'use strict';

// customJS-loadability gate (CJS-LOAD) — hard gate; no baseline.
//
// WHY THIS EXISTS
// ---------------
// The CustomJS plugin (samlewis0602, v1.0.x) loads each script file like this
// (main.js `evalFile`):
//
//     const def = eval(`(${fileBody})`);   // whole file wrapped in ( ... )
//     const cls = new def();               // then instantiated
//     window.customJS[cls.constructor.name] = cls;
//
// i.e. it wraps the ENTIRE file in parentheses and evaluates it as a SINGLE
// EXPRESSION, then `new`s the resulting class. A file that is a bare class
// definition works. A file with ANY trailing statement after the class — most
// notably the Node dual-export trailer
//
//     class Foo { ... }
//     if (typeof module !== "undefined" && module.exports) { module.exports = { Foo }; }
//
// parses fine as a Node *script* (class declaration + if statement are both
// valid statements), so `node --check` and `require()` are GREEN. But as an
// *expression* `(class Foo {} if (...) {})` is a SyntaxError ("Unexpected
// token 'if'"). CustomJS's `new def()` then throws (it swallows the error to
// the console), the class NEVER registers on window.customJS, and every
// customjs-guard block referencing it falls back to the
// "_<ClassName> unavailable_" placeholder. This is exactly how
// SpaceDailyDashboard broke on the daily note.
//
// `node --check` / `require()` cannot catch this because they use a *statement*
// parse context, not customJS's *expression* wrap. This gate replicates
// customJS's loader precisely, so the divergence can never regress silently.
//
// SCOPE
// -----
// Every customJS class file under the source-of-truth + dogfood trees:
//   - ranch/scripts/            (dogfood self-install = exact customJS load set)
//   - platform/blueprints/      (canonical blueprint helpers)
//   - platform/mechanisms/      (canonical mechanism scripts)
//   - platform/customjs/        (platform-level customJS classes)
// A file is treated as a customJS class file iff, after stripping leading
// comments + whitespace, its first token is `class` — this cleanly includes
// every customJS class and excludes node-only scripts (which begin with
// 'use strict' / const/require / a function). Node scripts are NOT loaded by
// customJS and are skipped.
//
// The gate replicates customJS exactly: `new (eval("(" + body + ")"))()`.
// (Verified: zero customJS class files have a constructor that touches
// app/window/customJS/moment/Notice, so instantiating in Node is
// false-positive-free.)

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = [
  'ranch/scripts',
  'platform/blueprints',
  'platform/mechanisms',
  'platform/customjs',
];

function walk(dir, acc) {
  const abs = path.isAbsolute(dir) ? dir : path.join(REPO_ROOT, dir);
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (_e) { return acc; }
  for (const e of ents) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

// Return the first ~80 chars of the file AFTER skipping leading whitespace,
// line comments, and block comments — used to decide if the file is a
// customJS class file (first real token is `class`).
function firstRealToken(src) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    break;
  }
  return src.slice(i, i + 80);
}

function isCustomJsClassFile(src) {
  return /^class\b/.test(firstRealToken(src));
}

// Replicate customJS's evalFile: eval(`(${body})`) then new def().
// Returns null on success, or an error string describing the failure.
function loadFailure(body) {
  let def;
  try {
    // eslint-disable-next-line no-eval
    def = eval('(' + body + ')');
  } catch (e) {
    return `eval("(" + file + ")") threw: ${e.constructor.name}: ${String(e.message).split('\n')[0]}`;
  }
  if (typeof def !== 'function') {
    return `eval did not yield a constructable class (got ${typeof def})`;
  }
  try {
    new def(); // eslint-disable-line no-new
  } catch (e) {
    return `new def() threw: ${e.constructor.name}: ${String(e.message).split('\n')[0]}`;
  }
  return null;
}

// Scan a set of directories; return { scanned, classFiles, failures }.
function scan(dirs) {
  const files = dirs.reduce((a, d) => walk(d, a), []);
  const failures = [];
  let classFiles = 0;
  for (const f of files) {
    const body = fs.readFileSync(f, 'utf8');
    if (!isCustomJsClassFile(body)) continue;
    classFiles++;
    const fail = loadFailure(body);
    if (fail) failures.push({ file: path.relative(REPO_ROOT, f), message: fail });
  }
  return { scanned: files.length, classFiles, failures };
}

// --- CJS-REF: template class-ref resolution (sibling failure to a non-loadable
// class). A note template / content note / manifest `inline_body` that invokes
// customjs-guard with { class: "X" } for a class X that has NO `class X`
// definition in any shipped helper produces the SAME "_X unavailable_"
// placeholder as a class file that fails to load — customJS simply never
// registers X. This is exactly how finance shipped the deleted InvoiceNavButtons
// ref (consistency-audit W0). run-finance-template-classes.js is the finance-
// scoped regression lock; this is the PLATFORM-WIDE guardrail across all
// blueprints + mechanisms. Only literal `class: "Name"` refs are checked;
// dynamic/variable class names are not statically resolvable and are skipped.
const REF_SCAN_DIRS = ['platform/blueprints', 'platform/mechanisms'];

// Class DEFINITIONS are the runtime truth (customJS loads the shipped .js files,
// not the manifest customjs_classes[] catalogue), so resolve refs against actual
// `class X` definitions — a class shipped but omitted from a manifest still
// resolves at render, and must not false-positive here.
function collectClassNames(dirs) {
  const names = new Set();
  for (const d of dirs) {
    for (const f of walk(d, [])) {
      const t = fs.readFileSync(f, 'utf8');
      const re = /(?:^|\n)\s*class\s+([A-Za-z0-9_]+)/g;
      let m;
      while ((m = re.exec(t)) !== null) names.add(m[1]);
    }
  }
  return names;
}

function scanClassRefs() {
  const defs = collectClassNames(REF_SCAN_DIRS);
  const refs = [];
  function rec(abs) {
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (_e) { return; }
    for (const e of ents) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) { if (e.name === 'node_modules') continue; rec(p); }
      else if (e.name.endsWith('.md') || e.name === 'manifest.json') {
        const text = fs.readFileSync(p, 'utf8');
        const re = /customjs-guard["'][^)]*\bclass\s*:\s*["']([A-Za-z0-9_]+)["']/g;
        let m;
        while ((m = re.exec(text)) !== null) refs.push({ cls: m[1], file: path.relative(REPO_ROOT, p) });
      }
    }
  }
  for (const d of REF_SCAN_DIRS) rec(path.join(REPO_ROOT, d));
  const unresolved = refs.filter((r) => !defs.has(r.cls));
  return { refCount: refs.length, defCount: defs.size, unresolved };
}

// --- CJS-REF-COORDINATOR (gate 3): scans the string literals and template parts
// of scripts/autoloop/codex-coordinator.js for customjs-guard. When the scan
// completes, each occurrence yields at least one class reference or unreadable
// failure, and a class reference fails the gate unless collectClassNames finds
// its class name under platform/blueprints or platform/mechanisms. The gate
// also fails when fewer than COORDINATOR_REF_FLOOR references are read or a
// class in COORDINATOR_REQUIRED_CLASSES is not among them. Fixtures in
// COORDINATOR_FIXTURES check reading rules against examples.
//
// Scope: a drift check on the text the coordinator source writes, not a
// sandbox. Guard calls are parsed with await as a keyword, as Dataview runs a
// block containing await in an async function. An occurrence is unreadable when
// a later part of its template or + chain has no static string value and is not
// its class value, or when its call's arguments are not followed by optional
// whitespace and ) in that text. Not checked: parts joined before the
// occurrence's string; code before the call in its own string; functions that
// compute new text from the written text (a string method, a tag function given
// it as a substitution, a rebound String.raw); guard calls whose customjs-guard
// text is in no string literal or template part, such as text split across
// literals, written with an escape like \x2d in the note text, or held in a
// regex; and helper calls that do not name the helper as a call, such as
// through eval or a global object.
const acorn = require('acorn');

