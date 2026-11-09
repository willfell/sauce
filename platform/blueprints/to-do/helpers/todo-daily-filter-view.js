/**
 * ToDoDailyFilterView (CustomJS) — the daily To-Do view: a tab bar (Today /
 * This week / Overdue / Backlog / All open), Sort and Group menus, one flat
 * live task-note list and, on the Today tab, a Done today section. Tab, sort
 * and group persist under one device-wide prefs key (not keyed by note date).
 * TV-4 mounts this helper in the daily template; TV-3 keeps it independently
 * renderable for behavioral coverage.
 *
 * Render layout (hosts are stable so later features slot in without touching
 * the paint code): above-tabs host, controls row (tabs left, `right` cluster
 * for Sort / Group), rule, list host, done host.
 *
 * BARE CLASS ONLY. CustomJS evaluates this file as one expression.
 */
class ToDoDailyFilterView {
    static get PREFS_KEY() { return 'sauce-todo-filter:prefs:v2'; }
    static get TABS() { return ['today', 'week', 'overdue', 'backlog', 'all']; }
    static get SORT_MODES() { return ['smart', 'manual', 'priority', 'due', 'oldest', 'touched']; }
    static get GROUP_MODES() { return ['none', 'project', 'priority', 'due']; }
    static get STALE_DIVIDER_LABEL() { return 'Stale · overdue 30+ days'; }

    static get SORT_OPTIONS() {
        return [
            { key: 'smart', label: 'Smart', sublabel: 'your order → priority → days late' },
            { key: 'manual', label: 'My order', sublabel: 'drag to arrange' },
            { key: 'priority', label: 'Priority', sublabel: 'highest first' },
            { key: 'due', label: 'Due date', sublabel: 'soonest first' },
            { key: 'oldest', label: 'Oldest first', sublabel: 'by created date' },
            { key: 'touched', label: 'Last touched', sublabel: 'recently edited first' },
        ];
    }

    static get GROUP_OPTIONS() {
        return [
            { key: 'none', label: 'None', sublabel: '' },
            { key: 'project', label: 'Project', sublabel: '' },
            { key: 'priority', label: 'Priority', sublabel: '' },
            { key: 'due', label: 'Due day', sublabel: '' },
        ];
    }

    static _defaultPrefs() { return { tab: 'today', sort: 'smart', group: 'none' }; }

    static _normalizePrefs(value) {
        const out = ToDoDailyFilterView._defaultPrefs();
        if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
        if (ToDoDailyFilterView.TABS.includes(value.tab)) out.tab = value.tab;
        if (ToDoDailyFilterView.SORT_MODES.includes(value.sort)) out.sort = value.sort;
        if (ToDoDailyFilterView.GROUP_MODES.includes(value.group)) out.group = value.group;
        return out;
    }

    static storage() {
        try { return typeof window !== 'undefined' ? window.localStorage : null; }
        catch (_e) { return null; }
    }

