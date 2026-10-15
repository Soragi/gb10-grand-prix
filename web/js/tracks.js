/* The three tracks: layout (curves/hills/sections), zones (road colours + backgrounds), scenery art and placement.
 *
 * A track definition:
 *   zones:     { key: { road:[light,dark], ground:[..], rumble:[..], lane, fog } }
 *   bg(zone):  -> { sky, far, near } panoramas (1280x400, horizon at y≈200)
 *   art():     -> { spriteKey: [canvas frames] }
 *   layout(T): T.sec(name, zone) / T.road(enter, hold, leave, curve, hill) / T.ads() / T.boost(n, offset) / T.mark()
 *   decorate(T): place scenery with T.add(n, key, offset, worldWidth, opts), T.zoneAt(n), T.secAt(n), T.inAds(n), T.rng
 */
'use strict';
(function () {
const R = window.RACE;
const { mk, rr, poly, circle, ellipse, fitText, shade, mulberry32, tileX } = R;
const BW = 1280, BH = 400;

// ONE ROUTE FOR ALL TRACKS: same curves, hills, length, boost pads (and the engine places the same GPUs), so lap times
// are comparable and there is a single leaderboard. Each track only supplies 10 section names + zones (scenery).
function route(T, names, zones) {
  let s;
  const S = i => T.sec(names[i], zones[i]);
  S(0); s = T.mark(); T.road(20, 20, 20, 0, 0); T.ads(s);                                   // start straight
  S(1); T.road(40, 40, 40, -4, 0); T.road(40, 40, 40, 4, 10);                               // left, then right + rise
  S(2); s = T.mark(); T.road(20, 50, 20, 0, 0); T.boost(s + 30, -0.45);                     // boost straight
  S(3); T.road(40, 40, 40, -5, 0); T.road(40, 40, 40, 3, -10);                              // left, right + dip
  S(4); s = T.mark(); T.road(30, 50, 30, 0, 0); T.ads(s); T.road(40, 40, 40, 5, 0);         // back straight + right
  S(5); T.road(40, 40, 40, 0, 40); T.road(40, 40, 40, -3, -40);                             // the big hill
  S(6); T.road(40, 40, 40, -6, 0);                                                           // hairpin left
  S(7); s = T.mark(); T.road(20, 40, 20, 0, 0); T.boost(s + 30, 0.45); T.road(40, 40, 40, 4, 0);
  S(8); T.road(50, 50, 50, -3, 0);                                                           // long left
  S(9); T.road(40, 40, 40, 0, -T.lastY()); s = T.mark(); T.road(15, 15, 15, 0, 0); T.ads(s, 1);   // home straight
}
R.ROUTE_ID = 'route-v3';
const bg = () => { const c = mk(BW, BH); return [c, c.getContext('2d')]; };
const vgrad = (g, y0, y1, stops) => { const gr = g.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };

// =====================================================================================================
// TRACK 1 · AI FACTORY (data center)
// =====================================================================================================
function rack(label, frame) {
  const cv = mk(120, 280), g = cv.getContext('2d'), rng = mulberry32(label.length * 97 + 11);
  g.fillStyle = '#0b0d0c'; rr(g, 4, 0, 112, 276, 4); g.fill();
  g.fillStyle = '#1c201e'; g.fillRect(4, 0, 6, 276); g.fillRect(110, 0, 6, 276);
  g.fillStyle = '#000'; g.fillRect(12, 4, 96, 26);
  if (label.length > 12) {                                     // long names (VERA RUBIN NVL72) on two lines
    const cut = label.lastIndexOf(' ');
    fitText(g, label.slice(0, cut), 60, 11, 90, 11, '#76b900'); fitText(g, label.slice(cut + 1), 60, 23, 90, 11, '#76b900');
  } else fitText(g, label, 60, 17, 88, 15, '#76b900');
  g.fillStyle = '#76b900'; g.fillRect(12, 30, 96, 4);
  for (let i = 0; i < 10; i++) {
    const y = 40 + i * 22;
    g.fillStyle = '#191d1b'; g.fillRect(14, y, 92, 18);
    g.fillStyle = '#242a27'; for (let x = 18; x < 80; x += 4) g.fillRect(x, y + 3, 2, 12);
    for (let k = 0; k < 4; k++) {
      const on = (rng() + frame * 0.37 + k * 0.13) % 1;
      g.fillStyle = on > 0.55 ? '#76ff3a' : on > 0.3 ? '#38b6ff' : '#1f3020';
      g.fillRect(84 + (k % 2) * 8, y + 4 + Math.floor(k / 2) * 6, 5, 3);
    }
  }
  g.fillStyle = '#26292b'; g.fillRect(4, 262, 112, 14);
  return cv;
}
function cdu() {
  const cv = mk(170, 200), g = cv.getContext('2d');
  [[40, '#1d6fb8'], [70, '#b8321d'], [110, '#1d6fb8'], [140, '#b8321d']].forEach(([x, c]) => { g.fillStyle = c; g.fillRect(x - 6, 0, 12, 60); g.fillStyle = '#999'; g.fillRect(x - 8, 50, 16, 6); });
  g.fillStyle = '#4c5864'; rr(g, 6, 56, 158, 140, 6); g.fill();
  g.fillStyle = '#5d6b78'; g.fillRect(14, 64, 142, 8);
  g.fillStyle = '#0b1b2a'; g.fillRect(22, 84, 70, 44); g.fillStyle = '#38b6ff'; g.fillRect(28, 92, 40, 4); g.fillRect(28, 102, 54, 4); g.fillRect(28, 112, 30, 4);
  circle(g, 126, 106, 18, '#ddd'); circle(g, 126, 106, 15, '#222'); g.strokeStyle = '#ff4d3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(126, 106); g.lineTo(136, 96); g.stroke();
  fitText(g, 'CDU · LIQUID COOLING', 85, 160, 140, 12, '#cfe6ff');
  return cv;
}
function pillar() {
  const cv = mk(60, 300), g = cv.getContext('2d');
  g.fillStyle = '#8a8f94'; g.fillRect(6, 0, 48, 300); g.fillStyle = '#9da2a7'; g.fillRect(6, 0, 10, 300);
  for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#111' : '#ffcc00'; g.fillRect(6, 250 + i * 8, 48, 8); }
  g.fillStyle = '#000'; g.fillRect(12, 120, 36, 28); fitText(g, 'A3', 30, 134, 30, 18, '#76b900');
  return cv;
}
function amr() {
  const cv = mk(130, 90), g = cv.getContext('2d');
  g.fillStyle = '#c58a3a'; g.fillRect(28, 6, 74, 40); g.strokeStyle = '#8a5a20'; g.lineWidth = 2; g.strokeRect(28, 6, 74, 40);
  fitText(g, 'GPU', 65, 26, 50, 16, '#5a3a10');
  g.fillStyle = '#ececec'; rr(g, 8, 44, 114, 30, 8); g.fill();
  g.fillStyle = '#76b900'; g.fillRect(14, 54, 102, 5);
  circle(g, 26, 78, 9, '#222'); circle(g, 104, 78, 9, '#222');
  g.fillStyle = '#38b6ff'; g.fillRect(56, 64, 18, 4);
  return cv;
}
function chiller() {
  const cv = mk(220, 150), g = cv.getContext('2d');
  g.fillStyle = '#5b6873'; rr(g, 4, 30, 212, 116, 6); g.fill();
  for (let i = 0; i < 3; i++) { circle(g, 42 + i * 68, 30, 26, '#3b4650'); circle(g, 42 + i * 68, 30, 22, '#1d242a'); g.strokeStyle = '#7a8892'; g.lineWidth = 3; g.beginPath(); g.moveTo(42 + i * 68 - 20, 30); g.lineTo(42 + i * 68 + 20, 30); g.moveTo(42 + i * 68, 10); g.lineTo(42 + i * 68, 50); g.stroke(); }
  g.fillStyle = '#4a565f'; for (let x = 12; x < 210; x += 10) g.fillRect(x, 64, 5, 70);
  fitText(g, 'CHILLER 04', 110, 140, 120, 10, '#d8e8f2');
  return cv;
}
function tank() {
  const cv = mk(110, 230), g = cv.getContext('2d');
  g.fillStyle = '#2f6fa0'; rr(g, 10, 20, 90, 200, 40); g.fill();
  g.fillStyle = '#4c92c8'; g.fillRect(22, 40, 12, 160);
  ellipse(g, 55, 26, 45, 12, '#3f86bd');
  circle(g, 55, 120, 14, '#eee'); circle(g, 55, 120, 11, '#222');
  fitText(g, 'COOLANT', 55, 170, 70, 12, '#e6f4ff');
  return cv;
}
function trayGantry(text) {
  const cv = mk(640, 240), g = cv.getContext('2d');
  g.fillStyle = '#3a3f44'; g.fillRect(0, 0, 26, 240); g.fillRect(614, 0, 26, 240);
  g.fillStyle = '#c9a400'; g.fillRect(0, 8, 640, 14); g.fillStyle = '#8a7000'; g.fillRect(0, 22, 640, 4);
  g.strokeStyle = '#ff6a00'; g.lineWidth = 3; for (let x = 40; x < 600; x += 18) { g.beginPath(); g.moveTo(x, 22); g.quadraticCurveTo(x + 9, 34, x + 18, 22); g.stroke(); }
  g.strokeStyle = '#2b9cff'; g.lineWidth = 2; for (let x = 30; x < 600; x += 24) { g.beginPath(); g.moveTo(x, 24); g.quadraticCurveTo(x + 12, 38, x + 24, 24); g.stroke(); }
  g.fillStyle = '#999'; g.fillRect(250, 26, 3, 24); g.fillRect(387, 26, 3, 24);
  g.fillStyle = '#000'; g.fillRect(220, 48, 200, 40); g.strokeStyle = '#76b900'; g.lineWidth = 3; g.strokeRect(220, 48, 200, 40);
  fitText(g, text, 320, 68, 186, 22, '#76b900');
  return cv;
}
function pipeGantry() {
  const cv = mk(640, 240), g = cv.getContext('2d');
  g.fillStyle = '#4b5258'; g.fillRect(0, 0, 24, 240); g.fillRect(616, 0, 24, 240);
  [[16, '#1d6fb8', 22], [44, '#b8321d', 18], [68, '#1d6fb8', 14]].forEach(([y, c, h]) => {
    g.fillStyle = c; g.fillRect(0, y, 640, h); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, y + 3, 640, 3);
    g.fillStyle = '#aaa'; for (let x = 60; x < 640; x += 120) g.fillRect(x, y - 2, 8, h + 4);
  });
  return cv;
}
const factory = {
  id: 'ai-factory', name: 'AI Factory', sub: 'Data center', seed: 1101,
  offroad: 'Off the aisle, rattling over the raised floor tiles!',
  zones: {
    hall: { road: ['#30343c', '#2b2f36'], ground: ['#58606e', '#4f5664'], rumble: ['#76b900', '#151515'], lane: '#5f8f1a', fog: '#0b1610' },
    cooling: { road: ['#2a3644', '#25303c'], ground: ['#38566e', '#324e64'], rumble: ['#00a3e0', '#dff4ff'], lane: '#4aa6cc', fog: '#07131d' },
  },
  bg(zone) {
    const cool = zone === 'cooling';
    const [sky, s] = bg();
    s.fillStyle = vgrad(s, 0, 210, cool ? [[0, '#02060b'], [1, '#0d1c29']] : [[0, '#030605'], [1, '#102016']]); s.fillRect(0, 0, BW, BH);
    for (let i = 0; i < 11; i++) {                                   // ceiling light rows receding to the horizon
      const y = 186 - 180 / (1 + i * 0.6), th = Math.max(1, 6 - i * 0.55);
      s.fillStyle = cool ? `rgba(150,220,255,${0.75 - i * 0.06})` : `rgba(190,255,200,${0.75 - i * 0.06})`;
      for (let x = 0; x < BW; x += 160) s.fillRect(x + 8, y, 144, th);
    }
    if (cool) [[26, '#1d6fb8', 16], [50, '#b8321d', 12]].forEach(([y, c, h]) => { s.fillStyle = c; s.fillRect(0, y, BW, h); s.fillStyle = 'rgba(255,255,255,.2)'; s.fillRect(0, y + 2, BW, 2); });
    else { s.fillStyle = '#6b5a00'; s.fillRect(0, 34, BW, 6); s.fillStyle = '#c9a400'; s.fillRect(0, 30, BW, 4); }
    const [far, f] = bg(), rng = mulberry32(cool ? 5 : 3);
    if (cool) {
      tileX(BW, 160, x => {
        f.fillStyle = '#16293a'; rr(f, x + 14, 118, 56, 84, 26); f.fill();
        f.fillStyle = '#1f3a52'; f.fillRect(x + 22, 128, 8, 66);
        f.fillStyle = '#12202c'; f.fillRect(x + 84, 150, 64, 50); f.fillStyle = '#2e4a62'; f.fillRect(x + 90, 156, 52, 6);
        f.fillStyle = '#1d6fb8'; f.fillRect(x + 70, 140, 14, 6); f.fillStyle = '#b8321d'; f.fillRect(x + 70, 160, 14, 6);
      });
    } else {
      for (let x = 0; x < BW; x += 22) {
        if (x % 352 > 300) continue;                               // aisle gaps
        f.fillStyle = '#0c0f0d'; f.fillRect(x, 128, 20, 74);
        for (let k = 0; k < 7; k++) { f.fillStyle = rng() > 0.5 ? '#76ff3a' : rng() > 0.5 ? '#38b6ff' : '#1d2b20'; f.fillRect(x + 4 + (k % 2) * 8, 134 + k * 9, 4, 2); }
      }
      tileX(BW, 640, x => { f.fillStyle = '#000'; f.fillRect(x + 200, 100, 240, 22); f.strokeStyle = '#76b900'; f.lineWidth = 2; f.strokeRect(x + 200, 100, 240, 22); fitText(f, 'AI FACTORY', x + 320, 111, 220, 14, '#76b900'); });
    }
    f.fillStyle = cool ? '#122230' : '#151d18'; f.fillRect(0, 200, BW, 200);
    const [near, n] = bg();
    n.fillStyle = cool ? '#3a444c' : '#3f3a22'; n.fillRect(0, 6, BW, 4);
    for (let x = 0; x < BW; x += 80) { n.fillStyle = '#2a2f33'; n.fillRect(x, 0, 4, 12); }
    return { sky, far, near };
  },
  art() {
    return {
      rackA: [0, 1].map(fr => rack('GB300 NVL72', fr)), rackB: [0, 1].map(fr => rack('VERA RUBIN NVL72', fr)),
      rackC: [0, 1].map(fr => rack('RUBIN NVL8', fr)),
      cdu: [cdu()], pillar: [pillar()], amr: [amr()], chiller: [chiller()], tank: [tank()],
      tray: ['HALL A · COLD AISLE', 'NVLINK SPINE', 'HALL B · HOT AISLE', 'NETWORK CORE', 'AI FACTORY', 'VERA RUBIN ROW'].map(trayGantry),
      pipes: [pipeGantry()],
    };
  },
  obstacles: { rackA: 'GB300 NVL72 rack', rackB: 'Vera Rubin NVL72 rack', rackC: 'Rubin NVL8 system', cdu: 'liquid-cooling unit', pillar: 'support pillar', amr: 'delivery robot', chiller: 'chiller unit', tank: 'coolant tank' },
  layout(T) {
    route(T, ['Loading dock', 'Hall A cold aisle', 'NVLink spine', 'Cooling loop', 'Hall B hot aisle', 'Ramp to Hall C',
      'Power room', 'Network core', 'Rubin row', 'Final aisle'],
    ['hall', 'hall', 'hall', 'cooling', 'hall', 'hall', 'cooling', 'hall', 'hall', 'hall']);
  },
  decorate(T) {
    const signFor = { 'Hall A cold aisle': 0, 'NVLink spine': 1, 'Hall B hot aisle': 2, 'Network core': 3, 'Rubin row': 5 };
    for (let n = 6; n < T.N - 2; n++) {
      const zone = T.zoneAt(n), sec = T.secAt(n), first = n === sec.start;
      if (zone === 'hall') {
        if (first && signFor[sec.name] != null) T.add(n, 'tray', 0, 5600, { collide: false, frame: signFor[sec.name] });
        else if (n % 90 === 45) T.add(n, 'tray', 0, 5600, { collide: false, frame: 4 });
        if (!T.inAds(n)) {
          if (n % 30 < 3) { if (n % 30 === 0) { T.add(n, 'pillar', -1.4, 500); T.add(n, 'pillar', 1.4, 500); } }
          else if (n % 3 === 0) {
            const racks = sec.name === 'Rubin row' ? ['rackB', 'rackC'] : ['rackA', 'rackB', 'rackC'], k = (n / 3) % racks.length;
            T.add(n, racks[k], -1.55, 1000, { anim: true, rate: 3 }); T.add(n, racks[(k + 1) % racks.length], 1.55, 1000, { anim: true, rate: 3 });
          }
        }
      } else {
        if (n % 40 === 0) T.add(n, 'pipes', 0, 5600, { collide: false });
        if (n % 7 === 0) { const sd = n % 14 ? 1 : -1; T.add(n, ['cdu', 'tank', 'chiller'][(n / 7) % 3], sd * (1.6 + T.rng() * 0.8), 1300); }
        if (n % 11 === 0) T.add(n, 'tank', -(n % 22 ? 1 : -1) * 2.4, 900);
        if (n % 37 === 0) T.add(n, 'amr', (T.rng() < 0.5 ? -1 : 1) * 1.35, 700);
      }
    }
  },
};

// =====================================================================================================
// TRACK 2 · HQ CAMPUS (Endeavor + Voyager buildings and the park between them)
// =====================================================================================================
function triSkylights(g, top, bottom, frame = '#c9ced2', glass = ['#bfe6ff', '#8fcdf6']) {
  let y = top, h = 30;
  while (y < bottom - 4 && h >= 2) {
    const w = h * 1.3;
    for (let x = -w, k = 0; x < BW + w; x += w / 2, k++) {
      const up = k % 2 === 0, x0 = x, x1 = x + w / 2, x2 = x + w;
      g.beginPath();
      if (up) { g.moveTo(x0, y + h); g.lineTo(x1, y); g.lineTo(x2, y + h); } else { g.moveTo(x0, y); g.lineTo(x1, y + h); g.lineTo(x2, y); }
      g.closePath(); g.fillStyle = (k + Math.round(y)) % 3 === 0 ? glass[0] : '#f4f6f7'; g.fill();
      g.strokeStyle = frame; g.lineWidth = Math.max(1, h / 14); g.stroke();
    }
    y += h; h = Math.max(2, h * 0.86);
  }
}
function desk() {
  const cv = mk(140, 120), g = cv.getContext('2d');
  g.fillStyle = '#3a3a3a'; g.fillRect(16, 70, 6, 46); g.fillRect(118, 70, 6, 46);
  g.fillStyle = '#f2f2f2'; g.fillRect(6, 62, 128, 10); g.fillStyle = '#d9d9d9'; g.fillRect(6, 72, 128, 3);
  [[26, 0], [74, 1]].forEach(([x, i]) => { g.fillStyle = '#111'; g.fillRect(x, 18, 42, 32); g.fillStyle = i ? '#76b900' : '#2b6fd6'; g.fillRect(x + 3, 21, 36, 24); g.fillStyle = '#222'; g.fillRect(x + 19, 50, 4, 12); });
  g.fillStyle = '#1f2a1f'; rr(g, 52, 78, 36, 40, 8); g.fill();
  return cv;
}
function plantWall() {
  const cv = mk(200, 230), g = cv.getContext('2d'), rng = mulberry32(42);
  g.fillStyle = '#3b2f22'; g.fillRect(0, 0, 200, 230);
  for (let i = 0; i < 260; i++) circle(g, 8 + rng() * 184, 8 + rng() * 214, 6 + rng() * 9, ['#2f7d2a', '#3f9a32', '#5bb83d', '#1f5e22', '#76b900'][Math.floor(rng() * 5)]);
  g.strokeStyle = '#6b5638'; g.lineWidth = 6; g.strokeRect(3, 3, 194, 224);
  return cv;
}
function ficus() {
  const cv = mk(120, 220), g = cv.getContext('2d');
  g.fillStyle = '#6b4a2a'; g.fillRect(56, 90, 8, 90);
  circle(g, 60, 70, 46, '#2f7d2a'); circle(g, 40, 56, 30, '#3f9a32'); circle(g, 82, 52, 28, '#3f9a32'); circle(g, 60, 34, 24, '#5bb83d');
  g.fillStyle = '#f2f2f2'; rr(g, 30, 170, 60, 48, 6); g.fill(); g.fillStyle = '#d6d6d6'; g.fillRect(30, 170, 60, 6);
  return cv;
}
function triArt() {
  const cv = mk(170, 220), g = cv.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(40, 180, 90, 40);
  const P = [[85, 10], [20, 120], [150, 120], [85, 175], [60, 70], [115, 70]];
  g.strokeStyle = '#76b900'; g.lineWidth = 4; g.shadowColor = '#9dff3a'; g.shadowBlur = 10;
  [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [0, 4], [0, 5], [4, 5], [4, 1], [5, 2], [4, 3], [5, 3]].forEach(([a, b]) => { g.beginPath(); g.moveTo(...P[a]); g.lineTo(...P[b]); g.stroke(); });
  return cv;
}
function lounge() {
  const cv = mk(170, 100), g = cv.getContext('2d');
  g.fillStyle = '#4c7f1c'; rr(g, 10, 20, 150, 46, 12); g.fill();
  g.fillStyle = '#76b900'; rr(g, 6, 52, 158, 34, 10); g.fill();
  g.fillStyle = '#5c9a14'; rr(g, 0, 40, 22, 46, 8); g.fill(); rr(g, 148, 40, 22, 46, 8); g.fill();
  g.fillStyle = '#333'; g.fillRect(16, 86, 6, 12); g.fillRect(148, 86, 6, 12);
  return cv;
}
function skyBeam() {
  const cv = mk(640, 240), g = cv.getContext('2d');
  g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 18, 240); g.fillRect(622, 0, 18, 240);
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, 640, 10); g.fillRect(0, 50, 640, 6);
  for (let x = 0, k = 0; x < 640; x += 40, k++) {
    g.beginPath();
    if (k % 2) { g.moveTo(x, 10); g.lineTo(x + 40, 10); g.lineTo(x + 20, 50); } else { g.moveTo(x, 50); g.lineTo(x + 20, 10); g.lineTo(x + 40, 50); }
    g.closePath(); g.fillStyle = 'rgba(160,215,255,.85)'; g.fill(); g.strokeStyle = '#d0d0d0'; g.lineWidth = 3; g.stroke();
  }
  return cv;
}
function trellis() {
  const cv = mk(640, 240), g = cv.getContext('2d');
  g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, 16, 240); g.fillRect(624, 0, 16, 240);
  g.fillStyle = '#bdbdbd'; g.fillRect(0, 38, 640, 6);
  for (let x = 4; x < 636; x += 52) {
    poly(g, [[x, 6], [x + 48, 0], [x + 48, 34], [x, 40]], '#1b2f55');
    g.strokeStyle = '#5a7bb0'; g.lineWidth = 1;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 12, 6 - k * 1.5); g.lineTo(x + k * 12, 40 - k * 1.5); g.stroke(); }
    g.beginPath(); g.moveTo(x, 23); g.lineTo(x + 48, 17); g.stroke();
  }
  return cv;
}
function oak(v) {
  const cv = mk(160, 210), g = cv.getContext('2d');
  g.fillStyle = '#5a4026'; g.fillRect(72, 110, 16, 100); g.fillRect(56, 120, 8, 30);
  const c = v ? ['#2e6b23', '#3d8a2c', '#5aa83c'] : ['#356f2a', '#4a9234', '#69b84a'];
  circle(g, 80, 80, 62, c[0]); circle(g, 46, 70, 40, c[1]); circle(g, 116, 66, 40, c[1]); circle(g, 80, 40, 36, c[2]);
  return cv;
}
function bench() {
  const cv = mk(150, 80), g = cv.getContext('2d');
  g.fillStyle = '#8a6a44'; for (let i = 0; i < 3; i++) g.fillRect(6, 10 + i * 10, 138, 7);
  g.fillStyle = '#9e7c52'; g.fillRect(6, 44, 138, 10);
  g.fillStyle = '#333'; g.fillRect(16, 54, 8, 24); g.fillRect(126, 54, 8, 24);
  return cv;
}
function terrace() {
  const cv = mk(230, 170), g = cv.getContext('2d'), rng = mulberry32(9);
  for (let i = 0; i < 4; i++) {
    const y = 20 + i * 36, x = 10 + i * 12, w = 210 - i * 24;
    g.fillStyle = i % 2 ? '#b07946' : '#c58b55'; g.fillRect(x, y, w, 36); g.fillStyle = '#8a5a2e'; g.fillRect(x, y + 30, w, 6);
    for (let k = 0; k < 8; k++) circle(g, x + 10 + rng() * (w - 20), y + 4, 6 + rng() * 6, ['#2f7d2a', '#5bb83d', '#76b900'][Math.floor(rng() * 3)]);
  }
  return cv;
}
function hqSign(name) {
  const cv = mk(250, 130), g = cv.getContext('2d');
  g.fillStyle = '#c9c4ba'; g.fillRect(0, 30, 250, 100); g.fillStyle = '#b5afa4'; g.fillRect(0, 120, 250, 10);
  poly(g, [[22, 100], [52, 44], [82, 100]], '#76b900');
  fitText(g, name, 160, 66, 150, 30, '#111'); fitText(g, 'HQ CAMPUS', 160, 100, 120, 16, '#3b3b3b');
  return cv;
}
const hq = {
  id: 'hq-campus', name: 'HQ Campus', sub: 'Endeavor · Voyager · the Park', seed: 2202,
  offroadByZone: { park: 'Off the path, cutting straight across the lawn!', endeavor: 'Off the walkway and weaving between the desks!', voyager: 'Off the walkway and onto the wooden floor!' },
  zones: {
    endeavor: { road: ['#b4b6b8', '#acaeb0'], ground: ['#ddd2bc', '#d5c9b1'], rumble: ['#76b900', '#ffffff'], lane: '#ffffff', fog: '#e9eef0' },
    park: { road: ['#d3c4a0', '#cbbb96'], ground: ['#5fae3e', '#55a236'], rumble: ['#efe9da', '#9c8a62'], lane: null, fog: '#cfe7f7' },
    voyager: { road: ['#7a7a7e', '#727276'], ground: ['#b9824f', '#b07946'], rumble: ['#76b900', '#2a2a2a'], lane: '#dcdcdc', fog: '#dfe6d8' },
  },
  bg(zone) {
    const [sky, s] = bg(), [far, f] = bg(), [near, n] = bg(), rng = mulberry32(zone.length * 13);
    if (zone === 'park') {
      s.fillStyle = vgrad(s, 0, 210, [[0, '#4ea6ea'], [1, '#d6eeff']]); s.fillRect(0, 0, BW, BH);
      [[200, 110], [700, 90], [1050, 120]].forEach(([x, y]) => { s.fillStyle = 'rgba(255,255,255,.85)'; s.fillRect(x, y, 110, 12); s.fillRect(x + 18, y - 9, 66, 9); });
      for (let x = 0; x < BW; x += 64) {                                       // the solar trellis seen from below
        poly(s, [[x, 8], [x + 58, 2], [x + 58, 42], [x, 50]], '#1b2f55');
        s.strokeStyle = '#4e6fa6'; s.lineWidth = 1; s.beginPath(); s.moveTo(x + 29, 5); s.lineTo(x + 29, 46); s.stroke();
      }
      s.fillStyle = '#d0d0d0'; s.fillRect(0, 50, BW, 5);
      tileX(BW, 640, x => {                                                    // Endeavor + Voyager facades
        [[x + 30, 'ENDEAVOR', 250], [x + 330, 'VOYAGER', 290]].forEach(([bx, name, w]) => {
          f.fillStyle = '#2c3e50'; f.fillRect(bx, 128, w, 74);
          f.strokeStyle = '#5c7a90'; f.lineWidth = 2;
          for (let k = 0; k < w; k += 26) { f.beginPath(); f.moveTo(bx + k, 202); f.lineTo(bx + k + 13, 128); f.lineTo(bx + k + 26, 202); f.stroke(); }
          f.fillStyle = '#3d5368'; for (let k = 0; k < w; k += 40) poly(f, [[bx + k, 128], [bx + k + 20, 112], [bx + k + 40, 128]], '#3d5368');
          f.fillStyle = '#fff'; f.font = '900 11px Arial'; f.textAlign = 'center'; f.fillText(name, bx + w / 2, 142);
        });
      });
      for (let x = 0; x < BW; x += 18) circle(n, x + rng() * 8, 196 + rng() * 6, 14 + rng() * 10, rng() > 0.5 ? '#3d8a2c' : '#2e6b23');
      n.fillStyle = '#4f9a34'; n.fillRect(0, 202, BW, 200);
    } else {
      const voy = zone === 'voyager';
      s.fillStyle = voy ? '#efe7dc' : '#f2f4f5'; s.fillRect(0, 0, BW, BH);
      if (voy) {                                                               // Voyager's undulating roof with skylights
        for (let r = 0; r < 9; r++) {
          const y = 186 - 176 / (1 + r * 0.55);
          s.strokeStyle = `rgba(150,120,90,${0.5 - r * 0.04})`; s.lineWidth = Math.max(1, 5 - r * 0.5);
          s.beginPath(); for (let x = 0; x <= BW; x += 16) s.lineTo(x, y + Math.sin(x / BW * Math.PI * 4) * (10 - r)); s.stroke();
        }
        tileX(BW, 320, x => { poly(s, [[x + 60, 40], [x + 100, 0], [x + 140, 40]], '#bfe6ff'); poly(s, [[x + 210, 90], [x + 235, 66], [x + 260, 90]], '#bfe6ff'); });
      } else triSkylights(s, 0, 176);                                          // Endeavor's triangle skylights
      if (voy) {                                                               // "the Mountain" with its terraces
        tileX(BW, 640, x => {
          for (let i = 0; i < 6; i++) {
            const w = 360 - i * 52, y = 196 - (i + 1) * 13;
            f.fillStyle = i % 2 ? '#a8723f' : '#bd8550'; f.fillRect(x + 140 + i * 26, y, w, 13);
            for (let k = 0; k < w; k += 18) circle(f, x + 146 + i * 26 + k, y + 1, 5, k % 36 ? '#3f9a32' : '#76b900');
          }
          f.fillStyle = '#e8e2d8'; f.fillRect(x + 300, 116, 40, 80);
          for (let k = 0; k < 8; k++) { f.fillStyle = '#c9b9a2'; f.fillRect(x + 300, 120 + k * 10, 40, 3); }
        });
        f.fillStyle = '#2f7d2a'; for (let x = 0; x < BW; x += 640) { f.fillRect(x + 20, 120, 90, 80); f.fillRect(x + 540, 130, 80, 70); }
      } else {
        f.fillStyle = '#d6e9f2'; f.fillRect(0, 150, BW, 52);
        f.fillStyle = '#9fb3bf'; for (let x = 0; x < BW; x += 30) f.fillRect(x, 150, 3, 52);
        for (let x = 0; x < BW; x += 46) { f.fillStyle = '#8c8f93'; f.fillRect(x + 6, 182, 30, 4); f.fillStyle = '#1b1b1b'; f.fillRect(x + 12, 172, 8, 8); f.fillRect(x + 22, 172, 8, 8); }
        f.fillStyle = '#76b900'; f.fillRect(0, 146, BW, 4);
      }
      for (let x = 0; x < BW; x += 70) { n.fillStyle = voy ? '#9b6a3e' : '#e6e1d6'; n.fillRect(x, 192, 50, 12); circle(n, x + 25, 190, 10, '#3f9a32'); }
      n.fillStyle = voy ? '#b07946' : '#d5c9b1'; n.fillRect(0, 204, BW, 200);
    }
    return { sky, far, near };
  },
  art() {
    return {
      desk: [desk()], plantWall: [plantWall()], ficus: [ficus()], triArt: [triArt()], lounge: [lounge()],
      skyBeam: [skyBeam()], trellis: [trellis()], oak: [oak(0), oak(1)], bench: [bench()], terrace: [terrace()],
      hqSign: [hqSign('ENDEAVOR'), hqSign('VOYAGER')],
    };
  },
  obstacles: { desk: 'desk with monitors', plantWall: 'living plant wall', ficus: 'indoor tree', triArt: 'triangle sculpture', lounge: 'lounge sofa', oak: 'oak tree', bench: 'park bench', terrace: 'terrace of the Mountain', hqSign: 'building sign' },
  layout(T) {
    route(T, ['Endeavor lobby', 'Endeavor open office', 'Skylight hall', 'The Park', 'Solar trellis walk', 'The Mountain',
      'Voyager basecamp', 'The Valley', 'Garden return', 'Back to Endeavor'],
    ['endeavor', 'endeavor', 'endeavor', 'park', 'park', 'voyager', 'voyager', 'voyager', 'park', 'endeavor']);
  },
  decorate(T) {
    for (let n = 6; n < T.N - 2; n++) {
      const zone = T.zoneAt(n), sec = T.secAt(n), sd = () => (T.rng() < 0.5 ? -1 : 1);
      if (n === sec.start && (sec.name === 'The Park' || sec.name === 'The Mountain')) T.add(n + 4, 'hqSign', 2.1, 1800, { frame: sec.name === 'The Park' ? 0 : 1 });
      if (zone === 'park') {
        if (n % 22 === 0) T.add(n, 'trellis', 0, 6200, { collide: false });
        if (n % 5 === 0) T.add(n, 'oak', sd() * (1.7 + T.rng() * 2), 1500, { frame: n % 2 });
        if (n % 23 === 0 && !T.inAds(n)) T.add(n, 'bench', sd() * 1.35, 700);
      } else {
        if (n % 48 === 0) T.add(n, 'skyBeam', 0, 5600, { collide: false });
        if (T.inAds(n)) continue;
        if (sec.name === 'The Mountain' && n % 6 === 0) { T.add(n, 'terrace', -1.6, 1700); T.add(n, 'terrace', 1.6, 1700); continue; }
        if (n % 5 === 0) T.add(n, zone === 'voyager' && n % 10 === 0 ? 'plantWall' : (n % 15 ? 'desk' : 'lounge'), sd() * (1.55 + T.rng() * 0.6), 1050);
        if (n % 13 === 0) T.add(n, 'ficus', sd() * 1.35, 800);
        if (n % 61 === 0) T.add(n, 'triArt', sd() * 2.4, 1100);
      }
    }
  },
};

