// run-v01103-monthly-overview.js — v0.110.3 / finance v0.6.3 behavioral test harness.
//
// Where run-helper-cases.js asserts source-text contracts via regex, this
// harness LOADS each helper / migration helper, INSTANTIATES it, and EXERCISES
// it against minimal Dataview / DOM / Obsidian app stubs — then asserts the
// resulting DOM tree, return values, and body transforms match the cycle's
// design contract.
//
// Coverage map:
//   MonthlyOverview math + DOM behavior  → MO-B-1..14
//   _injectMonthlyBand anchor tiers      → MIG-B-1..8
//
// Wiring: invoked from release:preflight via package.json after the
// run-v0109-projects-overhaul harness. Pattern + stubs lifted from
// run-v0109-projects-overhaul.js for consistency.

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
function approxEq(name, actual, expected, eps = 0.005) {
  ok(name, Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// DOM stub — Obsidian-style createEl chain. Only what MonthlyOverview calls.
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
      // Used only for `.markdown-embed` early-return check. Walk parent chain
      // looking for an attrs.cls that matches the selector's class form.
      let node = this;
      const want = String(sel).replace(/^\./, "");
      while (node) {
        if (node.attrs && node.attrs.cls === want) return node;
        node = node.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      // Used for ":scope > .mo-root" embed-dedup. Direct-children scope only.
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
  for (const c of (el.children || [])) out += "\n" + collectText(c);
  return out;
}

// ---------------------------------------------------------------------------
// Dataview-ish pages() stub — supports .where(fn) returning iterable.
// ---------------------------------------------------------------------------

function makeDA(items) {
  const arr = (items || []).slice();
  arr.where = (fn) => makeDA(arr.filter(fn));
  return arr;
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

// ---------------------------------------------------------------------------
// Helper loader — wraps a class declaration file so we can extract the class.
// ---------------------------------------------------------------------------

function loadClass(filename, className) {
  const src = fs.readFileSync(path.join(FIN_HELPERS, filename), "utf8");
  const wrapper = `${src}\n; return ${className};`;
  return new Function(wrapper)();
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function fxBudget(monthKey, categories) {
  return {
    file: { name: `Budget-${monthKey}`, path: `spice/finance/budgets/${monthKey}/Budget-${monthKey}.md` },
    type: "budget",
    month: monthKey,
    categories: categories || [],
  };
}

function fxPaycheck(payPeriodStart, paycheckAmount, expenses) {
  return {
    file: { name: `Paycheck-${payPeriodStart}`, path: `spice/finance/paychecks/${payPeriodStart.slice(0, 7)}/Paycheck-${payPeriodStart}.md` },
    type: "paycheck",
    pay_period_start: payPeriodStart,
    paycheck_amount: paycheckAmount,
    expenses: expenses || [],
  };
}

function fxDebt(name, currentBalance, balanceHistory) {
  return {
    file: { name: `Debt-${name}`, path: `spice/finance/debts/Debt-${name}.md` },
    type: "debt",
    name,
    current_balance: currentBalance,
    balance_history: balanceHistory || [],
  };
}

// ===========================================================================
// SECTION 1 — MonthlyOverview behavioral (math + DOM)
// ===========================================================================

const MonthlyOverview = loadClass("monthly-overview.js", "MonthlyOverview");

console.log("\n=== Section 1 — MonthlyOverview behavioral ===");

// ---------------------------------------------------------------------------
// MO-B-1: happy path — 2 paychecks ($2500 ea), 2 debts, paid debt expense $800,
// spending $1200 → net = 5000 - 1200 - 800 = $3000 (green)
// ---------------------------------------------------------------------------
(async function MO_B_1() {
  console.log("\n--- Case MO-B-1: happy-path math + three bands rendered ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", [
      { name: "Rent", planned: 1000, actual: 1000 },
      { name: "Groceries", planned: 400, actual: 200 },
    ]),
    pagesByScope: {
      "spice/finance/paychecks": [
        fxPaycheck("2026-07-01", 2500, [
          { item: "Apple Card pmt", amount: 800, paid: true, debt: "[[Debt-Apple]]" },
        ]),
        fxPaycheck("2026-07-15", 2500, []),
      ],
      "spice/finance/debts": [
        fxDebt("Apple", 15000, [
          { date: "2026-07-01", balance: 15200 },
          { date: "2026-07-28", balance: 14800 },
        ]),
        fxDebt("Discover", 5000, []),
      ],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  ok("MO-B-1.1 mo-root present", !!root);
  eq("MO-B-1.2 data-month attribute", root && root.getAttribute("data-month"), "2026-07");
  // Headline labels — uppercase via CSS text-transform but body is sentence-case
  const text = collectText(root);
  ok("MO-B-1.3 Income label present", /Income/.test(text));
  ok("MO-B-1.4 Spending label present", /Spending/.test(text));
  ok("MO-B-1.5 Debt paydown label present", /Debt paydown/.test(text));
  ok("MO-B-1.6 Net cashflow label present", /Net cashflow/.test(text));
  ok("MO-B-1.7 income $5,000.00 rendered", /\$5,000\.00/.test(text));
  ok("MO-B-1.8 spending $1,200.00 rendered", /\$1,200\.00/.test(text));
  ok("MO-B-1.9 debt paydown $800.00 rendered", /\$800\.00/.test(text));
  ok("MO-B-1.10 net cashflow +$3,000.00 rendered (signed positive)",
    /\+\$3,000\.00/.test(text));
  // Tone — green is #16a34a per palette
  const netCell = walkTree(root, (e) => e._textContent === "+$3,000.00");
  ok("MO-B-1.11 net cashflow value colored green",
    netCell && /#16a34a/.test(netCell.style.cssText));
  // Sources strip
  ok("MO-B-1.12 sources footer shows 2 paychecks", /From\s+2\s+paychecks/.test(text));
  ok("MO-B-1.13 sources footer shows 2 debt entities", /2\s+debt\s+entities/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-2: zero paychecks → income $0 + audit footer "No paychecks dated"
// ---------------------------------------------------------------------------
(async function MO_B_2() {
  console.log("\n--- Case MO-B-2: zero paychecks → income $0 ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-08", [{ name: "Rent", actual: 1000 }]),
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/debts": [fxDebt("X", 1000, [])],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-2.1 income $0.00 rendered", /Income[\s\S]{0,200}\$0\.00/.test(text));
  ok("MO-B-2.2 audit footer notes no paychecks", /No paychecks dated this month/.test(text));
  // netCash = 0 - 1000 - 0 = -1000; income=0 so amber threshold doesn't apply → red
  ok("MO-B-2.3 net cashflow shown as -$1,000.00", /-\$1,000\.00/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-3: zero debts → debt-paydown cell shows "—", Band 2 "No debt tracked"
// ---------------------------------------------------------------------------
(async function MO_B_3() {
  console.log("\n--- Case MO-B-3: zero debts → '—' cell + 'No debt tracked' band ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", [{ name: "Rent", actual: 1000 }]),
    pagesByScope: {
      "spice/finance/paychecks": [fxPaycheck("2026-07-15", 3000, [])],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  // Debt-paydown cell shows "—" (em-dash placeholder)
  ok("MO-B-3.1 debt paydown cell renders em-dash placeholder",
    /Debt paydown[\s\S]{0,200}—/.test(text));
  ok("MO-B-3.2 Band 2 'No debt tracked'", /No debt tracked/.test(text));
  // Net = 3000 - 1000 - 0 = 2000 (no debt subtracted; cell was "—" not 0)
  ok("MO-B-3.3 net cashflow +$2,000.00", /\+\$2,000\.00/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-4: negative net cashflow > 10% of income → red tone
// ---------------------------------------------------------------------------
(async function MO_B_4() {
  console.log("\n--- Case MO-B-4: severe loss → red net-cashflow tone ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", [{ name: "Rent", actual: 2000 }]),
    pagesByScope: {
      "spice/finance/paychecks": [fxPaycheck("2026-07-01", 1000, [])],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-4.1 net cashflow -$1,000.00 rendered", /-\$1,000\.00/.test(text));
  const netCell = walkTree(root, (e) => e._textContent === "-$1,000.00");
  ok("MO-B-4.2 severe-loss net cell colored red (#dc2626)",
    netCell && /#dc2626/.test(netCell.style.cssText));
})();

// ---------------------------------------------------------------------------
// MO-B-5: minor loss within 10% of income → amber tone
//   income=$10000, spending=$10500, debtPaid=0 → net=-$500 (5% of income → amber)
// ---------------------------------------------------------------------------
(async function MO_B_5() {
  console.log("\n--- Case MO-B-5: minor loss within 10% → amber tone ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", [{ name: "Rent", actual: 10500 }]),
    pagesByScope: {
      "spice/finance/paychecks": [fxPaycheck("2026-07-01", 10000, [])],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const netCell = walkTree(root, (e) => e._textContent === "-$500.00");
  ok("MO-B-5.1 amber tone for 5% loss",
    netCell && /#b45309/.test(netCell.style.cssText));
})();

// ---------------------------------------------------------------------------
// MO-B-6: page.type !== "budget" → early return (no DOM written)
// ---------------------------------------------------------------------------
(async function MO_B_6() {
  console.log("\n--- Case MO-B-6: non-budget page → no render ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: { file: { name: "Paycheck-2026-07-01", path: "spice/finance/paychecks/2026-07/Paycheck-2026-07-01.md" }, type: "paycheck" },
    pagesByScope: { "spice/finance/paychecks": [], "spice/finance/debts": [] },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  ok("MO-B-6.1 no mo-root rendered on non-budget page", !root);
  eq("MO-B-6.2 container has no children", dv.container.children.length, 0);
})();

// ---------------------------------------------------------------------------
// MO-B-7: paid:false debt expense MUST NOT count toward debtPaid
// ---------------------------------------------------------------------------
(async function MO_B_7() {
  console.log("\n--- Case MO-B-7: paid:false debt expense excluded ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [
        fxPaycheck("2026-07-01", 5000, [
          { item: "planned but not paid", amount: 500, paid: false, debt: "[[Debt-X]]" },
        ]),
      ],
      "spice/finance/debts": [fxDebt("X", 5000, [])],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-7.1 debt paydown $0.00 (paid:false excluded)",
    /Debt paydown[\s\S]{0,200}\$0\.00/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-8: empty `debt:` string MUST NOT count
// ---------------------------------------------------------------------------
(async function MO_B_8() {
  console.log("\n--- Case MO-B-8: empty debt-string expense excluded ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [
        fxPaycheck("2026-07-01", 5000, [
          { item: "rogue paid expense", amount: 500, paid: true, debt: "" },
          { item: "no debt key", amount: 300, paid: true },
        ]),
      ],
      "spice/finance/debts": [fxDebt("X", 1, [])],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-8.1 debt paydown $0.00 (no resolvable debt wikilink → excluded)",
    /Debt paydown[\s\S]{0,200}\$0\.00/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-9: single balance_history entry in month → "No MoM signal yet"
// ---------------------------------------------------------------------------
(async function MO_B_9() {
  console.log("\n--- Case MO-B-9: single MoM snapshot → No signal pill ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/debts": [
        fxDebt("X", 5000, [{ date: "2026-07-15", balance: 5000 }]),
      ],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-9.1 'No MoM signal yet' pill rendered", /No MoM signal yet/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-10: first.date === last.date → "No MoM signal yet"
// (single-day snapshot is not a delta even if the array has dup entries)
// ---------------------------------------------------------------------------
(async function MO_B_10() {
  console.log("\n--- Case MO-B-10: same-day MoM snapshots → No signal pill ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/debts": [
        fxDebt("X", 5000, [
          { date: "2026-07-10", balance: 5200 },
          { date: "2026-07-10", balance: 5000 },
        ]),
      ],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-10.1 same-day snapshots produce No signal", /No MoM signal yet/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-11: embed-dedup — render twice → exactly one .mo-root remains
// ---------------------------------------------------------------------------
(async function MO_B_11() {
  console.log("\n--- Case MO-B-11: embed-dedup ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: { "spice/finance/paychecks": [], "spice/finance/debts": [] },
  });
  await mo.render(dv);
  await mo.render(dv);
  let count = 0;
  for (const c of dv.container.children) if (c.attrs && c.attrs.cls === "mo-root") count += 1;
  eq("MO-B-11.1 exactly one mo-root after double render", count, 1);
})();

// ---------------------------------------------------------------------------
// MO-B-12: month-key parses from file.name when frontmatter.month invalid
// ---------------------------------------------------------------------------
(async function MO_B_12() {
  console.log("\n--- Case MO-B-12: month-key fallback to file.name ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: {
      file: { name: "Budget-2026-09", path: "spice/finance/budgets/2026-09/Budget-2026-09.md" },
      type: "budget",
      month: "garbage",
      categories: [],
    },
    pagesByScope: { "spice/finance/paychecks": [], "spice/finance/debts": [] },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  ok("MO-B-12.1 mo-root rendered via file.name fallback", !!root);
  eq("MO-B-12.2 data-month from file.name", root.getAttribute("data-month"), "2026-09");
})();

// ---------------------------------------------------------------------------
// MO-B-13: MoM negative delta → green "↓" pill (debt went DOWN = good)
// ---------------------------------------------------------------------------
(async function MO_B_13() {
  console.log("\n--- Case MO-B-13: debt went down → green MoM pill ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/debts": [
        fxDebt("X", 4500, [
          { date: "2026-07-01", balance: 5000 },
          { date: "2026-07-28", balance: 4500 },
        ]),
      ],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const pill = walkTree(root, (e) => /^MoM/.test(e._textContent || ""));
  ok("MO-B-13.1 MoM pill present", !!pill);
  ok("MO-B-13.2 pill uses down-arrow for paydown",
    pill && /MoM\s*↓\s*\$500\.00/.test(pill._textContent));
  ok("MO-B-13.3 pill colored green", pill && /#16a34a/.test(pill.style.cssText));
})();

// ---------------------------------------------------------------------------
// MO-B-14: MoM positive delta → red "↑" pill (debt grew = bad)
// ---------------------------------------------------------------------------
(async function MO_B_14() {
  console.log("\n--- Case MO-B-14: debt grew → red MoM pill ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/debts": [
        fxDebt("X", 5300, [
          { date: "2026-07-01", balance: 5000 },
          { date: "2026-07-28", balance: 5300 },
        ]),
      ],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const pill = walkTree(root, (e) => /^MoM/.test(e._textContent || ""));
  ok("MO-B-14.1 pill uses up-arrow for debt growth",
    pill && /MoM\s*↑\s*\$300\.00/.test(pill._textContent));
  ok("MO-B-14.2 pill colored red", pill && /#dc2626/.test(pill.style.cssText));
})();

// ===========================================================================
// SECTION 2 — _injectMonthlyBand anchor-tier coverage
// ===========================================================================

console.log("\n=== Section 2 — _injectMonthlyBand anchor tiers ===");

const installer = require(path.join(WORKSHOP, "platform/install.js"));
const injectBand = installer._injectMonthlyBand;
ok("MIG-B-pre _injectMonthlyBand exported", typeof injectBand === "function");

const MARKER = "<!-- monthly-overview-v0.6.3 -->";

// Helper: assert the injected MO marker precedes a target substring in the body.
function assertOrder(name, body, before, after) {
  const a = body.indexOf(before);
  const b = body.indexOf(after);
  ok(name, a !== -1 && b !== -1 && a < b, `before=${a} after=${b}`);
}

// ---------------------------------------------------------------------------
// MIG-B-1: tier 1 — body with budget-summary marker → MO injected BEFORE it
// ---------------------------------------------------------------------------
(function MIG_B_1() {
  console.log("\n--- Case MIG-B-1: tier 1 anchor — budget-summary marker ---");
  const body =
    "---\ntype: budget\nmonth: 2026-07\n---\n\n" +
    "```dataviewjs\nawait customJS.FinanceStatus.renderBadge(dv, \"budget\");\n```\n\n" +
    "<!-- budget-summary-v0.5.2 -->\n" +
    "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"BudgetSummary\" });\n```\n";
  const r = injectBand(body);
  ok("MIG-B-1.1 touched=true", r.touched === true);
  ok("MIG-B-1.2 MO marker present", r.body.includes(MARKER));
  assertOrder("MIG-B-1.3 MO marker precedes budget-summary marker",
    r.body, MARKER, "<!-- budget-summary-v0.5.2 -->");
  // Idempotency
  const r2 = injectBand(r.body);
  ok("MIG-B-1.4 second pass no-op", r2.touched === false && r2.body === r.body);
})();

// ---------------------------------------------------------------------------
// MIG-B-2: tier 2 — body with BudgetSummary block but NO marker → MO injected
// before the BudgetSummary block
// ---------------------------------------------------------------------------
(function MIG_B_2() {
  console.log("\n--- Case MIG-B-2: tier 2 anchor — BudgetSummary block w/o marker ---");
  const body =
    "---\ntype: budget\nmonth: 2026-07\n---\n\n" +
    "```dataviewjs\nawait customJS.FinanceStatus.renderBadge(dv, \"budget\");\n```\n\n" +
    "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"BudgetSummary\" });\n```\n";
  const r = injectBand(body);
  ok("MIG-B-2.1 touched=true", r.touched === true);
  ok("MIG-B-2.2 MO marker present", r.body.includes(MARKER));
  assertOrder("MIG-B-2.3 MO marker precedes BudgetSummary block",
    r.body, MARKER, "class: \"BudgetSummary\"");
  const r2 = injectBand(r.body);
  ok("MIG-B-2.4 second pass no-op", r2.touched === false);
})();

// ---------------------------------------------------------------------------
// MIG-B-3: tier 3 — body with only FinanceStatus.renderBadge → MO injected
// AFTER the badge block
// ---------------------------------------------------------------------------
(function MIG_B_3() {
  console.log("\n--- Case MIG-B-3: tier 3 anchor — FinanceStatus.renderBadge ---");
  const body =
    "---\ntype: budget\nmonth: 2026-07\n---\n\n" +
    "```dataviewjs\nawait customJS.FinanceStatus.renderBadge(dv, \"budget\");\n```\n";
  const r = injectBand(body);
  ok("MIG-B-3.1 touched=true", r.touched === true);
  ok("MIG-B-3.2 MO marker present", r.body.includes(MARKER));
  assertOrder("MIG-B-3.3 badge precedes MO marker (MO AFTER badge)",
    r.body, "FinanceStatus.renderBadge", MARKER);
})();

// ---------------------------------------------------------------------------
// MIG-B-4: tier 4 — body with neither summary nor badge → MO injected AFTER
// frontmatter close
// ---------------------------------------------------------------------------
(function MIG_B_4() {
  console.log("\n--- Case MIG-B-4: tier 4 anchor — frontmatter close fallback ---");
  const body = "---\ntype: budget\nmonth: 2026-07\n---\n\nBody prose with no widget blocks.\n";
  const r = injectBand(body);
  ok("MIG-B-4.1 touched=true", r.touched === true);
  ok("MIG-B-4.2 MO marker present", r.body.includes(MARKER));
  assertOrder("MIG-B-4.3 frontmatter close precedes MO marker",
    r.body, "---\n\n", MARKER);
})();

// ---------------------------------------------------------------------------
// MIG-B-5: body already has MonthlyOverview reference (no marker) → no-op
// (defense against double-injection if user pasted the block manually)
// ---------------------------------------------------------------------------
(function MIG_B_5() {
  console.log("\n--- Case MIG-B-5: existing MonthlyOverview reference → no-op ---");
  const body =
    "---\ntype: budget\nmonth: 2026-07\n---\n\n" +
    "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"MonthlyOverview\" });\n```\n" +
    "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"BudgetSummary\" });\n```\n";
  const r = injectBand(body);
  ok("MIG-B-5.1 touched=false (would double-inject otherwise)", r.touched === false);
  ok("MIG-B-5.2 body unchanged", r.body === body);
})();

// ---------------------------------------------------------------------------
// MIG-B-6: body without frontmatter → no anchor → no-op (don't crash)
// ---------------------------------------------------------------------------
(function MIG_B_6() {
  console.log("\n--- Case MIG-B-6: body w/o frontmatter → no-op ---");
  const body = "Just some markdown.\nNo frontmatter at all.\n";
  const r = injectBand(body);
  ok("MIG-B-6.1 touched=false", r.touched === false);
  ok("MIG-B-6.2 body unchanged", r.body === body);
})();

// ---------------------------------------------------------------------------
// MIG-B-7: marker already present → no-op (idempotency from the gate, not
// the post-write check)
// ---------------------------------------------------------------------------
(function MIG_B_7() {
  console.log("\n--- Case MIG-B-7: marker already present → no-op ---");
  const body =
    "---\ntype: budget\nmonth: 2026-07\n---\n\n" +
    `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MonthlyOverview" });\n\`\`\`\n`;
  const r = injectBand(body);
  ok("MIG-B-7.1 touched=false", r.touched === false);
  ok("MIG-B-7.2 body unchanged", r.body === body);
})();

// ---------------------------------------------------------------------------
// MIG-B-8: integration — chained migrations (BudgetBody then MonthlyBand) on a
// pre-v0.107.0 stale body produce the canonical badge → MO → BudgetSummary
// ordering. Uses the real exported _migrateBudgetBody.
// ---------------------------------------------------------------------------
(function MIG_B_8() {
  console.log("\n--- Case MIG-B-8: integration — chained migrations preserve canonical order ---");
  const migrateBudgetBody = installer._migrateBudgetBody;
  ok("MIG-B-8.pre _migrateBudgetBody exported", typeof migrateBudgetBody === "function");
  if (typeof migrateBudgetBody !== "function") return;
  const stale =
    "---\ntype: budget\nmonth: 2026-07\n---\n\n" +
    "```dataviewjs\nawait customJS.FinanceStatus.renderBadge(dv, \"budget\");\n```\n\n" +
    "## Categories\n\n" +
    "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"BudgetCategoriesEditor\" });\n```\n";
  const afterBudgetBody = migrateBudgetBody(stale);
  ok("MIG-B-8.1 BudgetBody migration injected BudgetSummary",
    afterBudgetBody.touched && afterBudgetBody.body.includes("<!-- budget-summary-v0.5.2 -->"));
  const afterMonthlyBand = injectBand(afterBudgetBody.body);
  ok("MIG-B-8.2 MonthlyBand injection touched",
    afterMonthlyBand.touched === true);
  const final = afterMonthlyBand.body;
  // Canonical order: badge → MO marker → budget-summary marker
  const badge = final.indexOf("FinanceStatus.renderBadge");
  const moMk = final.indexOf(MARKER);
  const bsMk = final.indexOf("<!-- budget-summary-v0.5.2 -->");
  ok("MIG-B-8.3 final order badge < MO marker < BudgetSummary marker",
    badge !== -1 && moMk !== -1 && bsMk !== -1 && badge < moMk && moMk < bsMk,
    `badge=${badge} mo=${moMk} bs=${bsMk}`);
})();

// ===========================================================================
// Verdict
// ===========================================================================

setTimeout(() => {
  console.log(`\n=== run-v01103-monthly-overview verdict ===`);
  console.log(`passed: ${passed}`);
  console.log(`failed: ${failed}`);
  if (failed > 0) {
    console.log("failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}, 100);
