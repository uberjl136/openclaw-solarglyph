// Reports page count and basic metadata for a generated PDF, so the 15-page
// competition limit can be verified rather than assumed.
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const [, , input] = process.argv;
const buf = await readFile(input);
const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;

console.log(`file      : ${input}`);
console.log(`bytes     : ${buf.length} (${(buf.length / 1048576).toFixed(2)} MB)`);
console.log(`pages     : ${doc.numPages}`);
console.log(`limit     : 15 pages / 10 MB`);
console.log(`within 15 : ${doc.numPages <= 15 ? 'YES' : 'NO — needs trimming'}`);
console.log(`within 10MB: ${buf.length <= 10 * 1048576 ? 'YES' : 'NO'}`);

for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const chars = content.items.reduce((a, it) => a + (it.str ? it.str.length : 0), 0);
  const first = content.items.find((it) => it.str && it.str.trim());
  console.log(
    `  p${String(p).padStart(2)}  ${Math.round(viewport.width)}x${Math.round(viewport.height)}  ${String(chars).padStart(5)} chars  ${first ? first.str.trim().slice(0, 46) : '(empty)'}`,
  );
}
