// 이웃의 수리 의뢰: 물건 받기 → 수리 작업대에 놓기 → 나사 3개 조이기 → 돌려주기. 신뢰도가 60 이상이면 급습 때 도와준다
import * as THREE from 'three';
import { Customer } from './customer.js';
import { makePanel, sound } from './ui.js';

export const REPAIR = { first: 35, gapMin: 50, gapMax: 80, wait: 60, time: 100, trust: 20, pay: 300, late: 10, missed: 5, open: 60, help: 5 };
const ITEMS = { '선풍기': 'fan_goldstar', '전화기': 'phone_soviet', '알람시계': 'alarm_clock', '카메라': 'camera', '카세트 녹음기': 'tape_recorder' };
const START = { junk: 40, food: 20, dealer: 0, clinic: 20, gamble: 0 };
export const NAMES = { junk: '고물상 주인', food: '음식점 주인', dealer: '마약상', clinic: '불법 의료인', gamble: '도박장 주인' };
const V = (x, z, y = 21.58) => new THREE.Vector3(x, y, z);
const SPOT = V(-3.15, -8.55), BENCH = V(0.9, -5.83);

export class Repair {
  /** env: { scene, loader, solid, game, police, street, shutter, say, feet, eye, grabbables, buzz } */
  constructor(env) {
    Object.assign(this, env);
    this.cache = {};
    this.trust = { ...START };
    const ray = new THREE.Raycaster(new THREE.Vector3(BENCH.x, 23.6, BENCH.z), new THREE.Vector3(0, -1, 0), 0, 2.2);
    const hit = ray.intersectObject(this.solid, true).find(h => h.point.y < 22.9);
    this.benchAt = new THREE.Vector3(BENCH.x, hit && hit.point.y > 22 ? hit.point.y : 22.58, BENCH.z);
    this.panel = makePanel(0.62, 0.22, 512);
    this.panel.position.set(BENCH.x, this.benchAt.y + 0.95, BENCH.z + 0.15);
    this.panel.rotation.y = Math.PI;
    this.scene.add(this.panel);
    this.mat = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.24, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.6 }));
    this.mat.position.copy(this.benchAt).y += 0.015;
    this.scene.add(this.mat);
    this.screws = [];
    this.next = Infinity;
    this.reset();
  }
  reset(keep = true) {
    this.visitor?.remove();
    this.visitor = null;
    this.item?.removeFromParent();
    const i = this.grabbables.indexOf(this.item);
    if (i >= 0) this.grabbables.splice(i, 1);
    this.item = null;
    this.clearScrews();
    if (!keep) this.trust = { ...START };
    if (this.next !== Infinity) this.next = REPAIR.first;
    this.idle();
  }
  begin() { if (this.next === Infinity) this.next = REPAIR.first; }
  idle() { this.panel.userData.set([{ text: '수리 작업대', size: 46, bold: true }, { text: '이웃이 맡긴 물건을 여기에', size: 32 }]); }
  /** 급습 때 시간을 벌어 주는 이웃 */
  friends() { return Object.keys(this.trust).filter(id => this.trust[id] >= REPAIR.open); }

  async model(file) {
    this.cache[file] ??= this.loader.loadAsync(`assets/item_${file}.glb`).then(g => {
      g.scene.traverse(o => { if (o.isMesh) o.material.metalness = Math.min(o.material.metalness, 0.3); });
      return g.scene;
    });
    return (await this.cache[file]).clone();
  }
  async visit() {
    const ids = Object.keys(START).filter(id => this.street.models[id] && !this.street.people.some(p => p.id === id));
    const low = ids.filter(id => this.trust[id] < REPAIR.open), pool = low.length ? low : ids;
    if (!pool.length) return;
    const id = pool[Math.floor(Math.random() * pool.length)], names = Object.keys(ITEMS), name = names[Math.floor(Math.random() * names.length)];
    this.loading = true;
    let look;
    try { look = await this.model(ITEMS[name]); } catch (e) { console.error(e); this.loading = false; return; }
    this.loading = false;
    if (this.police.raid || this.visitor) return;
    const v = new Customer(this.street.models[id], this.scene, [V(7.5, -4), V(-2.76, -4.13), V(-2.76, -6.5), SPOT.clone()], V(0.2, -8.5));
    if (id === 'dealer' || id === 'clinic') v.look.scale.setScalar(1.12);
    Object.assign(v, { id, name: NAMES[id], itemName: name, left: REPAIR.wait, given: false });
    const item = new THREE.Group(), box = new THREE.Box3().setFromObject(look), mid = box.getCenter(new THREE.Vector3());
    look.position.sub(mid);
    item.add(look);
    item.userData = { kind: 'repair', name, owner: id, broken: true, half: (box.max.y - box.min.y) / 2, size: box.getSize(new THREE.Vector3()) };
    item.position.set(0, 1.23, 0.34 + item.userData.size.z / 2);      // 두 손으로 들고 온다
    v.group.add(item);
    v.carry = item;
    v.carrying = true;
    this.visitor = v;
    this.say(`${NAMES[id]}이(가) 고장 난 ${name}을(를) 들고 온다`);
  }

  /** 의뢰인에게서 물건을 받는다 */
  take() {
    const v = this.visitor;
    if (!v || v.state !== 'waiting' || v.given) return null;
    v.given = true;
    v.carrying = false;
    v.left = REPAIR.time;
    this.item = v.carry;
    v.carry = null;
    this.scene.attach(this.item);
    this.grabbables.push(this.item);
    this.say(`${this.item.userData.name}을(를) 받았다 · ${REPAIR.time}초 안에 수리 작업대에서 고치세요`);
    return this.item;
  }
  nearBench(p) { return Math.hypot(p.x - this.benchAt.x, p.z - this.benchAt.z) < 1.25 && Math.abs(p.y - this.benchAt.y) < 1.2; }
  nearOwner(p) { const v = this.visitor; return !!v && v.state === 'waiting' && Math.hypot(p.x - v.group.position.x, p.z - v.group.position.z) < 1.6 && Math.abs(p.y - v.group.position.y - 1.1) < 1.4; }
  /** 들고 있던 물건을 여기서 놓았을 때. 작업대나 주인에게 갔으면 true */
  put(g, p) {
    if (g.userData.kind !== 'repair') return false;
    if (g.userData.broken && this.nearBench(p)) { this.place(g); return true; }
    if (!g.userData.broken && this.nearOwner(p)) { this.giveBack(g); return true; }
    return false;
  }
  place(g) {
    this.scene.attach(g);
    delete g.userData.fall;
    g.rotation.set(0, Math.PI, 0);                  // 앞면이 가게 쪽을 보게
    g.position.copy(this.benchAt).y += g.userData.half + 0.005;
    this.clearScrews();
    const s = g.userData.size, spots = [[-0.32, 0.25, -0.55], [0.32, 0.1, -0.55], [0, 0.55, -0.2]];
    for (const [x, y, z] of spots) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff7b3c, toneMapped: false }));
      b.position.set(g.position.x + x * Math.max(0.16, s.x), g.position.y + y * Math.max(0.1, s.y), g.position.z + z * Math.max(0.14, s.z));
      b.userData.turns = 0;
      this.scene.add(b);
      this.screws.push(b);
    }
    sound('snap');
    this.say('나사 3개를 두 번씩 조이세요 · 손을 대거나 가리키고 누르기');
  }
  clearScrews() { for (const s of this.screws) s.removeFromParent(); this.screws = []; }
  /** 나사를 조인다 */
  turn(s) {
    if (!this.screws.includes(s)) return;
    s.userData.turns++;
    sound('snap');
    this.buzz(0.5, 60);
    if (s.userData.turns < 2) { s.material.color.setHex(0xffd479); return; }
    s.removeFromParent();
    this.screws.splice(this.screws.indexOf(s), 1);
    if (this.screws.length) return;
    this.item.userData.broken = false;
    sound('good');
    this.say(`${this.item.userData.name} 수리 완료 · 주인에게 돌려주세요`, 'good');
  }
  screwNear(p, reach = 0.16) {
    let best = null, d = reach;
    for (const s of this.screws) { const k = s.position.distanceTo(p); if (k < d) { d = k; best = s; } }
    return best;
  }
  giveBack(g) {
    const v = this.visitor;
    g.removeFromParent();
    this.grabbables.splice(this.grabbables.indexOf(g), 1);
    this.item = null;
    this.game.money += REPAIR.pay;
    this.addTrust(v.id, REPAIR.trust);
    sound('good');
    this.say(`${v.name} 신뢰도 ${this.trust[v.id]} · HK$ ${REPAIR.pay}${this.trust[v.id] >= REPAIR.open ? ' · 급습 때 도와준다' : ''}`, 'good');
    this.leave();
  }
  addTrust(id, n) { this.trust[id] = THREE.MathUtils.clamp(this.trust[id] + n, 0, 100); }
  leave() {
    this.visitor?.leave();
    this.idle();
    this.next = THREE.MathUtils.randFloat(REPAIR.gapMin, REPAIR.gapMax);
  }
  lose(text, n) {
    const v = this.visitor;
    this.addTrust(v.id, -n);
    sound('bad');
    this.say(`${text} · ${v.name} 신뢰도 -${n}`, 'bad');
    if (this.item) {
      this.item.removeFromParent();
      const i = this.grabbables.indexOf(this.item);
      if (i >= 0) this.grabbables.splice(i, 1);
      this.item = null;
      this.clearScrews();
    }
    this.leave();
  }

  tick(dt) {
    if (this.police.raid) { if (this.visitor || this.item) this.reset(); return; }
    const v = this.visitor, g = this.game;
    this.mat.visible = !!this.item && this.item.userData.broken && !this.screws.length;
    for (const s of this.screws) s.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.18);
    if (!v) {
      if (this.loading) return;
      const busy = this.shutter.isDown || g.isBusy() || g.customers.length > 1 || this.street.triad;
      if (!busy) this.next -= dt;
      if (this.next <= 0) { this.next = 20; this.visit(); }
      return;
    }
    if (v.state === 'coming' && this.shutter.isDown && v.group.position.z > -5.6) { this.say('셔터가 닫혀 의뢰인이 돌아갔다'); this.leave(); }
    const e = v.tick(dt, this.eye());
    if (e === 'gone') { this.visitor = null; return; }
    if (e === 'arrived') v.panel.visible = true;
    if (v.state !== 'waiting') return;
    v.left -= dt;
    const name = v.itemName, fixed = this.item && !this.item.userData.broken;
    v.panel.userData.set([{ text: !v.given ? `${name} 고쳐 주세요` : fixed ? '다 고쳤어요?' : `${name} 기다리는 중`, size: 44, bold: true }, { text: `${!v.given ? '물건을 잡아 받기 · ' : ''}${Math.max(0, Math.ceil(v.left))}초`, size: 32, color: v.left < 20 ? '#ff7b5c' : '#ffd79a' }], v.left < 20 ? '#ff7b5c' : '#7fb8ff');
    v.panel.visible = true;
    this.panel.userData.set(this.screws.length ? [{ text: '나사 조이기', size: 46, bold: true }, { text: `${this.screws.length}개 남음`, size: 34 }] : fixed ? [{ text: '수리 완료!', size: 46, bold: true, color: '#9dff8a' }, { text: '주인에게 돌려주세요', size: 32 }]
      : this.item ? [{ text: '여기에 내려놓기', size: 46, bold: true }, { text: name, size: 34 }] : [{ text: '수리 작업대', size: 46, bold: true }, { text: '의뢰인에게 물건을 받으세요', size: 32 }]);
    if (v.left <= 0) { if (v.given) this.lose('수리 시간을 넘겼다', REPAIR.late); else this.lose('의뢰인을 그냥 보냈다', REPAIR.missed); }
  }
}
