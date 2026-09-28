/* Readout for the inspected spot: level, key numbers (animated), the side view, what works
   here, burst, shot and flight details, the error budget, and solved blanks. */
import { run } from "./runner.js";
import { FIELDS, lengthOut, esc } from "./state.js";
import { view, cellAt, tileName, LEVEL_NAME } from "./map.js";
import { drawSide, setSideCanvas } from "./side.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (v, d = 1) => (v === null || v === undefined || !isFinite(v)) ? "–" : Number(v).toFixed(d);
const WHY = {
  keepout: "The robot can't sit here: too close to a wall or a HIVE frame leg.",
  blocked: "The best arc from here hits the HIVE structure before reaching the opening.",
  graze: "The opening faces away from here, so the ball can't drop in.",
  outside: "The best arc misses the opening: the entry is too steep, or fixed settings don't land it.",
  bounce: "The ball gets in, then rebounds off the back of the CELL and out.",
  hi: "It needs more flywheel speed than the allowed maximum.",
  lo: "It needs less speed than the minimum flywheel speed allowed.",
  nocross: "The ball never reaches the opening from here.",
  close: "Too close to the target to aim.",
};
const BLK = { 1: "the raised CELL's own body", 2: "your HIVE's lowered CELL", 3: "the other HIVE", 4: "the frame (legs, crossbar or arm)" };

let host = null, solves = null, prevNums = {}, prevLevel = null;
export function initReadout(el) { host = el; }
export function setSolves(s) { solves = s; }

function rangeTxt(a, b, d, u) {
  if (a === undefined || a === null || !isFinite(a)) return "–";
  return Math.abs(b - a) < Math.pow(10, -d) * 5 ? fmt(a, d) + u : fmt(a, d) + "–" + fmt(b, d) + u;
}

