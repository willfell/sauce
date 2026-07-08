/**
 * TaskRecurringList (CustomJS) — the "Recurring" index view (to-do blueprint).
 * Replaces the old spice/to-do/Recurring Tasks.md raw-markdown registry: lists
 * every OPEN task note under spice/tasks/ that has a `recurrence` grammar set,
 * sorted by `scheduled` ascending (undated recurring tasks sort last). Each
 * row opens its real task note via the shared TaskTodayList.renderTaskRow —
 * this is a READ-ONLY index; there is no manual-editing surface here (edit
 * happens on the task note itself, same as everywhere else).
 *
 * Dependency chain: TaskEntity (parseNote) + TaskTodayList (renderTaskRow) +
 * SectionLabel (heading). Mirrors ToDoAllList's structure (same query root,
 * same cold-load guards, same dual-fire-safe render-generation counter) minus
 * the DocSearch filter strip — this list is expected to be small.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the
 * whole file in `( ... )` and evals it as ONE expression; any trailer
 * (module.exports, if, ...) -> "Unexpected token" -> the class never
 * registers. To Node-test the statics, load via
 * `new Function(src + "; return TaskRecurringList;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskRecurringList.filterRecurring(parsedTasks) -> parsedTask[]
 *
 * Instance API (browser-side):
 *   TaskRecurringList.render(dv)   <- the customjs-guard entry point
 */
class TaskRecurringList {

    /**
     * Filter parsed tasks (TaskEntity.parseNote output, or any object shaped
     * `{ status, recurrence, scheduled, title }`) to open tasks with a
     * non-empty `recurrence`. Sorted by `scheduled` ascending; tasks with no
     * `scheduled` value sort LAST (treated as "after" any real date), tie-
     * broken by title (case-insensitive). Tolerates null/non-array input
     * (-> []). Never throws.
     */
    static filterRecurring(parsedTasks) {
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        const out = list.filter(t => t && t.status === 'open' && t.recurrence && String(t.recurrence).trim() !== '');
        out.sort((a, b) => {
            const as = a.scheduled || '';
            const bs = b.scheduled || '';
            if (as !== bs) {
                if (as === '') return 1;
                if (bs === '') return -1;
                return as < bs ? -1 : 1;
            }
            return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
        });
        return out;
    }

    /**
     * Entry point invoked by customjs-guard: render(dv). Cold-load safe (bails
     * quietly if RenderSafe / TaskEntity / TaskTodayList / SectionLabel aren't
     * registered yet); embeds-safe; dual-fire-safe via a render-generation
     * counter (matches ToDoAllList / TaskDoneArchive convention).
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__taskRecurringListGen || 0) + 1;
        dv.container.__taskRecurringListGen = myGen;
        const isStale = () => dv.container.__taskRecurringListGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        const SL = window.customJS && window.customJS.SectionLabel;
        if (!TE || typeof TE.parseNote !== 'function'
            || !TTL || typeof TTL.renderTaskRow !== 'function'
            || !SL || typeof SL.render !== 'function') return;

        let allTasks = [];
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            allTasks = arr.map(p => TE.parseNote(p));
        } catch (_e) { allTasks = []; }

        if (isStale()) return;

        const recurring = TaskRecurringList.filterRecurring(allTasks);
        if (!recurring.length) {
            const p = dv.container.createEl('p', { text: 'No recurring tasks yet — set "Repeats" on a task to see it here.' });
            p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
            return;
        }

        for (const task of recurring) {
            try { TTL.renderTaskRow(dv.container, task, null); } catch (_e) {}
        }
    }
}
