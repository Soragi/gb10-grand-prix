/* Kart art (custom racers) and shared sprites: GPU collectible, trackside ads, start gantry. */
'use strict';
(function () {
const R = window.RACE;
const { mk, rr, poly, circle, ellipse, fitText, shade, lum, contrast, FONT } = R;

// ------------------------------------------------------------------ RACER MODEL
R.PALETTE = ['#76b900', '#00a3e0', '#1f4e9c', '#7b2cbf', '#e5007e', '#e4002b',
             '#ff6a00', '#ffcc00', '#00a19a', '#ffffff', '#9aa0a6', '#111111'];
R.WHEELS = [
  { id: 'classic', name: 'Classic' },
  { id: 'chrome', name: 'Chrome' },
  { id: 'neon', name: 'Neon' },
  { id: 'gold', name: 'Gold' },
  { id: 'monster', name: 'Monster' },
];
// Computer rivals (not selectable) fill the grid. Named after GPU architectures.
R.RIVALS = [
  ['HOPPER', '#1f4e9c', '#ffffff', 'chrome'], ['BLACKWELL', '#111111', '#76b900', 'neon'],
  ['GRACE', '#7b2cbf', '#ffcc00', 'gold'], ['AMPERE', '#ffcc00', '#111111', 'classic'],
  ['RUBIN', '#e4002b', '#ffffff', 'chrome'], ['VERA', '#e5007e', '#00a3e0', 'neon'],
  ['TURING', '#00a19a', '#ffffff', 'monster'], ['VOLTA', '#ff6a00', '#1f4e9c', 'gold'],
].map(([name, car, suit, wheels]) => ({ id: 'ai-' + name.toLowerCase(), name, car, suit, wheels, ai: true }));

const HEX = /^#[0-9a-f]{6}$/i;
R.normalizeRacer = r => ({
  id: String(r.id || ''),
  name: String(r.name || 'RACER').toUpperCase().slice(0, 12),
  car: HEX.test(r.car) ? r.car : '#76b900',
  suit: HEX.test(r.suit) ? r.suit : '#ffffff',
  wheels: R.WHEELS.some(w => w.id === r.wheels) ? r.wheels : 'classic',
  ai: !!r.ai,
});

// ------------------------------------------------------------------ WHEELS
const RIM = { classic: '#9a9a9a', chrome: '#eef2f5', neon: '#111111', gold: '#d4a017', monster: '#8a8a8a' };

function wheelRear(g, x, y, w, h, style) {
  g.fillStyle = '#141414'; rr(g, x, y, w, h, 6); g.fill();
  if (style === 'monster') {                                     // chunky blocks
    g.fillStyle = '#2e2e2e';
    for (let i = y + 3; i < y + h - 4; i += 8) { g.fillRect(x + 2, i, w / 2 - 3, 5); g.fillRect(x + w / 2 + 1, i + 4, w / 2 - 3, 5); }
  } else {
    g.fillStyle = '#2e2e2e'; for (let i = y + 4; i < y + h - 3; i += 6) g.fillRect(x + 3, i, w - 6, 2);
  }
  // the rim shows as a band on the inside face
  g.fillStyle = RIM[style]; rr(g, x + w * 0.32, y + h * 0.18, w * 0.36, h * 0.64, 3); g.fill();
  if (style === 'chrome') { g.fillStyle = '#fff'; g.fillRect(x + w * 0.36, y + h * 0.22, 2, h * 0.5); }
  if (style === 'neon') {
    g.save(); g.shadowColor = '#9dff3a'; g.shadowBlur = 8; g.strokeStyle = '#9dff3a'; g.lineWidth = 2;
    rr(g, x + 1, y + 1, w - 2, h - 2, 6); g.stroke(); g.restore();
    g.fillStyle = '#9dff3a'; g.fillRect(x + w * 0.45, y + h * 0.22, 2, h * 0.56);
  }
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x + 3, y + 2, 3, h - 4);
}

function wheelSide(g, x, y, r, style, car) {
  if (style === 'monster') {
    r *= 1.2;
    g.fillStyle = '#141414';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) { g.save(); g.translate(x, y); g.rotate(a); g.fillRect(r - 3, -3, 5, 6); g.restore(); }
  }
  circle(g, x, y, r, '#141414');
  const rim = RIM[style];
  if (style === 'neon') {
    g.save(); g.shadowColor = '#9dff3a'; g.shadowBlur = 10;
    g.strokeStyle = '#9dff3a'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r * 0.62, 0, Math.PI * 2); g.stroke(); g.restore();
    circle(g, x, y, r * 0.5, '#111'); circle(g, x, y, r * 0.18, '#9dff3a');
    return;
  }
  circle(g, x, y, r * 0.6, rim);
  const spokes = style === 'chrome' ? 8 : 5;
  g.strokeStyle = style === 'gold' ? '#7a5a00' : style === 'chrome' ? '#9aa3aa' : '#555'; g.lineWidth = style === 'chrome' ? 1.5 : 2.5;
  for (let i = 0; i < spokes; i++) {
    const a = i * Math.PI * 2 / spokes;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * 0.56, y + Math.sin(a) * r * 0.56); g.stroke();
  }
  circle(g, x, y, r * 0.2, car);
  if (style === 'chrome') { g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(x - r * 0.4, y - r * 0.45, r * 0.25, 2); }
}

