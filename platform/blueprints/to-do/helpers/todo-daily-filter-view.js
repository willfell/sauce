/**
 * ToDoDailyFilterView (CustomJS) — one flat live task-note list with
 * client-only scope and sort controls. TV-4 mounts this helper in the daily
 * template; TV-3 keeps it independently renderable for behavioral coverage.
 *
 * BARE CLASS ONLY. CustomJS evaluates this file as one expression.
 */
class ToDoDailyFilterView {
    static get STORAGE_KEY() { return 'sauce-todo-filter:state'; }
    static get DEFAULT_SCOPES() { return ['today', 'overdue']; }
    static get SCOPE_KEYS() { return ['today', 'overdue', 'upcoming', 'no-date', 'all', 'done']; }

    static _defaultState() {
        return { scopes: ToDoDailyFilterView.DEFAULT_SCOPES, sort: 'due', groupByProject: false };
    }

    static _normalizeState(value) {
        if (!value || typeof value !== 'object' || !Array.isArray(value.scopes)) {
            return ToDoDailyFilterView._defaultState();
        }
        const allowed = new Set(ToDoDailyFilterView.SCOPE_KEYS);
        const scopes = [];
        for (const raw of value.scopes) {
            const scope = String(raw == null ? '' : raw).trim().toLowerCase();
            if (allowed.has(scope) && !scopes.includes(scope)) scopes.push(scope);
        }
        if (!scopes.length) return ToDoDailyFilterView._defaultState();
        const sort = String(value.sort || '').trim().toLowerCase() === 'priority'
            ? 'priority'
            : 'due';
        return { scopes, sort, groupByProject: value.groupByProject === true };
    }

    static storage() {
        try { return typeof window !== 'undefined' ? window.localStorage : null; }
        catch (_e) { return null; }
    }

    static readState(storage) {
        try {
            if (!storage || typeof storage.getItem !== 'function') {
                return ToDoDailyFilterView._defaultState();
            }
            const raw = storage.getItem(ToDoDailyFilterView.STORAGE_KEY);
            if (!raw) return ToDoDailyFilterView._defaultState();
            return ToDoDailyFilterView._normalizeState(JSON.parse(raw));
        } catch (_e) {
            return ToDoDailyFilterView._defaultState();
        }
    }

    static writeState(storage, state) {
        const normalized = ToDoDailyFilterView._normalizeState(state);
        try {
            if (storage && typeof storage.setItem === 'function') {
                storage.setItem(ToDoDailyFilterView.STORAGE_KEY, JSON.stringify(normalized));
            }
        } catch (_e) { /* local preference persistence is best-effort */ }
        return normalized;
    }

