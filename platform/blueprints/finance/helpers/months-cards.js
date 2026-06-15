/**
 * MonthsCards — Grid of month cards for spice/finance/months/Months.md.
 *
 * Queries all type:month pages, sorts DESC by month key, renders a compact
 * card per month with income/spending/debt-paid stat line. Click-through to
 * each Month note. Capped at 24; overflow shown as muted "+N earlier" line.
 *
 * CSS root: fmc-root. Embed-deduped. Never writes. Pure derivation.
 */
class MonthsCards {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .fmc-root");
        if (previous) previous.remove();

        const allMonths = dv.pages('"spice/finance/months"')
            .where(p => p && p.type === "month")
            .array()
            .sort((a, b) => {
                const ak = (typeof a.month === "string") ? a.month : "";
                const bk = (typeof b.month === "string") ? b.month : "";
                return bk.localeCompare(ak);
            });

        const root = dv.container.createEl("div", { cls: "fmc-root" });
        root.style.cssText = "margin: 12px 0 20px;";

        if (allMonths.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "No months yet. Use + New Month to start one.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 8px 0;";
            return;
        }

        const CAP = 24;
        const displayed = allMonths.slice(0, CAP);
        const overflow = allMonths.length - CAP;

        const grid = root.createEl("div", { cls: "fmc-grid" });
        grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;";

        for (const p of displayed) {
            const monthKey = (typeof p.month === "string") ? p.month : (p.file && p.file.name) || "";
            const paychecks = customJS.FinanceMath.readPaychecksForMonth(dv, monthKey);
            const budget = customJS.FinanceMath.readBudgetForMonth(dv, monthKey);
            const income = customJS.FinanceMath.monthIncome(paychecks);
            const spending = customJS.FinanceMath.monthSpending(budget);
            const debtPaid = customJS.FinanceMath.monthDebtPaid(paychecks);

            const card = grid.createEl("div", { cls: "fmc-card" });
            card.style.cssText = "padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer; background: var(--background-secondary);";

            const labelEl = card.createEl("div", { cls: "fmc-month-label" });
            labelEl.textContent = monthKey || "(unknown)";
            labelEl.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 6px; font-variant-numeric: tabular-nums;";

            const statsEl = card.createEl("div", { cls: "fmc-stats" });
            statsEl.textContent = `Income ${customJS.FinanceMath.fmtMoney(income)} · Spending ${customJS.FinanceMath.fmtMoney(spending)} · Debt paid ${customJS.FinanceMath.fmtMoney(debtPaid)}`;
            statsEl.style.cssText = "font-size: 0.75em; color: var(--text-muted); font-variant-numeric: tabular-nums;";

            card.addEventListener("click", () => {
                if (p.file && p.file.name) app.workspace.openLinkText(p.file.name, "");
            });
        }

        if (overflow > 0) {
            const more = root.createEl("div", { cls: "fmc-overflow" });
            more.textContent = `+${overflow} earlier`;
            more.style.cssText = "margin-top: 8px; font-size: 0.82em; color: var(--text-muted);";
        }
    }
}
