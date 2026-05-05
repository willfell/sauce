/**
 * BudgetNavButtons — per-budget context nav. Auto-detects via path prefix
 * `beacon/finance/budgets/<YYYY-MM>/`. Renders buttons for Budget / Budgets Hub
 * / Finance Hub. Hides the button matching the active file. Embed-deduped per
 * v0.16.0 lesson. Mirrors InvoiceNavButtons shape.
 */
class BudgetNavButtons {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bnb-root");
        if (previous) previous.remove();

        const path = dv.current()?.file?.path || "";
        const m = path.match(/^beacon\/finance\/budgets\/(\d{4}-\d{2})\//);
        if (!m) return;
        const month = m[1];
        const targets = [
            { label: "Budget",      target: `beacon/finance/budgets/${month}/Budget-${month}.md` },
            { label: "Budgets Hub", target: `beacon/finance/budgets/Budgets.md` },
            { label: "Finance Hub", target: `beacon/finance/Finance.md` }
        ].filter(t => t.target !== path);

        const row = dv.container.createEl("div", { cls: "bnb-root" });
        row.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0;";
        for (const t of targets) {
            const btn = row.createEl("button");
            btn.textContent = t.label;
            btn.style.cssText = "cursor: pointer; padding: 6px 12px; border-radius: 6px; font-size: 0.85em; border: 1px solid var(--background-modifier-border); background: var(--background-secondary);";
            btn.onclick = () => app.workspace.openLinkText(t.target, "");
        }
    }
}
