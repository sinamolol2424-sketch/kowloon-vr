// 경찰: 감시(복도에서 들여다봄) → 순찰(매장 안까지) → 급습(추격). 셔터와 탈출구도 여기서
import * as THREE from 'three';
import { Customer } from './customer.js';
import { Nav } from './nav.js';
import { makePanel, sound } from './ui.js';

export const POLICE = { perPhase: 60, patrolSpeed: 1.5, raidSpeed: 1.65, half: 32, range: 9, spotTime: 1.3, catchAt: 0.75, siren: 10, cutTime: 12, bribe: 2000, bribeTime: 10 };
const NAMES = ['평시', '감시', '순찰', '급습'];
const V = (x, z, y = 21.58) => new THREE.Vector3(x, y, z);
const WEST = V(-12.5, -4.0), EAST = V(8, -4.0), FRONT = V(-2.76, -4.13), PANE = V(-0.95, -4.0), PEEK = V(-3.65, -4.2), DESK = V(0.5, -8.4), INSIDE = V(-2.25, -7.05), WORK = V(-3.0, -9.3);
const ROUTES = {
  watch: [{ p: WEST, wait: 6 }, { p: PEEK, wait: 3, look: DESK }, { p: PANE, wait: 2.5, look: DESK }, { p: EAST, wait: 8 }, { p: FRONT, wait: 2, look: V(-2.7, -8) }, { p: PEEK, wait: 2, look: DESK }],
  patrol: [{ p: WEST, wait: 3 }, { p: PEEK, wait: 2, look: DESK }, { p: INSIDE, wait: 3, look: V(0.4, -8.4), inside: true }, { p: WORK, wait: 2.5, look: V(-3, -12), inside: true }, { p: FRONT, wait: 1 }, { p: EAST, wait: 5 }],
};
export const EXIT = V(-7.2, -5.95, 17.98);

/** 수리점 정문 셔터: 손잡이를 잡으면 오르내린다 */
export class Shutter {
  constructor(scene, nav) {
    this.nav = nav;
    this.a = V(-3.52, -5.87);
    this.b = V(-1.9, -5.6);
    this.height = 2.5;
    this.isDown = this.broken = false;
    this.t = 0;                       // 0 올라감, 1 내려옴
    const g = this.group = new THREE.Group();
    g.position.copy(this.a).add(this.b).multiplyScalar(0.5);
    g.rotation.y = -Math.atan2(this.b.z - this.a.z, this.b.x - this.a.x);
    const w = this.a.distanceTo(this.b);
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 64;
    const c = canvas.getContext('2d'), grad = c.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, '#2c2a27'); grad.addColorStop(0.5, '#77706a'); grad.addColorStop(1, '#35322e');
    c.fillStyle = grad; c.fillRect(0, 0, 8, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 22);
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(w, this.height), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    this.handle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0xc8a14a }));
    g.add(this.plate, this.handle);
    scene.add(g);
    this.cells = nav.cellsNear(this.a, this.b, 0.4);
    this.segment = [[this.a.x, this.a.z, this.b.x, this.b.z]];
    this.tick(0);
  }
  get closed() { return this.t > 0.5; }
  get blocks() { return this.closed ? this.segment : []; }
  handleAt() { return this.handle.getWorldPosition(new THREE.Vector3()); }
  toggle(force) { if (!this.broken || force) { this.isDown = !this.isDown; sound('snap'); } }
  smash() { this.isDown = false; this.broken = true; sound('bad'); }
  reset() { this.isDown = this.broken = false; }
  tick(dt) {
    this.t = THREE.MathUtils.clamp(this.t + (this.isDown ? 1 : -1) * dt / 0.9, 0, 1);
    const shown = Math.max(0.12, this.t);
    this.plate.scale.y = shown;
    this.plate.material.map.repeat.y = 22 * shown;
    this.plate.position.y = this.height - this.height * shown / 2;
    this.handle.position.y = THREE.MathUtils.lerp(1.95, 0.12, this.t);
    if (this.closed) for (const c of this.cells) this.nav.blocked.add(c); else for (const c of this.cells) this.nav.blocked.delete(c);
  }
}

