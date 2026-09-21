// Renders docs/technical-report.md into a print-ready HTML file (A4, CJK fonts,
// page numbers via @page margins) that headless Chrome can turn into a PDF.
//
// The markdown subset used by the report is small enough that a focused
// converter is more predictable than a general library: headings, GFM tables,
// fenced code, blockquotes, ordered/unordered lists, horizontal rules, and
// inline code / bold. Everything is HTML-escaped first.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , mdPath, htmlPath, coverTitle] = process.argv;
if (!mdPath || !htmlPath) {
  console.error('usage: node md-to-html.mjs <report.md> <out.html> [coverTitle]');
  process.exit(2);
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline formatting: code spans first so bold inside code is untouched. */
function inline(text) {
  let out = esc(text);
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

const lines = (await readFile(mdPath, 'utf8')).split(/\r?\n/);
const body = [];
let i = 0;
let inCode = false;
let codeLang = '';
let codeBuf = [];

function flushCode() {
  if (!codeBuf.length) return;
  body.push(`<pre class="code${codeLang ? ` lang-${codeLang}` : ''}"><code>${esc(codeBuf.join('\n'))}</code></pre>`);
  codeBuf = [];
  codeLang = '';
}

while (i < lines.length) {
  const line = lines[i];

  // fenced code
  const fence = /^```(.*)$/.exec(line);
  if (fence) {
    if (inCode) {
      flushCode();
      inCode = false;
    } else {
      inCode = true;
      codeLang = fence[1].trim();
    }
    i += 1;
    continue;
  }
  if (inCode) {
    codeBuf.push(line);
    i += 1;
    continue;
  }

  // table
  if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
    const rows = [];
    while (i < lines.length && /^\|/.test(lines[i])) {
      rows.push(lines[i]);
      i += 1;
    }
    const cells = (r) =>
      r
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
    const head = cells(rows[0]);
    const bodyRows = rows.slice(2).map(cells);
    const align = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left'));
    body.push('<table>');
    body.push(
      `<thead><tr>${head.map((h, k) => `<th style="text-align:${align[k] || 'left'}">${inline(h)}</th>`).join('')}</tr></thead>`,
    );
    body.push('<tbody>');
    for (const row of bodyRows) {
      body.push(
        `<tr>${row.map((c, k) => `<td style="text-align:${align[k] || 'left'}">${inline(c)}</td>`).join('')}</tr>`,
      );
    }
    body.push('</tbody></table>');
    continue;
  }

  // headings
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) {
    const level = h[1].length;
    body.push(`<h${level}>${inline(h[2])}</h${level}>`);
    i += 1;
    continue;
  }

  // horizontal rule
  if (/^---+$/.test(line.trim())) {
    body.push('<hr/>');
    i += 1;
    continue;
  }

  // blockquote
  if (/^>\s?/.test(line)) {
    const quote = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) {
      quote.push(lines[i].replace(/^>\s?/, ''));
      i += 1;
    }
    body.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
    continue;
  }

  // lists
  if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
    const ordered = /^\s*\d+\.\s+/.test(line);
    const items = [];
    while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      i += 1;
    }
    const tag = ordered ? 'ol' : 'ul';
    body.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
    continue;
  }

  // blank
  if (line.trim() === '') {
    i += 1;
    continue;
  }

  // paragraph (gather until blank / block start)
  const para = [line];
  i += 1;
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !/^(#{1,6}\s|>\s?|\||```|---+$)/.test(lines[i]) &&
    !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
  ) {
    para.push(lines[i]);
    i += 1;
  }
  body.push(`<p>${inline(para.join(' '))}</p>`);
}
flushCode();

