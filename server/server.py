#!/usr/bin/env python3
"""Local server + AI hub for the DGX Spark GB10 Grand Prix.

- Serves the game and keeps the leaderboard in data/scores.json.
- /api/commentary  live race commentary from the local LLM (vLLM on the DGX Spark)
- /api/debrief     streamed AI race-engineer debrief (NDJSON)
- /api/tts         proxy to the GPU text-to-speech service (tts/tts_server.py)
- /api/stats       live GB10 telemetry for the "Powered by the GB10" panel
- /api/settings    race settings shared by every screen (laps per race: 1, 2 or 3)
- /api/usage       exact AI token consumption of one race (LLM text tokens + TTS text/speech tokens)
- /api/racers      the racer garage (custom karts), stored in data/racers.json

Every request runs on its own thread, so commentary, debrief, speech and stats all
run at the same time. Usage: python3 server/server.py   (configuration via environment, see .env.example)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(REPO, "web")
DATA = os.environ.get("DATA_DIR") or os.path.join(REPO, "data")
SCORES = os.path.join(DATA, "scores.json")
RACERS = os.path.join(DATA, "racers.json")
SETTINGS = os.path.join(DATA, "settings.json")
DEFAULT_SETTINGS = {"laps": 3}


def load_settings():
    try:
        with open(SETTINGS) as f:
            s = json.load(f)
        return {"laps": s.get("laps") if s.get("laps") in (1, 2, 3) else 3}
    except (OSError, ValueError, AttributeError):
        return dict(DEFAULT_SETTINGS)
LOCK = threading.Lock()

LLM_URL = os.environ.get("LLM_URL", "http://127.0.0.1:8000")
LLM_MODEL = os.environ.get("LLM_MODEL", "")          # auto-detected from /v1/models when empty
TTS_URL = os.environ.get("TTS_URL", "http://127.0.0.1:8766")
LLM_SLOTS = threading.BoundedSemaphore(int(os.environ.get("LLM_SLOTS", "3")))
LANGS = {"en": "English", "nl": "Dutch (as spoken in Belgium and the Netherlands)", "fr": "French"}

STATS = {
    "gpu": {"name": "GB10", "util": None, "power": None, "temp": None},
    "mem": {"used_gb": None, "total_gb": None},
    "llm": {"model": "", "online": False, "tps": 0.0, "running": 0, "waiting": 0,
            "active": 0, "calls": 0, "last_ms": 0, "last_tps": 0.0},
    "tts": {"online": False, "ready": False, "busy": False, "queue": 0, "active": 0,
            "calls": 0, "last_ms": 0, "models": []},
}
SLOCK = threading.Lock()


# ------------------------------------------------------------------ per-race token accounting
# Every AI call carries the race's run id. Counts come straight from the models: vLLM's usage block
# (prompt/completion tokens) and the TTS service's X-Text-Tokens / X-Speech-Tokens headers. Calls the
# browser abandoned (e.g. stale commentary) still count: they used the GPU.
RUNS = {}
RLOCK = threading.Lock()


def run_usage(run):
    run = str(run or "")[:40]
    if not run:
        return None
    with RLOCK:
        if run not in RUNS:
            if len(RUNS) > 200:
                RUNS.pop(next(iter(RUNS)))
            RUNS[run] = {"llm": {"calls": 0, "prompt": 0, "completion": 0, "commentary": 0, "debrief": 0},
                         "tts": {"clips": 0, "text": 0, "speech": 0, "audio_ms": 0},
                         "active": 0, "product": None}
        return RUNS[run]


def add_usage(run, section, **kw):
    u = run_usage(run)
    if u:
        with RLOCK:
            for k, v in kw.items():
                u[section][k] += int(v)


def set_active(run, delta):
    u = run_usage(run)
    if u:
        with RLOCK:
            u["active"] += delta


# ------------------------------------------------------------------ product spotlight (one per race)
try:
    with open(os.path.join(REPO, "server", "products.json")) as fh:
        PRODUCTS = json.load(fh)
except (OSError, ValueError):
    PRODUCTS = []
PRODUCT_NEXT = [int(time.time()) % max(1, len(PRODUCTS))]


def product_for(run):
    """Rotate through products.json so consecutive races feature different products."""
    u = run_usage(run)
    if not PRODUCTS:
        return None
    with RLOCK:
        if u is None:
            return PRODUCTS[0]
        if u["product"] is None:
            u["product"] = PRODUCT_NEXT[0] % len(PRODUCTS)
            PRODUCT_NEXT[0] += 1
        return PRODUCTS[u["product"]]


# ------------------------------------------------------------------ leaderboard
def load(path=SCORES):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def save(items, path=SCORES):
    os.makedirs(DATA, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(items, f, indent=1)
    os.replace(tmp, path)


HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
WHEELS = {"classic", "chrome", "neon", "gold", "monster"}


def color(v, default):
    return v if isinstance(v, str) and HEX.match(v) else default


def clean_racer(r):
    name = re.sub(r"[^A-Z0-9 .&'_-]", "", str(r.get("name", "")).upper()).strip()[:12]
    return {
        "id": re.sub(r"[^a-z0-9]", "", str(r.get("id", "")).lower())[:24],
        "name": name,
        "car": color(r.get("car"), "#76b900"),
        "suit": color(r.get("suit"), "#ffffff"),
        "wheels": r.get("wheels") if r.get("wheels") in WHEELS else "classic",
    }


def clean(entry):
    num = lambda k: float(entry.get(k, 0))
    return {
        "id": str(entry.get("id", ""))[:32],
        "name": str(entry.get("name", "?")).strip()[:18] or "?",
        "company": str(entry.get("company", "?"))[:40],
        "time": num("time"),
        "gpus": int(num("gpus")),
        "totalGpus": int(num("totalGpus")),
        "score": num("score"),
        "place": int(num("place")),
        "date": str(entry.get("date", ""))[:40],
        "track": re.sub(r"[^a-z0-9-]", "", str(entry.get("track", "")))[:24],
        "route": re.sub(r"[^a-z0-9-]", "", str(entry.get("route", "")))[:24],
        "laps": int(num("laps")) if num("laps") in (1, 2, 3) else 3,
        "racerId": re.sub(r"[^a-z0-9]", "", str(entry.get("racerId", "")).lower())[:24],
        "car": color(entry.get("car"), "#76b900"),
        "suit": color(entry.get("suit"), "#ffffff"),
        "wheels": entry.get("wheels") if entry.get("wheels") in WHEELS else "classic",
    }


# ------------------------------------------------------------------ LLM
def bump(section, key, delta):
    with SLOCK:
        STATS[section][key] += delta


def llm_request(messages, max_tokens, temperature, stream=False, timeout=20):
    body = {
        "model": LLM_MODEL, "messages": messages, "max_tokens": max_tokens,
        "temperature": temperature, "top_p": 0.95, "stream": stream,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if stream:
        body["stream_options"] = {"include_usage": True}
    req = urllib.request.Request(LLM_URL + "/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=timeout)


def tidy_line(text, max_words=24):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    text = text.splitlines()[0] if text else ""
    text = text.strip().strip('"“”«»*').strip()
    words = text.split()
    return " ".join(words[:max_words])


COMMENTARY_SYS = (
    "You are the lead TV commentator on a Formula 1 broadcast, calling the 'DGX Spark GB10 Grand Prix', a retro "
    "kart race, raced over 1 to 3 laps (see the facts) on one of three themed tracks that share the same route (an AI Factory data "
    "center, the HQ Campus offices and garden, or an underwater coral reef with OpenClaw lobsters). Each kart carries its "
    "driver's name; AI rivals are named after GPU architectures. Racers collect floating GPUs "
    "(they count toward the score) and every 5 GPUs charge a turbo. "
    "Call the EVENT the way a seasoned F1 commentator does: say what happened AND explain why it matters, "
    "using the facts (gap in seconds, position, track section, GPUs, turbo). Use real F1 broadcast language where it fits: "
    "lights out and away we go, down the inside, into the hairpin, the gap is down to, track limits, into the barrier, "
    "slipstream, track position, a costly mistake, a big moment, overtake mode for the turbo. Vary phrasing; avoid cliches already used. "
    "Base the line on what actually happened in THIS race: use the EVENT, the race story so far and the facts, and "
    "connect to earlier moments when it adds drama (a comeback after a crash, a GPU streak paying off). Never invent "
    "events, karts or numbers. "
    "Max 24 words, one or two sentences, in {lang}. "
    "Use the track's own scenery and section names to paint the picture. "
    "Refer to the driver by name. Never use gendered pronouns for the driver "
    "(not he/she/him/her, not hij/zij/hem/haar, not il/elle/lui); repeat the name or the company instead. "
    "Plain text only, it will be read aloud: no emojis, hashtags, quotes, asterisks or stage directions. "
    "Never mention company or brand names. Do not repeat earlier lines."
)

PRODUCT_SYS = (
    "You are the lead TV commentator on a Formula 1 style broadcast of the 'DGX Spark GB10 Grand Prix', a retro "
    "kart race. During a calm moment of the race, give a short technology spotlight "
    "on the TECHNOLOGY below, like a broadcaster explaining the tech behind the event. "
    "Exactly one or two sentences, max 40 words in total, in {lang}. Use ONLY the facts given: no other claims, "
    "numbers, prices or comparisons. You may use a race moment as a bridge into the spotlight, but never claim that the "
    "driver, the kart or this race uses it unless one of the facts says so. Never name any company. "
    "Refer to the driver by name, never with gendered pronouns. "
    "Plain text only, it will be read aloud: no emojis, hashtags, quotes or asterisks."
)

DEBRIEF_SYS = (
    "You are the AI Race Engineer, an upbeat Formula 1 style race engineer, debriefing a driver after a retro kart "
    "race at the DGX Spark GB10 Grand Prix. Use the telemetry. Write in {lang}.\n"
    "Format exactly:\n"
    "Line 1: a one-sentence verdict, max 18 words, that states the driver's EVENT LEADERBOARD position (not the "
    "position among the karts on track).\n"
    "Then exactly 3 lines, each starting with '• ', each a concrete tip of max 20 words that names a track section "
    "and uses numbers from the telemetry.\n"
    "Address the driver as 'you' (jij/je, tu) or by name. Never use gendered pronouns for the driver. No markdown, no headings."
)


def commentary(payload):
    lang = payload.get("lang") if payload.get("lang") in LANGS else "en"
    run = payload.get("run")
    facts = str(payload.get("facts", ""))[:2400]
    recent = [str(x)[:220] for x in payload.get("recent", [])][-5:]
    product = product_for(run) if payload.get("kind") == "product" else None
    if product:
        system = PRODUCT_SYS.format(lang=LANGS[lang])
        user = (f"TECHNOLOGY: {product['name']}\nFacts:\n- " + "\n- ".join(product["facts"]) + f"\n\nRace context: {facts}")
        max_words = 45
    else:
        system = COMMENTARY_SYS.format(lang=LANGS[lang])
        user = facts + ("\nEarlier lines (do not repeat): " + " | ".join(recent) if recent else "")
        max_words = 32
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    if not LLM_SLOTS.acquire(timeout=1.5):
        return {"error": "busy"}, 429
    bump("llm", "active", 1)
    set_active(run, 1)
    t = time.time()
    try:
        with llm_request(msgs, 110 if product else 72, 0.9, timeout=8) as r:
            d = json.load(r)
        text = tidy_line(" ".join((d["choices"][0]["message"].get("content") or "").split()), max_words)
        ms = int((time.time() - t) * 1000)
        u = d.get("usage") or {}
        add_usage(run, "llm", calls=1, commentary=1, prompt=u.get("prompt_tokens", 0), completion=u.get("completion_tokens", 0))
        with SLOCK:
            STATS["llm"]["calls"] += 1
            STATS["llm"]["last_ms"] = ms
        out = {"text": text, "ms": ms, "prompt_tokens": u.get("prompt_tokens", 0), "tokens": u.get("completion_tokens", 0)}
        if product:
            out["product"] = product["name"]
        return out, 200
    except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
        return {"error": str(e)}, 502
    finally:
        set_active(run, -1)
        bump("llm", "active", -1)
        LLM_SLOTS.release()


# ------------------------------------------------------------------ stats sampler
def sample_forever():
    last_gen, last_t = None, None
    while True:
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=name,utilization.gpu,power.draw,temperature.gpu",
                                  "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=3).stdout
            parts = [p.strip() for p in out.strip().split("\n")[0].split(",")]
            f = lambda s: float(s) if re.match(r"^[\d.]+$", s or "") else None
            with SLOCK:
                STATS["gpu"].update(name=parts[0].split()[-1] if parts[0] else "GB10", util=f(parts[1]), power=f(parts[2]), temp=f(parts[3]))
        except Exception:
            pass
        try:
            mi = {}
            with open("/proc/meminfo") as fh:
                for line in fh:
                    k, v = line.split(":", 1)
                    mi[k] = int(v.split()[0])
            with SLOCK:
                STATS["mem"].update(total_gb=round(mi["MemTotal"] / 1048576, 1),
                                    used_gb=round((mi["MemTotal"] - mi["MemAvailable"]) / 1048576, 1))
        except Exception:
            pass
        try:
            with urllib.request.urlopen(LLM_URL + "/metrics", timeout=2) as r:
                m = r.read().decode()
            g = lambda name: sum(float(x) for x in re.findall(r"^vllm:%s\{[^}]*\} ([\d.e+]+)$" % name, m, re.M))
            gen, now = g("generation_tokens_total"), time.time()
            with SLOCK:
                if last_gen is not None and now > last_t:
                    STATS["llm"]["tps"] = round(max(0.0, (gen - last_gen) / (now - last_t)), 1)
                STATS["llm"].update(online=True, running=int(g("num_requests_running")), waiting=int(g("num_requests_waiting")))
            last_gen, last_t = gen, now
        except Exception:
            with SLOCK:
                STATS["llm"].update(online=False, tps=0.0)
        try:
            with urllib.request.urlopen(TTS_URL + "/health", timeout=2) as r:
                h = json.load(r)
            with SLOCK:
                STATS["tts"].update(online=True, ready=h.get("ready", False), busy=h.get("busy", False),
                                    queue=h.get("queue", 0), models=h.get("models", []))
        except Exception:
            with SLOCK:
                STATS["tts"].update(online=False, ready=False)
        time.sleep(1)


def detect_model():
    global LLM_MODEL
    while not LLM_MODEL:
        try:
            with urllib.request.urlopen(LLM_URL + "/v1/models", timeout=3) as r:
                LLM_MODEL = json.load(r)["data"][0]["id"]
        except Exception:
            time.sleep(5)
    with SLOCK:
        STATS["llm"]["model"] = LLM_MODEL


# ------------------------------------------------------------------ HTTP
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self, limit=20000):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n < 0 or n > limit:
            raise ValueError("request body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def list_directory(self, path):          # never expose directory listings
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/scores":
            with LOCK:
                return self._json(load())
        if path == "/api/racers":
            with LOCK:
                return self._json(load(RACERS))
        if path == "/api/settings":
            with LOCK:
                return self._json(load_settings())
        if path == "/api/usage":
            run = (self.path.split("run=", 1) + [""])[1].split("&")[0]
            u = run_usage(run)
            if not u:
                return self._json({"error": "unknown run"}, 404)
            with RLOCK:
                out = json.loads(json.dumps(u))
            out["product"] = PRODUCTS[out["product"]]["name"] if out["product"] is not None and PRODUCTS else None
            out["llm"]["total"] = out["llm"]["prompt"] + out["llm"]["completion"]
            out["tts"]["total"] = out["tts"]["text"] + out["tts"]["speech"]
            out["total"] = out["llm"]["total"] + out["tts"]["total"]
            return self._json(out)
        if path == "/api/stats":
            with SLOCK:
                return self._json(json.loads(json.dumps(STATS)))
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            payload = self._body()
        except (ValueError, TypeError):
            return self._json({"error": "bad request"}, 400)
        if path == "/api/scores":
            try:
                entry = clean(payload)
            except (ValueError, TypeError):
                return self._json({"error": "bad entry"}, 400)
            with LOCK:
                scores = load()
                if not any(s.get("id") == entry["id"] for s in scores):
                    scores.append(entry)
                    save(scores)
                return self._json(scores)
        if path == "/api/settings":
            laps = payload.get("laps")
            if laps not in (1, 2, 3):
                return self._json({"error": "laps must be 1, 2 or 3"}, 400)
            with LOCK:
                s = load_settings()
                s["laps"] = laps
                save(s, SETTINGS)
                return self._json(s)
        if path == "/api/racers":
            r = clean_racer(payload)
            if not r["name"]:
                return self._json({"error": "Give your racer a name first."}, 400)
            with LOCK:
                racers = load(RACERS)
                if any(x["name"] == r["name"] and x["id"] != r["id"] for x in racers):
                    return self._json({"error": f"The name {r['name']} is already taken."}, 409)
                if not r["id"] or not any(x["id"] == r["id"] for x in racers):
                    r["id"] = r["id"] or ("r" + format(int(time.time() * 1000), "x"))
                    racers.append(r)
                else:
                    racers = [r if x["id"] == r["id"] else x for x in racers]
                save(racers, RACERS)
                return self._json({"racer": r, "racers": racers})
        if path == "/api/commentary":
            obj, code = commentary(payload)
            return self._json(obj, code)
        if path == "/api/debrief":
            return self.debrief(payload)
        if path == "/api/tts":
            return self.tts(payload)
        return self._json({"error": "not found"}, 404)

    def do_DELETE(self):
        if self.path.split("?")[0] == "/api/racers":
            rid = re.sub(r"[^a-z0-9]", "", (self.path.split("id=", 1) + [""])[1].split("&")[0].lower())
            with LOCK:
                racers = [x for x in load(RACERS) if x["id"] != rid]
                save(racers, RACERS)
                return self._json(racers)
        if self.path.split("?")[0] != "/api/scores":
            return self._json({"error": "not found"}, 404)
        with LOCK:
            if os.path.exists(SCORES):  # keep a backup of every wiped board
                shutil.copy(SCORES, os.path.join(DATA, f"scores-backup-{time.strftime('%Y%m%d-%H%M%S')}.json"))
            save([])
            return self._json([])

    def debrief(self, payload):
        """Stream the race-engineer debrief as NDJSON: {"t": "..."} chunks, then {"done": true, ...}."""
        lang = payload.get("lang") if payload.get("lang") in LANGS else "en"
        msgs = [{"role": "system", "content": DEBRIEF_SYS.format(lang=LANGS[lang])},
                {"role": "user", "content": str(payload.get("telemetry", ""))[:4000]}]
        run = payload.get("run")
        if not LLM_SLOTS.acquire(timeout=15):
            return self._json({"error": "busy"}, 429)
        bump("llm", "active", 1)
        set_active(run, 1)
        ptok = 0
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()
        t0, first, ntok, chunks = time.time(), None, 0, 0
        try:
            with llm_request(msgs, 220, 0.6, stream=True, timeout=30) as r:
                for raw in r:
                    line = raw.decode("utf-8", "ignore").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    d = json.loads(data)
                    if d.get("usage"):
                        ntok = d["usage"].get("completion_tokens", ntok)
                        ptok = d["usage"].get("prompt_tokens", ptok)
                    for ch in d.get("choices", []):
                        piece = ch.get("delta", {}).get("content")
                        if piece:
                            if first is None:
                                first = time.time()
                            chunks += 1
                            self.wfile.write((json.dumps({"t": piece}) + "\n").encode())
            ntok = ntok or chunks
            add_usage(run, "llm", calls=1, debrief=1, prompt=ptok, completion=ntok)
            gen_s = max(0.001, time.time() - (first or t0))
            tps = round(ntok / gen_s, 1) if ntok else 0.0
            ttft = int(((first or time.time()) - t0) * 1000)
            with SLOCK:
                STATS["llm"]["calls"] += 1
                STATS["llm"]["last_tps"] = tps
            self.wfile.write((json.dumps({"done": True, "tokens": ntok, "prompt_tokens": ptok, "tps": tps, "ttft_ms": ttft}) + "\n").encode())
        except (urllib.error.URLError, OSError, ValueError) as e:
            try:
                self.wfile.write((json.dumps({"error": str(e)}) + "\n").encode())
            except OSError:
                pass
        finally:
            set_active(run, -1)
            bump("llm", "active", -1)
            LLM_SLOTS.release()

    def tts(self, payload):
        run = payload.get("run")
        bump("tts", "active", 1)
        set_active(run, 1)
        t = time.time()
        try:
            req = urllib.request.Request(TTS_URL + "/tts", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=35) as r:
                audio = r.read()
                hdr = {k: int(r.headers.get(h, 0) or 0) for k, h in
                       (("text", "X-Text-Tokens"), ("speech", "X-Speech-Tokens"), ("audio_ms", "X-Audio-Ms"))}
            add_usage(run, "tts", clips=1, **hdr)
            with SLOCK:
                STATS["tts"]["calls"] += 1
                STATS["tts"]["last_ms"] = int((time.time() - t) * 1000)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)
        except urllib.error.HTTPError as e:
            self._json({"error": "tts %s" % e.code}, e.code)
        except (urllib.error.URLError, OSError) as e:
            self._json({"error": str(e)}, 502)
        finally:
            set_active(run, -1)
            bump("tts", "active", -1)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8765"))
    host = os.environ.get("BIND_HOST", "127.0.0.1")   # localhost only by default; use an SSH tunnel to reach it
    threading.Thread(target=detect_model, daemon=True).start()
    threading.Thread(target=sample_forever, daemon=True).start()
    print(f"DGX Spark GB10 Grand Prix -> http://{host}:{port}/", flush=True)
    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    srv.serve_forever()
