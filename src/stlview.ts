// Step 2: what an STL really is — triangles + normals. Wireframe, highlighted facets, sizes, download.
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { disposeTree } from './stage';
import { palette } from './theme';

const exporter = new STLExporter();

/** STL files are conventionally Z-up; three.js is Y-up. Returns a temporary Z-up mesh. */
function zUpMesh(geo: THREE.BufferGeometry): THREE.Mesh {
  const g = geo.clone();
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g);
}

export function stlBlob(geo: THREE.BufferGeometry, binary: boolean): Blob {
  const m = zUpMesh(geo);
  try {
    if (binary) {
      const dv = exporter.parse(m, { binary: true }) as DataView;
      return new Blob([new Uint8Array(dv.buffer as ArrayBuffer, dv.byteOffset, dv.byteLength)], { type: 'model/stl' });
    }
    return new Blob([exporter.parse(m, { binary: false }) as string], { type: 'model/stl' });
  } finally { m.geometry.dispose(); }
}

export function asciiSize(geo: THREE.BufferGeometry): number {
  const m = zUpMesh(geo);
  const s = exporter.parse(m, { binary: false }) as string;
  m.geometry.dispose();
  return s.length;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export interface Facet { normal: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; label: string }

/** Pick a few telling facets: top face, two sides, boss wall, hole wall. */
export function pickFacets(geo: THREE.BufferGeometry, holeR: number, bossR: number): Facet[] {
  const pos = geo.attributes.position;
  const n = pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  type Crit = { label: string; score: (nrm: THREE.Vector3, cen: THREE.Vector3, area: number) => number };
  const crits: Crit[] = [
    { label: 'top face', score: (m, _c, ar) => (m.y > 0.99 ? ar : -1) },
    { label: 'front side', score: (m, _c, ar) => (m.z > 0.99 ? ar : -1) },
    { label: 'right side', score: (m, _c, ar) => (m.x > 0.99 ? ar : -1) },
    { label: 'boss wall', score: (m, k) => { const r = Math.hypot(k.x, k.z); return bossR > 0 && Math.abs(m.y) < 0.05 && Math.abs(r - bossR) < 0.3 && m.x * k.x + m.z * k.z > 0 && k.z > 0 ? 1 + k.x * 0.01 : -1; } },
    { label: 'hole wall', score: (m, k) => { const r = Math.hypot(k.x, k.z); return Math.abs(m.y) < 0.05 && Math.abs(r - holeR) < 0.3 && m.x * k.x + m.z * k.z < 0 && k.z < 0 ? 1 + k.y * 0.01 : -1; } },
  ];
  const best = crits.map(() => ({ s: -1, i: -1 }));
  const cen = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
    nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const area = nn.length() / 2;
    if (area < 1e-6) continue;
    nn.normalize();
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    crits.forEach((k, ci) => { const s = k.score(nn, cen, area); if (s > best[ci].s) best[ci] = { s, i: t }; });
  }
  const out: Facet[] = [];
  best.forEach((bb, ci) => {
    if (bb.i < 0) return;
    const fa = new THREE.Vector3().fromBufferAttribute(pos, bb.i * 3);
    const fb = new THREE.Vector3().fromBufferAttribute(pos, bb.i * 3 + 1);
    const fc = new THREE.Vector3().fromBufferAttribute(pos, bb.i * 3 + 2);
    const normal = new THREE.Vector3().crossVectors(e1.subVectors(fb, fa), e2.subVectors(fc, fa)).normalize();
    out.push({ normal, a: fa, b: fb, c: fc, label: crits[ci].label });
  });
  return out;
}

const fmt = (v: number) => (Math.abs(v) < 5e-4 ? '0' : v.toFixed(2).replace(/\.?0+$/, ''));
/** The facet exactly as it appears in an ASCII STL (Z-up). */
export function asciiFacet(f: Facet): string {
  const z = (v: THREE.Vector3) => `${fmt(v.x)} ${fmt(-v.z)} ${fmt(v.y)}`;
  return `facet normal ${z(f.normal)}\n  outer loop\n    vertex ${z(f.a)}\n    vertex ${z(f.b)}\n    vertex ${z(f.c)}\n  endloop\nendfacet`;
}

export const FACET_COLORS = [0xff4fd8, 0xffe14f, 0x6dff8a, 0x4fd2ff, 0xff3b3b];

export class StlView {
  readonly group = new THREE.Group();
  private wire: THREE.LineSegments;

  constructor(geo: THREE.BufferGeometry, facets: Facet[]) {
    const wg = new THREE.WireframeGeometry(geo);
    this.wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: palette().wire, transparent: true, opacity: palette().wireOpacity }));
    this.group.add(this.wire);
    const fp: number[] = [], fc: number[] = [];
    const col = new THREE.Color();
    facets.forEach((f, i) => {
      // nudge along the normal so the highlight sits on the surface
      for (const v of [f.a, f.b, f.c]) fp.push(v.x + f.normal.x * 0.05, v.y + f.normal.y * 0.05, v.z + f.normal.z * 0.05);
      col.setHex(FACET_COLORS[i % FACET_COLORS.length]);
      for (let k = 0; k < 3; k++) fc.push(col.r, col.g, col.b);
      const cen = f.a.clone().add(f.b).add(f.c).multiplyScalar(1 / 3);
      const arrow = new THREE.ArrowHelper(f.normal, cen, 9, FACET_COLORS[i % FACET_COLORS.length], 2.2, 1.4);
      this.group.add(arrow);
    });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    const hm = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.group.add(hm);
  }

  setWire(on: boolean) { this.wire.visible = on; }

  dispose() {
    this.group.traverse((o) => { const ah = o as THREE.ArrowHelper; if ((ah as unknown as { type: string }).type === 'ArrowHelper') ah.dispose(); });
    disposeTree(this.group);
  }
}
