/* Settings: the field schema, the current values, parsing, units, presets and share links.
   Values are kept as the strings a person typed, in canonical units (inches, degrees, rpm). */

export const BALLS = { nectar: { ballD: 3.6, ballM: 41.3 }, pollen: { ballD: 2.8, ballM: 24.9 } };
/* Settings after your HIVE tips: its raised CELL swaps and the other HIVE stays put. The other
   HIVE is set relative to yours, so its setting swaps too. */
export const tipped = v => ({ ...v, raised: v.raised === "far" ? "aud" : "far", otherRaised: v.otherRaised === "same" ? "opposite" : "same" });

/* simple: shown in Simple mode. pol (for blanks): opt = sweep across the field for best coverage,
   lim = find the most error you can afford, val = solve at the inspected spot. */
export const GROUPS = [
  { id: "shot", title: "Shot", open: true,
    note: "One value fixes it, a range like 40-75 lets the robot adjust it, blank solves for it.",
    fields: [
      { k: "hood", kind: "shot", simple: true, label: "Hood angle", sub: "above horizontal", unit: "°", def: "30-75" },
      { k: "rpm", kind: "shot", simple: true, label: "Flywheel speed", sub: "blank = solve up to the max", unit: "rpm", def: "" },
    ] },
  { id: "fly", title: "Shooter & flywheel", open: true, fields: [
      { k: "launchH", simple: true, label: "Exit height", sub: "ball center at release", unit: "in", def: 14, lo: 4, hi: 30, pol: "opt" },
      { k: "wheelD", simple: true, label: "Flywheel diameter", unit: "in", def: 4, lo: 2, hi: 6, pol: "opt" },
      { k: "rpmCap", simple: true, label: "Max flywheel speed", sub: "what the motor holds under load", unit: "rpm", def: 6000, lo: 1000, hi: 12000, pol: "val" },
      { k: "exitFwd", label: "Exit ahead of robot center", unit: "in", def: 0, lo: -9, hi: 9, pol: "opt" },
      { k: "exitLat", label: "Exit left of robot center", unit: "in", def: 0, lo: -9, hi: 9, pol: "opt" },
      { k: "topRatio", label: "Hood surface speed", sub: "0 = fixed hood, 1 = matched top wheel", unit: "×", def: 0, lo: 0, hi: 1, pol: "opt" },
      { k: "compression", label: "Ball compression", sub: "squeeze between wheel and hood", unit: "in", def: 0.4, lo: 0.05, hi: 1.2, pol: "opt" },
      { k: "wheelShare", label: "Compression taken by wheel", sub: "0 for a rigid wheel", unit: "%", def: 20, lo: 0, hi: 100, pol: "val" },
      { k: "gripOnset", label: "Grip builds by", sub: "compression where slip mostly stops", unit: "in", def: 0.08, lo: 0.01, hi: 0.5, pol: "val" },
      { k: "eff", label: "Transfer efficiency", sub: "calibrate from test shots", unit: "%", def: 85, lo: 30, hi: 100, pol: "val" },
      { k: "inertia", label: "Flywheel inertia", sub: "all spinning parts", unit: "lb·in²", def: 4, lo: 0.5, hi: 30, pol: "opt" },
      { k: "sag", type: "check", label: "Speed is set before the shot, so it dips as the ball takes energy", def: true },
    ] },
  { id: "burst", title: "Burst", open: false,
    note: "Several balls fired back to back. Each one takes speed out of the flywheel.",
    fields: [
      { k: "burstN", label: "Balls per burst", unit: "", def: 3, lo: 1, hi: 6, solve: false },
      { k: "burstGap", label: "Time between balls", unit: "ms", def: 250, lo: 50, hi: 1000, pol: "lim" },
      { k: "recover", label: "Flywheel recovery", sub: "rpm regained per second at speed", unit: "rpm/s", def: 4000, lo: 200, hi: 20000, pol: "val" },
    ] },
  { id: "ball", title: "Ball & air", open: false, fields: [
      { k: "ballType", type: "select", simple: true, label: "Scoring element", def: "nectar", options: [["nectar", "NECTAR · 3.6 in · 41 g"], ["pollen", "POLLEN · 2.8 in · 25 g"], ["mixed", "Both · spot must work for each"]] },
      { k: "ballD", label: "Diameter", unit: "in", def: 3.6, lo: 2.5, hi: 4.2, pol: "val" },
      { k: "ballM", label: "Mass", sub: "AndyMark: 0.091 lb NECTAR, 0.055 lb POLLEN", unit: "g", def: 41.3, lo: 10, hi: 90, pol: "val" },
      { k: "cd", label: "Drag coefficient", sub: "calibrate from test shots", unit: "", def: 0.5, lo: 0.15, hi: 1.2, pol: "val" },
      { k: "magnus", label: "Backspin lift scale", sub: "1 = standard sphere, 0 = off", unit: "×", def: 1, lo: 0, hi: 2, pol: "val" },
      { k: "cor", label: "Bounciness", sub: "drop from 36 in: √(rebound ÷ 36)", unit: "", def: 0.5, lo: 0, hi: 0.95, pol: "val" },
      { k: "corT", label: "Speed kept along a panel", sub: "per impact inside the CELL", unit: "", def: 0.8, lo: 0, hi: 1, pol: "val" },
      { k: "rhoAir", label: "Air density", unit: "kg/m³", def: 1.2, lo: 1.0, hi: 1.3, pol: "val" },
    ] },
  { id: "robot", title: "Robot motion at the shot", open: false, fields: [
      { k: "robotSize", label: "Robot footprint", sub: "square, for keep-out", unit: "in", def: 18, lo: 12, hi: 18, solve: false },
      { k: "speed", label: "Driving speed", unit: "in/s", def: 0, lo: 0, hi: 80, pol: "lim" },
      { k: "dirMode", type: "select", label: "Direction is", def: "rel", options: [["rel", "relative to the target"], ["field", "a fixed field direction"], ["unknown", "unknown (any direction)"]] },
      { k: "dirAngle", label: "Direction", sub: "target: 0 = toward it, 90 = strafing left · field: 0 = toward blue", unit: "°", def: 90, lo: 0, hi: 360, pol: "val" },
      { k: "rot", label: "Turning rate", sub: "+ is counter-clockwise", unit: "°/s", def: 0, lo: 0, hi: 360, pol: "lim" },
      { k: "comp", type: "check", label: "Shooter compensates for motion (leads the shot)", def: true },
    ] },
  { id: "game", title: "Game & strategy", open: false,
    note: "Used for the tip-proof and points-per-second layers. Set balls to tip from your own testing.",
    fields: [
      { k: "ballsToTip", label: "Balls to tip a HIVE", unit: "", def: 5, lo: 1, hi: 20, solve: false },
      { k: "intakeTime", label: "Reload time", sub: "collecting a burst's worth of balls", unit: "s", def: 3, lo: 0, hi: 20, solve: false },
      { k: "driveSpeed", label: "Driving speed between spots", unit: "in/s", def: 45, lo: 10, hi: 120, solve: false },
      { k: "tipProof", type: "check", label: "Also map the other raised CELL (for tip-proof spots)", def: true },
    ] },
  { id: "acc", title: "Accuracy (±)", open: false,
    note: "How far each input can be off, shot to shot. Blank finds the most error you can afford at the inspected spot.",
    fields: [
      { k: "eHood", label: "Hood angle", unit: "°", def: 0.5, lo: 0, hi: 3, pol: "lim" },
      { k: "eHead", label: "Aim heading", unit: "°", def: 0.5, lo: 0, hi: 3, pol: "lim" },
      { k: "eRpm", label: "Flywheel speed control", unit: "rpm", def: 30, lo: 0, hi: 200, pol: "lim" },
      { k: "eSpd", label: "Ball-to-ball exit speed", sub: "compression, wear, ball variation", unit: "%", def: 2, lo: 0, hi: 8, pol: "lim" },
      { k: "eH", label: "Exit height", unit: "in", def: 0.25, lo: 0, hi: 1.5, pol: "lim" },
      { k: "ePos", label: "Robot position (each axis)", sub: "localization", unit: "in", def: 1, lo: 0, hi: 4, pol: "lim" },
      { k: "eVel", label: "Velocity estimate", sub: "only used when compensating", unit: "in/s", def: 3, lo: 0, hi: 15, pol: "lim" },
      { k: "eRot", label: "Turn-rate estimate", sub: "only used when compensating", unit: "°/s", def: 5, lo: 0, hi: 30, pol: "lim" },
      { k: "eTime", label: "Release timing", unit: "ms", def: 10, lo: 0, hi: 50, pol: "lim" },
      { k: "eAero", label: "Drag and lift model", sub: "lower it after calibrating", unit: "%", def: 20, lo: 0, hi: 50, pol: "lim" },
      { k: "eMass", label: "Ball mass", unit: "%", def: 5, lo: 0, hi: 20, pol: "lim" },
      { k: "eDia", label: "Ball diameter", unit: "in", def: 0.05, lo: 0, hi: 0.3, pol: "lim" },
      { k: "eField", label: "Field build (manual: ±1 in)", unit: "in", def: 1, lo: 0, hi: 2, pol: "lim" },
      { k: "kSigma", label: "Tolerances above cover", sub: "2 means about 95% of shots", unit: "σ", def: 2, lo: 1, hi: 3, solve: false },
      { k: "likelyThr", label: "Likely means at least", unit: "%", def: 70, lo: 30, hi: 99, solve: false },
      { k: "guarRule", type: "select", label: "Guaranteed means", def: "stat", options: [["stat", "3σ spread fits (≈99.7%)"], ["strict", "every error at its limit"]] },
    ] },
  { id: "field", title: "Target & field", open: false,
    note: "Defaults from BIOBUZZ Section 9 (TU02). Blank fields fall back to them.",
    fields: [
      { k: "hive", type: "select", simple: true, label: "Your HIVE", def: "red", options: [["red", "Red"], ["blue", "Blue"]] },
      { k: "raised", type: "select", simple: true, label: "Raised CELL", def: "far", options: [["far", "far side (tags 30–33 / 42–45)"], ["aud", "audience side (34–37 / 38–41)"]] },
      { k: "otherRaised", type: "select", label: "Other HIVE raised CELL", def: "opposite", options: [["opposite", "opposite side"], ["same", "same side"]] },
      { k: "res", type: "select", label: "Map detail", def: "auto", options: [["auto", "automatic"], ["6", "6 in (fast)"], ["4", "4 in"], ["3", "3 in (slow)"]] },
      { k: "pivotZ", label: "Pivot height", unit: "in", def: 43.95, lo: 30, hi: 60, solve: false },
      { k: "tilt", label: "HIVE tilt", unit: "°", def: 30, lo: 10, hi: 50, solve: false },
      { k: "mouthZ", label: "Bottom of opening", unit: "in", def: 53.5, lo: 40, hi: 70, solve: false },
      { k: "openW", label: "Opening width", unit: "in", def: 20, lo: 10, hi: 30, solve: false },
      { k: "openShoulder", label: "Opening side height", unit: "in", def: 7.61, lo: 3, hi: 14, solve: false },
      { k: "openPeak", label: "Opening peak height", unit: "in", def: 14, lo: 6, hi: 20, solve: false },
      { k: "lip", label: "Extra rim clearance", unit: "in", def: 0, lo: 0, hi: 2, solve: false },
      { k: "cellGap", label: "Gap between CELLS", unit: "in", def: 18.84, lo: 10, hi: 30, solve: false },
      { k: "cellDepth", label: "CELL depth", unit: "in", def: 12.04, lo: 6, hi: 20, solve: false },
      { k: "hiveSep", label: "HIVE center to center", unit: "in", def: 25.5, lo: 20, hi: 40, solve: false },
      { k: "frameW", label: "Frame width", unit: "in", def: 49.46, lo: 30, hi: 70, solve: false },
      { k: "frameD", label: "Frame depth", unit: "in", def: 38.95, lo: 20, hi: 60, solve: false },
    ] },
];

