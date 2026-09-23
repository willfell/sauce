// platform/engine/yaml-lite.js — the YAML subset a `sauce` block may use.
//
// Supported: nested maps (`key:` + deeper indent), lists (`- item` or
// `- key: value` opening a map), scalars (strings, ints, floats, true/false/
// null, single- or double-quoted strings), `|` block scalars, single-line
// inline flow maps `{ a: 1, b: two }` and flow sequences `[a, b]`. Comments
// start with `#` at line start or after whitespace. Tabs are refused.
// Anchors, tags, multi-document streams and multi-line flow collections are
// NOT supported; the error names the line so the author can fix it in
// Obsidian.
//
// Zero-dep by design: the workshop's only npm dependency is @inquirer/prompts
// and the engine must load from a brew libexec without a node_modules for it.
'use strict';

class YamlLiteError extends Error {
  constructor(line, message) {
    super(`yaml-lite: line ${line}: ${message}`);
    this.name = 'YamlLiteError';
    this.line = line;
  }
}

function stripComment(text) {
  // A `#` starts a comment only at the start or after whitespace, and never
  // inside quotes.
  let inS = false, inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && !inS) inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function scalar(raw, line) {
  const t = raw.trim();
  if (t === '') return null;
  if (t[0] === '"') {
    if (t[t.length - 1] !== '"' || t.length < 2) throw new YamlLiteError(line, 'unterminated double-quoted string');
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  if (t[0] === "'") {
    if (t[t.length - 1] !== "'" || t.length < 2) throw new YamlLiteError(line, 'unterminated single-quoted string');
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

function splitTopLevelCommas(body, line) {
  const parts = [];
  let depth = 0, cur = '', inS = false, inD = false;
  for (const c of body) {
    if (c === '"' && !inS) inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    if (!inS && !inD) {
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  if (depth !== 0) throw new YamlLiteError(line, 'unbalanced flow map');
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length);
}

function flowMap(text, line) {
  const t = text.trim();
  if (t[0] !== '{') throw new YamlLiteError(line, 'flow value must start with {');
  if (t[t.length - 1] !== '}') throw new YamlLiteError(line, 'unbalanced flow map (missing })');
  const out = {};
  for (const part of splitTopLevelCommas(t.slice(1, -1), line)) {
    const m = part.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) throw new YamlLiteError(line, `flow map entry is not key: value — "${part}"`);
    out[m[1]] = m[2].trim().startsWith('{') ? flowMap(m[2], line) : scalar(m[2], line);
  }
  return out;
}

function flowSeq(text, line) {
  const t = text.trim();
  if (t[t.length - 1] !== ']') throw new YamlLiteError(line, 'unbalanced flow sequence (missing ])');
  return splitTopLevelCommas(t.slice(1, -1), line).map((part) => value(part, line));
}

function value(raw, line) {
  const t = raw.trim();
  if (t.startsWith('{')) return flowMap(t, line);
  if (t.startsWith('[')) return flowSeq(t, line);
  return scalar(t, line);
}

function tokenize(text) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (/^\s*\t|^\t/.test(rawLine)) throw new YamlLiteError(i + 1, 'tab indentation is not allowed; use spaces');
    out.push({ n: i + 1, raw: rawLine });
  }
  return out;
}

function indentOf(raw) { return raw.match(/^ */)[0].length; }

// Parse a block starting at token index `i` whose lines are indented by
// exactly `indent`. Returns { value, next }.
function parseBlock(tokens, i, indent) {
  // Skip blank/comment lines to decide the block kind.
  let j = i;
  while (j < tokens.length && stripComment(tokens[j].raw).trim() === '') j++;
  if (j >= tokens.length) return { value: null, next: j };
  const first = stripComment(tokens[j].raw);
  if (indentOf(first) < indent) return { value: null, next: j };
  if (indentOf(first) > indent) throw new YamlLiteError(tokens[j].n, `unexpected indentation (expected ${indent} spaces)`);
  return first.trim().startsWith('- ') || first.trim() === '-'
    ? parseList(tokens, j, indent)
    : parseMap(tokens, j, indent);
}

function parseBlockScalar(tokens, i, parentIndent) {
  // Collect lines indented deeper than the parent; blank lines inside are kept.
  const lines = [];
  let j = i, contentIndent = null;
  while (j < tokens.length) {
    const raw = tokens[j].raw;
    if (raw.trim() === '') { lines.push(''); j++; continue; }
    const ind = indentOf(raw);
    if (ind <= parentIndent) break;
    if (contentIndent === null) contentIndent = ind;
    if (ind < contentIndent) throw new YamlLiteError(tokens[j].n, 'block scalar line is under-indented');
    lines.push(raw.slice(contentIndent));
    j++;
  }
  // Trailing blank lines are folded to a single newline (clip chomping).
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { value: lines.length ? lines.join('\n') + '\n' : '', next: j };
}

function parseEntryValue(tokens, i, indent, rest, n) {
  const r = rest.trim();
  if (r === '|' || r === '|-') {
    const bs = parseBlockScalar(tokens, i + 1, indent);
    return { value: r === '|-' ? bs.value.replace(/\n$/, '') : bs.value, next: bs.next };
  }
  if (r === '') {
    const child = parseBlock(tokens, i + 1, findChildIndent(tokens, i + 1, indent));
    return { value: child.value === null ? null : child.value, next: child.next };
  }
  return { value: value(r, n), next: i + 1 };
}

function findChildIndent(tokens, i, parentIndent) {
  let j = i;
  while (j < tokens.length && stripComment(tokens[j].raw).trim() === '') j++;
  if (j >= tokens.length) return parentIndent + 1;
  const ind = indentOf(stripComment(tokens[j].raw));
  return ind > parentIndent ? ind : parentIndent + 1;
}

function parseMap(tokens, i, indent) {
  const out = {};
  let j = i;
  while (j < tokens.length) {
    const line = stripComment(tokens[j].raw);
    if (line.trim() === '') { j++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new YamlLiteError(tokens[j].n, `unexpected indentation (expected ${indent} spaces)`);
    const m = line.trim().match(/^([A-Za-z_][\w.-]*)\s*:(?:\s+(.*)|\s*)$/);
    if (!m) throw new YamlLiteError(tokens[j].n, `expected "key: value", got "${line.trim()}"`);
    const ev = parseEntryValue(tokens, j, indent, m[2] || '', tokens[j].n);
    out[m[1]] = ev.value;
    j = ev.next;
  }
  return { value: out, next: j };
}

function parseList(tokens, i, indent) {
  const out = [];
  let j = i;
  while (j < tokens.length) {
    const line = stripComment(tokens[j].raw);
    if (line.trim() === '') { j++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new YamlLiteError(tokens[j].n, `unexpected indentation (expected ${indent} spaces)`);
    const t = line.trim();
    if (!(t === '-' || t.startsWith('- '))) throw new YamlLiteError(tokens[j].n, 'expected a list item ("- ")');
    const rest = t === '-' ? '' : t.slice(2);
    const km = rest.match(/^([A-Za-z_][\w.-]*)\s*:(?:\s+(.*)|\s*)$/);
    if (km && !rest.trim().startsWith('{')) {
      // `- key: value` opens a map whose further keys are indented by (indent + 2).
      const itemIndent = indent + 2;
      const rewritten = tokens.slice();
      rewritten[j] = { n: tokens[j].n, raw: ' '.repeat(itemIndent) + rest };
      const mp = parseMap(rewritten, j, itemIndent);
      out.push(mp.value);
      j = mp.next;
    } else if (rest.trim() === '') {
      const child = parseBlock(tokens, j + 1, findChildIndent(tokens, j + 1, indent));
      out.push(child.value);
      j = child.next;
    } else {
      out.push(value(rest, tokens[j].n));
      j++;
    }
  }
  return { value: out, next: j };
}

function parse(text) {
  const tokens = tokenize(text);
  let j = 0;
  while (j < tokens.length && stripComment(tokens[j].raw).trim() === '') j++;
  if (j >= tokens.length) return {};
  const indent = indentOf(stripComment(tokens[j].raw));
  const res = parseBlock(tokens, j, indent);
  let k = res.next;
  while (k < tokens.length) {
    if (stripComment(tokens[k].raw).trim() !== '') throw new YamlLiteError(tokens[k].n, 'content after the top-level block');
    k++;
  }
  return res.value === null ? {} : res.value;
}

module.exports = { parse, YamlLiteError, scalar };
