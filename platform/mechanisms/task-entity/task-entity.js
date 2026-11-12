/**
 * TaskEntity (CustomJS) — pure core of the note-per-task model.
 *
 * Every to-do task becomes its own tiny note under `spice/tasks/` with
 * `type: task` frontmatter; surfaces (daily, project, meeting) live-query
 * those notes. This class owns the DETERMINISTIC, side-effect-free core:
 *
 *   - taskFilename(payload, moment) → human-readable "<title>.md" (caller dedupes)
 *   - composeNote(payload)          → { path, frontmatter, body }
 *   - parseNote(page)               → normalized task view
 *   - queryToday(tasks, todayStr)   → { today, overdue }
 *   - validatePayload(payload)      → { valid, reason }
 *
 * SAFETY GUARANTEES (see README): one note per task means a bad write can only
 * ever touch one task's file, never a whole day's list; every helper here is
 * pure so the same input always yields the same output.
 *
 * DETERMINISM: no Date.now / Math.random / new Date. The filename is the
 * SANITIZED title + ".md" (readable), so two tasks with the SAME title collide
 * — the caller resolves that with `_uniqueName(base, existsFn)`, which appends
 * " 2", " 3", … against the vault. Re-deriving the same payload yields the same
 * base name.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (`module.exports`,
 * `if`, ...) → "Unexpected token" → the class never registers. To Node-test,
 * load via `new Function(src + "; return TaskEntity;")()` (see run-task-entity.js).
 *
 * Static API (Node-testable, pure):
 *   TaskEntity._sanitizeTitle(title)         → safe readable filename base
 *   TaskEntity.taskFilename(payload, moment) → "<title>.md"
 *   TaskEntity._uniqueName(base, existsFn)   → collision-free filename
 *   TaskEntity.composeNote(payload)          → { path, frontmatter, body }
 *   TaskEntity.parseNote(page)               → normalized object
 *   TaskEntity.queryToday(tasks, todayStr)   → { today, overdue }
 *   TaskEntity._groupSubtaskCounts(parsedTasks)  → { [parentBasename]: {done,total} }
 *   TaskEntity.subtaskCountsByParent(dv)          → { [parentBasename]: {done,total} }
 *   TaskEntity.validatePayload(payload)      → { valid, reason }
 */
class TaskEntity {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.TaskEntity, and
    // cross-class consumers (TaskDialog / TaskTodayList in later tasks, plus the
    // Node harness which news the class) reach these via that instance. A
    // static-only declaration is not on the prototype → the call throws at
    // runtime. Each instance method must precede its static in source order.

