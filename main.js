// 구룡성채 수리점 웹 VR — 둘러보기, 가방 집기, 총 조립
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { Bench, GUNS } from './assembly.js';
import { makePanel, sound } from './ui.js';
import { Game } from './game.js';
import { Nav } from './nav.js';
import { Police, Shutter } from './police.js';
import { Street } from './street.js';
import { Repair } from './repair.js';
import { Guide } from './guide.js';
import { settings, SettingsPanel } from './settings.js';

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
const lift = new THREE.Group();         // 키 높이 설정
rig.add(lift);
lift.add(camera);
scene.add(rig);
scene.add(new THREE.HemisphereLight(0xffe2b8, 0x3a3430, 1.6));   // 손에 드는 물건용 (건물은 구운 빛)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (!renderer.xr.isPresenting) renderer.setSize(innerWidth, innerHeight);
});

const zones = { z7: [], z6: [], zf: [] };       // 안 보이는 층은 그리지 않는다
// ---------- 불러오기 ----------
const loader = new GLTFLoader();
loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/'));
let map, floor, portals = [];
const grabbables = [];       // 손에 들 수 있는 것: userData.kind = 'bag' | 'gun'
let bench = null, bagModel = null, game = null, nav = null, police = null, shutter = null, solid = null, street = null, repair = null, guide = null;

