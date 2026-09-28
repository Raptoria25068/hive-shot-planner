"use strict";
/* HIVE shot engine. Internal units: meters, seconds, kg, radians. */
const IN = 0.0254, DEG = Math.PI / 180, GRAV = 9.80665;

/* ---------- quasi-random samples for Monte Carlo ---------- */
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
const MC_N = 400;
const MC = (() => {
  const z1 = new Float64Array(MC_N), z2 = new Float64Array(MC_N), cph = new Float64Array(MC_N), sph = new Float64Array(MC_N), sg = new Float64Array(MC_N);
  for (let i = 0; i < MC_N; i++) {
    const u1 = halton(i + 1, 2), u2 = halton(i + 1, 3), u3 = halton(i + 1, 5), u4 = halton(i + 1, 7);
    const rr = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12)));
    z1[i] = rr * Math.cos(2 * Math.PI * u2); z2[i] = rr * Math.sin(2 * Math.PI * u2);
    cph[i] = Math.cos(2 * Math.PI * u3); sph[i] = Math.sin(2 * Math.PI * u3);
    sg[i] = u4 < 0.5 ? -1 : 1;
  }
  return { z1, z2, cph, sph, sg };
})();

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* Pentagon opening: bottom edge on w=0, width W, shoulders at Hs, peak at Hp.
   Edge rows [ns, nw, c]: inside iff ns*s + nw*w - c >= inset. */
function pentEdges(W, Hs, Hp) {
  const L = Math.hypot(W / 2, Hp - Hs);
  const rs = -(Hp - Hs) / L, rw = -(W / 2) / L;
  const ls = (Hp - Hs) / L, lw = -(W / 2) / L;
  return [
    [0, 1, 0],
    [-1, 0, -W / 2],
    [1, 0, -W / 2],
    [rs, rw, rs * (W / 2) + rw * Hs],
    [ls, lw, ls * (-W / 2) + lw * Hs],
  ];
}

/* ---------- context ---------- */
function buildCtx(P) {
  const c = { P };
  c.dt = 0.008; c.tmax = 3.0; c.F = 144 * IN;
  // ball + air
  c.r = P.ballD / 2 * IN; c.m = Math.max(P.ballM, 1) / 1000;
  const A = Math.PI * c.r * c.r;
  c.kd = 0.5 * P.rhoAir * P.cd * A / c.m;
  c.km = 0.5 * P.rhoAir * A / c.m * P.magnus;
  // burst: balls per burst, seconds between balls, and rpm the flywheel regains per second
  c.burstN = Math.max(1, Math.round(+P.burstN || 1));
  c.burstGap = Math.max(0, P.burstGap === undefined ? 250 : +P.burstGap) / 1000;
  c.recover = Math.max(0, P.recover === undefined ? 4000 : +P.recover);
  // inside the CELL: restitution normal to a panel, and the share of along-panel speed kept per impact
  c.cor = clamp(P.cor === undefined || P.cor === '' ? 0.5 : +P.cor, 0, 0.95);
  c.corT = clamp(P.corT === undefined || P.corT === '' ? 0.8 : +P.corT, 0, 1);
  // flywheel transfer
  const R = P.wheelD / 2 * IN, del = Math.max(P.compression, 0) * IN, sh = clamp(P.wheelShare / 100, 0, 1);
  c.Rc = Math.max(R - sh * del, 0.2 * R);
  c.re = Math.max(c.r - (1 - sh) * del / 2, 0.3 * c.r);
  c.grip = P.gripOnset > 0 ? 1 - Math.exp(-Math.max(P.compression, 0) / P.gripOnset) : 1;
  const eta = clamp(P.eff / 100, 0.01, 1);
  c.eta = eta * c.grip;
  const rt = clamp(P.topRatio, -0.5, 2);
  c.kv = c.eta * (1 + rt) / 2;
  c.sf = (1 - rt) / (1 + rt);
  const I = Math.max(P.inertia, 0.01) * 0.45359237 * IN * IN;
  c.I = I;
  const crot = 1 + (2 / 3) * Math.pow(c.r / c.re, 2) * c.sf * c.sf;
  c.q = P.sag ? c.m * Math.pow(c.kv * c.Rc, 2) * crot / (eta * I) : 0;
  c.sagFac = Math.sqrt(1 + c.q);
  c.vPerRpm = (2 * Math.PI / 60) * c.kv * c.Rc / c.sagFac;
  c.dlnvdlnm = -0.5 * c.q / (1 + c.q);
  // shooter placement
  c.h = P.launchH * IN; c.fwd = P.exitFwd * IN; c.lat = P.exitLat * IN;
  c.hood = P.hoodSpec; c.rpm = P.rpmSpec; c.rpmCap = P.rpmCap;
  // errors
  c.err = {
    hood: P.eHood * DEG, head: P.eHead * DEG, rpm: P.eRpm, spd: P.eSpd / 100, h: P.eH * IN, pos: P.ePos * IN,
    vel: P.eVel * IN, rot: P.eRot * DEG, time: P.eTime / 1000, aero: P.eAero / 100, mass: P.eMass / 100,
    dia: P.eDia * IN, field: P.eField * IN,
  };
  c.k = Math.max(P.kSigma, 0.25); c.thr = clamp(P.likelyThr / 100, 0.01, 0.999); c.guarRule = P.guarRule === 'strict' ? 'strict' : 'stat';
  // motion
  c.speed = Math.max(P.speed, 0) * IN; c.om = P.rot * DEG;
  c.motion = (c.speed < 1e-9 && Math.abs(c.om) < 1e-9) ? 'none' : (P.dirMode === 'unknown' ? 'unknown' : (P.comp ? 'comp' : 'bias'));
  c.dirMode = P.dirMode; c.dirAngle = P.dirAngle * DEG;
  c.robotHalf = P.robotSize / 2 * IN;
  buildGeom(c, P);
  return c;
}

function buildGeom(c, P) {
  const t = P.tilt * DEG, ct = Math.cos(t), st = Math.sin(t);
  const pz = P.pivotZ * IN, a1 = P.cellGap / 2 * IN, a2 = a1 + P.cellDepth * IN;
  const dOff = (pz + a2 * st - P.mouthZ * IN) / ct;
  const W = P.openW * IN, Hs = P.openShoulder * IN, Hp = Math.max(P.openPeak, P.openShoulder + 0.01) * IN;
  c.W = W; c.Hs = Hs; c.Hp = Hp; c.lip = P.lip * IN;
  c.edges = pentEdges(W, Hs, Hp);
  c.kr = (W / 2) / Math.hypot(W / 2, Hp - Hs);
  const cxm = 72 * IN, cym = 72 * IN, half = P.hiveSep / 2 * IN;
  const hives = [{ name: 'red', x: cxm - half }, { name: 'blue', x: cxm + half }];
  const sigT = P.raised === 'far' ? 1 : -1;
  const sigO = P.otherRaised === 'same' ? sigT : -sigT;
  c.cells = []; c.segs = [];
  const fw = P.frameW / 2 * IN, fd = P.frameD / 2 * IN, rad = 0.75 * IN, topZ = pz + 0.75 * IN;
  for (const hv of hives) {
    const isT = hv.name === P.hive;
    const sig = isT ? sigT : sigO;
    const w = [0, -sig * st, ct], uR = [0, sig * ct, st], uL = [0, -sig * ct, -st];
    c.cells.push({ px: hv.x, py: cym, pz, u: uR, w, a1, a2, dOff, target: isT, raised: true, hive: hv.name, sig });
    if (isT) c.tq = c.cells[c.cells.length - 1];
    c.cells.push({ px: hv.x, py: cym, pz, u: uL, w, a1, a2, dOff, target: false, raised: false, hive: hv.name, sig });
    c.segs.push([hv.x + a1 * uL[0], cym + a1 * uL[1], pz + a1 * uL[2], hv.x + a1 * uR[0], cym + a1 * uR[1], pz + a1 * uR[2], rad]);
    if (isT) {
      c.M0 = [hv.x + a2 * uR[0] - dOff * w[0], cym + a2 * uR[1] - dOff * w[1], pz + a2 * uR[2] - dOff * w[2]];
      c.sH = [1, 0, 0]; c.wH = w; c.nH = uR; c.targetX = hv.x; c.sig = sig;
    }
  }
  // Frame: two triangles lean inward from the base corners to apexes that carry the HIVE
  // pivots; a crossbar joins the apexes.
  for (const hv of hives) {
    const x0 = cxm + Math.sign(hv.x - cxm) * fw;
    c.segs.push([x0, cym - fd, 0, hv.x, cym, topZ, rad]);
    c.segs.push([x0, cym + fd, 0, hv.x, cym, topZ, rad]);
  }
  c.segs.push([hives[0].x, cym, topZ, hives[1].x, cym, topZ, rad]);
  c.feet = [[cxm - fw, cym - fd], [cxm - fw, cym + fd], [cxm + fw, cym - fd], [cxm + fw, cym + fd]];
  const yr = Math.max(fd, a2 + Hp) + 0.2;
  c.bb = { x0: cxm - Math.max(fw, half + W) - 0.2, x1: cxm + Math.max(fw, half + W) + 0.2, y0: cym - yr, y1: cym + yr, z1: pz + a2 + Hp + 0.2 };
  c.geom = { a1, a2, dOff, pz, t, cxm, cym, fw, fd, hives: hives.map(h => h.x) };
}

