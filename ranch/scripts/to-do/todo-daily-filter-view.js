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
 * can be dropped on a week-strip day to reschedule it there. Clicking a
 * week-strip day shows only the open tasks due that day (plus what was done
 * that day); a day pill leads the tab row while it is shown, and its ×, the
 * same day again or any tab goes back. The day is held in memory, never in
 * the persisted prefs.
 *
 * Subtasks never list as roots: they are out of All open, Backlog, No date,
 * the recurring surface and the recently-done lists, and show in Today /
 * This week / Overdue / a picked day only when their own due falls there (tab
 * and strip counts follow the same rule). A task counts as a subtask only
 * while its parent is loaded and will show it on its card: an open task needs
 * an open parent. An open task whose parent is done, deleted or missing (a
 * promoted task) lists as a root, so nothing leaves the open lists.
 *
 * BARE CLASS ONLY. CustomJS evaluates this file as one expression.
 */
class ToDoDailyFilterView {
    static get PREFS_KEY() { return 'sauce-todo-filter:prefs:v2'; }
    static get TABS() { return ['today', 'week', 'overdue', 'backlog', 'all']; }
    static get SORT_MODES() { return ['smart', 'manual', 'priority', 'due', 'oldest', 'touched']; }
    static get GROUP_MODES() { return ['none', 'project', 'priority', 'due']; }
    static get STALE_DIVIDER_LABEL() { return 'Stale · overdue 30+ days'; }

    /**
     * The pages this view draws. `daily` is the To-Do note; `all` is All
     * To-Dos and `recurring` is the Recurring index, both reached through
     * their own thin classes (ToDoAllList, TaskRecurringList). Each surface
     * has its own tabs, defaults and prefs key, so a tab picked on one page
     * never moves another.
     */
    static get SURFACES() {
        return {
            daily: {
                key: 'daily',
                prefsKey: ToDoDailyFilterView.PREFS_KEY,
                tabs: ToDoDailyFilterView.TABS,
                defaults: { tab: 'today', sort: 'smart', group: 'none' },
                counted: ['overdue', 'backlog'],
                labels: {},
                strip: true, search: false, done: true, reorder: true, recurringOnly: false,
                emptyText: 'No tasks in this view.',
            },
            all: {
                key: 'all',
                prefsKey: 'sauce-todo-filter:prefs:all',
                tabs: ['all', 'overdue', 'week', 'backlog'],
                defaults: { tab: 'all', sort: 'due', group: 'none' },
                counted: ['all', 'overdue', 'backlog'],
                labels: {},
                strip: false, search: true, done: false, reorder: false, recurringOnly: false,
                searchPlaceholder: 'Search open tasks…',
                emptyText: 'No open tasks. All clear.',
            },
            recurring: {
                key: 'recurring',
                prefsKey: 'sauce-todo-filter:prefs:recurring',
                tabs: ['all', 'week', 'overdue'],
                defaults: { tab: 'all', sort: 'due', group: 'none' },
                counted: ['all', 'overdue'],
                labels: { all: 'All' },
                strip: false, search: true, done: false, reorder: false, recurringOnly: true,
                searchPlaceholder: 'Search recurring tasks…',
                emptyText: 'No recurring tasks yet. Set "Repeats" on a task to see it here.',
            },
            project: {
                key: 'project',
                prefsKey: 'sauce-todo-filter:prefs:project',
                tabs: ['all', 'overdue', 'week', 'undated'],
                defaults: { tab: 'all', sort: 'due', group: 'none' },
                counted: ['all', 'overdue'],
                labels: {},
                strip: false, search: false, done: false, reorder: false, recurringOnly: false,
                scoped: true,
                showProject: false,
                recentDone: { days: 14, label: 'Recently done', limit: 5 },
                emptyText: 'Nothing open on this project.',
            },
            trip: {
                key: 'trip',
                prefsKey: 'sauce-todo-filter:prefs:trip',
                tabs: ['all', 'overdue', 'week', 'undated'],
                defaults: { tab: 'all', sort: 'due', group: 'none' },
                counted: ['all', 'overdue'],
                labels: {},
                strip: false, search: false, done: false, reorder: false, recurringOnly: false,
                scoped: true,
                recentDone: { days: null, label: 'Done', limit: 5 },
                emptyText: 'Nothing open for this trip.',
            },
            meeting: {
                key: 'meeting',
                prefsKey: 'sauce-todo-filter:prefs:meeting',
                tabs: ['all', 'overdue'],
                defaults: { tab: 'all', sort: 'due', group: 'none' },
                counted: ['all', 'overdue'],
                labels: {},
                strip: false, search: false, done: false, reorder: false, recurringOnly: false,
                scoped: true,
                tools: ['select'],
                recentDone: { days: null, label: 'Done', limit: 5 },
                emptyText: 'Nothing open from this meeting.',
            },
        };
    }

    /** Every tab key selectTab knows; a surface shows a subset of these. */
    static get TAB_KEYS() { return [...ToDoDailyFilterView.TABS, 'undated']; }

    /** Shown alone, with no pills, when a scoped note has no tasks at all. */
    static get BLANK_SCOPE_TEXT() { return 'No tasks yet. Use + New Task above.'; }

    static surface(key) {
        const all = ToDoDailyFilterView.SURFACES;
        return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : all.daily;
    }

    static _defaultPrefs(surfaceKey) { return { ...ToDoDailyFilterView.surface(surfaceKey).defaults }; }

    static _normalizePrefs(value, surfaceKey) {
        const S = ToDoDailyFilterView.surface(surfaceKey);
        const out = { ...S.defaults };
        if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
        if (S.tabs.includes(value.tab)) out.tab = value.tab;
        if (ToDoDailyFilterView.SORT_MODES.includes(value.sort)) out.sort = value.sort;
        if (ToDoDailyFilterView.GROUP_MODES.includes(value.group)) out.group = value.group;
        return out;
    }

    static storage() {
        try { return typeof window !== 'undefined' ? window.localStorage : null; }
        catch (_e) { return null; }
    }

    static _readRaw(storage, surfaceKey) {
        try {
            if (!storage || typeof storage.getItem !== 'function') return {};
            const raw = storage.getItem(ToDoDailyFilterView.surface(surfaceKey).prefsKey);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_e) { return {}; }
    }

