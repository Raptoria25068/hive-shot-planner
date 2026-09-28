/* Runs the engine in background workers: field maps (with extra passes for tip-proof and mixed
   balls), design-value sweeps, spot inspection, per-spot solving and calibration fits. */
import { collect, BALLS, tipped } from "./state.js";

const ENGINE = new URL("../hive-engine.js", import.meta.url);
// A worker whose script fails to load (missing file, blocked by policy) reports through onerror,
// not through messages.
const mk = () => {
  const w = new Worker(ENGINE);
  w.onerror = e => { e.preventDefault(); emit("error", e.message || "The planner engine could not start"); };
  return w;
};
const NW = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
const CHUNK = 48;

const listeners = {};
export const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
const emit = (ev, ...args) => (listeners[ev] || []).forEach(fn => fn(...args));

export const run = { current: null };
let pool = [], gen = 0;

export function gridFor(P) {
  const R = P.robotSize / 2, res = P.res || 4;
  const n = Math.max(2, Math.round((144 - 2 * R) / res) + 1);
  return Array.from({ length: n }, (_, i) => R + (144 - 2 * R) * i / (n - 1));
}

/* The main map plus the passes the combined layers need. */
function passesFor(P, mixed) {
  const out = [{ key: "main", P }];
  if (P.tipProof) out.push({ key: "flip", P: tipped(P) });
  if (mixed) {
    const nectar = { ...P, ...BALLS.nectar, ballType: "nectar" };
    out.push({ key: "ball2", P: nectar });
    if (P.tipProof) out.push({ key: "ball2flip", P: tipped(nectar) });
  }
  return out;
}

export function startRun() {
  const my = ++gen;
  pool.forEach(w => w.terminate());
  pool = Array.from({ length: NW }, mk);
  const { P, blanks, mixed } = collect();
  const xs = gridFor(P);
  const cur = run.current = { id: my, P, blanks, mixed, xs, ys: xs.slice(), passes: {}, passDone: {}, chosen: {}, sweeps: {}, done: false };
  emit("start", cur);
  requestGeom(P);
  const opt = blanks.filter(b => b.pol === "opt");
  (opt.length ? sweeps(cur, opt) : Promise.resolve()).then(() => { if (my === gen) mapAll(cur); });
}

/* Blank design values (exit height, wheel size, ...) are swept at a coarse grid and set to the
   value that covers the most guaranteed area, then likely, then possible. */
function sweeps(cur, opt) {
  return new Promise(resolve => {
    const NV = 7, jobs = [];
    for (const b of opt) for (let i = 0; i < NV; i++) jobs.push({ key: b.k, value: b.lo + (b.hi - b.lo) * i / (NV - 1) });
    const per = pool.map(() => []);
    jobs.forEach((j, i) => per[i % pool.length].push(j));
    let pending = per.filter(js => js.length).length;
    const all = [];
    emit("progress", 0.02, "Sweeping design values…");
    per.forEach((js, wi) => {
      if (!js.length) return;
      const w = pool[wi];
      w.onmessage = e => {
        const m = e.data;
        if (m.id !== cur.id || m.type !== "sweep") { if (m.type === "error") emit("error", m.msg); return; }
        all.push(...m.out);
        emit("progress", 0.25 * (1 - --pending / per.length), "Sweeping design values…");
        if (pending) return;
        const sc = o => o.frac[2] * 100 + o.frac[1] * 10 + o.frac[0];
        for (const b of opt) {
          const pts = all.filter(o => o.key === b.k).sort((a, c) => a.value - c.value);
          let best = pts[0];
          for (const o of pts) if (sc(o) > sc(best) + 1e-9) best = o;
          cur.chosen[b.k] = best.value; cur.sweeps[b.k] = pts; cur.P[b.k] = best.value;
        }
        emit("sweeps", cur);
        resolve();
      };
      w.postMessage({ type: "sweep", id: cur.id, P: cur.P, jobs: js, res: 12 });
    });
  });
}

/* Every pass is split into chunks, coarse lattice first so a rough map appears quickly;
   each worker pulls the next chunk when it finishes one. */
