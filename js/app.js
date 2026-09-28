/* HIVE Shot Planner: wires settings, the engine runner, the map, readout, summary and dialogs. */
import { GROUPS, FIELDS, BALLS, state, saveVals, savePrefs, parseVal, toDisplay, fromDisplay, unitLabel, esc, outOfLimits,
  BUILTIN, presets, savePreset, deletePreset, applyValues, shareUrl, readShareHash, tipped } from "./state.js";
import { on, run, startRun, requestProbe, requestSolve, keyOf } from "./runner.js";
import { initMap, setGeom, drawAll, drawOverlay, view, LAYERS, snapshotA, toggleLevel } from "./map.js";
import { initSide, setSideGeom, playFlight, playTip } from "./side.js";
import { initReadout, renderReadout, setSolves } from "./readout.js";
import { renderSummary } from "./summary.js";
import { toCsv, toJson, toJava, download } from "./export.js";
import { initCalibrate, bindCalibrate, openCalibrate } from "./calibrate.js";

const $ = (s, r = document) => r.querySelector(s);
let GEOM = null;

/* ---------------- settings panel ---------------- */
function fieldRow(f) {
  const idn = "in-" + f.k;
  if (f.type === "check") return `<div class="row check" id="row-${f.k}"><input type="checkbox" id="${idn}"${state.vals[f.k] ? " checked" : ""}><label for="${idn}">${esc(f.label)}</label></div>`;
  if (f.type === "select") return `<div class="row wide" id="row-${f.k}"><label for="${idn}">${esc(f.label)}</label><select id="${idn}">${f.options.map(o => `<option value="${o[0]}"${state.vals[f.k] === o[0] ? " selected" : ""}>${esc(o[1])}</option>`).join("")}</select></div>`;
  const ph = f.kind === "shot" ? "solve" : f.solve === false ? String(f.def) : "solve";
  return `<div class="row" id="row-${f.k}"><label for="${idn}">${esc(f.label)}${f.sub ? `<small>${esc(f.sub)}</small>` : ""}</label>
    <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="${idn}" placeholder="${esc(ph)}" value="${esc(toDisplay(f, state.vals[f.k]))}"><span class="unit">${esc(unitLabel(f))}</span></div>`;
}
function buildInputs() {
  const host = $("#inputs"), simple = state.prefs.mode === "simple";
  let h = "";
  if (simple) {
    const essentials = GROUPS.flatMap(g => g.fields.filter(f => f.simple));
    h = `<section class="grp panel open"><div class="grp-h"><span>Essentials</span></div><p class="grp-note">${esc(GROUPS[0].note)}</p><div class="rows">${essentials.map(fieldRow).join("")}</div></section>`;
  } else {
    for (const g of GROUPS) {
      h += `<details class="grp panel" id="grp-${g.id}"${g.open ? " open" : ""}><summary class="grp-h"><span>${esc(g.title)}</span><span class="chipct" id="ct-${g.id}" hidden></span></summary>
        ${g.note ? `<p class="grp-note">${esc(g.note)}</p>` : ""}<div class="rows">${g.fields.map(fieldRow).join("")}</div></details>`;
    }
  }
  h += `<div class="panel foot"><div class="legend-ins"><span><b>40-75</b> adjustable range</span><span><b>blank</b> solve for it</span><span><b>14</b> fixed value</span></div>
    <div class="foot-btns"><button class="chip" type="button" id="modeBtn">${simple ? "Show all settings" : "Essentials only"}</button><button class="chip" type="button" id="reset">Reset all</button></div></div>`;
  host.innerHTML = h;
  Object.values(FIELDS).forEach(markRow);
  updateCounts();
}
function markRow(f) {
  const r = $("#row-" + f.k);
  if (!r || f.type) return;
  const p = parseVal(state.vals[f.k]);
  r.classList.toggle("solve", p.mode === "blank" && f.solve !== false);
  r.classList.toggle("range", p.mode === "range");
  const past = outOfLimits(f, state.vals[f.k]);
  r.classList.toggle("bad", p.mode === "bad" || past || (p.mode === "range" && f.kind !== "shot" && f.solve === false));
  const input = r.querySelector("input");
  if (input) input.title = past ? `Allowed: ${toDisplay(f, f.lo)} to ${toDisplay(f, f.hi)} ${unitLabel(f)}. The map uses the nearest limit.` : "";
}
function updateCounts() {
  for (const g of GROUPS) {
    const el = $("#ct-" + g.id);
    if (!el) continue;
    const n = g.fields.filter(f => !f.type && f.solve !== false && ["blank", "range"].includes(parseVal(state.vals[f.k]).mode)).length;
    el.hidden = !n; el.textContent = `${n} to solve`;
  }
}
function bindInputs() {
  const host = $("#inputs");
  host.addEventListener("input", e => {
    const t = e.target, k = t.id?.replace(/^in-/, "");
    if (!(k in FIELDS)) return;
    const f = FIELDS[k];
    if (f.type === "check") state.vals[k] = t.checked;
    else if (f.type === "select") {
      if (k === "ballType" && t.value !== "mixed") {
        const prev = BALLS[state.vals.ballType] || BALLS.nectar, next = BALLS[t.value];
        for (const key of ["ballD", "ballM"]) if (Number(state.vals[key]) === prev[key] || String(state.vals[key]).trim() === "") state.vals[key] = String(next[key]);
        if ($("#in-ballD")) { $("#in-ballD").value = toDisplay(FIELDS.ballD, state.vals.ballD); $("#in-ballM").value = state.vals.ballM; }
      }
      state.vals[k] = t.value;
    } else state.vals[k] = fromDisplay(f, t.value);
    markRow(f); changed();
  });
  host.addEventListener("click", e => {
    if (e.target.id === "modeBtn") { state.prefs.mode = state.prefs.mode === "simple" ? "advanced" : "simple"; savePrefs(); buildInputs(); }
    if (e.target.id === "reset") { applyValues({}); buildInputs(); changed(); }
  });
}

