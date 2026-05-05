/**
 * FinanceHubCards — top-level Finance.md hub composite.
 *
 * Renders, top-down:
 *   1. Area-link button row — Budgets / Paychecks / Invoices (open area hubs)
 *   2. Action button row     — New Budget / New Paycheck / New Invoice (overlay create)
 *   3. Three pending sub-sections — BudgetsCards / PaychecksCards / InvoicesCards
 *      filtered to status != "Done" via dv-shim {container: subEl} (mirrors the
 *      space-daily-dashboard.js sub-shim pattern from the daily blueprint).
 *
 * The action-button row delegates to the corresponding NewXButton helpers so
 * the overlay-dialog code lives in one place per entity type.
 */
class FinanceHubCards {
    async render(dv) {
        // Dedupe: re-renders should replace previous output, not append.
        const previous = dv.container.querySelector(":scope > .fhc-root");
        if (previous) previous.remove();
        const root = dv.container.createEl("div", { cls: "fhc-root" });

        // ── Row 1: area-link buttons ─────────────────────────────────────
        const areaRow = root.createEl("div");
        areaRow.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 8px 0;";
        const areas = [
            { label: "Budgets",   target: "beacon/finance/budgets/Budgets.md" },
            { label: "Paychecks", target: "beacon/finance/paychecks/Paychecks.md" },
            { label: "Invoices",  target: "beacon/finance/invoices/Invoices.md" }
        ];
        for (const a of areas) {
            const btn = areaRow.createEl("button");
            btn.textContent = a.label;
            btn.style.cssText = "cursor: pointer; padding: 8px 16px; border-radius: 6px; font-size: 0.9em; font-weight: 500; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
            btn.onclick = () => app.workspace.openLinkText(a.target, "");
        }

        // ── Row 2: action buttons (delegated to NewXButton helpers) ──────
        const actionRow = root.createEl("div");
        actionRow.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;";
        const actionShim = { container: actionRow };
        await customJS.NewBudgetButton.render(actionShim);
        await customJS.NewPaycheckButton.render(actionShim);
        await customJS.NewInvoiceButton.render(actionShim);

        // ── Row 3+: pending sub-sections (dv-shim per section) ───────────
        const sections = [
            { title: "Pending Budgets",   cls: "BudgetsCards" },
            { title: "Pending Paychecks", cls: "PaychecksCards" },
            { title: "Pending Invoices",  cls: "InvoicesCards" }
        ];
        for (const sec of sections) {
            const heading = root.createEl("h3");
            heading.textContent = sec.title;
            heading.style.cssText = "margin-top: 16px; margin-bottom: 8px;";
            const sub = root.createEl("div");
            const subDv = { container: sub };
            await customJS[sec.cls].render(subDv, { filter: "pending" });
        }
    }
}
