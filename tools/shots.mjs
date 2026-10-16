import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:5191/';
const out = process.argv[3] ?? '/workspace/printpath-shots';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const DESK = { viewport: { width: 1440, height: 900 } };
const report = [];
// overlap check among visible UI boxes
const overlapCheck = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && el.offsetParent !== null; };
  const issues = [];
  const top = document.querySelector('#top .brand').getBoundingClientRect(), panel = document.querySelector('#panel').getBoundingClientRect();
  const exp = document.querySelector('#explain').getBoundingClientRect();
  if (exp.bottom > panel.top && exp.right > panel.left) issues.push('explain overlaps panel');
  if (panel.bottom > innerHeight + 0.5 || panel.right > innerWidth + 0.5) issues.push('panel off-screen');
  // controls inside the active pane must not overlap each other
  const items = [...document.querySelectorAll('.pane:not([hidden]) .ctl, .pane:not([hidden]) .toggles > *, .pane:not([hidden]) .kpis > div, #nav .btn, #stepper button')].filter(vis);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (items[i].contains(items[j]) || items[j].contains(items[i])) continue;
    const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect();
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) issues.push(`${items[i].id || items[i].className || items[i].tagName} x ${items[j].id || items[j].className || items[j].tagName}`);
  }
  // horizontal overflow of text in pane
  const body = document.querySelector('#panel-body');
  if (body.scrollWidth > body.clientWidth + 1) issues.push('panel horizontal overflow');
  return { issues, panelH: Math.round(panel.height), scroll: body.scrollHeight > body.clientHeight, top: Math.round(top.bottom) };
};
for (const [tag, opts] of [['390x844', PHONE], ['1440x900', DESK]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base); await page.waitForTimeout(2500);
  const names = ['1-design', '2-stl', '3-slice', '4-print'];
  for (let i = 0; i < 4; i++) {
    await page.evaluate((k) => window.__pp.go(k), i);
    if (i === 2) await page.evaluate(() => window.__pp.setLayer(9));
    await page.waitForTimeout(i === 3 ? 2500 : 1600);
    await page.screenshot({ path: `${out}/${names[i]}-${tag}.png` });
    report.push(`[${tag}] ${names[i]}: ${JSON.stringify(await page.evaluate(overlapCheck))}`);
  }
  // mid-print
  await page.evaluate(() => { const s = window.__pp.sim; s.setProgress(0.55); s.playing = true; });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__pp.sim.playing = false; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/5-mid-print-${tag}.png` });
  await page.locator('#pr-cut').check();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/6-mid-print-cutaway-${tag}.png` });
  report.push(`[${tag}] print: ${await page.evaluate(() => JSON.stringify({ layer: document.querySelector('#pr-layer').textContent, pct: document.querySelector('#pr-pct').textContent, t: document.querySelector('#pr-time').textContent, count: window.__pp.sim && window.__pp.sliced.tp.extCount }))}`);
  report.push(`[${tag}] slice: ${await page.evaluate(() => [...document.querySelectorAll('.pane[data-pane="2"] .kpis b')].map((b) => b.textContent).join(' | '))}`);
  report.push(`[${tag}] stl: ${await page.evaluate(() => [...document.querySelectorAll('.pane[data-pane="1"] .kpis b')].map((b) => b.textContent).join(' | '))}`);
  if (errs.length) report.push(`[${tag}] ERRORS: ${errs.join(' | ')}`);
  await ctx.close();
}
await browser.close();
console.log(report.join('\n'));
