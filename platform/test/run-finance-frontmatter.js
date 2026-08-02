#!/usr/bin/env node
// run-finance-frontmatter.js — behavioral coverage for the FinanceFrontmatter
// helper (finance blueprint). Autoloop coverage item
// cov-blueprint-finance-customjs-behavioral: FinanceFrontmatter.read +
// FinanceFrontmatter.isTruthy were the only genuinely unit-testable uncovered
// methods on the finance customjs_behavioral axis (the rest are dogfood-only
// render() widgets). This pins the real branching logic:
//   FinanceFrontmatter.isTruthy — boolean coercion (true | "true" | "TRUE" only).
//   FinanceFrontmatter.read     — path/TFile resolution, file-validity guard
//                                 (folders rejected via children !== undefined),
//                                 metadataCache frontmatter snapshot, null cases.
//   FinanceFrontmatter.update   — same resolution + guard, delegates to
//                                 processFrontMatter (throws on non-file).
// The methods are instance methods (customJS stores an instance); we exercise
// them through an instance while a swappable global `app` stub feeds vault +
// metadataCache. Zero-dep. "PASS N/N" exit 0, "FAIL X/N" exit 1.

"use strict";

const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "blueprints", "finance", "helpers", "finance-frontmatter.js");
const src = fs.existsSync(SRC) ? fs.readFileSync(SRC, "utf8") : "";
const FinanceFrontmatter = src ? new Function(`${src}\nreturn FinanceFrontmatter;`)() : null;

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; const m = `${label}${detail ? " — " + detail : ""}`; failures.push(m); console.log(`  FAIL  ${m}`); }
}

// Build a minimal `app` stub. `files` maps path -> { frontmatter } (a file);
// `folders` is a set of directory paths (getAbstractFileByPath returns an object
// with `children` so the helper's `children !== undefined` folder-guard trips).
function installApp({ files = {}, folders = [] } = {}) {
  const processed = [];
  global.app = {
    vault: {
      getAbstractFileByPath(p) {
        if (Object.prototype.hasOwnProperty.call(files, p)) return { path: p };
        if (folders.includes(p)) return { path: p, children: [] };
        return null;
      },
    },
    metadataCache: {
      getFileCache(file) {
        const rec = file && files[file.path];
        if (!rec) return null;
        return rec.frontmatter !== undefined ? { frontmatter: rec.frontmatter } : {};
      },
    },
    fileManager: {
      async processFrontMatter(file, mutator) {
        const rec = files[file.path] || (files[file.path] = { frontmatter: {} });
        rec.frontmatter = rec.frontmatter || {};
        await mutator(rec.frontmatter);
        processed.push(file.path);
      },
    },
  };
  return { processed };
}

