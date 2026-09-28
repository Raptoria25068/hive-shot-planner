/* Side view along the shot: structure, error-spread arcs and the flight, plus the flight and
   HIVE-tip animations. The flight fraction is shared with the map overlay through view.flight. */
import { view, convexHull, LEVEL_COL } from "./map.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let canvas = null, geom = null, ballD = 3.6, robotSize = 18, redrawMap = () => {};
let spreadAlpha = 1, tipAngle = 0, tipCell = null, anim = 0;

export function initSide(cv, onMapRedraw) { canvas = cv; redrawMap = onMapRedraw; }
export function setSideGeom(g, P) { geom = g; ballD = P.ballD; robotSize = P.robotSize; }
export function setSideCanvas(cv) { canvas = cv; }

/* Plays the ball along its path in about its real flight time (clamped for readability). */
export function playFlight() {
  cancelAnimationFrame(anim);
  const d = view.detail;
  if (!d || !d.path || REDUCED) { view.flight = 1; spreadAlpha = 1; drawSide(); redrawMap(); return; }
  const dur = Math.min(Math.max((d.flight?.tof || 0.8) * 1000, 550), 1300), t0 = performance.now();
  const step = now => {
    const u = Math.min(Math.max((now - t0) / dur, 0), 1);
    view.flight = u;
    spreadAlpha = Math.max(0, (u - 0.55) / 0.45);
    drawSide(); redrawMap();
    if (u < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

/* Tips your HIVE (twice the tilt about its pivot, raised CELL swinging down), then calls done()
   to flip the map. The other HIVE stays put. */
export function playTip(done) {
  cancelAnimationFrame(anim);
  tipCell = geom && geom.cells.find(c => c.target);
  if (REDUCED || !tipCell) { done(); return; }
  // Positive angles turn +y toward +z; sig is +1 when the raised CELL points to +y.
  const t0 = performance.now(), dur = 700, total = -(geom.sig || 1) * 2 * (geom.tilt || 30);
  const step = now => {
    const u = Math.min(Math.max((now - t0) / dur, 0), 1), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    tipAngle = total * e;
    drawSide();
    if (u < 1) anim = requestAnimationFrame(step);
    else { tipAngle = 0; done(); }
  };
  anim = requestAnimationFrame(step);
}

const rotAboutPivot = (q, cell) => {
  if (!tipAngle || !tipCell || cell.hive !== tipCell.hive || !cell.pivot) return q;
  const th = tipAngle * Math.PI / 180, cy = cell.pivot[1], pz = cell.pivot[2];
  const dy = q[1] - cy, dz = q[2] - pz;
  return [q[0], cy + dy * Math.cos(th) - dz * Math.sin(th), pz + dy * Math.sin(th) + dz * Math.cos(th)];
};

export function drawSide() {
  if (!canvas) return;
  const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, d = view.detail;
  ctx.clearRect(0, 0, W, H);
  if (!d || !d.path || !geom) {
    ctx.fillStyle = "rgba(221,195,162,.75)"; ctx.font = '12px "Instrument Sans", sans-serif'; ctx.textAlign = "center";
    ctx.fillText(d ? "No arc to show from this spot" : "Computing…", W / 2, H / 2);
    return;
  }
  const ex = d.path[0], ey = d.path[1], T = d.T || geom.M0;
  let dx = T[0] - ex, dy = T[1] - ey; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const U = q => (q[0] - ex) * dx + (q[1] - ey) * dy;
  const pts = [];
  for (let i = 0; i < d.path.length; i += 3) pts.push([U([d.path[i], d.path[i + 1]]), d.path[i + 2]]);
  const u0 = -6, u1 = Math.max(U(T) + 20, ...pts.map(q => q[0])), z1 = Math.max(74, ...pts.map(q => q[1])) + 6;
  const mg = { l: 30, r: 8, t: 12, b: 20 };
  const sc = Math.min((W - mg.l - mg.r) / (u1 - u0), (H - mg.t - mg.b) / z1);
  const PX = u => mg.l + (u - u0) * sc, PY = z => H - mg.b - z * sc;
  ctx.strokeStyle = "rgba(249,246,238,.08)"; ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(221,195,162,.7)"; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let z = 0; z <= z1; z += 24) { ctx.beginPath(); ctx.moveTo(PX(u0), PY(z)); ctx.lineTo(PX(u1), PY(z)); ctx.stroke(); ctx.fillText(z + '"', mg.l - 4, PY(z)); }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let u = 0; u <= u1; u += 24) ctx.fillText(u + '"', PX(u), H - mg.b + 4);
  // structure
  for (const cell of geom.cells) {
    const col = cell.hive === "red" ? "#FF2C2C" : "#3D74FF";
    const all = cell.inner.concat(cell.outer).map(q => rotAboutPivot(q, cell)).map(q => [PX(U(q)), PY(q[2])]);
    const hull = convexHull(all);
    ctx.beginPath(); hull.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath();
    ctx.globalAlpha = cell.target ? 0.26 : 0.1; ctx.fillStyle = col; ctx.fill();
    ctx.globalAlpha = cell.target ? 0.95 : 0.45; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    // the opening's rim as seen across the shot: edge-on from straight ahead, wider from an angle
    if (cell.target && !tipAngle) {
      ctx.strokeStyle = "#F9F6EE"; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath(); cell.outer.forEach((q, i) => i ? ctx.lineTo(PX(U(q)), PY(q[2])) : ctx.moveTo(PX(U(q)), PY(q[2]))); ctx.closePath(); ctx.stroke();
      ctx.lineJoin = "miter";
    }
  }
  ctx.strokeStyle = "rgba(249,246,238,.35)"; ctx.lineWidth = 1.2;
  for (const g of geom.segs) {
    let a = [g[0], g[1], g[2]], b = [g[3], g[4], g[5]];
    // the axle between your HIVE's CELLS turns with them; the frame does not
    if (tipAngle && tipCell && Math.hypot((a[0] + b[0]) / 2 - tipCell.pivot[0], (a[1] + b[1]) / 2 - tipCell.pivot[1], (a[2] + b[2]) / 2 - tipCell.pivot[2]) < 1) {
      a = rotAboutPivot(a, tipCell); b = rotAboutPivot(b, tipCell);
    }
    ctx.beginPath(); ctx.moveTo(PX(U(a)), PY(a[2])); ctx.lineTo(PX(U(b)), PY(b[2])); ctx.stroke();
  }
  // spread arcs
  if (spreadAlpha > 0) {
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = `rgba(221,195,162,${0.7 * spreadAlpha})`;
    for (const sp of d.spread || []) {
      ctx.beginPath();
      for (let i = 0; i < sp.length; i += 3) { const x = PX(U([sp[i], sp[i + 1]])), y = PY(sp[i + 2]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // flight
  const lc = d.level >= 1 ? LEVEL_COL[d.level] : "#6F93B8";
  const upto = Math.max(1, Math.round((pts.length - 1) * view.flight));
  ctx.strokeStyle = d.level === 1 ? "#E0405A" : lc; ctx.lineWidth = 2.6;
  ctx.beginPath(); for (let k = 0; k <= upto; k++) { const q = pts[k]; k ? ctx.lineTo(PX(q[0]), PY(q[1])) : ctx.moveTo(PX(q[0]), PY(q[1])); } ctx.stroke();
  const b = pts[upto], rr = Math.max(ballD / 2 * sc, 2.5);
  ctx.beginPath(); ctx.arc(PX(b[0]), PY(b[1]), rr, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,44,44,.35)"; ctx.fill(); ctx.strokeStyle = "#FF2C2C"; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = "rgba(249,246,238,.14)";
  ctx.fillRect(PX(-robotSize / 2), PY(pts[0][1] - 1), robotSize * sc, (pts[0][1] - 1) * sc);
}
