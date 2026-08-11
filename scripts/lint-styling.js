'use strict';

// Baseline-ratcheted adoption gate for the shared Sauce styling and chrome
// primitives. Existing debt is recorded exactly; additions and stale baseline
// entries both fail so the baseline can only shrink alongside source cleanup.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'lint-styling-baseline.json');
const SCAN_DIRS = [
  path.join(REPO_ROOT, 'platform', 'blueprints'),
  path.join(REPO_ROOT, 'platform', 'mechanisms'),
];
const EXTENSIONS = new Set(['.js', '.md', '.css']);
const SAUCE_CORE = 'platform/mechanisms/styling/assets/snippets/sauce-core.css';
const VENDORED_THEME_PREFIX = 'platform/mechanisms/styling/assets/themes/';
const MAX_SNIPPET_LENGTH = 240;
const ALLOW_RE = /lint-styling:allow\b/;

const RULES = [
  {
    id: 'inline-css-text',
    description: 'inline style.cssText bypasses sauce-core classes',
  },
  {
    id: 'hardcoded-color',
    description: 'literal hex/rgb(a) color outside sauce-core',
  },
  {
    id: 'bespoke-nav',
    description: 'legacy nav helper invocation bypasses ChromeBar',
  },
  {
    id: 'bespoke-add-button',
    description: 'bespoke + button bypasses ChromeBar or EntityCreate',
  },
];

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return out; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures' || entry.name === 'test') continue;
      walk(file, out);
    } else if (EXTENSIONS.has(path.extname(entry.name)) || entry.name === 'manifest.json') {
      out.push(file);
    }
  }
  return out;
}

function findingKey(finding) {
  return `${finding.rule}:${finding.file}:${finding.snippet}`;
}

function regexCanStart(source, index) {
  const prefix = source.slice(0, index).replace(/\s+$/, '');
  if (!prefix) return true;
  if (/[([{=,:;!?&|+\-*%^~<>]$/.test(prefix)) return true;
  return /\b(?:return|case|throw|delete|void|typeof|instanceof|in|of|yield|await)\s*$/.test(prefix);
}

function codeMask(source) {
  const mask = new Uint8Array(source.length);
  mask.fill(1);
  const stack = [{ type: 'code', braceDepth: null }];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const context = stack[stack.length - 1];
    if (context.type === 'line-comment') {
      mask[index] = 0;
      if (char === '\n') stack.pop();
      continue;
    }
    if (context.type === 'block-comment') {
      mask[index] = 0;
      if (char === '*' && next === '/') { mask[index + 1] = 0; stack.pop(); index += 1; }
      continue;
    }
    if (context.type === 'string') {
      mask[index] = 0;
      if (context.escaped) { context.escaped = false; continue; }
      if (char === '\\') { context.escaped = true; continue; }
      if (char === context.quote) stack.pop();
      continue;
    }
    if (context.type === 'regex') {
      mask[index] = 0;
      if (context.escaped) { context.escaped = false; continue; }
      if (char === '\\') { context.escaped = true; continue; }
      if (char === '[') { context.inClass = true; continue; }
      if (char === ']' && context.inClass) { context.inClass = false; continue; }
      if (char === '/' && !context.inClass) stack.pop();
      continue;
    }
    if (context.type === 'template') {
      mask[index] = 0;
      if (context.escaped) { context.escaped = false; continue; }
      if (char === '\\') { context.escaped = true; continue; }
      if (char === '`') { stack.pop(); continue; }
      if (char === '$' && next === '{') {
        mask[index + 1] = 0;
        stack.push({ type: 'code', braceDepth: 0 });
        index += 1;
      }
      continue;
    }
    if (source.startsWith('```', index)) {
      mask[index] = 0;
      mask[index + 1] = 0;
      mask[index + 2] = 0;
      index += 2;
      continue;
    }
    if (char === '/' && next === '/') {
      mask[index] = 0; mask[index + 1] = 0;
      stack.push({ type: 'line-comment' }); index += 1; continue;
    }
    if (char === '/' && next === '*') {
      mask[index] = 0; mask[index + 1] = 0;
      stack.push({ type: 'block-comment' }); index += 1; continue;
    }
    if (char === '/' && regexCanStart(source, index)) {
      mask[index] = 0;
      stack.push({ type: 'regex', escaped: false, inClass: false });
      continue;
    }
    if (char === '"' || char === "'") {
      mask[index] = 0;
      stack.push({ type: 'string', quote: char, escaped: false });
      continue;
    }
    if (char === '`') {
      mask[index] = 0;
      stack.push({ type: 'template', escaped: false });
      continue;
    }
    if (context.braceDepth != null) {
      if (char === '{') context.braceDepth += 1;
      else if (char === '}' && context.braceDepth === 0) {
        mask[index] = 0;
        stack.pop();
      } else if (char === '}') context.braceDepth -= 1;
    }
  }
  return mask;
}

function cssCodeMask(source) {
  const mask = new Uint8Array(source.length);
  mask.fill(1);
  let quote = null;
  let escaped = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (blockComment) {
      mask[index] = 0;
      if (char === '*' && next === '/') {
        mask[index + 1] = 0;
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      mask[index] = 0;
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '*') {
      mask[index] = 0;
      mask[index + 1] = 0;
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      mask[index] = 0;
      quote = char;
    }
  }
  return mask;
}

function matchingParen(source, openIndex) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArgs(source) {
  const args = [];
  let start = 0;
  let round = 0; let square = 0; let curly = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '(') round += 1;
    else if (char === ')') round -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === ',' && round === 0 && square === 0 && curly === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
  }
  args.push(source.slice(start));
  return args;
}

