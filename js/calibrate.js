/* Calibration dialog: measured test shots in, fitted shooter physics out.
   Shots are kept in this browser (hive-planner-shots). */
import { collect, state, esc } from "./state.js";
import { requestCalibration } from "./runner.js";

const KEY = "hive-planner-shots";
const KEYS = [["eff", "Transfer efficiency", "%"], ["cd", "Drag coefficient", ""], ["magnus", "Backspin lift scale", "×"], ["hoodOffset", "Hood offset", "°"]];
// The fit's allowed ranges (match FIT_RANGE in hive-engine.js); a value pinned at an edge means the data disagree with the model.
const LIMITS = { eff: [30, 100], cd: [0.15, 1.2], magnus: [0, 2], hoodOffset: [-10, 10] };
const atLimit = (k, v) => Math.abs(v - LIMITS[k][0]) < 1e-3 * (LIMITS[k][1] - LIMITS[k][0]) || Math.abs(v - LIMITS[k][1]) < 1e-3 * (LIMITS[k][1] - LIMITS[k][0]);
const SAMPLE = [
  { hood: 30, rpm: 3000, kind: "floor", dist: "", measured: "" }, { hood: 45, rpm: 2800, kind: "floor", dist: "", measured: "" },
  { hood: 60, rpm: 3200, kind: "floor", dist: "", measured: "" }, { hood: 40, rpm: 3400, kind: "wall", dist: 60, measured: "" },
  { hood: 55, rpm: 3800, kind: "wall", dist: 90, measured: "" }, { hood: 70, rpm: 3600, kind: "wall", dist: 40, measured: "" },
];
let shots = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "null") || SAMPLE; } catch { return SAMPLE; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(shots)); } catch { /* storage unavailable */ } };

let dlg = null, onApply = () => {}, lastFit = null;
export function initCalibrate(dialog, apply) { dlg = dialog; onApply = apply; }

export function openCalibrate() {
  render();
  dlg.showModal();
}

function render(result) {
  const rows = shots.map((s, i) => `<tr data-i="${i}">
      <td><input data-f="hood" inputmode="decimal" value="${esc(s.hood)}" aria-label="Hood angle, shot ${i + 1}"></td>
      <td><input data-f="rpm" inputmode="decimal" value="${esc(s.rpm)}" aria-label="Flywheel rpm, shot ${i + 1}"></td>
      <td><select data-f="kind" aria-label="Measurement, shot ${i + 1}"><option value="floor"${s.kind === "floor" ? " selected" : ""}>lands at</option><option value="wall"${s.kind === "wall" ? " selected" : ""}>hits wall</option></select></td>
      <td><input data-f="dist" inputmode="decimal" value="${esc(s.dist)}" ${s.kind === "floor" ? "disabled placeholder='—'" : ""} aria-label="Wall distance, shot ${i + 1}"></td>
      <td><input data-f="measured" inputmode="decimal" value="${esc(s.measured)}" placeholder="measure" aria-label="Measured inches, shot ${i + 1}"></td>
      <td class="res">${result && result.residuals[i] !== undefined ? `${result.residuals[i] >= 0 ? "+" : ""}${result.residuals[i].toFixed(1)}` : ""}</td>
      <td><button class="x" type="button" data-del="${i}" aria-label="Remove shot ${i + 1}">✕</button></td></tr>`).join("");
  const P = collect().P;
  const fitBody = result ? KEYS.filter(([k]) => k in result.values).map(([k, label, u]) => {
    const now = k === "hoodOffset" ? 0 : P[k];
    const v = result.values[k], pinned = atLimit(k, v);
    return `<tr><td>${label}</td><td>${(+now).toFixed(k === "eff" ? 1 : 2)}${u}</td><td><b${pinned ? ' class="warn"' : ""}>${v.toFixed(k === "eff" ? 1 : 2)}${u}</b>${pinned ? ' <small class="warn">at its limit</small>' : ""}</td></tr>`;
  }).join("") : "";
  const pinnedAny = result && KEYS.some(([k]) => k in result.values && atLimit(k, result.values[k]));
  const quality = result ? (result.rms < 1 ? "Tight fit." : result.rms < 3 ? "Decent fit: re-measure the shots with the biggest leftovers." : "Loose fit: check units, the exit height setting, and that each measurement matches its shot.") : "";
  dlg.querySelector(".calbody").innerHTML = `
    <p class="lead-s">Shoot a few balls at known settings and measure them: where each first touches the floor
      (along the floor from the shooter's exit), or how high it hits a wall at a set distance (ball center, in inches).
      Use a spread of hood angles including steep ones, and at least two wall shots.</p>
    <table class="caltbl"><thead><tr><th>Hood °</th><th>rpm</th><th>Measure</th><th>Wall in</th><th>Measured in</th><th>Off by</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="calbar"><button class="chip" type="button" data-act="add">Add shot</button>
      <span class="fitkeys">${KEYS.map(([k, label]) => `<label><input type="checkbox" data-key="${k}"${(state.prefs.fitKeys || ["eff", "cd", "magnus", "hoodOffset"]).includes(k) ? " checked" : ""}> ${label}</label>`).join("")}</span></div>
    ${result ? `<div class="calres"><table class="tbl"><tr><th>Setting</th><th>Now</th><th>Fitted</th></tr>${fitBody}</table>
      <p>Leftover error: <b>${result.rms.toFixed(2)} in</b> RMS. ${quality}</p>
      ${pinnedAny ? '<p class="warn">Some settings hit the edge of their range, so the measurements disagree with the model. Check the exit height and that each measurement matches its shot before applying.</p>' : ""}
      ${result.values.hoodOffset !== undefined && Math.abs(result.values.hoodOffset) >= 0.5 ? `<p class="warn">Your hood reads about ${Math.abs(result.values.hoodOffset).toFixed(1)}° ${result.values.hoodOffset > 0 ? "low" : "high"}: add ${result.values.hoodOffset > 0 ? "" : "−"}${Math.abs(result.values.hoodOffset).toFixed(1)}° to hood setpoints, or fix the encoder zero.</p>` : ""}
      <label class="lower"><input type="checkbox" id="lowerAero" checked> Lower the drag-and-lift uncertainty to 5% (the physics are now measured)</label></div>` : ""}
    <div class="calfoot"><span class="calmsg" role="status"></span><button class="btn ghost" type="button" data-act="close">Close</button>
      <button class="btn solid" type="button" data-act="fit">Fit</button>${result ? '<button class="btn solid" type="button" data-act="apply">Apply to settings</button>' : ""}</div>`;
}

