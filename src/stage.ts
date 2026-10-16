// Renderer, camera, controls, resize/DPR and the "visible area" view offset (so the model
// centres in the space between the header and the bottom/side panel).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  readonly controls: OrbitControls;
  private vis = { w: 1, h: 1 };
  private tweenT = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromTgt = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly toTgt = new THREE.Vector3();
  private readonly dir = new THREE.Vector3(0.85, 0.8, 1.25).normalize();
  private lastFit = { r: 30, tx: 0, ty: 0, tz: 0 };
  private env: THREE.Texture;

  constructor(canvas: HTMLCanvasElement, private header: HTMLElement, private panel: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
    this.scene.background = new THREE.Color(0x0e1319);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.env = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(60, 120, 80);
    this.scene.add(key, new THREE.HemisphereLight(0xcfe6ff, 0x1a1410, 0.5));
    this.camera.position.set(60, 55, 80);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 600;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('start', () => { this.tweenT = 1; });
    window.addEventListener('resize', this.layout);
    window.visualViewport?.addEventListener('resize', this.layout);
    new ResizeObserver(this.layout).observe(panel);
    new ResizeObserver(this.layout).observe(header);
    this.layout();
  }

  private isDesktop() { return window.matchMedia('(min-width: 900px) and (min-height: 560px)').matches; }

  readonly layout = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    const top = this.header.getBoundingClientRect().bottom;
    const pr = this.panel.getBoundingClientRect();
    let vx: number, vy: number, vw: number, vh: number;
    if (this.isDesktop()) { vx = 0; vy = top; vw = Math.max(200, pr.left); vh = h - top; }
    else { vx = 0; vy = top; vw = w; vh = Math.max(120, pr.top - top); }
    this.vis = { w: vw, h: vh };
    const dx = w / 2 - (vx + vw / 2), dy = h / 2 - (vy + vh / 2);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, dx, dy, w, h);
    this.camera.updateProjectionMatrix();
  };

  /** Ease the camera so a sphere (centre, radius) fills the visible area. */
  frame(tx: number, ty: number, tz: number, r: number, instant = false) {
    this.lastFit = { r, tx, ty, tz };
    const w = window.innerWidth, h = window.innerHeight;
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dH = (r / t) * (h / this.vis.h);
    const dW = (r / (t * this.camera.aspect)) * (w / this.vis.w);
    const dist = Math.max(dH, dW) * 1.08;
    this.fromPos.copy(this.camera.position);
    this.fromTgt.copy(this.controls.target);
    this.toTgt.set(tx, ty, tz);
    this.toPos.copy(this.dir).multiplyScalar(dist).add(this.toTgt);
    this.tweenT = instant ? 1 : 0;
    if (instant) { this.camera.position.copy(this.toPos); this.controls.target.copy(this.toTgt); }
  }

  /** Jump to the end of the current camera move. */
  snap() { this.tweenT = 1; this.camera.position.copy(this.toPos); this.controls.target.copy(this.toTgt); }

  refit() { const f = this.lastFit; this.frame(f.tx, f.ty, f.tz, f.r); }

  update(dt: number) {
    if (this.tweenT < 1) {
      this.tweenT = Math.min(1, this.tweenT + dt / 0.6);
      const e = 1 - Math.pow(1 - this.tweenT, 3);
      this.camera.position.lerpVectors(this.fromPos, this.toPos, e);
      this.controls.target.lerpVectors(this.fromTgt, this.toTgt, e);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/** Dispose every geometry/material under an object (textures we create are disposed by owners). */
export function disposeTree(root: THREE.Object3D, keep: Set<unknown> = new Set()) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => { if (!keep.has(x)) x.dispose(); });
    else if (mat && !keep.has(mat)) mat.dispose();
    const ih = o as THREE.InstancedMesh;
    if (ih.isInstancedMesh) ih.dispose();
  });
  root.removeFromParent();
}

/** A 120 x 120 mm build plate with a 10 mm grid. */
export function makeBed(size = 120): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(size, 2, size),
    new THREE.MeshStandardMaterial({ color: 0x1d252e, roughness: 0.7, metalness: 0.2 }),
  );
  plate.position.y = -1.02;
  const grid = new THREE.GridHelper(size, size / 10, 0x3fc7ff, 0x2c3a47);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  grid.position.y = 0.01;
  g.add(plate, grid);
  return g;
}
