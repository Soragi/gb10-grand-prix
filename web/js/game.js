/* DGX Spark GB10 Grand Prix: engine, game flow, garage/settings, leaderboard and the AI features.
 * Road engine: classic "OutRun-style" segment projection. Tracks live in tracks.js, kart art in art.js. */
'use strict';
(function () {
const R = window.RACE;
const { U, increase, mulberry32, shuffle, fmtTime, ordinal, esc, mk, W, H } = R;

// ------------------------------------------------------------------ CONFIG
const STEP = 1 / 60;
const SEG = 200, RUMBLE = 3, ROAD_W = 2000, LANES = 3, FOV = 100, CAM_H = 1000;
const DRAW_DIST = 300, FOG_DENSITY = 4;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const PLAYER_Z = CAM_H * CAM_DEPTH;
const MAX_SPEED = SEG / STEP;                 // ~ 12000 world units / s
const ACCEL = MAX_SPEED / 5, BRAKING = -MAX_SPEED, DECEL = -MAX_SPEED / 5;
const OFFROAD_DECEL = -MAX_SPEED / 2, OFFROAD_LIMIT = MAX_SPEED / 4, CENTRIFUGAL = 0.3;
const BOOST_SPEED = MAX_SPEED * 1.35;
const KART_WW = 560, KART_N = KART_WW / ROAD_W;
let LAPS = 3;                                 // race setting (1, 2 or 3), shared via /api/settings
const NUM_CPU = 7;
const CPU_PACE = [0.92, 0.06];                // CPU top speed = MAX_SPEED * (0.92 .. 0.98 + a little random)
const GPU_BONUS = 0.5, PERFECT_BONUS = 10, GPUS_PER_TURBO = 5, MAX_TURBO = 1;
const KMH = 240;                              // display km/h at MAX_SPEED
const STORE_KEY = 'gb10GrandPrix.scores.v1', RACER_KEY = 'gb10GrandPrix.racers.v1';

// ------------------------------------------------------------------ TRACK ENGINE
let track = null;
let segments = [], trackLength = 0, N = 0, gpusPerLap = 0;
const SECTIONS = [];
let SPR = {};
const SHARED = {}, BG = {};
const OBSTACLE_SHARED = { barrier: 'advertising board', billboard: 'billboard' };

function buildShared() {
  SHARED.gpu = [0, 1, 2, 3].map(R.drawGPU);
  SHARED.barrier = [0, 1, 2].map(v => R.drawBarrier(v));
  SHARED.billboard = [0, 1, 2].map(R.drawBillboard);
  SHARED.gantry = [R.drawStartGantry()];
  Object.assign(SPR, SHARED);
}
function lastY() { return segments.length ? segments[segments.length - 1].p2.world.y : 0; }
function addSegment(curve, y, zone) {
  const n = segments.length;
  segments.push({
    index: n, curve, zone, sprites: [], cars: [], dark: Math.floor(n / RUMBLE) % 2 === 1,
    p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
    p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
    clip: 0, fog: 1, looped: false, checker: false, boost: null, sec: 0,
  });
}
function addRoad(enter, hold, leave, curve, hill, zone) {
  const startY = lastY(), endY = startY + (hill || 0) * SEG, total = enter + hold + leave;
  for (let n = 0; n < enter; n++) addSegment(U.easeIn(0, curve, n / enter), U.easeInOut(startY, endY, n / total), zone);
  for (let n = 0; n < hold; n++) addSegment(curve, U.easeInOut(startY, endY, (enter + n) / total), zone);
  for (let n = 0; n < leave; n++) addSegment(U.easeInOut(curve, 0, n / leave), U.easeInOut(startY, endY, (enter + hold + n) / total), zone);
}
function bgFor(zone) { const k = `${track.id}:${zone}`; return BG[k] || (BG[k] = track.bg(zone)); }

function loadTrack(def) {
  track = def; segments = []; SECTIONS.length = 0;
  let zone = Object.keys(def.zones)[0];
  const ads = [], boosts = [];
  def.layout({
    sec: (name, z) => { zone = z; SECTIONS.push({ name, zone: z, start: segments.length }); },
    road: (e, h, l, c, hill) => addRoad(e, h, l, c, hill, zone),
    mark: () => segments.length,
    lastY: () => lastY() / SEG,
    ads: (s, extra = 0) => ads.push([s, segments.length + extra]),
    boost: (n, offset) => boosts.push([n, offset]),
  });
  N = segments.length; trackLength = N * SEG;
  SECTIONS.forEach((x, i) => { x.end = i + 1 < SECTIONS.length ? SECTIONS[i + 1].start : N; x.gpus = 0; for (let n = x.start; n < x.end; n++) segments[n].sec = i; });
  segments[0].checker = segments[1].checker = true;
  boosts.forEach(([b, o]) => { for (let k = 0; k < 7; k++) if (segments[b + k]) segments[b + k].boost = { offset: o }; });

  if (!def._art) def._art = def.art();
  SPR = Object.assign({}, SHARED, def._art);
  const rng = mulberry32(def.seed);
  const add = (n, key, offset, ww, o = {}) => { if (n >= 0 && n < N) segments[n].sprites.push(Object.assign({ key, offset, ww, wy: 0, frame: 0, collide: true }, o)); };
  const inAds = n => ads.some(z => n >= z[0] && n < z[1]);
  add(1, 'gantry', 0, 5400, { collide: false });
  for (let n = 4; n < N - 2; n++) {
    if (inAds(n) && n % 4 === 0) {                                // F1-style trackside advertising
      const v = [0, 1, 0, 2][(n / 4) % 4];
      add(n, 'barrier', -1.6, 1300, { frame: v }); add(n, 'barrier', 1.6, 1300, { frame: v === 2 ? 0 : 1 - v });
    }
    if (n % 150 === 75) add(n, 'billboard', (n % 300 < 150 ? -1 : 1) * 2.8, 1900, { frame: (n / 150 | 0) % 3 });
  }
  def.decorate({ N, add, inAds, rng, zoneAt: n => segments[n].zone, secAt: n => SECTIONS[segments[n].sec] });
  segments.forEach(s => s.sprites.forEach(sp => { if (sp.swim || sp.anim) sp.ph = s.index * 0.7; }));

  // floating GPUs: one fixed seed, so every track (same route) has exactly the same GPUs in the same spots
  gpusPerLap = 0;
  const grng = mulberry32(2026);
  const addGPU = (n, off) => { add(n, 'gpu', off, 330, { wy: 420, gpu: true, taken: -99, collide: false, ph: n * 0.37 }); gpusPerLap++; SECTIONS[segments[n].sec].gpus++; };
  let p = 0;
  for (let a = 70; a < N - 60; a += 200, p++) {
    const curve = segments[a + 10].curve;
    switch (p % 4) {
      case 0: { const o = Math.round((grng() * 1.2 - 0.6) * 10) / 10; for (let k = 0; k < 3; k++) addGPU(a + k * 6, o); break; }
      case 1: [-0.55, 0, 0.55].forEach((o, k) => addGPU(a + k * 9, o)); break;
      case 2: { const sd = grng() < 0.5 ? -1 : 1; addGPU(a, sd * 0.8); addGPU(a + 6, sd * 0.8); break; }
      case 3: { const o = curve > 0.5 ? 0.6 : curve < -0.5 ? -0.6 : 0; for (let k = 0; k < 3; k++) addGPU(a + k * 7, o); break; }
    }
  }
}
function findSegment(z) { return segments[Math.floor(z / SEG) % N]; }
function obstacleName(key) { return (track.obstacles || {})[key] || OBSTACLE_SHARED[key] || 'trackside obstacle'; }
function offroadText(zone) { return (track.offroadByZone && track.offroadByZone[zone]) || track.offroad || 'Way off the track!'; }

// ------------------------------------------------------------------ AUDIO (WebAudio chiptune)
const Snd = {
  ac: null, master: null, muted: false, eng: null, engGain: null, musicOn: false, nextNote: 0, step: 0, timer: null,
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ac.createGain(); this.master.gain.value = 0.45; this.master.connect(this.ac.destination);
      this.music = this.ac.createGain(); this.music.connect(this.master);
      this.fx = this.ac.createGain(); this.fx.connect(this.master);
      this.voiceBus = this.ac.createGain(); this.voiceBus.gain.value = 1.6; this.voiceBus.connect(this.master);
    } catch (e) { this.ac = null; }
  },
  tone(f, dur, type = 'square', vol = 0.15, when = 0, slide = 0, bus = null) {
    if (!this.ac) return;
    const t = this.ac.currentTime + when, o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(bus || this.fx); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.2) {
    if (!this.ac) return;
    const b = this.ac.createBuffer(1, this.ac.sampleRate * dur, this.ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = this.ac.createBufferSource(), g = this.ac.createGain(); g.gain.value = vol;
    s.buffer = b; s.connect(g); g.connect(this.fx); s.start();
  },
  coin() { this.tone(988, 0.08, 'square', 0.12); this.tone(1319, 0.25, 'square', 0.12, 0.07); },
  boost() { this.tone(200, 0.6, 'sawtooth', 0.12, 0, 900); },
  bump() { this.noise(0.18, 0.3); this.tone(90, 0.15, 'square', 0.15); },
  beep(hi) { this.tone(hi ? 880 : 440, hi ? 0.5 : 0.22, 'square', 0.16); },
  lap() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.15, 'square', 0.12, i * 0.09)); },
  fanfare() { [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'square', 0.13, i * 0.13)); },
  engineOn() {
    if (!this.ac || this.eng) return;
    this.eng = this.ac.createOscillator(); this.eng.type = 'sawtooth';
    const lp = this.ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    this.engGain = this.ac.createGain(); this.engGain.gain.value = 0.05;
    this.eng.connect(lp); lp.connect(this.engGain); this.engGain.connect(this.fx); this.eng.start();
  },
  engine(p) { if (this.eng) this.eng.frequency.setTargetAtTime(55 + p * 170, this.ac.currentTime, 0.05); },
  engineOff() { if (this.eng) { try { this.eng.stop(); } catch (e) {} this.eng = null; } },
  MEL: [69, 72, 76, 72, 74, 72, 69, 67, 65, 69, 72, 69, 71, 69, 65, 64, 67, 71, 74, 71, 76, 74, 71, 67, 64, 68, 71, 74, 76, 0, 74, 71],
  BASS: [45, 41, 43, 40],
  musicStart() {
    if (!this.ac || this.musicOn) return;
    this.musicOn = true; this.nextNote = this.ac.currentTime + 0.05; this.step = 0;
    this.timer = setInterval(() => {
      const spb = 60 / 150 / 2;
      while (this.nextNote < this.ac.currentTime + 0.12) {
        const i = this.step % 32, m = this.MEL[i], b = this.BASS[Math.floor(i / 8)] + (i % 2 ? 12 : 0);
        const f = n => 440 * Math.pow(2, (n - 69) / 12);
        const when = this.nextNote - this.ac.currentTime;
        if (m) this.tone(f(m), spb * 0.9, 'square', 0.05, when, 0, this.music);
        this.tone(f(b), spb * 0.8, 'triangle', 0.09, when, 0, this.music);
        if (i % 4 === 2) this.tone(3000, 0.03, 'square', 0.015, when, 0, this.music);
        this.nextNote += spb; this.step++;
      }
    }, 25);
  },
  musicStop() { this.musicOn = false; clearInterval(this.timer); },
  // AI voice: one clip at a time, music + engine duck underneath it
  voiceSrc: null, voiceQ: [], voiceEnd: 0,
  voicePlaying() { return !!this.voiceSrc || this.voiceQ.length > 0; },
  voiceRemaining() {
    if (!this.ac || !this.voiceSrc) return 0;
    return Math.max(0, this.voiceEnd - this.ac.currentTime) + this.voiceQ.reduce((a, v) => a + v.audio.duration, 0);
  },
  duck(on) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.music.gain.setTargetAtTime(on ? 0.22 : 1, t, 0.15);
    this.fx.gain.setTargetAtTime(on ? 0.45 : 1, t, 0.15);
  },
  async playVoice(buf, onStart) {
    if (!this.ac) return false;
    let audio;
    try { audio = await this.ac.decodeAudioData(buf); } catch (e) { return false; }
    this.voiceQ.push({ audio, onStart });
    if (!this.voiceSrc) this._nextVoice();
    return true;
  },
  _nextVoice() {
    const item = this.voiceQ.shift();
    if (!item) { this.voiceSrc = null; this.duck(false); return; }
    const src = this.ac.createBufferSource(); src.buffer = item.audio; src.connect(this.voiceBus);
    src.onended = () => { if (this.voiceSrc === src) this._nextVoice(); };
    this.voiceSrc = src; this.voiceEnd = this.ac.currentTime + item.audio.duration; this.duck(true); src.start();
    if (item.onStart) item.onStart();
  },
  stopVoice() {
    this.voiceQ.length = 0;
    const s = this.voiceSrc; this.voiceSrc = null;
    if (s) { try { s.stop(); } catch (e) {} }
    this.duck(false);
  },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.45; },
};

