/**
 * TaskMeetingList (CustomJS) — the live-query task list a MEETING note renders
 * of its own tasks. Sibling of TaskTodayList (the daily) + TaskProjectList (the
 * project). Where the daily partitions into Today / Overdue bands, a meeting
 * shows a FLAT list of ALL its open tasks (no date bands) — a meeting is a
 * source, not a schedule.
 *
 * A task note carries `source_note: [[<Meeting>]]` when it was created from a
 * meeting surface. This widget resolves the CURRENT meeting's basename, then
 * live-queries the task notes under spice/tasks/ (open only, excluding _done/ +
 * _trash/), keeps those whose coerced source_note basename matches, and renders
 * each via the shared TaskTodayList.renderTaskRow so every surface draws a
 * uniform row (checkbox → markDone, click → edit dialog).
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the
 * meeting note is indexed. We resolve the page via the render-safe mechanism
 * (window.customJS?.RenderSafe?.page(dv), optional-chained so a TDZ'd customJS
 * never throws) and bail quietly if the classes we need (TaskEntity /
 * TaskDialog / TaskTodayList) aren't registered yet. NEVER throws out of render.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "\nreturn TaskMeetingList;")()`.
 *
 * MEETING ACTION ITEMS. A line in the meeting note starting with `->` or `→`
 * is an action item: `-> thing` is mine, `-> Name: thing` is someone else's
 * (Name a [[link]], an attendee or a spice/people/ note), and a trailing ` (due Fri)`, ` (due tomorrow)` or ` (due 2026-11-20)` sets
 * its due date. The Make tasks button above the list opens a review modal
 * (one row per unconverted line: checkbox, title, due date). Make tasks
 * creates each ticked row through TaskDialog's create path with
 * `source: meeting` and `source_note: [[<Meeting>]]`; a row titled
 * `Hear back from <Name>: <thing>` also gets a comms note (TaskDocs.create)
 * with `to: <Name>` and the thing as its first line. Each converted line is
 * rewritten to end with ` ✓ [[<task name>]]`, so it is never offered again.
 * Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md § 5.
 *
 * Static API (Node-testable, pure):
 *   TaskMeetingList._matches(task, meetingBasename) → bool
 *   TaskMeetingList.parseActionLine(line, people) → null | { prefix, owner, thing, dueSpec }
 *   TaskMeetingList.parseDue(spec, baseDate, today) → 'YYYY-MM-DD' | null
 *   TaskMeetingList.actionItems(text, { base, today, attendees, people }) → [{ index, raw, title, due, owner, to }]
 *   TaskMeetingList.ownerOfTitle(title) → null | { owner, thing }
 *   TaskMeetingList.markConverted(text, made) → { text, marked, missed }
 *
 * Instance API (browser-side):
 *   TaskMeetingList.render(dv)   ← the customjs-guard entry point; draws the shared
 *                          To-Do view's 'meeting' surface when it is loaded,
 *                          else _renderFlat(dv), the original flat list;
 *                          either way with the Make tasks button above it
 *   TaskMeetingList.openMakeTasks(app, meetingPath) → the review modal
 *   TaskMeetingList.makeTasks(app, meetingPath, rows) → RenderSafe.mutate result
 */
class TaskMeetingList {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _matches(task, meetingBasename) { return TaskMeetingList._matches(task, meetingBasename); }
    parseActionLine(line, people) { return TaskMeetingList.parseActionLine(line, people); }
    parseDue(spec, baseDate, today) { return TaskMeetingList.parseDue(spec, baseDate, today); }
    baseDate(meetingDate, today) { return TaskMeetingList.baseDate(meetingDate, today); }
    actionItems(text, opts) { return TaskMeetingList.actionItems(text, opts); }
    ownerOfTitle(title) { return TaskMeetingList.ownerOfTitle(title); }
    markConverted(text, made) { return TaskMeetingList.markConverted(text, made); }
    openMakeTasks(app, meetingPath) { return TaskMeetingList.openMakeTasks(app, meetingPath); }
    makeTasks(app, meetingPath, rows) { return TaskMeetingList.makeTasks(app, meetingPath, rows); }

    // ---------- Meeting action items (pure) ----------

    /** `-> …` or `→ …`, after optional indentation and an optional list bullet. */
    static get ACTION_RE() { return /^(\s*(?:[-*+]\s+)?)(?:->|→)\s*(\S.*?)\s*$/; }