export function renderReadout() {
  if (!host) return;
  const cur = run.current, p = view.hover || view.pin;
  const d = view.detail, cellInfo = cellAt(p), cc = cellInfo && cellInfo.c;
  const lvl = d ? d.level : (cc ? cc.l : null);
  const s = d && d.shot, fl = d && d.flight, rb = d && d.rob;
  const hood = s ? s.hood : cc && cc.a, rpm = s ? s.rpm : cc && cc.r;
  const prob = rb && lvl >= 1 ? rb.prob : (cc && cc.l >= 1 ? cc.p : null);
  const burst = d && d.burst ? d.burst : null, N = cur ? cur.P.burstN : 1;
  const lvCls = lvl === null ? "l0" : "l" + Math.max(0, lvl);
  let h = `<div class="ohead"><div class="opos"><b>${tileName(p)} · ${lengthOut(p.x)}, ${lengthOut(p.y)}</b>${view.hover ? "under the pointer" : "pinned spot"}</div>
    <span class="pill ${lvCls}${prevLevel !== null && prevLevel !== lvl ? " pop" : ""}">${lvl === null ? "…" : lvl < 0 ? "Keep-out" : LEVEL_NAME[lvl]}</span></div>`;
  h += `<div class="tiles">
    <div class="tile"><div class="k">Hood</div><div class="v"><span data-num="hood" data-d="1">${lvl >= 1 ? fmt(hood, 1) : "–"}</span><small>°</small></div></div>
    <div class="tile"><div class="k">Flywheel</div><div class="v"><span data-num="rpm" data-d="0">${lvl >= 1 ? fmt(rpm, 0) : "–"}</span><small>rpm</small></div></div>
    <div class="tile"><div class="k">Hit chance</div><div class="v"><span data-num="prob" data-d="0">${prob !== null && prob !== undefined ? fmt(prob * 100, 0) : "–"}</span><small>%</small></div></div>
    <div class="tile"><div class="k">Burst</div><div class="v"><span data-num="burst" data-d="0">${lvl >= 1 && burst ? burst.n : "–"}</span><small>/${N}</small></div></div></div>`;
  const why = d ? d.why : cc && cc.why;
  if (lvl !== null && lvl < 1) {
    let t = WHY[why] || WHY.nocross;
    if (why === "blocked" && fl && fl.blocked) t = "The best arc from here hits " + BLK[fl.blocked] + " before reaching the opening.";
    h += `<div class="why">${esc(t)}</div>`;
  }
  if (d && d.cap && d.cap.risky) h += `<div class="why soft">It stays in only if the ball is no bouncier than set: a livelier ball would rebound out, so this spot is capped at Likely.</div>`;
  h += `<div class="sidewrap"><canvas id="side" aria-label="Side view of the shot"></canvas>
    <div class="sidebar"><span class="sidecap">Side view along the shot · dashed: hood and speed at their ± tolerance</span>
    <span class="sidebtns"><button class="chip" type="button" data-act="replay">Replay</button><button class="chip" type="button" data-act="tip">Tip the HIVE</button><button class="chip" type="button" data-act="3d">3D</button></span></div></div>`;
  const rg = d ? d.ranges : cc && cc.rg;
  if (rg && lvl >= 0) {
    h += `<section class="sect"><h2>What works here</h2><table class="tbl"><tr><th>Level</th><th>Hood</th><th>Flywheel</th></tr>`;
    for (let L2 = 3; L2 >= 1; L2--) {
      const r = rg[L2 - 1];
      h += `<tr><td><i class="dot l${L2}"></i>${LEVEL_NAME[L2]}</td><td>${r ? rangeTxt(r[0], r[1], 1, "°") : "–"}</td><td>${r ? rangeTxt(r[2], r[3], 0, "") : "–"}</td></tr>`;
    }
    h += `</table></section>`;
  }
  if (burst && burst.balls && burst.balls.length > 1 && lvl >= 1) {
    h += `<section class="sect"><h2>Burst of ${burst.of}</h2><div class="burst">`;
    burst.balls.forEach((b, i) => {
      h += `<div class="bb ${b.pm >= 0 ? "in" : "out"}"><b>${i + 1}</b><span>${fmt(b.rpm, 0)} rpm</span><small>${b.pm >= 0 ? fmt(b.pm, 1) + " in to rim" : "misses"}</small></div>`;
    });
    h += `</div></section>`;
  }
  if (s) {
    h += `<section class="sect"><h2>Shot</h2><dl class="kv">
      <dt>Exit speed</dt><dd>${fmt(s.vrel, 2)} m/s</dd>
      <dt>Heading <small>(0° = toward blue)</small></dt><dd>${fmt(s.heading, 1)}°</dd>
      <dt>Lead vs straight line</dt><dd>${fmt(s.lead, 1)}°</dd>
      <dt>Ball ${s.spinDir === "back" ? "backspin" : "topspin"}</dt><dd>${fmt(s.spinRpm, 0)} rpm</dd>
      <dt>Flywheel dip during the shot</dt><dd>${fmt(s.sagRpm, 0)} rpm</dd>
    </dl></section>`;
  }
  if (fl) {
    h += `<section class="sect"><h2>Flight</h2><dl class="kv">
      <dt>Distance to aim point</dt><dd>${fl.D ? lengthOut(fl.D) : "–"}</dd>
      <dt>Time of flight</dt><dd>${fmt(fl.tof, 2)} s</dd>
      <dt>Apex height</dt><dd>${lengthOut(fl.apex)}</dd>
      ${fl.crossed ? `<dt>Entry angle (below horizontal)</dt><dd>${fmt(fl.entryAngle, 1)}°</dd>
      <dt>Entry speed</dt><dd>${fmt(fl.entrySpeed, 2)} m/s</dd>` : ""}
    </dl></section>`;
  }
  if (rb && lvl >= 1 && rb.contrib) {
    const max = Math.max(...rb.contrib.map(c => c.v), 1e-6);
    h += `<section class="sect"><h2>Error budget</h2><dl class="kv">
      <dt>Room to the rim (perfect shot)</dt><dd>${fmt(rb.pm, 2)} in</dd>
      <dt>Margin, 3σ rule</dt><dd>${fmt(rb.wcStat, 2)} in</dd>
      <dt>Margin, every error at its limit</dt><dd>${fmt(rb.wcStrict, 2)} in</dd>
    </dl><div class="errbars">`;
    for (const c of rb.contrib) h += `<div class="eb"><span>${esc(c.name)}</span><span class="trk"><i style="width:${(100 * c.v / max).toFixed(1)}%"></i></span><span class="n">${fmt(c.v, 2)} in</span></div>`;
    h += `</div></section>`;
  }
  if (cur && cur.blanks.length) {
    const sv = solves && solves.key === cur.id + ":" + p.x.toFixed(2) + "," + p.y.toFixed(2) ? solves : null;
    h += `<section class="sect"><h2>Solved at this spot</h2><div class="solved">`;
    for (const b of cur.blanks) {
      const f = FIELDS[b.k], part = sv && sv.parts[b.k], u = f.unit ? " " + f.unit : "", dec = Math.abs(b.hi - b.lo) < 5 ? 2 : 1;
      let body;
      if (!part) body = `<span class="muted" style="grid-column:1/-1">${sv && sv.pending ? "Solving…" : "Pause on a spot to solve"}</span>`;
      else {
        body = "";
        for (let L2 = 3; L2 >= 1; L2--) {
          const r = part.ranges[L2 - 1];
          let txt = "none in " + fmt(b.lo, dec) + "–" + fmt(b.hi, dec) + u;
          if (r) {
            const atLo = Math.abs(r[0] - b.lo) < 1e-9, atHi = Math.abs(r[1] - b.hi) < 1e-9;
            if (f.pol === "lim" && atLo) txt = atHi ? "any value up to " + fmt(b.hi, dec) + u : "up to " + fmt(r[1], dec) + u;
            else txt = fmt(r[0], dec) + "–" + fmt(r[1], dec) + u + (atLo || atHi ? ' <small class="muted">(search edge)</small>' : "");
          }
          body += `<span><i class="dot l${L2}"></i>${LEVEL_NAME[L2]}</span><span>${txt}</span>`;
        }
      }
      const mapv = cur.chosen[b.k] !== undefined ? `map uses ${fmt(cur.chosen[b.k], dec)}${u} (best coverage)` : `map uses ${fmt(cur.P[b.k], dec)}${u}`;
      h += `<div class="sv"><div class="t"><b>${esc(f.label)}</b> · <span class="muted">${esc(mapv)}</span></div><div class="r">${body}</div></div>`;
    }
    h += `</div></section>`;
  }
  host.innerHTML = h;
  setSideCanvas(host.querySelector("#side"));
  drawSide();
  tweenNumbers({ hood: lvl >= 1 ? hood : null, rpm: lvl >= 1 ? rpm : null, prob: prob != null ? prob * 100 : null, burst: lvl >= 1 && burst ? burst.n : null });
  prevLevel = lvl;
}

/* Numbers roll from their previous value to the new one. */
function tweenNumbers(next) {
  const els = [...host.querySelectorAll("[data-num]")];
  const from = { ...prevNums };
  prevNums = next;
  if (REDUCED) return;
  const t0 = performance.now(), dur = 380;
  const step = now => {
    const u = Math.min(Math.max((now - t0) / dur, 0), 1), e = 1 - Math.pow(1 - u, 3);
    for (const node of els) {
      const k = node.dataset.num, a = from[k], b = next[k];
      if (a == null || b == null || !isFinite(a) || !isFinite(b)) continue;
      node.textContent = (a + (b - a) * e).toFixed(+node.dataset.d);
    }
    if (u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
