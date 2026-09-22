// platform/engine/graph.js — read a graph note: frontmatter + the one fenced
// ```sauce block. The note is the unit of work; the block is the graph.
'use strict';

const yaml = require('./yaml-lite.js');

class GraphNoteError extends Error {
  constructor(message) { super(message); this.name = 'GraphNoteError'; }
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(text) {
  const src = String(text);
  const m = src.match(FM_RE);
  if (!m) return { frontmatter: {}, body: src, raw: '' };
  let frontmatter;
  try { frontmatter = yaml.parse(m[1]); }
  catch (e) { throw new GraphNoteError(`frontmatter: ${e.message}`); }
  return { frontmatter: frontmatter || {}, body: src.slice(m[0].length), raw: m[1] };
}

// Set (or add) one scalar frontmatter field, preserving every other line
// byte-for-byte. A note without frontmatter gains a minimal block.
function setFrontmatterField(text, key, value) {
  const src = String(text);
  const m = src.match(FM_RE);
  const line = `${key}: ${value}`;
  if (!m) return `---\n${line}\n---\n${src}`;
  const lines = m[1].split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (idx >= 0) lines[idx] = line; else lines.push(line);
  return `---\n${lines.join('\n')}\n---\n` + src.slice(m[0].length);
}

const FENCE_OPEN = /^```sauce[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;

function extractBlock(body) {
  const lines = String(body).split('\n');
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    if (open === null && FENCE_OPEN.test(lines[i])) { open = i; continue; }
    if (open !== null && FENCE_CLOSE.test(lines[i])) { blocks.push({ start: open, end: i, text: lines.slice(open + 1, i).join('\n') }); open = null; }
  }
  if (open !== null) throw new GraphNoteError('the ```sauce block is never closed');
  if (blocks.length === 0) throw new GraphNoteError('no ```sauce block in the note');
  if (blocks.length > 1) throw new GraphNoteError('a graph note carries exactly one ```sauce block');
  return blocks[0];
}

function parseGraphNote(text) {
  const { frontmatter, body } = splitFrontmatter(text);
  const block = extractBlock(body);
  let graph;
  try { graph = yaml.parse(block.text); }
  catch (e) { throw new GraphNoteError(`sauce block: ${e.message}`); }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new GraphNoteError('sauce block must be a map with nodes: and edges:');
  graph.nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
  return { frontmatter, block: block.text, graph };
}

module.exports = { parseGraphNote, splitFrontmatter, setFrontmatterField, GraphNoteError };