// ------------------------------------------------------------------ GAME STATE
const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
let state = 'title';                 // title | garage | countdown | race | finished | results | board | paused
let pausedFrom = null;
let position = 0, kartZ = 0, playerX = 0, speed = 0, lap = -1;
let skyOffset = 0, hillOffset = 0, treeOffset = 0;
let bgZone = null, bgPrev = null, bgFade = 1;
let raceTime = 0, countdown = 0, gpus = 0, turbo = 0, boostT = 0, bumpT = 0, shake = 0;
let lastSegIdx = 0, finishT = 0, finishPlace = 0, globalT = 0;
let cars = [];
let player = null;                   // the racer being driven (normalized racer object)
let lastEntryId = null;
let tele = null;                     // per-run telemetry for the AI Race Engineer debrief
function newTelemetry() {
  return {
    sec: SECTIONS.map(() => ({ t: 0, off: 0, gpus: 0, crashes: 0, bumps: 0 })),
    rocket: false, pads: 0, turboEarned: 0, turboUsed: 0, turboWasted: 0, top: 0,
    overtakes: 0, lost: 0, offT: 0, gpuTimes: [], half: false, final: false, place: NUM_CPU + 1, placeT: 0,
  };
}
const keys = {};
const popups = [];

function playerProgress() { return lap * trackLength + kartZ; }
function carProgress(c) { return c.lap * trackLength + c.z; }
function racePlace() { const pp = playerProgress(); return 1 + cars.filter(c => carProgress(c) > pp).length; }
const kartLabel = r => r.ai ? `${r.name} (AI rival)` : r.name;

function setupRace(me, attract) {
  segments.forEach(s => { s.cars.length = 0; s.sprites.forEach(sp => { if (sp.gpu) sp.taken = -99; }); });
  // rivals: other garage racers first, then the AI rivals named after GPU architectures
  const others = shuffle(racers.filter(r => !me || r.id !== me.id));
  const pool = others.concat(shuffle(R.RIVALS)).slice(0, NUM_CPU);
  const gap = SEG * 2.5;
  cars = shuffle(pool).map((r, k) => {
    const row = Math.floor(k / 2);
    const z = increase(0, -(row + 1) * gap, trackLength);
    const offset = k % 2 ? 0.45 : -0.45;
    const base = MAX_SPEED * (CPU_PACE[0] + CPU_PACE[1] * (1 - k / NUM_CPU) + Math.random() * 0.015);
    const car = { r, z, offset, target: offset, base, speed: 0, lap: -1, percent: U.pctRem(z, SEG), wander: Math.random() * 3 };
    findSegment(z).cars.push(car);
    return car;
  });
  const prow = Math.floor(NUM_CPU / 2);              // player starts last on the grid
  kartZ = increase(0, -(prow + 1) * gap, trackLength);
  position = increase(kartZ, -PLAYER_Z, trackLength);
  playerX = NUM_CPU % 2 ? 0.45 : -0.45;
  speed = 0; lap = -1; raceTime = 0; gpus = 0; turbo = 0; boostT = 0; bumpT = 0; shake = 0; finishT = 0;
  lastSegIdx = findSegment(kartZ).index;
  bgZone = findSegment(kartZ + PLAYER_Z).zone; bgPrev = null; bgFade = 1;
  popups.length = 0;
  tele = newTelemetry();
  if (attract) { cars.forEach(c => { c.speed = c.base * 0.8; }); speed = MAX_SPEED * 0.7; }
}

// ------------------------------------------------------------------ UPDATE
function steerCar(car, carSeg, playerSeg) {
  for (let i = 1; i < 20; i++) {
    const seg = segments[(carSeg.index + i) % N];
    if (player && seg === playerSeg && car.speed > speed && U.overlap(playerX, KART_N, car.offset, KART_N, 1.2)) {
      const dir = playerX > 0.5 ? -1 : playerX < -0.5 ? 1 : (car.offset > playerX ? 1 : -1);
      return dir / i * (car.speed - speed) / MAX_SPEED * 1.5;
    }
    for (const o of seg.cars) {
      if (o !== car && car.speed > o.speed && U.overlap(car.offset, KART_N, o.offset, KART_N, 1.2)) {
        const dir = o.offset > 0.5 ? -1 : o.offset < -0.5 ? 1 : (car.offset > o.offset ? 1 : -1);
        return dir / i * (car.speed - o.speed) / MAX_SPEED * 1.5;
      }
    }
  }
  return 0;
}

function updateCars(dt, playerSeg) {
  const pp = playerProgress();
  for (const car of cars) {
    const oldSeg = findSegment(car.z);
    let target = car.base;
    if (state === 'countdown') target = 0;
    else if (state === 'race') {
      const gap = carProgress(car) - pp;                        // gentle rubber-banding
      if (gap > 6000) target *= 0.95; else if (gap < -6000) target *= 1.06;
    }
    target *= 1 - Math.min(0.1, Math.abs(oldSeg.curve) * 0.012);
    car.speed += (target - car.speed) * Math.min(1, dt * (state === 'countdown' ? 10 : 0.8));
    const st = steerCar(car, oldSeg, playerSeg);
    if (st) car.offset += st;
    else {
      car.wander -= dt;
      if (car.wander < 0) { car.wander = 2 + Math.random() * 3; car.target = Math.random() * 1.4 - 0.7; }
      const d = car.target - car.offset; car.offset += Math.sign(d) * Math.min(Math.abs(d), dt * 0.35);
    }
    car.offset = U.limit(car.offset, -0.85, 0.85);
    const pz = car.z;
    car.z = increase(car.z, dt * car.speed, trackLength);
    if (car.z < pz) car.lap++;
    car.percent = U.pctRem(car.z, SEG);
    const newSeg = findSegment(car.z);
    if (oldSeg !== newSeg) { oldSeg.cars.splice(oldSeg.cars.indexOf(car), 1); newSeg.cars.push(car); }
  }
}

function collectGPUs(seg) {
  for (const s of seg.sprites) {
    if (!s.gpu || s.taken === lap) continue;
    if (Math.abs(playerX - s.offset) < 0.27) {
      s.taken = lap; gpus++; Snd.coin();
      popups.push({ text: '+1 GPU', t: 0.9, x: W / 2 + (Math.random() * 40 - 20), y: H - 120, col: '#9dff3a' });
      tele.sec[seg.sec].gpus++;
      tele.gpuTimes.push(globalT);
      const streak = tele.gpuTimes.filter(t => globalT - t < 3.5).length;
      const total = gpusPerLap * LAPS;
      if (gpus === total) AI.event('gpuAll', `Collected ALL ${total} GPUs on the track, a perfect haul!`, 8);
      else if (gpus % 15 === 0) AI.event('gpuMile', `Reaches ${gpus} GPUs collected.`, 5);
      else if (streak >= 3) AI.event('gpuStreak', `Grabs ${streak} GPUs in a row!`, 4);
      if (gpus % GPUS_PER_TURBO === 0) {
        if (turbo < MAX_TURBO) {
          turbo++; tele.turboEarned++; popups.push({ text: 'TURBO READY!', t: 1.2, x: W / 2, y: H - 150, col: '#ffb347' });
          AI.event('turboReady', 'Five GPUs collected, the turbo is charged and ready.', 2);
        } else tele.turboWasted++;
      }
    }
  }
}