    static readPrefs(storage, surfaceKey) {
        return ToDoDailyFilterView._normalizePrefs(ToDoDailyFilterView._readRaw(storage, surfaceKey), surfaceKey);
    }

    /**
     * Read-merge-write: keys this view does not own survive, and the owned keys
     * are normalised per key. Persistence is best-effort and never throws.
     */
    static writePrefs(storage, patch, surfaceKey) {
        const raw = ToDoDailyFilterView._readRaw(storage, surfaceKey);
        const merged = ToDoDailyFilterView._normalizePrefs({ ...raw, ...(patch || {}) }, surfaceKey);
        try {
            if (storage && typeof storage.setItem === 'function') {
                storage.setItem(ToDoDailyFilterView.surface(surfaceKey).prefsKey, JSON.stringify({ ...raw, ...merged }));
            }
        } catch (_e) { /* local preference persistence is best-effort */ }
        return merged;
    }

    /**
     * Tasks whose title or project contains every word of `text`, case
     * insensitive, in input order. Blank text keeps everything.
     */
    static searchTasks(tasks, text) {
        const list = Array.isArray(tasks) ? tasks : [];
        const words = String(text == null ? '' : text).toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return list.slice();
        return list.filter((task) => {
            if (!task) return false;
            const project = ToDoDailyFilterView._projectLabel(task);
            const hay = `${task.title || ''} ${project === 'No project' ? '' : project}`.toLowerCase();
            return words.every((w) => hay.includes(w));
        });
    }

    /**
     * Open tasks with a `recurrence` set, in input order. Subtasks never list
     * as roots. `parents` as isSubtask (default: built from `tasks`).
     */
    static recurringOnly(tasks, parents) {
        const list = Array.isArray(tasks) ? tasks : [];
        const index = parents || ToDoDailyFilterView.parentIndex(list);
        return list.filter((task) =>
            task && !ToDoDailyFilterView.isSubtask(task, index)
            && task.recurrence && String(task.recurrence).trim() !== '');
    }