export const FIELDS = {};
GROUPS.forEach(g => g.fields.forEach(f => { FIELDS[f.k] = f; f.group = g.id; }));

const STORE = "hive-planner-v2", PRESETS = "hive-planner-presets", PREFS = "hive-planner-prefs";
const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Values from share links, imported files and storage are untrusted: only known settings are
   kept, selects keep only their listed options, checkboxes are true or false, and text is capped. */
const MAX_TEXT = 32;
const isPlain = o => !!o && typeof o === "object" && !Array.isArray(o);
function cleanVal(f, v) {
  if (f.type === "select") return f.options.some(o => o[0] === v) ? v : String(f.def);
  if (f.type === "check") return v === true;
  return String(v ?? "").slice(0, MAX_TEXT);
}
export function cleanVals(obj) {
  const out = {};
  if (!isPlain(obj)) return out;
  for (const [k, v] of Object.entries(obj)) if (Object.hasOwn(FIELDS, k)) out[k] = cleanVal(FIELDS[k], v);
  return out;
}
function cleanPrefs(p) {
  const v = isPlain(p) ? p : {};
  return { ...v, mode: v.mode === "advanced" ? "advanced" : "simple", units: v.units === "cm" ? "cm" : "in",
    layer: typeof v.layer === "string" ? v.layer : "level", contours: v.contours !== false };
}

