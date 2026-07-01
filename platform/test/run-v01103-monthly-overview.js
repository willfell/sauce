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

function fxPaycheck(payPeriodStart, paycheckAmount, expenses, payPeriodEnd) {
  // pay_period_end defaults to pay_period_start (single-day period) so existing
  // fixtures are unaffected by end-first attribution; pass a distinct end to
  // exercise a check that straddles a month boundary.
  return {
    file: { name: `Paycheck-${payPeriodStart}`, path: `spice/finance/paychecks/${payPeriodStart.slice(0, 7)}/Paycheck-${payPeriodStart}.md` },
    type: "paycheck",
    pay_period_start: payPeriodStart,
    pay_period_end: payPeriodEnd || payPeriodStart,
    paycheck_amount: paycheckAmount,
    expenses: expenses || [],
  };
}

// Month-keyed paycheck (new shape): `month` + `deposits[]` + tagged expenses.
// Income for the month = Σ deposits[].amount (paycheck_amount absent).
function fxMonthlyPaycheck(monthKey, deposits, expenses) {
  return {
    file: { name: `Paycheck-${monthKey}`, path: `spice/finance/paychecks/${monthKey}/Paycheck-${monthKey}.md` },
    type: "paycheck",
    month: monthKey,
    deposits: deposits || [],
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

// ---------------------------------------------------------------------------
// MO-B-15: attribution by pay_period_end — a check whose period STARTS in June
// but ENDS (is paid) in July counts as JULY income (matches FinanceMath). A
// legacy check dated wholly in June is excluded from July.
// ---------------------------------------------------------------------------
(async function MO_B_15() {
  console.log("\n--- Case MO-B-15: straddling check attributes income to end-month ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [
        // paid July 2 (period 6/28→7/2) → belongs to July
        fxPaycheck("2026-06-28", 4500, [], "2026-07-02"),
        // legacy wholly-June check → NOT July
        fxPaycheck("2026-06-15", 9999, []),
      ],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-15.1 straddling check income lands in July ($4,500.00)", /\$4,500\.00/.test(text));
  ok("MO-B-15.2 wholly-June check excluded from July income", !/\$9,999\.00/.test(text));
  ok("MO-B-15.3 audit footer counts exactly 1 July paycheck", /From\s+1\s+paycheck/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-16: month-keyed paycheck — income = Σ deposits[].amount for the month.
// A single monthly note ($4500 + $4500) attributes $9,000 to July.
// ---------------------------------------------------------------------------
(async function MO_B_16() {
  console.log("\n--- Case MO-B-16: month-keyed paycheck income = Σ deposits ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-07", []),
    pagesByScope: {
      "spice/finance/paychecks": [
        fxMonthlyPaycheck("2026-07",
          [{ date: "2026-07-01", amount: 4500 }, { date: "2026-07-15", amount: 4500 }],
          [{ item: "Rent", amount: 2200, category: "Rent", deposit: 1, paid: false }]),
      ],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-16.1 income sums deposits ($9,000.00)", /Income[\s\S]{0,200}\$9,000\.00/.test(text));
  ok("MO-B-16.2 monthly note counted as 1 paycheck", /From\s+1\s+paycheck/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-B-17: backward-compat — a LEGACY per-check note (no deposits[], only
// paycheck_amount) still contributes its single amount to month income.
// ---------------------------------------------------------------------------
(async function MO_B_17() {
  console.log("\n--- Case MO-B-17: legacy per-check note income = paycheck_amount ---");
  const mo = new MonthlyOverview();
  const dv = makeDv({
    current: fxBudget("2026-08", []),
    pagesByScope: {
      "spice/finance/paychecks": [fxPaycheck("2026-08-01", 3200, [], "2026-08-01")],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const text = collectText(root);
  ok("MO-B-17.1 legacy note income = paycheck_amount ($3,200.00)", /Income[\s\S]{0,200}\$3,200\.00/.test(text));
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
// SECTION 3 — Coverage expansion (added 2026-06-15 post-cycle):
//   • DV-PROXY-* — Dataview-proxy fidelity (chainable .where/.sort/.limit
//     guards, non-Array-typed iterables).
//   • MO-PERF-*  — performance ceiling at realistic vault scale (100
//     paychecks × 20 expenses; 50 debts × 30 balance_history entries).
//   • MO-XYR-*   — cross-year month-key boundary correctness (Dec budget
//     viewed in January; paychecks must not bleed across the year).
// ===========================================================================

console.log("\n=== Section 3 — Dataview-proxy fidelity / performance / cross-year ===");

// ---------------------------------------------------------------------------
// Stricter Dataview-proxy stub: instead of inheriting from Array (so iteration
// uses native Array semantics), we use a NON-Array iterable that exposes only
// the methods Dataview itself documents on a DataArray: .where, .sort, .limit,
// .array, .first, .length, Symbol.iterator. If MonthlyOverview ever leans on
// Array.prototype.* (e.g. .filter, .map, .find) the helper will throw against
// this stub even though it passes with the loose array-based stub.
// ---------------------------------------------------------------------------

function makeStrictDA(items) {
  const inner = (items || []).slice();
  const obj = {
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
  return obj;
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
// DV-PROXY-1: MonthlyOverview renders correctly when dv.pages(...) returns a
// non-Array iterable (only .where + for-of iteration available). Catches any
// future drift toward Array.prototype.* method usage.
// ---------------------------------------------------------------------------
(async function DV_PROXY_1() {
  console.log("\n--- Case DV-PROXY-1: helper survives non-Array Dataview proxy ---");
  const mo = new MonthlyOverview();
  const dv = makeStrictDv({
    current: fxBudget("2026-07", [{ name: "Rent", actual: 1000 }]),
    pagesByScope: {
      "spice/finance/paychecks": [
        fxPaycheck("2026-07-01", 2500, [
          { item: "Apple Card", amount: 600, paid: true, debt: "[[Debt-Apple]]" },
        ]),
        fxPaycheck("2026-07-15", 2500, []),
      ],
      "spice/finance/debts": [fxDebt("Apple", 14400, [
        { date: "2026-07-01", balance: 15000 },
        { date: "2026-07-28", balance: 14400 },
      ])],
    },
  });
  let threw = null;
  try { await mo.render(dv); } catch (e) { threw = e; }
  ok("DV-PROXY-1.1 render did not throw on strict DA proxy",
    threw === null, threw && threw.message);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  ok("DV-PROXY-1.2 mo-root rendered through strict proxy", !!root);
  const text = collectText(root);
  ok("DV-PROXY-1.3 income $5,000.00 from strict-proxy paychecks", /\$5,000\.00/.test(text));
  ok("DV-PROXY-1.4 debt paydown $600.00 from strict-proxy expenses", /\$600\.00/.test(text));
  ok("DV-PROXY-1.5 net cashflow +$3,400.00", /\+\$3,400\.00/.test(text));
})();

// ---------------------------------------------------------------------------
// DV-PROXY-2: strict-proxy edge — Symbol.iterator is the ONLY iteration path.
// If the helper accidentally calls .filter / .map / .reduce on the proxy it'll
// throw TypeError, which is what we want as a regression net.
// ---------------------------------------------------------------------------
(async function DV_PROXY_2() {
  console.log("\n--- Case DV-PROXY-2: strict proxy has no Array.prototype methods ---");
  const da = makeStrictDA([{ a: 1 }, { a: 2 }]);
  ok("DV-PROXY-2.1 strict DA has no .filter", typeof da.filter !== "function");
  ok("DV-PROXY-2.2 strict DA has no .map", typeof da.map !== "function");
  ok("DV-PROXY-2.3 strict DA has no .reduce", typeof da.reduce !== "function");
  ok("DV-PROXY-2.4 strict DA has no .find", typeof da.find !== "function");
  // Documented Dataview surface
  ok("DV-PROXY-2.5 strict DA has .where", typeof da.where === "function");
  ok("DV-PROXY-2.6 strict DA has .sort", typeof da.sort === "function");
  ok("DV-PROXY-2.7 strict DA has .limit", typeof da.limit === "function");
  ok("DV-PROXY-2.8 strict DA has Symbol.iterator", typeof da[Symbol.iterator] === "function");
})();

// ---------------------------------------------------------------------------
// DV-PROXY-3: chained .where returns another DA (NOT a plain array). If the
// helper calls .where(...).where(...), the second call must work.
// ---------------------------------------------------------------------------
(async function DV_PROXY_3() {
  console.log("\n--- Case DV-PROXY-3: chained .where returns DA ---");
  const da = makeStrictDA([
    { type: "a", v: 1 },
    { type: "b", v: 2 },
    { type: "a", v: 3 },
  ]);
  const filtered = da.where((p) => p.type === "a");
  ok("DV-PROXY-3.1 chained .where returns DA-shaped object",
    filtered && filtered._kind === "DataArray");
  const second = filtered.where((p) => p.v > 1);
  ok("DV-PROXY-3.2 second .where also returns DA", second && second._kind === "DataArray");
  let n = 0;
  for (const _ of second) n += 1;
  eq("DV-PROXY-3.3 chained filter yields 1 item (v=3)", n, 1);
})();

// ---------------------------------------------------------------------------
// MO-PERF-1: render time bounded at realistic vault scale.
//   • 100 paychecks × 20 expenses each (50% paid debt expenses)
//   • 50 debts × 30 balance_history entries each
// Bound is intentionally generous (1s) — this is a smoke test for catastrophic
// regressions, not a benchmark. If render() ever goes O(n²) on either axis,
// this test fails. If hardware varies, the bound is loose enough to survive.
// ---------------------------------------------------------------------------
(async function MO_PERF_1() {
  console.log("\n--- Case MO-PERF-1: render bounded at vault scale (100p × 20e, 50d × 30h) ---");
  const PAYCHECK_COUNT = 100;
  const EXPENSES_PER_PAYCHECK = 20;
  const DEBT_COUNT = 50;
  const HIST_PER_DEBT = 30;

  const paychecks = [];
  let expectedIncome = 0;
  let expectedDebtPaid = 0;
  for (let i = 0; i < PAYCHECK_COUNT; i += 1) {
    const day = 1 + (i % 28); // keeps in July
    const dd = day < 10 ? `0${day}` : `${day}`;
    const expenses = [];
    for (let j = 0; j < EXPENSES_PER_PAYCHECK; j += 1) {
      const isDebt = (j % 2) === 0;
      const expense = { item: `exp-${j}`, amount: 10 };
      if (isDebt) { expense.paid = true; expense.debt = `[[Debt-${j}]]`; expectedDebtPaid += 10; }
      expenses.push(expense);
    }
    paychecks.push(fxPaycheck(`2026-07-${dd}`, 100, expenses));
    expectedIncome += 100;
  }

  const debts = [];
  for (let i = 0; i < DEBT_COUNT; i += 1) {
    const hist = [];
    for (let h = 0; h < HIST_PER_DEBT; h += 1) {
      const day = 1 + (h % 28);
      const dd = day < 10 ? `0${day}` : `${day}`;
      hist.push({ date: `2026-07-${dd}`, balance: 1000 - h });
    }
    debts.push(fxDebt(`d-${i}`, 500, hist));
  }

  const dv = makeStrictDv({
    current: fxBudget("2026-07", [{ name: "Rent", actual: 2000 }]),
    pagesByScope: {
      "spice/finance/paychecks": paychecks,
      "spice/finance/debts": debts,
    },
  });
  const mo = new MonthlyOverview();
  const t0 = process.hrtime.bigint();
  await mo.render(dv);
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  console.log(`  → render time: ${ms.toFixed(2)}ms (bound 1000ms)`);
  ok("MO-PERF-1.1 render completes under 1s bound", ms < 1000, `actual ${ms.toFixed(2)}ms`);

  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  ok("MO-PERF-1.2 mo-root rendered at scale", !!root);
  const text = collectText(root);
  // Correctness preserved at scale — income / debtPaid sums match exactly
  const expectedNet = expectedIncome - 2000 - expectedDebtPaid;
  ok(`MO-PERF-1.3 income sum correct at scale ($${expectedIncome.toFixed(2)})`,
    text.includes(`$${expectedIncome.toLocaleString("en-US")}.00`),
    `expected income string in band 1`);
  ok(`MO-PERF-1.4 debt paydown sum correct at scale ($${expectedDebtPaid.toFixed(2)})`,
    text.includes(`$${expectedDebtPaid.toLocaleString("en-US")}.00`),
    `expected debtPaid string in band 1`);
  const signedNet = (expectedNet >= 0 ? "+" : "-") + "$" + Math.abs(expectedNet).toLocaleString("en-US") + ".00";
  ok(`MO-PERF-1.5 net cashflow sign + magnitude correct at scale (${signedNet})`,
    text.includes(signedNet), `expected ${signedNet}`);
  ok(`MO-PERF-1.6 audit footer counts 100 paychecks`,
    /From 100 paychecks/.test(text));
  ok(`MO-PERF-1.7 audit footer counts 50 debt entities`,
    /50 debt entities/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-XYR-1: cross-year — Budget-2026-12.md viewed on/after Jan 1 2027.
// Paychecks dated 2027-01-* must NOT bleed into the December bucket; the
// month-key filter is a pure prefix match so this is enforced by
// pay_period_start.startsWith("2026-12"). Catches any future shift to
// loose YYYY-MM matching (e.g. trimming the dash).
// ---------------------------------------------------------------------------
(async function MO_XYR_1() {
  console.log("\n--- Case MO-XYR-1: cross-year boundary — December budget excludes January paychecks ---");
  const mo = new MonthlyOverview();
  const dv = makeStrictDv({
    current: fxBudget("2026-12", [{ name: "Holidays", actual: 800 }]),
    pagesByScope: {
      "spice/finance/paychecks": [
        fxPaycheck("2026-12-15", 3000, []),    // in December — counts
        fxPaycheck("2026-12-31", 3000, []),    // last day of December — counts
        fxPaycheck("2027-01-01", 3000, []),    // first day of January — MUST NOT count
        fxPaycheck("2027-01-15", 3000, []),    // mid-January — MUST NOT count
      ],
      "spice/finance/debts": [],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  eq("MO-XYR-1.1 data-month = 2026-12", root && root.getAttribute("data-month"), "2026-12");
  const text = collectText(root);
  // Only 2 paychecks count → income $6000
  ok("MO-XYR-1.2 income $6,000.00 (only Dec paychecks counted)",
    /Income[\s\S]{0,200}\$6,000\.00/.test(text));
  ok("MO-XYR-1.3 audit footer shows 2 paychecks (NOT 4)",
    /From\s+2\s+paychecks/.test(text), `text: ${text.slice(0, 500)}`);
  // Net = 6000 - 800 - 0 = 5200 → +$5,200.00
  ok("MO-XYR-1.4 net cashflow +$5,200.00 (Dec income only)",
    /\+\$5,200\.00/.test(text));
})();

// ---------------------------------------------------------------------------
// MO-XYR-2: cross-year balance_history MoM — debt with snapshots spanning the
// year boundary must only contribute December-window snapshots when viewing
// Budget-2026-12.md.
// ---------------------------------------------------------------------------
(async function MO_XYR_2() {
  console.log("\n--- Case MO-XYR-2: cross-year MoM — December window excludes January snapshots ---");
  const mo = new MonthlyOverview();
  const dv = makeStrictDv({
    current: fxBudget("2026-12", []),
    pagesByScope: {
      "spice/finance/paychecks": [],
      "spice/finance/debts": [
        fxDebt("X", 1000, [
          { date: "2026-11-30", balance: 1500 },  // pre-window — must NOT contribute
          { date: "2026-12-01", balance: 1400 },  // first-of-Dec → first
          { date: "2026-12-31", balance: 1000 },  // last-of-Dec → last
          { date: "2027-01-05", balance: 900 },   // post-window — must NOT contribute
        ]),
      ],
    },
  });
  await mo.render(dv);
  const root = walkTree(dv.container, (e) => e.attrs && e.attrs.cls === "mo-root");
  const pill = walkTree(root, (e) => /^MoM/.test(e._textContent || ""));
  ok("MO-XYR-2.1 MoM pill present (in-window snapshots found)", !!pill);
  // Delta = 1000 - 1400 = -400 → debt went down → green ↓ pill
  ok("MO-XYR-2.2 MoM delta = -$400 (1000 - 1400, December window only)",
    pill && /MoM\s*↓\s*\$400\.00/.test(pill._textContent),
    `pill text: ${pill && pill._textContent}`);
  ok("MO-XYR-2.3 pill colored green (debt went down)",
    pill && /#16a34a/.test(pill.style.cssText));
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
