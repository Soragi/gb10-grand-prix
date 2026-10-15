#!/usr/bin/env bash
# Show which parts of the race are up.
. "$(dirname "$0")/_env.sh"
row() { if ok "$2"; then printf "  %-12s UP    %s\n" "$1" "$3"; else printf "  %-12s DOWN  %s\n" "$1" "$3"; fi; }
echo "DGX Spark GB10 Grand Prix"
row "Game + hub" "http://127.0.0.1:${PORT}/api/scores" "http://127.0.0.1:${PORT}/"
row "LLM" "$LLM_URL/v1/models" "$LLM_URL"
row "Voice" "$TTS_URL/health" "$TTS_URL"
if ok "$TTS_URL/health"; then echo "  voice: $(curl -s "$TTS_URL/health")"; fi
if ok "$LLM_URL/v1/models"; then echo "  model: $(curl -s "$LLM_URL/v1/models" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"][0]["id"])')"; fi
