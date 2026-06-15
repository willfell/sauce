/**
 * FinanceHubActions — Consolidated action + nav row for every finance page.
 *
 * Renders a single flex row containing:
 *   1. Cross-hub nav buttons (Finance · Budgets · Paychecks · Invoices) —
 *      hides whichever hub the current page belongs to, so you never see a
 *      button pointing at the page you're already on.
 *   2. + New <X> button (delegated to customJS.EntityCreate) — only when
 *      `instance` is provided.
 *   3. ⚙ Defaults button — only when `defaultsPath` is provided.
 *
 * Usage (single dataviewjs block per hub):
 *
 *   await customJS.FinanceHubActions.render(dv, {
 *     here: "budgets",                                    // optional — hides Budgets nav button
 *     instance: "budget",                                 // optional — wires up + New Budget
 *     defaultsPath: "spice/finance/Budget Defaults.md"    // optional — wires up Defaults link
 *   });
 *
 * One row, consistent placement, every finance page. Mirrors the consolidated
 * intent the user called out post-CF-2 ("ensuring that no matter where you
 * find yourself, within finance, there will be nav buttons, even rowed with
 * buttons to navigate around them").
 *
 * v0.5.3 CF-3.
 */
class FinanceHubActions {
    async render(dv, opts) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .fha-root");
        if (previous) previous.remove();

        const { here = null, instance = null, defaultsPath = null } = opts || {};

        const row = dv.container.createEl("div", { cls: "fha-root" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0 14px;";

        // ---- Cross-hub nav buttons ----
        const HUBS = [
            { key: "finance",   label: "Finance",   path: "spice/finance/Finance.md",            iconKey: "wallet" },
            { key: "budgets",   label: "Budgets",   path: "spice/finance/budgets/Budgets.md",    iconKey: "wallet" },
            { key: "paychecks", label: "Paychecks", path: "spice/finance/paychecks/Paychecks.md", iconKey: "coins" },
            { key: "invoices",  label: "Invoices",  path: "spice/finance/invoices/Invoices.md",  iconKey: "file-text" },
            { key: "debts",     label: "Debts",     path: "spice/finance/debts/Debts.md",        iconKey: "credit-card" }
        ];

        for (const hub of HUBS) {
            if (here && hub.key === here) continue; // skip self
            const icon = this._iconFor(hub.iconKey);
            customJS.AccentButton.render(row, {
                label: hub.label,
                icon,
                onClick: () => app.workspace.openLinkText(hub.path, "")
            });
        }

        // ---- Optional spacer that pushes action buttons to the right ----
        if (instance || defaultsPath) {
            const spacer = row.createEl("div");
            spacer.style.cssText = "flex: 1 1 8px;";
        }

        // ---- + New <X> via EntityCreate (preserves the registry-managed
        // installer comment intent — EntityCreate.render handles label/icon
        // resolution from the manifest spec) ----
        if (instance) {
            const subContainer = row.createEl("div");
            subContainer.style.cssText = "display: inline-flex;";
            // EntityCreate.render attaches to dv.container; provide a tiny dv
            // shim that points at our sub-container instead.
            const shim = Object.create(dv);
            shim.container = subContainer;
            // v0.110.1: poll for customJS.EntityCreate (cold-vault load race —
            // CustomJS plugin registers asynchronously; mirrors the polling in
            // ranch/views/customjs-guard/view.js). Up to 2s, then fall back to
            // a muted placeholder rather than throwing.
            for (let i = 0; i < 40 && !window.customJS?.EntityCreate; i++) {
                await new Promise((r) => setTimeout(r, 50));
            }
            if (window.customJS?.EntityCreate) {
                await customJS.EntityCreate.render(shim, { instance });
            } else {
                const ph = subContainer.createEl("em", { text: "EntityCreate unavailable" });
                ph.style.cssText = "color: var(--text-muted); font-size: 0.85em;";
            }
        }

        // ---- ⚙ Defaults link ----
        if (defaultsPath) {
            customJS.AccentButton.render(row, {
                label: "Defaults",
                icon: this._iconFor("gear"),
                onClick: () => app.workspace.openLinkText(defaultsPath, "")
            });
        }
    }

    _iconFor(key) {
        switch (key) {
            case "wallet":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>';
            case "coins":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>';
            case "file-text":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
            case "credit-card":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
            case "gear":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
            default:
                return "";
        }
    }
}
