#!/usr/bin/env python3
"""End-to-end test: plays a full race in headless Chromium with live AI commentary, voice and debrief.

Starts its own copy of the game server on a spare port with a temporary leaderboard, so real
scores are never touched. Needs the LLM and voice service running (./scripts/start.sh).

  python3 -m venv .venv-test && .venv-test/bin/pip install -r tests/requirements.txt
  .venv-test/bin/python -m playwright install chromium
  .venv-test/bin/python tests/e2e_race.py --lang en        # en | nl | fr
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.async_api import async_playwright

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def wait_up(url, secs=15):
    for _ in range(secs * 4):
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def post(url, obj):
    req = urllib.request.Request(url, data=json.dumps(obj).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=5))


async def race(base, lang, out, track):
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        pg = await browser.new_page(viewport={"width": 1280, "height": 720})
        errors, lines, maxtasks = [], [], 0
        pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
        pg.on("pageerror", lambda e: errors.append(str(e)))
        t0 = time.time()
        await pg.goto(base + "?debug=1")
        await pg.wait_for_timeout(2500)
        await pg.click(f"#langSel button[data-l={lang}]")
        await pg.click(f"#trackSel .trk[data-id={track}]")
        await pg.click("#grid .card:first-child")
        await pg.screenshot(path=os.path.join(out, "title.png"))
        await pg.keyboard.press("Enter")
        await pg.keyboard.down("ArrowUp")
        held = None
        while await pg.evaluate("window.__race.state") != "results":
            # simple autopilot: steer toward the inside of the next bend, fire turbo when charged
            x = await pg.evaluate("window.__race.x")
            c = await pg.evaluate("window.__race.curve")
            want = "ArrowRight" if x < c * 0.12 - 0.08 else "ArrowLeft" if x > c * 0.12 + 0.08 else None
            if want != held:
                if held:
                    await pg.keyboard.up(held)
                if want:
                    await pg.keyboard.down(want)
                held = want
            if int(time.time() * 4) % 6 == 0:
                await pg.keyboard.press("Space")
            txt = await pg.evaluate("document.getElementById('ticker').classList.contains('hidden') ? '' : "
                                    "'<' + document.querySelector('#ticker .tk-label').textContent + '> ' + "
                                    "document.getElementById('tkText').textContent + '  [' + document.getElementById('tkMeta').textContent + ']'")
            if txt and (not lines or lines[-1][1] != txt):
                lines.append((round(time.time() - t0, 1), txt))
                if len(lines) == 3:
                    await pg.screenshot(path=os.path.join(out, "race.png"))
            st = await pg.evaluate("fetch('api/stats').then(r => r.json())")
            maxtasks = max(maxtasks, st["llm"]["active"] + st["tts"]["active"])
            await pg.wait_for_timeout(250)
            if time.time() - t0 > 420:
                raise SystemExit("race did not finish within 7 minutes")
        if held:
            await pg.keyboard.up(held)
        await pg.keyboard.up("ArrowUp")
        for _ in range(60):
            meta = await pg.text_content("#dbMeta")
            st = await pg.evaluate("fetch('api/stats').then(r => r.json())")
            maxtasks = max(maxtasks, st["llm"]["active"] + st["tts"]["active"])
            if "tok/s" in meta or "offline" in meta:
                break
            await pg.wait_for_timeout(500)
        finish_line = (await pg.evaluate("window.__race.recent"))[-1:]
        print("TRACK PLACE:", await pg.evaluate("window.__race.place"), "of 8 · race time", round(await pg.evaluate("window.__race.time"), 2), "s")
        for _ in range(60):     # wait until the token counter is final (debrief + spoken verdict done)
            if (await pg.text_content("#uState")) == "FINAL":
                break
            await pg.wait_for_timeout(500)
        usage = {k: await pg.text_content("#" + k) for k in ("uState", "uLlm", "uTts", "uAudio", "uTot", "uSpot")}
        await pg.screenshot(path=os.path.join(out, "results.png"))
        print("RESULT SCREEN:", await pg.text_content("#resRank"))
        debrief = await pg.text_content("#dbText")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(out, "leaderboard.png"))
        await browser.close()
    return lines, debrief, meta, maxtasks, errors, finish_line, usage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="en", choices=["en", "nl", "fr"])
    ap.add_argument("--port", type=int, default=8799)
    ap.add_argument("--track", default="ai-factory", choices=["ai-factory", "hq-campus", "coral-reef"])
    ap.add_argument("--laps", type=int, default=3, choices=[1, 2, 3])
    args = ap.parse_args()
    out = os.path.join(REPO, "tests", "output")
    os.makedirs(out, exist_ok=True)
    data = tempfile.mkdtemp(prefix="race-test-")
    env = dict(os.environ, PORT=str(args.port), DATA_DIR=data)
    srv = subprocess.Popen([sys.executable, os.path.join(REPO, "server", "server.py")], env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{args.port}/"
        assert wait_up(base + "api/scores"), "test server did not start"
        post(base + "api/racers", {"name": "TESTBOT", "car": "#76b900", "suit": "#111111", "wheels": "neon"})
        post(base + "api/settings", {"laps": args.laps})
        time.sleep(2)   # let the stats sampler see the LLM + voice service
        lines, debrief, meta, maxtasks, errors, finish_line, usage = asyncio.run(race(base, args.lang, out, args.track))
    finally:
        srv.terminate()
    print("COMMENTARY:")
    for t, l in lines:
        print(f"  {t:5.1f}s  {l}")
    print("FINISH CALL:", finish_line)
    print("DEBRIEF:\n" + debrief)
    print("TOKENS:", json.dumps(usage, ensure_ascii=False))
    print("META:", meta)
    print("MAX CONCURRENT AI TASKS:", maxtasks)
    print("JS ERRORS:", errors or "none")
    print("Screenshots:", out)
    spotlight = any("SPOTLIGHT" in l for _, l in lines)
    print("PRODUCT SPOTLIGHT SHOWN:", spotlight)
    ok = not errors and lines and debrief.strip() and usage["uState"] == "FINAL" and spotlight
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
