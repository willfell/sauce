/**
 * FinanceChromeBar (CustomJS) — the finance blueprint's ChromeBar adapter
 * config. PARTIAL INTEGRATION (mirrors the PersonNavButtons precedent):
 * FinanceNav's per-mode layout (cross-hub row, +New X, defaults links,
 * prev/next sibling nav) is richer than ChromeBar's one-primary +
 * flat-overflow model, so this adapter renders ONLY the shared top bar —
 * breadcrumb (new for finance) + a Go▾ launcher listing the 7 hubs. No
 * chrome-owned actions on any surface (FinanceNav already owns "+ New X"
 * and defaults links) — primary/overflow are always empty. FinanceNav is
 * left completely untouched below the bar; nothing here retires or
 * duplicates its logic. Detects by page.type across all 19 finance
 * frontmatter types (7 hubs, 6 entities, 3 defaults pages, the
 * finance-plan singleton, plus 2 auxiliary leaf types — invoice-board-card
 * kanban cards and per-invoice time-log notes — that FinanceNav never
 * correctly classified either, since neither has "+ New X"/defaults/
 * prev-next semantics; they just get the same Go▾ hub list as any other
 * leaf). Instance methods; never-throw; cold-load-safe.
 */
class FinanceChromeBar {
  get ICON() {
    return {
      wallet: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
      calculator: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/></svg>`,
      coins: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/></svg>`,
      fileText: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      creditCard: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
      piggyBank: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 2.5S17.5 10 19 10c.5 0 .9-.1 1.3-.3.4 1.1.7 2.3.7 3.3 0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8c1.4 0 2.7.4 3.9 1"/><path d="M9 11h.01"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const HUB_TYPES = ["finance-hub", "budgets-hub", "paychecks-hub", "invoices-hub", "debts-hub", "months-hub", "savings-hub"];
    const ENTITY_TYPES = ["budget", "paycheck", "invoice", "debt", "month", "savings-account"];
    const DEFAULTS_TYPES = ["budget-defaults", "paycheck-defaults", "debt-defaults", "finance-plan"];
    const AUX_TYPES = ["invoice-board-card", "time-log"];
    const HUBS = [
      { key: "finance-hub", label: "Finance", icon: ICON.wallet, path: "spice/finance/Finance.md" },
      { key: "budgets-hub", label: "Budgets", icon: ICON.calculator, path: "spice/finance/budgets/Budgets.md" },
      { key: "paychecks-hub", label: "Paychecks", icon: ICON.coins, path: "spice/finance/paychecks/Paychecks.md" },
      { key: "invoices-hub", label: "Invoices", icon: ICON.fileText, path: "spice/finance/invoices/Invoices.md" },
      { key: "debts-hub", label: "Debts", icon: ICON.creditCard, path: "spice/finance/debts/Debts.md" },
      { key: "months-hub", label: "Months", icon: ICON.calendar, path: "spice/finance/months/Months.md" },
      { key: "savings-hub", label: "Savings", icon: ICON.piggyBank, path: "spice/finance/savings/Savings.md" },
    ];

    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (!HUB_TYPES.includes(t) && !ENTITY_TYPES.includes(t) && !DEFAULTS_TYPES.includes(t) && !AUX_TYPES.includes(t)) return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => ({ primary: null, overflow: [], leaf: !HUB_TYPES.includes(ctx.context) }),
      dispatch: (dv, ctx, id) => { /* no chrome-owned actions — FinanceNav owns +New X / defaults links */ },
      destinations: (dv, ctx) => {
        const out = [{ section: "This finance" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        for (const hub of HUBS) {
          if (hub.key === ctx.context) continue;
          out.push({ label: hub.label, icon: hub.icon, _navTarget: hub.path, onSelect: () => open(hub.path) });
        }
        return out;
      },
      rootClass: "finance-chrome-root",
      btnClass: (v) => `finance-chrome-btn finance-chrome-btn-${v}`,
    };
  }
}