function lineFinding(source, rel, lines, rule, index) {
  const line = source.slice(0, index).split('\n').length;
  const raw = lines[line - 1] || '';
  let snippet = raw.trim();
  if (snippet.length > MAX_SNIPPET_LENGTH) {
    const lineStart = source.lastIndexOf('\n', index - 1) + 1;
    const column = index - lineStart;
    const start = Math.max(0, column - 80);
    const end = Math.min(raw.length, column + 156);
    snippet = `${start > 0 ? '…' : ''}${raw.slice(start, end).trim()}${end < raw.length ? '…' : ''}`;
  }
  return { rule, file: rel, line, snippet };
}

function ignoredFinding(finding) {
  return ALLOW_RE.test(finding.snippet);
}

function firstActiveMatch(pattern, source, offset, mask) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (mask[offset + match.index]) return match;
  }
  return null;
}

function lastActiveBoundary(source, index, mask) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (mask[cursor] && /[;{}]/.test(source[cursor])) return cursor;
  }
  return -1;
}

function colorIsStructural(source, index, mask) {
  if (mask[index]) return true;
  let literalStart = index;
  while (literalStart > 0 && !mask[literalStart - 1]) literalStart -= 1;
  if (source.startsWith('//', literalStart) || source.startsWith('/*', literalStart)) return false;
  const statementStart = lastActiveBoundary(source, literalStart - 1, mask) + 1;
  const prefix = source.slice(statementStart, literalStart);
  const aggregateStart = source.lastIndexOf(';', literalStart - 1) + 1;
  const aggregatePrefix = source.slice(aggregateStart, literalStart);
  const aggregateBinding = /\b(?:(?:const|let|var)\s+|static\s+)([A-Za-z_$][\w$]*)\s*=\s*[\[{][\s\S]*$/.exec(aggregatePrefix);
  const aggregateName = aggregateBinding ? aggregateBinding[1] : '';
  const stylingAggregate = /^(?:css|style|icon|color|background|border|fill|stroke|shadow|palette|theme|colors)$/i.test(aggregateName)
    || /(?:Css|Style|Icon|Color|Background|Border|Fill|Stroke|Shadow|Palette|Theme|Colors)$/.test(aggregateName);
  if (stylingAggregate) return true;
  if (/(?:\.style\b|\[\s*["'`]style["'`]\s*\]|\bcssText\b|\b(?:innerHTML|outerHTML)\s*=|\b(?:css|style|icon|color|background|border|fill|stroke|shadow|bg|fg|red|green|blue|amber|orange|yellow|purple|gr[ae]y|white|black|[A-Za-z_$][\w$]*(?:Css|Style|Icon|Color|Background|Border|Fill|Stroke|Shadow|Bg|Fg))\s*=[\s\S]*$|\b(?:color|background|border|fill|stroke|shadow|bg|fg|text)\s*=[\s\S]*$|\b(?:color|background|border|fill|stroke|shadow|bg|fg|text)[A-Za-z_$\d-]*\s*:\s*$|\b(?:setAttribute|setProperty)\s*\([^)]*$|\b(?:pill|_?render[A-Za-z_$\d]*)\s*\([^;]*$)/i.test(prefix)) {
    return true;
  }
  const binding = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[\s\S]*$/.exec(prefix);
  if (!binding) return false;
  let literalEnd = index;
  while (literalEnd < source.length && !mask[literalEnd]) literalEnd += 1;
  const blockEnd = enclosingBlockEnd(source, literalStart, mask);
  const escapedName = binding[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const after = source.slice(literalEnd, blockEnd);
  const mutation = firstActiveMatch(
    new RegExp(`\\b${escapedName}\\s*(?:=(?!=|>)|\\+=|-=|\\*=|/=|%=|\\|\\|=|&&=|\\?\\?=|\\+\\+|--)`, 'g'),
    after, literalEnd, mask,
  );
  const bounded = mutation ? after.slice(0, mutation.index) : after;
  const flows = [
    new RegExp(`(?:\\.style|\\[\\s*["'\`]style["'\`]\\s*\\])(?:\\.|\\[)[^;\\n=]*=\\s*${escapedName}\\b`, 'g'),
    new RegExp(`\\.style\\s*\\.\\s*cssText\\s*=\\s*[^;]*\\b${escapedName}\\b`, 'g'),
    new RegExp(`\\.style\\s*\\.\\s*setProperty\\s*\\([^,]+,\\s*${escapedName}\\b`, 'g'),
  ];
  return flows.some((flow) => firstActiveMatch(flow, bounded, literalEnd, mask));
}

function activeRangeIsTrivia(source, start, end, mask) {
  for (let index = start; index < end; index += 1) {
    if (mask[index] && !/\s/.test(source[index])) return false;
  }
  return true;
}

function styleArgument(source, start, end, mask) {
  const pattern = /(?:\.style|\[\s*["'`]style["'`]\s*\])/g;
  const argument = source.slice(start, end);
  let match;
  while ((match = pattern.exec(argument)) !== null) {
    const absolute = start + match.index;
    if (mask[absolute] && activeRangeIsTrivia(source, absolute + match[0].length, end, mask)) return true;
  }
  return false;
}

function topLevelComma(source, start, mask) {
  const depth = { '(': 0, '[': 0, '{': 0 };
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (let index = start; index < source.length; index += 1) {
    if (!mask[index]) continue;
    const char = source[index];
    if (Object.prototype.hasOwnProperty.call(depth, char)) depth[char] += 1;
    else if (Object.prototype.hasOwnProperty.call(closing, char)) {
      const opener = closing[char];
      if (depth[opener] === 0) return -1;
      depth[opener] -= 1;
    } else if (char === ',' && Object.values(depth).every((value) => value === 0)) return index;
  }
  return -1;
}

function matchingObjectEnd(source, open, mask) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (!mask[index]) continue;
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

function skipJsTrivia(source, start, end) {
  let index = start;
  while (index < end) {
    if (/\s/.test(source[index])) { index += 1; continue; }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 || newline >= end ? end : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      index = close === -1 || close + 2 >= end ? end : close + 2;
      continue;
    }
    break;
  }
  return index;
}

function simpleQuotedKey(source, start, end) {
  const quote = source[start];
  if (!['"', "'", '`'].includes(quote)) return null;
  let value = '';
  for (let index = start + 1; index < end; index += 1) {
    if (source[index] === '\\') return null;
    if (source[index] === quote) return { value, end: index + 1 };
    value += source[index];
  }
  return null;
}

function topLevelCssTextProperty(source, start, end) {
  let index = skipJsTrivia(source, start, end);
  if (index >= end) return false;
  if (source[index] === '[') {
    index = skipJsTrivia(source, index + 1, end);
    const computed = simpleQuotedKey(source, index, end);
    if (!computed || computed.value !== 'cssText') return false;
    index = skipJsTrivia(source, computed.end, end);
    if (source[index] !== ']') return false;
    index = skipJsTrivia(source, index + 1, end);
    return source[index] === ':';
  }
  const quoted = simpleQuotedKey(source, index, end);
  if (quoted) {
    if (quoted.value !== 'cssText') return false;
    index = skipJsTrivia(source, quoted.end, end);
    return source[index] === ':';
  }
  if (!source.startsWith('cssText', index) || /[A-Za-z0-9_$]/.test(source[index + 7] || '')) return false;
  index = skipJsTrivia(source, index + 7, end);
  return index >= end || source[index] === ':';
}

function objectHasTopLevelCssText(source, open, close, mask) {
  const depth = { '(': 0, '[': 0, '{': 0 };
  const closing = { ')': '(', ']': '[', '}': '{' };
  let propertyStart = open + 1;
  for (let index = open + 1; index <= close; index += 1) {
    const atEnd = index === close;
    const char = source[index];
    if (!atEnd && mask[index]) {
      if (Object.prototype.hasOwnProperty.call(depth, char)) depth[char] += 1;
      else if (Object.prototype.hasOwnProperty.call(closing, char)) depth[closing[char]] -= 1;
    }
    if (atEnd || (char === ',' && mask[index] && Object.values(depth).every((value) => value === 0))) {
      if (topLevelCssTextProperty(source, propertyStart, index)) return true;
      propertyStart = index + 1;
    }
  }
  return false;
}

function objectAssignCssTextSites(source, mask) {
  const sites = [];
  const calls = /\bObject\.assign\s*\(/g;
  let match;
  while ((match = calls.exec(source)) !== null) {
    if (!mask[match.index]) continue;
    const openParen = match.index + match[0].lastIndexOf('(');
    const comma = topLevelComma(source, openParen + 1, mask);
    if (comma === -1 || !styleArgument(source, openParen + 1, comma, mask)) continue;
    const objectStart = skipJsTrivia(source, comma + 1, source.length);
    if (source[objectStart] !== '{' || !mask[objectStart]) continue;
    const objectEnd = matchingObjectEnd(source, objectStart, mask);
    if (objectEnd !== -1 && objectHasTopLevelCssText(source, objectStart, objectEnd, mask)) sites.push(match.index);
  }
  return sites;
}

function scanInlineStyling(source, rel, lines) {
  const findings = [];
  const mask = rel.endsWith('.css') ? cssCodeMask(source) : codeMask(source);
  const cssTextPatterns = [
    /(?:\.style|\[\s*["'`]style["'`]\s*\])\s*(?:\.\s*cssText|\[\s*["'`]cssText["'`]\s*\])\s*(?:=|\+=|\|\|=|&&=|\?\?=)/g,
  ];
  let match;
  for (const cssTextPattern of cssTextPatterns) {
    while ((match = cssTextPattern.exec(source)) !== null) {
      if (!mask[match.index]) continue;
      const finding = lineFinding(source, rel, lines, 'inline-css-text', match.index);
      if (!ignoredFinding(finding)) findings.push(finding);
    }
  }
  for (const index of objectAssignCssTextSites(source, mask)) {
    const finding = lineFinding(source, rel, lines, 'inline-css-text', index);
    if (!ignoredFinding(finding)) findings.push(finding);
  }
  if (rel === SAUCE_CORE || rel.startsWith(VENDORED_THEME_PREFIX)) return findings;
  const colorPattern = /#[0-9a-f]{3,8}\b|rgba?\(\s*[-+.\d]/gi;
  while ((match = colorPattern.exec(source)) !== null) {
    if (!colorIsStructural(source, match.index, mask)) continue;
    const finding = lineFinding(source, rel, lines, 'hardcoded-color', match.index);
    if (!ignoredFinding(finding)) findings.push(finding);
  }
  return findings;
}

function enclosingBlockEnd(source, index, mask) {
  const stack = [];
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (!mask[cursor]) continue;
    if (source[cursor] === '{') stack.push(cursor);
    else if (source[cursor] === '}') stack.pop();
  }
  if (stack.length === 0) return source.length;
  let depth = 1;
  for (let cursor = stack[stack.length - 1] + 1; cursor < source.length; cursor += 1) {
    if (!mask[cursor]) continue;
    if (source[cursor] === '{') depth += 1;
    else if (source[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return source.length;
}

function scanStructuralNavRows(source, rel, lines, mask) {
  const findings = [];
  const callStart = /\b(createDiv|createEl|createElement)\s*\(/g;
  let match;
  while ((match = callStart.exec(source)) !== null) {
    if (!mask[match.index]) continue;
    const openIndex = source.indexOf('(', match.index);
    const closeIndex = matchingParen(source, openIndex);
    if (closeIndex < 0) continue;
    const args = splitTopLevelArgs(source.slice(openIndex + 1, closeIndex));
    const options = match[1] === 'createDiv'
      ? args[0]
      : (/^(["'`])div\1$/.test((args[0] || '').trim()) ? args[1] : '');
    const literalClass = match[1] === 'createDiv' && /^(["'`])[^"'`]*nav[^"'`]*\1$/i.test((args[0] || '').trim());
    const objectClass = /(?:(?:["'`](?:class|cls|className)["'`])|\b(?:class|cls|className)\b)\s*:\s*(["'`])[^"'`]*nav[^"'`]*\1/i.test(options || '');
    if (!literalClass && !objectClass) continue;
    const statementStart = Math.max(
      source.lastIndexOf(';', match.index - 1),
      source.lastIndexOf('{', match.index - 1),
      source.lastIndexOf('}', match.index - 1),
    ) + 1;
    const prefix = source.slice(statementStart, match.index);
    const variable = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/.exec(prefix);
    if (!variable) continue;
    const escapedVariable = variable[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const afterCall = source.slice(closeIndex + 1);
    const redeclaration = firstActiveMatch(
      new RegExp(`\\b(?:const|let|var)\\s+${escapedVariable}\\b`, 'g'),
      afterCall, closeIndex + 1, mask,
    );
    const boundedEnd = redeclaration ? closeIndex + 1 + redeclaration.index : source.length;
    const childCall = new RegExp(`\\b${escapedVariable}\\.(?:createEl|createElement)\\s*\\(`, 'g');
    childCall.lastIndex = closeIndex + 1;
    let buttonCount = 0;
    let child;
    while ((child = childCall.exec(source)) !== null && child.index < boundedEnd) {
      if (!mask[child.index]) continue;
      const childOpen = source.indexOf('(', child.index);
      const childClose = matchingParen(source, childOpen);
      if (childClose < 0 || childClose > boundedEnd) continue;
      const childArgs = splitTopLevelArgs(source.slice(childOpen + 1, childClose));
      if (/^(["'`])button\1$/.test((childArgs[0] || '').trim())) buttonCount += 1;
    }
    if (buttonCount < 1) continue;
    const finding = lineFinding(source, rel, lines, 'bespoke-nav', match.index);
    if (!ignoredFinding(finding)) findings.push(finding);
  }
  return findings;
}

function scanBespokeNav(source, rel, lines) {
  const findings = [];
  const mask = codeMask(source);
  const patterns = [
    /(?:\bclass\b|(["'`])class\1)\s*:\s*(["'`])[A-Za-z_$][\w$]*(?:Nav|NavButtons)\2/g,
    /\bcustomJS\s*(?:\.|\?\.)\s*[A-Za-z_$][\w$]*(?:Nav|NavButtons)\s*(?:\.|\?\.)\s*(?:render|show|open)\s*(?:\?\.)?\s*\(/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const evidenceIndex = pattern === patterns[0] ? source.indexOf(':', match.index) : match.index;
      if (!mask[evidenceIndex]) continue;
      const finding = lineFinding(source, rel, lines, 'bespoke-nav', match.index);
      if (!ignoredFinding(finding)) findings.push(finding);
    }
  }
  findings.push(...scanStructuralNavRows(source, rel, lines, mask));
  return findings;
}

function staticAddLabelBindings(source, mask) {
  const bindings = [];
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])\+[^"'`]*\2\s*(?:;|(?=\n|$))/g;
  let match;
  while ((match = declaration.exec(source)) !== null) {
    if (!mask[match.index]) continue;
    const after = source.slice(declaration.lastIndex);
    const escapedName = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mutation = firstActiveMatch(
      new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\b|\\b${escapedName}\\s*(?:=(?!=|>)|\\+=|-=|\\*=|/=|%=|\\|\\|=|&&=|\\?\\?=|\\+\\+|--)`, 'g'),
      after, declaration.lastIndex, mask,
    );
    const blockEnd = enclosingBlockEnd(source, match.index, mask);
    const mutationEnd = mutation ? declaration.lastIndex + mutation.index : source.length;
    bindings.push({
      name: match[1],
      start: declaration.lastIndex,
      end: Math.min(blockEnd, mutationEnd),
    });
  }
  return bindings;
}

function scanLegacyAccentAdds(source, rel, lines, mask) {
  const findings = [];
  const callStart = /\b(?:(?:customJS|cjs)\s*(?:\.|\?\.)\s*)?AccentButton\s*(?:\.|\?\.)\s*render\s*(?:\?\.)?\s*\(/g;
  let match;
  while ((match = callStart.exec(source)) !== null) {
    if (!mask[match.index]) continue;
    const openIndex = source.indexOf('(', match.index);
    const closeIndex = matchingParen(source, openIndex);
    if (closeIndex < 0) continue;
    const args = splitTopLevelArgs(source.slice(openIndex + 1, closeIndex));
    const options = [...args].reverse().find((arg) => /(?:\blabel\b|["'`]label["'`])\s*:/.test(arg)) || '';
    const label = /(?:(?:["'`]label["'`])|\blabel\b)\s*:\s*(["'`])([^"'`]*)\1/.exec(options);
    const icon = /(?:(?:["'`]icon["'`])|\bicon\b)\s*:\s*([^,}\n]+)/.exec(options);
    if (!label || !/^(?:\+\s*)?(?:add|new)\b/i.test(label[2])) continue;
    if (!label[2].trim().startsWith('+') && (!icon || !/plus/i.test(icon[1]))) continue;
    const finding = lineFinding(source, rel, lines, 'bespoke-add-button', match.index);
    if (!ignoredFinding(finding)) findings.push(finding);
  }
  return findings;
}

function isAddLabelExpression(expression, position, bindings) {
  const trimmed = String(expression || '').trim();
  if (/^(["'`])\+[^"'`]*\1$/.test(trimmed)) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(trimmed)) return false;
  return bindings.some((binding) => binding.name === trimmed && position >= binding.start && position < binding.end);
}

function scanBespokeAddCalls(source, rel, lines) {
  const findings = [];
  const mask = codeMask(source);
  const addLabelBindings = staticAddLabelBindings(source, mask);
  const buttonVars = [];
  const callStart = /\b(?:createEl|createElement)\s*\(/g;
  let match;
  while ((match = callStart.exec(source)) !== null) {
    if (!mask[match.index]) continue;
    const openIndex = source.indexOf('(', match.index);
    const closeIndex = matchingParen(source, openIndex);
    if (closeIndex < 0) continue;
    const args = splitTopLevelArgs(source.slice(openIndex + 1, closeIndex));
    if (!/^(["'`])button\1$/.test((args[0] || '').trim())) continue;
    const statementStart = Math.max(
      source.lastIndexOf(';', match.index - 1),
      source.lastIndexOf('{', match.index - 1),
      source.lastIndexOf('}', match.index - 1),
    ) + 1;
    const prefix = source.slice(statementStart, match.index);
    const variable = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/.exec(prefix);
    if (variable) buttonVars.push({ name: variable[1], start: closeIndex + 1 });
    const chainedLabel = /^\s*(?:\.|\?\.)\s*(?:setText\s*\(\s*([^\n,)]+)\s*\)|(?:textContent|innerText)\s*=\s*([^;\n]+))/
      .exec(source.slice(closeIndex + 1));
    if (chainedLabel && isAddLabelExpression(chainedLabel[1] || chainedLabel[2], match.index, addLabelBindings)) {
      const finding = lineFinding(source, rel, lines, 'bespoke-add-button', match.index);
      if (!ignoredFinding(finding)) findings.push(finding);
      continue;
    }
    const textProperty = /(?:(?:["'`]text["'`])|\btext\b)\s*:\s*([^,}\n]+)/.exec(args[1] || '');
    if (!textProperty || !isAddLabelExpression(textProperty[1], match.index, addLabelBindings)) continue;
    const finding = lineFinding(source, rel, lines, 'bespoke-add-button', match.index);
    if (ignoredFinding(finding)) continue;
    findings.push(finding);
  }

  for (const variable of buttonVars) {
    const escapedVariable = variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const afterCall = source.slice(variable.start);
    const redeclaration = firstActiveMatch(
      new RegExp(`\\b(?:const|let|var)\\s+${escapedVariable}\\b`, 'g'),
      afterCall, variable.start, mask,
    );
    const end = redeclaration ? variable.start + redeclaration.index : source.length;
    const boundedSource = source.slice(variable.start, end);
    const assignments = [
      new RegExp(`\\b${escapedVariable}\\.(?:textContent|innerText)\\s*=\\s*([^;\\n]+)`, 'g'),
      new RegExp(`\\b${escapedVariable}\\.setText\\s*\\(\\s*([^\\n,)]+)\\s*\\)`, 'g'),
    ];
    for (const assignment of assignments) {
      let assignmentMatch;
      while ((assignmentMatch = assignment.exec(boundedSource)) !== null) {
        const absoluteIndex = variable.start + assignmentMatch.index;
        if (!mask[absoluteIndex]) continue;
        if (!isAddLabelExpression(assignmentMatch[1], absoluteIndex, addLabelBindings)) continue;
        const finding = lineFinding(source, rel, lines, 'bespoke-add-button', absoluteIndex);
        if (!ignoredFinding(finding)) findings.push(finding);
      }
    }
  }
  findings.push(...scanLegacyAccentAdds(source, rel, lines, mask));
  return findings;
}

function executableMarkdownSource(source) {
  const output = [...source].map((char) => (char === '\n' ? '\n' : ' '));
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  let fence = null;
  for (const line of lines) {
    if (!fence) {
      const opening = /^ {0,3}(`{3,}|~{3,})\s*(?:dataviewjs|javascript|js|customjs)\s*(?:\n)?$/i.exec(line);
      if (opening) fence = opening[1][0];
    } else if (new RegExp(`^ {0,3}${fence}{3,}\\s*(?:\\n)?$`).test(line)) {
      fence = null;
    } else {
      for (let index = 0; index < line.length; index += 1) output[offset + index] = line[index];
    }
    offset += line.length;
  }
  return output.join('');
}

function scanSource(source, rel, options = {}) {
  const lines = source.split('\n');
  const markdownBody = options.markdownBody === true || rel.endsWith('.md');
  const structuralSource = markdownBody ? executableMarkdownSource(source) : source;
  const findings = scanInlineStyling(structuralSource, rel, lines);
  findings.push(...scanBespokeNav(structuralSource, rel, lines));
  findings.push(...scanBespokeAddCalls(structuralSource, rel, lines));
  return findings;
}

function collectInlineBodies(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectInlineBodies(item, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'inline_body' && typeof child === 'string') out.push(child);
    else collectInlineBodies(child, out);
  }
  return out;
}

function scanManifest(source, rel) {
  let parsed;
  try { parsed = JSON.parse(source); } catch (_e) { return []; }
  const bodies = collectInlineBodies(parsed);
  const keyLines = [];
  const keyPattern = /"inline_body"\s*:/g;
  let keyMatch;
  while ((keyMatch = keyPattern.exec(source)) !== null) {
    keyLines.push(source.slice(0, keyMatch.index).split('\n').length);
  }
  return bodies.flatMap((body, index) => {
    const startLine = keyLines[index] || 1;
    return scanSource(body, rel, { markdownBody: true }).map((finding) => ({
      ...finding,
      // JSON string newlines are escapes inside one physical source line.
      // Anchor decoded inline-body findings to that physical key line rather
      // than inventing line numbers from the decoded Markdown body.
      line: startLine,
    }));
  });
}

function scanFile(file, root = REPO_ROOT) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');
  if (path.basename(file) === 'manifest.json') return scanManifest(source, rel);
  return scanSource(source, rel);
}

function scanTree() {
  const files = SCAN_DIRS.flatMap((dir) => walk(dir));
  const findings = files.flatMap((file) => scanFile(file));
  findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b)));
  return { files, findings };
}

function countsFor(findings) {
  const counts = Object.fromEntries(RULES.map((rule) => [rule.id, 0]));
  for (const finding of findings) counts[finding.rule] = (counts[finding.rule] || 0) + 1;
  return counts;
}

function compareBaseline(findings, baselineFindings) {
  const group = (items) => {
    const grouped = new Map();
    for (const item of items) {
      const key = findingKey(item);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    return grouped;
  };
  const current = group(findings);
  const baseline = group(baselineFindings);
  const added = [];
  const stale = [];
  for (const [key, items] of current) {
    const expectedCount = (baseline.get(key) || []).length;
    if (items.length > expectedCount) added.push(...items.slice(expectedCount));
  }
  for (const [key, items] of baseline) {
    const currentCount = (current.get(key) || []).length;
    if (items.length > currentCount) stale.push(...items.slice(currentCount));
  }
  return { added, stale };
}

function loadBaseline() {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
  catch (error) { throw new Error(`cannot read ${path.relative(REPO_ROOT, BASELINE_PATH)}: ${error.message}`); }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.findings) || !parsed.counts) {
    throw new Error('baseline must contain version 1, counts, and a findings array');
  }
  return parsed;
}

function writeBaseline(findings) {
  const baseline = { version: 1, counts: countsFor(findings), findings };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}

function printFinding(prefix, finding) {
  console.error(`  ${prefix} ${finding.rule} ${finding.file}:${finding.line}`);
  console.error(`    ${finding.snippet}`);
}

function runSelfTest() {
  const fixturesRoot = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'lint-styling');
  const cases = [
    { file: 'pass/shared-primitives.js', expected: [] },
    { file: 'fail/inline-and-color.js', expected: ['hardcoded-color', 'inline-css-text'] },
    { file: 'fail/variable-color.js', expected: ['hardcoded-color'] },
    { file: 'fail/bracket-color.js', expected: ['hardcoded-color'] },
    { file: 'fail/palette-color.js', expected: ['hardcoded-color'] },
    { file: 'fail/interpolated-color.js', expected: ['hardcoded-color', 'hardcoded-color', 'inline-css-text'] },
    { file: 'fail/concatenated-color.js', expected: ['hardcoded-color', 'inline-css-text'] },
    { file: 'fail/minified-color.css', expected: ['hardcoded-color'] },
    { file: 'fail/url-color.css', expected: ['hardcoded-color'] },
    { file: 'fail/bracket-css-text.js', expected: ['inline-css-text'] },
    { file: 'fail/style-bracket.js', expected: ['inline-css-text'] },
    { file: 'fail/object-assign-css.js', expected: ['inline-css-text', 'inline-css-text', 'inline-css-text'] },
    { file: 'fail/comment-prefixed-active.js', expected: ['bespoke-add-button', 'bespoke-nav', 'hardcoded-color', 'inline-css-text', 'inline-css-text'] },
    { file: 'fail/nav-and-add.js', expected: ['bespoke-add-button', 'bespoke-nav'] },
    { file: 'fail/structural-nav.js', expected: ['bespoke-nav'] },
    { file: 'fail/create-div-nav.js', expected: ['bespoke-nav'] },
    { file: 'fail/long-add.js', expected: ['bespoke-add-button'] },
    { file: 'fail/post-label.js', expected: ['bespoke-add-button'] },
    { file: 'fail/inner-text.js', expected: ['bespoke-add-button'] },
    { file: 'fail/set-text.js', expected: ['bespoke-add-button'] },
    { file: 'fail/chained-set-text.js', expected: ['bespoke-add-button'] },
    { file: 'fail/variable-label.js', expected: ['bespoke-add-button'] },
    { file: 'fail/accent-add.js', expected: ['bespoke-add-button'] },
    { file: 'fail/template-interpolation.js', expected: ['bespoke-nav'] },
    { file: 'fail/fenced-nav.md', expected: ['bespoke-nav'] },
    { file: 'fail/manifest.json', expected: ['bespoke-nav'], expectedLines: [5] },
    { file: 'pass/inert-string.js', expected: [] },
    { file: 'pass/reused-variable.js', expected: [] },
    { file: 'pass/mutated-label.js', expected: [] },
    { file: 'pass/markdown-prose.md', expected: [] },
    { file: 'pass/manifest.json', expected: [] },
    { file: 'pass/object-assign-inert.js', expected: [] },
    { file: 'pass/cross-scope-label.js', expected: [] },
  ];
  let failures = 0;
  const allFixtureFindings = [];

  for (const testCase of cases) {
    const findings = scanFile(path.join(fixturesRoot, testCase.file), fixturesRoot);
    allFixtureFindings.push(...findings);
    const actual = findings.map((finding) => finding.rule).sort();
    const expected = [...testCase.expected].sort();
    const actualLines = findings.map((finding) => finding.line).sort((a, b) => a - b);
    const expectedLines = testCase.expectedLines || actualLines;
    if (JSON.stringify(actual) === JSON.stringify(expected)
      && JSON.stringify(actualLines) === JSON.stringify(expectedLines)) {
      console.log(`ok lint-styling self-test ${testCase.file}: ${actual.length} finding(s)`);
    } else {
      console.error(`FAIL lint-styling self-test ${testCase.file}: expected ${expected.join(', ') || 'clean'} at ${expectedLines.join(', ') || 'no lines'}, got ${actual.join(', ') || 'clean'} at ${actualLines.join(', ') || 'no lines'}`);
      failures += 1;
    }
  }

  const largeObjectSource = `Object.assign(row.style, {\n${'paddingInlineStart: 0,\n'.repeat(220)}cssText: 'display:flex'\n});`;
  const largeObjectFindings = scanSource(largeObjectSource, 'fail/object-assign-large.js');
  allFixtureFindings.push(...largeObjectFindings);
  if (largeObjectSource.length > 3793
    && JSON.stringify(largeObjectFindings.map((finding) => finding.rule)) === JSON.stringify(['inline-css-text'])) {
    console.log('ok lint-styling self-test fail/object-assign-large.js: unbounded top-level cssText finding');
  } else {
    console.error('FAIL lint-styling self-test fail/object-assign-large.js: balanced scan missed large top-level cssText');
    failures += 1;
  }

  const exact = compareBaseline(allFixtureFindings, allFixtureFindings);
  if (exact.added.length === 0 && exact.stale.length === 0) {
    console.log('ok lint-styling self-test exact baseline passes');
  } else {
    console.error('FAIL lint-styling self-test exact baseline comparison');
    failures += 1;
  }

  if (allFixtureFindings.every((finding) => finding.snippet.length <= MAX_SNIPPET_LENGTH)) {
    console.log('ok lint-styling self-test evidence snippets stay bounded');
  } else {
    console.error('FAIL lint-styling self-test evidence snippet exceeded bound');
    failures += 1;
  }

  const movedLines = allFixtureFindings.map((finding) => ({ ...finding, line: finding.line + 10 }));
  const moved = compareBaseline(movedLines, allFixtureFindings);
  if (moved.added.length === 0 && moved.stale.length === 0) {
    console.log('ok lint-styling self-test line-only movement preserves baseline identity');
  } else {
    console.error('FAIL lint-styling self-test line-only movement changed baseline identity');
    failures += 1;
  }

  const duplicateFinding = compareBaseline([...allFixtureFindings, allFixtureFindings[0]], allFixtureFindings);
  if (duplicateFinding.added.length === 1) {
    console.log('ok lint-styling self-test duplicate findings are compared as a multiset');
  } else {
    console.error('FAIL lint-styling self-test duplicate finding was collapsed');
    failures += 1;
  }

  const removedEntry = compareBaseline(allFixtureFindings, allFixtureFindings.slice(1));
  if (removedEntry.added.length === 1) {
    console.log('ok lint-styling self-test removed live entry fails');
  } else {
    console.error('FAIL lint-styling self-test removed live entry was not detected');
    failures += 1;
  }

  const staleEntry = { rule: 'inline-css-text', file: 'retired.js', line: 1, snippet: 'retired.style.cssText = "";' };
  const addedStale = compareBaseline(allFixtureFindings, [...allFixtureFindings, staleEntry]);
  if (addedStale.stale.length === 1) {
    console.log('ok lint-styling self-test stale baseline entry fails');
  } else {
    console.error('FAIL lint-styling self-test stale baseline entry was not detected');
    failures += 1;
  }

  console.log(`\n${failures === 0 ? 'ok' : 'FAIL'} lint-styling self-test: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return runSelfTest();

  const { files, findings } = scanTree();
  if (args.includes('--update-baseline')) {
    writeBaseline(findings);
    console.log(`Baseline updated: ${findings.length} finding(s) across ${files.length} file(s).`);
    console.log(JSON.stringify(countsFor(findings)));
    return;
  }

  let baseline;
  try { baseline = loadBaseline(); }
  catch (error) {
    console.error(`FAIL lint-styling: ${error.message}`);
    process.exit(1);
  }

  const currentCounts = countsFor(findings);
  const countMismatch = JSON.stringify(currentCounts) !== JSON.stringify(baseline.counts);
  const { added, stale } = compareBaseline(findings, baseline.findings);
  if (added.length === 0 && stale.length === 0 && !countMismatch) {
    console.log(`ok lint-styling: ${files.length} file(s), ${findings.length} grandfathered finding(s); baseline exact.`);
    console.log(JSON.stringify(currentCounts));
    return;
  }

  console.error(`FAIL lint-styling: ${added.length} new finding(s), ${stale.length} stale baseline entr${stale.length === 1 ? 'y' : 'ies'}.`);
  for (const finding of added) printFinding('+', finding);
  for (const finding of stale) printFinding('-', finding);
  if (countMismatch) {
    console.error(`  baseline counts: ${JSON.stringify(baseline.counts)}`);
    console.error(`  current counts:  ${JSON.stringify(currentCounts)}`);
  }
  console.error('\nMigrate the site to ChromeBar, EntityCreate, SauceModal, or sauce-core.');
  console.error('For an intentional current-tree snapshot only: npm run lint-styling -- --update-baseline');
  process.exit(1);
}

main();
