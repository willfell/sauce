/**
 * ToDoDailyFilterView (CustomJS) — one flat live task-note list with
 * client-only scope and sort controls. TV-4 mounts this helper in the daily
 * template; TV-3 keeps it independently renderable for behavioral coverage.
 *
 * BARE CLASS ONLY. CustomJS evaluates this file as one expression.
 */
class ToDoDailyFilterView {
    static get STORAGE_KEY() { return 'sauce-todo-filter:state'; }
    static get DEFAULT_SCOPE() { return 'today'; }
    static get SCOPE_KEYS() { return ['today', 'overdue', 'upcoming', 'no-date', 'all']; }

    static _defaultState(date) {
        return {
            scope: ToDoDailyFilterView.DEFAULT_SCOPE,
            includeDone: false,
            sort: 'due',
            groupByProject: false,
            date: String(date == null ? '' : date),
        };
    }

    static _normalizeState(value, date) {
        const wanted = String(date == null ? '' : date);
        if (!value || typeof value !== 'object') return ToDoDailyFilterView._defaultState(wanted);
        // A blob written before the scope bar correction carries `scopes[]` and no
        // `date` key. Discard it whole rather than guessing which single scope an
        // array of scopes meant.
        if (typeof value.date !== 'string' || value.date !== wanted) {
            return ToDoDailyFilterView._defaultState(wanted);
        }
        const scope = String(value.scope == null ? '' : value.scope).trim().toLowerCase();
        return {
            scope: ToDoDailyFilterView.SCOPE_KEYS.includes(scope)
                ? scope
                : ToDoDailyFilterView.DEFAULT_SCOPE,
            includeDone: value.includeDone === true,
            sort: String(value.sort || '').trim().toLowerCase() === 'priority' ? 'priority' : 'due',
            groupByProject: value.groupByProject === true,
            date: wanted,
        };
    }

    static storage() {
        try { return typeof window !== 'undefined' ? window.localStorage : null; }
        catch (_e) { return null; }
    }

    static readState(storage, date) {
        try {
            if (!storage || typeof storage.getItem !== 'function') {
                return ToDoDailyFilterView._defaultState(date);
            }
            const raw = storage.getItem(ToDoDailyFilterView.STORAGE_KEY);
            if (!raw) return ToDoDailyFilterView._defaultState(date);
            return ToDoDailyFilterView._normalizeState(JSON.parse(raw), date);
        } catch (_e) {
            return ToDoDailyFilterView._defaultState(date);
        }
    }

    static writeState(storage, state, date) {
        const normalized = ToDoDailyFilterView._normalizeState(
            { ...(state || {}), date: String(date == null ? '' : date) },
            date,
        );
        try {
            if (storage && typeof storage.setItem === 'function') {
                storage.setItem(ToDoDailyFilterView.STORAGE_KEY, JSON.stringify(normalized));
            }
        } catch (_e) { /* local preference persistence is best-effort */ }
        return normalized;
    }

    static selectByScope(tasks, scope, includeDone, todayIso) {
        const raw = String(scope == null ? '' : scope).trim().toLowerCase();
        const key = ToDoDailyFilterView.SCOPE_KEYS.includes(raw)
            ? raw
            : ToDoDailyFilterView.DEFAULT_SCOPE;
        const all = key === 'all';
        const today = String(todayIso || '');
        return (Array.isArray(tasks) ? tasks : []).filter((task) => {
            if (!task) return false;
            const status = String(task.status || 'open').toLowerCase();
            if (status === 'done') {
                // Completion is an independent include, evaluated for its own sake —
                // never an early return that the `all` widening cannot reach.
                if (!includeDone) return false;
                if (all) return true;
                if (!task.completed_at) return false;
                const completed = task.completed_at;
                if (typeof completed === 'object' && typeof completed.toFormat === 'function') {
                    return completed.toFormat('yyyy-MM-dd') === today;
                }
                return String(completed).slice(0, 10) === today;
            }
            if (status !== 'open') return false;
            if (all) return true;
            const due = task.due == null ? '' : String(task.due).trim();
            if (!due) return key === 'no-date';
            if (due === today) return key === 'today';
            if (due < today) return key === 'overdue';
            return key === 'upcoming';
        });
    }

