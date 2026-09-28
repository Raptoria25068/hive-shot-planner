// Shared fixtures for engine tests: the planner's default inputs, as numbers the engine accepts.
const engine = require("../hive-engine.js");

function defaultParams(overrides = {}) {
  return {
    // shot
    hoodSpec: { mode: "range", lo: 30, hi: 75 }, rpmSpec: { mode: "free" }, rpmCap: 6000,
    // shooter & flywheel
    launchH: 14, exitFwd: 0, exitLat: 0, wheelD: 4, topRatio: 0, compression: 0.4, wheelShare: 20,
    gripOnset: 0.08, eff: 85, inertia: 4, sag: true,
    // ball & air
    ballType: "nectar", ballD: 3.6, ballM: 41.3, cd: 0.5, magnus: 1, rhoAir: 1.2,
    // robot motion
    robotSize: 18, speed: 0, dirMode: "rel", dirAngle: 90, rot: 0, comp: true,
    // accuracy
    eHood: 0.5, eHead: 0.5, eRpm: 30, eSpd: 2, eH: 0.25, ePos: 1, eVel: 3, eRot: 5, eTime: 10,
    eAero: 20, eMass: 5, eDia: 0.05, eField: 1, kSigma: 2, likelyThr: 70, guarRule: "stat",
    // target & field (BIOBUZZ Section 9, TU02)
    hive: "red", raised: "far", otherRaised: "opposite", res: 4,
    pivotZ: 43.95, tilt: 30, mouthZ: 53.5, openW: 20, openShoulder: 7.61, openPeak: 14, lip: 0,
    cellGap: 18.84, cellDepth: 12.04, hiveSep: 25.5, frameW: 49.46, frameD: 38.95,
    ...overrides,
  };
}

module.exports = { engine, defaultParams, IN: engine.IN, DEG: engine.DEG };
