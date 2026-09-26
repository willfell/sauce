// platform/engine/projection.js — the human surface: a marker-bounded
// `## Runs` section in the graph note, the note's `status:` frontmatter,
// and the checkbox a `human` node parks on. The ledger stays authoritative;
// this file only renders it and reads one gesture (the tick) back.
'use strict';

const fs = require('fs');
const { setFrontmatterField, splitFrontmatter } = require('./graph.js');

const BEGIN = '<!-- @sauce:runs BEGIN -->';
const END = '<!-- @sauce:runs END -->';
const HEADING = '## Runs';

const GLYPH = { idle: '○', running: '◐', parked: '⏸', pass: '●', fail: '✕' };

function glyphFor(n) {
  if (n.status === 'finished') return n.outcome === 'pass' ? GLYPH.pass : GLYPH.fail;
  return GLYPH[n.status] || GLYPH.idle;
}

function humanLine(runId, nodeId, ask, checked, decision) {
  return `- [${checked ? 'x' : ' '}] run:${runId} node:${nodeId} — ${String(ask).replace(/\n+/g, ' ').trim()}${decision ? ` (decision: ${decision})` : ''}`;
}

function renderRunsSection(state, graph, options) {
  const opts = options || {};
  const lines = [];
  lines.push(`**Latest run:** \`${state.run_id}\` · status **${state.status}**${state.ended_at ? ` · ended ${state.ended_at}` : ''}`);
  lines.push('');
  for (const n of graph.nodes) {
    const st = state.nodes[n.id] || { status: 'idle', attempts: 0, outcome: null };
    const label = st.status === 'finished' ? st.outcome : st.status;
    const summary = st.result && typeof st.result.summary === 'string' && st.result.summary ? ` — ${st.result.summary.split('\n')[0].slice(0, 160)}` : '';
    lines.push(`- ${glyphFor(st)} \`${n.id}\` ${n.type} · ${label} · attempts ${st.attempts}${summary}`);
  }
  if (state.parked) {
    lines.push('');
    lines.push('Answer by ticking the box (add `(decision: fail)` or a named outcome before ticking to answer anything but pass):');
    lines.push(humanLine(state.run_id, state.parked.node, state.parked.ask, false, opts.decision || null));
  }
  lines.push('');
  lines.push(`Ledger: \`ranch/engine/runs/${state.run_id}.jsonl\``);
  return lines.join('\n');
}

function replaceRegion(body, inner) {
  const region = `${BEGIN}\n${inner}\n${END}`;
  const b = body.indexOf(BEGIN), e = body.indexOf(END);
  if (b >= 0 && e > b) return body.slice(0, b) + region + body.slice(e + END.length);
  const trimmed = body.replace(/\s+$/, '');
  return `${trimmed}\n\n${HEADING}\n\n${region}\n`;
}

function writeProjection(notePath, state, graph, options) {
  const src = fs.readFileSync(notePath, 'utf8');
  const { body } = splitFrontmatter(src);
  const existing = readHumanAnswers(src).find((a) => a.runId === state.run_id && state.parked && a.node === state.parked.node);
  let inner = renderRunsSection(state, graph, options);
  if (existing && existing.decision) {
    // Preserve a decision the human typed but has not ticked yet.
    inner = inner.replace(humanLine(state.run_id, state.parked.node, state.parked.ask, false, null), humanLine(state.run_id, state.parked.node, state.parked.ask, false, existing.decision));
  }
  const newBody = replaceRegion(body, inner);
  const withFm = src.startsWith('---') ? src.slice(0, src.length - body.length) + newBody : newBody;
  const next = setFrontmatterField(withFm, 'status', state.status);
  if (next === src) return false;
  const tmp = `${notePath}.tmp`;
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, notePath);
  return true;
}

const HUMAN_RE = /^- \[( |x|X)\] run:(\S+) node:(\S+) — (.*?)(?: \(decision: ([a-z][a-z0-9-]*)\))?\s*$/;

function readHumanAnswers(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(HUMAN_RE);
    if (!m) continue;
    out.push({ runId: m[2], node: m[3], ask: m[4], checked: m[1].toLowerCase() === 'x', decision: m[5] || null });
  }
  return out;
}

function readHumanAnswersFromNote(notePath) {
  if (!fs.existsSync(notePath)) return [];
  return readHumanAnswers(fs.readFileSync(notePath, 'utf8'));
}

function isHalted(notePath) {
  if (!fs.existsSync(notePath)) return false;
  const { frontmatter } = splitFrontmatter(fs.readFileSync(notePath, 'utf8'));
  return frontmatter && frontmatter.status === 'halted';
}

module.exports = { renderRunsSection, writeProjection, readHumanAnswers, readHumanAnswersFromNote, isHalted, humanLine, BEGIN, END };
