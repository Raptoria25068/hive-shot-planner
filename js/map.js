/* Field map: the base drawing (tiles, zones, HIVE structure), smooth heat layers with contours,
   the interactive overlay (pin, hover, robot, flight path), hover tooltip and legend.
   Field units are inches with the origin at the red, audience-side corner. */
import { run } from "./runner.js";
import { state, savePrefs, lengthOut } from "./state.js";

export const LEVEL_COL = { 3: "#FF2C2C", 2: "#B3162C", 1: "#5C1019" };
export const LEVEL_NAME = ["Can't score", "Possible", "Likely", "Guaranteed"];
const RAMP = ["#1A0B0D", "#45101A", "#80152A", "#C41E3A", "#FF2C2C", "#FF8F6B", "#FFC9AE"];
const DIFF = { up: [255, 44, 44], down: [111, 147, 184] };
const TEAM = { red: "#FF2C2C", blue: "#3D74FF" };
const DOM_COLORS = {
  "Exit speed variation": "#FF2C2C", "Drag / lift model": "#DDC3A2", "Robot position (x)": "#7FA7C9",
  "Robot position (y)": "#4F7FA8", "Hood angle": "#F4A259", "Heading": "#B39DDB", "Flywheel RPM": "#E57373",
  "Release timing": "#80CBC4", "Launch height": "#A1887F", "Ball mass": "#CE93D8", "Ball size": "#90A4AE",
  "Velocity estimate (x)": "#4DB6AC", "Velocity estimate (y)": "#4DB6AC", "Rotation estimate": "#26A69A",
  "Field tolerance (x)": "#8D8D8D", "Field tolerance (y)": "#8D8D8D", "Field tolerance (z)": "#8D8D8D",
};

/* kind: level (discrete levels), scalar (smooth ramp), count, category, diff */
export const LAYERS = [
  { id: "level", label: "Levels", kind: "level" },
  { id: "prob", label: "Hit chance", kind: "scalar", get: c => c.p, fixed: [0, 1], step: 0.1, fmt: v => `${Math.round(v * 100)}%` },
  { id: "hood", label: "Hood", kind: "scalar", get: c => c.a, step: 5, fmt: v => `${v.toFixed(0)}°` },
  { id: "rpm", label: "Flywheel", kind: "scalar", get: c => c.r, step: 250, fmt: v => `${Math.round(v)} rpm` },
  { id: "tof", label: "Flight time", kind: "scalar", get: c => c.t, step: 0.1, fmt: v => `${v.toFixed(2)} s` },
  { id: "ev", label: "Entry speed", kind: "scalar", get: c => c.ev, step: 0.5, fmt: v => `${v.toFixed(1)} m/s`, note: "faster entries bounce more" },
  { id: "wc", label: "Rim margin", kind: "scalar", get: c => c.wc, step: 0.5, fmt: v => `${v.toFixed(1)} in`, note: "room left after errors" },
  { id: "burst", label: "Burst", kind: "count", get: c => c.bk },
  { id: "dom", label: "Biggest error", kind: "category", get: c => c.de },
  { id: "tip", label: "Tip-proof", kind: "level", combine: true },
  { id: "pps", label: "Points / sec", kind: "scalar", derived: true, step: 0.25, fmt: v => `${v.toFixed(2)} pts/s`, note: "estimate: hit chance × burst × tip value ÷ cycle time" },
  { id: "cmp", label: "Compare A/B", kind: "diff" },
];
export const LAYER = Object.fromEntries(LAYERS.map(l => [l.id, l]));

const el = {}, L = { ox: 0, oy: 0, s: 1, px: 1, W: 1, H: 1 };
let GEOM = null, snapA = null, handlers = {};
export const view = { pin: { x: 72, y: 115 }, hover: null, detail: null, flight: 1 };
try { const s = JSON.parse(localStorage.getItem("hive-planner-pin") || "null"); if (s && isFinite(s.x) && isFinite(s.y)) view.pin = s; } catch { /* storage unavailable */ }
const savePin = () => { try { localStorage.setItem("hive-planner-pin", JSON.stringify(view.pin)); } catch { /* storage unavailable */ } };

export function initMap(dom, on) {
  Object.assign(el, dom);
  handlers = on;
  new ResizeObserver(() => { size(); drawAll(); }).observe(el.wrap);
  size();
  bindPointer();
}
export function setGeom(g) { GEOM = g; drawAll(); }

