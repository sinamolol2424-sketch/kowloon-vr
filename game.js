// 비밀 의뢰 한 바퀴: 전화 → 부품 가방 → 조립 → 총기 보관함 → 손님에게 판매
import * as THREE from 'three';
import { GUNS } from './assembly.js';
import { Customer } from './customer.js';
import { makePanel, sound } from './ui.js';

export const RULES = {
  firstCall: 12, gapMin: 30, gapMax: 45, ringTime: 20,
  accept: 3, miss: 12, assemblyPay: 900, salePay: 1200, saleTrust: 5, failTrust: 20,
  customerDelay: 25, customerWait: 120, maxWarnings: 3,
};
const V = a => new THREE.Vector3(...a);

export class Game {
  /** env: { scene, map, customerModel, say, addBag, takeOut, feet, isBusy } */
  constructor(env) {
    Object.assign(this, env);
    this.codes = Object.keys(GUNS);
    this.buildPhone();
    this.vaultAt = V(this.map.vault.p);
    this.vaultPanel = makePanel(0.55, 0.31, 640);
    this.vaultPanel.position.copy(this.vaultAt).y += 0.35;
    this.scene.add(this.vaultPanel);
    this.vaultFront = V(this.map.bench).sub(this.vaultAt).setY(0).normalize();
    this.vaultPanel.position.addScaledVector(this.vaultFront, 0.85);
    this.vaultPanel.lookAt(this.vaultPanel.position.clone().add(this.vaultFront));
    this.customers = [];
    this.reset();
  }

  reset() {
    for (const c of this.customers) c.remove();
    this.customers = [];
    this.money = 0;
    this.trust = 60;
    this.warnings = 0;
    this.suspicion = 0;
    this.sold = 0;
    this.stock = [];
    this.call = null;
    this.nextCall = RULES.firstCall;
    this.pending = [];            // 곧 올 것: { in, what: 'bag' | 'customer', code }
    this.over = null;
    this.pulse = 0;
    this.phonePanel.visible = false;
    this.showVault();
  }

