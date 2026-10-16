import { describe, it, expect } from 'vitest';
import { PRESETS, cleanParams, presetById, type Params, type Preset } from '../src/presets';
import { sliceMesh, polyArea } from '../src/slicer';
import { buildToolpath } from '../src/toolpath';
import { meshVolume } from '../src/part';
import { CATALOG } from '../src/projects/catalog';
import { textLoops, normalizeText } from '../src/pixelfont';

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
    });
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
    for (const id of ['name-keychain', 'phone-stand', 'cookie-cutter', 'pencil-holder', 'gear-set']) expect(loadable).toContain(id);
    for (const p of CATALOG) if (p.preset?.params) {
      const pr = presetById(p.preset.id)!;
      const clean = cleanParams(pr, p.preset.params);
      for (const [k, v] of Object.entries(p.preset.params)) expect(clean[k], `${p.id}.${k}`).toEqual(v);
    }
  });
});