const X = x => L.ox + x * L.s, Y = y => L.oy + (144 - y) * L.s;
function size() {
  const r = el.wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  for (const c of [el.base, el.heat, el.ov]) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const mg = { l: 22, r: 6, t: 6, b: 22 }, S = Math.min(r.width - mg.l - mg.r, r.height - mg.t - mg.b);
  Object.assign(L, { ox: mg.l, oy: mg.t, s: S / 144, px: dpr, W: r.width, H: r.height });
}
let queued = false;
export function drawAll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; drawBase(); drawHeat(); drawOverlay(); renderLegend(); });
}

/* ---------- values per layer ---------- */
const passCell = (key, i, j) => run.current?.passes[key]?.[j]?.[i] ?? null;
const levelOf = c => (c && c.l !== undefined ? c.l : null);
function combinedLevel(i, j, withFlip) {
  const cur = run.current, keys = ["main"];
  if (cur.mixed) keys.push("ball2");
  if (withFlip) { keys.push("flip"); if (cur.mixed) keys.push("ball2flip"); }
  let lv = 3;
  for (const k of keys) {
    if (!cur.passes[k]) return null;
    const l = levelOf(passCell(k, i, j));
    if (l === null) return null;
    lv = Math.min(lv, l);
  }
  return lv;
}
function loadingZone(P) { return P.hive === "blue" ? [138.5, 36] : [5.5, 108]; }
function pps(c, x, y) {
  const P = run.current.P;
  if (!c || c.l < 1) return NaN;
  const lz = loadingZone(P);
  const cycle = P.intakeTime + 2 * Math.hypot(x - lz[0], y - lz[1]) / P.driveSpeed + P.burstN * P.burstGap / 1000;
  return ((c.bk ?? 1) * c.p) * (20 / Math.max(P.ballsToTip, 1)) / Math.max(cycle, 0.1);
}
/* Numeric value of the active layer at grid spot (i, j); NaN where it doesn't apply. */
export function layerValue(layer, i, j) {
  const cur = run.current;
  if (!cur) return NaN;
  if (layer.kind === "level") {
    const lv = combinedLevel(i, j, !!layer.combine);
    return lv === null ? NaN : lv < 0 ? NaN : lv;
  }
  const c = passCell("main", i, j);
  if (!c || c.l < 1) return NaN;
  if (layer.id === "pps") return pps(c, cur.xs[i], cur.ys[j]);
  if (layer.kind === "diff") {
    if (!snapA) return NaN;
    const a = snapA[j]?.[i];
    const pa = a && a.l >= 1 ? a.p : 0;
    return c.p - pa;
  }
  const v = layer.get(c);
  return v === undefined || v === null ? NaN : v;
}
export function cellAt(p) {
  const cur = run.current;
  if (!cur) return null;
  const n = cur.xs.length, step = cur.xs[1] - cur.xs[0];
  const i = Math.round((p.x - cur.xs[0]) / step), j = Math.round((p.y - cur.ys[0]) / step);
  if (i < 0 || j < 0 || i >= n || j >= n) return null;
  return { i, j, c: passCell("main", i, j) };
}

/* ---------- base drawing ---------- */
function drawBase() {
  const ctx = el.base.getContext("2d");
  ctx.setTransform(L.px, 0, 0, L.px, 0, 0);
  ctx.clearRect(0, 0, L.W, L.H);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    ctx.fillStyle = (i + j) % 2 ? "#141011" : "#181314";
    ctx.fillRect(X(i * 24), Y((j + 1) * 24), 24 * L.s + 0.5, 24 * L.s + 0.5);
  }
  ctx.strokeStyle = "rgba(249,246,238,.06)"; ctx.lineWidth = 1; ctx.beginPath();
  for (let k = 1; k < 6; k++) { ctx.moveTo(X(k * 24), Y(0)); ctx.lineTo(X(k * 24), Y(144)); ctx.moveTo(X(0), Y(k * 24)); ctx.lineTo(X(144), Y(k * 24)); }
  ctx.stroke();
  ctx.fillStyle = "rgba(221,195,162,.7)"; ctx.font = '500 10.5px "JetBrains Mono", monospace'; ctx.textAlign = "center"; ctx.textBaseline = "top";
  "ABCDEF".split("").forEach((ch, i) => ctx.fillText(ch, X(i * 24 + 12), Y(0) + 7));
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let j = 0; j < 6; j++) ctx.fillText(String(j + 1), X(0) - 8, Y(j * 24 + 12));
}