function update(dt) {
  globalT += dt;
  if (state === 'paused' || state === 'results') return;
  const playerSeg = findSegment(position + PLAYER_Z);
  const control = state === 'race';
  const auto = state === 'title' || state === 'board' || state === 'garage' || state === 'finished';

  if (playerSeg.zone !== bgZone) { bgPrev = bgZone; bgZone = playerSeg.zone; bgFade = 0; }
  bgFade = Math.min(1, bgFade + dt * 1.3);

  if (state === 'countdown') {
    const prev = Math.ceil(countdown);
    countdown -= dt;
    const cur = Math.ceil(countdown);
    if (cur !== prev && cur > 0) { showMsg(String(cur)); Snd.beep(false); }
    if (countdown <= 0) {
      state = 'race'; showMsg('GO!', true); Snd.beep(true); Snd.engineOn();
      if (keys.up && keys.upHeld < 0.7) {
        boostT = 1.0; Snd.boost(); tele.rocket = true; popups.push({ text: 'ROCKET START!', t: 1.4, x: W / 2, y: H - 150, col: '#ffd23f' });
        AI.event('start', `Lights out at ${track.name}! Perfect rocket start from the back of the grid (${NUM_CPU + 1}th).`, 7);
      } else AI.event('start', `Lights out at ${track.name}, ${LAPS} lap${LAPS > 1 ? 's' : ''}! Starting from the back of the grid in ${NUM_CPU + 1}th.`, 6);
      setTimeout(() => { if (state === 'race') hideMsg(); }, 900);
    }
    if (keys.up) keys.upHeld = (keys.upHeld || 0) + dt; else keys.upHeld = 0;
  }

  const sp = speed / MAX_SPEED, dx = dt * 2 * Math.min(1, sp);
  const prevKartZ = kartZ;
  position = increase(position, dt * speed, trackLength);
  kartZ = increase(position, PLAYER_Z, trackLength);
  if (kartZ < prevKartZ) onCrossLine();

  if (control) {
    if (keys.left) playerX -= dx; else if (keys.right) playerX += dx;
  } else if (auto) {
    const ahead = segments[(playerSeg.index + 8) % N];
    playerX += U.limit((-ahead.curve * 0.05 - playerX) * dt * 2, -dx, dx);
  }
  playerX -= dx * Math.min(1, sp) * playerSeg.curve * CENTRIFUGAL;

  boostT = Math.max(0, boostT - dt); bumpT = Math.max(0, bumpT - dt); shake = Math.max(0, shake - dt);
  if (boostT > 0) speed += ACCEL * 2.5 * dt;
  else if (control && keys.up) speed += ACCEL * dt;
  else if (control && keys.down) speed += BRAKING * dt;
  else if (auto) speed += (MAX_SPEED * (state === 'finished' ? 0.5 : 0.7) - speed) * dt;
  else speed += DECEL * dt;
  if (boostT <= 0 && speed > MAX_SPEED) speed = Math.max(MAX_SPEED, speed - MAX_SPEED * 0.6 * dt);

  const offroad = playerX < -1 || playerX > 1;
  if (offroad) {
    if (speed > OFFROAD_LIMIT && boostT <= 0) speed += OFFROAD_DECEL * dt;
    for (const s of playerSeg.sprites) {
      if (s.collide && U.overlap(playerX, KART_N, s.offset, s.ww / ROAD_W)) {
        if (bumpT <= 0) {
          Snd.bump(); bumpT = 0.4; shake = 0.25;
          if (control) { tele.sec[playerSeg.sec].crashes++; AI.event('crash', `Crashes into a ${obstacleName(s.key)} in the ${SECTIONS[playerSeg.sec].name}!`, 5); }
        }
        speed = Math.min(speed, MAX_SPEED * 0.2);
        playerX += (playerX > 0 ? -1 : 1) * 0.12;
        break;
      }
    }
  }
  if (player) {
    for (const car of playerSeg.cars) {
      if (speed > car.speed && U.overlap(playerX, KART_N, car.offset, KART_N, 0.8)) {
        speed = car.speed * (car.speed / speed);
        playerX += (playerX > car.offset ? 1 : -1) * 0.06;
        if (bumpT <= 0) {
          Snd.bump(); bumpT = 0.4; shake = 0.2;
          if (control) { tele.sec[playerSeg.sec].bumps++; AI.event('bump', `Bumps into ${kartLabel(car.r)}!`, 3); }
        }
        break;
      }
    }
    if (playerSeg.boost && Math.abs(playerX - playerSeg.boost.offset) < 0.3 && boostT < 0.5) {
      boostT = 1.2; Snd.boost(); popups.push({ text: 'BOOST!', t: 0.8, x: W / 2, y: H - 150, col: '#eaff00' });
      if (control) { tele.pads++; AI.event('pad', 'Hits the green boost pad and rockets forward!', 2); }
    }
  }
  playerX = U.limit(playerX, -2.6, 2.6);
  speed = U.limit(speed, 0, BOOST_SPEED);

  if (control) {
    let i = lastSegIdx, guard = 0;
    while (i !== playerSeg.index && guard++ < 12) { i = (i + 1) % N; collectGPUs(segments[i]); }
  }
  lastSegIdx = playerSeg.index;

  const segsMoved = dt * speed / SEG;
  skyOffset = increase(skyOffset, 0.001 * playerSeg.curve * segsMoved, 1);
  hillOffset = increase(hillOffset, 0.002 * playerSeg.curve * segsMoved, 1);
  treeOffset = increase(treeOffset, 0.003 * playerSeg.curve * segsMoved, 1);

  updateCars(dt, playerSeg);

  if (state === 'race') { raceTime += dt; Snd.engine(speed / MAX_SPEED); trackRace(dt, playerSeg, offroad); }
  if (state === 'finished') { finishT += dt; Snd.engine(speed / MAX_SPEED); if (finishT > 3.2) showResults(); }
  for (const p of popups) { p.t -= dt; p.y -= 30 * dt; }
  while (popups.length && popups[0].t <= 0) popups.shift();
}

function neighbours() {
  const pp = playerProgress(); let ahead = null, behind = null;
  for (const c of cars) {
    const d = carProgress(c) - pp;
    if (d > 0 && (!ahead || d < ahead.d)) ahead = { c, d };
    if (d <= 0 && (!behind || d > behind.d)) behind = { c, d };
  }
  return { ahead, behind };
}
function raceProgress() { return lap < 0 ? 0 : U.limit((lap * trackLength + kartZ) / (LAPS * trackLength), 0, 1); }
function trackRace(dt, seg, offroad) {
  const T = tele.sec[seg.sec];
  T.t += dt; if (offroad) T.off += dt;
  tele.top = Math.max(tele.top, speed);
  if (offroad) { tele.offT += dt; if (tele.offT > 1.2 && tele.offT - dt <= 1.2) AI.event('offroad', offroadText(seg.zone), 3); }
  else tele.offT = 0;
  tele.placeT -= dt;
  if (tele.placeT <= 0) {
    tele.placeT = 0.3;
    const p = racePlace(), nb = neighbours();
    if (p < tele.place && lap >= 0) {
      tele.overtakes += tele.place - p;
      AI.event('overtake', `Overtakes ${nb.behind ? kartLabel(nb.behind.c.r) : 'a rival'} in the ${SECTIONS[seg.sec].name} and moves up to ${p}${ordinal(p)} place!`, p <= 3 ? 6 : 4);
    } else if (p > tele.place && lap >= 0) {
      tele.lost += p - tele.place;
      AI.event('lost', `Gets passed by ${nb.ahead ? kartLabel(nb.ahead.c.r) : 'a rival'} and drops to ${p}${ordinal(p)}.`, 3);
    }
    tele.place = p;
  }
  const prog = raceProgress();
  if (!tele.half && prog >= 0.5) { tele.half = true; AI.event('half', 'Halfway through the race.', 3); }
  if (!tele.final && prog >= 0.94) { tele.final = true; AI.event('final', 'Into the final stretch of the last lap, the finish line is in sight!', 5); }
}

function onCrossLine() {
  lap++;
  if (state !== 'race') return;
  if (lap >= LAPS) { finishRace(); return; }
  if (lap === 0) return;                      // crossing the line from the grid
  Snd.lap();
  const final = lap === LAPS - 1;
  showMsg(final ? 'FINAL LAP!' : `LAP ${lap + 1}`, true, true);
  AI.event('lap', final ? `Starts the FINAL LAP, lap ${LAPS} of ${LAPS}, in ${racePlace()}${ordinal(racePlace())} place!` : `Completes lap ${lap} and starts lap ${lap + 1} of ${LAPS} in ${racePlace()}${ordinal(racePlace())} place.`, final ? 6 : 4);
  setTimeout(() => { if (state === 'race') hideMsg(); }, 1500);
}

// ------------------------------------------------------------------ RENDER
function project(p, camX, camY, camZ) {
  p.camera.x = (p.world.x || 0) - camX; p.camera.y = (p.world.y || 0) - camY; p.camera.z = (p.world.z || 0) - camZ;
  p.screen.scale = CAM_DEPTH / p.camera.z;
  p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
  p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
  p.screen.w = Math.round(p.screen.scale * ROAD_W * W / 2);
}
function quad(x1, y1, x2, y2, x3, y3, x4, y4, c) {
  ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
function renderSegment(seg, fog) {
  const p1 = seg.p1.screen, p2 = seg.p2.screen, z = track.zones[seg.zone], i = seg.dark ? 1 : 0;
  const x1 = p1.x, y1 = p1.y, w1 = p1.w, x2 = p2.x, y2 = p2.y, w2 = p2.w;
  ctx.fillStyle = z.ground[i]; ctx.fillRect(0, y2, W, y1 - y2);
  const r1 = w1 / 6, r2 = w2 / 6;
  quad(x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, z.rumble[i]);
  quad(x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, z.rumble[i]);
  quad(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, z.road[i]);
  if (seg.checker) {
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n;
      quad(x1 - w1 + 2 * w1 * a, y1, x1 - w1 + 2 * w1 * b, y1, x2 - w2 + 2 * w2 * b, y2, x2 - w2 + 2 * w2 * a, y2, (k + seg.index) % 2 ? '#fff' : '#111');
    }
  } else if (z.lane && !seg.dark) {
    const l1 = w1 / 32, l2 = w2 / 32;
    let lx1 = x1 - w1 + 2 * w1 / LANES, lx2 = x2 - w2 + 2 * w2 / LANES;
    for (let l = 1; l < LANES; l++) {
      quad(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, z.lane);
      lx1 += 2 * w1 / LANES; lx2 += 2 * w2 / LANES;
    }
  }
  if (seg.boost) {
    const o = seg.boost.offset, hw = 0.24;
    const col = (seg.index + Math.floor(globalT * 14)) % 3 === 0 ? '#f5ff4a' : '#76b900';
    quad(x1 + w1 * (o - hw), y1, x1 + w1 * (o + hw), y1, x2 + w2 * (o + hw), y2, x2 + w2 * (o - hw), y2, col);
  }
  if (fog < 1) { ctx.globalAlpha = 1 - fog; ctx.fillStyle = z.fog; ctx.fillRect(0, y2, W, y1 - y2); ctx.globalAlpha = 1; }
}
function renderBg(img, rot, dy) {
  const iw = img.width, sx = Math.floor((((rot % 1) + 1) % 1) * iw);
  ctx.drawImage(img, -sx, dy); ctx.drawImage(img, iw - sx, dy);
}
function renderLayers(zone, alpha, vy) {
  const L = bgFor(zone);
  ctx.globalAlpha = alpha;
  renderBg(L.sky, skyOffset, -20 + vy * 0.3);
  renderBg(L.far, hillOffset, -20 + vy * 0.6);
  renderBg(L.near, treeOffset, -20 + vy);
  ctx.globalAlpha = 1;
}
function renderSprite(img, ww, scale, x, y, clipY) {
  const dw = ww * scale * W / 2, dh = dw * img.height / img.width;
  if (dw < 1 || dw > W * 6) return;
  const dx = x - dw / 2, dy = y - dh;
  const clipH = clipY ? Math.max(0, dy + dh - clipY) : 0;
  if (clipH < dh) ctx.drawImage(img, 0, 0, img.width, img.height - img.height * clipH / dh, dx, dy, dw, dh - clipH);
}