let debounce = 0;
function changed() {
  saveVals(); updateCounts();
  clearTimeout(debounce);
  debounce = setTimeout(startRun, 350);
}

/* ---------------- top bar: presets, share, export, units, calibrate ---------------- */
function renderPresets() {
  const saved = presets(), sel = $("#preset");
  sel.innerHTML = `<option value="">Presets…</option><optgroup label="Starting points">${Object.keys(BUILTIN).map(n => `<option value="b:${esc(n)}">${esc(n)}</option>`).join("")}</optgroup>`
    + (Object.keys(saved).length ? `<optgroup label="Saved">${Object.keys(saved).map(n => `<option value="s:${esc(n)}">${esc(n)}</option>`).join("")}</optgroup>` : "")
    + `<optgroup label="Manage"><option value="save">Save current as…</option>${Object.keys(saved).length ? '<option value="delete">Delete a saved preset…</option>' : ""}<option value="import">Import from file…</option><option value="exportcfg">Export settings file</option></optgroup>`;
}
function bindTopBar() {
  $("#preset").addEventListener("change", e => {
    const v = e.target.value; e.target.value = "";
    const after = () => { buildInputs(); changed(); toast("Preset loaded"); };
    if (v.startsWith("b:")) { applyValues(BUILTIN[v.slice(2)]); after(); }
    else if (v.startsWith("s:")) { applyValues(presets()[v.slice(2)] || {}); after(); }
    else if (v === "save") { const name = prompt("Name this preset"); if (name && name.trim()) { savePreset(name.trim().slice(0, 40)); renderPresets(); toast(`Saved “${name.trim()}”`); } }
    else if (v === "delete") { const name = prompt("Delete which preset?\n" + Object.keys(presets()).join("\n")); if (name && presets()[name]) { deletePreset(name); renderPresets(); toast(`Deleted “${name}”`); } }
    else if (v === "import") $("#importFile").click();
    else if (v === "exportcfg") download("hive-planner-settings.json", JSON.stringify({ tool: "Raptoria HIVE Shot Planner", values: state.vals }, null, 1), "application/json");
  });
  $("#importFile").addEventListener("change", async e => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    try { const data = JSON.parse(await file.text()); applyValues(data.values || data); buildInputs(); changed(); toast("Settings imported"); }
    catch { toast("That file isn't a planner settings file"); }
  });
  $("#shareBtn").addEventListener("click", async () => {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); toast("Link copied: it opens with these settings"); }
    catch { prompt("Copy this link", url); }
  });
  $("#exportSel").addEventListener("change", e => {
    const v = e.target.value; e.target.value = "";
    const far = run.current?.P.raised !== "aud";
    const out = v === "csv" ? toCsv() : v === "json" ? toJson() : v === "java" ? toJava() : null;
    if (!out) { if (v) toast("Wait for the map to finish"); return; }
    const name = v === "java" ? `HiveShotTable${far ? "Far" : "Audience"}.java` : `hive-shots-${far ? "far" : "audience"}.${v}`;
    download(name, out, v === "json" ? "application/json" : "text/plain");
  });
  $("#units").addEventListener("click", () => { state.prefs.units = state.prefs.units === "in" ? "cm" : "in"; savePrefs(); $("#units").textContent = state.prefs.units; buildInputs(); renderReadout(); });
  $("#units").textContent = state.prefs.units;
  $("#calBtn").addEventListener("click", openCalibrate);
}

