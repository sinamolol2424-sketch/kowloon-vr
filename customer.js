// 총을 사러 오는 손님: 걷기·숨쉬기는 코드로 (Unity 의 CharacterRig 와 같은 값)
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makePanel } from './ui.js';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const rad = THREE.MathUtils.degToRad;

export class Customer {
  constructor(source, scene, path, face) {
    this.group = new THREE.Group();
    this.look = SkeletonUtils.clone(source);
    this.group.add(this.look);
    this.bones = {};
    this.restPose = {};
    this.look.traverse(o => {
      if (o.isBone) { this.bones[o.name] = o; this.restPose[o.name] = o.quaternion.clone(); }
      if (o.isSkinnedMesh) o.frustumCulled = false;
    });
    this.path = path;
    this.home = [...path].reverse();
    this.index = 1;
    this.face = face;
    this.state = 'coming';
    this.walk = 0;
    this.phase = 0;
    this.time = Math.random() * 9;
    this.group.position.copy(path[0]);
    this.panel = makePanel(0.62, 0.22, 512);
    this.panel.position.y = 2.3;
    this.panel.visible = false;
    this.group.add(this.panel);
    scene.add(this.group);
  }
  leave() {
    if (this.state === 'leaving') return;
    this.state = 'leaving';
    this.path = this.home;
    this.index = 1;
    this.panel.visible = false;
  }
  remove() { this.group.removeFromParent(); this.state = 'gone'; }

  /** 도착한 순간 'arrived', 사라질 때 'gone' */
  tick(dt, viewer) {
    let event = null, moving = false;
    this.time += dt;
    this.stagger = Math.max(0, (this.stagger ?? 0) - dt * 0.35);
    if (this.hold > 0 && this.state !== 'gone') {          // 부딪혀서 멈춰 돌아봄
      this.hold -= dt;
      this.turn(Math.atan2(viewer.x - this.group.position.x, viewer.z - this.group.position.z), dt);
      this.walk += (0 - this.walk) * Math.min(1, dt * 8);
      this.pose();
      if (this.panel.visible) this.panel.lookAt(viewer.x, this.panel.getWorldPosition(new THREE.Vector3()).y, viewer.z);
      return null;
    }
    if (this.state === 'coming' || this.state === 'leaving') {
      const to = this.path[this.index];
      const d = new THREE.Vector3().subVectors(to, this.group.position);
      const step = 1.9 * dt, len = d.length();
      moving = true;
      if (len > 0.001) this.turn(Math.atan2(d.x, d.z), dt);
      if (len <= step) {
        this.group.position.copy(to);
        if (++this.index >= this.path.length) {
          if (this.state === 'coming') { this.state = 'waiting'; event = 'arrived'; } else { this.remove(); return 'gone'; }
        }
      } else this.group.position.addScaledVector(d, step / len);
      this.phase += step / 1.35 * Math.PI * 2;
    } else this.turn(Math.atan2(this.face.x - this.group.position.x, this.face.z - this.group.position.z), dt);
    this.walk += ((moving ? 1 : 0) - this.walk) * Math.min(1, dt * 8);
    this.pose();
    if (this.panel.visible) this.panel.lookAt(viewer.x, this.panel.getWorldPosition(new THREE.Vector3()).y, viewer.z);
    return event;
  }
  turn(yaw, dt) {
    let d = (yaw - this.group.rotation.y + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    this.group.rotation.y += THREE.MathUtils.clamp(d - Math.PI, -6 * dt, 6 * dt);
  }
  /** 모델 축으로 뼈를 돌린다 (부모 뼈부터) */
  bend(name, degrees, axis) {
    const b = this.bones[name];
    if (!b) return;
    const parent = new THREE.Quaternion();
    for (let p = b.parent; p && p !== this.look; p = p.parent) parent.premultiply(p.quaternion);
    const local = axis.clone().applyQuaternion(parent.invert());
    b.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(local, rad(degrees)));
  }
  pose() {
    for (const n in this.bones) this.bones[n].quaternion.copy(this.restPose[n]);
    this.look.rotation.x = -(this.stagger ?? 0);
    const w = this.walk, s = Math.sin(this.phase), c = Math.cos(this.phase), br = Math.sin(this.time * 1.6) * (1 - w * 0.6);
    this.bend('Spine', 1.5 * w + br * 0.5, X);
    this.bend('Chest', -br * 0.6, X);
    this.bend('Chest', -5 * s * w, Y);
    this.bend('Head', 4 * s * w + Math.sin(this.time * 0.4) * 5 * (1 - w), Y);
    for (const [k, a, b] of [['L', s, c], ['R', -s, -c]]) {
      const lift = Math.max(0, b);
      this.bend('UpperLeg' + k, (-a * 20 - lift * 5) * w, X);
      this.bend('LowerLeg' + k, (5 + lift * 34) * w, X);
      this.bend('Foot' + k, (a * 10 - lift * 14) * w, X);
      this.bend('UpperArm' + k, a * 24 * w + br * 0.8, X);
      this.bend('LowerArm' + k, -(8 + Math.max(0, -a) * 14) * w - 4, X);
    }
  }
}