function render() {
  const baseSeg = findSegment(position), basePct = U.pctRem(position, SEG);
  const playerSeg = findSegment(position + PLAYER_Z), playerPct = U.pctRem(position + PLAYER_Z, SEG);
  const playerY = U.lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPct);
  let maxy = H, x = 0, dx = -(baseSeg.curve * basePct);

  ctx.save();
  if (shake > 0) ctx.translate((Math.random() * 2 - 1) * 4, (Math.random() * 2 - 1) * 3);
  const vy = U.limit(-playerY * 0.002, -30, 30);
  ctx.fillStyle = track.zones[bgZone].fog; ctx.fillRect(-10, -10, W + 20, H + 20);
  if (bgPrev && bgFade < 1) renderLayers(bgPrev, 1, vy);
  renderLayers(bgZone, bgPrev ? bgFade : 1, vy);

  for (let n = 0; n < DRAW_DIST; n++) {
    const seg = segments[(baseSeg.index + n) % N];
    seg.looped = seg.index < baseSeg.index;
    seg.fog = U.fog(n / DRAW_DIST, FOG_DENSITY);
    seg.clip = maxy;
    const camZ = position - (seg.looped ? trackLength : 0);
    project(seg.p1, playerX * ROAD_W - x, playerY + CAM_H, camZ);
    project(seg.p2, playerX * ROAD_W - x - dx, playerY + CAM_H, camZ);
    x += dx; dx += seg.curve;
    if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
    renderSegment(seg, seg.fog);
    maxy = seg.p1.screen.y;
  }

  const showPlayer = !!player && state !== 'title' && state !== 'board' && state !== 'garage';
  for (let n = DRAW_DIST - 1; n > 0; n--) {
    const seg = segments[(baseSeg.index + n) % N];
    for (const s of seg.sprites) {
      if (s.gpu && (!showPlayer || s.taken === lap)) continue;
      const sc = seg.p1.screen.scale;
      if (!(sc > 0)) continue;
      let off = s.offset, wy = s.wy;
      if (s.gpu) wy += Math.sin(globalT * 3 + s.ph) * 60;
      if (s.swim) { off += Math.sin(globalT * s.swim.sp + s.ph) * s.swim.amp; wy += Math.sin(globalT * s.swim.sp * 1.7 + s.ph) * 120; }
      const sx = seg.p1.screen.x + sc * off * ROAD_W * W / 2;
      const sy = seg.p1.screen.y - sc * wy * H / 2;
      const set = SPR[s.key];
      const img = s.anim ? set[Math.floor(globalT * (s.rate || 8) + (s.ph || 0)) % set.length] : s.gpu ? set[Math.floor(globalT * 20) % set.length] : set[s.frame || 0];
      renderSprite(img, s.ww, sc, sx, sy, seg.clip);
    }
    for (const car of seg.cars) {
      const sc = U.lerp(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
      if (!(sc > 0)) continue;
      const sx = U.lerp(seg.p1.screen.x, seg.p2.screen.x, car.percent) + sc * car.offset * ROAD_W * W / 2;
      const sy = U.lerp(seg.p1.screen.y, seg.p2.screen.y, car.percent);
      const fr = seg.curve > 1 ? 2 : seg.curve < -1 ? 0 : 1;
      renderSprite(R.kartRear(car.r, fr), KART_WW, sc, sx, sy, seg.clip);
    }
    if (seg === playerSeg && showPlayer) renderPlayer(playerSeg, playerPct);
  }
  if (track.overlay) track.overlay(ctx, globalT, W, H, bgZone);
  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.t * 2);
    ctx.font = '16px "Press Start 2P", monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText(p.text, p.x + 2, p.y + 2); ctx.fillStyle = p.col; ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function renderPlayer(seg, pct) {
  const sc = CAM_DEPTH / PLAYER_Z;
  const sp = speed / MAX_SPEED;
  const offroad = playerX < -1 || playerX > 1;
  let y = H / 2 - (sc * U.lerp(seg.p1.camera.y, seg.p2.camera.y, pct) * H / 2);
  y += (Math.random() * 2 - 1) * (offroad ? 3 : 0.8) * Math.min(1, sp);
  const fr = state === 'race' && speed > 0 ? (keys.left ? 0 : keys.right ? 2 : 1) : 1;
  const img = R.kartRear(player, fr);
  const dw = KART_WW * sc * W / 2, k = dw / 160;
  const x = W / 2;
  if (boostT > 0) {
    for (const ex of [64, 96]) {
      const fx = x - dw / 2 + ex * k, fy = y - (124 - 78) * k, len = (18 + Math.random() * 14) * k;
      ctx.fillStyle = '#ff7a00'; ctx.beginPath(); ctx.moveTo(fx - 6 * k, fy); ctx.lineTo(fx + 6 * k, fy); ctx.lineTo(fx, fy + len); ctx.fill();
      ctx.fillStyle = '#fff36b'; ctx.beginPath(); ctx.moveTo(fx - 3 * k, fy); ctx.lineTo(fx + 3 * k, fy); ctx.lineTo(fx, fy + len * 0.6); ctx.fill();
    }
  }
  if (offroad && speed > 500) {
    ctx.fillStyle = 'rgba(120,90,40,.7)';
    for (let i = 0; i < 6; i++) ctx.fillRect(x + (Math.random() * 2 - 1) * dw * 0.6, y - Math.random() * 20, 4, 4);
  }
  renderSprite(img, KART_WW, sc, x, y, 0);
}

// ------------------------------------------------------------------ HUD
const $ = id => document.getElementById(id);
const hud = {
  lap: $('hLap'), time: $('hTime'), pos: $('hPos'), suf: $('hPosSuf'), gpu: $('hGpu'),
  turbo: $('hTurbo'), speed: $('hSpeed'), bar: $('hSpeedBar'), cache: {},
};
function setTxt(el, key, v) { if (hud.cache[key] !== v) { hud.cache[key] = v; el.textContent = v; } }
function updateHud() {
  if (state !== 'race' && state !== 'countdown' && state !== 'finished') return;
  setTxt(hud.lap, 'lap', String(U.limit(lap + 1, 1, LAPS)));
  setTxt(hud.time, 'time', fmtTime(raceTime));
  const place = state === 'finished' ? finishPlace : racePlace();
  setTxt(hud.pos, 'pos', String(place)); setTxt(hud.suf, 'suf', ordinal(place));
  setTxt(hud.gpu, 'gpu', String(gpus));
  setTxt(hud.speed, 'spd', String(Math.round(speed / MAX_SPEED * KMH)));
  hud.bar.style.width = Math.min(100, speed / BOOST_SPEED * 100) + '%';
  const t = '<i class="on"></i>'.repeat(turbo) + '<i></i>'.repeat(MAX_TURBO - turbo);
  if (hud.cache.turbo !== t) { hud.cache.turbo = t; hud.turbo.innerHTML = t; }
}
function showMsg(t, go, small) {
  const m = $('msg'); m.textContent = t; m.className = (go ? 'go ' : '') + 'pop';
  m.style.fontSize = small ? '48px' : '96px';
  void m.offsetWidth;
}
function hideMsg() { $('msg').textContent = ''; $('submsg').textContent = ''; }

