/**
 * FinanceEditScopeBanner — the Defaults-vs-month context one-liner (finance
 * "make it make sense" #3). Surfaces the mental model the UI never stated:
 *   • on a per-month Budget/Paycheck snapshot (has `month`):
 *       "Editing {month} only — edit Defaults to change every month."
 *   • on a Defaults template (type ends with `-defaults`):
 *       "Template for every new month — changes seed future months, not existing ones."
 *   • anything else → renders nothing.
 *
 * Tiny, muted, display-only. NEVER writes. Bare class only (no trailing
 * statements — CJS-LOAD gate); async render(dv); embed-dedup guard; render-safe
 * (no bare dv.current() deref).
 */
class FinanceEditScopeBanner {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .fesb-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;

        const type = typeof page.type === "string" ? page.type : "";
        let text = null;

        if (type === "budget-defaults" || type === "paycheck-defaults" || type === "debt-defaults" || /-defaults$/.test(type)) {
            text = "Template for every new month — changes here seed future months, not existing ones.";
        } else if ((type === "budget" || type === "paycheck") && page.month != null) {
            const month = this._resolveMonth(page);
            if (month) text = `Editing ${month} only — edit Defaults to change every month.`;
        }

        if (!text) return;

        const root = dv.container.createEl("div", { cls: "fesb-root" });
        root.style.cssText = "margin: 6px 0 12px; font-size: 0.78em; color: var(--text-muted);";
        const line = root.createEl("div");
        line.textContent = text;
    }

    _resolveMonth(page) {
        const m = customJS.FinanceMath && typeof customJS.FinanceMath._coerceMonthString === "function"
            ? customJS.FinanceMath._coerceMonthString(page.month)
            : (typeof page.month === "string" ? page.month.slice(0, 7) : null);
        if (m && /^\d{4}-\d{2}$/.test(m)) return m;
        const name = page.file && page.file.name;
        if (typeof name === "string") {
            const mm = name.match(/(\d{4}-\d{2})/);
            if (mm) return mm[1];
        }
        return null;
    }
}
