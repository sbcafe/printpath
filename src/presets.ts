// Small parametric presets for the designer (not a general CAD tool).
// Every builder returns a closed, non-indexed, Y-up mesh with its bottom at y = 0, centred in X/Z.
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, type CSGOperation } from 'three-bvh-csg';
import { buildPart, maxHole, type PartParams } from './part';
import { offsetPoly, polyArea, pointInPolys, simplify, type Poly } from './slicer';
import { textLoops, normalizeText } from './pixelfont';

export type PresetId = 'plate' | 'keychain' | 'cookie' | 'stand' | 'pencil' | 'gear' | 'solid';
export type Value = number | boolean | string;
export type Params = Record<string, Value>;
export type Control =
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step: number; unit?: string }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'choice'; key: string; label: string; options: [string, string][] }
  | { kind: 'text'; key: string; label: string; maxLength: number };

export interface Preset {
  id: PresetId;
  name: string;
  icon: string;
  controls: Control[];
  defaults: Params;
  /** dynamic slider maxima that depend on other params */
  limits?(p: Params): Record<string, number>;
  build(p: Params): THREE.BufferGeometry;
  /** hints for the STL facet picker */
  radii?(p: Params): { hole: number; boss: number };
  note?: string;
}

const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal'];

function brush(g: THREE.BufferGeometry): Brush {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
  const b = new Brush(ng);
  b.updateMatrixWorld();
  return b;
}

/** a op b, disposing both inputs' geometries. */
function csg(a: Brush, b: Brush, op: CSGOperation): Brush {
  const r = evaluator.evaluate(a, b, op);
  a.geometry.dispose();
  b.geometry.dispose();
  return r;
}

/** Non-indexed, normals, centred X/Z, bottom at 0, bounds computed. */
function finalize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

const v2 = (p: Poly) => { const o: THREE.Vector2[] = []; for (let i = 0; i < p.length; i += 2) o.push(new THREE.Vector2(p[i], p[i + 1])); return o; };
const reverse = (p: Poly): Poly => { const o: number[] = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; };
/** Grow a CCW loop outward by d (offset the reversed loop toward its left = outside). */
const grow = (p: Poly, d: number): Poly | null => { const o = offsetPoly(reverse(p), d); return o ? reverse(o) : null; };

