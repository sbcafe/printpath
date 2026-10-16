import './style.css';
import * as THREE from 'three';
import { Stage, makeBed } from './stage';
import { buildPart, clampParams, DEFAULT_PARAMS, maxHole, meshVolume, partHeight, type PartParams } from './part';
import { sliceMesh, type SliceResult } from './slicer';
import { buildToolpath, formatDuration, type Toolpath } from './toolpath';
import { StlView, pickFacets, asciiFacet, asciiSize, stlBlob, downloadBlob, FACET_COLORS, type Facet } from './stlview';
import { SliceView } from './sliceview';
import { PrintSim, TIP_Y } from './printer';
import { Hum } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const STEPS = [
  { name: 'Design', explain: 'Design: you build a part from simple solids (plate + boss − hole), the way CAD combines shapes.' },
  { name: 'STL', explain: 'STL: the printer never sees your design, only a list of flat triangles, each with an “outside” arrow (normal).' },
  { name: 'Slice', explain: 'Slice: the slicer cuts the triangles into thin layers and plans every nozzle move: walls, then infill.' },
  { name: 'Print', explain: 'Print: the printer follows that plan, melting plastic into a thin bead, one layer on top of the last.' },
];

const stage = new Stage($<HTMLCanvasElement>('#c'), $('#top'), $('#panel'));
const hum = new Hum();

// ---------- shared part state ----------
let params: PartParams = { ...DEFAULT_PARAMS };
const partMat = new THREE.MeshStandardMaterial({ color: 0xf07a35, roughness: 0.48, metalness: 0.0 });
const partMesh = new THREE.Mesh(new THREE.BufferGeometry(), partMat);
const bed = makeBed();
stage.scene.add(bed, partMesh);
let partVersion = 0;

const slice = { layerHeight: 0.2, infill: 20, walls: 2, layer: 0, below: false };
let sliced: { key: string; sr: SliceResult; tp: Toolpath } | null = null;
let stlInfo: { version: number; ascii: number; facets: Facet[] } | null = null;

function rebuildPart() {
  params = clampParams(params);
  const g = buildPart(params);
  partMesh.geometry.dispose();
  partMesh.geometry = g;
  partVersion++;
  sliced = null; stlInfo = null;
  const vol = meshVolume(g) / 1000; // cm^3
  $('#design-stat').textContent = `${params.width} × ${params.depth} × ${partHeight(params)} mm · ${vol.toFixed(1)} cm³ · ≈${(vol * 1.24).toFixed(0)} g PLA if solid`;
}

function ensureSliced(): { sr: SliceResult; tp: Toolpath } {
  const key = `${partVersion}|${slice.layerHeight}|${slice.infill}|${slice.walls}`;
  if (sliced?.key === key) return sliced;
  const sr = sliceMesh(partMesh.geometry.attributes.position.array, {
    layerHeight: slice.layerHeight, lineWidth: 0.45, walls: slice.walls, infill: slice.infill, solidBottom: 2, solidTop: 2,
  });
  sliced = { key, sr, tp: buildToolpath(sr) };
  return sliced;
}

function framePart(scale = 1, yBias = 0) {
  const s = partMesh.geometry.boundingSphere!;
  stage.frame(s.center.x, s.center.y + yBias, s.center.z, s.radius * scale);
}

// ---------- step views ----------
interface View { enter(): void; exit(): void; update?(dt: number): void }
let stlView: StlView | null = null;
let sliceView: SliceView | null = null;
let sim: PrintSim | null = null;

const designView: View = {
  enter() { partMesh.visible = true; bed.visible = true; framePart(1.05); },
  exit() {},
};

