#!/usr/bin/env node
/**
 * Builds ONE PDF containing every supporting-evidence file under docs/evidence/.
 *
 * What it does beyond the technical-report builder:
 *   - embeds the screenshots inline where they are discussed
 *   - prints a table of contents with real page numbers (two-pass render)
 *   - appends every raw log in full, as <pre> blocks, so nothing is summarised away
 *   - verifies afterwards that each log's content actually reached the PDF
 *
 * Usage:
 *   node scripts/report/build-evidence-pdf.cjs
 *
 * Env:
 *   EVIDENCE_OUT_DIR   output directory (default: <repo>/../aic-req)
 *   CHROME_PATH        Chrome/Edge binary
 *   NODE_PATH          must expose puppeteer-core (this repo keeps it under work/pdfext)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const EVID = path.join(ROOT, 'docs', 'evidence');
const SHOTS = path.join(EVID, 'screenshots');
const LOGS = path.join(EVID, 'logs');
const OUT_DIR = process.env.EVIDENCE_OUT_DIR
  ? path.resolve(process.env.EVIDENCE_OUT_DIR)
  : path.resolve(ROOT, '..', 'aic-req');

const OUT_HTML = path.join(OUT_DIR, '佐证材料.html');
const OUT_PDF = path.join(OUT_DIR, '佐证材料.pdf');
const OUT_MANIFEST = path.join(OUT_DIR, '佐证材料-manifest.json');

const TITLE = '佐证材料';
const SUBTITLE = 'OpenClaw 新能源仿真 Skill：光伏发电与工业余热回收自动化评估';

// ---------------------------------------------------------------- helpers

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown: code spans first, then bold/italic. */
function inline(text) {
  let out = esc(text);
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(esc(code));
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

const slug = (s) =>
  s
    .replace(/[`*_[\]()（）·、，。：；！？"“”]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

/**
 * Converts the small markdown subset these documents use into HTML.
 * Returns { html, headings } where headings lets the caller build a TOC.
 */
function mdToHtml(md, opts = {}) {
  const { demote = 0, dropFirstH1 = false, anchors = true } = opts;
  const lines = md.split(/\r?\n/);
  const body = [];
  const headings = [];
  let i = 0;
  let seenH1 = false;
  let inCode = false;
  let codeBuf = [];
  let firstBlockDone = false;

  const flushCode = () => {
    if (!codeBuf.length) return;
    body.push(`<pre class="code"><code>${esc(codeBuf.join('\n'))}</code></pre>`);
    codeBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      if (inCode) { flushCode(); inCode = false; } else { inCode = true; }
      i += 1;
      continue;
    }
    if (inCode) { codeBuf.push(line); i += 1; continue; }

    // GFM table
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i += 1; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const align = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left'));
      body.push('<table>');
      body.push(`<thead><tr>${head.map((h, k) => `<th style="text-align:${align[k] || 'left'}">${inline(h)}</th>`).join('')}</tr></thead><tbody>`);
      for (const row of rows.slice(2)) {
        const cs = cells(row);
        body.push(`<tr>${cs.map((c, k) => `<td style="text-align:${align[k] || 'left'}">${inline(c)}</td>`).join('')}</tr>`);
      }
      body.push('</tbody></table>');
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      let level = h[1].length;
      const text = h[2].trim();
      i += 1;
      if (level === 1) {
        if (dropFirstH1 && !seenH1) { seenH1 = true; continue; }
        seenH1 = true;
      }
      level = Math.min(6, level + demote);
      const id = anchors ? ` id="${slug(text)}"` : '';
      if (level <= 3) headings.push({ level, text, id: anchors ? slug(text) : '' });
      body.push(`<h${level}${id}>${inline(text)}</h${level}>`);
      firstBlockDone = true;
      continue;
    }

    if (/^\s*<!--\s*pagebreak\s*-->\s*$/.test(line)) {
      body.push('<div class="pagebreak"></div>');
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) { body.push('<hr/>'); i += 1; continue; }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      body.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
      continue;
    }

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

    if (line.trim() === '') { i += 1; continue; }

    const para = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6}\s|>\s?|\||```|---+$)/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) { para.push(lines[i]); i += 1; }
    body.push(`<p>${inline(para.join(' '))}</p>`);
    firstBlockDone = true;
  }
  flushCode();
  return { html: body.join('\n'), headings };
}

/**
 * Reads text with BOM detection. A log captured with PowerShell's `>` redirection
 * is UTF-16LE, which renders as NUL-interleaved garbage if decoded as UTF-8.
 */
