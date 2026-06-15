#!/usr/bin/env node
// scripts/scaffold-behavioral-harness.js — v0.112.0
//
// Generates `platform/test/run-<cycle-id>-<topic-slug>.js` from the canonical
// v0.110.3 / v0.111.3-CF1 zero-dep behavioral-harness template (DOM stub +
// Dataview-proxy stub + verdict block + section markers).
//
// Usage:
//   node scripts/scaffold-behavioral-harness.js v01200 workshop-tooling
//   → wrote platform/test/run-v01200-workshop-tooling.js (~280 lines)
//
// Flags:
//   --force    overwrite existing target (default: refuse)
//   --dry-run  print to stdout instead of writing
//   --help     usage
//
// After scaffold: manually wire into `package.json`'s `release:preflight`
// chain (one Edit tool call) so CI fires the new harness. The script
// intentionally does NOT auto-edit `package.json` to avoid corrupting
// the long single-line script field.

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "..");
const TEST_DIR = path.join(WORKSHOP, "platform/test");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY_RUN = args.includes("--dry-run");
const HELP = args.includes("--help") || args.includes("-h");

function usage() {
  process.stdout.write(`scaffold-behavioral-harness — generate a per-cycle behavioral test harness.

Usage:
  node scripts/scaffold-behavioral-harness.js <cycle-id> <topic-slug> [flags]

  <cycle-id>    Pattern: v\\d+   e.g. v01200 / v01200-CF1
  <topic-slug>  Pattern: [a-z][a-z0-9-]*   e.g. workshop-tooling / finance-overhaul

Flags:
  --force       overwrite an existing target file
  --dry-run     print to stdout instead of writing the file
  --help, -h    show this message

After scaffold, wire into package.json release:preflight script chain.
`);
}

if (HELP || args.length < 2) { usage(); process.exit(args.length < 2 && !HELP ? 2 : 0); }

const positional = args.filter(a => !a.startsWith("--") && a !== "-h");
const [cycleId, topicSlug] = positional;

if (!/^v\d+(?:-CF\d+)?$/.test(cycleId)) {
  process.stderr.write(`error: cycle-id must match /^v\\d+(?:-CF\\d+)?$/   (got: ${cycleId})\n`);
  process.exit(2);
}
if (!/^[a-z][a-z0-9-]*$/.test(topicSlug)) {
  process.stderr.write(`error: topic-slug must match /^[a-z][a-z0-9-]*$/   (got: ${topicSlug})\n`);
  process.exit(2);
}

const fileName = `run-${cycleId}-${topicSlug}.js`;
const target = path.join(TEST_DIR, fileName);
const exists = fs.existsSync(target);
if (exists && !FORCE && !DRY_RUN) {
  process.stderr.write(`error: ${target} already exists. Pass --force to overwrite or --dry-run to preview.\n`);
  process.exit(3);
}

const today = process.env.SAUCE_SCAFFOLD_DATE || "YYYY-MM-DD";

// ---------------------------------------------------------------------------
// Template — distilled from platform/test/run-v01103-monthly-overview.js.
// Kept intentionally identical in structure so future cycles get the canonical
// shape without copy-paste drift.
// ---------------------------------------------------------------------------

