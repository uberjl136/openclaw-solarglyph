// Renders the report HTML with Chrome's *print* media (same engine path as
// --print-to-pdf) and screenshots it in page-sized slices, so the output can be
// inspected visually. CSS transform scaling lets us capture the full print
// layout in one tall screenshot without the screen-media fallback.
import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , htmlPath, outDir] = process.argv;
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// A4 at 96dpi, minus the @page margins from the report stylesheet.
const PAGE_W = 794;
const PAGE_H = 1123;

await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.emulateMediaType('print');
await page.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: 1.5 });
await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 800));

const metrics = await page.evaluate(() => ({
  scrollHeight: document.documentElement.scrollHeight,
  scrollWidth: document.documentElement.scrollWidth,
  // widest table, to catch horizontal overflow
  widest: Math.max(
    0,
    ...[...document.querySelectorAll('table, pre')].map((el) => Math.ceil(el.getBoundingClientRect().width)),
  ),
  bodyFont: getComputedStyle(document.body).fontFamily,
}));
console.log('metrics:', JSON.stringify(metrics));

const slices = Math.min(20, Math.ceil(metrics.scrollHeight / PAGE_H));
for (let i = 0; i < slices; i += 1) {
  const y = i * PAGE_H;
  await page.screenshot({
    path: path.join(outDir, `slice-${String(i + 1).padStart(2, '0')}.png`),
    clip: { x: 0, y, width: PAGE_W, height: Math.min(PAGE_H, metrics.scrollHeight - y) },
  });
}
console.log(`wrote ${slices} slice(s) to ${outDir}`);

await browser.close();