function drawStructure(ctx) {
  ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(249,246,238,.55)"; ctx.strokeRect(X(0), Y(144), 144 * L.s, 144 * L.s);
  ctx.lineWidth = 4;
  ctx.strokeStyle = TEAM.red; ctx.beginPath(); ctx.moveTo(X(0) - 4, Y(24)); ctx.lineTo(X(0) - 4, Y(120)); ctx.stroke();
  ctx.strokeStyle = TEAM.blue; ctx.beginPath(); ctx.moveTo(X(144) + 4, Y(24)); ctx.lineTo(X(144) + 4, Y(120)); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = TEAM.red; ctx.strokeRect(X(0), Y(119.5), 11 * L.s, 23 * L.s);
  ctx.strokeStyle = TEAM.blue; ctx.strokeRect(X(133), Y(47.5), 11 * L.s, 23 * L.s);
  ctx.fillStyle = TEAM.red; ctx.fillRect(X(0.5), Y(2), 23 * L.s, 2 * L.s);
  ctx.fillStyle = TEAM.blue; ctx.fillRect(X(120.5), Y(144), 23 * L.s, 2 * L.s);
  for (const [fx, fy] of [[48, 142], [142, 96], [2, 48], [96, 2]]) {
    ctx.beginPath(); ctx.arc(X(fx), Y(fy), 2.4 * L.s, 0, Math.PI * 2);
    ctx.fillStyle = "#DDC3A2"; ctx.fill();
  }
  if (!GEOM) return;
  ctx.lineCap = "round";
  for (const cell of GEOM.cells) {
    const hull = convexHull(cell.inner.concat(cell.outer).map(p => [X(p[0]), Y(p[1])]));
    const col = TEAM[cell.hive];
    ctx.beginPath(); hull.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.globalAlpha = cell.raised ? 0.3 : 0.14; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = cell.target ? 2 : 1.1; ctx.strokeStyle = col; ctx.setLineDash(cell.raised ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = "rgba(249,246,238,.45)"; ctx.lineWidth = 1.5;
  for (const g of GEOM.segs) { ctx.beginPath(); ctx.moveTo(X(g[0]), Y(g[1])); ctx.lineTo(X(g[3]), Y(g[4])); ctx.stroke(); }
  const tc = GEOM.cells.find(c => c.target);
  if (tc) {
    const o = tc.outer, mx = (o[0][0] + o[1][0]) / 2, my = (o[0][1] + o[1][1]) / 2, dy = Math.sign(GEOM.nH[1]) || 1;
    ctx.strokeStyle = "#F9F6EE"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(X(o[0][0]), Y(o[0][1])); ctx.lineTo(X(o[1][0]), Y(o[1][1])); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(mx), Y(my)); ctx.lineTo(X(mx), Y(my + 9 * dy)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X(mx - 2.4), Y(my + 6.5 * dy)); ctx.lineTo(X(mx), Y(my + 9.5 * dy)); ctx.lineTo(X(mx + 2.4), Y(my + 6.5 * dy)); ctx.stroke();
  }
  ctx.lineCap = "butt";
}
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}

/* ---------- heat ---------- */
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const RAMP_RGB = RAMP.map(hexRgb);
function rampRgb(t) {
  t = Math.min(Math.max(t, 0), 1);
  const f = t * (RAMP_RGB.length - 1), i = Math.min(Math.floor(f), RAMP_RGB.length - 2), u = f - i, a = RAMP_RGB[i], b = RAMP_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
export const rampCss = t => { const c = rampRgb(t); return `rgb(${c.map(Math.round).join(",")})`; };
export const RAMP_CSS = RAMP;

let lastRange = null;
export function currentRange() { return lastRange; }

/* Grid of values for the layer; while the map is still filling in, missing spots borrow the
   nearest computed spot within two grid steps so the coarse pass already reads as a map. */
function valueGrid(layer, n) {
  const V = new Float64Array(n * n).fill(NaN), known = new Uint8Array(n * n);
  const cur = run.current, main = cur.passes.main;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!main || !main[j][i]) continue;
    known[j * n + i] = 1;
    V[j * n + i] = layerValue(layer, i, j);
  }
  if (!cur.passDone.main) {
    const F = V.slice();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (known[j * n + i]) continue;
      let best = null, bd = 9;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n || !known[b * n + a]) continue;
        const d = di * di + dj * dj;
        if (d < bd) { bd = d; best = b * n + a; }
      }
      if (best !== null) F[j * n + i] = V[best];
    }
    return F;
  }
  return V;
}

