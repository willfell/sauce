// platform/engine/ledger.js — the run ledger: one append-only JSONL file per
// run under <vault>/ranch/engine/runs/. Designed for Obsidian Sync: nothing
// is ever rewritten, there is no shared index file, and a partial trailing
// line (a sync caught mid-append) is ignored on read. Any index is derived
// at read time by replaying the files.
'use strict';

const fs = require('fs');
const path = require('path');

function runsDir(vault) { return path.join(vault, 'ranch', 'engine', 'runs'); }
function runPath(vault, runId) { return path.join(runsDir(vault), `${runId}.jsonl`); }
function runDir(vault, runId) { return path.join(runsDir(vault), runId); }

function appendEvent(vault, runId, event) {
  const dir = runsDir(vault);
  fs.mkdirSync(dir, { recursive: true });
  const ev = Object.assign({ ts: new Date().toISOString() }, event);
  fs.appendFileSync(runPath(vault, runId), JSON.stringify(ev) + '\n');
  return ev;
}

function readEvents(vault, runId) {
  const p = runPath(vault, runId);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); }
    catch (_e) { /* partial or corrupt line: ignored, never fatal */ }
  }
  return out;
}

function summarize(runId, events) {
  const created = events.find((e) => e.type === 'run.created') || {};
  let status = 'running', ended_at = null, parked = null;
  for (const e of events) {
    if (e.type === 'run.parked') { status = 'parked'; parked = { node: e.node, ask: e.ask }; }
    else if (e.type === 'human.answered') { status = 'running'; parked = null; }
    else if (e.type === 'run.halted') { status = 'halted'; ended_at = e.ts || null; }
    else if (e.type === 'run.ended') { status = e.status || 'done'; ended_at = e.ts || null; }
  }
  return { run_id: runId, graph_note: created.graph_note || null, repo: created.repo || null, status, parked, started_at: created.ts || null, ended_at };
}

function listRuns(vault, filter) {
  const dir = runsDir(vault);
  if (!fs.existsSync(dir)) return [];
  const runs = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const runId = f.slice(0, -'.jsonl'.length);
    const events = readEvents(vault, runId);
    if (!events.length) continue;
    const s = summarize(runId, events);
    if (filter && filter.graph_note && s.graph_note !== filter.graph_note) continue;
    runs.push(s);
  }
  runs.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')) || b.run_id.localeCompare(a.run_id));
  return runs;
}

module.exports = { runsDir, runPath, runDir, appendEvent, readEvents, listRuns, summarize };