/* ---------- obstacles ---------- */
/* CELL bodies are solid volumes: 1 = the raised target CELL's own body, 2 = your lowered CELL,
   3 = the other HIVE. The target's opening side (beyond its mouth plane) is left open. */
function blockedCells(c, x, y, z) {
  const R = c.r, E = c.edges, cells = c.cells;
  for (let i = 0; i < cells.length; i++) {
    const q = cells[i];
    const rx = x - q.px, ry = y - q.py, rz = z - q.pz;
    const a = rx * q.u[0] + ry * q.u[1] + rz * q.u[2];
    if (a < q.a1 - R || a > (q.target ? q.a2 : q.a2 + R)) continue;
    const s = rx, h = rx * q.w[0] + ry * q.w[1] + rz * q.w[2] + q.dOff;
    let mn = Infinity;
    for (let e = 0; e < 5; e++) { const d = E[e][0] * s + E[e][1] * h - E[e][2]; if (d < mn) mn = d; }
    if (mn >= -R) return q.target ? 1 : (q.hive === c.P.hive ? 2 : 3);
  }
  return 0;
}

/* Squared closest distance between segment p→q (the ball's path over one step) and a frame bar
   segment g; SEG_S receives how far along p→q (0..1) the closest approach happens. */
let SEG_S = 0;
function segSegDist2(px, py, pz, qx, qy, qz, g) {
  const d1x = qx - px, d1y = qy - py, d1z = qz - pz;
  const d2x = g[3] - g[0], d2y = g[4] - g[1], d2z = g[5] - g[2];
  const rx = px - g[0], ry = py - g[1], rz = pz - g[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz, cc = d1x * rx + d1y * ry + d1z * rz;
  let s = 0, t = 0;
  if (a <= 1e-14) t = e > 1e-14 ? clamp(f / e, 0, 1) : 0;
  else if (e <= 1e-14) s = clamp(-cc / a, 0, 1);
  else {
    const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
    s = den > 1e-14 ? clamp((b * f - cc * e) / den, 0, 1) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-cc / a, 0, 1); }
    else if (t > 1) { t = 1; s = clamp((b - cc) / a, 0, 1); }
  }
  SEG_S = s;
  const dx = rx + d1x * s - d2x * t, dy = ry + d1y * s - d2y * t, dz = rz + d1z * s - d2z * t;
  return dx * dx + dy * dy + dz * dz;
}

/* First obstacle the ball touches while moving from p to q during one step, or 0.
   Frame bars (code 4) use the exact closest approach of the two segments, so nothing can slip
   between samples; the solid CELL bodies are sampled every third of a ball radius.
   SWEEP_AT receives the fraction of the step where the hit happens. */
let SWEEP_AT = 1;
function blockedSweep(c, px, py, pz, qx, qy, qz) {
  const bb = c.bb, R = c.r;
  if (Math.min(pz, qz) > bb.z1 || Math.max(px, qx) < bb.x0 || Math.min(px, qx) > bb.x1 ||
      Math.max(py, qy) < bb.y0 || Math.min(py, qy) > bb.y1) return 0;
  const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py, qz - pz) / (R / 3)));
  let hit = 0, at = 2;
  for (let k = 1; k <= n; k++) {
    const f = k / n, code = blockedCells(c, px + f * (qx - px), py + f * (qy - py), pz + f * (qz - pz));
    if (code) { hit = code; at = f; break; }
  }
  const segs = c.segs;
  for (let i = 0; i < segs.length; i++) {
    const rr = R + segs[i][6];
    if (segSegDist2(px, py, pz, qx, qy, qz, segs[i]) < rr * rr && SEG_S < at) { hit = 4; at = SEG_S; }
  }
  SWEEP_AT = at;
  return hit;
}

/* ---------- flight ---------- */
function launch(c, S, alpha, vrel, psi, withMotion) {
  const ch = Math.cos(psi), sh = Math.sin(psi);
  const ex = S.cx + ch * c.fwd - sh * c.lat, ey = S.cy + sh * c.fwd + ch * c.lat, ez = c.h;
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  let vx = vrel * ca * ch, vy = vrel * ca * sh; const vz = vrel * sa;
  if (withMotion) { vx += S.vrx - S.om * (ey - S.cy); vy += S.vry + S.om * (ex - S.cx); }
  const wb = c.sf * vrel / c.re;
  return { ex, ey, ez, vx, vy, vz, wx: wb * sh, wy: -wb * ch, wz: 0 };
}

/* mode 1: stop when along-track distance reaches D (for solving).
   mode 2: stop at the first outside-to-inside crossing of the mouth plane.
   mode 3: stop when the ball first touches the tiles (for calibration). */
function fly(c, L, aeroS, mode, D, dhx, dhy, checkObs, rec) {
  const dt = c.dt, n = Math.ceil(c.tmax / dt);
  const kd = c.kd * aeroS, km = c.km * aeroS, rb = c.r;
  const wx = L.wx, wy = L.wy, wz = L.wz, W = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const useM = km > 0 && W > 1e-9;
  const M0 = c.M0, nH = c.nH, F = c.F;
  let x = L.ex, y = L.ey, z = L.ez, vx = L.vx, vy = L.vy, vz = L.vz, t = 0;
  let fPrev = (x - M0[0]) * nH[0] + (y - M0[1]) * nH[1] + (z - M0[2]) * nH[2];
  let sPrev = 0, latPrev = 0, apex = z;
  if (rec) rec.push(x, y, z);
  for (let i = 0; i < n; i++) {
    let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    let ax = -kd * sp * vx, ay = -kd * sp * vy, az = -GRAV - kd * sp * vz;
    if (useM && sp > 1e-6) { const S = rb * W / sp; const f = km * (S / (2 * S + 1)) * sp / W; ax += f * (wy * vz - wz * vy); ay += f * (wz * vx - wx * vz); az += f * (wx * vy - wy * vx); }
    const hx = vx + 0.5 * dt * ax, hy = vy + 0.5 * dt * ay, hz = vz + 0.5 * dt * az;
    sp = Math.sqrt(hx * hx + hy * hy + hz * hz);
    let bx = -kd * sp * hx, by = -kd * sp * hy, bz = -GRAV - kd * sp * hz;
    if (useM && sp > 1e-6) { const S = rb * W / sp; const f = km * (S / (2 * S + 1)) * sp / W; bx += f * (wy * hz - wz * hy); by += f * (wz * hx - wx * hz); bz += f * (wx * hy - wy * hx); }
    const nx = x + dt * hx, ny = y + dt * hy, nz = z + dt * hz;
    const nvx = vx + dt * bx, nvy = vy + dt * by, nvz = vz + dt * bz;
    const nt = t + dt;
    if (mode === 1) {
      const s = (nx - L.ex) * dhx + (ny - L.ey) * dhy;
      const lat = -(nx - L.ex) * dhy + (ny - L.ey) * dhx;
      if (s >= D) {
        const fr = (D - sPrev) / (s - sPrev);
        return { reached: true, z: z + fr * (nz - z), lat: latPrev + fr * (lat - latPrev), t: t + fr * dt, vz: vz + fr * (nvz - vz), apex: Math.max(apex, nz) };
      }
      if (nz < -0.05 || nt >= c.tmax - 1e-9 || (i > 4 && s < sPrev)) {
        return { reached: false, z: Math.min(nz, 0) - 2 * (D - s), lat, t: nt };
      }
      sPrev = s; latPrev = lat;
    } else if (mode === 3) {
      if (nz <= rb) {
        const fr = (z - rb) / (z - nz);
        return { landed: true, s: Math.hypot(x + fr * (nx - x) - L.ex, y + fr * (ny - y) - L.ey), t: t + fr * dt };
      }
      if (nt >= c.tmax - 1e-9) return { landed: false, s: Math.hypot(nx - L.ex, ny - L.ey), t: nt };
    } else {
      const fN = (nx - M0[0]) * nH[0] + (ny - M0[1]) * nH[1] + (nz - M0[2]) * nH[2];
      const crossing = fPrev > 0 && fN <= 0;
      const frCross = crossing ? fPrev / (fPrev - fN) : 1;
      // An obstacle only stops the shot if the ball reaches it before crossing into the opening.
      const b = checkObs ? blockedSweep(c, x, y, z, nx, ny, nz) : 0;
      if (b && SWEEP_AT <= frCross) {
        const f = SWEEP_AT, hx = x + f * (nx - x), hy = y + f * (ny - y), hz = z + f * (nz - z);
        if (rec) rec.push(hx, hy, hz);
        return { crossed: false, blocked: b, x: hx, y: hy, z: hz, t: t + f * dt, apex };
      }
      if (crossing) {
        const fr = frCross;
        const o = { crossed: true, blocked: 0, x: x + fr * (nx - x), y: y + fr * (ny - y), z: z + fr * (nz - z), vx: vx + fr * (nvx - vx), vy: vy + fr * (nvy - vy), vz: vz + fr * (nvz - vz), t: t + fr * dt, apex: Math.max(apex, nz) };
        if (rec) rec.push(o.x, o.y, o.z);
        return o;
      }
      if (nz < rb * 0.5 || nx < -0.3 || nx > F + 0.3 || ny < -0.3 || ny > F + 0.3) {
        if (rec) rec.push(nx, ny, nz);
        return { crossed: false, blocked: 0, landed: true, x: nx, y: ny, z: nz, t: nt, apex };
      }
      fPrev = fN;
    }
    x = nx; y = ny; z = nz; vx = nvx; vy = nvy; vz = nvz; t = nt;
    if (z > apex) apex = z;
    if (rec) rec.push(x, y, z);
  }
  return mode === 1 ? { reached: false, z: z - 2 * D, lat: 0, t } : { crossed: false, blocked: 0, t, apex };
}

