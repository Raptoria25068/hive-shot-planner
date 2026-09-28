// Capture model: what happens to the ball after it crosses into the raised CELL.
const test = require("node:test");
const assert = require("node:assert/strict");
const { engine, defaultParams, IN } = require("./helpers.cjs");

// A crossing state at the middle of the opening, moving with speed v along a local direction
// (da = along the tube, + is out; dh = up within the cross-section; ds = across).
function entry(c, v, da, dh, ds = 0) {
  const q = c.tq, n = Math.hypot(da, dh, ds);
  const a = q.a2, h = c.Hp * 0.45, s = 0;
  const rel = [s + a * q.u[0] + (h - q.dOff) * q.w[0], a * q.u[1] + (h - q.dOff) * q.w[1], a * q.u[2] + (h - q.dOff) * q.w[2]];
  const vel = [0, 1, 2].map(i => v * ((ds / n) * [1, 0, 0][i] + (da / n) * q.u[i] + (dh / n) * q.w[i]));
  return { x: q.px + rel[0], y: q.py + rel[1], z: q.pz + rel[2], vx: vel[0], vy: vel[1], vz: vel[2] };
}

test("a gentle drop into the CELL stays in", () => {
  const c = engine.buildCtx(defaultParams());
  const r = engine.capture(c, entry(c, 2.5, -1, -0.8), 0.5, 0.8);
  assert.equal(r.captured, true);
});

test("a hard, flat shot at the back panel with a very bouncy ball comes back out", () => {
  const c = engine.buildCtx(defaultParams());
  const r = engine.capture(c, entry(c, 9, -1, -0.05), 0.9, 0.95);
  assert.equal(r.captured, false, `bounces ${r.bounces}`);
});

test("a dead ball (no restitution) never escapes", () => {
  const c = engine.buildCtx(defaultParams());
  for (const [v, da, dh] of [[9, -1, -0.05], [6, -1, 0.3], [4, -0.5, -1]]) {
    assert.equal(engine.capture(c, entry(c, v, da, dh), 0, 0.8).captured, true, `${v} m/s`);
  }
});

test("the ball never gains energy inside the CELL", () => {
  const c = engine.buildCtx(defaultParams());
  const r = engine.capture(c, entry(c, 7, -1, -0.2, 0.3), 0.6, 0.85, true);
  const g = 9.80665;
  const e0 = r.trace[0].sp ** 2 / 2 + g * r.trace[0].z;
  for (const p of r.trace) assert.ok(p.sp ** 2 / 2 + g * p.z <= e0 + 1e-6, `energy rose at t=${p.t}`);
});

test("with a fixed hood, very bouncy balls lose map spots to bounce-outs; dead balls lose none", () => {
  // A free hood lets the solver lob softly into the CELL instead, so the hood is pinned here.
  const spots = [];
  for (let y = 9; y <= 135; y += 12) for (let x = 9; x <= 135; x += 12) spots.push([x, y]);
  const count = cor => {
    const c = engine.buildCtx(defaultParams({ cor: cor, hoodSpec: { mode: "fixed", v: 60 } }));
    return spots.filter(([x, y]) => engine.evalCell(c, x * IN, y * IN, false).why === "bounce").length;
  };
  assert.equal(count(0), 0);
  assert.ok(count(0.95) > 0, "expected some bounce-outs at restitution 0.95");
});
