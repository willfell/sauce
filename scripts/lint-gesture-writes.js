#!/usr/bin/env node
'use strict';

// Reject direct frontmatter/content writes nested in DOM gesture callbacks.
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCAN_DIRS = [
  path.join(REPO_ROOT, 'platform', 'blueprints'),
  path.join(REPO_ROOT, 'platform', 'mechanisms'),
];
const DEFAULT_ALLOWLIST = path.join(__dirname, 'lint-gesture-writes-allowlist.json');
const ALLOW_RE = /gesture-write-ok\s+\S.{7,}/;
const WRITE_RE = /\b(?:fileManager\s*(?:\.|\?\.)\s*processFrontMatter|vault\s*(?:\.|\?\.)\s*(?:modify|create))\s*(?:\?\.)?\s*\(/g;
const GESTURE_ASSIGN_CONTEXT_RE = /(?:\.|\b)(?:onclick|onchange|oninput|onsubmit|onkeydown|onkeyup|onpointer(?:down|up|move)|onmousedown|onmouseup|ontouch(?:start|end|move))\s*=\s*$/i;
const GESTURE_PROP_CONTEXT_RE = /\b(?:onClick|onChange|onInput|onSubmit|onKeyDown|onKeyUp|onPointerDown|onPointerUp|onMouseDown|onMouseUp|onTouchStart|onTouchEnd)\s*:\s*$/;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_error) { return out; }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(absolute);
  }
  return out;
}

function parsedRegexStarts(source) {
  for (const sourceType of ['script', 'module']) {
    const tokens = [];
    try {
      acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType,
        allowAwaitOutsideFunction: true,
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        onToken: tokens,
      });
      return new Set(tokens
        .filter((token) => token.type && token.type.label === 'regexp')
        .map((token) => token.start));
    } catch (_error) {
      // A valid module can fail script parsing. Only fall back after both
      // complete grammar modes reject the source.
    }
  }
  const starts = new Set();
  try {
    const tokenizer = acorn.tokenizer(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowHashBang: true,
    });
    while (true) {
      const token = tokenizer.getToken();
      if (token.type && token.type.label === 'regexp') starts.add(token.start);
      if (token.type && token.type.label === 'eof') break;
    }
  } catch (_error) {
    // Invalid JavaScript stays unevaluated and receives no heuristic rewrite.
  }
  return starts;
}

// Blank comments, strings, and regex literals while preserving offsets and
// executable braces, including code inside template interpolation. Record
// escapes only when the marker is inside a comment.
function maskNonCode(source) {
  const chars = source.split('');
  const allowLines = new Set();
  const regexStarts = parsedRegexStarts(source);
  let line = 1;

  const blank = (offset) => { if (chars[offset] !== '\n') chars[offset] = ' '; };
  const scanString = (start, quote) => {
    blank(start);
    let escaped = false;
    for (let i = start + 1; i < chars.length; i++) {
      const current = chars[i];
      if (current === '\n') line++; else blank(i);
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) {
        chars[i] = '0';
        return i + 1;
      }
    }
    return chars.length;
  };
  const scanRegex = (start) => {
    blank(start);
    let escaped = false;
    let inClass = false;
    for (let i = start + 1; i < chars.length; i++) {
      const current = chars[i];
      if (current === '\n') { line++; return i + 1; }
      blank(i);
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '[') inClass = true;
      else if (current === ']') inClass = false;
      else if (current === '/' && !inClass) {
        chars[i] = '0';
        i++;
        while (i < chars.length && /[a-z]/i.test(chars[i])) blank(i++);
        return i;
      }
    }
    return chars.length;
  };
  let scanCode;
  const scanTemplate = (start) => {
    blank(start);
    for (let i = start + 1; i < chars.length;) {
      const current = chars[i];
      if (current === '\\') {
        blank(i++);
        if (i < chars.length) {
          if (chars[i] === '\n') line++; else blank(i);
          i++;
        }
      } else if (current === '`') {
        chars[i] = '0';
        return i + 1;
      } else if (current === '$' && chars[i + 1] === '{') {
        blank(i);
        i = scanCode(i + 2, 1);
      } else {
        if (current === '\n') line++; else blank(i);
        i++;
      }
    }
    return chars.length;
  };
  scanCode = (start, interpolationDepth = 0) => {
    let depth = interpolationDepth;
    for (let i = start; i < chars.length;) {
      const ch = chars[i];
      const next = chars[i + 1];
      if (depth > 0 && ch === '}') {
        depth--;
        i++;
        if (depth === 0) return i;
      } else if (depth > 0 && ch === '{') {
        depth++;
        i++;
      } else if (ch === '/' && next === '/') {
        let end = source.indexOf('\n', i);
        if (end < 0) end = source.length;
        if (ALLOW_RE.test(source.slice(i, end))) allowLines.add(line);
        for (let cursor = i; cursor < end; cursor++) blank(cursor);
        i = end;
      } else if (ch === '/' && next === '*') {
        let end = source.indexOf('*/', i + 2);
        end = end < 0 ? source.length : end + 2;
        const commentLines = source.slice(i, end).split('\n');
        commentLines.forEach((text, index) => {
          if (ALLOW_RE.test(text)) allowLines.add(line + index);
        });
        for (let cursor = i; cursor < end; cursor++) {
          if (chars[cursor] === '\n') line++; else blank(cursor);
        }
        i = end;
      } else if (ch === "'" || ch === '"') i = scanString(i, ch);
      else if (ch === '`') i = scanTemplate(i);
      else if (ch === '/' && regexStarts.has(i)) i = scanRegex(i);
      else {
        if (ch === '\n') line++;
        i++;
      }
    }
    return chars.length;
  };
  scanCode(0);
  return { masked: chars.join(''), allowLines };
}

