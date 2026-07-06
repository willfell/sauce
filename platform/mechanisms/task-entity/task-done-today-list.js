class TaskDoneTodayList {

    filterToday(parsedTasks, todayStr) { return TaskDoneTodayList.filterToday(parsedTasks, todayStr); }

    /**
     * Entry point invoked by customjs-guard: render(dv). Live-queries
     * spice/tasks/_done/ for tasks completed today and renders a native
     * <details>/<summary> collapsible section. Renders nothing if no tasks
     * were completed today. Cold-load safe — returns quietly if dependencies
     * are not yet registered. Dual-fire-safe via __renderGen counter.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__taskDoneTodayGen || 0) + 1;
        dv.container.__taskDoneTodayGen = myGen;
        const isStale = () => dv.container.__taskDoneTodayGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' || !TTL || typeof TTL.renderTaskRow !== 'function') return;

        const today = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DD') : '';
        if (!today) return;

        let doneTasks = [];
        try {
            const raw = dv.pages('"spice/tasks/_done"').where(p =>
                p && p.type === 'task' && p.file && !p.file.path.includes('/_trash/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            doneTasks = TaskDoneTodayList.filterToday(arr.map(p => TE.parseNote(p)), today);
        } catch (_e) { return; }

        if (isStale()) return;
        if (!doneTasks.length) return;

        const details = dv.container.createEl('details');
        details.style.cssText = 'width: 100%; box-sizing: border-box; margin-top: 4px;';

        const summary = details.createEl('summary');
        summary.style.cssText = 'cursor: pointer; color: var(--text-muted); font-size: 0.85em; padding: 4px 0; user-select: none; list-style: none;';
        summary.textContent = `Completed (${doneTasks.length})`;

        const list = details.createEl('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin-top: 4px;';

        for (const task of doneTasks) {
            try {
                TTL.renderTaskRow(list, task, null);
                // Pre-check the checkbox — done tasks show as checked.
                try {
                    const row = list.lastElementChild || list.lastChild;
                    const cb = row && row.querySelector && row.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = true;
                } catch (_e) {}
            } catch (_e) {}
        }
    }

    static filterToday(parsedTasks, todayStr) {
        if (!Array.isArray(parsedTasks) || !todayStr) return [];
        return parsedTasks.filter(t => {
            if (!t || !t.completed_at) return false;
            const val = t.completed_at;
            // Dataview parses ISO datetime frontmatter into Luxon DateTime objects.
            if (typeof val === 'object' && val !== null && typeof val.toFormat === 'function') {
                return val.toFormat('yyyy-MM-dd') === todayStr;
            }
            return String(val).slice(0, 10) === todayStr;
        });
    }
}
