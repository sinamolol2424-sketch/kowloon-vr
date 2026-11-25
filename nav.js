// 걸을 수 있는 바닥(NavMesh 삼각형)을 칸으로 바꾼 길찾기 + 벽 시야
import * as THREE from 'three';
const S = 0.3, X0 = -14, Z0 = -18, W = 84, H = 80;
export const FLOORS = [18, 21.6];

export class Nav {
  constructor(map) {
    this.grids = FLOORS.map(y => {
      const g = new Uint8Array(W * H);
      for (let i = 0; i + 2 < map.floor.length; i += 3) {
        const [a, b, c] = [map.floor[i], map.floor[i + 1], map.floor[i + 2]];
        if (Math.abs((a[1] + b[1] + c[1]) / 3 - y) > 0.5) continue;
        const cell = (v, o) => Math.floor((v - o) / S);
        const x1 = Math.max(0, cell(Math.min(a[0], b[0], c[0]), X0)), x2 = Math.min(W - 1, cell(Math.max(a[0], b[0], c[0]), X0));
        const z1 = Math.max(0, cell(Math.min(a[2], b[2], c[2]), Z0)), z2 = Math.min(H - 1, cell(Math.max(a[2], b[2], c[2]), Z0));
        const side = (p, q, x, z) => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
        for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
          const px = X0 + (x + 0.5) * S, pz = Z0 + (z + 0.5) * S;
          const r = [side(a, b, px, pz), side(b, c, px, pz), side(c, a, px, pz)];
          if (r.every(v => v >= -1e-6) || r.every(v => v <= 1e-6)) g[z * W + x] = 1;
        }
      }
      return g;
    });
    this.blocked = new Set();       // 닫힌 셔터가 막는 7층 칸
    this.walls = [];                // 7층 눈높이 벽 선분 [x1,z1,x2,z2]
  }
  static floor(y) { return y < 20 ? 0 : 1; }
  open(f, x, z) { return x >= 0 && z >= 0 && x < W && z < H && this.grids[f][z * W + x] === 1 && !(f === 1 && this.blocked.has(z * W + x)); }
  cell(p) { return [Math.floor((p.x - X0) / S), Math.floor((p.z - Z0) / S)]; }
  /** 선분 가까이의 칸 (셔터) */
  cellsNear(a, b, r) {
    const out = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const px = X0 + (x + 0.5) * S, pz = Z0 + (z + 0.5) * S, dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(px - a.x - dx * t, pz - a.z - dz * t) < r) out.push(z * W + x);
    }
    return out;
  }
  nearest(f, p, reach = 5) {
    const [cx, cz] = this.cell(p);
    for (let r = 0; r <= reach; r++) {
      let best = null, d = 1e9;
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++)
        if (this.open(f, x, z) && Math.hypot(x - cx, z - cz) < d) { d = Math.hypot(x - cx, z - cz); best = [x, z]; }
      if (best) return best;
    }
    return null;
  }
  /** 같은 층 길. 없으면 null */
  path(from, to) {
    const f = Nav.floor(from.y);
    const s = this.nearest(f, from), e = this.nearest(f, to);
    if (!s || !e) return null;
    const id = (x, z) => z * W + x, start = id(...s), goal = id(...e);
    const cost = new Float32Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
    const heap = [];
    const push = (k, v) => { heap.push([k, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const t = heap[0], l = heap.pop(); if (heap.length) { heap[0] = l; let i = 0; for (;;) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[i][0] <= heap[c][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return t[1]; };
    cost[start] = 0;
    push(0, start);
    while (heap.length) {
      const n = pop();
      if (n === goal) break;
      if (done[n]) continue;
      done[n] = 1;
      const x = n % W, z = (n - x) / W;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz || !this.open(f, x + dx, z + dz) || dx && dz && (!this.open(f, x + dx, z) || !this.open(f, x, z + dz))) continue;
        const m = id(x + dx, z + dz), c = cost[n] + Math.hypot(dx, dz);
        if (c >= cost[m]) continue;
        cost[m] = c;
        came[m] = n;
        push(c + Math.hypot(x + dx - e[0], z + dz - e[1]), m);
      }
    }
    if (cost[goal] === Infinity) return null;
    const cells = [];
    for (let n = goal; n !== -1; n = came[n]) cells.push([n % W, (n - n % W) / W]);
    cells.reverse();
    const pts = [cells[0]];                         // 곧장 갈 수 있는 칸은 건너뛴다
    for (let i = 0; i < cells.length - 1;) {
      let j = cells.length - 1;
      while (j > i + 1 && !this.clear(f, cells[i], cells[j])) j--;
      pts.push(cells[j]);
      i = j;
    }
    return pts.map(([x, z]) => new THREE.Vector3(X0 + (x + 0.5) * S, FLOORS[f] - 0.02, Z0 + (z + 0.5) * S));
  }
  clear(f, a, b) {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3);
    for (let i = 0; i <= n; i++) if (!this.open(f, Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n))) return false;
    return true;
  }
  static length(p) { let s = 0; for (let i = 1; i < p.length; i++) s += p[i].distanceTo(p[i - 1]); return s; }

  /** 벽 메시를 눈높이에서 잘라 선분으로 (유리창은 벽에 구멍이라 저절로 통과) */
  addWalls(mesh, y) {
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, v = [0, 1, 2].map(() => new THREE.Vector3());
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
      const hit = [];
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        if ((a.y - y) * (b.y - y) >= 0) continue;
        const t = (y - a.y) / (b.y - a.y);
        hit.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]);
      }
      if (hit.length === 2 && Math.hypot(hit[0][0] - hit[1][0], hit[0][1] - hit[1][1]) > 0.01) this.walls.push([...hit[0], ...hit[1]]);
    }
  }
  /** 벽에 막히기까지의 비율 (1 = 안 막힘) */
  cast(x1, z1, x2, z2, extra = []) {
    let best = 1;
    const dx = x2 - x1, dz = z2 - z1;
    for (const list of [this.walls, extra]) for (const w of list) {
      const ex = w[2] - w[0], ez = w[3] - w[1], den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((w[0] - x1) * ez - (w[1] - z1) * ex) / den, u = ((w[0] - x1) * dz - (w[1] - z1) * dx) / den;
      if (t > 0 && t < best && u >= -0.002 && u <= 1.002) best = t;
    }
    return best;
  }
}
