/* Shared helpers: math, colour, canvas drawing. Everything hangs off window.RACE. */
'use strict';
(function () {
const R = window.RACE = window.RACE || {};

R.W = 640; R.H = 360;                       // internal render resolution (scaled 2x, pixelated)

R.U = {
  lerp: (a, b, p) => a + (b - a) * p,
  easeIn: (a, b, p) => a + (b - a) * p * p,
  easeInOut: (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5),
  pctRem: (n, total) => (n % total) / total,
  limit: (v, mn, mx) => Math.max(mn, Math.min(v, mx)),
  overlap: (x1, w1, x2, w2, pct = 1) => {
    const h = pct / 2;
    return !((x1 + w1 * h) < (x2 - w2 * h) || (x1 - w1 * h) > (x2 + w2 * h));
  },
  fog: (d, density) => 1 / Math.pow(Math.E, d * d * density),
};
R.increase = (start, inc, max) => { let r = start + inc; while (r >= max) r -= max; while (r < 0) r += max; return r; };
R.mulberry32 = a => function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
R.shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

R.hexRgb = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) || 0); };
R.shade = (h, amt) => { const [r, g, b] = R.hexRgb(h).map(v => R.U.limit(v + amt, 0, 255)); return `rgb(${r},${g},${b})`; };
R.lum = h => { const [r, g, b] = R.hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
R.contrast = h => R.lum(h) > 0.6 ? '#111111' : '#ffffff';
R.fmtTime = t => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
R.ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; };
R.esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ---- canvas
R.mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
R.rr = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
R.poly = (g, pts, fill) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fillStyle = fill; g.fill(); };
R.circle = (g, x, y, r, fill) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
R.ellipse = (g, x, y, rx, ry, fill, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
R.FONT = s => `900 ${s}px "Arial Black", "Arial", sans-serif`;
R.fitText = (g, text, cx, cy, maxW, maxH, color, font = R.FONT) => {
  let s = Math.floor(maxH); g.font = font(s);
  while (s > 5 && g.measureText(text).width > maxW) { s--; g.font = font(s); }
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cx, cy + 1);
};
R.drawLogoFit = (g, img, x, y, w, h) => {
  const s = Math.min(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
};
// Repeat-friendly horizontal panorama helper: draw fn(g, x) at several x so the image tiles seamlessly.
R.tileX = (w, step, fn) => { for (let x = -step; x < w + step; x += step) fn(x); };
})();
