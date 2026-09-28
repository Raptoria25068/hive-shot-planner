// Engine correctness: field geometry, flight physics, aiming, and obstacle detection.
const test = require("node:test");
const assert = require("node:assert/strict");
const { engine, defaultParams, IN, DEG } = require("./helpers.cjs");

const GRAV = 9.80665;

test("target opening spans 53.5 in to 65.6 in above the tiles (TU02 Figure 9-10)", () => {
  const c = engine.buildCtx(defaultParams());
  const outer = engine.geomOut(c).cells.find(q => q.target).outer;
  const zs = outer.map(p => p[2]);
  assert.ok(Math.abs(Math.min(...zs) - 53.5) < 0.05, `bottom ${Math.min(...zs)}`);
  assert.ok(Math.abs(Math.max(...zs) - 65.6) < 0.05, `top ${Math.max(...zs)}`);
});

test("frame legs rise from the base corners to the HIVE pivots (TU02 Figures 9-8 and 9-10)", () => {
  const P = defaultParams(), g = engine.geomOut(engine.buildCtx(P));
  const pivots = [72 - P.hiveSep / 2, 72 + P.hiveSep / 2];
  const legs = g.segs.filter(s => s[2] === 0);
  assert.equal(legs.length, 4);
  for (const s of legs) {
    assert.ok(Math.abs(Math.abs(s[0] - 72) - P.frameW / 2) < 1e-9, `foot x ${s[0]}`);
    assert.ok(Math.abs(Math.abs(s[1] - 72) - P.frameD / 2) < 1e-9, `foot y ${s[1]}`);
    assert.ok(pivots.some(x => Math.abs(s[3] - x) < 1e-9) && Math.abs(s[4] - 72) < 1e-9, `apex ${s[3]}, ${s[4]}`);
    assert.ok(s[5] > P.pivotZ, `apex z ${s[5]}`);
  }
  const bar = g.segs.find(s => s[2] > 0 && s[2] === s[5] && s[1] === s[4] && s[0] !== s[3]);
  assert.ok(Math.abs(Math.abs(bar[3] - bar[0]) - P.hiveSep) < 1e-9, `crossbar ${Math.abs(bar[3] - bar[0])} in`);
});

test("without drag or lift, flight follows the exact projectile parabola", () => {
  const c = engine.buildCtx(defaultParams({ cd: 0, magnus: 0 }));
  const S = { cx: 72 * IN, cy: 20 * IN, vrx: 0, vry: 0, om: 0 };
  for (const [aDeg, v, D] of [[45, 7, 2.0], [30, 8, 2.6], [60, 6.5, 1.2]]) {
    const a = aDeg * DEG, L = engine.launch(c, S, a, v, Math.PI / 2, false);
    const r = engine.fly(c, L, 1, 1, D, 0, 1, false, null);
    const exact = L.ez + D * Math.tan(a) - GRAV * D * D / (2 * v * v * Math.cos(a) ** 2);
    assert.ok(r.reached, `reached ${aDeg}°`);
    assert.ok(Math.abs(r.z - exact) < 0.0005, `${aDeg}° ${v} m/s: z ${r.z} vs ${exact}`);
  }
});

test("the solved shot at the default pin scores and passes through its aim point", () => {
  const c = engine.buildCtx(defaultParams());
  const res = engine.evalCell(c, 72 * IN, 115 * IN, true);
  assert.ok(res.level >= 1, `level ${res.level} (${res.why})`);
  const b = res.best;
  assert.ok(b.tr.crossed && b.pm >= 0, "lands inside the opening");
  const e = [b.L.ex, b.L.ey], T = b.T, D = Math.hypot(T[0] - e[0], T[1] - e[1]);
  const r = engine.fly(c, b.L, 1, 1, D, (T[0] - e[0]) / D, (T[1] - e[1]) / D, false, null);
  assert.ok(Math.abs(r.z - T[2]) < 0.003, `misses aim height by ${((r.z - T[2]) / IN).toFixed(3)} in`);
});

test("8 ms flight steps catch every crossbar hit that 0.5 ms steps catch", () => {
  const c = engine.buildCtx(defaultParams());
  const S = { cx: 72 * IN, cy: 30 * IN, vrx: 0, vry: 0, om: 0 };
  let fineHits = 0, missed = 0;
  for (let aDeg = 25; aDeg <= 55; aDeg += 1) {
    for (let v = 5.5; v <= 9.0001; v += 0.1) {
      const L = engine.launch(c, S, aDeg * DEG, v, Math.PI / 2, false);
      c.dt = 0.0005;
      const fine = engine.fly(c, L, 1, 2, 0, 0, 0, true, null);
      c.dt = 0.008;
      const coarse = engine.fly(c, L, 1, 2, 0, 0, 0, true, null);
      if (fine.blocked === 4) { fineHits++; if (coarse.blocked !== 4) missed++; }
    }
  }
  assert.ok(fineHits > 20, `test needs crossbar hits to be meaningful (${fineHits})`);
  assert.equal(missed, 0, `${missed} of ${fineHits} crossbar hits slipped between 8 ms samples`);
});