/* ---------- capture inside the CELL ---------- */
/* Follows the ball after it crosses into the raised CELL: a pentagonal tube (side walls, floor,
   roof) closed by a back panel, open at the mouth. Each impact keeps e of the speed into the panel
   and eT of the speed along it. The mouth is uphill, so the ball only escapes by rebounding hard
   enough to climb back out. Returns { captured, bounces, t } (plus a trace when asked). */
function capture(c, tr, e, eT, wantTrace) {
  const q = c.tq, R = c.r, E = c.edges, u = q.u, w = q.w;
  const rx = tr.x - q.px, ry = tr.y - q.py, rz = tr.z - q.pz;
  let s = rx, a = rx * u[0] + ry * u[1] + rz * u[2], h = rx * w[0] + ry * w[1] + rz * w[2] + q.dOff;
  let vs = tr.vx, va = tr.vx * u[0] + tr.vy * u[1] + tr.vz * u[2], vh = tr.vx * w[0] + tr.vy * w[1] + tr.vz * w[2];
  const ga = -GRAV * u[2], gh = -GRAV * w[2], dt = 0.001, IMPACT = 0.25;
  const back = q.a1 + R, trace = wantTrace ? [] : null;
  const rec = (t) => trace && trace.push({ t, sp: Math.sqrt(vs * vs + va * va + vh * vh), z: q.pz + a * u[2] + (h - q.dOff) * w[2] });
  let bounces = 0, still = 0;
  rec(0);
  for (let t = dt; t < 2.5; t += dt) {
    va += ga * dt; vh += gh * dt;
    s += vs * dt; a += va * dt; h += vh * dt;
    for (let k = 0; k < 5; k++) {
      const pen = E[k][0] * s + E[k][1] * h - E[k][2] - R;
      if (pen >= 0) continue;
      s -= pen * E[k][0]; h -= pen * E[k][1];
      const vn = E[k][0] * vs + E[k][1] * vh;
      if (vn >= 0) continue;
      const ts = vs - vn * E[k][0], th = vh - vn * E[k][1];
      const keep = -vn > IMPACT ? eT : 1;       // resting contact slides freely; impacts scrub speed
      if (-vn > IMPACT) bounces++;
      vs = keep * ts - e * vn * E[k][0]; vh = keep * th - e * vn * E[k][1];
      if (-vn > IMPACT) va *= eT;
    }
    if (a < back) {
      a = back;
      if (va < 0) { if (-va > IMPACT) { bounces++; vs *= eT; vh *= eT; } va = -e * va; }
    }
    rec(t);
    if (a > q.a2 + R) return { captured: false, bounces, t, trace };
    still = vs * vs + va * va + vh * vh < 0.04 ? still + 1 : 0;
    if (still > 60) return { captured: true, bounces, t, trace };
  }
  return { captured: true, bounces, t: 2.5, trace };
}

/* ---------- calibration ---------- */
/* Predicted measurement for one test shot fired along +x from the field origin: where the ball
   first touches the tiles (inches from the exit point, along the floor), or the height of its
   center (inches) where it reaches a wall shot.dist inches away. */
function predictWith(c, P, shot) {
  const S = { cx: 0, cy: 0, vrx: 0, vry: 0, om: 0 };
  const alpha = (shot.hood + (+P.hoodOffset || 0)) * DEG;
  const L = launch(c, S, alpha, shot.rpm * c.vPerRpm, 0, false);
  if (shot.kind === 'wall') return fly(c, L, 1, 1, shot.dist * IN, 1, 0, false, null).z / IN;
  return fly(c, L, 1, 3, 0, 0, 0, false, null).s / IN;
}
function predictShot(P, shot) { return predictWith(buildCtx(P), P, shot); }

/* Bounded Nelder–Mead on unit-scaled parameters; restarts from the best point to escape
   early collapse of the simplex. */
function nelderMead(f, x0, step, iters) {
  const n = x0.length;
  let best = x0.slice(), fb = f(best);
  for (let round = 0; round < 3; round++) {
    let S = [best.slice()].concat(best.map((_, i) => { const p = best.slice(); p[i] += p[i] + step > 1 ? -step : step; return p; }));
    let F = S.map(f);
    for (let it = 0; it < iters; it++) {
      const ord = F.map((v, i) => i).sort((a, b) => F[a] - F[b]);
      S = ord.map(i => S[i]); F = ord.map(i => F[i]);
      if (F[n] - F[0] < 1e-10) break;
      const cen = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += S[i][j] / n;
      const at = k => cen.map((v, j) => v + k * (S[n][j] - v));
      const xr = at(-1), fr = f(xr);
      if (fr < F[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; } }
      else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
      else {
        const xc = at(fr < F[n] ? -0.5 : 0.5), fc = f(xc);
        if (fc < Math.min(fr, F[n])) { S[n] = xc; F[n] = fc; }
        else for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); }
      }
    }
    const i0 = F.indexOf(Math.min(...F));
    if (F[i0] < fb) { best = S[i0].slice(); fb = F[i0]; }
    step *= 0.4;
  }
  return best;
}

const FIT_RANGE = { eff: [30, 100], cd: [0.15, 1.2], magnus: [0, 2], hoodOffset: [-10, 10] };
/* Fits the chosen keys (eff, cd, magnus, hoodOffset) to measured test shots
   ({ hood, rpm, kind: 'floor' | 'wall', dist?, measured } in degrees, rpm, inches).
   Returns the fitted values, per-shot residuals (predicted − measured, inches) and their RMS. */