const COORDINATOR_SOURCE = 'scripts/autoloop/codex-coordinator.js';
const COORDINATOR_REF_FLOOR = 6;
const COORDINATOR_REQUIRED_CLASSES = ['BoardHealth', 'GraphView', 'OperatorStation'];
const EXPR_PLACEHOLDER_RE = /__sauceClassExpr(\d+)__/;
const CALL_SPLICE = 'customjs-guard call has __sauceClassExpr text between the opening quote of its path and the end of its object argument, outside its class value; a joined part with no static string value becomes such text';
const CALL_CHAIN = 'a later part of the template or + chain of this customjs-guard string or template part has no static string value and is not written as the whole text between the quotes of its class value';
const CALL_OPEN = "customjs-guard call's arguments are not followed by optional whitespace and ) in the text of this string or template part and the later parts of its template or + chain";

function stringValue(node) {
  if (node && node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node && node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function readGuardCall(text, at) {
  const call = /\bdv\.view\(\s*["'`][^"'`]*$/.exec(text.slice(0, at));
  if (!call) return { error: 'customjs-guard does not follow dv.view( at the start of a word, optional whitespace and a quote in this string or template part, with no other quote between that quote and customjs-guard' };
  let parsed;
  try { parsed = acorn.parseExpressionAt(text, call.index + call[0].search(/["'`]/), { ecmaVersion: 'latest', allowAwaitOutsideFunction: true }); }
  catch (_e) { return { error: "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value" }; }
  const args = parsed.type === 'SequenceExpression' ? parsed.expressions : [parsed];
  if (!/customjs-guard$/.test(stringValue(args[0]) || '')) return { error: "customjs-guard call's first argument, as parsed from the quote before customjs-guard, has no static string value ending in customjs-guard" };
  const config = args[1];
  if (!config || config.type !== 'ObjectExpression') return { error: 'customjs-guard call has no object literal as its second argument' };
  if (config.properties.some((p) => p.type !== 'Property' || p.computed)) return { error: 'customjs-guard object has a spread or computed key' };
  const keys = config.properties.filter((p) => (p.key.type === 'Identifier' ? p.key.name : p.key.value) === 'class');
  if (keys.length !== 1) return { error: `customjs-guard object has ${keys.length} class keys` };
  const value = stringValue(keys[0].value);
  if (value === null) return { error: 'customjs-guard class value is not a string literal' };
  const from = call.index + call[0].search(/["'`]/);
  const outside = [text.slice(from, keys[0].value.start), text.slice(keys[0].value.end, config.end)];
  const written = text.slice(keys[0].value.start + 1, keys[0].value.end - 1);
  return { value, spliced: outside.some((t) => t.includes('__sauceClassExpr')), written, closed: /^\s*\)/.test(text.slice(parsed.end)) };
}

function coordinatorClassRefs(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true });
  const parent = new Map();
  const nodes = [];
  (function visit(node) {
    nodes.push(node);
    for (const value of Object.values(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child && typeof child.type === 'string') { parent.set(child, node); visit(child); }
      }
    }
  })(ast);

  const refs = [];
  const problems = [];
  const concatenated = (node) => {
    for (let cur = node, up = parent.get(cur); up && up.type === 'BinaryExpression' && up.operator === '+'; cur = up, up = parent.get(up)) {
      if (up.left === cur) return up.right;
    }
    return null;
  };
  const following = (node) => {
    const pieces = [];
    for (let next = concatenated(node); next; next = concatenated(next)) pieces.push(next);
    return pieces;
  };
  const enclosingFunction = (node) => {
    for (let up = parent.get(node); up; up = parent.get(up)) {
      if (/Function/.test(up.type)) return up;
    }
    return null;
  };
  const isWithin = (node, ancestor) => {
    for (let up = node; up; up = parent.get(up)) if (up === ancestor) return true;
    return false;
  };
  const isName = (id) => {
    const up = parent.get(id);
    return (up.type === 'MemberExpression' && up.property === id && !up.computed)
      || (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(up.type) && up.key === id && !up.computed && !up.shorthand)
      || (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(up.type) && up.label === id);
  };
  const binds = (id) => {
    const up = parent.get(id);
    switch (up.type) {
      case 'AssignmentExpression': case 'AssignmentPattern': case 'ForInStatement': case 'ForOfStatement': return up.left === id;
      case 'UpdateExpression': case 'ArrayPattern': case 'RestElement': return true;
      case 'VariableDeclarator': case 'ClassDeclaration': case 'ClassExpression': return up.id === id;
      case 'CatchClause': return up.param === id;
      case 'Property': return up.value === id && parent.get(up).type === 'ObjectPattern';
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': return up.id === id || up.params.includes(id);
      default: return false;
    }
  };
  const resolve = (expr, line) => {
    const fn = expr.type === 'Identifier' ? enclosingFunction(expr) : null;
    const index = fn && fn.type === 'FunctionDeclaration' ? fn.params.findIndex((p) => p.name === expr.name) : -1;
    if (index < 0) { problems.push({ line, message: 'class value is not a string literal, a template literal without substitutions, or a plain identifier parameter of its nearest enclosing function, or that function is not a function declaration' }); return; }
    const rebinds = (n) => n !== fn.params[index] && isWithin(n, fn) && (n.type === 'WithStatement'
      || (n.type === 'Identifier' && (n.name === 'arguments' || n.name === 'eval' || (n.name === expr.name && binds(n)))));
    if (nodes.some(rebinds)) { problems.push({ line, message: `${expr.name} is redeclared or assigned in ${fn.id.name}, or ${fn.id.name} names arguments, eval or with` }); return; }
    let uses = 0;
    for (const id of nodes) {
      if (id.type !== 'Identifier' || id.name !== fn.id.name || id === fn.id || isName(id)) continue;
      uses++;
      const up = parent.get(id);
      const called = up.type === 'CallExpression' && up.callee === id
        && !up.arguments.slice(0, index).some((a) => a.type === 'SpreadElement');
      const value = called ? stringValue(up.arguments[index]) : null;
      if (value === null) problems.push({ line: id.loc.start.line, message: `${fn.id.name} appears other than as a call with a readable string literal class argument` });
      else refs.push({ cls: value, line: id.loc.start.line });
    }
    if (uses === 0) problems.push({ line, message: `${fn.id.name} has no call to read the class from` });
  };

  const parts = [];
  for (const node of nodes) {
    if (node.type === 'Literal' && typeof node.value === 'string') {
      parts.push({ text: node.value, line: node.loc.start.line, rest: () => following(node) });
    } else if (node.type === 'TemplateLiteral') {
      const up = parent.get(node);
      const tagged = up && up.type === 'TaggedTemplateExpression' && up.quasi === node;
      const raw = tagged && up.tag.type === 'MemberExpression' && !up.tag.computed
        && up.tag.object.type === 'Identifier' && up.tag.object.name === 'String' && up.tag.property.name === 'raw';
      const quasiText = (q) => (raw ? q.value.raw : q.value.cooked);
      node.quasis.forEach((q, i) => parts.push({
        text: quasiText(q),
        line: q.loc.start.line,
        opaque: tagged && !raw,
        rest: () => node.expressions.slice(i).flatMap((e, j) => [e, { type: 'Literal', value: quasiText(node.quasis[i + j + 1]) }])
          .concat(following(tagged ? up : node)),
      }));
    }
  }
  for (const part of parts) {
    for (let at = part.text.indexOf('customjs-guard'); at !== -1; at = part.text.indexOf('customjs-guard', at + 1)) {
      if (part.opaque) { problems.push({ line: part.line, message: 'customjs-guard string is in a template with a tag not written String.raw' }); continue; }
      const exprs = [];
      const text = part.text + part.rest().map((piece) => {
        const value = stringValue(piece);
        if (value !== null) return value;
        exprs.push(piece);
        return `__sauceClassExpr${exprs.length - 1}__`;
      }).join('');
      const collides = text.split('__sauceClassExpr').length - 1 > exprs.length;
      const { value, error, spliced, written, closed } = readGuardCall(text, at);
      const placeholder = value === undefined ? null : EXPR_PLACEHOLDER_RE.exec(value);
      if (error) problems.push({ line: part.line, message: error });
      else if (spliced && !(placeholder && (placeholder[0] !== value || collides))) problems.push({ line: part.line, message: CALL_SPLICE });
      else if (!(placeholder && (placeholder[0] !== value || collides)) && exprs.some((_e, i) => written !== `__sauceClassExpr${i}__`)) problems.push({ line: part.line, message: CALL_CHAIN });
      else if (!closed && !(placeholder && (placeholder[0] !== value || collides))) problems.push({ line: part.line, message: CALL_OPEN });
      else if (!placeholder) refs.push({ cls: value, line: part.line });
      else if (placeholder[0] !== value || collides) problems.push({ line: part.line, message: 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders' });
      else resolve(exprs[Number(placeholder[1])], part.line);
    }
  }
  return { refs, problems };
}

function coordinatorFailures(source, defs, file) {
  const { refs, problems } = coordinatorClassRefs(source);
  const names = new Set(refs.map((r) => r.cls));
  const failures = [];
  if (refs.length < COORDINATOR_REF_FLOOR) {
    failures.push(`FAIL CJS-REF-COORDINATOR floor: extracted ${refs.length} customjs-guard class ref(s) from ${file}, expected at least ${COORDINATOR_REF_FLOOR}`);
  }
  for (const cls of COORDINATOR_REQUIRED_CLASSES) {
    if (!names.has(cls)) failures.push(`FAIL CJS-REF-COORDINATOR required: no customjs-guard class ref "${cls}" extracted from ${file}`);
  }
  return { refs, failures: [...failures, ...refFailures(refs, problems, defs, file)] };
}

function refFailures(refs, problems, defs, file) {
  return [
    ...problems.map((p) => `FAIL CJS-REF-COORDINATOR unreadable: ${file}:${p.line} ${p.message}`),
    ...refs.filter((r) => !defs.has(r.cls))
      .map((r) => `FAIL CJS-REF-COORDINATOR: { class: "${r.cls}" } <- ${file}:${r.line} has no shipped class definition`),
  ];
}

function checkCoordinatorFixture(fixture, defs) {
  const unmet = fixture.precondition ? fixture.precondition() : null;
  if (unmet) return `precondition not met: ${unmet}`;
  const { refs, problems } = coordinatorClassRefs(fixture.source);
  const got = JSON.stringify({ refs: refs.map((r) => r.cls), failures: refFailures(refs, problems, defs, 'fixture') });
  const want = JSON.stringify({ refs: fixture.refs, failures: fixture.failures });
  return got === want ? null : `expected ${want}, got ${got}`;
}

const missing = (cls, line) => `FAIL CJS-REF-COORDINATOR: { class: "${cls}" } <- fixture:${line} has no shipped class definition`;
const unreadable = (line, message) => `FAIL CJS-REF-COORDINATOR unreadable: fixture:${line} ${message}`;
const NOT_PARAM = 'class value is not a string literal, a template literal without substitutions, or a plain identifier parameter of its nearest enclosing function, or that function is not a function declaration';
const BLOCK_ARG = 'block appears other than as a call with a readable string literal class argument';
const MAY_NOT_HOLD = (fn) => `widget is redeclared or assigned in ${fn}, or ${fn} names arguments, eval or with`;

const COORDINATOR_FIXTURES = [
  {
    label: 'a body naming a class that does not ship fails with that class named',
    source: String.raw`const BODY = ['await dv.view("ranch/views/customjs-guard", { class: "NoSuchClassRR4" });'].join('\n');`,
    refs: ['NoSuchClassRR4'],
    failures: [missing('NoSuchClassRR4', 1)],
  },
  {
    label: 'a body naming a shipped class passes',
    source: String.raw`const BODY = ['await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });'].join('\n');`,
    refs: ['OperatorStation'],
    failures: [],
  },
  {
    label: 'a class named only in a comment is not a ref',
    source: String.raw`// await dv.view("ranch/views/customjs-guard", { class: "GhostInLineComment" });
/* await dv.view("ranch/views/customjs-guard", { class: "GhostInBlockComment" }); */
const x = 1;`,
    refs: [],
    failures: [],
  },
  {
    label: 'a class named in a string without customjs-guard is not a ref',
    source: String.raw`const a = 'GhostInProse is not loaded';
const b = '{ class: "GhostInProse" }';`,
    refs: [],
    failures: [],
  },
  {
    label: 'escapes are read as the written note text; templates tagged tag, String.other, Other.raw and String[raw] each fail the gate',
    source: String.raw`const a = "await dv.view(\"ranch/views/customjs-guard\", { class: \"EscapedDouble\" });";
const b = 'await dv.view(\'ranch/views/customjs-guard\', { class: \'EscapedSingle\' });';
const c = 'await dv.view("ranch/views/customjs-guard", \
{ class: "ContinuedLine" });';
` + 'const d = String.raw`await dv.view("ranch/views/customjs-guard", { class: "TaggedRaw" }); \\unicode`;\n'
      + 'const e = String.raw`await dv.view("ranch/views/customjs-guard", { class: "Raw\\"Quote" });`;\n'
      + 'const f = tag`await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });`;\n'
      + 'const g = String.other`await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });`;\n'
      + 'const h = Other.raw`await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });`;\n'
      + 'const i = String[raw]`await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });`;',
    refs: ['EscapedDouble', 'EscapedSingle', 'ContinuedLine', 'TaggedRaw', 'Raw"Quote'],
    failures: [
      unreadable(7, 'customjs-guard string is in a template with a tag not written String.raw'),
      unreadable(8, 'customjs-guard string is in a template with a tag not written String.raw'),
      unreadable(9, 'customjs-guard string is in a template with a tag not written String.raw'),
      unreadable(10, 'customjs-guard string is in a template with a tag not written String.raw'),
      missing('EscapedDouble', 1), missing('EscapedSingle', 2), missing('ContinuedLine', 3), missing('TaggedRaw', 5), missing('Raw"Quote', 6),
    ],
  },
  {
    label: 'each of the three calls of a class-writing helper is checked',
    source: String.raw`function block(title, widget) {
  return '## ' + title + '\n\x60\x60\x60dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });\n\x60\x60\x60';
}
block('Heading', 'MissingViaHelperFirst');
block('Heading', 'OperatorStation');
block(
  'Heading',
  'MissingViaHelperLast',
);`,
    refs: ['MissingViaHelperFirst', 'OperatorStation', 'MissingViaHelperLast'],
    failures: [missing('MissingViaHelperFirst', 4), missing('MissingViaHelperLast', 6)],
  },
  {
    label: 'class values are read from customjs-guard calls that start in template literals: one from each of three helper calls and one from each of two templates outside a helper; the guard object of two(a, widget) also holds ${a} and fails the gate',
    source: 'function block(widget) {\n  return `await dv.view(\\"ranch/views/customjs-guard\\", { class: \\"${widget}\\" });`;\n}\n'
      + "block('MissingViaTemplate');\nblock(`OperatorStation`);\n"
      + 'const multi = `\nawait dv.view("ranch/views/customjs-guard", { class: "MissingInMultilineTemplate" });`;\n'
      + 'const inline = `await dv.view("ranch/views/customjs-guard", { class: "${\'InlinedLiteral\'}" });`;\n'
      + 'function two(a, widget) { return `await dv.view("ranch/views/customjs-guard", { args: [${a}], class: "${widget}" });`; }\n'
      + "two('x', 'MissingSecondExpr');\n"
      + 'function rawBlock(widget) { return String.raw`await dv.view("ranch/views/customjs-guard", { class: "` + widget + \'" });\'; }\n'
      + "rawBlock('MissingAfterRaw');",
    refs: ['MissingViaTemplate', 'OperatorStation', 'MissingInMultilineTemplate', 'InlinedLiteral', 'MissingAfterRaw'],
    failures: [
      unreadable(9, CALL_SPLICE),
      missing('MissingViaTemplate', 4), missing('MissingInMultilineTemplate', 6), missing('InlinedLiteral', 8),
      missing('MissingAfterRaw', 12),
    ],
  },
  {
    label: 'class values that are not string literals or cannot be read: no ref is read, and the gate fails at lines 5-10, 12, 16, 20 and 26-30 of this source',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
const name = 'OperatorStation';
block(name);
wrap('OperatorStation', block);
block(${'`${name}`'});
block(5);
const c = 'await dv.view("ranch/views/customjs-guard", { class: "' + name.trim() + '" });';
const d = name + 'await dv.view("ranch/views/customjs-guard", { class: "' + name + '" });';
const expr = function named(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
};
expr('OperatorStation');
function compare(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' == widget;
}
compare('OperatorStation');
function outer(widget) {
  return [1].map(() => 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });');
}
outer('OperatorStation');
function pair(title, widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
pair(...['Heading'], 'OperatorStation');
function lonely(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const mixed = 'await dv.view("ranch/views/customjs-guard", { class: "Pre' + name + '" });';
const cmp = 'await dv.view("ranch/views/customjs-guard", { class: "' == 'OperatorStation" });';
const unary = +'await dv.view("ranch/views/customjs-guard", { class: "' + 'OperatorStation" });';`,
    refs: [],
    failures: [
      unreadable(5, BLOCK_ARG), unreadable(6, BLOCK_ARG), unreadable(7, BLOCK_ARG), unreadable(8, BLOCK_ARG),
      unreadable(9, NOT_PARAM), unreadable(10, NOT_PARAM), unreadable(12, NOT_PARAM),
      unreadable(16, "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value"), unreadable(20, NOT_PARAM),
      unreadable(26, 'pair appears other than as a call with a readable string literal class argument'),
      unreadable(27, 'lonely has no call to read the class from'),
      unreadable(28, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders'),
      unreadable(29, "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value"), unreadable(30, "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value"),
    ],
  },
  {
    label: 'a parameter redeclared or assigned in its function, or a function naming arguments, eval or with, fails the gate',
    source: String.raw`function f1(widget) { widget = 'Ghost'; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f1('OperatorStation');
function f2(widget) { widget++; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f2('OperatorStation');
function f3(widget) { { let widget = 'Ghost'; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } } f3('OperatorStation');
function f4(widget) { [widget = 'Ghost'] = []; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f4('OperatorStation');
function f5(widget) { [widget] = ['Ghost']; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f5('OperatorStation');
function f6(widget) { [...widget] = 'G'; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f6('OperatorStation');
function f7(widget) { ({ widget } = { widget: 'Ghost' }); return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f7('OperatorStation');
function f8(widget) { try {} catch (widget) {} return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f8('OperatorStation');
function f9(widget) { for (widget in {}) {} return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f9('OperatorStation');
function f10(widget) { for (widget of []) {} return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f10('OperatorStation');
function f11(widget) { function widget() {} return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f11('OperatorStation');
function f12(widget) { const g = (widget) => widget; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f12('OperatorStation');
function f13(widget) { { class widget {} } return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f13('OperatorStation');
function f14(widget) { const c = class widget {}; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f14('OperatorStation');
function f15(widget) { const g = function widget() {}; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f15('OperatorStation');
function f16(widget, widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f16('OperatorStation', 'Ghost');
function f17(widget) { arguments[0] = 'Ghost'; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f17('OperatorStation');
function f18(widget) { eval('widget = 1'); return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f18('OperatorStation');
function f19(widget) { with ({ widget: 'Ghost' }) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } } f19('OperatorStation');`,
    refs: [],
    failures: [
      unreadable(1, MAY_NOT_HOLD('f1')), unreadable(2, MAY_NOT_HOLD('f2')), unreadable(3, MAY_NOT_HOLD('f3')),
      unreadable(4, MAY_NOT_HOLD('f4')), unreadable(5, MAY_NOT_HOLD('f5')), unreadable(6, MAY_NOT_HOLD('f6')),
      unreadable(7, MAY_NOT_HOLD('f7')), unreadable(8, MAY_NOT_HOLD('f8')), unreadable(9, MAY_NOT_HOLD('f9')),
      unreadable(10, MAY_NOT_HOLD('f10')), unreadable(11, MAY_NOT_HOLD('f11')), unreadable(12, MAY_NOT_HOLD('f12')),
      unreadable(13, MAY_NOT_HOLD('f13')), unreadable(14, MAY_NOT_HOLD('f14')), unreadable(15, MAY_NOT_HOLD('f15')),
      unreadable(16, MAY_NOT_HOLD('f16')), unreadable(17, MAY_NOT_HOLD('f17')), unreadable(18, MAY_NOT_HOLD('f18')),
      unreadable(19, MAY_NOT_HOLD('f19')),
    ],
  },
  {
    label: 'reads of the parameter, and bindings in functions outside it, do not fail the gate',
    source: String.raw`function block(widget) {
  const copy = widget; let t; t = widget; [t = widget] = []; ({ widget: t } = { widget: 1 });
  const o = { a: widget }; const f = () => widget; class C extends widget {}
  for (const k in widget) {} for (const k of widget) {}
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('OperatorStation');
function other(widget) { widget = arguments[0]; with (widget) {} }`,
    refs: ['OperatorStation'],
    failures: [],
  },
  {
    label: 'a customjs-guard string that is not a readable guard call fails the gate',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { method: "render" });';
const b = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", class: "GraphView" });';
const c = 'await dv.view("ranch/views/customjs-guard", { ...base, class: "OperatorStation" });';
const d = 'await dv.view("ranch/views/customjs-guard", { ["class"]: "OperatorStation" });';
const e = 'await dv.view("ranch/views/customjs-guard", { class: name });';
const f = ['await dv.view("ranch/views/customjs-guard", {', '  class: "OperatorStation" });'].join('\n');
const g = 'see ranch/views/customjs-guard for details';
const h = 'await dv.view("ranch/views/customjs-guard");';
const i = 'await dv.view("ranch/views/customjs-guard-legacy", { class: "OperatorStation" });';
const j = 'await dv.other("ranch/views/customjs-guard", { class: "OperatorStation" });';
const k = 'await dv.view("ranch/views/customjs-guard", { class: "__sauceClassExpr0__" });';
const l = 'await dv.view("ranch/views/customjs-guard", { class: "__sauce' + 'ClassExpr0__" });';
function collideOne(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "__sauceClassExpr0__", x: "' + widget + '" });'; } collideOne('OperatorStation');
function collideTwo(a, widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "__sauceClassExpr1__", x: "' + a + '", y: "' + widget + '" });'; } collideTwo('x', 'OperatorStation');`,
    refs: [],
    failures: [
      unreadable(1, 'customjs-guard object has 0 class keys'),
      unreadable(2, 'customjs-guard object has 2 class keys'),
      unreadable(3, 'customjs-guard object has a spread or computed key'),
      unreadable(4, 'customjs-guard object has a spread or computed key'),
      unreadable(5, 'customjs-guard class value is not a string literal'),
      unreadable(6, "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value"),
      unreadable(7, 'customjs-guard does not follow dv.view( at the start of a word, optional whitespace and a quote in this string or template part, with no other quote between that quote and customjs-guard'),
      unreadable(8, 'customjs-guard call has no object literal as its second argument'),
      unreadable(9, "customjs-guard call's first argument, as parsed from the quote before customjs-guard, has no static string value ending in customjs-guard"),
      unreadable(10, 'customjs-guard does not follow dv.view( at the start of a word, optional whitespace and a quote in this string or template part, with no other quote between that quote and customjs-guard'),
      unreadable(11, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders'),
      unreadable(12, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders'),
      unreadable(13, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders'),
      unreadable(14, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders'),
    ],
  },
  {
    label: 'Board, a prefix of BoardHealth, and oardHealt, a substring of BoardHealth, each fail with that name',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "Board" });';
const b = 'await dv.view("ranch/views/customjs-guard", { class: "oardHealt" });';`,
    refs: ['Board', 'oardHealt'],
    failures: [missing('Board', 1), missing('oardHealt', 2)],
  },
  {
    label: 'AccentButton passes; GoodClass, TypoWidget, FakeElement and CliRefusal each fail with that class named',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "AccentButton" });';
const b = 'await dv.view("ranch/views/customjs-guard", { class: "GoodClass" });';
const c = 'await dv.view("ranch/views/customjs-guard", { class: "TypoWidget" });';
const d = 'await dv.view("ranch/views/customjs-guard", { class: "FakeElement" });';
const e = 'await dv.view("ranch/views/customjs-guard", { class: "CliRefusal" });';`,
    refs: ['AccentButton', 'GoodClass', 'TypoWidget', 'FakeElement', 'CliRefusal'],
    failures: [missing('GoodClass', 2), missing('TypoWidget', 3), missing('FakeElement', 4), missing('CliRefusal', 5)],
  },
  {
    label: 'class names are matched case-sensitively',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "operatorStation" });';`,
    refs: ['operatorStation'],
    failures: [missing('operatorStation', 1)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: 'in one returned string that joins widget into the fifth of its five customjs-guard calls, each of the first four calls fails the gate and the fifth is read at the top-level class key of its own object',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "Board Health" }); await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", args: [{ class: "NotTheGuardClass" }] }); await dv.view("ranch/views/customjs-guard", { args: [{ class: "NotGuard" }], class: "RealGuard" }); await dv.view("ranch/views/customjs-guard", { $class: "Wrong", "class": "Right" }); await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('MissingLastInString');`,
    refs: ['MissingLastInString'],
    failures: [unreadable(2, CALL_CHAIN), unreadable(2, CALL_CHAIN), unreadable(2, CALL_CHAIN), unreadable(2, CALL_CHAIN), missing('MissingLastInString', 4)],
  },
  // MUTATION GUARD: reading only the first customjs-guard occurrence in each string turns RED
  {
    label: 'each of the four customjs-guard calls in one returned string that joins no other part is read at the top-level class key of its own object',
    source: String.raw`function block() {
  return 'await dv.view("ranch/views/customjs-guard", { class: "Board Health" }); await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", args: [{ class: "NotTheGuardClass" }] }); await dv.view("ranch/views/customjs-guard", { args: [{ class: "NotGuard" }], class: "RealGuard" }); await dv.view("ranch/views/customjs-guard", { $class: "Wrong", "class": "Right" });';
}
block();`,
    refs: ['Board Health', 'OperatorStation', 'RealGuard', 'Right'],
    failures: [missing('Board Health', 2), missing('RealGuard', 2), missing('Right', 2)],
  },
  {
    label: 'a property, method, field or label named like the helper is not an appearance of it; a computed one or an object shorthand one is',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('OperatorStation');
const table = { block: 1 };
table.block;
table[block];
const exported = { block };
const keyed = { [block]: 1 };
class K { block() {} static block = 1; }
block: for (;;) { if (table) break block; else continue block; }`,
    refs: ['OperatorStation'],
    failures: [unreadable(7, BLOCK_ARG), unreadable(8, BLOCK_ARG), unreadable(8, BLOCK_ARG), unreadable(9, BLOCK_ARG)],
  },
  {
    label: 'RR4B-CLASS-SET-EXACT: PlanningNavButtons, defined under ranch/scripts and under neither platform/blueprints nor platform/mechanisms, fails with that class named',
    precondition: () => {
      const definedUnder = (dir) => collectClassNames([dir]).has('PlanningNavButtons');
      if (!definedUnder('ranch/scripts')) return 'PlanningNavButtons is not defined under ranch/scripts';
      const also = ['platform/blueprints', 'platform/mechanisms'].filter(definedUnder);
      return also.length ? `PlanningNavButtons is defined under ${also.join(' and ')}` : null;
    },
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "PlanningNavButtons" });';`,
    refs: ['PlanningNavButtons'],
    failures: [missing('PlanningNavButtons', 1)],
  },
  {
    label: 'RR4B-HELPER-ARGUMENTS: a call of a class-writing helper that omits the class argument fails the gate',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block();`,
    refs: [],
    failures: [unreadable(4, BLOCK_ARG)],
  },
  {
    label: "RR4B-HELPER-ARGUMENTS: for function block(widget, title), the call block('Missing', 'OperatorStation') fails naming Missing",
    source: String.raw`function block(widget, title) {
  return '## ' + title + '\nawait dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('Missing', 'OperatorStation');`,
    refs: ['Missing'],
    failures: [missing('Missing', 4)],
  },
  {
    label: 'RR4B-TEMPLATE-AND-VALUE-SHAPES: a customjs-guard call after a ${} expression in a template is read, and fails naming its class that does not ship',
    source: "const title = 'x';\n"
      + 'const body = `## ${\n  title} await dv.view("ranch/views/customjs-guard", { class: "MissingAfterExpr" });`;',
    refs: ['MissingAfterExpr'],
    failures: [missing('MissingAfterExpr', 3)],
  },
  {
    label: 'RR4B-TEMPLATE-AND-VALUE-SHAPES: the class values `Operator${x}Station` and "OperatorStation" + suffix each fail the gate',
    source: "const a = 'await dv.view(\"ranch/views/customjs-guard\", { class: `Operator${x}Station` });';\n"
      + "const b = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\" + suffix });';",
    refs: [],
    failures: [
      unreadable(1, 'customjs-guard class value is not a string literal'),
      unreadable(2, 'customjs-guard class value is not a string literal'),
    ],
  },
  {
    label: 'RR4B-TEMPLATE-AND-VALUE-SHAPES: a class key in a third dv.view argument is not read: with { class: "Missing" } second and { class: "OperatorStation" } third the call fails naming Missing, and with cfg second and { class: "OperatorStation" } third it fails the gate',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "Missing" }, { class: "OperatorStation" });';
const b = 'await dv.view("ranch/views/customjs-guard", cfg, { class: "OperatorStation" });';`,
    refs: ['Missing'],
    failures: [unreadable(2, 'customjs-guard call has no object literal as its second argument'), missing('Missing', 1)],
  },
  {
    label: 'RR4B-TEMPLATE-AND-VALUE-SHAPES: a with statement nested below the top level of a class-writing helper fails the gate',
    source: String.raw`function nested(widget) {
  if (widget) {
    with ({ widget: 'Ghost' }) {
      return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
    }
  }
}
nested('OperatorStation');`,
    refs: [],
    failures: [unreadable(4, MAY_NOT_HOLD('nested'))],
  },
  {
    label: 'the customjs-guard path Extras/Scripts/customjs-guard, outside ranch/views, is read: dv.view("Extras/Scripts/customjs-guard", { class: "Missing" }) fails naming Missing',
    source: String.raw`const a = 'await dv.view("Extras/Scripts/customjs-guard", { class: "Missing" });';`,
    refs: ['Missing'],
    failures: [missing('Missing', 1)],
  },
  {
    label: 'declaration fails with that name, though a .js file under platform/blueprints or platform/mechanisms has the word class, after other text on its line, followed by whitespace and the word declaration',
    precondition: () => (['platform/blueprints', 'platform/mechanisms'].flatMap((d) => walk(d, []))
      .some((f) => /^[^\n]*\S[^\n]*\bclass\s+declaration\b/m.test(fs.readFileSync(f, 'utf8')))
      ? null : 'no line of a .js file under platform/blueprints or platform/mechanisms has other text before the whole words "class declaration"'),
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "declaration" });';`,
    refs: ['declaration'],
    failures: [missing('declaration', 1)],
  },
  {
    label: 'a string that starts with customjs-guard is checked: \'await dv.view("ranch/views/\' + \'customjs-guard", { class: "NoSuchSplitPath" });\' fails the gate',
    source: String.raw`const a = 'await dv.view("ranch/views/' + 'customjs-guard", { class: "NoSuchSplitPath" });';`,
    refs: [],
    failures: [unreadable(1, 'customjs-guard does not follow dv.view( at the start of a word, optional whitespace and a quote in this string or template part, with no other quote between that quote and customjs-guard')],
  },
  {
    label: "the helper as the object of a member expression is an appearance of it: block.call(null, 'NoSuchViaCall') fails the gate",
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('OperatorStation');
block.call(null, 'NoSuchViaCall');`,
    refs: ['OperatorStation'],
    failures: [unreadable(5, BLOCK_ARG)],
  },
  {
    label: 'the helper as the value of a property is an appearance of it: { make: block } fails the gate',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('OperatorStation');
const o = { make: block };
o.make('NoSuchViaAlias');`,
    refs: ['OperatorStation'],
    failures: [unreadable(5, BLOCK_ARG)],
  },
  {
    label: 'a class-writing helper naming arguments fails the gate also when arguments is not the object of a member expression: const a = arguments',
    source: String.raw`function f(widget) { const a = arguments; a[0] = 'Ghost'; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f('OperatorStation');`,
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('f'))],
  },
  {
    label: "a call of a class-writing helper written before the helper declaration is checked: block('NoSuchHoisted') fails naming NoSuchHoisted",
    source: String.raw`block('NoSuchHoisted');
function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('OperatorStation');`,
    refs: ['NoSuchHoisted', 'OperatorStation'],
    failures: [missing('NoSuchHoisted', 1)],
  },
  {
    label: "RR4B-FIXTURE-BRANCH-PINS: for function block(widget, title), the call block(cls, 'OperatorStation'), whose class argument is the identifier cls, fails the gate",
    source: String.raw`function block(widget, title) {
  return '## ' + title + '\nawait dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
const cls = 'NoSuchVariable';
block(cls, 'OperatorStation');`,
    refs: [],
    failures: [unreadable(5, BLOCK_ARG)],
  },
  {
    label: "a customjs-guard call that does not parse from its own string and that string's + operands fails the gate, though a class key naming OperatorStation follows customjs-guard in that string",
    source: String.raw`const a = ['await dv.view("ranch/views/customjs-guard", { class: "OperatorStation",', '  class: "NoSuchSecondKey" });'].join('\n');`,
    refs: [],
    failures: [unreadable(1, "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value")],
  },
  {
    label: 'a customjs-guard string in a template whose tag is the bare identifier raw, not String.raw, fails the gate',
    source: 'const a = raw`await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });`;',
    refs: [],
    failures: [unreadable(1, 'customjs-guard string is in a template with a tag not written String.raw')],
  },
  {
    label: 'the class key is matched case-sensitively: { Class: "OperatorStation" } has 0 class keys and fails the gate',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { Class: "OperatorStation" });';`,
    refs: [],
    failures: [unreadable(1, 'customjs-guard object has 0 class keys')],
  },
  {
    label: 'RR4B-FIXTURE-BRANCH-PINS: Name fails with that name, though a .js file under platform/blueprints or platform/mechanisms has a line whose first word is className',
    precondition: () => (['platform/blueprints', 'platform/mechanisms'].flatMap((d) => walk(d, []))
      .some((f) => /^[ \t]*className\b/m.test(fs.readFileSync(f, 'utf8')))
      ? null : 'no line of a .js file under platform/blueprints or platform/mechanisms has className as its first word'),
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "Name" });';`,
    refs: ['Name'],
    failures: [missing('Name', 1)],
  },
  {
    label: "the helper passed as an argument to a call of itself is an appearance of it other than as a call: block('OperatorStation', block) fails the gate",
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}
block('OperatorStation', block);`,
    refs: ['OperatorStation'],
    failures: [unreadable(4, BLOCK_ARG)],
  },
  {
    label: 'a class-writing helper naming eval fails the gate also when eval is not called: const e = eval',
    source: String.raw`function f(widget) { const e = eval; return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } f('OperatorStation');`,
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('f'))],
  },
  {
    label: 'a customjs-guard call whose path argument is "ranch/views/customjs-guard" + x fails the gate',
    source: String.raw`const a = 'await dv.view("ranch/views/customjs-guard" + x, { class: "OperatorStation" });';`,
    refs: [],
    failures: [unreadable(1, "customjs-guard call's first argument, as parsed from the quote before customjs-guard, has no static string value ending in customjs-guard")],
  },
  {
    label: 'a class-writing helper with no call fails the gate also when a string before it is a ref to a shipped class',
    source: String.raw`const z = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });';
function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });';
}`,
    refs: ['OperatorStation'],
    failures: [unreadable(3, 'block has no call to read the class from')],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: "a guard object that joins a helper's second parameter after its class key fails the gate, though the helper call's class argument is OperatorStation",
    source: String.raw`function block(widget, extra) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '", ' + extra + ' });';
}
block('OperatorStation', 'class: "NoSuchInjected"');`,
    refs: [],
    failures: [unreadable(2, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a guard object whose class is the literal OperatorStation and that joins the const extra after its class key fails the gate',
    source: String.raw`const extra = 'class: "NoSuchInjected2"';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", ' + extra + ' });';`,
    refs: [],
    failures: [unreadable(2, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a guard object in a template whose class is the literal OperatorStation and whose args array holds ${a} fails the gate',
    source: 'function g(a) { return `await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", args: [${a}] });`; }\n'
      + "g('0], class: \"NoSuchInjected3\", z: [0');",
    refs: [],
    failures: [unreadable(1, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a guard object whose class is the literal OperatorStation and that joins the const v inside a quoted title value fails the gate',
    source: String.raw`const v = 'x';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", title: "' + v + '" });';`,
    refs: [],
    failures: [unreadable(2, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a path that joins the const x between two ranch/views/customjs-guard texts fails the gate at its first occurrence, and its second occurrence, with no dv.view( before it in its own string, fails the dv.view( check',
    source: String.raw`const x = 'y';
const s = 'await dv.view("ranch/views/customjs-guard' + x + 'ranch/views/customjs-guard", { class: "OperatorStation" });';`,
    refs: [],
    failures: [
      unreadable(2, CALL_SPLICE),
      unreadable(2, 'customjs-guard does not follow dv.view( at the start of a word, optional whitespace and a quote in this string or template part, with no other quote between that quote and customjs-guard'),
    ],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a guard call that joins the const x inside a comment between its path and its object fails the gate',
    source: String.raw`const x = 'y';
const s = 'await dv.view("ranch/views/customjs-guard", /* ' + x + ' */ { class: "OperatorStation" });';`,
    refs: [],
    failures: [unreadable(2, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a guard object whose class is the literal OperatorStation and that joins the const x into a key name after its class key fails the gate',
    source: String.raw`const x = ': 1, class: "Evil", k2';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", k' + x + ': 1 });';`,
    refs: [],
    failures: [unreadable(2, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  {
    label: 'a guard object whose class is the literal OperatorStation and that joins the const x inside a comment after its class value fails the gate',
    source: String.raw`const x = '*/ class: "Evil", /*';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" /* ' + x + ' */ });';`,
    refs: [],
    failures: [unreadable(2, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_SPLICE line in coordinatorClassRefs turns RED
  // MUTATION GUARD: testing EXPR_PLACEHOLDER_RE in place of the __sauceClassExpr prefix turns RED
  {
    label: 'a guard object whose class is the literal OperatorStation and whose note value joins the string literal __sauceClassExprZ fails the gate',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", note: "' + '__sauceClassExprZ' + '" });';`,
    refs: [],
    failures: [unreadable(1, CALL_SPLICE)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: "a guard call whose object is followed in its + chain by the const tail, ' && { class: \"NoSuchConst\" }', fails the gate",
    source: String.raw`const tail = ' && { class: "NoSuchConst" }';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + tail + ');';`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: "a helper that joins its second parameter tail between its guard object and the closing ) fails the gate, though its call's class argument is OperatorStation",
    source: String.raw`function block(widget, tail) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" }' + tail + ');';
}
block('OperatorStation', ' && { class: "NoSuchHelper" }');`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: 'a template whose guard object is followed by ${t} fails the gate',
    source: 'function g(t) { return `await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }${t});`; }\n'
      + "g(' ? { class: \"NoSuchTern\" } : 0');",
    refs: [],
    failures: [unreadable(1, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: "a guard call whose object is followed in its + chain by the const t, '.constructor({ class: \"NoSuchMember\" })', fails the gate",
    source: String.raw`const t = '.constructor({ class: "NoSuchMember" })';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + t + ');';`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: "a guard call whose object is followed in its + chain by a space and the const t, '|| 0 ? { class: \"NoSuchSpace\" } : 0', fails the gate",
    source: String.raw`const t = '|| 0 ? { class: "NoSuchSpace" } : 0';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } ' + t + ');';`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: 'a String.raw template whose guard object is followed by ${t} fails the gate',
    source: 'function g(t) { return String.raw`await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }${t});`; }\n'
      + "g(' && { class: \"NoSuchRaw\" }');",
    refs: [],
    failures: [unreadable(1, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: 'a template whose guard object is followed by a space, ${""} and ${t} fails the gate',
    source: 'function g(t) { return `await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } ${""}${t});`; }\n'
      + "g(' && { class: \"NoSuchQuasi\" }');",
    refs: [],
    failures: [unreadable(1, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: 'a template holding a guard call up to its object, followed in its + chain by the const t, fails the gate',
    source: "const t = ' && { class: \"NoSuchTplPlus\" }';\n"
      + 'const s = `await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }` + t + \');\';',
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: 'a guard call whose object is followed in its + chain by t.trim() fails the gate',
    source: String.raw`const t = ' && { class: "NoSuchTrim" }';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + t.trim() + ');';`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_CHAIN line in coordinatorClassRefs turns RED
  {
    label: "a guard call whose object is followed in its + chain by (t + ');') fails the gate",
    source: String.raw`const t = ' && { class: "NoSuchNest" }';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + (t + ');');`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: exempting every part from the CALL_CHAIN check when the class value is a placeholder turns RED
  {
    label: 'a helper whose class value is its widget parameter and that joins its second parameter t after the closed guard call fails the gate',
    source: String.raw`function block(widget, t) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });' + t;
}
block('OperatorStation', '; await dv.view("ranch/views/customjs-' + 'guard", { class: "NoSuchAfterClose" });');`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: exempting the part whose placeholder is the class value, in place of the part written as the whole text between its quotes, turns RED
  {
    label: 'a helper whose class value is written \\x5f_sauceClassExpr0__ and that joins widget after the closed guard call fails the gate',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "\\x5f_sauceClassExpr0__" }); /* ' + widget + ' */';
}
block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: deleting the CALL_OPEN line in coordinatorClassRefs turns RED
  {
    label: 'a guard call left open in its string and joined with += fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }';
s += ' && { class: "NoSuchPlusEq" }';
s += ');';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: deleting the CALL_OPEN line in coordinatorClassRefs turns RED
  {
    label: 'a guard call left open in its string and joined with .concat fails the gate',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }'.concat(' && { class: "NoSuchConcat" }', ');');`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: deleting the CALL_OPEN line in coordinatorClassRefs turns RED
  {
    label: "a guard call left open in its string and joined with [...].join('') fails the gate",
    source: String.raw`const s = ['await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }', ' && { class: "NoSuchJoin" }', ');'].join('');`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: deleting the CALL_OPEN line in coordinatorClassRefs turns RED
  {
    label: 'a guard call left open in its string and joined by a wrapper function fails the gate',
    source: String.raw`const close = (x, t) => x + t + ');';
const s = close('await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }', ' && { class: "NoSuchWrap" }');`,
    refs: [],
    failures: [unreadable(2, CALL_OPEN)],
  },
  // MUTATION GUARD: deleting the CALL_OPEN line in coordinatorClassRefs turns RED
  {
    label: 'a guard call left open in its string and joined by a template holding that string in a variable fails the gate',
    source: "const head = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\" }';\n"
      + "const t = ' && { class: \"NoSuchTplVar\" }';\n"
      + 'const s = `${head}${t});`;',
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: accepting ) anywhere later in the text, not only after optional whitespace, turns RED
  {
    label: 'a guard call left open in its string except for a ) inside a comment, and joined with +=, fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } /* ) */';
s += ' && { class: "NoSuchComment" });';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: parsing the call without allowAwaitOutsideFunction turns RED
  {
    label: 'in the async body that runs the note, await /"/ is a regex, so a guard object with x: await /"/ before a second class key has 2 class keys and fails the gate',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", x: await /"/, class: \'NoSuchAwait\', y: /"/g });';`,
    refs: [],
    failures: [unreadable(1, 'customjs-guard object has 2 class keys')],
  },
  // MUTATION GUARD: exempting every placeholder class value from the CALL_OPEN check (!placeholder) turns RED
  // MUTATION GUARD: checking CALL_OPEN only when no part is joined (!closed && exprs.length === 0) turns RED
  {
    label: 'a helper whose class value is its widget parameter, whose guard call is left open in its string and joined with +=, fails the gate',
    source: String.raw`function block(widget) {
  let s = 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" }';
  s += ' && { class: "NoSuchOpenHelper" });';
  return s;
}
block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, CALL_OPEN)],
  },
  // MUTATION GUARD: exempting every placeholder class value from the CALL_OPEN check (!placeholder) turns RED
  // MUTATION GUARD: checking CALL_OPEN only when no part is joined (!closed && exprs.length === 0) turns RED
  {
    label: 'a helper whose class value is its widget parameter, whose guard call is left open in its string and joined with .concat, fails the gate',
    source: String.raw`function block(widget) {
  return ('await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" }').concat(' && { class: "NoSuchOpenConcat" });');
}
block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, CALL_OPEN)],
  },
  // MUTATION GUARD: exempting every placeholder class value from the CALL_OPEN check (!placeholder) turns RED
  // MUTATION GUARD: checking CALL_OPEN only when no part is joined (!closed && exprs.length === 0) turns RED
  {
    label: "a helper whose class value is its widget parameter, whose guard call is left open in its string and joined with [...].join(''), fails the gate",
    source: String.raw`function block(widget) {
  return ['await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" }', ' && { class: "NoSuchOpenJoin" });'].join('');
}
block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, CALL_OPEN)],
  },
  // MUTATION GUARD: accepting ) only with no whitespace before it (/^\)/), or only after spaces (/^ *\)/), turns RED
  {
    label: 'a guard call whose ) follows a newline and two spaces after its object is read',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }\n  );';`,
    refs: ['OperatorStation'],
    failures: [],
  },
  // MUTATION GUARD: dropping the mixed-value exemption from the CALL_OPEN check, or keeping only its collision half, turns RED
  {
    label: 'a guard call whose class value joins name after Operator, and whose call is left open in its string and closed with +=, fails as a mixed value',
    source: String.raw`const name = 'Station';
let s = 'await dv.view("ranch/views/customjs-guard", { class: "Operator' + name + '" }';
s += ');';`,
    refs: [],
    failures: [unreadable(2, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders')],
  },
  // MUTATION GUARD: keeping only the collision half of the CALL_SPLICE exemption turns RED
  {
    label: 'a guard object whose class value joins name after Operator and whose x value joins name fails as a mixed value',
    source: String.raw`const name = 'Station';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "Operator' + name + '", x: "' + name + '" });';`,
    refs: [],
    failures: [unreadable(2, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders')],
  },
  // MUTATION GUARD: dropping the collision exemption from the CALL_OPEN check, or keeping only its mixed-value half, turns RED
  {
    label: 'a helper whose guard object has class "__sauceClassExpr0__" beside widget, and whose call is left open in its string and closed with +=, fails as a collision',
    source: String.raw`function block(widget) {
  let s = 'await dv.view("ranch/views/customjs-guard", { class: "__sauceClassExpr0__", x: "' + widget + '" }';
  s += ');';
  return s;
}
block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders')],
  },
  // MUTATION GUARD: exempting from CALL_CHAIN a part whose placeholder is contained in, not equal to, the text between the class value quotes turns RED
  {
    label: 'a helper whose class value is written as a backslash followed by widget fails the gate',
    source: String.raw`function block(widget) {
  return 'await dv.view("ranch/views/customjs-guard", { class: "\\' + widget + '" });';
}
block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: exempting template literal parts from the CALL_CHAIN check turns RED
  {
    label: 'a guard call whose object is followed in its + chain by the template `${t}` fails the gate',
    source: "const t = ' && { class: \"NoSuchTplPart\" }';\n"
      + "const s = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\" }' + `${t}` + ');';",
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: exempting member expression parts from the CALL_CHAIN check turns RED
  {
    label: 'a guard call whose object is followed in its + chain by o.tail fails the gate',
    source: String.raw`const o = { tail: ' && { class: "NoSuchMemberTail" }' };
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + o.tail + ');';`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: parsing the call as a module (sourceType: 'module') in place of allowAwaitOutsideFunction turns RED
  {
    label: 'a guard object whose class value is followed by <!-- , class: "NoSuchHtml" and a newline is read as OperatorStation',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" <!-- , class: "NoSuchHtml"\n });';`,
    refs: ['OperatorStation'],
    failures: [],
  },
];

const COORDINATOR_GATE_FIXTURES = [
  {
    label: 'a coordinator source with 3 refs, one per required class, fails only the floor',
    source: () => String.raw`const a = 'await dv.view("ranch/views/customjs-guard", { class: "BoardHealth" });';
const b = 'await dv.view("ranch/views/customjs-guard", { class: "GraphView" });';
const c = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" });';`,
    check: (failures) => JSON.stringify(failures) === JSON.stringify([
      'FAIL CJS-REF-COORDINATOR floor: extracted 3 customjs-guard class ref(s) from scripts/autoloop/codex-coordinator.js, expected at least 6',
    ]),
  },
  {
    label: 'a coordinator source with no refs fails the floor and names each required class',
    source: () => '',
    check: (failures) => JSON.stringify(failures) === JSON.stringify([
      'FAIL CJS-REF-COORDINATOR floor: extracted 0 customjs-guard class ref(s) from scripts/autoloop/codex-coordinator.js, expected at least 6',
      'FAIL CJS-REF-COORDINATOR required: no customjs-guard class ref "BoardHealth" extracted from scripts/autoloop/codex-coordinator.js',
      'FAIL CJS-REF-COORDINATOR required: no customjs-guard class ref "GraphView" extracted from scripts/autoloop/codex-coordinator.js',
      'FAIL CJS-REF-COORDINATOR required: no customjs-guard class ref "OperatorStation" extracted from scripts/autoloop/codex-coordinator.js',
    ]),
  },
  {
    label: 'the coordinator with BoardHealth renamed to a class that does not ship fails naming it',
    source: (real) => real.split('{ class: "BoardHealth" }').join('{ class: "NoSuchBoardHealthRR4" }'),
    check: (failures) => failures.length === 2
      && failures[0] === 'FAIL CJS-REF-COORDINATOR required: no customjs-guard class ref "BoardHealth" extracted from scripts/autoloop/codex-coordinator.js'
      && /^FAIL CJS-REF-COORDINATOR: \{ class: "NoSuchBoardHealthRR4" \} <- scripts\/autoloop\/codex-coordinator\.js:\d+ has no shipped class definition$/.test(failures[1]),
  },
];

function runCoordinatorGate(defs) {
  const failures = [];
  for (const fixture of COORDINATOR_FIXTURES) {
    let fail;
    try { fail = checkCoordinatorFixture(fixture, defs); } catch (e) { fail = `threw ${e.constructor.name}: ${e.message}`; }
    if (fail) failures.push(`FAIL CJS-REF-COORDINATOR fixture: ${fixture.label}: ${fail}`);
    else console.log(`ok CJS-REF-COORDINATOR fixture: ${fixture.label}`);
  }
  const real = fs.readFileSync(path.join(REPO_ROOT, COORDINATOR_SOURCE), 'utf8');
  for (const fixture of COORDINATOR_GATE_FIXTURES) {
    let got;
    try { got = coordinatorFailures(fixture.source(real), defs, COORDINATOR_SOURCE).failures; } catch (e) { got = [`threw ${e.constructor.name}: ${e.message}`]; }
    if (fixture.check(got)) console.log(`ok CJS-REF-COORDINATOR fixture: ${fixture.label}`);
    else failures.push(`FAIL CJS-REF-COORDINATOR fixture: ${fixture.label}: got ${JSON.stringify(got)}`);
  }

  const { refs, failures: gateFailures } = coordinatorFailures(real, defs, COORDINATOR_SOURCE);
  failures.push(...gateFailures);
  if (failures.length) {
    console.error('');
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  const names = [...new Set(refs.map((r) => r.cls))].sort().join(', ');
  console.log(`ok CJS-REF-COORDINATOR: ${refs.length} customjs-guard class ref(s) in ${COORDINATOR_SOURCE} all resolve to a shipped class definition (${names}).`);
}

function runSelfTest() {
  const fx = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'customjs-loadable');
  const cases = [
    { dir: 'pass', expectFail: false },
    { dir: 'fail', expectFail: true },
  ];
  let passes = 0, fails = 0;
  for (const c of cases) {
    const d = path.join(fx, c.dir);
    let names; try { names = fs.readdirSync(d); } catch (_e) { names = []; }
    for (const name of names) {
      if (!name.endsWith('.js')) continue;
      const body = fs.readFileSync(path.join(d, name), 'utf8');
      const fail = loadFailure(body);
      const flagged = fail !== null;
      if (flagged === c.expectFail) {
        console.log(`ok self-test ${c.dir}/${name}: ${c.expectFail ? `flagged (${fail})` : 'loads cleanly'}`);
        passes++;
      } else {
        console.error(`FAIL self-test ${c.dir}/${name}: expected ${c.expectFail ? 'a load failure' : 'clean load'}, got ${flagged ? fail : 'clean'}`);
        fails++;
      }
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  // Gate 1 (CJS-LOAD): every customJS class FILE loads the way the plugin loads it.
  const { scanned, classFiles, failures } = scan(SCAN_DIRS);
  if (failures.length) {
    console.error(`FAIL CJS-LOAD: ${failures.length} customJS class file(s) do NOT load the way the CustomJS plugin loads them:\n`);
    for (const v of failures) console.error(`  ${v.file}\n    ${v.message}`);
    console.error('\nCustomJS wraps each file in ( ... ) and evals it as a SINGLE expression, then calls new().');
    console.error('A customJS class file must be a bare class definition with NO trailing statements.');
    console.error('For Node-testable statics, do NOT append a `module.exports` trailer — load the class in the');
    console.error('harness via `new Function(src + "\\nreturn ClassName;")` instead (see run-renderer.js).');
    process.exit(1);
  }
  console.log(`ok CJS-LOAD: ${classFiles} customJS class file(s) load via customJS's eval("(" + file + ")") + new (of ${scanned} .js scanned); no violations.`);

  // Gate 2 (CJS-REF): every customjs-guard { class: "X" } literal ref resolves to
  // a shipped `class X` definition (same "_X unavailable_" failure otherwise).
  const { refCount, defCount, unresolved } = scanClassRefs();
  if (unresolved.length) {
    console.error(`\nFAIL CJS-REF: ${unresolved.length} customjs-guard class ref(s) reference a class with NO shipped definition (renders "_<class> unavailable_" on every note born from that template):\n`);
    for (const u of unresolved) console.error(`  { class: "${u.cls}" } <- ${u.file}`);
    console.error('\nEither the class was deleted/renamed (repoint the ref to a live class) or its helper file is missing.');
    process.exit(1);
  }
  console.log(`ok CJS-REF: ${refCount} customjs-guard class ref(s) across ${REF_SCAN_DIRS.join(' + ')} all resolve to a shipped class definition (of ${defCount} known).`);

  // Gate 3 (CJS-REF-COORDINATOR): coordinator-written refs resolve against the same class definitions.
  runCoordinatorGate(collectClassNames(REF_SCAN_DIRS));
  process.exit(0);
}

main();
