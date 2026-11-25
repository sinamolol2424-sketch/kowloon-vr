// 처음 하는 사람을 위한 안내: 다음에 갈 곳의 화살표 + 시작할 때 조작판
import * as THREE from 'three';
import { makePanel } from './ui.js';
import { EXIT } from './police.js';

const V = a => new THREE.Vector3(...a);
export class Guide {
  /** env: { scene, map, stairs, game, police, repair, bench, feet, eye, held(), vr(), settings } */
  constructor(env) {
    Object.assign(this, env);
    this.arrow = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: 0xffc04d, toneMapped: false, transparent: true, opacity: 0.9, depthTest: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), m);
    cone.rotation.x = Math.PI;
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), m);
    stem.position.y = 0.13;
    this.arrow.add(cone, stem);
    this.arrow.renderOrder = cone.renderOrder = stem.renderOrder = 990;
    this.scene.add(this.arrow);
    this.label = makePanel(0.5, 0.11, 512);
    this.label.material.depthTest = false;
    this.label.renderOrder = 991;
    this.scene.add(this.label);
    this.up = this.stairs.find(s => s.p[1] < 20);
    this.down = this.stairs.find(s => s.p[1] > 20);
    this.board = makePanel(1.5, 1.2, 1024);
    this.board.visible = false;
    this.scene.add(this.board);
    this.closed = false;
  }
  showBoard() {
    if (this.closed || !this.settings.guide) return;
    const vr = this.vr();
    this.board.userData.set([
      { text: '구룡성채 수리점', size: 80, bold: true, color: '#ffd79a' },
      ...(vr ? ['왼쪽 스틱 걷기 · 오른쪽 스틱 돌기', '방아쇠로 바닥을 가리켜 순간이동', '옆 버튼(그립) = 집기 · 다시 누르면 놓기', '왼손 X = 설정 · 손목 = 지금 할 일'] : ['WASD 걷기 · 마우스 둘러보기', 'E 또는 클릭 = 집기 · 다시 누르면 놓기', '오른쪽 위 = 지금 할 일']).map(text => ({ text, size: 48 })),
      { text: ' ', size: 20 },
      { text: '노란 화살표를 따라가세요', size: 54, bold: true, color: '#9dff8a' },
      { text: '1. 전화가 울리면 수화기를 집는다', size: 42 }, { text: '2. 부품 가방을 지하 작업대로', size: 42 }, { text: '3. 조립한 총을 손님에게', size: 42 }, { text: '경찰이 보이면 총과 가방을 숨기세요', size: 42, color: '#ff9b7c' },
    ]);
    const eye = this.eye(), me = this.feet();
    this.board.position.set(me.x - 1.9, eye.y - 0.05, me.z);
    this.board.lookAt(eye.x, this.board.position.y, eye.z);
    this.board.visible = true;
    this.left = 25;
  }
  hideBoard() { this.closed = true; this.board.visible = false; }

  /** 지금 가야 할 곳: [위치, 글자] */
  target() {
    const g = this.game, up = this.feet().y > 20, held = this.held(), kind = held?.userData.kind, code = held?.userData.code;
    const stairs = (text, below) => below === !up ? null : [V((up ? this.down : this.up).p).setY((up ? 21.6 : 18) + 1.5), text];
    if (g.over || this.bench.active) return null;
    if (this.police.raid) return up ? stairs('지하로 도망치기', true) : [EXIT.clone().setY(EXIT.y + 1.2), '탈출구'];
    if (kind === 'bag') return up ? stairs('비밀 작업실로', true) : [this.bench.origin.clone().setY(this.bench.origin.y + 0.45), '작업대에 놓기'];
    if (kind === 'gun') {
      const c = g.customers.find(x => x.code === code && x.state === 'waiting');
      if (c) return up ? [c.group.position.clone().setY(c.group.position.y + 1.55), '손님에게 건네기'] : stairs('손님에게', false);
      return up ? stairs('총기 보관함으로', true) : [g.vaultPanel.position.clone().setY(g.vaultPanel.position.y + 0.4), '보관함에 넣기'];
    }
    const r = this.repair, v = r.visitor;
    if (kind === 'repair') return !up ? stairs('수리점으로', false) : held.userData.broken ? [r.benchAt.clone().setY(r.benchAt.y + 0.45), '수리 작업대에 놓기'] : v && [v.group.position.clone().setY(23.1), '돌려주기'];
    if (g.call) return up ? [g.phone.position.clone().setY(g.phone.position.y + 0.32), '전화 받기'] : null;
    const c = g.customers.find(x => x.state === 'waiting' && g.stock.includes(x.code));
    if (c) return up ? stairs('보관함에서 총 꺼내기', true) : [g.vaultPanel.position.clone().setY(g.vaultPanel.position.y + 0.4), `'${c.code}' 꺼내기`];
    if (r.screws.length) return up ? [r.screws[0].position.clone().setY(r.screws[0].position.y + 0.15), '나사 조이기'] : null;
    if (r.item && up) return [r.item.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0)), r.item.userData.broken ? '수리할 물건 집기' : '고친 물건 집기'];
    if (v && v.state === 'waiting' && !v.given && up) return [v.group.position.clone().setY(23.1), '물건 받기'];
    const bag = this.loose('bag'), gun = this.loose('gun');
    if (gun && (gun.position.y > 20) === up) return [gun.position.clone().setY(gun.position.y + 0.3), '총 집기'];
    if (bag) return (bag.position.y > 20) === up ? [bag.position.clone().setY(bag.position.y + 0.35), '부품 가방 집기'] : stairs('부품 가방 집기', false);
    return null;
  }
  tick(dt) {
    if (this.board.visible) { this.left -= dt; if (this.left <= 0 || this.game.customers.length || this.game.pending.length) this.hideBoard(); }
    const t = this.settings.guide ? this.target() : null;
    this.arrow.visible = this.label.visible = !!t;
    if (!t) return;
    const eye = this.eye(), bob = Math.sin(performance.now() / 260) * 0.04;
    this.arrow.position.copy(t[0]).y += 0.1 + bob;
    this.arrow.rotation.y += dt * 1.5;
    const d = eye.distanceTo(t[0]), s = THREE.MathUtils.clamp(d / 2.6, 0.7, 2.2);
    this.arrow.scale.setScalar(s);
    this.label.scale.setScalar(s);
    this.label.position.copy(this.arrow.position).y += 0.34 * s;
    this.label.lookAt(eye);
    this.label.userData.set([{ text: t[1], size: 54, bold: true }]);
  }
}