// ------------------------------------------------------------------ DATA: scores + racers (server, localStorage fallback)
let scores = [], racers = [];
const readLocal = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch (e) { return JSON.parse(d); } };
const writeLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
async function loadScores() {
  try { const r = await fetch('api/scores', { cache: 'no-store' }); if (!r.ok) throw 0; scores = await r.json(); }
  catch (e) { scores = readLocal(STORE_KEY, '[]'); }
}
async function saveScore(entry) {
  scores.push(entry); writeLocal(STORE_KEY, scores);
  try {
    const r = await fetch('api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
    if (r.ok) { scores = await r.json(); writeLocal(STORE_KEY, scores); }
  } catch (e) {}
}
async function resetScores() { scores = []; writeLocal(STORE_KEY, scores); try { await fetch('api/scores', { method: 'DELETE' }); } catch (e) {} }
async function loadSettings() {
  try { const r = await fetch('api/settings', { cache: 'no-store' }); if (!r.ok) throw 0; applySettings(await r.json()); }
  catch (e) { applySettings(readLocal('race.settings', '{"laps":3}')); }
}
function applySettings(st) {
  LAPS = [1, 2, 3].includes(st && st.laps) ? st.laps : 3;
  writeLocal('race.settings', { laps: LAPS });
  document.querySelectorAll('#lapSel button').forEach(b => b.classList.toggle('on', +b.dataset.l === LAPS));
  $('rulesLaps').textContent = `${LAPS} lap${LAPS > 1 ? 's' : ''}`;
  $('boardLaps').textContent = `${LAPS} LAP${LAPS > 1 ? 'S' : ''}`;
}
async function setLaps(n) {
  applySettings({ laps: n });
  try { const r = await fetch('api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ laps: n }) }); if (r.ok) applySettings(await r.json()); } catch (e) {}
  Snd.tone(700, 0.06, 'square', 0.08);
}
document.querySelectorAll('#lapSel button').forEach(b => { b.onclick = () => setLaps(+b.dataset.l); });
async function loadRacers() {
  try { const r = await fetch('api/racers', { cache: 'no-store' }); if (!r.ok) throw 0; racers = (await r.json()).map(R.normalizeRacer); writeLocal(RACER_KEY, racers); }
  catch (e) { racers = readLocal(RACER_KEY, '[]').map(R.normalizeRacer); }
}
async function saveRacerData(rc) {
  try {
    const r = await fetch('api/racers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rc) });
    const d = await r.json();
    if (!r.ok) return { error: d.error || 'could not save' };
    racers = d.racers.map(R.normalizeRacer); writeLocal(RACER_KEY, racers);
    return { racer: R.normalizeRacer(d.racer) };
  } catch (e) {                                                   // offline: keep it in this browser
    if (racers.some(x => x.id !== rc.id && x.name === rc.name)) return { error: 'That name is already taken' };
    const saved = R.normalizeRacer(Object.assign({}, rc, { id: rc.id || 'r' + Date.now().toString(36) }));
    racers = racers.filter(x => x.id !== saved.id).concat(saved); writeLocal(RACER_KEY, racers);
    return { racer: saved };
  }
}
async function deleteRacerData(id) {
  racers = racers.filter(x => x.id !== id); writeLocal(RACER_KEY, racers);
  try { const r = await fetch('api/racers?id=' + encodeURIComponent(id), { method: 'DELETE' }); if (r.ok) racers = (await r.json()).map(R.normalizeRacer); } catch (e) {}
}

// One leaderboard for all tracks (they share the same route) per lap setting, each racer listed once with their best run.
const cmpRuns = (a, b) => a.score - b.score || b.gpus - a.gpus || a.time - b.time;
const sameName = (a, b) => String(a.name).trim().toLowerCase() === String(b.name).trim().toLowerCase();
const lapsOf = e => e.laps || 3;                                 // runs saved before the lap setting existed were 3 laps
const onRoute = e => e.route === R.ROUTE_ID && lapsOf(e) === LAPS; // other layouts / lap counts are not comparable
const trackName = id => { const t = R.TRACKS.find(x => x.id === id); return t ? t.name : ''; };
function boardFor() {
  const best = new Map();
  for (const e of scores) {
    if (!onRoute(e)) continue;
    const k = String(e.name).trim().toLowerCase(), b = best.get(k);
    if (!b || cmpRuns(e, b) < 0) best.set(k, e);
  }
  return [...best.values()].sort(cmpRuns);
}
// Where a run lands on the deduplicated board (keeps the racer's earlier best if that was faster).
function rankFor(run) {
  const list = boardFor(), mine = list.find(e => sameName(e, run)), others = list.filter(e => !sameName(e, run));
  const pb = !mine || cmpRuns(run, mine) < 0, best = pb ? run : mine;
  return { rank: 1 + others.filter(e => cmpRuns(e, best) < 0).length, of: others.length + 1, pb, prevBest: mine, leader: others[0] || null, best };
}

// ------------------------------------------------------------------ SCREENS
const screens = ['scrTitle', 'scrGarage', 'scrResults', 'scrBoard', 'scrPause'];
function showScreen(id) { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); }

let selTrack = readLocal('race.track', '"ai-factory"');
let selRacerId = null;
const grid = $('grid');

function trackThumb(def) {
  if (def._thumb) return def._thumb;
  const cv = mk(200, 100), g = cv.getContext('2d'), zone = Object.keys(def.zones)[0], L = (BG[`${def.id}:${zone}`] = BG[`${def.id}:${zone}`] || def.bg(zone)), z = def.zones[zone];
  [L.sky, L.far, L.near].forEach(img => g.drawImage(img, 300, 80, 640, 320, 0, 0, 200, 100));
  g.fillStyle = z.ground[0]; g.fillRect(0, 62, 200, 38);
  g.fillStyle = z.rumble[0]; g.beginPath(); g.moveTo(88, 62); g.lineTo(112, 62); g.lineTo(190, 100); g.lineTo(10, 100); g.fill();
  g.fillStyle = z.road[0]; g.beginPath(); g.moveTo(91, 62); g.lineTo(109, 62); g.lineTo(176, 100); g.lineTo(24, 100); g.fill();
  def._thumb = cv; return cv;
}
function buildTrackSel() {
  const box = $('trackSel'); box.innerHTML = '';
  R.TRACKS.forEach((t, i) => {
    const b = document.createElement('button'); b.className = 'trk'; b.dataset.id = t.id;
    const cv = mk(200, 100); cv.getContext('2d').drawImage(trackThumb(t), 0, 0); b.appendChild(cv);
    b.insertAdjacentHTML('beforeend', `<b>${i + 1}. ${esc(t.name)}</b><small>${esc(t.sub)}</small>`);
    b.onclick = () => { Snd.init(); selectTrack(t.id); };
    box.appendChild(b);
  });
  selectTrack(selTrack, true);
}
function selectTrack(id, silent) {
  selTrack = R.trackById(id).id; writeLocal('race.track', selTrack);
  document.querySelectorAll('#trackSel .trk').forEach(b => b.classList.toggle('sel', b.dataset.id === selTrack));
  if (!track || track.id !== selTrack) { loadTrack(R.trackById(selTrack)); if (state === 'title' || state === 'garage') setupRace(null, true); }
  if (!silent) Snd.tone(520, 0.06, 'square', 0.08);
}

function buildGrid() {
  grid.innerHTML = '';
  racers.forEach(r => {
    const d = document.createElement('div'); d.className = 'card'; d.dataset.id = r.id;
    const cv = mk(220, 130); cv.getContext('2d').drawImage(R.kartSide(r), 0, 0); d.appendChild(cv);
    const s = document.createElement('span'); s.textContent = r.name; d.appendChild(s);
    d.onclick = () => { Snd.init(); selectRacer(r.id); };
    d.ondblclick = () => { selectRacer(r.id); startRace(); };
    grid.appendChild(d);
  });
  const plus = document.createElement('div'); plus.className = 'card plus'; plus.dataset.id = '+';
  plus.innerHTML = `<div class="plus-sign">＋</div><span>ADD RACER</span>`;
  plus.onclick = () => { Snd.init(); openGarage({ isNew: true, returnTo: 'title' }); };
  grid.appendChild(plus);
  if (selRacerId && !racers.some(r => r.id === selRacerId)) selRacerId = null;
  selectRacer(selRacerId, true);
}
function selectRacer(id, silent) {
  selRacerId = id;
  [...grid.children].forEach(d => d.classList.toggle('sel', d.dataset.id === (id || '')));
  const pv = $('previewKart'), g = pv.getContext('2d'), r = racers.find(x => x.id === id);
  g.clearRect(0, 0, pv.width, pv.height);
  if (r) { g.drawImage(R.kartSide(r), 0, 0); $('previewName').textContent = r.name; if (!silent) Snd.tone(660, 0.06, 'square', 0.08); }
  else $('previewName').textContent = racers.length ? '— pick your racer →' : '— add a racer with ＋ →';
}
function moveSelection(delta) {
  const ids = racers.map(r => r.id).concat('+');
  let i = [...grid.children].findIndex(d => d.classList.contains('sel'));
  i = U.limit(i < 0 ? 0 : i + delta, 0, ids.length - 1);
  if (ids[i] === '+') { selRacerId = null; [...grid.children].forEach(d => d.classList.toggle('sel', d.dataset.id === '+')); $('previewName').textContent = 'press ENTER to add a racer'; }
  else selectRacer(ids[i]);
}

function goTitle() {
  state = 'title'; Snd.engineOff(); AI.reset();
  loadSettings();                                  // pick up a lap change made on another screen
  if (debriefAbort) { debriefAbort.abort(); debriefAbort = null; }
  $('hud').classList.add('hidden'); hideMsg();
  showScreen('scrTitle');
  player = null;
  if (!track || track.id !== selTrack) loadTrack(R.trackById(selTrack));
  setupRace(null, true);
  buildGrid();
  setTimeout(() => grid.focus(), 50);
}
function startRace(racer) {
  const r = racer || racers.find(x => x.id === selRacerId);
  if (!r) {
    if (!racers.length) { openGarage({ isNew: true, returnTo: 'title' }); return; }
    grid.classList.remove('shake'); void grid.offsetWidth; grid.classList.add('shake'); grid.focus(); return;
  }
  Snd.init(); Snd.musicStart();
  player = R.normalizeRacer(r);
  if (!track || track.id !== selTrack) loadTrack(R.trackById(selTrack));
  setupRace(player, false);
  showScreen(null);
  $('hud').classList.remove('hidden');
  $('hLaps').textContent = LAPS; $('hGpuTot').textContent = gpusPerLap * LAPS; $('hPosOf').textContent = NUM_CPU + 1;
  $('hRacer').textContent = `${player.name} · ${track.name}`;
  hud.cache = {};
  state = 'countdown'; countdown = 3.999; keys.upHeld = 0;
  AI.reset();
  AI.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  loadScores();                                   // fresh leaderboard for the finish-line ranking
  showMsg('3'); Snd.beep(false);
  $('submsg').textContent = 'Hold ↑ just before GO for a rocket start!';
}
function makeEntry() {
  const total = gpusPerLap * LAPS;
  const bonus = gpus * GPU_BONUS + (gpus === total ? PERFECT_BONUS : 0);
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: player.name, racerId: player.id, car: player.car, suit: player.suit, wheels: player.wheels,
    track: track.id, route: R.ROUTE_ID, laps: LAPS, time: +raceTime.toFixed(3), gpus, totalGpus: total,
    score: +Math.max(0, raceTime - bonus).toFixed(3), bonus, place: finishPlace, date: new Date().toISOString(),
  };
}
function finishRace() {
  finishPlace = racePlace();
  state = 'finished'; finishT = 0;
  Snd.fanfare();
  // the finish call pre-empts whatever the commentator was doing
  AI.gen++; AI.inflight = false; AI.speaking = false; AI.lastLineT = -99; Snd.stopVoice();
  AI.pending = [];
  lastResult = makeEntry();
  const rk = rankFor(lastResult);
  let line = `CROSSES THE FINISH LINE after ${LAPS} lap${LAPS > 1 ? 's' : ''}! Race time ${fmtTime(raceTime)}, ${gpus} of ${gpusPerLap * LAPS} GPUs, score ${fmtTime(lastResult.score)}. `;
  if (rk.prevBest && !rk.pb) line += `That does not beat the personal best of ${fmtTime(rk.prevBest.score)}, so ${player.name} stays ${rk.rank}${ordinal(rk.rank)} on the leaderboard out of ${rk.of} drivers.`;
  else line += `${rk.prevBest ? 'A new personal best! ' : ''}That is ${rk.rank}${ordinal(rk.rank)} place on the leaderboard out of ${rk.of} drivers` +
    (rk.rank === 1 ? (rk.leader ? `, beating the previous best of ${fmtTime(rk.leader.score)} by ${rk.leader.name}!` : ', the very first name on the board!') : `; the leader is ${rk.leader.name} with ${fmtTime(rk.leader.score)}.`);
  AI.event('finish', line + ' Announce the LEADERBOARD position; the position among the karts on track does not count.', 10);
  runDebrief(lastResult, rk);
  showMsg('FINISH!', true);
  $('submsg').textContent = `Leaderboard: ${rk.rank}${ordinal(rk.rank)} of ${rk.of}${rk.prevBest && !rk.pb ? ' (personal best kept)' : rk.prevBest ? ' · NEW PERSONAL BEST' : ''} · ${gpus} GPUs`;
}
let lastResult = null;
async function showResults() {
  if (state === 'results') return;
  state = 'results'; Snd.engineOff();
  $('hud').classList.add('hidden'); hideMsg();
  const entry = lastResult || makeEntry(), total = entry.totalGpus, bonus = entry.bonus, score = entry.score;
  delete entry.bonus;
  lastEntryId = entry.id;
  if (AI.pendingVerdict) { AI.speak(AI.pendingVerdict, 'debrief'); AI.pendingVerdict = null; }
  ['uLlm', 'uTts', 'uAudio', 'uTot', 'uSpot'].forEach(id => { $(id).textContent = '–'; });
  pollUsage(AI.runId);
  const g = $('resKart').getContext('2d'); g.clearRect(0, 0, 220, 130); g.drawImage(R.kartSide(player), 0, 0);
  $('resName').textContent = player.name; $('resCo').textContent = `${track.name} · ${LAPS} lap${LAPS > 1 ? 's' : ''}`;
  $('resTime').textContent = fmtTime(raceTime);
  $('resGpu').textContent = `${gpus} / ${total}` + (gpus === total ? '  ★ ALL!' : '');
  $('resBonus').textContent = `− ${bonus.toFixed(1)} s`;
  $('resScore').textContent = fmtTime(score);
  $('resRank').textContent = 'saving…';
  showScreen('scrResults');
  const rk = rankFor(entry);
  await saveScore(entry);
  $('resRank').textContent = `LEADERBOARD: ${rk.rank}${ordinal(rk.rank).toUpperCase()} OF ${rk.of}` + (rk.prevBest && !rk.pb ? ` · BEST ${fmtTime(rk.prevBest.score)} KEPT` : rk.prevBest ? ' · NEW PB!' : '');
  setTimeout(() => $('btnResNext').focus(), 50);
}

// ---- leaderboard (end dashboard): one board for all tracks
function showBoard() {
  state = 'board'; Snd.engineOff();
  $('hud').classList.add('hidden'); hideMsg();
  if (!cars.length || !player) setupRace(null, true);
  player = null;
  const list = boardFor();
  const runsOf = e => scores.filter(x => onRoute(x) && sameName(x, e)).length;
  const pod = $('podium'); pod.innerHTML = '';
  [1, 0, 2].forEach(i => {
    const e = list[i], d = document.createElement('div');
    d.className = `pod p${i + 1}` + (e ? '' : ' empty') + (e && e.id === lastEntryId ? ' me' : '');
    const cv = mk(220, 130);
    if (e) cv.getContext('2d').drawImage(R.kartSide(R.normalizeRacer(e)), 0, 0);
    d.appendChild(cv);
    d.insertAdjacentHTML('beforeend', `<div class="p-name">${e ? esc(e.name) : '—'}</div><div class="p-co">${e ? esc(trackName(e.track)) + ' · ' + (e.gpus | 0) + ' GPUs' : '&nbsp;'}</div>
      <div class="block"><div class="num">${i + 1}</div><div class="sc">${e ? fmtTime(e.score) : ''}</div></div>`);
    pod.appendChild(d);
  });
  const bl = $('boardList');
  if (list.length <= 3) bl.innerHTML = `<div class="empty">${list.length ? 'Places 4+ will appear here.' : 'No races yet. Be the first on the podium!'}</div>`;
  else {
    let h = '<table><tr><th class="num">#</th><th>RACER</th><th>BEST ON</th><th class="num">TIME</th><th class="num">GPUS</th><th class="num">SCORE</th><th class="num">RUNS</th></tr>';
    list.slice(3).forEach((e, k) => {
      h += `<tr class="${e.id === lastEntryId ? 'me' : ''}"><td class="num">${k + 4}</td><td>${esc(e.name)}</td><td>${esc(trackName(e.track))}</td><td class="num">${fmtTime(e.time)}</td><td class="num">${e.gpus | 0}/${e.totalGpus | 0}</td><td class="num">${fmtTime(e.score)}</td><td class="num">${runsOf(e)}</td></tr>`;
    });
    bl.innerHTML = h + '</table>';
    const me = bl.querySelector('tr.me'); if (me) me.scrollIntoView({ block: 'center' });
  }
  showScreen('scrBoard');
  setTimeout(() => $('btnNew').focus(), 50);
}
function pause(on) {
  if (on && (state === 'race' || state === 'countdown')) { pausedFrom = state; state = 'paused'; showScreen('scrPause'); Snd.engineOff(); Snd.musicStop(); AI.reset(false); }
  else if (!on && state === 'paused') { state = pausedFrom; showScreen(null); if (state === 'race') Snd.engineOn(); Snd.musicStart(); }
}
function quitRun() { Snd.musicStop(); goTitle(); }
function exportCsv() {
  const rows = [['rank', 'racer', 'best_on_track', 'race_time_s', 'gpus', 'total_gpus', 'score_s', 'runs', 'date_of_best']];
  boardFor().forEach((e, i) => rows.push([i + 1, e.name, trackName(e.track), e.time, e.gpus, e.totalGpus, e.score, scores.filter(x => onRoute(x) && sameName(x, e)).length, e.date]));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `gb10-grand-prix-leaderboard-${LAPS}-laps.csv`; a.click();
}

// ---- settings: racer garage (add / edit / delete racers)
let gEdit = null, gReturn = 'title';
function openGarage(opts = {}) {
  state = 'garage'; gReturn = opts.returnTo || 'title';
  showScreen('scrGarage');
  renderGarageList();
  editRacer(opts.isNew ? null : (racers.find(r => r.id === selRacerId) || racers[0] || null));
}
function renderGarageList() {
  const box = $('gList'); box.innerHTML = '';
  $('gCount').textContent = `(${racers.length})`;
  if (!racers.length) box.innerHTML = '<div class="g-empty">No racers yet. Build the first one on the right.</div>';
  racers.forEach(r => {
    const d = document.createElement('div'); d.className = 'g-item' + (gEdit && gEdit.id === r.id ? ' sel' : '');
    const cv = mk(220, 130); cv.getContext('2d').drawImage(R.kartSide(r), 0, 0); d.appendChild(cv);
    d.insertAdjacentHTML('beforeend', `<span>${esc(r.name)}</span>`);
    d.onclick = () => editRacer(r);
    box.appendChild(d);
  });
}
function editRacer(r) {
  const pal = R.PALETTE;
  gEdit = r ? Object.assign({}, r) : { id: '', name: '', car: pal[Math.floor(Math.random() * 9)], suit: pal[9 + Math.floor(Math.random() * 3)], wheels: 'classic' };
  $('gTitle').textContent = gEdit.id ? 'EDIT RACER' : 'NEW RACER';
  $('gName').value = gEdit.name; $('gMsg').textContent = '';
  $('gDelete').disabled = !gEdit.id;
  renderSwatches(); renderGaragePreview(); renderGarageList();
  setTimeout(() => $('gName').focus(), 30);
}
function renderSwatches() {
  [['gCar', 'car'], ['gSuit', 'suit']].forEach(([id, field]) => {
    const box = $(id); box.innerHTML = '';
    R.PALETTE.forEach(c => {
      const b = document.createElement('button'); b.className = 'sw' + (gEdit[field] === c ? ' on' : ''); b.style.background = c; b.title = c;
      b.onclick = () => { gEdit[field] = c; renderSwatches(); renderGaragePreview(); };
      box.appendChild(b);
    });
    const custom = document.createElement('input'); custom.type = 'color'; custom.value = gEdit[field]; custom.title = 'custom colour';
    custom.className = 'sw custom' + (R.PALETTE.includes(gEdit[field]) ? '' : ' on');
    custom.oninput = () => { gEdit[field] = custom.value; renderGaragePreview(); };
    custom.onchange = () => renderSwatches();
    box.appendChild(custom);
  });
  const wb = $('gWheels'); wb.innerHTML = '';
  R.WHEELS.forEach(w => {
    const b = document.createElement('button'); b.className = 'wh' + (gEdit.wheels === w.id ? ' on' : '');
    b.appendChild(R.wheelSwatch(w.id, gEdit.car)); b.insertAdjacentHTML('beforeend', `<span>${w.name}</span>`);
    b.onclick = () => { gEdit.wheels = w.id; renderSwatches(); renderGaragePreview(); };
    wb.appendChild(b);
  });
}
function renderGaragePreview() {
  const r = R.normalizeRacer(Object.assign({}, gEdit, { name: gEdit.name || 'YOUR NAME' }));
  const s = $('gSide').getContext('2d'); s.clearRect(0, 0, 220, 130); s.drawImage(R.kartSide(r), 0, 0);
  const b = $('gRear').getContext('2d'); b.clearRect(0, 0, 160, 124); b.drawImage(R.kartRear(r, 1), 0, 0);
}
async function saveGarage() {
  const name = $('gName').value.trim().toUpperCase();
  if (!name) { $('gMsg').textContent = 'Give your racer a name first.'; $('gName').focus(); return; }
  gEdit.name = name;
  const res = await saveRacerData({ id: gEdit.id, name, car: gEdit.car, suit: gEdit.suit, wheels: gEdit.wheels });
  if (res.error) { $('gMsg').textContent = res.error; return; }
  Snd.tone(880, 0.08, 'square', 0.1);
  selRacerId = res.racer.id;
  if (gReturn === 'title') { goTitle(); return; }
  editRacer(res.racer);
  $('gMsg').textContent = 'Saved!';
}
async function deleteGarage() {
  if (!gEdit || !gEdit.id) return;
  if (!confirm(`Delete racer ${gEdit.name}? Their leaderboard results stay.`)) return;
  await deleteRacerData(gEdit.id);
  if (selRacerId === gEdit.id) selRacerId = null;
  editRacer(racers[0] || null);
}
$('gName').addEventListener('input', () => {
  if (!gEdit) return;
  const v = $('gName').value.toUpperCase().replace(/[^A-Z0-9 .&'_-]/g, '').slice(0, 12);
  if (v !== $('gName').value) $('gName').value = v;
  gEdit.name = v; renderGaragePreview();
});

// ------------------------------------------------------------------ AI ON THE DGX SPARK
// Three AI tasks share the Spark's GPU concurrently:
//   1) live commentator  (LLM line -> GPU text-to-speech), 2) AI Race Engineer debrief (streamed LLM),
//   3) live telemetry panel. All calls are async; the game loop never waits on them.
function postT(url, body, ms, signal) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  if (signal) signal.addEventListener('abort', () => ac.abort());
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal })
    .finally(() => clearTimeout(t));
}
const AI = {
  lang: readLocal('race.lang', '"en"'),
  voice: readLocal('race.voice', 'true'),
  stats: null, tpsHist: [], pending: [], recent: [], lastType: {},
  inflight: false, speaking: false, lastLineT: -99, gen: 0, lines: 0,
  runId: null, story: [], productDone: false, debriefDone: false, pendingVerdict: null,
  llmOk() { return !!(this.stats && this.stats.llm.online && this.stats.llm.model); },
  ttsOk() { return this.voice && !!(this.stats && this.stats.tts.ready); },
  setLang(l) { this.lang = l; writeLocal('race.lang', l); renderAiOpts(); },
  toggleVoice() {
    this.voice = !this.voice; writeLocal('race.voice', this.voice);
    if (!this.voice) Snd.stopVoice();
    renderAiOpts(); popups.push({ text: this.voice ? 'VOICE ON' : 'VOICE OFF', t: 1, x: W / 2, y: 90, col: '#fff' });
  },
  // full=false only silences the commentator (pause) and keeps this race's story
  reset(full = true) {
    if (full) { this.story = []; this.productDone = false; }
    this.pendingVerdict = null; this.gen++; this.pending = []; this.recent = []; this.lastType = {}; this.inflight = false; this.speaking = false; this.lastLineT = globalT; this.lines = 0; Snd.stopVoice(); hideTicker();
  },
  event(type, text, prio) {
    if (state !== 'race' && type !== 'finish') return;
    if (this.lastType[type] && globalT - this.lastType[type] < 3 && prio < 8) return;   // de-spam
    this.lastType[type] = globalT;
    if (!['status', 'turboReady'].includes(type)) { this.story.push(`${fmtTime(raceTime)} ${text}`); if (this.story.length > 16) this.story.shift(); }
    this.pending.push({ type, text, prio, t: globalT });
  },
  tick() {
    if ((state !== 'race' && state !== 'finished') || !this.llmOk()) return;
    if (state === 'race' && !this.pending.length && globalT - this.lastLineT > 8)
      this.event('status', 'Quiet moment: sum up how this race has gone so far (use the race story) and what is at stake now.', 1);
    // one product spotlight per race, in a calm moment (queued at 30%, top priority from 55%)
    if (state === 'race' && !this.productDone) {
      const pr = raceProgress();
      if (pr >= 0.3 && (pr >= 0.8 || !this.pending.some(e => e.prio >= 4))) {
        this.productDone = true;
        this.pending.push({ type: 'product', text: 'product spotlight', prio: pr >= 0.8 ? 7 : 4, t: globalT });
      }
    }
    // pipeline: write + voice the next line while the current clip is still playing
    if (this.inflight || this.speaking || Snd.voiceRemaining() > 1.6 || globalT - this.lastLineT < 0.8) return;
    const spot = this.pending.find(e => e.type === 'product');
    if (spot && raceProgress() >= 0.55) spot.prio = 9;
    this.pending = this.pending.filter(e => e.prio >= 8 || e.type === 'product' || globalT - e.t < 4);
    if (!this.pending.length) return;
    this.pending.sort((a, b) => b.prio - a.prio || b.t - a.t);
    const ev = this.pending.shift();
    const also = this.pending.slice(0, 2).map(e => e.text);
    this.pending = this.pending.filter(e => e.prio >= 8 || e.type === 'product');
    this.comment(ev, ev.type === 'product' ? [] : also);
  },
  async comment(ev, also) {
    const gen = this.gen;
    this.inflight = true; this.lastLineT = globalT;
    const facts = raceFacts() + `\nEVENT: ${ev.text}` + (also.length ? `\nAlso just happened: ${also.join(' ')}` : '');
    let d = null;
    const kind = ev.type === 'product' ? 'product' : 'event';
    try { const r = await postT('api/commentary', { lang: this.lang, facts, recent: this.recent, run: this.runId, kind }, 6000); if (r.ok) d = await r.json(); } catch (e) {}
    if (gen !== this.gen) return;
    this.inflight = false; this.lastLineT = globalT;
    if (!d || !d.text) return;
    this.lines++;
    this.recent.push(d.text); if (this.recent.length > 5) this.recent.shift();
    const meta = `LLM ${(d.ms / 1000).toFixed(1)}s`;
    const label = d.product ? `📣 TECH SPOTLIGHT · ${d.product}` : '🎙 AI COMMENTATOR';
    if (!this.ttsOk()) { showTicker(d.text, meta, label); return; }
    // text appears the moment its voice starts, so screen and speaker stay in sync
    const ok = await this.speak(d.text, 'commentary', vs => showTicker(d.text, `${meta} · voice ${vs}s`, label));
    if (!ok && gen === this.gen) showTicker(d.text, meta, label);
  },
  async speak(text, kind, onStart) {
    const gen = this.gen;
    this.speaking = true;
    let ok = false;
    try {
      const t0 = performance.now();
      const r = await postT('api/tts', { text, lang: this.lang, kind, run: this.runId }, kind === 'debrief' ? 30000 : 8000);
      if (r.ok && gen === this.gen) {
        const buf = await r.arrayBuffer(), vs = ((performance.now() - t0) / 1000).toFixed(1);
        if (gen === this.gen) ok = await Snd.playVoice(buf, () => { if (gen === this.gen) { this.lastLineT = globalT; if (onStart) onStart(vs); } });
      }
    } catch (e) {}
    if (gen === this.gen) { this.speaking = false; this.lastLineT = globalT; }
    return ok;
  },
};
function raceFacts() {
  const nb = neighbours(), place = state === 'finished' ? finishPlace : racePlace();
  const gap = o => (Math.abs(o.d) / MAX_SPEED).toFixed(1);
  return `Driver: ${player.name}. Track: ${track.name} (${track.sub}). Lap ${U.limit(lap + 1, 1, LAPS)} of ${LAPS}. Position ${place} of ${NUM_CPU + 1} on track. ` +
    `GPUs collected: ${gpus} of ${gpusPerLap * LAPS}. Race progress ${Math.round(raceProgress() * 100)}%. ` +
    `Race time ${fmtTime(raceTime)}. Speed ${Math.round(speed / MAX_SPEED * KMH)} km/h. ` +
    `Track section: ${SECTIONS[findSegment(position + PLAYER_Z).sec].name}. Turbo ${turbo ? 'charged' : 'empty'}. ` +
    (place === 1 ? 'Leading the race! ' : nb.ahead ? `Kart ahead: ${kartLabel(nb.ahead.c.r)}, ${gap(nb.ahead)}s up the road. ` : '') +
    (nb.behind ? `Kart behind: ${kartLabel(nb.behind.c.r)}.` : '') +
    `\nRace story so far: ${AI.story.length ? AI.story.slice(-10).join(' | ') : 'the race has just started'}`;
}

// ---- commentary ticker
let tickerTimer = null;
function showTicker(text, meta, label = '🎙 AI COMMENTATOR') {
  const el = $('ticker');
  el.querySelector('.tk-label').textContent = label;
  el.classList.toggle('spot', label !== '🎙 AI COMMENTATOR');
  $('tkText').textContent = text; $('tkMeta').textContent = meta;
  el.classList.remove('hidden', 'pop'); void el.offsetWidth; el.classList.add('pop');
  clearTimeout(tickerTimer); tickerTimer = setTimeout(hideTicker, 7000);
}
function hideTicker() { $('ticker').classList.add('hidden'); }

// ---- exact AI token usage of this race (counted on the Spark, see /api/usage)
let usageTimer = null;
const fmtN = n => Number(n || 0).toLocaleString('en-US');
function pollUsage(run) {
  clearTimeout(usageTimer);
  if (!run) return;
  let stable = 0;
  const tick = async () => {
    let u = null;
    try { const r = await fetch(`api/usage?run=${encodeURIComponent(run)}`, { cache: 'no-store' }); if (r.ok) u = await r.json(); } catch (e) {}
    if (run !== AI.runId) return;
    if (u) {
      const L = u.llm, T = u.tts;
      $('uLlm').textContent = `${L.calls} calls · ${fmtN(L.prompt)} in + ${fmtN(L.completion)} out = ${fmtN(L.total)}`;
      $('uTts').textContent = `${T.clips} clips · ${fmtN(T.text)} text + ${fmtN(T.speech)} speech = ${fmtN(T.total)}`;
      $('uAudio').textContent = `${(T.audio_ms / 1000).toFixed(1)} s of speech generated`;
      $('uTot').textContent = fmtN(u.total);
      $('uSpot').textContent = u.product ? `Tech spotlight this race: ${u.product}` : '';
      const busy = u.active > 0 || !AI.debriefDone || AI.speaking || AI.inflight;
      stable = busy ? 0 : stable + 1;
      $('uState').textContent = stable >= 2 ? 'FINAL' : 'counting…';
      $('uState').className = stable >= 2 ? 'final' : '';
    } else $('uState').textContent = 'AI offline';
    if (stable < 2 && (state === 'results' || state === 'board')) usageTimer = setTimeout(tick, 800);
  };
  tick();
}

// ---- AI Race Engineer debrief (streamed)
let debriefAbort = null;
function buildTelemetry(entry, rk) {
  const ideal = x => (x.end - x.start) * SEG / MAX_SPEED * LAPS;
  const rows = SECTIONS.map((x, i) => ({ x, T: tele.sec[i], lost: Math.max(0, tele.sec[i].t - ideal(x)) }))
    .filter((r, i) => i !== 0)                                       // first section includes the standing start
    .sort((a, b) => b.lost - a.lost);
  const L = [];
  L.push(`Driver ${entry.name}. Track: ${track.name} (${track.sub}), ${LAPS} lap${LAPS > 1 ? 's' : ''}.`);
  L.push(`RESULT: LEADERBOARD POSITION ${rk.rank} of ${rk.of} (the ${LAPS}-lap leaderboard, shared by all tracks)` +
    (rk.prevBest && !rk.pb ? ` (this run did not beat the personal best of ${fmtTime(rk.prevBest.score)}).` : rk.prevBest ? ' (new personal best).' : '.') +
    (rk.leader && rk.rank > 1 ? ` Leader: ${rk.leader.name} with ${fmtTime(rk.leader.score)}.` : ''));
  L.push(`Score ${fmtTime(entry.score)} = race time ${fmtTime(entry.time)} minus ${GPU_BONUS}s per GPU; GPUs ${entry.gpus}/${entry.totalGpus}. Lower is better.`);
  L.push(`(On track the kart crossed the line ${entry.place}${ordinal(entry.place)} among ${NUM_CPU + 1} karts incl. AI rivals; that does NOT count for the ranking.)`);
  L.push(`Rocket start: ${tele.rocket ? 'yes' : 'no (hold the gas just before GO)'}. Green boost pads hit: ${tele.pads} of ${2 * LAPS}. ` +
    `Turbo: charged ${tele.turboEarned}x, fired ${tele.turboUsed}x, ${turbo} unused at the finish, ${tele.turboWasted} charge(s) lost because the turbo was already full.`);
  L.push(`Top speed ${Math.round(tele.top / MAX_SPEED * KMH)} km/h. Overtakes ${tele.overtakes}, positions lost ${tele.lost}.`);
  L.push(`Track sections over ${LAPS === 1 ? 'the lap' : 'all ' + LAPS + ' laps'}, worst first (time lost vs a perfect flat-out line):`);
  rows.forEach(({ x, T, lost }) => {
    L.push(`- ${x.name}: lost ${lost.toFixed(1)}s, off-road ${T.off.toFixed(1)}s, crashes into trackside objects ${T.crashes}, kart collisions ${T.bumps}, GPUs ${T.gpus}/${x.gpus * LAPS}`);
  });
  return L.join('\n');
}
function fallbackDebrief(entry) {
  const worst = SECTIONS.map((x, i) => ({ x, T: tele.sec[i] })).sort((a, b) => (b.T.off + b.T.crashes) - (a.T.off + a.T.crashes))[0];
  return `Solid run, ${entry.name}: ${fmtTime(entry.time)} with ${entry.gpus} GPUs.\n` +
    `• Stay on the track in the ${worst.x.name}.\n• Grab more of the ${entry.totalGpus} GPUs: each one is worth ${GPU_BONUS}s.\n` +
    `• ${tele.rocket ? 'Great rocket start, keep it up.' : 'Hold the gas just before GO for a rocket start.'}`;
}
async function runDebrief(entry, rk) {
  if (debriefAbort) debriefAbort.abort();
  AI.debriefDone = false;
  const ctl = new AbortController(); debriefAbort = ctl;
  const el = $('dbText'), meta = $('dbMeta');
  el.textContent = ''; el.classList.add('typing');
  meta.textContent = AI.llmOk() ? `Analysing your telemetry on the GB10…` : 'AI offline';
  let text = '', done = null;
  if (AI.llmOk()) {
    try {
      const r = await postT('api/debrief', { lang: AI.lang, telemetry: buildTelemetry(entry, rk), run: AI.runId }, 45000, ctl.signal);
      if (!r.ok || !r.body) throw new Error('debrief ' + r.status);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const d = JSON.parse(line);
          if (d.t) { text += d.t; el.textContent = text.replace(/^\s+/, ''); }
          else if (d.done) done = d;
          else if (d.error) throw new Error(d.error);
        }
      }
    } catch (e) { if (ctl.signal.aborted) return; }
  }
  if (ctl !== debriefAbort) return;
  el.classList.remove('typing');
  text = text.trim();
  if (!text) { text = fallbackDebrief(entry); el.textContent = text; meta.textContent = 'AI offline: basic debrief'; AI.debriefDone = true; return; }
  if (done) meta.textContent = `Generated live on the GB10 · ${shortModel()} · ${done.tokens} tokens · ${done.tps} tok/s · first word in ${done.ttft_ms} ms`;
  const verdict = text.split('\n')[0];
  if (AI.ttsOk()) { if (state === 'results') AI.speak(verdict, 'debrief'); else AI.pendingVerdict = verdict; }
  AI.debriefDone = true;
}

