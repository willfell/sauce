/**
 * ToDoAllList (CustomJS) — the All To-Dos page (spice/to-do/All-ToDos.md).
 * Draws the shared To-Do view (ToDoDailyFilterView) on its `all` surface:
 * a search field, All open / Overdue / This week / Backlog pills, Sort,
 * Group and Select, over every open task note. The rows, menus and bulk
 * actions are the To-Do note's own, so both pages look and behave the same.
 *
 * The class name and its hosting note are unchanged: ToDoLeafActions'
 * self-heal looks for the ToDoAllList sentinel in All-ToDos.md.
 *
 * BARE CLASS ONLY. CustomJS evaluates this file as one expression.
 */
class ToDoAllList {
    async render(dv) {
        const CJS = typeof window !== 'undefined' && window.customJS ? window.customJS : null;
        const View = CJS && CJS.ToDoDailyFilterView;
        if (!View || typeof View.render !== 'function') return;
        return View.render(dv, { surface: 'all' });
    }
}