export function defaults() {
  const v = {};
  for (const f of Object.values(FIELDS)) v[f.k] = f.type === "check" ? !!f.def : String(f.def);
  return v;
}
export const state = { vals: { ...defaults(), ...cleanVals(read(STORE, {})) }, prefs: cleanPrefs(read(PREFS, {})) };
export const saveVals = () => write(STORE, state.vals);
export const savePrefs = () => write(PREFS, state.prefs);

/* ---------- parsing ---------- */
export function parseVal(raw) {
  const t = String(raw ?? "").trim();
  if (t === "") return { mode: "blank" };
  const m = t.match(/^(-?\d*\.?\d+)\s*(?:-|–|—|\.\.|to)\s*(-?\d*\.?\d+)$/i);
  if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; return { mode: "range", lo: a, hi: b }; }
  const n = Number(t);
  return Number.isFinite(n) ? { mode: "fixed", v: n } : { mode: "bad" };
}
/* Every number setting has limits; values past them are flagged in the panel and clamped for the engine. */
const RPM_MAX = 20000;
const clampTo = (f, v) => Math.min(Math.max(v, f.lo), f.hi);
export function outOfLimits(f, raw) {
  const p = parseVal(raw);
  if (f.type || f.kind === "shot" || f.lo === undefined) return false;
  return p.mode === "fixed" ? p.v < f.lo || p.v > f.hi : p.mode === "range" ? p.lo < f.lo || p.hi > f.hi : false;
}