// ---- Powered by the GB10 panel
function shortModel() { const m = AI.stats && AI.stats.llm.model; return m ? m.split('/').pop() : 'LLM'; }
async function pollStats() {
  try { const r = await fetch('api/stats', { cache: 'no-store' }); AI.stats = r.ok ? await r.json() : null; } catch (e) { AI.stats = null; }
  if (AI.stats) { AI.tpsHist.push(AI.stats.llm.tps || 0); if (AI.tpsHist.length > 60) AI.tpsHist.shift(); }
  renderSpark();
  setTimeout(pollStats, 1000);
}
function renderSpark() {
  const el = $('spark'), st = AI.stats;
  const mode = ['race', 'countdown', 'finished', 'results'].includes(state) ? 'mini' : ['paused', 'garage'].includes(state) ? 'off' : 'full';
  el.className = `spark ${mode} s-${state}`;
  if (!st || mode === 'off') { el.classList.add('hidden'); return; }
  const g = st.gpu, l = st.llm, t = st.tts;
  const util = g.util == null ? '–' : Math.round(g.util) + '%';
  const pw = g.power == null ? '' : ` · ${Math.round(g.power)} W`;
  const tasks = (l.active || 0) + (t.active || 0);
  const dot = on => `<i class="dot ${on ? 'on' : ''}"></i>`;
  if (mode === 'mini') {
    el.innerHTML = `<b>⚡ GB10</b> GPU ${util}${pw} <span class="sep">|</span> LLM ${dot(l.active)} ${l.tps > 0 ? Math.round(l.tps) + ' tok/s' : l.last_ms ? l.last_ms + ' ms/line' : 'ready'} <span class="sep">|</span> VOICE ${dot(t.busy || t.active)} <span class="sep">|</span> AI TASKS ${tasks}`;
    return;
  }
  el.innerHTML = `
    <div class="sp-title">⚡ POWERED BY THE GB10</div>
    <div class="sp-row"><b>GPU</b><span>${esc(g.name || 'GB10')} · ${util}${pw}${g.temp == null ? '' : ` · ${Math.round(g.temp)}°C`}</span></div>
    <div class="sp-bar"><div style="width:${g.util || 0}%"></div></div>
    <div class="sp-row"><b>LLM</b><span>${l.online ? esc(shortModel()) : 'offline'}</span></div>
    <div class="sp-row"><b>${dot(l.active)} GEN</b><span>${l.tps.toFixed(0)} tok/s · ${l.calls} AI calls</span></div>
    <canvas id="spGraph" width="268" height="${state === 'board' ? 18 : 26}"></canvas>
    <div class="sp-row"><b>${dot(t.busy || t.active)} VOICE</b><span>${t.ready ? 'Chatterbox TTS · ' + (t.busy ? 'speaking' : 'ready') : t.online ? 'loading…' : 'offline'}</span></div>
    <div class="sp-row"><b>AI TASKS NOW</b><span>LLM ×${l.active} · TTS ×${t.active}</span></div>`;
  const cv = $('spGraph'), gx = cv.getContext('2d'), h = AI.tpsHist, mx = Math.max(60, ...h);
  gx.clearRect(0, 0, cv.width, cv.height);
  gx.fillStyle = 'rgba(118,185,0,.35)';
  gx.beginPath(); gx.moveTo(0, cv.height);
  h.forEach((v, i) => gx.lineTo(i / 59 * cv.width, cv.height - v / mx * (cv.height - 2)));
  gx.lineTo((h.length - 1) / 59 * cv.width, cv.height); gx.closePath(); gx.fill();
}
function renderAiOpts() {
  document.querySelectorAll('#langSel button').forEach(b => b.classList.toggle('on', b.dataset.l === AI.lang));
  const v = $('voiceBtn'); if (v) { v.textContent = AI.voice ? '🔊 VOICE ON' : '🔇 VOICE OFF'; v.classList.toggle('on', AI.voice); }
}
document.querySelectorAll('#langSel button').forEach(b => { b.onclick = () => AI.setLang(b.dataset.l); });
$('voiceBtn').onclick = () => AI.toggleVoice();

