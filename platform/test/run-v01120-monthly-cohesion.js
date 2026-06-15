// run-v01120-monthly-cohesion.js — v0.112.0 finance — behavioral harness for FinanceMath.
//
// Where run-helper-cases.js asserts source-text contracts via regex, this
// harness LOADS FinanceMath, CALLS its static methods, and ASSERTS return
// values against the cycle's design contract.
//
// Coverage map:
//   FM-DT-*  — debtTotals (interest, weightedApr, zeroDebtDate)
//   FM-MB-*  — monthBounds (cross-year Dec/Jan boundary)
//   FM-MM-*  — measuredMovement + reconcile (boundary logic, hasSignal gating)
//   FM-DP-*  — monthDebtPaid + debtPaidByDebt (paid-only filtering)
//   FM-FMT-* — fmtMoney (sign/negative/positive)
//
// Load pattern: fs.readFileSync + IIFE-eval (mirrors run-v01103-monthly-overview.js).
// Wiring: package.json release:preflight invokes this after run-v01103-monthly-overview.js.

const fs = require("fs");
const path = require("path");

const WORKSHOP = path.resolve(__dirname, "../..");
const FIN_HELPERS = path.join(WORKSHOP, "platform/blueprints/finance/helpers");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ok ${name}`);
  } else {
    failed += 1;
    const msg = `${name}${detail ? " — " + detail : ""}`;
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function approxEq(name, actual, expected, eps) {
  const e = eps !== undefined ? eps : 0.01;
  ok(name, Math.abs(actual - expected) < e,
    `expected ~${expected} (±${e}), got ${actual}`);
}

function deepEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

// ---------------------------------------------------------------------------
// Helper loader — wraps a class declaration file so we can extract the class.
// ---------------------------------------------------------------------------

function loadClass(filename, className) {
  const src = fs.readFileSync(path.join(FIN_HELPERS, filename), "utf8");
  const wrapper = `${src}\n; return ${className};`;
  return new Function(wrapper)();
}

// ---------------------------------------------------------------------------
// Load FinanceMath
// ---------------------------------------------------------------------------

// v0.115.1: FinanceMath methods are now INSTANCE methods (CustomJS exposes
// instances, not classes — static would be unreachable as customJS.FinanceMath.X).
// Instantiate once; all existing FinanceMath.X(...) call-sites in this harness
// continue to work because they're now calls on the instance.
const FinanceMath = new (loadClass("finance-math.js", "FinanceMath"))();

// ===========================================================================
// SECTION 1 — debtTotals
// ===========================================================================

console.log("\n=== Section 1 — FinanceMath.debtTotals ===");

// FM-DT-1: single debt — interest, weightedApr, zeroDebtDate resolve correctly.
// balance=1000, apr=24, plannedPayment=100
// monthlyInterest = 1000 * 24 / 100 / 12 = 20
// principalAttack = 100 - 20 = 80 (> 0, so zeroDebtDate is a future ISO date)
// weightedApr = (1000 * 24) / 1000 = 24
(function FM_DT_1() {
  console.log("\n--- FM-DT-1: single debt positive principal attack ---");
  const result = FinanceMath.debtTotals([
    { current_balance: 1000, apr: 24, planned_monthly_payment: 100 }
  ]);
  approxEq("FM-DT-1.1 monthlyInterest ≈ 20", result.monthlyInterest, 20, 0.01);
  eq("FM-DT-1.2 weightedApr === 24", result.weightedApr, 24);
  ok("FM-DT-1.3 zeroDebtDate is ISO date string",
    /^\d{4}-\d{2}-\d{2}$/.test(result.zeroDebtDate),
    `got: ${result.zeroDebtDate}`);
  ok("FM-DT-1.4 totalBalance === 1000", result.totalBalance === 1000);
})();

// FM-DT-2: planned payment < monthly interest → principalAttack <= 0 → zeroDebtDate = "—"
// balance=1000, apr=24, plannedPayment=10
// monthlyInterest = 20; principalAttack = 10 - 20 = -10 (negative)
(function FM_DT_2() {
  console.log("\n--- FM-DT-2: negative principal attack → zeroDebtDate = em-dash ---");
  const result = FinanceMath.debtTotals([
    { current_balance: 1000, apr: 24, planned_monthly_payment: 10 }
  ]);
  eq("FM-DT-2.1 zeroDebtDate === '—'", result.zeroDebtDate, "—");
})();

// FM-DT-3: empty debts array → all zeros, zeroDebtDate = "—"
(function FM_DT_3() {
  console.log("\n--- FM-DT-3: empty debts array → zero totals ---");
  const result = FinanceMath.debtTotals([]);
  eq("FM-DT-3.1 totalBalance === 0", result.totalBalance, 0);
  eq("FM-DT-3.2 weightedApr === 0", result.weightedApr, 0);
  eq("FM-DT-3.3 zeroDebtDate === '—'", result.zeroDebtDate, "—");
})();

// ===========================================================================
// SECTION 2 — monthBounds
// ===========================================================================

console.log("\n=== Section 2 — FinanceMath.monthBounds ===");

// FM-MB-1: cross-year December boundary
(function FM_MB_1() {
  console.log("\n--- FM-MB-1: December 2026 cross-year boundary ---");
  const result = FinanceMath.monthBounds("2026-12");
  deepEq("FM-MB-1.1 monthBounds('2026-12')", result,
    { first: "2026-12-01", lastExclusive: "2027-01-01" });
})();

// FM-MB-2: mid-year month
(function FM_MB_2() {
  console.log("\n--- FM-MB-2: June 2026 standard mid-year ---");
  const result = FinanceMath.monthBounds("2026-06");
  deepEq("FM-MB-2.1 monthBounds('2026-06')", result,
    { first: "2026-06-01", lastExclusive: "2026-07-01" });
})();

// ===========================================================================
// SECTION 3 — measuredMovement + reconcile
// ===========================================================================

console.log("\n=== Section 3 — FinanceMath.measuredMovement + reconcile ===");

// FM-MM-1: happy path — opening (pre-month) + closing (in-month) = signal + delta
// balance_history: 2026-05-31 (opening, strictly before 2026-06-01) + 2026-06-28 (closing, inside June)
// delta = 820 - 1000 = -180; measuredDrop = -delta = 180
(function FM_MM_1() {
  console.log("\n--- FM-MM-1: measuredMovement with valid opening + closing ---");
  const debts = [{
    name: "X",
    balance_history: [
      { date: "2026-05-31", balance: 1000 },
      { date: "2026-06-28", balance: 820 }
    ]
  }];
  const mv = FinanceMath.measuredMovement(debts, "2026-06");
  ok("FM-MM-1.1 hasSignal === true", mv.hasSignal === true);
  eq("FM-MM-1.2 delta === -180", mv.delta, -180);
  const entry = mv.perDebt.get("X");
  ok("FM-MM-1.3 perDebt X entry present", !!entry);
  ok("FM-MM-1.4 perDebt X hasSignal === true", entry && entry.hasSignal === true);
  eq("FM-MM-1.5 perDebt X delta === -180", entry && entry.delta, -180);

  // FM-MM-1 reconcile: paydownApplied=200, measuredDrop=180, interestAndCharges=20
  const rec = FinanceMath.reconcile(200, mv);
  deepEq("FM-MM-1.6 reconcile result", rec,
    { paydownApplied: 200, measuredDrop: 180, interestAndCharges: 20 });
})();

// FM-MM-2: no opening snapshot (only in-month entries) → hasSignal === false
// 2026-06-10 is inside June, so there is no "strictly before first" entry
(function FM_MM_2() {
  console.log("\n--- FM-MM-2: no opening snapshot → hasSignal false ---");
  const debts = [{
    name: "Y",
    balance_history: [
      { date: "2026-06-10", balance: 500 }
    ]
  }];
  const mv = FinanceMath.measuredMovement(debts, "2026-06");
  ok("FM-MM-2.1 overall hasSignal === false", mv.hasSignal === false);
  const entry = mv.perDebt.get("Y");
  ok("FM-MM-2.2 perDebt Y entry present", !!entry);
  ok("FM-MM-2.3 perDebt Y hasSignal === false", entry && entry.hasSignal === false);
})();

// FM-MM-3: empty balance_history → perDebt entry with hasSignal false, no throw
(function FM_MM_3() {
  console.log("\n--- FM-MM-3: empty balance_history → graceful no-signal ---");
  const debts = [{ name: "Z", balance_history: [] }];
  let threw = null;
  let mv;
  try { mv = FinanceMath.measuredMovement(debts, "2026-06"); }
  catch (e) { threw = e; }
  ok("FM-MM-3.1 no throw on empty balance_history", threw === null, threw && threw.message);
  ok("FM-MM-3.2 hasSignal === false", mv && mv.hasSignal === false);
})();

// ===========================================================================
// SECTION 4 — monthDebtPaid + debtPaidByDebt
// ===========================================================================

console.log("\n=== Section 4 — FinanceMath.monthDebtPaid + debtPaidByDebt ===");

const samplePaychecks = [{
  expenses: [
    { amount: 100, debt: "[[Debt-A]]", paid: true },
    { amount: 50,  debt: "[[Debt-A]]", paid: false },
    { amount: 30,  paid: true }           // no debt key — must not count
  ]
}];

// FM-DP-1: monthDebtPaid — only paid=true + non-empty debt string counts
(function FM_DP_1() {
  console.log("\n--- FM-DP-1: monthDebtPaid ignores paid:false and non-debt rows ---");
  const total = FinanceMath.monthDebtPaid(samplePaychecks);
  eq("FM-DP-1.1 monthDebtPaid === 100", total, 100);
})();

// FM-DP-2: debtPaidByDebt — groups by wikilink key, default paidOnly
(function FM_DP_2() {
  console.log("\n--- FM-DP-2: debtPaidByDebt groups by wikilink, default paidOnly ---");
  const map = FinanceMath.debtPaidByDebt(samplePaychecks);
  ok("FM-DP-2.1 map is a Map", map instanceof Map);
  ok("FM-DP-2.2 [[Debt-A]] key present", map.has("[[Debt-A]]"));
  const entry = map.get("[[Debt-A]]");
  eq("FM-DP-2.3 [[Debt-A]] amount === 100 (paid:false excluded)", entry && entry.amount, 100);
  eq("FM-DP-2.4 [[Debt-A]] count === 1", entry && entry.count, 1);
})();

// FM-DP-3: debtPaidByDebt with paidOnly:false — includes unpaid rows
(function FM_DP_3() {
  console.log("\n--- FM-DP-3: debtPaidByDebt paidOnly:false includes unpaid ---");
  const map = FinanceMath.debtPaidByDebt(samplePaychecks, { paidOnly: false });
  const entry = map.get("[[Debt-A]]");
  eq("FM-DP-3.1 [[Debt-A]] amount === 150 (both included)", entry && entry.amount, 150);
  eq("FM-DP-3.2 [[Debt-A]] count === 2", entry && entry.count, 2);
})();

// ===========================================================================
// SECTION 5 — fmtMoney
// ===========================================================================

console.log("\n=== Section 5 — FinanceMath.fmtMoney ===");

(function FM_FMT_1() {
  console.log("\n--- FM-FMT-1: fmtMoney formatting ---");
  eq("FM-FMT-1.1 negative number", FinanceMath.fmtMoney(-1234.5), "-$1,234.50");
  eq("FM-FMT-1.2 positive with signed:true", FinanceMath.fmtMoney(1234.5, { signed: true }), "+$1,234.50");
  eq("FM-FMT-1.3 zero", FinanceMath.fmtMoney(0), "$0.00");
  eq("FM-FMT-1.4 negative with signed:true", FinanceMath.fmtMoney(-500, { signed: true }), "-$500.00");
  eq("FM-FMT-1.5 large number with commas", FinanceMath.fmtMoney(1000000), "$1,000,000.00");
  eq("FM-FMT-1.6 non-finite defaults to 0", FinanceMath.fmtMoney(NaN), "$0.00");
})();

// ===========================================================================
// SECTION 6 — Widget behavioral fixtures
// (MonthsCards, MonthDashboard, FinanceHubSummary)
//
// All widgets call customJS.FinanceMath.* so we must set up a global
// `customJS` shim before loading them.
// ===========================================================================

console.log("\n=== Section 6 — Widget behavioral fixtures ===");

// ---------------------------------------------------------------------------
// DOM stub (mirrors run-v01103-monthly-overview.js makeEl / makeDA / makeDv)
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
    createEl(tag, opts) {
      const o = opts || {};
      const child = makeEl(tag);
      if (o.text != null) child.textContent = String(o.text);
      if (o.cls != null) child.attrs.cls = o.cls;
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener() {},
    closest(sel) {
      let node = this;
      const want = String(sel).replace(/^\./, "");
      while (node) {
        if (node.attrs && node.attrs.cls === want) return node;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      const want = String(sel).replace(/^:scope\s*>\s*\./, "").replace(/^\./, "");
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

function makeDA(items) {
  const arr = (items || []).slice();
  arr.where = (fn) => makeDA(arr.filter(fn));
  arr.array = () => arr.slice();
  return arr;
}

function makeDv(opts) {
  const o = opts || {};
  const container = makeEl("div");
  const pagesByScope = o.pagesByScope || {};
  return {
    container,
    current: () => (o.current !== undefined ? o.current : null),
    pages: (q) => {
      const scope = String(q || "").replace(/"/g, "");
      return makeDA(pagesByScope[scope] || []);
    },
  };
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
  if (!el) return "";
  let out = el._textContent || "";
  for (const c of (el.children || [])) out += " " + collectText(c);
  return out;
}

// ---------------------------------------------------------------------------
// Global customJS shim — widgets reference customJS.FinanceMath and customJS.FinanceStatus
// ---------------------------------------------------------------------------

// We run in Node (no global `customJS`), so set it up before loading widgets.
if (typeof global.customJS === "undefined") {
  global.customJS = {};
}
global.customJS.FinanceMath = FinanceMath;

// Minimal FinanceStatus shim for FinanceHubSummary's open-invoices tile.
global.customJS.FinanceStatus = {
  derive(page, type) {
    if (type === "invoice") {
      if (page.submitted_date) return { label: "Done", tone: "success" };
      if (page.hours > 0) return { label: "In Progress", tone: "warn" };
      return { label: "Planning", tone: "muted" };
    }
    return { label: "Planning", tone: "muted" };
  }
};

// `app` stub for openLinkText calls (widgets call app.workspace.openLinkText)
if (typeof global.app === "undefined") {
  global.app = { workspace: { openLinkText() {} } };
}

// ---------------------------------------------------------------------------
// Load widget classes
// ---------------------------------------------------------------------------

const MonthsCards = loadClass("months-cards.js", "MonthsCards");
const MonthDashboard = loadClass("month-dashboard.js", "MonthDashboard");
const FinanceHubSummary = loadClass("finance-hub-summary.js", "FinanceHubSummary");

// ---------------------------------------------------------------------------
// MC — MonthsCards fixtures
// ---------------------------------------------------------------------------

console.log("\n--- MC-1: empty month set → empty-state text ---");
(async function MC_1() {
  const dv = makeDv({ current: { file: { path: "spice/finance/months/Months.md", name: "Months" } } });
  const widget = new MonthsCards();
  await widget.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "fmc-root");
  ok("MC-1.1 fmc-root rendered", !!root);
  const text = root ? collectText(root) : "";
  ok("MC-1.2 empty-state text present", /No months yet/.test(text), `got: "${text.slice(0, 80)}"`);
  ok("MC-1.3 no grid children", !root || !root.children.some(c => c.attrs && c.attrs.cls === "fmc-grid") || (function() {
    const grid = walkTree(root, (e) => e.attrs && e.attrs.cls === "fmc-grid");
    return !grid || grid.children.length === 0;
  })());
})();

console.log("\n--- MC-2: two type:month pages → 2 cards DESC order ---");
(async function MC_2() {
  const page2026_05 = { type: "month", month: "2026-05", file: { name: "Month-2026-05", path: "spice/finance/months/Month-2026-05.md" } };
  const page2026_06 = { type: "month", month: "2026-06", file: { name: "Month-2026-06", path: "spice/finance/months/Month-2026-06.md" } };
  const dv = makeDv({
    current: { file: { path: "spice/finance/months/Months.md", name: "Months" } },
    pagesByScope: {
      "spice/finance/months": [page2026_05, page2026_06],
      "spice/finance/paychecks": [],
      "spice/finance/budgets": [],
    }
  });
  const widget = new MonthsCards();
  await widget.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "fmc-root");
  ok("MC-2.1 fmc-root rendered", !!root);
  const grid = walkTree(root, (e) => e.attrs && e.attrs.cls === "fmc-grid");
  ok("MC-2.2 grid rendered", !!grid);
  ok("MC-2.3 two card children", grid && grid.children.length === 2, `got ${grid && grid.children.length}`);
  // DESC order: first card should be 2026-06, second 2026-05
  if (grid && grid.children.length === 2) {
    const first = collectText(grid.children[0]);
    const second = collectText(grid.children[1]);
    ok("MC-2.4 first card is 2026-06 (DESC order)", /2026-06/.test(first), `got: "${first.slice(0, 40)}"`);
    ok("MC-2.5 second card is 2026-05", /2026-05/.test(second), `got: "${second.slice(0, 40)}"`);
  }
})();

// ---------------------------------------------------------------------------
// MD — MonthDashboard fixtures
// ---------------------------------------------------------------------------

console.log("\n--- MD-1: non-month type → no mdash-root rendered ---");
(async function MD_1() {
  const dv = makeDv({
    current: { type: "budget", month: "2026-06", file: { name: "Budget-2026-06", path: "spice/finance/budgets/2026-06/Budget-2026-06.md" } }
  });
  const widget = new MonthDashboard();
  await widget.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mdash-root");
  ok("MD-1.1 no mdash-root for non-month type", !root);
})();

console.log("\n--- MD-2: type:month page → three section roots present ---");
(async function MD_2() {
  const monthPage = {
    type: "month",
    month: "2026-06",
    file: { name: "Month-2026-06", path: "spice/finance/months/Month-2026-06.md" }
  };
  const dv = makeDv({
    current: monthPage,
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/budgets": [],
      "spice/finance/debts": [],
    }
  });
  const widget = new MonthDashboard();
  await widget.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mdash-root");
  ok("MD-2.1 mdash-root rendered", !!root);
  // Three section wrappers should be direct children (mdash-budget, mdash-paychecks, mdash-debts)
  ok("MD-2.2 at least 3 children in root", root && root.children.length >= 3,
    `got ${root && root.children.length}`);
  const budgetSection = root && walkTree(root, (e) => e.attrs && e.attrs.cls === "mdash-budget");
  const paycheckSection = root && walkTree(root, (e) => e.attrs && e.attrs.cls === "mdash-paychecks");
  const debtSection = root && walkTree(root, (e) => e.attrs && e.attrs.cls === "mdash-debts");
  ok("MD-2.3 mdash-budget section present", !!budgetSection);
  ok("MD-2.4 mdash-paychecks section present", !!paycheckSection);
  ok("MD-2.5 mdash-debts section present", !!debtSection);
})();

// ---------------------------------------------------------------------------
// FHS — FinanceHubSummary fixtures
// ---------------------------------------------------------------------------

console.log("\n--- FHS-1: non-Finance.md path → no fhs-root rendered (path guard) ---");
(async function FHS_1() {
  const dv = makeDv({
    current: { type: "finance-hub", file: { name: "Finance", path: "spice/finance/NOT-Finance.md" } }
  });
  const widget = new FinanceHubSummary();
  await widget.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "fhs-root");
  ok("FHS-1.1 no fhs-root for non-Finance.md path", !root);
})();

console.log("\n--- FHS-2: Finance.md + no debts → muted 'No debt tracked' hero ---");
(async function FHS_2() {
  const dv = makeDv({
    current: { type: "finance-hub", file: { name: "Finance", path: "spice/finance/Finance.md" } },
    pagesByScope: {
      "spice/finance/debts": [],
      "spice/finance/paychecks": [],
      "spice/finance/budgets": [],
      "spice/finance/invoices": [],
    }
  });
  const widget = new FinanceHubSummary();
  await widget.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "fhs-root");
  ok("FHS-2.1 fhs-root rendered on Finance.md", !!root);
  const hero = root && walkTree(root, (e) => e.attrs && e.attrs.cls === "fhs-hero");
  ok("FHS-2.2 fhs-hero section present", !!hero);
  const heroText = hero ? collectText(hero) : "";
  ok("FHS-2.3 muted 'No debt tracked' text in hero", /No debt tracked/.test(heroText),
    `got: "${heroText.slice(0, 80)}"`);
})();

// ===========================================================================
// Verdict
// ===========================================================================

setTimeout(() => {
  console.log(`\n=== run-v01120-monthly-cohesion verdict ===`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);
  if (failed > 0) {
    console.log("failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}, 100);
