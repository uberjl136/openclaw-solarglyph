#!/usr/bin/env node
/**
 * Prints the code-size split between our work and the vendored upstream
 * snapshot. Used as evidence for the report: it quantifies the extension.
 *
 *   node scripts/stats.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const UPSTREAM = path.join(ROOT, 'upstream', 'openclaw-main');

/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-runtime',
  'build',
  '.artifacts',
  'coverage',
  '.turbo',
  'locale-modules',
]);

/** Language buckets, by extension. */
const LANG = {
  '.js': 'JavaScript',
  '.cjs': 'JavaScript',
  '.mjs': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.json5': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.swift': 'Swift',
  '.kt': 'Kotlin',
  '.css': 'CSS',
  '.sh': 'Shell',
};

function walk(dir, acc, { skipSkill = false } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Our extension inside the snapshot is counted as our work, not upstream.
      if (skipSkill && entry.name === 'solar-glyph-simulation') continue;
      walk(full, acc, { skipSkill });
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    const lang = LANG[ext];
    if (!lang) continue;
    let size = 0;
    let lines = 0;
    try {
      const text = fs.readFileSync(full, 'utf8');
      size = Buffer.byteLength(text);
      lines = text.split('\n').length;
    } catch {
      continue;
    }
    acc.push({ lang, size, lines });
  }
  return acc;
}

function summarize(rows) {
  const byLang = new Map();
  let size = 0;
  let lines = 0;
  for (const row of rows) {
    const cur = byLang.get(row.lang) || { size: 0, lines: 0, files: 0 };
    cur.size += row.size;
    cur.lines += row.lines;
    cur.files += 1;
    byLang.set(row.lang, cur);
    size += row.size;
    lines += row.lines;
  }
  return { byLang, size, lines, files: rows.length };
}

/** Our code: everything in work/solarglyph-skill except the vendored snapshot. */
const ourFiles = [];
walk(path.join(ROOT, 'solarglyph-core'), ourFiles);
walk(path.join(ROOT, 'scripts'), ourFiles);
walk(path.join(ROOT, 'skills'), ourFiles);
walk(path.join(ROOT, 'docs'), ourFiles);
for (const file of ['README.md', 'LICENSE', 'package.json']) {
  const full = path.join(ROOT, file);
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, 'utf8');
    ourFiles.push({ lang: file.endsWith('.md') ? 'Markdown' : file.endsWith('.json') ? 'JSON' : 'Text', size: Buffer.byteLength(text), lines: text.split('\n').length });
  }
}

const upstreamFiles = fs.existsSync(UPSTREAM) ? walk(UPSTREAM, [], { skipSkill: true }) : [];

const ours = summarize(ourFiles);
const upstream = summarize(upstreamFiles);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0%');

console.log('SolarGlyph skill — code footprint');
console.log('═'.repeat(62));
console.log(`our extension      : ${ours.files} files, ${ours.lines} lines, ${kb(ours.size)}`);
console.log(`upstream snapshot  : ${upstream.files} files, ${upstream.lines} lines, ${kb(upstream.size)}`);
console.log(`our share of bytes : ${pct(ours.size, ours.size + upstream.size)} (${((ours.size / (ours.size + upstream.size)) * 100).toFixed(3)}%)`);
console.log('─'.repeat(62));
console.log('our files by language:');
for (const [lang, v] of [...ours.byLang.entries()].sort((a, b) => b[1].size - a[1].size)) {
  console.log(`  ${lang.padEnd(12)} ${String(v.files).padStart(3)} files  ${String(v.lines).padStart(6)} lines  ${kb(v.size)}`);
}
console.log('─'.repeat(62));
console.log('upstream files by language (top 6):');
for (const [lang, v] of [...upstream.byLang.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6)) {
  console.log(`  ${lang.padEnd(12)} ${String(v.files).padStart(5)} files  ${String(v.lines).padStart(7)} lines  ${kb(v.size)}`);
}
