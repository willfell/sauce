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

  console.log("");
  if (fail === 0) { console.log(`PASS ${pass}/${pass + fail}`); process.exit(0); }
  console.log(`FAIL ${fail}/${pass + fail}`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}

run().catch((e) => { console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e))); process.exit(2); });
