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
  // MUTATION GUARD: accepting a line comment before ) (/^\s*(\/\/.*)?\s*\)/) turns RED
  {
    label: 'a guard call left open in its string except for a ) inside a line comment, and joined with += to a part that starts with a newline, fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } // )';
s += '\n && { class: "NoSuchLineParen" });';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: testing the closing ) with the m flag (/^\s*\)/m) turns RED
  {
    label: 'a guard call left open in its string except for a ) on the next line inside a block comment, and joined with +=, fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } /*\n) */';
s += ' && { class: "NoSuchMFlag" });';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: accepting ) anywhere later in the text, not only after optional whitespace, turns RED
  {
    label: 'a guard call left open in its string except for a ) inside a block comment that holds /*, and joined with += to a part that starts with a newline, fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } /* /* ) */';
s += '\n && { class: "NoSuchNestedLooking" });';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: accepting an HTML-like comment before ) (/^\s*(<!--.*)?\s*\)/) turns RED
  {
    label: 'a guard call left open in its string except for a ) after <!--, and joined with += to a part that starts with a newline, fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } <!-- )';
s += '\n && { class: "NoSuchHtmlParen" });';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: exempting a literal class value from the CALL_OPEN check when the joined text collides (!((placeholder && placeholder[0] !== value) || collides)) turns RED
  {
    label: 'a guard call whose class value is the literal OperatorStation, with a comment holding __sauceClassExprZ, left open in its string and joined with +=, fails the gate',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" } /* __sauceClassExprZ */';
s += ' && { class: "NoSuchOpenCollide" });';`,
    refs: [],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: exempting a literal class value from the CALL_CHAIN check when the joined text collides (!((placeholder && placeholder[0] !== value) || collides)) turns RED
  {
    label: 'a guard call whose class value is the literal OperatorStation, with a comment holding __sauceClassExprZ after the closed call and t joined after that, fails the gate',
    source: String.raw`const t = '; await dv.view("ranch/views/customjs-' + 'guard", { class: "NoSuchChainCollide" });';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }); /* __sauceClassExprZ */' + t;`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: checking CALL_OPEN only for the first customjs-guard occurrence in its string turns RED
  {
    label: 'a string whose first guard call is closed and read as OperatorStation, and whose second is left open and joined with +=, fails the gate at the second call',
    source: String.raw`let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }); await dv.view("ranch/views/customjs-guard", { class: "BoardHealth" }';
s += ' && { class: "NoSuchSecondOpen" });';`,
    refs: ['OperatorStation'],
    failures: [unreadable(1, CALL_OPEN)],
  },
  // MUTATION GUARD: reading a template literal part by its raw text in place of its cooked text turns RED
  {
    label: 'a guard object whose comment after the class key joins a template literal part written \\x2a/ class: "NoSuchRawPart", /\\x2a has 2 class keys and fails the gate',
    source: "const s = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", /* ' + `\\x2a/ class: \"NoSuchRawPart\", /\\x2a` + ' */ });';",
    refs: [],
    failures: [unreadable(1, 'customjs-guard object has 2 class keys')],
  },
  // MUTATION GUARD: skipping method-shorthand properties when counting class keys turns RED
  {
    label: 'a guard object with class: "OperatorStation" and a method class() has 2 class keys and fails the gate',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", class() { return "NoSuchMethod"; } });';`,
    refs: [],
    failures: [unreadable(1, 'customjs-guard object has 2 class keys')],
  },
  // MUTATION GUARD: parsing the call as a module (sourceType: 'module') in place of allowAwaitOutsideFunction turns RED
  {
    label: 'a guard object whose class value is followed by <!-- , class: "NoSuchHtml" and a newline is read as OperatorStation',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" <!-- , class: "NoSuchHtml"\n });';`,
    refs: ['OperatorStation'],
    failures: [],
  },
];

const GUARD_OPEN = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }';
const GUARD_CLOSED = `${GUARD_OPEN});`;
const PART_SETUP = {
  object: `const t = ' && { class: "NoSuchAfterObject" }'; const o = { t }; let u; let n = 0;`,
  call: `const t = '; await dv.view("ranch/views/customjs-' + 'guard", { class: "NoSuchAfterCall" });'; const o = { t }; let u; let n = 0;`,
};
const guardText = (at) => (at === 'object' ? GUARD_OPEN : GUARD_CLOSED);
const closeText = (at) => (at === 'object' ? "');'" : "''");
const viewCall = (at) => `dv.view("ranch/views/customjs-" + "guard", { class: "${at === 'object' ? 'NoSuchAfterObject' : 'NoSuchAfterCall'}" })`;
const joined = (part) => (at) => `const s = '${guardText(at)}' + ${part} + ${closeText(at)};`;
const called = (fn) => (at) => (at === 'object'
  ? `const s = '${GUARD_OPEN}, (' + ${fn(at)} + ')());';`
  : `const s = '${GUARD_CLOSED} (' + ${fn(at)} + ')();';`);
