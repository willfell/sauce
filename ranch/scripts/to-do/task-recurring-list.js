/**
 * TaskRecurringList (CustomJS) — the Recurring page (spice/to-do/Recurring.md).
 * Draws the shared To-Do view (ToDoDailyFilterView) on its `recurring`
 * surface: every open task note with a `recurrence` set, behind a search
 * field and All / This week / Overdue pills, sorted by next due date. Rows
 * are the shared task rows, so each carries the repeat badge and opens its
 * own note; editing happens there or in the task dialog, as everywhere else.
 *
 * BARE CLASS ONLY. CustomJS evaluates this file as one expression.
 */
class TaskRecurringList {
    async render(dv) {
        const CJS = typeof window !== 'undefined' && window.customJS ? window.customJS : null;
        const View = CJS && CJS.ToDoDailyFilterView;
        if (!View || typeof View.render !== 'function') return;
        return View.render(dv, { surface: 'recurring' });
    }
}