function braceRanges(masked) {
  const stack = [];
  const ranges = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === '{') stack.push(i);
    else if (masked[i] === '}' && stack.length) ranges.push({ start: stack.pop(), end: i });
  }
  return ranges;
}

function previousNonSpace(source, offset) {
  let cursor = offset;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor--;
  return cursor;
}

function matchingOpenParen(source, close) {
  if (source[close] !== ')') return -1;
  let depth = 0;
  for (let cursor = close; cursor >= 0; cursor--) {
    if (source[cursor] === ')') depth++;
    else if (source[cursor] === '(' && --depth === 0) return cursor;
  }
  return -1;
}

function matchingCloseParen(source, open) {
  if (source[open] !== '(') return -1;
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor++) {
    if (source[cursor] === '(') depth++;
    else if (source[cursor] === ')' && --depth === 0) return cursor;
  }
  return -1;
}

function includeAsyncPrefix(source, start) {
  const end = previousNonSpace(source, start - 1) + 1;
  let cursor = end - 1;
  while (cursor >= 0 && /[\w$]/.test(source[cursor])) cursor--;
  const tokenStart = cursor + 1;
  return source.slice(tokenStart, end) === 'async' ? tokenStart : start;
}

function arrowCallbackStart(masked, arrow) {
  const parameterEnd = previousNonSpace(masked, arrow - 1);
  if (parameterEnd < 0) return -1;
  let start;
  if (masked[parameterEnd] === ')') {
    start = matchingOpenParen(masked, parameterEnd);
    if (start < 0) return -1;
  } else {
    start = parameterEnd;
    while (start >= 0 && /[\w$]/.test(masked[start])) start--;
    start++;
    if (start > parameterEnd || !/[A-Za-z_$]/.test(masked[start])) return -1;
  }
  return includeAsyncPrefix(masked, start);
}