function bakedMaterial(m, mesh) {
  const lit = new THREE.MeshBasicMaterial({ map: m.map, color: m.color, side: m.side, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: !!mesh.geometry.attributes.color });
  if (lit.vertexColors) lit.color.multiplyScalar(LIGHT);
  if (m.emissive && m.emissive.getHex() !== 0 && (!m.emissiveMap || /CRT|Neon|Win_|Bulb/.test(m.name))) {        // 전구·네온·화면은 스스로 빛난다
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
  shop.scene.traverse(o => { if (o.isMesh) { o.userData.baseName = o.material.name; o.material = bakedMaterial(o.material, o); o.matrixAutoUpdate = false; o.updateMatrix(); } });
  scene.add(shop.scene);
  shop.scene.traverse(o => { const z = /^(z7|z6|zf)_/.exec(o.name) ?? /^(z7|z6|zf)_/.exec(o.parent?.name ?? ''); if (o.isMesh && z) zones[z[1]].push(o); });
  solid = shop.scene;

  bagModel = (await loader.loadAsync('assets/briefcase.glb')).scene;
  bench = new Bench({
    scene, loader, position: map.bench, say,
    onDone: (code, gun) => { gun.userData = { kind: 'gun', code }; grabbables.push(gun); game.assembled(code); if (renderer.xr.isPresenting) drop(gun); },
    onFail: () => game.fail('조립 시간 초과 · 부품을 못 쓰게 됐다'),
  });
  bench.baseYaw = THREE.MathUtils.degToRad(map.benchYaw);
  bench.stage.rotation.y = bench.baseYaw;

  const person = (await loader.loadAsync('assets/customer.glb')).scene;
  nav = new Nav(map);
  shop.scene.updateMatrixWorld(true);
  shop.scene.traverse(o => { if (o.isMesh && /^Wall_/.test(o.userData.baseName ?? '')) nav.addWalls(o, 23.05); });
  shutter = new Shutter(scene, nav);
  const phone = (await loader.loadAsync('assets/phone.glb')).scene;
  game = new Game({
    scene, map, customerModel: person, phoneModel: phone,
    suspect: n => police.add(n), isRaid: () => police?.raid, policeTodo: () => police?.todo(), shopClosed: () => shutter.isDown, say, addBag, feet,
    viewer: () => camera.getWorldPosition(new THREE.Vector3()),
    isBusy: () => rig.position.y < 20 || !!bench.code,
    heldGuns: () => grabbables.filter(g => g.userData.kind === 'gun').map(g => g.userData.code),
    assembling: () => bench.active ? `조립 ${bench.parts.filter(x => x.placed).length}/${bench.parts.length} · 남은 시간 ${Math.ceil(bench.left)}초` : '',
    repairTodo: () => { const v = repair?.visitor; return !v || v.state !== 'waiting' ? '' : !v.given ? `${v.name}의 ${v.itemName} 받기` : repair.item?.userData.broken ? `${v.itemName} 수리 · ${Math.ceil(v.left)}초` : `${v.name}에게 돌려주기 · ${Math.ceil(v.left)}초`; },
    bagCount: () => grabbables.filter(g => g.userData.kind === 'bag').length,
  });
  police = new Police({
    scene, nav, shutter, game, say, feet, model: (await loader.loadAsync('assets/police.glb')).scene,
    stairs: map.stairs.filter(s => groundAt(new THREE.Vector3(...s.to), 1.5) !== null),
    eye: () => camera.getWorldPosition(new THREE.Vector3()),
    evidence: lyingEvidence,
    handsBusy: carrying,
    onRaid: () => { game.onRaid(); if (heldPart) { bench.release(heldPart); heldPart = null; } for (const h of hands) if (h.part) h.letGo(); bench.clear(); },
    setOver: (title, text, win) => game.end(text, title, win),
  });
  const people = {};
  await Promise.all(['junk', 'food', 'dealer', 'clinic', 'gamble', 'resident'].map(async id => { people[id] = (await loader.loadAsync(`assets/npc_${id}.glb`)).scene; }));
  street = new Street({
    scene, nav, game, police, shutter, say, feet, models: people, triadModel: person,
    eye: () => camera.getWorldPosition(new THREE.Vector3()),
    handsBusy: carrying,
    buzz: (s, ms) => { for (const h of hands) buzz(h, s, ms); },
    visitor: () => repair?.visitor,
  });
  repair = new Repair({ scene, loader, solid, game, police, street, shutter, say, feet, grabbables, eye: () => camera.getWorldPosition(new THREE.Vector3()), buzz: (s, ms) => { for (const h of hands) buzz(h, s, ms); } });
  police.friends = () => repair.friends();
  guide = new Guide({
    scene, map, game, police, repair, bench, feet, settings, stairs: police.stairs,
    eye: () => camera.getWorldPosition(new THREE.Vector3()), vr: () => renderer.xr.isPresenting,
    held: () => held ?? hands.find(h => h.held)?.held,
    loose: kind => grabbables.find(g => g.userData.kind === kind && g.parent === scene),
  });
  applySettings();
  game.nextCall = Infinity;               // 시작 화면에서는 전화가 울리지 않는다

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
  const box = new THREE.Box3().setFromObject(look), mid = box.getCenter(new THREE.Vector3());
  look.position.sub(mid);              // 한가운데가 손잡는 자리
  b.add(look);
  const top = (box.max.y - box.min.y) / 2;
  const tag = makePanel(0.26, 0.09, 256);
  tag.userData.set([{ text: code, size: 56, bold: true }]);
  tag.position.y = top + 0.006;
  tag.rotation.x = -Math.PI / 2;
  b.add(tag);
  b.position.fromArray(map.bags).y += top + stacked * (top * 2 + 0.004);
  b.position.x -= 0.02;
  b.rotation.y = THREE.MathUtils.degToRad(map.bagsYaw + (stacked ? 10 : -8));
  b.userData = { kind: 'bag', code };
  scene.add(b);
  grabbables.push(b);
}

// ---------- 총: 보관함·손님 ----------
function removeItem(g) {
  g.removeFromParent();
  grabbables.splice(grabbables.indexOf(g), 1);
}
/** 들고 있던 총을 여기(at)에서 놓았을 때: 손님에게 주거나 보관함에 넣었으면 true */
function handOver(g, at) {
  if (g.userData.kind === 'repair') return !game.over && repair.put(g, at);
  if (g.userData.kind !== 'gun' || game.over) return false;
  const c = game.customerNear(at);
  if (c) { removeItem(g); game.deliver(c, g.userData.code); return true; }
  if (game.nearVault(at)) { removeItem(g); game.store(g.userData.code); return true; }
  return false;
}
let taking = false;
/** 보관함에서 총을 하나 꺼내 준다 */
async function takeFromVault(give) {
  if (taking) return;
  const code = game.takeGun();
  if (!code) { say('보관함이 비어 있다', 'bad'); return; }
  taking = true;
  try {
    const gun = await bench.whole(code);
    gun.userData = { kind: 'gun', code };
    gun.position.copy(game.vaultPanel.position);
    scene.add(gun);
    grabbables.push(gun);
    give(gun);
  } catch (e) { console.error(e); game.stock.push(code); game.showVault(); }
  taking = false;
}
/** 처음부터 다시 */
function restart() {
  for (const g of [...grabbables]) removeItem(g);
  held = heldPart = null;
  for (const h of hands) h.held = h.part = null;
  bench.clear();
  const keepRun = game.over?.title !== '게임 오버' && !!game.over;
  game.reset(keepRun);
  police.reset();
  street.reset();
  repair.reset(keepRun);
  fadeTo(() => { goTo(new THREE.Vector3(...map.spawn)); settle(); });
}
function begin() { if (game && game.nextCall === Infinity) { game.nextCall = 12; repair.begin(); setTimeout(() => guide.showBoard(), 400); say('조직의 전화를 기다리세요 · 카운터 전화기'); } }
function applySettings() {
  lift.position.y = renderer.xr.isPresenting ? settings.height : 0;
  bench?.raise(renderer.xr.isPresenting ? settings.table : 0);
  toast.scale.setScalar(settings.text);
  wrist.scale.setScalar(0.6 * settings.text);
  panel.mesh.scale.setScalar(0.62 * settings.text);
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
/** 들어갈 수 없는 이웃집·건너편 집 안 */
function closedOff(p) { return p.y > 20 && (p.z > 4.9 || p.z < -5.75 && (p.x < -5.9 || p.x > 4.2)); }
function groundAt(p, reach = 0.8) {
  if (closedOff(p)) return null;
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
    if (y === null || shutterBlocks(f, f.x + x, f.z + z) || street?.blocks(f, f.x + x, f.z + z)) continue;
    rig.position.x += x;
    rig.position.z += z;
    rig.position.y = y;
    return;
  }
}
/** 내려온 셔터를 넘어가려는지 */
function shutterBlocks(f, x, z) {
  if (!shutter?.closed || f.y < 20) return false;
  const { a, b } = shutter, side = (px, pz) => (b.x - a.x) * (pz - a.z) - (b.z - a.z) * (px - a.x);
  const t = ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / a.distanceToSquared(b);
  return t > -0.3 && t < 1.3 && (side(f.x, f.z) > 0) !== (side(x, z) > 0);
}
/** 셔터 손잡이 */
function useShutter() {
  if (police.raid && shutter.broken) { say('셔터가 부서졌다', 'bad'); return; }
  if (!shutter.isDown && game.customers.some(c => c.state !== 'leaving')) { say('손님이 있을 때는 셔터를 내릴 수 없다', 'bad'); return; }
  shutter.toggle();
  say(shutter.isDown ? '셔터를 내렸다 · 손님도 들어오지 못한다' : '셔터를 올렸다');
}
function aimedShutter() {
  aimRay();
  ray.far = 2.4;
  const hit = ray.intersectObjects([shutter.handle, shutter.plate]).length > 0;
  ray.far = Infinity;
  return hit;
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
addEventListener('keydown', e => { keys.add(e.code); if ((e.code === 'KeyE' && !renderer.xr.isPresenting || e.code === 'KeyF' && renderer.xr.isPresenting) && !e.repeat) toggleHeld(); if (e.code === 'KeyR' && game?.over) restart(); if (/^Digit[123]$/.test(e.code)) street?.choose(+e.code[5] - 1); if (e.code === 'KeyG') police?.bribe(); if (e.code === 'KeyP' && !game?.over && !e.repeat) police?.set(police.phase + 1); if (e.code === 'KeyY' && game?.call && rig.position.y > 20) game.answer(); });
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('mousedown', e => { if (e.button === 0 && document.pointerLockElement === renderer.domElement) { clickedAt = performance.now(); toggleHeld(); } });
addEventListener('mouseup', e => { if (e.button === 0 && heldPart && document.pointerLockElement === renderer.domElement && performance.now() - clickedAt > 260) toggleHeld(); });   // 누른 채 끌어 놓기
addEventListener('blur', () => keys.clear());
// 마우스 잠금이 안 되는 창(미리보기 등)에서는 끌어서 둘러본다
let dragLook = false, dragging = false, dragged = 0;
async function lock() {
  if (dragLook) return;
  try { await renderer.domElement.requestPointerLock(); } catch { dragLook = true; $('start').hidden = true; }
}
$('play').onclick = () => { begin(); $('start').hidden = true; lock(); };
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
/** 바라보는 방향 (PC = 조준점, VR = 머리) */
function aimRay() {
  if (!renderer.xr.isPresenting) { ray.setFromCamera(new THREE.Vector2(), camera); return; }
  camera.getWorldPosition(ray.ray.origin);
  camera.getWorldDirection(ray.ray.direction);
}
let held = null;
function aimed() {
  aimRay();
  ray.far = 2.6;
  const hit = ray.intersectObjects(grabbables, true)[0];
  ray.far = Infinity;
  return hit ? grabbables.find(g => { let o = hit.object; while (o) { if (o === g) return true; o = o.parent; } }) : null;
}
let heldPart = null;                 // PC 에서 집은 총 부품: 작업대 위에서 조준점을 따라온다
const tablePlane = new THREE.Plane();
function setTablePlane() {
  tablePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0).transformDirection(bench.stage.matrixWorld), bench.stage.localToWorld(new THREE.Vector3(0, 0.1, 0)));
}
let clickedAt = 0;
function hold(g) {
  held = g;
  delete g.userData.fall;
  camera.attach(g);
  if (g.userData.kind === 'gun') { g.position.set(0.25, -0.28, -0.75); g.rotation.set(0, -Math.PI / 2 - 0.15, 0); }
  else if (g.userData.kind === 'repair') { g.position.set(0.24, -0.42, -0.75 - g.userData.size.z / 2); g.rotation.set(0, 0.3, 0); }
  else { g.position.set(0.28, -0.4, -0.75); g.rotation.set(0, 0.3, 0); }
  if (g === repair.item) repair.clearScrews();          // 다시 들면 나사 작업은 취소
  sound('pick');
}
function aimedScrew(r, pad = 0.05) {
  let best = null, dist = 3.2;
  for (const s of repair.screws) { const d = r.distanceToPoint(s.position), far = s.position.distanceTo(r.origin); if (d < pad && far < dist) { dist = far; best = s; } }
  return best;
}
/** 물건을 든 의뢰인을 보고 있는지 */
function aimedVisitor(r) {
  const v = repair.visitor;
  if (!v?.carry || v.state !== 'waiting') return false;
  const c = v.group.position.clone().setY(v.group.position.y + 1.2);
  return r.distanceToPoint(c) < 0.4 && c.distanceTo(r.origin) < 3.2;
}
/** 조준점이 전화기를 보는지 */
function aimedPhone() {
  aimRay();
  ray.far = 3;
  const hit = ray.intersectObject(game.phone, true).length > 0;
  ray.far = Infinity;
  return hit;
}
/** 들고 있는 총을 건넬 위치: 1.2 m 앞 */
function handAt() {
  const p = feetAtHand();
  return p.addScaledVector(camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize(), 1.2);
}
function toggleHeld() {
  if (!police) return;
  if (game.over) { if (renderer.xr.isPresenting) restart(); return; }
  if (renderer.xr.isPresenting) gaze.visible = true;         // VR 에서 키보드 F = 바라보는 것 집기 (에뮬레이터용)
  if (street?.open) { aimRay(); const i = street.hit(ray.ray); if (i >= 0) { street.choose(i); return; } }
  if (game.call && !heldPart && aimedPhone()) { game.answer(); return; }
  if (heldPart) { bench.release(heldPart); heldPart = null; return; }
  if (held) {
    const g = held;
    held = null;
    if (g.userData.kind === 'bag' && bench.near(feetAtHand())) { useBag(g); return; }
    if (handOver(g, handAt()) || handOver(g, feetAtHand())) return;
    drop(g);
    return;
  }
  if (bench.active) {
    aimRay();
    const p = bench.hit(ray);
    if (p) { heldPart = p; bench.grab(p, bench); return; }
  }
  aimRay();
  const s = aimedScrew(ray.ray);
  if (s) { repair.turn(s); return; }
  if (aimedVisitor(ray.ray)) { const it = repair.take(); if (it) { hold(it); return; } }
  const g = aimed();
  if (!g && aimedShutter()) { useShutter(); return; }
  if (g) hold(g);
  else if (game.nearVault(feetAtHand()) && game.stock.length) takeFromVault(hold);
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
  bench.vr = renderer.xr.isPresenting;
  if (bench.vr) sitAtBench();
  bench.start(code, feet()).catch(e => { console.error(e); bench.clear(); addBag(code); say('총 모델을 불러오지 못했다', 'bad'); });
}
/** 멀리서 집은 부품: 컨트롤러가 가리키는 곳, 작업대를 벗어나면 바라보는 곳 */
function tickFarPart(hand, dt) {
  const p = hand.part;
  if (!p.holder) { hand.part = null; return; }
  if (p.holder !== bench) return;
  setTablePlane();
  const beam = new THREE.Ray(hand.c.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0, -1).transformDirection(hand.c.matrixWorld));
  let at = beam.intersectPlane(tablePlane, new THREE.Vector3());
  if (!at || at.distanceTo(bench.origin) > 1.2) { aimRay(); at = ray.ray.intersectPlane(tablePlane, new THREE.Vector3()); }
  if (!at || at.distanceTo(bench.origin) > 1.4) return;
  const k = 1 - Math.exp(-16 * dt);
  p.body.position.lerp(bench.stage.worldToLocal(at).sub(p.offset), k);
  p.body.quaternion.slerp(p.target.quat, k);
}
/** VR: 화면을 잠깐 어둡게 하고 작업대 앞에 정면으로 세운다 */
function sitAtBench() {
  const me = feet(), yawOf = v => Math.atan2(v.x, v.z);
  const side = Math.round((Math.atan2(me.x - bench.origin.x, me.z - bench.origin.z) - bench.baseYaw) / Math.PI) * Math.PI + bench.baseYaw;
  const out = new THREE.Vector3(Math.sin(side), 0, Math.cos(side));
  fadeTo(() => {
    const spot = bench.origin.clone().addScaledVector(out, 0.95).setY(rig.position.y);
    for (let d = 0.95; d < 1.6; d += 0.08) { spot.copy(bench.origin).addScaledVector(out, d).setY(rig.position.y); if (groundAt(spot) !== null) break; }
    const look = camera.getWorldDirection(new THREE.Vector3());
    rig.rotation.y += yawOf(out.clone().negate()) - yawOf(look);
    rig.updateMatrixWorld(true);
    goTo(spot);
  });
}
function tickPart(dt) {
  if (!heldPart) return;
  if (!heldPart.holder) { heldPart = null; return; }       // 붙었거나 시간이 끝났다
  aimRay();
  setTablePlane();
  const at = ray.ray.intersectPlane(tablePlane, new THREE.Vector3());
  if (!at || at.distanceTo(bench.origin) > 1.4) return;
  const want = bench.stage.worldToLocal(at);
  const p = heldPart, k = 1 - Math.exp(-22 * dt);
  p.body.position.lerp(want.sub(p.offset), k);
  p.body.quaternion.slerp(p.target.quat, k);
}
/** 총이나 부품 가방을 손에 들고 있는지 (수리 물건은 괜찮다) */
function carrying() { return [held, ...hands.map(h => h.held)].some(g => g && g.userData.kind !== 'repair'); }
/** 경찰 눈에 띄면 안 되는데 바닥·선반에 놓인 것: 총, 카운터 밖의 부품 가방 (7층) */
function lyingEvidence() {
  return grabbables.filter(g => g.parent === scene && g.position.y > 20
    && (g.userData.kind === 'gun' || g.userData.kind === 'bag' && Math.hypot(g.position.x + 0.64, g.position.z + 8.46) > 1.5)).map(g => g.position);
}
/** 놓으면 아래 물건(카운터·작업대·바닥) 위에 내려앉는다 */
function drop(g) {
  scene.attach(g);
  const p = g.getWorldPosition(new THREE.Vector3());
  ray.set(p.clone().setY(p.y + 0.12), down);
  ray.far = 4;
  const hit = ray.intersectObject(solid, true)[0];          // 사람·부채꼴·글자판에는 얹히지 않는다
  ray.far = Infinity;
  const turn = new THREE.Euler().setFromQuaternion(g.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
  g.rotation.set(g.userData.kind === 'gun' ? -Math.PI / 2 : 0, turn, 0, 'YXZ');      // 총은 옆으로 눕힌다
  const half = g.userData.half ?? 0.065;
  g.userData.fall = hit ? hit.point.y + half : rig.position.y + half;
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
  lift.add(c, grip);
  const hand = { c, grip, line, aiming: false, target: null, held: null, part: null, source: null };
  c.addEventListener('connected', e => { hand.source = e.data; if (e.data.handedness === 'left') attachWrist(hand); });
  c.addEventListener('disconnected', () => { hand.source = null; });
  c.addEventListener('selectstart', () => {
    if (game?.over) { restart(); return; }
    if (pickChoice(hand)) return;
    if (bench?.active && !hand.part && !hand.held) {          // 방아쇠를 누른 채 부품을 끌어 맞추기
      const t = pointed(hand);
      if (t?.kind === 'part') { grabPointed(hand, t); hand.dragging = true; return; }
    }
    if (bench?.active && bench.near(feetAtHand())) return;      // 조립 중에는 순간이동하지 않는다
    hand.aiming = true;
  });
  c.addEventListener('selectend', () => {
    if (hand.dragging) { hand.dragging = false; if (hand.part) hand.letGo(); return; }
    hand.aiming = false;
    line.visible = false;
    if (hand.target) { const t = hand.target; hand.target = null; fadeTo(() => goTo(t)); }
  });
  const letGo = () => {
    if (hand.part) { if (hand.part.holder === grip || hand.part.holder === bench) bench.release(hand.part); hand.part = null; }
    if (!hand.held) return;
    const g = hand.held, spots = [grip.getWorldPosition(new THREE.Vector3()), feetAtHand(), handAt()];
    hand.held = null;
    if (g.userData.kind === 'bag' && spots.some(p => bench.near(p))) useBag(g);
    else if (!spots.some(p => handOver(g, p))) drop(g);
  };
  hand.letGo = letGo;
  c.addEventListener('squeezestart', () => {
    if (pickChoice(hand)) return;
    if (hand.part && !hand.part.holder) hand.part = null;       // 이미 붙은 부품
    if (hand.held || hand.part) { if (settings.toggle) letGo(); return; }
    const p = grip.getWorldPosition(new THREE.Vector3());
    const part = bench?.active ? bench.nearest(p) : null;
    if (part) { hand.part = part; bench.grab(part, grip); buzz(hand, 0.3, 30); return; }
    let best = null, dist = 0.45;
    for (const g of grabbables) {
      const d = new THREE.Box3().setFromObject(g).distanceToPoint(p);
      if (d < dist) { dist = d; best = g; }
    }
    const screw = repair?.screwNear(p);
    if (screw) { repair.turn(screw); return; }
    if (repair?.visitor?.carry && repair.visitor.carry.getWorldPosition(new THREE.Vector3()).distanceTo(p) < 0.4) best = repair.take() ?? best;
    if (game?.call && game.phone.getWorldPosition(new THREE.Vector3()).distanceTo(p) < 0.4) { game.answer(); buzz(hand, 0.6, 80); return; }
    if (!best && shutter && shutter.handleAt().distanceTo(p) < 0.35) { useShutter(); buzz(hand, 0.6, 60); return; }
    const far = best ? null : pointed(hand);
    if (far) { grabPointed(hand, far); return; }
    if (!best) {
      if (game && !game.over && game.stock.length && game.nearVault(p)) takeFromVault(gun => {
        gun.position.copy(grip.getWorldPosition(new THREE.Vector3()));
        hand.held = gun;
        grip.attach(gun);
        buzz(hand, 0.4, 40);
      });
      return;
    }
    for (const h of hands) if (h.held === best) h.held = null;
    hand.held = best;
    if (best === repair?.item) repair.clearScrews();
    delete best.userData.fall;
    grip.attach(best);
    buzz(hand, 0.4, 40);
  });
  c.addEventListener('squeezeend', () => { if (!settings.toggle) letGo(); });
  grip.userData.onSnap = () => buzz(hand, 0.9, 90);          // 부품이 붙는 순간 손이 떨린다
  return hand;
});
// 왼손 손목: 돈·신뢰도·할 일 / 설정판
const wrist = makePanel(0.24, 0.15, 512);
const panel = new SettingsPanel(applySettings);
function attachWrist(hand) {
  wrist.position.set(-0.02, 0.05, 0.06);
  wrist.rotation.x = -0.9;
  panel.mesh.position.set(0, 0.17, -0.1);
  panel.mesh.rotation.x = -0.35;
  hand.grip.add(wrist, panel.mesh);
}
const overPanel = makePanel(1.1, 0.5, 768);
overPanel.position.set(0, 0, -1.6);
overPanel.visible = false;
overPanel.material.depthTest = false;
overPanel.renderOrder = 997;
camera.add(overPanel);
function drawStatus() {
  const money = `HK$ ${game.money.toLocaleString()}`;
  wrist.userData.set([{ text: money, size: 60, bold: true, color: '#ffd79a' }, { text: `신뢰도 ${game.trust} · 경고 ${game.warnings}/3 · 경찰 ${police.name}`, size: 34, color: police.phase > 1 ? '#ff7b5c' : undefined }, { text: game.todo(), size: 34, color: '#9dff8a' }, { text: police.raid ? '오른손 A = 경찰 매수 HK$ 2,000' : 'X 설정', size: 24, color: '#8f8169' }]);
  $('status').textContent = `${money}  ·  조직 신뢰도 ${game.trust}  ·  경고 ${game.warnings}/3  ·  경찰 ${police.name} (의심도 ${police.suspicion})${police.raid && !police.bribed ? ' · [G] 매수 HK$ 2,000' : ''}\n${game.todo()}`;
  overPanel.visible = !!game.over;
  if (game.over) overPanel.userData.set([{ text: game.over.title, size: 80, bold: true, color: game.over.win ? '#9dff8a' : '#ff7b5c' }, { text: game.over.text, size: 38 }, { text: `번 돈 ${money} · 판매 ${game.sold}건`, size: 38, color: '#ffd79a' }, { text: renderer.xr.isPresenting ? '방아쇠를 당기면 다시 시작' : '[R] 다시 시작', size: 34 }], game.over.win ? '#9dff8a' : '#ff7b5c');
}
// VR 에서 바라보는 점 (키보드 F 를 썼을 때만)
const gaze = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), new THREE.MeshBasicMaterial({ color: 0xffd79a, depthTest: false, toneMapped: false }));
gaze.position.z = -1;
gaze.renderOrder = 999;
gaze.visible = false;
camera.add(gaze);
/** 컨트롤러가 가리키는, 멀리서 잡을 수 있는 것 (4 m) */
function pointed(hand) {
  if (!police || hand.held || hand.part || hand.aiming || game.over) return null;
  const from = hand.c.getWorldPosition(new THREE.Vector3()), dir = new THREE.Vector3(0, 0, -1).transformDirection(hand.c.matrixWorld);
  const beam = new THREE.Ray(from, dir), at = new THREE.Vector3(), list = [];
  const add = (o, kind, label, pad = 0.06, target = o) => list.push({ o, kind, label, pad, target });
  if (bench.active) for (const p of bench.parts) if (!p.placed && !p.holder) add(p.body, 'part', `${p.name} 잡기`, 0.03, p);
  for (const g of grabbables) if (g.parent === scene) add(g, 'item', g.userData.kind === 'bag' ? `'${g.userData.code}' 부품 가방 잡기` : g.userData.kind === 'repair' ? `${g.userData.name} 잡기` : `'${g.userData.code}' 총 잡기`);
  for (const s of repair.screws) add(s, 'screw', '나사 조이기', 0.03);
  if (repair.visitor?.carry && repair.visitor.state === 'waiting') add(repair.visitor.carry, 'visitor', `${repair.visitor.itemName} 받기`, 0.12);
  if (game.call) add(game.phone, 'phone', '전화 받기', 0.1);
  add(shutter.handle, 'shutter', shutter.isDown ? '셔터 올리기' : '셔터 내리기', 0.08);
  const cast = (beam, extra) => {
    let best = null, dist = 4;
    for (const t of list) {
      if (!beam.intersectBox(new THREE.Box3().setFromObject(t.o).expandByScalar(t.pad + extra), at)) continue;
      const d = at.distanceTo(beam.origin);
      if (d < dist) { dist = d; best = { ...t, distance: at.distanceTo(from) }; }
    }
    return best;
  };
  const hit = cast(beam, 0);
  if (hit || hand.source?.handedness === 'left') return hit;
  aimRay();                                        // 오른손은 바라보는 것도 잡힌다
  const seen = cast(ray.ray, 0.08);
  return seen && { ...seen, gaze: true };
}
/** 시비 선택지: 가리키거나(오른손은 바라봐도) 방아쇠·그립으로 고른다 */
function aimedChoice(hand) {
  if (!street?.open) return -1;
  const i = street.hit(new THREE.Ray(hand.c.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0, 0, -1).transformDirection(hand.c.matrixWorld)));
  if (i >= 0 || hand.source?.handedness === 'left') return i;
  aimRay();
  return street.hit(ray.ray);
}
function pickChoice(hand) {
  const i = aimedChoice(hand);
  if (i < 0) return false;
  buzz(hand, 0.5, 40);
  return street.choose(i);
}
function grabPointed(hand, t) {
  if (t.kind === 'screw') { repair.turn(t.target); return; }
  if (t.kind === 'visitor') { const it = repair.take(); if (!it) return; t = { ...t, kind: 'item', target: it }; }
  if (t.kind === 'phone') game.answer();
  else if (t.kind === 'shutter') useShutter();
  else if (t.kind === 'part') {
    hand.part = t.target;                          // 멀리서 집은 부품은 가리키는(바라보는) 작업대 위를 따라온다
    bench.grab(t.target, bench);
  } else {
    hand.held = t.target;
    if (t.target === repair.item) repair.clearScrews();
    delete t.target.userData.fall;
    hand.grip.attach(t.target);
    t.target.position.set(0, -0.06, -0.1);
  }
  buzz(hand, 0.5, 50);
}
function buzz(hand, strength, ms) { hand.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); }
let turnReady = true;
function tickVR(dt) {
  marker.visible = false;
  for (const h of hands) {
    if (h.part) tickFarPart(h, dt);
    const axes = h.source?.gamepad?.axes ?? [];
    const x = axes[2] ?? axes[0] ?? 0, y = axes[3] ?? axes[1] ?? 0;
    const menu = h.source?.gamepad?.buttons?.[4]?.pressed;         // 왼손 X
    if (h.source?.handedness === 'left' && menu && !h.menu) panel.toggle();
    h.menu = menu;
    const a = h.source?.gamepad?.buttons?.[4]?.pressed && h.source.handedness === 'right';      // 오른손 A = 경찰 매수
    if (a && !h.a) police?.bribe();
    h.a = a;
    if (h.source?.handedness === 'left' && panel.open) { panel.stick(x, y); h.target = null; continue; }
    if (h.source?.handedness === 'right') {
      if (Math.abs(x) < 0.3) turnReady = true;
      else if (Math.abs(x) > 0.7 && turnReady) {         // 정해진 각도씩 딱딱 끊어 돌기 (멀미가 덜하다)
        turnReady = false;
        const f = feet(), a = -Math.sign(x) * THREE.MathUtils.degToRad(settings.turn);
        rig.rotation.y += a;
        const d = new THREE.Vector3().subVectors(rig.position, f).applyAxisAngle(THREE.Object3D.DEFAULT_UP, a);
        rig.position.x = f.x + d.x;
        rig.position.z = f.z + d.z;
      }
    } else if (!(bench.active && bench.near(feetAtHand()) && Math.hypot(x, y) < 0.6) && settings.smooth && Math.hypot(x, y) > 0.15) {
      const look = camera.getWorldDirection(new THREE.Vector3());
      look.y = 0;
      look.normalize();
      const side = new THREE.Vector3(-look.z, 0, look.x);
      tryMove((side.x * x - look.x * y) * settings.speed * dt, (side.z * x - look.z * y) * settings.speed * dt);
    }
    h.target = null;
    h.look = (h.look ?? 0) - dt;
    if (h.look <= 0) { h.look = 0.1; h.far = pointed(h); if (h.far && toastLeft <= 0.2) { say(`그립 버튼 · ${h.far.label}`); toastLeft = 0.35; } }
    h.line.visible = !!h.far && !h.far.gaze && !h.aiming;
    if (h.line.visible) h.line.scale.z = h.far.distance / 5 / rig.scale.x;
    if (!h.aiming) continue;
    h.line.scale.z = 1;
    h.line.visible = true;
    const from = h.c.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(h.c.matrixWorld);
    ray.set(from, dir);
    ray.far = 8;
    const hit = ray.intersectObject(floor)[0];
    ray.far = Infinity;
    if (!hit || Math.abs(hit.point.y - rig.position.y) > 1 || shutterBlocks(feet(), hit.point.x, hit.point.z)) continue;
    h.target = hit.point.clone().setY(hit.point.y - 0.04);
    marker.position.copy(hit.point).y += 0.02;
    marker.visible = true;
  }
}
renderer.xr.addEventListener('sessionstart', () => { $('start').hidden = true; rig.rotation.y = yaw; rig.scale.setScalar(1.15); camera.rotation.set(0, 0, 0); applySettings(); begin(); });
renderer.xr.addEventListener('sessionend', () => { $('start').hidden = false; yaw = rig.rotation.y; rig.rotation.y = 0; rig.scale.setScalar(1); camera.position.set(0, EYE, 0); applySettings(); });

