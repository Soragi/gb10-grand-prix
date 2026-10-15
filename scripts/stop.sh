#!/usr/bin/env bash
# Stop the game server and the voice service.  --all also stops the race's own vLLM container.
set -uo pipefail
. "$(dirname "$0")/_env.sh"
for svc in server tts; do
  pidf="$DATA_DIR/$svc.pid"
  if alive "$pidf"; then kill "$(cat "$pidf")" && echo "stopped $svc"; fi
  rm -f "$pidf"
done
if [[ "${1:-}" == "--all" ]] && docker ps --format '{{.Names}}' | grep -qx "$VLLM_CONTAINER"; then
  docker stop "$VLLM_CONTAINER" >/dev/null && echo "stopped $VLLM_CONTAINER"
fi