    static _projectLabel(task) {
        const raw = task && task.project;
        let value = '';
        if (raw && typeof raw === 'object') {
            value = raw.display || raw.name || raw.path || '';
        } else {
            value = raw == null ? '' : String(raw);
        }
        value = String(value).replace(/^\[\[/, '').replace(/\]\]$/, '');
        if (value.includes('|')) value = value.split('|').pop();
        if (value.includes('/')) value = value.split('/').pop();
        value = value.replace(/\.md$/i, '').trim();
        return value || 'No Project';
    }

    static groupByProject(tasks) {
        const groups = new Map();
        for (const task of (Array.isArray(tasks) ? tasks : [])) {
            const label = ToDoDailyFilterView._projectLabel(task);
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(task);
        }
        return [...groups].map(([label, groupedTasks]) => ({ label, tasks: groupedTasks }));
    }

    static priorityLevel(task) {
        const known = ['highest', 'high', 'medium', 'low'];
        const raw = String(task && task.priority || '').trim().toLowerCase();
        return known.includes(raw) ? raw : 'none';
    }

    /**
     * Decorate a row produced by TaskTodayList.renderTaskRow with a priority
     * dot. Deliberately NOT done inside renderTaskRow: that method is shared by
     * the Home, project, meeting and trip lists, and only this surface offers a
     * Priority sort that the dot exists to explain. Every guard degrades to no
     * dot rather than throwing, so a future change to the row's internals
     * cannot break the list.
     */
    static decorateRow(row, task) {
        if (!row || typeof row.querySelector !== 'function') return null;
        let group = null;
        try { group = row.querySelector('.sauce-task-today-titlegroup'); } catch (_e) { group = null; }
        if (!group || typeof group.createEl !== 'function') return null;
        const dot = group.createEl('span', {
            cls: `sauce-task-priority-dot is-${ToDoDailyFilterView.priorityLevel(task)}`,
        });
        if (typeof dot.setAttribute === 'function') dot.setAttribute('aria-hidden', 'true');
        try {
            const cbWrap = group.querySelector('.sauce-task-today-cbwrap');
            if (cbWrap && typeof group.insertBefore === 'function') {
                group.insertBefore(dot, cbWrap.nextSibling);
            }
        } catch (_e) { /* append order is an acceptable fallback */ }
        return dot;
    }

    static noteDate(page) {
        const name = page && page.file && page.file.name;
        const match = /ToDo-(\d{4}-\d{2}-\d{2})/.exec(String(name == null ? '' : name));
        return match ? match[1] : '';
    }

    static _fallbackDue(a, b) {
        const ad = String(a && a.due != null ? a.due : '').trim();
        const bd = String(b && b.due != null ? b.due : '').trim();
        if (ad === bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return ad < bd ? -1 : 1;
    }

    static _fallbackPriority(a, b) {
        const ranks = { highest: 4, high: 3, medium: 2, low: 1 };
        const rank = (task) => ranks[String(task && task.priority || '').trim().toLowerCase()] || 0;
        return rank(b) - rank(a) || ToDoDailyFilterView._fallbackDue(a, b);
    }

    static sortTasks(tasks, mode, dashboardRef) {
        let dashboard = dashboardRef || null;
        if (dashboard && typeof dashboard.compareTasksByDue !== 'function'
            && dashboard.constructor && dashboard.constructor !== Object) {
            dashboard = dashboard.constructor;
        }
        const priority = String(mode || '').toLowerCase() === 'priority';
        const method = priority ? 'compareTasksByPriority' : 'compareTasksByDue';
        const shared = dashboard && typeof dashboard[method] === 'function'
            ? (a, b) => dashboard[method](a, b)
            : (priority ? ToDoDailyFilterView._fallbackPriority : ToDoDailyFilterView._fallbackDue);
        return (Array.isArray(tasks) ? tasks : [])
            .map((task, index) => ({ task, index }))
            .sort((left, right) => shared(left.task, right.task) || left.index - right.index)
            .map((entry) => entry.task);
    }

    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const CJS = typeof window !== 'undefined' && window.customJS ? window.customJS : null;
        const TE = CJS && CJS.TaskEntity;
        const TTL = CJS && CJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function'
            || !TTL || typeof TTL.renderTaskRow !== 'function') return;