class Cop {
  constructor(boss, at) {
    this.boss = boss;
    this.body = new Customer(boss.model, boss.scene, [at.clone(), at.clone()], at.clone().add(new THREE.Vector3(1, 0, 0)));
    this.body.state = 'waiting';
    this.pos = this.body.group.position;
    this.speed = POLICE.patrolSpeed;
    this.path = null;
    this.pause = 0;
    this.spot = 0;
    this.body.panel.scale.setScalar(0.6);
    this.fan = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    this.fan.frustumCulled = false;
    this.fan.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(21 * 3), 3));
    const idx = [];
    for (let i = 1; i < 20; i++) idx.push(0, i, i + 1);
    this.fan.geometry.setIndex(idx);
    boss.scene.add(this.fan);
  }
  remove() { this.body.remove(); this.fan.removeFromParent(); this.fan.geometry.dispose(); }
  go(to) { this.path = this.boss.nav.path(this.pos, to); this.index = 1; return !!this.path; }
  /** 길을 따라 걷고, 다 왔으면 true */
  step(dt) {
    if (!this.path || this.index >= this.path.length) return true;
    const to = this.path[this.index], d = new THREE.Vector3().subVectors(to, this.pos), len = d.length(), s = this.speed * dt;
    if (len > 0.001) this.body.turn(Math.atan2(d.x, d.z), dt);
    if (len <= s) { this.pos.copy(to); this.index++; } else this.pos.addScaledVector(d, s / len);
    this.body.phase += s / 1.35 * Math.PI * 2;
    this.moving = true;
    return false;
  }
  look(at, dt) { this.body.turn(Math.atan2(at.x - this.pos.x, at.z - this.pos.z), dt); }
  animate(dt) {
    this.body.time += dt;
    this.body.walk += ((this.moving ? 1 : 0) - this.body.walk) * Math.min(1, dt * 8);
    this.body.pose();
    this.moving = false;
  }
  drawFan(show, extra) {
    this.fan.visible = show;
    if (!show) return;
    const p = this.fan.geometry.attributes.position, yaw = this.body.group.rotation.y, half = THREE.MathUtils.degToRad(POLICE.half);
    p.setXYZ(0, this.pos.x, this.pos.y + 0.06, this.pos.z);
    for (let i = 0; i < 20; i++) {
      const a = yaw - half + half * 2 * i / 19, x = this.pos.x + Math.sin(a) * POLICE.range, z = this.pos.z + Math.cos(a) * POLICE.range;
      const t = this.boss.nav.cast(this.pos.x, this.pos.z, x, z, extra);
      p.setXYZ(i + 1, this.pos.x + (x - this.pos.x) * t, this.pos.y + 0.06, this.pos.z + (z - this.pos.z) * t);
    }
    p.needsUpdate = true;
    this.fan.material.color.setHex(this.spot > 0.05 ? 0xff5a3c : 0xffd479);
  }
  sees(p) {
    if (Nav.floor(p.y) !== Nav.floor(this.pos.y) || Nav.floor(p.y) !== 1) return false;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > POLICE.range) return false;
    const a = Math.atan2(dx, dz) - this.body.group.rotation.y;
    if (d > 1.2 && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > THREE.MathUtils.degToRad(POLICE.half)) return false;
    return this.boss.nav.cast(this.pos.x, this.pos.z, p.x, p.z, this.boss.shutter.blocks) >= 1;
  }
}

