import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5191/'); await page.waitForTimeout(2000);
await page.evaluate(() => { const st = window.__pp.stage; st.frame(0, 8, 0, 14, true); });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/pp-zoom.png', clip: { x: 200, y: 150, width: 800, height: 600 } });
// stress: biggest part, finest layers, 100% infill
const t = await page.evaluate(async () => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
  set('p-width', 80); set('p-depth', 60); set('p-height', 12);
  await new Promise((r) => setTimeout(r, 300));
  window.__pp.go(2);
  set('s-lh', 0.1); set('s-infill', 100);
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 200));
  const sl = window.__pp.sliced; // may still be the old one; force
  window.__pp.go(3);
  const t1 = performance.now();
  return { ms: Math.round(t1 - t0), ext: window.__pp.sliced.tp.extCount, layers: window.__pp.sliced.tp.layers, time: window.__pp.sliced.tp.time };
});
await page.waitForTimeout(1500);
const fps = await page.evaluate(() => new Promise((r) => { const s = window.__pp.sim; s.speed = 100; s.playing = true; let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
console.log(JSON.stringify({ t, fps, errs }));
await browser.close();