    static _readRaw(storage) {
        try {
            if (!storage || typeof storage.getItem !== 'function') return {};
            const raw = storage.getItem(ToDoDailyFilterView.PREFS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_e) { return {}; }
    }

    static readPrefs(storage) {
        return ToDoDailyFilterView._normalizePrefs(ToDoDailyFilterView._readRaw(storage));
    }

    /**
     * Read-merge-write: keys this view does not own survive, and the owned keys
     * are normalised per key. Persistence is best-effort and never throws.
     */
    static writePrefs(storage, patch) {
        const raw = ToDoDailyFilterView._readRaw(storage);
        const merged = ToDoDailyFilterView._normalizePrefs({ ...raw, ...(patch || {}) });
        try {
            if (storage && typeof storage.setItem === 'function') {
                storage.setItem(ToDoDailyFilterView.PREFS_KEY, JSON.stringify({ ...raw, ...merged }));
            }
        } catch (_e) { /* local preference persistence is best-effort */ }
        return merged;
    }

    static _te(ref) {
        if (ref) return ref;
        try {
            return (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null;
        } catch (_e) { return null; }
    }

    static _dueOf(task) {
        const v = task && task.due;
        if (v == null || v === '') return '';
        if (typeof v === 'string') {
            const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(v);
            return m ? m[1] : '';
        }
        try {
            if (typeof v.toISODate === 'function') return v.toISODate() || '';
            if (typeof v.toFormat === 'function') return v.toFormat('yyyy-MM-dd') || '';
        } catch (_e) { return ''; }
        return '';
    }

    static _openTasks(tasks) {
        return (Array.isArray(tasks) ? tasks : []).filter((task) =>
            task && String(task.status || 'open').toLowerCase() === 'open');
    }

    /** Monday..Sunday (inclusive) of the ISO week holding `todayStr`. */
    static weekRange(todayStr, TEref) {
        const TE = ToDoDailyFilterView._te(TEref);
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(todayStr == null ? '' : todayStr));
        if (!TE || !m) return null;
        const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
        const monday = TE.addDays(todayStr, -((dow + 6) % 7));
        const sunday = TE.addDays(monday, 6);
        return monday && sunday ? { from: monday, to: sunday } : null;
    }

    /** Overdue (1..29 days late) and stale (30+) open tasks, each in input order. */
    static splitOverdue(tasks, todayStr, TEref) {
        const TE = ToDoDailyFilterView._te(TEref);
        const out = { overdue: [], stale: [] };
        if (!TE) return out;
        for (const task of ToDoDailyFilterView._openTasks(tasks)) {
            const bucket = TE.bucketOf(task, todayStr);
            if (bucket === 'overdue') out.overdue.push(task);
            else if (bucket === 'stale') out.stale.push(task);
        }
        return out;
    }

    static selectTab(tasks, tab, todayStr, TEref) {
        const TE = ToDoDailyFilterView._te(TEref);
        if (!TE) return [];
        const open = ToDoDailyFilterView._openTasks(tasks);
        const key = ToDoDailyFilterView.TABS.includes(tab) ? tab : 'today';
        switch (key) {
            case 'all':
                return open;
            case 'backlog':
                return open.filter((task) => TE.isBacklog(task));
            case 'overdue': {
                const split = ToDoDailyFilterView.splitOverdue(open, todayStr, TE);
                return [...split.overdue, ...split.stale];
            }
            case 'week': {
                const range = ToDoDailyFilterView.weekRange(todayStr, TE);
                if (!range) return [];
                return open.filter((task) => {
                    const bucket = TE.bucketOf(task, todayStr);
                    if (bucket !== 'today' && bucket !== 'upcoming') return false;
                    const due = ToDoDailyFilterView._dueOf(task);
                    return due >= range.from && due <= range.to;
                });
            }
            default:
                return open.filter((task) => TE.bucketOf(task, todayStr) === 'today');
        }
    }

    /** Done tasks completed on `todayStr`, latest completion first. */
    static doneToday(tasks, todayStr, TEref, TTLref) {
        const TE = ToDoDailyFilterView._te(TEref);
        const TTL = TTLref
            || (typeof window !== 'undefined' && window.customJS && window.customJS.TaskTodayList) || null;
        if (!TE || !TTL) return [];
        return (Array.isArray(tasks) ? tasks : [])
            .filter((task) => task && task.status === 'done' && TE.completedDay(task) === todayStr)
            .map((task, index) => ({ task, index, time: TTL.doneTimeLabel(task) }))
            .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : a.index - b.index))
            .map((entry) => entry.task);
    }

    static sortTasks(tasks, mode, todayStr, TEref) {
        const list = Array.isArray(tasks) ? tasks : [];
        const TE = ToDoDailyFilterView._te(TEref);
        if (!TE || typeof TE.compareBy !== 'function') return list.slice();
        const compare = TE.compareBy(mode, todayStr);
        return list
            .map((task, index) => ({ task, index }))
            .sort((a, b) => compare(a.task, b.task) || a.index - b.index)
            .map((entry) => entry.task);
    }

    static groupTasks(tasks, group, _todayStr) {
        const list = Array.isArray(tasks) ? tasks : [];
        if (!list.length) return [];
        const push = (groups, label, task) => {
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(task);
        };
        switch (group) {
            case 'project': {
                const groups = ToDoDailyFilterView.groupByProject(list);
                const none = groups.findIndex((g) => g.label === 'No project');
                if (none >= 0 && none !== groups.length - 1) groups.push(groups.splice(none, 1)[0]);
                return groups;
            }
            case 'priority': {
                const order = ['highest', 'high', 'medium', 'low', 'none'];
                const labels = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', none: 'None' };
                const groups = new Map(order.map((level) => [labels[level], []]));
                for (const task of list) push(groups, labels[ToDoDailyFilterView.priorityLevel(task)], task);
                return [...groups].map(([label, rows]) => ({ label, tasks: rows })).filter((g) => g.tasks.length);
            }
            case 'due': {
                const dated = new Map();
                const undated = [];
                for (const task of list) {
                    const due = ToDoDailyFilterView._dueOf(task);
                    if (due) push(dated, due, task);
                    else undated.push(task);
                }
                const out = [...dated.keys()].sort().map((due) => ({
                    label: ToDoDailyFilterView._dayLabel(due), tasks: dated.get(due),
                }));
                if (undated.length) out.push({ label: 'No date', tasks: undated });
                return out;
            }
            default:
                return [{ label: '', tasks: list.slice() }];
        }
    }

    static _dayLabel(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
        if (!m) return String(dateStr);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${+m[3]}`;
    }

    /** The date a ToDo-YYYY-MM-DD note shows; any other note shows `todayStr`. */
    static viewedDay(page, todayStr) {
        const name = page && page.file && page.file.name;
        const match = /ToDo-(\d{4}-\d{2}-\d{2})/.exec(String(name == null ? '' : name));
        return match ? match[1] : String(todayStr == null ? '' : todayStr);
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
        return value || 'No project';
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
     * dot. No longer called by the filter view: renderTaskRow now draws its own
     * `.sauce-task-prio-bar` on every row, so adding the dot too would double
     * the marker. Retained as a standalone, guarded helper.
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

    static _addClass(el, cls) {
        if (!el) return;
        try {
            if (el.classList && typeof el.classList.add === 'function') { el.classList.add(cls); return; }
        } catch (_e) { /* fall through to className */ }
        el.className = `${el.className || ''} ${cls}`.trim();
    }

    static _notice(message) {
        try {
            const Ctor = (typeof Notice !== 'undefined' && Notice)
                || (typeof window !== 'undefined' && window.Notice) || null;
            if (Ctor) new Ctor(message);
        } catch (_e) { /* a Notice must never break a gesture */ }
    }

    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const View = ToDoDailyFilterView;
        const CJS = typeof window !== 'undefined' && window.customJS ? window.customJS : null;
        const TE = CJS && CJS.TaskEntity;
        const TTL = CJS && CJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function'
            || !TTL || typeof TTL.renderTaskRow !== 'function') return;

        const page = CJS.RenderSafe && typeof CJS.RenderSafe.page === 'function'
            ? CJS.RenderSafe.page(dv)
            : (typeof dv.current === 'function' ? dv.current() : null);
        if (!page) return;

        // Read the live clock exactly once; every decision below is pure on it.
        const todayStr = typeof window.moment === 'function'
            ? window.moment().format('YYYY-MM-DD')
            : '';
        if (!todayStr) return;
        const viewedDay = View.viewedDay(page, todayStr);

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

        const storage = View.storage();
        let prefs = View.readPrefs(storage);
        const TD = CJS.TaskDialog || null;
        const SL = CJS.SectionLabel || null;

        const root = dv.container.createEl('div', { cls: 'sauce-todo-daily-filter-view' });
        root.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

        root.createEl('div', { cls: 'sauce-todo-above-tabs' });
        const controls = root.createEl('div', { cls: 'sauce-todo-filter-controls' });
        const tabGroup = controls.createEl('div', { cls: 'sauce-pill-group sauce-todo-filter-tabs' });
        tabGroup.setAttribute('role', 'tablist');
        tabGroup.setAttribute('aria-label', 'Task view');
        const rightSide = controls.createEl('div', { cls: 'sauce-todo-filter-right' });
        root.createEl('div', { cls: 'sauce-todo-filter-rule' }).setAttribute('aria-hidden', 'true');
        const listHost = root.createEl('div', { cls: 'sauce-todo-daily-filter-list-host' });
        listHost.style.cssText = 'display:flex; flex-direction:column; gap:8px; width:100%;';
        const doneHost = root.createEl('div', { cls: 'sauce-todo-filter-done-host' });
        doneHost.style.cssText = 'display:flex; flex-direction:column; gap:4px; width:100%;';

        const clear = (host) => { while (host.firstChild) host.removeChild(host.firstChild); };
        const label = (parent, text) => {
            const holder = parent.createEl('div', { cls: 'sauce-todo-filter-section-label' });
            if (SL && typeof SL.render === 'function') {
                try { SL.render({ ...dv, container: holder }, { text }); return holder; }
                catch (_e) { /* fall through to plain text */ }
            }
            holder.textContent = text;
            holder.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); font-weight:600;';
            return holder;
        };
        const makeList = (parent) => {
            const list = parent.createEl('ul', { cls: 'sauce-todo-daily-filter-list' });
            list.style.cssText = 'display:flex; flex-direction:column; gap:0; margin:0; padding:0; list-style:none; width:100%;';
            return list;
        };

        const TAB_LABELS = { today: 'Today', week: 'This week', overdue: 'Overdue', backlog: 'Backlog', all: 'All open' };
        const tabButtons = {};
        const tabText = (key) => {
            if (key !== 'overdue' && key !== 'backlog') return TAB_LABELS[key];
            const n = View.selectTab(tasks, key, todayStr, TE).length;
            return n > 0 ? `${TAB_LABELS[key]} · ${n}` : TAB_LABELS[key];
        };
        const setPill = (button, active) => {
            button.className = `sauce-pill-toggle${active ? ' is-active' : ''}`;
        };
        const updateControls = () => {
            for (const key of View.TABS) {
                const button = tabButtons[key];
                button.textContent = tabText(key);
                setPill(button, prefs.tab === key);
                button.setAttribute('aria-selected', prefs.tab === key ? 'true' : 'false');
            }
            setPill(sortButton, prefs.sort !== 'smart');
            setPill(groupButton, prefs.group !== 'none');
        };

        const renderRow = (list, task, stale) => {
            let row = null;
            try {
                row = TTL.renderTaskRow(list, task, TD, {
                    viewedDay,
                    todayStr,
                    onRescheduled: (moved, due) => {
                        const live = tasks.find((t) => t.path && t.path === moved.path) || moved;
                        live.due = due || null;
                        live.rank = null;
                        paint();
                    },
                });
            } catch (_e) { return; }
            if (stale && row) {
                View._addClass(row, 'is-stale');
                if (row.style) row.style.opacity = '0.6';
            }
        };
        const paintRows = (host, rows, stale) => {
            const sorted = View.sortTasks(rows, prefs.sort, todayStr, TE);
            if (prefs.group === 'none') {
                const list = makeList(host);
                for (const task of sorted) renderRow(list, task, stale);
                return;
            }
            for (const group of View.groupTasks(sorted, prefs.group, todayStr)) {
                const section = host.createEl('div', { cls: 'sauce-todo-filter-project-group' });
                label(section, group.label);
                const list = makeList(section);
                for (const task of group.tasks) renderRow(list, task, stale);
            }
        };
        const paintList = () => {
            clear(listHost);
            if (prefs.tab === 'overdue') {
                const split = View.splitOverdue(tasks, todayStr, TE);
                if (!split.overdue.length && !split.stale.length) { paintEmpty(); return; }
                if (split.overdue.length) paintRows(listHost, split.overdue, false);
                if (split.stale.length) {
                    const divider = listHost.createEl('div', {
                        cls: 'sauce-todo-stale-divider', text: View.STALE_DIVIDER_LABEL,
                    });
                    divider.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); font-weight:600; padding-top:6px; border-top:1px solid var(--background-modifier-border);';
                    paintRows(listHost, split.stale, true);
                }
                return;
            }
            const rows = View.selectTab(tasks, prefs.tab, todayStr, TE);
            if (!rows.length) { paintEmpty(); return; }
            paintRows(listHost, rows, false);
        };
        const paintEmpty = () => {
            const list = makeList(listHost);
            const empty = list.createEl('li', { cls: 'sauce-todo-filter-empty', text: 'No tasks in this view.' });
            empty.style.cssText = 'color:var(--text-muted); font-size:0.85em; font-style:italic; padding:6px 0;';
        };

        const reopen = async (task, undo) => {
            if (undo.disabled) return;
            undo.disabled = true;
            let res = null;
            const dialog = CJS.TaskDialog;
            try { res = dialog && typeof dialog.reopen === 'function' ? await dialog.reopen(task.path) : null; }
            catch (_e) { res = null; }
            const outcome = TTL.classifyOutcome(res);
            if (outcome === 'ok') {
                task.status = 'open';
                task.completed_at = null;
                task.path = res.path || task.path;
                paint();
                return;
            }
            undo.disabled = false;
            if (outcome === 'silent') View._notice(`Could not reopen task: ${(res && res.reason) || 'unknown'}`);
        };
        const paintDone = () => {
            clear(doneHost);
            if (prefs.tab !== 'today' || typeof TTL.renderDoneRow !== 'function') return;
            const done = View.doneToday(tasks, todayStr, TE, TTL);
            if (!done.length) return;
            label(doneHost, `Done today · ${done.length}`);
            for (const task of done) {
                TTL.renderDoneRow(doneHost, task, { TD, notice: View._notice, onUndo: reopen });
            }
        };
        const paint = () => {
            try {
                updateControls();
                paintList();
                paintDone();
            } catch (e) {
                try { console.warn('[ToDoDailyFilterView] render failed', e); } catch (_e) { /* no console */ }
            }
        };

        const commit = (patch) => {
            prefs = View.writePrefs(storage, { ...prefs, ...patch });
            paint();
        };
        const onClick = (handler) => (event) => {
            try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
            return handler();
        };

        const openMenu = (anchor, options, key, current) => {
            const MP = CJS.MenuPopover;
            if (MP && typeof MP.open === 'function') {
                MP.open(options.map((option) => ({
                    label: option.label,
                    ...(option.sublabel ? { sublabel: option.sublabel } : {}),
                    ...(option.key === prefs[key] ? { icon: '✓' } : {}),
                    onSelect: () => { commit({ [key]: option.key }); },
                })), { anchor });
                return;
            }
            const index = options.findIndex((option) => option.key === current);
            commit({ [key]: options[(index + 1) % options.length].key });
        };

        for (const key of View.TABS) {
            const button = tabGroup.createEl('button', { text: TAB_LABELS[key] });
            tabButtons[key] = button;
            button.setAttribute('type', 'button');
            button.setAttribute('role', 'tab');
            button.addEventListener('click', onClick(() => {
                if (prefs.tab === key) return;
                commit({ tab: key });
            }));
        }
        const sortButton = rightSide.createEl('button', { text: 'Sort ▾' });
        sortButton.setAttribute('type', 'button');
        sortButton.setAttribute('aria-haspopup', 'menu');
        sortButton.addEventListener('click', onClick(
            () => openMenu(sortButton, View.SORT_OPTIONS, 'sort', prefs.sort)));
        const groupButton = rightSide.createEl('button', { text: 'Group ▾' });
        groupButton.setAttribute('type', 'button');
        groupButton.setAttribute('aria-haspopup', 'menu');
        groupButton.addEventListener('click', onClick(
            () => openMenu(groupButton, View.GROUP_OPTIONS, 'group', prefs.group)));

        paint();
    }
}
