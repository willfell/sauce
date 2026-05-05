/**
 * FinanceHubCards — top-level Finance.md hub composite.
 *
 * Renders, top-down:
 *   1. Area-link button row — Budgets / Paychecks / Invoices with per-area icons.
 *   2. Three pending sub-sections — BudgetsCards / PaychecksCards / InvoicesCards
 *      filtered to status != "Done" via a dv-shim that proxies `pages` + `current`
 *      + `el` from the parent dv so the sub-cards classes can run their queries.
 *
 * Creation flow lives in each area hub (Budgets.md / Paychecks.md / Invoices.md)
 * via the existing NewBudgetButton / NewPaycheckButton / NewInvoiceButton classes
 * — no inline creation buttons on Finance.md (mirrors project blueprint pattern).
 */
class FinanceHubCards {
    async render(dv) {
        const previous = dv.container.querySelector(":scope > .fhc-root");
        if (previous) previous.remove();
        const root = dv.container.createEl("div", { cls: "fhc-root" });

        const icons = {
            budgets: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
            paychecks: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M16 9.5C16 8.12 14.21 7 12 7s-4 1.12-4 2.5 1.79 2.5 4 2.5 4 1.12 4 2.5-1.79 2.5-4 2.5-4-1.12-4-2.5"/></svg>`,
            invoices: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`
        };

        const areaRow = root.createEl("div");
        areaRow.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 16px 0 16px 0;";

        const areas = [
            { label: "Budgets",   icon: icons.budgets,   target: "beacon/finance/budgets/Budgets.md" },
            { label: "Paychecks", icon: icons.paychecks, target: "beacon/finance/paychecks/Paychecks.md" },
            { label: "Invoices",  icon: icons.invoices,  target: "beacon/finance/invoices/Invoices.md" }
        ];

        const btnStyle = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: 0.85em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; min-height: 40px;";

        for (const a of areas) {
            const btn = areaRow.createEl("button");
            btn.innerHTML = a.icon + `<span>${a.label}</span>`;
            btn.style.cssText = btnStyle;
            btn.onmouseenter = () => {
                btn.style.background = "var(--interactive-accent)";
                btn.style.color = "var(--text-on-accent)";
                btn.style.borderColor = "var(--interactive-accent)";
            };
            btn.onmouseleave = () => {
                btn.style.background = "var(--background-primary)";
                btn.style.color = "var(--text-muted)";
                btn.style.borderColor = "var(--background-modifier-border)";
            };
            btn.onclick = () => app.workspace.openLinkText(a.target, "");
        }

        const sections = [
            { title: "Pending Budgets",   cls: "BudgetsCards" },
            { title: "Pending Paychecks", cls: "PaychecksCards" },
            { title: "Pending Invoices",  cls: "InvoicesCards" }
        ];
        for (const sec of sections) {
            const heading = root.createEl("h3");
            heading.textContent = sec.title;
            heading.style.cssText = "margin-top: 16px; margin-bottom: 8px; font-size: 0.85em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;";
            const sub = root.createEl("div");
            const subDv = {
                container: sub,
                pages: dv.pages ? dv.pages.bind(dv) : undefined,
                current: dv.current ? dv.current.bind(dv) : undefined,
                el: dv.el ? dv.el.bind(dv) : undefined
            };
            await customJS[sec.cls].render(subDv, { filter: "pending" });
        }
    }
}