    /** A line Make tasks already converted: it ends with ` ✓ [[<task name>]]`. */
    static get CONVERTED_RE() { return /\s✓\s*\[\[[^\]\n]+\]\]\s*$/; }

    static get DUE_RE() { return /\s*\(\s*due\s+([^()]+?)\s*\)\s*$/i; }

    static get WEEKDAYS() {
        return {
            sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
            wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
            fri: 5, friday: 5, sat: 6, saturday: 6,
        };
    }

    /**
     * `text` as lines plus each line's own ending ('\n', '\r\n' or '' for
     * the last), so a rewrite keeps mixed endings exactly as they were.
     */
    static _splitLines(text) {
        const parts = String(text == null ? '' : text).split(/(\r?\n)/);
        const lines = [];
        const ends = [];
        for (let i = 0; i < parts.length; i += 2) {
            lines.push(parts[i]);
            ends.push(i + 1 < parts.length ? parts[i + 1] : '');
        }
        return { lines, ends };
    }

    static _joinLines(lines, ends) {
        let out = '';
        for (let i = 0; i < lines.length; i++) out += lines[i] + (ends[i] || '');
        return out;
    }

    /** Lowercased full names and first names of `names`, for owner matching. */
    static _knownNames(names) {
        const set = new Set();
        for (const n of names || []) {
            const s = String(n == null ? '' : n).replace(/^\[\[|\]\]$/g, '').split('|')[0];
            const base = s.slice(s.lastIndexOf('/') + 1).replace(/\.md$/i, '').trim().toLowerCase();
            if (!base) continue;
            set.add(base);
            set.add(base.split(/\s+/)[0]);
        }
        return set;
    }

    /**
     * One meeting-note line as an action item, or null when it is not one (or
     * was already converted). `owner` is '' for mine, else the name before
     * the colon. It is someone else's only when that text is a [[link]], or
     * matches (case-insensitive, full name or first name) one of `people`
     * (the meeting's attendees and the notes under spice/people/); anything
     * else before a colon stays part of my item. `dueSpec` is the text
     * inside a trailing `(due …)`, or '' when there is none. Pure.
     */
    static parseActionLine(line, people) {
        const s = String(line == null ? '' : line);
        if (TaskMeetingList.CONVERTED_RE.test(s)) return null;
        const m = TaskMeetingList.ACTION_RE.exec(s);
        if (!m) return null;
        let rest = m[2];
        let dueSpec = '';
        const d = TaskMeetingList.DUE_RE.exec(rest);
        if (d) { dueSpec = d[1]; rest = rest.slice(0, d.index).trim(); }
        let owner = '';
        const o = /^([^:\n]{1,80}?)\s*:\s+(\S.*)$/.exec(rest);
        if (o) {
            const head = o[1].trim();
            const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(head);
            if (link) owner = String(link[2] || link[1]).trim();
            else if (TaskMeetingList._knownNames(people).has(head.toLowerCase())) owner = head;
            if (owner) rest = o[2].trim();
        }
        if (!rest) return null;
        return { prefix: m[1], owner, thing: rest, dueSpec };
    }

    static _ymd(y, mo, d) {
        const p = (x) => String(x).padStart(2, '0');
        return y + '-' + p(mo) + '-' + p(d);
    }

    static _plusDays(dateStr, n) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr == null ? '' : dateStr));
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(n) || 0)));
        return TaskMeetingList._ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }

    /**
     * The due date a `(due …)` spec names, counted from `baseDate`
     * (YYYY-MM-DD): a weekday is the next such day strictly after it,
     * `tomorrow` the day after it, `today` the day itself. None of these
     * lands before `today` (when given): a weekday rolls forward a week at a
     * time, `tomorrow` becomes today + 1 and `today` today. A YYYY-MM-DD is
     * taken as written when it is a real date. null when the spec is none
     * of these. Pure: no clock; the caller supplies the dates.
     */
    static parseDue(spec, baseDate, today) {
        const s = String(spec == null ? '' : spec).trim().toLowerCase().replace(/\.$/, '');
        if (!s) return null;
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (iso) {
            const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
            return d.getUTCFullYear() === +iso[1] && d.getUTCMonth() + 1 === +iso[2] && d.getUTCDate() === +iso[3] ? s : null;
        }
        const base = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(baseDate == null ? '' : baseDate));
        if (!base) return null;
        const now = /^\d{4}-\d{2}-\d{2}$/.test(String(today == null ? '' : today)) ? String(today) : '';
        if (s === 'today') return now && base[0] < now ? now : base[0];
        if (s === 'tomorrow') {
            const t = TaskMeetingList._plusDays(base[0], 1);
            return now && t < now ? TaskMeetingList._plusDays(now, 1) : t;
        }
        const day = TaskMeetingList.WEEKDAYS[s];
        if (day == null) return null;
        const cur = new Date(Date.UTC(+base[1], +base[2] - 1, +base[3])).getUTCDay();
        let out = TaskMeetingList._plusDays(base[0], ((day - cur + 7) % 7) || 7);
        while (now && out < now) out = TaskMeetingList._plusDays(out, 7);
        return out;
    }

    /** The meeting's own date (YYYY-MM-DD of its `date:`), else `today`. */
    static baseDate(meetingDate, today) {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(meetingDate == null ? '' : meetingDate).trim());
        return m ? m[1] : String(today == null ? '' : today);
    }

    /** `[[Jason Batai]]`-style attendee entries as plain names. */
    static _attendeeNames(attendees) {
        const list = Array.isArray(attendees) ? attendees : (attendees == null ? [] : [attendees]);
        const out = [];
        for (const a of list) {
            let s = a && typeof a === 'object' && a.path != null ? String(a.path) : String(a == null ? '' : a);
            s = s.replace(/^\[\[|\]\]$/g, '').split('|')[0];
            s = s.slice(s.lastIndexOf('/') + 1).replace(/\.md$/i, '').trim();
            if (s) out.push(s);
        }
        return out;
    }

    /**
     * Who a comms note goes to: the attendee (else the person note) whose
     * full name, or (when only one matches) first name, is `owner`; else
     * `owner` as written.
     */
    static _resolveTo(owner, attendees, people) {
        const o = String(owner == null ? '' : owner).trim();
        if (!o) return '';
        const lower = o.toLowerCase();
        for (const names of [TaskMeetingList._attendeeNames(attendees), TaskMeetingList._attendeeNames(people)]) {
            const full = names.find((n) => n.toLowerCase() === lower);
            if (full) return full;
            const first = names.filter((n) => n.split(/\s+/)[0].toLowerCase() === lower);
            if (first.length === 1) return first[0];
            if (first.length > 1) return o;
        }
        return o;
    }

    /** The task title for an action: the thing, or `Hear back from <Name>: <thing>`. */
    static titleFor(owner, thing) {
        const t = String(thing == null ? '' : thing).replace(/\s+/g, ' ').trim();
        const o = String(owner == null ? '' : owner).trim();
        return o ? 'Hear back from ' + o + ': ' + t : t;
    }

    /** `{ owner, thing }` when `title` reads `Hear back from <Name>: <thing>`, else null. */
    static ownerOfTitle(title) {
        const m = /^\s*hear back from\s+([^:]+?)\s*:\s*(\S.*?)\s*$/i.exec(String(title == null ? '' : title));
        return m ? { owner: m[1], thing: m[2] } : null;
    }

    /** An indented code line: 4+ spaces or a tab, and not a list item. */
    static _indentedCode(line) {
        const s = String(line == null ? '' : line);
        return /^(?: {4,}|\t)/.test(s) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(s);
    }

    /**
     * Every unconverted action line of a meeting note's `text`, in note
     * order, outside the frontmatter, code fences and indented code:
     * [{ index, raw, owner, to, thing, title, due }]. `opts` is
     * { base, today, attendees, people }. `due` is '' when the line names
     * none; a `(due …)` that does not parse stays in the title.
     */
    static actionItems(text, opts) {
        const o = opts || {};
        const known = TaskMeetingList._attendeeNames(o.attendees).concat(TaskMeetingList._attendeeNames(o.people));
        const lines = TaskMeetingList._splitLines(text).lines;
        const out = [];
        let i = 0;
        if (lines[0] === '---') {
            const end = lines.indexOf('---', 1);
            if (end > 0) i = end + 1;
        }
        let fence = '';
        for (; i < lines.length; i++) {
            const line = lines[i];
            const f = /^\s*(`{3,}|~{3,})/.exec(line);
            if (f) {
                if (!fence) fence = f[1];
                else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = '';
                continue;
            }
            if (fence || TaskMeetingList._indentedCode(line)) continue;
            const p = TaskMeetingList.parseActionLine(line, known);
            if (!p) continue;
            const due = p.dueSpec ? TaskMeetingList.parseDue(p.dueSpec, o.base, o.today) : '';
            const thing = due === null ? p.thing + ' (due ' + p.dueSpec + ')' : p.thing;
            out.push({
                index: i,
                raw: line,
                owner: p.owner,
                to: TaskMeetingList._resolveTo(p.owner, o.attendees, o.people),
                thing,
                title: TaskMeetingList.titleFor(p.owner, thing),
                due: due || '',
            });
        }
        return out;
    }

    /**
     * `text` with each converted line ({ index, raw, name }) ending in
     * ` ✓ [[<name>]]`. A line is matched by its exact original text: at its
     * old index when it is still there, else its first unused unconverted
     * copy. A line that changed is left alone and reported in `missed`.
     * Every line keeps its own ending.
     */
    static markConverted(text, made) {
        const { lines, ends } = TaskMeetingList._splitLines(text);
        const used = new Set();
        const marked = [];
        const missed = [];
        for (const item of made || []) {
            const raw = String(item && item.raw != null ? item.raw : '');
            let at = -1;
            if (item && lines[item.index] === raw && !used.has(item.index)) at = item.index;
            else at = lines.findIndex((l, j) => l === raw && !used.has(j));
            if (at < 0 || !raw) { missed.push(item); continue; }
            used.add(at);
            lines[at] = raw.replace(/\s+$/, '') + ' ✓ [[' + item.name + ']]';
            marked.push(at);
        }
        return { text: TaskMeetingList._joinLines(lines, ends), marked, missed };
    }

    // ---------- Static pure helper ----------

    /**
     * Does a PARSED task (parseNote output — source_note already coerced to a
     * basename string by TaskEntity._linkText) belong to the meeting whose
     * basename is `meetingBasename`? Open-only is enforced by the caller's query;
     * this is a pure source_note-basename equality. A blank meeting basename or a
     * task with no source_note → false. Never throws.
     */
    static _matches(task, meetingBasename) {
        if (!task) return false;
        const want = String(meetingBasename == null ? '' : meetingBasename).trim();
        if (!want) return false;
        const got = String(task.source_note == null ? '' : task.source_note).trim();
        return got !== '' && got === want;
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Resolves the current
     * meeting's basename, live-queries the open task notes, keeps the ones whose
     * source_note matches, and draws a flat list. Fully guarded — returns quietly
     * on cold-load (no throw); each row is drawn by the shared static renderer.
     */
    /**
     * The shared To-Do view (to-do blueprint) when it is loaded and knows the
     * 'meeting' surface, else null. customJS stores instances, so the
     * surface table is read off the constructor.
     */
    static _sharedView() {
        try {
            const View = typeof window !== 'undefined' && window.customJS && window.customJS.ToDoDailyFilterView;
            const ctor = View && View.constructor;
            const surfaces = ctor && ctor.SURFACES;
            return View && typeof View.render === 'function' && surfaces && surfaces.meeting ? View : null;
        } catch (_e) { return null; }
    }

    /**
     * Entry point invoked by customjs-guard. With the shared To-Do view loaded
     * this note's tasks draw on its 'meeting' surface (pills, Select,
     * recently done), with TaskMeetingList._matches as the membership rule. A vault
     * without the to-do blueprint keeps the flat list in _renderFlat.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;
        const View = TaskMeetingList._sharedView();
        if (!View) {
            const flat = await this._renderFlat(dv);
            TaskMeetingList._mountActions(dv);
            return flat;
        }
        const page = (window.customJS && window.customJS.RenderSafe)
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;
        const rawName = (page.file && page.file.name) || '';
        const meetingBasename = String(rawName).replace(/\.md$/i, '').trim();
        if (!meetingBasename) return;
        const drawn = await View.render(dv, {
            surface: 'meeting',
            scope: { id: meetingBasename, match: (task) => TaskMeetingList._matches(task, meetingBasename) },
        });
        TaskMeetingList._mountActions(dv, page);
        return drawn;
    }

    // ---------- Meeting action items (browser) ----------

    static _app() {
        try {
            if (typeof window !== 'undefined' && window.app) return window.app;
            if (typeof app !== 'undefined') return app;
        } catch (_e) {}
        return null;
    }

    static _notice(msg, ms) {
        try {
            const N = (typeof window !== 'undefined' && window.Notice) || (typeof Notice !== 'undefined' ? Notice : null);
            if (typeof N === 'function') new N(msg, ms);
        } catch (_e) {}
    }

    static _today() {
        try {
            if (typeof window !== 'undefined' && typeof window.moment === 'function') return window.moment().format('YYYY-MM-DD');
        } catch (_e) {}
        return '';
    }

    /**
     * The Make tasks button, first in the task section. Drawn after the list
     * (the shared view clears the container), then moved to the top. Never
     * throws; a cold page or a missing app draws nothing.
     */
    static _mountActions(dv, page) {
        try {
            const host = dv && dv.container;
            if (!host || typeof host.createEl !== 'function') return;
            const appRef = TaskMeetingList._app();
            const pg = page || ((typeof window !== 'undefined' && window.customJS && window.customJS.RenderSafe)
                ? window.customJS.RenderSafe.page(dv)
                : (typeof dv.current === 'function' ? dv.current() : null));
            const meetingPath = pg && pg.file && pg.file.path ? String(pg.file.path) : '';
            if (!appRef || !meetingPath) return;
            for (const c of (host.children ? Array.from(host.children) : [])) {
                if (c && String(c.className || '').split(/\s+/).includes('sauce-mtg-actions')) host.removeChild(c);
            }
            TaskMeetingList._injectCss();
            const bar = host.createEl('div', { cls: 'sauce-mtg-actions' });
            const button = bar.createEl('button', { cls: 'sauce-btn sauce-mtg-make', text: 'Make tasks' });
            button.setAttribute('type', 'button');
            button.setAttribute('title', 'Turn -> lines in this note into tasks');
            button.addEventListener('click', (ev) => {
                try { ev.preventDefault(); ev.stopPropagation(); } catch (_e) {}
                TaskMeetingList.openMakeTasks(appRef, meetingPath);
            });
            if (host.firstChild !== bar && typeof host.insertBefore === 'function') {
                host.removeChild(bar);
                host.insertBefore(bar, host.firstChild);
            }
        } catch (_e) { /* the list still stands without the button */ }
    }

    static _fm(appRef, file) {
        try { return (appRef.metadataCache.getFileCache(file) || {}).frontmatter || {}; } catch (_e) { return {}; }
    }

    /**
     * The review modal: one row per unconverted action line, each with a
     * checkbox, an editable title and an editable due date. Make tasks
     * hands the rows to makeTasks. Resolves the makeTasks result, or null
     * when closed without making anything.
     */
    static async openMakeTasks(appRef, meetingPath) {
        if (TaskMeetingList._busy().has(String(meetingPath))) {
            TaskMeetingList._notice(TaskMeetingList.BUSY_TEXT);
            return null;
        }
        const file = appRef && appRef.vault ? appRef.vault.getAbstractFileByPath(meetingPath) : null;
        if (!file) { TaskMeetingList._notice('Meeting note not found'); return null; }
        let text = '';
        try {
            text = typeof appRef.vault.read === 'function' ? await appRef.vault.read(file) : await appRef.vault.cachedRead(file);
        } catch (_e) { TaskMeetingList._notice('Could not read the meeting note'); return null; }
        const fm = TaskMeetingList._fm(appRef, file);
        const today = TaskMeetingList._today();
        const items = TaskMeetingList.actionItems(text, {
            base: TaskMeetingList.baseDate(fm.date, today),
            today,
            attendees: fm.attendees,
            people: TaskMeetingList._peopleNames(appRef),
        });
        const SM = typeof window !== 'undefined' && window.customJS && window.customJS.SauceModal;
        const doc = typeof document !== 'undefined' ? document : null;
        if (!SM || typeof SM.open !== 'function') { TaskMeetingList._notice('Install the modal mechanism to make tasks'); return null; }
        TaskMeetingList._injectCss();
        const rows = items.map((it) => ({ index: it.index, raw: it.raw, owner: it.owner, to: it.to, title: it.title, due: it.due, on: true }));
        return new Promise((resolve) => {
            let settled = false;
            const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
            const opts = {
                title: 'Make tasks',
                body: (body) => {
                    if (!rows.length) {
                        body.createEl('div', { cls: 'sauce-mtg-review-copy', text: 'No action lines to convert. Start a line with -> for yours, or -> Name: for someone else\'s. Add (due Fri) to set a date.' });
                        return;
                    }
                    body.createEl('div', { cls: 'sauce-mtg-review-copy', text: 'Each ticked line becomes a task from this meeting. Someone else\'s also gets a comms note.' });
                    const list = body.createEl('div', { cls: 'sauce-mtg-review' });
                    rows.forEach((row) => {
                        const el = list.createEl('div', { cls: 'sauce-mtg-review-row' });
                        const tick = el.createEl('label', { cls: 'sauce-mtg-review-tick' });
                        const box = tick.createEl('input', { type: 'checkbox' });
                        box.checked = true;
                        box.setAttribute('aria-label', 'Make this task');
                        const fields = el.createEl('div', { cls: 'sauce-mtg-review-fields' });
                        const title = fields.createEl('input', { cls: 'sauce-mtg-review-title', type: 'text' });
                        title.value = row.title;
                        title.setAttribute('aria-label', 'Task title');
                        const due = fields.createEl('input', { cls: 'sauce-mtg-review-due', type: 'date' });
                        due.value = row.due;
                        due.setAttribute('aria-label', 'Due date');
                        const hint = fields.createEl('div', { cls: 'sauce-mtg-review-hint' });
                        const paintHint = () => {
                            const other = TaskMeetingList.ownerOfTitle(row.title);
                            hint.textContent = other ? 'Plus a comms note to ' + TaskMeetingList._toFor(row, other.owner) : String(row.raw).trim();
                        };
                        paintHint();
                        box.addEventListener('change', () => {
                            row.on = !!box.checked;
                            el.classList.toggle('is-off', !row.on);
                        });
                        title.addEventListener('input', () => { row.title = String(title.value || ''); paintHint(); });
                        due.addEventListener('change', () => { row.due = String(due.value || ''); });
                        due.addEventListener('input', () => { row.due = String(due.value || ''); });
                    });
                },
                buttons: rows.length ? [
                    { label: 'Cancel', action: 'cancel' },
                    {
                        label: 'Make tasks',
                        tone: 'accent',
                        close: false,
                        onClick: async (handle, event) => {
                            const button = event && (event.currentTarget || event.target);
                            try { if (button) button.disabled = true; } catch (_e) {}
                            const res = await TaskMeetingList.makeTasks(appRef, meetingPath, rows);
                            finish(res);
                            handle.close('made');
                        },
                    },
                ] : [{ label: 'Close', action: 'cancel' }],
                onClose: () => finish(null),
            };
            if (doc) opts.doc = doc;
            const handle = SM.open(opts);
            if (!handle) finish(null);
        });
    }

    static get BUSY_TEXT() { return 'Already making tasks for this meeting'; }

    /** Meeting paths with a Make tasks batch running (one batch per meeting). */
    static _busy() {
        if (!TaskMeetingList._inFlight) TaskMeetingList._inFlight = new Set();
        return TaskMeetingList._inFlight;
    }

    /** Basenames of the person notes under spice/people/ (not the People index). */
    static _peopleNames(appRef) {
        try {
            return appRef.vault.getMarkdownFiles()
                .filter((f) => String(f.path || '').indexOf('spice/people/') === 0 && f.basename !== 'People')
                .map((f) => String(f.basename));
        } catch (_e) { return []; }
    }

    /**
     * The `{ name, slug }` for the meeting's project: the project note's
     * `project_slug`, else its `slug`, else the slugified name (as
     * MeetingLeafActions resolves it).
     */
    static _project(appRef, name, TD) {
        const slugify = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        try {
            for (const f of appRef.vault.getMarkdownFiles()) {
                if (String(f.path || '').indexOf('spice/projects/') !== 0) continue;
                const fm = TaskMeetingList._fm(appRef, f);
                if (!fm || fm.type !== 'project' || String(fm.name || f.basename) !== name) continue;
                const slug = fm.project_slug || fm.slug;
                if (slug) return { name, slug: String(slug) };
                break;
            }
        } catch (_e) {}
        return { name, slug: TD && typeof TD._slugify === 'function' ? TD._slugify(name) : slugify(name) };
    }

    /** `to:` for a row: the resolved attendee while the name is unchanged, else the name as typed. */
    static _toFor(row, owner) {
        const o = String(owner == null ? '' : owner).trim();
        return row && row.owner && o.toLowerCase() === String(row.owner).toLowerCase() && row.to ? row.to : o;
    }

    /**
     * Make the ticked `rows` ({ index, raw, title, due, on, owner, to }) into
     * tasks, then mark their lines converted. One gesture write through
     * RenderSafe.mutate. Resolves the mutate result; its value is
     * { made: [{ index, raw, name, path, comms }], skipped, failed,
     * commsMissed }. Refuses while a batch for the same meeting is running.
     */
    static async makeTasks(appRef, meetingPath, rows) {
        const busy = TaskMeetingList._busy();
        const key = String(meetingPath);
        if (busy.has(key)) {
            TaskMeetingList._notice(TaskMeetingList.BUSY_TEXT);
            return { ok: false, error: new Error('busy') };
        }
        const RenderSafe = typeof window !== 'undefined' && window.customJS && window.customJS.RenderSafe;
        if (!RenderSafe || typeof RenderSafe.mutate !== 'function') {
            TaskMeetingList._notice('Could not make tasks: render-safe is not loaded');
            return { ok: false, error: new Error('render-safe not loaded') };
        }
        busy.add(key);
        try {
            const res = await RenderSafe.mutate({
                app: appRef,
                path: meetingPath,
                failureMessage: 'Could not make tasks',
                write: () => TaskMeetingList._convert(appRef, meetingPath, rows),
            });
            if (res && res.ok && res.value) TaskMeetingList._notice(TaskMeetingList._summary(res.value), 5000);
            return res;
        } finally {
            busy.delete(key);
        }
    }

    /** The one notice after a batch. */
    static _summary(v) {
        const n = v.made.length;
        const parts = [n ? 'Made ' + n + (n === 1 ? ' task' : ' tasks') : 'No tasks made'];
        if (v.skipped) parts.push(v.skipped + (v.skipped === 1 ? ' line changed, skipped' : ' lines changed, skipped'));
        if (v.failed) parts.push(v.failed + ' could not be made');
        if (v.commsMissed) parts.push('comms note not made for ' + v.commsMissed);
        return parts.join('; ');
    }

    /**
     * The write behind makeTasks. Throws only when the meeting note is gone.
     * Every task that was made has its line marked (in a finally), so a
     * failure part-way never leaves a made task's line to be offered again.
     */
    static async _convert(appRef, meetingPath, rows) {
        const CJS = (typeof window !== 'undefined' && window.customJS) || {};
        const TD = CJS.TaskDialog;
        const Docs = CJS.TaskDocs;
        const TE = CJS.TaskEntity;
        if (!TD || typeof TD._create !== 'function') throw new Error('task-entity is not loaded');
        const file = appRef.vault.getAbstractFileByPath(meetingPath);
        if (!file) throw new Error('meeting note not found');
        const meetingName = String(file.basename || String(meetingPath).split('/').pop().replace(/\.md$/i, ''));
        const fm = TaskMeetingList._fm(appRef, file);
        const projectName = fm.project ? (TE && typeof TE._linkText === 'function' ? TE._linkText(fm.project) : String(fm.project).replace(/^\[\[|\]\]$/g, '')) : '';
        const project = projectName ? TaskMeetingList._project(appRef, projectName, TD) : null;
        const text = await appRef.vault.read(file);
        const lines = TaskMeetingList._splitLines(text).lines;
        const out = { made: [], skipped: 0, failed: 0, commsMissed: 0 };
        const claimed = new Set();
        let lastPath = '';
        try {
            for (const row of rows || []) {
                await TaskMeetingList._convertRow(appRef, row, { lines, claimed, out, TD, Docs, meetingName, project, onMade: (p) => { lastPath = p; } });
            }
        } finally {
            if (out.made.length) {
                await appRef.vault.process(file, (t) => TaskMeetingList.markConverted(t, out.made).text);
                try { if (typeof TD._reconcileAfterCreate === 'function') TD._reconcileAfterCreate(appRef, lastPath); } catch (_e) {}
            }
        }
        return out;
    }

    /** One row of _convert: make its task, then its comms note when it is someone else's. */
    static async _convertRow(appRef, row, ctx) {
        const { lines, claimed, out, TD, Docs, meetingName, project } = ctx;
        if (!row || !row.on) return;
        const title = String(row.title == null ? '' : row.title).replace(/\s+/g, ' ').trim();
        if (!title) return;
        const at = lines[row.index] === row.raw && !claimed.has(row.index)
            ? row.index
            : lines.findIndex((l, j) => l === row.raw && !claimed.has(j));
        if (at < 0) { out.skipped++; return; }
        claimed.add(at);
        const due = /^\d{4}-\d{2}-\d{2}$/.test(String(row.due || '')) ? String(row.due) : '';
        const payload = { title, due, source: 'meeting', source_note: '[[' + meetingName + ']]', links: [] };
        if (project) payload.project = project;
        let created = null;
        try { created = await TD._create(appRef, payload, '', { reconcile: false, notice: false }); } catch (_e) { created = null; }
        if (!created || !created.ok || !created.path) { out.failed++; return; }
        ctx.onMade(created.path);
        const name = String(created.path).split('/').pop().replace(/\.md$/i, '');
        const item = { index: at, raw: row.raw, name, path: created.path, comms: '' };
        out.made.push(item);
        const other = TaskMeetingList.ownerOfTitle(title);
        if (!other) return;
        try {
            if (!Docs || typeof Docs.create !== 'function') throw new Error('task notes are not loaded');
            const to = TaskMeetingList._toFor(row, other.owner);
            const doc = await Docs.create(appRef, created.path, 'comms', 'Message to ' + to);
            const docFile = doc && doc.ok ? appRef.vault.getAbstractFileByPath(doc.path) : null;
            if (!docFile) throw new Error((doc && doc.reason) || 'comms note not created');
            item.comms = doc.path;
            await appRef.vault.process(docFile, (t) => String(t).replace(/\s*$/, '\n\n') + other.thing + '\n');
            await appRef.fileManager.processFrontMatter(docFile, (f) => { f.to = to; });
        } catch (_e) {
            out.commsMissed++;
        }
    }

    static get _CSS() {
        return [
            '.sauce-mtg-actions { display: flex; justify-content: flex-end; gap: 8px; margin: 0 0 6px; }',
            'body .sauce-mtg-make.sauce-mtg-make { min-height: 36px; font-size: 0.85em; }',
            '.sauce-mtg-review-copy { color: var(--text-muted); font-size: 0.9em; margin-bottom: 10px; }',
            '.sauce-mtg-review { display: flex; flex-direction: column; gap: 6px; max-height: 55vh; overflow-y: auto; }',
            '.sauce-mtg-review-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px); background: var(--background-primary); }',
            '.sauce-mtg-review-row.is-off .sauce-mtg-review-fields { opacity: 0.5; }',
            '.sauce-mtg-review-tick { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; cursor: pointer; }',
            '.sauce-mtg-review-tick input { margin: 0; width: 18px; height: 18px; cursor: pointer; }',
            '.sauce-mtg-review-fields { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }',
            'body .sauce-mtg-review-title.sauce-mtg-review-title { flex: 1 1 220px; min-width: 0; min-height: 36px; box-sizing: border-box; }',
            'body .sauce-mtg-review-due.sauce-mtg-review-due { flex: 0 0 auto; min-height: 36px; box-sizing: border-box; }',
            '.sauce-mtg-review-hint { flex-basis: 100%; min-width: 0; color: var(--text-faint, var(--text-muted)); font-size: 0.8em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            'body.is-phone .sauce-mtg-review-title.sauce-mtg-review-title, body.is-phone .sauce-mtg-review-due.sauce-mtg-review-due { flex-basis: 100%; font-size: 16px; }',
            'body.is-phone .sauce-mtg-review { max-height: none; }',
        ].join('\n');
    }

    static _injectCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            let s = document.getElementById('sauce-task-meeting-css');
            if (!s) {
                s = document.createElement('style');
                s.id = 'sauce-task-meeting-css';
                document.head.appendChild(s);
            }
            if (s.textContent !== TaskMeetingList._CSS) s.textContent = TaskMeetingList._CSS;
        } catch (_e) {}
    }

    async _renderFlat(dv) {
        if (!dv || !dv.container) return;
        // Skip inside embeds — the host note renders its own list.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        // ----- Cold-load guard -----
        const page = (window.customJS && window.customJS.RenderSafe)
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' || !TTL || typeof TTL.renderTaskRow !== 'function') {
            return;
        }

        // Current meeting basename (strip a trailing .md defensively).
        const rawName = (page.file && page.file.name) || '';
        const meetingBasename = String(rawName).replace(/\.md$/i, '').trim();
        if (!meetingBasename) return;

        // ----- Live query: open task notes (exclude _trash/ + _done/). -----
        let parsed = [];
        try {
            // The archives are excluded in the SOURCE so Dataview never builds a page
            // object for a finished or trashed task; the status check below decides the rest.
            const raw = dv.pages('"spice/tasks" and -"spice/tasks/_done" and -"spice/tasks/_trash" and -"spice/tasks/_sets"').where(p =>
                p && p.type === 'task'
                && p.file && p.file.path
                && (typeof TE.isOpenTask === 'function' ? TE.isOpenTask(p) : p.status === 'open'));
            // Parse each task once (the old feature test mapped the whole list twice).
            const mapped = raw.map(p => TE.parseNote(p));
            parsed = typeof mapped.array === 'function' ? mapped.array() : Array.from(mapped);
        } catch (_e) {
            parsed = [];
        }

        const mine = parsed.filter(t => TaskMeetingList._matches(t, meetingBasename));

        // Attach an optional subtask-count summary to each task — one shared
        // vault-wide query, not a per-row query (mirrors TaskTodayList.render).
        const subtaskCounts = (typeof TE.subtaskCountsByParent === 'function') ? TE.subtaskCountsByParent(dv) : {};
        for (const t of mine) {
            const basename = t && t.path ? t.path.split('/').pop().replace(/\.md$/i, '') : '';
            t.subtask_count = subtaskCounts[basename] || null;
        }

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-meeting' });
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0; width: 100%; box-sizing: border-box;';

        const cap = wrap.createEl('div', { cls: 'sauce-task-meeting-label', text: 'Tasks' });
        cap.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #999); margin-bottom: 2px;';

        if (!mine.length) {
            const hint = wrap.createEl('div', { text: 'No tasks yet — use + New Task above.' });
            hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }

        const TD = window.customJS && window.customJS.TaskDialog;
        for (const t of mine) {
            try {
                TTL.renderTaskRow(wrap, t, TD);
            } catch (_e) {
                // One bad task note must not break the whole list.
            }
        }
    }
}
