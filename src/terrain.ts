// Procedural terrain for the topographic-map preset: seeded value noise, no external data.
// buildTerrain() returns a closed, non-indexed triangle soup (top surface + 4 skirt walls + fan bottom).
import * as THREE from 'three';

/** Small deterministic PRNG-free hash: integer lattice point + seed -> [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = fade(x - x0), fy = fade(y - y0);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal (3 octave) noise, roughly in [0, 1): broad hills with a little detail. */
export function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 1013) * amp;
    norm += amp; amp *= 0.42; f *= 2.03;
  }
  return sum / norm;
}

export interface TerrainParams {
  seed: number;
  size: number; // tile edge, mm
  levels: number; // number of contour steps
  relief: number; // height of the landscape above the base, mm
  base: number; // solid base under the lowest point, mm
  terraced: boolean;
  island: boolean;
}

/** Normalised heights in [0, 1] on an (n+1) x (n+1) grid. */
export function heightGrid(p: TerrainParams, n: number): Float32Array {
  const g = new Float32Array((n + 1) * (n + 1));
  const freq = 1.3 + p.size / 70; // two or three hills per tile, a few more on big tiles
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = i / n, v = j / n;
    let h = fbm(u * freq + 17.3, v * freq + 5.1, p.seed);
    if (p.island) {
      const r = Math.hypot(u - 0.5, v - 0.5) / 0.5; // 0 centre, 1 edge midpoints
      h = h * 0.55 + 0.45 * Math.max(0, 1 - r * r); // a hill in the middle, falling to the shore
      h *= THREE.MathUtils.smoothstep(1.05 - r, 0, 0.35);
    }
    g[j * (n + 1) + i] = h;
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const span = hi - lo || 1;
  // the top 3 % becomes a small flat summit, so the highest print layer is a real island, not a single point
  for (let k = 0; k < g.length; k++) g[k] = Math.min(1, ((g[k] - lo) / span) * 1.03);
  return g;
}

/**
 * Classroom terraces: flat steps joined by steep risers. The steps tilt very slightly (6 % of a
 * step) so no flat face sits exactly on a slicing plane.
 */
export function terrace(h: number, levels: number, riser = 0.14): number {
  const v = h * levels;
  const k = Math.min(levels, Math.floor(v));
  const f = v - k;
  const tread = 0.06 * Math.min(1, f / (1 - riser));
  const rise = f <= 1 - riser ? 0 : THREE.MathUtils.smoothstep(f, 1 - riser, 1) * (1 - 0.06);
  return Math.min(1, (k + tread + rise) / levels);
}

/** Grid resolution for a tile: ~0.75 mm cells, capped for speed. */
export const terrainRes = (size: number) => Math.max(48, Math.min(128, Math.round(size / 0.75)));

export function buildTerrain(p: TerrainParams): THREE.BufferGeometry {
  const n = terrainRes(p.size), S = p.size, half = S / 2, step = S / n;
  const g = heightGrid(p, n);
  const H = new Float32Array(g.length);
  for (let k = 0; k < g.length; k++) H[k] = p.base + p.relief * (p.terraced ? terrace(g[k], p.levels) : g[k]);
  const X = (i: number) => -half + i * step, Z = (j: number) => -half + j * step;
  const at = (i: number, j: number) => H[j * (n + 1) + i];
  const tris = n * n * 2 + 4 * n * 2 + 4 * n;
  const pos = new Float32Array(tris * 9);
  let o = 0;
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
    pos[o++] = ax; pos[o++] = ay; pos[o++] = az; pos[o++] = bx; pos[o++] = by; pos[o++] = bz; pos[o++] = cx; pos[o++] = cy; pos[o++] = cz;
  };
  // top surface (normals +Y): (i,j) (i,j+1) (i+1,j) ordering faces up
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = X(i), x1 = X(i + 1), z0 = Z(j), z1 = Z(j + 1);
    const h00 = at(i, j), h10 = at(i + 1, j), h01 = at(i, j + 1), h11 = at(i + 1, j + 1);
    // split along the diagonal that follows the terrain better
    if (Math.abs(h00 - h11) < Math.abs(h10 - h01)) {
      tri(x0, h00, z0, x0, h01, z1, x1, h11, z1);
      tri(x0, h00, z0, x1, h11, z1, x1, h10, z0);
    } else {
      tri(x0, h00, z0, x0, h01, z1, x1, h10, z0);
      tri(x1, h10, z0, x0, h01, z1, x1, h11, z1);
    }
  }
  // border loop, walked so the skirt walls face outward and the bottom fan faces down
  const ring: [number, number, number][] = [];
  for (let i = 0; i < n; i++) ring.push([X(i), Z(0), at(i, 0)]);
  for (let j = 0; j < n; j++) ring.push([X(n), Z(j), at(n, j)]);
  for (let i = n; i > 0; i--) ring.push([X(i), Z(n), at(i, n)]);
  for (let j = n; j > 0; j--) ring.push([X(0), Z(j), at(0, j)]);
  ring.reverse();
  for (let k = 0; k < ring.length; k++) {
    const [ax, az, ah] = ring[k], [bx, bz, bh] = ring[(k + 1) % ring.length];
    // skirt wall from y = 0 up to the terrain edge, facing outward
    tri(ax, 0, az, bx, 0, bz, bx, bh, bz);
    tri(ax, 0, az, bx, bh, bz, ax, ah, az);
    // bottom fan to the centre, facing down
    tri(0, 0, 0, bx, 0, bz, ax, 0, az);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}
