class TaskDoneArchive {

    groupByDate(parsedTasks) { return TaskDoneArchive.groupByDate(parsedTasks); }
    filterByText(parsedTasks, text) { return TaskDoneArchive.filterByText(parsedTasks, text); }

    /**
     * Entry point invoked by customjs-guard: render(dv). Renders a DocSearch
     * text-filter strip above a date-grouped list of all completed task notes.
     * Dependency chain: TaskEntity (parseNote) + TaskTodayList (renderTaskRow) +
     * DocSearch (search strip) + SectionLabel (date headers). Returns quietly if
     * any dependency is absent (cold-load safe). Dual-fire-safe via __renderGen.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__taskDoneArchiveGen || 0) + 1;
        dv.container.__taskDoneArchiveGen = myGen;
        const isStale = () => dv.container.__taskDoneArchiveGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE  = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        const DS  = window.customJS && window.customJS.DocSearch;
        const SL  = window.customJS && window.customJS.SectionLabel;
        if (!TE || typeof TE.parseNote !== 'function' ||
            !TTL || typeof TTL.renderTaskRow !== 'function' ||
            !DS  || typeof DS.render !== 'function' ||
            !SL  || typeof SL.render !== 'function') return;

        // Load all completed task notes once.
        let allTasks = [];
        try {
            const raw = dv.pages('"spice/tasks/_done"').where(p =>
                p && p.type === 'task' && p.file && !p.file.path.includes('/_trash/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            allTasks = arr.map(p => TE.parseNote(p));
        } catch (_e) {}

        if (isStale()) return;

        // Render results into ctx.resultsContainer (two-container DocSearch pattern).
        const renderResults = (ctx) => {
            const container = ctx.resultsContainer;
            while (container.firstChild) container.removeChild(container.firstChild);

            const filtered = ctx.hasActiveFilter
                ? TaskDoneArchive.filterByText(allTasks, ctx.text)
                : allTasks;

            if (!filtered.length) {
                const msg = ctx.hasActiveFilter ? 'No completed tasks match.' : 'No completed tasks yet.';
                const p = container.createEl('p', { text: msg });
                p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
                return;
            }

            const groups = TaskDoneArchive.groupByDate(filtered);
            for (const [dateStr, tasks] of groups) {
                const label = (typeof window !== 'undefined' && window.moment)
                    ? window.moment(dateStr, 'YYYY-MM-DD').format('MMM D, YYYY')
                    : dateStr;
                // SectionLabel.render accepts a container element directly
                // (c = dv.container || dv — passes through when no .container prop).
                SL.render(container, { text: label });
                for (const task of tasks) {
                    try {
                        TTL.renderTaskRow(container, task, null);
                        // Pre-check checkbox for done tasks.
                        try {
                            const row = container.lastElementChild || container.lastChild;
                            const cb = row && row.querySelector && row.querySelector('input[type="checkbox"]');
                            if (cb) cb.checked = true;
                        } catch (_e) {}
                    } catch (_e) {}
                }
            }
        };

        const filterCtx = DS.render(dv, {
            scopePath: 'spice/tasks/_done',
            hideTags: true,
            persist: false,
            hideNativeSearch: true,
            onChange: renderResults,
        });

        if (isStale()) return;
        renderResults(filterCtx);
    }

    static groupByDate(parsedTasks) {
        if (!Array.isArray(parsedTasks)) return new Map();
        const map = new Map();
        for (const t of parsedTasks) {
            if (!t || !t.completed_at) continue;
            if (!map.has(t.completed_at)) map.set(t.completed_at, []);
            map.get(t.completed_at).push(t);
        }
        return new Map([...map.entries()].sort((a, b) =>
            b[0] < a[0] ? -1 : b[0] > a[0] ? 1 : 0));
    }

    static filterByText(parsedTasks, text) {
        if (!Array.isArray(parsedTasks)) return [];
        if (!text || !text.trim()) return parsedTasks;
        const lower = text.toLowerCase();
        return parsedTasks.filter(t => t && t.title && t.title.toLowerCase().includes(lower));
    }
}
