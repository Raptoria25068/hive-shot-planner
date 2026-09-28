/* Lookup-table export from the main map: CSV, JSON (with the settings used), and a Java class with
   bilinear interpolation for robot code. Grid in field inches; NaN where no shot scores. */
import { run } from "./runner.js";
import { changedVals } from "./state.js";

const LEVELS = ["none", "possible", "likely", "guaranteed"];

function table() {
  const cur = run.current;
  if (!cur || !cur.passDone.main) return null;
  const n = cur.xs.length, rows = [];
  const grid = key => cur.ys.map((_, j) => cur.xs.map((_, i) => { const c = cur.passes.main[j][i]; return c && c.l >= 1 && isFinite(c[key]) ? c[key] : NaN; }));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = cur.passes.main[j][i];
    if (!c || c.l < 0) continue;
    rows.push({ x: cur.xs[i], y: cur.ys[j], level: LEVELS[c.l], hood: c.l >= 1 ? c.a : NaN, rpm: c.l >= 1 ? c.r : NaN, p: c.l >= 1 ? c.p : 0, t: c.l >= 1 ? c.t : NaN, ev: c.l >= 1 ? c.ev : NaN, burst: c.bk ?? 0 });
  }
  return { cur, rows, xs: cur.xs, ys: cur.ys, hood: grid("a"), rpm: grid("r"), p: grid("p") };
}

const num = (v, d) => isFinite(v) ? Number(v).toFixed(d) : "";
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

export function toCsv() {
  const t = table(); if (!t) return null;
  const head = "x_in,y_in,level,hood_deg,flywheel_rpm,hit_chance,flight_s,entry_speed_mps,burst_scored";
  return [head, ...t.rows.map(r => [num(r.x, 2), num(r.y, 2), r.level, num(r.hood, 2), num(r.rpm, 0), num(r.p, 3), num(r.t, 3), num(r.ev, 2), r.burst].join(","))].join("\n") + "\n";
}

export function toJson() {
  const t = table(); if (!t) return null;
  const P = t.cur.P;
  return JSON.stringify({
    generated: stamp(), tool: "Raptoria HIVE Shot Planner (BIOBUZZ)",
    target: { hive: P.hive, raised: P.raised }, settings: changedVals(),
    units: { position: "in", hood: "deg", flywheel: "rpm" },
    xs: t.xs, ys: t.ys, spots: t.rows,
  }, (k, v) => (typeof v === "number" && !isFinite(v) ? null : v), 1);
}

export function toJava() {
  const t = table(); if (!t) return null;
  const P = t.cur.P, side = P.raised === "far" ? "Far" : "Audience";
  const arr = a => "{" + a.map(v => isFinite(v) ? Number(v).toFixed(2) : "Double.NaN").join(", ") + "}";
  const arr2 = g => "{\n" + g.map(row => "      " + arr(row)).join(",\n") + "\n  }";
  return `/**
 * HIVE shot lookup for the ${P.hive} HIVE with its ${P.raised === "far" ? "far-side" : "audience-side"} CELL raised.
 * Generated ${stamp()} by the Raptoria HIVE Shot Planner (BIOBUZZ).
 *
 * Positions are robot-center field coordinates in inches: origin at the red-alliance,
 * audience-side corner, +x toward blue, +y away from the audience. Tables are [yIndex][xIndex].
 * Double.NaN marks spots with no scoring shot; hood(x, y) and rpm(x, y) interpolate bilinearly
 * and return NaN when any surrounding grid point has no shot.
 */
public final class HiveShotTable${side} {
  private HiveShotTable${side}() {}

  public static final double[] X_IN = ${arr(t.xs)};
  public static final double[] Y_IN = ${arr(t.ys)};

  /** Hood angle above horizontal, degrees. */
  public static final double[][] HOOD_DEG = ${arr2(t.hood)};

  /** Flywheel speed set before the shot, rpm. */
  public static final double[][] FLYWHEEL_RPM = ${arr2(t.rpm)};

  /** Chance a ball scores with the planner's error settings, 0 to 1. */
  public static final double[][] HIT_CHANCE = ${arr2(t.p)};

  public static double hood(double xIn, double yIn) { return interp(HOOD_DEG, xIn, yIn); }
  public static double rpm(double xIn, double yIn) { return interp(FLYWHEEL_RPM, xIn, yIn); }
  public static double hitChance(double xIn, double yIn) { return interp(HIT_CHANCE, xIn, yIn); }

  private static double interp(double[][] t, double x, double y) {
    int i = cell(X_IN, x), j = cell(Y_IN, y);
    double fx = frac(X_IN, i, x), fy = frac(Y_IN, j, y);
    double a = t[j][i], b = t[j][i + 1], c = t[j + 1][i], d = t[j + 1][i + 1];
    if (Double.isNaN(a) || Double.isNaN(b) || Double.isNaN(c) || Double.isNaN(d)) return Double.NaN;
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  private static int cell(double[] axis, double v) {
    int k = 0;
    while (k < axis.length - 2 && v > axis[k + 1]) k++;
    return k;
  }
  private static double frac(double[] axis, int k, double v) {
    return Math.max(0, Math.min(1, (v - axis[k]) / (axis[k + 1] - axis[k])));
  }
}
`;
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
