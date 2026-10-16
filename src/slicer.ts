// PrintPath slicer: plane/triangle intersection -> chained contours -> offset walls -> scanline infill.
// Pure TypeScript (no DOM, no three), so it runs in unit tests and in the browser.
// Coordinates: the mesh is Y-up (three.js). We slice along Y; contours live in the plan (u = X, v = Z).

export type Poly = number[]; // flat [u0, v0, u1, v1, ...], implicitly closed

export interface SliceSettings {
  layerHeight: number; // mm
  lineWidth: number; // mm (nozzle bead width)
  walls: number; // perimeter count (1..2)
  infill: number; // 0..100 (%)
  solidBottom?: number; // solid layers at the bottom
  solidTop?: number; // solid layers under any top surface (approximated by area drop)
}

export interface Layer {
  index: number;
  z: number; // slicing plane height (mid-layer)
  top: number; // nozzle height when printing this layer
  contours: Poly[]; // outer CCW (+area), holes CW (-area)
  walls: Poly[][]; // walls[k] = all loops of wall k (0 = outermost)
  infill: number[]; // flat segments [u0, v0, u1, v1, ...]
  solid: boolean;
  area: number; // net area of contours (mm^2)
}

export interface SliceResult {
  layers: Layer[];
  height: number;
  settings: SliceSettings;
}

export function layerCount(height: number, layerHeight: number): number {
  return Math.max(1, Math.floor(height / layerHeight + 1e-6));
}

/** Signed area (shoelace). Positive = CCW in (u, v). */
export function polyArea(p: Poly): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
  return a / 2;
}

export function polyPerimeter(p: Poly): number {
  let L = 0;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) L += Math.hypot(p[i * 2] - p[j * 2], p[i * 2 + 1] - p[j * 2 + 1]);
  return L;
}

/** Even-odd point-in-polygon over a set of loops (outer + holes). */
export function pointInPolys(u: number, v: number, polys: Poly[]): boolean {
  let inside = false;
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ui = p[i * 2], vi = p[i * 2 + 1], uj = p[j * 2], vj = p[j * 2 + 1];
      if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
    }
  }
  return inside;
}

/**
 * Intersect every triangle with the plane y = z. Each crossing triangle gives one segment,
 * oriented so that the solid is on its LEFT (using the triangle's outward normal). That makes
 * chained outer loops CCW and holes CW without any nesting analysis.
 */
export function sliceSegments(pos: ArrayLike<number>, triCount: number, z: number, minY?: Float32Array, maxY?: Float32Array): number[] {
  const out: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (minY && maxY && (minY[t] > z || maxY[t] < z)) continue;
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    const da = ay - z, db = by - z, dc = cy - z;
    const sa = da >= 0, sb = db >= 0, sc = dc >= 0;
    if (sa === sb && sb === sc) continue;
    // collect the two crossing points
    let k = 0;
    const pts = [0, 0, 0, 0];
    const edge = (x0: number, z0: number, d0: number, x1: number, z1: number, d1: number) => {
      const f = d0 / (d0 - d1);
      pts[k++] = x0 + (x1 - x0) * f;
      pts[k++] = z0 + (z1 - z0) * f;
    };
    if (sa !== sb) edge(ax, az, da, bx, bz, db);
    if (sb !== sc) edge(bx, bz, db, cx, cz, dc);
    if (sc !== sa && k < 4) edge(cx, cz, dc, ax, az, da);
    if (k < 4) continue;
    let pu = pts[0], pv = pts[1], qu = pts[2], qv = pts[3];
    if (Math.abs(qu - pu) + Math.abs(qv - pv) < 1e-9) continue;
    // outward normal projected to the plan: n = (b-a) x (c-a), take (nx, nz)
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const nz = ux * vy - uy * vx;
    const du = qu - pu, dv = qv - pv;
    // outward direction for a solid-on-left segment is (dv, -du)
    if (dv * nx - du * nz < 0) {
      const tu = pu, tv = pv;
      pu = qu; pv = qv; qu = tu; qv = tv;
    }
    out.push(pu, pv, qu, qv);
  }
  return out;
}

