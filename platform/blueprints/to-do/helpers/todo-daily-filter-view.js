/**
 * ToDoDailyFilterView (CustomJS) — the daily To-Do view: a tab bar (Today /
 * This week / Overdue / Backlog / All open), Sort and Group menus, one flat
 * live task-note list and, on the Today tab, a Done today section. Tab, sort
 * and group persist under one device-wide prefs key (not keyed by note date).
 * TV-4 mounts this helper in the daily template; TV-3 keeps it independently
 * renderable for behavioral coverage.
 *
 * Render layout (hosts are stable so later features slot in without touching
 * the paint code): above-tabs host (week strip), controls row (tabs left,
 * `right` cluster for Sort / Group / Select), rule, list host, done host, bulk
 * host (floating bar while tasks are selected).
 *
 * Gestures: Select mode adds selection squares and a bulk bar whose actions
 * run one task at a time through the row write paths (reschedule, setFields,
 * markDone). On the Today tab with Smart / My order and no grouping, rows can
 * be reordered (drag, or ⋯ Move up / down), which renumbers `rank`. Any row
 * can be dropped on a week-strip day to reschedule it there.
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

    static get BULK_PRIORITY_OPTIONS() {
        return [
            { label: 'None', value: '' },
            { label: 'Low', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High', value: 'high' },
            { label: 'Highest', value: 'highest' },
        ];
    }

    /**
     * Stylesheet for the floating bulk bar. It lives in a stylesheet (not
     * inline styles) because the narrow-width rule needs a media query.
     */
    static get BULKBAR_CSS() {
        return [
            '.sauce-todo-bulkbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; align-self: center; max-width: 100%; box-sizing: border-box; padding: 6px 10px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px); background: var(--background-primary); box-shadow: var(--shadow-s, 0 2px 8px rgba(0, 0, 0, 0.15)); }',
            '.sauce-todo-bulkbar .sauce-todo-bulk-count { font-size: 0.85em; font-weight: 600; color: var(--text-muted); margin-right: 4px; }',
            '.sauce-todo-bulkbar button { font-size: 0.85em; }',
            '@media (max-width: 720px) { .sauce-todo-bulkbar { width: 100%; align-self: stretch; } }',
        ].join('\n');
    }

    /**
     * Pure manual-order renumber: the { path, rank } writes that make rank equal
     * position + 1, only for rows whose rank changes. One implementation lives
     * in TaskEntity.renumber; before TaskEntity loads nothing is renumbered.
     */
    static renumber(orderedPaths, rankByPath, TEref) {
        const TE = ToDoDailyFilterView._te(TEref);
        return TE && typeof TE.renumber === 'function' ? TE.renumber(orderedPaths, rankByPath) : [];
    }

    /**
     * Cells for the week strip above the tabs: Monday..Friday of the week
     * holding `todayStr` always, Saturday / Sunday only when they hold open
     * tasks. `count` is the open tasks due that day.
     */
    static weekStrip(tasks, todayStr, TEref) {
        const TE = ToDoDailyFilterView._te(TEref);
        const range = ToDoDailyFilterView.weekRange(todayStr, TE);
        if (!range) return [];
        const counts = new Map();
        for (const task of ToDoDailyFilterView._openTasks(tasks)) {
            const due = ToDoDailyFilterView._dueOf(task);
            if (due) counts.set(due, (counts.get(due) || 0) + 1);
        }
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const out = [];
        for (let i = 0; i < 7; i += 1) {
            const date = TE.addDays(range.from, i);
            if (!date) return [];
            const count = counts.get(date) || 0;
            if (i >= 5 && count === 0) continue;
            out.push({ date, label: `${days[i]} ${Number(date.slice(8))}`, count, isToday: date === todayStr });
        }
        return out;
    }

    /**
     * Run one bulk action over `paths`, one task at a time. `action(path)`
     * resolves the write result; deps.classify maps it to ok / skipped /
     * silent / noticed. Skipped results are neither done nor failed. One Notice
     * (deps.notice) summarises the failures the write rail did not already
     * announce: 'silent' ones, or every failure when deps.noticeAll is set.
     */
    static async runBulk(paths, action, deps) {
        const d = deps || {};
        const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
        const classify = typeof d.classify === 'function'
            ? d.classify
            : (res) => (res && res.ok === true ? 'ok' : res && res.no_op ? 'skipped' : 'silent');
        const done = [];
        const failed = [];
        let unannounced = 0;
        for (const p of list) {
            let res = null;
            try { res = typeof action === 'function' ? await action(p) : null; } catch (_e) { res = null; }
            let outcome = 'silent';
            try { outcome = classify(res); } catch (_e) { outcome = 'silent'; }
            if (outcome === 'ok') {
                done.push(p);
                try { if (typeof d.onOk === 'function') d.onOk(p, res); } catch (_e) { /* cache patch is best-effort */ }
            } else if (outcome !== 'skipped') {
                failed.push(p);
                if (outcome === 'silent' || d.noticeAll) unannounced += 1;
            }
        }
        if (unannounced > 0 && typeof d.notice === 'function') {
            try {
                d.notice(`Could not ${d.verb || 'update'} ${unannounced} ${unannounced === 1 ? 'task' : 'tasks'}`);
            } catch (_e) { /* a Notice must never break a gesture */ }
        }
        return { done, failed };
    }

    /** Stand-in row for a selected task that is not painted on the current tab. */
    static _detachedRow() {
        return { dataset: {}, parentNode: null, remove() {} };
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

        root.createEl('style').textContent = View.BULKBAR_CSS;
        const aboveTabs = root.createEl('div', { cls: 'sauce-todo-above-tabs' });
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
        const bulkHost = root.createEl('div', { cls: 'sauce-todo-bulk-host' });
        bulkHost.style.cssText = 'display:flex; flex-direction:column; position:sticky; bottom:12px; z-index:5; width:100%;';

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
            setPill(selectButton, selecting);
            selectButton.setAttribute('aria-pressed', selecting ? 'true' : 'false');
        };

        // Gesture state that lives only as long as this render: selection is
        // in memory (never persisted) and survives tab switches; leaving Select
        // mode clears it.
        let selecting = false;
        const selected = new Set();
        let bulkBusy = false;
        let reordering = false;
        let dragPath = null;
        let focusDay = null;
        let manualOrder = [];
        const rowByPath = new Map();

        const taskByPath = (taskPath) => tasks.find((t) => t && t.path && t.path === taskPath) || null;
        const applyMoved = (task, due) => {
            if (!task) return;
            task.due = due || null;
            task.rank = null;
        };
        const applyDone = (task) => {
            if (!task) return;
            selected.delete(task.path);
            // A recurring completion rolls `due` forward in place and never
            // reaches _done/. The new date is unknown here, so the task leaves
            // the open lists until Dataview's own refresh brings it back.
            if (task.recurrence) { task.status = 'rolled'; return; }
            task.status = 'done';
            task.completed_at = todayStr;
            try { if (TD && typeof TD.donePath === 'function') task.path = TD.donePath(task.path) || task.path; }
            catch (_e) { /* keep the open path */ }
        };
        const canReorder = () => prefs.tab === 'today'
            && (prefs.sort === 'smart' || prefs.sort === 'manual')
            && prefs.group === 'none'
            && !!TD && typeof TD.setFields === 'function';

        const applyOrder = async (next) => {
            if (reordering) return;
            reordering = true;
            try {
                const rankByPath = {};
                for (const t of next) rankByPath[t.path] = t.rank;
                const changes = View.renumber(next.map((t) => t.path), rankByPath, TE);
                if (!changes.length) return;
                const prior = new Map(next.map((t) => [t.path, t.rank]));
                const byPath = new Map(next.map((t) => [t.path, t]));
                next.forEach((t, i) => { t.rank = i + 1; });
                paint();
                let failed = 0;
                let silent = 0;
                for (const change of changes) {
                    let res = null;
                    try { res = await TD.setFields(change.path, { rank: change.rank }); } catch (_e) { res = null; }
                    const outcome = TTL.classifyOutcome(res);
                    if (outcome === 'ok') continue;
                    failed += 1;
                    if (outcome === 'silent') silent += 1;
                    const t = byPath.get(change.path);
                    if (t) t.rank = prior.get(change.path);
                }
                if (failed > 0) paint();
                if (silent > 0) View._notice('Could not save the new task order');
            } finally {
                reordering = false;
            }
        };
        // Only rows still on screen take part: a row completed or rescheduled
        // by its own controls has already left the list.
        const visibleManual = () => manualOrder.filter((t) => {
            const row = rowByPath.get(t.path);
            return !!(row && row.parentNode);
        });
        const reorder = (fromPath, toPath) => {
            const current = visibleManual();
            const paths = current.map((t) => t.path);
            const from = paths.indexOf(fromPath);
            const to = paths.indexOf(toPath);
            if (from < 0 || to < 0 || from === to) return undefined;
            const next = current.slice();
            next.splice(to, 0, next.splice(from, 1)[0]);
            return applyOrder(next);
        };
        const onMove = (task, dir) => {
            const current = visibleManual();
            const i = current.findIndex((t) => task && t.path === task.path);
            const j = i + (dir < 0 ? -1 : 1);
            if (i < 0 || j < 0 || j >= current.length) return undefined;
            const next = current.slice();
            next[i] = current[j];
            next[j] = current[i];
            return applyOrder(next);
        };

        const dropOnDay = async (taskPath, date) => {
            const task = taskByPath(taskPath);
            if (!task || typeof TTL.reschedule !== 'function') return;
            let res = null;
            try {
                res = await TTL.reschedule(rowByPath.get(taskPath) || View._detachedRow(), task, date, viewedDay, TD);
            } catch (_e) { res = null; }
            const outcome = TTL.classifyOutcome(res);
            if (outcome === 'ok') {
                applyMoved(task, res.due != null ? res.due : date);
                paint();
            } else if (outcome === 'silent') {
                View._notice('Could not move task');
            }
        };
        const wireDrag = (row, task, manual) => {
            if (!row || typeof row.addEventListener !== 'function') return;
            row.draggable = true;
            try { row.setAttribute('draggable', 'true'); } catch (_e) { /* property already set */ }
            row.addEventListener('dragstart', (event) => {
                dragPath = task.path;
                try {
                    if (event && event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(task.path));
                    }
                } catch (_e) { /* drag data is advisory */ }
            });
            row.addEventListener('dragend', () => { dragPath = null; });
            if (!manual) return;
            row.addEventListener('dragover', (event) => {
                if (!dragPath || !manualOrder.some((t) => t.path === dragPath)) return;
                try {
                    event.preventDefault();
                    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                } catch (_e) { /* the drop still works without dropEffect */ }
            });
            row.addEventListener('drop', (event) => {
                try { event.preventDefault(); } catch (_e) { /* default drop is harmless */ }
                const from = dragPath;
                dragPath = null;
                if (!from) return undefined;
                return reorder(from, task.path);
            });
        };

        const renderRow = (list, task, stale, manual) => {
            const options = {
                viewedDay,
                todayStr,
                onRescheduled: (moved, due) => {
                    applyMoved(taskByPath(moved.path) || moved, due);
                    paint();
                },
                onDone: (doneTask) => {
                    applyDone(taskByPath(doneTask && doneTask.path) || doneTask);
                    paint();
                },
            };
            if (selecting) {
                options.selectable = true;
                options.selected = selected.has(task.path);
                options.onSelect = (picked, checked) => {
                    if (!picked || !picked.path) return;
                    if (checked) selected.add(picked.path);
                    else selected.delete(picked.path);
                    paintBulk();
                };
            }
            if (manual) {
                options.dragHandle = true;
                options.onMove = onMove;
            }
            let row = null;
            try {
                row = TTL.renderTaskRow(list, task, TD, options);
            } catch (_e) { return; }
            if (!row) return;
            if (task.path) rowByPath.set(task.path, row);
            wireDrag(row, task, manual);
            if (stale) {
                View._addClass(row, 'is-stale');
                if (row.style) row.style.opacity = '0.6';
            }
        };
        const paintRows = (host, rows, stale) => {
            const sorted = View.sortTasks(rows, prefs.sort, todayStr, TE);
            if (prefs.group === 'none') {
                const manual = !stale && canReorder();
                if (manual) manualOrder = sorted;
                const list = makeList(host);
                for (const task of sorted) renderRow(list, task, stale, manual);
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
        const paintStrip = () => {
            clear(aboveTabs);
            const cells = View.weekStrip(tasks, todayStr, TE);
            if (!cells.length) return;
            const strip = aboveTabs.createEl('div', { cls: 'sauce-todo-week-strip' });
            strip.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; width:100%;';
            strip.setAttribute('role', 'group');
            strip.setAttribute('aria-label', 'This week');
            for (const cell of cells) {
                const button = strip.createEl('button', {
                    cls: `sauce-todo-week-cell${cell.isToday ? ' is-today' : ''}`,
                });
                button.setAttribute('type', 'button');
                button.setAttribute('aria-label', `${cell.label}: ${cell.count} open`);
                if (cell.isToday) button.setAttribute('aria-current', 'date');
                button.dataset.date = cell.date;
                const idle = `display:inline-flex; flex-direction:column; align-items:center; gap:1px; min-width:52px; height:auto; padding:4px 10px; border-radius:var(--radius-s, 4px); border:1px solid ${cell.isToday ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'}; color:${cell.isToday ? 'var(--text-accent)' : 'var(--text-normal)'}; background:transparent; cursor:pointer;`;
                button.style.cssText = idle;
                const name = button.createEl('span', { cls: 'sauce-todo-week-label', text: cell.label });
                name.style.cssText = 'font-size:0.8em; font-weight:600;';
                const count = button.createEl('span', { cls: 'sauce-todo-week-count', text: String(cell.count) });
                count.style.cssText = `font-size:0.75em; color:${cell.count ? 'var(--text-muted)' : 'var(--text-faint)'}; font-variant-numeric:tabular-nums;`;
                button.addEventListener('click', onClick(() => {
                    focusDay = cell.date;
                    commit({ tab: 'week' });
                }));
                button.addEventListener('dragover', (event) => {
                    if (!dragPath) return;
                    try {
                        event.preventDefault();
                        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                    } catch (_e) { /* the drop still works without dropEffect */ }
                    button.style.background = 'var(--background-modifier-hover)';
                });
                button.addEventListener('dragleave', () => { button.style.background = 'transparent'; });
                button.addEventListener('drop', (event) => {
                    try { event.preventDefault(); } catch (_e) { /* default drop is harmless */ }
                    button.style.background = 'transparent';
                    const from = dragPath;
                    dragPath = null;
                    if (!from) return undefined;
                    return dropOnDay(from, cell.date);
                });
            }
        };

        const bulk = async (verb, action, onOk, noticeAll) => {
            if (bulkBusy) return undefined;
            const paths = [];
            for (const p of Array.from(selected)) {
                const task = taskByPath(p);
                if (task && String(task.status || 'open') === 'open') paths.push(p);
                else selected.delete(p);
            }
            if (!paths.length) { paint(); return undefined; }
            bulkBusy = true;
            paintBulk();
            let out = { done: [], failed: [] };
            try {
                out = await View.runBulk(paths, action, {
                    classify: (res) => TTL.classifyOutcome(res),
                    notice: (message) => View._notice(message),
                    onOk,
                    verb,
                    noticeAll,
                });
                for (const p of out.done) selected.delete(p);
            } finally {
                bulkBusy = false;
            }
            paint();
            return out;
        };
        const bulkReschedule = (due) => {
            if (due == null || typeof TTL.reschedule !== 'function') return undefined;
            return bulk('move', (p) => TTL.reschedule(
                rowByPath.get(p) || View._detachedRow(), taskByPath(p), due, viewedDay, TD),
            (p, res) => applyMoved(taskByPath(p), res && res.due != null ? res.due : due));
        };
        const bulkFields = (fields) => {
            if (!TD || typeof TD.setFields !== 'function') return undefined;
            return bulk('update', (p) => TD.setFields(p, fields),
                (p) => { const task = taskByPath(p); if (task) Object.assign(task, fields); });
        };
        const bulkDone = () => {
            if (!TD || typeof TD.markDone !== 'function') return undefined;
            return bulk('complete', (p) => TD.markDone(p), (p) => applyDone(taskByPath(p)), true);
        };
        const openPicker = (anchor, entries) => {
            const MP = CJS.MenuPopover;
            if (!MP || typeof MP.open !== 'function' || !entries.length) return;
            try { MP.open(entries, { anchor }); } catch (_e) { View._notice('Could not open menu'); }
        };
        const priorityEntries = () => View.BULK_PRIORITY_OPTIONS.map((option) => ({
            label: option.label,
            onSelect: () => bulkFields({ priority: option.value }),
        }));
        const projectEntries = () => {
            let projects = [];
            try {
                const appRef = typeof window !== 'undefined' ? window.app : null;
                projects = TD && typeof TD._loadProjectList === 'function' ? TD._loadProjectList(appRef) : [];
            } catch (_e) { projects = []; }
            const entries = [{ label: 'No project', onSelect: () => bulkFields({ project: '', project_slug: '' }) }];
            for (const project of (Array.isArray(projects) ? projects : [])) {
                const name = project && project.name ? String(project.name) : '';
                if (!name) continue;
                const slug = project.slug ? String(project.slug) : '';
                entries.push({ label: name, onSelect: () => bulkFields({ project: `[[${name}]]`, project_slug: slug }) });
            }
            return entries;
        };
        const paintBulk = () => {
            clear(bulkHost);
            if (!selecting || selected.size === 0) return;
            const bar = bulkHost.createEl('div', { cls: 'sauce-todo-bulkbar' });
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', 'Selected tasks');
            bar.createEl('span', { cls: 'sauce-todo-bulk-count', text: `${selected.size} selected` });
            const action = (text, handler) => {
                const button = bar.createEl('button', { cls: 'sauce-todo-bulk-action', text });
                button.setAttribute('type', 'button');
                if (bulkBusy) button.disabled = true;
                button.addEventListener('click', onClick(() => handler(button)));
                return button;
            };
            action('→ Tomorrow', () => bulkReschedule(TE.tomorrow(todayStr)));
            action('→ Next Mon', () => bulkReschedule(TE.nextMonday(todayStr)));
            action('Priority ▾', (button) => openPicker(button, priorityEntries())).setAttribute('aria-haspopup', 'menu');
            action('Project ▾', (button) => openPicker(button, projectEntries())).setAttribute('aria-haspopup', 'menu');
            action('Backlog', () => bulkReschedule(''));
            action('Mark done', () => bulkDone());
        };

        const scrollToFocusDay = () => {
            if (!focusDay) return;
            const day = focusDay;
            focusDay = null;
            for (const [taskPath, row] of rowByPath) {
                const task = taskByPath(taskPath);
                if (!task || View._dueOf(task) !== day) continue;
                try { if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' }); }
                catch (_e) { /* scrolling is a convenience */ }
                return;
            }
        };

        const paint = () => {
            try {
                rowByPath.clear();
                manualOrder = [];
                updateControls();
                paintStrip();
                paintList();
                paintDone();
                paintBulk();
                scrollToFocusDay();
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
        const selectButton = rightSide.createEl('button', { text: 'Select' });
        selectButton.setAttribute('type', 'button');
        selectButton.addEventListener('click', onClick(() => {
            selecting = !selecting;
            if (!selecting) selected.clear();
            paint();
        }));

        paint();
    }
}
