/**
 * PaychecksCards — listing view for beacon/finance/paychecks/Paycheck-*.md.
 *
 * Delegates to BeaconCards row layout. Status pill derived via
 * customJS.FinanceStatus.derive(page, "paycheck"). Sorted newest-first by
 * pay_period_start.
 */
class PaychecksCards {
    async render(dv, opts) {
        opts = opts || {};
        const filter = opts.filter || "all";
        const pages = dv.pages('"beacon/finance/paychecks"')
            .where(p => p.type === "paycheck")
            .array()
            .sort((a, b) => String(b.pay_period_start || "").localeCompare(String(a.pay_period_start || "")));
        const filtered = filter === "pending"
            ? pages.filter(p => customJS.FinanceStatus.derive(p, "paycheck").label !== "Done")
            : pages;
        await customJS.BeaconCards.render(dv, {
            pages: filtered,
            layout: "row",
            title: p => `Paycheck — ${p.pay_period_start || p.file.name}`,
            subtitle: p => {
                const exp = Array.isArray(p.expenses) ? p.expenses : [];
                const paid = exp.filter(e => e && e.paid === true).length;
                const amt = Number(p.paycheck_amount || 0);
                const range = (p.pay_period_start && p.pay_period_end)
                    ? `${p.pay_period_start} to ${p.pay_period_end}`
                    : "";
                return {
                    text: `${paid}/${exp.length} paid · $${amt.toLocaleString()}`,
                    secondaryText: range
                };
            },
            badges: p => [customJS.FinanceStatus.derive(p, "paycheck")],
            targetFn: p => p.file.path,
        });
    }
}