// =====================================================================================================
// TRACK 3 · CORAL REEF (underwater, with OpenClaw lobsters)
// =====================================================================================================
function lobster(g, cx, cy, s, frame) {           // cartoon red lobster, front view
  const red = '#e8322b', dark = '#b5221c', light = '#ff6b5e', open = frame ? 0.5 : 0.15;
  g.strokeStyle = dark; g.lineWidth = 1.6 * s;                                       // antennae
  [-1, 1].forEach(d => { g.beginPath(); g.moveTo(cx + d * 4 * s, cy - 20 * s); g.quadraticCurveTo(cx + d * 22 * s, cy - 52 * s, cx + d * 40 * s, cy - 42 * s); g.stroke(); });
  g.lineWidth = 2 * s;                                                               // legs
  [-1, 1].forEach(d => { for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(cx + d * 10 * s, cy + (i * 6 - 2) * s); g.lineTo(cx + d * 20 * s, cy + (i * 7 + 6) * s); g.stroke(); } });
  [-1, 1].forEach(d => {                                                             // arms + claws
    g.strokeStyle = red; g.lineWidth = 5 * s; g.beginPath(); g.moveTo(cx + d * 10 * s, cy - 8 * s); g.lineTo(cx + d * 24 * s, cy - 18 * s); g.stroke();
    g.save(); g.translate(cx + d * 30 * s, cy - 26 * s); g.rotate(d * 0.5);
    ellipse(g, 0, -open * 6 * s, 7 * s, 11 * s, red, -d * open); ellipse(g, d * 6 * s, open * 4 * s, 5 * s, 9 * s, dark, d * open);
    ellipse(g, -d * 2 * s, -open * 8 * s, 2.5 * s, 4 * s, light);
    g.restore();
  });
  for (let i = 0; i < 4; i++) ellipse(g, cx, cy + (12 + i * 7) * s, (12 - i * 2) * s, 5 * s, i % 2 ? dark : red);   // tail
  poly(g, [[cx - 12 * s, cy + 40 * s], [cx, cy + 34 * s], [cx + 12 * s, cy + 40 * s], [cx, cy + 46 * s]], dark);
  ellipse(g, cx, cy - 4 * s, 13 * s, 18 * s, red); ellipse(g, cx - 4 * s, cy - 10 * s, 4 * s, 7 * s, light);       // carapace
  [-1, 1].forEach(d => { g.strokeStyle = dark; g.lineWidth = 2 * s; g.beginPath(); g.moveTo(cx + d * 3 * s, cy - 18 * s); g.lineTo(cx + d * 6 * s, cy - 25 * s); g.stroke(); circle(g, cx + d * 6 * s, cy - 26 * s, 3 * s, '#111'); circle(g, cx + d * 6.8 * s, cy - 27 * s, 1 * s, '#fff'); });
}
function brain() {
  const cv = mk(150, 110), g = cv.getContext('2d');
  ellipse(g, 75, 92, 70, 16, '#6b6f7a');
  ellipse(g, 75, 62, 64, 44, '#e9a15f'); ellipse(g, 60, 48, 34, 20, '#f3b878');
  g.strokeStyle = '#b86f30'; g.lineWidth = 2.5;
  for (let i = 0; i < 6; i++) { g.beginPath(); for (let x = 20; x < 130; x += 4) g.lineTo(x, 34 + i * 10 + Math.sin(x / 7 + i) * 4); g.stroke(); }
  return cv;
}
function staghorn(col) {
  const cv = mk(170, 170), g = cv.getContext('2d'), rng = mulberry32(col.length * 7);
  g.strokeStyle = col; g.lineCap = 'round';
  const branch = (x, y, a, len, w) => {
    if (len < 8) { circle(g, x, y, w * 0.8, shade(col, 40)); return; }
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    branch(x2, y2, a - 0.45 - rng() * 0.2, len * 0.72, w * 0.75); branch(x2, y2, a + 0.45 + rng() * 0.2, len * 0.72, w * 0.75);
  };
  [-0.5, 0, 0.5].forEach(o => branch(85, 165, -Math.PI / 2 + o, 46, 11));
  return cv;
}
function seaFan() {
  const cv = mk(170, 190), g = cv.getContext('2d'), rng = mulberry32(77);
  g.strokeStyle = '#b04ad8'; g.lineCap = 'round';
  const fan = (x, y, a, len, w, d) => {
    if (d > 6) return;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    fan(x2, y2, a - 0.35 - rng() * 0.2, len * 0.8, w * 0.75, d + 1); fan(x2, y2, a + 0.35 + rng() * 0.2, len * 0.8, w * 0.75, d + 1);
  };
  fan(85, 188, -Math.PI / 2, 40, 7, 0);
  g.strokeStyle = 'rgba(220,140,255,.35)'; g.lineWidth = 1;
  for (let y = 30; y < 170; y += 8) { g.beginPath(); g.moveTo(20, y); g.lineTo(150, y + 4); g.stroke(); }
  return cv;
}
function tubes() {
  const cv = mk(130, 160), g = cv.getContext('2d');
  [[30, 80, '#ffd23f'], [55, 40, '#b04ad8'], [80, 64, '#ffd23f'], [100, 96, '#ff7b7b']].forEach(([x, top, c]) => {
    g.fillStyle = c; rr(g, x - 12, top, 24, 160 - top, 10); g.fill();
    ellipse(g, x, top + 4, 10, 5, shade(c, -70));
  });
  return cv;
}
function anemone(frame) {
  const cv = mk(140, 120), g = cv.getContext('2d');
  ellipse(g, 70, 104, 46, 12, '#7a4a8a');
  g.strokeStyle = '#ff8fd0'; g.lineCap = 'round'; g.lineWidth = 6;
  for (let i = 0; i < 14; i++) {
    const x = 26 + i * 6.6, sway = Math.sin(i + frame * 1.6) * 10;
    g.beginPath(); g.moveTo(x, 100); g.quadraticCurveTo(x + sway, 70, x + sway * 1.6, 44 + Math.abs(i - 7) * 3); g.stroke();
  }
  const fx = 70 + (frame ? 8 : -8);
  ellipse(g, fx, 62, 16, 9, '#ff7a00'); g.fillStyle = '#fff'; g.fillRect(fx - 6, 54, 4, 16); g.fillRect(fx + 4, 55, 4, 14);
  poly(g, [[fx + 14, 62], [fx + 24, 54], [fx + 24, 70]], '#ff7a00'); circle(g, fx - 10, 60, 2, '#111');
  return cv;
}
function kelp(frame) {
  const cv = mk(70, 270), g = cv.getContext('2d');
  [[20, '#3f8f2a'], [38, '#5aa83c'], [54, '#2f6f22']].forEach(([x, c], k) => {
    g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.moveTo(x, 270);
    for (let y = 270; y > 10; y -= 10) g.lineTo(x + Math.sin(y / 30 + frame * 0.8 + k) * 9, y);
    g.stroke();
    for (let y = 250; y > 30; y -= 26) ellipse(g, x + Math.sin(y / 30 + frame * 0.8 + k) * 9 + 8, y, 9, 4, c, 0.5);
  });
  return cv;
}
function boulder() {
  const cv = mk(160, 120), g = cv.getContext('2d');
  ellipse(g, 80, 74, 72, 44, '#5b6b78'); ellipse(g, 62, 58, 36, 18, '#7a8a96');
  circle(g, 120, 46, 10, '#ff8a5c'); circle(g, 40, 40, 8, '#b04ad8'); circle(g, 100, 30, 7, '#ffd23f');
  return cv;
}
function lobsterRock(frame) {
  const cv = mk(190, 190), g = cv.getContext('2d');
  ellipse(g, 95, 150, 88, 38, '#5b6b78'); ellipse(g, 70, 136, 44, 18, '#7a8a96');
  circle(g, 30, 140, 12, '#ff8a5c'); circle(g, 165, 136, 10, '#b04ad8');
  lobster(g, 95, 96, 1.25, frame);
  return cv;
}
function swimLobster(frame) { const cv = mk(120, 110), g = cv.getContext('2d'); lobster(g, 60, 60, 1, frame); return cv; }
function fishSchool(frame) {
  const cv = mk(170, 80), g = cv.getContext('2d'), rng = mulberry32(5);
  for (let i = 0; i < 14; i++) {
    const x = 14 + rng() * 140, y = 10 + rng() * 60, wag = frame ? 3 : -3;
    ellipse(g, x, y, 8, 4, i % 3 ? '#ffd23f' : '#38b6ff');
    poly(g, [[x + 7, y], [x + 13, y - 4 + wag], [x + 13, y + 4 + wag]], i % 3 ? '#ffb000' : '#1f8ad0');
    circle(g, x - 4, y - 1, 1.2, '#111');
  }
  return cv;
}
function arch() {
  const cv = mk(640, 260), g = cv.getContext('2d');
  g.fillStyle = '#4f5f6b';
  g.beginPath(); g.moveTo(0, 260); g.lineTo(0, 40); g.quadraticCurveTo(320, -60, 640, 40); g.lineTo(640, 260); g.lineTo(600, 260); g.lineTo(600, 70); g.quadraticCurveTo(320, -6, 40, 70); g.lineTo(40, 260); g.closePath(); g.fill();
  g.fillStyle = '#6b7c88'; g.beginPath(); g.moveTo(40, 70); g.quadraticCurveTo(320, -6, 600, 70); g.lineTo(600, 60); g.quadraticCurveTo(320, -16, 40, 60); g.fill();
  const rng = mulberry32(3);
  for (let i = 0; i < 40; i++) { const t = rng(), x = 20 + t * 600, y = 50 - Math.sin(t * Math.PI) * 50 + rng() * 14; circle(g, x, y, 4 + rng() * 6, ['#ff8a5c', '#b04ad8', '#ffd23f', '#ff7b7b', '#76b900'][Math.floor(rng() * 5)]); }
  return cv;
}
const reefState = { bubbles: [] };
const reef = {
  id: 'coral-reef', name: 'Coral Reef', sub: 'Underwater · OpenClaw lobsters', seed: 3303,
  offroad: 'Off the sand track, kicking up a cloud on the seabed!',
  zones: {
    reef: { road: ['#ecdcaa', '#e4d29c'], ground: ['#cdb985', '#c4af7a'], rumble: ['#ff7b7b', '#ffe3cf'], lane: null, fog: '#1b8db0' },
    kelp: { road: ['#d8c99c', '#cfbf91'], ground: ['#4f7d3a', '#467133'], rumble: ['#c6ff7a', '#5a8f2a'], lane: null, fog: '#13695f' },
    deep: { road: ['#bfae86', '#b5a47b'], ground: ['#2a5a74', '#24506a'], rumble: ['#ff9e4a', '#ffd9a8'], lane: null, fog: '#0a3552' },
  },
  bg(zone) {
    const [sky, s] = bg(), [far, f] = bg(), [near, n] = bg(), rng = mulberry32(zone.length * 31);
    const water = zone === 'deep' ? [[0, '#2a8fbf'], [1, '#04223a']] : zone === 'kelp' ? [[0, '#86e8cf'], [1, '#0f6a64']] : [[0, '#9aeaff'], [1, '#1786b8']];
    s.fillStyle = vgrad(s, 0, 210, water); s.fillRect(0, 0, BW, BH);
    s.strokeStyle = 'rgba(255,255,255,.45)'; s.lineWidth = 2;                                 // the surface, seen from below
    for (let r = 0; r < 3; r++) { s.beginPath(); for (let x = 0; x <= BW; x += 10) s.lineTo(x, 6 + r * 9 + Math.sin(x / 40 + r) * 3); s.stroke(); }
    for (let i = 0; i < (zone === 'deep' ? 4 : 9); i++) {                                     // light rays
      const x = rng() * BW, w = 30 + rng() * 50;
      s.fillStyle = `rgba(255,255,255,${zone === 'deep' ? 0.05 : 0.1})`; poly(s, [[x, 0], [x + w, 0], [x + w * 2.4 + 60, 200], [x + 60, 200]], s.fillStyle);
    }
    for (let i = 0; i < 12; i++) { const x = rng() * BW, y = 60 + rng() * 100; ellipse(s, x, y, 6, 2.5, 'rgba(0,40,60,.35)'); }
    if (zone === 'kelp') {
      for (let x = 0; x < BW; x += 26) { f.strokeStyle = '#0c4a3a'; f.lineWidth = 6; f.beginPath(); f.moveTo(x, 202); for (let y = 202; y > 40 + (x % 70); y -= 12) f.lineTo(x + Math.sin(y / 25) * 6, y); f.stroke(); }
    } else if (zone === 'deep') {
      f.fillStyle = '#06293f'; f.beginPath(); f.moveTo(0, 202); for (let x = 0; x <= BW; x += 40) f.lineTo(x, 110 + Math.sin(x / 90) * 30 + rng() * 10); f.lineTo(BW, 202); f.fill();
    } else {
      f.fillStyle = '#0f5e7a'; f.beginPath(); f.moveTo(0, 202); for (let x = 0; x <= BW; x += 20) f.lineTo(x, 176 + Math.sin(x / 60) * 10 - Math.abs(Math.sin(x / 23)) * 8); f.lineTo(BW, 202); f.fill();
    }
    f.fillStyle = reef.zones[zone].ground[1]; f.fillRect(0, 202, BW, 200);
    const cols = zone === 'deep' ? ['#3b4a63', '#2c3a52'] : ['#ff8a5c', '#b04ad8', '#ffd23f', '#ff7b7b', '#3fb87a'];
    for (let x = 0; x < BW; x += 22) {
      const c = cols[Math.floor(rng() * cols.length)], h = 8 + rng() * 14;
      if (rng() > 0.5) { ellipse(n, x, 202 - h / 2, 10, h / 2, c); } else { n.strokeStyle = c; n.lineWidth = 4; n.beginPath(); n.moveTo(x, 204); n.lineTo(x - 5, 204 - h); n.moveTo(x, 204); n.lineTo(x + 6, 204 - h * 0.8); n.stroke(); }
    }
    n.fillStyle = reef.zones[zone].ground[0]; n.fillRect(0, 204, BW, 200);
    return { sky, far, near };
  },
  art() {
    return {
      brain: [brain()], staghorn: [staghorn('#ff8a5c'), staghorn('#b04ad8')], fan: [seaFan()], tube: [tubes()],
      anemone: [anemone(0), anemone(1)], kelp: [0, 1, 2, 3].map(kelp), rock: [boulder()],
      lobsterRock: [lobsterRock(0), lobsterRock(1)], lobster: [swimLobster(0), swimLobster(1)],
      fish: [fishSchool(0), fishSchool(1)], arch: [arch()],
    };
  },
  obstacles: { brain: 'brain coral', staghorn: 'staghorn coral', fan: 'sea fan', tube: 'tube sponge', anemone: 'anemone', rock: 'boulder', lobsterRock: 'Lobster Rock, home of an OpenClaw lobster', kelp: 'kelp' },
  layout(T) {
    route(T, ['Lagoon start', 'Staghorn alley', 'Sea-fan forest', 'Lobster Rock', 'Kelp tunnel', 'Coral ridge',
      'The Drop-off', 'Anemone garden', 'Coral arch', 'Back to the lagoon'],
    ['reef', 'reef', 'reef', 'reef', 'kelp', 'reef', 'deep', 'reef', 'reef', 'reef']);
  },
  decorate(T) {
    const coral = ['brain', 'staghorn', 'fan', 'tube', 'anemone', 'rock'];
    for (let n = 6; n < T.N - 2; n++) {
      const zone = T.zoneAt(n), sec = T.secAt(n), sd = () => (T.rng() < 0.5 ? -1 : 1);
      if (sec.name === 'Coral arch' && (n - sec.start) % 40 === 5) T.add(n, 'arch', 0, 5800, { collide: false });
      if (n % 27 === 0) T.add(n, 'lobster', sd() * 1.2, 650, { collide: false, wy: 650, swim: { amp: 1.3, sp: 0.6 + T.rng() * 0.6 }, anim: true, rate: 3 });
      if (n % 41 === 0) T.add(n, 'fish', sd() * 1.5, 1300, { collide: false, wy: 900, swim: { amp: 1.8, sp: 0.4 }, anim: true, rate: 4 });
      if (T.inAds(n)) continue;
      if (zone === 'kelp') { if (n % 2 === 0) T.add(n, 'kelp', sd() * (1.35 + T.rng() * 1.8), 650, { anim: true, rate: 2, collide: false }); continue; }
      const lobsterSpot = sec.name === 'Lobster Rock' ? n % 8 === 0 : n % 45 === 0;
      if (lobsterSpot) { T.add(n, 'lobsterRock', sd() * 1.75, 1400, { anim: true, rate: 2 }); continue; }
      if (n % 4 === 0) {
        const k = coral[Math.floor(T.rng() * coral.length)];
        T.add(n, k, sd() * (1.45 + T.rng() * 1.9), k === 'fan' ? 1200 : 1000, { frame: k === 'staghorn' ? n % 2 : 0, anim: k === 'anemone', rate: 2 });
      }
    }
  },
  // per-frame underwater feel: blue tint, drifting light and rising bubbles
  overlay(ctx, t, W, H, zone) {
    ctx.fillStyle = zone === 'deep' ? 'rgba(0,30,60,.22)' : 'rgba(0,90,140,.10)'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const x = ((t * 18 + i * 230) % (W + 200)) - 100;
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 50, 0); ctx.lineTo(x + 130, H); ctx.lineTo(x + 70, H); ctx.fill();
    }
    const B = reefState.bubbles;
    while (B.length < 26) B.push({ x: Math.random() * W, y: H + Math.random() * H, r: 1 + Math.random() * 2.5, v: 20 + Math.random() * 30 });
    ctx.strokeStyle = 'rgba(220,250,255,.7)'; ctx.lineWidth = 1;
    for (const b of B) {
      b.y -= b.v / 60; b.x += Math.sin(t * 2 + b.r * 9) * 0.3;
      if (b.y < -5) { b.y = H + 5; b.x = Math.random() * W; }
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
    }
  },
};

R.TRACKS = [factory, hq, reef];
R.trackById = id => R.TRACKS.find(t => t.id === id) || R.TRACKS[0];
})();
