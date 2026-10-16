// WCAG 2.x contrast for the Educator theme, computed from the real CSS variables in src/style.css.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
function vars(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  const block = css.slice(i, css.indexOf('}', i));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const E = vars('[data-theme="educator"]');
// [label, foreground, background, minimum]
const PAIRS: [string, string, string, number][] = [
  ['body text on panel', E.text, E['panel-solid'], 7],
  ['body text on page background', E.text, E.bg, 7],
  ['labels on panel', E['text-2'], E['panel-solid'], 7],
  ['secondary text on panel', E.muted, E['panel-solid'], 4.5],
  ['secondary text on page background', E.muted, E.bg, 4.5],
  ['secondary text on KPI tiles', E.muted, E['surface-3'], 4.5],
  ['primary button text (white on orange)', E['on-accent'], E.accent, 4.5],
  ['secondary button text', E.text, E['surface-2'], 4.5],
  ['chip / toggle text', E.text, E.surface, 4.5],
  ['active step text', E.text, E['accent-soft'], 4.5],
  ['done step number', E['on-done'], E.done, 4.5],
  ['difficulty: Easy', E['easy-fg'], E['easy-bg'], 4.5],
  ['difficulty: Medium', E['med-fg'], E['med-bg'], 4.5],
  ['difficulty: Hard', E['hard-fg'], E['hard-bg'], 4.5],
  ['teacher tip', '#3d3000', '#fff8db', 4.5],
  ['control borders (non-text, 3:1)', E.line, E['panel-solid'], 3],
  ['focus ring (non-text, 3:1)', E.focus, E['panel-solid'], 3],
];

describe('educator theme contrast (WCAG AA)', () => {
  it('reads the educator variables from style.css', () => {
    expect(Object.keys(E).length).toBeGreaterThan(20);
  });
  for (const [label, fg, bg, min] of PAIRS) {
    it(`${label}: ${fg} on ${bg} >= ${min}:1`, () => {
      const r = ratio(fg, bg);
      console.log(`CONTRAST | ${label} | ${fg} on ${bg} | ${r.toFixed(2)}:1`);
      expect(r).toBeGreaterThanOrEqual(min);
    });
  }
  it('body type is at least 16px and headings are larger', () => {
    const px = (k: string) => parseFloat(E[k]);
    for (const k of ['fs', 'fs-ctl', 'fs-sm', 'fs-cap']) expect(px(k), k).toBeGreaterThanOrEqual(16);
    expect(px('fs-h2')).toBeGreaterThan(px('fs'));
    expect(px('fs-brand')).toBeGreaterThan(px('fs'));
  });
});