const template = `// ${fileName} — ${cycleId} behavioral test harness (scaffolded ${today}).
//
// Coverage map:
//   Section 1 — <topic> behavioral cases     → MAIN-1..N
//   Section 2 — <topic> contract / migration → CONTRACT-1..M
//
// Pattern matches run-v01103-monthly-overview.js (zero-dep; inline DOM stub;
// Dataview-proxy stub; verdict footer). Wire into release:preflight in
// package.json after this file is populated with cases.

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const FIN_HELPERS = path.join(WORKSHOP, "platform/blueprints/finance/helpers");
// Adjust the helper dir to match the surface this cycle exercises:
//   const PROJ_HELPERS = path.join(WORKSHOP, "platform/blueprints/project/helpers");
//   const MECH_HELPERS = path.join(WORKSHOP, "platform/mechanisms/<name>");

let passed = 0;
let failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(\`  ok \${name}\`);
  } else {
    failed += 1;
    const msg = \`\${name}\${detail ? " — " + detail : ""}\`;
    failures.push(msg);
    console.log(\`  FAIL \${msg}\`);
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, \`expected \${JSON.stringify(expected)}, got \${JSON.stringify(actual)}\`);
}
function approxEq(name, actual, expected, eps = 0.005) {
  ok(name, Math.abs(actual - expected) < eps, \`expected ~\${expected}, got \${actual}\`);
}

// ---------------------------------------------------------------------------
// DOM stub — Obsidian-style createEl chain. Only what helpers actually call.
// ---------------------------------------------------------------------------

function makeEl(tagName) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    style: { cssText: "" },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); },
    children: [],
    parentElement: null,
    attrs: {},
    createEl(tag, opts = {}) {
      const child = makeEl(tag);
      if (opts.text != null) child.textContent = String(opts.text);
      if (opts.cls != null) child.attrs.cls = opts.cls;
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    closest(sel) {
      let node = this;
      const want = String(sel).replace(/^\\./, "");
      while (node) {
        if (node.attrs && node.attrs.cls === want) return node;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      const want = String(sel).replace(/^:scope\\s*>\\s*\\./, "").replace(/^\\./, "");
      for (const c of this.children) {
        if (c.attrs && c.attrs.cls === want) return c;
      }
      return null;
    },
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx >= 0) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
    },
  };
  return el;
}

function walkTree(el, predicate) {
  if (!el) return null;
  if (predicate(el)) return el;
  for (const c of (el.children || [])) {
    const hit = walkTree(c, predicate);
    if (hit) return hit;
  }
  return null;
}

function collectText(el) {
  let out = el._textContent || "";
  for (const c of (el.children || [])) out += "\\n" + collectText(c);
  return out;
}

// ---------------------------------------------------------------------------
// Dataview proxy stubs — both loose (Array-backed) and strict (only the
// documented DataArray surface). Strict is preferred for regression nets;
// loose is convenient for happy-path math tests.
// ---------------------------------------------------------------------------

function makeDA(items) {
  const arr = (items || []).slice();
  arr.where = (fn) => makeDA(arr.filter(fn));
  return arr;
}

function makeStrictDA(items) {
  const inner = (items || []).slice();
  return {
    _kind: "DataArray",
    get length() { return inner.length; },
    where(fn) {
      const out = [];
      for (const x of inner) { if (fn(x)) out.push(x); }
      return makeStrictDA(out);
    },
    sort(keyFn, dir) {
      const copy = inner.slice().sort((a, b) => {
        const ka = typeof keyFn === "function" ? keyFn(a) : a;
        const kb = typeof keyFn === "function" ? keyFn(b) : b;
        if (ka == null && kb == null) return 0;
        if (ka == null) return 1;
        if (kb == null) return -1;
        if (ka < kb) return dir === "desc" ? 1 : -1;
        if (ka > kb) return dir === "desc" ? -1 : 1;
        return 0;
      });
      return makeStrictDA(copy);
    },
    limit(n) { return makeStrictDA(inner.slice(0, n)); },
    first() { return inner[0]; },
    array() { return inner.slice(); },
    [Symbol.iterator]() {
      let i = 0;
      return { next: () => i < inner.length ? { value: inner[i++], done: false } : { value: undefined, done: true } };
    },
  };
}

function makeDv(opts = {}) {
  const container = makeEl("div");
  const pagesByScope = opts.pagesByScope || {};
  return {
    container,
    current: () => (opts.current !== undefined ? opts.current : null),
    pages: (q) => {
      const scope = String(q || "").replace(/"/g, "");
      const pages = pagesByScope[scope] || [];
      return makeDA(pages);
    },
  };
}

function makeStrictDv(opts = {}) {
  const container = makeEl("div");
  const pagesByScope = opts.pagesByScope || {};
  return {
    container,
    current: () => (opts.current !== undefined ? opts.current : null),
    pages: (q) => {
      const scope = String(q || "").replace(/"/g, "");
      const pages = pagesByScope[scope] || [];
      return makeStrictDA(pages);
    },
  };
}

// ---------------------------------------------------------------------------
// Helper loader — wraps a class declaration file so we can extract the class
// from a non-module-scoped \`class\` declaration.
// ---------------------------------------------------------------------------

function loadClass(filename, className, helperDir) {
  const dir = helperDir || FIN_HELPERS;
  const src = fs.readFileSync(path.join(dir, filename), "utf8");
  const wrapper = \`\${src}\\n; return \${className};\`;
  return new Function(wrapper)();
}

// ===========================================================================
// SECTION 1 — TODO: <topic> behavioral cases (MAIN-1..N)
// ===========================================================================

console.log("\\n=== Section 1 — <topic> behavioral ===");

// (async function MAIN_1() {
//   console.log("\\n--- Case MAIN-1: <what this proves> ---");
//   const Klass = loadClass("<helper>.js", "<ClassName>");
//   const instance = new Klass();
//   const dv = makeDv({
//     current: { /* fake page */ },
//     pagesByScope: { /* "scope/path": [pages...] */ },
//   });
//   await instance.render(dv);
//   const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "<css-root>");
//   ok("MAIN-1.1 root rendered", !!root);
// })();

// ===========================================================================
// SECTION 2 — TODO: <topic> contract / migration coverage (CONTRACT-1..M)
// ===========================================================================

console.log("\\n=== Section 2 — <topic> contract / migration ===");

// (function CONTRACT_1() {
//   console.log("\\n--- Case CONTRACT-1: <migration / regex contract> ---");
//   const installer = require(path.join(WORKSHOP, "platform/install.js"));
//   const transform = installer._myTransform;
//   ok("CONTRACT-1.pre exported", typeof transform === "function");
//   const sample = "...body fixture...";
//   const r = transform(sample);
//   ok("CONTRACT-1.1 transform touched", r.touched === true);
//   ok("CONTRACT-1.2 idempotent on second pass",
//      transform(r.body).touched === false);
// })();

// ===========================================================================
// Verdict
// ===========================================================================

setTimeout(() => {
  console.log(\`\\n=== ${fileName.replace(".js", "")} verdict ===\`);
  console.log(\`passed: \${passed}\`);
  console.log(\`failed: \${failed}\`);
  if (failed > 0) {
    console.log("failures:");
    for (const f of failures) console.log(\`  - \${f}\`);
    process.exit(1);
  }
  process.exit(0);
}, 100);
`;

if (DRY_RUN) {
  process.stdout.write(template);
  process.exit(0);
}

fs.writeFileSync(target, template);
const lc = template.split("\n").length;
process.stdout.write(`scaffold-behavioral-harness: wrote ${path.relative(WORKSHOP, target)} (${lc} lines)\n`);
process.stdout.write(`   next: wire into package.json release:preflight, then populate Sections 1 + 2.\n`);
process.exit(0);