function functionCallbackStart(masked, bodyStart) {
  const parameterEnd = previousNonSpace(masked, bodyStart - 1);
  const parameterStart = matchingOpenParen(masked, parameterEnd);
  if (parameterStart < 0) return -1;
  const prefixStart = 0;
  const prefix = masked.slice(0, parameterStart);
  const match = prefix.match(/\b(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*$/);
  return match ? prefixStart + match.index : -1;
}

function listenerContext(masked, callbackStart) {
  const comma = previousNonSpace(masked, callbackStart - 1);
  if (masked[comma] !== ',') return false;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  for (let cursor = comma - 1; cursor >= 0; cursor--) {
    const ch = masked[cursor];
    if (ch === ')') parens++;
    else if (ch === '(') {
      if (parens > 0) parens--;
      else if (brackets === 0 && braces === 0) {
        const prefix = masked.slice(0, cursor);
        return /\.addEventListener\s*$/.test(prefix);
      }
    } else if (ch === ']') brackets++;
    else if (ch === '[') brackets = Math.max(0, brackets - 1);
    else if (ch === '}') braces++;
    else if (ch === '{') braces = Math.max(0, braces - 1);
  }
  return false;
}

function gestureContext(masked, callbackStart) {
  if (callbackStart < 0) return false;
  while (masked[previousNonSpace(masked, callbackStart - 1)] === '(') {
    callbackStart = previousNonSpace(masked, callbackStart - 1);
  }
  const prefix = masked.slice(0, callbackStart);
  return GESTURE_ASSIGN_CONTEXT_RE.test(prefix)
    || GESTURE_PROP_CONTEXT_RE.test(prefix)
    || listenerContext(masked, callbackStart);
}

function gestureBodyStart(masked, bodyStart) {
  const before = previousNonSpace(masked, bodyStart - 1);
  if (masked[before] === '>' && masked[before - 1] === '=') {
    return gestureContext(masked, arrowCallbackStart(masked, before - 1));
  }
  return gestureContext(masked, functionCallbackStart(masked, bodyStart));
}

function callbackBodyStartAt(masked, callbackStart) {
  let cursor = callbackStart;
  while (masked[cursor] === '(') {
    const wrapperClose = matchingCloseParen(masked, cursor);
    if (wrapperClose < 0) return -1;
    let afterWrapper = wrapperClose + 1;
    while (/\s/.test(masked[afterWrapper])) afterWrapper++;
    if (masked.slice(afterWrapper, afterWrapper + 2) === '=>') break;
    cursor++;
    while (/\s/.test(masked[cursor])) cursor++;
  }
  const consumeWord = (word) => {
    if (masked.slice(cursor, cursor + word.length) !== word
      || /[\w$]/.test(masked[cursor + word.length] || '')) return false;
    cursor += word.length;
    while (/\s/.test(masked[cursor])) cursor++;
    return true;
  };
  if (masked.slice(cursor, cursor + 5) === 'async' && !/[\w$]/.test(masked[cursor + 5] || '')) {
    cursor += 5;
    while (/\s/.test(masked[cursor])) cursor++;
  }
  if (consumeWord('function')) {
    if (/[A-Za-z_$]/.test(masked[cursor] || '')) {
      cursor++;
      while (/[\w$]/.test(masked[cursor] || '')) cursor++;
      while (/\s/.test(masked[cursor])) cursor++;
    }
    const close = matchingCloseParen(masked, cursor);
    if (close < 0) return -1;
    cursor = close + 1;
    while (/\s/.test(masked[cursor])) cursor++;
    return masked[cursor] === '{' ? cursor : -1;
  }
  if (masked[cursor] === '(') {
    const close = matchingCloseParen(masked, cursor);
    if (close < 0) return -1;
    cursor = close + 1;
  } else {
    if (!/[A-Za-z_$]/.test(masked[cursor] || '')) return -1;
    cursor++;
    while (/[\w$]/.test(masked[cursor] || '')) cursor++;
  }
  while (/\s/.test(masked[cursor])) cursor++;
  if (masked.slice(cursor, cursor + 2) !== '=>') return -1;
  cursor += 2;
  while (/\s/.test(masked[cursor])) cursor++;
  return cursor;
}

function callbackRanges(masked, ranges) {
  const callbacks = ranges.filter(({ start }) => gestureBodyStart(masked, start));
  for (let arrow = masked.indexOf('=>'); arrow >= 0; arrow = masked.indexOf('=>', arrow + 2)) {
    if (!gestureContext(masked, arrowCallbackStart(masked, arrow))) continue;
    let start = arrow + 2;
    while (start < masked.length && /\s/.test(masked[start])) start++;
    if (masked[start] === '{') continue;
    let parens = 0;
    let brackets = 0;
    let braces = 0;
    let end = masked.length;
    for (let i = start; i < masked.length; i++) {
      const ch = masked[i];
      if (parens === 0 && brackets === 0 && braces === 0
        && (ch === ';' || ch === ',' || ch === ')' || ch === '\n')) { end = i; break; }
      if (ch === '(') parens++;
      else if (ch === ')') parens--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
      else if (ch === '{') braces++;
      else if (ch === '}') braces--;
    }
    callbacks.push({ start, end });
  }
  return callbacks;
}

function mutateRanges(masked, ranges) {
  return ranges.filter(({ start }) => /(?:\b(?:customJS\.)?RenderSafe|\brenderSafe)\.mutate\s*\(\s*$/.test(masked.slice(0, start)));
}

function protectedByMutation(masked, mutations, offset) {
  for (const mutation of mutations) {
    if (!(mutation.start < offset && offset < mutation.end)) continue;
    let propertyStart = mutation.start + 1;
    let parens = 0;
    let brackets = 0;
    let braces = 0;
    for (let i = propertyStart; i <= mutation.end; i++) {
      const ch = masked[i];
      const boundary = (i === mutation.end) || (ch === ',' && parens === 0 && brackets === 0 && braces === 0);
      if (boundary) {
        if (propertyStart < offset && offset < i) {
          const beforeWrite = masked.slice(propertyStart, offset);
          const propertyMatch = beforeWrite.match(/^\s*write\s*:\s*/);
          if (!propertyMatch) return false;
          const bodyStart = callbackBodyStartAt(masked, propertyStart + propertyMatch[0].length);
          return bodyStart >= 0 && bodyStart < offset;
        }
        propertyStart = i + 1;
        continue;
      }
      if (ch === '(') parens++;
      else if (ch === ')') parens = Math.max(0, parens - 1);
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets = Math.max(0, brackets - 1);
      else if (ch === '{') braces++;
      else if (ch === '}') braces = Math.max(0, braces - 1);
    }
  }
  return false;
}

function containing(ranges, offset) {
  return ranges.some(({ start, end }) => start <= offset && offset < end);
}

function lineInfo(source, offset) {
  const line = source.slice(0, offset).split('\n').length;
  const lines = source.split('\n');
  return { line, text: lines[line - 1] || '', previous: lines[line - 2] || '' };
}

function lintSource(source) {
  const { masked, allowLines } = maskNonCode(source);
  const ranges = braceRanges(masked);
  const gestures = callbackRanges(masked, ranges);
  const mutations = mutateRanges(masked, ranges);
  const findings = [];
  WRITE_RE.lastIndex = 0;
  let match;
  while ((match = WRITE_RE.exec(masked)) !== null) {
    const offset = match.index;
    if (!containing(gestures, offset) || protectedByMutation(masked, mutations, offset)) continue;
    const info = lineInfo(source, offset);
    if (allowLines.has(info.line) || allowLines.has(info.line - 1)) continue;
    findings.push({
      line: info.line,
      message: `bare ${match[0].replace(/\s*\($/, '')} in gesture callback — route the write through RenderSafe.mutate or add a reasoned gesture-write-ok escape`,
    });
  }
  return findings;
}

function loadAllowlist(file = DEFAULT_ALLOWLIST) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('gesture-write allowlist must contain entries[]');
  const entries = new Map();
  for (const entry of parsed.entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) throw new Error('gesture-write allowlist entry requires path');
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) throw new Error(`gesture-write allowlist entry ${entry.path} requires a specific reason`);
    if (entry.lines !== undefined && (!Array.isArray(entry.lines)
      || entry.lines.some((line) => !Number.isInteger(line) || line < 1))) {
      throw new Error(`gesture-write allowlist entry ${entry.path} lines must be positive integers`);
    }
    if (entries.has(entry.path)) throw new Error(`duplicate gesture-write allowlist entry: ${entry.path}`);
    entries.set(entry.path, { reason: entry.reason.trim(), lines: new Set(entry.lines || []) });
  }
  return entries;
}

