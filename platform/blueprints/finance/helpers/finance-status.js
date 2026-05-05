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
    derive(page, type) {
        const today = window.moment().startOf("day");
        if (type === "budget") {
            const month = page.budget_month;
            if (!month) return { label: "Planning", tone: "muted" };
            const m = window.moment(String(month), "YYYY-MM", true);
            if (!m.isValid()) return { label: "Planning", tone: "muted" };
            if (m.isBefore(today, "month")) return { label: "Done", tone: "success" };
            if (m.isSame(today, "month"))   return { label: "In Progress", tone: "warn" };
            return { label: "Planning", tone: "muted" };
        }
        if (type === "paycheck") {
            const start = page.pay_period_start
                ? window.moment(String(page.pay_period_start), "YYYY-MM-DD", true)
                : null;
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
}
