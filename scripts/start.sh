#!/usr/bin/env bash
# Start the race: voice service + game/AI hub (+ the LLM container if no LLM is running).
#   ./scripts/start.sh          then open the game (windowed Firefox if a screen is attached)
#   ./scripts/start.sh --kiosk  fullscreen kiosk mode for the booth (Alt+F4 to exit)
set -euo pipefail
. "$(dirname "$0")/_env.sh"
cd "$REPO"
URL="http://127.0.0.1:${PORT}/"

# 1. LLM (optional: the game runs without it, just without commentary/debrief)
if ! ok "$LLM_URL/v1/models"; then
  if command -v docker >/dev/null && docker image inspect "$VLLM_IMAGE" >/dev/null 2>&1; then
    "$REPO/scripts/llm.sh" --no-wait
    echo "   the model needs a few minutes to load; the commentator switches on automatically"
  else
    echo "No LLM at $LLM_URL: AI commentary + debrief are off (run ./scripts/setup.sh, then ./scripts/llm.sh)."
  fi
fi

# 2. Voice service
if ! ok "$TTS_URL/health"; then
  if [[ -x tts/.venv/bin/python ]]; then
    setsid nohup tts/.venv/bin/python tts/tts_server.py "$TTS_PORT" > "$DATA_DIR/tts.log" 2>&1 < /dev/null &
    echo $! > "$DATA_DIR/tts.pid"
    echo "Voice service starting (loads on the GPU in ~30 s; log: data/tts.log)"
  else
    echo "Voice service not installed (run ./scripts/setup.sh): commentary will be text only."
  fi
fi

# 3. Game + AI hub
if ! ok "${URL}api/scores"; then
  setsid nohup python3 server/server.py > "$DATA_DIR/server.log" 2>&1 < /dev/null &
  echo $! > "$DATA_DIR/server.pid"
  for _ in $(seq 40); do ok "${URL}api/scores" && break; sleep 0.25; done
fi
ok "${URL}api/scores" || { echo "Game server failed to start, see data/server.log"; exit 1; }
echo "Race running at $URL   (status: ./scripts/status.sh, stop: ./scripts/stop.sh)"

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "No screen attached. From your laptop:  ssh -N -L ${PORT}:127.0.0.1:${PORT} $(whoami)@<spark-address>"
  echo "then open http://localhost:${PORT}/"
  exit 0
fi
if [[ "${1:-}" == "--kiosk" ]]; then firefox --kiosk "$URL" >/dev/null 2>&1 &
else firefox --new-window "$URL" >/dev/null 2>&1 &
fi