// ------------------------------------------------------------------ INPUT
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
document.addEventListener('keydown', e => {
  const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
  if (state === 'race' || state === 'countdown' || state === 'finished') {
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'Space') { e.preventDefault(); if (state === 'race' && turbo > 0 && boostT < 0.3) { turbo--; tele.turboUsed++; boostT = 1.6; Snd.boost(); popups.push({ text: 'TURBO!', t: 0.8, x: W / 2, y: H - 150, col: '#ffb347' }); AI.event('turbo', 'Fires the GPU turbo!', 3); } }
    if (e.code === 'KeyP' || e.code === 'Escape') pause(true);
    if (e.code === 'KeyM') Snd.toggleMute();
    if (e.code === 'KeyV') AI.toggleVoice();
    return;
  }
  if (state === 'paused') {
    if (e.code === 'KeyP' || e.code === 'Escape') pause(false);
    if (e.code === 'KeyQ') quitRun();
    return;
  }
  if (state === 'garage') {
    if (e.code === 'Escape') { e.preventDefault(); goTitle(); }
    if (e.code === 'Enter') { e.preventDefault(); saveGarage(); }
    return;
  }
  if (state === 'title') {
    Snd.init();
    const f = document.activeElement && document.activeElement.id;
    if (e.code === 'Enter' && ['btnBoard', 'btnSettings'].includes(f)) return;
    if (e.code === 'Enter') {
      e.preventDefault();
      const plusSel = grid.querySelector('.card.plus.sel');
      if (plusSel || !racers.length) openGarage({ isNew: true, returnTo: 'title' }); else startRace();
      return;
    }
    if (!typing && /^Arrow/.test(e.code)) {
      e.preventDefault();
      moveSelection({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[e.code]);
    }
    if (!typing && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) selectTrack(R.TRACKS[+e.code.slice(-1) - 1].id);
    if (!typing && e.code === 'KeyM') Snd.toggleMute();
    return;
  }
  if (state === 'results' && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); showBoard(); return; }
  if (state === 'board' && e.code === 'Enter' && !['btnCsv', 'btnReset'].includes(document.activeElement.id)) { e.preventDefault(); goTitle(); }
});
document.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'race') pause(true); });

