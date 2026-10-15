# Shared configuration for the scripts. Values come from .env (optional) or the defaults below.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$REPO/.env" ]]; then set -a; . "$REPO/.env"; set +a; fi

PORT="${PORT:-8765}"                     # game + AI hub
TTS_PORT="${TTS_PORT:-8766}"             # voice service
LLM_PORT="${LLM_PORT:-8000}"             # vLLM
LLM_URL="${LLM_URL:-http://127.0.0.1:${LLM_PORT}}"
LLM_MODEL="${LLM_MODEL:-nvidia/Qwen3.6-35B-A3B-NVFP4}"
LLM_REVISION="${LLM_REVISION:-491c2f1ea524c639598bf8fa787a93fed5a6fbce}"
VLLM_IMAGE="${VLLM_IMAGE:-nvcr.io/nvidia/vllm:26.05.post1-py3}"
VLLM_CONTAINER="${VLLM_CONTAINER:-race-vllm}"
VLLM_GPU_MEM="${VLLM_GPU_MEM:-0.4}"     # share of the 128 GB unified memory vLLM may reserve
HF_CACHE="${HF_CACHE:-$HOME/.cache/huggingface}"
DATA_DIR="${DATA_DIR:-$REPO/data}"

export PORT TTS_PORT LLM_URL DATA_DIR
export TTS_URL="http://127.0.0.1:${TTS_PORT}"
export HF_HOME="$HF_CACHE"
mkdir -p "$DATA_DIR"

ok() { curl -fs -m 3 "$1" >/dev/null 2>&1; }
alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }
