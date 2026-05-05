/**
 * FinanceStatus — shared status pill derivation helper.
 *
 * Returns {label, tone} for a finance entity at render time. Used by
 * FinanceHubCards + BudgetsCards + PaychecksCards + InvoicesCards.
 *
 * Status rules (v0.16.0 design):
 *   Budget    Done(success)  if budget_month is past
 *             InProgress(warn) if budget_month is current
 *             Planning(muted)  if budget_month is future or absent
 *   Paycheck  Done(success)  if all expenses[].paid === true (and any expenses)
 *             InProgress(warn) if today >= pay_period_start
 *             Planning(muted)  otherwise
 *   Invoice   Done(success)  if submitted_date is set
 *             InProgress(warn) if hours > 0 (and no submitted_date)
 *             Planning(muted)  if hours == 0
 */
class FinanceStatus {
    /**
     * Accept a frontmatter date value that Obsidian/Dataview may have parsed
     * into a Date object (Luxon DateTime) OR left as a string. Return a
     * non-strict moment instance.
     */
    _toMoment(val) {
        if (val == null) return null;
        // Luxon DateTime (Dataview) — has .toJSDate
        if (typeof val === "object" && typeof val.toJSDate === "function") {
            return window.moment(val.toJSDate());
        }
        // JS Date object
        if (val instanceof Date) {
            return window.moment(val);
        }
        // Bare string
        return window.moment(String(val));
    }

    /** Returns {label, tone} for a finance entity. tone is a BeaconCards palette key. */
    derive(page, type) {
        const today = window.moment().startOf("day");
        if (type === "budget") {
            const m = this._toMoment(page.budget_month);
            if (!m || !m.isValid()) return { label: "Planning", tone: "muted" };
            if (m.isBefore(today, "month")) return { label: "Done", tone: "success" };
            if (m.isSame(today, "month"))   return { label: "In Progress", tone: "warn" };
            return { label: "Planning", tone: "muted" };
        }
        if (type === "paycheck") {
            const start = this._toMoment(page.pay_period_start);
            const expenses = Array.isArray(page.expenses) ? page.expenses : [];
            const allPaid = expenses.length > 0 && expenses.every(e => e && e.paid === true);
            if (allPaid) return { label: "Done", tone: "success" };
            if (start && start.isValid() && !today.isBefore(start, "day")) {
                return { label: "In Progress", tone: "warn" };
            }
            return { label: "Planning", tone: "muted" };
        }
        if (type === "invoice") {
            if (page.submitted_date) return { label: "Done", tone: "success" };
            const hours = Number(page.hours || 0);
            if (hours > 0) return { label: "In Progress", tone: "warn" };
            return { label: "Planning", tone: "muted" };
        }
        return { label: "Planning", tone: "muted" };
    }

    /**
     * Render a colored status pill onto a Dataview container. Caller must
     * supply page (current dv.current()) and type. Mirrors BeaconCards' badge
     * palette so colors stay consistent.
     */
    async renderBadge(dv, type) {
        const previous = dv.container.querySelector(":scope > .fs-badge-row");
        if (previous) previous.remove();
        const page = dv.current();
        if (!page) return;
        const { label, tone } = this.derive(page, type);
        const palette = {
            warn:    { bg: "#f59e0b", text: "#fff" },
            success: { bg: "#16a34a", text: "#fff" },
            muted:   { bg: "var(--background-modifier-border)", text: "var(--text-muted)" }
        };
        const p = palette[tone] || palette.muted;
        const row = dv.container.createEl("div", { cls: "fs-badge-row" });
        row.style.cssText = "display: flex; gap: 6px; margin: 4px 0 12px 0;";
        const chip = row.createEl("span");
        chip.textContent = label;
        chip.style.cssText = `display: inline-flex; align-items: center; padding: 3px 12px; border-radius: 4px; font-size: 0.78em; font-weight: 600; background: ${p.bg}; color: ${p.text}; white-space: nowrap;`;
    }

    /** Format a Date|string|Luxon-DateTime to YYYY-MM-DD or YYYY-MM. */
    formatDate(val, fmt) {
        const m = this._toMoment(val);
        if (!m || !m.isValid()) return String(val == null ? "" : val);
        return m.format(fmt || "YYYY-MM-DD");
    }
}