function drawHeat() {
  const ctx = el.heat.getContext("2d");
  ctx.setTransform(L.px, 0, 0, L.px, 0, 0);
  ctx.clearRect(0, 0, L.W, L.H);
  const cur = run.current;
  if (cur && cur.passes.main) {
    const layer = LAYER[state.prefs.layer] || LAYER.level;
    const n = cur.xs.length, step = cur.xs[1] - cur.xs[0];
    const V = valueGrid(layer, n);
    let lo = Infinity, hi = -Infinity;
    for (const v of V) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (layer.fixed) [lo, hi] = layer.fixed;
    if (layer.kind === "diff") { const m = Math.max(Math.abs(lo), Math.abs(hi), 0.05); lo = -m; hi = m; }
    if (layer.kind === "count") { lo = 0; hi = cur.P.burstN; }
    lastRange = isFinite(lo) ? [lo, hi] : null;
    const hidden = new Set(state.prefs.hiddenLevels || []);
    const K = layer.kind === "category" || layer.kind === "count" ? 1 : 6, B = n * K;
    const buf = document.createElement("canvas"); buf.width = B; buf.height = B;
    const bctx = buf.getContext("2d"), img = bctx.createImageData(B, B), px = img.data;
    const hatch = layer.kind === "level" ? new Uint8Array(B * B) : null;
    for (let py = 0; py < B; py++) {
      for (let pxi = 0; pxi < B; pxi++) {
        const gx = (pxi + 0.5) / K - 0.5, gy = (n - 1) - ((py + 0.5) / K - 0.5);
        let v, a = 225;
        if (K === 1) v = V[Math.round(gy) * n + Math.round(gx)];
        else {
          v = bilinear(V, n, gx, gy, layer.kind === "level");
          // Scalar layers fade out where their blend draws on spots without data, for a soft edge.
          if (layer.kind !== "level") a = Math.round(225 * Math.min(1, Math.max(0, (COVER - 0.3) / 0.45)));
        }
        if (!isFinite(v) || a <= 0) continue;
        let rgb;
        if (layer.kind === "level") {
          const lv = v >= 2.5 ? 3 : v >= 1.5 ? 2 : v >= 0.5 ? 1 : 0;
          if (!lv || hidden.has(lv)) continue;
          rgb = hexRgb(LEVEL_COL[lv]);
          if (lv === 1) hatch[py * B + pxi] = 1;
        } else if (layer.kind === "category") {
          const name = passCell("main", Math.round(gx), Math.round(gy))?.de;
          if (!name) continue;
          rgb = hexRgb(DOM_COLORS[name] || "#8D8D8D");
        } else if (layer.kind === "diff") {
          const t = Math.min(Math.abs(v) / (hi || 1), 1), base = v >= 0 ? DIFF.up : DIFF.down;
          rgb = base; a = Math.round(40 + 200 * t);
        } else {
          rgb = rampRgb(hi > lo ? (v - lo) / (hi - lo) : 0.5);
        }
        const o = (py * B + pxi) * 4;
        px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = a;
      }
    }
    bctx.putImageData(img, 0, 0);
    const x0 = X(cur.xs[0] - step / 2), y0 = Y(cur.ys[n - 1] + step / 2), side = n * step * L.s;
    ctx.imageSmoothingEnabled = K > 1;
    ctx.drawImage(buf, x0, y0, side, side);
    if (hatch && hatch.some(Boolean)) drawHatch(ctx, hatch, B, x0, y0, side);
    if (state.prefs.contours && (layer.kind === "scalar" || layer.kind === "level")) drawContours(ctx, layer, V, n, lo, hi);
  }
  drawStructure(ctx);
}

/* Bilinear blend of the four surrounding grid values. Level layers treat missing spots as 0 so
   boundaries fall between spots; scalar layers average only the spots with data and report how
   much of the blend that was in COVER (0..1). */