// MUTATION GUARD: exempting any one part type below from the CALL_CHAIN check turns both of that type's fixtures RED
const PART_KINDS = [
  ['Identifier', joined('t')],
  ['MemberExpression', joined('o.t')],
  ['CallExpression', joined('String(t)')],
  ['CallExpression with a spread argument', joined('String(...[t])')],
  ['NewExpression', joined('new String(t)')],
  ['ConditionalExpression', joined("(t ? t : '')")],
  ['LogicalExpression', joined("(t || '')")],
  ['BinaryExpression', joined("(t + '')")],
  ['AssignmentExpression', joined('(u = t)')],
  ['SequenceExpression', joined('(0, t)')],
  ['TaggedTemplateExpression', joined('String.raw`${t}`')],
  ['TemplateLiteral', joined('`${t}`')],
  ['ArrayExpression', joined('[t]')],
  ['ObjectExpression', joined('{ toString: () => t }')],
  ['ChainExpression', joined('o?.t')],
  ['UnaryExpression', joined('(typeof t)')],
  ['UpdateExpression', joined('n++')],
  ['ThisExpression', (at) => `function f() { return '${guardText(at)}' + this + ${closeText(at)}; } const s = f.call(t);`],
  ['AwaitExpression', (at) => `const s = (async () => '${guardText(at)}' + await t + ${closeText(at)})();`],
  ['YieldExpression', (at) => `function* g() { return '${guardText(at)}' + (yield) + ${closeText(at)}; } const it = g(); it.next(); const s = it.next(t).value;`],
  ['Literal (regex)', (at) => (at === 'object'
    ? `const s = '${GUARD_OPEN}' + /x/ + ');';`
    : `const s = '${GUARD_CLOSED} 1' + / (await dv.view("ranch\\/views\\/customjs-" + "guard", { class: "NoSuchAfterCall" })) / + '1;';`)],
  ['ArrowFunctionExpression', called((at) => `(() => ${viewCall(at)})`)],
  ['FunctionExpression', called((at) => `(function () { return ${viewCall(at)}; })`)],
  ['ClassExpression', (at) => (at === 'object'
    ? `const s = '${GUARD_OPEN}, new (' + (class { constructor() { ${viewCall(at)}; } }) + ')());';`
    : `const s = '${GUARD_CLOSED} new (' + (class { constructor() { ${viewCall(at)}; } }) + ')();';`)],
  ['MetaProperty (new.target)', (at) => `function F() { if (!new.target) return ${viewCall(at)}; this.s = '${at === 'object' ? `${GUARD_OPEN}, (` : `${GUARD_CLOSED} (`}' + new.target + '${at === 'object' ? ')());' : ')();'}'; } const s = new F().s;`],
  ['ImportExpression', joined('import(t)')],
  ['Literal (number)', joined('1')],
  // MUTATION GUARD: exempting an Identifier part by its name (u, undefined, NaN, Infinity or v) from the CALL_CHAIN check turns both of that name's fixtures RED
  ['Identifier named u', (at) => `u = t; const s = '${guardText(at)}' + u + ${closeText(at)};`],
  ['Identifier named undefined', (at) => `function f(undefined) { return '${guardText(at)}' + undefined + ${closeText(at)}; } const s = f(t);`],
  ['Identifier named NaN', (at) => `function f(NaN) { return '${guardText(at)}' + NaN + ${closeText(at)}; } const s = f(t);`],
  ['Identifier named Infinity', (at) => `function f(Infinity) { return '${guardText(at)}' + Infinity + ${closeText(at)}; } const s = f(t);`],
  ['Identifier named v, written \\u0076', (at) => `const v = t; const s = '${guardText(at)}' + \\u0076 + ${closeText(at)};`],
];
const PART_KIND_FIXTURES = PART_KINDS.flatMap(([kind, line]) => ['object', 'call'].map((at) => ({
  label: `part-kind matrix: ${/^[AEIOU]/.test(kind) ? 'an' : 'a'} ${kind} part joined after the ${at === 'object' ? 'guard object' : 'closed guard call'} fails the gate`,
  source: `${PART_SETUP[at]}\n${line(at)}`,
  refs: [],
  failures: [unreadable(2, CALL_CHAIN)],
})));

COORDINATOR_FIXTURES.push(...PART_KIND_FIXTURES);

const TWO_CLASS_KEYS = 'customjs-guard object has 2 class keys';
const SPREAD_OR_COMPUTED = 'customjs-guard object has a spread or computed key';
const NO_PARSE = "customjs-guard call's arguments do not parse as one comma expression from the path onward in this string and its + operands, with a placeholder for each part that has no static string value";
const PROPERTY_KINDS = [
  // MUTATION GUARD: skipping get properties when counting class keys turns this row RED
  ['a getter named class', String.raw`{ class: "OperatorStation", get class() { return "NoSuchGetter"; } }`, TWO_CLASS_KEYS],
  // MUTATION GUARD: skipping set properties when counting class keys turns this row RED
  ['a setter named class', String.raw`{ class: "OperatorStation", set class(v) {} }`, TWO_CLASS_KEYS],
  // MUTATION GUARD: skipping method properties when counting class keys turns this row and the next two RED
  ['a method named class', String.raw`{ class: "OperatorStation", class() { return "NoSuchMethodKind"; } }`, TWO_CLASS_KEYS],
  // MUTATION GUARD: skipping async methods when counting class keys turns this row RED
  ['an async method named class', String.raw`{ class: "OperatorStation", async class() { return "NoSuchAsync"; } }`, TWO_CLASS_KEYS],
  // MUTATION GUARD: skipping generator methods when counting class keys turns this row RED
  ['a generator method named class', String.raw`{ class: "OperatorStation", *class() { yield "NoSuchGenerator"; } }`, TWO_CLASS_KEYS],
  // MUTATION GUARD: allowing computed keys turns this row RED
  ['a computed key ["class"]', String.raw`{ class: "OperatorStation", ["class"]: "NoSuchComputed" }`, SPREAD_OR_COMPUTED],
  // MUTATION GUARD: counting only Identifier keys turns this row RED
  ['a string key "class"', String.raw`{ class: "OperatorStation", "class": "NoSuchStringKey" }`, TWO_CLASS_KEYS],
  // MUTATION GUARD: matching class keys by their source text turns this row and the next RED
  ['an identifier key written cl\\u0061ss', String.raw`{ class: "OperatorStation", cl\\u0061ss: "NoSuchEscapedKey" }`, TWO_CLASS_KEYS],
  ['a string key written "cl\\x61ss"', String.raw`{ class: "OperatorStation", "cl\\x61ss": "NoSuchEscapedString" }`, TWO_CLASS_KEYS],
  ['a numeric key 1', String.raw`{ class: "OperatorStation", 1: "NoSuchNumericKey" }`, null],
  ['a shorthand property class', String.raw`{ class: "OperatorStation", class }`, NO_PARSE],
  // MUTATION GUARD: allowing spread elements turns this row and the next RED
  ['a spread element before it', String.raw`{ ...{ class: "NoSuchSpreadBefore" }, class: "OperatorStation" }`, SPREAD_OR_COMPUTED],
  ['a spread element after it', String.raw`{ class: "OperatorStation", ...{ class: "NoSuchSpreadAfter" } }`, SPREAD_OR_COMPUTED],
];
COORDINATOR_FIXTURES.push(...PROPERTY_KINDS.map(([kind, object, message]) => ({
  label: `property-kind matrix: a guard object with class: "OperatorStation" and ${kind} ${message ? 'fails the gate' : 'is read as OperatorStation'}`,
  source: `const s = 'await dv.view("ranch/views/customjs-guard", ${object});';`,
  refs: message ? [] : ['OperatorStation'],
  failures: message ? [unreadable(1, message)] : [],
})));

COORDINATOR_FIXTURES.push(
  // MUTATION GUARD: reading a missing class argument from the first argument turns RED
  {
    label: "helper-argument matrix: for function block(title, widget), block('OperatorStation') omits the class argument and fails the gate",
    source: String.raw`function block(title, widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block('OperatorStation');`,
    refs: [],
    failures: [unreadable(2, BLOCK_ARG)],
  },
  {
    label: 'helper-argument matrix: block(undefined) fails the gate',
    source: String.raw`function block(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block(undefined);`,
    refs: [],
    failures: [unreadable(2, BLOCK_ARG)],
  },
  {
    label: "helper-argument matrix: block('OperatorStation', 'NoSuchExtra') is read as OperatorStation",
    source: String.raw`function block(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block('OperatorStation', 'NoSuchExtra');`,
    refs: ['OperatorStation'],
    failures: [],
  },
  {
    label: "helper-argument matrix: block(...['NoSuchSpreadArg']) fails the gate",
    source: String.raw`function block(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block(...['NoSuchSpreadArg']);`,
    refs: [],
    failures: [unreadable(2, BLOCK_ARG)],
  },
  {
    label: "helper-argument matrix: a class parameter with a default value fails the gate",
    source: String.raw`function block(widget = 'OperatorStation') { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block('NoSuchDefault');`,
    refs: [],
    failures: [unreadable(1, NOT_PARAM)],
  },
  {
    label: 'helper-argument matrix: a class value read from arguments[0] fails the gate',
    source: String.raw`function block(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + arguments[0] + '" });'; }
const s = block('NoSuchArgumentsIndex');`,
    refs: [],
    failures: [unreadable(1, NOT_PARAM)],
  },
  {
    label: 'helper-argument matrix: a rest parameter as the class value fails the gate',
    source: String.raw`function block(...widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block('NoSuchRest');`,
    refs: [],
    failures: [unreadable(1, NOT_PARAM)],
  },
  // MUTATION GUARD: counting the class parameter's position among plain identifier parameters only turns RED
  {
    label: "helper-argument matrix: for function block({ length }, widget), block('x', 'NoSuchPattern') fails naming NoSuchPattern",
    source: String.raw`function block({ length }, widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block('x', 'NoSuchPattern');`,
    refs: ['NoSuchPattern'],
    failures: [missing('NoSuchPattern', 2)],
  },
  // MUTATION GUARD: skipping appearances of the helper inside the helper itself turns RED
  {
    label: "helper-argument matrix: a call of the helper inside the helper, block('NoSuchRecursive'), is checked and fails naming NoSuchRecursive",
    source: String.raw`function block(widget, n) { if (n) return block('NoSuchRecursive'); return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const s = block('OperatorStation', 1);`,
    refs: ['NoSuchRecursive', 'OperatorStation'],
    failures: [missing('NoSuchRecursive', 1)],
  },
  // MUTATION GUARD: skipping appearances of the helper under typeof turns RED
  {
    label: 'helper-argument matrix: typeof block is an appearance of the helper other than as a call and fails the gate',
    source: String.raw`function block(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }
const k = typeof block;
const s = block('OperatorStation');`,
    refs: ['OperatorStation'],
    failures: [unreadable(2, BLOCK_ARG)],
  },
  // MUTATION GUARD: skipping a guard call that lies inside the previous guard call of the same string turns RED
  {
    label: 'nested guard calls: a guard call inside the object of another is read and fails naming NoSuchNested',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation", x: dv.view("ranch/views/customjs-guard", { class: "NoSuchNested" }) });';`,
    refs: ['OperatorStation', 'NoSuchNested'],
    failures: [missing('NoSuchNested', 1)],
  },
  // MUTATION GUARD: resuming the occurrence scan at the end of the call just read turns RED
  {
    label: 'nested guard calls: a guard call in the third argument of another is read and fails naming NoSuchNested3',
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }, dv.view("ranch/views/customjs-guard", { class: "NoSuchNested3" }));';`,
    refs: ['OperatorStation', 'NoSuchNested3'],
    failures: [missing('NoSuchNested3', 1)],
  },
  // MUTATION GUARD: skipping templates nested in another template's substitution turns RED
  {
    label: 'nested guard calls: a guard call in a template nested in another template is read and fails naming NoSuchNestedTpl',
    source: 'const s = `${`await dv.view("ranch/views/customjs-guard", { class: "NoSuchNestedTpl" });`}`;',
    refs: ['NoSuchNestedTpl'],
    failures: [missing('NoSuchNestedTpl', 1)],
  },
  // MUTATION GUARD: skipping string literals in a conditional expression branch turns RED
  {
    label: 'nested guard calls: a guard call in a branch of a conditional expression is read and fails naming NoSuchCond',
    source: String.raw`const flag = true; const s = flag ? 'await dv.view("ranch/views/customjs-guard", { class: "NoSuchCond" });' : '';`,
    refs: ['NoSuchCond'],
    failures: [missing('NoSuchCond', 1)],
  },
  // MUTATION GUARD: exempting from CALL_CHAIN a part placed after an unterminated // on its line turns RED
  {
    label: 'a guard string ending in // and a space, joined with t, which starts with a newline, fails the gate',
    source: String.raw`const t = '\nawait dv.view("ranch/views/customjs-' + 'guard", { class: "NoSuchLineComment" });';
const s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }); // ' + t;`,
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: testing the mixed-value exemption with startsWith in place of equality turns RED
  {
    label: "a class value written widget + 'X' fails as a mixed value",
    source: String.raw`function block(widget) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + 'X" });'; }
const s = block('OperatorStation');`,
    refs: [],
    failures: [unreadable(1, 'customjs-guard class value is not a single literal or expression, or the joined text contains __sauceClassExpr outside its placeholders')],
  },
  // MUTATION GUARD: letting collectClassNames read class lines behind // or * comment markers turns RED
  {
    label: 'builds fails with that name, though a .js file under platform/blueprints or platform/mechanisms has a line whose text before the words class builds is only spaces, tabs, / and *, with at least one *',
    precondition: () => (['platform/blueprints', 'platform/mechanisms'].flatMap((d) => walk(d, []))
      .some((f) => /^[ \t/*]*\*[ \t/*]*class\s+builds\b/m.test(fs.readFileSync(f, 'utf8')))
      ? null : 'no line of a .js file under platform/blueprints or platform/mechanisms has only spaces, tabs, / and *, with at least one *, before the words class builds'),
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "builds" });';`,
    refs: ['builds'],
    failures: [missing('builds', 1)],
  },
);

COORDINATOR_FIXTURES.push(
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting += as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment += in block(widget) fails the gate",
    source: "function block(widget) { widget += 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting -= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment -= in block(widget) fails the gate",
    source: "function block(widget) { widget -= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting *= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment *= in block(widget) fails the gate",
    source: "function block(widget) { widget *= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting **= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment **= in block(widget) fails the gate",
    source: "function block(widget) { widget **= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting /= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment /= in block(widget) fails the gate",
    source: "function block(widget) { widget /= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting %= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment %= in block(widget) fails the gate",
    source: "function block(widget) { widget %= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting <<= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment <<= in block(widget) fails the gate",
    source: "function block(widget) { widget <<= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting >>= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment >>= in block(widget) fails the gate",
    source: "function block(widget) { widget >>= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting >>>= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment >>>= in block(widget) fails the gate",
    source: "function block(widget) { widget >>>= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting &= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment &= in block(widget) fails the gate",
    source: "function block(widget) { widget &= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting |= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment |= in block(widget) fails the gate",
    source: "function block(widget) { widget |= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting ^= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment ^= in block(widget) fails the gate",
    source: "function block(widget) { widget ^= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting &&= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment &&= in block(widget) fails the gate",
    source: "function block(widget) { widget &&= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting ||= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment ||= in block(widget) fails the gate",
    source: "function block(widget) { widget ||= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting only a plain = assignment as a rebinding turns RED
  // MUTATION GUARD: not counting ??= as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: compound assignment ??= in block(widget) fails the gate",
    source: "function block(widget) { widget ??= 'NoSuchCompound'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting ++ as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: update widget++ in block(widget) fails the gate",
    source: "function block(widget) { widget++; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting -- as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: update widget-- in block(widget) fails the gate",
    source: "function block(widget) { widget--; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting ++ as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: update ++widget in block(widget) fails the gate",
    source: "function block(widget) { ++widget; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting -- as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: update --widget in block(widget) fails the gate",
    source: "function block(widget) { --widget; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting a destructured property as a rebinding only when it is shorthand turns RED
  // MUTATION GUARD: not counting a destructured property as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: object destructuring ({ x: widget } = ...) in block(widget) fails the gate",
    source: "function block(widget) { ({ x: widget } = { x: 'NoSuchObjectPattern' }); return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: counting a destructured property as a rebinding only when it is shorthand turns RED
  // MUTATION GUARD: not counting a destructured property as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: nested object destructuring ({ a: { b: widget } } = ...) in block(widget) fails the gate",
    source: "function block(widget) { ({ a: { b: widget } } = { a: { b: 'NoSuchNestedObject' } }); return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a destructuring default as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: object destructuring with a default ({ x: widget = ... } = {}) in block(widget) fails the gate",
    source: "function block(widget) { ({ x: widget = 'NoSuchObjectDefault' } = {}); return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a rest element as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: object rest ({ ...widget } = ...) in block(widget) fails the gate",
    source: "function block(widget) { ({ ...widget } = { x: 1 }); return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting an array pattern element as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: array destructuring [widget] = ... in block(widget) fails the gate",
    source: "function block(widget) { [widget] = ['NoSuchArrayPattern']; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting an array pattern element as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: nested array destructuring [[widget]] = ... in block(widget) fails the gate",
    source: "function block(widget) { [[widget]] = [['NoSuchNestedArray']]; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a destructuring default as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: array destructuring with a default [widget = ...] = [] in block(widget) fails the gate",
    source: "function block(widget) { [widget = 'NoSuchArrayDefault'] = []; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a rest element as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: array rest [...widget] = ... in block(widget) fails the gate",
    source: "function block(widget) { [...widget] = ['NoSuchArrayRest']; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting an array pattern element as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: array inside object destructuring ({ a: [widget] } = ...) in block(widget) fails the gate",
    source: "function block(widget) { ({ a: [widget] } = { a: ['NoSuchMixedPattern'] }); return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a for-in target as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: a for-in target in block(widget) fails the gate",
    source: "function block(widget) { for (widget in { NoSuchForIn: 1 }) {}; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a for-of target as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: a for-of target in block(widget) fails the gate",
    source: "function block(widget) { for (widget of ['NoSuchForOf']) {}; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a var declaration as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: var redeclaration in block(widget) fails the gate",
    source: "function block(widget) { var widget = 'NoSuchVar'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not flagging arguments in the helper turns RED
  {
    label: "parameter-rebinding matrix: arguments[0] assignment in block(widget) fails the gate",
    source: "function block(widget) { arguments[0] = 'NoSuchArguments'; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: not counting a catch parameter as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: a catch parameter named widget in block(widget) fails the gate",
    source: "function block(widget) { try { throw 'NoSuchCatch'; } catch (widget) { return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; } }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  {
    label: "parameter-rebinding matrix: a nested arrow function whose parameter is named widget in block(widget) fails the gate",
    source: "function block(widget) { const f = (widget) => 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; return f('NoSuchShadowParam'); }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, NOT_PARAM)],
  },
  // MUTATION GUARD: not counting a nested function parameter as a rebinding turns RED
  {
    label: "parameter-rebinding matrix: a nested arrow function parameter named widget beside the guard string in block(widget) fails the gate",
    source: "function block(widget) { const g = (widget) => widget; return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }\nconst s = block('OperatorStation');",
    refs: [],
    failures: [unreadable(1, MAY_NOT_HOLD('block'))],
  },
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: reading the occurrence's own quasi cooked turns RED
  {
    label: "template-quasi matrix: String.raw, \\\\ in the first quasi: the guard call fails the gate",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '\\\\', class: \"NoSuchQuasi\" } //' }\n);`;",
    refs: [],
    failures: [unreadable(1, TWO_CLASS_KEYS)],
  },
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: reading the occurrence's own quasi cooked turns RED
  {
    label: "template-quasi matrix: String.raw, \\u0027 in the first quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '\\u0027, class: \"NoSuchQuasi\", z: \\u0027' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: reading the occurrence's own quasi cooked turns RED
  {
    label: "template-quasi matrix: String.raw, \\x27 in the first quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '\\x27, class: \"NoSuchQuasi\", z: \\x27' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  {
    label: "template-quasi matrix: String.raw, \\${ in the first quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: 'a\\${b' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  {
    label: "template-quasi matrix: String.raw, a line continuation in the first quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: 'a\\\nb' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading every quasi raw turns RED
  {
    label: "template-quasi matrix: untagged template, \\\\ in the first quasi: the guard call is read as OperatorStation",
    source: "const s = `await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '\\\\', class: \"NoSuchQuasi\" } //' }\n);`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading later String.raw quasis cooked turns RED
  // MUTATION GUARD: reading only the first String.raw quasi raw turns RED
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\\\ in the middle quasi: the guard call fails the gate",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\\\'${''}, class: \"NoSuchQuasi\" } //' }\n);`;",
    refs: [],
    failures: [unreadable(1, TWO_CLASS_KEYS)],
  },
  // MUTATION GUARD: reading later String.raw quasis cooked turns RED
  // MUTATION GUARD: reading only the first String.raw quasi raw turns RED
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\u0027 in the middle quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\u0027, class: \"NoSuchQuasi\", z: ${''}\\u0027' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading later String.raw quasis cooked turns RED
  // MUTATION GUARD: reading only the first String.raw quasi raw turns RED
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\x27 in the middle quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\x27, class: \"NoSuchQuasi\", z: ${''}\\x27' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\${ in the middle quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: 'a${''}\\${${''}b' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, a line continuation in the middle quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: 'a${''}\\\n${''}b' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading every quasi raw turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: untagged template, \\\\ in the middle quasi: the guard call is read as OperatorStation",
    source: "const s = `await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\\\'${''}, class: \"NoSuchQuasi\" } //' }\n);`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading later String.raw quasis cooked turns RED
  // MUTATION GUARD: reading only the first String.raw quasi raw turns RED
  // MUTATION GUARD: reading every quasi cooked turns RED
  {
    label: "template-quasi matrix: String.raw, \\\\ in the last quasi: the guard call fails the gate",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\\\', class: \"NoSuchQuasi\" } //' }\n);`;",
    refs: [],
    failures: [unreadable(1, TWO_CLASS_KEYS)],
  },
  // MUTATION GUARD: reading later String.raw quasis cooked turns RED
  // MUTATION GUARD: reading only the first String.raw quasi raw turns RED
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\u0027 in the last quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\u0027, class: \"NoSuchQuasi\", z: \\u0027' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading later String.raw quasis cooked turns RED
  // MUTATION GUARD: reading only the first String.raw quasi raw turns RED
  // MUTATION GUARD: reading every quasi cooked turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\x27 in the last quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\x27, class: \"NoSuchQuasi\", z: \\x27' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, \\${ in the last quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: 'a${''}\\${b' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, a line continuation in the last quasi: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: 'a${''}\\\nb' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: reading every quasi raw turns RED
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: untagged template, \\\\ in the last quasi: the guard call is read as OperatorStation",
    source: "const s = `await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${''}\\\\', class: \"NoSuchQuasi\" } //' }\n);`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  // MUTATION GUARD: treating string literal substitutions as parts with no static string value turns RED
  {
    label: "template-quasi matrix: String.raw, a string literal substitution: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${'x'}' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  {
    label: "template-quasi matrix: String.raw, a template substitution: the guard call is read as OperatorStation",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\", n: '${`x`}' });`;",
    refs: ["OperatorStation"],
    failures: [],
  },
  {
    label: "template-quasi matrix: String.raw, a number substitution after the closed call: the guard call fails the gate",
    source: "const s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\" }); ${1}`;",
    refs: [],
    failures: [unreadable(1, CALL_CHAIN)],
  },
  {
    label: "template-quasi matrix: String.raw, an identifier substitution after the closed call: the guard call fails the gate",
    source: "const t = '; await dv.view(\"ranch/views/customjs-' + 'guard\", { class: \"NoSuchSubstIdent\" });';\nconst s = String.raw`await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStation\" }); ${t}`;",
    refs: [],
    failures: [unreadable(2, CALL_CHAIN)],
  },
  // MUTATION GUARD: skipping string literals that are template substitutions turns RED
  {
    label: "template-quasi matrix: a guard string literal used as a template substitution: the guard call fails naming NoSuchInSubst",
    source: "const s = `${'await dv.view(\"ranch/views/customjs-guard\", { class: \"NoSuchInSubst\" });'}`;",
    refs: ["NoSuchInSubst"],
    failures: [missing("NoSuchInSubst", 1)],
  },
  {
    label: "class-name matrix: the class all lower-case operatorstation fails naming operatorstation",
    source: "const s = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"operatorstation\" });';",
    refs: ["operatorstation"],
    failures: [missing("operatorstation", 1)],
  },
  {
    label: "class-name matrix: the class all upper-case OPERATORSTATION fails naming OPERATORSTATION",
    source: "const s = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OPERATORSTATION\" });';",
    refs: ["OPERATORSTATION"],
    failures: [missing("OPERATORSTATION", 1)],
  },
  {
    label: "class-name matrix: the class mixed case OperatorstatioN fails naming OperatorstatioN",
    source: "const s = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorstatioN\" });';",
    refs: ["OperatorstatioN"],
    failures: [missing("OperatorstatioN", 1)],
  },
  {
    label: "class-name matrix: the class one letter different OperatorStatiom fails naming OperatorStatiom",
    source: "const s = 'await dv.view(\"ranch/views/customjs-guard\", { class: \"OperatorStatiom\" });';",
    refs: ["OperatorStatiom"],
    failures: [missing("OperatorStatiom", 1)],
  },
);

COORDINATOR_FIXTURES.push(
  // MUTATION GUARD: letting collectClassNames read class lines behind a // comment marker turns RED
  {
    label: 'would fails with that name, though a .js file under platform/blueprints or platform/mechanisms has a line whose text before the words class would is only spaces, tabs and //',
    precondition: () => (['platform/blueprints', 'platform/mechanisms'].flatMap((d) => walk(d, []))
      .some((f) => /^[ \t]*\/\/[ \t]*class\s+would\b/m.test(fs.readFileSync(f, 'utf8')))
      ? null : 'no line of a .js file under platform/blueprints or platform/mechanisms has only spaces, tabs and // before the words class would'),
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "would" });';`,
    refs: ['would'],
    failures: [missing('would', 1)],
  },
);

COORDINATOR_FIXTURES.push(
  // MUTATION GUARD: letting enclosingFunction stop at a class field or static block turns RED
  {
    label: "a helper whose guard string is a static class field initialiser reading widget is read through its call and fails naming NoSuchInStaticField",
    source: String.raw`function block(widget) { return (class { static s = 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }).s; }
const s = block('NoSuchInStaticField');`,
    refs: ['NoSuchInStaticField'],
    failures: [missing('NoSuchInStaticField', 2)],
  },
  // MUTATION GUARD: letting enclosingFunction stop at a class field or static block turns RED
  {
    label: "a helper whose guard string is built in a class static block reading widget is read through its call and fails naming NoSuchInStaticBlock",
    source: String.raw`function block(widget) { let r; class K { static { r = 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; } } return r; }
const s = block('NoSuchInStaticBlock');`,
    refs: ['NoSuchInStaticBlock'],
    failures: [missing('NoSuchInStaticBlock', 2)],
  },
);

// Position property: a seeded, deterministic generator builds strict CommonJS scripts from the
// payload families below. Each expression slot in POSITION_EXPRESSIONS holds a payload
// without nesting; each statement position in POSITION_STATEMENTS wraps a payload in the
// declarator-init slot; and seeded samples nest slots and positions to depth 2 or 3. It
// pushes one fixture per generated source. The expected refs and failures come from the
// payload's family, not from the gate, as the comment above POSITION_FAMILIES states.
// A generated source identical to an earlier one, or that V8 does not compile as a strict
// script, is dropped, and the last fixture asserts that every position kind appears in every
// family.
// MUTATION GUARD: the visitor not descending into any one node type used below (ClassBody,
// StaticBlock, PropertyDefinition, MethodDefinition, SwitchCase, LabeledStatement,
// IfStatement, WhileStatement, DoWhileStatement, ForStatement, ForInStatement,
// ForOfStatement, TryStatement, CatchClause, BlockStatement, ReturnStatement, ThrowStatement,
// AssignmentPattern, SpreadElement, AwaitExpression, YieldExpression, ChainExpression,
// SequenceExpression, ConditionalExpression, LogicalExpression, NewExpression,
// CallExpression, TaggedTemplateExpression, TemplateLiteral, ArrayExpression,
// ObjectExpression, Property, ArrowFunctionExpression, FunctionExpression, ClassExpression,
// UnaryExpression, AssignmentExpression, BinaryExpression) turns position fixtures RED
// MUTATION GUARD: skipping untagged template or String.raw template parts, or reading String.raw
// cooked, below any one of those node types turns the template payload fixtures RED
// MUTATION GUARD: reading only the first customjs-guard occurrence of a part below any one of
// those node types turns the two-call payload fixtures RED
// MUTATION GUARD: resolving a helper once, caching its parameter index or its rebinding verdict
// per function, or checking only the first argument for a spread turns the helper payload
// fixtures RED
// MUTATION GUARD: reading an empty tagged template, a sequence, a call on a static string, or a
// void operand as a static string turns the chain and void payload fixtures RED
// MUTATION GUARD: skipping the closing check for parts inside a class body turns the open-call
// payload fixtures RED
const POSITION_SEED = 20261003;
const POSITION_SAMPLES = 40;
const positionRandom = (seed) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const POSITION_EXPRESSIONS = [
  ['declarator init', (h) => `(() => { const v = ${h}; })`],
  ['assignment right side', (h) => `(x = ${h})`],
  ['compound assignment right side', (h) => `(x += ${h})`],
  ['object property value', (h) => `({ k: ${h} })`],
  ['object method return', (h) => `({ m() { return ${h}; } })`],
  ['object getter return', (h) => `({ get g() { return ${h}; } })`],
  ['object setter body', (h) => `({ set s(v) { x = ${h}; } })`],
  ['class field', (h) => `(class { f = ${h}; })`],
  ['static class field', (h) => `(class { static f = ${h}; })`],
  ['class static block', (h) => `(class { static { x = ${h}; } })`],
  ['class method return', (h) => `(class { m() { return ${h}; } })`],
  ['class getter return', (h) => `(class { get g() { return ${h}; } })`],
  ['computed class key', (h) => `(class { [${h}]() {} })`],
  ['default parameter', (h) => `(function (p = ${h}) {})`],
  ['destructuring default', (h) => `(({ q = ${h} }) => q)`],
  ['function return', (h) => `(function () { return ${h}; })`],
  ['function throw', (h) => `(function () { throw ${h}; })`],
  ['arrow body', (h) => `(() => ${h})`],
  ['ternary consequent', (h) => `(c ? ${h} : 0)`],
  ['ternary alternate', (h) => `(c ? 0 : ${h})`],
  ['ternary test', (h) => `(${h} ? 0 : 1)`],
  ['logical || right side', (h) => `(c || ${h})`],
  ['logical && right side', (h) => `(c && ${h})`],
  ['logical ?? right side', (h) => `(c ?? ${h})`],
  ['array element', (h) => `[0, ${h}]`],
  ['array spread', (h) => `[...[${h}]]`],
  ['call argument', (h) => `g(${h})`],
  ['call spread argument', (h) => `g(...[${h}])`],
  ['new argument', (h) => `new G(${h})`],
  ['optional call argument', (h) => `g?.(${h})`],
  ['optional member call argument', (h) => `o?.m?.(${h})`],
  ['sequence after the first', (h) => `(0, ${h})`],
  ['sequence first', (h) => `(${h}, 0)`],
  ['yield argument', (h) => `(function* () { yield ${h}; })`],
  ['await argument', (h) => `(async () => { await ${h}; })`],
  ['template substitution', (h) => `\`a\${${h}}b\``],
  ['tagged template substitution', (h) => `tag\`a\${${h}}b\``],
  ['unary operand', (h) => `(void ${h})`],
  ['binary right side after a static string', (h) => `('' + ${h})`],
  ['member object', (h) => `(${h}).length`],
];
const POSITION_STATEMENTS = [
  ['if consequent', (s, n) => `if (c) { ${s} }`],
  ['if alternate', (s, n) => `if (c) {} else { ${s} }`],
  ['else-if consequent', (s, n) => `if (c) {} else if (c) { ${s} }`],
  ['switch case', (s, n) => `switch (c) { case 1: ${s} }`],
  ['switch default', (s, n) => `switch (c) { default: ${s} }`],
  ['for body', (s, n) => `for (let i${n} = 0; i${n} < 1; i${n}++) { ${s} }`],
  ['for-in body', (s, n) => `for (const k${n} in o) { ${s} }`],
  ['for-of body', (s, n) => `for (const k${n} of a) { ${s} }`],
  ['while body', (s, n) => `while (c) { ${s} }`],
  ['do-while body', (s, n) => `do { ${s} } while (c);`],
  ['try block', (s, n) => `try { ${s} } catch (e${n}) {}`],
  ['catch block', (s, n) => `try {} catch (e${n}) { ${s} }`],
  ['finally block', (s, n) => `try {} finally { ${s} }`],
  ['labeled block', (s, n) => `l${n}: { ${s} }`],
  ['labeled loop', (s, n) => `m${n}: for (;;) { ${s} break m${n}; }`],
  ['block', (s, n) => `{ ${s} }`],
  ['function declaration body', (s, n) => `function f${n}() { ${s} }`],
  ['arrow function block body', (s, n) => `(() => { ${s} })();`],
  ['class method body', (s, n) => `class K${n} { m() { ${s} } }`],
  ['class static block body', (s, n) => `class S${n} { static { ${s} } }`],
  ['generator body', (s, n) => `function* y${n}() { ${s} }`],
  ['async function body', (s, n) => `async function z${n}() { ${s} }`],
];
const POSITION_PRELUDE = "'use strict'; let c = 0, x, u, o = {}, a = []; const g = () => 0, G = function () {}, tag = () => 0, j = ' && { class: \"NoSuchChainPart\" }', inj = () => j;";
const positionGuard = (cls) => `await dv.view("ranch/views/customjs-guard", { class: "${cls}" });`;
const POSITION_HELPER = "function block(widget) { return 'await dv.view(\"ranch/views/customjs-guard\", { class: \"' + widget + '\" });'; }";
const POSITION_BACKSLASH = String.fromCharCode(92);
const positionHelperOf = (params, classParam) => `function block(${params}) { return 'await dv.view("ranch/views/customjs-guard", { class: "' + ${classParam} + '" });'; }`;
const POSITION_TWO_STRINGS = (rebind) => `function block(a, b) { ${rebind}const p = 'await dv.view("ranch/views/customjs-guard", { class: "' + a + '" });'; const q = 'await dv.view("ranch/views/customjs-guard", { class: "' + b + '" });'; return p + q; }`;
const POSITION_RAW_ESCAPED = (cls, decoy) => `String.raw\`await dv.view("ranch/views/customjs-guard", { n: '${POSITION_BACKSLASH}${POSITION_BACKSLASH}', class: "${cls}" //', class: "${decoy}" })\n})\``;
// The produced text of a payload is computed by evaluating its second line and expression in a
// strict script, and the classes Dataview passes to dv.view for that text by running it as
// Dataview runs a dataviewjs block, with a dv.view stub; the context runs its queued
// microtasks after the script, so a call after an await is recorded.
const positionProduced = (second, expr) => new (require('vm').Script)(`${POSITION_PRELUDE} ${second}\n(${expr});`).runInNewContext({});
const positionDataview = (text) => {
  const vm = require('vm');
  const context = vm.createContext({ got: [] }, { microtaskMode: 'afterEvaluate' });
  new vm.Script(`(function (dv) { 'use strict'; return (async () => { ${text} })(); })({ view: (p, input) => got.push(input.class) });`).runInContext(context);
  return Array.from(context.got);
};
// Each family has a name and one of three shapes, and add() sets its expected refs and failures:
// - An expression family has expr, which is placed in a position on line 3, and second, the
//   second line (empty when absent). With read, the expected refs are the classes Dataview
//   passes to dv.view for the text that second and expr produce, and the expected failures
//   are a missing-class failure on line 3 for each of those classes that does not ship.
//   Without read, the expected refs are refs (none when absent) and the expected failures are
//   fail, each a line and a message.
// - The alias family's second line is POSITION_HELPER followed by block('OperatorStation'),
//   and line 3 places an alias from POSITION_ALIASES in a position. Its expected refs are
//   ['OperatorStation'] and its expected failures are BLOCK_ARG on line 3, twice for
//   ({ block }).
// - The rebinding family's second line is a helper with a rebinding from POSITION_REBINDS
//   placed in a position inside it, and line 3 is block('OperatorStation'). Its expected refs
//   are none and its expected failure is MAY_NOT_HOLD('block') on line 2.
const POSITION_FAMILIES = [
  { name: 'an unshipped single-quoted guard literal', expr: `'${positionGuard('NoSuchPositionLiteral')}'`, read: true },
  { name: 'a shipped single-quoted guard literal', expr: `'${positionGuard('OperatorStation')}'`, read: true },
  { name: 'an unshipped double-quoted guard literal', expr: `"await dv.view('ranch/views/customjs-guard', { class: 'NoSuchPositionDouble' });"`, read: true },
  { name: 'a shipped double-quoted guard literal', expr: `"await dv.view('ranch/views/customjs-guard', { class: 'OperatorStation' });"`, read: true },
  { name: 'an unshipped template literal', expr: `\`${positionGuard('NoSuchPositionTemplate')}\``, read: true },
  { name: 'a shipped template literal', expr: `\`${positionGuard('OperatorStation')}\``, read: true },
  { name: 'an unshipped template with a substitution in the class value', expr: '`await dv.view("ranch/views/customjs-guard", { class: "${\'NoSuchPositionSubst\'}" });`', read: true },
  { name: 'a shipped template with a substitution in the class value', expr: '`await dv.view("ranch/views/customjs-guard", { class: "${\'OperatorStation\'}" });`', read: true },
  { name: 'an unshipped String.raw template', expr: `String.raw\`${positionGuard('NoSuchPositionRaw')}\``, read: true },
  { name: 'a shipped String.raw template', expr: `String.raw\`${positionGuard('OperatorStation')}\``, read: true },
  { name: 'an unshipped String.raw template whose escapes differ raw and cooked', expr: POSITION_RAW_ESCAPED('NoSuchPositionRawEscaped', 'OperatorStation'), read: true },
  { name: 'a shipped String.raw template whose escapes differ raw and cooked', expr: POSITION_RAW_ESCAPED('OperatorStation', 'NoSuchPositionRawDecoy'), read: true },
  { name: 'an unshipped + chain of static strings', expr: `('await dv.view("ranch/views/customjs-guard", { class: "' + 'NoSuchPositionChain' + '" });')`, read: true },
  { name: 'a shipped + chain of static strings', expr: `('await dv.view("ranch/views/customjs-guard", { class: "' + 'OperatorStation' + '" });')`, read: true },
  { name: 'an unshipped template whose chain goes on after the call', expr: `(\`${positionGuard('NoSuchPositionTail')}\` + ' /* tail */')`, read: true },
  { name: 'a shipped template whose chain goes on after the call', expr: `(\`${positionGuard('OperatorStation')}\` + ' /* tail */')`, read: true },
  { name: 'two guard calls in one string, shipped then unshipped', expr: `'${positionGuard('OperatorStation')} ${positionGuard('NoSuchPositionSecond')}'`, read: true },
  { name: 'two guard calls in one string, unshipped then shipped', expr: `'${positionGuard('NoSuchPositionFirst')} ${positionGuard('OperatorStation')}'`, read: true },
  { name: 'two guard calls in one string, both unshipped', expr: `'${positionGuard('NoSuchPositionOne')} ${positionGuard('NoSuchPositionTwo')}'`, read: true },
  { name: 'two guard calls in one template, shipped then unshipped', expr: `\`${positionGuard('OperatorStation')} ${positionGuard('NoSuchPositionTemplateSecond')}\``, read: true },
  { name: 'a guard call joined with an empty tagged template', expr: `('await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + inj\`\` + ');')`, fail: [[3, () => CALL_CHAIN]] },
  { name: "a guard call joined with ('', j)", expr: `('await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + ('', j) + ');')`, fail: [[3, () => CALL_CHAIN]] },
  { name: "a guard call joined with ''.concat(j)", expr: `('await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }' + ''.concat(j) + ');')`, fail: [[3, () => CALL_CHAIN]] },
  { name: "a class value written void 'OperatorStation'", expr: `('await dv.view("ranch/views/customjs-guard", { class: "' + void 'OperatorStation' + '" });')`, fail: [[3, () => NOT_PARAM]] },
  { name: 'an open guard call closed with += in a closure', expr: `(() => { let s = 'await dv.view("ranch/views/customjs-guard", { class: "OperatorStation" }'; s += ' && { class: "NoSuchPositionOpen" });'; return s; })()`, fail: [[3, () => CALL_OPEN]] },
  { name: 'an unshipped helper call', second: POSITION_HELPER, expr: "block('NoSuchPositionHelper')", read: true },
  { name: 'a shipped helper call', second: POSITION_HELPER, expr: "block('OperatorStation')", read: true },
  { name: 'a two-parameter helper with the class first', second: positionHelperOf('w, z', 'w'), expr: "block('NoSuchPositionParam0of2', 'x')", read: true },
  { name: 'a two-parameter helper with the class second', second: positionHelperOf('z, w', 'w'), expr: "block('x', 'NoSuchPositionParam1of2')", read: true },
  { name: 'a three-parameter helper with the class first', second: positionHelperOf('w, y, z', 'w'), expr: "block('NoSuchPositionParam0of3', 'x', 'x')", read: true },
  { name: 'a three-parameter helper with the class second', second: positionHelperOf('y, w, z', 'w'), expr: "block('x', 'NoSuchPositionParam1of3', 'x')", read: true },
  { name: 'a three-parameter helper with the class third', second: positionHelperOf('y, z, w', 'w'), expr: "block('x', 'x', 'NoSuchPositionParam2of3')", read: true },
  { name: 'a helper with a guard string for each of two parameters', second: POSITION_TWO_STRINGS(''), expr: "block('OperatorStation', 'NoSuchPositionTwoStrings')", read: true },
  { name: 'a helper with a guard string for each of two parameters, the second rebound', second: POSITION_TWO_STRINGS("b = 'NoSuchPositionRebound'; "), expr: "block('OperatorStation', 'OperatorStation')",
    refs: ['OperatorStation'], fail: [[2, () => 'b is redeclared or assigned in block, or block names arguments, eval or with']] },
  { name: 'a helper call with a spread before the class argument', second: positionHelperOf('y, z, w', 'w'), expr: "block('a', ...['b', 'NoSuchPositionSpread'], 'OperatorStation')", fail: [[3, () => BLOCK_ARG]] },
  { name: 'a helper whose class parameter has a default', second: positionHelperOf("w = 'OperatorStation'", 'w'), expr: "block('NoSuchPositionDefault')", fail: [[2, () => NOT_PARAM]] },
  { name: 'a helper alias', second: `${POSITION_HELPER} block('OperatorStation');`, alias: true },
  { name: 'a class parameter rebinding', rebinding: true },
];
// The shorthand alias ({ block }) is two Identifier nodes in acorn, its key and its value, and each
// fails as an appearance other than a call.
const POSITION_ALIASES = ['block', '(u = block)', '(o.b = block)', '[block]', '(block || 0)', '[].map(block)', "block.call(null, 'NoSuchAlias')",
  "block.apply(null, ['NoSuchAlias'])", "Reflect.apply(block, null, ['NoSuchAlias'])", '({ block })', '(() => block)'];
const POSITION_REBINDS = ["(widget = 'NoSuchRebind')", "(widget += 'X')", '(widget++)', "([widget] = ['NoSuchRebind'])",
  "({ w: widget } = { w: 'NoSuchRebind' })", "(() => { widget = 'NoSuchRebind'; })", "(() => { const widget = 'NoSuchRebind'; return widget; })",
  "(() => { for (widget of ['NoSuchRebind']) {} })", "(() => { arguments[0] = 'NoSuchRebind'; })", "(() => { eval(\"widget = 'NoSuchRebind'\"); })"];
// with is not generated: strict code, which the coordinator source is, rejects it as a SyntaxError.
const positionCompiles = (source) => {
  try { new (require('vm').Script)(source); return null; } catch (e) { return `generated source does not compile as a strict script: ${e.message}`; }
};
const positionExpected = (family, defs) => {
  if (family.alias || family.rebinding) return null;
  const read = family.read ? positionDataview(positionProduced(family.second || '', family.expr)) : family.refs || [];
  return {
    refs: read,
    failures: [...(family.fail || []).map(([line, message]) => unreadable(line, message())),
      ...(family.read ? read.filter((cls) => !defs.has(cls)).map((cls) => missing(cls, 3)) : [])],
  };
};
const POSITION_FIXTURES = (() => {
  const defs = collectClassNames(REF_SCAN_DIRS);
  const random = positionRandom(POSITION_SEED);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const expectations = POSITION_FAMILIES.map((family) => positionExpected(family, defs));
  let serial = 0;
  let skipped = 0;
  let repeated = 0;
  const sources = new Set();
  const fixtures = [];
  const seen = POSITION_FAMILIES.map(() => new Set());
  const add = (familyIndex, path, expression, variant = serial) => {
    const family = POSITION_FAMILIES[familyIndex];
    const alias = POSITION_ALIASES[variant % POSITION_ALIASES.length];
    const rebind = POSITION_REBINDS[variant % POSITION_REBINDS.length];
    const wrap = (payload) => {
      let text = payload;
      for (const [, ctx] of expression) text = ctx(text);
      text = `void ${text};`;
      path.forEach(([, ctx], level) => { text = ctx(text, `${serial}_${level}`); });
      return text;
    };
    serial += 1;
    const [second, third] = family.rebinding
      ? [`function block(widget) { ${wrap(rebind)} return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }`, "block('OperatorStation');"]
      : [family.second || '', wrap(family.alias ? alias : family.expr)];
    const source = `${POSITION_PRELUDE}\n${second}\n${third}`;
    if (sources.has(source)) { repeated += 1; return; }
    sources.add(source);
    if (positionCompiles(source)) { skipped += 1; return; }
    for (const [kind] of [...expression, ...path]) seen[familyIndex].add(kind);
    const where = [...expression.map(([k]) => k), ...path.map(([k]) => k)].join(' in ')
      + (family.alias ? ` (${alias})` : family.rebinding ? ` (${rebind})` : '');
    let { refs, failures } = expectations[familyIndex] || {};
    if (family.alias) {
      refs = ['OperatorStation'];
      failures = alias === '({ block })' ? [unreadable(3, BLOCK_ARG), unreadable(3, BLOCK_ARG)] : [unreadable(3, BLOCK_ARG)];
    } else if (family.rebinding) {
      refs = [];
      failures = [unreadable(2, MAY_NOT_HOLD('block'))];
    }
    fixtures.push({ label: `position property: ${family.name} in ${where}`, source, refs, failures });
  };
  POSITION_FAMILIES.forEach((family, i) => {
    const variants = family.alias ? POSITION_ALIASES.length : family.rebinding ? POSITION_REBINDS.length : 1;
    for (const e of POSITION_EXPRESSIONS) for (let v = 0; v < variants; v++) add(i, [], [e], v);
    for (const s of POSITION_STATEMENTS) add(i, [s], [POSITION_EXPRESSIONS[0]]);
    for (let n = 0; n < POSITION_SAMPLES; n++) {
      const depth = 2 + Math.floor(random() * 2);
      const exprCount = 1 + Math.floor(random() * (depth - 1));
      const expression = Array.from({ length: exprCount }, () => pick(POSITION_EXPRESSIONS));
      const path = Array.from({ length: depth - exprCount }, () => pick(POSITION_STATEMENTS));
      add(i, path, expression);
    }
  });
  const kinds = [...POSITION_EXPRESSIONS, ...POSITION_STATEMENTS].map(([k]) => k);
  fixtures.push({
    label: `position property: each of the ${kinds.length} position kinds appears in each of the ${POSITION_FAMILIES.length} families among the ${fixtures.length} generated sources that compile as strict scripts (${repeated} repeats of an earlier source and ${skipped} sources that do not compile are dropped)`,
    precondition: () => {
      const gaps = POSITION_FAMILIES.flatMap((family, i) => kinds.filter((k) => !seen[i].has(k)).map((k) => `${family.name}: ${k}`));
      return gaps.length ? `position kinds missing: ${gaps.join('; ')}` : null;
    },
    source: '',
    refs: [],
    failures: [],
  });
  return fixtures;
})();
COORDINATOR_FIXTURES.push(...POSITION_FIXTURES);

// Derived position property: instead of hand-picked positions, every (node type, field) pair is
// taken from acorn's own parse of DERIVED_CORPUS, a script valid in strict mode that holds every
// node type acorn 8.18 builds for a strict script under the gate's parse options. For each pair and
// each payload family above, the generator replaces one instance of that field in the corpus with
// the family's payload, as (P), as P (a string literal payload only), or as the statement void
// (P);, and keeps the first replacement that V8 compiles as a strict script and that acorn parses
// with the payload as exactly that field of the same parent node. The expected refs and failures
// are the family's, as for the position property. A pair with no such replacement for a family is
// excluded for it, and DERIVED_EXCLUSIONS gives, for each excluded field, the reason a payload
// cannot sit there. Each pair whose field holds an expression (the probe (z0) sits there) and that
// holds the first family's payload also has a fixture whose field holds a node of each expression
// type in the corpus that has a shape (see below), with the payload inside, and DERIVED_UNSHAPED
// gives the reason for each expression type without one. The last fixture asserts all of this, and
// that every node type named in acorn's source appears in the corpus or in DERIVED_ABSENT_TYPES.
// MUTATION GUARD: the visitor skipping any one (node type, field) pair that holds a fixture, or
// skipping one of those pairs whose field holds an expression only when the field holds a node of
// one shape's type, turns derived position fixtures RED
const DERIVED_CORPUS = [
  'let z0 = 0, z1 = [0], z2 = { k: 0, [z0]: 0, m() { return 0; }, get g() { return 0; }, set s(v) { z0 = v; }, ...z1 };',
  'const z3 = function* z3n(z4 = 0, ...z5) { yield 0; yield* z1; };',
  'const z6 = async (z7) => { await z7; };',
  'const z8 = (z9) => z9;',
  'function z10({ z11 = 0, ...z12 }, [z13 = 0, ...z14]) { if (z0) z0; else if (z0) {} else { z0; } return z0; }',
  'class Z15 extends Object { static z16 = 0; z17 = 0; #z18 = 0; [z0] = 0; static { z0 = 0; } constructor() { super(0); void new.target; } z19() { return this.#z18 % (#z18 in this); } get z20() { return 0; } set z20(v) {} static [z0]() {} }',
  'const z21 = class Z21n extends Object {};',
  'z0 = (z0 % 0) * (z0 - 0) || (z0 && 0); z0 = z0 ?? 0; z0 += 0; z0++; --z0; z0 = -z0; z0 = !z0; z0 = typeof z0;',
  "z0 = '' + '';",
  'z0 = z0 ? 0 : 1; z0 = (0, z0); z0 = [0, ...z1]; z0 = z2.k; z0 = z2[z0]; z0 = z2?.k; z0 = z8?.(0); z0 = z8(0); z0 = new Z15(0);',
  'z0 = `a${z0}b`; z0 = z8`a${z0}b`; ({ k: z0 } = z2); [z0] = z1; void import(z0); void import(z0, z0);',
  'switch (z0) { case 0: z0; break; default: z0; }',
  'for (let z22 = 0; z22 < 1; z22++) { continue; } for (z0 = 0; z0 < 1; z0++) z0; for (const z23 in z2) z0; for (const z24 of z1) z0; for (z0 of z1) z0;',
  'while (z0) z0; do z0; while (z0);',
  'try { z0; } catch (z25) { z0; } finally { z0; } try { z0; } catch { z0; }',
  'z26: { break z26; } z27: for (;;) { continue z27; }',
  'function z28() { throw z0; }',
  '; debugger;',
].join(' ');
// Names in acorn's source that the type pattern below matches but that acorn never builds for a
// strict script under the gate's parse options, so they are not in the corpus.
const DERIVED_ABSENT_TYPES = {
  ImportDeclaration: 'module syntax; the coordinator source and a Dataview block are scripts',
  ImportSpecifier: 'module syntax',
  ImportDefaultSpecifier: 'module syntax',
  ImportNamespaceSpecifier: 'module syntax',
  ImportAttribute: 'module syntax',
  ExportAllDeclaration: 'module syntax',
  ExportDefaultDeclaration: 'module syntax',
  ExportNamedDeclaration: 'module syntax',
  ExportSpecifier: 'module syntax',
  ParenthesizedExpression: 'built only with the preserveParens option, which the gate does not set',
  WithStatement: 'strict code rejects with',
  Block: 'the kind acorn passes to onComment for a block comment, not a node type',
};
// For each field the generator finds excluded for some family, the reason a payload cannot sit
// there.
const DERIVED_EXCLUSIONS = {
  'ArrayPattern.elements': 'holds patterns, of which only the bare helper name is a payload',
  'ArrowFunctionExpression.params': 'holds patterns',
  'AssignmentExpression.left': 'holds an assignment target, of which only the bare helper name is a payload',
  'AssignmentPattern.left': 'holds a pattern',
  'BreakStatement.label': 'holds a label name',
  'CatchClause.body': 'holds a block',
  'CatchClause.param': 'holds a binding pattern',
  'ChainExpression.expression': 'holds only an optional chain, which a payload in its place replaces',
  'ClassBody.body': 'holds class members',
  'ClassDeclaration.body': 'holds a class body',
  'ClassDeclaration.id': 'holds a binding name',
  'ClassExpression.body': 'holds a class body',
  'ClassExpression.id': 'holds a binding name',
  'ContinueStatement.label': 'holds a label name',
  'ForInStatement.left': 'holds a declaration or assignment target, of which only the bare helper name is a payload',
  'ForOfStatement.left': 'holds a declaration or assignment target, of which only the bare helper name is a payload',
  'FunctionDeclaration.body': 'holds a block',
  'FunctionDeclaration.id': 'holds a binding name',
  'FunctionDeclaration.params': 'holds patterns',
  'FunctionExpression.body': 'holds a block',
  'FunctionExpression.id': 'holds a binding name',
  'FunctionExpression.params': 'holds patterns',
  'LabeledStatement.label': 'holds a label name',
  'MetaProperty.meta': 'holds the word new',
  'MetaProperty.property': 'holds the word target',
  'MethodDefinition.value': 'holds the method function',
  'ObjectExpression.properties': 'holds properties',
  'ObjectPattern.properties': 'holds pattern properties',
  'Program.body': 'for the rebinding family the corpus sits inside the helper, where its top-level statements are BlockStatement.body',
  'RestElement.argument': 'holds a pattern',
  'SwitchStatement.cases': 'holds switch cases',
  'TaggedTemplateExpression.quasi': 'holds a template, which a template payload in its place would make tagged',
  'TemplateLiteral.quasis': 'holds template text',
  'TryStatement.block': 'holds a block',
  'TryStatement.finalizer': 'holds a block',
  'TryStatement.handler': 'holds a catch clause',
  'UpdateExpression.argument': 'holds an assignment target, of which only the bare helper name is a payload',
  'VariableDeclaration.declarations': 'holds declarators',
  'VariableDeclarator.id': 'holds a binding pattern',
};
// Expression node types in the corpus that no shape below has, with the reason.
const DERIVED_UNSHAPED = {
  AwaitExpression: 'parses only inside an async function',
  YieldExpression: 'parses only inside a generator function',
  UpdateExpression: 'its argument holds an assignment target',
  ThisExpression: 'has no field',
  Identifier: 'has no field that holds a node',
  Literal: 'has no field that holds a node',
  MetaProperty: 'its fields hold the words new and target',
};
const DERIVED_FIXTURES = (() => {
  const parseOptions = { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true };
  const children = (node) => {
    const out = [];
    for (const key in node) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child, index) => { if (child && typeof child.type === 'string') out.push([key, index, child]); });
      else if (value && typeof value.type === 'string') out.push([key, -1, value]);
    }
    return out;
  };
  const instances = new Map();
  const typesSeen = new Set();
  (function walk(node, ancestors) {
    typesSeen.add(node.type);
    for (const [key, index, child] of children(node)) {
      const pair = `${node.type}.${key}`;
      if (!instances.has(pair)) instances.set(pair, []);
      instances.get(pair).push({ type: node.type, start: node.start, end: node.end, key, index, childStart: child.start, childEnd: child.end, ancestors: [node, ...ancestors] });
      walk(child, [node, ...ancestors]);
    }
  })(acorn.parse(DERIVED_CORPUS, parseOptions), []);
  const acornSource = fs.readFileSync(require.resolve('acorn'), 'utf8');
  const acornTypes = new Set([...acornSource.matchAll(/"((?:[A-Z][A-Za-z]*)?(?:Expression|Statement|Declaration|Declarator|Pattern|Element|Literal|Clause|Case|Block|Body|Definition|Identifier|Property|Specifier|Attribute|Program|Super))"/g)].map((m) => m[1]));
  const defs = collectClassNames(REF_SCAN_DIRS);
  const families = POSITION_FAMILIES.map((family) => ({ family, expected: positionExpected(family, defs) }));
  const unparen = (text) => { let t = text.trim(); while (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim(); return t; };
  // A wrapper places a payload P as (P), as P (only for a string literal payload), or as void (P);.
  const WRAPPERS = [['paren', (p) => `(${p})`], ['bare', (p) => p], ['statement', (p) => `void (${p});`]];
  // Whether the payload, wrapped, sits exactly in the field of the same parent: the parent is found by
  // type and shifted range, and the field holds a node of the payload's own type spanning the
  // payload's text (for a statement, an expression statement of void and that node).
  const lands = (source, corpusStart, at, wrapped, payload) => {
    let ast;
    try { ast = acorn.parse(source, parseOptions); } catch (e) { return e.message.replace(/ \(\d+:\d+\)$/, ''); }
    const delta = wrapped.length - (at.childEnd - at.childStart);
    let holder = null;
    const start = corpusStart + at.start;
    const end = corpusStart + at.end + delta;
    (function find(node) {
      if (holder || node.start > start || node.end < end) return;
      if (node.type === at.type && node.start === start && node.end === end) { holder = node; return; }
      for (const [, , child] of children(node)) find(child);
    })(ast);
    // The corpus's Program is the whole source's Program, whose body also holds the earlier lines.
    if (at.type === 'Program') holder = ast;
    let held = holder && (at.type === 'Program'
      ? ast.body.find((n) => n.start >= corpusStart + at.childStart && n.end <= corpusStart + at.childStart + wrapped.length)
      : at.index < 0 ? holder[at.key] : holder[at.key][at.index]);
    if (held && wrapped.startsWith('void ')) held = held.type === 'ExpressionStatement' && held.expression.type === 'UnaryExpression' ? held.expression.argument : null;
    const want = acorn.parseExpressionAt(payload, 0, { ecmaVersion: 'latest' });
    return held && held.type === want.type && unparen(source.slice(held.start, held.end)) === unparen(payload)
      ? null : 'the payload does not sit in this field';
  };
  // Which wrappers fit each instance, probed with the identifier z0 and the string literal 's'.
  const fits = new Map();
  for (const [pair, list] of instances) {
    fits.set(pair, list.map((at) => Object.fromEntries(WRAPPERS.map(([name, wrap]) => {
      const probe = name === 'bare' ? "'s'" : 'z0';
      const corpus = DERIVED_CORPUS.slice(0, at.childStart) + wrap(probe) + DERIVED_CORPUS.slice(at.childEnd);
      return [name, lands(corpus, 0, at, wrap(probe), probe)];
    }))));
  }
  const fixtures = [];
  const covered = new Set();
  const excluded = new Map();
  const pairs = [...instances.keys()].sort();
  pairs.forEach((pair, pairIndex) => {
    const list = instances.get(pair);
    families.forEach(({ family, expected }, familyIndex) => {
      let firstError = null;
      const variants = family.alias ? POSITION_ALIASES.length : family.rebinding ? POSITION_REBINDS.length : 1;
      for (let v = 0; v < variants && !covered.has(`${pair}|${familyIndex}`); v++) {
        const alias = POSITION_ALIASES[(pairIndex + v) % POSITION_ALIASES.length];
        const rebind = POSITION_REBINDS[(pairIndex + v) % POSITION_REBINDS.length];
        const payload = family.alias ? alias : family.rebinding ? rebind : family.expr;
        const literal = /^['"]/.test(payload) && acorn.parseExpressionAt(payload, 0, { ecmaVersion: 'latest' }).type === 'Literal';
        for (let k = 0; k < list.length && !covered.has(`${pair}|${familyIndex}`); k++) {
          const index = (familyIndex + k) % list.length;
          const at = list[index];
          for (const [name, wrap] of WRAPPERS) {
            if (name === 'bare' && !literal) continue;
            if (fits.get(pair)[index][name]) { firstError = firstError || fits.get(pair)[index][name]; continue; }
            const wrapped = wrap(payload);
            const corpus = DERIVED_CORPUS.slice(0, at.childStart) + wrapped + DERIVED_CORPUS.slice(at.childEnd);
            const lead = family.rebinding ? 'function block(widget) { ' : '';
            const second = family.rebinding
              ? `${lead}${corpus} return 'await dv.view("ranch/views/customjs-guard", { class: "' + widget + '" });'; }` : family.second || '';
            const third = family.rebinding ? "block('OperatorStation');" : corpus;
            const source = `${POSITION_PRELUDE}\n${second}\n${third}`;
            const corpusStart = POSITION_PRELUDE.length + 1 + (family.rebinding ? lead.length : second.length + 1);
            const problem = lands(source, corpusStart, at, wrapped, payload) || positionCompiles(source);
            if (problem) { firstError = firstError || problem; continue; }
            let { refs, failures } = expected || {};
            if (family.alias) {
              refs = ['OperatorStation'];
              failures = alias === '({ block })' ? [unreadable(3, BLOCK_ARG), unreadable(3, BLOCK_ARG)] : [unreadable(3, BLOCK_ARG)];
            } else if (family.rebinding) {
              refs = [];
              failures = [unreadable(2, MAY_NOT_HOLD('block'))];
            }
            fixtures.push({ label: `derived position property: ${family.name} as ${pair}${family.alias ? ` (${alias})` : family.rebinding ? ` (${rebind})` : ''}`, source, refs, failures });
            covered.add(`${pair}|${familyIndex}`);
            break;
          }
        }
      }
      if (!covered.has(`${pair}|${familyIndex}`)) excluded.set(`${pair}|${familyIndex}`, firstError);
    });
  });
  // Child types: a shape is the text of the nearest node above a field that parses alone as an
  // expression of its own type, from the corpus, with the field replaced by (P); there is one
  // shape per node type. Each shape, holding the first family's payload, is then placed as (S)
  // in each pair whose field holds an expression, so the field holds a node of every such type.
  const first = families[0];
  const shapes = new Map();
  for (const pair of pairs) {
    instances.get(pair).forEach((at, index) => {
      if (fits.get(pair)[index].paren) return;
      for (const above of at.ancestors) {
        const text = `${DERIVED_CORPUS.slice(above.start, at.childStart)}(${first.family.expr})${DERIVED_CORPUS.slice(at.childEnd, above.end)}`;
        let node = null;
        try { node = acorn.parseExpressionAt(text, 0, { ecmaVersion: 'latest' }); } catch (_e) { continue; }
        if (node.type === above.type && node.end === text.length) {
          if (!shapes.has(above.type)) shapes.set(above.type, text);
          return;
        }
      }
    });
  }
  const expressionFields = pairs.filter((pair) => covered.has(`${pair}|0`) && fits.get(pair).some((fit) => !fit.paren));
  const shaped = new Set();
  for (const pair of expressionFields) {
    const list = instances.get(pair);
    for (const [type, shape] of shapes) {
      for (let k = 0; k < list.length && !shaped.has(`${pair}|${type}`); k++) {
        const at = list[k];
        if (fits.get(pair)[k].paren) continue;
        const wrapped = `(${shape})`;
        const corpus = DERIVED_CORPUS.slice(0, at.childStart) + wrapped + DERIVED_CORPUS.slice(at.childEnd);
        const source = `${POSITION_PRELUDE}\n\n${corpus}`;
        if (lands(source, POSITION_PRELUDE.length + 2, at, wrapped, shape) || positionCompiles(source)) continue;
        fixtures.push({ label: `derived position property: ${first.family.name} in a ${type} as ${pair}`, source, ...first.expected });
        shaped.add(`${pair}|${type}`);
      }
    }
  }
  fixtures.push({
    label: `derived position property: each of the ${pairs.length} (node type, field) pairs in the corpus has a fixture for each of the ${families.length} families or is excluded with a listed reason, each of the ${expressionFields.length} pairs whose field holds an expression and that have a fixture for the first family has one whose field holds each of the ${shapes.size} shapes, each expression type in the corpus has a shape or a listed reason, and each node type acorn names is in the corpus or listed as absent`,
    precondition: () => {
      const unlisted = [...excluded].filter(([key]) => !DERIVED_EXCLUSIONS[key.split('|')[0]])
        .map(([key, error]) => `${key.split('|')[0]} is excluded for ${families[key.split('|')[1]].family.name} without a listed reason (${error})`);
      const unusedReasons = Object.keys(DERIVED_EXCLUSIONS).filter((pair) => !instances.has(pair) || families.every((_f, i) => covered.has(`${pair}|${i}`)));
      const missingTypes = [...acornTypes].filter((type) => !typesSeen.has(type) && !DERIVED_ABSENT_TYPES[type]);
      const shapeless = [...typesSeen].filter((type) => /Expression$|Literal$|^Identifier$|^MetaProperty$/.test(type))
        .filter((type) => shapes.has(type) === Boolean(DERIVED_UNSHAPED[type]))
        .map((type) => (shapes.has(type) ? `${type} has a shape but is listed as unshaped` : `${type} has no shape and no listed reason`));
      const unshaped = expressionFields.flatMap((pair) => [...shapes.keys()].filter((type) => !shaped.has(`${pair}|${type}`)).map((type) => `${pair} has no fixture holding a ${type}`));
      const problems = [
        ...unlisted,
        ...unusedReasons.map((pair) => `${pair} has a listed exclusion but is not in the corpus or has a fixture for every family`),
        ...missingTypes.map((type) => `${type} is named in acorn but neither in the corpus nor listed as absent`),
        ...shapeless,
        ...unshaped,
      ];
      return problems.length ? problems.join('; ') : null;
    },
    source: '',
    refs: [],
    failures: [],
  });
  return fixtures;
})();
COORDINATOR_FIXTURES.push(...DERIVED_FIXTURES);

COORDINATOR_FIXTURES.push(
  // MUTATION GUARD: letting collectClassNames also add the class a definition extends turns RED
  {
    label: 'Plugin, which a class in a .js file under platform/blueprints or platform/mechanisms extends and none of those files defines, fails with that name',
    precondition: () => {
      const files = REF_SCAN_DIRS.flatMap((d) => walk(d, [])).map((f) => fs.readFileSync(f, 'utf8'));
      if (!files.some((t) => /(?:^|\n)\s*class\s+[A-Za-z0-9_]+\s+extends\s+Plugin\b/.test(t))) return 'no .js file under platform/blueprints or platform/mechanisms has a class that extends Plugin';
      return collectClassNames(REF_SCAN_DIRS).has('Plugin') ? 'a .js file under platform/blueprints or platform/mechanisms defines Plugin' : null;
    },
    source: String.raw`const s = 'await dv.view("ranch/views/customjs-guard", { class: "Plugin" });';`,
    refs: ['Plugin'],
    failures: [missing('Plugin', 1)],
  },
);

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
