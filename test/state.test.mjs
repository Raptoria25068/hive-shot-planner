// Settings intake: values from share links, imported files and storage are cleaned before use.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.location = { origin: "https://example.test", pathname: "/hive/", hash: "" };
const { applyValues, collect, defaults, state, FIELDS, shareUrl, readShareHash } = await import("../js/state.js");

test("select values outside their options fall back to the default", () => {
  applyValues({ hive: "red */ static {} /*", res: "0.01", raised: "aud" });
  assert.equal(state.vals.hive, "red");
  assert.equal(state.vals.res, "auto");
  assert.equal(state.vals.raised, "aud");
});

test("checkboxes take only true or false", () => {
  applyValues({ comp: { on: 1 }, sag: "yes" });
  assert.equal(state.vals.comp, false);
  assert.equal(state.vals.sag, false);
  applyValues({ comp: true });
  assert.equal(state.vals.comp, true);
});

test("unknown keys and non-object input leave the defaults", () => {
  for (const bad of [5, null, "cfg", ["x"], JSON.parse('{"__proto__": {"hive": "blue"}, "nope": 1}')]) {
    applyValues(bad);
    assert.deepEqual(state.vals, defaults());
  }
});

test("typed text is capped in length", () => {
  applyValues({ launchH: "1".repeat(500) });
  assert.ok(state.vals.launchH.length <= 32);
});

test("numbers outside a setting's limits reach the engine clamped", () => {
  applyValues({ burstN: "1000000000", wheelD: "0", launchH: "-5", tilt: "89", hiveSep: "1e9", rpm: "1e12" });
  const { P } = collect();
  assert.equal(P.burstN, 6);
  assert.equal(P.wheelD, 2);
  assert.equal(P.launchH, 4);
  assert.equal(P.tilt, 50);
  assert.equal(P.hiveSep, 40);
  assert.ok(P.rpmSpec.v <= 20000, `rpm ${P.rpmSpec.v}`);
});

test("ranges to solve are trimmed to the setting's limits", () => {
  applyValues({ launchH: "0-100" });
  const b = collect().blanks.find(x => x.k === "launchH");
  assert.equal(b.lo, 4);
  assert.equal(b.hi, 30);
});

test("every number setting has limits", () => {
  for (const f of Object.values(FIELDS)) if (!f.type && f.kind !== "shot") assert.ok(f.lo < f.hi, f.k);
});

test("share links carry the changed settings, including non-ASCII text", () => {
  applyValues({ launchH: "10–12", hive: "blue" });
  const url = shareUrl();
  location.hash = url.slice(url.indexOf("#"));
  assert.deepEqual(readShareHash(), { launchH: "10–12", hive: "blue" });
});
