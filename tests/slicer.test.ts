import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sliceMesh, layerCount, polyPerimeter, polyArea, pointInPolys, chainSegments, sliceSegments } from '../src/slicer';
import { buildToolpath } from '../src/toolpath';
import { buildPart, DEFAULT_PARAMS, meshVolume, maxHole, type PartParams } from '../src/part';

function cube(size: number): Float32Array {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  g.translate(0, size / 2, 0);
  return g.attributes.position.array as Float32Array;
}
const base = { lineWidth: 0.45, walls: 2, infill: 20, solidBottom: 0, solidTop: 0 };

describe('slicer', () => {
  it('a 20 mm cube sliced at h gives one square contour with perimeter 80', () => {
    const pos = cube(20);
    for (const h of [0.1, 5, 10.05, 19.9]) {
      const loops = chainSegments(sliceSegments(pos, pos.length / 9, h));
      expect(loops.length).toBe(1);
      expect(loops[0].length / 2).toBe(4); // collinear points simplified away
      expect(polyPerimeter(loops[0])).toBeCloseTo(80, 4);
      expect(polyArea(loops[0])).toBeCloseTo(400, 3); // CCW outer => positive area
    }
  });

  it('layer count = height / layerHeight', () => {
    const pos = cube(20);
    for (const lh of [0.1, 0.2, 0.25, 0.4]) {
      const r = sliceMesh(pos, { ...base, layerHeight: lh });
      expect(r.layers.length).toBe(Math.round(20 / lh));
      expect(r.layers.length).toBe(layerCount(20, lh));
    }
    expect(layerCount(10, 0.3)).toBe(33); // partial top layer is dropped
  });

  it('walls are inset and infill lines stay inside the contour', () => {
    const pos = cube(20);
    for (const infill of [10, 20, 50, 100]) {
      const r = sliceMesh(pos, { ...base, layerHeight: 0.2, infill });
      for (const L of [r.layers[3], r.layers[4], r.layers[50]]) {
        expect(L.walls.length).toBe(2);
        expect(polyPerimeter(L.walls[0][0])).toBeCloseTo(4 * (20 - 0.45), 3);
        expect(L.infill.length).toBeGreaterThan(0);
        for (let i = 0; i < L.infill.length; i += 2) {
          expect(pointInPolys(L.infill[i], L.infill[i + 1], L.contours)).toBe(true);
          expect(Math.abs(L.infill[i])).toBeLessThanOrEqual(10 - 2 * 0.45 + 0.1 + 1e-6);
          expect(Math.abs(L.infill[i + 1])).toBeLessThanOrEqual(10 - 2 * 0.45 + 0.1 + 1e-6);
        }
      }
      // direction alternates per layer (+45 / -45 degrees)
      const a = r.layers[4].infill, b = r.layers[5].infill;
      const dir = (s: number[]) => Math.sign((s[2] - s[0]) * (s[3] - s[1]));
      expect(dir(a)).toBe(-dir(b));
    }
  });

  it('slices the CSG part: hole is a CW loop inside a CCW outer loop', () => {
    const geo = buildPart(DEFAULT_PARAMS);
    expect(meshVolume(geo)).toBeGreaterThan(0);
    const r = sliceMesh(geo.attributes.position.array, { ...base, layerHeight: 0.2, solidBottom: 2, solidTop: 2 });
    expect(r.layers.length).toBe(60); // 6 mm plate + 6 mm boss
    const plate = r.layers[10];
    expect(plate.contours.length).toBe(2);
    const areas = plate.contours.map(polyArea).sort((x, y) => x - y);
    expect(areas[0]).toBeLessThan(0);
    expect(areas[1]).toBeGreaterThan(0);
    expect(pointInPolys(0, 0, plate.contours)).toBe(false); // the hole is empty
    const boss = r.layers[45];
    expect(boss.contours.length).toBe(2);
    expect(r.layers[29].solid).toBe(true); // top of the plate around the boss gets a solid skin
    const tp = buildToolpath(r);
    expect(tp.extCount).toBeGreaterThan(1000);
    expect(tp.time).toBeGreaterThan(60);
  });

  it('every slider extreme slices into exactly one outer loop + one hole per layer', () => {
    for (const width of [20, 80]) for (const depth of [20, 60]) for (const height of [3, 12]) for (const boss of [true, false]) {
      const chamfer = (width + height) % 2 === 0;
      for (const holeKind of ['min', 'max']) {
        const p0: PartParams = { width, depth, height, hole: 3, boss, chamfer };
        const p: PartParams = { ...p0, hole: holeKind === 'min' ? 3 : maxHole(p0) };
        const geo = buildPart(p);
        const r = sliceMesh(geo.attributes.position.array, { ...base, layerHeight: 0.3 });
        for (const L of r.layers) {
          const areas = L.contours.map(polyArea);
          expect(areas.length, `${JSON.stringify(p)} layer ${L.index}`).toBe(2);
          expect(areas.filter((a) => a < 0).length).toBe(1);
          expect(L.walls.length).toBe(2);
        }
        geo.dispose();
      }
    }
  });
});
