#!/usr/bin/env node
/**
 * bughunt — the model bug-hunt Scout's DETERMINISTIC half. The model pass
 * (one bounded agent over a rotating code slice, dispatched by the slash
 * command's Phase B) produces candidate bugs as JSON; this module validates,
 * dedups, caps, and renders them into autoloop-queue.md items. No model here —
 * everything below is pure + harness-testable, mirroring scout-signals.js.
 *
 * A candidate is { title, file, symptom, repro_hint, fix_sketch, test_sketch,
 * severity, confidence }. Only candidates that (a) name a file that exists,
 * (b) carry a test_sketch (so Phase C can write a failing regression test),
 * and (c) clear the confidence floor survive — capped at maxNew, deduped
 * against the existing queue (any status, so a dismissed bug never returns).
 *
 * Exports: slug, candidateId, oneLine, rejectReason, filterCandidates,
 *          toQueueBlocks, nextArea, AREAS
 * CLI: node scripts/autoloop/bughunt.js next-area --turn <N>
 *      node scripts/autoloop/bughunt.js append --candidates <file.json> [--max <n>] [--min-confidence <0..1>]
 */
'use strict';

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

// Collapse newlines/runs of whitespace so a value stays a single queue line.
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// Stable id from the file's parent-dir + basename + title, so the same bug
// dedups across runs while same-basename files in different dirs (a/x.js vs
// b/x.js) stay distinct. (A reworded title still mints a new id — the safe
// direction: re-propose, never silently lose a different bug.)
function candidateId(c) {
  const file = String((c && c.file) || '');
  const parts = file.split('/');
  const dir = parts.length > 1 ? parts[parts.length - 2] : '';
  const base = (parts.pop() || '').replace(/\.[a-z0-9]+$/i, '');
  const tail = [dir, base].filter(Boolean).join('-');
  return slug(`bug-${tail}-${(c && c.title) || ''}`) || 'bug-unknown';
}

// Why a candidate is rejected, or null if it survives. Order matters: shape
// checks first, then dedup (so a dupe of a valid item reports "duplicate",
// not "no title").
function rejectReason(c, id, taken, batch, fileExists, minConfidence) {
  if (!c || !oneLine(c.title)) return 'no title';
  if (!c.file || !fileExists(c.file)) return `file missing: ${(c && c.file) || '(none)'}`;
  if (!oneLine(c.test_sketch)) return 'no test_sketch (cannot write a regression test)';
  const conf = Number(c.confidence);
  if (Number.isFinite(conf) && conf < minConfidence) return `confidence ${conf} < ${minConfidence}`;
  if (taken.has(id)) return 'already in queue (proposed or dismissed)';
  if (batch.has(id)) return 'duplicate within batch';
  return null;
}

/**
 * filterCandidates — validate + dedup + cap model candidates.
 * @returns {{survivors: object[], rejected: {id:string, reason:string}[]}}
 */
function filterCandidates(o) {
  const { candidates = [], haveIds = [], dismissedIds = [], fileExists = () => true,
    maxNew = 3, minConfidence = 0.6 } = o || {};
  const taken = new Set([...haveIds, ...dismissedIds]);
  const batch = new Set();
  const survivors = [];
  const rejected = [];
  for (const c of candidates) {
    const id = candidateId(c);
    const reason = rejectReason(c, id, taken, batch, fileExists, minConfidence);
    if (reason) { rejected.push({ id, reason }); continue; }
    batch.add(id);
    survivors.push({ ...c, id });
    if (survivors.length >= maxNew) break;
  }
  return { survivors, rejected };
}

// Render survivors as autoloop-queue.md items. The repro/fix/test plan is
// folded into a single rationale line so parseQueue (one line per key) keeps it
// intact and Phase C has everything it needs to write the fix + regression test.
function toQueueBlocks(items) {
  return items.map((it) => [
    `- id: ${it.id}`,
    `  title: ${oneLine(it.title)}`,
    '  category: bug',
    '  source: bug-hunt',
    `  file: ${oneLine(it.file)}`,
    `  severity: ${oneLine(it.severity) || 'unknown'}`,
    `  confidence: ${it.confidence != null ? it.confidence : 'unknown'}`,
    `  rationale: ${oneLine(`${it.symptom || ''} | repro: ${it.repro_hint || 'n/a'} | fix: ${it.fix_sketch || 'n/a'} | test: ${it.test_sketch}`)}`,
    '  status: proposed',
    '',
  ].join('\n')).join('\n');
}

// Rotating code slices: each discovery turn hunts ONE area (bounded + cheap);
// over N turns the whole platform is swept. Deterministic by turn number so the
// rotation is reproducible and the harness can assert it.
const AREAS = [
  { name: 'autoloop', globs: ['scripts/autoloop/*.js'], focus: 'loop selector / gate / reconcile logic' },
  { name: 'installer', globs: ['platform/install.js'], focus: 'install heals + claude_surface rewrite' },
  { name: 'finance-engine', globs: ['platform/blueprints/finance/scripts/**/*.js'], focus: 'payoff / envelope / plan math' },
  { name: 'project-widgets', globs: ['platform/blueprints/project/scripts/**/*.js'], focus: 'hub cards / nav / activity panels' },
  { name: 'meetings-todo', globs: ['platform/blueprints/meetings/scripts/**/*.js', 'platform/blueprints/to-do/scripts/**/*.js'], focus: 'task capture / action-item markers' },
  { name: 'mechanisms', globs: ['platform/mechanisms/**/*.js'], focus: 'cross-cutting render-safe / breadcrumb / section-label' },
];

function nextArea(turnN, areas = AREAS) {
  const n = Number(turnN);
  const i = Number.isFinite(n) && n >= 0 ? Math.floor(n) % areas.length : 0;
  return areas[i];
}

module.exports = { slug, candidateId, oneLine, rejectReason, filterCandidates, toQueueBlocks, nextArea, AREAS };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };

  if (cmd === 'next-area') {
    console.log(JSON.stringify(nextArea(flag('turn', '0'))));
    process.exit(0);
  }

  if (cmd === 'append') {
    const candPath = flag('candidates', '');
    let candidates = [];
    try { candidates = JSON.parse(read(candPath) || '[]'); } catch (_) { candidates = []; }
    if (!Array.isArray(candidates)) candidates = (candidates && Array.isArray(candidates.bugs)) ? candidates.bugs : [];

    const { parseQueue } = require('./select-card.js');
    const queuePath = path.join(ROOT, 'autoloop-queue.md');
    const queueMd = read(queuePath);
    const haveIds = parseQueue(queueMd).map((i) => i.id);
    const fileExists = (f) => { try { return fs.existsSync(path.resolve(ROOT, f)); } catch (_) { return false; } };

    const mc = Number(flag('min-confidence', '0.6'));
    const { survivors, rejected } = filterCandidates({
      candidates, haveIds, fileExists,
      maxNew: Number(flag('max', '3')) || 3,
      minConfidence: Number.isFinite(mc) ? mc : 0.6, // a garbage flag must not disable the floor
    });

    if (!survivors.length) { console.log(JSON.stringify({ added: 0, rejected }, null, 2)); process.exit(0); }
    fs.writeFileSync(queuePath, queueMd.replace(/\s*$/, '') + '\n\n' + toQueueBlocks(survivors), 'utf8');
    console.log(JSON.stringify({ added: survivors.length, ids: survivors.map((s) => s.id), rejected }, null, 2));
    process.exit(0);
  }

  console.error('usage: bughunt.js next-area --turn <N> | append --candidates <file.json> [--max <n>] [--min-confidence <0..1>]');
  process.exit(2);
}
