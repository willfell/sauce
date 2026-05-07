/**
 * PaychecksCards — listing view for spice/finance/paychecks/Paycheck-*.md.
 *
 * Delegates to BeaconCards row layout. Status pill derived via
 * customJS.FinanceStatus.derive(page, "paycheck"). Sorted newest-first by
 * pay_period_start.
 */
class PaychecksCards {
    async render(dv, opts) {
        opts = opts || {};
        const filter = opts.filter || "all";
        const pages = dv.pages('"spice/finance/paychecks"')
            .where(p => p.type === "paycheck")
            .array()
            .sort((a, b) => String(b.pay_period_start || "").localeCompare(String(a.pay_period_start || "")));
        const filtered = filter === "pending"
            ? pages.filter(p => customJS.FinanceStatus.derive(p, "paycheck").label !== "Done")
            : pages;
        await customJS.BeaconCards.render(dv, {
            pages: filtered,
            layout: "row",
            title: p => `Paycheck — ${customJS.FinanceStatus.formatDate(p.pay_period_start, "YYYY-MM-DD") || p.file.name}`,
            subtitle: p => {
                const exp = Array.isArray(p.expenses) ? p.expenses : [];
                const isPaid = (e) => {
                    if (!e) return false;
                    const v = e.paid;
                    return v === true || (typeof v === "string" && v.toLowerCase() === "true");
                };
                const paid = exp.filter(isPaid).length;
                const amt = Number(p.paycheck_amount || 0);
                const startStr = customJS.FinanceStatus.formatDate(p.pay_period_start, "YYYY-MM-DD");
                const endStr   = customJS.FinanceStatus.formatDate(p.pay_period_end,   "YYYY-MM-DD");
                const range = (startStr && endStr) ? `${startStr} to ${endStr}` : "";
                return {
                    text: `${paid}/${exp.length} paid · $${amt.toLocaleString()}`,
                    secondaryText: range
                };
            },
            badges: p => [{ ...customJS.FinanceStatus.derive(p, "paycheck"), style: "outline" }],
            targetFn: p => p.file.path,
        });
    }
}
