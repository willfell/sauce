/**
 * InvoicesCards — listing view for beacon/finance/invoices/<YYYY-MM>/Invoice-*.md.
 *
 * Delegates to BeaconCards row layout. Status pill derived via
 * customJS.FinanceStatus.derive(page, "invoice"). Filters to type=="invoice"
 * (excludes Time-Log, Board, and any auto-promoted board card files).
 */
class InvoicesCards {
    async render(dv, opts) {
        opts = opts || {};
        const filter = opts.filter || "all";
        const pages = dv.pages('"beacon/finance/invoices"')
            .where(p => p.type === "invoice")
            .array()
            .sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")));
        const filtered = filter === "pending"
            ? pages.filter(p => customJS.FinanceStatus.derive(p, "invoice").label !== "Done")
            : pages;
        await customJS.BeaconCards.render(dv, {
            pages: filtered,
            layout: "row",
            title: p => `Invoice — ${customJS.FinanceStatus.formatDate(p.month, "YYYY-MM") || p.file.name}`,
            subtitle: p => {
                const hours = Number(p.hours || 0);
                const amt = Number(p.amount || 0);
                const submitted = p.submitted_date
                    ? customJS.FinanceStatus.formatDate(p.submitted_date, "YYYY-MM-DD")
                    : "—";
                return {
                    text: `${hours}h · $${amt.toLocaleString()}`,
                    secondaryText: `submitted: ${submitted}`
                };
            },
            badges: p => [customJS.FinanceStatus.derive(p, "invoice")],
            targetFn: p => p.file.path,
        });
    }
}
