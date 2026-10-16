// Parametric part: rounded/chamfered plate + optional boss, minus a through hole (three-bvh-csg).
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';

export interface PartParams {
  width: number; // X, mm
  depth: number; // Z, mm
  height: number; // plate thickness, mm
  hole: number; // through-hole diameter, mm
  boss: boolean; // raised ring around the hole
  chamfer: boolean; // chamfer the four vertical corners
}

export const DEFAULT_PARAMS: PartParams = { width: 40, depth: 30, height: 6, hole: 8, boss: true, chamfer: true };
export const LIMITS = {
  width: [20, 80], depth: [20, 60], height: [3, 12], hole: [3, 16],
} as const;

const BOSS_WALL = 3;

/** Largest hole that still leaves material around it. */
export function maxHole(p: PartParams): number {
  const m = Math.min(p.width, p.depth);
  return Math.max(LIMITS.hole[0], Math.floor(p.boss ? m - 2 * BOSS_WALL - 8 : m - 8));
}

export function clampParams(p: PartParams): PartParams {
  return { ...p, hole: Math.min(p.hole, maxHole(p)) };
}

export function partHeight(p: PartParams): number {
  return p.height + (p.boss ? p.height : 0);
}

const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal'];
// note: the CDT splitter (useCDTClipping) gives fewer slivers but left the hole wall non-watertight in tests,
// which breaks slicing; the legacy splitter is watertight for this part.

function brush(g: THREE.BufferGeometry): Brush {
  // keep only what the evaluator needs, non-indexed for consistency
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  ng.deleteAttribute('uv');
  const b = new Brush(ng);
  b.updateMatrixWorld();
  return b;
}

export function buildPart(input: PartParams): THREE.BufferGeometry {
  const p = clampParams(input);
  const w = p.width / 2, d = p.depth / 2;
  const c = p.chamfer ? Math.min(4, Math.min(w, d) * 0.3) : 0;
  const s = new THREE.Shape();
  if (c > 0) {
    s.moveTo(-w + c, -d); s.lineTo(w - c, -d); s.lineTo(w, -d + c); s.lineTo(w, d - c);
    s.lineTo(w - c, d); s.lineTo(-w + c, d); s.lineTo(-w, d - c); s.lineTo(-w, -d + c);
  } else {
    s.moveTo(-w, -d); s.lineTo(w, -d); s.lineTo(w, d); s.lineTo(-w, d);
  }
  s.closePath();
  const plateG = new THREE.ExtrudeGeometry(s, { depth: p.height, bevelEnabled: false, steps: 1 });
  plateG.rotateX(-Math.PI / 2); // extrude along +Y, bottom at y = 0
  let result: Brush = brush(plateG);
  const total = partHeight(p);
  const toDispose: Brush[] = [result];
  if (p.boss) {
    const rb = p.hole / 2 + BOSS_WALL;
    const bh = p.height + 0.5; // overlaps the plate by 0.5 mm to avoid coplanar faces
    const bg = new THREE.CylinderGeometry(rb, rb, bh, 64);
    bg.translate(0, p.height - 0.5 + bh / 2, 0);
    const bossB = brush(bg);
    toDispose.push(bossB);
    result = evaluator.evaluate(result, bossB, ADDITION);
    toDispose.push(result);
  }
  const hg = new THREE.CylinderGeometry(p.hole / 2, p.hole / 2, total + 2, 48);
  hg.translate(0, total / 2, 0);
  const holeB = brush(hg);
  toDispose.push(holeB);
  const out = evaluator.evaluate(result, holeB, SUBTRACTION);
  const geo = out.geometry;
  // the result brush owns the geometry we return; dispose all intermediates
  for (const b of toDispose) if (b.geometry !== geo) b.geometry.dispose();
  if (!geo.index) geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** Volume in mm^3 of a closed, non-indexed or indexed triangle mesh (divergence theorem). */
export function meshVolume(geo: THREE.BufferGeometry): number {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  let v = 0;
  const g = (i: number, k: number) => pos.getComponent(idx ? idx.getX(i) : i, k);
  for (let i = 0; i < n; i += 3) {
    const ax = g(i, 0), ay = g(i, 1), az = g(i, 2);
    const bx = g(i + 1, 0), by = g(i + 1, 1), bz = g(i + 1, 2);
    const cx = g(i + 2, 0), cy = g(i + 2, 1), cz = g(i + 2, 2);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v / 6);
}
