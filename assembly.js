// 비밀 작업대 총 조립: 몸통을 먼저, 나머지는 순서 없이 흐린 자리에 가져가면 딸깍 붙는다.
import * as THREE from 'three';
import { makePanel, sound } from './ui.js';

export const GUNS = {
  '버번': { file: 'gun_bourbon', title: '소총', scale: 1.05 },
  '베르무트': { file: 'gun_vermouth', title: '권총', scale: 2.2 },
};
const TIME = 90, SNAP = 0.13;

export class Bench {
  /** say(글자, 종류), onDone(code, 총 Group), onFail(code) */
  constructor({ scene, loader, position, say, onDone, onFail }) {
    Object.assign(this, { scene, loader, say, onDone, onFail });
    this.origin = new THREE.Vector3(...position);
    this.stage = new THREE.Group();
    this.stage.position.copy(this.origin);
    scene.add(this.stage);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.16, depthWrite: false });
    this.hotMat = new THREE.MeshBasicMaterial({ color: 0x9dff8a, transparent: true, opacity: 0.45, depthWrite: false });
    this.panel = makePanel(0.9, 0.36, 640);
    this.panel.position.set(0, 0.62, -0.55);
    this.panel.rotation.x = -0.12;
    this.stage.add(this.panel);
    this.lamp = new THREE.PointLight(0xffe2b8, 1.2, 3);
    this.lamp.position.set(0, 1, 0.1);
    this.stage.add(this.lamp);
    this.parts = [];
    this.code = null;
    this.cache = {};
    this.idle();
  }

  get active() { return this.parts.length > 0; }
  near(p) { return Math.hypot(p.x - this.origin.x, p.z - this.origin.z) < 1.5 && Math.abs(p.y - this.origin.y) < 1.3; }
  idle() { this.panel.userData.set([{ text: '총기 조립 작업대', size: 44, bold: true }, { text: '부품 가방을 여기에 내려놓으세요', size: 34 }]); }

  async model(code) {
    const { file } = GUNS[code];
    this.cache[file] ??= this.loader.loadAsync(`assets/${file}.glb`).then(g => {
      const root = g.scene.getObjectByName(file) || g.scene;
      root.traverse(o => { if (o.isMesh) o.material.metalness = Math.min(o.material.metalness, 0.35); });
      return root;
    });
    return (await this.cache[file]).clone();
  }

  /** 플레이어가 선 쪽을 앞으로 해서 부품을 늘어놓는다 */
  async start(code, playerPos) {
    if (this.code) return false;
    this.code = code;
    const turn = Math.round((Math.atan2(playerPos.x - this.origin.x, playerPos.z - this.origin.z) - this.baseYaw) / Math.PI) * Math.PI + this.baseYaw;
    this.stage.rotation.y = turn;
    const gun = await this.model(code), ghost = await this.model(code);
    const { scale } = GUNS[code];
    this.gunRoot = new THREE.Group();          // 총을 옆으로 눕힌다: 총의 위 = 작업대 안쪽
    this.gunRoot.rotation.x = -Math.PI / 2;
    this.gunRoot.scale.setScalar(scale);
    this.gunRoot.add(ghost);
    this.stage.add(this.gunRoot);
    this.gunRoot.updateMatrixWorld(true);
    const c = this.stage.worldToLocal(new THREE.Box3().setFromObject(ghost).getCenter(new THREE.Vector3()));
    this.gunRoot.position.set(-c.x, 0.06, -0.1 - c.z);
    this.gunRoot.updateMatrixWorld(true);

    const list = [...gun.children].sort((a, b) => (b.name === '몸통') - (a.name === '몸통'));
    const spots = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    let long = 0;
    const size = new THREE.Vector3();
    this.parts = list.map((body, i) => {
      const g = ghost.children.find(x => x.name === body.name);
      const meshes = [];
      g.traverse(o => { if (o.isMesh) { o.material = this.ghostMat; meshes.push(o); } });
      const part = { name: body.name, ghost: g, ghostMeshes: meshes, placed: false, holder: null };
      part.target = { pos: this.stage.worldToLocal(g.getWorldPosition(new THREE.Vector3())), quat: this.gunRoot.quaternion.clone().multiply(g.quaternion), center: this.stage.worldToLocal(new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3())) };
      part.offset = part.target.center.clone().sub(part.target.pos);      // 부품 원점에서 한가운데까지
      new THREE.Box3().setFromObject(g).getSize(size);
      part.length = Math.max(size.x, size.y, size.z);
      part.body = new THREE.Group();
      body.position.set(0, 0, 0);
      body.quaternion.identity();
      body.scale.multiplyScalar(scale);
      part.body.add(body);
      this.stage.add(part.body);
      const x = THREE.MathUtils.lerp(-0.6, 0.6, list.length > 1 ? spots[i] / (list.length - 1) : 0.5);
      part.homeCenter = part.length > 0.4 ? new THREE.Vector3(THREE.MathUtils.clamp(x, -0.3, 0.3), 0.06, 0.48 - long++ * 0.12) : new THREE.Vector3(x, 0.06, long || part.length < 0.12 ? 0.3 : 0.36 + (spots[i] % 2) * 0.1);
      part.homeYaw = part.length > 0.4 ? 0 : (Math.random() - 0.5) * 1.2;
      return part;
    });
    const longs = this.parts.filter(p => p.length > 0.4).length;      // 긴 부품이 있으면 짧은 부품은 그 안쪽 줄로
    if (longs) for (const p of this.parts) if (p.length <= 0.4) p.homeCenter.z = 0.48 - longs * 0.12 - 0.02;
    for (const p of this.parts) this.home(p, 1);
    this.left = TIME;
    this.warned = false;
    this.say(`'${code}' 부품을 꺼냈다 · 몸통부터 맞추세요`);
    return true;
  }

  home(p, k) {
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.homeYaw).multiply(p.target.quat);
    const off = p.offset.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, p.homeYaw);
    p.body.position.lerp(p.homeCenter.clone().sub(off), k);
    p.body.quaternion.slerp(q, k);
  }

  center(p) { return new THREE.Box3().setFromObject(p.body).getCenter(new THREE.Vector3()); }

  /** 손(월드 위치) 가까이의 부품 */
  nearest(point, reach = 0.22) {
    let best = null, dist = reach;
    for (const p of this.parts) {
      if (p.placed || p.holder) continue;
      const d = new THREE.Box3().setFromObject(p.body).distanceToPoint(point);
      if (d < dist) { dist = d; best = p; }
    }
    return best;
  }
  /** 조준선에 걸린 부품 (PC) */
  hit(ray) {
    const free = this.parts.filter(p => !p.placed);
    const h = ray.intersectObjects(free.map(p => p.body), true)[0];
    if (h) return free.find(p => { for (let o = h.object; o; o = o.parent) if (o === p.body) return true; });
    let best = null, dist = 0.07;                          // 작은 부품은 조금 빗나가도 집힌다
    for (const p of free) {
      const d = ray.ray.distanceToPoint(this.center(p));
      if (d < dist) { dist = d; best = p; }
    }
    return best;
  }
  grab(p, parent) {
    p.holder = parent;
    if (parent !== this) parent.attach(p.body);
    sound('pick');
  }
  release(p) {
    if (!p.holder) return;
    p.holder = null;
    this.stage.attach(p.body);
    this.trySnap(p, true);
  }
  ready(p) { return p.name === '몸통' || this.parts.some(x => x.name === '몸통' && x.placed) || !this.parts.some(x => x.name === '몸통'); }

  distance(p) { return this.stage.worldToLocal(this.center(p)).distanceTo(p.target.center); }
  trySnap(p, dropped) {
    const reach = dropped ? SNAP * 1.4 : SNAP * 0.75;
    if (this.distance(p) > reach) return false;
    if (!this.ready(p)) { if (dropped) this.say('몸통을 먼저 놓으세요', 'bad'); return false; }
    const holder = p.holder;
    p.holder = null;
    p.placed = true;
    this.stage.attach(p.body);
    p.body.scale.setScalar(1);
    p.ghost.visible = false;
    sound('snap');
    if (holder?.userData?.onSnap) holder.userData.onSnap();
    return true;
  }

  tick(dt) {
    if (!this.active) return;
    const k = 1 - Math.exp(-12 * dt);
    for (const p of this.parts) {
      if (p.placed) {
        p.body.position.lerp(p.target.pos, k);
        p.body.quaternion.slerp(p.target.quat, k);
      } else if (!p.holder) this.home(p, k);
      else {
        const hot = this.ready(p) && this.distance(p) < SNAP * 1.6;
        for (const m of p.ghostMeshes) m.material = hot ? this.hotMat : this.ghostMat;
        this.trySnap(p, false);
      }
    }
    const done = this.parts.filter(p => p.placed).length;
    if (done === this.parts.length) { this.finish(); return; }
    this.left -= dt;
    if (this.left < 15 && !this.warned) { this.warned = true; this.say('시간이 얼마 남지 않았다!', 'bad'); }
    const next = this.ready({ name: '' }) ? `${done} / ${this.parts.length} 맞춤` : '몸통을 먼저 놓으세요';
    this.panel.userData.set([{ text: `${this.code} · ${GUNS[this.code].title}`, size: 44, bold: true }, { text: next, size: 34 },
      { text: `남은 시간 ${Math.max(0, Math.ceil(this.left))}초`, size: 34, color: this.left < 15 ? '#ff7b5c' : '#ffd79a' }], this.left < 15 ? '#ff7b5c' : '#e9a94a');
    if (this.left > 0) return;
    const code = this.code;
    this.clear();
    sound('bad');
    this.say('시간 초과 · 부품을 못 쓰게 됐다', 'bad');
    this.onFail(code);
  }

  finish() {
    const code = this.code;
    const gun = new THREE.Group();
    this.stage.updateMatrixWorld(true);
    for (const p of this.parts) { p.body.position.copy(p.target.pos); p.body.quaternion.copy(p.target.quat); p.body.updateMatrixWorld(true); }
    const all = new THREE.Box3();
    for (const p of this.parts) all.expandByObject(p.body);
    all.getCenter(gun.position);
    gun.quaternion.copy(this.gunRoot.getWorldQuaternion(new THREE.Quaternion()));
    this.scene.add(gun);
    gun.updateMatrixWorld(true);
    for (const p of this.parts) gun.attach(p.body);
    this.parts = [];
    this.clear();
    this.panel.userData.set([{ text: `${code} 완성!`, size: 52, bold: true, color: '#9dff8a' }, { text: '총을 집어 들 수 있다', size: 32 }], '#9dff8a');
    sound('good');
    this.say(`'${code}' ${GUNS[code].title} 조립 완료`, 'good');
    this.onDone(code, gun);
  }

  clear() {
    for (const p of this.parts) p.body.removeFromParent();
    this.parts = [];
    this.gunRoot?.removeFromParent();
    this.code = null;
    this.idle();
  }
}
