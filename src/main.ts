import './style.css';
import * as THREE from 'three';
import { Stage, makeBed, disposeTree } from './stage';
import { meshVolume } from './part';
import { PRESETS, presetById, cleanParams, type Params, type Preset } from './presets';
import { DesignerControls } from './designer';
import { sliceMesh, type SliceResult } from './slicer';
import { buildToolpath, formatDuration, type Toolpath } from './toolpath';
import { StlView, pickFacets, asciiFacet, asciiSize, stlBlob, downloadBlob, FACET_COLORS, type Facet } from './stlview';
import { SliceView } from './sliceview';
import { PrintSim, TIP_Y } from './printer';
import { Hum } from './audio';
import { applyTheme, readTheme, palette, theme, COPY, type ThemeId } from './theme';
import { Favourites, browserStorage } from './projects/favourites';
import { PROJECT_IDS, type Project } from './projects/catalog';
import { ProjectsView } from './projects/view';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const STEP_NAMES = ['Design', 'STL', 'Slice', 'Print'];

applyTheme(readTheme());
const stage = new Stage($<HTMLCanvasElement>('#c'), $('#top'), $('#panel'));
stage.applyPalette();
const hum = new Hum();

// ---------- shared part state ----------
let preset: Preset = PRESETS[0];
let params: Params = { ...preset.defaults };
const partMat = new THREE.MeshStandardMaterial({ color: palette().part, roughness: 0.48, metalness: 0.0 });
const partMesh = new THREE.Mesh(new THREE.BufferGeometry(), partMat);
let bed = makeBed();
stage.scene.add(bed, partMesh);
let partVersion = 0;
let controls: DesignerControls | null = null;

const slice = { layerHeight: 0.2, infill: 20, walls: 2, layer: -1, below: false };
let sliced: { key: string; sr: SliceResult; tp: Toolpath } | null = null;
let stlInfo: { version: number; ascii: number; facets: Facet[] } | null = null;

function rebuildPart() {
  params = cleanParams(preset, params);
  const g = preset.build(params);
  partMesh.geometry.dispose(); // old preset/params geometry
  partMesh.geometry = g;
  partVersion++;
  sliced = null; stlInfo = null;
  const bb = g.boundingBox!, vol = meshVolume(g) / 1000;
  const d = (v: number) => Math.round(v * 10) / 10;
  $('#design-stat').textContent = `${d(bb.max.x - bb.min.x)} × ${d(bb.max.z - bb.min.z)} × ${d(bb.max.y)} mm · ${vol.toFixed(1)} cm³ · ≈${Math.max(1, Math.round(vol * 1.24))} g PLA if solid`;
  controls?.sync(params);
}