// ---------- 조립할 때 작업대를 내려다보기 (PC 만. VR 은 시점을 움직이면 멀미가 난다) ----------
let viewK = 0, stillFor = 0, wasView = false;
function assemblyView(dt) {
  const on = bench.active && bench.near(feetAtHand()) && stillFor > 0.35;
  viewK = THREE.MathUtils.damp(viewK, on ? 1 : 0, 5, dt);
  const eye = new THREE.Vector3(0, EYE, 0);
  if (viewK > 0.002) {
    const spot = bench.stage.localToWorld(new THREE.Vector3(0, 1.12, 0.62)).sub(rig.position);
    eye.lerp(spot, viewK);
  }
  camera.position.copy(eye);
  if (on && !wasView) aimIn = 0.7;
  wasView = on;
  if (aimIn <= 0) return;
  aimIn -= dt;
  const at = bench.stage.localToWorld(new THREE.Vector3(0, 0, 0.1)).sub(bench.stage.localToWorld(new THREE.Vector3(0, 1.12, 0.62)));
  const wantYaw = Math.atan2(-at.x, -at.z), k = 1 - Math.exp(-7 * dt);
  yaw += Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw)) * k;
  pitch += (Math.atan2(at.y, Math.hypot(at.x, at.z)) - pitch) * k;
}
let aimIn = 0;