    static _baseOf(path) {
        const s = String(path == null ? '' : path);
        return s.slice(s.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    }

    /**
     * The tasks that can hold others on their card, from every loaded task:
     * by path (a folder note's children name it by parent_path) and by note
     * name (a flat child names it by its parent_task link), once for open
     * tasks and once for every loaded task. Pure.
     */
    static parentIndex(tasks) {
        const index = { openPaths: new Set(), openNames: new Set(), paths: new Set(), names: new Set() };
        for (const task of Array.isArray(tasks) ? tasks : []) {
            if (!task || !task.path) continue;
            const path = String(task.path);
            const name = ToDoDailyFilterView._baseOf(path);
            index.paths.add(path);
            if (name) index.names.add(name);
            if (String(task.status || 'open').toLowerCase() === 'open') {
                index.openPaths.add(path);
                if (name) index.openNames.add(name);
            }
        }
        return index;
    }

    /**
     * Whether a task lives on its parent's card rather than as a root. With
     * no `parents` index, any task with a parent counts. With one (see
     * parentIndex), only a task whose parent is loaded counts, and an open
     * task's parent must be open too: an open task under a done, deleted or
     * missing parent shows on no card, so it lists as a root. A folder note's
     * parent is matched by parent_path, a flat note's by its parent's name.
     */
    static isSubtask(task, parents) {
        if (!task) return false;
        const name = String(task.parent_task == null ? '' : task.parent_task).trim();
        if (!name) return false;
        if (!parents) return true;
        const open = String(task.status || 'open').toLowerCase() === 'open';
        const parentPath = String(task.parent_path == null ? '' : task.parent_path).trim();
        if (parentPath) {
            if (parentPath === task.path) return false;
            return (open ? parents.openPaths : parents.paths).has(parentPath);
        }
        if (name === ToDoDailyFilterView._baseOf(task.path)) return false;
        return (open ? parents.openNames : parents.names).has(name);
    }

    /**
     * Whether a task may list on its own: a root always, a subtask only when it
     * has a due date of its own. Subtasks otherwise live on their parent's card.
     */
    static isListable(task, parents) {
        return !!task && (!ToDoDailyFilterView.isSubtask(task, parents) || !!ToDoDailyFilterView._dueOf(task));
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

    /**
     * The open tasks on `tab`. `parents` is the parentIndex of every loaded
     * task (default: built from `tasks`), so a search-narrowed `tasks` still
     * sees parents that did not match.
     */
    static selectTab(tasks, tab, todayStr, TEref, parents) {
        const TE = ToDoDailyFilterView._te(TEref);
        if (!TE) return [];
        const open = ToDoDailyFilterView._openTasks(tasks);
        const index = parents || ToDoDailyFilterView.parentIndex(tasks);
        const root = (task) => !ToDoDailyFilterView.isSubtask(task, index);
        const key = ToDoDailyFilterView.TAB_KEYS.includes(tab) ? tab : 'today';
        switch (key) {
            case 'all':
                return open.filter(root);
            case 'undated':
                return open.filter((task) => root(task) && !ToDoDailyFilterView._dueOf(task));
            case 'backlog':
                return open.filter((task) => root(task) && TE.isBacklog(task));
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

    /** Open tasks due on exactly `date`, in input order. No date selects nothing. */
    static selectDay(tasks, date) {
        const day = String(date == null ? '' : date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
        return ToDoDailyFilterView._openTasks(tasks).filter((task) => ToDoDailyFilterView._dueOf(task) === day);
    }

    /** Done tasks completed on `todayStr`, latest completion first. */
    static doneToday(tasks, todayStr, TEref, TTLref, parents) {
        const TE = ToDoDailyFilterView._te(TEref);
        const TTL = TTLref
            || (typeof window !== 'undefined' && window.customJS && window.customJS.TaskTodayList) || null;
        if (!TE || !TTL) return [];
        const index = parents || ToDoDailyFilterView.parentIndex(tasks);
        return (Array.isArray(tasks) ? tasks : [])
            .filter((task) => task && task.status === 'done' && ToDoDailyFilterView.isListable(task, index)
                && TE.completedDay(task) === todayStr)
            .map((task, index) => ({ task, index, time: TTL.doneTimeLabel(task) }))
            .sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : a.index - b.index))
            .map((entry) => entry.task);
    }

    /**
     * Done tasks completed in the `days` days up to and including `todayStr`
     * (every done task when `days` is null), latest completion first. A task
     * with no completion day only counts when `days` is null.
     */
    static doneRecent(tasks, todayStr, days, TEref, TTLref, parents) {
        const TE = ToDoDailyFilterView._te(TEref);
        const TTL = TTLref
            || (typeof window !== 'undefined' && window.customJS && window.customJS.TaskTodayList) || null;
        if (!TE || typeof TE.completedDay !== 'function') return [];
        const windowed = Number.isInteger(days) && days > 0;
        const from = windowed && typeof TE.addDays === 'function' ? TE.addDays(todayStr, -(days - 1)) : '';
        if (windowed && !from) return [];
        const timeOf = (task) => (TTL && typeof TTL.doneTimeLabel === 'function' ? TTL.doneTimeLabel(task) : '');
        const index = parents || ToDoDailyFilterView.parentIndex(tasks);
        return (Array.isArray(tasks) ? tasks : [])
            .filter((task) => task && task.status === 'done' && !ToDoDailyFilterView.isSubtask(task, index))
            .map((task, index) => ({ task, index, day: String(TE.completedDay(task) || ''), time: timeOf(task) }))
            .filter((entry) => !windowed || (entry.day && entry.day >= from && entry.day <= todayStr))
            .sort((a, b) => {
                if (a.day !== b.day) return a.day < b.day ? 1 : -1;
                if (a.time !== b.time) return a.time < b.time ? 1 : -1;
                return a.index - b.index;
            })
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

    /**
     * The heading over one project's group when the list is grouped by
     * project: the name (a link to the project note) in the theme's own
     * text, the number of tasks, and how many are overdue. The project's
     * colour shows only as the dot on its rows' chips. "No project" is plain
     * text, not a link. Returns the heading element.
     */
    static get COLLAPSED_KEY() { return 'sauce-todo-filter:collapsed:v1'; }
    static get COLLAPSED_MAX() { return 200; }

    /**
     * The keys of the collapsed groups, kept across repaints and, through
     * `storage` (default View.storage(), this device's localStorage), across
     * restarts. Holds the newest COLLAPSED_MAX keys. A store that cannot be
     * read or written still works for the session.
     */
    static collapsedStore(storage) {
        const S = storage !== undefined ? storage : ToDoDailyFilterView.storage();
        const KEY = ToDoDailyFilterView.COLLAPSED_KEY;
        let keys = [];
        try {
            const raw = S && typeof S.getItem === 'function' ? S.getItem(KEY) : null;
            const parsed = raw ? JSON.parse(raw) : [];
            if (Array.isArray(parsed)) keys = parsed.filter((k) => typeof k === 'string');
        } catch (_e) { keys = []; }
        const set = new Set(keys);
        const save = () => {
            try {
                const list = Array.from(set).slice(-ToDoDailyFilterView.COLLAPSED_MAX);
                if (S && typeof S.setItem === 'function') S.setItem(KEY, JSON.stringify(list));
            } catch (_e) { /* the session copy still works */ }
        };
        return {
            has: (k) => set.has(k),
            add: (k) => { set.delete(k); set.add(k); save(); },
            delete: (k) => { const had = set.delete(k); if (had) save(); return had; },
        };
    }

    /** This device's collapsed-group store, read once per session. */
    static get collapsedGroups() {
        if (!ToDoDailyFilterView._collapsedSet) ToDoDailyFilterView._collapsedSet = ToDoDailyFilterView.collapsedStore();
        return ToDoDailyFilterView._collapsedSet;
    }

    static _reducedMotion() {
        try {
            return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
        } catch (_e) { return false; }
    }

    /**
     * Show or hide a group's list. With motion allowed and element.animate
     * present it folds shut (height and fade) or opens with its rows rising
     * in; otherwise it just shows or hides. A toggle mid-animation cancels the
     * running one. The list's own display value is kept for when it opens.
     */
    static animateCollapse(list, collapse) {
        if (!list || !list.style) return;
        if (list.__display == null) list.__display = list.style.display && list.style.display !== 'none' ? list.style.display : '';
        const shown = list.__display;
        try { if (list.__collapseAnim && typeof list.__collapseAnim.cancel === 'function') list.__collapseAnim.cancel(); } catch (_e) {}
        list.__collapseAnim = null;
        if (ToDoDailyFilterView._reducedMotion() || typeof list.animate !== 'function') {
            list.style.display = collapse ? 'none' : shown;
            return;
        }
        try {
            if (collapse) {
                const h = list.scrollHeight || 0;
                list.style.overflow = 'hidden';
                const anim = list.animate([
                    { height: h + 'px', opacity: 1, transform: 'translateY(0)' },
                    { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
                ], { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
                list.__collapseAnim = anim;
                anim.onfinish = () => { list.style.display = 'none'; list.style.overflow = ''; list.__collapseAnim = null; };
            } else {
                list.style.display = shown;
                list.style.overflow = 'hidden';
                const h = list.scrollHeight || 0;
                const anim = list.animate([
                    { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
                    { height: h + 'px', opacity: 1, transform: 'translateY(0)' },
                ], { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
                list.__collapseAnim = anim;
                anim.onfinish = () => { list.style.overflow = ''; list.__collapseAnim = null; };
                const rows = Array.from(list.children || []).slice(0, 12);
                rows.forEach((row, i) => {
                    if (row && typeof row.animate === 'function') {
                        row.animate([
                            { opacity: 0, transform: 'translateY(6px)' },
                            { opacity: 1, transform: 'translateY(0)' },
                        ], { duration: 220, delay: 40 + i * 28, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' });
                    }
                });
            }
        } catch (_e) {
            list.style.display = collapse ? 'none' : shown;
            list.style.overflow = '';
        }
    }

    /**
     * Give a group section a rail on its left edge (shown on hover, always on
     * touch) that collapses and expands the group's `list`. `key` names the
     * group in `store` (default collapsedGroups), so a collapsed group stays
     * collapsed when the list repaints. Returns the rail.
     */
    static wireCollapsible(section, list, key, label, store) {
        if (!section || !list || typeof section.createEl !== 'function') return null;
        const keep = store || ToDoDailyFilterView.collapsedGroups;
        const name = String(label == null ? '' : label) || 'section';
        const rail = section.createEl('button', { cls: 'sauce-todo-group-rail' });
        try { if (typeof section.insertBefore === 'function' && section.firstChild && section.firstChild !== rail) section.insertBefore(rail, section.firstChild); } catch (_e) {}
        try { rail.setAttribute('type', 'button'); } catch (_e) {}
        const sync = (collapsed) => {
            ToDoDailyFilterView._setClass(section, 'is-collapsed', collapsed);
            try {
                rail.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                rail.setAttribute('aria-label', (collapsed ? 'Expand ' : 'Collapse ') + name);
                rail.setAttribute('title', (collapsed ? 'Expand ' : 'Collapse ') + name);
            } catch (_e) {}
        };
        const start = keep.has(key);
        sync(start);
        if (start && list.style) {
            if (list.__display == null) list.__display = list.style.display && list.style.display !== 'none' ? list.style.display : '';
            list.style.display = 'none';
        }
        rail.addEventListener('click', (ev) => {
            try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
            const collapse = !keep.has(key);
            if (collapse) keep.add(key); else keep.delete(key);
            sync(collapse);
            ToDoDailyFilterView.animateCollapse(list, collapse);
        });
        return rail;
    }

    static _setClass(el, cls, on) {
        try {
            if (el && el.classList) { if (on) el.classList.add(cls); else el.classList.remove(cls); return; }
            if (el) {
                const parts = String(el.className || '').split(/\s+/).filter((c) => c && c !== cls);
                if (on) parts.push(cls);
                el.className = parts.join(' ');
            }
        } catch (_e) {}
    }

    static renderProjectHeader(host, group, opts) {
        const o = opts || {};
        const name = String((group && group.label) || '');
        const none = !name || name === 'No project';
        const head = host.createEl('div', { cls: 'sauce-todo-project-head' + (none ? ' is-none' : '') + (o.first ? ' is-first' : '') });
        const nameEl = head.createEl(none ? 'span' : 'a', { cls: 'sauce-todo-project-name', text: name || 'No project' });
        if (!none) {
            try { nameEl.setAttribute('href', '#'); nameEl.setAttribute('title', 'Open ' + name); } catch (_e) {}
            nameEl.addEventListener('click', (ev) => {
                try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (_e) {}
                try {
                    const appRef = (typeof window !== 'undefined' && window.app) || null;
                    if (appRef && appRef.workspace) appRef.workspace.openLinkText(name, '', false);
                } catch (_e) { /* open best-effort */ }
            });
        }
        const tasks = Array.isArray(group && group.tasks) ? group.tasks : [];
        head.createEl('span', { cls: 'sauce-todo-project-count', text: String(tasks.length) });
        let late = 0;
        try {
            const TE = o.TE;
            if (TE && typeof TE.bucketOf === 'function' && o.todayStr) {
                late = tasks.filter((t) => TE.bucketOf(t, o.todayStr) === 'overdue').length;
            }
        } catch (_e) { late = 0; }
        if (late) head.createEl('span', { cls: 'sauce-todo-project-late', text: `${late} overdue` });
        return head;
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
            'body.is-phone .sauce-todo-bulkbar button.sauce-todo-bulk-action { height: auto; min-height: 30px; padding: 4px 10px; font-size: 13px; }',
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
     * Cells for the week strip above the tabs: Monday..Sunday of the week
     * holding `todayStr`, always all seven. `count` is the open tasks due that
     * day.
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

    /**
     * Per-day gesture state shared by every render of the view: Select mode,
     * the selection, the week-strip day being shown (`day`, a YYYY-MM-DD or
     * null), in-flight locks ('bulk', 'reorder') and the live render. Each
     * surface keeps its own entry; other days' entries are dropped once they
     * hold no lock. A scoped surface (one project, trip or meeting) keys its
     * entry by `scopeId` too, so Select mode on one note never follows you
     * into the next.
     */
    static _dayState(todayStr, surfaceKey, scopeId) {
        const day = String(todayStr || '');
        const scope = scopeId ? `:${String(scopeId)}` : '';
        const key = `${ToDoDailyFilterView.surface(surfaceKey).key}${scope}|${day}`;
        const all = ToDoDailyFilterView._dayStates || (ToDoDailyFilterView._dayStates = new Map());
        for (const [k, entry] of all) {
            if (k.slice(k.lastIndexOf('|') + 1) !== day && !entry.locks.size) all.delete(k);
        }
        if (!all.has(key)) all.set(key, { selecting: false, selected: new Set(), locks: new Set(), live: null, day: null, doneAll: false });
        return all.get(key);
    }

    /** Stand-in row for a selected task that is not painted on the current tab. */
    static _detachedRow() {
        return { dataset: {}, parentNode: null, remove() {} };
    }

    async render(dv, opts) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const View = ToDoDailyFilterView;
        const S = View.surface(opts && opts.surface);
        // A scoped surface draws one note's tasks: the caller (TaskProjectList,
        // TaskTripList, TaskMeetingList) owns the membership rule and passes it
        // as { id, match }. Without one there is nothing to draw.
        const scope = S.scoped ? (opts && opts.scope) : null;
        if (S.scoped && (!scope || !scope.id || typeof scope.match !== 'function')) return;
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
                && (typeof TE.taskState === 'function' ? TE.taskState(candidate) !== 'deleted' : true));
            const pages = raw && typeof raw.array === 'function' ? raw.array() : Array.from(raw || []);
            tasks = pages.map((candidate) => TE.parseNote(candidate));
        } catch (_e) { tasks = []; }
        // Whether a task is a subtask depends on its parent being open and
        // loaded, so it is decided over every loaded task (before the scope
        // and the search narrow them) at each paint: a row's own write
        // flips a task's status in place.
        const loaded = tasks;
        const parents = () => View.parentIndex(loaded);
        if (scope) {
            tasks = tasks.filter((task) => {
                try { return !!scope.match(task); } catch (_e) { return false; }
            });
            // The lists this replaces showed each task's subtask count; keep it.
            if (typeof TE.subtaskCountsByParent === 'function') {
                let counts = {};
                try { counts = TE.subtaskCountsByParent(dv) || {}; } catch (_e) { counts = {}; }
                for (const task of tasks) {
                    const base = task && task.path ? String(task.path).split('/').pop().replace(/\.md$/i, '') : '';
                    if (task && task.subtask_count == null) task.subtask_count = counts[base] || null;
                }
            }
        }

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        if (scope && !tasks.length) {
            const blank = dv.container.createEl('div', { cls: `sauce-todo-daily-filter-view is-${S.key} is-blank` });
            const line = blank.createEl('div', { cls: 'sauce-todo-filter-empty', text: View.BLANK_SCOPE_TEXT });
            line.style.cssText = 'color:var(--text-muted); font-size:0.85em; font-style:italic; padding:4px 0;';
            return;
        }

        const storage = View.storage();
        let prefs = View.readPrefs(storage, S.key);
        const TD = CJS.TaskDialog || null;
        const SL = CJS.SectionLabel || null;

        const root = dv.container.createEl('div', { cls: `sauce-todo-daily-filter-view is-${S.key}` });
        root.style.cssText = 'display:flex; flex-direction:column; gap:10px; width:100%;';

        root.createEl('style').textContent = View.BULKBAR_CSS;
        // Search is in memory only: it narrows the tabs, their counts and the
        // list, and clears when the note reloads.
        let query = '';
        if (S.search) {
            const searchWrap = root.createEl('label', { cls: 'sauce-todo-search' });
            const icon = searchWrap.createEl('span', { cls: 'sauce-todo-search-icon' });
            icon.setAttribute('aria-hidden', 'true');
            icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
            const input = searchWrap.createEl('input', { cls: 'sauce-todo-search-input', type: 'search' });
            input.setAttribute('placeholder', S.searchPlaceholder || 'Search…');
            input.setAttribute('aria-label', S.searchPlaceholder ? S.searchPlaceholder.replace(/…$/, '') : 'Search tasks');
            // Coalesce fast typing: a paint rebuilds every row, so it follows the
            // last keystroke, not each one.
            let searchTimer = null;
            input.addEventListener('input', () => {
                query = String(input.value || '');
                if (typeof setTimeout !== 'function') { paint(); return; }
                if (searchTimer != null && typeof clearTimeout === 'function') clearTimeout(searchTimer);
                searchTimer = setTimeout(() => { searchTimer = null; paint(); }, 120);
            });
        }
        const pool = () => {
            let list = S.recurringOnly ? View.recurringOnly(tasks, parents()) : tasks;
            if (query.trim()) list = View.searchTasks(list, query);
            return list;
        };
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
        bulkHost.style.cssText = 'display:flex; flex-direction:column; position:sticky; bottom:var(--sauce-bulk-bottom, 12px); z-index:5; width:100%;';

        const clear = (host) => { while (host.firstChild) host.removeChild(host.firstChild); };
        // `top` drops SectionLabel's own hairline where the filter rule
        // already sits directly above, so the two never stack.
        const label = (parent, text, top) => {
            const holder = parent.createEl('div', { cls: 'sauce-todo-filter-section-label' });
            if (SL && typeof SL.render === 'function') {
                try { SL.render({ ...dv, container: holder }, top ? { text, top: true } : { text }); return holder; }
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

        const TAB_LABELS = { today: 'Today', week: 'This week', overdue: 'Overdue', backlog: 'Backlog', all: 'All open', undated: 'No date', ...S.labels };
        const tools = Array.isArray(S.tools) ? S.tools : ['sort', 'group', 'select'];
        const tabButtons = {};
        const tabText = (key) => {
            if (!S.counted.includes(key)) return TAB_LABELS[key];
            const n = View.selectTab(pool(), key, todayStr, TE, parents()).length;
            return n > 0 ? `${TAB_LABELS[key]} · ${n}` : TAB_LABELS[key];
        };
        const setPill = (button, active) => {
            button.className = `sauce-pill-toggle${active ? ' is-active' : ''}`;
        };
        // The day pill leads the tab row while a week-strip day is shown: the
        // active pill names the day, and its × goes back to the tab underneath.
        let dayPill = null;
        let dayPillName = null;
        const leaveDay = () => { state.day = null; paint(); };
        const updateDayPill = () => {
            if (!state.day) {
                if (dayPill) dayPill.remove();
                dayPill = null;
                dayPillName = null;
                return;
            }
            if (!dayPill) {
                dayPill = tabGroup.createEl('button', { cls: 'sauce-pill-toggle is-active sauce-todo-day-pill' });
                dayPill.setAttribute('type', 'button');
                dayPill.setAttribute('title', 'Show all tasks');
                dayPillName = dayPill.createEl('span', { cls: 'sauce-todo-day-pill-label' });
                const x = dayPill.createEl('span', { cls: 'sauce-todo-day-pill-x', text: '×' });
                x.setAttribute('aria-hidden', 'true');
                x.style.cssText = 'margin-left:6px; font-size:1.15em; line-height:1; opacity:0.8;';
                dayPill.addEventListener('click', onClick(leaveDay));
                tabGroup.insertBefore(dayPill, tabGroup.firstChild);
            }
            const text = View._dayLabel(state.day);
            dayPillName.textContent = text;
            dayPill.setAttribute('aria-label', `Showing ${text}. Show all tasks`);
        };
        const updateControls = () => {
            updateDayPill();
            for (const key of S.tabs) {
                const button = tabButtons[key];
                const active = !state.day && prefs.tab === key;
                button.textContent = tabText(key);
                setPill(button, active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            }
            if (sortButton) setPill(sortButton, prefs.sort !== S.defaults.sort);
            if (groupButton) setPill(groupButton, prefs.group !== S.defaults.group);
            if (selectButton) {
                setPill(selectButton, state.selecting);
                selectButton.setAttribute('aria-pressed', state.selecting ? 'true' : 'false');
            }
        };

        // Selection and in-flight locks live on the class, keyed by todayStr,
        // so they survive the Dataview re-render the view's own writes cause.
        // Selection is in memory only (never persisted) and survives tab
        // switches; leaving Select mode clears it.
        const state = View._dayState(todayStr, S.key, scope && scope.id);
        const selected = state.selected;
        const isMobile = typeof TTL._isMobile === 'function'
            && TTL._isMobile(typeof window !== 'undefined' ? window.app : null);
        const dragMime = String(TTL.DRAG_MIME || 'application/x-sauce-task-path');
        const fromFormField = (event) => typeof TTL._fromFormField === 'function' && TTL._fromFormField(event);
        const droppedPath = (event) => {
            let carried = '';
            try {
                const dt = event && event.dataTransfer;
                carried = dt && typeof dt.getData === 'function' ? String(dt.getData(dragMime) || '') : '';
            } catch (_e) { carried = ''; }
            return carried || dragPath;
        };
        let dragPath = null;
        let manualOrder = [];
        const rowByPath = new Map();

        const taskByPath = (taskPath) => tasks.find((t) => t && t.path && t.path === taskPath) || null;
        // A write started by an earlier render patches that render's cache and
        // the live render's, then repaints the live one.
        const patchTask = (taskPath, fn) => {
            const mine = taskByPath(taskPath);
            if (mine) fn(mine);
            const live = state.live;
            if (!live || live.taskByPath === taskByPath) return;
            const theirs = live.taskByPath(taskPath);
            if (theirs && theirs !== mine) fn(theirs);
        };
        const repaintLive = () => {
            const live = state.live;
            if (live && typeof live.paint === 'function') live.paint();
            else paint();
        };
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
        const canReorder = () => S.reorder && !state.day && prefs.tab === 'today'
            && (prefs.sort === 'smart' || prefs.sort === 'manual')
            && prefs.group === 'none'
            && !!TD && typeof TD.setFields === 'function'
            && typeof TTL.manualOrder === 'function';

        const order = typeof TTL.manualOrder === 'function' ? TTL.manualOrder({
            order: () => manualOrder,
            rows: rowByPath,
            setFields: (taskPath, fields) => TD.setFields(taskPath, fields),
            renumber: (paths, rankByPath) => View.renumber(paths, rankByPath, TE),
            classify: (res) => TTL.classifyOutcome(res),
            repaint: () => repaintLive(),
            notice: (message) => View._notice(message),
            lock: { set: state.locks, key: 'reorder' },
        }) : null;
        const reorder = (fromPath, toPath) => (order ? order.reorder(fromPath, toPath) : undefined);
        const onMove = (task, dir) => (order ? order.move(task, dir) : undefined);

        const dropOnDay = async (taskPath, date) => {
            const task = taskByPath(taskPath);
            if (!task || typeof TTL.reschedule !== 'function') return;
            let res = null;
            try {
                res = await TTL.reschedule(rowByPath.get(taskPath) || View._detachedRow(), task, date, viewedDay, TD);
            } catch (_e) { res = null; }
            const outcome = TTL.classifyOutcome(res);
            if (outcome === 'ok') {
                patchTask(taskPath, (t) => applyMoved(t, res.due != null ? res.due : date));
                repaintLive();
            } else if (outcome === 'silent') {
                View._notice('Could not move task');
            }
        };
        // Desktop only: HTML5 drag-and-drop does not run on Obsidian mobile,
        // where the row menu's Move up / Move down is the equivalent. Only the
        // row's handle starts a drag, so mouse text selection of a title still
        // works; the row itself is a drop target only where manual order applies.
        const wireDrag = (row, task, manual) => {
            if (isMobile || !row || typeof row.addEventListener !== 'function') return;
            let handle = null;
            try { handle = typeof row.querySelector === 'function' ? row.querySelector('.sauce-task-drag') : null; }
            catch (_e) { handle = null; }
            if (handle && typeof handle.addEventListener === 'function') {
                handle.addEventListener('dragstart', (event) => {
                    if (fromFormField(event)) {
                        try { event.preventDefault(); } catch (_e) { /* the drag is cancelled either way */ }
                        dragPath = null;
                        return;
                    }
                    dragPath = task.path;
                    try {
                        if (event && event.dataTransfer) {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData(dragMime, String(task.path));
                            if (typeof event.dataTransfer.setDragImage === 'function') event.dataTransfer.setDragImage(row, 12, 12);
                        }
                    } catch (_e) { /* drag data is advisory */ }
                });
                handle.addEventListener('dragend', () => { dragPath = null; });
            }
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
                const from = droppedPath(event);
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
            if (state.selecting) {
                options.selectable = true;
                options.selected = selected.has(task.path);
                options.onSelect = (picked, checked) => {
                    if (!picked || !picked.path) return;
                    if (checked) selected.add(picked.path);
                    else selected.delete(picked.path);
                    paintBulk();
                };
            }
            if (S.showProject === false) options.showProject = false;
            // A handle only where a drag lands: manual order, or the week strip.
            if (!isMobile && (manual || S.strip)) options.dragHandle = manual ? true : 'Drag to a day';
            if (manual) options.onMove = onMove;
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
                const first = host === listHost && !host.firstChild;
                const section = host.createEl('div', { cls: 'sauce-todo-filter-project-group' });
                if (prefs.group === 'project') View.renderProjectHeader(section, group, { first, todayStr, TE, TTL });
                else label(section, group.label, first);
                const list = makeList(section);
                for (const task of group.tasks) renderRow(list, task, stale);
                View.wireCollapsible(section, list,
                    [S.key || '', (scope && scope.id) || '', prefs.group, stale ? 'stale' : 'live', group.label].join('|'), group.label);
            }
        };
        const paintList = () => {
            clear(listHost);
            const searching = !!query.trim();
            if (state.day) {
                const rows = View.selectDay(pool(), state.day);
                if (!rows.length) { paintEmpty(searching ? 'No tasks match.' : `Nothing due ${View._dayLabel(state.day)}.`); return; }
                paintRows(listHost, rows, false);
                return;
            }
            if (prefs.tab === 'overdue') {
                const split = View.splitOverdue(pool(), todayStr, TE);
                if (!split.overdue.length && !split.stale.length) { paintEmpty(searching ? 'No tasks match.' : ''); return; }
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
            const index = parents();
            const rows = View.selectTab(pool(), prefs.tab, todayStr, TE, index);
            if (!rows.length) {
                // The surface's own empty copy only when nothing exists at all;
                // a tab that is merely empty keeps the neutral line.
                const none = !pool().some((t) => t && String(t.status || 'open').toLowerCase() === 'open'
                    && View.isListable(t, index));
                paintEmpty(searching ? 'No tasks match.' : none ? S.emptyText : '');
                return;
            }
            paintRows(listHost, rows, false);
        };
        const paintEmpty = (text) => {
            const list = makeList(listHost);
            const empty = list.createEl('li', { cls: 'sauce-todo-filter-empty', text: text || 'No tasks in this view.' });
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
        // A scoped note lists its own finished tasks under the open ones, on
        // the All tab only: the first few, then "Show N more".
        const paintRecentDone = () => {
            const R = S.recentDone;
            const done = View.doneRecent(tasks, todayStr, R.days, TE, TTL, parents());
            if (!done.length) return;
            label(doneHost, `${R.label} · ${done.length}`);
            const limit = Number.isInteger(R.limit) && R.limit > 0 ? R.limit : done.length;
            const shown = state.doneAll ? done : done.slice(0, limit);
            for (const task of shown) {
                const day = typeof TE.completedDay === 'function' ? TE.completedDay(task) : '';
                const stamp = day && day !== todayStr ? View._dayLabel(day) : null;
                TTL.renderDoneRow(doneHost, task, { TD, notice: View._notice, onUndo: reopen, undoLabel: 'Reopen', stamp });
            }
            if (shown.length < done.length) {
                const more = doneHost.createEl('button', {
                    cls: 'sauce-todo-done-more', text: `Show ${done.length - shown.length} more`,
                });
                more.setAttribute('type', 'button');
                more.style.cssText = 'align-self:flex-start; background:none; border:none; box-shadow:none; padding:2px 6px; height:auto; font-size:0.85em; color:var(--text-accent); cursor:pointer;';
                more.addEventListener('click', onClick(() => { state.doneAll = true; paint(); }));
            }
        };
        const paintDone = () => {
            clear(doneHost);
            if (typeof TTL.renderDoneRow !== 'function') return;
            if (S.recentDone) {
                if (!state.day && prefs.tab === 'all') paintRecentDone();
                return;
            }
            if (!S.done) return;
            if (!state.day && prefs.tab !== 'today') return;
            const day = state.day || todayStr;
            const done = View.doneToday(tasks, day, TE, TTL, parents());
            if (!done.length) return;
            label(doneHost, `Done ${day === todayStr ? 'today' : View._dayLabel(day)} · ${done.length}`);
            for (const task of done) {
                TTL.renderDoneRow(doneHost, task, { TD, notice: View._notice, onUndo: reopen });
            }
        };
        const paintStrip = () => {
            clear(aboveTabs);
            if (!S.strip) return;
            const cells = View.weekStrip(tasks, todayStr, TE);
            if (!cells.length) return;
            const strip = aboveTabs.createEl('div', { cls: 'sauce-todo-week-strip' });
            strip.style.cssText = `display:grid; grid-template-columns:repeat(${cells.length}, minmax(0, 1fr)); gap:8px; width:100%; box-sizing:border-box;`;
            strip.setAttribute('role', 'group');
            strip.setAttribute('aria-label', 'This week');
            for (const cell of cells) {
                const picked = state.day === cell.date;
                const button = strip.createEl('button', {
                    cls: `sauce-todo-week-cell${cell.isToday ? ' is-today' : ''}${picked ? ' is-selected' : ''}`,
                });
                button.setAttribute('type', 'button');
                button.setAttribute('aria-label', `${cell.label}: ${cell.count} open`);
                button.setAttribute('aria-pressed', picked ? 'true' : 'false');
                if (cell.isToday) button.setAttribute('aria-current', 'date');
                button.dataset.date = cell.date;
                // A picked day wears the active pill's tint, border and glow,
                // so it reads as the same "selected" as the day pill it pairs with.
                const rest = picked ? 'color-mix(in srgb, var(--interactive-accent) 14%, transparent)' : 'transparent';
                const border = picked || cell.isToday ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
                const ink = picked || cell.isToday ? 'var(--text-accent)' : 'var(--text-normal)';
                const glow = picked ? ' box-shadow:0 0 8px color-mix(in srgb, var(--interactive-accent) 30%, transparent);' : '';
                button.style.cssText = `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; width:100%; min-width:0; height:auto; padding:6px 4px; box-sizing:border-box; border-radius:var(--radius-m, 6px); border:1px solid ${border}; color:${ink}; background:${rest};${glow} cursor:pointer;`;
                // Day name and date as two spans, so a phone can stack them
                // (sauce-core) and every cell keeps the same height.
                const name = button.createEl('span', { cls: 'sauce-todo-week-label' });
                const gap = String(cell.label).indexOf(' ');
                name.createEl('span', { text: gap > 0 ? String(cell.label).slice(0, gap + 1) : String(cell.label) });
                if (gap > 0) name.createEl('span', { text: String(cell.label).slice(gap + 1) });
                name.style.cssText = 'font-size:0.8em; font-weight:600; max-width:100%; white-space:normal; text-align:center; line-height:1.2;';
                const count = button.createEl('span', { cls: 'sauce-todo-week-count', text: String(cell.count) });
                count.style.cssText = `font-size:0.75em; color:${picked ? 'var(--text-accent)' : cell.count ? 'var(--text-muted)' : 'var(--text-faint)'}; font-variant-numeric:tabular-nums;`;
                button.addEventListener('click', onClick(() => {
                    state.day = picked ? null : cell.date;
                    paint();
                }));
                if (isMobile) continue;
                button.addEventListener('dragover', (event) => {
                    if (!dragPath) return;
                    try {
                        event.preventDefault();
                        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
                    } catch (_e) { /* the drop still works without dropEffect */ }
                    button.style.background = 'var(--background-modifier-hover)';
                });
                button.addEventListener('dragleave', () => { button.style.background = rest; });
                button.addEventListener('drop', (event) => {
                    try { event.preventDefault(); } catch (_e) { /* default drop is harmless */ }
                    button.style.background = rest;
                    const from = droppedPath(event);
                    dragPath = null;
                    if (!from) return undefined;
                    return dropOnDay(from, cell.date);
                });
            }
        };

        const bulk = async (verb, action, onOk, noticeAll) => {
            if (state.locks.has('bulk')) return undefined;
            const paths = [];
            for (const p of Array.from(selected)) {
                const task = taskByPath(p);
                if (task && String(task.status || 'open') === 'open') paths.push(p);
                else selected.delete(p);
            }
            if (!paths.length) { paint(); return undefined; }
            state.locks.add('bulk');
            let out = { done: [], failed: [] };
            try {
                paintBulk();
                out = await View.runBulk(paths, action, {
                    classify: (res) => TTL.classifyOutcome(res),
                    notice: (message) => View._notice(message),
                    onOk,
                    verb,
                    noticeAll,
                });
                for (const p of out.done) selected.delete(p);
            } finally {
                state.locks.delete('bulk');
            }
            repaintLive();
            return out;
        };
        const bulkReschedule = (due) => {
            if (due == null || typeof TTL.reschedule !== 'function') return undefined;
            return bulk('move', (p) => TTL.reschedule(
                rowByPath.get(p) || View._detachedRow(), taskByPath(p), due, viewedDay, TD),
            (p, res) => patchTask(p, (t) => applyMoved(t, res && res.due != null ? res.due : due)));
        };
        // Each selected task moves one day past the later of the viewed day
        // and its own due date, as the row's own tomorrow button does.
        const bulkTomorrow = () => {
            if (typeof TTL.reschedule !== 'function') return undefined;
            const dueFor = (task) => (typeof TTL.tomorrowFor === 'function'
                ? TTL.tomorrowFor(task, viewedDay) : TE.tomorrow(todayStr));
            const due = {};
            return bulk('move', (p) => {
                const task = taskByPath(p);
                due[p] = dueFor(task);
                return TTL.reschedule(rowByPath.get(p) || View._detachedRow(), task, due[p], viewedDay, TD);
            }, (p, res) => patchTask(p, (t) => applyMoved(t, res && res.due != null ? res.due : due[p])));
        };
        const bulkFields = (fields) => {
            if (!TD || typeof TD.setFields !== 'function') return undefined;
            return bulk('update', (p) => TD.setFields(p, fields),
                (p) => patchTask(p, (t) => Object.assign(t, fields)));
        };
        const bulkDone = () => {
            if (!TD || typeof TD.markDone !== 'function') return undefined;
            return bulk('complete', (p) => TD.markDone(p), (p) => patchTask(p, applyDone), true);
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
                // The dialog's save writes _slugify(name); match it. An older
                // TaskDialog without the delegate falls back to the list's slug.
                const slug = typeof TD._slugify === 'function'
                    ? String(TD._slugify(name) || '')
                    : String(project.slug || '');
                if (!slug) continue;
                entries.push({ label: name, onSelect: () => bulkFields({ project: `[[${name}]]`, project_slug: slug }) });
            }
            return entries;
        };
        const paintBulk = () => {
            clear(bulkHost);
            if (!state.selecting || selected.size === 0) return;
            const bar = bulkHost.createEl('div', { cls: 'sauce-todo-bulkbar' });
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', 'Selected tasks');
            bar.createEl('span', { cls: 'sauce-todo-bulk-count', text: `${selected.size} selected` });
            const action = (text, handler) => {
                const button = bar.createEl('button', { cls: 'sauce-todo-bulk-action', text });
                button.setAttribute('type', 'button');
                if (state.locks.has('bulk')) button.disabled = true;
                button.addEventListener('click', onClick(() => handler(button)));
                return button;
            };
            action('→ Today', () => bulkReschedule(todayStr)).setAttribute('title', 'Move the selected tasks to today');
            action('→ Tomorrow', () => bulkTomorrow());
            action('→ Next Mon', () => bulkReschedule(TE.nextMonday(todayStr)));
            action('Priority ▾', (button) => openPicker(button, priorityEntries())).setAttribute('aria-haspopup', 'menu');
            action('Project ▾', (button) => openPicker(button, projectEntries())).setAttribute('aria-haspopup', 'menu');
            const backlog = action('Backlog', () => bulkReschedule(''));
            backlog.setAttribute('title', 'Remove date (personal tasks go to Backlog)');
            backlog.setAttribute('aria-label', 'Remove date (personal tasks go to Backlog)');
            action('Mark done', () => bulkDone());
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
            } catch (e) {
                try { console.warn('[ToDoDailyFilterView] render failed', e); } catch (_e) { /* no console */ }
            }
        };

        const commit = (patch) => {
            prefs = View.writePrefs(storage, { ...prefs, ...patch }, S.key);
            paint();
        };
        const onClick = (handler) => (event) => {
            try { event.preventDefault(); event.stopPropagation(); } catch (_e) {}
            return handler();
        };

        const openMenu = (anchor, options, key, current) => {
            if (!Array.isArray(options) || !options.length) return;
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

        for (const key of S.tabs) {
            const button = tabGroup.createEl('button', { text: TAB_LABELS[key] });
            tabButtons[key] = button;
            button.setAttribute('type', 'button');
            button.setAttribute('role', 'tab');
            button.addEventListener('click', onClick(() => {
                const wasDay = !!state.day;
                state.day = null;
                if (prefs.tab === key) { if (wasDay) paint(); return; }
                commit({ tab: key });
            }));
        }
        let sortButton = null;
        if (tools.includes('sort')) {
            sortButton = rightSide.createEl('button', { text: 'Sort ▾' });
            sortButton.setAttribute('type', 'button');
            sortButton.setAttribute('aria-haspopup', 'menu');
            sortButton.addEventListener('click', onClick(
                () => openMenu(sortButton, TTL.SORT_OPTIONS || [], 'sort', prefs.sort)));
        }
        let groupButton = null;
        if (tools.includes('group')) {
            groupButton = rightSide.createEl('button', { text: 'Group ▾' });
            groupButton.setAttribute('type', 'button');
            groupButton.setAttribute('aria-haspopup', 'menu');
            groupButton.addEventListener('click', onClick(
                () => openMenu(groupButton, TTL.GROUP_OPTIONS || [], 'group', prefs.group)));
        }
        state.live = { paint, taskByPath };
        let selectButton = null;
        if (tools.includes('select')) {
            selectButton = rightSide.createEl('button', { text: 'Select' });
            selectButton.setAttribute('type', 'button');
            selectButton.addEventListener('click', onClick(() => {
                state.selecting = !state.selecting;
                if (!state.selecting) selected.clear();
                paint();
            }));
        }

        paint();
    }
}