/** Chain oriented segments end->start into closed loops. */
export function chainSegments(seg: number[], tol = 1e-3): Poly[] {
  const n = seg.length / 4;
  const used = new Uint8Array(n);
  const map = new Map<string, number[]>();
  const key = (u: number, v: number) => `${Math.round(u / tol)},${Math.round(v / tol)}`;
  for (let i = 0; i < n; i++) {
    const k = key(seg[i * 4], seg[i * 4 + 1]);
    const l = map.get(k);
    if (l) l.push(i); else map.set(k, [i]);
  }
  const far2 = (tol * 50) ** 2;
  const findNext = (u: number, v: number): number => {
    const l = map.get(key(u, v));
    if (l) for (const j of l) if (!used[j]) return j;
    let best = -1, bd = far2;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = (seg[j * 4] - u) ** 2 + (seg[j * 4 + 1] - v) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  };
  const closed: Poly[] = [];
  const open: Poly[] = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const su = seg[i * 4], sv = seg[i * 4 + 1];
    const loop: Poly = [su, sv, seg[i * 4 + 2], seg[i * 4 + 3]];
    let eu = seg[i * 4 + 2], ev = seg[i * 4 + 3];
    let isClosed = false;
    for (let guard = 0; guard < n; guard++) {
      if ((eu - su) ** 2 + (ev - sv) ** 2 < far2 && loop.length > 4) { isClosed = true; break; }
      const j = findNext(eu, ev);
      if (j < 0) break;
      used[j] = 1;
      eu = seg[j * 4 + 2]; ev = seg[j * 4 + 3];
      loop.push(eu, ev);
    }
    if (isClosed) loop.length -= 2; // drop duplicated closing point
    (isClosed ? closed : open).push(loop);
  }
  // Robustness: stitch open chains across small gaps (CSG T-junctions / slivers), end -> nearest start.
  const gap2 = 0.5 * 0.5;
  while (open.length) {
    const a = open.pop()!;
    for (;;) {
      const eu = a[a.length - 2], ev = a[a.length - 1];
      const dSelf = (a[0] - eu) ** 2 + (a[1] - ev) ** 2;
      let best = -1, bd = dSelf;
      for (let k = 0; k < open.length; k++) {
        const d = (open[k][0] - eu) ** 2 + (open[k][1] - ev) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0 || bd > gap2) { if (dSelf <= gap2 || a.length >= 6) closed.push(a); break; }
      const b = open.splice(best, 1)[0];
      for (let k = 0; k < b.length; k++) a.push(b[k]);
    }
  }
  const loops: Poly[] = [];
  for (const l of closed) {
    const s2 = simplify(l);
    if (s2.length >= 6 && Math.abs(polyArea(s2)) > 0.01) loops.push(s2);
  }
  return loops;
}

/** Remove near-duplicate and collinear points. */
export function simplify(p: Poly, eps = 1e-4): Poly {
  let pts = p.slice();
  for (let pass = 0; pass < 2; pass++) {
    const n = pts.length / 2;
    if (n < 3) return pts;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const pu = pts[((i + n - 1) % n) * 2], pv = pts[((i + n - 1) % n) * 2 + 1];
      const cu = pts[i * 2], cv = pts[i * 2 + 1];
      const nu = pts[((i + 1) % n) * 2], nv = pts[((i + 1) % n) * 2 + 1];
      const l1 = Math.hypot(cu - pu, cv - pv), l2 = Math.hypot(nu - cu, nv - cv);
      if (l1 < eps) continue; // duplicate of previous
      if (l2 < eps) { out.push(cu, cv); continue; }
      const cross = ((cu - pu) * (nv - cv) - (cv - pv) * (nu - cu)) / (l1 * l2);
      const dot = ((cu - pu) * (nu - cu) + (cv - pv) * (nv - cv)) / (l1 * l2);
      if (Math.abs(cross) < 1e-5 && dot > 0) continue; // collinear, straight through
      out.push(cu, cv);
    }
    pts = out;
  }
  return pts;
}

/**
 * Miter offset toward the solid (left side) by d. Works for outer loops (shrinks) and holes (grows).
 * Simplification: no self-intersection cleanup; loops that collapse or flip are dropped.
 */
export function offsetPoly(p: Poly, d: number): Poly | null {
  const n = p.length / 2;
  if (n < 3) return null;
  const out: number[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const i0 = (i + n - 1) % n, i2 = (i + 1) % n;
    let e1u = p[i * 2] - p[i0 * 2], e1v = p[i * 2 + 1] - p[i0 * 2 + 1];
    let e2u = p[i2 * 2] - p[i * 2], e2v = p[i2 * 2 + 1] - p[i * 2 + 1];
    const l1 = Math.hypot(e1u, e1v) || 1, l2 = Math.hypot(e2u, e2v) || 1;
    e1u /= l1; e1v /= l1; e2u /= l2; e2v /= l2;
    const n1u = -e1v, n1v = e1u, n2u = -e2v, n2v = e2u;
    let bu = n1u + n2u, bv = n1v + n2v;
    const bl = Math.hypot(bu, bv);
    let s = d;
    if (bl < 1e-6) { bu = n1u; bv = n1v; } else {
      bu /= bl; bv /= bl;
      s = d / Math.max(bu * n1u + bv * n1v, 0.35); // miter limit
    }
    out[i * 2] = p[i * 2] + bu * s;
    out[i * 2 + 1] = p[i * 2 + 1] + bv * s;
  }
  const a0 = polyArea(p), a1 = polyArea(out);
  if (Math.sign(a0) !== Math.sign(a1)) return null;
  if (a0 > 0 && a1 > a0) return null; // outer must shrink
  if (Math.abs(a1) < 0.05) return null;
  return out;
}