/* ---------- units: inch fields can be shown and typed in centimetres ---------- */
const CM = 2.54;
export const showsCm = f => state.prefs.units === "cm" && (f.unit === "in" || f.unit === "in/s");
export const unitLabel = f => showsCm(f) ? f.unit.replace("in", "cm") : (f.unit || "");
const scaleText = (text, k) => {
  const p = parseVal(text);
  const r = v => String(Math.round(v * k * 1000) / 1000);
  return p.mode === "fixed" ? r(p.v) : p.mode === "range" ? `${r(p.lo)}-${r(p.hi)}` : text;
};
export const toDisplay = (f, raw) => showsCm(f) ? scaleText(raw, CM) : String(raw ?? "");
export const fromDisplay = (f, typed) => showsCm(f) ? scaleText(typed, 1 / CM) : typed;
export const lengthOut = (inches, d = 1) => state.prefs.units === "cm" ? `${(inches * CM).toFixed(d)} cm` : `${inches.toFixed(d)} in`;

/* ---------- engine parameters ---------- */
/* Numbers for the map (P) plus the blanks and ranges to solve for. */
export function collect(vals = state.vals) {
  const P = {}, blanks = [];
  for (const f of Object.values(FIELDS)) {
    if (f.type === "check") { P[f.k] = !!vals[f.k]; continue; }
    if (f.type === "select") { P[f.k] = vals[f.k]; continue; }
    const p = parseVal(vals[f.k]);
    if (f.kind === "shot") {
      let spec = p.mode === "fixed" ? { mode: "fixed", v: p.v } : p.mode === "range" ? { mode: "range", lo: p.lo, hi: p.hi } : { mode: "free" };
      if (f.k === "hood") {
        if (spec.mode === "fixed") spec.v = Math.min(Math.max(spec.v, 1), 89);
        if (spec.mode === "range") { spec.lo = Math.max(spec.lo, 1); spec.hi = Math.min(Math.max(spec.hi, spec.lo), 89); }
      }
      if (f.k === "rpm") {
        if (spec.mode === "fixed") spec.v = Math.min(Math.max(spec.v, 1), RPM_MAX);
        if (spec.mode === "range") { spec.lo = Math.max(spec.lo, 0); spec.hi = Math.min(Math.max(spec.hi, spec.lo), RPM_MAX); }
      }
      P[f.k + "Spec"] = spec; continue;
    }
    if (p.mode === "fixed") { P[f.k] = clampTo(f, p.v); continue; }
    if ((p.mode === "blank" || p.mode === "range") && f.solve !== false) {
      const lo = p.mode === "range" ? clampTo(f, p.lo) : f.lo, hi = p.mode === "range" ? clampTo(f, p.hi) : f.hi;
      blanks.push({ k: f.k, lo, hi, pol: f.pol || "val", given: p.mode === "range" });
      P[f.k] = Math.min(Math.max(Number(f.def), lo), hi);
      continue;
    }
    P[f.k] = Number(f.def);
  }
  const ball = P.ballType === "mixed" ? "pollen" : P.ballType;
  if (P.ballType === "mixed") Object.assign(P, BALLS.pollen);
  P.ballType = ball;
  P.res = P.res === "auto" ? autoRes() : Number(P.res);
  return { P, blanks, mixed: vals.ballType === "mixed" };
}
function autoRes() {
  const cores = navigator.hardwareConcurrency || 4, narrow = matchMedia("(max-width: 700px)").matches;
  return narrow || cores <= 4 ? 6 : 4;
}

