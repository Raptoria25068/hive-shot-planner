/* 3D view of the shot: field, HIVE CELLS and frame, robot, and the flight with a ball flying it.
   three.js loads only when the view first opens; drag orbits, the wheel zooms. Units: inches, z up. */
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
let THREE = null, renderer = null, scene = null, camera = null, world = null, host = null;
const orbit = { theta: -2.2, phi: 1.05, r: 190, target: [72, 72, 28] };
let ball = null, path = null, t0 = 0, anim = 0;

export async function open3d(container, geom, detail, P, pin) {
  host = container;
  try {
    if (!THREE) THREE = await import("../vendor/three.module.min.js");
    if (!renderer) setup();
  } catch {
    // Some browsers and managed laptops turn WebGL off; say so in place of the scene.
    renderer = null;
    host.innerHTML = '<p class="nogl">The 3D view needs WebGL, which this browser has turned off. The side view and map still work.</p>';
    return;
  }
  build(geom, detail, P, pin);
  resize();
  play();
}
export function close3d() { cancelAnimationFrame(anim); }

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.append(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 1, 2000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(40, -60, 160);
  scene.add(sun);
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", e => {
    if (!drag) return;
    orbit.theta -= (e.clientX - drag[0]) * 0.008;
    orbit.phi = Math.min(Math.max(orbit.phi - (e.clientY - drag[1]) * 0.006, 0.15), 1.5);
    drag = [e.clientX, e.clientY];
    draw();
  });
  el.addEventListener("pointerup", () => { drag = null; });
  el.addEventListener("wheel", e => { e.preventDefault(); orbit.r = Math.min(Math.max(orbit.r * (1 + e.deltaY * 0.001), 60), 420); draw(); }, { passive: false });
  new ResizeObserver(() => { resize(); draw(); }).observe(host);
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}

const mat = (color, opacity = 1, extra = {}) => new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, ...extra });

function build(geom, d, P, pin) {
  if (world) {
    // free the previous scene's GPU buffers
    scene.remove(world);
    world.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  world = new THREE.Group();
  scene.add(world);
  // field tiles
  const tile = new THREE.PlaneGeometry(24, 24);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const m = new THREE.Mesh(tile, mat((i + j) % 2 ? 0x1a1516 : 0x201a1b));
    m.position.set(i * 24 + 12, j * 24 + 12, 0);
    world.add(m);
  }
  const wall = mat(0xf9f6ee, 0.18);
  for (const [x, y, w, h] of [[72, 0, 144, 0.5], [72, 144, 144, 0.5], [0, 72, 0.5, 144], [144, 72, 0.5, 144]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 12), wall);
    m.position.set(x, y, 6);
    world.add(m);
  }
  // CELLS: pentagonal prisms, tinted by alliance
  for (const cell of geom.cells) {
    const col = cell.hive === "red" ? 0xff2c2c : 0x3d74ff;
    const pts = cell.inner.concat(cell.outer).flat();
    const idx = [];
    for (let k = 0; k < 5; k++) { const a = k, b = (k + 1) % 5; idx.push(a, b, b + 5, a, b + 5, a + 5); }
    idx.push(0, 1, 2, 0, 2, 3, 0, 3, 4);
    if (!cell.target) idx.push(5, 7, 6, 5, 8, 7, 5, 9, 8);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // faces sit a hair behind their own rim so the outline stays crisp
    world.add(new THREE.Mesh(g, mat(col, cell.target ? 0.42 : 0.2, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
    const rim = new THREE.BufferGeometry().setFromPoints(cell.outer.concat([cell.outer[0]]).map(p => new THREE.Vector3(...p)));
    world.add(new THREE.Line(rim, new THREE.LineBasicMaterial({ color: cell.target ? 0xf9f6ee : col })));
  }
  const bars = [];
  for (const s of geom.segs) bars.push(new THREE.Vector3(s[0], s[1], s[2]), new THREE.Vector3(s[3], s[4], s[5]));
  world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bars), new THREE.LineBasicMaterial({ color: 0xddc3a2 })));
  // robot
  const rs = P.robotSize, heading = d && d.shot ? d.shot.heading * Math.PI / 180 : 0;
  const robot = new THREE.Mesh(new THREE.BoxGeometry(rs, rs, Math.max(P.launchH - 2, 6)), mat(0xf9f6ee, 0.22));
  robot.position.set(pin.x, pin.y, Math.max(P.launchH - 2, 6) / 2);
  robot.rotation.z = heading;
  world.add(robot);
  // flight
  path = null; ball = null;
  if (d && d.path && d.path.length >= 6) {
    path = [];
    for (let k = 0; k < d.path.length; k += 3) path.push(new THREE.Vector3(d.path[k], d.path[k + 1], d.path[k + 2]));
    const col = d.level >= 3 ? 0xff2c2c : d.level === 2 ? 0xb3162c : d.level === 1 ? 0xe0405a : 0x6f93b8;
    // WebGL lines are always one pixel wide, so the flight is drawn as a thin glowing tube.
    const curve = new THREE.CatmullRomCurve3(path);
    world.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(path.length * 2, 32), 0.35, 8, false), mat(col, 0.95, { emissive: col, emissiveIntensity: 0.45 })));
    ball = new THREE.Mesh(new THREE.SphereGeometry(P.ballD / 2, 20, 14), mat(0xff2c2c, 1, { emissive: 0x440000 }));
    world.add(ball);
    orbit.target = [(pin.x + geom.M0[0]) / 2, (pin.y + geom.M0[1]) / 2, 30];
  }
}

function play() {
  cancelAnimationFrame(anim);
  if (!ball || REDUCED) { if (ball) ball.position.copy(path[path.length - 1]); draw(); return; }
  t0 = performance.now();
  const dur = 1100;
  const step = now => {
    // a frame's timestamp can fall just before t0, so progress is clamped at zero
    const u = Math.min(Math.max((now - t0) / dur, 0), 1), f = u * (path.length - 1), k = Math.min(Math.floor(f), path.length - 2);
    ball.position.lerpVectors(path[k], path[k + 1], f - k);
    draw();
    if (u < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
export const replay3d = () => play();

function draw() {
  if (!renderer) return;
  const [tx, ty, tz] = orbit.target, r = orbit.r;
  camera.position.set(tx + r * Math.sin(orbit.phi) * Math.cos(orbit.theta), ty + r * Math.sin(orbit.phi) * Math.sin(orbit.theta), tz + r * Math.cos(orbit.phi));
  camera.lookAt(tx, ty, tz);
  renderer.render(scene, camera);
}
