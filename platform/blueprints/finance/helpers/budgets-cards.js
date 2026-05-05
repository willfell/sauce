/**
 * BudgetsCards — listing view for beacon/finance/budgets/Budget-*.md.
 *
 * Delegates to BeaconCards row layout (mobile-aware mechanism). Status pill
 * derived via customJS.FinanceStatus.derive(page, "budget").
 *
 * Options:
 *   filter — "all" (default) | "pending" (hides "Done")
 */
class BudgetsCards {
    async render(dv, opts) {
        opts = opts || {};
        const filter = opts.filter || "all";
        const pages = dv.pages('"beacon/finance/budgets"')
            .where(p => p.type === "budget")
            .array()
            .sort((a, b) => String(b.budget_month || "").localeCompare(String(a.budget_month || "")));
        const filtered = filter === "pending"
            ? pages.filter(p => customJS.FinanceStatus.derive(p, "budget").label !== "Done")
            : pages;
        await customJS.BeaconCards.render(dv, {
            pages: filtered,
            layout: "row",
            title: p => `Budget — ${customJS.FinanceStatus.formatDate(p.budget_month, "YYYY-MM") || p.file.name}`,
            subtitle: p => {
                const cats = Array.isArray(p.categories) ? p.categories : [];
                const planned = cats.reduce((s, c) => s + Number(c.planned || 0), 0);
                const actual  = cats.reduce((s, c) => s + Number(c.actual  || 0), 0);
                return {
                    text: `${cats.length} categories`,
                    secondaryText: `Planned $${planned.toLocaleString()} · Actual $${actual.toLocaleString()}`
                };
            },
            badges: p => [{ ...customJS.FinanceStatus.derive(p, "budget"), style: "outline" }],
            targetFn: p => p.file.path,
        });
    }
}
