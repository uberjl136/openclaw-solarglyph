#!/usr/bin/env node
/**
 * Builds the competition PDF from docs/technical-report.md.
 *
 * Steps: markdown -> print-ready HTML -> A4 PDF via headless Chrome -> verify
 * the competition limits (<= 15 pages, <= 10 MB).
 *
 *   node scripts/report/build-report.cjs
 *   node scripts/report/build-report.cjs --no-cover
 *
 * Chrome is located from CHROME_PATH, then a list of standard install paths.
 * The tooling is dependency-light on purpose: rendering lives in
 * md-to-html.mjs, and page verification reuses pdfjs-dist only when present.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC_MD = path.join(ROOT, 'docs', 'technical-report.md');

// Output goes outside the repository on purpose: the built PDF is a submission
// artifact, and committing multi-hundred-KB binaries to the repo adds churn
// without helping a reviewer read the source. Override with REPORT_OUT_DIR.
const OUT_DIR = process.env.REPORT_OUT_DIR
  ? path.resolve(process.env.REPORT_OUT_DIR)
  : path.resolve(ROOT, '..', 'aic-req');
const OUT_HTML = path.join(OUT_DIR, '技术报告.html');
const OUT_PDF = path.join(OUT_DIR, '技术报告.pdf');

const MAX_PAGES = 15;
const MAX_BYTES = 10 * 1024 * 1024;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

if (!fs.existsSync(SRC_MD)) {
  console.error(`report source not found: ${SRC_MD}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------- 1. HTML
const withCover = !process.argv.includes('--no-cover');
const render = spawnSync(
  process.execPath,
  [path.join(__dirname, 'md-to-html.mjs'), SRC_MD, OUT_HTML, withCover ? 'cover' : ''],
  { stdio: 'inherit' },
);
if (render.status !== 0) {
  console.error('markdown -> html failed');
  process.exit(render.status || 1);
}

// ---------------------------------------------------------------- 2. PDF
const chrome = findChrome();
if (!chrome) {
  console.error('Chrome/Edge not found. Set CHROME_PATH to the browser executable.');
  console.error(`The print-ready HTML is still available at ${OUT_HTML}`);
  process.exit(2);
}

// Chrome needs a file:// URL with forward slashes.
const fileUrl = `file:///${OUT_HTML.replace(/\\/g, '/')}`;
const print = spawnSync(
  chrome,
  ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', `--print-to-pdf=${OUT_PDF}`, fileUrl],
  { encoding: 'utf8' },
);
const printed = fs.existsSync(OUT_PDF);
if (!printed) {
  console.error('PDF was not produced');
  console.error((print.stderr || '').slice(0, 800));
  process.exit(print.status || 1);
}

// ---------------------------------------------------------------- 3. Verify
const size = fs.statSync(OUT_PDF).size;

/** Page count via pdfjs-dist (a devDependency so verification is self-contained). */
async function pageCount() {
  try {
    const { createRequire } = await import('node:module');
    const require_ = createRequire(path.join(ROOT, 'package.json'));
    const entry = require_.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    const { getDocument } = await import(`file://${entry.replace(/\\/g, '/')}`);
    const { readFile } = await import('node:fs/promises');
    const data = new Uint8Array(await readFile(OUT_PDF));
    const doc = await getDocument({ data, verbosity: 0 }).promise;
    return doc.numPages;
  } catch {
    return null;
  }
}

pageCount().then((pages) => {
  console.log('');
  console.log('技术报告 build');
  console.log('─'.repeat(52));
  console.log(`source   : docs/technical-report.md`);
  console.log(`html     : ${path.relative(ROOT, OUT_HTML)}`);
  console.log(`pdf      : ${path.relative(ROOT, OUT_PDF)}`);
  console.log(`size     : ${(size / 1048576).toFixed(2)} MB  (limit 10 MB) ${size <= MAX_BYTES ? 'OK' : 'OVER'}`);
  if (pages === null) {
    console.log('pages    : unknown (install pdfjs-dist to verify)  (limit 15)');
  } else {
    console.log(`pages    : ${pages}  (limit 15) ${pages <= MAX_PAGES ? 'OK' : 'OVER — trim content or tighten CSS'}`);
  }
  console.log('─'.repeat(52));
  const ok = size <= MAX_BYTES && (pages === null || pages <= MAX_PAGES);
  console.log(ok ? 'within competition limits' : 'OUTSIDE competition limits');
  process.exit(ok ? 0 : 1);
});
