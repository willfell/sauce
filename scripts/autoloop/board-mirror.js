#!/usr/bin/env node
/**
 * board-mirror — project the autoloop queue into a human-visible board lane.
 *
 * The queue (autoloop-queue.md) stays the single system of record; this only
 * MIRRORS open queue items into a `## Discovered (autoloop)` lane on the project
 * board so the user can see the loop's autonomous backlog. It never touches any
 * other column. One control flows back: a lane card the user checks `[x]` is a
 * dismissal — syncLane reports it, the CLI flips that queue item to
 * `status: dismissed` (so the loop skips it AND the bug-hunt never re-proposes
 * it), and it drops off the lane next sync.
 *
 * Cards are `[[<id>|<title>]]` — id-keyed (robust dedup, matches the queue) but
 * title-displayed (readable). parseBoard already captures the id (text before
 * `|`), so the existing selector is unaffected.
 *
 * Exports: parseLane, syncLane, laneLine, cardNote, oneLineTitle, LANE
 * CLI: node scripts/autoloop/board-mirror.js sync --board <p> --cards-root <p> [--queue <p>]
 */
'use strict';

const LANE = 'Discovered (autoloop)';
const OPEN_STATUS = 'proposed';
// New Discovered lanes land just before one of these (out of the active work
// columns, still visible); falls back to end-of-board if none is present.
const ANCHORS = ['## Completed', '## Archive'];