function calibrate(P0, shots, keys) {
  const lo = keys.map(k => FIT_RANGE[k][0]), hi = keys.map(k => FIT_RANGE[k][1]);
  const toP = u => { const P = Object.assign({}, P0); keys.forEach((k, i) => { P[k] = lo[i] + clamp(u[i], 0, 1) * (hi[i] - lo[i]); }); return P; };
  const cost = u => {
    const P = toP(u), c = buildCtx(P);
    let s = 0;
    for (const sh of shots) { const d = predictWith(c, P, sh) - sh.measured; s += d * d; }
    for (const x of u) s += 1e4 * (x < 0 ? -x : x > 1 ? x - 1 : 0);
    return s;
  };
  const start = keys.map((k, i) => clamp(((P0[k] === undefined ? 0 : +P0[k]) - lo[i]) / (hi[i] - lo[i]), 0, 1));
  const P = toP(nelderMead(cost, start, 0.2, 300));
  const c = buildCtx(P);
  const residuals = shots.map(sh => predictWith(c, P, sh) - sh.measured);
  const values = {};
  keys.forEach(k => { values[k] = P[k]; });
  return { values, residuals, rms: Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / Math.max(shots.length, 1)) };
}

/* ---------- aiming ---------- */
function exitPt(c, S, psi) {
  const ch = Math.cos(psi), sh = Math.sin(psi);
  return [S.cx + ch * c.fwd - sh * c.lat, S.cy + sh * c.fwd + ch * c.lat];
}
function headingTo(c, S, T, delta) {
  let psi = Math.atan2(T[1] - S.cy, T[0] - S.cx) + delta;
  if (c.fwd === 0 && c.lat === 0) return psi;
  for (let k = 0; k < 4; k++) { const e = exitPt(c, S, psi); psi = Math.atan2(T[1] - e[1], T[0] - e[0]) + delta; }
  return psi;
}

const TOLZ = 0.0005;
/* increasing f; returns {x} or {why:'hi'|'lo'} */
function rootUp(f, lo, hi, guess) {
  let x = clamp(guess, lo, hi), fx = f(x);
  if (Math.abs(fx) < TOLZ) return { x };
  let a, fa, b, fb;
  if (fx < 0) {
    a = x; fa = fx; let y = x, step = 1.1;
    for (;;) {
      if (y >= hi) return { why: 'hi' };
      y = Math.min(y * step, hi); const fy = f(y);
      if (fy >= 0) { b = y; fb = fy; break; }
      a = y; fa = fy; step = 1 + (step - 1) * 1.6;
    }
  } else {
    b = x; fb = fx; let y = x, step = 1.1;
    for (;;) {
      if (y <= lo) return { why: 'lo' };
      y = Math.max(y / step, lo); const fy = f(y);
      if (fy <= 0) { a = y; fa = fy; break; }
      b = y; fb = fy; step = 1 + (step - 1) * 1.6;
    }
  }
  if (Math.abs(fb) < TOLZ) return { x: b };
  if (Math.abs(fa) < TOLZ) return { x: a };
  let side = 0;
  for (let i = 0; i < 40; i++) {
    const m = (a * fb - b * fa) / (fb - fa), fm = f(m);
    if (Math.abs(fm) < TOLZ || Math.abs(b - a) < 1e-5) return { x: m };
    if (fm < 0) { a = m; fa = fm; if (side === -1) fb *= 0.5; side = -1; }
    else { b = m; fb = fm; if (side === 1) fa *= 0.5; side = 1; }
  }
  return { x: 0.5 * (a + b) };
}
/* generic bracketed root (sign change between a and b) */
function rootBr(f, a, fa, b, fb) {
  let side = 0;
  for (let i = 0; i < 40; i++) {
    const m = (a * fb - b * fa) / (fb - fa), fm = f(m);
    if (Math.abs(fm) < TOLZ || Math.abs(b - a) < 1e-6) return m;
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; if (side === -1) fb *= 0.5; side = -1; }
    else { b = m; fb = fm; if (side === 1) fa *= 0.5; side = 1; }
  }
  return 0.5 * (a + b);
}

/* Solve exit speed for a fixed hood angle so the ball passes through T. */
function aimV(c, S, T, alpha, vmin, vmax, motion, vGuess) {
  let delta = 0, out = null;
  for (let it = 0; it < 4; it++) {
    const psi = headingTo(c, S, T, delta);
    const e = exitPt(c, S, psi);
    let dhx = T[0] - e[0], dhy = T[1] - e[1]; const D = Math.hypot(dhx, dhy);
    if (D < 0.05) return { ok: false, why: 'close' };
    dhx /= D; dhy /= D;
    let guess = vGuess;
    if (!(guess > 0)) {
      const dz = T[2] - c.h, ca = Math.cos(alpha), den = 2 * ca * ca * (D * Math.tan(alpha) - dz);
      guess = den > 0 ? Math.sqrt(GRAV * D * D / den) * 1.06 : vmax * 0.6;
    }
    let lat = 0;
    const f = (v) => { const L = launch(c, S, alpha, v, psi, motion); const r = fly(c, L, 1, 1, D, dhx, dhy, false, null); lat = r.lat; return r.z - T[2]; };
    const rr = rootUp(f, vmin, vmax, guess);
    if (rr.x === undefined) return { ok: false, why: rr.why };
    out = { ok: true, v: rr.x, psi, D };
    if (!motion) return out;
    f(rr.x);
    if (Math.abs(lat) < 0.002) return out;
    delta -= lat / D; vGuess = rr.x;
  }
  return out;
}

/* Solve hood angle (bracket [aLo,aHi], fixed speed) so ball passes through T. */
function aimA(c, S, T, v, aLo, aHi, motion) {
  let delta = 0, out = null;
  for (let it = 0; it < 4; it++) {
    const psi = headingTo(c, S, T, delta);
    const e = exitPt(c, S, psi);
    let dhx = T[0] - e[0], dhy = T[1] - e[1]; const D = Math.hypot(dhx, dhy);
    if (D < 0.05) return null;
    dhx /= D; dhy /= D;
    let lat = 0;
    const g = (a) => { const L = launch(c, S, a, v, psi, motion); const r = fly(c, L, 1, 1, D, dhx, dhy, false, null); lat = r.lat; return r.z - T[2]; };
    const ga = g(aLo), gb = g(aHi);
    if ((ga < 0) === (gb < 0)) return out;
    const a = rootBr(g, aLo, ga, aHi, gb);
    out = { ok: true, a, psi, D };
    if (!motion) return out;
    g(a);
    if (Math.abs(lat) < 0.002) return out;
    delta -= lat / D;
  }
  return out;
}

/* Heading only (both hood and speed fixed). */
function aimFixed(c, S, T, alpha, v, motion) {
  let delta = 0, psi = 0, D = 0;
  for (let it = 0; it < 4; it++) {
    psi = headingTo(c, S, T, delta);
    const e = exitPt(c, S, psi);
    let dhx = T[0] - e[0], dhy = T[1] - e[1]; D = Math.hypot(dhx, dhy);
    if (!motion) break;
    dhx /= D; dhy /= D;
    const r = fly(c, launch(c, S, alpha, v, psi, motion), 1, 1, D, dhx, dhy, false, null);
    if (!r.reached || Math.abs(r.lat) < 0.002) break;
    delta -= r.lat / D;
  }
  return { ok: true, psi, D };
}

/* Insets and aim point for an entry direction d */
function insetsFor(c, d, extra) {
  const nH = c.nH, sH = c.sH, wH = c.wH, E = c.edges;
  const dn = d[0] * nH[0] + d[1] * nH[1] + d[2] * nH[2];
  const ds = d[0] * sH[0] + d[1] * sH[1] + d[2] * sH[2];
  const dw = d[0] * wH[0] + d[1] * wH[1] + d[2] * wH[2];
  const base = c.r + c.lip + (extra || 0);
  const ins = [0, 0, 0, 0, 0];
  for (let e = 0; e < 5; e++) {
    const dm = E[e][0] * ds + E[e][1] * dw;
    const cb = Math.abs(dn) / Math.sqrt(dn * dn + dm * dm);
    ins[e] = base / Math.max(cb, 0.2);
  }
  return ins;
}
function aimW(c, ins) {
  const ib = ins[0], ir = Math.max(ins[3], ins[4]);
  let w = (c.kr * c.Hp + ib - ir) / (1 + c.kr);
  return clamp(w, 0, c.Hp);
}
function aimPoint(c, w) {
  const M0 = c.M0, wH = c.wH;
  return [M0[0] + w * wH[0], M0[1] + w * wH[1], M0[2] + w * wH[2]];
}

/* ---------- evaluate one shot ---------- */
function planeCoords(c, x, y, z) {
  const M0 = c.M0, sH = c.sH, wH = c.wH;
  const dx = x - M0[0], dy = y - M0[1], dz = z - M0[2];
  return [dx * sH[0] + dy * sH[1] + dz * sH[2], dx * wH[0] + dy * wH[1] + dz * wH[2]];
}