export function bindCalibrate() {
  dlg.addEventListener("input", e => {
    const t = e.target, tr = t.closest("tr[data-i]");
    if (tr && t.dataset.f) { shots[+tr.dataset.i][t.dataset.f] = t.value; save(); }
    if (t.dataset.key) state.prefs.fitKeys = [...dlg.querySelectorAll("[data-key]:checked")].map(x => x.dataset.key);
  });
  dlg.addEventListener("change", e => { if (e.target.dataset.f === "kind") render(lastFit); });
  dlg.addEventListener("click", async e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.del !== undefined) { shots.splice(+b.dataset.del, 1); save(); render(); return; }
    const act = b.dataset.act;
    if (act === "close") dlg.close();
    if (act === "add") { shots.push({ hood: 45, rpm: 3000, kind: "floor", dist: "", measured: "" }); save(); render(lastFit); }
    if (act === "fit") await fit();
    if (act === "apply" && lastFit) {
      onApply(lastFit.values, dlg.querySelector("#lowerAero")?.checked);
      dlg.close();
    }
  });
}

async function fit() {
  const msg = dlg.querySelector(".calmsg");
  const usableRow = s => +s.measured > 0 && +s.rpm > 0 && isFinite(+s.hood) && (s.kind === "floor" || +s.dist > 0);
  const usable = shots.filter(usableRow).map(s => ({ hood: +s.hood, rpm: +s.rpm, kind: s.kind, dist: +s.dist, measured: +s.measured }));
  const keys = [...dlg.querySelectorAll("[data-key]:checked")].map(x => x.dataset.key);
  if (!keys.length) { msg.textContent = "Pick at least one setting to fit."; return; }
  if (usable.length < keys.length + 1) { msg.textContent = `Enter at least ${keys.length + 1} measured shots to fit ${keys.length} settings.`; return; }
  msg.textContent = "Fitting…";
  try {
    lastFit = await requestCalibration(collect().P, usable, keys);
    // residuals follow the usable rows; line them back up with the table
    let k = 0;
    const residuals = shots.map(s => (usableRow(s) ? lastFit.residuals[k++] : undefined));
    render({ ...lastFit, residuals });
  } catch (err) {
    msg.textContent = "The fit failed: " + err.message;
  }
}