function lintFile(file, allowlist = new Map(), root = REPO_ROOT) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const findings = lintSource(fs.readFileSync(file, 'utf8'));
  const entry = allowlist.get(relative);
  if (!entry) return findings;
  return findings.filter((finding) => !entry.lines.has(finding.line));
}

function run(scanDirs = DEFAULT_SCAN_DIRS, allowlistFile = DEFAULT_ALLOWLIST, root = REPO_ROOT) {
  const allowlist = allowlistFile ? loadAllowlist(allowlistFile) : new Map();
  const files = scanDirs.flatMap((dir) => walk(dir)).sort();
  const findings = [];
  for (const file of files) {
    for (const finding of lintFile(file, allowlist, root)) {
      findings.push({ file: path.relative(root, file).split(path.sep).join('/'), ...finding });
    }
  }
  return { files, findings, allowlist };
}

function parseArgs(argv) {
  const args = { scans: [], allowlist: DEFAULT_ALLOWLIST, root: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scan') args.scans.push(path.resolve(argv[++i]));
    else if (argv[i] === '--root') args.root = path.resolve(argv[++i]);
    else if (argv[i] === '--allowlist') args.allowlist = path.resolve(argv[++i]);
    else if (argv[i] === '--no-allowlist') args.allowlist = null;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (args.scans.length === 0) args.scans = DEFAULT_SCAN_DIRS;
  return args;
}

function main() {
  let result;
  try {
    const args = parseArgs(process.argv.slice(2));
    result = run(args.scans, args.allowlist, args.root);
  } catch (error) {
    console.error(`FAIL lint-gesture-writes: ${error.message}`);
    process.exit(1);
  }
  if (result.findings.length === 0) {
    console.log(`PASS lint-gesture-writes: ${result.files.length} helper file(s) scanned; no bare gesture writes.`);
    return;
  }
  console.error(`FAIL lint-gesture-writes: ${result.findings.length} violation(s):`);
  for (const finding of result.findings) console.error(`  ${finding.file}:${finding.line} ${finding.message}`);
  process.exit(1);
}

module.exports = { lintSource, loadAllowlist, lintFile, run };

if (require.main === module) main();