$('btnStart').onclick = () => startRace();
$('btnBoard').onclick = () => { Snd.init(); showBoard(); };
$('btnSettings').onclick = () => { Snd.init(); openGarage({ returnTo: 'garage' }); };
$('btnResNext').onclick = showBoard;
$('btnNew').onclick = goTitle;
$('btnResume').onclick = () => pause(false);
$('btnQuit').onclick = quitRun;
$('btnCsv').onclick = exportCsv;
$('btnReset').onclick = async () => {
  if (prompt('Type RESET to wipe the leaderboard (a backup is kept on the Spark)') === 'RESET') { await resetScores(); lastEntryId = null; showBoard(); }
};
$('gNew').onclick = () => editRacer(null);
$('gSave').onclick = saveGarage;
$('gDelete').onclick = deleteGarage;
$('gBack').onclick = goTitle;

// ------------------------------------------------------------------ LAYOUT + LOOP
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720);
  $('stage').style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fit);

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.25, (now - last) / 1000); last = now;
  while (acc >= STEP) { update(STEP); acc -= STEP; }
  render(); updateHud(); AI.tick();
  requestAnimationFrame(frame);
}

async function boot() {
  fit(); buildShared(); renderAiOpts(); pollStats();
  await Promise.all([loadRacers(), loadScores(), loadSettings()]);
  loadTrack(R.trackById(selTrack));
  buildTrackSel();
  goTitle();
  const q = new URLSearchParams(location.search);
  if (q.has('debug')) window.__race = { get x() { return playerX; }, get curve() { return findSegment(position + PLAYER_Z + SEG * 6).curve; }, get state() { return state; }, get recent() { return AI.recent.slice(); }, get lap() { return lap; }, get place() { return finishPlace; }, get time() { return raceTime; } };
  // screenshot hooks: ?shot=race&track=coral-reef&t=12 simulates synchronously
  if (q.get('shot')) {
    if (q.get('track')) selectTrack(q.get('track'), true);
    const tmp = R.normalizeRacer({ id: 'shot', name: q.get('name') || 'TESTER', car: '#76b900', suit: '#111111', wheels: q.get('wheels') || 'neon' });
    if (q.get('shot') === 'race') {
      startRace(tmp); keys.up = true; const secs = +q.get('t') || 8;
      for (let i = 0; i < secs * 60; i++) { const ps = findSegment(position + PLAYER_Z + SEG * 6); playerX += U.limit(ps.curve * 0.12 - playerX, -0.03, 0.03) * 0.5; update(STEP); }
    } else if (q.get('shot') === 'board') showBoard();
    else if (q.get('shot') === 'garage') openGarage({ isNew: true });
  }
  requestAnimationFrame(frame);
}
boot();
})();
