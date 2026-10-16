// Step 4: an animated CoreXY-style printer following the toolpath.
// The bead is ONE InstancedMesh preallocated for every extrusion move; playback only changes
// `count` and rewrites the single partially-printed instance (addUpdateRange), so nothing is
// allocated per frame.
import * as THREE from 'three';
import { MOVE_TRAVEL, SPEEDS, type Toolpath } from './toolpath';
import { disposeTree, makeBed } from './stage';
import type { Hum } from './audio';

export const TIP_Y = 40; // world height of the nozzle tip (the bed moves down instead)
const FRAME = 64;
const BEAD_COLORS = [0x000000, 0xff7a33, 0xff9a52, 0xf2c14e, 0xffb36b];

export class PrintSim {
  readonly group = new THREE.Group();
  private bedGroup = new THREE.Group();
  private bead: THREE.InstancedMesh;
  private beadMat: THREE.MeshStandardMaterial;
  private ghostMat: THREE.MeshStandardMaterial;
  private head = new THREE.Group();
  private beam: THREE.Mesh;
  private carriage: THREE.Mesh;
  private glow: THREE.Mesh;
  private ghost: THREE.Mesh;
  private clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
  t = 0;
  playing = false;
  speed = 20;
  private seg = 0;
  private partial = -1;
  private lastHumSeg = -1;
  // scratch (no per-frame allocation)
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private tp: Toolpath, partGeo: THREE.BufferGeometry) {
    this.group.add(this.bedGroup);
    this.bedGroup.add(makeBed());
    // ghost of the final part
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0xbfd6ea, transparent: true, opacity: 0.12, depthWrite: false });
    this.ghost = new THREE.Mesh(partGeo, this.ghostMat);
    this.bedGroup.add(this.ghost);
    // bead
    const unit = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true); // 12 tris per bead segment
    unit.rotateZ(Math.PI / 2); // axis along +X
    this.beadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
    this.bead = new THREE.InstancedMesh(unit, this.beadMat, Math.max(1, tp.extCount));
    this.bead.frustumCulled = false;
    const col = new THREE.Color();
    for (let e = 0; e < tp.extCount; e++) {
      this.writeMatrix(e, 1);
      const mi = tp.extSeg[e];
      col.setHex(BEAD_COLORS[tp.type[mi]]).multiplyScalar(tp.layer[mi] % 2 ? 0.9 : 1);
      this.bead.setColorAt(e, col);
    }
    this.bead.instanceMatrix.needsUpdate = true;
    if (this.bead.instanceColor) this.bead.instanceColor.needsUpdate = true;
    this.bead.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bead.count = 0;
    this.bedGroup.add(this.bead);
    this.buildPrinter();
    this.beam = this.group.getObjectByName('beam') as THREE.Mesh;
    this.carriage = this.group.getObjectByName('carriage') as THREE.Mesh;
    this.glow = this.head.getObjectByName('glow') as THREE.Mesh;
    this.apply();
  }

  private buildPrinter() {
    const alu = new THREE.MeshStandardMaterial({ color: 0x2b333c, roughness: 0.45, metalness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 0.6, metalness: 0.3 });
    const top = TIP_Y + 26;
    for (const x of [-FRAME, FRAME]) for (const z of [-FRAME, FRAME]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(4, top + 110, 4), alu); // tall enough for a 100 mm part
      post.position.set(x, (top - 110) / 2, z);
      this.group.add(post);
    }
    for (const x of [-FRAME, FRAME]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4, 4, FRAME * 2 + 4), alu);
      rail.position.set(x, top - 4, 0);
      this.group.add(rail);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(FRAME * 2, 4, 6), black);
    beam.name = 'beam';
    beam.position.y = top - 4;
    this.group.add(beam);
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 10), black);
    carriage.name = 'carriage';
    carriage.position.y = top - 4;
    this.group.add(carriage);
    // hotend hangs from the carriage; its origin is the nozzle tip
    const sink = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 12, 16), new THREE.MeshStandardMaterial({ color: 0xb8c2cc, roughness: 0.3, metalness: 0.9 }));
    sink.position.y = 13;
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 14, 10), new THREE.MeshStandardMaterial({ color: 0x8a949e, roughness: 0.3, metalness: 0.9 }));
    throat.position.y = 13;
    const block = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 8), new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.8 }));
    block.position.y = 5;
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 16).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xd7b25a, roughness: 0.3, metalness: 0.9 }));
    nozzle.position.y = 1.3;
    const fan = new THREE.Mesh(new THREE.BoxGeometry(3, 10, 10), new THREE.MeshStandardMaterial({ color: 0x3fc7ff, roughness: 0.5 }));
    fan.position.set(-7, 9, 0);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
    glow.name = 'glow';
    const drop = TIP_Y + 26 - 4 - 19; // throat length to carriage
    const rod = new THREE.Mesh(new THREE.BoxGeometry(3, drop, 3), black);
    rod.position.y = 19 + drop / 2;
    this.head.add(sink, throat, block, nozzle, fan, glow, rod);
    this.group.add(this.head);
  }

  private writeMatrix(e: number, f: number) {
    const tp = this.tp, mi = tp.extSeg[e], o = mi * 4;
    const u0 = tp.seg[o], v0 = tp.seg[o + 1], u1 = tp.seg[o + 2], v1 = tp.seg[o + 3];
    const du = (u1 - u0) * f, dv = (v1 - v0) * f;
    const len = Math.hypot(du, dv);
    this.p.set(u0 + du / 2, (tp.layer[mi] + 0.5) * tp.layerHeight, v0 + dv / 2);
    this.q.setFromAxisAngle(this.up, Math.atan2(-dv, du));
    this.s.set(Math.max(len + tp.lineWidth * 0.4 * Math.min(1, f * 4), 1e-3), tp.layerHeight, tp.lineWidth);
    this.m4.compose(this.p, this.q, this.s);
    this.bead.setMatrixAt(e, this.m4);
  }

  private touch(e: number) {
    this.bead.instanceMatrix.addUpdateRange(e * 16, 16);
    this.bead.instanceMatrix.needsUpdate = true;
  }

  get done() { return this.t >= this.tp.time; }
  get progress() { return this.tp.time > 0 ? this.t / this.tp.time : 1; }
  get layer() { return this.tp.count ? this.tp.layer[this.seg] : 0; }

  setProgress(f: number) { this.t = Math.max(0, Math.min(1, f)) * this.tp.time; this.apply(); }
  restart() { this.t = 0; this.apply(); }

  setCutaway(on: boolean) {
    this.beadMat.clippingPlanes = on ? this.clip : null;
    this.ghostMat.clippingPlanes = on ? this.clip : null;
    this.beadMat.needsUpdate = true; this.ghostMat.needsUpdate = true;
  }

  update(dt: number, hum?: Hum) {
    if (this.playing) {
      this.t = Math.min(this.t + dt * this.speed, this.tp.time);
      if (this.t >= this.tp.time) this.playing = false;
    }
    this.apply();
    if (hum) {
      if (!this.playing) hum.stop();
      else if (this.seg !== this.lastHumSeg) {
        this.lastHumSeg = this.seg;
        const ty = this.tp.type[this.seg], o = this.seg * 4;
        const horiz = Math.abs(this.tp.seg[o + 2] - this.tp.seg[o]) > Math.abs(this.tp.seg[o + 3] - this.tp.seg[o + 1]) ? 1 : 0;
        hum.set(true, Math.min(1, (SPEEDS[ty] / 150) * Math.min(1, this.speed / 10)) * 0.8 + horiz * 0.2);
      }
    }
  }

  private apply() {
    const tp = this.tp;
    if (!tp.count) return;
    while (this.seg < tp.count - 1 && tp.tEnd[this.seg] < this.t) this.seg++;
    while (this.seg > 0 && tp.tEnd[this.seg - 1] >= this.t) this.seg--;
    const s = this.seg, o = s * 4;
    const t0 = s > 0 ? tp.tEnd[s - 1] : 0;
    const f = this.t >= tp.time ? 1 : Math.max(0, Math.min(1, (this.t - t0) / Math.max(1e-9, tp.tEnd[s] - t0)));
    const ext = tp.type[s] !== MOVE_TRAVEL;
    const partial = ext && f < 1 ? tp.extBefore[s] : -1;
    if (partial !== this.partial) {
      if (this.partial >= 0) { this.writeMatrix(this.partial, 1); this.touch(this.partial); }
      this.partial = partial;
    }
    if (partial >= 0) { this.writeMatrix(partial, f); this.touch(partial); }
    this.bead.count = this.t <= 0 ? 0 : tp.extBefore[s] + (ext ? 1 : 0);
    const u = tp.seg[o] + (tp.seg[o + 2] - tp.seg[o]) * f;
    const v = tp.seg[o + 1] + (tp.seg[o + 3] - tp.seg[o + 1]) * f;
    this.head.position.set(u, TIP_Y, v);
    this.beam.position.z = v;
    this.carriage.position.set(u, this.carriage.position.y, v);
    this.bedGroup.position.y = TIP_Y - (tp.layer[s] + 1) * tp.layerHeight;
    this.glow.visible = ext && this.playing;
  }

  dispose() {
    this.ghost.removeFromParent(); // shares the part geometry, owned by the app
    this.ghostMat.dispose();
    disposeTree(this.group);
  }
}