let COVER = 1;
function bilinear(V, n, gx, gy, levelLike) {
  const i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
  let sum = 0, wsum = 0;
  for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const i = Math.min(Math.max(i0 + di, 0), n - 1), j = Math.min(Math.max(j0 + dj, 0), n - 1);
    let v = V[j * n + i];
    if (!isFinite(v)) { if (!levelLike) continue; v = 0; }
    sum += v * w; wsum += w;
  }
  COVER = wsum;
  return wsum > 1e-9 ? sum / wsum : NaN;
}

function drawHatch(ctx, mask, B, x0, y0, side) {
  const m = document.createElement("canvas"); m.width = B; m.height = B;
  const mctx = m.getContext("2d"), img = mctx.createImageData(B, B);
  for (let k = 0; k < mask.length; k++) if (mask[k]) img.data[k * 4 + 3] = 255;
  mctx.putImageData(img, 0, 0);
  const t = document.createElement("canvas"); t.width = Math.ceil(side); t.height = Math.ceil(side);
  const tctx = t.getContext("2d");
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(m, 0, 0, side, side);
  tctx.globalCompositeOperation = "source-in";
  tctx.strokeStyle = "rgba(249,246,238,.28)"; tctx.lineWidth = 1.2;
  tctx.beginPath();
  for (let d = -side; d < side; d += 7) { tctx.moveTo(d, side); tctx.lineTo(d + side, 0); }
  tctx.stroke();
  ctx.drawImage(t, x0, y0);
}

/* Marching squares over the value grid; labels are spread out so they don't pile up. */
function drawContours(ctx, layer, V, n, lo, hi) {
  const cur = run.current, step = cur.xs[1] - cur.xs[0];
  const toScreen = (gx, gy) => [X(cur.xs[0] + gx * step), Y(cur.ys[0] + gy * step)];
  let levels;
  if (layer.kind === "level") levels = [0.5, 1.5, 2.5];
  else {
    if (!(hi > lo)) return;
    let st = layer.step || (hi - lo) / 6;
    while ((hi - lo) / st > 9) st *= 2;
    levels = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) if (v > lo + 1e-9 && v < hi - 1e-9) levels.push(+v.toFixed(6));
  }
  const labels = [];
  ctx.save();
  ctx.lineWidth = 1.1; ctx.strokeStyle = layer.kind === "level" ? "rgba(249,246,238,.5)" : "rgba(249,246,238,.38)";
  ctx.font = '500 10px "JetBrains Mono", monospace'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const t of levels) {
    const segs = [];
    for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
      const a = V[j * n + i], b = V[j * n + i + 1], c = V[(j + 1) * n + i + 1], d = V[(j + 1) * n + i];
      if (layer.kind !== "level" && !(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
      const q = [a, b, c, d].map(v => (isFinite(v) ? v : 0));
      const pts = [];
      const edge = (v0, v1, x0, y0, x1, y1) => { if ((v0 >= t) !== (v1 >= t)) { const f = (t - v0) / (v1 - v0); pts.push([x0 + f * (x1 - x0), y0 + f * (y1 - y0)]); } };
      edge(q[0], q[1], i, j, i + 1, j); edge(q[1], q[2], i + 1, j, i + 1, j + 1); edge(q[2], q[3], i + 1, j + 1, i, j + 1); edge(q[3], q[0], i, j + 1, i, j);
      for (let k = 0; k + 1 < pts.length; k += 2) segs.push([toScreen(...pts[k]), toScreen(...pts[k + 1])]);
    }
    ctx.beginPath();
    for (const [p, q] of segs) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
    ctx.stroke();
    if (layer.kind === "level") continue;
    let placed = 0;
    for (let k = Math.floor(segs.length / 3); k < segs.length && placed < 2; k += 7) {
      const m = [(segs[k][0][0] + segs[k][1][0]) / 2, (segs[k][0][1] + segs[k][1][1]) / 2];
      if (labels.some(l => Math.hypot(l[0] - m[0], l[1] - m[1]) < 70)) continue;
      labels.push(m); placed++;
      const txt = layer.fmt(t);
      ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(10,10,10,.85)"; ctx.strokeText(txt, m[0], m[1]);
      ctx.fillStyle = "#F9F6EE"; ctx.fillText(txt, m[0], m[1]);
      ctx.lineWidth = 1.1; ctx.strokeStyle = "rgba(249,246,238,.38)";
    }
  }
  ctx.restore();
}

