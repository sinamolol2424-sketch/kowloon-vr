// 구룡성채 수리점 웹 VR — 둘러보기, 가방 집기, 총 조립
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { Bench, GUNS } from './assembly.js';
import { makePanel, sound } from './ui.js';

const LIGHT = 4;              // 구운 빛은 1/4 로 저장되어 있다 (Tools/web_shop.py)
const EYE = 1.8;              // 건물을 높이 1.2배로 키워서 실제보다 조금 높다
const $ = id => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = true;
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0a09);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 60);
const rig = new THREE.Group();          // 발 위치. VR 에서는 헤드셋이 이 안에서 움직인다
rig.add(camera);
scene.add(rig);
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x3a3430, 1.6));   // 손에 드는 물건용 (건물은 구운 빛)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (!renderer.xr.isPresenting) renderer.setSize(innerWidth, innerHeight);
});

// ---------- 불러오기 ----------
const loader = new GLTFLoader();
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/'));
let map, floor, portals = [];
const grabbables = [];       // 손에 들 수 있는 것: userData.kind = 'bag' | 'gun'
let bench = null, bagModel = null;

function bakedMaterial(m, mesh) {
  const lit = new THREE.MeshBasicMaterial({ map: m.map, color: m.color, side: m.side, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: !!mesh.geometry.attributes.color });
  if (lit.vertexColors) lit.color.multiplyScalar(LIGHT);
  if (m.emissive.getHex() !== 0 && (!m.emissiveMap || /CRT|Neon|Win_|Bulb/.test(m.name))) {        // 전구·네온·화면은 스스로 빛난다
    lit.vertexColors = false;
    lit.color.copy(m.emissive);
    lit.map = m.emissiveMap || m.map;
  }
  if (m.map) m.map.anisotropy = 4;
  return lit;
}

async function load() {
  map = await (await fetch('assets/map.json')).json();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(map.floor.flat(), 3));
  floor = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  floor.updateMatrixWorld();

  const shop = await loader.loadAsync('assets/shop.glb', e => { $('load').textContent = `불러오는 중… ${e.total ? Math.round(e.loaded / e.total * 100) : 0}%`; });
  shop.scene.traverse(o => { if (o.isMesh) { o.material = bakedMaterial(o.material, o); o.matrixAutoUpdate = false; o.updateMatrix(); } });
  scene.add(shop.scene);

  bagModel = (await loader.loadAsync('assets/briefcase.glb')).scene;
  for (const code of Object.keys(GUNS).sort(() => Math.random() - 0.5).slice(0, 2)) addBag(code);
  bench = new Bench({
    scene, loader, position: map.bench, say,
    onDone: (code, gun) => { gun.userData = { kind: 'gun', code }; grabbables.push(gun); addBag(code); },
    onFail: code => addBag(code),
  });
  bench.baseYaw = THREE.MathUtils.degToRad(map.benchYaw);
  bench.stage.rotation.y = bench.baseYaw;

  portals = map.stairs.filter(s => groundAt(new THREE.Vector3(...s.to), 1.5) !== null);
  rig.position.fromArray(map.spawn);
  settle();
  yaw = Math.PI / 2;
  $('load').textContent = '준비됐어요';
  $('play').disabled = false;
}

/** 카운터에 부품 가방을 놓는다 (이미 있으면 그 위에) */
function addBag(code) {
  const stacked = grabbables.filter(g => g.userData.kind === 'bag' && Math.hypot(g.position.x - map.bags[0], g.position.z - map.bags[2]) < 0.4 && g.position.y > map.bags[1] - 0.1).length;
  const b = new THREE.Group();
  const look = bagModel.clone();
  look.rotation.x = Math.PI / 2;
  look.position.z = 0.13;
  b.add(look);
  const tag = makePanel(0.26, 0.09, 256);
  tag.userData.set([{ text: code, size: 56, bold: true }]);
  tag.position.y = 0.071;
  tag.rotation.x = -Math.PI / 2;
  b.add(tag);
  b.position.fromArray(map.bags).y += 0.065 + stacked * 0.126;
  b.rotation.y = THREE.MathUtils.degToRad(map.bagsYaw + (stacked ? 10 : -8));
  b.userData = { kind: 'bag', code };
  scene.add(b);
  grabbables.push(b);
}

