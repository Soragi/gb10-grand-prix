# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, …) working in this repository.

## What this is
The DGX Spark GB10 Grand Prix: a retro pseudo-3D kart racer for an event booth, running on a DGX Spark (GB10, aarch64, 128 GB unified memory,
CUDA 13). Three AI tasks run in parallel on the Spark: live LLM commentary with GPU text-to-speech, a streamed LLM race
debrief, and a live telemetry panel. Read `README.md` for the user-facing view and `docs/architecture.png` for the data flow.

## Layout
```
web/            index.html, style.css
web/js/         util.js (helpers) → art.js (karts, wheels, GPUs, ads) → tracks.js (3 tracks) → game.js (engine, garage,
                leaderboards, AI client). Plain scripts sharing the window.RACE namespace, loaded in that order.
server/         server.py: static files + racers + leaderboard + AI hub. Python stdlib ONLY (no pip deps).
                products.json: product spotlight facts (the only claims the commentator may make)
tts/            tts_server.py (Chatterbox on CUDA) + pinned requirements; runs in tts/.venv
scripts/        _env.sh (shared config, reads .env), setup.sh, llm.sh, start.sh, stop.sh, status.sh
tests/          e2e_race.py: headless full race against an isolated server + temp leaderboard
docs/           architecture.html (source) -> architecture.png via render_diagram.py
data/           runtime only (scores.json, racers.json, logs, pids). Git-ignored. Never commit.
```

## Run / verify
```bash
./scripts/status.sh                      # what's up
./scripts/start.sh  /  ./scripts/stop.sh # services (pid files in data/)
for f in web/js/*.js; do node --check $f; done   # JS syntax
python3 -m py_compile server/server.py tts/tts_server.py
.venv-test/bin/python tests/e2e_race.py --lang en --track hq-campus --laps 1   # full race with live AI; PASS/FAIL
```
After changing `server/server.py`, restart with `./scripts/stop.sh && ./scripts/start.sh`. Browser files are served
with `Cache-Control: no-store`, so a page reload picks up `web/` changes. To see a change, run the e2e test or take
screenshots with Playwright. Don't assume it works.

## Architecture rules (keep these true)
- **The game loop never awaits AI.** All AI calls are async with timeouts, and the race must stay playable with the LLM
  and/or the voice offline. Check `AI.llmOk()` / `AI.ttsOk()` before calling.
- **Concurrency is deliberate.** Commentary is pipelined: the next line is generated and voiced while the current clip
  plays (`Snd.voiceRemaining()`). The debrief starts at `finishRace()`, alongside the finish call. The server caps LLM
  calls with `LLM_SLOTS` (3) because vLLM may be shared with other apps. The TTS service has one GPU worker with a
  priority queue and drops stale commentary.
- **Prompts** live in `server/server.py` (`COMMENTARY_SYS`, `DEBRIEF_SYS`). They must keep telling the model to refer to
  drivers by name or company and **never use gendered pronouns** (EN/NL/FR). Qwen "thinking" is disabled via
  `chat_template_kwargs.enable_thinking=false`. Keep it off, because latency matters.
- **Token accounting is exact, not estimated.** Each race has `AI.runId`, sent with every AI call. The server adds up
  vLLM's `usage` (prompt and completion tokens) and the TTS service's `X-Text-Tokens` / `X-Speech-Tokens` headers. The
  TTS service counts tokens by wrapping Chatterbox's T3 `inference*` methods. Keep `run` on any new AI call, or
  `/api/usage` will under-report.
- **Finish = leaderboard position.** The finish call, the banner and the debrief must state the event leaderboard rank.
  The on-track position among the computer karts doesn't count for the ranking.
- **Product spotlight:** exactly one per race, with facts only from `server/products.json` (`PRODUCT_SYS` forbids other
  claims). It's queued at 30% of the lap and gets top priority from 55%, so it always airs.
- **One leaderboard for all tracks.** The tracks share one route (`route()` in tracks.js) and the GPUs use a fixed seed,
  so never give a track its own geometry or GPU layout. Change `route()` for all tracks together and bump `R.ROUTE_ID`:
  runs from another route id are hidden from the board. The board is deduplicated by racer name (case-insensitive), keeping each racer's
  best run (`boardFor()` / `rankFor()` in game.js). Every run is still stored in `data/scores.json`.
- **Racers** are user-created only (`/api/racers`, unique names enforced by the server). The 8 AI rivals in `R.RIVALS`
  (art.js) only fill the grid and can't be selected.
- **Tracks** are data + drawing in tracks.js (`layout` = `route()` with the track's 10 section names + zones, `zones`,
  `bg`, `art`, `decorate`, optional `overlay`). The route's last section is a straight back at height 0, because the
  start/finish line is segment 0. Any drawing
  loop that shrinks a step size needs a floor, or it can hang the page.
- **Fair scoring.** Track and GPU placement come from a seeded RNG (`mulberry32(2026)`), so every player gets the same
  track. Don't randomise them per run.
- **Security.** Bind to `127.0.0.1` by default (`BIND_HOST`). No secrets in code. `.env` is git-ignored. Player names
  only go to `data/` and to the local LLM. Escape user text with `esc()` before putting it in `innerHTML`.

## Conventions
- No build step and no frameworks: vanilla JS in `web/js/*.js`, sections marked with `// ---- NAME` banners.
- Laps per race (1/2/3) is a setting: ⚙ Settings → `/api/settings` → `data/settings.json`. Leaderboards are per lap
  count (`lapsOf()`), so never compare runs with different `laps`.
- Tunables are constants at the top of `web/js/game.js` (NUM_CPU, CPU_PACE, GPU_BONUS, …) and in `scripts/_env.sh` / `.env`.
- `?shot=race&track=coral-reef&t=20` (or `shot=garage` / `shot=board`) renders a screen synchronously for screenshots.
- Python: stdlib in `server/`. Heavy ML dependencies belong only in `tts/requirements*.txt` (pinned; torch comes from the cu130 index).

## Gotchas
- Don't stop services with `pkill -f "server.py"`: the pattern also matches your own shell command. Use
  `./scripts/stop.sh` (pid files).
- Firefox on Ubuntu is a Snap: it can't read `/tmp`. Keep any screenshots or profiles under `$HOME`.
- The GPU tool (`nvidia-smi`) shows no memory figures on the GB10 (unified memory). The server reads `/proc/meminfo` instead.
- Chatterbox's upstream package pins `torch==2.6`, which has no GB10 build. That's why it's installed `--no-deps` on top
  of torch 2.14 cu130.
- `?debug=1` exposes `window.__race` (used by the e2e autopilot). `?shot=race|finish|board` runs a synchronous
  simulation for static screenshots.

## Branding
- The game is called **DGX Spark GB10 Grand Prix** and is "powered by the GB10". No company, vendor, partner or organizer
  names or logos anywhere: titles, ads, UI text, prompts, spotlights (`server/products.json`) or docs. The only allowed
  exceptions are technical identifiers that setup needs (driver tool, container image path, model ID).
- `server/products.json` facts describe this setup (35B mixture-of-experts LLM, ~3B active). Update them if you change `LLM_MODEL`.