function oneLineTitle(s) {
  // Single line, and strip the chars that would break a [[wikilink|alias]].
  return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Parse the cards under a lane header → [{ id, title, checked }].
function parseLane(boardMd, laneName) {
  const out = [];
  let inLane = false;
  for (const raw of String(boardMd || '').split('\n')) {
    const h = raw.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (h) { inLane = h[1].trim() === laneName; continue; }
    if (!inLane) continue;
    const m = raw.match(/^\s*-\s*\[([ xX]?)\]\s*\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/);
    if (m) out.push({ id: m[2].trim(), title: (m[3] || m[2]).trim(), checked: m[1].toLowerCase() === 'x' });
  }
  return out;
}

function laneLine(item) {
  const title = oneLineTitle(item.title || item.id);
  return `- [ ] [[${item.id}|${title}]]`;
}

/**
 * syncLane — recompute the Discovered lane from the queue + the board's own
 * checkbox state. Pure: returns the new board markdown + what changed.
 * @returns {{boardMd, added:string[], removed:string[], dismissed:string[]}}
 */
function syncLane(o) {
  const { boardMd = '', queueItems = [], laneName = LANE } = o || {};
  const existing = parseLane(boardMd, laneName);
  // User-checked lane cards = dismissals (even though the queue still says open).
  const dismissed = existing.filter((c) => c.checked).map((c) => c.id);
  const dismissedSet = new Set(dismissed);

  const open = queueItems.filter((it) => (it.status || OPEN_STATUS) === OPEN_STATUS && !dismissedSet.has(it.id));
  const prevIds = new Set(existing.map((c) => c.id));
  const added = open.filter((it) => !prevIds.has(it.id)).map((it) => it.id);
  const removed = existing
    .filter((c) => !c.checked && !open.some((it) => it.id === c.id))
    .map((c) => c.id);

  const body = open.length ? open.map(laneLine).join('\n') : '';
  const block = `## ${laneName}\n\n${body}${body ? '\n' : ''}`;

  const lines = String(boardMd).split('\n');
  // A Kanban board ends with a `%% kanban:settings %%` trailer that is NOT a
  // `## ` header — it must survive every sync, so treat `%%` (and EOF) as a
  // span/insert boundary alongside the next header.
  const isBoundary = (l) => /^#{1,6}\s+/.test(l) || /^%%/.test(l.trim());
  const headerIdx = lines.findIndex((l) => l.trim() === `## ${laneName}`);
  let next;
  if (headerIdx !== -1) {
    // Replace the existing lane span (header → next header / settings trailer / EOF).
    let end = headerIdx + 1;
    while (end < lines.length && !isBoundary(lines[end])) end++;
    const before = lines.slice(0, headerIdx).join('\n').replace(/\s*$/, '');
    const after = lines.slice(end).join('\n').replace(/^\s*/, '');
    next = `${before}\n\n${block}${after ? '\n' + after : '\n'}`;
  } else {
    // Insert before the first anchor header; else before a settings trailer;
    // else append at the end. Never place the lane after the settings block.
    let insertIdx = lines.findIndex((l) => ANCHORS.includes(l.trim()));
    if (insertIdx === -1) insertIdx = lines.findIndex((l) => /^%%/.test(l.trim()));
    if (insertIdx !== -1) {
      const before = lines.slice(0, insertIdx).join('\n').replace(/\s*$/, '');
      const after = lines.slice(insertIdx).join('\n');
      next = `${before}\n\n${block}\n${after}`;
    } else {
      next = `${String(boardMd).replace(/\s*$/, '')}\n\n${block}`;
    }
  }
  return { boardMd: next, added, removed, dismissed };
}

// Stub card-note body for a discovered item (written at tasks/<id>/<id>.md so
// the [[id]] link resolves). Lightweight — the queue holds the real plan.
function cardNote(o) {
  const { item = {}, date = '(unknown)' } = o || {};
  const fm = [
    '---',
    `autoloop_id: ${item.id || ''}`,
    'status: discovered',
    `category: ${item.category || 'bug'}`,
    `source: ${item.source || 'bug-hunt'}`,
    `discovered_at: ${date}`,
    '---',
    '',
  ].join('\n');
  return `${fm}# ${oneLineTitle(item.title || item.id)}\n\n` +
    `> [!info] Discovered by the autoloop (${item.source || 'bug-hunt'})\n` +
    `> ${oneLineTitle(item.rationale || item.title || '')}\n\n` +
    `_The loop will pick this up from its queue and ship a fix through Gate B. ` +
    `Check this card off on the board to dismiss it (the loop will skip it and never re-propose it)._\n`;
}

// Flip the given ids' queue `status` to `dismissed` — the back-channel for a
// user-checked Discovered card. The id is anchored to its full line (so
// `bug-x` never matches `bug-x-foo`) and the match cannot cross into the next
// `- id:` item (so a status-less target can't flip a neighbour). Items without
// a status line are simply left untouched.
function dismissInQueue(queueMd, ids) {
  let out = String(queueMd || '');
  for (const id of ids || []) {
    const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^- id:\\s*${esc}\\s*$(?:\\n(?!- id:).*)*?\\n\\s+status:\\s*)\\S+`, 'm');
    out = out.replace(re, '$1dismissed');
  }
  return out;
}

module.exports = { parseLane, syncLane, laneLine, cardNote, dismissInQueue, oneLineTitle, LANE };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (name, def) => { const i = argv.indexOf(`--${name}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };

  if (cmd === 'sync') {
    const boardPath = flag('board', '');
    const cardsRoot = flag('cards-root', '');
    const queuePath = flag('queue', path.join(ROOT, 'autoloop-queue.md'));
    const date = flag('date', '(unknown)');
    if (!boardPath) { console.error('sync needs --board <path>'); process.exit(2); }

    const { parseQueue } = require('./select-card.js');
    const queueMd = read(queuePath);
    const queueItems = parseQueue(queueMd);
    const boardMd = read(boardPath);
    const { boardMd: next, added, removed, dismissed } = syncLane({ boardMd, queueItems });

    // Back-channel: flip user-checked (dismissed) items to status: dismissed.
    const newQueue = dismissInQueue(queueMd, dismissed);
    // Write stub card notes for newly added ids (so [[id]] resolves).
    if (cardsRoot) {
      const byId = new Map(queueItems.map((it) => [it.id, it]));
      for (const id of added) {
        if (!/^[a-z0-9-]+$/.test(id)) continue; // defensive: ids are slugs; never path-traverse
        const dir = path.join(cardsRoot, id);
        const dest = path.join(dir, `${id}.md`);
        if (!fs.existsSync(dest)) {
          try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(dest, cardNote({ item: byId.get(id) || { id }, date }), 'utf8'); } catch (_) {}
        }
      }
    }
    if (next !== boardMd) fs.writeFileSync(boardPath, next, 'utf8');
    if (newQueue !== queueMd) fs.writeFileSync(queuePath, newQueue, 'utf8');
    console.log(JSON.stringify({ added, removed, dismissed }, null, 2));
    process.exit(0);
  }

  console.error('usage: board-mirror.js sync --board <p> --cards-root <p> [--queue <p>] [--date <iso>]');
  process.exit(2);
}