    taskFilename(payload, moment) { return TaskEntity.taskFilename(payload, moment); }
    composeNote(payload) { return TaskEntity.composeNote(payload); }
    parseNote(page) { return TaskEntity.parseNote(page); }
    queryToday(tasks, todayStr) { return TaskEntity.queryToday(tasks, todayStr); }
    nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn) { return TaskEntity.nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn); }
    validatePayload(payload) { return TaskEntity.validatePayload(payload); }
    _toDateStr(v) { return TaskEntity._toDateStr(v); }
    _linkText(v) { return TaskEntity._linkText(v); }
    _normLinks(v) { return TaskEntity._normLinks(v); }
    _sanitizeTitle(title) { return TaskEntity._sanitizeTitle(title); }
    _uniqueName(baseFilename, existsFn) { return TaskEntity._uniqueName(baseFilename, existsFn); }
    get TASK_ROOT() { return TaskEntity.TASK_ROOT; }
    taskName(title, ctx) { return TaskEntity.taskName(title, ctx); }
    folderNotePath(parentFolder, name) { return TaskEntity.folderNotePath(parentFolder, name); }
    isFolderNote(path) { return TaskEntity.isFolderNote(path); }
    taskFolderOf(path) { return TaskEntity.taskFolderOf(path); }
    parentNotePathOf(path) { return TaskEntity.parentNotePathOf(path); }
    rootFolderOf(path) { return TaskEntity.rootFolderOf(path); }
    doneFolderFor(completedAt) { return TaskEntity.doneFolderFor(completedAt); }
    taskState(task) { return TaskEntity.taskState(task); }
    isOpenTask(pageOrTask) { return TaskEntity.isOpenTask(pageOrTask); }
    _chromeBody() { return TaskEntity._chromeBody(); }
    _groupSubtaskCounts(parsedTasks) { return TaskEntity._groupSubtaskCounts(parsedTasks); }
    subtaskCountsByParent(dv) { return TaskEntity.subtaskCountsByParent(dv); }
    get STALE_DAYS() { return TaskEntity.STALE_DAYS; }
    addDays(dateStr, n) { return TaskEntity.addDays(dateStr, n); }
    tomorrow(todayStr) { return TaskEntity.tomorrow(todayStr); }
    nextMonday(todayStr) { return TaskEntity.nextMonday(todayStr); }
    daysLate(task, todayStr) { return TaskEntity.daysLate(task, todayStr); }
    isBacklog(task) { return TaskEntity.isBacklog(task); }
    bucketOf(task, todayStr) { return TaskEntity.bucketOf(task, todayStr); }
    completedDay(task) { return TaskEntity.completedDay(task); }
    compareBy(mode, todayStr) { return TaskEntity.compareBy(mode, todayStr); }
    renumber(orderedPaths, rankByPath) { return TaskEntity.renumber(orderedPaths, rankByPath); }
    parseTitleShortcuts(text, todayStr, projectNames) { return TaskEntity.parseTitleShortcuts(text, todayStr, projectNames); }

    // ---------- Static pure helpers ----------

    static get STALE_DAYS() { return 30; }

    /**
     * Calendar-date math on plain `YYYY-MM-DD` strings via Date.UTC /
     * getUTC* only — no wall-clock or local-zone reads. Unparseable input
     * returns null.
     */
    static addDays(dateStr, n) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr == null ? '' : dateStr));
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(n) || 0)));
        const p = (x) => String(x).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }

    static tomorrow(todayStr) { return TaskEntity.addDays(todayStr, 1); }

    /** Next Monday strictly after `todayStr` (a Monday yields +7 days). */
    static nextMonday(todayStr) {
        return TaskEntity._nextWeekday(todayStr, 1);
    }

    /** Next occurrence of weekday `dow` (0=Sun..6=Sat) strictly after `todayStr`. */
    static _nextWeekday(todayStr, dow) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(todayStr == null ? '' : todayStr));
        if (!m) return null;
        const cur = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
        const delta = ((dow - cur + 7) % 7) || 7;
        return TaskEntity.addDays(todayStr, delta);
    }

    /** Whole days `task.due` is before `todayStr`; 0 when not overdue or no due. */
    static daysLate(task, todayStr) {
        const due = TaskEntity._toDateStr(task && task.due);
        const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(due == null ? '' : due));
        const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(todayStr == null ? '' : todayStr));
        if (!m1 || !m2) return 0;
        const diff = Math.round((Date.UTC(+m2[1], +m2[2] - 1, +m2[3]) - Date.UTC(+m1[1], +m1[2] - 1, +m1[3])) / 86400000);
        return diff > 0 ? diff : 0;
    }

    /**
     * Personal undated open task: open, no due, no project_slug / trip_slug /
     * parent_task, and not sourced from a meeting. A missing status counts as
     * open (parseNote's own default).
     */
    static isBacklog(task) {
        const t = task || {};
        if ((t.status || 'open') !== 'open') return false;
        if (TaskEntity._toDateStr(t.due)) return false;
        if (t.project_slug || t.trip_slug || t.parent_task) return false;
        if (t.source === 'meeting') return false;
        return true;
    }

    /**
     * Surface bucket for a task. 'done' only for status done. Open tasks:
     * 'backlog' (see isBacklog) / 'undated' (no due but owned by a
     * project/trip/meeting/parent) / 'today' / 'overdue' (1..STALE_DAYS-1 late) /
     * 'stale' (>= STALE_DAYS late) / 'upcoming'. Any other status (e.g.
     * 'deleted') is not an open task and also reports 'undated' so it never
     * lands in a due-date band.
     */
    static bucketOf(task, todayStr) {
        const t = task || {};
        const status = t.status || 'open';
        if (status === 'done') return 'done';
        if (status !== 'open') return 'undated';
        const due = TaskEntity._toDateStr(t.due);
        if (!due) return TaskEntity.isBacklog(t) ? 'backlog' : 'undated';
        if (due === todayStr) return 'today';
        const late = TaskEntity.daysLate(t, todayStr);
        if (late >= TaskEntity.STALE_DAYS) return 'stale';
        if (late >= 1) return 'overdue';
        return 'upcoming';
    }

    /**
     * Calendar day (`YYYY-MM-DD`) of `task.completed_at`, read in the zone the
     * value was written in (an ISO string keeps its own offset, so the leading
     * date IS the local day). Luxon-ish objects use toISODate / toFormat
     * directly (no UTC shift). Empty / unparseable -> null.
     */
    static completedDay(task) {
        const v = task && task.completed_at;
        if (v == null || v === '') return null;
        if (typeof v === 'string') {
            const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(v);
            return m ? m[1] : null;
        }
        try {
            if (typeof v.toISODate === 'function') return v.toISODate() || null;
            if (typeof v.toFormat === 'function') return v.toFormat('yyyy-MM-dd') || null;
        } catch (_e) { return null; }
        return TaskEntity._toDateStr(v);
    }

    static _priorityRank(p) {
        switch (String(p == null ? '' : p).trim().toLowerCase()) {
            case 'highest': return 4;
            case 'high': return 3;
            case 'medium': return 2;
            case 'low': return 1;
            default: return 0;
        }
    }

    /** Finite numeric rank or null ('' / junk -> null; Number('') is 0, so guard it). */
    static _rankOf(v) {
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v !== 'string' || v.trim() === '') return null;
        const n = Number(v);
        return isFinite(n) ? n : null;
    }

    /** Epoch ms from number / Luxon (toMillis, ts) / ISO string; else null. */
    static _msOf(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        if (typeof v === 'string') {
            const n = Date.parse(v);
            return isNaN(n) ? null : n;
        }
        try {
            if (typeof v.toMillis === 'function') {
                const n = v.toMillis();
                return typeof n === 'number' && isFinite(n) ? n : null;
            }
        } catch (_e) { return null; }
        if (typeof v.ts === 'number' && isFinite(v.ts)) return v.ts;
        return null;
    }

    /**
     * Comparator factory. Modes: smart | manual | priority | due | oldest |
     * touched; anything else behaves as smart. Every comparator is total and
     * tolerant of missing / junk fields (never throws), ending on title so
     * the order is deterministic.
     */
    static compareBy(mode, todayStr) {
        const asc = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
        const nullsLast = (x, y, cmp) => {
            if (x == null && y == null) return 0;
            if (x == null) return 1;
            if (y == null) return -1;
            return cmp(x, y);
        };
        const title = (a, b) => asc(String((a && a.title) || '').toLowerCase(), String((b && b.title) || '').toLowerCase());
        const created = (a, b) => nullsLast(TaskEntity._msOf(a && a.created_at), TaskEntity._msOf(b && b.created_at), asc);
        const priority = (a, b) => TaskEntity._priorityRank(b && b.priority) - TaskEntity._priorityRank(a && a.priority);
        const late = (a, b) => TaskEntity.daysLate(b, todayStr) - TaskEntity.daysLate(a, todayStr);
        const rank = (a, b) => nullsLast(TaskEntity._rankOf(a && a.rank), TaskEntity._rankOf(b && b.rank), asc);
        const chain = (...fns) => (a, b) => {
            for (const f of fns) { const r = f(a, b); if (r) return r; }
            return 0;
        };
        switch (mode) {
            case 'manual': return chain(rank, created, title);
            case 'priority': return chain(priority, late, created, title);
            case 'due': return chain(
                (a, b) => nullsLast(TaskEntity._toDateStr(a && a.due), TaskEntity._toDateStr(b && b.due), asc),
                priority, created, title);
            case 'oldest': return chain(created, title);
            case 'touched': return chain(
                (a, b) => nullsLast(TaskEntity._msOf(a && a.mtime), TaskEntity._msOf(b && b.mtime), (x, y) => y - x),
                title);
            default: return chain(rank, priority, late, created, title);
        }
    }

    /**
     * Manual-order renumber: given the new top-to-bottom order of task paths
     * and their current ranks, return the { path, rank } writes that make rank
     * equal position + 1, skipping rows whose rank already matches. Blank paths
     * keep their position but are never written. Pure.
     */
    static renumber(orderedPaths, rankByPath) {
        const ranks = rankByPath && typeof rankByPath === 'object' ? rankByPath : {};
        const list = Array.isArray(orderedPaths) ? orderedPaths : [];
        const out = [];
        list.forEach((p, i) => {
            if (!p) return;
            const cur = Object.prototype.hasOwnProperty.call(ranks, p) ? ranks[p] : null;
            const ranked = cur !== null && cur !== undefined && cur !== '';
            if (!ranked || Number(cur) !== i + 1) out.push({ path: p, rank: i + 1 });
        });
        return out;
    }

    /**
     * Pull a trailing run of shortcut tokens off a task title. Scans from the
     * END only and stops at the first word that is not a token, so
     * "Prep Monday standup notes" is untouched. Tokens: today, tomorrow,
     * next <weekday>, <weekday> (next occurrence strictly after today),
     * !low|!medium|!high|!highest, #Project / #"Two Words" (case-insensitive:
     * exact name first, then a unique prefix; no match stops the scan and the
     * text stays in the title). Each field is taken once (the rightmost wins;
     * a second token of the same field stops the scan), and a token is never
     * consumed if that would leave an empty title.
     * Returns { title, due?, priority?, project? }.
     */
    static parseTitleShortcuts(text, todayStr, projectNames) {
        const names = Array.isArray(projectNames) ? projectNames.map(String) : [];
        const DAYS = {
            sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
            wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
            fri: 5, friday: 5, sat: 6, saturday: 6,
        };
        const findProject = (raw) => {
            const q = String(raw).trim().toLowerCase();
            if (!q) return null;
            const exact = names.filter((n) => n.toLowerCase() === q);
            if (exact.length) return exact[0];
            const pre = names.filter((n) => n.toLowerCase().startsWith(q));
            return pre.length === 1 ? pre[0] : null;
        };
        let rest = String(text == null ? '' : text).replace(/\s+$/, '');
        const out = {};
        for (;;) {
            let m;
            let consumed = null;
            let field = null;
            let value = null;
            if ((m = /^(.*?)\s*#"([^"]+)"$/.exec(rest))) {
                const proj = findProject(m[2]);
                if (proj) { consumed = m[1]; field = 'project'; value = proj; }
            } else if ((m = /^(.*?)(?:^|\s)#([^\s"#]+)$/.exec(rest))) {
                const proj = findProject(m[2]);
                if (proj) { consumed = m[1]; field = 'project'; value = proj; }
            } else if ((m = /^(.*?)(?:^|\s)!(low|medium|high|highest)$/i.exec(rest))) {
                consumed = m[1]; field = 'priority'; value = m[2].toLowerCase();
            } else if ((m = /^(.*?)(?:^|\s)next\s+([A-Za-z]+)$/i.exec(rest)) && DAYS[m[2].toLowerCase()] != null) {
                consumed = m[1]; field = 'due'; value = TaskEntity._nextWeekday(todayStr, DAYS[m[2].toLowerCase()]);
            } else if ((m = /^(.*?)(?:^|\s)([A-Za-z]+)$/.exec(rest))) {
                const w = m[2].toLowerCase();
                if (w === 'today') { consumed = m[1]; field = 'due'; value = todayStr; }
                else if (w === 'tomorrow') { consumed = m[1]; field = 'due'; value = TaskEntity.tomorrow(todayStr); }
                else if (DAYS[w] != null) { consumed = m[1]; field = 'due'; value = TaskEntity._nextWeekday(todayStr, DAYS[w]); }
            }
            if (field == null || out[field] !== undefined) break;
            const remaining = consumed.replace(/\s+$/, '');
            if (!remaining) break;
            out[field] = value;
            rest = remaining;
        }
        out.title = rest;
        return out;
    }

    /**
     * Turn a task title into a safe, HUMAN-READABLE filename base (no `.md`).
     * Strips Obsidian-illegal filename chars (`/ \ : * ? " < > | # ^ [ ]`),
     * collapses runs of whitespace to a single space, trims, and caps to ~80
     * chars so a pathological title can't blow the filesystem name limit.
     * Normal case + spaces are preserved so "Go through mail" stays readable.
     * An empty result (title was all-illegal or blank) → "Task" so we never
     * emit ".md" / a dotfile. Pure + deterministic.
     */
    static _sanitizeTitle(title) {
        const s = String(title == null ? '' : title)
            .replace(/[/\\:*?"<>|#^[\]]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
            .trim();
        return s === '' ? 'Task' : s;
    }

    /**
     * Given a base filename ("Go through mail.md") and a predicate
     * `existsFn(vaultPath)` → bool that reports whether `spice/tasks/<name>`
     * is already taken, return a FREE filename: the base if it's free, else
     * "Go through mail 2.md", "…3.md", … Returns just the filename (the caller
     * prepends `spice/tasks/`). Pure apart from the injected predicate; a
     * missing/non-function predicate → the base is returned unchanged.
     */
    static _uniqueName(baseFilename, existsFn) {
        const base = String(baseFilename == null ? '' : baseFilename);
        const taken = (name) => {
            try { return typeof existsFn === 'function' ? !!existsFn('spice/tasks/' + name) : false; }
            catch (_e) { return false; }
        };
        if (!taken(base)) return base;
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext = dot > 0 ? base.slice(dot) : '';
        // Cap the probe count so a pathological existsFn can't spin forever.
        for (let n = 2; n < 10000; n++) {
            const candidate = stem + ' ' + n + ext;
            if (!taken(candidate)) return candidate;
        }
        return stem + ' ' + Date.now() + ext;
    }

    static get TASK_ROOT() { return 'spice/tasks'; }

    /**
     * The note and folder name for a task: its sanitized title while no other
     * note in the vault has that basename, else `Title (Parent Title)` for a
     * subtask or `Title - MM-DD-YY` (from createdAt) for a top-level task,
     * else that plus " 2", " 3", …. `ctx.taken(lowerBasename)` is the caller's
     * vault-wide, case-insensitive clash check (candidates are passed
     * lowercased, no ".md"). The whole name stays within 120 characters: the
     * qualifier (parent title / date) is trimmed first, and the title only
     * when no qualifier is left and title plus number still exceed 120.
     * No `Date` involved.
     */
    static taskName(title, ctx) {
        const c = ctx || {};
        const taken = (name) => {
            try { return typeof c.taken === 'function' ? !!c.taken(String(name).toLowerCase()) : false; }
            catch (_e) { return false; }
        };
        const MAX = 120;
        const fit = (t, qual, num) => {
            let q = '';
            if (qual && qual.inner) {
                const room = MAX - t.length - num.length - qual.open.length - qual.close.length;
                const cut = room >= 1 ? qual.inner.slice(0, room).trimEnd() : '';
                if (cut) q = qual.open + cut + qual.close;
            }
            const room = MAX - q.length - num.length;
            return (t.length > room ? t.slice(0, room).trimEnd() : t) + q + num;
        };
        const base = TaskEntity._sanitizeTitle(title);
        if (!taken(fit(base, null, ''))) return fit(base, null, '');
        let qual = null;
        if (c.parentTitle != null && String(c.parentTitle).trim() !== '') {
            qual = { open: ' (', inner: TaskEntity._sanitizeTitle(c.parentTitle), close: ')' };
        } else {
            const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(c.createdAt == null ? '' : c.createdAt));
            if (m) qual = { open: ' - ', inner: m[2] + '-' + m[3] + '-' + m[1].slice(2), close: '' };
        }
        if (qual && !taken(fit(base, qual, ''))) return fit(base, qual, '');
        for (let n = 2; n < 10000; n++) {
            const candidate = fit(base, qual, ' ' + n);
            if (!taken(candidate)) return candidate;
        }
        return fit(base, qual, ' ' + Date.now());
    }

    static folderNotePath(parentFolder, name) {
        return parentFolder + '/' + name + '/' + name + '.md';
    }

    static _noteParts(path) {
        const p = String(path == null ? '' : path);
        const i = p.lastIndexOf('/');
        const dir = i < 0 ? '' : p.slice(0, i);
        const file = i < 0 ? p : p.slice(i + 1);
        const base = file.replace(/\.md$/i, '');
        const j = dir.lastIndexOf('/');
        return { dir, base, folderName: j < 0 ? dir : dir.slice(j + 1) };
    }

    static isFolderNote(path) {
        const n = TaskEntity._noteParts(path);
        return n.base !== '' && n.base === n.folderName;
    }

    static taskFolderOf(path) {
        return TaskEntity._noteParts(path).dir;
    }

    static _isTaskFolder(dir) {
        const root = TaskEntity.TASK_ROOT;
        if (dir.indexOf(root + '/') !== 0) return false;
        if (dir === root + '/_done' || dir === root + '/_trash') return false;
        if (/^spice\/tasks\/_done\/\d{4}(\/\d{2})?$/.test(dir)) return false;
        return true;
    }

    static parentNotePathOf(path) {
        if (!TaskEntity.isFolderNote(path)) return '';
        const folder = TaskEntity._noteParts(path).dir;
        const j = folder.lastIndexOf('/');
        if (j < 0) return '';
        const up = folder.slice(0, j);
        if (!TaskEntity._isTaskFolder(up)) return '';
        const k = up.lastIndexOf('/');
        return up + '/' + up.slice(k + 1) + '.md';
    }

    static rootFolderOf(path) {
        const p = String(path == null ? '' : path);
        const root = TaskEntity.TASK_ROOT + '/';
        if (p.indexOf(root) !== 0) return '';
        const segs = p.slice(root.length).split('/');
        let take = 1;
        if (segs[0] === '_done') take = 4;
        else if (segs[0] === '_trash') take = 2;
        if (segs.length <= take) return '';
        return root + segs.slice(0, take).join('/');
    }

    static doneFolderFor(completedAt) {
        let s = '';
        if (typeof completedAt === 'string') s = completedAt.trim();
        else if (completedAt != null && completedAt !== '') s = String(TaskEntity._toDateStr(completedAt) || '');
        let m = /^(\d{4})-(\d{2})/.exec(s);
        if (!m) {
            let now;
            if (typeof window !== 'undefined' && window && typeof window.moment === 'function') now = window.moment().format('YYYY-MM');
            else {
                const d = new Date();
                now = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            }
            m = /^(\d{4})-(\d{2})/.exec(now);
        }
        return TaskEntity.TASK_ROOT + '/_done/' + m[1] + '/' + m[2];
    }

    static taskState(task) {
        const t = task || {};
        const p = String(t.path || (t.file && t.file.path) || '');
        if (p.indexOf(TaskEntity.TASK_ROOT + '/_trash/') === 0) return 'deleted';
        const status = t.status || 'open';
        if (status === 'deleted') return 'deleted';
        if (status === 'done') return 'done';
        return 'open';
    }

    static _parentNameOf(path, parentTaskValue) {
        const parentPath = path ? TaskEntity.parentNotePathOf(path) : '';
        if (parentPath) return TaskEntity._noteParts(parentPath).base;
        return parentTaskValue != null ? TaskEntity._linkText(parentTaskValue) : '';
    }

    static isOpenTask(pageOrTask) {
        const t = pageOrTask || {};
        if (t.type != null && t.type !== '' && t.type !== 'task') return false;
        return TaskEntity.taskState(t) === 'open';
    }

    /**
     * Normalize any date-ish value to a `YYYY-MM-DD` string (or null). Dataview
     * parses an UNQUOTED frontmatter date (`scheduled: 2026-07-01`) into a Luxon
     * DateTime object, NOT a string — so comparing `page.scheduled` against a
     * string todayStr (buildBands / queryToday) always fails and every scheduled
     * task falls into neither band (empty daily list). parseNote runs every date
     * through this on READ so downstream comparisons see plain strings. Handles:
     * string (ISO or date), Luxon DateTime (toISODate / toFormat), moment
     * (format), and JS Date. Empty / null / unparseable → null.
     *
     * UTC-safe: a bare YAML date (`scheduled: 2026-07-08`) parses to UTC
     * midnight; Dataview wraps it in a Luxon DateTime in the LOCAL system
     * zone, so naive .toISODate()/.toFormat() in a negative-UTC-offset zone
     * (e.g. America/Chicago, -06:00) rolls the calendar date back one day —
     * misclassifying today-scheduled tasks as overdue. Always read the
     * calendar date via UTC accessors first, regardless of the device's
     * local zone.
     */
    static _toDateStr(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return null;
            const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
            return m ? m[1] : s;
        }
        // Luxon DateTime (Dataview) — convert to UTC first (see note above).
        if (typeof v.toISODate === 'function') {
            const dt = (typeof v.toUTC === 'function') ? v.toUTC() : v;
            const s = dt.toISODate();
            return s || null;
        }
        if (typeof v.toFormat === 'function') {
            const dt = (typeof v.toUTC === 'function') ? v.toUTC() : v;
            return dt.toFormat('yyyy-MM-dd');
        }
        // moment — mutable, so clone before switching to UTC (never mutate
        // the caller's instance).
        if (typeof v.format === 'function') {
            const dt = (typeof v.clone === 'function' && typeof v.utc === 'function')
                ? v.clone().utc()
                : v;
            const s = dt.format('YYYY-MM-DD');
            return s || null;
        }
        // JS Date — read the calendar date via UTC getters (a bare YAML date
        // parses to UTC midnight; local getters roll it back a day in a
        // negative-offset zone).
        if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
            const p = (n) => String(n).padStart(2, '0');
            return v.getUTCFullYear() + '-' + p(v.getUTCMonth() + 1) + '-' + p(v.getUTCDate());
        }
        const m2 = /(\d{4}-\d{2}-\d{2})/.exec(String(v));
        return m2 ? m2[1] : null;
    }

    /**
     * Coerce a Dataview LINK-valued frontmatter field (source_note / project) into
     * a plain, comparable BASENAME string. Just like an unquoted date becomes a
     * Luxon DateTime, a `[[Wikilink]]` frontmatter value becomes a Dataview Link
     * OBJECT (with `.path` / `.display` / `.subpath`), NOT a string — so comparing
     * `page.source_note === meetingBasename` always fails and a meeting/project
     * task-list filter never matches. This normalizes every shape to the note's
     * basename (the last `/` segment of the path, trailing `.md` stripped):
     *   - nullish                                    → ''
     *   - Dataview Link ({path/display/subpath})     → basename of .path, else .display
     *   - string "[[Bar]]" / "[[a/b/Baz.md|Baz]]"    → basename, pipe-label + path + .md tolerated
     *   - anything else                              → String(v)
     * Pure + null-tolerant; never throws.
     */
    static _linkText(v) {
        if (v == null) return '';
        // Basename of a path-ish string: last `/` segment, trailing `.md` stripped.
        const baseOf = (s) => {
            let out = String(s == null ? '' : s).trim();
            const slash = out.lastIndexOf('/');
            if (slash >= 0) out = out.slice(slash + 1);
            return out.replace(/\.md$/i, '');
        };
        // Dataview Link object — has .path/.display/.subpath (not a string).
        if (typeof v === 'object'
            && ('path' in v || 'display' in v || 'subpath' in v)) {
            if (v.path != null && String(v.path).trim() !== '') return baseOf(v.path);
            if (v.display != null) return String(v.display).trim();
            return '';
        }
        if (typeof v === 'string') {
            let s = v.trim();
            // Strip surrounding [[ ]] if present.
            const m = /^\[\[([^\]]*)\]\]$/.exec(s);
            if (m) s = m[1].trim();
            // Split off any `|label` alias → keep the target (before the pipe).
            const pipe = s.indexOf('|');
            if (pipe >= 0) s = s.slice(0, pipe).trim();
            return baseOf(s);
        }
        return String(v);
    }

    /**
     * Normalize a `links` frontmatter value into a clean array of markdown link
     * STRINGS (FIX 5). Each entry is expected to be a markdown link — a note link
     * `"[[Note]]"`, a web link `"[label](url)"`, or `"<url>"`. Coerces each entry
     * to a trimmed string and DROPS blanks; a Dataview Link OBJECT (which Dataview
     * surfaces for a `[[wikilink]]` inside a YAML array) is coerced back to
     * `[[basename]]` via _linkText so it stays a renderable wikilink. A non-array
     * / nullish input yields []. Pure + null-tolerant; never throws.
     */
    static _normLinks(v) {
        if (!Array.isArray(v)) return [];
        const out = [];
        for (const entry of v) {
            if (entry == null) continue;
            let s;
            if (typeof entry === 'string') {
                s = entry.trim();
            } else if (typeof entry === 'object'
                && ('path' in entry || 'display' in entry || 'subpath' in entry)) {
                // A Dataview Link object → a renderable `[[basename]]` wikilink.
                const base = TaskEntity._linkText(entry);
                s = base ? '[[' + base + ']]' : '';
            } else {
                s = String(entry).trim();
            }
            if (s) out.push(s);
        }
        return out;
    }

    /**
     * Human-readable per-task filename: the sanitized TITLE + ".md"
     * (e.g. "Go through mail.md") — NO timestamp, NO hash. Titles can collide,
     * so the CALLER dedupes the returned base against the vault via
     * `_uniqueName(base, existsFn)` before writing. `moment` is accepted for
     * signature compatibility (created_at stamping lives in composeNote) but is
     * no longer used to derive the name.
     */
    static taskFilename(payload, moment) {
        const p = payload || {};
        return TaskEntity._sanitizeTitle(p.title) + '.md';
    }

    /**
     * The canonical CHROME body for a task note (no user notes yet). Task notes
     * are written at RUNTIME (app.vault.create), not through the template
     * installer, so the customjs-guard refs are MATERIALIZED here rather than
     * left as installer tokens. TaskChromeBar gives the shared breadcrumb + Go ▾
     * nav bar (see task-entity's manifest breadcrumb.types.task declaration); the
     * TaskNoteView widget renders the clean task card. The two `---` thematic
     * breaks fence the card: nav → HR → card → HR → notes. The
     * `<!-- TASK_NOTES -->` marker separates the (regenerable) chrome above from
     * the user's own notes below — the edit dialog + the install heal both key
     * off this marker.
     *
     * RENDER NOTE: each `---` sits on its OWN line with a BLANK line above + below
     * so Obsidian renders it as a horizontal rule (not swallowed as a setext
     * heading under the preceding code fence / paragraph); the dataviewjs fences
     * still close on their own ``` line, so both blocks keep executing.
     * Keep this string BYTE-IDENTICAL to the heal's inline copy in install.js.
     */
    static _chromeBody() {
        return '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });\n' +
            '```\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
    }

    /**
     * Compose a task note from a create payload. Returns:
     *   { path: "spice/tasks/<filename>", frontmatter: {...}, body: <chrome> }
     *
     * Frontmatter keys are emitted in the canonical schema order. Absent
     * due / completed_at are emitted as EMPTY STRINGS (not omitted)
     * so downstream edits (setting a date) are a simple in-place field write.
     * `path` is the legacy flat path and is not where a new task goes: TaskDialog
     * places it with taskName + folderNotePath.
     * The body is the CHROME body (TaskChromeBar + TaskNoteView + the
     * `<!-- TASK_NOTES -->` marker) so a freshly-created task note is never
     * bare; the caller appends any typed user notes BELOW the marker.
     *
     * payload = {
     *   title, status?, due?, recurrence?, priority?,
     *   project?: { name, slug }, source?, source_note?,
     *   now?, moment?,   // now: ISO string; moment: moment-like for filename+created_at
     * }
     */
    static composeNote(payload) {
        const p = payload || {};
        const moment = p.moment || null;
        const filename = TaskEntity.taskFilename(p, moment);
        const createdAt = p.now
            || (moment && moment.format ? moment.format('YYYY-MM-DDTHH:mm:ssZ') : '');
        const project = (p.project && p.project.name) ? `[[${p.project.name}]]` : '';
        const projectSlug = (p.project && p.project.slug) ? p.project.slug : '';
        // Trip linkage — PARALLEL and ADDITIVE to project (same shape/semantics):
        // `trip` is a Dataview LINK-valued display field (`[[Name]]`), `trip_slug`
        // a plain-string filter key. Empty (not omitted) when no trip is given so a
        // later edit is a simple in-place field write, exactly like project.
        const trip = (p.trip && p.trip.name) ? `[[${p.trip.name}]]` : '';
        const tripSlug = (p.trip && p.trip.slug) ? String(p.trip.slug) : '';
        // Structured links (FIX 5) — an array of markdown link STRINGS that
        // TaskNoteView renders INSIDE the card (a note link `[[Note]]`, a web link
        // `[label](url)` / `<url>`). Normalized to a clean string array: coerce
        // each entry to a string, trim, and drop blanks; a non-array / nullish
        // `links` becomes []. Kept empty (not omitted) so it round-trips as an
        // empty flow array and a later edit is a simple field write.
        const links = TaskEntity._normLinks(p.links);
        // Canonical key order — keep in lockstep with the schema in the README.
        const frontmatter = {
            type: 'task',
            title: p.title || '',
            status: p.status || 'open',
            due: p.due || '',
            recurrence: p.recurrence || '',
            priority: p.priority || '',
            project: project,
            project_slug: projectSlug,
            trip: trip,
            trip_slug: tripSlug,
            source: p.source || '',
            source_note: p.source_note || '',
            parent_task: p.parent_task || '',
            links: links,
            created_at: createdAt,
            completed_at: p.completed_at || '',
        };
        return { path: 'spice/tasks/' + filename, frontmatter: frontmatter, body: TaskEntity._chromeBody() };
    }

    /**
     * Normalize a Dataview page (or plain frontmatter object) into a stable
     * task view. Missing status → "open"; blank/empty dates → null. The path is
     * read from `page.file.path` (Dataview) falling back to `page.path`.
     */
    static parseNote(page) {
        const p = page || {};
        const blankToNull = (v) => {
            if (v == null) return null;
            const s = String(v).trim();
            return s === '' ? null : s;
        };
        const path = (p.file && p.file.path) || p.path || null;
        const parentPath = path ? TaskEntity.parentNotePathOf(path) : '';
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            due: TaskEntity._toDateStr(p.due),
            recurrence: p.recurrence || '',
            priority: p.priority || '',
            project: p.project != null ? p.project : null,
            project_slug: p.project_slug != null ? p.project_slug : null,
            // Trip linkage — parallel to project. `trip` is a `[[Name]]` LINK value,
            // so coerce it to a comparable basename via _linkText (empty when absent);
            // `trip_slug` stays a plain trimmed string filter key (empty when absent).
            trip: TaskEntity._linkText(p.trip),
            trip_slug: p.trip_slug ? String(p.trip_slug).trim() : '',
            source: p.source != null ? p.source : null,
            // Dataview surfaces a `[[Meeting]]` frontmatter value as a Link OBJECT,
            // not a string. Coerce to a comparable basename so the meeting task-list
            // filter (source_note === meetingBasename) actually matches. project is
            // left as-is (TaskNoteView strips its brackets); the reliable project
            // filter uses project_slug (a plain string) above.
            source_note: p.source_note != null ? TaskEntity._linkText(p.source_note) : null,
            // Unlike source_note, parent_task normalizes to '' (not null) when
            // absent — it is read as a plain string for subtask truthiness checks
            // (`if (task.parent_task)`), so empty-string is more convenient here.
            // A folder note names its parent from the folder above it (the folder
            // wins); a flat note keeps the frontmatter link.
            parent_task: TaskEntity._parentNameOf(path, p.parent_task),
            parent_path: parentPath,
            // Structured card links (FIX 5) — normalized to a clean string array so
            // TaskNoteView can render them inside the card. Dataview may hand back an
            // array of strings and/or Link objects; _normLinks coerces both.
            links: TaskEntity._normLinks(p.links),
            created_at: p.created_at != null ? p.created_at : null,
            completed_at: (p.status || 'open') === 'open' ? null : blankToNull(p.completed_at),
            rank: TaskEntity._rankOf(p.rank),
            mtime: TaskEntity._msOf(p.file && p.file.mtime),
            path: path,
        };
    }

    /**
     * Partition a list of task-like objects (raw frontmatter or parseNote output)
     * relative to `todayStr` (YYYY-MM-DD). Only status==="open" tasks are
     * considered. Returns { today, overdue }:
     *   today   — due === todayStr
     *   overdue — due truthy AND due < todayStr (string compare of
     *             zero-padded ISO dates is chronologically correct)
     * Future-due and undated open tasks appear in NEITHER bucket.
     */
    static queryToday(tasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(tasks) ? tasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            const due = t.due;
            if (!due) continue;
            if (due === todayStr) today.push(t);
            else if (due < todayStr) overdue.push(t);
            // due > todayStr (future) → excluded from both buckets.
        }
        return { today: today, overdue: overdue };
    }

    /**
     * Group an array of ALREADY-PARSED tasks (parseNote output, or any object
     * with `{ parent_task, status }`) by `parent_task` and count how many are
     * done vs. total. A task with no `parent_task` (empty string or nullish —
     * not a subtask) is skipped entirely. A parent with zero children is
     * simply ABSENT from the returned map (no zero-entries), so callers do a
     * plain `counts[basename] || null` presence check. Missing/malformed
     * `status` is treated as "open" (matches parseNote's own default). Pure,
     * null/non-array-tolerant (→ {}); never throws.
     */
    static _groupSubtaskCounts(parsedTasks) {
        const counts = {};
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t) continue;
            const parent = String(t.parent_task == null ? '' : t.parent_task).trim();
            if (!parent) continue;
            if (!counts[parent]) counts[parent] = { done: 0, total: 0 };
            counts[parent].total += 1;
            if ((t.status || 'open') === 'done') counts[parent].done += 1;
        }
        return counts;
    }

    /**
     * Live-query wrapper around `_groupSubtaskCounts`: fetches every task note
     * under `spice/tasks/` (open AND done — a subtask's total shouldn't shrink
     * once it's completed — excluding only the recoverable `_trash/`), parses
     * each via `parseNote`, and groups by parent. This is the SINGLE shared
     * definition of "how many subtasks does this task have, and how many are
     * done" for every surface that doesn't already hold the full child list
     * locally (daily, project, meeting task rows). Guarded — a missing/broken
     * `dv` or a cold-load query failure yields `{}`, never throws.
     */
    static subtaskCountsByParent(dv) {
        try {
            if (!dv || typeof dv.pages !== 'function') return {};
            // Every task widget on a page asks for the same counts during the
            // same refresh. Reuse them while the Dataview index has not moved
            // (index.revision increments on every reload, rename and delete),
            // so sibling widgets share one scan instead of each running their own.
            const index = dv.index && typeof dv.index.revision === 'number' ? dv.index : null;
            const memo = TaskEntity._subtaskCountsMemo;
            if (index && memo && memo.index === index && memo.revision === index.revision) return memo.counts;
            const revision = index ? index.revision : null;
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.file && p.file.path
                && TaskEntity.taskState(p) !== 'deleted');
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            // Counting needs two fields per task, normalized exactly as parseNote
            // does; a full parseNote of the whole archive was wasted work.
            const light = arr.map(p => ({
                parent_task: TaskEntity._parentNameOf(p.file.path, p.parent_task),
                status: p.status || 'open',
            }));
            const counts = TaskEntity._groupSubtaskCounts(light);
            if (index) TaskEntity._subtaskCountsMemo = { index, revision, counts };
            return counts;
        } catch (_e) {
            return {};
        }
    }

    /**
     * Walk forward day-by-day from the day AFTER `fromDateStr` (never returning
     * `fromDateStr` itself, even if it would match) looking for the first date
     * where `matchesFn(candidateDateStr, anchorDateStr)` returns true. Capped at
     * a 400-day horizon (mirrors `_uniqueName`'s collision-loop cap) so an
     * unsupported or never-firing grammar can't spin forever — returns `null` in
     * that case. `matchesFn` is INJECTED (not a hard dependency on
     * RecurrenceParser) so this pure core stays testable without a customJS
     * global; the browser-side caller (TaskDialog) closes over
     * `window.customJS.RecurrenceParser.matches`. A missing/throwing/non-function
     * `matchesFn` yields `null` — never throws.
     *
     * `fromDateStr` / `anchorDateStr` are plain `YYYY-MM-DD` strings. Date
     * arithmetic is done via `Date.UTC` (never local-zone getters) so this is
     * correct regardless of the host device's timezone (mirrors `_toDateStr`'s
     * UTC-safety rationale).
     */
    static nextOccurrence(recurrence, fromDateStr, anchorDateStr, matchesFn) {
        if (typeof matchesFn !== 'function') return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromDateStr == null ? '' : fromDateStr));
        if (!m) return null;
        const startMs = Date.UTC(+m[1], +m[2] - 1, +m[3]);
        const DAY_MS = 86400000;
        const HORIZON_DAYS = 400;
        for (let i = 1; i <= HORIZON_DAYS; i++) {
            const d = new Date(startMs + i * DAY_MS);
            const p = (n) => String(n).padStart(2, '0');
            const candidate = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
            let fires = false;
            try { fires = !!matchesFn(candidate, anchorDateStr, recurrence); } catch (_e) { fires = false; }
            if (fires) return candidate;
        }
        return null;
    }

    /**
     * Validate a create/edit payload. `title` (non-empty after trim) is
     * required. `due`, when present, must be strict YYYY-MM-DD.
     */
    static validatePayload(payload) {
        if (!payload) return { valid: false, reason: 'empty payload' };
        if (!payload.title || !String(payload.title).trim()) {
            return { valid: false, reason: 'title required' };
        }
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (payload.due && !DATE_RE.test(payload.due)) {
            return { valid: false, reason: 'invalid due date' };
        }
        return { valid: true };
    }
}
