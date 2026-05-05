/**
 * FinanceHubCards — top-level Finance.md hub composite.
 *
 * Renders three sub-sections with headings (Pending Budgets / Paychecks /
 * Invoices), each delegating to the respective *Cards class via a dv-shim
 * `{container: subEl}` (mirrors space-daily-dashboard.js pattern from daily
 * blueprint). Each sub-section filtered to status != "Done".
 */
class FinanceHubCards {
    async render(dv) {
        const sections = [
            { title: "Pending Budgets",   cls: "BudgetsCards" },
            { title: "Pending Paychecks", cls: "PaychecksCards" },
            { title: "Pending Invoices",  cls: "InvoicesCards" }
        ];
        for (const sec of sections) {
            const heading = dv.container.createEl("h3");
            heading.textContent = sec.title;
            heading.style.cssText = "margin-top: 16px; margin-bottom: 8px;";
            const sub = dv.container.createEl("div");
            const subDv = { container: sub };
            await customJS[sec.cls].render(subDv, { filter: "pending" });
        }
    }
}
