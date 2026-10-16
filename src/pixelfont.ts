// Tiny built-in 5x7 block font (no font files, no network). Text -> closed outline loops.
// Loops are traced on the pixel grid with the solid on the LEFT, so outers are CCW and holes CW.
import { simplify } from './slicer';

const G: Record<string, string> = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  '-': '.....|.....|.....|.###.|.....|.....|.....', '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '.': '.....|.....|.....|.....|.....|.....|..#..', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '*': '.#.#.|#####|#####|#####|.###.|..#..|.....', ' ': '.....|.....|.....|.....|.....|.....|.....',
};

export const ROWS = 7;
export const SUPPORTED = Object.keys(G).join('');

/** Uppercase and keep supported characters only (♥ maps to *). */
export function normalizeText(s: string, max = 10): string {
  return [...s.toUpperCase().replace(/♥|❤/g, '*')].filter((c) => c in G).join('').slice(0, max);
}

/** Bitmap rows (top first) for a string, 1 blank column between glyphs, diagonal-only joins thickened. */
export function textGrid(text: string): boolean[][] {
  const t = normalizeText(text, 64);
  const cols = Math.max(0, t.length * 6 - 1);
  const g: boolean[][] = Array.from({ length: ROWS }, () => new Array(cols).fill(false));
  [...t].forEach((ch, k) => {
    G[ch].split('|').forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') g[r][k * 6 + c] = true; });
  });
  // a pixel grid whose cells only touch at a corner would trace to a pinched loop; fill one cell to join them
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let r = 0; r + 1 < ROWS; r++) for (let c = 0; c + 1 < cols; c++) {
      const a = g[r][c], b = g[r][c + 1], d = g[r + 1][c], e = g[r + 1][c + 1];
      if (a && e && !b && !d) { g[r + 1][c] = true; changed = true; }
      else if (b && d && !a && !e) { g[r + 1][c + 1] = true; changed = true; }
    }
    if (!changed) break;
  }
  return g;
}

/** Closed loops in pixel units (x right, y up, origin bottom-left). */
export function textLoops(text: string): { loops: number[][]; cols: number; rows: number } {
  const g = textGrid(text);
  const cols = g[0]?.length ?? 0;
  const on = (c: number, y: number) => y >= 0 && y < ROWS && c >= 0 && c < cols && g[ROWS - 1 - y][c];
  const next = new Map<string, [number, number]>(); // start vertex -> end vertex
  const add = (x0: number, y0: number, x1: number, y1: number) => next.set(`${x0},${y0}`, [x1, y1]);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) add(x, y, x + 1, y);
    if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!on(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: number[][] = [];
  for (const startKey of [...next.keys()]) {
    if (!next.has(startKey)) continue;
    const loop: number[] = [];
    let k = startKey;
    for (let guard = 0; guard < 100000 && next.has(k); guard++) {
      const [x1, y1] = next.get(k)!;
      next.delete(k);
      const [x0, y0] = k.split(',').map(Number);
      loop.push(x0, y0);
      k = `${x1},${y1}`;
    }
    const s = simplify(loop);
    if (s.length >= 8) loops.push(s);
  }
  return { loops, cols, rows: ROWS };
}
