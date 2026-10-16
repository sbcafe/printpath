// Turns slice layers into an ordered list of nozzle moves with timing.
import type { SliceResult } from './slicer';

export const MOVE_TRAVEL = 0, MOVE_OUTER = 1, MOVE_INNER = 2, MOVE_INFILL = 3, MOVE_SOLID = 4;
export const SPEEDS = [150, 30, 45, 70, 50]; // mm/s per move type (travel, outer, inner, infill, solid)
const LAYER_CHANGE_S = 0.4;

export interface Toolpath {
  count: number; // moves
  seg: Float32Array; // [u0, v0, u1, v1] per move (plan coords)
  layer: Uint16Array; // layer index per move
  type: Uint8Array; // MOVE_*
  tEnd: Float64Array; // cumulative time at end of move (s)
  extBefore: Int32Array; // number of extrusion moves before this move
  extSeg: Int32Array; // extrusion index -> move index
  extCount: number;
  layerStart: Int32Array; // first move of each layer (length layers + 1)
  layerHeight: number;
  lineWidth: number;
  layers: number;
  extrudeLength: number; // mm
  travelLength: number; // mm
  time: number; // s (estimate)
}

export function buildToolpath(sr: SliceResult): Toolpath {
  const segs: number[] = [], layer: number[] = [], type: number[] = [];
  const layerStart: number[] = [];
  let cu = 0, cv = 0, first = true;
  const move = (u: number, v: number, t: number, li: number) => {
    if (first) { cu = u; cv = v; first = false; if (t === MOVE_TRAVEL) return; }
    if (Math.abs(u - cu) + Math.abs(v - cv) < 1e-6) return;
    segs.push(cu, cv, u, v); layer.push(li); type.push(t);
    cu = u; cv = v;
  };
  for (const L of sr.layers) {
    layerStart.push(type.length);
    L.walls.forEach((loops, w) => {
      const t = w === 0 ? MOVE_OUTER : MOVE_INNER;
      for (const p of loops) {
        move(p[0], p[1], MOVE_TRAVEL, L.index);
        for (let i = 2; i < p.length; i += 2) move(p[i], p[i + 1], t, L.index);
        move(p[0], p[1], t, L.index);
      }
    });
    const ti = L.solid ? MOVE_SOLID : MOVE_INFILL;
    for (let i = 0; i < L.infill.length; i += 4) {
      move(L.infill[i], L.infill[i + 1], MOVE_TRAVEL, L.index);
      move(L.infill[i + 2], L.infill[i + 3], ti, L.index);
    }
  }
  layerStart.push(type.length);
  const count = type.length;
  const tEnd = new Float64Array(count), extBefore = new Int32Array(count);
  const extSegArr: number[] = [];
  let t = 0, ext = 0, extLen = 0, travLen = 0, li = -1;
  for (let i = 0; i < count; i++) {
    const len = Math.hypot(segs[i * 4 + 2] - segs[i * 4], segs[i * 4 + 3] - segs[i * 4 + 1]);
    if (layer[i] !== li) { li = layer[i]; if (i > 0) t += LAYER_CHANGE_S; }
    t += len / SPEEDS[type[i]];
    tEnd[i] = t;
    extBefore[i] = ext;
    if (type[i] !== MOVE_TRAVEL) { extSegArr.push(i); ext++; extLen += len; } else travLen += len;
  }
  return {
    count,
    seg: new Float32Array(segs),
    layer: new Uint16Array(layer),
    type: new Uint8Array(type),
    tEnd,
    extBefore,
    extSeg: new Int32Array(extSegArr),
    extCount: ext,
    layerStart: new Int32Array(layerStart),
    layerHeight: sr.settings.layerHeight,
    lineWidth: sr.settings.lineWidth,
    layers: sr.layers.length,
    extrudeLength: extLen,
    travelLength: travLen,
    time: t,
  };
}

export function formatDuration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
