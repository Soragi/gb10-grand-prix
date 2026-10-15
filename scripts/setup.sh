#!/usr/bin/env bash
# One-time setup on a fresh DGX Spark.
#   ./scripts/setup.sh             voice service + pull the vLLM container image
#   ./scripts/setup.sh --skip-llm  voice service only (you already run an LLM)
set -euo pipefail
. "$(dirname "$0")/_env.sh"
cd "$REPO"
SKIP_LLM=0; [[ "${1:-}" == "--skip-llm" ]] && SKIP_LLM=1

echo "== 1/4 Checking the machine"
[[ "$(uname -m)" == "aarch64" ]] || echo "   note: expected aarch64 (DGX Spark), found $(uname -m)"
command -v nvidia-smi >/dev/null || { echo "   nvidia-smi not found: the GPU driver is missing (DGX OS includes it)"; exit 1; }
echo "   GPU: $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader)"
for c in python3 curl git; do command -v "$c" >/dev/null || { echo "   missing '$c' (sudo apt install $c)"; exit 1; }; done
if ! command -v uv >/dev/null && [[ ! -x "$HOME/.local/bin/uv" ]]; then
  echo "   installing uv (Python package manager)"; curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"

echo "== 2/4 Voice service environment (tts/.venv, ~6 GB)"
[[ -x tts/.venv/bin/python ]] || "$UV" venv -p 3.12 tts/.venv
"$UV" pip install -p tts/.venv/bin/python -r tts/requirements-torch.txt --index-url https://download.pytorch.org/whl/cu130
"$UV" pip install -p tts/.venv/bin/python -r tts/requirements.txt
"$UV" pip install -p tts/.venv/bin/python --no-deps -r tts/requirements-chatterbox.txt

echo "== 3/4 Downloading + checking the voice models on the GPU (~7 GB into $HF_CACHE)"
HF_HOME="$HF_CACHE" tts/.venv/bin/python - <<'PY'
import warnings; warnings.filterwarnings("ignore")
import torch
assert torch.cuda.is_available(), "PyTorch cannot see the GPU"
print("   torch", torch.__version__, "on", torch.cuda.get_device_name(0))
from chatterbox.tts_turbo import ChatterboxTurboTTS
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
ChatterboxTurboTTS.from_pretrained(device="cuda"); ChatterboxMultilingualTTS.from_pretrained(device="cuda")
print("   voice models OK")
PY

echo "== 4/4 LLM container image"
if [[ $SKIP_LLM == 1 ]]; then
  echo "   skipped (--skip-llm). Point LLM_URL in .env at your OpenAI-compatible server."
elif ! command -v docker >/dev/null; then
  echo "   docker not found: install Docker + the GPU container toolkit (DGX OS ships both)"; exit 1
else
  docker pull "$VLLM_IMAGE"
fi

echo
echo "Setup done. Next:"
echo "  ./scripts/llm.sh      start the LLM (first run downloads the ~22 GB model)"
echo "  ./scripts/start.sh    start the game"