function setPreset(id: string, overrides: Params = {}) {
  const p = presetById(id) ?? PRESETS[0];
  preset = p;
  params = cleanParams(p, { ...p.defaults, ...overrides });
  $<HTMLSelectElement>('#d-preset').value = p.id;
  $('#design-note').textContent = p.note ?? '';
  controls = new DesignerControls($('#d-controls'), p, params, (key, value) => { params = { ...params, [key]: value }; schedulePart(); });
  slice.layer = -1;
  rebuildPart();
  if (step === 0) framePart(1.05);
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

function framePart(scale = 1) {
  const s = partMesh.geometry.boundingSphere!;
  stage.frame(s.center.x, s.center.y, s.center.z, s.radius * scale);
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

const kb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const stlViewCtl: View = {
  enter() {
    partMesh.visible = true; bed.visible = true;
    const g = partMesh.geometry;
    const tris = g.attributes.position.count / 3;
    if (!stlInfo || stlInfo.version !== partVersion) {
      const r = preset.radii?.(params) ?? { hole: 0, boss: 0 };
      stlInfo = { version: partVersion, ascii: asciiSize(g), facets: pickFacets(g, r.hole, r.boss) };
    }
    stlView = new StlView(g, stlInfo.facets);
    stlView.setWire($<HTMLInputElement>('#stl-wire').checked);
    stage.scene.add(stlView.group);
    $('#stl-tris').textContent = tris.toLocaleString();
    $('#stl-bin').textContent = kb(84 + 50 * tris);
    $('#stl-ascii').textContent = kb(stlInfo.ascii);
    $('#stl-ascii-cap').textContent = `ASCII STL (${(stlInfo.ascii / (84 + 50 * tris)).toFixed(1)}× bigger)`;
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

const sliceViewCtl: View = {
  enter() { partMesh.visible = false; bed.visible = true; rebuildSliceView(); framePart(1.05); },
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
  if (slice.layer < 0) slice.layer = Math.floor(n * 0.3);
  slice.layer = Math.min(slice.layer, n - 1);
  lr.value = String(slice.layer + 1);
  sliceView.setLayer(slice.layer, slice.below);
  syncOutputs();
  $('#sl-layers').textContent = String(n);
  $('#sl-len').textContent = `${(tp.extrudeLength / 1000).toFixed(1)} m`;
  $('#sl-time').textContent = `~${formatDuration(tp.time)}`;
}

let keepPrintT = -1;
const printViewCtl: View = {
  enter() {
    partMesh.visible = false; bed.visible = false;
    const { tp } = ensureSliced();
    sim = new PrintSim(tp, partMesh.geometry);
    sim.speed = Number($<HTMLInputElement>('#pr-speed').value);
    sim.setCutaway($<HTMLInputElement>('#pr-cut').checked);
    if (keepPrintT >= 0) { sim.t = Math.min(keepPrintT, tp.time); sim.update(0); keepPrintT = -1; }
    stage.scene.add(sim.group);
    const s = partMesh.geometry.boundingSphere!, h = partMesh.geometry.boundingBox!.max.y;
    stage.frame(0, TIP_Y - h * 0.5 + 4, 0, Math.max(s.radius * 1.75, 36));
    hudLast = '';
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
function setCopy() {
  const c = COPY[theme()];
  $('#explain').textContent = c.explain[step] ?? '';
  const tip = c.tips?.[step];
  $('#tip').innerHTML = tip ? `<span aria-hidden="true">💡</span> <b>Teacher tip:</b> ${tip}` : '';
}
function go(i: number) {
  i = Math.max(0, Math.min(3, i));
  if (i === step) return;
  if (step >= 0) views[step].exit();
  step = i;
  document.querySelectorAll<HTMLElement>('.pane').forEach((p) => (p.hidden = Number(p.dataset.pane) !== i));
  document.querySelectorAll<HTMLButtonElement>('#stepper button').forEach((b, k) => {
    b.classList.toggle('on', k === i); b.classList.toggle('done', k < i);
    if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  setCopy();
  $('#stepno').textContent = `Step ${i + 1} of 4`;
  $<HTMLButtonElement>('#back').disabled = i === 0;
  $('#next').textContent = i === 3 ? '↺ New part' : `Next: ${STEP_NAMES[i + 1]} ›`;
  stage.layout();
  views[i].enter();
}

// ---------- theme ----------
function setTheme(t: ThemeId) {
  applyTheme(t);
  document.querySelectorAll<HTMLButtonElement>('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)));
  stage.applyPalette();
  partMat.color.setHex(palette().part);
  // rebuild palette-dependent scene pieces (dispose the old ones)
  const vis = bed.visible;
  disposeTree(bed);
  bed = makeBed(); bed.visible = vis; stage.scene.add(bed);
  if (step >= 0) {
    if (step === 3 && sim) keepPrintT = sim.t;
    const wasPlaying = sim?.playing ?? false;
    views[step].exit();
    views[step].enter();
    if (sim && wasPlaying) sim.playing = true;
    setCopy();
  }
  requestAnimationFrame(stage.layout); // font sizes change the header/panel height
}
document.querySelectorAll<HTMLButtonElement>('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn as ThemeId)));

// ---------- controls ----------
function syncOutputs() {
  document.querySelectorAll<HTMLOutputElement>('output[data-for]').forEach((o) => {
    const inp = document.getElementById(o.dataset.for!) as HTMLInputElement;
    const v = Number(inp.value), id = inp.id;
    o.textContent = id === 's-infill' ? `${v}%` : id === 'pr-speed' ? `${v}×` : id === 's-layer' ? `${v} / ${inp.max}` : id === 's-lh' ? `${v.toFixed(2)} mm` : `${v} mm`;
  });
}
const bind = (id: string, get: () => number, set: (v: number) => void) => {
  const el = document.getElementById(id) as HTMLInputElement;
  el.value = String(get());
  el.addEventListener('input', () => { set(Number(el.value)); syncOutputs(); });
};
let partTimer = 0;
const schedulePart = () => { cancelAnimationFrame(partTimer); partTimer = requestAnimationFrame(() => rebuildPart()); };

const presetSel = $<HTMLSelectElement>('#d-preset');
presetSel.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('');
presetSel.addEventListener('change', () => setPreset(presetSel.value));

$<HTMLInputElement>('#stl-wire').addEventListener('change', (e) => stlView?.setWire((e.target as HTMLInputElement).checked));
$('#stl-dl').addEventListener('click', () => downloadBlob(stlBlob(partMesh.geometry, true), `printpath-${preset.id}.stl`));

let sliceTimer = 0;
const scheduleSlice = () => { clearTimeout(sliceTimer); sliceTimer = window.setTimeout(() => { if (step === 2) rebuildSliceView(); }, 120); };
bind('s-lh', () => slice.layerHeight, (v) => { slice.layerHeight = v; scheduleSlice(); });
bind('s-infill', () => slice.infill, (v) => { slice.infill = v; scheduleSlice(); });
bind('s-layer', () => 1, (v) => { slice.layer = v - 1; sliceView?.setLayer(slice.layer, slice.below); });
$<HTMLInputElement>('#s-below').addEventListener('change', (e) => { slice.below = (e.target as HTMLInputElement).checked; sliceView?.setLayer(slice.layer, slice.below); });
const wallBtns = document.querySelectorAll<HTMLButtonElement>('[data-walls]');
const syncWalls = () => wallBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.walls) === slice.walls));
wallBtns.forEach((b) => b.addEventListener('click', () => { slice.walls = Number(b.dataset.walls); syncWalls(); scheduleSlice(); }));
syncWalls();

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

// ---------- projects + favourites ----------
const favourites = new Favourites(browserStorage(), PROJECT_IDS);
const loadProject = (p: Project) => {
  if (!p.preset) return;
  setPreset(p.preset.id, p.preset.params ?? {});
  if (step !== 0) go(0); else framePart(1.05);
};
const projects = new ProjectsView($('#projects'), favourites, loadProject);
$('#open-projects').addEventListener('click', () => projects.open());

// ---------- start ----------
const q = new URLSearchParams(location.search);
setPreset(q.get('preset') ?? 'plate');
document.querySelectorAll<HTMLButtonElement>('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === theme())));
syncOutputs();
const startStep = Number(q.get('step') ?? 1) - 1;
go(Number.isFinite(startStep) ? startStep : 0);
stage.snap();
if (q.get('projects') === '1') projects.open();
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
  go, stage, setTheme, setPreset, projects, favourites, loadProject,
  get sim() { return sim; }, get sliced() { return sliced; }, params: () => params, preset: () => preset.id,
  setLayer: (i: number) => { slice.layer = i; $<HTMLInputElement>('#s-layer').value = String(i + 1); syncOutputs(); sliceView?.setLayer(i, slice.below); },
};