async function run() {
  ok("FF-0 FinanceFrontmatter class loads", typeof FinanceFrontmatter === "function");
  const ff = FinanceFrontmatter ? new FinanceFrontmatter() : null;

  // ── FinanceFrontmatter.isTruthy — pure boolean coercion ────────────────────
  ok("FF-1 isTruthy(true) === true", ff && ff.isTruthy(true) === true);
  ok("FF-2 isTruthy('true') === true", ff && ff.isTruthy("true") === true);
  ok("FF-3 isTruthy('TRUE') === true (case-insensitive)", ff && ff.isTruthy("TRUE") === true && ff.isTruthy("True") === true);
  ok("FF-4 isTruthy(false) === false", ff && ff.isTruthy(false) === false);
  ok("FF-5 isTruthy('false') === false", ff && ff.isTruthy("false") === false);
  ok("FF-6 isTruthy non-true values === false",
    ff && ff.isTruthy("yes") === false && ff.isTruthy(1) === false && ff.isTruthy(null) === false && ff.isTruthy(undefined) === false && ff.isTruthy({}) === false);

  // ── FinanceFrontmatter.read — resolution + guards + metadataCache ──────────
  {
    installApp({ files: { "spice/finance/Budget.md": { frontmatter: { type: "budget", month: "2026-07" } } } });
    const got = ff && ff.read("spice/finance/Budget.md");
    ok("FF-7 read(path) returns the frontmatter snapshot", got && got.type === "budget" && got.month === "2026-07");
  }
  {
    installApp({ files: { "spice/finance/Budget.md": { frontmatter: { type: "budget" } } } });
    const tfile = { path: "spice/finance/Budget.md" };
    const got = ff && ff.read(tfile);
    ok("FF-8 read(TFile) resolves without vault lookup", got && got.type === "budget");
  }
  {
    installApp({ files: {} });
    ok("FF-9 read(missing path) === null", ff && ff.read("spice/finance/Nope.md") === null);
  }
  {
    installApp({ folders: ["spice/finance"] });
    ok("FF-10 read(folder) === null (children-guard rejects directories)", ff && ff.read("spice/finance") === null);
  }
  {
    installApp({ files: { "spice/finance/Bare.md": {} } });   // file exists, no frontmatter
    ok("FF-11 read(file w/o frontmatter) === null", ff && ff.read("spice/finance/Bare.md") === null);
  }

  // ── FinanceFrontmatter.update — resolution + guard + processFrontMatter ─────
  {
    const { processed } = installApp({ files: { "spice/finance/Budget.md": { frontmatter: { n: 1 } } } });
    await ff.update("spice/finance/Budget.md", (fm) => { fm.n = 2; fm.added = true; });
    ok("FF-12 update(path) mutates via processFrontMatter",
      processed.includes("spice/finance/Budget.md") && global.app.metadataCache.getFileCache({ path: "spice/finance/Budget.md" }).frontmatter.n === 2);
  }
  {
    const file = { path: "spice/finance/Budget.md", stat: { mtime: 10 } };
    const persisted = { categories: [{ name: "A" }] };
    const staleCache = { categories: [{ name: "A" }] };
    global.app = {
      vault: { getAbstractFileByPath: () => file },
      metadataCache: { getFileCache: () => ({ frontmatter: staleCache }) },
      fileManager: { async processFrontMatter(_file, mutator) { await mutator(persisted); } },
    };
    await ff.update(file, (fm) => { fm.categories.push({ name: "B" }); });
    const secondPreview = ff.read(file);
    secondPreview.categories.push({ name: "C" });
    const stillAuthoritative = ff.read(file);
    await ff.update(file, (fm) => { fm.categories.push({ name: "C" }); });
    const thirdPreview = ff.read(file);
    ok("FF-12A completed writes shadow a stale metadata cache for sequential gestures",
      secondPreview.categories.map((row) => row.name).join(",") === "A,B,C"
        && stillAuthoritative.categories.map((row) => row.name).join(",") === "A,B"
        && persisted.categories.map((row) => row.name).join(",") === "A,B,C"
        && thirdPreview.categories.map((row) => row.name).join(",") === "A,B,C");
  }
  {
    installApp({ files: {} });
    let threw = false;
    try { await ff.update("spice/finance/Nope.md", () => {}); } catch (_e) { threw = true; }
    ok("FF-13 update(missing path) throws", threw);
  }
  {
    installApp({ folders: ["spice/finance"] });
    let threw = false;
    try { await ff.update("spice/finance", () => {}); } catch (_e) { threw = true; }
    ok("FF-14 update(folder) throws (children-guard)", threw);
  }

  // ── Finance editor structural lifecycle ──────────────────────────────────
  const makeNode = (name) => {
    const node = {
      name, parentNode: null, nextSibling: null, dataset: {}, children: [], focused: 0,
      focus() { this.focused++; global.document.activeElement = this; },
      setSelectionRange(start, end, direction) { this.selection = { start, end, direction }; },
      contains(target) { return target === this || this.children.includes(target); },
      querySelector(selector) {
        const match = selector.match(/data-finance-focus-key="([^"]+)"/);
        return match ? this.children.find((child) => child.dataset.financeFocusKey === match[1]) || null : null;
      },
      remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      },
    };
    return node;
  };
  const makeEditorDom = () => {
    const container = {
      children: [],
      querySelector: () => container.children.find((child) => child.name === "editor") || null,
      appendChild(node) { node.parentNode = container; container.children.push(node); return node; },
      insertBefore(node, sibling) {
        node.parentNode = container;
        const index = sibling ? container.children.indexOf(sibling) : -1;
        if (index < 0) container.children.push(node); else container.children.splice(index, 0, node);
        return node;
      },
    };
    const oldRoot = makeNode("editor");
    const oldInput = makeNode("old-input");
    oldInput.dataset.financeFocusKey = "rate";
    oldInput.selectionStart = 2;
    oldInput.selectionEnd = 4;
    oldInput.selectionDirection = "forward";
    oldInput.parentNode = oldRoot;
    oldRoot.children.push(oldInput);
    const tail = makeNode("tail");
    oldRoot.nextSibling = tail;
    container.appendChild(oldRoot);
    container.appendChild(tail);
    return { container, oldRoot, oldInput, tail };
  };
  const installLifecycle = () => {
    global.customJS = {
      RenderSafe: {
        async mutateStructure(opts) {
          let receipt;
          try {
            receipt = await opts.apply();
            return { ok: true, value: await opts.write() };
          } catch (error) {
            if (typeof opts.rollback === "function") await opts.rollback(receipt, error);
            return { ok: false, error };
          }
        },
      },
    };
    global.Notice = function () {};
  };

  {
    installLifecycle();
    const { container, oldRoot, oldInput, tail } = makeEditorDom();
    global.document = { activeElement: oldInput };
    let optimisticRoot, optimisticInput, sawOptimisticBeforeWrite = false;
    const rejected = new Error("fixture persistence rejected");
    const result = await ff.mutateRendered({ path: "spice/finance/Budget.md" }, {
      dv: { container }, selector: ".editor", failureMessage: "fixture",
      render: async () => {
        oldRoot.remove();
        optimisticRoot = makeNode("editor");
        optimisticInput = makeNode("optimistic-input");
        optimisticInput.dataset.financeFocusKey = "rate";
        optimisticInput.parentNode = optimisticRoot;
        optimisticRoot.children.push(optimisticInput);
        container.appendChild(optimisticRoot);
      },
      write: async () => {
        sawOptimisticBeforeWrite = container.children.includes(optimisticRoot) && !container.children.includes(oldRoot)
          && optimisticInput.focused > 0 && optimisticInput.selection
          && optimisticInput.selection.start === 2 && optimisticInput.selection.end === 4;
        throw rejected;
      },
    });
    ok("FF-15 mutateRendered applies the authoritative root before persistence",
      result && result.ok === false && result.error === rejected && sawOptimisticBeforeWrite);
    ok("FF-16 rejected persistence restores the exact old root identity and position",
      container.children.length === 2 && container.children[0] === oldRoot
        && container.children[1] === tail && optimisticRoot.parentNode === null);
    ok("FF-17 rejected persistence restores exact focus and selection",
      global.document.activeElement === oldInput && oldInput.focused > 0
        && oldInput.selection && oldInput.selection.start === 2 && oldInput.selection.end === 4);
  }

  {
    installLifecycle();
    const { container, oldRoot } = makeEditorDom();
    global.document = { activeElement: null };
    let rejectFirst;
    let firstStarted;
    const firstReady = new Promise((resolve) => { firstStarted = resolve; });
    const firstWrite = new Promise((_resolve, reject) => { rejectFirst = reject; });
    let firstOptimistic, newerRoot;
    const first = ff.mutateRendered({ path: "spice/finance/Budget.md" }, {
      dv: { container }, selector: ".editor",
      render: async () => {
        oldRoot.remove();
        firstOptimistic = makeNode("editor");
        container.appendChild(firstOptimistic);
      },
      write: async () => { firstStarted(); return await firstWrite; },
    });
    await firstReady;
    const newer = await ff.mutateRendered({ path: "spice/finance/Budget.md" }, {
      dv: { container }, selector: ".editor",
      render: async () => {
        firstOptimistic.remove();
        newerRoot = makeNode("editor");
        container.appendChild(newerRoot);
      },
      write: async () => true,
    });
    rejectFirst(new Error("older write rejected"));
    const older = await first;
    ok("FF-18 overlapping older rejection cannot resurrect its obsolete root",
      newer.ok === true && older.ok === false
        && container.querySelector(".editor") === newerRoot
        && !container.children.includes(oldRoot));
  }

  {
    installLifecycle();
    const { container, oldRoot, tail } = makeEditorDom();
    global.document = { activeElement: null };
    let rejectFirst, rejectSecond;
    let firstStarted, secondStarted;
    const firstReady = new Promise((resolve) => { firstStarted = resolve; });
    const secondReady = new Promise((resolve) => { secondStarted = resolve; });
    const firstWrite = new Promise((_resolve, reject) => { rejectFirst = reject; });
    const secondWrite = new Promise((_resolve, reject) => { rejectSecond = reject; });
    let firstOptimistic, secondOptimistic;
    const first = ff.mutateRendered({ path: "spice/finance/Budget.md" }, {
      dv: { container }, selector: ".editor",
      render: async () => {
        oldRoot.remove();
        firstOptimistic = makeNode("editor");
        container.appendChild(firstOptimistic);
      },
      write: async () => { firstStarted(); return await firstWrite; },
    });
    await firstReady;
    const second = ff.mutateRendered({ path: "spice/finance/Budget.md" }, {
      dv: { container }, selector: ".editor",
      render: async () => {
        firstOptimistic.remove();
        secondOptimistic = makeNode("editor");
        container.appendChild(secondOptimistic);
      },
      write: async () => { secondStarted(); return await secondWrite; },
    });
    await secondReady;
    rejectFirst(new Error("older write rejected first"));
    await first;
    rejectSecond(new Error("newer write rejected second"));
    await second;
    ok("FF-19 overlapping double rejection unwinds through failed receipts",
      container.children[0] === oldRoot && container.children[1] === tail
        && firstOptimistic.parentNode === null && secondOptimistic.parentNode === null);
  }

  {
    installLifecycle();
    const { container, oldRoot, oldInput, tail } = makeEditorDom();
    global.document = { activeElement: oldInput };
    const renderFailure = new Error("fixture render failed");
    const result = await ff.mutateRendered({ path: "spice/finance/Budget.md" }, {
      dv: { container }, selector: ".editor",
      render: async () => { oldRoot.remove(); throw renderFailure; },
      write: async () => { throw new Error("write must not run"); },
    });
    ok("FF-20 optimistic render failure restores the old root before escaping",
      result && result.ok === false && result.error === renderFailure
        && container.children.length === 2 && container.children[0] === oldRoot && container.children[1] === tail);
  }

  {
    installLifecycle();
    ok("FF-21 page returns null for missing or throwing cold-load current",
      ff.page({}) === null && ff.page({ current() { throw new Error("cold"); } }) === null);
  }

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}

run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
