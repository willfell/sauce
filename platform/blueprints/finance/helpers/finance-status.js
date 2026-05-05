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
            const isPaid = (e) => {
                if (!e) return false;
                const v = e.paid;
                if (v === true) return true;
                if (typeof v === "string" && v.toLowerCase() === "true") return true;
                return false;
            };
            const allPaid = expenses.length > 0 && expenses.every(isPaid);
            const anyPaid = expenses.some(isPaid);
            if (allPaid) return { label: "Done", tone: "success" };
            if (anyPaid) return { label: "In Progress", tone: "warn" };
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
            warn:    { dot: "#f59e0b", border: "rgba(245, 158, 11, 0.35)",  bg: "rgba(245, 158, 11, 0.08)" },
            success: { dot: "#16a34a", border: "rgba(22, 163, 74, 0.35)",   bg: "rgba(22, 163, 74, 0.08)" },
            muted:   { dot: "var(--text-muted)", border: "var(--background-modifier-border)", bg: "transparent" }
        };
        const p = palette[tone] || palette.muted;
        const row = dv.container.createEl("div", { cls: "fs-badge-row" });
        row.style.cssText = "display: flex; gap: 6px; margin: 4px 0 12px 0;";
        const chip = row.createEl("span");
        chip.style.cssText = `display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 999px; font-size: 0.75em; font-weight: 500; background: ${p.bg}; color: var(--text-normal); border: 1px solid ${p.border}; white-space: nowrap; letter-spacing: 0.02em;`;
        const dot = chip.createEl("span");
        dot.style.cssText = `width: 6px; height: 6px; border-radius: 50%; background: ${p.dot}; flex-shrink: 0;`;
        const text = chip.createEl("span");
        text.textContent = label;
    }

    /** Format a Date|string|Luxon-DateTime to YYYY-MM-DD or YYYY-MM. */
    formatDate(val, fmt) {
        const m = this._toMoment(val);
        if (!m || !m.isValid()) return String(val == null ? "" : val);
        return m.format(fmt || "YYYY-MM-DD");
    }
}