function mapAll(cur) {
  const n = cur.xs.length, passes = passesFor(cur.P, cur.mixed), queue = [];
  for (const p of passes) {
    cur.passes[p.key] = Array.from({ length: n }, () => new Array(n).fill(null));
    const coarse = [], fine = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ((i % 3 === 0 && j % 3 === 0) ? coarse : fine).push([i, j, cur.xs[i], cur.ys[j]]);
    for (const list of [coarse, fine]) for (let k = 0; k < list.length; k += CHUNK) queue.push({ pass: p.key, P: p.P, pts: list.slice(k, k + CHUNK) });
  }
  const left = Object.fromEntries(passes.map(p => [p.key, n * n]));
  const total = passes.length * n * n;
  let doneN = 0, busy = 0;
  const feed = w => {
    const job = queue.shift();
    if (!job) return false;
    w.postMessage({ type: "pts", id: cur.id, pass: job.pass, P: job.P, pts: job.pts });
    return true;
  };
  emit("progress", 0.3, "Mapping the field…");
  for (const w of pool) {
    w.onmessage = e => {
      const m = e.data;
      if (m.id !== cur.id) return;
      if (m.type === "error") { emit("error", m.msg); return; }
      if (m.type !== "pts") return;
      const g = cur.passes[m.pass];
      for (const [i, j, o] of m.out) g[j][i] = o;
      doneN += m.out.length;
      left[m.pass] -= m.out.length;
      if (left[m.pass] === 0) { cur.passDone[m.pass] = true; emit("passDone", cur, m.pass); }
      emit("cells", cur, m.pass);
      emit("progress", 0.3 + 0.7 * doneN / total, `Mapping the field… ${Math.round(100 * doneN / total)}%`);
      if (m.done && !feed(w) && --busy === 0) { cur.done = true; emit("done", cur); }
    };
    if (feed(w)) busy++;
  }
}

/* ---------- geometry, inspection, per-spot solving, calibration ---------- */
function requestGeom(P) {
  const w = mk();
  w.onmessage = e => { if (e.data.type === "geom") emit("geom", e.data.g); w.terminate(); };
  w.postMessage({ type: "geom", id: 0, P });
}

let probeW = mk(), probeBusy = false, probePending = null;
export function requestProbe(p) { probePending = p; pumpProbe(); }
function pumpProbe() {
  const cur = run.current;
  if (probeBusy || !probePending || !cur) return;
  const p = probePending; probePending = null; probeBusy = true;
  probeW.postMessage({ type: "probe", id: keyOf(p), P: cur.P, x: p.x, y: p.y });
}
probeW.onmessage = e => {
  probeBusy = false;
  const m = e.data;
  if (m.type === "probe") emit("probe", m.id, m.d);
  else if (m.type === "error") emit("error", m.msg);
  pumpProbe();
};
export const keyOf = p => (run.current ? run.current.id : 0) + ":" + p.x.toFixed(2) + "," + p.y.toFixed(2);

let solveW = mk(), solveBusy = false;
export function requestSolve(p) {
  const cur = run.current;
  if (!cur) return;
  const jobs = cur.blanks.map(b => ({ key: b.k, lo: b.lo, hi: b.hi }));
  const key = keyOf(p);
  emit("solveStart", key, jobs.length > 0);
  if (!jobs.length) return;
  if (solveBusy) { solveW.terminate(); solveW = mk(); }
  solveBusy = true;
  solveW.onmessage = e => {
    const m = e.data;
    if (m.type === "error") { solveBusy = false; emit("error", m.msg); return; }
    if (m.type === "solvePart") emit("solvePart", m.id, m.part);
    if (m.type === "solveDone") { solveBusy = false; emit("solveDone", m.id); }
  };
  solveW.postMessage({ type: "solve", id: key, P: cur.P, x: p.x, y: p.y, jobs });
}

export function requestCalibration(P, shots, keys) {
  return new Promise((resolve, reject) => {
    const w = mk();
    w.onerror = e => { e.preventDefault(); w.terminate(); reject(new Error(e.message || "The planner engine could not start")); };
    w.onmessage = e => {
      if (e.data.type === "calibrated") resolve(e.data.fit);
      else if (e.data.type === "error") reject(new Error(e.data.msg));
      w.terminate();
    };
    w.postMessage({ type: "calibrate", id: 0, P, shots, keys });
  });
}