/** 지금 할 수 있는 것 */
function hintText() {
  if (!held && !heldPart && !bench.active) { aimRay(); if (aimedScrew(ray.ray)) return '[E·클릭] 나사 조이기'; if (aimedVisitor(ray.ray)) return `[E] ${repair.visitor.itemName} 받기`; }
  if (held?.userData.kind === 'repair') return held.userData.broken ? (repair.nearBench(feetAtHand()) || repair.nearBench(handAt()) ? '[E] 수리 작업대에 놓기' : '[E] 내려놓기') : repair.nearOwner(handAt()) || repair.nearOwner(feetAtHand()) ? `[E] ${held.userData.name} 돌려주기` : '[E] 내려놓기';
  if (street.open) return street.hover >= 0 ? '[E·클릭] 고르기' : '선택지를 바라보고 [E·클릭] 또는 숫자 1 2 3';
  const g = held || heldPart ? null : aimed();
  aimRay();
  const part = !held && !heldPart && bench.active ? bench.hit(ray) : null;
  return heldPart ? `[E·클릭] ${heldPart.name} 놓기 · 같은 모양의 흐린 자리로 가져가세요`
    : held && held.userData.kind === 'gun' && (game.customerNear(handAt()) || game.customerNear(feetAtHand())) ? `[E] 손님에게 '${held.userData.code}' 건네기`
    : held && held.userData.kind === 'gun' && game.nearVault(feetAtHand()) ? '[E] 총기 보관함에 넣기'
    : held ? (held.userData.kind === 'bag' && bench.near(feetAtHand()) ? `[E] '${held.userData.code}' 조립 시작` : '[E] 내려놓기')
    : part ? `[E·클릭] ${part.name} 집기` : g ? (g.userData.kind === 'bag' ? `[E] '${g.userData.code}' 부품 가방 들기` : g.userData.kind === 'repair' ? `[E] ${g.userData.name} 들기` : `[E] '${g.userData.code}' 총 들기`)
    : aimedShutter() ? (shutter.isDown ? '[E] 셔터 올리기' : '[E] 셔터 내리기') : game.call && aimedPhone() ? '[E] 전화 받기' : game.nearVault(feetAtHand()) && game.stock.length ? `[E] '${game.nextGun()}' 총 꺼내기` : '';
}

