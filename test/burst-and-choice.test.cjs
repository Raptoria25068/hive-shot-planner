// Burst fire (flywheel recovery between balls) and the choice of shot at each spot.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { engine, defaultParams, IN } = require("./helpers.cjs");

const GRID = [];
for (let y = 9; y <= 135; y += 12) for (let x = 9; x <= 135; x += 12) GRID.push([x, y]);
const burstTotal = P => {
  const c = engine.buildCtx(P);
  let balls = 0, spots = 0;
  for (const [x, y] of GRID) {
    const r = engine.evalCell(c, x * IN, y * IN, false);
    if (r.level >= 1) { spots++; balls += r.burst; }
  }
  return { balls, spots };
};

test("without speed dip, every ball of a burst scores wherever the first does", () => {
  const { balls, spots } = burstTotal(defaultParams({ sag: false, burstN: 3 }));
  assert.ok(spots > 20);
  assert.equal(balls, 3 * spots);
});

test("a light flywheel that recovers slowly scores fewer burst balls than a heavy, quick one", () => {
  const heavy = burstTotal(defaultParams({ burstN: 3, inertia: 25, recover: 8000, burstGap: 300 }));
  const light = burstTotal(defaultParams({ burstN: 3, inertia: 1, recover: 800, burstGap: 120 }));
  assert.equal(heavy.balls, 3 * heavy.spots, "heavy wheel keeps every ball");
  assert.ok(light.balls < 3 * light.spots, `light wheel ${light.balls}/${3 * light.spots}`);
});

test("shot search never covers less than the original engine at any level", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "original.html"), "utf8")
    .match(/<script id="engine" type="text\/plain">([\s\S]*?)<\/script>/)[1];
  const m = { exports: {} };
  vm.runInNewContext(src, { module: m, Math, Float64Array, Object, Array, Infinity, Number, String, isFinite });
  const levels = (E, P) => {
    const c = E.buildCtx(P), n = [0, 0, 0, 0];
    for (const [x, y] of GRID) { const r = E.evalCell(c, x * IN, y * IN, false); for (let L = 1; L <= 3; L++) if (r.level >= L) n[L]++; }
    return n;
  };
  // Dead balls isolate the search from the capture model, which only removes shots.
  const P = defaultParams({ cor: 0 });
  const before = levels(m.exports, P), after = levels(engine, P);
  for (let L = 1; L <= 3; L++) assert.ok(after[L] >= before[L], `level ${L}: ${after[L]} < ${before[L]}`);
});
