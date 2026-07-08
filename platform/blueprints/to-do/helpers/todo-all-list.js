/**
 * ToDoAllList (CustomJS) — renders every OPEN task-note under spice/tasks/
 * (excluding _trash/ and _done/), with a DocSearch text-filter strip above a
 * date-grouped list: Overdue (oldest first) → Today → future dates (soonest
 * first) → "No date". Mirrors TaskDoneArchive's pattern exactly (same
 * dependency chain, same two-container DocSearch shape), rendering each row
 * via the shared TaskTodayList.renderTaskRow so behavior (checkbox, edit,
 * delete, title-click) matches every other task surface.
 *
 * Rebuilt because it retired the p.file.tasks (native markdown-checkbox)
 * model — that data source stopped being populated once the note-per-task
 * migration replaced raw checkboxes with task notes, which is why the old
 * view froze at whatever date last had literal checkbox lines.
 *
 * Class name (ToDoAllList) and hosting template path
 * (spice/to-do/All-ToDos.md) are UNCHANGED so ToDoLeafActions' self-heal
 * check (which tests file content for the ToDoAllList sentinel string)
 * keeps working without modification.
 *
 * Embeds-safe (returns early in markdown-embed contexts). Dual-fire-safe via
 * the __toDoAllRenderGen counter pattern other helpers use.
 */
class ToDoAllList {
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__toDoAllRenderGen || 0) + 1;
        dv.container.__toDoAllRenderGen = myGen;
        const isStale = () => dv.container.__toDoAllRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        const DS = window.customJS && window.customJS.DocSearch;
        const SL = window.customJS && window.customJS.SectionLabel;
        if (!TE || typeof TE.parseNote !== 'function' ||
            !TTL || typeof TTL.renderTaskRow !== 'function' ||
            !DS || typeof DS.render !== 'function' ||
            !SL || typeof SL.render !== 'function') return;

        const todayStr = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DD')
            : '';

        // Load every OPEN task note once (excluding _trash/ and _done/).
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

        // Render results into ctx.resultsContainer (two-container DocSearch pattern,
        // matching TaskDoneArchive).
        const renderResults = (ctx) => {
            const container = ctx.resultsContainer;
            while (container.firstChild) container.removeChild(container.firstChild);

            const filtered = ctx.hasActiveFilter
                ? ToDoAllList.filterByText(allTasks, ctx.text)
                : allTasks;

            if (!filtered.length) {
                const msg = ctx.hasActiveFilter ? 'No tasks match.' : 'No open tasks — all clear. ✅';
                const p = container.createEl('p', { text: msg });
                p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
                return;
            }

            const groups = ToDoAllList.groupByDate(filtered, todayStr);
            const renderGroup = (label, tasks) => {
                if (!tasks.length) return;
                SL.render(container, { text: label });
                for (const task of tasks) {
                    try { TTL.renderTaskRow(container, task, null); } catch (_e) {}
                }
            };
            renderGroup('Overdue', groups.overdue);
            renderGroup('Today', groups.today);
            for (const [dateStr, tasks] of groups.futureByDate) {
                const label = (typeof window !== 'undefined' && window.moment)
                    ? window.moment(dateStr, 'YYYY-MM-DD').format('MMM D, YYYY')
                    : dateStr;
                renderGroup(label, tasks);
            }
            renderGroup('No date', groups.noDate);
        };

        const filterCtx = DS.render(dv, {
            scopePath: 'spice/tasks',
            hideTags: true,
            persist: false,
            onChange: () => renderResults(filterCtx),
        });
        renderResults(filterCtx);
    }

    /**
     * Buckets parsed OPEN tasks by their `scheduled` date relative to
     * `todayStr` (YYYY-MM-DD): overdue (scheduled < today), today
     * (scheduled === today), future (scheduled > today, further split
     * per-date into `futureByDate`), and noDate (no scheduled value).
     * Overdue sorts oldest-first, future sorts soonest-first. Pure,
     * Node-testable; tolerates null/non-array input (returns all-empty
     * groups).
     */
    static groupByDate(parsedTasks, todayStr) {
        const overdue = [];
        const today = [];
        const future = [];
        const noDate = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t) continue;
            const sched = t.scheduled;
            if (!sched) { noDate.push(t); continue; }
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            else future.push(t);
        }
        overdue.sort((a, b) => (a.scheduled < b.scheduled ? -1 : a.scheduled > b.scheduled ? 1 : 0));
        future.sort((a, b) => (a.scheduled < b.scheduled ? -1 : a.scheduled > b.scheduled ? 1 : 0));
        const futureByDate = new Map();
        for (const t of future) {
            if (!futureByDate.has(t.scheduled)) futureByDate.set(t.scheduled, []);
            futureByDate.get(t.scheduled).push(t);
        }
        return { overdue, today, future, futureByDate, noDate };
    }

    /** Case-insensitive title substring filter (mirrors TaskDoneArchive.filterByText). */
    static filterByText(parsedTasks, text) {
        if (!Array.isArray(parsedTasks)) return [];
        if (!text || !text.trim()) return parsedTasks;
        const lower = text.toLowerCase();
        return parsedTasks.filter(t => t && t.title && t.title.toLowerCase().includes(lower));
    }
}
