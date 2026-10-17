// DNA helix + topographic map screenshots (Educator) with the same overlap / 16px checks. Usage: node tools/sci-shots.mjs [base] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:5190/';
const out = process.argv[3] ?? new URL('../.shots/edu2', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const DESK = { viewport: { width: 1440, height: 900 } };
const report = [];
const check = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden'; };
  const issues = [];
  const pj = document.querySelector('#projects');
  const sel = pj.hidden
    ? '.brand b, .tools > *, #stepper button, #explain, .pane:not([hidden]) .ctl, .pane:not([hidden]) .toggles > *, .pane:not([hidden]) .kpis > div, .pane:not([hidden]) .seg.choice, #tip, #nav .btn, #panel'
    : '.pj-head h2, .pj-close, #pj-tabs .chip, #pj-grades .chip, #pj-subjects .chip, .card';
  const items = [...document.querySelectorAll(sel)].filter(vis);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const A = items[i], B = items[j];
    if (A.contains(B) || B.contains(A)) continue;
    if ((A.id === 'panel') !== (B.id === 'panel') && (A.closest('#panel') || B.closest('#panel'))) continue; // panel vs its own children
    // clip rows inside the scrolling panel body to its visible box (rows scrolled under the nav are not overlaps)
    const pb = document.querySelector('#panel-body').getBoundingClientRect();
    const clip = (el) => { const r = el.getBoundingClientRect(); if (!el.closest('#panel-body')) return r; return { left: r.left, right: r.right, top: Math.max(r.top, pb.top), bottom: Math.min(r.bottom, pb.bottom) }; };
    const a = clip(A), b = clip(B);
    if (a.bottom <= a.top || b.bottom <= b.top) continue;
    // chips rows scroll horizontally on phones: only compare chips that are on screen
    if (a.right < 0 || b.right < 0 || a.left > innerWidth || b.left > innerWidth) continue;
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) issues.push(`${A.id || A.className || A.tagName} x ${B.id || B.className || B.tagName}`);
  }
  const top = document.querySelector('#top').getBoundingClientRect(), panel = document.querySelector('#panel').getBoundingClientRect();
  if (pj.hidden && innerWidth < 900 && top.bottom > panel.top) issues.push('header overlaps panel');
  if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('page horizontal overflow');
  const body = document.querySelector('#panel-body');
  if (pj.hidden && body.scrollWidth > body.clientWidth + 1) issues.push('panel horizontal overflow');
  const small = [...document.querySelectorAll(pj.hidden ? '#panel *, #top *' : '#projects *')].filter((e) => vis(e) && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 16 && !e.classList.contains('tag') && e.id !== 'stepno' && !e.closest('#stl-snippet'));
  return { theme: document.documentElement.dataset.theme, issues, under16px: document.documentElement.dataset.theme === 'educator' ? small.map((e) => `${e.tagName}.${e.className}:${getComputedStyle(e).fontSize}`).slice(0, 6) : [], visibleH: Math.round(panel.top - top.bottom) };
};
async function run(tag, opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const shot = async (name) => {
    try { await page.screenshot({ path: `${out}/${name}-${tag}.png`, timeout: 90000 }); report.push(`[${tag}] ${name}: ${JSON.stringify(await page.evaluate(check))}`); }
    catch (e) { report.push(`[${tag}] ${name}: SHOT FAILED ${e.message.split('\n')[0]}`); }
  };
  await fn(page, shot);
  if (errs.length) report.push(`[${tag}] ERRORS: ${errs.join(' | ')}`);
  await ctx.close();
}
const W = (page, ms) => page.waitForTimeout(ms);
const layerAt = (page, f) => page.evaluate((f) => window.__pp.setLayer(Math.floor(window.__pp.sliced.sr.layers.length * f)), f);
const stats = (page) => page.evaluate(() => JSON.stringify({ preset: window.__pp.preset(), layers: window.__pp.sliced?.sr.layers.length, beads: window.__pp.sliced?.tp.extCount, printLayer: document.querySelector('#pane-3 .kpis b, .pane:not([hidden]) .kpis b')?.textContent, stat: document.querySelector('#design-stat').textContent }));

// Phone, Educator: both presets loaded from their project cards, design + slice
await run('390x844', PHONE, async (page, shot) => {
  await page.goto(`${base}?theme=educator`); await W(page, 2500);
  for (const [card, name, f] of [['dna-helix', 'helix', 0.31], ['topo-map', 'topo', 0.55]]) {
    await page.click('#open-projects'); await W(page, 300);
    await page.click(`.card[data-id="${card}"] .load`); await W(page, 2000);
    await shot(`${name}-design`);
    await page.evaluate(() => window.__pp.go(2)); await W(page, 2500);
    await layerAt(page, f); await W(page, 700);
    await shot(`${name}-slice`);
    report.push(`[390x844] ${name}: ${await stats(page)}`);
    await page.evaluate(() => window.__pp.go(0)); await W(page, 800);
  }
  // island + smooth variant of the map, and the helix centre post
  await page.evaluate(() => window.__pp.setPreset('topo', { land: 'island', terraced: false, seed: 7 })); await W(page, 1500);
  await shot('topo-island-smooth-design');
  await page.evaluate(() => window.__pp.setPreset('helix', { post: true, turns: 2 })); await W(page, 1500);
  await shot('helix-post-design');

  // responsiveness: drag a slider (20 input events, 16 ms apart) and time how long until the part settles
  for (const [preset, key, lo, hi] of [['helix', 'height', 50, 100], ['topo', 'relief', 6, 26]]) {
    await page.evaluate((p) => window.__pp.setPreset(p), preset); await W(page, 800);
    const r = await page.evaluate(async ([key, lo, hi]) => {
      const el = document.getElementById(`d-${key}`);
      const info = window.__pp.stage.renderer.info.memory;
      const g0 = info.geometries;
      const t0 = performance.now(); let worstFrame = 0, last = t0;
      for (let i = 0; i < 20; i++) {
        el.value = String(lo + ((hi - lo) * i) / 19); el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((res) => setTimeout(res, 16));
        const now = performance.now(); worstFrame = Math.max(worstFrame, now - last); last = now;
      }
      while (document.querySelector('#design-stat').classList.contains('busy')) await new Promise((res) => setTimeout(res, 10));
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { settleMs: Math.round(performance.now() - t0), worstGapMs: Math.round(worstFrame), finalValue: window.__pp.params()[key], geometriesBefore: g0, geometriesAfter: info.geometries };
    }, [key, lo, hi]);
    report.push(`[390x844] drag ${preset}.${key}: ${JSON.stringify(r)}`);
  }
});

// Desktop: print step with the cutaway, one of each
await run('1440x900', DESK, async (page, shot) => {
  await page.goto(`${base}?theme=educator`); await W(page, 2500);
  for (const [name, p] of [['helix', 0.42], ['topo', 0.6]]) {
    await page.evaluate((n) => { window.__pp.go(0); window.__pp.setPreset(n); }, name); await W(page, 1200);
    await page.evaluate(() => window.__pp.go(3)); await W(page, 3000);
    await page.evaluate((p) => { window.__pp.sim.setProgress(p); }, p); await W(page, 900);
    await page.locator('#pr-cut').check(); await W(page, 600);
    await shot(`${name}-print-cutaway`);
    report.push(`[1440x900] ${name}: ${await stats(page)}`);
    await page.locator('#pr-cut').uncheck();
  }
});
await browser.close();
console.log(report.join('\n'));