function evalShot(c, S, alpha, vrel, psi, opts) {
  const motionNom = c.motion === 'comp' || c.motion === 'bias';
  const L = launch(c, S, alpha, vrel, psi, motionNom);
  const rec = opts && opts.rec ? [] : null;
  const tr = fly(c, L, 1, 2, 0, 0, 0, true, rec);
  const o = { alpha, vrel, psi, L, tr, rec, level: 0, prob: 0, wc: -1, pm: -1 };
  if (tr.blocked) { o.why = 'blocked'; o.blk = tr.blocked; return o; }
  if (!tr.crossed) { o.why = 'nocross'; return o; }
  const pc = planeCoords(c, tr.x, tr.y, tr.z);
  const s = pc[0], w = pc[1];
  const sp = Math.sqrt(tr.vx * tr.vx + tr.vy * tr.vy + tr.vz * tr.vz);
  const d = [tr.vx / sp, tr.vy / sp, tr.vz / sp];
  const nH = c.nH;
  const dn = d[0] * nH[0] + d[1] * nH[1] + d[2] * nH[2];
  o.s = s; o.w = w; o.sp = sp; o.d = d; o.dn = dn;
  if (dn > -0.12) { o.why = 'graze'; return o; }
  const ins = insetsFor(c, d, 0);
  const E = c.edges;
  let pm = Infinity;
  for (let e = 0; e < 5; e++) { const v = E[e][0] * s + E[e][1] * w - E[e][2] - ins[e]; if (v < pm) pm = v; }
  o.ins = ins; o.pm = pm;
  if (pm < 0) { o.why = 'outside'; return o; }
  // A ball that rebounds back out of the CELL doesn't score; one that only stays in with a
  // perfectly known bounciness is at best Likely.
  const cap = capture(c, tr, c.cor, c.corT, false);
  o.cap = { captured: cap.captured, bounces: cap.bounces };
  if (!cap.captured) { o.why = 'bounce'; return o; }
  o.level = 1;
  robust(c, S, o, L, alpha, vrel, psi, opts && opts.detail);
  if (o.level > 2 && !capture(c, tr, Math.min(c.cor + 0.1, 0.95), c.corT, false).captured) { o.level = 2; o.cap.risky = true; }
  return o;
}

function robust(c, S, o, L, alpha, vrel, psi, detail) {
  const eps = 0.02;
  const Jv = [[0, 0], [0, 0], [0, 0]];
  for (let k = 0; k < 3; k++) {
    const L2 = Object.assign({}, L);
    if (k === 0) L2.vx += eps; else if (k === 1) L2.vy += eps; else L2.vz += eps;
    const t2 = fly(c, L2, 1, 2, 0, 0, 0, false, null);
    if (!t2.crossed) { Jv[k] = [5, 5]; continue; }
    const p2 = planeCoords(c, t2.x, t2.y, t2.z);
    Jv[k] = [(p2[0] - o.s) / eps, (p2[1] - o.w) / eps];
  }
  let Ja = [0, 0];
  const ta = fly(c, L, 1.1, 2, 0, 0, 0, false, null);
  if (ta.crossed) { const pa = planeCoords(c, ta.x, ta.y, ta.z); Ja = [(pa[0] - o.s) / 0.1, (pa[1] - o.w) / 0.1]; }
  else Ja = [0, -3];
  const d = o.d, nH = c.nH, sH = c.sH, wH = c.wH, dn = o.dn;
  const Jp = (px, py, pz) => {
    const k = (px * nH[0] + py * nH[1] + pz * nH[2]) / dn;
    const qx = px - d[0] * k, qy = py - d[1] * k, qz = pz - d[2] * k;
    return [qx * sH[0] + qy * sH[1] + qz * sH[2], qx * wH[0] + qy * wH[1] + qz * wH[2]];
  };
  const Jvf = (x, y, z) => [x * Jv[0][0] + y * Jv[1][0] + z * Jv[2][0], x * Jv[0][1] + y * Jv[1][1] + z * Jv[2][1]];
  const ch = Math.cos(psi), sh = Math.sin(psi), ca = Math.cos(alpha), sa = Math.sin(alpha);
  const ex = L.ex - S.cx, ey = L.ey - S.cy;
  const e = c.err, G = [], names = [];
  const add = (nm, g) => { if (Math.abs(g[0]) + Math.abs(g[1]) > 1e-9) { G.push(g); names.push(nm); } };
  const sc = (g, k) => [g[0] * k, g[1] * k];
  const sum = (a, b) => [a[0] + b[0], a[1] + b[1]];
  add('Hood angle', Jvf(-vrel * sa * ch * e.hood, -vrel * sa * sh * e.hood, vrel * ca * e.hood));
  const Hmap = sum(Jvf(-vrel * ca * sh, vrel * ca * ch, 0), Jp(-ey, ex, 0));
  add('Heading', sc(Hmap, e.head));
  const Vr = [vrel * ca * ch, vrel * ca * sh, vrel * sa];
  const rpmNow = vrel / c.vPerRpm;
  if (rpmNow > 1) add('Flywheel RPM', sc(Jvf(Vr[0], Vr[1], Vr[2]), e.rpm / rpmNow));
  add('Exit speed variation', sc(Jvf(Vr[0], Vr[1], Vr[2]), e.spd));
  add('Launch height', Jp(0, 0, e.h));
  add('Robot position (x)', Jp(e.pos, 0, 0));
  add('Robot position (y)', Jp(0, e.pos, 0));
  add('Field tolerance (x)', Jp(-e.field, 0, 0));
  add('Field tolerance (y)', Jp(0, -e.field, 0));
  add('Field tolerance (z)', Jp(0, 0, -e.field));
  if (c.motion === 'comp') {
    add('Velocity estimate (x)', Jvf(e.vel, 0, 0));
    add('Velocity estimate (y)', Jvf(0, e.vel, 0));
    add('Rotation estimate', Jvf(-ey * e.rot, ex * e.rot, 0));
  }
  if (c.motion !== 'none') {
    const tm = sum(sc(Hmap, Math.abs(c.om) * e.time), c.motion === 'unknown' ? [0, 0] : Jp(S.vrx * e.time, S.vry * e.time, 0));
    add('Release timing', tm);
  }
  add('Drag / lift model', sc(Ja, e.aero));
  add('Ball mass', sum(sc(Ja, e.mass), sc(Jvf(Vr[0], Vr[1], Vr[2]), c.dlnvdlnm * e.mass)));
  add('Ball size', sc(Ja, e.dia / c.r));
  let circ = null, rotG = null;
  if (c.motion === 'unknown') {
    if (c.speed > 0) circ = [Jvf(c.speed, 0, 0), Jvf(0, c.speed, 0)];
    if (c.om) rotG = Jvf(-ey * c.om, ex * c.om, 0);
  }
  // worst case (zonotope + ellipse)
  const E = c.edges;
  const insWC = insetsFor(c, d, e.dia / 2);
  let wc = Infinity, bind = 0;
  for (let k = 0; k < 5; k++) {
    const ns = E[k][0], nw = E[k][1];
    let v = ns * o.s + nw * o.w - E[k][2] - insWC[k];
    for (let i = 0; i < G.length; i++) v -= Math.abs(ns * G[i][0] + nw * G[i][1]);
    if (circ) { const a = ns * circ[0][0] + nw * circ[0][1], b = ns * circ[1][0] + nw * circ[1][1]; v -= Math.sqrt(a * a + b * b); }
    if (rotG) v -= Math.abs(ns * rotG[0] + nw * rotG[1]);
    if (v < wc) { wc = v; bind = k; }
  }
  // Monte Carlo (Gaussian sources at tol = k sigma)
  let c11 = 0, c12 = 0, c22 = 0;
  for (let i = 0; i < G.length; i++) { c11 += G[i][0] * G[i][0]; c12 += G[i][0] * G[i][1]; c22 += G[i][1] * G[i][1]; }
  const k2 = c.k * c.k; c11 /= k2; c12 /= k2; c22 /= k2;
  const l11 = Math.sqrt(Math.max(c11, 1e-14)), l21 = c12 / l11, l22 = Math.sqrt(Math.max(c22 - l21 * l21, 1e-14));
  const ins = o.ins;
  let hit = 0;
  for (let j = 0; j < MC_N; j++) {
    let ps = o.s + l11 * MC.z1[j], pw = o.w + l21 * MC.z1[j] + l22 * MC.z2[j];
    if (circ) { ps += circ[0][0] * MC.cph[j] + circ[1][0] * MC.sph[j]; pw += circ[0][1] * MC.cph[j] + circ[1][1] * MC.sph[j]; }
    if (rotG) { ps += rotG[0] * MC.sg[j]; pw += rotG[1] * MC.sg[j]; }
    let inside = true;
    for (let k = 0; k < 5; k++) { if (E[k][0] * ps + E[k][1] * pw - E[k][2] < ins[k]) { inside = false; break; } }
    if (inside) hit++;
  }
  o.prob = hit / MC_N;
  // statistical rule: 3-sigma spread (plus bounded non-Gaussian terms) inside the opening
  let ws = Infinity, bindS = 0;
  for (let k = 0; k < 5; k++) {
    const ns = E[k][0], nw = E[k][1];
    let v = ns * o.s + nw * o.w - E[k][2] - insWC[k];
    v -= 3 * Math.sqrt(Math.max(ns * ns * c11 + 2 * ns * nw * c12 + nw * nw * c22, 0));
    if (circ) { const a = ns * circ[0][0] + nw * circ[0][1], b = ns * circ[1][0] + nw * circ[1][1]; v -= Math.sqrt(a * a + b * b); }
    if (rotG) v -= Math.abs(ns * rotG[0] + nw * rotG[1]);
    if (v < ws) { ws = v; bindS = k; }
  }
  o.wcStrict = wc; o.wcStat = ws;
  if (c.guarRule === 'stat') { wc = ws; bind = bindS; }
  o.wc = wc;
  // The error source that pushes hardest toward the tightest rim edge (for the map layer).
  let domV = -1;
  for (let i = 0; i < G.length; i++) {
    const v = Math.abs(E[bind][0] * G[i][0] + E[bind][1] * G[i][1]);
    if (v > domV) { domV = v; o.dom = names[i]; }
  }
  o.level = wc >= 0 ? 3 : (o.prob >= c.thr ? 2 : 1);
  o.Jv = Jv; o.Ja = Ja;
  o.dwdv = Jvf(Vr[0] / vrel, Vr[1] / vrel, Vr[2] / vrel);
  o.dwda = Jvf(-vrel * sa * ch, -vrel * sa * sh, vrel * ca);
  if (detail) {
    const ns = E[bind][0], nw = E[bind][1];
    const contrib = G.map((g, i) => ({ name: names[i], v: Math.abs(ns * g[0] + nw * g[1]) }));
    if (circ) { const a = ns * circ[0][0] + nw * circ[0][1], b = ns * circ[1][0] + nw * circ[1][1]; contrib.push({ name: 'Robot motion (unknown dir.)', v: Math.sqrt(a * a + b * b) }); }
    if (rotG) contrib.push({ name: 'Robot rotation (unknown dir.)', v: Math.abs(ns * rotG[0] + nw * rotG[1]) });
    contrib.sort((a, b) => b.v - a.v);
    o.contrib = contrib; o.bind = bind;
    o.sigma = [Math.sqrt(c11), Math.sqrt(c22)];
  }
}