const stlViewCtl: View = {
  enter() {
    partMesh.visible = true; bed.visible = true;
    const g = partMesh.geometry;
    const tris = g.attributes.position.count / 3;
    if (!stlInfo || stlInfo.version !== partVersion) {
      const holeR = params.hole / 2, bossR = params.boss ? params.hole / 2 + 3 : 0;
      stlInfo = { version: partVersion, ascii: asciiSize(g), facets: pickFacets(g, holeR, bossR) };
    }
    stlView = new StlView(g, stlInfo.facets);
    stlView.setWire($<HTMLInputElement>('#stl-wire').checked);
    stage.scene.add(stlView.group);
    $('#stl-tris').textContent = tris.toLocaleString();
    $('#stl-bin').textContent = kb(84 + 50 * tris);
    $('#stl-ascii').textContent = `${kb(stlInfo.ascii)} (${(stlInfo.ascii / (84 + 50 * tris)).toFixed(1)}×)`;
    const tabs = $('#stl-facets');
    tabs.innerHTML = '';
    stlInfo.facets.forEach((f, i) => {
      const b = document.createElement('button');
      b.innerHTML = `<i style="background:#${FACET_COLORS[i % FACET_COLORS.length].toString(16).padStart(6, '0')}"></i>${f.label}`;
      b.onclick = () => showFacet(i);
      tabs.appendChild(b);
    });
    showFacet(0);
    framePart(1.1);
  },
  exit() { stlView?.dispose(); stlView = null; },
};
function showFacet(i: number) {
  if (!stlInfo?.facets.length) { $('#stl-snippet').textContent = ''; return; }
  $('#stl-snippet').textContent = asciiFacet(stlInfo.facets[i]);
  [...$('#stl-facets').children].forEach((c, k) => c.classList.toggle('on', k === i));
}
const kb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const sliceViewCtl: View = {
  enter() {
    partMesh.visible = false; bed.visible = true;
    rebuildSliceView();
    framePart(1.05);
  },
  exit() { sliceView?.dispose(); sliceView = null; },
};
function rebuildSliceView() {
  sliceView?.dispose();
  const { sr, tp } = ensureSliced();
  sliceView = new SliceView(partMesh.geometry, sr, tp);
  stage.scene.add(sliceView.group);
  const n = sr.layers.length;
  const lr = $<HTMLInputElement>('#s-layer');
  lr.max = String(n);
  slice.layer = Math.min(slice.layer, n - 1);
  if (slice.layer < 0) slice.layer = Math.floor(n * 0.3);
  lr.value = String(slice.layer + 1);
  sliceView.setLayer(slice.layer, slice.below);
  syncOutputs();
  $('#sl-layers').textContent = String(n);
  $('#sl-len').textContent = `${(tp.extrudeLength / 1000).toFixed(1)} m`;
  $('#sl-time').textContent = `~${formatDuration(tp.time)}`;
}

const printViewCtl: View = {
  enter() {
    partMesh.visible = false; bed.visible = false;
    const { tp } = ensureSliced();
    sim = new PrintSim(tp, partMesh.geometry);
    sim.speed = Number($<HTMLInputElement>('#pr-speed').value);
    sim.setCutaway($<HTMLInputElement>('#pr-cut').checked);
    stage.scene.add(sim.group);
    const h = partHeight(params);
    const s = partMesh.geometry.boundingSphere!;
    stage.frame(0, TIP_Y - h * 0.5 + 4, 0, Math.max(s.radius * 1.75, 36));
    updatePrintHud();
  },
  exit() { sim?.dispose(); sim = null; hum.stop(); setPlayLabel(); },
  update() { updatePrintHud(); },
};
let hudLast = '';
function updatePrintHud() {
  if (!sim || !sliced) return;
  const pct = Math.floor(sim.progress * 100);
  const key = `${pct}|${sim.layer}|${Math.floor(sim.t)}|${sim.playing}`;
  if (key === hudLast) return;
  hudLast = key;
  $('#pr-bar').style.width = `${(sim.progress * 100).toFixed(1)}%`;
  $('#pr-layer').textContent = `${sim.layer + 1} / ${sliced.tp.layers}`;
  $('#pr-pct').textContent = sim.done ? 'Done ✓' : `${pct}%`;
  $('#pr-time').textContent = `${Math.round(sim.t / 60)} / ${formatDuration(sliced.tp.time)}`;
  setPlayLabel();
}
function setPlayLabel() {
  $('#pr-play').textContent = sim?.playing ? '❚❚ Pause' : sim?.done ? '✓ Done' : sim && sim.t > 0 ? '▶ Resume' : '▶ Print';
}

const views: View[] = [designView, stlViewCtl, sliceViewCtl, printViewCtl];
let step = -1;
function go(i: number) {
  i = Math.max(0, Math.min(3, i));
  if (i === step) return;
  if (step >= 0) views[step].exit();
  step = i;
  document.querySelectorAll<HTMLElement>('.pane').forEach((p) => (p.hidden = Number(p.dataset.pane) !== i));
  document.querySelectorAll<HTMLButtonElement>('#stepper button').forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('done', k < i); });
  $('#explain').textContent = STEPS[i].explain;
  $('#stepno').textContent = `Step ${i + 1} of 4`;
  $<HTMLButtonElement>('#back').disabled = i === 0;
  $('#next').textContent = i === 3 ? '↺ New part' : `Next: ${STEPS[i + 1].name} ›`;
  stage.layout();
  views[i].enter();
}