/* ---------------- map controls ---------------- */
function renderLayerTabs() {
  $("#layers").innerHTML = LAYERS.map(l => `<button type="button" data-l="${l.id}" aria-pressed="${state.prefs.layer === l.id}">${esc(l.label)}</button>`).join("");
}
function bindMapControls() {
  $("#layers").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.prefs.layer = b.dataset.l; savePrefs(); renderLayerTabs(); drawAll();
  });
  $("#contours").checked = !!state.prefs.contours;
  $("#contours").addEventListener("change", e => { state.prefs.contours = e.target.checked; savePrefs(); drawAll(); });
  $("#snapA").addEventListener("click", () => {
    if (snapshotA()) { state.prefs.layer = "cmp"; savePrefs(); renderLayerTabs(); drawAll(); toast("Snapshot A saved: change settings to compare"); }
    else toast("Wait for the map to finish");
  });
  $("#legend").addEventListener("click", e => { const b = e.target.closest("[data-level]"); if (b) toggleLevel(+b.dataset.level); });
}

/* ---------------- inspection ---------------- */
let solves = null, restT = 0;
const active = () => view.hover || view.pin;
function inspect(withSolve) {
  requestProbe(active());
  renderReadout(); drawOverlay();
  clearTimeout(restT);
  if (withSolve) restT = setTimeout(() => requestSolve(active()), 450);
}
function bindReadoutButtons() {
  $("#out").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "replay") playFlight();
    if (b.dataset.act === "tip") {
      playTip(() => {
        state.vals = tipped(state.vals);
        for (const k of ["raised", "otherRaised"]) { const s = $("#in-" + k); if (s) s.value = state.vals[k]; }
        saveVals(); startRun(); toast("HIVE tipped: now aiming at the other CELL");
      });
    }
    if (b.dataset.act === "3d" && GEOM && run.current) {
      $("#view3d").showModal();
      const { open3d } = await import("./view3d.js");
      open3d($("#stage3d"), GEOM, view.detail, run.current.P, view.pin);
    }
  });
  $("#view3d").addEventListener("click", async e => {
    const act = e.target.dataset.act;
    if (act === "close3d") { $("#view3d").close(); (await import("./view3d.js")).close3d(); }
    if (act === "replay3d") (await import("./view3d.js")).replay3d();
  });
}

/* ---------------- runner events ---------------- */
function bindRunner() {
  on("start", () => { view.detail = null; renderSummary($("#cov")); drawAll(); inspect(true); });
  on("geom", g => { GEOM = g; setGeom(g); setSideGeom(g, run.current.P); renderReadout(); });
  let cellsQueued = false;
  on("cells", () => { if (cellsQueued) return; cellsQueued = true; requestAnimationFrame(() => { cellsQueued = false; drawAll(); if (!view.detail) renderReadout(); }); });
  on("passDone", () => { renderSummary($("#cov")); drawAll(); });
  on("done", () => { renderSummary($("#cov")); status("Map ready", 1); setTimeout(() => status("Map ready", null), 900); });
  on("sweeps", () => renderSummary($("#cov")));
  on("progress", (f, t) => status(t, f));
  on("error", msg => { status("Engine error: " + String(msg).split("\n")[0], null); console.error(msg); });
  on("probe", (id, d) => {
    if (id !== keyOf(active())) return;
    const fresh = !view.detail || view.detail.x !== d.x || view.detail.y !== d.y;
    view.detail = d;
    renderReadout();
    if (fresh && !view.hover) playFlight(); else drawOverlay();
  });
  on("solveStart", (key, pending) => { solves = { key, parts: {}, pending }; setSolves(solves); renderReadout(); });
  on("solvePart", (key, part) => { if (solves && solves.key === key) { solves.parts[part.key] = part; renderReadout(); } });
  on("solveDone", key => { if (solves && solves.key === key) { solves.pending = false; renderReadout(); } });
}

function status(text, frac) {
  $("#stat").textContent = text;
  $("#prog").style.transform = `scaleX(${frac == null ? 0 : frac})`;
}
let toastT = 0;
function toast(text) {
  const t = $("#toast");
  t.textContent = text; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------------- calibration apply ---------------- */
function applyCalibration(values, lowerAero) {
  for (const k of ["eff", "cd", "magnus"]) if (k in values) state.vals[k] = String(+values[k].toFixed(k === "eff" ? 1 : 3));
  if (lowerAero) state.vals.eAero = "5";
  buildInputs(); changed();
  toast("Calibration applied");
}

/* ---------------- boot ---------------- */
const shared = readShareHash();
if (shared) { applyValues(shared); history.replaceState(null, "", location.pathname); }
buildInputs(); bindInputs();
renderPresets(); bindTopBar();
renderLayerTabs(); bindMapControls();
initMap({ wrap: $("#fw"), base: $("#base"), heat: $("#heat"), ov: $("#ov"), tip: $("#tip"), legend: $("#legend") },
  { pin: () => inspect(true), hover: () => inspect(false) });
initSide(null, drawOverlay);
initReadout($("#out"));
initCalibrate($("#calib"), applyCalibration); bindCalibrate();
bindReadoutButtons();
bindRunner();
startRun();
if (shared) toast("Opened with shared settings");
