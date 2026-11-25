// VR 안에서 바꾸는 설정. 헤드셋에서 코드를 고치지 않고 맞추기 위한 것 (이 기기에 저장)
import { makePanel, sound } from './ui.js';

const KEY = 'kowloon-vr-settings';
export const settings = { height: 0, speed: 1.8, turn: 30, text: 1, table: 0, smooth: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 저장을 못 쓰는 창 */ }

const ITEMS = [
  { key: 'height', name: '키 높이', step: 0.05, min: -0.4, max: 0.6, show: v => `${v >= 0 ? '+' : ''}${Math.round(v * 100)} cm` },
  { key: 'speed', name: '걷는 속도', step: 0.2, min: 0.8, max: 3.2, show: v => v.toFixed(1) },
  { key: 'smooth', name: '스틱으로 걷기', step: 1, min: 0, max: 1, show: v => v ? '켜기' : '끄기 (순간이동만)' },
  { key: 'turn', name: '한 번에 도는 각도', step: 15, min: 15, max: 90, show: v => `${v}°` },
  { key: 'text', name: '글자 크기', step: 0.1, min: 0.7, max: 1.8, show: v => `${Math.round(v * 100)}%` },
  { key: 'table', name: '조립판 높이', step: 0.03, min: 0, max: 0.36, show: v => `+${Math.round(v * 100)} cm` },
];

export class SettingsPanel {
  constructor(onChange) {
    this.onChange = onChange;
    this.mesh = makePanel(0.36, 0.36, 640);
    this.mesh.visible = false;
    this.at = 0;
    this.ready = true;
    this.draw();
  }
  get open() { return this.mesh.visible; }
  toggle() { this.mesh.visible = !this.mesh.visible; this.draw(); sound('pick'); }
  /** 왼쪽 스틱: 위아래 = 고르기, 좌우 = 바꾸기 */
  stick(x, y) {
    if (Math.hypot(x, y) < 0.4) { this.ready = true; return; }
    if (!this.ready || Math.hypot(x, y) < 0.7) return;
    this.ready = false;
    if (Math.abs(y) > Math.abs(x)) this.at = (this.at + (y > 0 ? 1 : ITEMS.length - 1)) % ITEMS.length;
    else {
      const i = ITEMS[this.at];
      settings[i.key] = Math.round(Math.min(i.max, Math.max(i.min, settings[i.key] + Math.sign(x) * i.step)) * 100) / 100;
      try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 저장 못 해도 이번에는 적용된다 */ }
      this.onChange();
    }
    sound('pick');
    this.draw();
  }
  draw() {
    this.mesh.userData.set([{ text: '설정', size: 46, bold: true },
      ...ITEMS.map((i, n) => ({ text: `${n === this.at ? '▶ ' : ''}${i.name}   ${i.show(settings[i.key])}`, size: 34, color: n === this.at ? '#ffd79a' : '#b8a98a' })),
      { text: '왼쪽 스틱으로 바꾸기 · X 닫기', size: 26, color: '#8f8169' }]);
  }
}
