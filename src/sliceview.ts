// Step 3: stacked contours + per-layer toolpath inspected with drawRange (no rebuild on scrub).
import * as THREE from 'three';
import type { SliceResult } from './slicer';
import { MOVE_TRAVEL, type Toolpath } from './toolpath';
import { disposeTree } from './stage';

export const PATH_COLORS = [0x4a5562, 0xff7a33, 0xffb36b, 0x3fc7ff, 0x8fe6ff]; // travel, outer, inner, infill, solid

export class SliceView {
  readonly group = new THREE.Group();
  private paths: THREE.LineSegments;
  private contours: THREE.LineSegments;
  private plane: THREE.Mesh;
  private ghost: THREE.Mesh;

  constructor(partGeo: THREE.BufferGeometry, private sr: SliceResult, private tp: Toolpath) {
    // ghost of the part (shares the part geometry; not disposed here)
    this.ghost = new THREE.Mesh(partGeo, new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.08, depthWrite: false }));
    // contour stack
    const cp: number[] = [], cc: number[] = [];
    const lo = new THREE.Color(0x245a73), hi = new THREE.Color(0x9ad7ee), col = new THREE.Color();
    const n = sr.layers.length;
    for (const L of sr.layers) {
      col.lerpColors(lo, hi, n > 1 ? L.index / (n - 1) : 0);
      for (const p of L.contours) {
        const m = p.length / 2;
        for (let i = 0; i < m; i++) {
          const j = (i + 1) % m;
          cp.push(p[i * 2], L.z, p[i * 2 + 1], p[j * 2], L.z, p[j * 2 + 1]);
          cc.push(col.r, col.g, col.b, col.r, col.g, col.b);
        }
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    this.contours = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
    // all moves, coloured by type; we pick a layer via drawRange
    const pp = new Float32Array(tp.count * 6), pc = new Float32Array(tp.count * 6);
    for (let i = 0; i < tp.count; i++) {
      const y = (tp.layer[i] + 0.5) * tp.layerHeight + 0.03;
      pp.set([tp.seg[i * 4], y, tp.seg[i * 4 + 1], tp.seg[i * 4 + 2], y, tp.seg[i * 4 + 3]], i * 6);
      col.setHex(PATH_COLORS[tp.type[i]]);
      if (tp.type[i] === MOVE_TRAVEL) col.multiplyScalar(0.8);
      pc.set([col.r, col.g, col.b, col.r, col.g, col.b], i * 6);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    this.paths = new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ vertexColors: true }));
    const bb = partGeo.boundingBox!;
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(bb.max.x - bb.min.x + 14, bb.max.z - bb.min.z + 14).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3fc7ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.group.add(this.ghost, this.contours, this.paths, this.plane);
  }

  /** Show layer i (0-based). cumulative = also show all toolpaths below. */
  setLayer(i: number, cumulative: boolean) {
    const tp = this.tp;
    const li = Math.max(0, Math.min(this.sr.layers.length - 1, i));
    const a = cumulative ? 0 : tp.layerStart[li], b = tp.layerStart[li + 1];
    this.paths.geometry.setDrawRange(a * 2, (b - a) * 2);
    this.plane.position.y = this.sr.layers[li].z;
  }

  dispose() {
    this.group.remove(this.ghost);
    (this.ghost.material as THREE.Material).dispose();
    disposeTree(this.group);
  }
}