const cover = coverTitle
  ? `<section class="cover">
      <div class="cover-org">2026 年第八届全球校园人工智能算法精英大赛</div>
      <div class="cover-sub">算法主题赛（AI+开源）</div>
      <h1 class="cover-title">技术报告</h1>
      <div class="cover-rule"></div>
      <table class="cover-fields">
        <tr><th>团队名称</th><td>（待填）</td></tr>
        <tr><th>参赛编号</th><td>AIC-2026-（待填）</td></tr>
        <tr><th>作品名称</th><td>OpenClaw 新能源仿真 Skill：光伏发电与工业余热回收自动化评估</td></tr>
        <tr><th>参赛方向</th><td>开源项目改进与生态贡献</td></tr>
        <tr><th>日期</th><td>2026 年 &nbsp; 月 &nbsp; 日</td></tr>
      </table>
    </section>`
  : '';

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>技术报告</title>
<style>
  @page { size: A4; margin: 16mm 15mm 14mm 15mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
    font-size: 9.8pt;
    line-height: 1.5;
    color: #111;
    margin: 0;
  }
  h1, h2, h3, h4 { line-height: 1.3; break-after: avoid-page; }
  h1 { font-size: 14.5pt; margin: 12pt 0 6pt; }
  h2 { font-size: 12.5pt; margin: 11pt 0 5pt; border-bottom: 1.4px solid #222; padding-bottom: 2pt; }
  h3 { font-size: 11pt; margin: 9pt 0 4pt; }
  h4 { font-size: 10.2pt; margin: 7pt 0 3pt; }
  p { margin: 3.5pt 0; text-align: justify; }
  ul, ol { margin: 3.5pt 0 3.5pt 17pt; padding: 0; }
  li { margin: 1.6pt 0; }
  code {
    font-family: Consolas, "Cascadia Mono", monospace;
    font-size: 9pt;
    background: #f2f4f7;
    padding: 0.5pt 3pt;
    border-radius: 3px;
  }
  pre.code {
    background: #f6f8fa;
    border: 1px solid #e2e6ea;
    border-left: 3px solid #4a6fa5;
    border-radius: 3px;
    padding: 5pt 7pt;
    margin: 4.5pt 0;
    font-size: 8.6pt;
    line-height: 1.38;
    white-space: pre-wrap;
    word-break: break-word;
    break-inside: avoid-page;
  }
  pre.code code { background: none; padding: 0; font-size: 8.6pt; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 5pt 0;
    font-size: 9pt;
    break-inside: avoid-page;
  }
  th, td { border: 1px solid #c8ced6; padding: 2.8pt 4.5pt; vertical-align: top; }
  th { background: #eef2f7; font-weight: 600; }
  blockquote {
    margin: 4.5pt 0;
    padding: 3pt 7pt;
    border-left: 3px solid #b9c2cc;
    background: #fafbfc;
    color: #333;
  }
  blockquote p { margin: 1.5pt 0; }
  hr { border: none; border-top: 1px solid #d6dbe1; margin: 8pt 0; }
  section.cover {
    break-after: page;
    text-align: center;
    padding-top: 45mm;
    page-break-after: always;
  }
  .cover-org { font-size: 13pt; letter-spacing: 1px; }
  .cover-sub { font-size: 11pt; color: #444; margin-top: 4pt; }
  .cover-title { font-size: 26pt; margin: 26pt 0 0; letter-spacing: 6px; }
  .cover-rule { width: 62%; margin: 12pt auto 22pt; border-top: 2px solid #222; }
  table.cover-fields { width: 78%; margin: 0 auto; font-size: 11pt; text-align: left; }
  table.cover-fields th {
    background: none;
    border: none;
    border-bottom: 1px solid #999;
    width: 26%;
    font-weight: 600;
    padding: 7pt 4pt;
  }
  table.cover-fields td { border: none; border-bottom: 1px solid #999; padding: 7pt 4pt; }
</style>
</head>
<body>
${cover}
${body.join('\n')}
</body>
</html>
`;

await writeFile(htmlPath, html, 'utf8');
console.log(`rendered ${path.basename(htmlPath)}  ${(html.length / 1024).toFixed(1)} KB  (${body.length} blocks)`);