export function offsetAll(polys: Poly[], d: number): Poly[] {
  const out: Poly[] = [];
  for (const p of polys) {
    const o = offsetPoly(p, d);
    if (o) out.push(o);
  }
  // drop holes that ended up outside every outer loop (can happen in very thin regions)
  return out.filter((p) => polyArea(p) > 0 || pointInPolys(p[0], p[1], out.filter((q) => polyArea(q) > 0)));
}

/** Scanline infill of a region (outer + holes) at a given angle and spacing. */
export function scanInfill(region: Poly[], spacing: number, angle: number, minLen = 0.3): number[] {
  const out: number[] = [];
  if (!region.length || spacing <= 0) return out;
  const c = Math.cos(angle), s = Math.sin(angle);
  // rotate region by -angle so scanlines are horizontal (constant v')
  const rot: Poly[] = region.map((p) => {
    const r = new Array(p.length);
    for (let i = 0; i < p.length; i += 2) {
      r[i] = p[i] * c + p[i + 1] * s;
      r[i + 1] = -p[i] * s + p[i + 1] * c;
    }
    return r;
  });
  let vmin = Infinity, vmax = -Infinity;
  for (const p of rot) for (let i = 1; i < p.length; i += 2) { vmin = Math.min(vmin, p[i]); vmax = Math.max(vmax, p[i]); }
  const xs: number[] = [];
  const k0 = Math.ceil(vmin / spacing);
  const k1 = Math.floor(vmax / spacing);
  for (let k = k0; k <= k1; k++) {
    const v = k * spacing + 1e-7; // nudge off vertices
    xs.length = 0;
    for (const p of rot) {
      const n = p.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const vi = p[i * 2 + 1], vj = p[j * 2 + 1];
        if (vi > v !== vj > v) xs.push(p[j * 2] + ((p[i * 2] - p[j * 2]) * (v - vj)) / (vi - vj));
      }
    }
    xs.sort((a, b) => a - b);
    const flip = (k - k0) % 2 === 1; // serpentine order
    const segs: number[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] < minLen) continue;
      segs.push(xs[i], xs[i + 1]);
    }
    if (flip) segs.reverse();
    for (let i = 0; i < segs.length; i += 2) {
      const a = segs[i], b = segs[i + 1];
      // rotate back by +angle: u = u' c - v' s, v = u' s + v' c
      out.push(a * c - v * s, a * s + v * c, b * c - v * s, b * s + v * c);
    }
  }
  return out;
}

/** Slice a non-indexed Y-up triangle soup. */
export function sliceMesh(pos: ArrayLike<number>, settings: SliceSettings): SliceResult {
  const triCount = Math.floor(pos.length / 9);
  const minY = new Float32Array(triCount), maxY = new Float32Array(triCount);
  let height = 0;
  for (let t = 0; t < triCount; t++) {
    const a = pos[t * 9 + 1], b = pos[t * 9 + 4], c = pos[t * 9 + 7];
    minY[t] = Math.min(a, b, c);
    maxY[t] = Math.max(a, b, c);
    height = Math.max(height, maxY[t]);
  }
  const lh = settings.layerHeight, lw = settings.lineWidth;
  const n = layerCount(height, lh);
  const layers: Layer[] = [];
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * lh;
    const contours = chainSegments(sliceSegments(pos, triCount, z, minY, maxY));
    let area = 0;
    for (const c of contours) area += polyArea(c);
    layers.push({ index: i, z, top: (i + 1) * lh, contours, walls: [], infill: [], solid: false, area });
  }
  const sb = settings.solidBottom ?? 2, st = settings.solidTop ?? 2;
  for (let i = 0; i < n; i++) {
    const L = layers[i];
    // solid if near the bottom, near the very top, or the area shrinks within the next `st` layers (top surface)
    let solid = i < sb || i >= n - st;
    for (let k = 1; k <= st && !solid; k++) if (i + k < n && layers[i + k].area < L.area * 0.97) solid = true;
    L.solid = solid;
    for (let w = 0; w < settings.walls; w++) {
      const loops = offsetAll(L.contours, (w + 0.5) * lw);
      if (!loops.length) break;
      L.walls.push(loops);
    }
    const pct = solid ? 100 : settings.infill;
    if (pct > 0) {
      const region = offsetAll(L.contours, settings.walls * lw - lw * 0.15);
      const spacing = lw / (pct / 100);
      const angle = (i % 2 === 0 ? 1 : -1) * (Math.PI / 4);
      L.infill = scanInfill(region, spacing, angle, lw * 0.8);
    }
  }
  return { layers, height, settings };
}