/* ---------- presets ---------- */
export const BUILTIN = {
  "Default": {},
  "Low, compact shooter": { launchH: "10", wheelD: "3", rpmCap: "5000", inertia: "2" },
  "Tall shooter, heavy wheel": { launchH: "20", wheelD: "4", inertia: "12", rpmCap: "5000" },
  "Shoot on the move": { speed: "30", dirMode: "rel", dirAngle: "90", comp: true },
};
export const presets = () => ({ ...read(PRESETS, {}) });
export function savePreset(name) { const all = presets(); all[name] = changedVals(); write(PRESETS, all); }
export function deletePreset(name) { const all = presets(); delete all[name]; write(PRESETS, all); }
export function applyValues(partial) { state.vals = { ...defaults(), ...cleanVals(partial) }; saveVals(); }
export function changedVals() {
  const d = defaults(), out = {};
  for (const [k, v] of Object.entries(state.vals)) if (v !== d[k]) out[k] = v;
  return out;
}

/* ---------- share links: #cfg=<base64url JSON of changed values> ---------- */
const MAX_HASH = 4000;
export function shareUrl() {
  const bytes = new TextEncoder().encode(JSON.stringify(changedVals()));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}${location.pathname}#cfg=${b64}`;
}
export function readShareHash() {
  const m = location.hash.match(/cfg=([\w-]+)/);
  if (!m || m[1].length > MAX_HASH) return null;
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch { return null; }
}