// ---------- 안내 글자 (PC = 화면 아래, VR = 눈앞) ----------
const toast = makePanel(0.5, 0.09, 768);
toast.position.set(0, -0.28, -0.9);
toast.material.depthTest = false;
toast.renderOrder = 998;
toast.visible = false;
camera.add(toast);
let toastLeft = 0, toastText = '';
function say(text, kind = 'normal') {
  toastText = text;
  toastLeft = 3.2;
  toast.userData.set([{ text, size: 44 }], { bad: '#ff7b5c', good: '#9dff8a', normal: '#e9a94a' }[kind]);
}

// ---------- 바닥 ----------
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
/** 그 자리의 바닥 높이. 걸을 수 없는 곳이면 null */
function groundAt(p, reach = 0.8) {
  ray.set(new THREE.Vector3(p.x, p.y + reach, p.z), down);
  ray.far = reach * 2;
  const hit = ray.intersectObject(floor)[0];
  ray.far = Infinity;
  return hit ? hit.point.y - 0.04 : null;
}
function settle() {
  const y = groundAt(rig.position, 1.5);
  if (y !== null) rig.position.y = y;
}
/** 머리(발)의 실제 위치: VR 에서는 방 안에서 걸은 만큼 더해진다 */
function feet() {
  const p = new THREE.Vector3();
  if (renderer.xr.isPresenting) { camera.getWorldPosition(p); p.y = rig.position.y; } else p.copy(rig.position);
  return p;
}
function tryMove(dx, dz) {
  const f = feet();
  for (const [x, z] of [[dx, dz], [dx, 0], [0, dz]]) {
    const y = groundAt(new THREE.Vector3(f.x + x, f.y, f.z + z));
    if (y === null) continue;
    rig.position.x += x;
    rig.position.z += z;
    rig.position.y = y;
    return;
  }
}
function goTo(point) {
  const f = feet();
  rig.position.x += point.x - f.x;
  rig.position.z += point.z - f.z;
  rig.position.y = point.y;
}

// ---------- 화면 어둡게 (계단·순간이동) ----------
const veil = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false }));
veil.renderOrder = 999;
veil.visible = false;
camera.add(veil);
let fade = null;
function fadeTo(action) { if (!fade) fade = { t: 0, action, done: false }; }
function tickFade(dt) {
  if (!fade) return;
  fade.t += dt / 0.22;
  if (fade.t >= 1 && !fade.done) { fade.done = true; fade.action(); }
  veil.visible = true;
  veil.material.opacity = fade.t < 1 ? fade.t : Math.max(0, 2 - fade.t);
  if (fade.t >= 2) { fade = null; veil.visible = false; }
}

// ---------- 계단 ----------
let portalLock = null;
function tickPortals() {
  if (fade) return;
  const f = feet();
  let inside = null;
  for (const s of portals) {
    const d = new THREE.Vector3(f.x - s.p[0], 0, f.z - s.p[2]).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -THREE.MathUtils.degToRad(s.yaw));
    if (Math.abs(f.y - (s.p[1] - s.size[1] / 2)) < 0.8 && Math.abs(d.x) < s.size[0] / 2 + 0.25 && Math.abs(d.z) < s.size[2] / 2 + 0.25) inside = s;
  }
  if (!inside) { portalLock = null; return; }
  if (portalLock) return;
  fadeTo(() => {
    const to = new THREE.Vector3(...inside.to);
    const y = groundAt(to, 1.5);
    if (y !== null) to.y = y;
    goTo(to);
    portalLock = inside;
  });
}

