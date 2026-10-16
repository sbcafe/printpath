import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = [], reqs = [];
page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) reqs.push(r.url()); });
await page.goto('file:///workspace/printpath/dist-single/printpath.html'); await page.waitForTimeout(2500);
await page.evaluate(() => window.__pp.go(3)); await page.waitForTimeout(1500);
await page.evaluate(() => { window.__pp.sim.setProgress(0.4); }); await page.waitForTimeout(800);
await page.screenshot({ path: '/workspace/printpath-shots/7-single-file-print-390x844.png' });
const nonBlank = await page.evaluate(() => { const c = document.querySelector('#c'); const g = c.getContext('webgl2') || c.getContext('webgl'); return !!g; });
// download STL via the button (blob, no network)
await page.evaluate(() => window.__pp.go(1)); await page.waitForTimeout(800);
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stl-dl')]);
const path = '/tmp/pp-test.stl'; await dl.saveAs(path);
console.log(JSON.stringify({ errs, externalRequests: reqs, webgl: nonBlank, download: dl.suggestedFilename(), dlPath: path }));
await browser.close();