/** Extrude a plan-view outline (x, y in the shape plane -> world x, -z) upward by h from y0. */
function extrudePlan(outer: Poly, holes: Poly[], h: number, y0 = 0, curveSegments = 12): THREE.BufferGeometry {
  const s = new THREE.Shape(v2(outer));
  for (const hl of holes) s.holes.push(new THREE.Path(v2(hl)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function circle(r: number, n = 64, cx = 0, cy = 0): Poly {
  const p: number[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  return p;
}

function roundedRect(w: number, h: number, r: number, seg = 8): Poly {
  const p: number[] = [];
  const cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= seg; i++) {
    const a = THREE.MathUtils.degToRad(a0 + (90 * i) / seg);
    p.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return simplify(p);
}

const num = (p: Params, k: string) => Number(p[k]);
const bool = (p: Params, k: string) => Boolean(p[k]);

// ---------------------------------------------------------------- outlines
export function starOutline(R: number, points = 5): Poly {
  const p: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 ? R * 0.5 : R;
    p.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return p;
}

export function heartOutline(size: number): Poly {
  // classic bezier heart (point at the bottom), normalised to `size` wide
  const s = new THREE.Shape();
  s.moveTo(25, 25);
  s.bezierCurveTo(25, 25, 20, 0, 0, 0);
  s.bezierCurveTo(-30, 0, -30, 35, -30, 35);
  s.bezierCurveTo(-30, 55, -10, 77, 25, 95);
  s.bezierCurveTo(60, 77, 80, 55, 80, 35);
  s.bezierCurveTo(80, 35, 80, 0, 50, 0);
  s.bezierCurveTo(35, 0, 25, 25, 25, 25);
  const pts = s.getSpacedPoints(160);
  const k = size / 110;
  let p: number[] = [];
  for (const q of pts) p.push((q.x - 25) * k, -(q.y - 47.5) * k); // flip so the point is at the bottom
  p = simplify(p, 1e-3);
  if (polyArea(p) < 0) p = reverse(p);
  return p;
}

function cutterOutline(shape: string, size: number): Poly {
  if (shape === 'star') return starOutline(size / 2);
  if (shape === 'heart') return heartOutline(size);
  return circle(size / 2, 96);
}

// ---------------------------------------------------------------- gear
export function gearOutline(teeth: number, module: number): Poly {
  const rp = (module * teeth) / 2, ra = rp + module, rr = rp - 1.25 * module;
  const a = (Math.PI * 2) / teeth;
  const p: number[] = [];
  const at = (r: number, t: number) => p.push(Math.cos(t) * r, Math.sin(t) * r);
  for (let i = 0; i < teeth; i++) {
    const c = i * a;
    at(rr, c - a * 0.3); at(ra, c - a * 0.12); at(ra, c + a * 0.12); at(rr, c + a * 0.3); at(rr, c + a * 0.5);
  }
  return p;
}

// ---------------------------------------------------------------- presets
export const PRESETS: Preset[] = [
  {
    id: 'plate', name: 'Mounting plate', icon: '🔩',
    controls: [
      { kind: 'slider', key: 'width', label: 'Width', min: 20, max: 80, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'depth', label: 'Depth', min: 20, max: 60, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'height', label: 'Height', min: 3, max: 12, step: 0.5, unit: 'mm' },
      { kind: 'slider', key: 'hole', label: 'Hole Ø', min: 3, max: 16, step: 0.5, unit: 'mm' },
      { kind: 'toggle', key: 'boss', label: 'Boss' },
      { kind: 'toggle', key: 'chamfer', label: 'Chamfer corners' },
    ],
    defaults: { width: 40, depth: 30, height: 6, hole: 8, boss: true, chamfer: true },
    limits: (p) => ({ hole: maxHole(p as unknown as PartParams) }),
    build: (p) => finalize(buildPart(p as unknown as PartParams)),
    radii: (p) => ({ hole: num(p, 'hole') / 2, boss: bool(p, 'boss') ? num(p, 'hole') / 2 + 3 : 0 }),
  },
  {
    id: 'keychain', name: 'Name keychain', icon: '🔑',
    controls: [
      { kind: 'text', key: 'text', label: 'Name', maxLength: 8 },
      { kind: 'slider', key: 'length', label: 'Length', min: 40, max: 80, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'width', label: 'Width', min: 16, max: 30, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'thickness', label: 'Thickness', min: 2, max: 5, step: 0.5, unit: 'mm' },
      { kind: 'toggle', key: 'raised', label: 'Raised name' },
    ],
    defaults: { text: 'SAM', length: 56, width: 20, thickness: 3, raised: true },
    note: 'Block letters A–Z, 0–9 and - ! ? . * (heart) from a built-in pixel font.',
    build: (p) => {
      const L = num(p, 'length'), W = num(p, 'width'), T = num(p, 'thickness');
      const holeR = 2.5, hx = -L / 2 + 3 + holeR;
      const plate = extrudePlan(roundedRect(L, W, Math.min(6, W / 3)), [reverse(circle(holeR, 32, hx, 0))], T);
      const text = normalizeText(String(p.text ?? ''), 8);
      if (!bool(p, 'raised') || !text.trim()) return finalize(plate);
      const { loops, cols, rows } = textLoops(text);
      if (!loops.length) return finalize(plate);
      const x0 = hx + holeR + 2.5, x1 = L / 2 - 3;
      const px = Math.min((x1 - x0) / cols, (W - 6) / rows, 2.4);
      const ox = (x0 + x1) / 2 - (cols * px) / 2, oy = -(rows * px) / 2;
      const sc = loops.map((l) => l.map((v, i) => (i % 2 ? oy + v * px : ox + v * px)));
      const outers = sc.filter((l) => polyArea(l) > 0), holes = sc.filter((l) => polyArea(l) < 0);
      const shapes = outers.map((o) => {
        const s = new THREE.Shape(v2(o));
        for (const h of holes) if (pointInPolys(h[0] + 1e-3, h[1] + 1e-3, [o])) s.holes.push(new THREE.Path(v2(h)));
        return s;
      });
      const tg = new THREE.ExtrudeGeometry(shapes, { depth: 1.5, bevelEnabled: false });
      tg.rotateX(-Math.PI / 2);
      tg.translate(0, T - 0.3, 0); // 0.3 mm overlap: a real union, no coplanar faces
      return finalize(csg(brush(plate), brush(tg), ADDITION).geometry);
    },
  },
  {
    id: 'cookie', name: 'Cookie cutter', icon: '🍪',
    controls: [
      { kind: 'choice', key: 'shape', label: 'Shape', options: [['circle', 'Circle'], ['star', 'Star'], ['heart', 'Heart']] },
      { kind: 'slider', key: 'size', label: 'Size', min: 40, max: 90, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'height', label: 'Height', min: 10, max: 20, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'wall', label: 'Blade', min: 1.2, max: 2.4, step: 0.1, unit: 'mm' },
      { kind: 'toggle', key: 'flange', label: 'Grip rim' },
    ],
    defaults: { shape: 'star', size: 70, height: 14, wall: 1.6, flange: true },
    build: (p) => {
      const O = cutterOutline(String(p.shape), num(p, 'size'));
      const wall = num(p, 'wall'), H = num(p, 'height');
      const I = offsetPoly(O, wall)!;
      const blade = extrudePlan(O, [I], H);
      if (!bool(p, 'flange')) return finalize(blade);
      const F = grow(O, 4)!, Fi = offsetPoly(O, wall / 2)!; // rim overlaps half the blade: no coplanar walls
      const rim = extrudePlan(F, [Fi], 2.2);
      return finalize(csg(brush(blade), brush(rim), ADDITION).geometry);
    },
  },
  {
    id: 'stand', name: 'Phone stand', icon: '📱',
    controls: [
      { kind: 'slider', key: 'width', label: 'Width', min: 50, max: 100, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'angle', label: 'Lean angle', min: 55, max: 75, step: 1, unit: '°' },
      { kind: 'slider', key: 'back', label: 'Back height', min: 50, max: 90, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'thickness', label: 'Thickness', min: 3, max: 6, step: 0.5, unit: 'mm' },
      { kind: 'slider', key: 'lip', label: 'Front lip', min: 6, max: 16, step: 1, unit: 'mm' },
    ],
    defaults: { width: 70, angle: 65, back: 70, thickness: 4, lip: 10 },
    build: (p) => {
      // side profile (x = depth, y = up), extruded across the width
      const T = num(p, 'thickness'), th = THREE.MathUtils.degToRad(num(p, 'angle')), Lr = num(p, 'back');
      const lip = Math.max(num(p, 'lip'), T + 2), g = 14;
      const A = [g, T], F = [g + Math.cos(th) * Lr, T + Math.sin(th) * Lr];
      const R = [F[0] + Math.sin(th) * T, F[1] - Math.cos(th) * T];
      const B = Math.max(R[0] + 14, g + 30);
      const prof: Poly = [0, 0, B, 0, B, T, R[0], R[1], F[0], F[1], A[0], A[1], T, T, T, lip, 0, lip];
      const s = new THREE.Shape(v2(prof));
      const geo = new THREE.ExtrudeGeometry(s, { depth: num(p, 'width'), bevelEnabled: false });
      geo.rotateY(Math.PI / 2); // depth -> -Z (front lip faces the camera), width -> X
      return finalize(geo);
    },
  },
  {
    id: 'pencil', name: 'Pencil holder', icon: '✏️',
    controls: [
      { kind: 'slider', key: 'diameter', label: 'Diameter', min: 50, max: 80, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'height', label: 'Height', min: 40, max: 100, step: 1, unit: 'mm' },
      { kind: 'slider', key: 'wall', label: 'Wall', min: 1.6, max: 4, step: 0.2, unit: 'mm' },
      { kind: 'toggle', key: 'hex', label: 'Hexagon' },
    ],
    defaults: { diameter: 64, height: 80, wall: 2.4, hex: true },
    build: (p) => {
      const R = num(p, 'diameter') / 2, H = num(p, 'height'), w = num(p, 'wall'), hex = bool(p, 'hex');
      const seg = hex ? 6 : 72, floor = 2.4;
      const ri = hex ? R - w / Math.cos(Math.PI / 6) : R - w;
      const outer = new THREE.CylinderGeometry(R, R, H, seg);
      outer.translate(0, H / 2, 0);
      const inner = new THREE.CylinderGeometry(ri, ri, H - floor + 2, seg);
      inner.translate(0, floor + (H - floor + 2) / 2, 0);
      return finalize(csg(brush(outer), brush(inner), SUBTRACTION).geometry);
    },
  },
  {
    id: 'gear', name: 'Spur gear', icon: '⚙️',
    controls: [
      { kind: 'slider', key: 'teeth', label: 'Teeth', min: 8, max: 40, step: 1 },
      { kind: 'slider', key: 'module', label: 'Tooth size', min: 1, max: 3, step: 0.25, unit: 'mm' },
      { kind: 'slider', key: 'thickness', label: 'Thickness', min: 3, max: 10, step: 0.5, unit: 'mm' },
      { kind: 'slider', key: 'bore', label: 'Axle hole', min: 3, max: 10, step: 0.5, unit: 'mm' },
      { kind: 'toggle', key: 'hub', label: 'Hub' },
    ],
    defaults: { teeth: 16, module: 2, thickness: 5, bore: 5, hub: true },
    note: 'Simplified trapezoid teeth (not a true involute profile).',
    limits: (p) => ({ module: Math.max(1, Math.floor((110 / (num(p, 'teeth') + 2)) * 4) / 4), bore: Math.max(3, Math.floor(((num(p, 'module') * num(p, 'teeth')) / 2 - 1.25 * num(p, 'module') - 4) * 2) / 2) }),
    build: (p) => {
      const n = num(p, 'teeth'), m = num(p, 'module'), T = num(p, 'thickness'), bore = num(p, 'bore');
      let b = brush(extrudePlan(gearOutline(n, m), [], T));
      if (bool(p, 'hub')) {
        const hr = Math.min(bore / 2 + 4, (m * n) / 2 - 1.25 * m - 1);
        const hub = new THREE.CylinderGeometry(hr, hr, 3.5, 48);
        hub.translate(0, T - 0.5 + 1.75, 0);
        b = csg(b, brush(hub), ADDITION);
      }
      const hole = new THREE.CylinderGeometry(bore / 2, bore / 2, T + 10, 40);
      hole.translate(0, (T + 3) / 2, 0);
      return finalize(csg(b, brush(hole), SUBTRACTION).geometry);
    },
    radii: (p) => ({ hole: num(p, 'bore') / 2, boss: 0 }),
  },
  {
    id: 'solid', name: 'Geometric solid', icon: '🔷',
    controls: [
      { kind: 'choice', key: 'shape', label: 'Solid', options: [['cube', 'Cube'], ['tri', 'Tri prism'], ['hex', 'Hex prism'], ['pyramid', 'Pyramid'], ['tetra', 'Tetra'], ['cylinder', 'Cylinder'], ['cone', 'Cone']] },
      { kind: 'slider', key: 'size', label: 'Size', min: 15, max: 50, step: 1, unit: 'mm' },
    ],
    defaults: { shape: 'pyramid', size: 30 },
    note: 'Pointed tips are flattened to 0.6 mm so the top layer still has an outline.',
    build: (p) => {
      const s = num(p, 'size'), r = s / 2, tip = 0.6;
      const k = String(p.shape);
      let g: THREE.BufferGeometry;
      if (k === 'cube') g = new THREE.BoxGeometry(s, s, s);
      else if (k === 'tri') g = new THREE.CylinderGeometry(r, r, s, 3);
      else if (k === 'hex') g = new THREE.CylinderGeometry(r, r, s * 0.8, 6);
      else if (k === 'pyramid') g = new THREE.CylinderGeometry(tip, r * Math.SQRT2, s * 0.8, 4, 1, false, Math.PI / 4);
      else if (k === 'tetra') g = new THREE.CylinderGeometry(tip, r, s * 0.8, 3);
      else if (k === 'cone') g = new THREE.CylinderGeometry(tip, r, s, 64);
      else g = new THREE.CylinderGeometry(r, r, s, 64);
      return finalize(g);
    },
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** Clamp to control ranges and dynamic limits; unknown keys dropped, missing ones defaulted. */
export function cleanParams(preset: Preset, input: Params): Params {
  const p: Params = { ...preset.defaults };
  for (const c of preset.controls) {
    const v = input[c.key];
    if (v === undefined) continue;
    if (c.kind === 'slider') { const n = Number(v); if (Number.isFinite(n)) p[c.key] = Math.min(c.max, Math.max(c.min, n)); }
    else if (c.kind === 'toggle') p[c.key] = Boolean(v);
    else if (c.kind === 'choice') { if (c.options.some(([o]) => o === v)) p[c.key] = String(v); }
    else p[c.key] = normalizeText(String(v), c.maxLength);
  }
  const lim = preset.limits?.(p) ?? {};
  for (const [k, max] of Object.entries(lim)) if (Number(p[k]) > max) p[k] = max;
  return p;
}