        const page = CJS.RenderSafe && typeof CJS.RenderSafe.page === 'function'
            ? CJS.RenderSafe.page(dv)
            : (typeof dv.current === 'function' ? dv.current() : null);
        if (!page) return;

        // Read the live clock exactly once; every scope decision below is pure.
        const todayIso = typeof window.moment === 'function'
            ? window.moment().format('YYYY-MM-DD')
            : '';

        let tasks = [];
        try {
            const raw = dv.pages('"spice/tasks"').where((candidate) =>
                candidate && candidate.type === 'task'
                && (candidate.status === 'open' || candidate.status === 'done')
                && candidate.file && candidate.file.path
                && !candidate.file.path.includes('/_trash/'));
            const pages = raw && typeof raw.array === 'function' ? raw.array() : Array.from(raw || []);
            tasks = pages.map((candidate) => TE.parseNote(candidate));
        } catch (_e) { tasks = []; }

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const storage = ToDoDailyFilterView.storage();
        // Persistence is keyed to the note's own date so opening another day never
        // silently restores a filter chosen on a different one. Scope arithmetic
        // below still resolves against the live clock, not this date.
        const noteDate = ToDoDailyFilterView.noteDate(page);
        let state = ToDoDailyFilterView.readState(storage, noteDate);

        const root = dv.container.createEl('div', { cls: 'sauce-todo-daily-filter-view' });
        root.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

        const controls = root.createEl('div', { cls: 'sauce-todo-filter-controls' });
        const scopeGroup = controls.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-scopes' });
        scopeGroup.setAttribute('role', 'group');
        scopeGroup.setAttribute('aria-label', 'Filter tasks by date scope');

        const rightSide = controls.createEl('div', { cls: 'sauce-todo-filter-right' });
        const doneGroup = rightSide.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-done' });
        doneGroup.setAttribute('role', 'group');
        doneGroup.setAttribute('aria-label', 'Include completed tasks');
        rightSide.createEl('div', { cls: 'sauce-todo-filter-sep' }).setAttribute('aria-hidden', 'true');
        const sortGroup = rightSide.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-sort' });
        sortGroup.setAttribute('role', 'group');
        sortGroup.setAttribute('aria-label', 'Sort tasks');
        rightSide.createEl('div', { cls: 'sauce-todo-filter-sep' }).setAttribute('aria-hidden', 'true');
        const groupGroup = rightSide.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-group' });
        groupGroup.setAttribute('role', 'group');
        groupGroup.setAttribute('aria-label', 'Group tasks');

        root.createEl('div', { cls: 'sauce-todo-filter-rule' }).setAttribute('aria-hidden', 'true');

        const listHost = root.createEl('div', { cls: 'sauce-todo-daily-filter-list-host' });
        listHost.style.cssText = 'display:flex; flex-direction:column; gap:8px; width:100%;';