function read(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  return buf.toString('utf8');
}

/**
 * Normalises extracted PDF text for substring checks.
 * Page footers sit inside the text stream, so a paragraph that spans a page
 * break arrives with footer junk in the middle. Callers therefore probe with
 * short slices rather than whole lines.
 */
const norm = (s) => s.replace(/\s+/g, '');

/** Reduces markdown to roughly the text a renderer would emit. */
function plainify(md) {
  return md
    .split(/\r?\n/)
    .filter((l) => !/^```/.test(l))
    .map((l) =>
      l
        .replace(/^#{1,6}\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^\s*([-*]|\d+\.)\s+/, '')
        .replace(/^\|/, '')
        .replace(/\|$/, ''),
    )
    .join('\n')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\|/g, ' ')
    .replace(/<[^>]+>/g, '');
}

// ---------------------------------------------------------------- content plan

// Screenshots in the order the 03 document discusses them.
const SHOT_FILES = fs
  .readdirSync(SHOTS)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .sort();

const LOG_FILES = fs
  .readdirSync(LOGS)
  .filter((f) => fs.statSync(path.join(LOGS, f)).isFile())
  .sort();

// One-line purpose per log, keyed by filename prefix.
const LOG_PURPOSE = {
  '01-verify-skill.log': '技能包自检的七项检查结果',
  '02-smoke.log': '四套场景预设的引擎输出',
  '03-e2e-http.log': 'HTTP 提交、轮询、取结果的完整轨迹',
  '04-trigger-5mw.log': '中文指令触发 5MW 场景',
  '05-trigger-10mw.log': '中文指令触发 10MW 场景',
  '06-simulations-jobs.json': '服务端任务历史（原始 JSON）',
  '07-git-log.txt': '完整提交记录与远端分支',
  '08-commit-count.txt': '提交总数',
  '09-github-repo.json': 'GitHub 仓库元数据（公开性、默认分支、推送时间）',
  '10-github-commits.json': '远端提交列表',
  '11-github-readme-meta.json': 'README 存在性与大小',
  '12-github-root-tree.json': '远端根目录结构',
  '13-对话页面文本.txt': '网页对话的整页文本（含模型完整回复）',
  '14-对话对应任务号.json': '该次对话产生的任务号与会话地址',
};

// ---------------------------------------------------------------- build chapters

const chapters = []; // { num, title, html, headings, tocOnly }

function addChapter(num, title, mdText, opts = {}) {
  const { html, headings } = mdToHtml(mdText, { demote: 1, dropFirstH1: true, ...opts });
  chapters.push({ num, title, html, headings });
}

// 第一章：材料说明（README 的正文，去掉文件清单表格之外的引导语即可）
const readmeMd = read(path.join(EVID, 'README.md'));
addChapter('一', '材料说明', readmeMd);

// 第二章：测试记录
addChapter('二', '测试记录', read(path.join(EVID, '01-测试记录.md')));

// 第三章：仓库与提交记录
addChapter('三', '仓库与提交记录', read(path.join(EVID, '02-仓库与提交记录.md')));

// 第四章：截图与证据链（正文 + 每节后插图）
{
  const md = read(path.join(EVID, '03-截图清单.md'));
  const { html, headings } = mdToHtml(md, { demote: 1, dropFirstH1: true });

  // 在讨论某张图的小节之后插入该图（插到下一节标题之前，避免打断叙述）
  let withFigures = html;
  SHOT_FILES.forEach((file, n) => {
    const figure = `<figure class="shot">
  <img src="${path.join(SHOTS, file).replace(/\\/g, '/')}" alt="${esc(file)}"/>
  <figcaption>图 ${n + 1}　${esc(file)}</figcaption>
</figure>`;
    const idx = withFigures.indexOf(file);
    if (idx < 0) {
      withFigures += '\n' + figure;
      return;
    }
    const nextHeading = withFigures.indexOf('<h3', idx);
    const at = nextHeading >= 0 ? nextHeading : withFigures.length;
    withFigures = withFigures.slice(0, at) + figure + '\n' + withFigures.slice(at);
  });
  chapters.push({ num: '四', title: '截图与证据链', html: withFigures, headings });
}

// 第五章：自行核验方法
addChapter('五', '自行核验方法', read(path.join(EVID, '04-自行核验方法.md')));

// 附录 A：原始日志全文
{
  const parts = [];
  const headings = [];
  parts.push(
    `<p>本附录收录 <code>logs/</code> 下全部 ${LOG_FILES.length} 份原始输出，<strong>逐字收录，未做删减</strong>。` +
      `这些就是正文所引用数字的出处，可与正文逐条对照。</p>`,
  );
  LOG_FILES.forEach((file, n) => {
    const content = read(path.join(LOGS, file));
    const purpose = LOG_PURPOSE[file] || '';
    const id = `log-${n + 1}`;
    headings.push({ level: 3, text: `A.${n + 1}　${file}`, id });
    parts.push(`<h3 id="${id}">A.${n + 1}　${esc(file)}</h3>`);
    if (purpose) parts.push(`<p class="log-purpose">${esc(purpose)}</p>`);
    parts.push(
      `<p class="log-meta">文件大小 ${content.length.toLocaleString('en-US')} 字符　·　` +
        `SHA-256 <code>${crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)}…</code></p>`,
    );
    parts.push(`<pre class="log"><code>${esc(content)}</code></pre>`);
  });
  chapters.push({ num: '附录 A', title: '原始日志全文', html: parts.join('\n'), headings });
}

// 附录 B：文件清单与校验值
{
  const rows = [];
  const all = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else all.push(p);
    }
  };
  walk(EVID);
  all.sort();
  for (const p of all) {
    const buf = fs.readFileSync(p);
    rows.push({
      rel: path.relative(EVID, p).replace(/\\/g, '/'),
      size: buf.length,
      sha: crypto.createHash('sha256').update(buf).digest('hex'),
    });
  }
  const parts = [
    `<p>本材料文档（含截图与日志）共 <strong>${rows.length}</strong> 个文件。` +
      `下表列出每个文件的字节数与 SHA-256，可用于核对材料是否被改动。</p>`,
    '<table><thead><tr><th>文件</th><th style="text-align:right">字节</th><th>SHA-256</th></tr></thead><tbody>',
  ];
  for (const r of rows) {
    parts.push(`<tr><td><code>${esc(r.rel)}</code></td><td style="text-align:right">${r.size.toLocaleString('en-US')}</td><td><code class="hash">${r.sha}</code></td></tr>`);
  }
  parts.push('</tbody></table>');
  chapters.push({ num: '附录 B', title: '文件清单与校验值', html: parts.join('\n'), headings: [] });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), files: rows }, null, 2), 'utf8');
}

// ---------------------------------------------------------------- HTML assembly

function buildToc(pageMap) {
  const items = [];
  for (const c of chapters) {
    const page = pageMap ? pageMap[c.num] : null;
    const pn = page ? `<span class="toc-p">${page}</span>` : '<span class="toc-p"></span>';
    items.push(
      `<li class="toc-l1"><span class="toc-t">${esc(c.num)}　${esc(c.title)}</span>${pn}</li>`,
    );
    // 只列前 6 个二级条目，保证目录落在一页内
    for (const h of c.headings.filter((x) => x.level === 3).slice(0, 6)) {
      items.push(`<li class="toc-l2"><span class="toc-t">${esc(h.text)}</span></li>`);
    }
  }
  return `<ul class="toc">${items.join('')}</ul>`;
}

const CSS = `
  @page { size: A4; margin: 17mm 15mm 16mm 15mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    font-size: 9.7pt; line-height: 1.55; color: #111; margin: 0;
  }
  h1, h2, h3, h4 { line-height: 1.3; break-after: avoid-page; }
  h1 { font-size: 15.5pt; margin: 0 0 8pt; padding-bottom: 3pt; border-bottom: 2.2px solid #222; }
  h2 { font-size: 12.6pt; margin: 12pt 0 5pt; border-bottom: 1.3px solid #444; padding-bottom: 2pt; }
  h3 { font-size: 11pt; margin: 10pt 0 4pt; }
  h4 { font-size: 10.2pt; margin: 8pt 0 3pt; }
  p { margin: 3.6pt 0; text-align: justify; }
  ul, ol { margin: 3.6pt 0 3.6pt 17pt; padding: 0; }
  li { margin: 1.7pt 0; }
  code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 8.8pt; background: #f2f4f7; padding: 0.5pt 3pt; border-radius: 3px; }
  code.hash { font-size: 6.6pt; background: none; }
  pre.code { background: #f6f8fa; border: 1px solid #e2e6ea; border-left: 3px solid #4a6fa5; border-radius: 3px; padding: 5pt 7pt; margin: 4.5pt 0; font-size: 8.5pt; line-height: 1.4; white-space: pre-wrap; word-break: break-word; break-inside: avoid-page; }
  pre.code code { background: none; padding: 0; font-size: 8.5pt; }
  pre.log { background: #fbfcfd; border: 1px solid #dde3e9; border-left: 3px solid #7a8fa8; border-radius: 3px; padding: 5pt 7pt; margin: 3pt 0 9pt; font-size: 7.4pt; line-height: 1.35; white-space: pre-wrap; word-break: break-all; break-inside: auto; }
  pre.log code { background: none; padding: 0; font-size: 7.4pt; }
  .log-purpose { font-size: 9pt; color: #333; margin: 1pt 0; }
  .log-meta { font-size: 7.8pt; color: #666; margin: 0 0 2pt; }
  table { border-collapse: collapse; width: 100%; margin: 5pt 0; font-size: 8.9pt; break-inside: avoid-page; }
  th, td { border: 1px solid #c8ced6; padding: 2.8pt 4.4pt; vertical-align: top; }
  th { background: #eef2f7; font-weight: 600; }
  blockquote { margin: 4.5pt 0; padding: 3pt 7pt; border-left: 3px solid #b9c2cc; background: #fafbfc; color: #333; }
  blockquote p { margin: 1.5pt 0; }
  hr { border: none; border-top: 1px solid #d6dbe1; margin: 9pt 0; }
  .pagebreak { break-before: page; page-break-before: always; }

  section.cover { break-after: page; text-align: center; padding-top: 40mm; }
  .cover-org { font-size: 12.5pt; letter-spacing: 1px; color: #333; }
  .cover-sub { font-size: 10.5pt; color: #555; margin-top: 4pt; }
  .cover-title { font-size: 30pt; margin: 22pt 0 0; letter-spacing: 10px; border: none; }
  .cover-rule { width: 58%; margin: 14pt auto 20pt; border-top: 2px solid #222; }
  table.cover-fields { width: 82%; margin: 0 auto; font-size: 10.5pt; text-align: left; }
  table.cover-fields th { background: none; border: none; border-bottom: 1px solid #999; width: 27%; font-weight: 600; padding: 7pt 4pt; }
  table.cover-fields td { border: none; border-bottom: 1px solid #999; padding: 7pt 4pt; }
  .cover-note { width: 78%; margin: 26pt auto 0; font-size: 9pt; color: #555; text-align: left; line-height: 1.6; }

  section.toc-page { break-after: page; }
  h1.toc-title { border: none; font-size: 18pt; letter-spacing: 8px; margin-bottom: 12pt; }
  ul.toc { list-style: none; margin: 0; padding: 0; font-size: 10pt; }
  ul.toc li { margin: 0; }
  li.toc-l1 { display: flex; justify-content: space-between; align-items: baseline; margin: 7pt 0 2pt; font-weight: 600; }
  li.toc-l2 { display: flex; justify-content: space-between; margin: 1.2pt 0 1.2pt 16pt; font-size: 9pt; color: #444; }
  .toc-t { flex: 1; }
  .toc-p { margin-left: 8pt; min-width: 16pt; text-align: right; color: #333; }

  figure.shot { margin: 7pt 0 10pt; break-inside: avoid-page; text-align: center; }
  figure.shot img { width: 100%; border: 1px solid #c9d0d8; border-radius: 3px; }
  figure.shot figcaption { font-size: 8.4pt; color: #555; margin-top: 3pt; }
`;

function buildHtml(pageMap, opts = {}) {
  const { frontOnly = false } = opts;
  const cover = `<section class="cover">
    <div class="cover-org">2026 年第八届全球校园人工智能算法精英大赛</div>
    <div class="cover-sub">算法主题赛（AI+开源）</div>
    <h1 class="cover-title">${TITLE}</h1>
    <div class="cover-rule"></div>
    <table class="cover-fields">
      <tr><th>作品名称</th><td>OpenClaw 新能源仿真 Skill：光伏发电与工业余热回收自动化评估</td></tr>
      <tr><th>作品方向</th><td>开源项目改进与生态贡献</td></tr>
      <tr><th>团队名称</th><td>（待填）</td></tr>
      <tr><th>参赛编号</th><td>AIC-2026-（待填）</td></tr>
      <tr><th>材料类型</th><td>佐证材料（可选提交项）</td></tr>
      <tr><th>生成日期</th><td>2026 年 10 月 29 日</td></tr>
    </table>
    <div class="cover-note">
      <strong>本材料说明：</strong>全部内容由实际运行产生——日志是命令的真实输出，截图是真实浏览器访问运行中服务
      的屏幕截取，仓库数据取自 GitHub 官方 API 与本地 git 记录。收件内容包含 5 篇说明文档、5 张截图、
      14 份原始日志，以及文件校验清单，<strong>逐字收录、未做删减</strong>。
    </div>
  </section>`;

  const tocPage = `<section class="toc-page">
    <h1 class="toc-title">目　录</h1>
    ${buildToc(pageMap)}
  </section>`;

  const bodyParts = [];
  if (!frontOnly) {
    for (const c of chapters) {
      bodyParts.push(`<div class="pagebreak"></div>`);
      bodyParts.push(`<h1 id="${slug(c.num + c.title)}">${esc(c.num)}　${esc(c.title)}</h1>`);
      bodyParts.push(c.html);
    }
  }

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"/><title>${TITLE}</title><style>${CSS}</style></head>
<body>
${cover}
${tocPage}
${bodyParts.join('\n')}
</body></html>`;
}

// ---------------------------------------------------------------- PDF rendering

async function renderPdf(htmlPath, pdfPath, withFooter = true) {
  const puppeteer = require('puppeteer-core');
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const exe = candidates.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('找不到 Chrome/Edge 可执行文件');

  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: withFooter,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-family:'Microsoft YaHei',sans-serif;font-size:7.5pt;color:#666;padding:0 15mm;display:flex;justify-content:space-between;">
        <span>${TITLE} · OpenClaw 新能源仿真 Skill</span>
        <span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span>
      </div>`,
      margin: { top: '17mm', bottom: '16mm', left: '15mm', right: '15mm' },
    });
  } finally {
    await browser.close();
  }
}

/** Extracts normalised text per page, for TOC page numbers and content checks. */
async function readPages(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => it.str).join('').replace(/\s+/g, '');
    pages.push(text);
  }
  return pages;
}

/**
 * Samples short slices spread across a text file and reports how many are
 * present in the extracted PDF text. Slice-based probing survives page breaks,
 * where the footer text lands in the middle of a long line.
 */
function auditText(fileText, pdfText, sliceLen = 20, samples = 24) {
  const flat = norm(fileText);
  if (!flat) return { found: 0, total: 0, ratio: 1 };
  if (flat.length <= sliceLen) {
    const ok = pdfText.includes(flat);
    return { found: ok ? 1 : 0, total: 1, ratio: ok ? 1 : 0 };
  }
  const total = Math.min(samples, Math.max(1, Math.floor(flat.length / sliceLen)));
  let found = 0;
  for (let k = 0; k < total; k++) {
    const at = Math.floor((flat.length - sliceLen) * (k / (total - 1)));
    const slice = flat.slice(at, at + sliceLen);
    if (slice.length === sliceLen && pdfText.includes(slice)) found += 1;
  }
  return { found, total, ratio: total ? found / total : 1 };
}

// ---------------------------------------------------------------- main

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('assembling evidence document');
  for (const c of chapters) {
    console.log(`  ${c.num}  ${c.title}  (${(c.html.length / 1024).toFixed(1)} KB html)`);
  }

  // Measure how many pages the front matter (cover + TOC) takes. Chapters start
  // right after it, which is what makes the chapter lookup unambiguous: the TOC
  // page also contains every chapter title, so a naive search matches page 2.
  console.log('\npass 0: measure front matter');
  fs.writeFileSync(OUT_HTML, buildHtml(null, { frontOnly: true }), 'utf8');
  const frontPdf = path.join(OUT_DIR, '.evidence-front.pdf');
  await renderPdf(OUT_HTML, frontPdf);
  const frontPages = (await readPages(frontPdf)).length;
  fs.unlinkSync(frontPdf);
  console.log(`  cover + TOC = ${frontPages} page(s); chapters start on page ${frontPages + 1}`);

  // Pass 1: render the whole thing, then locate each chapter's first page.
  console.log('\npass 1: render to locate chapters');
  fs.writeFileSync(OUT_HTML, buildHtml(null), 'utf8');
  const tmpPdf = path.join(OUT_DIR, '.evidence-pass1.pdf');
  await renderPdf(OUT_HTML, tmpPdf);
  const pages1 = await readPages(tmpPdf);
  console.log(`  ${pages1.length} pages`);

  const pageMap = {};
  for (const c of chapters) {
    const needle = norm(`${c.num}${c.title}`);
    const idx = pages1.findIndex((t, n) => n >= frontPages && t.includes(needle));
    pageMap[c.num] = idx >= 0 ? idx + 1 : null;
    console.log(`  ${c.num} ${c.title} -> page ${pageMap[c.num] || '?'}`);
  }

  // Pass 2: re-render with the page numbers in the TOC.
  console.log('\npass 2: render with TOC page numbers');
  fs.writeFileSync(OUT_HTML, buildHtml(pageMap), 'utf8');
  await renderPdf(OUT_HTML, OUT_PDF);
  fs.unlinkSync(tmpPdf);

  const pages = await readPages(OUT_PDF);
  const allText = pages.join('');
  const size = fs.statSync(OUT_PDF).size;
  console.log(`  ${pages.length} pages, ${(size / 1024 / 1024).toFixed(2)} MB`);

  // ---- content audit: every log's actual content must appear in the PDF ----
  console.log('\ncontent audit (nothing dropped)');
  const auditRows = [];
  let missing = 0;
  for (const file of LOG_FILES) {
    const raw = read(path.join(LOGS, file));
    const a = auditText(raw, allText);
    const ok = a.ratio >= 0.9;
    if (!ok) missing += 1;
    auditRows.push({ file, ...a, ok });
    console.log(`  ${ok ? 'ok  ' : 'MISS'} ${file.padEnd(30)} ${a.found}/${a.total} slices`);
  }

  // ---- 正文抽查：以「已生成的 HTML」为参照（markdown 标记在渲染时会被去掉，
  //      直接用 md 作参照会因表格分隔行、分隔线等被丢弃而错位）----
  // 正文含大量中文标点与符号，PDF 文本层对个别字形（·、（、→）的提取可能与源文
  // 不一致，因此这里作为「告警」而非硬失败；真正的硬校验放在日志与图片嵌入上。
  console.log('\nbody audit');
  const stripTags = (html) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  const bodyWarn = [];
  for (const c of chapters) {
    const a = auditText(stripTags(c.html), allText);
    const ok = a.ratio >= 0.9;
    if (!ok) bodyWarn.push(`${c.num} ${c.title} (${a.found}/${a.total})`);
    auditRows.push({ file: `${c.num} ${c.title}`, ...a, ok, kind: 'chapter' });
    console.log(`  ${ok ? 'ok  ' : 'warn'} ${(`${c.num} ${c.title}`).padEnd(24)} ${a.found}/${a.total} slices`);
  }

  // ---- 硬校验：5 张图必须真的嵌进 PDF（图片对象数 ≥ 5）----
  const raw = fs.readFileSync(OUT_PDF).toString('latin1');
  const imageObjects = (raw.match(/\/Subtype\s*\/Image/g) || []).length;
  const imagesOk = imageObjects >= SHOT_FILES.length;
  console.log(`\n  image objects in PDF: ${imageObjects} (need >= ${SHOT_FILES.length}) ${imagesOk ? 'ok' : 'MISS'}`);
  if (!imagesOk) missing += 1;

  // ---- images present? ----
  const shots = SHOT_FILES.map((f) => {
    const stem = f.replace(/\.png$/i, '');
    const found = allText.includes(stem.slice(0, 10)) || allText.includes(stem.slice(0, 6));
    return { file: f, captionFound: found };
  });
  console.log(`\n  screenshots: ${SHOT_FILES.length}, captions found: ${shots.filter((s) => s.captionFound).length}`);

  const report = {
    generatedAt: new Date().toISOString(),
    pdf: OUT_PDF,
    pages: pages.length,
    frontPages,
    bytes: size,
    chapters: chapters.map((c) => ({ num: c.num, title: c.title, page: pageMap[c.num] })),
    logs: LOG_FILES.length,
    screenshots: SHOT_FILES.length,
    imageObjects,
    audits: auditRows,
    bodyWarnings: bodyWarn,
    missing,
  };
  fs.writeFileSync(path.join(OUT_DIR, '佐证材料-build.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(`\nwrote ${OUT_PDF}`);
  if (bodyWarn.length) console.log(`note: ${bodyWarn.length} chapter(s) below the 90% slice match (prose only): ${bodyWarn.join(', ')}`);
  if (missing) {
    console.error(`\n${missing} hard check(s) failed`);
    process.exit(1);
  }
})();