// ---------- PC 조작 ----------
let yaw = 0, pitch = 0;
const keys = new Set();
addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'KeyE' && !e.repeat) toggleHeld(); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('mousedown', e => { if (e.button === 0 && document.pointerLockElement === renderer.domElement) toggleHeld(); });
addEventListener('blur', () => keys.clear());
// 마우스 잠금이 안 되는 창(미리보기 등)에서는 끌어서 둘러본다
let dragLook = false, dragging = false, dragged = 0;
async function lock() {
  if (dragLook) return;
  try { await renderer.domElement.requestPointerLock(); } catch { dragLook = true; $('start').hidden = true; }
}
$('play').onclick = () => { $('start').hidden = true; lock(); };
renderer.domElement.addEventListener('mousedown', () => { if (dragLook) { dragging = true; dragged = 0; } });
addEventListener('mouseup', () => { if (dragging && dragged < 4) toggleHeld(); dragging = false; });
renderer.domElement.addEventListener('click', () => { if (!renderer.xr.isPresenting && document.pointerLockElement !== renderer.domElement) lock(); });
document.addEventListener('pointerlockchange', () => { if (!renderer.xr.isPresenting && !dragLook) $('start').hidden = document.pointerLockElement === renderer.domElement; });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement && !dragging) return;
  const k = dragging ? -0.005 : 0.0022;
  dragged += Math.abs(e.movementX) + Math.abs(e.movementY);
  yaw -= e.movementX * k;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * k, -1.45, 1.45);
});
let held = null;
function aimed() {
  ray.setFromCamera(new THREE.Vector2(), camera);
  ray.far = 2.6;
  const hit = ray.intersectObjects(grabbables, true)[0];
  ray.far = Infinity;
  return hit ? grabbables.find(g => { let o = hit.object; while (o) { if (o === g) return true; o = o.parent; } }) : null;
}
let heldPart = null;                 // PC 에서 집은 총 부품: 작업대 위에서 조준점을 따라온다
const tablePlane = new THREE.Plane();
function toggleHeld() {
  if (renderer.xr.isPresenting || !bench) return;
  if (heldPart) { bench.release(heldPart); heldPart = null; return; }
  if (held) {
    const g = held;
    held = null;
    if (g.userData.kind === 'bag' && bench.near(feetAtHand())) { useBag(g); return; }
    drop(g);
    return;
  }
  if (bench.active) {
    ray.setFromCamera(new THREE.Vector2(), camera);
    const p = bench.hit(ray);
    if (p) { heldPart = p; bench.grab(p, bench); return; }
  }
  const g = aimed();
  if (!g) return;
  held = g;
  delete g.userData.fall;
  camera.attach(g);
  if (g.userData.kind === 'gun') { g.position.set(0.25, -0.28, -0.75); g.rotation.set(0, -Math.PI / 2 - 0.15, 0); }
  else { g.position.set(0.28, -0.4, -0.75); g.rotation.set(0, 0.3, 0); }
  sound('pick');
}
function feetAtHand() { const p = feet(); p.y += 1; return p; }
/** 부품 가방을 작업대에 놓았을 때 */
function useBag(g) {
  if (bench.code) { say('먼저 하던 조립을 끝내세요', 'bad'); drop(g); return; }
  const code = g.userData.code;
  g.removeFromParent();
  grabbables.splice(grabbables.indexOf(g), 1);
  // 작업대에 남은 총은 안쪽으로 밀어 둔다
  grabbables.filter(x => x.userData.kind === 'gun' && x.parent === scene && x.position.distanceTo(bench.origin) < 0.9).forEach((x, i) => {
    const away = new THREE.Vector3().subVectors(bench.origin, feet()).setY(0).normalize();
    x.position.copy(bench.origin).addScaledVector(away, 0.42 - i * 0.02).add(new THREE.Vector3(-away.z, 0, away.x).multiplyScalar((i % 3 - 1) * 0.4)).y += 0.05 + Math.floor(i / 3) * 0.06;
    delete x.userData.fall;
  });
  bench.start(code, feet()).catch(e => { console.error(e); bench.clear(); addBag(code); say('총 모델을 불러오지 못했다', 'bad'); });
}
function tickPart(dt) {
  if (!heldPart) return;
  if (!heldPart.holder) { heldPart = null; return; }       // 붙었거나 시간이 끝났다
  ray.setFromCamera(new THREE.Vector2(), camera);
  tablePlane.setFromNormalAndCoplanarPoint(THREE.Object3D.DEFAULT_UP, bench.origin.clone().setY(bench.origin.y + 0.1));
  const at = ray.ray.intersectPlane(tablePlane, new THREE.Vector3());
  if (!at || at.distanceTo(bench.origin) > 1.4) return;
  const want = bench.stage.worldToLocal(at);
  const p = heldPart, k = 1 - Math.exp(-22 * dt);
  p.body.position.lerp(want.sub(p.offset), k);
  p.body.quaternion.slerp(p.target.quat, k);
}
/** 놓으면 아래 물건(카운터·작업대·바닥) 위에 내려앉는다 */
function drop(g) {
  scene.attach(g);
  const p = g.getWorldPosition(new THREE.Vector3());
  ray.set(p.clone().setY(p.y + 0.12), down);
  ray.far = 4;
  const hit = ray.intersectObjects(scene.children.filter(c => c !== g && c !== rig && !grabbables.includes(c)), true)[0];
  ray.far = Infinity;
  const turn = new THREE.Euler().setFromQuaternion(g.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
  g.rotation.set(g.userData.kind === 'gun' ? -Math.PI / 2 : 0, turn, 0, 'YXZ');      // 총은 옆으로 눕힌다
  g.userData.fall = hit ? hit.point.y + 0.065 : rig.position.y + 0.065;
}

// ---------- VR 컨트롤러 ----------
const factory = new XRControllerModelFactory();
const marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.85 }));
marker.visible = false;
scene.add(marker);
const hands = [0, 1].map(i => {
  const c = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(factory.createControllerModel(grip));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -5)]), new THREE.LineBasicMaterial({ color: 0xffb84d }));
  line.visible = false;
  c.add(line);
  rig.add(c, grip);
  const hand = { c, grip, line, aiming: false, target: null, held: null, part: null, source: null };
  c.addEventListener('connected', e => { hand.source = e.data; });
  c.addEventListener('disconnected', () => { hand.source = null; });
  c.addEventListener('selectstart', () => { hand.aiming = true; });
  c.addEventListener('selectend', () => {
    hand.aiming = false;
    line.visible = false;
    if (hand.target) { const t = hand.target; hand.target = null; fadeTo(() => goTo(t)); }
  });
  c.addEventListener('squeezestart', () => {
    const p = grip.getWorldPosition(new THREE.Vector3());
    const part = bench?.active ? bench.nearest(p) : null;
    if (part) { hand.part = part; bench.grab(part, grip); buzz(hand, 0.3, 30); return; }
    let best = null, dist = 0.45;
    for (const g of grabbables) {
      const d = new THREE.Box3().setFromObject(g).distanceToPoint(p);
      if (d < dist) { dist = d; best = g; }
    }
    if (!best) return;
    for (const h of hands) if (h.held === best) h.held = null;
    hand.held = best;
    delete best.userData.fall;
    grip.attach(best);
    buzz(hand, 0.4, 40);
  });
  c.addEventListener('squeezeend', () => {
    if (hand.part) { if (hand.part.holder === grip) bench.release(hand.part); hand.part = null; }
    if (!hand.held) return;
    const g = hand.held;
    hand.held = null;
    if (g.userData.kind === 'bag' && bench.near(grip.getWorldPosition(new THREE.Vector3()))) useBag(g);
    else drop(g);
  });
  grip.userData.onSnap = () => buzz(hand, 0.9, 90);          // 부품이 붙는 순간 손이 떨린다
  return hand;
});
function buzz(hand, strength, ms) { hand.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); }
let turnReady = true;
function tickVR(dt) {
  marker.visible = false;
  for (const h of hands) {
    const axes = h.source?.gamepad?.axes ?? [];
    const x = axes[2] ?? axes[0] ?? 0, y = axes[3] ?? axes[1] ?? 0;
    if (h.source?.handedness === 'right') {
      if (Math.abs(x) < 0.3) turnReady = true;
      else if (Math.abs(x) > 0.7 && turnReady) {         // 30도씩 딱딱 끊어 돌기 (멀미가 덜하다)
        turnReady = false;
        const f = feet(), a = -Math.sign(x) * Math.PI / 6;
        rig.rotation.y += a;
        const d = new THREE.Vector3().subVectors(rig.position, f).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a);
        rig.position.x = f.x + d.x;
        rig.position.z = f.z + d.z;
      }
    } else if (Math.hypot(x, y) > 0.15) {
      const look = camera.getWorldDirection(new THREE.Vector3());
      look.y = 0;
      look.normalize();
      const side = new THREE.Vector3(-look.z, 0, look.x);
      tryMove((side.x * x - look.x * y) * 1.8 * dt, (side.z * x - look.z * y) * 1.8 * dt);
    }
    h.target = null;
    if (!h.aiming) continue;
    h.line.visible = true;
    const from = h.c.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(h.c.matrixWorld);
    ray.set(from, dir);
    ray.far = 8;
    const hit = ray.intersectObject(floor)[0];
    ray.far = Infinity;
    if (!hit || Math.abs(hit.point.y - rig.position.y) > 1) continue;
    h.target = hit.point.clone().setY(hit.point.y - 0.04);
    marker.position.copy(hit.point).y += 0.02;
    marker.visible = true;
  }
}
renderer.xr.addEventListener('sessionstart', () => { $('start').hidden = true; rig.rotation.y = yaw; rig.scale.setScalar(1.15); camera.rotation.set(0, 0, 0); });
renderer.xr.addEventListener('sessionend', () => { $('start').hidden = false; yaw = rig.rotation.y; rig.rotation.y = 0; rig.scale.setScalar(1); camera.position.set(0, EYE, 0); });

