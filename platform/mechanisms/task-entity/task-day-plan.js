class TaskDayPlan {

    // The day rhythm: Plan the day, Shut down, and the pinned Now task.
    // Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md, sections 3 and 4.
    //
    // - Now. A task may carry `pinned_at:` (ISO). The open task with the
    //   newest pinned_at is Now; a done or trashed one drops out on its own.
    //   Pinning sets it on one task and clears it on every other task that
    //   has it; unpinning clears it.
    // - Plan the day. A panel on Home (open) and at the top of today's daily
    //   note (collapsed): Now, Overdue, Due today, today's meetings and the
    //   Waiting comms notes, each row clickable, the counts in the head.
    // - Shut down. A modal from the panel and the `Sauce: Shut down the day`
    //   command (TaskDayPlanInit): Done today (read only) and Still open
    //   (overdue and due today), each with Tomorrow, Next work day, Pick date,
    //   Done or Leave. Finish applies the choices one task at a time through
    //   TaskTodayList.reschedule and TaskDialog.markDone, then writes a
    //   `## Shutdown` section to today's daily note, replacing that day's
    //   section when it is run again.
    //
    // The data comes from the metadata cache (no Dataview query). Waiting
    // comes from TaskDocs.waiting when it is loaded, else the panel leaves it
    // out. Today's meetings come from SpaceDailyDashboard.selectMeetings.
    //
    // Statics above "Browser" are pure: no clock, no vault. Callers pass
    // `today` (YYYY-MM-DD).

    nowTask(tasks) { return TaskDayPlan.nowTask(tasks); }
    planModel(input) { return TaskDayPlan.planModel(input); }
    subtaskProgress(tasks, task) { return TaskDayPlan.subtaskProgress(tasks, task); }
    addDays(day, n) { return TaskDayPlan.addDays(day, n); }
    nextWorkDay(day) { return TaskDayPlan.nextWorkDay(day); }
    targetDate(choice, today) { return TaskDayPlan.targetDate(choice, today); }
    shutdownSection(summary) { return TaskDayPlan.shutdownSection(summary); }
    replaceShutdown(content, section) { return TaskDayPlan.replaceShutdown(content, section); }
    dailyNotePath(today, config, moment) { return TaskDayPlan.dailyNotePath(today, config, moment); }
    tasksFrom(records) { return TaskDayPlan.tasksFrom(records); }
    commsItems(records) { return TaskDayPlan.commsItems(records); }
    meetingItems(pages) { return TaskDayPlan.meetingItems(pages); }
    doneToday(tasks, today) { return TaskDayPlan.doneToday(tasks, today); }
    signature(model) { return TaskDayPlan.signature(model); }
    collect(app) { return TaskDayPlan.collect(app); }
    build(opts) { return TaskDayPlan.build(opts); }
    isPinned(app, path) { return TaskDayPlan.isPinned(app, path); }
    pin(app, path, iso) { return TaskDayPlan.pin(app, path, iso); }
    unpin(app, path) { return TaskDayPlan.unpin(app, path); }
    togglePin(app, path, opts) { return TaskDayPlan.togglePin(app, path, opts); }
    menuEntry(task) { return TaskDayPlan.menuEntry(task); }
    renderPinButton(host, opts) { return TaskDayPlan.renderPinButton(host, opts); }
    renderNow(host, opts) { return TaskDayPlan.renderNow(host, opts); }
    renderPlan(host, opts) { return TaskDayPlan.renderPlan(host, opts); }
    renderDay(host, opts) { return TaskDayPlan.renderDay(host, opts); }
    openShutdown(opts) { return TaskDayPlan.openShutdown(opts); }
    finishShutdown(ctx) { return TaskDayPlan.finishShutdown(ctx); }
    writeShutdown(app, today, section) { return TaskDayPlan.writeShutdown(app, today, section); }
    get CHOICES() { return TaskDayPlan.CHOICES; }

    static get ROOT() { return 'spice/tasks'; }
    static get SKIP() { return ['spice/tasks/_sets/']; }
    static get FIELD() { return 'pinned_at'; }
    static get _MONTHS() { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; }
    static get _WEEKDAYS() { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; }

    /** The Shut down choices for a still-open task, in button order. Leave is the default. */
    static get CHOICES() {
        return [
            { key: 'tomorrow', label: 'Tomorrow' },
            { key: 'next', label: 'Next work day' },
            { key: 'pick', label: 'Pick date' },
            { key: 'done', label: 'Done' },
            { key: 'leave', label: 'Leave' },
        ];
    }

    static get ICON() {
        const svg = (d, n) => '<svg xmlns="http://www.w3.org/2000/svg" width="' + (n || 15) + '" height="' + (n || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        return {
            pin: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
            unpin: svg('<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>'),
            sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
            moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
            chevron: svg('<path d="m9 18 6-6-6-6"/>', 14),
            copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 14),
            open: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 14),
        };
    }

    // ---------- Pure ----------

    static _str(v) { return v == null ? '' : String(v).trim(); }

    static _day(v) {
        if (v == null || v === '') return '';
        let s = '';
        try {
            if (typeof v === 'string') s = v;
            else if (typeof v.toISODate === 'function') s = String(v.toISODate() || '');
            else if (typeof v.toFormat === 'function') s = String(v.toFormat('yyyy-MM-dd') || '');
            else s = String(v);
        } catch (_e) { s = ''; }
        const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(s);
        return m ? m[1] : '';
    }

    /** Epoch ms of an ISO stamp (string or Luxon-like); NaN when there is none. */
    static _ms(v) {
        if (v == null || v === '') return NaN;
        try {
            if (typeof v === 'number') return v;
            if (typeof v === 'object' && typeof v.toMillis === 'function') return Number(v.toMillis());
            const s = String(v).trim();
            return s ? Date.parse(s) : NaN;
        } catch (_e) { return NaN; }
    }

    static _base(path) {
        const p = String(path == null ? '' : path);
        return p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    }

    /** open, done or deleted: status decides, and a note under _trash/ is deleted. */
    static _state(t) {
        const p = String((t && (t.path || (t.file && t.file.path))) || '');
        if (p.indexOf(TaskDayPlan.ROOT + '/_trash/') === 0) return 'deleted';
        const s = TaskDayPlan._str(t && t.status).toLowerCase() || 'open';
        if (s === 'deleted') return 'deleted';
        if (s === 'done') return 'done';
        return 'open';
    }

    /** Days since 1970-01-01 for a YYYY-MM-DD day; null when it is not one. */
    static _dayNumber(day) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
        if (!m) return null;
        return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
    }

    /** The YYYY-MM-DD day for a day number (Hinnant's civil_from_days). */
    static _fromDayNumber(n) {
        let z = n + 719468;
        const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
        const doe = z - era * 146097;
        const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
        const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
        const mp = Math.floor((5 * doy + 2) / 153);
        const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
        const mo = mp + (mp < 10 ? 3 : -9);
        const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
        const p = (x) => String(x).padStart(2, '0');
        return String(y).padStart(4, '0') + '-' + p(mo) + '-' + p(d);
    }

    static addDays(day, n) {
        const dn = TaskDayPlan._dayNumber(day);
        if (dn == null) return '';
        return TaskDayPlan._fromDayNumber(dn + (Number(n) || 0));
    }

    /** 0 = Sunday … 6 = Saturday. */
    static _weekday(day) {
        const dn = TaskDayPlan._dayNumber(day);
        return dn == null ? null : (((dn + 4) % 7) + 7) % 7;
    }

    /** The first Monday-to-Friday day after `day`. */
    static nextWorkDay(day) {
        let d = TaskDayPlan.addDays(day, 1);
        while (d && (TaskDayPlan._weekday(d) === 0 || TaskDayPlan._weekday(d) === 6)) d = TaskDayPlan.addDays(d, 1);
        return d;
    }

    /** "Mon Nov 16" for 2026-11-16; '' otherwise. */
    static dayLabel(day) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
        if (!m) return '';
        return TaskDayPlan._WEEKDAYS[TaskDayPlan._weekday(day)] + ' ' + TaskDayPlan._MONTHS[+m[2] - 1] + ' ' + (+m[3]);
    }

    /**
     * The due date a Shut down choice moves a task to: tomorrow, the next
     * work day, or the picked date. '' for Done, Leave or a pick with no date.
     */
    static targetDate(choice, today) {
        const c = choice && typeof choice === 'object' ? choice : { key: choice };
        if (c.key === 'tomorrow') return TaskDayPlan.addDays(today, 1);
        if (c.key === 'next') return TaskDayPlan.nextWorkDay(today);
        if (c.key === 'pick') return /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || '')) ? String(c.date) : '';
        return '';
    }

    /** The open task with the newest pinned_at, or null. */
    static nowTask(tasks) {
        let best = null;
        let bestMs = -Infinity;
        for (const t of Array.isArray(tasks) ? tasks : []) {
            if (!t || TaskDayPlan._state(t) !== 'open') continue;
            const ms = TaskDayPlan._ms(t.pinned_at);
            if (!Number.isFinite(ms)) continue;
            if (ms > bestMs) { best = t; bestMs = ms; }
        }
        return best;
    }

    /** { done, total } over the subtasks of `task` in `tasks` (trashed ones left out). */
    static subtaskProgress(tasks, task) {
        const out = { done: 0, total: 0 };
        if (!task || !task.path) return out;
        const name = TaskDayPlan._base(task.path).toLowerCase();
        for (const t of Array.isArray(tasks) ? tasks : []) {
            if (!t || t.path === task.path) continue;
            const st = TaskDayPlan._state(t);
            if (st === 'deleted') continue;
            const mine = t.parent_path
                ? t.parent_path === task.path
                : TaskDayPlan._str(t.parent_task).toLowerCase() === name && !!name;
            if (!mine) continue;
            out.total += 1;
            if (st === 'done') out.done += 1;
        }
        return out;
    }

    /** Tasks finished on `today`, newest first. */
    static doneToday(tasks, today) {
        const list = (Array.isArray(tasks) ? tasks : [])
            .filter((t) => t && TaskDayPlan._state(t) === 'done' && TaskDayPlan._day(t.completed_at) === today);
        return list
            .map((t, i) => ({ t, i, ms: TaskDayPlan._ms(t.completed_at) }))
            .sort((a, b) => ((Number.isFinite(b.ms) ? b.ms : 0) - (Number.isFinite(a.ms) ? a.ms : 0)) || (a.i - b.i))
            .map((x) => x.t);
    }

    /**
     * What Plan the day shows: { now, overdue, dueToday, meetings, waiting,
     * counts: { overdue, today, meetings, waiting } }. Overdue is every open
     * task due before today, oldest due first; Due today is every open task
     * due today. `meetings` and `waiting` are passed through as given.
     */
    static planModel(input) {
        const o = input || {};
        const today = String(o.today || '');
        const tasks = Array.isArray(o.tasks) ? o.tasks : [];
        const open = tasks.filter((t) => t && TaskDayPlan._state(t) === 'open');
        const title = (t) => TaskDayPlan._str(t.title) || TaskDayPlan._base(t.path);
        const overdue = open
            .filter((t) => { const d = TaskDayPlan._day(t.due); return !!d && !!today && d < today; })
            .sort((a, b) => TaskDayPlan._day(a.due).localeCompare(TaskDayPlan._day(b.due)) || title(a).localeCompare(title(b)));
        const dueToday = open
            .filter((t) => !!today && TaskDayPlan._day(t.due) === today)
            .sort((a, b) => title(a).localeCompare(title(b)));
        const meetings = Array.isArray(o.meetings) ? o.meetings.slice() : [];
        const waiting = Array.isArray(o.waiting) ? o.waiting.slice() : [];
        return {
            today,
            now: TaskDayPlan.nowTask(tasks),
            overdue,
            dueToday,
            meetings,
            waiting,
            counts: { overdue: overdue.length, today: dueToday.length, meetings: meetings.length, waiting: waiting.length },
        };
    }

    /** A string that changes whenever what the day panel shows changes. */
    static signature(model) {
        if (!model) return '';
        const m = model;
        const paths = (list) => (Array.isArray(list) ? list : []).map((x) => (x && x.path) || '').join(',');
        return JSON.stringify([
            m.today || '',
            m.now ? [m.now.path, String(m.now.pinned_at || ''), TaskDayPlan._day(m.now.due), m.now.title || ''] : null,
            paths(m.overdue), paths(m.dueToday), paths(m.meetings),
            (Array.isArray(m.waiting) ? m.waiting : []).map((w) => (w && w.path) + ':' + (w && w.days)).join(','),
            m.progress ? [m.progress.done, m.progress.total] : null,
        ]);
    }

    static _alias(text) {
        return String(text == null ? '' : text).replace(/[\[\]|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /** `[[Name]]`, or `[[Name|Title]]` when the title differs from the note name. */
    static _link(name, title) {
        const n = String(name == null ? '' : name).trim();
        const t = TaskDayPlan._alias(title);
        return t && t !== n ? '[[' + n + '|' + t + ']]' : '[[' + n + ']]';
    }

    /**
     * The Shutdown section (a level 2 heading): `Done: N` with the titles as links,
     * `Moved: N` as `title → date`, and `Still waiting: N`. `done` and `moved`
     * are [{ path, title, date? }].
     */
    static shutdownSection(summary) {
        const s = summary || {};
        const done = Array.isArray(s.done) ? s.done : [];
        const moved = Array.isArray(s.moved) ? s.moved : [];
        const waiting = Number.isFinite(s.waiting) ? s.waiting : 0;
        const lines = ['## Shutdown', '']; // lint-display-markers:allow spec section 3 names this heading as the section Shut down writes and replaces
        lines.push('Done: ' + done.length);
        for (const d of done) lines.push('- ' + TaskDayPlan._link(TaskDayPlan._base(d.path), d.title));
        lines.push('');
        lines.push('Moved: ' + moved.length);
        for (const m of moved) lines.push('- ' + TaskDayPlan._link(TaskDayPlan._base(m.path), m.title) + ' → ' + (TaskDayPlan.dayLabel(m.date) || m.date || ''));
        lines.push('');
        lines.push('Still waiting: ' + waiting);
        return lines.join('\n') + '\n';
    }

    /**
     * `content` with its Shutdown section replaced by `section`: from the
     * Shutdown heading line up to the next level 2 heading or the end of the file.
     * With no such section, `section` is appended after a blank line. Fenced
     * code is never matched.
     */
    static replaceShutdown(content, section) {
        const text = String(content == null ? '' : content).replace(/\r\n/g, '\n');
        const sec = String(section == null ? '' : section).replace(/\s+$/, '');
        const lines = text.split('\n');
        const isFence = (l) => /^\s*(`{3,}|~{3,})/.test(l);
        const isShutdown = (l) => /^##\s+Shutdown\s*$/.test(l); // lint-display-markers:allow spec section 3 makes this heading the section boundary
        const isH2 = (l) => /^##\s/.test(l); // lint-display-markers:allow spec section 3 ends the section at the next level 2 heading
        let start = -1;
        let fenced = false;
        for (let i = 0; i < lines.length; i++) {
            if (isFence(lines[i])) { fenced = !fenced; continue; }
            if (!fenced && isShutdown(lines[i])) { start = i; break; }
        }
        if (start < 0) {
            const body = text.replace(/\s+$/, '');
            return (body ? body + '\n\n' : '') + sec + '\n';
        }
        let end = lines.length;
        fenced = false;
        for (let j = start + 1; j < lines.length; j++) {
            if (isFence(lines[j])) { fenced = !fenced; continue; }
            if (!fenced && isH2(lines[j])) { end = j; break; }
        }
        const before = lines.slice(0, start);
        const after = lines.slice(end);
        if (!after.length) return before.concat(sec.split('\n')).join('\n') + '\n';
        return before.concat(sec.split('\n'), [''], after).join('\n');
    }

    /** Today's daily note path from the core Daily notes settings ({ folder, format }). */
    static dailyNotePath(today, config, moment) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) || typeof moment !== 'function') return '';
        const c = config || {};
        const format = typeof c.format === 'string' && c.format.trim() ? c.format.trim() : 'YYYY-MM-DD';
        const folder = typeof c.folder === 'string' ? c.folder.trim().replace(/^\/+|\/+$/g, '') : '';
        let name = '';
        try { name = String(moment(today, 'YYYY-MM-DD').format(format) || ''); } catch (_e) { name = ''; }
        if (!name) return '';
        return (folder ? folder + '/' : '') + name + '.md';
    }

    /** Parsed tasks (TaskEntity.parseNote plus pinned_at) from metadata-cache records; trashed ones left out. */
    static tasksFrom(records) {
        const TE = TaskDayPlan._te();
        const out = [];
        for (const r of Array.isArray(records) ? records : []) {
            const fm = r && r.fm;
            if (!fm || TaskDayPlan._str(fm.type) !== 'task') continue;
            const page = Object.assign({}, fm, { file: { path: r.path, name: r.basename, mtime: r.mtime } });
            let t = null;
            try {
                t = TE && typeof TE.parseNote === 'function' ? TE.parseNote(page) : null;
            } catch (_e) { t = null; }
            if (!t) {
                t = {
                    title: TaskDayPlan._str(fm.title), status: TaskDayPlan._str(fm.status) || 'open',
                    due: TaskDayPlan._day(fm.due) || null, priority: fm.priority || '', source: fm.source || null,
                    source_note: fm.source_note || null, parent_task: TaskDayPlan._str(fm.parent_task).replace(/^\[\[|\]\]$/g, ''),
                    parent_path: '', completed_at: fm.completed_at || null, path: r.path,
                };
            }
            t.pinned_at = fm.pinned_at == null ? '' : fm.pinned_at;
            if (TaskDayPlan._state(t) === 'deleted') continue;
            out.push(t);
        }
        return out;
    }

    /** The comms notes among metadata-cache records, as TaskDocs.waiting reads them. */
    static commsItems(records) {
        const str = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(', ') : TaskDayPlan._str(v));
        const iso = (v) => {
            if (v == null || v === '') return '';
            try { if (typeof v === 'object' && typeof v.toISO === 'function') return String(v.toISO() || ''); } catch (_e) {}
            return String(v).trim();
        };
        const out = [];
        for (const r of Array.isArray(records) ? records : []) {
            const fm = r && r.fm;
            if (!fm || TaskDayPlan._str(fm.type) !== 'task-doc') continue;
            if (TaskDayPlan._str(fm.kind).toLowerCase() !== 'comms') continue;
            out.push({
                path: r.path,
                kind: 'comms',
                title: str(fm.title) || r.basename || TaskDayPlan._base(r.path),
                to: str(fm.to),
                via: str(fm.via),
                sent_at: iso(fm.sent_at),
                replied_at: iso(fm.replied_at),
            });
        }
        return out;
    }

    /** Today's meeting notes (Dataview pages) as { path, title, time }. */
    static meetingItems(pages) {
        const MBL = TaskDayPlan._static('MeetingsBrowseList');
        const out = [];
        for (const p of Array.isArray(pages) ? pages : []) {
            const path = p && p.file && p.file.path;
            if (!path) continue;
            let title = '';
            let time = '';
            try {
                if (MBL && typeof MBL.meetingTitle === 'function') title = MBL.meetingTitle(p);
                if (MBL && typeof MBL.meetingClock === 'function' && typeof MBL.timeLabel === 'function') time = MBL.timeLabel(MBL.meetingClock(p));
            } catch (_e) {}
            if (!title) {
                const name = String(p.file.name || TaskDayPlan._base(path));
                title = name.replace(/[-\s]\d{4}-\d{2}-\d{2}$/, '').replace(/^\d{4}-\d{2}-\d{2}[-\s]+/, '').trim() || name;
            }
            out.push({ path, title, time });
        }
        return out;
    }

    // ---------- Browser ----------

    static _cjs() {
        try { return (typeof window !== 'undefined' && window.customJS) || null; } catch (_e) { return null; }
    }

    static _te() { const c = TaskDayPlan._cjs(); return (c && c.TaskEntity) || null; }

    /** A class's statics from its stored CustomJS instance. */
    static _static(name) {
        const c = TaskDayPlan._cjs();
        const inst = c && c[name];
        if (!inst) return null;
        return inst.constructor && inst.constructor !== Object ? inst.constructor : inst;
    }

    static _app(opts) {
        try { return (opts && opts.app) || (typeof window !== 'undefined' ? window.app : null) || null; } catch (_e) { return null; }
    }

    static _today() {
        try {
            const m = typeof window !== 'undefined' ? window.moment : null;
            return typeof m === 'function' ? String(m().format('YYYY-MM-DD') || '') : '';
        } catch (_e) { return ''; }
    }

    static _stamp() {
        try {
            const m = typeof window !== 'undefined' ? window.moment : null;
            if (typeof m === 'function') return String(m().format('YYYY-MM-DDTHH:mm:ssZ'));
        } catch (_e) {}
        return '';
    }

    static _notice(msg, ms) { try { new Notice(msg, ms); } catch (_e) {} }

    /** Metadata-cache records for every markdown file under spice/tasks except _sets/: { path, basename, mtime, fm }. */
    static collect(app) {
        const out = [];
        try {
            const files = app && app.vault && typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
            const root = TaskDayPlan.ROOT + '/';
            for (const f of files || []) {
                const p = String((f && f.path) || '');
                if (p.indexOf(root) !== 0 || TaskDayPlan.SKIP.some((s) => p.indexOf(s) === 0)) continue;
                let fm = null;
                try { fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || null; } catch (_e) { fm = null; }
                if (!fm) continue;
                out.push({ path: p, basename: f.basename || TaskDayPlan._base(p), mtime: (f.stat && f.stat.mtime) || 0, fm });
            }
        } catch (_e) {}
        return out;
    }

    /** The waiting comms notes (TaskDocs.waiting), or null when TaskDocs has no waiting yet. */
    static _waiting(records, tasks, today) {
        const c = TaskDayPlan._cjs();
        const TD = c && c.TaskDocs;
        if (!TD || typeof TD.waiting !== 'function') return null;
        try { return TD.waiting(TaskDayPlan.commsItems(records), tasks, today) || []; } catch (_e) { return []; }
    }

    static _waitingText(days) {
        const c = TaskDayPlan._cjs();
        const TD = c && c.TaskDocs;
        try { if (TD && typeof TD.waitingText === 'function') return TD.waitingText(days); } catch (_e) {}
        return Number.isFinite(days) && days > 0 ? 'Waiting ' + days + 'd' : 'Waiting';
    }

    /**
     * Everything the day panel needs, from the metadata cache: the plan
     * model plus `tasks`, `progress` (the Now task's subtasks) and whether
     * Waiting is available. opts: { app, today, meetingPages, dv }.
     */
    static build(opts) {
        const o = opts || {};
        const app = TaskDayPlan._app(o);
        const today = String(o.today || TaskDayPlan._today());
        const records = TaskDayPlan.collect(app);
        const tasks = TaskDayPlan.tasksFrom(records);
        let pages = Array.isArray(o.meetingPages) ? o.meetingPages : null;
        if (!pages && o.dv) {
            try {
                const SDD = TaskDayPlan._cjs() && TaskDayPlan._cjs().SpaceDailyDashboard;
                if (SDD && typeof SDD.selectMeetings === 'function') pages = SDD.selectMeetings(o.dv, today) || [];
            } catch (_e) { pages = []; }
        }
        const waiting = TaskDayPlan._waiting(records, tasks, today);
        const model = TaskDayPlan.planModel({ tasks, today, meetings: TaskDayPlan.meetingItems(pages || []), waiting: waiting || [] });
        model.hasWaiting = waiting !== null;
        model.tasks = tasks;
        model.records = records;
        model.progress = model.now ? TaskDayPlan.subtaskProgress(tasks, model.now) : null;
        return model;
    }

    static isPinned(app, path) {
        try {
            const f = app && app.vault && app.vault.getAbstractFileByPath(path);
            const fm = f ? ((app.metadataCache.getFileCache(f) || {}).frontmatter || null) : null;
            return !!(fm && TaskDayPlan._str(fm[TaskDayPlan.FIELD]));
        } catch (_e) { return false; }
    }

    /** Set pinned_at on `path`, then clear it on every other task that has it. */
    static async pin(app, path, iso) {
        const file = app && app.vault && app.vault.getAbstractFileByPath(path);
        if (!file) throw new Error('task not found');
        const stamp = String(iso || TaskDayPlan._stamp());
        if (!stamp) throw new Error('no clock');
        await app.fileManager.processFrontMatter(file, (fm) => { fm[TaskDayPlan.FIELD] = stamp; });
        for (const r of TaskDayPlan.collect(app)) {
            if (r.path === path || TaskDayPlan._str(r.fm && r.fm.type) !== 'task') continue;
            if (!TaskDayPlan._str(r.fm[TaskDayPlan.FIELD])) continue;
            const other = app.vault.getAbstractFileByPath(r.path);
            if (!other) continue;
            await app.fileManager.processFrontMatter(other, (fm) => { delete fm[TaskDayPlan.FIELD]; });
        }
        return { ok: true, pinned: true };
    }

    static async unpin(app, path) {
        const file = app && app.vault && app.vault.getAbstractFileByPath(path);
        if (!file) throw new Error('task not found');
        await app.fileManager.processFrontMatter(file, (fm) => { delete fm[TaskDayPlan.FIELD]; });
        return { ok: true, pinned: false };
    }

    /**
     * Pin the task at `path` as Now, or unpin it when it is pinned, through
     * RenderSafe.mutate. opts: { pinned (else read from the cache),
     * optimistic, revert }. Resolves RenderSafe's { ok, value | error }.
     */
    static async togglePin(app, path, opts) {
        const o = opts || {};
        const appRef = app || TaskDayPlan._app(o);
        const c = TaskDayPlan._cjs();
        const RenderSafe = c && c.RenderSafe;
        if (!appRef || !path || !RenderSafe || typeof RenderSafe.mutate !== 'function') {
            TaskDayPlan._notice('Tasks are still loading. Try again in a moment.', 4000);
            return { ok: false, error: new Error('not ready') };
        }
        const pinned = typeof o.pinned === 'boolean' ? o.pinned : TaskDayPlan.isPinned(appRef, path);
        const iso = TaskDayPlan._stamp();
        return RenderSafe.mutate({
            app: appRef,
            path,
            failureMessage: pinned ? 'Could not unpin the task' : 'Could not pin the task',
            optimistic: () => { if (typeof o.optimistic === 'function') o.optimistic(!pinned); },
            write: () => (pinned ? TaskDayPlan.unpin(appRef, path) : TaskDayPlan.pin(appRef, path, iso)),
            revert: () => { if (typeof o.revert === 'function') o.revert(pinned); },
        });
    }

    /** The To-Do row ⋯ menu entry: Pin as Now, or Unpin when the task is Now's pin. Null for a task that is not open. */
    static menuEntry(task) {
        try {
            const path = task && task.path;
            if (!path || TaskDayPlan._state(task) !== 'open') return null;
            const app = TaskDayPlan._app();
            if (!app) return null;
            const pinned = TaskDayPlan.isPinned(app, path);
            return {
                label: pinned ? 'Unpin' : 'Pin as Now',
                icon: pinned ? TaskDayPlan.ICON.unpin : TaskDayPlan.ICON.pin,
                onSelect: () => { TaskDayPlan.togglePin(app, path, { pinned }); },
            };
        } catch (_e) {
            return null;
        }
    }

    /** The pin button on a task card header. opts: { app, path, status }. Null for a task that is not open. */
    static renderPinButton(host, opts) {
        try {
            const o = opts || {};
            const app = TaskDayPlan._app(o);
            const path = String(o.path || '');
            if (!host || typeof host.createEl !== 'function' || !app || !path) return null;
            if (TaskDayPlan._state({ path, status: o.status }) !== 'open') return null;
            TaskDayPlan._injectCss();
            const btn = host.createEl('button', { cls: 'sauce-dp-pin' });
            try { btn.setAttribute('type', 'button'); } catch (_e) {}
            let pinned = TaskDayPlan.isPinned(app, path);
            const paint = (on) => {
                pinned = !!on;
                btn.innerHTML = TaskDayPlan.ICON.pin;
                try {
                    if (btn.classList && typeof btn.classList.toggle === 'function') btn.classList.toggle('is-pinned', pinned);
                    else btn.className = 'sauce-dp-pin' + (pinned ? ' is-pinned' : '');
                } catch (_e) {}
                try {
                    btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
                    btn.setAttribute('aria-label', pinned ? 'Unpin' : 'Pin as Now');
                    btn.setAttribute('title', pinned ? 'Unpin' : 'Pin as Now');
                } catch (_e) {}
            };
            paint(pinned);
            btn.addEventListener('click', (ev) => {
                try { ev.stopPropagation(); ev.preventDefault(); } catch (_e) {}
                const was = pinned;
                return TaskDayPlan.togglePin(app, path, { pinned: was, optimistic: (on) => paint(on), revert: () => paint(was) });
            });
            return btn;
        } catch (_e) {
            return null;
        }
    }

    static _open(app, path, ev) {
        try {
            if (!app || !path) return;
            const newTab = !!(ev && (ev.metaKey || ev.ctrlKey));
            app.workspace.openLinkText(path, '', newTab);
        } catch (_e) {}
    }

    static async _copy(text) {
        const c = TaskDayPlan._cjs();
        try {
            const TTL = c && c.TaskTodayList;
            if (TTL && typeof TTL.copyText === 'function') return !!(await TTL.copyText(text));
        } catch (_e) {}
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(String(text)); return true; }
        } catch (_e) {}
        return false;
    }

    /** The newest prompt note and the newest unsent comms note of the task at `taskPath`. */
    static _notesFor(app, taskPath) {
        const out = { prompt: null, message: null };
        try {
            const c = TaskDayPlan._cjs();
            const TD = c && c.TaskDocs;
            if (!TD || typeof TD.list !== 'function') return out;
            const notes = (TD.list(app, taskPath) || []).slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
            for (const n of notes) {
                if (!out.prompt && n.kind === 'prompt') out.prompt = n;
                if (!out.message && n.kind === 'comms') {
                    let fm = null;
                    try { fm = (app.metadataCache.getFileCache(n.file) || {}).frontmatter || null; } catch (_e) { fm = null; }
                    if (!TaskDayPlan._str(fm && fm.sent_at)) out.message = n;
                }
            }
        } catch (_e) {}
        return out;
    }

    static _dueChip(due, today) {
        try {
            const S = TaskDayPlan._static('TaskDocs');
            if (S && typeof S.dueChip === 'function') return S.dueChip(TaskDayPlan._day(due), today, 'open');
        } catch (_e) {}
        const d = TaskDayPlan._day(due);
        if (!d) return null;
        if (d === today) return { text: 'Due today', tone: 'accent' };
        if (today && d < today) return { text: 'Overdue · ' + TaskDayPlan.dayLabel(d), tone: 'danger' };
        return { text: 'Due ' + TaskDayPlan.dayLabel(d), tone: '' };
    }

    /** The Now card. opts: { app, model, today }. Nothing when no task is pinned. */
    static renderNow(host, opts) {
        try {
            const o = opts || {};
            const app = TaskDayPlan._app(o);
            const model = o.model || {};
            const now = model.now;
            if (!host || typeof host.createEl !== 'function' || !now) return null;
            const today = String(o.today || model.today || '');
            const card = host.createEl('div', { cls: 'sauce-dp-now' });
            const top = card.createEl('div', { cls: 'sauce-dp-now-top' });
            const label = top.createEl('span', { cls: 'sauce-dp-now-label' });
            label.innerHTML = TaskDayPlan.ICON.pin;
            label.createEl('span', { text: 'Now' });
            const title = card.createEl('a', { cls: 'sauce-dp-now-title', text: TaskDayPlan._str(now.title) || TaskDayPlan._base(now.path), href: '#' });
            title.addEventListener('click', (ev) => { try { ev.preventDefault(); } catch (_e) {} TaskDayPlan._open(app, now.path, ev); });
            const chips = card.createEl('div', { cls: 'sauce-dp-chips' });
            const due = TaskDayPlan._dueChip(now.due, today);
            if (due) chips.createEl('span', { cls: 'sauce-dp-chip' + (due.tone ? ' is-' + due.tone : ''), text: due.text });
            const prog = model.progress || TaskDayPlan.subtaskProgress(model.tasks, now);
            if (prog && prog.total) {
                chips.createEl('span', { cls: 'sauce-dp-chip is-progress' + (prog.done === prog.total ? ' is-complete' : ''), text: prog.done + '/' + prog.total + ' subtasks' });
            }
            const actions = card.createEl('div', { cls: 'sauce-dp-actions' });
            const button = (cls, text, icon) => {
                const b = actions.createEl('button', { cls: 'sauce-dp-btn ' + cls });
                try { b.setAttribute('type', 'button'); } catch (_e) {}
                if (icon) b.innerHTML = icon;
                b.createEl('span', { text });
                return b;
            };
            const notes = app ? TaskDayPlan._notesFor(app, now.path) : { prompt: null, message: null };
            const copyFrom = (note, what) => async () => {
                let text = '';
                try {
                    const TD = TaskDayPlan._cjs() && TaskDayPlan._cjs().TaskDocs;
                    text = TD.extractPrompt(await app.vault.cachedRead(note.file));
                } catch (_e) { text = ''; }
                if (!text) { TaskDayPlan._notice('This note has nothing to copy yet', 4000); return; }
                const ok = await TaskDayPlan._copy(text);
                TaskDayPlan._notice(ok ? what + ' copied' : 'Could not copy the ' + what.toLowerCase(), ok ? 2500 : 5000);
            };
            if (notes.prompt) button('sauce-dp-copy-prompt', 'Copy prompt', TaskDayPlan.ICON.copy).addEventListener('click', copyFrom(notes.prompt, 'Prompt'));
            if (notes.message) button('sauce-dp-copy-message', 'Copy message', TaskDayPlan.ICON.copy).addEventListener('click', copyFrom(notes.message, 'Message'));
            button('sauce-dp-open', 'Open', TaskDayPlan.ICON.open).addEventListener('click', (ev) => TaskDayPlan._open(app, now.path, ev));
            const unpin = button('sauce-dp-unpin', 'Unpin', TaskDayPlan.ICON.unpin);
            unpin.addEventListener('click', () => TaskDayPlan.togglePin(app, now.path, {
                pinned: true,
                optimistic: () => { try { card.classList.add('is-leaving'); } catch (_e) {} },
                revert: () => { try { card.classList.remove('is-leaving'); } catch (_e) {} },
            }));
            return card;
        } catch (_e) {
            return null;
        }
    }

    static _plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

    /**
     * The Plan the day panel: a <details> whose head holds the title, the
     * counts and Shut down. opts: { app, model, today, surface, open }.
     * The panel stays as the person left it for the rest of the session.
     */
    static renderPlan(host, opts) {
        try {
            const o = opts || {};
            const app = TaskDayPlan._app(o);
            const model = o.model || TaskDayPlan.planModel({});
            if (!host || typeof host.createEl !== 'function') return null;
            const surface = String(o.surface || 'daily');
            const state = TaskDayPlan._openState || (TaskDayPlan._openState = {});
            const isOpen = typeof state[surface] === 'boolean' ? state[surface] : !!o.open;
            const panel = host.createEl('details', { cls: 'sauce-dp-plan' });
            try { panel.setAttribute('data-surface', surface); } catch (_e) {}
            if (isOpen) { panel.open = true; try { panel.setAttribute('open', ''); } catch (_e) {} }
            panel.addEventListener('toggle', () => { state[surface] = !!panel.open; });
            const head = panel.createEl('summary', { cls: 'sauce-dp-plan-head' });
            const chev = head.createEl('span', { cls: 'sauce-dp-plan-chevron' });
            chev.innerHTML = TaskDayPlan.ICON.chevron;
            const icon = head.createEl('span', { cls: 'sauce-dp-plan-icon' });
            icon.innerHTML = TaskDayPlan.ICON.sun;
            head.createEl('span', { cls: 'sauce-dp-plan-title', text: 'Plan the day' });
            const counts = head.createEl('span', { cls: 'sauce-dp-counts' });
            const k = model.counts || {};
            const pill = (n, cls, text) => { if (n > 0) counts.createEl('span', { cls: 'sauce-dp-count ' + cls, text }); };
            pill(k.overdue || 0, 'is-overdue', (k.overdue || 0) + ' overdue');
            pill(k.today || 0, 'is-today', (k.today || 0) + ' today');
            pill(k.meetings || 0, 'is-meetings', TaskDayPlan._plural(k.meetings || 0, 'meeting', 'meetings'));
            pill(k.waiting || 0, 'is-waiting', (k.waiting || 0) + ' waiting');
            const sd = head.createEl('button', { cls: 'sauce-dp-btn sauce-dp-shutdown' });
            try { sd.setAttribute('type', 'button'); } catch (_e) {}
            sd.innerHTML = TaskDayPlan.ICON.moon;
            sd.createEl('span', { text: 'Shut down' });
            sd.addEventListener('click', (ev) => {
                try { ev.preventDefault(); ev.stopPropagation(); } catch (_e) {}
                TaskDayPlan.openShutdown({ app, today: model.today || o.today });
            });

            const body = panel.createEl('div', { cls: 'sauce-dp-plan-body' });
            const today = String(model.today || o.today || '');
            const group = (key, label, items, fill) => {
                if (!items.length) return;
                const g = body.createEl('div', { cls: 'sauce-dp-group' });
                try { g.setAttribute('data-group', key); } catch (_e) {}
                const l = g.createEl('div', { cls: 'sauce-dp-group-label' });
                l.createEl('span', { text: label });
                l.createEl('span', { cls: 'sauce-dp-group-count', text: String(items.length) });
                for (const item of items) {
                    const row = g.createEl('div', { cls: 'sauce-dp-row' });
                    try { row.setAttribute('role', 'button'); row.setAttribute('tabindex', '0'); row.setAttribute('data-path', item.path || ''); } catch (_e) {}
                    fill(row, item);
                    row.addEventListener('click', (ev) => TaskDayPlan._open(app, item.path, ev));
                    row.addEventListener('keydown', (ev) => { if (ev && (ev.key === 'Enter' || ev.key === ' ')) { try { ev.preventDefault(); } catch (_e) {} TaskDayPlan._open(app, item.path, ev); } });
                }
            };
            const taskRow = (row, t, meta, tone) => {
                row.createEl('span', { cls: 'sauce-dp-row-title', text: TaskDayPlan._str(t.title) || TaskDayPlan._base(t.path) });
                if (meta) row.createEl('span', { cls: 'sauce-dp-row-meta' + (tone ? ' is-' + tone : ''), text: meta });
            };
            const late = (t) => {
                const a = TaskDayPlan._dayNumber(TaskDayPlan._day(t.due));
                const b = TaskDayPlan._dayNumber(today);
                return a == null || b == null ? '' : (b - a) + 'd late';
            };
            if (model.now) group('now', 'Now', [model.now], (row, t) => { const chip = TaskDayPlan._dueChip(t.due, today); taskRow(row, t, chip ? chip.text : '', chip ? chip.tone : ''); });
            group('overdue', 'Overdue', model.overdue || [], (row, t) => taskRow(row, t, late(t), 'danger'));
            group('today', 'Due today', model.dueToday || [], (row, t) => taskRow(row, t, TaskDayPlan._str(t.priority) && !/^(none|normal)$/i.test(TaskDayPlan._str(t.priority)) ? TaskDayPlan._str(t.priority) : '', ''));
            group('meetings', 'Meetings', model.meetings || [], (row, m) => {
                if (m.time) row.createEl('span', { cls: 'sauce-dp-row-time', text: m.time });
                row.createEl('span', { cls: 'sauce-dp-row-title', text: m.title || TaskDayPlan._base(m.path) });
            });
            group('waiting', 'Waiting', model.waiting || [], (row, w) => {
                row.createEl('span', { cls: 'sauce-dp-row-title', text: w.title || TaskDayPlan._base(w.path) });
                const who = [w.to ? 'to ' + w.to : '', w.via || ''].filter(Boolean).join(' · ');
                const meta = [TaskDayPlan._waitingText(w.days), who, w.taskTitle || ''].filter(Boolean).join(' · ');
                row.createEl('span', { cls: 'sauce-dp-row-meta is-waiting', text: meta });
            });
            const empty = !model.now && !(model.overdue || []).length && !(model.dueToday || []).length
                && !(model.meetings || []).length && !(model.waiting || []).length;
            if (empty) body.createEl('div', { cls: 'sauce-dp-empty', text: 'Nothing due, nothing waiting. A clear day.' });
            return panel;
        } catch (_e) {
            return null;
        }
    }

    /**
     * The Now card (when a task is pinned) and the Plan the day panel into
     * `host`. opts: { app, today, model (else built), dv, meetingPages,
     * surface: 'home' | 'daily', open }. Returns the model, or null.
     */
    static renderDay(host, opts) {
        try {
            const o = opts || {};
            if (!host || typeof host.createEl !== 'function') return null;
            TaskDayPlan._injectCss();
            const model = o.model || TaskDayPlan.build(o);
            const today = String(o.today || model.today || '');
            TaskDayPlan.renderNow(host, { app: o.app, model, today });
            TaskDayPlan.renderPlan(host, { app: o.app, model, today, surface: o.surface, open: o.open });
            return model;
        } catch (_e) {
            return null;
        }
    }

    // ---------- Shut down ----------

    /** Open the Shut down modal. opts: { app, today }. Returns the modal handle, or null. */
    static openShutdown(opts) {
        try {
            const o = opts || {};
            const app = TaskDayPlan._app(o);
            const today = String(o.today || TaskDayPlan._today());
            const c = TaskDayPlan._cjs();
            const SM = c && c.SauceModal;
            const doc = (typeof document !== 'undefined' && document) ? document : null;
            if (!app || !today || !SM || typeof SM.open !== 'function' || !doc || !doc.body) {
                TaskDayPlan._notice('Shut down is not available yet. Try again in a moment.', 5000);
                return null;
            }
            TaskDayPlan._injectCss();
            const tasks = TaskDayPlan.tasksFrom(TaskDayPlan.collect(app));
            const model = TaskDayPlan.planModel({ tasks, today });
            const still = model.overdue.concat(model.dueToday);
            const done = TaskDayPlan.doneToday(tasks, today);
            const choices = new Map();
            const rows = new Map();
            const handle = SM.open({
                doc,
                title: 'Shut down the day',
                body: (body) => {
                    try { body.classList.add('sauce-dp-sd'); } catch (_e) {}
                    const section = (label, n) => {
                        const s = body.createEl('div', { cls: 'sauce-dp-sd-section' });
                        const l = s.createEl('div', { cls: 'sauce-dp-sd-label' });
                        l.createEl('span', { text: label });
                        l.createEl('span', { cls: 'sauce-dp-group-count', text: String(n) });
                        return s;
                    };
                    const doneSec = section('Done today', done.length);
                    if (!done.length) doneSec.createEl('div', { cls: 'sauce-dp-empty', text: 'Nothing finished yet today.' });
                    for (const t of done) doneSec.createEl('div', { cls: 'sauce-dp-sd-done', text: TaskDayPlan._str(t.title) || TaskDayPlan._base(t.path) });

                    const openSec = section('Still open', still.length);
                    if (!still.length) openSec.createEl('div', { cls: 'sauce-dp-empty', text: 'Nothing overdue or due today.' });
                    for (const t of still) {
                        const row = openSec.createEl('div', { cls: 'sauce-dp-sd-row' });
                        try { row.setAttribute('data-path', t.path); } catch (_e) {}
                        rows.set(t.path, row);
                        const info = row.createEl('div', { cls: 'sauce-dp-sd-info' });
                        info.createEl('span', { cls: 'sauce-dp-row-title', text: TaskDayPlan._str(t.title) || TaskDayPlan._base(t.path) });
                        const d = TaskDayPlan._day(t.due);
                        info.createEl('span', { cls: 'sauce-dp-row-meta' + (d < today ? ' is-danger' : ''), text: d < today ? 'Overdue · ' + TaskDayPlan.dayLabel(d) : 'Due today' });
                        const seg = row.createEl('div', { cls: 'sauce-dp-sd-choices' });
                        const date = row.createEl('input', { cls: 'sauce-dp-sd-date', type: 'date' });
                        try { date.type = 'date'; date.style.display = 'none'; date.setAttribute('aria-label', 'Pick a date'); } catch (_e) {}
                        choices.set(t.path, { key: 'leave', date: '' });
                        const buttons = {};
                        const paint = () => {
                            const cur = choices.get(t.path);
                            for (const key of Object.keys(buttons)) {
                                const b = buttons[key];
                                const on = cur.key === key;
                                try {
                                    if (b.classList && typeof b.classList.toggle === 'function') b.classList.toggle('is-active', on);
                                    b.setAttribute('aria-pressed', on ? 'true' : 'false');
                                } catch (_e) {}
                            }
                            try { date.style.display = cur.key === 'pick' ? '' : 'none'; } catch (_e) {}
                        };
                        for (const ch of TaskDayPlan.CHOICES) {
                            const b = seg.createEl('button', { cls: 'sauce-dp-sd-choice', text: ch.label });
                            try { b.setAttribute('type', 'button'); b.setAttribute('data-choice', ch.key); } catch (_e) {}
                            buttons[ch.key] = b;
                            b.addEventListener('click', () => {
                                choices.set(t.path, { key: ch.key, date: ch.key === 'pick' ? String(date.value || '') : '' });
                                paint();
                                if (ch.key === 'pick') {
                                    try { if (typeof date.showPicker === 'function') date.showPicker(); else date.focus(); } catch (_e) { try { date.focus(); } catch (_e2) {} }
                                }
                            });
                        }
                        date.addEventListener('change', () => {
                            choices.set(t.path, { key: 'pick', date: String(date.value || '') });
                            paint();
                        });
                        paint();
                    }
                },
                buttons: [
                    { label: 'Cancel', action: 'cancel' },
                    {
                        label: 'Finish',
                        tone: 'accent',
                        close: false,
                        className: 'sauce-dp-finish',
                        onClick: (api) => {
                            const picked = new Map(choices);
                            try { api.close('finish'); } catch (_e) {}
                            TaskDayPlan.finishShutdown({ app, today, tasks: still, done, choices: picked, rows })
                                .catch((e) => TaskDayPlan._notice('Shut down stopped: ' + ((e && e.message) || e), 6000));
                        },
                    },
                ],
            });
            return handle || null;
        } catch (e) {
            TaskDayPlan._notice('Could not open Shut down: ' + ((e && e.message) || e), 6000);
            return null;
        }
    }

    /**
     * Apply the Shut down choices one task at a time, through
     * TaskTodayList.reschedule (Tomorrow, Next work day, Pick date) and
     * TaskDialog.markDone (Done), then write the Shutdown section to today's
     * daily note. ctx: { app, today, tasks, done, choices: Map(path →
     * { key, date }), rows }. Resolves { done, moved, failed, waiting, written }.
     */
    static async finishShutdown(ctx) {
        const o = ctx || {};
        const app = TaskDayPlan._app(o);
        const today = String(o.today || '');
        const c = TaskDayPlan._cjs() || {};
        const TTL = c.TaskTodayList;
        const TD = c.TaskDialog;
        const choices = o.choices instanceof Map ? o.choices : new Map();
        const rows = o.rows instanceof Map ? o.rows : new Map();
        const doneNow = [];
        const moved = [];
        let failed = 0;
        for (const t of Array.isArray(o.tasks) ? o.tasks : []) {
            const choice = choices.get(t.path) || { key: 'leave' };
            if (choice.key === 'leave') continue;
            if (choice.key === 'done') {
                let res = null;
                try { res = TD && typeof TD.markDone === 'function' ? await TD.markDone(t.path) : { ok: false, reason: 'not ready' }; }
                catch (e) { res = { ok: false, reason: (e && e.message) || 'failed' }; }
                if (res && res.ok) doneNow.push({ path: (res && res.path) || t.path, title: t.title });
                else if (!res || res.reason !== 'cancelled') failed += 1;
                continue;
            }
            const date = TaskDayPlan.targetDate(choice, today);
            if (!date) continue;
            let res = null;
            try {
                const row = rows.get(t.path) || { dataset: {}, parentNode: null, remove() {} };
                res = TTL && typeof TTL.reschedule === 'function'
                    ? await TTL.reschedule(row, Object.assign({}, t, { status: 'open' }), date, today, TD)
                    : { ok: false };
            } catch (_e) { res = { ok: false }; }
            if (res && res.ok) moved.push({ path: t.path, title: t.title, date });
            else failed += 1;
        }
        const seen = new Set();
        const done = [];
        for (const d of (Array.isArray(o.done) ? o.done : []).concat(doneNow)) {
            const key = TaskDayPlan._base(d.path).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            done.push({ path: d.path, title: d.title });
        }
        let waiting = 0;
        try {
            const records = TaskDayPlan.collect(app);
            const w = TaskDayPlan._waiting(records, TaskDayPlan.tasksFrom(records), today);
            waiting = Array.isArray(w) ? w.length : 0;
        } catch (_e) { waiting = 0; }
        const section = TaskDayPlan.shutdownSection({ done, moved, waiting });
        const res = await TaskDayPlan.writeShutdown(app, today, section);
        const parts = [doneNow.length + ' done', moved.length + ' moved'];
        if (failed) parts.push(failed + ' not changed');
        TaskDayPlan._notice('Day shut down: ' + parts.join(', '), 4000);
        return { done, moved, failed, waiting, written: !!(res && res.ok) };
    }

    static async _dailyConfig(app) {
        try {
            const dir = (app.vault && app.vault.configDir) || '.obsidian';
            return JSON.parse(await app.vault.adapter.read(dir + '/daily-notes.json'));
        } catch (_e) { return null; }
    }

    /**
     * Write `section` into today's daily note with app.vault.process inside
     * RenderSafe.mutate, replacing that day's Shutdown section. Resolves
     * RenderSafe's result, or { ok: false, reason } when there is no note.
     */
    static async writeShutdown(app, today, section) {
        const c = TaskDayPlan._cjs() || {};
        const RenderSafe = c.RenderSafe;
        const cfg = app ? await TaskDayPlan._dailyConfig(app) : null;
        const path = TaskDayPlan.dailyNotePath(today, cfg, typeof window !== 'undefined' ? window.moment : null);
        const file = path && app && app.vault ? app.vault.getAbstractFileByPath(path) : null;
        if (!file) {
            TaskDayPlan._notice("No daily note for today, so the summary wasn't saved.", 6000);
            return { ok: false, reason: 'no daily note' };
        }
        if (!RenderSafe || typeof RenderSafe.mutate !== 'function' || typeof app.vault.process !== 'function') {
            TaskDayPlan._notice("Couldn't save the summary yet. Try again in a moment.", 6000);
            return { ok: false, reason: 'not ready' };
        }
        return RenderSafe.mutate({
            app,
            path,
            failureMessage: "Couldn't save the summary to today's daily note",
            write: () => app.vault.process(file, (data) => TaskDayPlan.replaceShutdown(data, section)),
        });
    }

    // ---------- Styles ----------

    static get _CSS() {
        return [
            '.sauce-day-plan { display: flex; flex-direction: column; gap: 10px; margin: 0 0 12px; }',
            '.space-daily-dashboard > .sauce-dp-now, .space-daily-dashboard > .sauce-dp-plan { margin-bottom: 12px; }',
            '.sauce-dp-now { --dp-accent: var(--interactive-accent); display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--dp-accent) 40%, var(--background-modifier-border)); border-radius: var(--radius-l, 12px); background: linear-gradient(135deg, color-mix(in srgb, var(--dp-accent) 12%, var(--background-secondary)) 0%, var(--background-secondary) 65%); }',
            '.sauce-dp-now.is-leaving { opacity: 0.5; }',
            '.sauce-dp-now-top { display: flex; align-items: center; gap: 8px; }',
            '.sauce-dp-now-label { display: inline-flex; align-items: center; gap: 5px; color: var(--dp-accent); font-size: 0.72em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }',
            '.sauce-dp-now-title { color: var(--text-normal); font-size: 1.15em; font-weight: 700; line-height: 1.3; text-decoration: none; overflow-wrap: anywhere; cursor: pointer; }',
            '.sauce-dp-chips { display: flex; flex-wrap: wrap; gap: 6px; }',
            '.sauce-dp-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 1px 9px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: var(--background-primary); color: var(--text-muted); font-size: 0.76em; font-weight: 600; white-space: nowrap; }',
            '.sauce-dp-chip.is-accent { color: var(--interactive-accent); border-color: color-mix(in srgb, var(--interactive-accent) 55%, transparent); }',
            '.sauce-dp-chip.is-danger { color: var(--color-red, #dc2626); border-color: color-mix(in srgb, var(--color-red, #dc2626) 55%, transparent); }',
            '.sauce-dp-chip.is-progress.is-complete { color: var(--color-green, #4c9a5a); }',
            '.sauce-dp-actions { display: flex; flex-wrap: wrap; gap: 6px; }',
            'body .sauce-dp-btn.sauce-dp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: auto; min-height: 30px; padding: 0 11px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px); background: var(--background-primary); box-shadow: none; color: var(--text-normal); font-size: 0.82em; cursor: pointer; }',
            '@media (hover: hover) { body .sauce-dp-btn.sauce-dp-btn:hover { border-color: var(--background-modifier-border-hover, var(--background-modifier-border)); background: var(--background-modifier-hover); } }',
            'body .sauce-dp-btn.sauce-dp-copy-prompt, body .sauce-dp-btn.sauce-dp-copy-message { border-color: var(--dp-accent, var(--interactive-accent)); color: var(--dp-accent, var(--interactive-accent)); }',
            '.sauce-dp-btn > svg { flex-shrink: 0; }',
            '.sauce-dp-plan { border: 1px solid var(--background-modifier-border); border-left: 3px solid var(--color-yellow, #ca8a04); border-radius: var(--radius-m, 8px); background: color-mix(in srgb, var(--color-yellow, #ca8a04) 6%, var(--background-secondary)); }',
            '.sauce-dp-plan-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 40px; padding: 6px 10px; list-style: none; cursor: pointer; }',
            '.sauce-dp-plan-head::-webkit-details-marker { display: none; }',
            '.sauce-dp-plan-head::marker { content: ""; }',
            '.sauce-dp-plan-chevron { display: inline-flex; color: var(--text-faint); transition: transform 120ms ease; }',
            '.sauce-dp-plan[open] > .sauce-dp-plan-head .sauce-dp-plan-chevron { transform: rotate(90deg); }',
            '.sauce-dp-plan-icon { display: inline-flex; color: var(--color-yellow, #ca8a04); }',
            '.sauce-dp-plan-title { font-weight: 700; color: var(--text-normal); }',
            '.sauce-dp-counts { display: inline-flex; flex-wrap: wrap; gap: 5px; flex: 1 1 auto; min-width: 0; }',
            '.sauce-dp-count { padding: 0 8px; border-radius: 999px; font-size: 0.74em; font-weight: 600; line-height: 1.7; white-space: nowrap; background: var(--background-modifier-hover); color: var(--text-muted); }',
            '.sauce-dp-count.is-overdue { color: var(--color-red, #dc2626); background: color-mix(in srgb, var(--color-red, #dc2626) 12%, transparent); }',
            '.sauce-dp-count.is-today { color: var(--color-orange, #ea580c); background: color-mix(in srgb, var(--color-orange, #ea580c) 12%, transparent); }',
            '.sauce-dp-count.is-meetings { color: var(--color-blue, #2563eb); background: color-mix(in srgb, var(--color-blue, #2563eb) 12%, transparent); }',
            '.sauce-dp-count.is-waiting { color: var(--color-pink, #db2777); background: color-mix(in srgb, var(--color-pink, #db2777) 12%, transparent); }',
            'body .sauce-dp-btn.sauce-dp-shutdown { margin-left: auto; }',
            '.sauce-dp-plan-body { display: flex; flex-direction: column; gap: 10px; padding: 2px 12px 12px; }',
            '.sauce-dp-group { display: flex; flex-direction: column; gap: 1px; }',
            '.sauce-dp-group-label, .sauce-dp-sd-label { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; color: var(--text-muted); font-size: 0.72em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }',
            '.sauce-dp-group-count { color: var(--text-faint); font-variant-numeric: tabular-nums; }',
            '.sauce-dp-row { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 4px 8px; border-radius: var(--radius-s, 6px); cursor: pointer; min-width: 0; }',
            '@media (hover: hover) { .sauce-dp-row:hover { background: var(--background-modifier-hover); } }',
            '.sauce-dp-row-title { flex: 1 1 auto; min-width: 0; color: var(--text-normal); font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-dp-row-time { flex-shrink: 0; min-width: 62px; color: var(--text-muted); font-size: 0.8em; font-variant-numeric: tabular-nums; }',
            '.sauce-dp-row-meta { flex-shrink: 0; max-width: 55%; color: var(--text-faint); font-size: 0.78em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-dp-row-meta.is-danger { color: var(--color-red, #dc2626); }',
            '.sauce-dp-row-meta.is-waiting { color: var(--color-pink, #db2777); }',
            '.sauce-dp-empty { color: var(--text-faint); font-size: 0.85em; padding: 2px 8px; }',
            '.sauce-dp-sd { display: flex; flex-direction: column; gap: 14px; max-height: 65vh; overflow-y: auto; }',
            '.sauce-dp-sd-section { display: flex; flex-direction: column; gap: 4px; }',
            '.sauce-dp-sd-done { padding: 3px 8px; color: var(--text-muted); font-size: 0.9em; text-decoration: line-through; text-decoration-color: var(--text-faint); }',
            '.sauce-dp-sd-row { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px); }',
            '.sauce-dp-sd-info { display: flex; align-items: center; gap: 8px; min-width: 0; }',
            '.sauce-dp-sd-choices { display: flex; flex-wrap: wrap; gap: 4px; }',
            'body .sauce-dp-sd-choice.sauce-dp-sd-choice { height: auto; min-height: 30px; padding: 0 10px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: transparent; box-shadow: none; color: var(--text-muted); font-size: 0.8em; cursor: pointer; }',
            'body .sauce-dp-sd-choice.sauce-dp-sd-choice.is-active { border-color: var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent, #fff); }',
            '.sauce-dp-sd-date { align-self: flex-start; min-height: 30px; }',
            'body .sauce-dp-pin.sauce-dp-pin { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; min-height: 0; padding: 0; border: 1px solid transparent; border-radius: var(--radius-s, 6px); background: transparent; box-shadow: none; color: var(--text-faint); cursor: pointer; }',
            '@media (hover: hover) { body .sauce-dp-pin.sauce-dp-pin:hover { color: var(--text-normal); background: var(--background-modifier-hover); } }',
            'body .sauce-dp-pin.sauce-dp-pin.is-pinned { color: var(--interactive-accent); border-color: color-mix(in srgb, var(--interactive-accent) 45%, transparent); background: color-mix(in srgb, var(--interactive-accent) 12%, transparent); }',
            'body.is-mobile .sauce-dp-btn.sauce-dp-btn, body.is-mobile .sauce-dp-sd-choice.sauce-dp-sd-choice, body.is-mobile .sauce-dp-row, body.is-mobile .sauce-dp-sd-date { min-height: 36px; }',
            'body.is-mobile .sauce-dp-pin.sauce-dp-pin { width: 36px; height: 36px; }',
            'body.is-mobile .sauce-dp-actions > .sauce-dp-btn { flex: 1 1 auto; }',
            '@media (max-width: 480px) { .sauce-dp-row-meta { max-width: 45%; } body .sauce-dp-btn.sauce-dp-shutdown { margin-left: 0; } }',
        ].join('\n');
    }

    static _injectCss() {
        try {
            if (typeof document === 'undefined' || !document || !document.head || typeof document.getElementById !== 'function') return;
            let s = document.getElementById('sauce-task-day-plan-css');
            if (!s) {
                s = document.createElement('style');
                s.id = 'sauce-task-day-plan-css';
                document.head.appendChild(s);
            }
            if (s.textContent !== TaskDayPlan._CSS) s.textContent = TaskDayPlan._CSS;
        } catch (_e) {}
    }
}
