#!/usr/bin/env node
/**
 * scout-signals — deterministic Scout. Pure detectors that turn grounded
 * signals into SAFE-category (doc/test) queue items; CLI gathers real inputs,
 * dedups against the existing queue, caps the batch, and appends to
 * autoloop-queue.md. No model.
 *
 * Exports: coverageGapItems, docDriftItems, landmineGuardGapItems, toQueueBlocks, slug
 */
'use strict';

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

function coverageGapItems(matrix) {
  const items = [];
  for (const e of (matrix && matrix.entries) || []) {
    for (const [axis, a] of Object.entries(e.axes || {})) {
      if (typeof a.covered === 'number' && typeof a.total === 'number' && a.total > 0 && a.covered < a.total) {
        items.push({
          id: slug(`cov-${e.kind}-${e.name}-${axis}`),
          title: `Add coverage for ${e.name} ${axis} (${a.covered}/${a.total})`,
          category: 'test', source: 'coverage-matrix',
          rationale: `${e.kind} ${e.name} axis ${axis}: ${a.total - a.covered} uncovered`,
          status: 'proposed', _gap: a.total - a.covered,
        });
      }
    }
  }
  return items.sort((x, y) => y._gap - x._gap).map(({ _gap, ...it }) => it);
}

function docDriftItems(docFiles, exists) {
  const items = [];
  for (const f of docFiles || []) {
    for (const m of String(f.content).matchAll(/\]\(([^)]+?\.md)(?:#[^)]*)?\)/g)) {
      const target = m[1].trim();
      if (!target || /^https?:\/\//.test(target)) continue;
      if (!exists(target, f.path)) {
        items.push({
          id: slug(`dd-${target}-${String(f.path).split('/').pop()}`),
          title: `Fix broken link "${target}" in ${f.path}`,
          category: 'doc', source: 'doc-drift',
          rationale: `${f.path} links to ${target} which does not resolve`,
          status: 'proposed',
        });
      }
    }
  }
  return items;
}

function landmineGuardGapItems(landminesMd, hasGuard) {
  const items = [];
  const re = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(String(landminesMd || ''))) !== null) {
    const n = m[1], title = m[2];
    if (!hasGuard(n, title)) {
      items.push({
        id: `landmine-${n}-guard`,
        title: `Add a guard harness for landmine #${n}: ${title}`.slice(0, 100),
        category: 'test', source: 'landmine-guard',
        rationale: `Landmine #${n} has no detectable guard harness`,
        status: 'proposed',
      });
    }
  }
  return items;
}

function toQueueBlocks(items) {
  return items.map((it) => [
    `- id: ${it.id}`,
    `  title: ${it.title}`,
    `  category: ${it.category}`,
    `  source: ${it.source}`,
    `  rationale: ${it.rationale}`,
    `  status: ${it.status || 'proposed'}`,
    '',
  ].join('\n')).join('\n');
}

module.exports = { coverageGapItems, docDriftItems, landmineGuardGapItems, toQueueBlocks, slug };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const MAX_NEW = 5;
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };

  let cov = [];
  try { cov = coverageGapItems(JSON.parse(read(path.join(ROOT, 'platform/test/coverage-matrix.json')) || '{}')); } catch (_) {}

  const docFiles = [];
  (function walk(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) docFiles.push({ path: path.relative(ROOT, p), content: read(p) });
    }
  })(path.join(ROOT, 'Docs'));
  const exists = (target, fromPath) => {
    try { return fs.existsSync(path.resolve(ROOT, path.dirname(fromPath), target)); } catch (_) { return true; }
  };
  const dd = docDriftItems(docFiles, exists);

  const testDir = path.join(ROOT, 'platform/test');
  let testBlob = '';
  try { for (const f of fs.readdirSync(testDir)) if (/^run-.*\.js$/.test(f)) testBlob += '\n' + f + '\n' + read(path.join(testDir, f)); } catch (_) {}
  const hasGuard = (n) => new RegExp(`landmine[^0-9]{0,4}${n}\\b`, 'i').test(testBlob);
  const lm = landmineGuardGapItems(read(path.join(ROOT, 'Docs/landmines.md')), hasGuard);

  const { parseQueue } = require('./select-card.js');
  const queuePath = path.join(ROOT, 'autoloop-queue.md');
  const queueMd = read(queuePath);
  const have = new Set(parseQueue(queueMd).map((i) => i.id));
  // Dedup against the existing queue AND within this batch (ids can collide).
  const seen = new Set();
  const fresh = [];
  for (const it of [...cov, ...dd, ...lm]) {
    if (have.has(it.id) || seen.has(it.id)) continue;
    seen.add(it.id); fresh.push(it);
    if (fresh.length >= MAX_NEW) break;
  }

  if (!fresh.length) { console.log(JSON.stringify({ added: 0, reason: 'no new signals' })); process.exit(0); }
  fs.writeFileSync(queuePath, queueMd.replace(/\s*$/, '') + '\n\n' + toQueueBlocks(fresh), 'utf8');
  console.log(JSON.stringify({ added: fresh.length, ids: fresh.map((i) => i.id) }, null, 2));
  process.exit(0);
}