// ---------- 매 프레임 ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (map && floor && bench) {
    tickPart(dt);
    bench.tick(dt);
    toastLeft -= dt;
    toast.visible = toastLeft > 0 && renderer.xr.isPresenting;
    if (renderer.xr.isPresenting) tickVR(dt);
    else {
      camera.position.set(0, EYE, 0);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), z = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
      if (x || z) {
        const v = new THREE.Vector3(x, 0, z).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).multiplyScalar((keys.has('ShiftLeft') ? 4 : 2.4) * dt);
        tryMove(v.x, v.z);
      }
      const g = held || heldPart ? null : aimed();
      ray.setFromCamera(new THREE.Vector2(), camera);
      const part = !held && !heldPart && bench.active ? bench.hit(ray) : null;
      $('hint').textContent = toastLeft > 0 ? toastText : heldPart ? `[E·클릭] ${heldPart.name} 놓기 · 같은 모양의 흐린 자리로 가져가세요`
        : held ? (held.userData.kind === 'bag' && bench.near(feetAtHand()) ? `[E] '${held.userData.code}' 조립 시작` : '[E] 내려놓기')
        : part ? `[E·클릭] ${part.name} 집기` : g ? (g.userData.kind === 'bag' ? `[E] '${g.userData.code}' 부품 가방 들기` : `[E] '${g.userData.code}' 총 들기`) : '';
    }
    tickPortals();
    $('where').textContent = rig.position.y < 20 ? '6F · 비밀 작업실' : '7F · 수리점';
    for (const g of grabbables) if (g.userData.fall !== undefined) {
      g.position.y = Math.max(g.userData.fall, g.position.y - 4 * dt);
      if (g.position.y <= g.userData.fall) delete g.userData.fall;
    }
  }
  tickFade(dt);
  renderer.render(scene, camera);
});
load().catch(e => { $('load').textContent = '불러오지 못했어요: ' + e.message; console.error(e); });
window.game = { rig, camera, renderer, scene, tryMove, goTo, groundAt, look: (y, p) => { yaw = y; pitch = p; }, get map() { return map; }, get portals() { return portals; }, grabbables, toggleHeld, useBag, drop, hands, get bench() { return bench; } };
