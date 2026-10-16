import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [], reqs = [];
page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) reqs.push(r.url()); });
await page.goto(new URL('../dist-single/printpath.html', import.meta.url).href); await page.waitForTimeout(2500);
await page.evaluate(() => window.__pp.go(3)); await page.waitForTimeout(1500);
await page.evaluate(() => { window.__pp.sim.setProgress(0.4); }); await page.waitForTimeout(800);
await page.screenshot({ path: process.env.SHOT || '/tmp/pp-single.png' });
const nonBlank = await page.evaluate(() => { const c = document.querySelector('#c'); const g = c.getContext('webgl2') || c.getContext('webgl'); return !!g; });
// download STL via the button (blob, no network)
await page.evaluate(() => window.__pp.go(1)); await page.waitForTimeout(800);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stl-dl')]);
const path = '/tmp/pp-test.stl'; await dl.saveAs(path);
console.log(JSON.stringify({ errs, externalRequests: reqs, webgl: nonBlank, download: dl.suggestedFilename(), dlPath: path }));
await browser.close();
// Educator + Projects + preset smoke test on the offline file
{
  const b2 = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p2 = await (await b2.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
  const e2 = [], r2 = [];
  p2.on('pageerror', (e) => e2.push(e.message)); p2.on('console', (m) => { if (m.type() === 'error') e2.push(m.text()); });
  p2.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) r2.push(r.url()); });
  await p2.goto(new URL('../dist-single/printpath.html', import.meta.url).href); await p2.waitForTimeout(2000);
  await p2.click('[data-theme-btn="educator"]'); await p2.waitForTimeout(600);
  await p2.click('#open-projects'); await p2.click('#pj-grades .chip[data-v="K-2"]'); await p2.click('.card[data-id="cookie-cutter"] .star');
  await p2.click('.card[data-id="cookie-cutter"] .load'); await p2.waitForTimeout(1500);
  await p2.evaluate(() => window.__pp.go(2)); await p2.waitForTimeout(1200);
  await p2.screenshot({ path: (process.env.SHOT || '/tmp/pp-single.png').replace('.png', '-educator-cookie-slice.png') });
  console.log(JSON.stringify({ educatorOffline: { errs: e2, externalRequests: r2, theme: await p2.evaluate(() => document.documentElement.dataset.theme), preset: await p2.evaluate(() => window.__pp.preset()), layers: await p2.evaluate(() => window.__pp.sliced.sr.layers.length), favs: await p2.evaluate(() => localStorage.getItem('printpath.favourites.v1')) } }));
  await b2.close();
}
