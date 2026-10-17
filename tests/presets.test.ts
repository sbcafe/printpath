import { describe, it, expect } from 'vitest';
import { PRESETS, cleanParams, presetById, type Params, type Preset } from '../src/presets';
import { sliceMesh, polyArea } from '../src/slicer';
import { buildToolpath } from '../src/toolpath';
import { meshVolume } from '../src/part';
import { CATALOG } from '../src/projects/catalog';
import { textLoops, normalizeText } from '../src/pixelfont';
import { buildTerrain, heightGrid, type TerrainParams } from '../src/terrain';

/** Every directed edge must be matched by exactly one reverse edge (a strictly watertight, consistently wound mesh). */
function openEdges(a: ArrayLike<number>): number {
  const m = new Map<string, number>();
  const k = (o: number) => `${a[o].toFixed(4)},${a[o + 1].toFixed(4)},${a[o + 2].toFixed(4)}`;
  for (let t = 0; t < a.length / 9; t++) for (let e = 0; e < 3; e++) {
    const d = `${k(t * 9 + e * 3)}>${k(t * 9 + ((e + 1) % 3) * 3)}`;
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  let bad = 0;
  for (const [d, c] of m) { const [p, q] = d.split('>'); if (c !== 1 || m.get(`${q}>${p}`) !== 1) bad++; }
  return bad;
}

const settings = { lineWidth: 0.45, walls: 2, infill: 20, solidBottom: 2, solidTop: 2 };

/** defaults, every slider at min and at max, every choice option, every toggle flipped */
function variants(p: Preset): Params[] {
  const out: Params[] = [p.defaults];
  const sliders = p.controls.filter((c) => c.kind === 'slider');
  const lo: Params = { ...p.defaults }, hi: Params = { ...p.defaults };
  for (const c of sliders) if (c.kind === 'slider') { lo[c.key] = c.min; hi[c.key] = c.max; }
  out.push(lo, hi);
  for (const c of p.controls) {
    if (c.kind === 'choice') for (const [v] of c.options) out.push({ ...p.defaults, [c.key]: v }, { ...lo, [c.key]: v }, { ...hi, [c.key]: v });
    if (c.kind === 'toggle') out.push({ ...p.defaults, [c.key]: !p.defaults[c.key] }, { ...lo, [c.key]: !p.defaults[c.key] });
    if (c.kind === 'text') out.push({ ...p.defaults, [c.key]: 'WXYZ-08' }, { ...p.defaults, [c.key]: '' }, { ...hi, [c.key]: 'ABCD8OQR' });
  }
  return out.map((v) => cleanParams(p, v));
}

describe('designer presets', () => {
  for (const preset of PRESETS) {
    it(`${preset.id}: every variant slices to >= 1 closed outline per layer`, () => {
      for (const params of variants(preset)) {
        const geo = preset.build(params);
        const bb = geo.boundingBox!;
        const tag = `${preset.id} ${JSON.stringify(params)}`;
        expect(bb.min.y, tag).toBeCloseTo(0, 5);
        expect(Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), tag).toBeLessThanOrEqual(115); // fits the 120 mm bed
        expect(meshVolume(geo), tag).toBeGreaterThan(50);
        for (const lh of [0.2, 0.4]) {
          const r = sliceMesh(geo.attributes.position.array, { ...settings, layerHeight: lh });
          expect(r.layers.length, tag).toBeGreaterThanOrEqual(5);
          for (const L of r.layers) {
            expect(L.contours.length, `${tag} lh ${lh} layer ${L.index}`).toBeGreaterThanOrEqual(1);
            const outers = L.contours.filter((c) => polyArea(c) > 0).length;
            expect(outers, `${tag} lh ${lh} layer ${L.index}`).toBeGreaterThanOrEqual(1);
            for (const c of L.contours) expect(c.length).toBeGreaterThanOrEqual(6);
          }
          expect(buildToolpath(r).extCount, tag).toBeGreaterThan(0);
        }
        geo.dispose();
      }
    }, 120_000);
  }

  it('keychain with a name has letter outlines above the plate (holes in A/O/R kept)', () => {
    const p = presetById('keychain')!;
    const geo = p.build(cleanParams(p, { text: 'ROA', thickness: 3 }));
    const r = sliceMesh(geo.attributes.position.array, { ...settings, layerHeight: 0.2 });
    const top = r.layers[r.layers.length - 2];
    expect(top.contours.filter((c) => polyArea(c) > 0).length).toBe(3); // R, O, A
    expect(top.contours.filter((c) => polyArea(c) < 0).length).toBe(3); // their counters
    const plate = r.layers[3];
    expect(plate.contours.length).toBe(2); // tag + key-ring hole
  });

  it('cookie cutter and pencil holder are hollow (outer + inner loop on upper layers)', () => {
    for (const [id, shape] of [['cookie', 'star'], ['cookie', 'heart'], ['pencil', undefined]] as const) {
      const p = presetById(id)!;
      const geo = p.build(cleanParams(p, shape ? { shape } : {}));
      const r = sliceMesh(geo.attributes.position.array, { ...settings, layerHeight: 0.3 });
      const L = r.layers[r.layers.length - 5];
      expect(L.contours.map(polyArea).filter((a) => a < 0).length, id).toBe(1);
      expect(L.contours.map(polyArea).filter((a) => a > 0).length, id).toBe(1);
    }
  });

  it('DNA helix is one piece: two strands between rungs, joined at each rung, on a flat base disc', () => {
    const p = presetById('helix')!;
    const params = cleanParams(p, { height: 80, turns: 1.5, radius: 12, strand: 4, rungs: 6, post: false });
    const geo = p.build(params);
    const r = sliceMesh(geo.attributes.position.array, { ...settings, layerHeight: 0.2 });
    const outers = r.layers.map((L) => L.contours.filter((c) => polyArea(c) > 0).length);
    expect(outers[2]).toBe(1); // base disc
    expect(Math.abs(r.layers[0].area - Math.PI * (12 + 2 + 5) ** 2) / r.layers[0].area).toBeLessThan(0.01); // flat, full disc at the bottom
    expect(outers.filter((n) => n === 2).length).toBeGreaterThan(r.layers.length / 2); // mostly two separate strands...
    // ...but every rung joins them: the first rung (y = 3 + 2 + 1.2 = 6.2 mm) slices to a single outline
    expect(outers[Math.round(6.2 / 0.2)]).toBe(1);
    expect(Math.max(...outers)).toBe(2);
    expect(geo.boundingBox!.max.y).toBeCloseTo(80, 3); // flat top cut
    const post = p.build(cleanParams(p, { ...params, post: true }));
    const rp = sliceMesh(post.attributes.position.array, { ...settings, layerHeight: 0.2 });
    expect(Math.max(...rp.layers.map((L) => L.contours.filter((c) => polyArea(c) > 0).length))).toBe(3); // strands + post
    // turns are capped so neighbouring coils never touch
    expect(Number(cleanParams(p, { height: 40, strand: 6, turns: 3 }).turns)).toBeLessThanOrEqual((40 - 3) / 9);
    geo.dispose(); post.dispose();
  }, 60_000);

  it('topographic map: same seed gives the identical mesh, a new seed changes it', () => {
    const p = presetById('topo')!;
    const a = p.build(cleanParams(p, { seed: 123 })), b = p.build(cleanParams(p, { seed: 123 })), c = p.build(cleanParams(p, { seed: 124 }));
    const pa = a.attributes.position.array, pb = b.attributes.position.array, pc = c.attributes.position.array;
    expect(pa.length).toBe(pb.length);
    expect(Buffer.from(new Float32Array(pa).buffer).equals(Buffer.from(new Float32Array(pb).buffer))).toBe(true);
    expect(Buffer.from(new Float32Array(pa).buffer).equals(Buffer.from(new Float32Array(pc).buffer))).toBe(false);
    const tp: TerrainParams = { seed: 9, size: 60, levels: 5, relief: 10, base: 2, terraced: true, island: true };
    const g1 = heightGrid(tp, 32), g2 = heightGrid(tp, 32);
    expect(Array.from(g1)).toEqual(Array.from(g2));
    expect(Math.min(...g1)).toBe(0);
    expect(Math.max(...g1)).toBe(1);
    a.dispose(); b.dispose(); c.dispose();
  });

  it('topographic map is strictly watertight with a flat base, terraced or smooth', () => {
    for (const terraced of [true, false]) for (const island of [false, true]) {
      const geo = buildTerrain({ seed: 77, size: 50, levels: 7, relief: 12, base: 2, terraced, island });
      const a = geo.attributes.position.array;
      expect(openEdges(a), `terraced=${terraced} island=${island}`).toBe(0);
      expect(meshVolume(geo)).toBeGreaterThan(50 * 50 * 2);
      let low = 0;
      for (let i = 1; i < a.length; i += 3) { expect(a[i]).toBeGreaterThanOrEqual(0); if (a[i] < 2 - 1e-6) expect(a[i]).toBe(0); else low++; }
      expect(low).toBeGreaterThan(0);
      geo.dispose();
    }
  });

  it('terraced mode makes flat steps: most of the top surface is near-level, unlike smooth mode', () => {
    const flatShare = (terraced: boolean) => {
      const geo = buildTerrain({ seed: 5, size: 70, levels: 6, relief: 14, base: 2, terraced, island: false });
      const a = geo.attributes.position.array;
      let flat = 0, top = 0;
      for (let i = 0; i < a.length; i += 9) {
        const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2];
        const vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (ny / len < 0.2) continue; // walls and the bottom
        top++;
        if (ny / len > 0.995) flat++;
      }
      geo.dispose();
      return flat / top;
    };
    const terr = flatShare(true), smooth = flatShare(false);
    expect(terr).toBeGreaterThan(0.6);
    expect(terr).toBeGreaterThan(smooth + 0.2);
  });

  it('cleanParams clamps sliders, drops bad choices and normalises text', () => {
    const p = presetById('gear')!;
    const c = cleanParams(p, { teeth: 400, module: 3, bore: -2, hub: 'yes' as unknown as boolean, bogus: 1 });
    expect(c.teeth).toBe(40);
    expect(Number(c.module)).toBeLessThanOrEqual(110 / 42);
    expect(c.bore).toBe(3);
    expect(c.hub).toBe(true);
    expect('bogus' in c).toBe(false);
    const k = presetById('keychain')!;
    expect(cleanParams(k, { text: 'alex 2026 ♥ & more' }).text).toBe('ALEX 202');
    expect(cleanParams(presetById('solid')!, { shape: 'sphere' }).shape).toBe('pyramid');
  });

  it('pixel font traces closed, diagonal-free loops', () => {
    expect(normalizeText('Hi♥!')).toBe('HI*!');
    const { loops, cols, rows } = textLoops('XO');
    expect(cols).toBe(11);
    expect(rows).toBe(7);
    expect(loops.filter((l) => polyArea(l) > 0).length).toBe(2);
    expect(loops.filter((l) => polyArea(l) < 0).length).toBe(1);
  });
});