    static selectByScope(tasks, scopeSet, todayIso) {
        const scopes = scopeSet instanceof Set
            ? scopeSet
            : new Set(Array.isArray(scopeSet) ? scopeSet : []);
        const all = scopes.has('all');
        const today = String(todayIso || '');
        return (Array.isArray(tasks) ? tasks : []).filter((task) => {
            if (!task) return false;
            const status = String(task.status || 'open').toLowerCase();
            if (status === 'done') {
                if (!scopes.has('done') || !task.completed_at) return false;
                const completed = task.completed_at;
                if (typeof completed === 'object' && typeof completed.toFormat === 'function') {
                    return completed.toFormat('yyyy-MM-dd') === today;
                }
                return String(completed).slice(0, 10) === today;
            }
            if (status !== 'open') return false;
            const due = task.due == null ? '' : String(task.due).trim();
            if (all) return true;
            if (!due) return scopes.has('no-date');
            if (due === today) return scopes.has('today');
            if (due < today) return scopes.has('overdue');
            return scopes.has('upcoming');
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
        let state = ToDoDailyFilterView.readState(storage);
        const root = dv.container.createEl('div', { cls: 'sauce-todo-daily-filter-view' });
        root.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

        const controls = root.createEl('div', { cls: 'sauce-todo-filter-controls' });
        controls.style.cssText = 'display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;';
        const scopeGroup = controls.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-scopes' });
        scopeGroup.setAttribute('role', 'group');
        scopeGroup.setAttribute('aria-label', 'Filter tasks by date scope');
        const sortGroup = controls.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-sort' });
        sortGroup.setAttribute('role', 'group');
        sortGroup.setAttribute('aria-label', 'Sort tasks');
        const listHost = root.createEl('div', { cls: 'sauce-todo-daily-filter-list-host' });
        listHost.style.cssText = 'display:flex; flex-direction:column; gap:8px; width:100%;';

        const scopeButtons = {};
        const sortButtons = {};
        let groupButton = null;
        const updateButtons = () => {
            for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
                const active = state.scopes.includes(key);
                scopeButtons[key].className = `sauce-pill-toggle${active ? ' is-active' : ''}`;
                scopeButtons[key].setAttribute('aria-pressed', active ? 'true' : 'false');
            }
            for (const key of ['due', 'priority']) {
                const active = state.sort === key;
                sortButtons[key].className = `sauce-pill-toggle${active ? ' is-active' : ''}`;
                sortButtons[key].setAttribute('aria-pressed', active ? 'true' : 'false');
            }
            groupButton.className = `sauce-pill-toggle${state.groupByProject ? ' is-active' : ''}`;
            groupButton.setAttribute('aria-pressed', state.groupByProject ? 'true' : 'false');
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
                    if (task.status === 'done' && row && typeof row.querySelector === 'function') {
                        const checkbox = row.querySelector('input[type="checkbox"]');
                        if (checkbox) checkbox.checked = true;
                    }
                } catch (_e) { /* isolate bad notes */ }
            }
        };
        const renderList = () => {
            while (listHost.firstChild) listHost.removeChild(listHost.firstChild);
            const selected = ToDoDailyFilterView.selectByScope(tasks, new Set(state.scopes), todayIso);
            const sorted = ToDoDailyFilterView.sortTasks(selected, state.sort, dashboard);
            if (!sorted.length) {
                const list = makeList(listHost);
                const empty = list.createEl('li', { cls: 'sauce-todo-filter-empty', text: 'No tasks in the selected scopes.' });
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

        const scopeLabels = {
            today: 'Today', overdue: 'Overdue', upcoming: 'Upcoming',
            'no-date': 'No date', all: 'All', done: 'Done',
        };
        for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
            const button = scopeGroup.createEl('button', { text: scopeLabels[key] });
            scopeButtons[key] = button;
            button.setAttribute('type', 'button');
            button.addEventListener('click', (event) => {
                try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
                if (key === 'all') {
                    state = { ...state, scopes: state.scopes.includes('done') ? ['all', 'done'] : ['all'] };
                } else if (key === 'done') {
                    const next = [...state.scopes];
                    const index = next.indexOf('done');
                    if (index >= 0) next.splice(index, 1); else next.push('done');
                    state = { ...state, scopes: next };
                } else {
                    const keepDone = state.scopes.includes('done');
                    const next = state.scopes.filter((scope) => scope !== 'all' && scope !== 'done');
                    const index = next.indexOf(key);
                    if (index >= 0) next.splice(index, 1); else next.push(key);
                    if (keepDone) next.push('done');
                    state = { ...state, scopes: next };
                }
                state = ToDoDailyFilterView.writeState(storage, state);
                updateButtons();
                renderList();
            });
        }

        for (const key of ['due', 'priority']) {
            const button = sortGroup.createEl('button', { text: key === 'due' ? 'Due' : 'Priority' });
            sortButtons[key] = button;
            button.setAttribute('type', 'button');
            button.addEventListener('click', (event) => {
                try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
                state = ToDoDailyFilterView.writeState(storage, { ...state, sort: key });
                updateButtons();
                renderList();
            });
        }

        groupButton = sortGroup.createEl('button', { text: 'By Project' });
        groupButton.setAttribute('type', 'button');
        groupButton.addEventListener('click', (event) => {
            try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
            state = ToDoDailyFilterView.writeState(storage, {
                ...state, groupByProject: !state.groupByProject,
            });
            updateButtons();
            renderList();
        });

        updateButtons();
        renderList();
    }
}
