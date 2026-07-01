/**
 * PaychecksCards — listing view for spice/finance/paychecks/Paycheck-*.md.
 *
 * Delegates to BeaconCards row layout. Status pill derived via
 * customJS.FinanceStatus.derive(page, "paycheck"). Sorted newest-first by
 * pay_period_start.
 */
class PaychecksCards {
    // A note is the new month-keyed shape iff it carries a deposits[] array.
    _isMonthly(p) { return !!(p && Array.isArray(p.deposits)); }
    // Sort key: prefer `month` (YYYY-MM), fall back to legacy pay_period_start.
    _sortKey(p) {
        const FS = customJS.FinanceStatus;
        if (typeof p.month === "string" && /^\d{4}-\d{2}$/.test(p.month)) return p.month;
        return FS.formatDate(p.month || p.pay_period_start, "YYYY-MM-DD") || "";
    }
    async render(dv, opts) {
        opts = opts || {};
        const filter = opts.filter || "all";
        const pages = dv.pages('"spice/finance/paychecks"')
            .where(p => p.type === "paycheck")
            // Archived notes never show as cards (mirrors
            // FinanceMath.readPaychecksForMonth / monthly-overview).
            .where(p => !(p.file && typeof p.file.path === "string" && p.file.path.includes("/_archive/")))
            .array()
            .sort((a, b) => String(this._sortKey(b) || "").localeCompare(String(this._sortKey(a) || "")));
        const filtered = filter === "pending"
            ? pages.filter(p => customJS.FinanceStatus.derive(p, "paycheck").label !== "Done")
            : pages;
        await customJS.BeaconCards.render(dv, {
            pages: filtered,
            layout: "row",
            title: p => this._isMonthly(p)
                ? `Paycheck — ${typeof p.month === "string" ? p.month : (customJS.FinanceStatus.formatDate(p.month, "YYYY-MM") || p.file.name)}`
                : `Paycheck — ${customJS.FinanceStatus.formatDate(p.pay_period_start, "YYYY-MM-DD") || p.file.name}`,
            subtitle: p => {
                const exp = Array.isArray(p.expenses) ? p.expenses : [];
                const isPaid = (e) => {
                    if (!e) return false;
                    const v = e.paid;
                    return v === true || (typeof v === "string" && v.toLowerCase() === "true");
                };
                const paid = exp.filter(isPaid).length;
                if (this._isMonthly(p)) {
                    // Month total = Σ deposits; secondary = deposit count.
                    const deposits = Array.isArray(p.deposits) ? p.deposits : [];
                    const total = deposits.reduce((s, d) => s + (Number(d && d.amount) || 0), 0);
                    const n = deposits.length;
                    return {
                        text: `${paid}/${exp.length} paid · $${total.toLocaleString()}`,
                        secondaryText: `${n} deposit${n === 1 ? "" : "s"}`,
                    };
                }
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