/* ---------- one field position ---------- */
const WHY_RANK = { bounce: 7, blocked: 6, graze: 5, outside: 4, hi: 3, lo: 2, nocross: 1, close: 0 };

function shotState(c, cx, cy) {
  const S = { cx, cy, vrx: 0, vry: 0, om: 0 };
  if (c.motion !== 'none') {
    const ang = c.dirMode === 'field' ? c.dirAngle : Math.atan2(c.M0[1] - cy, c.M0[0] - cx) + c.dirAngle;
    S.vrx = c.speed * Math.cos(ang); S.vry = c.speed * Math.sin(ang); S.om = c.om;
  }
  return S;
}

function keepOut(c, cx, cy) {
  const R = c.robotHalf, F = c.F;
  if (cx < R - 1e-9 || cx > F - R + 1e-9 || cy < R - 1e-9 || cy > F - R + 1e-9) return true;
  for (const f of c.feet) if (Math.hypot(cx - f[0], cy - f[1]) < R * 0.75 + 0.03) return true;
  return false;
}

function hoodList(c) {
  const h = c.hood;
  if (h.mode === 'fixed') return [h.v];
  const lo = h.mode === 'range' ? h.lo : 6, hi = h.mode === 'range' ? h.hi : 88;
  const step = h.mode === 'range' ? 2.5 : 3;
  const n = Math.max(1, Math.round((hi - lo) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(lo + (hi - lo) * i / n);
  return out;
}
function rpmBounds(c) {
  const r = c.rpm;
  if (r.mode === 'fixed') return [r.v, r.v];
  if (r.mode === 'range') return [r.lo, r.hi];
  return [0, c.rpmCap];
}

/* Ranks candidate shots: level first; within a level, hit chance, then margin to the rim
   (inches, capped so one huge margin doesn't outweigh hit chance). */
function score(o) {
  if (o.level < 1) return -10 + (o.pm > -1 ? o.pm : -1);
  return o.level * 10 + 2 * o.prob + 0.3 * clamp(o.wc / IN, -3, 3);
}

/* Balls of a burst that land in the opening when the flywheel isn't fully back to speed between
   them: each ball takes its dip out of the wheel, which regains c.recover rpm per second over the
   gap to the next ball. Later balls leave slower; their landing shift uses the shot's own
   sensitivity of landing point to exit speed. */
function burstBalls(c, o) {
  if (!o.dwdv || !o.ins) return { n: 1, balls: [{ rpm: o.rpm, pm: o.pm / IN }] };
  const E = c.edges, dipFrac = 1 - 1 / c.sagFac, balls = [];
  let r = o.rpm, n = 0;
  for (let k = 0; k < c.burstN; k++) {
    const dv = (r - o.rpm) * c.vPerRpm;
    const s = o.s + o.dwdv[0] * dv, w = o.w + o.dwdv[1] * dv;
    let pm = Infinity;
    for (let e = 0; e < 5; e++) pm = Math.min(pm, E[e][0] * s + E[e][1] * w - E[e][2] - o.ins[e]);
    if (pm >= 0) n++;
    balls.push({ rpm: r, pm: pm / IN });
    r = Math.min(o.rpm, r * (1 - dipFrac) + c.recover * c.burstGap);
  }
  return { n, balls };
}

function evalCell(c, cx, cy, detail) {
  const res = { x: cx, y: cy, level: -1, why: null, best: null, ranges: [null, null, null] };
  if (keepOut(c, cx, cy)) { res.why = 'keepout'; return res; }
  res.level = 0;
  const S = shotState(c, cx, cy);
  const motionSolve = c.motion === 'comp';
  const aList = hoodList(c);
  const rb = rpmBounds(c);
  const vmin = Math.max(rb[0] * c.vPerRpm, 0.3), vmax = Math.max(rb[1] * c.vPerRpm, 0.31);
  const rpmFixed = c.rpm.mode === 'fixed';
  let lastIns = insetsFor(c, [-c.nH[0], -c.nH[1], -c.nH[2]], 0);
  const cands = [];
  let whyBest = null;
  const tally = (w) => { if (w && (whyBest === null || WHY_RANK[w] > WHY_RANK[whyBest])) whyBest = w; };
  const addCand = (o, aDeg, T, D) => {
    o.aDeg = aDeg; o.rpm = o.vrel / c.vPerRpm; o.T = T; o.D = D;
    if (o.d) lastIns = insetsFor(c, o.d, 0);
    cands.push(o); if (o.level < 1) tally(o.why);
  };
  let vGuess = 0;
  if (!rpmFixed) {
    const tryAngle = (aDeg) => {
      const T = aimPoint(c, aimW(c, lastIns));
      const sol = aimV(c, S, T, aDeg * DEG, vmin, vmax, motionSolve, vGuess);
      if (!sol.ok) { tally(sol.why); return false; }
      const o = evalShot(c, S, aDeg * DEG, sol.v, sol.psi, null);
      addCand(o, aDeg, T, sol.D);
      return o.level >= 1;
    };
    const tried = aList.map(aDeg => ({ aDeg, ok: tryAngle(aDeg) }));
    // A narrow scoring window can sit between two grid angles: probe thirds wherever the outcome changes.
    for (let i = 0; i + 1 < tried.length; i++) {
      if (tried[i].ok === tried[i + 1].ok) continue;
      const a0 = tried[i].aDeg, a1 = tried[i + 1].aDeg;
      tryAngle(a0 + (a1 - a0) / 3); tryAngle(a0 + 2 * (a1 - a0) / 3);
    }
  } else {
    const v = rb[0] * c.vPerRpm;
    if (c.hood.mode === 'fixed') {
      const aDeg = c.hood.v, T = aimPoint(c, aimW(c, lastIns));
      const sol = aimFixed(c, S, T, aDeg * DEG, v, motionSolve);
      addCand(evalShot(c, S, aDeg * DEG, v, sol.psi, null), aDeg, T, sol.D);
    } else {
      const lo = c.hood.mode === 'range' ? c.hood.lo : 4, hi = c.hood.mode === 'range' ? c.hood.hi : 89;
      const n = Math.max(2, Math.ceil((hi - lo) / 1.5));
      const T = aimPoint(c, aimW(c, lastIns));
      const psi0 = headingTo(c, S, T, 0);
      const e0 = exitPt(c, S, psi0);
      let dhx = T[0] - e0[0], dhy = T[1] - e0[1]; const D0 = Math.hypot(dhx, dhy); dhx /= D0; dhy /= D0;
      const g = (a) => fly(c, launch(c, S, a, v, psi0, motionSolve), 1, 1, D0, dhx, dhy, false, null).z - T[2];
      let pa = lo * DEG, pg = g(pa), found = 0;
      for (let i = 1; i <= n; i++) {
        const a = (lo + (hi - lo) * i / n) * DEG, ga = g(a);
        if ((ga < 0) !== (pg < 0)) {
          const sol = aimA(c, S, T, v, pa, a, motionSolve);
          if (sol && sol.ok) { found++; addCand(evalShot(c, S, sol.a, v, sol.psi, null), sol.a / DEG, T, sol.D); }
        }
        pa = a; pg = ga;
      }
      if (!found) tally(g(hi * DEG) < 0 && g(lo * DEG) < 0 ? 'hi' : 'lo');
    }
  }
  // best + local refinement
  let best = null;
  for (const o of cands) if (!best || score(o) > score(best)) best = o;
  if (best && best.level >= 1 && !rpmFixed) {
    // re-center aim for the best arc's own entry direction
    const Tn = aimPoint(c, aimW(c, insetsFor(c, best.d, 0)));
    const tries = [[best.aDeg, Tn]];
    if (c.hood.mode !== 'fixed') {
      const hl = aList.length > 1 ? Math.abs(aList[1] - aList[0]) / 2 : 1.5;
      const lo = c.hood.mode === 'range' ? c.hood.lo : 6, hi = c.hood.mode === 'range' ? c.hood.hi : 88;
      if (best.aDeg - hl >= lo) tries.push([best.aDeg - hl, Tn]);
      if (best.aDeg + hl <= hi) tries.push([best.aDeg + hl, Tn]);
    }
    for (const [aDeg, T] of tries) {
      const sol = aimV(c, S, T, aDeg * DEG, vmin, vmax, motionSolve, best.vrel);
      if (!sol.ok) continue;
      const o = evalShot(c, S, aDeg * DEG, sol.v, sol.psi, null);
      o.aDeg = aDeg; o.rpm = o.vrel / c.vPerRpm; o.T = T; o.D = sol.D;
      cands.push(o);
      if (score(o) > score(best)) best = o;
    }
  }
  // ranges per level
  for (let L = 1; L <= 3; L++) {
    let r = null;
    for (const o of cands) {
      if (o.level < L) continue;
      let r0 = o.rpm, r1 = o.rpm, a0 = o.aDeg, a1 = o.aDeg;
      if (L === 1 && o.ins) {
        const wLo = o.ins[0], wHi = c.Hp - Math.max(o.ins[3], o.ins[4]) / c.kr;
        if (!rpmFixed && o.dwdv && o.dwdv[1] > 1e-4) {
          r0 = clamp((o.vrel + (wLo - o.w) / o.dwdv[1]) / c.vPerRpm, rb[0], rb[1]);
          r1 = clamp((o.vrel + (wHi - o.w) / o.dwdv[1]) / c.vPerRpm, rb[0], rb[1]);
          if (r0 > r1) { const t = r0; r0 = r1; r1 = t; }
        } else if (rpmFixed && c.hood.mode !== 'fixed' && o.dwda && Math.abs(o.dwda[1]) > 1e-4) {
          let x0 = o.aDeg + ((wLo - o.w) / o.dwda[1]) / DEG, x1 = o.aDeg + ((wHi - o.w) / o.dwda[1]) / DEG;
          if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
          const lo = c.hood.mode === 'range' ? c.hood.lo : 0, hi = c.hood.mode === 'range' ? c.hood.hi : 90;
          a0 = clamp(x0, lo, hi); a1 = clamp(x1, lo, hi);
        }
      }
      if (!r) r = [a0, a1, r0, r1];
      else { r[0] = Math.min(r[0], a0); r[1] = Math.max(r[1], a1); r[2] = Math.min(r[2], r0); r[3] = Math.max(r[3], r1); }
    }
    res.ranges[L - 1] = r;
  }
  if (best && best.level >= 1) { res.level = best.level; res.best = best; }
  else { res.level = 0; res.why = (best && best.why) || whyBest || 'nocross'; res.best = best; }
  if (detail && res.best && res.best.tr && res.best.tr.crossed && res.best.level >= 1) {
    const b = res.best;
    const o2 = evalShot(c, S, b.alpha, b.vrel, b.psi, { rec: true, detail: true });
    o2.aDeg = b.aDeg; o2.rpm = b.rpm; o2.T = b.T; o2.D = b.D;
    res.best = o2;
  } else if (detail && res.best) {
    const b = res.best;
    const o2 = evalShot(c, S, b.alpha, b.vrel, b.psi, { rec: true, detail: true });
    o2.aDeg = b.aDeg; o2.rpm = b.rpm; o2.T = b.T; o2.D = b.D;
    res.best = o2;
  }
  const bb = res.level >= 1 ? burstBalls(c, res.best) : { n: 0, balls: [] };
  res.burst = bb.n; res.burstBalls = bb.balls;
  res.S = S;
  return res;
}

/* ---------- compact output ---------- */
function compact(c, r) {
  const o = { l: r.level };
  if (r.level < 0) return o;
  if (r.why) o.why = r.why;
  const b = r.best;
  if (b && r.level >= 1) {
    o.p = b.prob; o.wc = b.wc / IN; o.pm = b.pm / IN;
    o.a = b.aDeg; o.r = b.rpm; o.t = b.tr.t;
    o.ea = Math.atan2(-b.tr.vz, Math.hypot(b.tr.vx, b.tr.vy)) / DEG;
    o.v = b.vrel;
  }
  o.rg = r.ranges;
  if (r.level >= 1) {
    o.bk = r.burst;
    o.ev = Math.hypot(b.tr.vx, b.tr.vy, b.tr.vz);   // entry speed, m/s
    o.de = b.dom || null;                            // dominant error source
    if (b.cap && b.cap.risky) o.cr = 1;              // stays in only with a well-known bounciness
  }
  return o;
}

function detailOut(c, r) {
  const b = r.best;
  const out = { level: r.level, why: r.why, ranges: r.ranges, x: r.x / IN, y: r.y / IN };
  if (!b) return out;
  const L = b.L;
  const ca = Math.cos(b.alpha), sa = Math.sin(b.alpha);
  const Tq = b.T || c.M0;
  const az = Math.atan2(Tq[1] - r.y, Tq[0] - r.x);
  let lead = (b.psi - az) / DEG; while (lead > 180) lead -= 360; while (lead < -180) lead += 360;
  let hdg = b.psi / DEG; while (hdg < 0) hdg += 360; while (hdg >= 360) hdg -= 360;
  out.shot = {
    hood: b.aDeg, rpm: b.rpm, vrel: b.vrel, vh: b.vrel * ca, vv: b.vrel * sa,
    vabs: Math.hypot(L.vx, L.vy, L.vz), heading: hdg, lead,
    spinRpm: Math.abs(c.sf * b.vrel / c.re) * 60 / (2 * Math.PI), spinDir: c.sf >= 0 ? 'back' : 'top',
    sagRpm: b.rpm * (1 - 1 / c.sagFac), exit: [L.ex / IN, L.ey / IN, L.ez / IN],
    wheelSurf: b.rpm / c.sagFac * 2 * Math.PI / 60 * c.Rc,
  };
  const tr = b.tr;
  out.level = r.level;
  out.flight = {
    D: b.D ? b.D / IN : null, tof: tr.t, apex: (tr.apex || 0) / IN,
    crossed: !!tr.crossed, blocked: tr.blocked || 0,
  };
  if (tr.crossed) {
    out.flight.entryAngle = Math.atan2(-tr.vz, Math.hypot(tr.vx, tr.vy)) / DEG;
    out.flight.entrySpeed = Math.hypot(tr.vx, tr.vy, tr.vz);
    out.flight.normAngle = Math.acos(clamp(-b.dn, -1, 1)) / DEG;
    out.flight.s = b.s / IN; out.flight.w = b.w / IN;
    out.flight.ins = b.ins ? b.ins.map(v => v / IN) : null;
  }
  out.burst = { n: r.burst, of: c.burstN, balls: r.burstBalls };
  out.cap = b.cap || null;
  out.rob = { prob: b.prob, wc: b.wc / IN, wcStrict: b.wcStrict / IN, wcStat: b.wcStat / IN, pm: b.pm / IN, contrib: b.contrib ? b.contrib.slice(0, 6).map(x => ({ name: x.name, v: x.v / IN })) : null, sigma: b.sigma ? b.sigma.map(v => v / IN) : null };
  out.path = b.rec ? Array.from(b.rec, v => v / IN) : null;
  out.T = b.T ? b.T.map(v => v / IN) : null;
  // spread trajectories (hood +/-, speed +/-) for the side view
  const S = r.S, e = c.err, motionNom = c.motion === 'comp' || c.motion === 'bias';
  const vars = [[e.hood, 0], [-e.hood, 0], [0, e.spd + (b.rpm > 1 ? e.rpm / b.rpm : 0)], [0, -(e.spd + (b.rpm > 1 ? e.rpm / b.rpm : 0))]];
  out.spread = vars.map(([da, dv]) => {
    const Lx = launch(c, S, b.alpha + da, b.vrel * (1 + dv), b.psi, motionNom);
    const rec = [];
    fly(c, Lx, 1, 2, 0, 0, 0, true, rec);
    return rec.map(v => v / IN);
  });
  return out;
}

/* geometry for drawing (inches) */
function geomOut(c) {
  const g = c.geom, E = c.edges;
  const pent = [[-c.W / 2, 0], [c.W / 2, 0], [c.W / 2, c.Hs], [0, c.Hp], [-c.W / 2, c.Hs]];
  const cells = c.cells.map(q => {
    const faces = [q.a1, q.a2].map(a => pent.map(([s, h]) => {
      const hh = h - q.dOff;
      return [(q.px + s + a * q.u[0] + hh * q.w[0]) / IN, (q.py + a * q.u[1] + hh * q.w[1]) / IN, (q.pz + a * q.u[2] + hh * q.w[2]) / IN];
    }));
    return { hive: q.hive, target: q.target, raised: q.raised, inner: faces[0], outer: faces[1], pivot: [q.px / IN, q.py / IN, q.pz / IN] };
  });
  return {
    cells, segs: c.segs.map(s => s.map((v, i) => i < 6 ? v / IN : v / IN)), feet: c.feet.map(f => [f[0] / IN, f[1] / IN]),
    M0: c.M0.map(v => v / IN), nH: c.nH, wH: c.wH, W: c.W / IN, Hs: c.Hs / IN, Hp: c.Hp / IN, tilt: c.P.tilt, sig: c.sig,
    vPerRpm: c.vPerRpm, sagFac: c.sagFac, grip: c.grip, kv: c.kv, Rc: c.Rc / IN, re: c.re / IN, motion: c.motion,
  };
}

/* ---------- worker protocol ---------- */
function gridPts(c, res) {
  const R = c.robotHalf / IN, xs = [];
  const start = Math.ceil(R / res) * res;
  for (let v = start; v <= 144 - R + 1e-9; v += res) xs.push(v);
  return xs;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  self.onmessage = (ev) => {
    const m = ev.data;
    try {
      if (m.type === 'map') {
        const c = buildCtx(m.P);
        for (const j of m.rows) {
          const y = m.ys[j] * IN, row = [];
          for (let i = 0; i < m.xs.length; i++) row.push(compact(c, evalCell(c, m.xs[i] * IN, y, false)));
          self.postMessage({ type: 'row', id: m.id, j, row });
        }
        self.postMessage({ type: 'done', id: m.id });
      } else if (m.type === 'sweep') {
        const out = [];
        for (const job of m.jobs) {
          const P = Object.assign({}, m.P); P[job.key] = job.value;
          const c = buildCtx(P);
          const xs = gridPts(c, m.res);
          let n = 0, cnt = [0, 0, 0];
          for (const y of xs) for (const x of xs) {
            const r = evalCell(c, x * IN, y * IN, false);
            if (r.level < 0) continue;
            n++; for (let L = 1; L <= 3; L++) if (r.level >= L) cnt[L - 1]++;
          }
          out.push({ key: job.key, value: job.value, n, frac: cnt.map(v => n ? v / n : 0) });
        }
        self.postMessage({ type: 'sweep', id: m.id, out });
      } else if (m.type === 'probe') {
        const c = buildCtx(m.P);
        const r = evalCell(c, m.x * IN, m.y * IN, true);
        self.postMessage({ type: 'probe', id: m.id, d: detailOut(c, r), g: m.wantGeom ? geomOut(c) : null });
      } else if (m.type === 'pts') {
        // Arbitrary field spots [[i, j, xIn, yIn], ...], streamed back in small batches.
        const c = buildCtx(m.P);
        let batch = [];
        for (const [i, j, x, y] of m.pts) {
          batch.push([i, j, compact(c, evalCell(c, x * IN, y * IN, false))]);
          if (batch.length >= 24) { self.postMessage({ type: 'pts', id: m.id, pass: m.pass, out: batch }); batch = []; }
        }
        self.postMessage({ type: 'pts', id: m.id, pass: m.pass, out: batch, done: true });
      } else if (m.type === 'calibrate') {
        self.postMessage({ type: 'calibrated', id: m.id, fit: calibrate(m.P, m.shots, m.keys) });
      } else if (m.type === 'geom') {
        const c = buildCtx(m.P);
        self.postMessage({ type: 'geom', id: m.id, g: geomOut(c) });
      } else if (m.type === 'solve') {
        const results = [];
        for (const job of m.jobs) {
          const N = 13, vals = [], lv = [];
          const lvAt = (v) => { const P = Object.assign({}, m.P); P[job.key] = v; const c = buildCtx(P); return evalCell(c, m.x * IN, m.y * IN, false).level; };
          for (let i = 0; i < N; i++) { const v = job.lo + (job.hi - job.lo) * i / (N - 1); vals.push(v); lv.push(lvAt(v)); }
          const out = [];
          for (let L = 1; L <= 3; L++) {
            let lo = null, hi = null;
            for (let i = 0; i < N; i++) {
              if (lv[i] < L) continue;
              let a = vals[i], b = vals[i];
              if (i > 0 && lv[i - 1] < L) { let x0 = vals[i - 1], x1 = vals[i]; for (let k = 0; k < 4; k++) { const xm = 0.5 * (x0 + x1); if (lvAt(xm) >= L) x1 = xm; else x0 = xm; } a = x1; }
              if (i < N - 1 && lv[i + 1] < L) { let x0 = vals[i], x1 = vals[i + 1]; for (let k = 0; k < 4; k++) { const xm = 0.5 * (x0 + x1); if (lvAt(xm) >= L) x0 = xm; else x1 = xm; } b = x0; }
              lo = lo === null ? a : Math.min(lo, a); hi = hi === null ? b : Math.max(hi, b);
            }
            out.push(lo === null ? null : [lo, hi]);
          }
          results.push({ key: job.key, ranges: out, edgeLo: job.lo, edgeHi: job.hi });
          self.postMessage({ type: 'solvePart', id: m.id, part: results[results.length - 1] });
        }
        self.postMessage({ type: 'solveDone', id: m.id });
      }
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, msg: String(err && err.stack || err) });
    }
  };
}

if (typeof module !== 'undefined') module.exports = { buildCtx, evalCell, fly, launch, aimV, capture, predictShot, calibrate, compact, detailOut, geomOut, gridPts, IN, DEG };