        const scopeButtons = {};
        const sortButtons = {};
        let doneButton = null;
        let groupButton = null;
        const setPill = (button, active) => {
            button.className = `sauce-pill-toggle${active ? ' is-active' : ''}`;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        };
        const updateButtons = () => {
            for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
                setPill(scopeButtons[key], state.scope === key);
            }
            setPill(doneButton, state.includeDone);
            for (const key of ['due', 'priority']) setPill(sortButtons[key], state.sort === key);
            setPill(groupButton, state.groupByProject);
        };

        const dashboard = CJS.SpaceDailyDashboard || null;
        const TD = CJS.TaskDialog || null;
        const makeList = (parent) => {
            const list = parent.createEl('ul', { cls: 'sauce-todo-daily-filter-list' });
            list.style.cssText = 'display:flex; flex-direction:column; gap:0; margin:0; padding:0; list-style:none; width:100%;';
            return list;
        };
        const renderRows = (list, rows) => {
            for (const task of rows) {
                try {
                    const row = TTL.renderTaskRow(list, task, TD);
                    ToDoDailyFilterView.decorateRow(row, task);
                    if (task.status === 'done' && row && typeof row.querySelector === 'function') {
                        const checkbox = row.querySelector('input[type="checkbox"]');
                        if (checkbox) checkbox.checked = true;
                    }
                } catch (_e) { /* isolate bad notes */ }
            }
        };
        const renderList = () => {
            while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
            const selected = ToDoDailyFilterView.selectByScope(
                tasks, state.scope, state.includeDone, todayIso);
            const sorted = ToDoDailyFilterView.sortTasks(selected, state.sort, dashboard);
            if (!sorted.length) {
                const list = makeList(listHost);
                const empty = list.createEl('li', { cls: 'sauce-todo-filter-empty', text: 'No tasks in this scope.' });
                empty.style.cssText = 'color:var(--text-muted); font-size:0.85em; font-style:italic; padding:6px 0;';
                return;
            }
            if (!state.groupByProject) {
                renderRows(makeList(listHost), sorted);
                return;
            }
            const SL = CJS.SectionLabel || null;
            for (const group of ToDoDailyFilterView.groupByProject(sorted)) {
                const section = listHost.createEl('div', { cls: 'sauce-todo-filter-project-group' });
                const label = section.createEl('div', { cls: 'sauce-todo-filter-project-label' });
                if (SL && typeof SL.render === 'function') {
                    try { SL.render({ ...dv, container: label }, { text: group.label }); }
                    catch (_e) { label.textContent = group.label; }
                } else {
                    label.textContent = group.label;
                    label.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); font-weight:600;';
                }
                renderRows(makeList(section), group.tasks);
            }
        };

        const commit = (next) => {
            state = ToDoDailyFilterView.writeState(storage, next, noteDate);
            updateButtons();
            renderList();
        };
        const onClick = (handler) => (event) => {
            try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
            handler();
        };

        const scopeLabels = {
            today: 'Today', overdue: 'Overdue', upcoming: 'Upcoming',
            'no-date': 'No date', all: 'All',
        };
        for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
            const button = scopeGroup.createEl('button', { text: scopeLabels[key] });
            scopeButtons[key] = button;
            button.setAttribute('type', 'button');
            // Single-select: choosing a scope replaces the previous one. There is no
            // deselect, so a click can never empty the selection.
            button.addEventListener('click', onClick(() => commit({ ...state, scope: key })));
        }

        doneButton = doneGroup.createEl('button', { text: 'Done' });
        doneButton.setAttribute('type', 'button');
        doneButton.addEventListener('click', onClick(
            () => commit({ ...state, includeDone: !state.includeDone })));

        for (const key of ['due', 'priority']) {
            const button = sortGroup.createEl('button', { text: key === 'due' ? 'Due' : 'Priority' });
            sortButtons[key] = button;
            button.setAttribute('type', 'button');
            button.addEventListener('click', onClick(() => commit({ ...state, sort: key })));
        }

        groupButton = groupGroup.createEl('button', { text: 'By Project' });
        groupButton.setAttribute('type', 'button');
        groupButton.addEventListener('click', onClick(
            () => commit({ ...state, groupByProject: !state.groupByProject })));

        updateButtons();
        renderList();
    }
}