  // ---------- 전화기 (카운터 위) ----------
  buildPhone() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x7a2f24 }), metal = new THREE.MeshLambertMaterial({ color: 0xc9b98f });
    const p = this.phone = new THREE.Group();
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); p.add(o); return o; };
    add(new THREE.CylinderGeometry(0.09, 0.14, 0.1, 4, 1).rotateY(Math.PI / 4), mat, 0, 0.05, 0).scale.set(1.15, 1, 1);
    const dial = add(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 24), metal, 0, 0.075, 0.075);
    dial.rotation.x = 0.95;
    this.handset = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10).rotateZ(Math.PI / 2), mat);
    bar.position.y = 0.02;
    this.handset.add(bar);
    for (const x of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.04, 14), mat); e.position.x = x; this.handset.add(e); }
    this.handset.position.y = 0.13;
    p.add(this.handset);
    p.position.set(-0.6, this.map.bags[1], -7.42);
    p.rotation.y = Math.PI / 2;
    this.scene.add(p);
    this.phonePanel = makePanel(0.8, 0.34, 640);
    this.phonePanel.position.set(0, 0.5, 0);
    p.add(this.phonePanel);
  }

  /** 전화를 받는다 */
  answer() {
    if (!this.call) return;
    const c = this.call;
    this.call = null;
    this.phonePanel.visible = false;
    this.addTrust(RULES.accept);
    if (c.type === 'assembly') {
      this.pending.push({ in: 4, what: 'bag', code: c.code });
      this.say(`조립 의뢰 수락 · 곧 '${c.code}' 부품 가방이 온다`, 'good');
    } else {
      this.pending.push({ in: RULES.customerDelay, what: 'customer', code: c.code });
      this.say(`판매 의뢰 수락 · ${RULES.customerDelay}초 뒤 손님이 온다. '${c.code}'를 준비하세요`, 'good');
    }
    this.planCall();
  }
  planCall() { this.nextCall = THREE.MathUtils.randFloat(RULES.gapMin, RULES.gapMax); }

  ring() {
    const want = code => this.customers.filter(c => c.code === code).length + this.pending.filter(p => p.what === 'customer' && p.code === code).length;
    const guns = [...this.stock, ...this.heldGuns()];
    const free = this.codes.filter(code => guns.filter(g => g === code).length > want(code));
    const buyers = this.customers.filter(c => c.state !== 'leaving').length + this.pending.filter(p => p.what === 'customer').length;
    const bags = this.bagCount() + this.pending.filter(p => p.what === 'bag').length;
    let type = free.length && buyers < 2 && (bags >= 2 || Math.random() < 0.65) ? 'sale' : 'assembly';
    if (type === 'assembly' && bags >= 3) { this.nextCall = 8; return; }
    const pool = type === 'sale' ? free : this.codes;
    this.call = { type, code: pool[Math.floor(Math.random() * pool.length)], left: RULES.ringTime, beat: 0 };
  }

  addTrust(n) {
    this.trust = THREE.MathUtils.clamp(this.trust + n, 0, 100);
    if (this.trust <= 0) this.end('조직 신뢰도가 바닥났다');
  }
  fail(text, trust = RULES.failTrust) {
    if (this.over) return;
    this.warnings++;
    sound('bad');
    this.say(`${text} · 경고 ${this.warnings}/${RULES.maxWarnings}`, 'bad');
    this.addTrust(-trust);
    if (this.warnings >= RULES.maxWarnings) this.end('세 번째 실패로 조직에게 버림받았다');
  }
  end(reason) {
    if (this.over) return;
    this.over = reason;
    this.call = null;
    this.phonePanel.visible = false;
    sound('bad');
  }

  assembled(code) {
    this.money += RULES.assemblyPay;
    this.suspicion += 30;
    this.say(`'${code}' 완성 · HK$ ${RULES.assemblyPay} · 총기 보관함에 넣으세요`, 'good');
  }

  // ---------- 총기 보관함 ----------
  nearVault(p) { return Math.abs(p.y - this.vaultAt.y) < 1.6 && Math.hypot(p.x - this.vaultAt.x, p.z - this.vaultAt.z) < 2.2; }
  store(code) {
    this.stock.push(code);
    sound('snap');
    this.say(`'${code}' 총을 보관함에 넣었다`);
    this.showVault();
  }
  /** 꺼낼 총: 손님이 찾는 것 먼저 */
  nextGun() {
    const wanted = [...this.customers.map(c => c.code), ...this.pending.filter(p => p.what === 'customer').map(p => p.code)];
    return wanted.find(c => this.stock.includes(c)) ?? this.stock[0] ?? null;
  }
  takeGun() {
    const code = this.nextGun();
    if (!code) return null;
    this.stock.splice(this.stock.indexOf(code), 1);
    sound('pick');
    this.showVault();
    return code;
  }
  showVault() {
    const lines = [{ text: '총기 보관함', size: 46, bold: true }];
    const kinds = this.codes.filter(c => this.stock.includes(c));
    if (!kinds.length) lines.push({ text: '비어 있음', size: 34, color: '#b8a98a' });
    for (const c of kinds) lines.push({ text: `${c} ${GUNS[c].title} × ${this.stock.filter(s => s === c).length}`, size: 34 });
    this.vaultPanel.userData.set(lines);
  }

  // ---------- 손님 ----------
  send(code) {
    const used = new Set(this.customers.map(c => c.slot));
    const slot = [0, 1, 2].find(i => !used.has(i)) ?? 0;
    const s = this.map.slots[slot];
    const path = [V([-10.5, 21.6, -4.2]), V([-2.76, 21.6, -4.13]), V([-2.76, 21.6, -6.5]), V(s)];
    const c = new Customer(this.customerModel, this.scene, path, V(this.map.counter));
    c.code = code;
    c.slot = slot;
    c.left = RULES.customerWait;
    this.customers.push(c);
    this.say(`손님이 오고 있다 · 암호 '${code}'`);
  }
  /** 이 위치 가까이서 기다리는 손님 */
  customerNear(p, reach = 1.7) {
    return this.customers.find(c => c.state === 'waiting' && Math.abs(p.y - c.group.position.y - 1.1) < 1.6 && Math.hypot(p.x - c.group.position.x, p.z - c.group.position.z) < reach) ?? null;
  }
  deliver(c, code) {
    if (c.code === code) {
      this.money += RULES.salePay;
      this.suspicion += 25;
      this.sold++;
      sound('good');
      this.say(`판매 성공 · HK$ ${RULES.salePay}`, 'good');
      this.addTrust(RULES.saleTrust);
    } else this.fail(`암호가 다르다 · 손님은 '${c.code}'를 찾았다`);
    c.leave();
  }

  tick(dt) {
    if (this.over) return;
    this.pulse += dt;
    // 전화
    if (this.call) {
      const c = this.call;
      c.left -= dt;
      c.beat -= dt;
      if (c.beat <= 0) { c.beat = 1.6; sound('ring'); }
      this.handset.position.y = 0.13 + (c.beat > 0.8 ? Math.abs(Math.sin(this.pulse * 40)) * 0.012 : 0);
      this.phonePanel.visible = true;
      const eye = this.viewer();
      this.phonePanel.lookAt(eye.x, this.phonePanel.getWorldPosition(new THREE.Vector3()).y, eye.z);
      this.phonePanel.userData.set([{ text: c.type === 'assembly' ? '조립 의뢰' : '판매 의뢰', size: 46, bold: true }, { text: `암호 '${c.code}'`, size: 38, color: '#ffd79a' },
        { text: `수화기를 잡아 받기 · ${Math.ceil(c.left)}초`, size: 30 }]);
      if (c.left <= 0) {
        this.call = null;
        this.phonePanel.visible = false;
        this.say(`전화를 놓쳤다 · 조직 신뢰도 -${RULES.miss}`, 'bad');
        this.addTrust(-RULES.miss);
        this.planCall();
      }
    } else if (!this.isBusy()) {          // 지하에 있거나 조립하는 동안은 울리지 않는다
      this.nextCall -= dt;
      if (this.nextCall <= 0) this.ring();
    }
    // 곧 올 가방·손님
    for (const p of [...this.pending]) {
      p.in -= dt;
      if (p.in > 0) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      if (p.what === 'bag') { this.addBag(p.code); this.say(`카운터에 '${p.code}' 부품 가방이 왔다`); } else this.send(p.code);
    }
    // 손님
    for (const c of [...this.customers]) {
      const e = c.tick(dt, this.viewer());
      if (e === 'gone') { this.customers.splice(this.customers.indexOf(c), 1); continue; }
      if (e === 'arrived') { this.say(`손님이 카운터에서 기다린다 · 암호 '${c.code}'`); c.panel.visible = true; }
      if (c.state !== 'waiting') continue;
      c.left -= dt;
      c.panel.userData.set([{ text: `"${c.code}"`, size: 62, bold: true }, { text: `${Math.max(0, Math.ceil(c.left))}초`, size: 38, color: c.left < 25 ? '#ff7b5c' : '#ffd79a' }], c.left < 25 ? '#ff7b5c' : '#e9a94a');
      if (c.left <= 0) { c.leave(); this.fail('손님이 기다리다 떠났다'); }
    }
  }

  /** 지금 할 일 (손목·화면 안내) */
  todo() {
    if (this.over) return '';
    if (this.call) return '전화를 받으세요';
    const job = this.assembling();
    if (job) return job;
    const c = this.customers.find(x => x.state !== 'leaving') ?? this.pending.find(p => p.what === 'customer');
    if (c) return this.heldGuns().includes(c.code) ? `손님에게 '${c.code}' 건네기` : this.stock.includes(c.code) ? `보관함에서 '${c.code}' 꺼내기` : `'${c.code}' 총이 필요하다`;
    if (this.heldGuns().length) return '총을 보관함에 넣기';
    if (this.bagCount()) return '부품 가방을 비밀 작업대로';
    return '전화를 기다리는 중';
  }
}
