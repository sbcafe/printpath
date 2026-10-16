// Educator / Projects / Favourites screenshots + overlap checks. Usage: node tools/edu-shots.mjs [base] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:5190/';
const out = process.argv[3] ?? new URL('../.shots/edu', import.meta.url).pathname;
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

// Phone, Educator theme: the 4 steps (switched via the header button, like a user)
await run('390x844', PHONE, async (page, shot) => {
  await page.goto(base); await W(page, 2500);
  await page.click('[data-theme-btn="educator"]'); await W(page, 1500);
  const names = ['edu-1-design', 'edu-2-stl', 'edu-3-slice', 'edu-4-print'];
  for (let i = 0; i < 4; i++) {
    await page.evaluate((k) => window.__pp.go(k), i);
    if (i === 2) await page.evaluate(() => window.__pp.setLayer(12));
    await W(page, i === 3 ? 2200 : 1500);
    if (i === 3) { await page.evaluate(() => { window.__pp.sim.setProgress(0.45); }); await W(page, 600); }
    await shot(names[i]);
  }
  // theme persisted across reload
  await page.reload(); await W(page, 2000);
  report.push(`[390x844] theme after reload: ${await page.evaluate(() => document.documentElement.dataset.theme + ' / ' + localStorage.getItem('printpath.theme.v1'))}`);
  // Projects with a grade filter
  await page.click('#open-projects'); await W(page, 500);
  await page.click('#pj-grades .chip[data-v="3-5"]'); await W(page, 400);
  await shot('projects-grade-3-5');
  report.push(`[390x844] grade 3-5 list: ${await page.evaluate(() => document.querySelector('#pj-count').textContent + ' :: ' + [...document.querySelectorAll('.card h3')].map((h) => h.textContent).join(', '))}`);
  // star three projects through the UI, reload, open favourites
  await page.click('#pj-grades .chip[data-v=""]'); await W(page, 200);
  for (const id of ['gear-set', 'cookie-cutter', 'name-keychain']) { await page.click(`.card[data-id="${id}"] .star`); await W(page, 150); }
  await page.reload(); await W(page, 2000);
  await page.click('#open-projects'); await W(page, 300);
  await page.click('#pj-tabs [data-tab="fav"]'); await W(page, 400);
  await shot('favourites');
  report.push(`[390x844] favourites after reload: ${await page.evaluate(() => [...document.querySelectorAll('.card h3')].map((h) => h.textContent).join(', ') + ' | stored ' + localStorage.getItem('printpath.favourites.v1'))}`);
  // load a preset from its card
  await page.click('#pj-tabs [data-tab="all"]'); await W(page, 200);
  await page.click('.card[data-id="name-keychain"] .load'); await W(page, 1800);
  await shot('preset-keychain-design');
  await page.evaluate(() => window.__pp.go(2)); await W(page, 1200);
  await page.evaluate(() => window.__pp.setLayer(window.__pp.sliced.sr.layers.length - 3)); await W(page, 600);
  await shot('preset-keychain-slice');
  // a second preset (hex pencil holder) in the slice step
  await page.evaluate(() => { window.__pp.setPreset('pencil'); window.__pp.go(0); }); await W(page, 1500);
  await shot('preset-pencil-design');
  await page.evaluate(() => window.__pp.go(2)); await W(page, 1500);
  await page.evaluate(() => window.__pp.setLayer(120)); await W(page, 600);
  await shot('preset-pencil-slice');
  // studio regression with the new header controls
  await page.click('[data-theme-btn="studio"]'); await W(page, 1200);
  await page.evaluate(() => { window.__pp.setPreset('gear'); window.__pp.go(0); }); await W(page, 1500);
  await shot('studio-gear-design');
});

// Desktop
await run('1440x900', DESK, async (page, shot) => {
  await page.goto(`${base}?theme=educator`); await W(page, 2500);
  await shot('edu-1-design');
  await page.click('#open-projects'); await W(page, 400);
  await page.click('#pj-grades .chip[data-v="6-8"]'); await W(page, 300);
  await page.click('#pj-subjects .chip[data-v="Engineering"]'); await W(page, 300);
  await shot('projects-grade-6-8-engineering');
  report.push(`[1440x900] 6-8 + Engineering: ${await page.evaluate(() => document.querySelector('#pj-count').textContent)}`);
  await page.click('#pj-subjects .chip[data-v=""]'); await W(page, 300);
  await shot('projects-grade-6-8');
  await page.click('.card[data-id="phone-stand"] .load'); await W(page, 1500);
  await page.evaluate(() => window.__pp.go(2)); await W(page, 1500);
  await shot('preset-stand-slice');
  report.push(`[1440x900] stand toolpath: ${await page.evaluate(() => JSON.stringify({ layers: window.__pp.sliced.tp.layers, beads: window.__pp.sliced.tp.extCount }))}`);
  await page.evaluate(() => { window.__pp.setPreset('gear'); window.__pp.go(3); }); await W(page, 1800);
  await page.evaluate(() => { window.__pp.sim.setProgress(0.5); }); await W(page, 600);
  await page.locator('#pr-cut').check(); await W(page, 500);
  await shot('edu-4-print-gear-cutaway');
});

// Corrupted storage must not break the page
await run('corrupt', PHONE, async (page) => {
  await page.addInitScript(() => { localStorage.setItem('printpath.favourites.v1', '{oops'); localStorage.setItem('printpath.theme.v1', '<<bad>>'); });
  await page.goto(base); await W(page, 2000);
  await page.click('#open-projects'); await W(page, 300);
  await page.click('#pj-tabs [data-tab="fav"]'); await W(page, 300);
  report.push(`[corrupt] theme=${await page.evaluate(() => document.documentElement.dataset.theme)} favs="${await page.evaluate(() => document.querySelector('.pj-empty')?.textContent)}" stored=${await page.evaluate(() => localStorage.getItem('printpath.favourites.v1'))}`);
});
await browser.close();
console.log(report.join('\n'));
