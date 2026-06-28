#!/usr/bin/env node
/**
 * select-card — deterministic work selector for the Sauce Autoloop.
 * Pure functions over board markdown; no model, no side effects.
 *
 * Exports: selectCard, isBroadScope, parseBoard, recommendedFrom
 * CLI: node scripts/autoloop/select-card.js --board <p> --handoff <p> [--halt <p>] [--cards-root <p>] [--json]
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Broad-scope heuristic: signals multi-cycle work the autonomous loop must NOT
// pick (it would run unbounded). Deterministic mirror of the human pipeline's
// Phase B scope sanity-check.
const BROAD_PATTERNS = [
  /\baudit\b/i, /\bredesign\b/i, /\broadmap\b/i, /\boverhaul\b/i,
  /\beverything\b/i, /\ball (blueprints|mechanisms|vaults)\b/i,
  /\bmigrat(e|ion) (all|every)\b/i, /\bfigure out\b/i,
];

function isBroadScope(text) {
  if (!text) return { broad: false, reason: null };
  for (const re of BROAD_PATTERNS) {
    if (re.test(text)) return { broad: true, reason: `matched ${re}` };
  }
  if (text.length > 1200) return { broad: true, reason: 'body > 1200 chars' };
  return { broad: false, reason: null };
}

// Parse a kanban-ish board markdown into columns -> arrays of card link names.
function parseBoard(md) {
  const cols = { 'In Planning': [], 'In Progress': [], 'Blocked': [], 'Completed': [] };
  let cur = null;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { const name = h[1].trim(); cur = Object.prototype.hasOwnProperty.call(cols, name) ? name : null; continue; }
    if (!cur) continue;
    const m = raw.match(/^\s*-\s*(?:\[[ xX]?\]\s*)?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) cols[cur].push(m[1].trim());
  }
  return cols;
}

// Names of cards in the "In Planning" column that are [x]/[X]-checked (treated
// as done, not pickable). Scoped to In Planning only.
function parsePlanningChecked(md) {
  const set = new Set();
  let inPlanning = false;
  for (const raw of String(md || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { inPlanning = h[1].trim() === 'In Planning'; continue; }
    if (!inPlanning) continue;
    const m = raw.match(/^\s*-\s*\[[xX]\]\s*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/);
    if (m) set.add(m[1].trim());
  }
  return set;
}

// Extract the "Recommended next" card name from a handoff markdown, if present.
function recommendedFrom(handoffMd) {
  if (!handoffMd) return null;
  const m = String(handoffMd).match(/##\s*Recommended next[\s\S]*?\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/i);
  return m ? m[1].trim() : null;
}

/**
 * selectCard — decide what (if anything) this turn should work on.
 * @returns {{action:string, card?:string, reason:string, skipped?:Array, cards?:string[]}}
 */
function selectCard(o) {
  const { haltExists, boardMd, handoffMd, loadBody } = o || {};
  if (haltExists) return { action: 'halt', reason: 'kill-switch sentinel present' };
  const cols = parseBoard(boardMd);
  const planning = cols['In Planning'];
  if (!planning.length) return { action: 'no-work', reason: 'Planning column empty' };
  const rec = recommendedFrom(handoffMd);
  const ordered = rec && planning.includes(rec)
    ? [rec, ...planning.filter((c) => c !== rec)]
    : planning.slice();
  const skipped = [];
  const checked = parsePlanningChecked(boardMd);
  for (const card of ordered) {
    if (checked.has(card)) { skipped.push({ card, reason: 'checked (done) in Planning' }); continue; }
    const body = loadBody ? (loadBody(card) || '') : '';
    const scope = isBroadScope(`${card}\n${body}`);
    if (scope.broad) { skipped.push({ card, reason: scope.reason }); continue; }
    return {
      action: 'work', card, skipped,
      reason: rec === card ? 'recommended + in-scope' : 'first in-scope Planning card',
    };
  }
  return { action: 'no-eligible-work', reason: 'all Planning cards are broad-scope', skipped };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) { const key = k.slice(2); const v = argv[i + 1]; if (v && !v.startsWith('--')) { a[key] = v; i++; } else a[key] = true; }
  }
  return a;
}

function cliLoadBody(cardsRoot) {
  return (card) => {
    if (!cardsRoot) return '';
    // tasks/<W>/board/<Card>/<Card>.md — recursive basename match.
    try {
      const fname = `${card}.md`;
      const stack = [cardsRoot];
      while (stack.length) {
        const dir = stack.pop();
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) stack.push(p);
          else if (ent.name === fname) return fs.readFileSync(p, 'utf8');
        }
      }
    } catch (_) { /* fall through */ }
    return '';
  };
}

module.exports = { selectCard, isBroadScope, parseBoard, recommendedFrom, parsePlanningChecked };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };
  const result = selectCard({
    haltExists: args.halt ? fs.existsSync(args.halt) : false,
    boardMd: args.board ? read(args.board) : '',
    handoffMd: args.handoff ? read(args.handoff) : '',
    loadBody: cliLoadBody(args['cards-root']),
  });
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.action}${result.card ? ': ' + result.card : ''} — ${result.reason}`);
  process.exit(0);
}
