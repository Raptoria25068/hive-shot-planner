/* Field-wide summary: coverage per level, the tip plan (best spot, time to the RP thresholds),
   how much of the map survives a tip, and the design-value sweeps. */
import { run } from "./runner.js";
import { FIELDS } from "./state.js";
import { LAYER, layerValue, LEVEL_COL, LEVEL_NAME, tileName } from "./map.js";

const fmt = (v, d = 1) => (v === null || v === undefined || !isFinite(v)) ? "–" : Number(v).toFixed(d);
const rangeTxt = (a, b, d, u) => !isFinite(a) ? "–" : Math.abs(b - a) < Math.pow(10, -d) * 5 ? fmt(a, d) + u : fmt(a, d) + "–" + fmt(b, d) + u;
const RP = [{ tips: 4, label: "POLLINATOR 1" }, { tips: 7, label: "POLLINATOR 2" }];
const TIP_POINTS = 20;

export function renderSummary(host) {
  const cur = run.current;
  if (!cur || !cur.passDone.main) { host.innerHTML = `<h2>Across the field</h2><p class="muted">Map in progress…</p>`; return; }
  const n = cur.xs.length, cnt = [0, 0, 0, 0];
  let spots = 0;
  const rng = [0, 1, 2].map(() => ({ a0: Infinity, a1: -Infinity, r0: Infinity, r1: -Infinity }));
  let best = null, tipKeep = 0, tipBase = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = cur.passes.main[j][i];
    if (!c || c.l < 0) continue;
    spots++; cnt[c.l]++;
    for (let L = 1; L <= 3; L++) {
      const r = c.rg && c.rg[L - 1]; if (!r) continue;
      const q = rng[L - 1];
      q.a0 = Math.min(q.a0, r[0]); q.a1 = Math.max(q.a1, r[1]); q.r0 = Math.min(q.r0, r[2]); q.r1 = Math.max(q.r1, r[3]);
    }
    if (c.l >= 1) {
      const v = layerValue(LAYER.pps, i, j);
      if (isFinite(v) && (!best || v > best.pps)) best = { i, j, c, pps: v };
      if (cur.passes.flip) { tipBase++; if (layerValue(LAYER.tip, i, j) >= 1) tipKeep++; }
    }
  }
  const pct = v => spots ? v / spots * 100 : 0, atLeast = [cnt[1] + cnt[2] + cnt[3], cnt[2] + cnt[3], cnt[3]];
  let h = `<h2>Across the field</h2><div class="covbar">${[3, 2, 1].map(L => `<i class="l${L}" style="width:${pct(cnt[L])}%"></i>`).join("")}</div>
    <table class="tbl"><tr><th>At least</th><th>Field area</th><th>Hood needed</th><th>Flywheel needed</th></tr>`;
  for (let L = 3; L >= 1; L--) {
    const q = rng[L - 1];
    h += `<tr><td><i class="dot l${L}"></i>${LEVEL_NAME[L]}</td><td>${fmt(pct(atLeast[L - 1]), 0)}%</td><td>${rangeTxt(q.a0, q.a1, 1, "°")}</td><td>${rangeTxt(q.r0, q.r1, 0, " rpm")}</td></tr>`;
  }
  h += `</table>`;
  if (best) {
    const P = cur.P, perBurst = (best.c.bk ?? 1) * best.c.p, bursts = P.ballsToTip / Math.max(perBurst, 1e-6);
    const tipTime = TIP_POINTS / best.pps;
    h += `<div class="plan"><h3>Tip plan <small>estimate</small></h3>
      <p>Fastest spot: <b>${tileName({ x: cur.xs[best.i], y: cur.ys[best.j] })}</b> · ${Math.round(best.c.p * 100)}% per ball · ${fmt(perBurst, 1)} of ${P.burstN} per burst</p>
      <div class="plan-row"><span><b>${fmt(bursts, 1)}</b> bursts per tip</span><span><b>${fmt(tipTime, 0)} s</b> per tip</span><span><b>${fmt(best.pps, 2)}</b> pts/s</span></div>
      <div class="plan-row">${RP.map(r => `<span>${r.label}: ${r.tips} tips ≈ <b>${fmt(r.tips * tipTime, 0)} s</b>${r.tips * tipTime <= 150 ? "" : ' <small class="warn">over a match</small>'}</span>`).join("")}</div>
      <p class="muted">Match: 30 s AUTO + 120 s TELEOP. Uses balls-to-tip ${P.ballsToTip}, reload ${P.intakeTime} s, driving ${P.driveSpeed} in/s from your LOADING ZONE.</p></div>`;
  }
  if (cur.passes.flip) {
    h += cur.passDone.flip
      ? `<p class="tipnote"><b>${fmt(tipBase ? 100 * tipKeep / tipBase : 0, 0)}%</b> of your scorable spots still score after the HIVE tips. The <b>Tip-proof</b> layer shows where.</p>`
      : `<p class="tipnote muted">Mapping the other raised CELL for tip-proof spots…</p>`;
  }
  if (Object.keys(cur.sweeps).length) {
    h += `<h2 class="sw-h">Solved design values</h2><div class="sweeps">`;
    for (const k of Object.keys(cur.sweeps)) {
      const f = FIELDS[k], pts = cur.sweeps[k], dec = Math.abs(pts[pts.length - 1].value - pts[0].value) < 5 ? 2 : 1;
      h += `<div class="sweep"><div class="t">${f.label}</div><div class="v">${fmt(cur.chosen[k], dec)} ${f.unit || ""}</div><canvas data-k="${k}"></canvas><div class="muted">coverage vs value · guaranteed brightest</div></div>`;
    }
    h += `</div>`;
  }
  host.innerHTML = h;
  host.querySelectorAll("canvas[data-k]").forEach(cv => drawSweep(cv, cur.sweeps[cv.dataset.k], cur.chosen[cv.dataset.k]));
}

function drawSweep(cv, pts, chosen) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, x0 = pts[0].value, x1 = pts[pts.length - 1].value;
  const PX = v => 4 + (W - 8) * (x1 > x0 ? (v - x0) / (x1 - x0) : 0.5), PY = f => H - 4 - (H - 8) * f;
  ctx.strokeStyle = "rgba(249,246,238,.12)"; ctx.beginPath(); ctx.moveTo(4, PY(0)); ctx.lineTo(W - 4, PY(0)); ctx.stroke();
  [[0, 1], [1, 2], [2, 3]].forEach(([i, L]) => {
    ctx.strokeStyle = LEVEL_COL[L]; ctx.lineWidth = L === 3 ? 2.2 : 1.4; ctx.beginPath();
    pts.forEach((o, j) => j ? ctx.lineTo(PX(o.value), PY(o.frac[i])) : ctx.moveTo(PX(o.value), PY(o.frac[i])));
    ctx.stroke();
  });
  ctx.strokeStyle = "#F9F6EE"; ctx.setLineDash([2, 2]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PX(chosen), 2); ctx.lineTo(PX(chosen), H - 2); ctx.stroke(); ctx.setLineDash([]);
}