// ---------- controls ----------
function syncOutputs() {
  document.querySelectorAll<HTMLOutputElement>('output[data-for]').forEach((o) => {
    const inp = document.getElementById(o.dataset.for!) as HTMLInputElement;
    const v = Number(inp.value);
    const id = inp.id;
    o.textContent = id === 's-infill' ? `${v}%` : id === 'pr-speed' ? `${v}×` : id === 's-layer' ? `${v} / ${inp.max}` : id === 's-lh' ? `${v.toFixed(2)} mm` : `${v} mm`;
  });
}
const bind = (id: string, get: () => number, set: (v: number) => void) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = String(get());
  el.addEventListener('input', () => { set(Number(el.value)); syncOutputs(); });
  return el;
};
let partTimer = 0;
const schedulePart = () => {
  cancelAnimationFrame(partTimer);
  partTimer = requestAnimationFrame(() => {
    rebuildPart();
    const hole = $<HTMLInputElement>('#p-hole');
    hole.max = String(maxHole(params));
    hole.value = String(params.hole);
    syncOutputs();
  });
};
(['width', 'depth', 'height', 'hole'] as const).forEach((k) => bind(`p-${k}`, () => params[k], (v) => { params = { ...params, [k]: v }; schedulePart(); }));
for (const k of ['boss', 'chamfer'] as const) {
  const el = $<HTMLInputElement>(`#p-${k}`);
  el.checked = params[k];
  el.addEventListener('change', () => { params = { ...params, [k]: el.checked }; schedulePart(); });
}
$<HTMLInputElement>('#stl-wire').addEventListener('change', (e) => stlView?.setWire((e.target as HTMLInputElement).checked));
$('#stl-dl').addEventListener('click', () => downloadBlob(stlBlob(partMesh.geometry, true), `printpath-part-${params.width}x${params.depth}.stl`));

let sliceTimer = 0;
const scheduleSlice = () => { clearTimeout(sliceTimer); sliceTimer = window.setTimeout(() => { if (step === 2) rebuildSliceView(); }, 120); };
bind('s-lh', () => slice.layerHeight, (v) => { slice.layerHeight = v; scheduleSlice(); });
bind('s-infill', () => slice.infill, (v) => { slice.infill = v; scheduleSlice(); });
bind('s-layer', () => slice.layer + 1, (v) => { slice.layer = v - 1; sliceView?.setLayer(slice.layer, slice.below); });
$<HTMLInputElement>('#s-below').addEventListener('change', (e) => { slice.below = (e.target as HTMLInputElement).checked; sliceView?.setLayer(slice.layer, slice.below); });
const wallBtns = document.querySelectorAll<HTMLButtonElement>('[data-walls]');
const syncWalls = () => wallBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.walls) === slice.walls));
wallBtns.forEach((b) => b.addEventListener('click', () => { slice.walls = Number(b.dataset.walls); syncWalls(); scheduleSlice(); }));
syncWalls();
slice.layer = -1;

bind('pr-speed', () => 25, (v) => { if (sim) sim.speed = v; });
$('#pr-play').addEventListener('click', () => {
  if (!sim) return;
  if (sim.done) sim.restart();
  sim.playing = !sim.playing;
  if ($<HTMLInputElement>('#pr-sound').checked) hum.start();
  hudLast = '';
  updatePrintHud();
});
$('#pr-restart').addEventListener('click', () => { if (sim) { sim.restart(); hudLast = ''; updatePrintHud(); } });
$<HTMLInputElement>('#pr-cut').addEventListener('change', (e) => sim?.setCutaway((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#pr-sound').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  hum.muted = !on;
  if (on) hum.start(); else hum.stop(); // AudioContext is created only inside this user gesture
});
hum.muted = true;

$('#back').addEventListener('click', () => go(step - 1));
$('#next').addEventListener('click', () => go(step === 3 ? 0 : step + 1));
document.querySelectorAll<HTMLButtonElement>('#stepper button').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.step))));

// ---------- loop ----------
rebuildPart();
$<HTMLInputElement>('#p-hole').max = String(maxHole(params));
syncOutputs();
const startStep = Number(new URLSearchParams(location.search).get('step') ?? 1) - 1;
go(Number.isFinite(startStep) ? startStep : 0);
stage.snap();
let last = performance.now();
stage.renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sim?.update(dt, hum);
  views[step].update?.(dt);
  stage.update(dt);
});

// test/screenshot hook
(window as unknown as { __pp: unknown }).__pp = {
  go, stage, get sim() { return sim; }, get sliced() { return sliced; }, params: () => params,
  setLayer: (i: number) => { slice.layer = i; $<HTMLInputElement>('#s-layer').value = String(i + 1); syncOutputs(); sliceView?.setLayer(i, slice.below); },
};