// ---------- 매 프레임 ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (map && floor && guide) {
    if ($('start').hidden || renderer.xr.isPresenting) { game.tick(dt); if (!game.over) { police.tick(dt); if (!game.over) street.tick(dt); if (!game.over) repair.tick(dt); } guide.tick(dt); }
    const up = rig.position.y > 20;
    for (const k in zones) for (const o of zones[k]) o.visible = k === 'z6' ? !up : up;
    drawStatus();
    if (street.open) {                              // 고르려는 선택지를 밝게
      let i = -1;
      if (renderer.xr.isPresenting) { for (const h of hands) if (i < 0) i = aimedChoice(h); } else { aimRay(); i = street.hit(ray.ray); }
      street.hover = i;
    }
    tickPart(dt);
    bench.tick(dt);
    toastLeft -= dt;
    toast.visible = toastLeft > 0 && renderer.xr.isPresenting;
    if (renderer.xr.isPresenting) {
      tickVR(dt);
      if (gaze.visible && toastLeft <= 0) { const t = hintText(); if (t) { say(t); toastLeft = 0.25; } }
    }
    else {
      assemblyView(dt);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const x = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), z = (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0);
      stillFor = x || z ? 0 : stillFor + dt;
      if (x || z) {
        const v = new THREE.Vector3(x, 0, z).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).multiplyScalar((keys.has('ShiftLeft') ? 4 : 2.4) * dt);
        tryMove(v.x, v.z);
      }
      $('hint').textContent = toastLeft > 0 ? toastText : hintText();
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
window.dev = { tickFarPart, sitAtBench, get game() { return game; }, get police() { return police; }, get shutter() { return shutter; }, get street() { return street; }, get repair() { return repair; }, get guide() { return guide; }, zones, get nav() { return nav; }, begin, restart, takeFromVault, handOver, hold, panel, settings };
window.game = { rig, camera, renderer, scene, tryMove, goTo, groundAt, look: (y, p) => { yaw = y; pitch = p; }, get map() { return map; }, get portals() { return portals; }, grabbables, toggleHeld, useBag, drop, hands, get bench() { return bench; } };
