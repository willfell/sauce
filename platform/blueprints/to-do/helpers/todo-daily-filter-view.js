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
    static get SCOPE_KEYS() { return ['today', 'overdue', 'upcoming', 'no-date', 'all']; }

    static _defaultState() {
        return { scopes: ToDoDailyFilterView.DEFAULT_SCOPES, sort: 'due' };
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
        return { scopes, sort };
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
            if (!task || String(task.status || 'open').toLowerCase() !== 'open') return false;
            const due = task.due == null ? '' : String(task.due).trim();
            if (all) return true;
            if (!due) return scopes.has('no-date');
            if (due === today) return scopes.has('today');
            if (due < today) return scopes.has('overdue');
            return scopes.has('upcoming');
        });
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
                candidate && candidate.type === 'task' && candidate.status === 'open'
                && candidate.file && candidate.file.path
                && !candidate.file.path.includes('/_trash/')
                && !candidate.file.path.includes('/_done/'));
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
        const list = root.createEl('ul', { cls: 'sauce-todo-daily-filter-list' });
        list.style.cssText = 'display:flex; flex-direction:column; gap:0; margin:0; padding:0; list-style:none; width:100%;';

        const scopeButtons = {};
        const sortButtons = {};
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
        };

        const dashboard = CJS.SpaceDailyDashboard || null;
        const TD = CJS.TaskDialog || null;
        const renderList = () => {
            while (list.firstChild) list.removeChild(list.firstChild);
            const selected = ToDoDailyFilterView.selectByScope(tasks, new Set(state.scopes), todayIso);
            const sorted = ToDoDailyFilterView.sortTasks(selected, state.sort, dashboard);
            for (const task of sorted) {
                try { TTL.renderTaskRow(list, task, TD); } catch (_e) { /* isolate bad notes */ }
            }
            if (!sorted.length) {
                const empty = list.createEl('li', { cls: 'sauce-todo-filter-empty', text: 'No tasks in the selected scopes.' });
                empty.style.cssText = 'color:var(--text-muted); font-size:0.85em; font-style:italic; padding:6px 0;';
            }
        };

        const scopeLabels = {
            today: 'Today', overdue: 'Overdue', upcoming: 'Upcoming',
            'no-date': 'No date', all: 'All',
        };
        for (const key of ToDoDailyFilterView.SCOPE_KEYS) {
            const button = scopeGroup.createEl('button', { text: scopeLabels[key] });
            scopeButtons[key] = button;
            button.setAttribute('type', 'button');
            button.addEventListener('click', (event) => {
                try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
                if (key === 'all') {
                    state = { ...state, scopes: ['all'] };
                } else {
                    const next = state.scopes.includes('all') ? [] : [...state.scopes];
                    const index = next.indexOf(key);
                    if (index >= 0) next.splice(index, 1); else next.push(key);
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

        updateButtons();
        renderList();
    }
}