// ------------------------------------------------------------------ KARTS
function namePlate(g, r, x, y, w, h) {
  g.fillStyle = '#ffffff'; rr(g, x, y, w, h, Math.min(4, h / 4)); g.fill();
  fitText(g, r.name, x + w / 2, y + h / 2, w - 8, h - 5, lum(r.car) > 0.6 ? '#111' : r.car);
}

function drawKartRear(r, steer) {
  const cv = mk(160, 124), g = cv.getContext('2d'), d = steer * 4, big = r.wheels === 'monster';
  ellipse(g, 80, 117, 74, 7, 'rgba(0,0,0,0.38)');
  wheelRear(g, 26 + d, 56, 20, 22, r.wheels); wheelRear(g, 114 + d, 56, 20, 22, r.wheels);
  g.fillStyle = '#2b2b2b'; g.fillRect(30, 90, 100, 7);
  poly(g, [[34, 58], [126, 58], [134, 90], [26, 90]], shade(r.car, -45));
  poly(g, [[42, 56], [118, 56], [124, 84], [36, 84]], r.car);
  g.fillStyle = shade(r.car, 50); g.fillRect(46, 58, 68, 3);
  g.fillStyle = '#1e1e1e'; rr(g, 54, 36, 52, 26, 6); g.fill();
  // driver in the racer colour, name on the back of the suit
  g.fillStyle = shade(r.suit, -40); rr(g, 44 + d, 34, 16, 12, 5); g.fill(); rr(g, 100 + d, 34, 16, 12, 5); g.fill();
  g.fillStyle = r.suit; rr(g, 52 + d, 28, 56, 34, 11); g.fill();
  g.strokeStyle = shade(r.suit, -70); g.lineWidth = 2; rr(g, 52 + d, 28, 56, 34, 11); g.stroke();
  fitText(g, r.name, 80 + d, 45, 48, 12, contrast(r.suit));
  const hx = 80 + d * 1.6;
  circle(g, hx, 19, 17, r.suit);
  g.save(); g.beginPath(); g.arc(hx, 19, 17, 0, Math.PI * 2); g.clip(); g.fillStyle = r.car; g.fillRect(hx - 4, 0, 8, 40); g.restore();
  g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(hx - 11, 8, 5, 5);
  g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(hx, 19, 17, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#555'; g.fillRect(58, 64, 44, 12);
  g.fillStyle = '#777'; for (let i = 0; i < 4; i++) g.fillRect(61 + i * 10, 66, 6, 8);
  circle(g, 64, 78, 5, '#999'); circle(g, 64, 78, 3, '#111'); circle(g, 96, 78, 5, '#999'); circle(g, 96, 78, 3, '#111');
  if (big) { wheelRear(g, 0, 64, 38, 52, 'monster'); wheelRear(g, 122, 64, 38, 52, 'monster'); }
  else { wheelRear(g, 3, 70, 34, 44, r.wheels); wheelRear(g, 123, 70, 34, 44, r.wheels); }
  g.fillStyle = '#000'; rr(g, 28, 81, 104, 26, 5); g.fill();
  namePlate(g, r, 30, 83, 100, 22);
  g.fillStyle = '#ff2a2a'; g.fillRect(31, 98, 7, 6); g.fillRect(122, 98, 7, 6);
  return cv;
}

function drawKartSide(r) {
  const cv = mk(220, 130), g = cv.getContext('2d');
  ellipse(g, 112, 124, 98, 6, 'rgba(0,0,0,0.35)');
  g.fillStyle = '#666'; g.fillRect(4, 76, 22, 7); circle(g, 6, 79, 5, '#999'); circle(g, 6, 79, 3, '#111');
  poly(g, [[18, 102], [22, 72], [70, 66], [122, 76], [186, 80], [210, 92], [204, 106], [28, 108]], r.car);
  poly(g, [[22, 100], [204, 100], [204, 106], [28, 108]], shade(r.car, -50));
  g.fillStyle = shade(r.car, 60); g.fillRect(70, 68, 50, 3);
  g.fillStyle = '#000'; rr(g, 60, 80, 124, 20, 5); g.fill();
  namePlate(g, r, 62, 82, 120, 16);
  g.fillStyle = '#1e1e1e'; rr(g, 58, 40, 16, 34, 5); g.fill();
  g.fillStyle = r.suit; rr(g, 70, 40, 34, 32, 10); g.fill();
  g.strokeStyle = shade(r.suit, -70); g.lineWidth = 2; rr(g, 70, 40, 34, 32, 10); g.stroke();
  g.strokeStyle = '#333'; g.lineWidth = 4; g.beginPath(); g.moveTo(140, 76); g.lineTo(130, 50); g.stroke();
  g.strokeStyle = shade(r.suit, -30); g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(96, 50); g.lineTo(128, 52); g.stroke();
  g.strokeStyle = '#222'; g.lineWidth = 4; g.beginPath(); g.ellipse(130, 50, 3, 9, 0.3, 0, Math.PI * 2); g.stroke();
  circle(g, 90, 26, 17, r.suit);
  g.save(); g.beginPath(); g.arc(90, 26, 17, 0, Math.PI * 2); g.clip();
  g.fillStyle = r.car; g.fillRect(72, 18, 40, 6);
  g.fillStyle = '#111'; g.fillRect(96, 20, 16, 12); g.fillStyle = 'rgba(120,200,255,.6)'; g.fillRect(98, 22, 10, 4);
  g.restore();
  g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(90, 26, 17, 0, Math.PI * 2); g.stroke();
  wheelSide(g, 48, 104, 22, r.wheels, r.car); wheelSide(g, 176, 108, 18, r.wheels, r.car);
  return cv;
}

const kartCache = new Map();
const keyOf = r => `${r.name}|${r.car}|${r.suit}|${r.wheels}`;
function entry(r) {
  const k = keyOf(r);
  let e = kartCache.get(k);
  if (!e) { e = { rear: null, side: null }; kartCache.set(k, e); if (kartCache.size > 300) kartCache.delete(kartCache.keys().next().value); }
  return e;
}
R.kartRear = (r, frame) => { const e = entry(r); if (!e.rear) e.rear = [-1, 0, 1].map(s => drawKartRear(r, s)); return e.rear[frame]; };
R.kartSide = r => { const e = entry(r); if (!e.side) e.side = drawKartSide(r); return e.side; };
R.wheelSwatch = (style, car) => { const cv = mk(44, 44), g = cv.getContext('2d'); wheelSide(g, 22, 22, style === 'monster' ? 15 : 18, style, car); return cv; };

// ------------------------------------------------------------------ SHARED SPRITES
R.drawGPU = frame => {
  const cv = mk(128, 80), g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 40, 6, 64, 40, 64);
  grd.addColorStop(0, 'rgba(150,255,60,.55)'); grd.addColorStop(1, 'rgba(118,185,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 80);
  g.fillStyle = '#c8c8c8'; g.fillRect(8, 16, 6, 46);
  g.fillStyle = '#d4a017'; g.fillRect(40, 60, 50, 5);
  g.fillStyle = '#1b1b1b'; rr(g, 12, 18, 106, 42, 5); g.fill();
  g.fillStyle = '#76b900'; g.fillRect(12, 18, 106, 5);
  poly(g, [[60, 23], [70, 23], [58, 60], [48, 60]], '#2c2c2c');
  [[38, 41], [92, 41]].forEach(([x, y]) => {
    circle(g, x, y, 15, '#76b900'); circle(g, x, y, 13, '#333');
    for (let b = 0; b < 6; b++) {
      const a = frame * Math.PI / 12 + b * Math.PI / 3;
      g.save(); g.translate(x, y); g.rotate(a); poly(g, [[0, 0], [12, -4], [12, 4]], '#111'); g.restore();
    }
    circle(g, x, y, 4, '#76b900');
  });
  g.font = FONT(7); g.fillStyle = '#76b900'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GPU', 65, 56);
  g.strokeStyle = '#000'; g.lineWidth = 2; rr(g, 12, 18, 106, 42, 5); g.stroke();
  return cv;
};

// F1-style trackside advertising board (race branding)
const BOARDS = [
  ['#000000', 'GB10 GRAND PRIX', '#76b900'],
  ['#76b900', 'DGX SPARK', '#000000'],
  ['#ffffff', 'POWERED BY THE GB10', '#111111'],
  ['#111111', 'GRAB THE GPUs!', '#ffd23f'],
];
R.drawBarrier = v => {
  const [bg, text, fg] = BOARDS[v % BOARDS.length];
  const cv = mk(300, 60), g = cv.getContext('2d');
  g.fillStyle = '#444'; g.fillRect(20, 44, 8, 16); g.fillRect(272, 44, 8, 16);
  g.fillStyle = '#111'; g.fillRect(0, 0, 300, 48);
  g.fillStyle = bg; g.fillRect(3, 3, 294, 42);
  fitText(g, text, 150, 24, 270, 26, fg);
  return cv;
};
R.drawBillboard = v => {
  const cv = mk(320, 190), g = cv.getContext('2d');
  g.fillStyle = '#5a5a5a'; g.fillRect(60, 120, 12, 70); g.fillRect(248, 120, 12, 70);
  g.fillStyle = '#222'; g.fillRect(0, 0, 320, 126);
  g.fillStyle = '#000'; g.fillRect(6, 6, 308, 114);
  if (v === 0) {
    fitText(g, 'DGX SPARK', 160, 40, 260, 40, '#ffffff'); fitText(g, 'GB10 GRAND PRIX', 160, 82, 280, 26, '#76b900');
    g.fillStyle = '#76b900'; g.fillRect(60, 102, 200, 4);
  } else if (v === 1) {
    fitText(g, 'POWERED BY', 160, 30, 200, 16, '#bbbbbb'); fitText(g, 'THE GB10', 160, 64, 290, 34, '#76b900');
    fitText(g, 'AI COMMENTARY · LIVE ON THE GPU', 160, 100, 280, 13, '#ffffff');
  } else {
    g.fillStyle = '#76b900'; g.fillRect(6, 6, 308, 114);
    fitText(g, 'GRAB THE', 160, 36, 240, 26, '#000'); fitText(g, 'GPUs!', 160, 80, 280, 40, '#000');
  }
  return cv;
};
R.drawStartGantry = () => {
  const cv = mk(640, 210), g = cv.getContext('2d');
  [[0, 34], [606, 34]].forEach(([x, w]) => {
    g.fillStyle = '#ddd'; g.fillRect(x, 30, w, 180);
    g.fillStyle = '#76b900'; for (let y = 36; y < 210; y += 24) g.fillRect(x, y, w, 12);
  });
  g.fillStyle = '#000'; g.fillRect(0, 10, 640, 88);
  g.strokeStyle = '#76b900'; g.lineWidth = 4; g.strokeRect(2, 12, 636, 84);
  fitText(g, 'DGX SPARK GB10 GRAND PRIX', 320, 40, 600, 36, '#76b900');
  fitText(g, 'POWERED BY THE GB10', 320, 78, 360, 16, '#ffffff');
  for (let i = 0; i < 40; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#fff' : '#000'; g.fillRect(i * 16, 98 + j * 8, 16, 8); }
  return cv;
};
})();
