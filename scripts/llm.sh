#!/usr/bin/env bash
# Start the local LLM: vLLM in the GPU-optimized vLLM container, serving a 4-bit (NVFP4) model on the GB10.
# Does nothing if an LLM already answers on $LLM_URL (e.g. one shared with other apps).
#   ./scripts/llm.sh            start and wait until the model is loaded
#   ./scripts/llm.sh --no-wait  start and return immediately
#   ./scripts/llm.sh --stop     stop the race's own vLLM container
set -euo pipefail
. "$(dirname "$0")/_env.sh"

if [[ "${1:-}" == "--stop" ]]; then docker stop "$VLLM_CONTAINER" >/dev/null && echo "stopped $VLLM_CONTAINER"; exit 0; fi
if ok "$LLM_URL/v1/models"; then echo "LLM already answering at $LLM_URL, reusing it."; exit 0; fi

if docker ps -a --format '{{.Names}}' | grep -qx "$VLLM_CONTAINER"; then
  docker start "$VLLM_CONTAINER" >/dev/null
else
  mkdir -p "$HF_CACHE"
  docker run -d --name "$VLLM_CONTAINER" --restart unless-stopped \
    --gpus all --ipc=host \
    -p "127.0.0.1:${LLM_PORT}:8000" \
    -v "$HF_CACHE:/root/.cache/huggingface" \
    ${HF_TOKEN:+-e HF_TOKEN} \
    "$VLLM_IMAGE" \
    vllm serve "$LLM_MODEL" --revision "$LLM_REVISION" --port 8000 \
      --trust-remote-code --quantization modelopt --kv-cache-dtype fp8 \
      --max-model-len 32768 --gpu-memory-utilization "$VLLM_GPU_MEM" \
      --max-num-seqs 8 --max-num-batched-tokens 8192 --enable-chunked-prefill --enable-prefix-caching \
      --reasoning-parser qwen3 >/dev/null
fi
echo "vLLM container '$VLLM_CONTAINER' started ($LLM_MODEL)."
[[ "${1:-}" == "--no-wait" ]] && exit 0

echo "Waiting for the model to load (first run downloads ~22 GB; logs: docker logs -f $VLLM_CONTAINER)"
for _ in $(seq 360); do
  if ok "$LLM_URL/v1/models"; then echo "LLM ready at $LLM_URL"; exit 0; fi
  sleep 5
done
echo "LLM not ready after 30 min. Check: docker logs $VLLM_CONTAINER"; exit 1