export class Police {
  /** env: { scene, nav, model, shutter, stairs, say, feet, handsBusy, game, onRaid, setOver } */
  constructor(env) {
    Object.assign(this, env);
    this.cops = [];
    this.phase = 0;
    this.gate = new THREE.Group();
    const glow = new THREE.MeshBasicMaterial({ color: 0xffb84d, toneMapped: false });
    for (const [w, h, x, y] of [[0.08, 2.1, -0.62, 1.05], [0.08, 2.1, 0.62, 1.05], [1.32, 0.08, 0, 2.1]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), glow);
      m.position.set(x, y, 0);
      this.gate.add(m);
    }
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.1), new THREE.MeshBasicMaterial({ color: 0x050403 }));
    hole.position.y = 1.05;
    this.gate.add(hole);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ color: 0x3a1a12 }));   // 내보낸 구역이 끝나는 곳을 가린다
    wall.position.set(0, 1.75, -0.03);
    this.gate.add(wall);
    this.gate.position.copy(EXIT).z += 0.35;
    this.gate.rotation.y = Math.PI;
    const sign = makePanel(0.9, 0.22, 512);
    sign.userData.set([{ text: '탈출구 · 배수로', size: 54, bold: true, color: '#ffb84d' }]);
    sign.position.set(0, 1.75, 0.06);
    this.gate.add(sign);
    this.scene.add(this.gate);
  }
  get raid() { return this.phase === 3; }
  get name() { return NAMES[this.phase]; }
  reset() { this.set(0); this.suspicion = 0; this.shutter.reset(); }

  suspicion = 0;
  add(n) {
    if (this.raid) return;
    this.suspicion += n;
    if (this.suspicion < POLICE.perPhase) return;
    this.suspicion -= POLICE.perPhase;
    this.set(this.phase + 1);
  }
  set(phase) {
    this.phase = Math.min(3, phase);
    for (const c of this.cops) c.remove();
    this.cops = [];
    this.bribed = false;
    this.cut = 0;
    this.siren = 0;
    const post = (route, start) => { const c = new Cop(this, route[start].p); Object.assign(c, { route, at: start, wait: start ? 0 : 1 }); this.cops.push(c); };
    if (this.phase === 1) { post(ROUTES.watch, 0); this.say('경찰 감시 시작 · 총·가방을 들고 있거나 밖에 놓아두면 체포된다', 'bad'); }
    if (this.phase === 2) { post(ROUTES.patrol, 0); this.say('경찰 순찰 시작 · 매장 안까지 들어온다. 셔터를 내리면 막을 수 있다', 'bad'); }
    if (this.phase === 3) {
      const friends = this.friends?.() ?? [];
      this.siren = POLICE.siren + friends.length * 5;              // 신뢰도 60 이상인 이웃이 시간을 벌어 준다
      this.beat = 0;
      this.say(friends.length ? `급습! 이웃 ${friends.length}명이 시간을 벌어 준다 · 비밀 작업실 탈출구로` : '급습! 비밀 작업실 철문 너머 탈출구로 도망치세요', 'bad');
      this.onRaid();
    }
    if (this.phase) sound('bad');
  }
  bribe() {
    if (!this.raid || this.bribed || !this.cops.length) return;
    if (this.game.money < POLICE.bribe) { this.say(`매수할 돈이 없다 · HK$ ${POLICE.bribe}`, 'bad'); return; }
    this.game.money -= POLICE.bribe;
    this.bribed = true;
    for (const c of this.cops) c.pause = POLICE.bribeTime;
    this.say(`경찰 매수 · ${POLICE.bribeTime}초 동안 멈춘다`, 'good');
  }

  tick(dt) {
    this.shutter.tick(dt);
    const me = this.feet();
    if (this.raid) this.tickRaid(dt, me); else for (const c of this.cops) this.patrol(c, dt, me);
    for (const c of this.cops) { c.animate(dt); c.drawFan(!this.raid && Nav.floor(me.y) === 1, this.shutter.blocks); }
  }

  patrol(c, dt, me) {
    c.body.stagger = Math.max(0, (c.body.stagger ?? 0) - dt * 0.35);
    if (c.body.hold > 0) { c.body.hold -= dt; c.look(me, dt); return; }        // 부딪혀서 검문 중
    if (c.heardFor > 0) { c.heardFor -= dt; c.look(c.heard, dt); this.watchMe(c, dt, me); return; }   // 소란을 쳐다봄
    const here = c.route[c.at];
    if (c.wait > 0) {
      c.wait -= dt;
      if (here.look) c.look(here.look, dt);
    } else {
      if (!c.path) {
        let n = (c.at + 1) % c.route.length;
        while (c.route[n].inside && this.shutter.closed) n = (n + 1) % c.route.length;
        c.next = n;
        if (!c.go(c.route[n].p)) { c.path = null; c.wait = 1; }       // 안에 갇혔으면 열릴 때까지
      }
      if (c.path && c.step(dt)) { c.at = c.next; c.path = null; c.wait = Math.max(0.05, c.route[c.at].wait); }
    }
    this.watchMe(c, dt, me);
  }
  watchMe(c, dt, me) {
    const holding = this.handsBusy() && c.sees(me), lying = !holding && this.evidence().find(p => c.sees(p));
    const seen = holding || !!lying;
    if (lying) c.look(lying, dt * 0.6);
    c.spot = THREE.MathUtils.clamp(c.spot + (seen ? dt : -dt * 0.8), 0, POLICE.spotTime);
    c.body.panel.visible = c.spot > 0.05;
    if (c.body.panel.visible) {
      const eye = this.eye();
      c.body.panel.lookAt(eye.x, c.body.panel.getWorldPosition(new THREE.Vector3()).y, eye.z);
      c.body.panel.userData.set([{ text: '거기 그거 뭐야!', size: 60, bold: true, color: '#ff7b5c' }], '#ff7b5c');
    }
    if (c.spot >= POLICE.spotTime) this.setOver('체포', holding ? '총이나 부품 가방을 든 채 경찰에게 들켰다' : '떨어져 있던 총이나 부품 가방을 경찰이 발견했다');
  }

  tickRaid(dt, me) {
    this.beat -= dt;
    if (this.beat <= 0) { this.beat = 1.5; sound('siren'); }
    if (this.siren > 0) {
      this.siren -= dt;
      if (this.siren <= 0) for (const p of [WEST, EAST]) { const c = new Cop(this, p); c.speed = POLICE.raidSpeed; c.think = 0; this.cops.push(c); }
      return;
    }
    let cutting = false;
    for (const c of this.cops) {
      if (c.pause > 0) { c.pause -= dt; continue; }
      c.think -= dt;
      if (c.think <= 0) { c.think = 0.5 + Math.random() * 0.2; this.plan(c, me); }
      const there = c.step(dt);
      if (there && c.cutting) { cutting = true; c.look(this.shutter.group.position, dt); }
      if (there && c.hop) {
        c.pos.set(...c.hop.to).y -= 0.1;
        c.pause = 1.5;
        c.hop = null;
        c.path = null;
        this.say('경찰이 계단으로 따라온다!', 'bad');
      }
      if (c.pause <= 0 && Math.abs(c.pos.y - me.y) < 1.2 && Math.hypot(c.pos.x - me.x, c.pos.z - me.z) < POLICE.catchAt) { this.setOver('체포', '급습한 경찰에게 붙잡혔다'); return; }
    }
    if (cutting) {
      if (!this.cut) this.say(`경찰이 셔터를 뜯는다 · ${POLICE.cutTime}초`, 'bad');
      this.cut += dt;
      if (this.cut >= POLICE.cutTime) { this.shutter.smash(); this.say('셔터가 뜯겼다!', 'bad'); }
    }
    if (Math.abs(me.y - EXIT.y) < 1 && Math.hypot(me.x - EXIT.x, me.z - EXIT.z) < 0.75) this.setOver('탈출 성공', '배수로를 따라 빠져나갔다', true);
  }
  plan(c, me) {
    c.hop = null;
    c.cutting = false;
    if (Nav.floor(c.pos.y) === Nav.floor(me.y)) { if (c.go(me)) return; }
    else {
      const s = this.stairs.find(p => Nav.floor(p.p[1]) === Nav.floor(c.pos.y));
      if (s && c.go(new THREE.Vector3(s.p[0], c.pos.y, s.p[2]))) { c.hop = s; return; }
    }
    c.path = null;
    if (this.shutter.closed && c.pos.z > -5.8) { c.go(V(-2.76, -4.9)); c.cutting = true; }   // 셔터에 막힘
  }
  todo() {
    if (!this.raid) return '';
    return this.siren > 0 ? `급습 ${Math.ceil(this.siren)}초 전 · 비밀 작업실 철문으로!` : '비밀 작업실 철문 너머 탈출구로!';
  }
}
