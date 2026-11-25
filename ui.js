// 글자판(VR 안에서 보이는 글자)과 소리
import * as THREE from 'three';

const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

/** 여러 줄 글자를 그리는 판. set([{text,size,color}...]) */
export function makePanel(width, height, px = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = Math.round(px * height / width);
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  let last = '';
  mesh.userData.set = (lines, border = '#e9a94a') => {
    const key = JSON.stringify([lines, border]);
    if (key === last) return;
    last = key;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20,14,8,.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = border;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const total = lines.reduce((s, l) => s + l.size * 1.35, 0);
    let y = (canvas.height - total) / 2;
    for (const l of lines) {
      ctx.font = `${l.bold ? 'bold ' : ''}${l.size}px ${FONT}`;
      ctx.fillStyle = l.color || '#ffe6bf';
      ctx.fillText(l.text, canvas.width / 2, y + l.size * 0.67, canvas.width - 30);
      y += l.size * 1.35;
    }
    texture.needsUpdate = true;
  };
  return mesh;
}

let audio = null;
/** 짧은 소리. kind: snap 딸깍 / good 완성 / bad 실패 / pick 집기 */
export function sound(kind) {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const notes = { snap: [[900, 0, 0.05], [420, 0.03, 0.06]], pick: [[300, 0, 0.04]], good: [[520, 0, 0.12], [660, 0.12, 0.12], [880, 0.24, 0.25]], ring: [[1250, 0, 0.09], [980, 0.1, 0.09], [1250, 0.2, 0.09], [980, 0.3, 0.09], [1250, 0.4, 0.09], [980, 0.5, 0.12]], siren: [[620, 0, 0.35], [830, 0.35, 0.35], [620, 0.7, 0.35], [830, 1.05, 0.4]], bad: [[220, 0, 0.2], [160, 0.18, 0.3]] }[kind];
    for (const [f, at, len] of notes) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = kind === 'snap' ? 'square' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.12, audio.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + at + len);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + at);
      o.stop(audio.currentTime + at + len);
    }
  } catch { /* 소리를 못 내도 게임은 된다 */ }
}
