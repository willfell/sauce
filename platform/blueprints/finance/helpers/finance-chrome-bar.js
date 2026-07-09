/**
 * FinanceChromeBar (CustomJS) — the finance blueprint's ChromeBar adapter
 * config. Breadcrumb + Go▾ launcher (7 hubs) as always, PLUS — on the 6
 * hub surfaces that scaffold an entity (budgets/paychecks/invoices/debts/
 * months/savings; finance-hub itself has no entity) — a primary "+ New <X>"
 * button to the right of the compass, dispatching straight to
 * EntityCreate.create (same call FinanceNav's old inline button used,
 * mirrors ReaderChromeBar's reader-hub "+ New article" precedent exactly).
 * FinanceNav's OWN "+ New X" render is now guarded behind chrome-bar
 * presence (see finance-nav.js) — its cross-hub row, defaults links, and
 * prev/next sibling nav are unaffected. Detects by page.type across all 19
 * finance frontmatter types (7 hubs, 6 entities, 3 defaults pages, the
 * finance-plan singleton, plus 2 auxiliary leaf types — invoice-board-card
 * kanban cards and per-invoice time-log notes). Instance methods;
 * never-throw; cold-load-safe.
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
      plus: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
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
    // Hub → the entity it scaffolds. finance-hub is deliberately absent —
    // the top hub has no entity of its own to create (matches FinanceNav's
    // pre-existing behavior, which never rendered a "+ New X" there either).
    const CREATE_FOR_HUB = {
      "budgets-hub": { instance: "budget", label: "New Budget" },
      "paychecks-hub": { instance: "paycheck", label: "New Paycheck" },
      "invoices-hub": { instance: "invoice", label: "New Invoice" },
      "debts-hub": { instance: "debt", label: "New Debt" },
      "months-hub": { instance: "month", label: "New Month" },
      "savings-hub": { instance: "savings", label: "New Savings" },
    };

    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (!HUB_TYPES.includes(t) && !ENTITY_TYPES.includes(t) && !DEFAULTS_TYPES.includes(t) && !AUX_TYPES.includes(t)) return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        const create = CREATE_FOR_HUB[ctx.context];
        const primary = create ? { id: `new-${create.instance}`, label: `+ ${create.label}`, icon: ICON.plus } : null;
        return { primary, overflow: [], leaf: !HUB_TYPES.includes(ctx.context) };
      },
      dispatch: (dv, ctx, id) => {
        if (typeof id !== "string" || !id.startsWith("new-")) return;
        const instance = id.slice("new-".length);
        try {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance, dv });
          } else if (typeof Notice === "function") { new Notice("FinanceChromeBar: EntityCreate unavailable — reinstall finance blueprint.", 6000); }
        } catch (_e) { /* never throw */ }
      },
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
