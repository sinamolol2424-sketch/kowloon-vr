// 복도의 이웃, 삼합회, 그리고 부딪혔을 때의 시비
import * as THREE from 'three';
import { Customer } from './customer.js';
import { makePanel, sound } from './ui.js';

export const STREET = { people: 3, cooldown: 8, answer: 10, bribe: 100, fightWin: 0.5, fightSuspicion: 15, fightLoss: 150, demand: 600, demandTime: 30, demandPay: 8, demandRefuse: 15, lowTrust: 25 };
const V = (x, z, y = 21.58) => new THREE.Vector3(x, y, z);
const SPOTS = [V(-12, -3.9), V(-8, -4.1), V(-5.2, -3.8), V(1.5, -3.9), V(4.5, -4), V(7.5, -3.8), V(-11, 4), V(-4, 4.1), V(0, 4), V(5, 4.1)];
const NAMES = { junk: '고물상 주인', food: '음식점 주인', dealer: '마약상', clinic: '불법 의료인', gamble: '도박장 주인', resident: '주민' };
const LINES = {
  customer: ['어이, 눈 똑바로 뜨고 다녀!', '뭐야, 지금 시비 거는 거야?', '됐어. 다른 데서 산다.'],
  triad: ['죽고 싶어? 내가 누군지 몰라?'],
  junk: ['아이고, 고물 다 쏟을 뻔했네!'], food: ['국물 흘릴 뻔했잖아! 앞 좀 봐!'], dealer: ['…손대지 마.'],
  clinic: ['또 다치고 싶어서 그래?'], gamble: ['재수 없게… 오늘 패가 말리겠군.'], resident: ['좁은 데서 왜 이렇게 급해요!'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];

export class Street {
  /** env: { scene, nav, game, police, shutter, say, feet, eye, handsBusy, models:{id:scene}, triadModel, buzz } */
  constructor(env) {
    Object.assign(this, env);
    this.people = [];
    this.buttons = [0, 1, 2].map(() => {
      const b = makePanel(0.62, 0.13, 512);
      b.visible = false;
      this.scene.add(b);
      return b;
    });
    this.reset();
  }

  reset() {
    this.clear();
    this.seenWarnings = 0;
    this.seenLow = false;
    this.triadIn = -1;
    this.wait = 0;
    this.spawnIn = 0;
  }
  clear() {
    this.close();
    for (const p of this.people) p.remove();
    this.people = [];
    this.triad?.remove();
    this.triad = null;
  }

  // ---------- 이웃 산책 ----------
  spawn() {
    const free = Object.keys(this.models).filter(id => !this.people.some(p => p.id === id));
    if (!free.length) return;
    const id = pick(free), me = this.feet();
    const at = pick(SPOTS.filter(s => s.distanceTo(me) > 5));
    if (!at) return;
    const p = new Customer(this.models[id], this.scene, [at.clone(), at.clone()], at.clone());
    if (id === 'dealer' || id === 'clinic') p.look.scale.setScalar(1.12);
    Object.assign(p, { id, type: id, name: NAMES[id], state: 'waiting', rest: 1 });
    p.face = at.clone().add(V(0, 1, 0));
    this.people.push(p);
  }
  stroll(p, dt) {
    if (p.state === 'waiting') {
      p.rest -= dt;
      if (p.rest <= 0) {
        const path = this.nav.path(p.group.position, pick(SPOTS.filter(s => s.distanceTo(p.group.position) > 2)));
        if (path && path.length > 1) { p.path = path; p.index = 1; p.state = 'coming'; p.group.position.copy(path[0]); } else p.rest = 2;
      }
    }
    if (p.tick(dt, this.eye()) === 'arrived') { p.rest = 3 + Math.random() * 8; p.face = p.group.position.clone().add(V(Math.random() - 0.5, p.group.position.z < 0 ? -1 : 1, 0)); }
  }

  // ---------- 부딪힘 ----------
  /** 지금 몸이 있는 사람들 */
  bodies() {
    const list = [];
    for (const c of this.game.customers) if (c.state !== 'gone') list.push({ who: c, type: 'customer' });
    if (!this.police.raid) for (const c of this.police.cops) list.push({ who: c.body, type: 'police', cop: c });
    for (const p of this.people) list.push({ who: p, type: 'neighbor' });
    if (this.triad && this.triad.state !== 'gone') list.push({ who: this.triad, type: 'triad' });
    return list;
  }
  /** f 에서 (x, z) 로 걸어가려 할 때 사람에게 막히면 true. 정면으로 걸어가 부딪힌 것이면 시비 */
  blocks(f, x, z) {
    if (f.y < 20) return false;
    for (const b of this.bodies()) {
      const p = b.who.group.position;
      const now = Math.hypot(f.x - p.x, f.z - p.z), next = Math.hypot(x - p.x, z - p.z);
      if (next > 0.46 || next >= now) continue;
      const len = Math.hypot(x - f.x, z - f.z) || 1;
      const front = ((x - f.x) * (p.x - f.x) + (z - f.z) * (p.z - f.z)) / (len * (now || 1));
      if (front > 0.55) this.bump(b);
      return true;
    }
    return false;
  }
  bump(b) {
    if (this.wait > 0 || this.open || this.game.over) return;
    this.wait = STREET.cooldown;
    b.who.stagger = 0.22;
    b.who.hold = 2.5;
    if (b.type !== 'police') this.back = { who: b.who, left: 0.9 };       // 한 걸음 물러나 돌아본다 (VR 에서 얼굴이 너무 가깝지 않게)
    sound('bump');
    this.buzz(0.8, 120);
    if (b.type === 'police') { this.frisk(b); return; }
    if (b.type === 'triad' && this.triadWaiting) return;      // 상납금 이야기 중
    if (b.type === 'customer') {
      b.who.bumps = (b.who.bumps ?? 0) + 1;
      if (b.who.left !== undefined) b.who.left -= 10;
      if (b.who.bumps >= 3 && b.who.state !== 'leaving') {
        this.talk(b.who, LINES.customer[2]);
        b.who.hold = 1.5;
        b.who.leave();
        this.game.fail('손님이 화가 나서 가 버렸다');
        return;
      }
    }
    const line = b.type === 'customer' ? LINES.customer[Math.min(1, b.who.bumps - 1)] : pick(LINES[b.type === 'triad' ? 'triad' : b.who.id]);
    this.ask(b, line, [['사과하기', () => this.sorry(b)], [`돈 주기 HK$ ${b.type === 'triad' ? 200 : STREET.bribe}`, () => this.pay(b, b.type === 'triad' ? 200 : STREET.bribe)], ['맞서기', () => this.fight(b)]], STREET.answer, () => this.ignore(b));
  }
  frisk(b) {
    if (this.handsBusy()) { this.talk(b.who, '그 가방 열어 봐.'); this.police.setOver('체포', '경찰과 부딪혀 들고 있던 것을 들켰다'); return; }
    b.who.hold = 3;
    this.talk(b.who, '신분증 꺼내 봐.', 3);
    this.say('경찰과 부딪혀 검문을 당했다 · 의심도 +10', 'bad');
    this.suspectLater = 3;                // 검문이 끝난 뒤에 올린다 (단계가 바뀌면 경찰이 교대해서)
  }
  sorry(b) {
    if (b.type === 'triad') { this.say('"…이번만 봐준다." · 조직 신뢰도 -5', 'bad'); this.game.addTrust(-5); }
    else this.say('사과하고 넘어갔다');
  }
  pay(b, n) {
    if (this.game.money < n) { this.say('돈이 모자라다', 'bad'); this.ignore(b); return; }
    this.game.money -= n;
    sound('pick');
    this.say(`HK$ ${n}를 주고 달랬다`, 'good');
  }
  fight(b) {
    const win = Math.random() < (b.type === 'triad' ? 0.3 : STREET.fightWin);
    b.who.stagger = win ? 0.4 : 0;
    sound(win ? 'bump' : 'bad');
    this.buzz(1, 200);
    if (win) { this.say('기세로 눌렀다 · 상대가 물러난다', 'good'); b.who.hold = 2; }
    else {
      const loss = Math.min(this.game.money, STREET.fightLoss);
      this.game.money -= loss;
      this.say(`말싸움에서 밀렸다 · HK$ ${loss} 뜯김`, 'bad');
      if (b.type === 'triad') this.game.addTrust(-5);
    }
    this.noise(b.who.group.position, STREET.fightSuspicion);
  }
  ignore(b) {
    this.say('무시하자 큰소리를 친다', 'bad');
    if (b.type === 'triad') this.game.addTrust(-5);
    this.noise(b.who.group.position, 5);
  }
  /** 소란: 의심도가 오르고 가까운 경찰이 쳐다본다 */
  noise(at, n) {
    for (const c of this.police.cops) if (c.pos.distanceTo(at) < 11) { c.heard = at.clone(); c.heardFor = 4; }
    this.police.add(n);
  }

  // ---------- 말풍선과 선택지 ----------
  talk(who, text, seconds = 2.5) {
    this.restorePanel();
    this.speaker = { who, left: seconds, text };
  }
  ask(b, text, choices, seconds, timeout) {
    this.talk(b.who, text, seconds);
    this.open = { who: b.who, choices, left: seconds, timeout };
    this.hover = -1;
  }
  choose(i) {
    const o = this.open;
    if (!o || !o.choices[i]) return false;
    this.close();
    o.who.hold = 0.8;
    o.choices[i][1]();
    return true;
  }
  close() {
    this.open = null;
    for (const b of this.buttons) b.visible = false;
    this.restorePanel();
  }
  restorePanel() {
    if (!this.speaker) return;
    const { who } = this.speaker;
    who.panel.visible = this.game.customers.includes(who) && who.state === 'waiting';
    this.speaker = null;
  }
  /** 광선이 가리키는 선택지 번호 */
  hit(ray, pad = 0) {
    if (!this.open) return -1;
    const box = new THREE.Box3(), at = new THREE.Vector3();
    let best = -1, dist = 6;
    this.buttons.forEach((b, i) => {
      if (!b.visible || !ray.intersectBox(box.setFromObject(b).expandByScalar(0.02 + pad), at)) return;
      const d = at.distanceTo(ray.origin);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  }

  // ---------- 삼합회 ----------
  callTriad(after) { if (!this.triad && this.triadIn < 0) this.triadIn = after; }
  tickTriad(dt) {
    const g = this.game;
    if (g.warnings > this.seenWarnings) { this.seenWarnings = g.warnings; this.callTriad(20); }
    if (g.trust > STREET.lowTrust) this.seenLow = false; else if (!this.seenLow) { this.seenLow = true; this.callTriad(15); }
    if (this.triadIn >= 0 && !this.triad) {
      this.triadIn -= dt;
      if (this.triadIn > 0 || g.customers.length || this.feet().y < 20) return;       // 손님이 있거나 지하에 있으면 기다린다
      this.triadIn = -1;
      const path = [V(-12.5, -4), V(-2.76, -4.13), V(-2.76, -5.1)];
      this.triad = new Customer(this.triadModel, this.scene, path, V(-2.76, -8));
      this.triad.look.scale.setScalar(1.06);
      this.triadStep = 'door';
      this.say('삼합회 조직원이 복도에 나타났다', 'bad');
    }
    const t = this.triad;
    if (!t) return;
    const e = t.tick(dt, this.eye());
    if (e === 'gone') { this.triad = null; return; }
    const walk = (points, face) => { t.path = [t.group.position.clone(), ...points]; t.index = 1; t.state = 'coming'; t.face = face; };
    if (this.triadStep === 'door' && t.state === 'waiting') {
      if (this.shutter.isDown) { if (!this.knocked) { this.knocked = 1.5; this.say('쾅쾅쾅! "문 열어!"', 'bad'); sound('bump'); } this.knocked -= dt; if (this.knocked <= 0) this.shutter.isDown = false; return; }
      if (this.shutter.closed) return;
      this.knocked = 0;
      walk([V(-2.76, -6.5), V(-1.9, -7.4)], V(0.3, -8.4));
      this.triadStep = 'in';
    } else if (this.triadStep === 'in' && t.state === 'waiting') {
      this.shutter.isDown = true;                     // 등 뒤로 셔터를 내린다
      this.triadStep = 'ask';
      this.triadWaiting = true;
      const out = paid => { this.triadWaiting = false; if (!paid) g.addTrust(-STREET.demandRefuse); this.shutter.isDown = false; this.triadStep = 'out'; };
      this.ask({ who: t }, `"HK$ ${STREET.demand} 내놔."`, [[`내기 HK$ ${STREET.demand}`, () => {
        if (g.money < STREET.demand) { this.say('돈이 모자라다 · 조직 신뢰도 -15', 'bad'); out(false); return; }
        g.money -= STREET.demand;
        g.addTrust(STREET.demandPay);
        this.say('"다음부터 잘해." · 조직 신뢰도 +8', 'good');
        out(true);
      }], ['못 낸다', () => { this.say('조직원이 가게를 뒤엎었다 · 조직 신뢰도 -15', 'bad'); sound('bad'); out(false); }]], STREET.demandTime, () => { this.say('상납금을 내지 않았다 · 조직 신뢰도 -15', 'bad'); out(false); });
    } else if (this.triadStep === 'out' && !this.shutter.closed && t.state === 'waiting') {
      t.state = 'leaving';
      t.hold = 0;
      t.path = [t.group.position.clone(), V(-2.76, -6.5), V(-2.76, -4.13), V(-12.5, -4)];
      t.index = 1;
      this.triadStep = 'gone';
    }
  }

  tick(dt) {
    this.wait -= dt;
    if (this.suspectLater > 0) { this.suspectLater -= dt; if (this.suspectLater <= 0) this.police.add(10); }
    if (this.police.raid) { if (this.people.length || this.triad) this.clear(); }
    else {
      this.spawnIn -= dt;
      if (this.people.length < STREET.people && this.spawnIn <= 0) { this.spawnIn = 4; this.spawn(); }
      for (const p of this.people) this.stroll(p, dt);
      this.tickTriad(dt);
    }
    const eye = this.eye();
    if (this.back) {
      const { who } = this.back, p = who.group.position, d = new THREE.Vector3(p.x - eye.x, 0, p.z - eye.z), len = d.length();
      this.back.left -= dt;
      const to = p.clone().addScaledVector(d.normalize(), 1.1 * dt), [x, z] = this.nav.cell(to);
      if (len < 1.35 && this.nav.open(1, x, z)) p.copy(to);
      if (this.back.left <= 0 || who.state === 'gone') this.back = null;
    }
    if (this.speaker) {
      const s = this.speaker;
      s.left -= dt;
      if (s.left <= 0 || s.who.state === 'gone') { if (!this.open) this.restorePanel(); }
      else {
        s.who.panel.visible = true;
        s.who.panel.userData.set([{ text: s.text, size: 44, bold: true, color: '#ffb0a0' }, ...(this.open ? [{ text: `${Math.ceil(this.open.left)}초`, size: 30 }] : [])], '#ff7b5c');
        s.who.panel.lookAt(eye.x, s.who.panel.getWorldPosition(new THREE.Vector3()).y, eye.z);
      }
    }
    const o = this.open;
    if (!o) return;
    o.left -= dt;
    o.who.hold = Math.max(o.who.hold ?? 0, 0.3);
    const far = o.who.group.position.distanceTo(this.feet()) > 5 && !this.triadWaiting;
    if (o.left <= 0 || far || o.who.state === 'gone') { this.close(); o.timeout(); return; }
    const p = o.who.group.position, to = new THREE.Vector3(eye.x - p.x, 0, eye.z - p.z), d = Math.max(0.01, to.length());
    to.normalize();
    this.buttons.forEach((b, i) => {
      b.visible = i < o.choices.length;
      if (!b.visible) return;
      const size = THREE.MathUtils.clamp(d / 1.6, 0.4, 1.1);
      b.scale.setScalar(size);
      b.position.set(p.x, eye.y - 0.12 - i * 0.16 * size, p.z).addScaledVector(to, Math.min(0.4, d * 0.3));
      b.lookAt(eye.x, b.position.y, eye.z);
      const on = this.hover === i;
      b.userData.set([{ text: `${i + 1}. ${o.choices[i][0]}`, size: 50, bold: on, color: on ? '#1b1208' : '#ffe6bf' }], on ? '#ffd79a' : '#e9a94a', on ? '#e9a94a' : undefined);
    });
  }
}