/* ---------- overlay ---------- */
export function drawOverlay() {
  const ctx = el.ov.getContext("2d");
  ctx.setTransform(L.px, 0, 0, L.px, 0, 0);
  ctx.clearRect(0, 0, L.W, L.H);
  const p = view.hover || view.pin, d = view.detail;
  if (d && d.path && d.path.length >= 6) {
    const n = d.path.length / 3, upto = Math.max(1, Math.round((n - 1) * view.flight));
    ctx.strokeStyle = "rgba(249,246,238,.9)"; ctx.lineWidth = 2; ctx.beginPath();
    for (let k = 0; k <= upto; k++) { const x = X(d.path[3 * k]), y = Y(d.path[3 * k + 1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    if (view.flight < 1) {
      const k = upto * 3;
      ctx.fillStyle = "#FF2C2C"; ctx.beginPath(); ctx.arc(X(d.path[k]), Y(d.path[k + 1]), 4.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  const size = run.current ? run.current.P.robotSize : 18;
  const h = d && d.shot ? d.shot.heading * Math.PI / 180 : Math.atan2(72 - p.y, 60 - p.x);
  ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(-h);
  ctx.strokeStyle = "#F9F6EE"; ctx.lineWidth = 1.6; ctx.fillStyle = "rgba(249,246,238,.1)";
  ctx.beginPath(); ctx.rect(-size / 2 * L.s, -size / 2 * L.s, size * L.s, size * L.s); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(size / 2 * L.s - 4, -5); ctx.lineTo(size / 2 * L.s + 4, 0); ctx.lineTo(size / 2 * L.s - 4, 5); ctx.stroke();
  ctx.restore();
  const q = view.pin;
  ctx.strokeStyle = "#FF2C2C"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 6, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { ctx.moveTo(X(q.x) + dx * 3, Y(q.y) + dy * 3); ctx.lineTo(X(q.x) + dx * 10, Y(q.y) + dy * 10); }
  ctx.stroke();
}

export const tileName = p => "ABCDEF"[Math.min(5, Math.max(0, Math.floor(p.x / 24)))] + Math.min(6, Math.max(1, Math.floor(p.y / 24) + 1));

/* ---------- pointer, keyboard, tooltip ---------- */
function evtPt(e) {
  const r = el.ov.getBoundingClientRect();
  const x = (e.clientX - r.left - L.ox) / L.s, y = 144 - (e.clientY - r.top - L.oy) / L.s;
  return { x, y, inside: x >= 0 && x <= 144 && y >= 0 && y <= 144, sx: e.clientX - r.left, sy: e.clientY - r.top };
}
function bindPointer() {
  el.ov.addEventListener("pointermove", e => {
    const q = evtPt(e);
    if (!q.inside) { leave(); return; }
    if (e.pointerType !== "mouse" && e.buttons === 0) return;
    if (e.pointerType !== "mouse") { view.pin = { x: q.x, y: q.y }; view.hover = null; savePin(); handlers.pin?.(); }
    else { view.hover = { x: q.x, y: q.y }; handlers.hover?.(); }
    tooltip(q);
  });
  el.ov.addEventListener("pointerleave", leave);
  el.ov.addEventListener("pointerdown", e => {
    const q = evtPt(e);
    if (!q.inside) return;
    view.pin = { x: q.x, y: q.y };
    view.hover = e.pointerType === "mouse" ? view.pin : null;
    savePin(); handlers.pin?.();
  });
  el.ov.addEventListener("keydown", e => {
    const st = e.shiftKey ? 6 : 1.5;
    const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
    if (!mv) return;
    e.preventDefault();
    view.hover = null;
    view.pin = { x: Math.min(144, Math.max(0, view.pin.x + mv[0])), y: Math.min(144, Math.max(0, view.pin.y + mv[1])) };
    savePin(); handlers.pin?.();
  });
}
function leave() { el.tip.hidden = true; if (view.hover) { view.hover = null; handlers.hover?.(); } }
function tooltip(q) {
  const cell = cellAt(q), c = cell && cell.c;
  const layer = LAYER[state.prefs.layer] || LAYER.level;
  let body = "";
  if (!c) body = "Computing…";
  else if (c.l < 0) body = "Robot can't sit here";
  else if (c.l < 1) body = LEVEL_NAME[0];
  else {
    const lv = layer.kind === "level" ? layerValue(layer, cell.i, cell.j) : c.l;
    const name = layer.combine && lv < c.l ? `${lv >= 1 ? LEVEL_NAME[lv | 0] + " after a tip" : "Not tip-proof"} <small>(${LEVEL_NAME[c.l]} now)</small>` : (LEVEL_NAME[lv | 0] ?? LEVEL_NAME[c.l]);
    body = `<b style="color:${LEVEL_COL[Math.max(1, lv | 0)] || "#F9F6EE"}">${name}</b> · ${Math.round(c.p * 100)}%<br>${c.a.toFixed(1)}° · ${Math.round(c.r)} rpm`;
    if (layer.kind === "scalar" || layer.kind === "diff") { const v = layerValue(layer, cell.i, cell.j); if (isFinite(v)) body += `<br>${layer.label}: ${layer.kind === "diff" ? (v >= 0 ? "+" : "") + Math.round(v * 100) + " pts" : layer.fmt(v)}`; }
    if (layer.id === "dom" && c.de) body += `<br>${c.de}`;
    if (layer.id === "burst") body += `<br>${c.bk ?? 1} of ${run.current.P.burstN} balls`;
  }
  el.tip.innerHTML = `<span class="mono">${tileName(q)} · ${lengthOut(q.x, 0)}, ${lengthOut(q.y, 0)}</span><br>${body}`;
  el.tip.hidden = false;
  const w = el.wrap.clientWidth;
  el.tip.style.transform = `translate(${Math.min(q.sx + 14, w - 190)}px, ${Math.max(q.sy - 64, 4)}px)`;
}

/* ---------- compare ---------- */
export function snapshotA() {
  const g = run.current?.passes.main;
  if (!g) return false;
  snapA = g.map(row => row.slice());
  return true;
}
export const hasSnapshot = () => !!snapA;

/* ---------- legend ---------- */
export function renderLegend() {
  const layer = LAYER[state.prefs.layer] || LAYER.level, host = el.legend, r = lastRange;
  if (!host) return;
  let h = "";
  if (layer.kind === "level") {
    const hidden = new Set(state.prefs.hiddenLevels || []);
    h = [3, 2, 1].map(lv => `<button type="button" class="lg-item${hidden.has(lv) ? " off" : ""}" data-level="${lv}" aria-pressed="${!hidden.has(lv)}"><i class="sw l${lv}"></i>${LEVEL_NAME[lv]}${lv === 2 ? ` <small>≥ ${run.current ? run.current.P.likelyThr : 70}%</small>` : ""}</button>`).join("")
      + `<span class="lg-note">${layer.combine ? "works for both raised CELLS" : "click a level to hide it"}</span>`;
  } else if (layer.kind === "category") {
    const seen = new Set();
    const g = run.current?.passes.main || [];
    for (const row of g) for (const c of row) if (c && c.de) seen.add(c.de);
    h = [...seen].map(n => `<span class="lg-item"><i class="sw" style="background:${DOM_COLORS[n] || "#8D8D8D"}"></i>${n}</span>`).join("") || '<span class="lg-note">Waiting for the map…</span>';
  } else if (layer.kind === "diff") {
    h = snapA ? `<span>worse</span><span class="ramp diff"></span><span>better</span><span class="lg-note">hit chance vs snapshot A</span>` : '<span class="lg-note">Press “Snapshot A”, change settings, and the map shows what changed.</span>';
  } else if (layer.kind === "count") {
    const N = run.current ? run.current.P.burstN : 3;
    h = `<span>0</span><span class="ramp"></span><span>${N} of ${N} balls score</span>`;
  } else {
    h = r ? `<span>${layer.fmt(r[0])}</span><span class="ramp"></span><span>${layer.fmt(r[1])}</span>${layer.note ? `<span class="lg-note">${layer.note}</span>` : ""}` : '<span class="lg-note">Waiting for the map…</span>';
  }
  host.innerHTML = h;
}
export function toggleLevel(lv) {
  const s = new Set(state.prefs.hiddenLevels || []);
  s.has(lv) ? s.delete(lv) : s.add(lv);
  state.prefs.hiddenLevels = [...s];
  savePrefs();
  drawAll();
}