describe('projects catalog', () => {
  it('has 10–12 well-formed entries with unique ids', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(CATALOG.length).toBeLessThanOrEqual(12);
    expect(new Set(CATALOG.map((p) => p.id)).size).toBe(CATALOG.length);
    for (const p of CATALOG) {
      expect(p.grades.length, p.id).toBeGreaterThan(0);
      expect(p.subjects.length, p.id).toBeGreaterThan(0);
      const sentences = p.description.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      expect(sentences, p.id).toBeGreaterThanOrEqual(1);
      expect(sentences, p.id).toBeLessThanOrEqual(2);
      expect(JSON.stringify(p), p.id).not.toMatch(/https?:|www\.|\.com\b/i); // no external links
    }
  });

  it('every loadable project points at a real preset; the required ones are loadable', () => {
    for (const p of CATALOG) if (p.preset) expect(presetById(p.preset.id), p.id).toBeTruthy();
    const loadable = CATALOG.filter((p) => p.preset).map((p) => p.id);
    for (const id of ['name-keychain', 'phone-stand', 'cookie-cutter', 'pencil-holder', 'gear-set', 'dna-helix', 'topo-map']) expect(loadable).toContain(id);
    expect(CATALOG.find((p) => p.id === 'dna-helix')?.preset?.id).toBe('helix');
    expect(CATALOG.find((p) => p.id === 'topo-map')?.preset?.id).toBe('topo');
    for (const p of CATALOG) if (p.preset?.params) {
      const pr = presetById(p.preset.id)!;
      const clean = cleanParams(pr, p.preset.params);
      for (const [k, v] of Object.entries(p.preset.params)) expect(clean[k], `${p.id}.${k}`).toEqual(v);
    }
  });
});
