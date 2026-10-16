// Deterministic print clip: step the sim per frame, screenshot, encode with system ffmpeg.
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
const dir = '/tmp/pp-frames'; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
await page.goto('http://127.0.0.1:5191/'); await page.waitForTimeout(1500);
await page.evaluate(() => window.__pp.go(3)); await page.waitForTimeout(1500);
await page.evaluate(() => { const s = window.__pp.sim; s.speed = 0; s.playing = true; });
const FPS = 24, N = FPS * 10;
for (let i = 0; i < N; i++) {
  if (i === Math.floor(N * 0.55)) await page.click('#pr-cut');
  await page.evaluate((f) => new Promise((r) => { window.__pp.sim.setProgress(f); window.__pp.sim.playing = true; requestAnimationFrame(() => requestAnimationFrame(r)); }), 0.04 + 0.9 * (i / (N - 1)));
  await page.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.png` });
}
await browser.close();
