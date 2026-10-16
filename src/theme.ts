// Theme = CSS variables (style.css, [data-theme]) + a small 3D scene palette + per-theme copy.
export type ThemeId = 'studio' | 'educator';
export const THEME_KEY = 'printpath.theme.v1';

export interface ScenePalette {
  bg: number; bedPlate: number; gridMain: number; gridLine: number; gridOpacity: number;
  envIntensity: number; exposure: number; part: number;
  path: [number, number, number, number, number]; // travel, outer, inner, infill, solid
  contourLo: number; contourHi: number; contourOpacity: number;
  ghost: number; ghostOpacity: number; wire: number; wireOpacity: number; layerPlane: number;
}

export const PALETTES: Record<ThemeId, ScenePalette> = {
  studio: {
    bg: 0x0e1319, bedPlate: 0x1d252e, gridMain: 0x3fc7ff, gridLine: 0x2c3a47, gridOpacity: 0.55,
    envIntensity: 0.55, exposure: 1.0, part: 0xf07a35,
    path: [0x4a5562, 0xff7a33, 0xffb36b, 0x3fc7ff, 0x8fe6ff],
    contourLo: 0x245a73, contourHi: 0x9ad7ee, contourOpacity: 0.45,
    ghost: 0x9fb4c8, ghostOpacity: 0.08, wire: 0x0b0f14, wireOpacity: 0.55, layerPlane: 0x3fc7ff,
  },
  educator: {
    bg: 0xeaf2f8, bedPlate: 0xf4f7fa, gridMain: 0x2f6fd6, gridLine: 0xb4c4d6, gridOpacity: 0.9,
    envIntensity: 0.6, exposure: 1.0, part: 0xf47b2a,
    path: [0xa3adb8, 0xe8590c, 0xf59f00, 0x1c7ed6, 0x7048e8],
    contourLo: 0x74b9f0, contourHi: 0x1b4f8a, contourOpacity: 0.6,
    ghost: 0x5b7a99, ghostOpacity: 0.12, wire: 0x2b2118, wireOpacity: 0.45, layerPlane: 0x1c7ed6,
  },
};

let current: ThemeId = 'studio';
export const theme = () => current;
export const palette = () => PALETTES[current];

/** Tolerant read: anything unexpected -> studio. ?theme=educator overrides (and is saved). */
export function readTheme(): ThemeId {
  const q = new URLSearchParams(location.search).get('theme');
  if (q === 'studio' || q === 'educator') return q;
  try { const v = localStorage.getItem(THEME_KEY); return v === 'educator' ? 'educator' : 'studio'; } catch { return 'studio'; }
}

export function applyTheme(t: ThemeId) {
  current = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* not persisted */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `#${PALETTES[t].bg.toString(16).padStart(6, '0')}`);
}

export const STEP_ICONS = ['📐', '🔺', '🥞', '🖨️'];

export const COPY: Record<ThemeId, { explain: string[]; tips?: string[] }> = {
  studio: {
    explain: [
      'Design: you build a part from simple solids (add and cut shapes), the way CAD combines them.',
      'STL: the printer never sees your design, only a list of flat triangles, each with an “outside” arrow (normal).',
      'Slice: the slicer cuts the triangles into thin layers and plans every nozzle move: walls, then infill.',
      'Print: the printer follows that plan, melting plastic into a thin bead, one layer on top of the last.',
    ],
  },
  educator: {
    explain: [
      'Design: pick a shape and change its size. The computer builds it by adding and cutting simple blocks.',
      'STL file: the printer gets your shape as lots of tiny flat triangles. Arrows show which side is outside.',
      'Slice: the computer cuts the shape into thin layers, like slicing bread, and plans where the nozzle goes.',
      'Print: the printer melts plastic and draws one layer at a time, stacking them up into your object.',
    ],
    tips: [
      'Ask students to predict how the weight changes before they move a slider, then check the number.',
      'Turn “Show triangles” on and off. Why do curved parts need many more triangles than flat ones?',
      'Drag “Inspect layer” slowly. Compare 0.1 mm and 0.4 mm layers: which is faster, which is smoother?',
      'Turn on “Cut-away” to see the pattern inside. Most prints are partly hollow. Why might that be useful?',
    ],
  },
};
