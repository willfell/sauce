/**
 * TaskDialog (CustomJS) — the create/edit/done/delete dialog for a task note.
 *
 * Companion to TaskEntity (the pure note-per-task core). This class owns the
 * BROWSER-side gestures — but every gesture writes EXACTLY ONE file: the task's
 * own `spice/tasks/task-<id>.md`. It NEVER reads or rewrites any surface note
 * (daily / project / meeting); surfaces live-query the task notes instead. That
 * one-file invariant is the whole point of the redesign: a bad write on mobile
 * can only ever touch one task's file, never wipe a whole day's list.
 *
 * SAFE single-file primitives (no read+rewrite of the whole file, ever):
 *   - create → app.vault.create(path, content)                (one NEW file)
 *   - edit   → app.fileManager.processFrontMatter(file, mut)  (that file's FM only)
 *   - done   → processFrontMatter(status=done, completed_at) + renameFile → _done/
 *   - delete → processFrontMatter(status=deleted)            + renameFile → _trash/
 * `_done/` / `_trash/` folders are created on demand (createFolder guarded in a
 * try/catch — it throws if the folder already exists).
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "; return TaskDialog;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskDialog.defaultsForSurface({surface, today, project, sourceNote}) → {...}
 *   TaskDialog.trashPath(path) → path under spice/tasks/_trash/
 *   TaskDialog.donePath(path)  → path under spice/tasks/_done/
 *   TaskDialog.whenOptions / whenKeyForDue / whenCaption / recentProjects /
 *     projectMatches → the two-column dialog's When and Project helpers
 *
 * Dialog layout (`_render`): header + close; body = `.sauce-task-dialog-cols`
 * (left: title, notes, links/parent; right: When, Priority, Project, Repeats),
 * stacked below 720px by the injected `_DIALOG_CSS`; footer outside the body.
 *
 * Instance API (browser-side):
 *   TaskDialog.open({ edit?, surface?, today?, project?, sourceNote? })
 */
class TaskDialog {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.TaskDialog, and any
    // cross-class consumer (surface buttons wired in a later task) reaches these
    // via that instance. A static-only declaration is not on the prototype → the
    // call throws at runtime. Each instance method precedes its static in source
    // order (mirrors TaskEntity / ToDoCreateTask posture).

    defaultsForSurface(opts) { return TaskDialog.defaultsForSurface(opts); }
    trashPath(path) { return TaskDialog.trashPath(path); }
    donePath(path) { return TaskDialog.donePath(path); }
    _loadProjectList(app) { return TaskDialog._loadProjectList(app); }
    _slugify(name) { return TaskDialog._slugify(name); }
    _bodyNotesBelowMarker(fileText) { return TaskDialog._bodyNotesBelowMarker(fileText); }
    _replaceBody(fileText, newNotes) { return TaskDialog._replaceBody(fileText, newNotes); }
    _wikilink(name) { return TaskDialog._wikilink(name); }
    _mdLink(label, url) { return TaskDialog._mdLink(label, url); }
    _addLink(links, entry) { return TaskDialog._addLink(links, entry); }
    _removeLink(links, i) { return TaskDialog._removeLink(links, i); }
    _insertAt(text, insertion, start, end) { return TaskDialog._insertAt(text, insertion, start, end); }
    renderNote(frontmatter, body) { return TaskDialog.renderNote(frontmatter, body); }
    _chromeBody() { return TaskDialog._chromeBody(); }
    _payloadFromState(state) { return TaskDialog._payloadFromState(state); }
    _composeRecurrenceGrammar(freq, opts) { return TaskDialog._composeRecurrenceGrammar(freq, opts); }
    _ordinalSuffix(n) { return TaskDialog._ordinalSuffix(n); }
    _recurrenceStateFromDescribe(described) { return TaskDialog._recurrenceStateFromDescribe(described); }
    _recurrencePickerValid(state) { return TaskDialog._recurrencePickerValid(state); }
    _rollForwardDate(recurrence, todayStr, anchorDateStr, matchesFn) { return TaskDialog._rollForwardDate(recurrence, todayStr, anchorDateStr, matchesFn); }
    _moreOptionsShouldStartExpanded(state) { return TaskDialog._moreOptionsShouldStartExpanded(state); }
    _renderSafe() { return TaskDialog._renderSafe(); }
    whenOptions(todayStr) { return TaskDialog.whenOptions(todayStr); }
    whenKeyForDue(due, todayStr) { return TaskDialog.whenKeyForDue(due, todayStr); }
    whenCaption(key, due, owned) { return TaskDialog.whenCaption(key, due, owned); }
    recentProjects(parsedTasks, todayStr, limit) { return TaskDialog.recentProjects(parsedTasks, todayStr, limit); }
    _utcDatePlus(dateStr, n) { return TaskDialog._utcDatePlus(dateStr, n); }
    _utcNextMonday(dateStr) { return TaskDialog._utcNextMonday(dateStr); }
    _projectDisplay(v) { return TaskDialog._projectDisplay(v); }
    projectMatches(names, query, limit) { return TaskDialog.projectMatches(names, query, limit); }
    _recentTaskRows(app, todayStr) { return TaskDialog._recentTaskRows(app, todayStr); }
    _parentCandidates(app, editPath) { return TaskDialog._parentCandidates(app, editPath); }
    _linkBasename(v) { return TaskDialog._linkBasename(v); }
    _submitKeyHint(app) { return TaskDialog._submitKeyHint(app); }
    _todayStr(given) { return TaskDialog._todayStr(given); }
    _readOpenAfterPref() { return TaskDialog._readOpenAfterPref(); }
    _writeOpenAfterPref(on) { return TaskDialog._writeOpenAfterPref(on); }
    _injectDialogCss(doc) { return TaskDialog._injectDialogCss(doc); }
    get _DIALOG_CSS() { return TaskDialog._DIALOG_CSS; }
    openShell(opts) { return TaskDialog.openShell(opts); }
    get FIELD_CSS() { return TaskDialog.FIELD_CSS; }
    get DATE_CSS() { return TaskDialog.DATE_CSS; }
    sectionLabel(parent, text) { return TaskDialog.sectionLabel(parent, text); }
    setPressed(el, base, on) { return TaskDialog.setPressed(el, base, on); }
    pill(parent, base, text) { return TaskDialog.pill(parent, base, text); }
    actionButton(parent, o) { return TaskDialog.actionButton(parent, o); }
    isCmdEnter(event) { return TaskDialog.isCmdEnter(event); }
    filterList(host, opts) { return TaskDialog.filterList(host, opts); }
    projectField(parent, opts) { return TaskDialog.projectField(parent, opts); }
    _takenNames(app, reservedLower, excludeUnder) { return TaskDialog._takenNames(app, reservedLower, excludeUnder); }
    _taskNotesBelow(app, folder) { return TaskDialog._taskNotesBelow(app, folder); }
    _openDescendants(app, folder) { return TaskDialog._openDescendants(app, folder); }
    _fmOf(app, file) { return TaskDialog._fmOf(app, file); }
    _isTaskFolderNote(path) { return TaskDialog._isTaskFolderNote(path); }
    _folderNoteWhileCold(path) { return TaskDialog._folderNoteWhileCold(path); }
    _movedPath(path, moved) { return TaskDialog._movedPath(path, moved); }
    _restoreFields(app, priors) { return TaskDialog._restoreFields(app, priors); }
    _resolveTaskParent(app, parentLink) { return TaskDialog._resolveTaskParent(app, parentLink); }
    _parentFolderFor(app, parentLink) { return TaskDialog._parentFolderFor(app, parentLink); }
    _planEditMove(app, file, payload, prior) { return TaskDialog._planEditMove(app, file, payload, prior); }

    // ---------- Static pure helpers ----------

    /**
     * Seed a create form from the surface that opened the dialog.
     *   daily / home → { source: "daily" }              (NO due: When starts on No date)
     *   project → { project, source: "project" }        (NO due)
     *   meeting → { source_note, project, source: "meeting" }
     *   manual / absent → { source: "manual" }
     * Only keys with a meaningful value are emitted (no empty scaffolding), so a
     * deep-equal against the minimal expected object holds.
     */
    static defaultsForSurface(opts) {
        const o = opts || {};
        switch (o.surface) {
            case 'daily':
            case 'home':
                return { source: 'daily' };
            case 'project':
                return { project: o.project, source: 'project' };
            case 'trip':
                return { trip: o.trip, source: 'trip' };
            case 'meeting': {
                const out = { source: 'meeting' };
                if (o.sourceNote != null) out.source_note = o.sourceNote;
                if (o.project != null) out.project = o.project;
                return out;
            }
            case 'manual':
            default:
                return { source: 'manual' };
        }
    }

    // ---------- When picker / recent-project helpers (pure) ----------

    /** YYYY-MM-DD plus n days via Date.UTC only; null on unparseable input. */
    static _utcDatePlus(dateStr, n) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr == null ? '' : dateStr));
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(n) || 0)));
        const p = (x) => String(x).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }

    /** Next Monday strictly after dateStr (a Monday yields +7); null on unparseable input. */
    static _utcNextMonday(dateStr) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr == null ? '' : dateStr));
        if (!m) return null;
        const cur = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
        return TaskDialog._utcDatePlus(dateStr, ((1 - cur + 7) % 7) || 7);
    }

    /**
     * The quick "when" choices, in display order. `due` is the resolved date:
     * '' for No date, null for Pick date (the user chooses). Prefers the stored
     * TaskEntity for tomorrow/next-Monday, falling back to a local UTC helper.
     */
    static whenOptions(todayStr) {
        let tomorrow = null, nextMon = null;
        const TE = TaskDialog._taskEntity();
        try {
            if (TE && typeof TE.tomorrow === 'function') tomorrow = TE.tomorrow(todayStr);
            if (TE && typeof TE.nextMonday === 'function') nextMon = TE.nextMonday(todayStr);
        } catch (_e) { /* fall through to the local helper */ }
        if (!tomorrow) tomorrow = TaskDialog._utcDatePlus(todayStr, 1);
        if (!nextMon) nextMon = TaskDialog._utcNextMonday(todayStr);
        return [
            { key: 'today', label: 'Today', due: todayStr },
            { key: 'tomorrow', label: 'Tomorrow', due: tomorrow },
            { key: 'nextmon', label: 'Next Mon', due: nextMon },
            { key: 'pick', label: 'Pick date…', due: null },
            { key: 'none', label: 'No date', due: '' },
        ];
    }

    /** Which quick choice a due date corresponds to: '' -> none; today/tomorrow/next Monday -> their key; else pick. */
    static whenKeyForDue(due, todayStr) {
        const d = due == null ? '' : String(due).trim();
        if (!d) return 'none';
        const hit = TaskDialog.whenOptions(todayStr).find(o => o.due && o.due === d);
        return hit ? hit.key : 'pick';
    }

    /**
     * Caption under the when picker: `Due Mon Nov 16`, `No date: goes to the
     * backlog`, `Pick a date`. `owned` (the task has a project, trip, parent
     * or meeting) means an undated task stays with its owner instead of going
     * to the backlog, so the No date caption is just `No date`.
     */
    static whenCaption(key, due, owned) {
        if (key === 'none') return owned ? 'No date' : 'No date: goes to the backlog';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(due == null ? '' : due));
        if (!m) return 'Pick a date';
        const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return 'Due ' + WD[d.getUTCDay()] + ' ' + MO[d.getUTCMonth()] + ' ' + (+m[3]);
    }

    /**
     * Whether the dialog's task has an owner (project, trip, parent task or a
     * meeting source), in which case clearing its date does not send it to
     * the backlog (TaskEntity.isBacklog).
     */
    static _ownedForCaption(state) {
        const s = state || {};
        return !!(String(s.projectName || '').trim() || String(s.tripName || '').trim()
            || String(s.tripSlug || '').trim() || String(s.parentTask || '').trim()
            || s.source === 'meeting');
    }

    /** Display name of a project value: `[[Name]]` / `[[Name|alias]]` -> Name; Dataview Link -> display or path basename. */
    static _projectDisplay(v) {
        if (v == null) return '';
        if (typeof v === 'object') {
            if (v.display != null && String(v.display).trim()) return String(v.display).trim();
            if (v.path != null) return String(v.path).trim().replace(/^.*\//, '').replace(/\.md$/i, '');
            return '';
        }
        let s = TaskDialog._stripWikilink(v);
        const pipe = s.indexOf('|');
        if (pipe >= 0) s = s.slice(0, pipe);
        return s.trim();
    }

    /**
     * Project display names among tasks created in the 30 days ending todayStr
     * (inclusive), ranked by count desc then most recent created_at, capped at
     * `limit` (default 6). Tasks with no project or an unparseable created_at
     * are ignored.
     */
    static recentProjects(parsedTasks, todayStr, limit) {
        const max = limit == null ? 6 : limit;
        const lo = TaskDialog._utcDatePlus(todayStr, -29);
        const hi = TaskDialog._utcDatePlus(todayStr, 0);
        if (!lo || !hi || !Array.isArray(parsedTasks)) return [];
        const stats = new Map();
        for (const t of parsedTasks) {
            if (!t) continue;
            const name = TaskDialog._projectDisplay(t.project);
            if (!name) continue;
            let c = t.created_at;
            if (c != null && typeof c === 'object') {
                if (typeof c.toISO === 'function') c = c.toISO();
                else if (typeof c.toISOString === 'function') c = c.toISOString();
            }
            c = c == null ? '' : String(c).trim();
            const dm = /^(\d{4}-\d{2}-\d{2})/.exec(c);
            if (!dm) continue;
            const day = dm[1];
            if (day < lo || day > hi) continue;
            let ms = Date.parse(c);
            if (isNaN(ms)) ms = Date.parse(day + 'T00:00:00Z');
            const cur = stats.get(name) || { name: name, count: 0, last: -Infinity };
            cur.count++;
            if (ms > cur.last) cur.last = ms;
            stats.set(name, cur);
        }
        return Array.from(stats.values())
            .sort((a, b) => (b.count - a.count) || (b.last - a.last) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .slice(0, max)
            .map(x => x.name);
    }

    /**
     * Rewrite the `spice/tasks/` prefix of a task path into `spice/tasks/_trash/`,
     * keeping the filename. e.g. "spice/tasks/task-a.md" → "spice/tasks/_trash/task-a.md".
     * A path not under spice/tasks/ is returned unchanged.
     */
    static trashPath(path) {
        return TaskDialog._rebase(path, '_trash');
    }

    /**
     * Rewrite the `spice/tasks/` prefix of a task path into `spice/tasks/_done/`.
     * e.g. "spice/tasks/task-a.md" → "spice/tasks/_done/task-a.md".
     */
    static donePath(path) {
        return TaskDialog._rebase(path, '_done');
    }

    /** Shared prefix-rewriter for donePath / trashPath. */
    static _rebase(path, sub) {
        const p = String(path == null ? '' : path);
        const PREFIX = 'spice/tasks/';
        if (p.indexOf(PREFIX) !== 0) return p;
        return PREFIX + sub + '/' + p.slice(PREFIX.length);
    }

    /**
     * Slugify a project name the same way the rest of the platform does
     * (lowercase, runs of non-alphanumerics → single dash, trimmed). Used when a
     * free-text project name is typed in the create form so composeNote gets a
     * { name, slug } pair.
     */
    static _slugify(name) {
        return String(name == null ? '' : name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Compose a RecurrenceParser grammar string from the dialog's structured
     * picker state. `freq` is one of 'none' | 'daily' | 'weekday' | 'weekly' |
     * 'monthly'; `opts.days` is an array of 0(Sun)..6(Sat), `opts.weeks` is the
     * "every N weeks" interval (weekly only, N<=1 omits the wrapper),
     * `opts.dayOfMonth` is 1..31 (monthly only). Days are de-duped, filtered to
     * 0..6, and sorted Sun..Sat so click order never affects the output — the
     * composed string is deterministic. Weekly with zero valid days, or
     * monthly with an out-of-range/missing day, both return "" (never a
     * malformed "every " with nothing after it). Pure, never throws.
     */
    static _composeRecurrenceGrammar(freq, opts) {
        const o = opts || {};
        switch (freq) {
            case 'daily':
                return 'every day';
            case 'weekday':
                return 'every weekday';
            case 'monthly': {
                const day = parseInt(o.dayOfMonth, 10);
                if (!Number.isInteger(day) || day < 1 || day > 31) return '';
                return 'every ' + day + TaskDialog._ordinalSuffix(day) + ' of month';
            }
            case 'weekly': {
                const raw = Array.isArray(o.days) ? o.days : [];
                const uniq = Array.from(new Set(raw.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort((a, b) => a - b);
                if (uniq.length === 0) return '';
                const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const dayNames = uniq.map((d) => DOW_NAMES[d]).join(' ');
                const weeks = parseInt(o.weeks, 10);
                if (Number.isInteger(weeks) && weeks > 1) return 'every ' + weeks + ' weeks on ' + dayNames;
                return 'every ' + dayNames;
            }
            case 'none':
            default:
                return '';
        }
    }

    /** English ordinal suffix for a day-of-month number (1st, 2nd, 3rd, 4th..11th..21st..). */
    static _ordinalSuffix(n) {
        const v = n % 100;
        if (v >= 11 && v <= 13) return 'th';
        switch (n % 10) {
            case 1: return 'st';
            case 2: return 'nd';
            case 3: return 'rd';
            default: return 'th';
        }
    }

    /**
     * Reverse-map RecurrenceParser.describe()'s output into the picker's
     * initial UI state — { freq, days, weeks, dayOfMonth } — for hydrating
     * the dialog when editing a task that already has a recurrence. A `null`
     * input (no recurrence, or an unsupported/legacy grammar) maps to
     * freq: 'none' with everything blank, never throws.
     */
    static _recurrenceStateFromDescribe(described) {
        const BLANK = { freq: 'none', days: [], weeks: 1, dayOfMonth: null };
        if (!described) return BLANK;
        switch (described.kind) {
            case 'daily':
                return Object.assign({}, BLANK, { freq: 'daily' });
            case 'weekday-block':
                return Object.assign({}, BLANK, { freq: 'weekday' });
            case 'weekend-block':
                return Object.assign({}, BLANK, { freq: 'weekly', days: [0, 6] });
            case 'day-of-month':
                return Object.assign({}, BLANK, { freq: 'monthly', dayOfMonth: described.day || null });
            case 'weekday-set':
                return Object.assign({}, BLANK, { freq: 'weekly', days: Array.isArray(described.days) ? described.days.slice() : [] });
            case 'every-n-weeks-on-day':
                return Object.assign({}, BLANK, {
                    freq: 'weekly',
                    days: Array.isArray(described.days) ? described.days.slice() : [],
                    weeks: described.weeks || 1,
                });
            default:
                return BLANK;
        }
    }

    /**
     * Gate for Save: the only structurally-invalid picker state is Weekly
     * with zero days toggled (which would silently compose to "" — i.e.
     * "doesn't repeat" — contradicting the user's choice of Weekly). Every
     * other frequency is always valid. Pure, never throws.
     */
    static _recurrencePickerValid(state) {
        const s = state || {};
        if (s.recurrenceFreq !== 'weekly') return true;
        return Array.isArray(s.recurrenceDays) && s.recurrenceDays.length > 0;
    }

    /**
     * True iff any of Priority/Project/Repeats/Notes/Links already has a
     * value, so a disclosure holding them starts EXPANDED and existing data is
     * never hidden. The two-column dialog shows everything except Repeats, so
     * it passes only `{ recurrence }` to decide whether Repeats starts open.
     * Pure, never throws.
     */
    static _moreOptionsShouldStartExpanded(state) {
        const s = state || {};
        if (s.priority && String(s.priority).trim()) return true;
        if (s.projectName && String(s.projectName).trim()) return true;
        if (s.recurrence && String(s.recurrence).trim()) return true;
        if (s.notes && String(s.notes).trim()) return true;
        if (Array.isArray(s.links) && s.links.length > 0) return true;
        return false;
    }

    /**
     * Thin wrapper over TaskEntity.nextOccurrence for the "done" branch:
     * rolls forward from TODAY (not from the task's stale `due`), so a
     * late completion doesn't create a backlog of overdue occurrences. Returns
     * the next `YYYY-MM-DD`, or `null` when the grammar is unsupported/never
     * fires (caller falls back to normal archiving). Pure, never throws.
     */
    static _rollForwardDate(recurrence, todayStr, anchorDateStr, matchesFn) {
        const TE = TaskDialog._taskEntity();
        if (TE && typeof TE.nextOccurrence === 'function') {
            return TE.nextOccurrence(recurrence, todayStr, anchorDateStr, matchesFn);
        }
        return null;
    }

    /**
     * Enumerate the vault's projects (for the create/edit dialog's project
     * dropdown) dependency-free via metadataCache — TaskDialog is button-invoked
     * so there's no `dv` to query. Scans markdown files under spice/projects/
     * whose frontmatter `type === 'project'`, reading `{ name, slug }` (falling
     * back to basename / slugified name). Deduped by slug, sorted by name. Never
     * throws — a missing app / cache just yields [].
     */
    static _loadProjectList(app) {
        const out = [];
        try {
            const files = app.vault.getMarkdownFiles();
            for (const f of files) {
                if (f.path.indexOf('spice/projects/') !== 0) continue;
                const fm = app.metadataCache.getFileCache(f) && app.metadataCache.getFileCache(f).frontmatter;
                if (fm && fm.type === 'project') {
                    const name = fm.name || f.basename;
                    const slug = fm.slug || TaskDialog._slugify(name);
                    out.push({ name: String(name), slug: String(slug) });
                }
            }
        } catch (_e) {}
        // dedupe by slug, sort by name
        const seen = {}; const uniq = [];
        for (const p of out) { if (!seen[p.slug]) { seen[p.slug] = 1; uniq.push(p); } }
        uniq.sort((a, b) => a.name.localeCompare(b.name));
        return uniq;
    }

    /**
     * Render a { path, frontmatter, body } note (from TaskEntity.composeNote)
     * into the full file string. Frontmatter values are single-line and quoted
     * when they contain a YAML-hostile character (`[`, `]`, `:`, `#`, `"`, or a
     * leading space) so wikilinks (`[[Sauce]]`) and ISO timestamps (which contain
     * `:`) round-trip. Empty values emit a bare `key:` (matches the schema's
     * empty-string-not-omitted convention). Deterministic — pure string work.
     */
    static renderNote(frontmatter, body) {
        const fm = frontmatter || {};
        const lines = ['---'];
        for (const key of Object.keys(fm)) {
            const raw = fm[key];
            // Array-valued keys (FIX 5 — `links`) serialize as a YAML FLOW array
            // (`["[[A]]", "[b](u)"]`), or a bare `[]` when empty, so a list of
            // markdown link strings round-trips through Dataview/Obsidian and a
            // later edit is a whole-field write. Everything else stays a scalar.
            if (Array.isArray(raw)) { lines.push(key + ': ' + TaskDialog._yamlFlowArray(raw)); continue; }
            const val = raw == null ? '' : String(raw);
            if (val === '') { lines.push(key + ':'); continue; }
            lines.push(key + ': ' + TaskDialog._yamlScalar(val));
        }
        lines.push('---');
        const b = body == null ? '' : String(body);
        return lines.join('\n') + '\n' + (b ? b + '\n' : '');
    }

    /**
     * Serialize a string array as a YAML FLOW array: `["a", "b"]` (or `[]` when
     * empty). Each element is double-quoted with `"` and `\` escaped so a markdown
     * link string containing brackets / colons / quotes round-trips. Non-string
     * elements are coerced via String(); nullish elements are dropped. Pure. This
     * is a compact, JSON-compatible YAML flow array — `JSON.parse` round-trips it.
     */
    static _yamlFlowArray(arr) {
        const list = Array.isArray(arr) ? arr : [];
        const parts = [];
        for (const el of list) {
            if (el == null) continue;
            const s = String(el);
            parts.push('"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
        }
        return '[' + parts.join(', ') + ']';
    }

    /** Quote a scalar iff it contains a YAML-hostile char or a leading space. */
    static _yamlScalar(val) {
        const s = String(val);
        if (/[[\]:#"]|^\s/.test(s)) {
            return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        }
        return s;
    }

    /**
     * Build an Obsidian wikilink from a note basename: `[[Name]]`. Trims the
     * name; an empty/nullish/all-whitespace name yields "" (so the caller can
     * no-op). Pure string work — the note-picker inserts the result into the
     * Notes textarea, where Obsidian renders it as a real link.
     */
    static _wikilink(name) {
        const n = String(name == null ? '' : name).trim();
        return n ? '[[' + n + ']]' : '';
    }

    /**
     * Build a markdown link from a URL + optional label.
     *   no url                → ""            (caller no-ops)
     *   url, no/blank label   → "<url>"       (autolink; renders clickable)
     *   url + label           → "[label](url)"
     * Both label and url are trimmed. Pure string work.
     */
    static _mdLink(label, url) {
        const u = String(url == null ? '' : url).trim();
        if (!u) return '';
        const l = String(label == null ? '' : label).trim();
        return l ? '[' + l + '](' + u + ')' : '<' + u + '>';
    }

    /**
     * Push a markdown link STRING onto the dialog's `links` chip list (FIX 5),
     * returning a NEW array (never mutates the input). The entry is trimmed;
     * blank / nullish entries and exact duplicates are no-ops (kept unique so the
     * same link isn't added twice). A non-array base is treated as []. Pure — this
     * is the add half of the chip-list model TaskNoteView renders inside the card.
     */
    static _addLink(links, entry) {
        const base = Array.isArray(links) ? links.slice() : [];
        const s = String(entry == null ? '' : entry).trim();
        if (!s) return base;
        if (base.indexOf(s) >= 0) return base;   // dedupe — no duplicate chips
        base.push(s);
        return base;
    }

    /**
     * Remove the chip at index `i` from `links`, returning a NEW array (never
     * mutates the input). An out-of-range / negative / non-integer index leaves
     * the list unchanged (returns a clone). A non-array base yields []. Pure —
     * the remove half of the chip-list model. This is what a chip's ✕ calls.
     */
    static _removeLink(links, i) {
        const base = Array.isArray(links) ? links.slice() : [];
        const idx = Number(i);
        if (!Number.isInteger(idx) || idx < 0 || idx >= base.length) return base;
        base.splice(idx, 1);
        return base;
    }

    /**
     * Splice `insertion` into `text`, replacing the [start, end) selection (the
     * textarea's selectionStart / selectionEnd). When the range is invalid
     * (null / NaN / out of [0, text.length]), APPEND `insertion` to the end
     * instead, with a single leading space when `text` is non-empty and doesn't
     * already end in whitespace (so an inserted link never abuts prior text).
     * Returns the new string. Pure — this is what the textarea insertion uses.
     */
    static _insertAt(text, insertion, start, end) {
        const s = String(text == null ? '' : text);
        const ins = String(insertion == null ? '' : insertion);
        const len = s.length;
        // Number(null) === 0 (a valid integer), so reject null/undefined BEFORE
        // coercing — a nullish selection means "no caret" → append, not caret-0.
        const a = (start == null) ? NaN : Number(start);
        const b = (end == null) ? NaN : Number(end);
        const valid = Number.isInteger(a) && Number.isInteger(b)
            && a >= 0 && b >= 0 && a <= len && b <= len && a <= b;
        if (!valid) {
            if (!s) return ins;
            const sep = /\s$/.test(s) ? '' : ' ';
            return s + sep + ins;
        }
        return s.slice(0, a) + ins + s.slice(b);
    }

    // ---------- Instance / browser API ----------

    /**
     * Open the create/edit dialog. opts:
     *   { edit?, surface?, today?, project?, sourceNote? }
     * `edit` is a task-file path string (edit mode); absent = create mode.
     * Fully guarded so it never throws on cold-load — window.customJS may not be
     * ready when a stale render fires, and a throw here would abort the render.
     */
    open(opts) {
        try {
            this._render(opts || {});
        } catch (e) {
            try { new Notice('TaskDialog error: ' + (e && (e.message || e)), 6000); } catch (_e) { /* no Notice in test/CLI */ }
        }
    }

    /**
     * Complete a task by PATH (no dialog). Resolves app + the task file from the
     * path, then routes through the SAME single-file _markDone internal that the
     * edit-dialog's Done button uses (status=done + completed_at; a top-level
     * task folder moves to spice/tasks/_done/YYYY/MM/, a subtask stays put, a
     * flat note moves to spice/tasks/_done/). Consumed by surface widgets
     * (TaskTodayList's row checkbox, the task card's Mark done) so a one-tap
     * complete never opens the edit modal. When the task still has open
     * subtasks and `opts.completeOpenSubtasks` is not set, it asks first
     * (confirmComplete); No resolves { ok: false, reason: 'cancelled' } with
     * nothing changed. Returns { ok: true, path? } on success or
     * { ok: false, reason } so the caller can revert its optimistic UI.
     * Never throws.
     */
    async markDone(path, opts) {
        try {
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            const res = await this._markDone(app, file, opts);
            if (res && res.ok === false) return res;
            return res && res.path ? { ok: true, path: res.path } : { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        }
    }

    /**
     * Recoverable-delete a task by PATH (no dialog). Routes through the SAME
     * single-file _markDeleted internal that the edit-dialog's Delete button
     * uses (status=deleted, then move to spice/tasks/_trash/: a task folder
     * moves whole, a flat note moves alone). Returns { ok: true, path? } /
     * { ok: false, reason }. Never throws.
     */
    async markDeleted(path) {
        try {
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            const res = await this._markDeleted(app, file);
            if (res && res.ok === false) return res;
            return res && res.path ? { ok: true, path: res.path } : { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        }
    }

    /**
     * CONFIRM-DELETE — a tiny yes/no modal for the surface row's trash icon. Opens
     * a confirm overlay (matching the create/edit dialog grammar) and resolves a
     * Promise so the caller (TaskTodayList.renderTaskRow's delete button) knows
     * whether to remove the row:
     *   { ok: true }                    the user confirmed AND markDeleted succeeded
     *   { ok: false, cancelled: true }  the user cancelled / dismissed (Esc / backdrop)
     *   { ok: false, reason }           cold-load (no app / no document) or delete failure
     * The actual write goes through the SAME single-file markDeleted (status=deleted
     * + move to _trash/), so the one-file-write invariant is intact and the delete is
     * recoverable. Fully guarded — never throws (resolves a reason instead). Reuses
     * the recoverable-delete so nothing is hard-deleted.
     */
    supportsDeferredDelete() {
        return true;
    }

    async confirmDelete(path, opts) {
        const deferWrite = !!(opts && opts.deferWrite);
        return new Promise((resolve) => {
            let settled = false;
            const done = (r) => { if (settled) return; settled = true; resolve(r); };
            try {
                const { app, file } = this._resolveFile(path);
                if (!app) { done({ ok: false, reason: 'app unavailable' }); return; }
                const doc = (typeof document !== 'undefined' && document) ? document : null;
                if (!doc || !doc.body) {
                    done({ ok: false, reason: 'no document' });
                    return;
                }
                const sauceModal = (typeof globalThis !== 'undefined' && globalThis.customJS)
                    ? globalThis.customJS.SauceModal : null;
                if (!sauceModal || typeof sauceModal.open !== 'function') {
                    done({ ok: false, reason: 'SauceModal unavailable' });
                    return;
                }

                // Friendly title for the prompt: frontmatter title → basename → path.
                let title = '';
                try {
                    if (file && app.metadataCache && typeof app.metadataCache.getFileCache === 'function') {
                        const cache = app.metadataCache.getFileCache(file);
                        title = (cache && cache.frontmatter && cache.frontmatter.title) || '';
                    }
                } catch (_e) { title = ''; }
                if (!title) {
                    let base = String((file && file.basename) || path || '').replace(/\.md$/i, '');
                    const slash = base.lastIndexOf('/');
                    title = slash >= 0 ? base.slice(slash + 1) : base;
                }

                // A task folder goes to the trash whole: say how many subtasks go with it.
                let below = 0;
                try {
                    const fp = String((file && file.path) || path || '');
                    if (TaskDialog._isTaskFolderNote(fp)) {
                        const TE = TaskDialog._taskEntity();
                        below = TaskDialog._taskNotesBelow(app, TE.taskFolderOf(fp)).length;
                    }
                } catch (_e) { below = 0; }

                const handle = sauceModal.open({
                    doc,
                    title: 'Delete task?',
                    autofocus: '.sauce-task-confirm-cancel',
                    body: (body) => {
                        const copy = body.createEl('div', { cls: 'sauce-task-confirm-copy' });
                        copy.createSpan({ text: 'This moves ' });
                        copy.createEl('strong', { text: '“' + title + '”' });
                        if (below > 0) copy.createSpan({ text: ' and ' + below + (below === 1 ? ' subtask' : ' subtasks') });
                        copy.createSpan({ text: ' to the trash. You can recover it from spice/tasks/_trash.' });
                    },
                    buttons: [
                        { label: 'Cancel', action: 'cancel', className: 'sauce-task-confirm-cancel' },
                        {
                            label: 'Delete',
                            tone: 'danger',
                            close: false,
                            className: 'sauce-task-confirm-delete',
                            onClick: async (api, event) => {
                                const button = event && (event.currentTarget || event.target);
                                try { if (button) button.disabled = true; } catch (_e) {}
                                if (deferWrite) {
                                    done({ ok: true, confirmed: true, deferred: true });
                                    api.close('delete');
                                    return;
                                }
                                let res;
                                try { res = await this.markDeleted(path); }
                                catch (e) { res = { ok: false, reason: (e && (e.message || String(e))) || 'unknown' }; }
                                if (res && res.ok) {
                                    done({ ok: true });
                                    api.close('delete');
                                } else {
                                    try { new Notice('Could not delete task: ' + ((res && res.reason) || 'unknown'), 6000); } catch (_e) {}
                                    done({ ok: false, reason: (res && res.reason) || 'delete failed' });
                                    api.close('delete-error');
                                }
                            },
                        },
                    ],
                    onClose: () => done({ ok: false, cancelled: true }),
                });
                if (!handle) done({ ok: false, reason: 'SauceModal open failed' });
                else {
                    const cancelBtn = handle.footer && handle.footer.querySelector
                        ? handle.footer.querySelector('.sauce-btn') : null;
                    const deleteBtn = handle.footer && handle.footer.children ? handle.footer.children[1] : null;
                    if (cancelBtn) cancelBtn.className += ' sauce-task-confirm-cancel';
                    if (deleteBtn) deleteBtn.className += ' sauce-task-confirm-delete';
                }
            } catch (e) {
                done({ ok: false, reason: (e && (e.message || String(e))) || 'unknown' });
            }
        });
    }

    /**
     * CONFIRM-COMPLETE — the yes/no question markDone asks before finishing a
     * task that still has open subtasks: "Also complete its N open subtasks?"
     * Resolves true for Complete all, false for Cancel / dismiss / cold-load
     * (no app, no document, no SauceModal). Writes nothing. Never throws.
     */
    async confirmComplete(path) {
        return new Promise((resolve) => {
            let settled = false;
            const done = (r) => { if (settled) return; settled = true; resolve(!!r); };
            try {
                const { app, file } = this._resolveFile(path);
                if (!app || !file) { done(false); return; }
                const doc = (typeof document !== 'undefined' && document) ? document : null;
                const sauceModal = (typeof globalThis !== 'undefined' && globalThis.customJS)
                    ? globalThis.customJS.SauceModal : null;
                if (!doc || !doc.body || !sauceModal || typeof sauceModal.open !== 'function') { done(false); return; }
                const TE = TaskDialog._taskEntity();
                const n = TE ? TaskDialog._openDescendants(app, TE.taskFolderOf(String(file.path))).length : 0;
                const handle = sauceModal.open({
                    doc,
                    title: 'Complete subtasks?',
                    autofocus: '.sauce-task-confirm-cancel',
                    body: (body) => {
                        const copy = body.createEl('div', { cls: 'sauce-task-confirm-copy' });
                        copy.createSpan({ text: 'Also complete its ' + n + (n === 1 ? ' open subtask?' : ' open subtasks?') });
                    },
                    buttons: [
                        { label: 'Cancel', action: 'cancel', className: 'sauce-task-confirm-cancel' },
                        {
                            label: 'Complete all',
                            tone: 'accent',
                            close: false,
                            className: 'sauce-task-confirm-complete',
                            onClick: (api) => {
                                done(true);
                                try { api.close('complete'); } catch (_e) {}
                            },
                        },
                    ],
                    onClose: () => done(false),
                });
                if (!handle) done(false);
                else {
                    const cancelBtn = handle.footer && handle.footer.querySelector
                        ? handle.footer.querySelector('.sauce-btn') : null;
                    const okBtn = handle.footer && handle.footer.children ? handle.footer.children[1] : null;
                    if (cancelBtn) cancelBtn.className += ' sauce-task-confirm-cancel';
                    if (okBtn) okBtn.className += ' sauce-task-confirm-complete';
                }
            } catch (_e) {
                done(false);
            }
        });
    }

    /** Resolve { app, file } from a vault-relative task path (browser-side). */
    _resolveFile(path) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const file = (app && app.vault && typeof app.vault.getAbstractFileByPath === 'function')
            ? app.vault.getAbstractFileByPath(String(path == null ? '' : path))
            : null;
        return { app: app, file: file };
    }

    /**
     * Pure candidate-builder for the note-link picker (Links → "+ Note").
     * Given `files` (an array of Obsidian TFile-shaped objects: { path,
     * basename, stat: { mtime } }) and the path of the task currently being
     * edited (`editPath`, or null for a new task), returns basenames sorted by
     * mtime DESCENDING (most-recently-edited first, ties broken
     * alphabetically), excluding notes under `spice/tasks/` (don't link a
     * task to another task) and the file currently being edited.
     *
     * Uses a null-prototype map for dedup so a note whose basename happens to
     * collide with an inherited Object.prototype key (e.g. a note literally
     * titled "constructor" or "hasOwnProperty") is never silently treated as
     * already-seen. Pure, Node-testable, never throws on malformed input.
     */
    static _buildNoteLinkCandidates(files, editPath) {
        const cand = [];
        const seen = Object.create(null);
        const list = Array.isArray(files) ? files : [];
        for (const f of list) {
            const p = (f && f.path) || '';
            if (p.indexOf('spice/tasks/') === 0) continue;   // don't link tasks to tasks
            if (editPath && p === editPath) continue;        // not the current file
            const bn = (f && f.basename) || '';
            if (!bn || seen[bn]) continue;
            seen[bn] = 1;
            const mtime = (f && f.stat && typeof f.stat.mtime === 'number') ? f.stat.mtime : 0;
            cand.push({ name: bn, mtime: mtime });
        }
        cand.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name));
        return cand.map((c) => c.name);
    }

    _render(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app);
        if (!app) { try { new Notice('TaskDialog: app unavailable'); } catch (_e) {} return; }

        // Resolve edit-mode target + hydrate state from its frontmatter.
        const editPath = typeof opts.edit === 'string' ? opts.edit : null;
        let editFile = null;
        let fm = null;
        if (editPath) {
            editFile = app.vault && app.vault.getAbstractFileByPath ? app.vault.getAbstractFileByPath(editPath) : null;
            if (editFile && app.metadataCache && app.metadataCache.getFileCache) {
                const cache = app.metadataCache.getFileCache(editFile);
                fm = (cache && cache.frontmatter) || null;
            }
        }

        // The render entry is the only place that reads the clock: every helper
        // below takes todayStr.
        const todayStr = TaskDialog._todayStr(opts.today);
        const surface = opts.surface;
        const defaults = editPath ? {} : TaskDialog.defaultsForSurface(opts);
        let createDue = defaults.due || '';
        if (!editPath && !createDue && opts.today && (!surface || surface === 'manual')) createDue = String(opts.today);

        const state = {
            title: fm ? (fm.title || '') : '',
            due: fm ? (fm.due || '') : createDue,
            priority: fm ? (fm.priority || '') : (defaults.priority || ''),
            // project as a display name (strip [[ ]] if present)
            projectName: fm ? TaskDialog._stripWikilink(fm.project) : (defaults.project && defaults.project.name) || '',
            // trip linkage — parallel to project. On edit hydrate from the note's
            // trip / trip_slug frontmatter; on create seed from defaults.trip.
            tripName: fm ? TaskDialog._stripWikilink(fm.trip) : (defaults.trip && defaults.trip.name) || '',
            tripSlug: fm ? (fm.trip_slug || '') : (defaults.trip && defaults.trip.slug) || '',
            notes: '',
            // Edit mode: true only once the task body has been read, so a save
            // never rewrites notes it has not seen. Create mode starts loaded.
            notesLoaded: !editPath,
            // Structured card links (FIX 5) — load the edit file's `links[]` (via
            // TaskEntity._normLinks so a Dataview-array-of-Link-objects coerces to
            // clean strings); create mode starts empty. Rendered as removable chips.
            links: TaskDialog._loadLinks(fm),
            // carry create-only seeds forward into the payload
            source: fm ? (fm.source || '') : (defaults.source || 'manual'),
            source_note: fm ? (fm.source_note || '') : (defaults.source_note || ''),
            recurrence: fm ? (fm.recurrence || '') : '',
            parentTask: fm ? String(fm.parent_task == null ? '' : fm.parent_task) : '',
        };
        state.whenKey = TaskDialog.whenKeyForDue(state.due, todayStr);

        // ----- Shared SauceModal shell (openShell); TaskDialog owns only field internals. -----
        const doc = (typeof document !== 'undefined' && document) ? document : null;
        const sauceModal = (typeof globalThis !== 'undefined' && globalThis.customJS)
            ? globalThis.customJS.SauceModal : null;
        if (!doc || !sauceModal || typeof sauceModal.open !== 'function') {
            try { new Notice('TaskDialog: SauceModal unavailable'); } catch (_e) {}
            return;
        }
        let submitTask = async () => false;
        let updateSubmit = () => {};
        let saveBtn = null;
        let addAnotherBtn = null;
        let titleInput = null;
        let detachKeys = () => {};
        const isCmdEnter = TaskDialog.isCmdEnter;
        const shell = TaskDialog.openShell({
            doc,
            title: editPath ? 'Edit task' : 'New task',
            closeReason: 'task-dialog',
            // SauceModal listens in capture phase, so only the title field may
            // use plain Enter as the dialog-level Save gesture. Nested controls
            // such as the note filter and web-link mini-form own their own Enter
            // behavior and must not race a task save before target handlers run.
            // Save / Create & add another contain label spans, so their bubbling
            // clicks are identified by currentTarget. ⌘↵ / Ctrl↵ arrive from the
            // dialog's own key listener (SauceModal never forwards a modified Enter).
            onSubmit: (_handle, event) => {
                if (!event) return false;
                if (addAnotherBtn && event.currentTarget === addAnotherBtn) return submitTask('another');
                if ((titleInput && event.target === titleInput) || (saveBtn && event.currentTarget === saveBtn)
                    || isCmdEnter(event)) return submitTask('save');
                return false;
            },
            onClose: () => { try { detachKeys(); } catch (_e) {} },
        });
        if (!shell) {
            try { new Notice('TaskDialog: could not open SauceModal'); } catch (_e) {}
            return;
        }
        const modalHandle = shell.handle;
        const closeOverlay = shell.close;
        const modalEl = shell.modal;

        const fieldCss = TaskDialog.FIELD_CSS;
        const dateCss = TaskDialog.DATE_CSS;
        const sectionLabel = TaskDialog.sectionLabel;
        const setPressed = TaskDialog.setPressed;
        const mkPill = TaskDialog.pill;

        // ----- Two columns: left = what (title / notes / links), right = when / how. -----
        const left = shell.left;
        const right = shell.right;

        // Title (large). Live shortcut parsing runs in create mode only: an
        // existing title is never rewritten by a trailing word that happens to
        // look like a token.
        titleInput = left.createEl('input', { type: 'text', cls: 'sauce-task-title' });
        titleInput.placeholder = 'Task title';
        try { titleInput.setAttribute('aria-label', 'Task title'); } catch (_e) {}
        titleInput.value = state.title;
        titleInput.oninput = () => { state.title = titleInput.value; applyShortcuts(); updateSubmit(); };
        // Autofocus the title ONLY in create mode (FIX 4) — opening the dialog on an
        // existing task shouldn't grab focus (the title is already filled in).
        if (!editPath) {
            left.createDiv({
                cls: 'sauce-task-hint',
                text: 'Shortcuts work while typing: next mon, !high, #Project. Each fills its matching field.',
            });
            setTimeout(() => titleInput.focus(), 50);
        }

        // Notes → note body (both modes). In edit mode we load the task file's
        // existing body (minus its frontmatter) just-in-time so notes/hyperlinks
        // can be added or edited on an existing task; the save path writes them
        // back into the task's OWN file only (single-file invariant intact).
        //
        // Edit mode never writes the body until the read has succeeded: until
        // then the textarea is disabled ("Loading notes…") and a save touches
        // only the frontmatter, so a slow or failed read can never blank the
        // task's existing notes.
        const notesInput = left.createEl('textarea', { cls: 'sauce-task-notes' });
        notesInput.placeholder = 'Notes';
        try { notesInput.setAttribute('aria-label', 'Notes'); } catch (_e) {}
        notesInput.value = state.notes;
        notesInput.oninput = () => { if (state.notesLoaded) state.notes = notesInput.value; };
        const setNotesState = (placeholder, disabled, busy) => {
            notesInput.placeholder = placeholder;
            notesInput.disabled = !!disabled;
            try { notesInput.setAttribute('aria-busy', busy ? 'true' : 'false'); } catch (_e) {}
        };
        if (editPath) {
            const failed = () => { state.notesLoaded = false; setNotesState('Notes could not be loaded', true, false); };
            if (editFile && app.vault && typeof app.vault.read === 'function') {
                setNotesState('Loading notes\u2026', true, true);
                let pending = null;
                try { pending = Promise.resolve(app.vault.read(editFile)); } catch (_e) { pending = null; }
                if (!pending) failed();
                else {
                    pending.then((txt) => {
                        // Load ONLY the user-notes portion (below <!-- TASK_NOTES -->), not
                        // the regenerable chrome. A legacy note with no marker falls back
                        // to the whole body (minus frontmatter) so nothing is lost.
                        if (typeof txt !== 'string') { failed(); return; }
                        const body = TaskDialog._bodyNotesBelowMarker(txt);
                        notesInput.value = body;
                        state.notes = body;
                        state.notesLoaded = true;
                        setNotesState('Notes', false, false);
                    }).catch(failed);
                }
            } else {
                failed();
            }
        }

        // ----- Structured LINKS + parent (both modes) — FIX 5 -----
        // ＋Link note / ＋Web link PUSH a markdown link STRING onto state.links
        // (via the pure _addLink), which TaskNoteView renders INSIDE the card;
        // the current links show as removable chips. Subtask of… sets
        // parent_task to `[[<open task>]]`. Only ONE inserter is open at a time.
        // Everything is guarded — a bad DOM/vault call never throws out of _render.
        let renderChips = () => {};
        try {
            const chipsBox = left.createDiv({ cls: 'sauce-task-link-chips' });
            renderChips = () => {
                chipsBox.empty();
                chipsBox.style.display = state.links.length ? '' : 'none';
                state.links.forEach((entry, i) => {
                    const chip = chipsBox.createDiv({ cls: 'sauce-task-link-chip' });
                    const txt = chip.createEl('span', { text: entry });
                    txt.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:280px;';
                    const x = chip.createEl('button', { cls: 'sauce-task-chip-x', text: '✕' });
                    x.setAttribute('aria-label', 'Remove link');
                    x.onclick = () => { state.links = TaskDialog._removeLink(state.links, i); renderChips(); };
                });
            };
            renderChips();

            const parentBox = left.createDiv({ cls: 'sauce-task-parent' });
            const renderParent = () => {
                parentBox.empty();
                const pt = String(state.parentTask || '').trim();
                parentBox.style.display = pt ? '' : 'none';
                if (!pt) return;
                parentBox.createSpan({ cls: 'sauce-task-parent-label', text: 'Subtask of ' });
                parentBox.createSpan({ text: TaskDialog._stripWikilink(pt) });
                const x = parentBox.createEl('button', { cls: 'sauce-task-chip-x', text: '✕' });
                x.setAttribute('aria-label', 'Remove parent task');
                x.onclick = () => { state.parentTask = ''; renderParent(); renderWhen(); };
            };
            renderParent();

            const linkRow = left.createDiv({ cls: 'sauce-task-quiet-row' });
            const mkQuiet = (text) => mkPill(linkRow, 'sauce-task-quiet', text);
            const noteBtn = mkQuiet('＋ Link note');
            const webBtn = mkQuiet('＋ Web link');
            const parentBtn = mkQuiet('Subtask of…');

            // A single host div below the row that holds whichever inserter is open.
            const inserterBox = left.createDiv({ cls: 'sauce-task-inserter' });
            let openKind = null;   // null | 'note' | 'web' | 'parent'
            const closeInserter = () => { inserterBox.empty(); openKind = null; };

            // Add `entry` to state.links (pure _addLink → new array), re-render the
            // chips, close the inserter. Deduped + trimmed by _addLink.
            const addLinkEntry = (entry) => {
                if (!entry) return;
                state.links = TaskDialog._addLink(state.links, entry);
                renderChips();
                closeInserter();
            };

            // Filterable list shared by the note picker and the parent picker:
            // the candidate list is built ONCE, then filtered on each keystroke
            // (order preserved: filter, then slice — no re-sort).
            const openPicker = (kind, placeholder, names, rowCls, onPick) => {
                if (openKind === kind) { closeInserter(); return; }
                closeInserter();
                openKind = kind;
                const picker = TaskDialog.filterList(inserterBox, { placeholder, names, rowCls, onPick });
                setTimeout(() => { try { picker.input.focus(); } catch (_e) {} }, 30);
            };

            // ----- Note picker (FIX 6 — sorted MOST-RECENTLY-EDITED first) -----
            const openNotePicker = () => {
                let names = [];
                try {
                    const files = (app.vault && typeof app.vault.getMarkdownFiles === 'function')
                        ? app.vault.getMarkdownFiles() : [];
                    names = TaskDialog._buildNoteLinkCandidates(files, editPath);
                } catch (_e) { names = []; }
                openPicker('note', 'Filter notes (recent first)…', names, 'sauce-task-note-option',
                    (n) => addLinkEntry(TaskDialog._wikilink(n)));
            };

            // ----- Parent picker (open top-level tasks, recent first) -----
            const openParentPicker = () => {
                openPicker('parent', 'Find a parent task…', TaskDialog._parentCandidates(app, editPath),
                    'sauce-task-parent-option', (n) => {
                        state.parentTask = TaskDialog._wikilink(n);
                        renderParent();
                        renderWhen();
                        closeInserter();
                    });
            };

            // ----- Web-link mini-form -----
            const openWebForm = () => {
                if (openKind === 'web') { closeInserter(); return; }
                closeInserter();
                openKind = 'web';
                const urlInput = inserterBox.createEl('input', { type: 'url' });
                urlInput.placeholder = 'https://…';
                urlInput.style.cssText = fieldCss;
                const labelInput = inserterBox.createEl('input', { type: 'text' });
                labelInput.placeholder = 'Link text (optional)';
                labelInput.style.cssText = fieldCss + ' margin-top:6px;';
                const insertBtn = mkPill(inserterBox, 'sauce-task-quiet', 'Add link');
                insertBtn.style.marginTop = '8px';
                const doInsert = () => {
                    const ins = TaskDialog._mdLink(labelInput.value, urlInput.value);
                    if (!ins) { try { new Notice('Enter a URL first'); } catch (_e) {} return; }
                    addLinkEntry(ins);
                };
                insertBtn.onclick = doInsert;
                // Enter in either field adds.
                const onKey = (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); doInsert(); } };
                urlInput.addEventListener('keydown', onKey);
                labelInput.addEventListener('keydown', onKey);
                setTimeout(() => { try { urlInput.focus(); } catch (_e) {} }, 30);
            };

            noteBtn.onclick = openNotePicker;
            webBtn.onclick = openWebForm;
            parentBtn.onclick = openParentPicker;
        } catch (_e) { /* link chips are best-effort; never abort the render */ }

        // ----- Right column: When -----
        const whenSec = right.createDiv({ cls: 'sauce-task-section' });
        sectionLabel(whenSec, 'When');
        const whenRow = whenSec.createDiv({ cls: 'sauce-task-pill-row' });
        const whenOpts = TaskDialog.whenOptions(todayStr);
        const whenBtns = whenOpts.map((o) => {
            const b = mkPill(whenRow, 'sauce-task-pill sauce-task-when', o.label);
            b.setAttribute('data-key', o.key);
            b.onclick = () => setWhen(o.key);
            return { el: b, key: o.key };
        });
        const whenDate = whenSec.createEl('input', { type: 'date', cls: 'sauce-task-when-date' });
        whenDate.style.cssText = dateCss + ' margin-top:8px;';
        whenDate.onchange = () => { state.due = whenDate.value || ''; state.whenKey = 'pick'; renderWhen(); updateSubmit(); };
        whenDate.oninput = whenDate.onchange;
        const whenCaption = whenSec.createDiv({ cls: 'sauce-task-caption sauce-task-when-caption' });
        const renderWhen = () => {
            for (const w of whenBtns) setPressed(w.el, 'sauce-task-pill sauce-task-when', w.key === state.whenKey);
            whenDate.style.display = state.whenKey === 'pick' ? '' : 'none';
            if (state.whenKey === 'pick' && whenDate.value !== (state.due || '')) whenDate.value = state.due || '';
            whenCaption.textContent = TaskDialog.whenCaption(state.whenKey, state.due, TaskDialog._ownedForCaption(state));
        };
        // Pick keeps the current date and reveals the native input to change it.
        const setWhen = (key) => {
            state.whenKey = key;
            if (key !== 'pick') {
                const o = whenOpts.find((x) => x.key === key);
                state.due = (o && o.due) || '';
            }
            renderWhen();
            updateSubmit();
            if (key === 'pick') setTimeout(() => { try { whenDate.focus(); } catch (_e) {} }, 0);
        };
        const setDue = (due) => {
            state.due = due || '';
            state.whenKey = TaskDialog.whenKeyForDue(state.due, todayStr);
            renderWhen();
            updateSubmit();
        };
        renderWhen();

        // ----- Right column: Priority (keys 0–4 when focus is outside a text field) -----
        const prioSec = right.createDiv({ cls: 'sauce-task-section' });
        sectionLabel(prioSec, 'Priority');
        const prioRow = prioSec.createDiv({ cls: 'sauce-task-pill-row' });
        const PRIOS = [
            { v: '', l: 'None' }, { v: 'low', l: 'Low' }, { v: 'medium', l: 'Medium' },
            { v: 'high', l: 'High' }, { v: 'highest', l: 'Highest' },
        ];
        const prioBtns = PRIOS.map((p, i) => {
            const b = prioRow.createEl('button', { cls: 'sauce-task-pill sauce-task-prio' });
            try { b.setAttribute('type', 'button'); } catch (_e) {}
            b.setAttribute('data-prio', p.v || 'none');
            b.setAttribute('title', p.l + ' (' + i + ')');
            b.createSpan({ cls: 'sauce-task-prio-swatch' });
            b.createSpan({ text: p.l });
            b.onclick = () => setPriority(p.v);
            return { el: b, v: p.v };
        });
        const renderPrio = () => {
            for (const p of prioBtns) setPressed(p.el, 'sauce-task-pill sauce-task-prio', p.v === (state.priority || ''));
        };
        const setPriority = (v) => { state.priority = v || ''; renderPrio(); };
        renderPrio();

        // ----- Right column: Project (recent chips + type-to-filter) -----
        // Enumerated dependency-free via metadataCache (no `dv` in a
        // button-invoked dialog). A seeded/edited project that is not among the
        // recent chips is shown as its own selected chip, so it is never hidden.
        let recentNames = [];
        try { recentNames = TaskDialog.recentProjects(TaskDialog._recentTaskRows(app, todayStr), todayStr, 6); }
        catch (_e) { recentNames = []; }
        const projField = TaskDialog.projectField(right, {
            app,
            recentNames,
            value: state.projectName,
            onChange: (name) => { state.projectName = name; renderWhen(); },
        });
        const shortcutProjectNames = Array.from(new Set(projField.projectNames.concat(recentNames)));
        const setProject = projField.set;

        // ----- Right column: Repeats — one button that expands in place -----
        // The structured picker composes the SAME RecurrenceParser grammar the
        // backend already understands (TaskEntity.nextOccurrence, _markDone's
        // roll-forward). state.recurrence stays the source of truth written to
        // frontmatter; state.recurrenceFreq/Days/Weeks/DayOfMonth are picker-only
        // UI state, recomposed on every change.
        const repSec = right.createDiv({ cls: 'sauce-task-section' });
        sectionLabel(repSec, 'Repeats');
        const repToggle = mkPill(repSec, 'sauce-task-pill sauce-task-repeat-toggle', '');
        const repBox = repSec.createDiv({ cls: 'sauce-task-repeat-box' });
        {
            const described = (() => {
                try {
                    const RP = window.customJS && window.customJS.RecurrenceParser;
                    return RP && typeof RP.describe === 'function' ? RP.describe(state.recurrence) : null;
                } catch (_e) { return null; }
            })();
            const initial = TaskDialog._recurrenceStateFromDescribe(described);
            state.recurrenceFreq = initial.freq;
            state.recurrenceDays = initial.days;
            state.recurrenceWeeks = initial.weeks;
            state.recurrenceDayOfMonth = initial.dayOfMonth;
        }
        // Notes and links are always visible now, so only an existing
        // recurrence decides whether Repeats starts open.
        let repExpanded = TaskDialog._moreOptionsShouldStartExpanded({ recurrence: state.recurrence });
        const renderRepeatToggle = () => {
            const r = String(state.recurrence || '').trim();
            const text = r ? r.charAt(0).toUpperCase() + r.slice(1) : "Doesn't repeat";
            repToggle.textContent = text + (repExpanded ? ' ▴' : ' ▾');
            repToggle.setAttribute('aria-expanded', repExpanded ? 'true' : 'false');
            repBox.style.display = repExpanded ? '' : 'none';
        };
        repToggle.onclick = () => { repExpanded = !repExpanded; renderRepeatToggle(); };

        const recurSelect = repBox.createEl('select');
        recurSelect.style.cssText = fieldCss;
        const RECUR_OPTIONS = [
            { value: 'none', text: "Doesn't repeat" },
            { value: 'daily', text: 'Every day' },
            { value: 'weekly', text: 'Weekly' },
            { value: 'weekday', text: 'Every weekday' },
            { value: 'monthly', text: 'Monthly' },
        ];
        for (const ro of RECUR_OPTIONS) {
            const opt = recurSelect.createEl('option', { text: ro.text });
            opt.value = ro.value;
            if (ro.value === state.recurrenceFreq) opt.selected = true;
        }

        const recurSubBox = repBox.createDiv();
        recurSubBox.style.cssText = 'margin-top:8px;';
        const recurError = repBox.createEl('div');
        recurError.style.cssText = 'font-size:11px; color:var(--text-error,#e05561); margin-top:4px; display:none;';

        const recomposeRecurrence = () => {
            state.recurrence = TaskDialog._composeRecurrenceGrammar(state.recurrenceFreq, {
                days: state.recurrenceDays,
                weeks: state.recurrenceWeeks,
                dayOfMonth: state.recurrenceDayOfMonth,
            });
            const valid = TaskDialog._recurrencePickerValid(state);
            recurError.style.display = valid ? 'none' : 'block';
            recurError.textContent = valid ? '' : 'Pick at least one day for a weekly repeat.';
            renderRepeatToggle();
            updateSubmit();
        };

        const dayChipCss = 'flex:0 0 34px; box-sizing:border-box; text-align:center; padding:6px 0; border-radius:var(--radius-s,6px); font-size:12px; line-height:1; cursor:pointer; transition:background 120ms ease, color 120ms ease, border-color 120ms ease;';
        const dayChipOff = dayChipCss + ' border:1px solid var(--background-modifier-border,#444); background:transparent; color:var(--text-muted,#999);';
        const dayChipOn = dayChipCss + ' border:1px solid var(--interactive-accent,#6a6abf); background:var(--interactive-accent,#6a6abf); color:var(--text-on-accent,#fff); font-weight:600;';
        const DOW_LABELS = [
            { n: 0, l: 'S' }, { n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' },
            { n: 4, l: 'T' }, { n: 5, l: 'F' }, { n: 6, l: 'S' },
        ];
        const smallNumCss = 'box-sizing:border-box; padding:5px 6px; background:var(--background-primary,#1e1e1e); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:12px;';
        const mutedCss = 'font-size:12px; color:var(--text-muted,#999);';

        const renderRecurSubBox = () => {
            recurSubBox.empty();
            if (state.recurrenceFreq === 'weekly') {
                const dayRow = recurSubBox.createDiv();
                dayRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
                for (const d of DOW_LABELS) {
                    const on = state.recurrenceDays.indexOf(d.n) >= 0;
                    const btn = dayRow.createEl('div', { text: d.l });
                    btn.style.cssText = on ? dayChipOn : dayChipOff;
                    btn.onclick = () => {
                        const idx = state.recurrenceDays.indexOf(d.n);
                        if (idx >= 0) state.recurrenceDays.splice(idx, 1);
                        else state.recurrenceDays.push(d.n);
                        renderRecurSubBox();
                        recomposeRecurrence();
                    };
                }
                const weeksRow = recurSubBox.createDiv();
                weeksRow.style.cssText = 'display:flex; align-items:center; gap:8px; margin-top:8px;';
                weeksRow.createEl('span', { text: 'Every' }).style.cssText = mutedCss;
                const weeksInput = weeksRow.createEl('input', { type: 'number' });
                weeksInput.style.cssText = 'width:52px; ' + smallNumCss;
                weeksInput.min = '1';
                weeksInput.max = '12';
                weeksInput.value = String(state.recurrenceWeeks || 1);
                weeksInput.onchange = () => {
                    const n = parseInt(weeksInput.value, 10);
                    state.recurrenceWeeks = Number.isInteger(n) && n >= 1 && n <= 12 ? n : 1;
                    weeksInput.value = String(state.recurrenceWeeks);
                    recomposeRecurrence();
                };
                weeksRow.createEl('span', { text: 'week(s)' }).style.cssText = mutedCss;
            } else if (state.recurrenceFreq === 'monthly') {
                const domRow = recurSubBox.createDiv();
                domRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
                domRow.createEl('span', { text: 'On day' }).style.cssText = mutedCss;
                const domInput = domRow.createEl('input', { type: 'number' });
                domInput.style.cssText = 'width:60px; ' + smallNumCss;
                domInput.min = '1';
                domInput.max = '31';
                if (state.recurrenceDayOfMonth) domInput.value = String(state.recurrenceDayOfMonth);
                domInput.onchange = () => {
                    const n = parseInt(domInput.value, 10);
                    state.recurrenceDayOfMonth = (Number.isInteger(n) && n >= 1 && n <= 31) ? n : null;
                    recomposeRecurrence();
                };
                domRow.createEl('span', { text: 'of the month' }).style.cssText = mutedCss;
            }
        };
        renderRecurSubBox();
        renderRepeatToggle();

        recurSelect.onchange = () => {
            const opt = recurSelect.options[recurSelect.selectedIndex];
            state.recurrenceFreq = (opt && opt.value) || 'none';
            renderRecurSubBox();
            recomposeRecurrence();
        };

        // ----- Title shortcuts (create mode) -----
        // Each input event re-parses the title. A token that appears (or
        // changes) sets its field; a later explicit click wins until the token
        // itself changes; a token that disappears restores the field's prior
        // value unless the user has changed it since. The stripped title is
        // what gets saved.
        const parseShortcuts = () => {
            if (editPath) return null;
            const TE = TaskDialog._taskEntity();
            if (!TE || typeof TE.parseTitleShortcuts !== 'function') return null;
            try { return TE.parseTitleShortcuts(state.title, todayStr, shortcutProjectNames); } catch (_e) { return null; }
        };
        const SHORTCUT_FIELDS = {
            due: { get: () => state.due || '', set: setDue },
            priority: { get: () => state.priority || '', set: setPriority },
            project: { get: () => state.projectName || '', set: setProject },
        };
        let shortcutApplied = { due: null, priority: null, project: null };
        const applyShortcuts = () => {
            const parsed = parseShortcuts();
            if (!parsed) return;
            for (const field of Object.keys(SHORTCUT_FIELDS)) {
                const acc = SHORTCUT_FIELDS[field];
                const tok = parsed[field];
                const rec = shortcutApplied[field];
                if (tok != null && tok !== '') {
                    if (rec && rec.value === tok) continue;
                    const prev = rec ? rec.prev : acc.get();
                    acc.set(tok);
                    shortcutApplied[field] = { value: tok, prev };
                } else if (rec) {
                    if (acc.get() === rec.value) acc.set(rec.prev);
                    shortcutApplied[field] = null;
                }
            }
        };
        const effectiveTitle = () => {
            const parsed = parseShortcuts();
            return parsed && typeof parsed.title === 'string' ? parsed.title : state.title;
        };

        // ----- Footer (outside the scrolling body) -----
        // Left: create → "Open the note after creating"; edit → Open / Done /
        // Delete as quiet actions. Right: Create & add another (create only)
        // and the primary Create task / Save with its ⌘↵ hint.
        const footer = modalHandle.footer;
        const leftGroup = footer.createDiv({ cls: 'sauce-task-footer-left' });
        const rightGroup = footer.createDiv({ cls: 'sauce-task-footer-right' });

        // Icons: crisp inline Lucide SVGs at 16px, currentColor so they theme with
        // the button's text (matches ToDoLeafActions' icon convention).
        const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
        const ICON = {
            check: svg('<polyline points="20 6 9 17 4 12"/>'),
            trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
            open: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
        };

        const mkBtn = TaskDialog.actionButton;

        let openAfterCb = null;
        if (editPath) {
            // Open note + Done + Delete (edit mode only) sit on the LEFT as quiet actions.
            const openBtn = mkBtn(leftGroup, { label: 'Open', icon: ICON.open, variant: 'ghost' });
            openBtn.onclick = async () => {
                try {
                    if (app.workspace && typeof app.workspace.getLeaf === 'function' && editFile) {
                        await app.workspace.getLeaf(false).openFile(editFile);
                    } else if (app.workspace && typeof app.workspace.openLinkText === 'function') {
                        await app.workspace.openLinkText(editPath, '', false);
                    }
                    closeOverlay();
                } catch (e) { try { new Notice('Could not open note: ' + (e && (e.message || e)), 6000); } catch (_e) {} }
            };
            const doneBtn = mkBtn(leftGroup, { label: 'Done', icon: ICON.check, variant: 'ghost' });
            doneBtn.onclick = async () => {
                try {
                    const res = await this._markDone(app, editFile);
                    if (res && res.ok === false) {
                        if (res.reason !== 'cancelled') { try { new Notice('Done failed: ' + res.reason, 6000); } catch (_e) {} }
                        return;
                    }
                    closeOverlay();
                }
                catch (e) { try { new Notice('Done failed: ' + (e.message || e), 6000); } catch (_e) {} }
            };
            const delBtn = mkBtn(leftGroup, { label: 'Delete', icon: ICON.trash, variant: 'danger' });
            delBtn.onclick = async () => {
                try {
                    const res = await this._markDeleted(app, editFile);
                    if (res && res.ok === false) { try { new Notice('Delete failed: ' + res.reason, 6000); } catch (_e) {} return; }
                    closeOverlay();
                }
                catch (e) { try { new Notice('Delete failed: ' + (e.message || e), 6000); } catch (_e) {} }
            };
        } else {
            const lab = leftGroup.createEl('label', { cls: 'sauce-task-open-after-label' });
            openAfterCb = lab.createEl('input', { type: 'checkbox', cls: 'sauce-task-open-after' });
            openAfterCb.checked = TaskDialog._readOpenAfterPref();
            lab.createSpan({ text: 'Open the note after creating' });
            openAfterCb.onchange = () => TaskDialog._writeOpenAfterPref(!!openAfterCb.checked);
        }

        const kbd = TaskDialog._submitKeyHint(app);
        if (!editPath) {
            addAnotherBtn = mkBtn(rightGroup, { label: 'Create & add another', variant: 'ghost', cls: 'sauce-task-add-another' });
            addAnotherBtn.onclick = (event) => modalHandle.submit(event);
        }
        saveBtn = mkBtn(rightGroup, { label: editPath ? 'Save' : 'Create task', kbd, variant: 'accent', cls: 'sauce-task-save' });
        saveBtn.classList.add('mod-cta');
        saveBtn.onclick = (event) => modalHandle.submit(event);

        const buildPayload = () => this._payloadFromState(Object.assign({}, state, { title: effectiveTitle() }));
        updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const p = buildPayload();
            const v = TE ? TE.validatePayload(p) : { valid: !!(p.title && String(p.title).trim()) };
            const valid = v.valid && TaskDialog._recurrencePickerValid(state);
            saveBtn.disabled = !valid;
            if (addAnotherBtn) addAnotherBtn.disabled = !valid;
        };
        // Create & add another keeps When / Priority / Project / Repeats / parent
        // and starts the next task from a blank title, notes and links.
        const resetForAnother = () => {
            state.title = '';
            titleInput.value = '';
            state.notes = '';
            notesInput.value = '';
            state.links = [];
            renderChips();
            shortcutApplied = { due: null, priority: null, project: null };
            updateSubmit();
            setTimeout(() => { try { titleInput.focus(); } catch (_e) {} }, 0);
        };
        submitTask = async (mode) => {
            if (saveBtn.disabled) return false;
            try {
                if (editPath) {
                    const saved = await this._saveEdit(app, editFile, buildPayload(), state.notesLoaded ? state.notes : null);
                    if (saved && saved.ok === false) return false;
                    closeOverlay();
                    return true;
                }
                const res = await this._create(app, buildPayload(), state.notes);
                // _create resolves without a result when it bails (TaskEntity
                // missing, payload rejected): keep the dialog and its contents.
                if (!res || !res.ok) return false;
                if (mode === 'another') { resetForAnother(); return true; }
                closeOverlay();
                if (openAfterCb && openAfterCb.checked && res && (res.file || res.path)) await this._openCreated(app, res);
                return true;
            } catch (e) {
                try { new Notice('Save failed: ' + (e.message || e), 6000); } catch (_e) {}
                return false;
            }
        };

        // Dialog-level keys: ⌘↵ / Ctrl↵ submit from anywhere in the dialog
        // (textarea included); 0–4 set priority when focus is not in a text
        // field. Capture phase, detached when the modal closes.
        const PRIO_KEYS = { '0': '', '1': 'low', '2': 'medium', '3': 'high', '4': 'highest' };
        const isTextTarget = (t) => {
            if (!t) return false;
            if (t.isContentEditable) return true;
            const tag = String(t.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || tag === 'select';
        };
        const inDialog = (t) => !t || t === doc.body
            || (modalEl && typeof modalEl.contains === 'function' && modalEl.contains(t));
        const onKey = (ev) => {
            try {
                if (!ev || !modalHandle.isOpen) return;
                if (isCmdEnter(ev)) {
                    if (!inDialog(ev.target)) return;
                    if (ev.preventDefault) ev.preventDefault();
                    modalHandle.submit(ev);
                    return;
                }
                if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
                if (!Object.prototype.hasOwnProperty.call(PRIO_KEYS, ev.key)) return;
                if (isTextTarget(ev.target) || !inDialog(ev.target)) return;
                if (ev.preventDefault) ev.preventDefault();
                setPriority(PRIO_KEYS[ev.key]);
            } catch (_e) { /* a key handler must never throw */ }
        };
        try {
            if (typeof doc.addEventListener === 'function') {
                doc.addEventListener('keydown', onKey, true);
                detachKeys = () => { if (typeof doc.removeEventListener === 'function') doc.removeEventListener('keydown', onKey, true); };
            }
        } catch (_e) {}

        updateSubmit();
    }

    // ---------- Shared dialog parts ----------
    //
    // The pieces TaskDialog is built from, as statics so other dialogs (the
    // New meeting dialog, Edit attendees, EntityCreate's people prompt) build
    // the same markup with the same classes and _DIALOG_CSS styles them all.
    // Each part never throws out of a render.

    /**
     * Open the shared dialog shell on SauceModal: the `sauce-task-dialog`
     * class (so _DIALOG_CSS applies), the header ✕, and either the two
     * columns (`left` / `right`) or, with `columns: false`, one column
     * (`left` only, modal gets `sauce-task-dialog-single`). `cls` adds the
     * caller's own class. Returns null when SauceModal or a document is
     * missing, so the caller can fall back.
     *   → { handle, modal, body, footer, left, right, close, doc }
     */
    static openShell(opts) {
        const o = opts || {};
        const doc = o.doc || ((typeof document !== 'undefined' && document) ? document : null);
        const sauceModal = (typeof globalThis !== 'undefined' && globalThis.customJS)
            ? globalThis.customJS.SauceModal : null;
        if (!doc || !sauceModal || typeof sauceModal.open !== 'function') return null;
        let handle = null;
        try {
            handle = sauceModal.open({
                doc,
                title: o.title,
                buttons: [],
                onSubmit: o.onSubmit,
                closeOnSubmit: false,
                onClose: o.onClose,
            });
        } catch (_e) { handle = null; }
        if (!handle) return null;
        const modal = handle.modal || null;
        const host = handle.body;
        const close = () => handle.close(o.closeReason || 'dialog');
        TaskDialog._injectDialogCss(doc);
        try {
            if (modal && modal.classList) {
                modal.classList.add('sauce-task-dialog');
                if (o.columns === false) modal.classList.add('sauce-task-dialog-single');
                for (const c of String(o.cls || '').split(/\s+/)) if (c) modal.classList.add(c);
            }
        } catch (_e) {}
        try {
            if (modal && typeof doc.createElement === 'function') {
                const closeX = doc.createElement('button');
                closeX.className = 'sauce-task-dialog-close';
                closeX.textContent = '✕';
                closeX.setAttribute('type', 'button');
                closeX.setAttribute('aria-label', 'Close');
                closeX.onclick = () => close();
                // Before the body so it follows the heading in DOM and tab order.
                if (host && typeof modal.insertBefore === 'function') modal.insertBefore(closeX, host);
                else modal.appendChild(closeX);
            }
        } catch (_e) { /* the header close is a convenience; Escape still closes */ }
        let left = null;
        let right = null;
        if (o.columns === false) {
            left = host.createDiv({ cls: 'sauce-task-dialog-left' });
        } else {
            const cols = host.createDiv({ cls: 'sauce-task-dialog-cols' });
            left = cols.createDiv({ cls: 'sauce-task-dialog-left' });
            right = cols.createDiv({ cls: 'sauce-task-dialog-right' });
        }
        return { handle, modal, body: host, footer: handle.footer, left, right, close, doc };
    }

    /** Inline style for a text field inside the dialog (theme variables only). */
    static get FIELD_CSS() {
        return 'width:100%; min-width:0; box-sizing:border-box; padding:7px 10px; background:var(--background-primary,#1e1e1e); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:13px; line-height:1.4;';
    }

    /**
     * Inline style for a native date / datetime-local input. iOS gives it an
     * intrinsic min-width that ignores width:100%; `appearance: none` strips
     * that sizing (the native picker still opens on tap) so it fits the column.
     */
    static get DATE_CSS() {
        return TaskDialog.FIELD_CSS + ' -webkit-appearance:none; appearance:none; max-width:100%; text-align:left;';
    }

    /** Uppercase section heading (When, Priority, Project, Attendees…). */
    static sectionLabel(parent, text) {
        return parent.createDiv({ cls: 'sauce-task-section-label', text });
    }

    /** Selection state for a pill: class + aria-pressed together. */
    static setPressed(el, base, on) {
        el.className = base + (on ? ' is-selected' : '');
        try { el.setAttribute('aria-pressed', on ? 'true' : 'false'); } catch (_e) {}
    }

    /** A type="button" pill or quiet button with class `base`. */
    static pill(parent, base, text) {
        const b = parent.createEl('button', { cls: base, text });
        try { b.setAttribute('type', 'button'); } catch (_e) {}
        return b;
    }

    /**
     * A footer button. Sauce-core owns button geometry, state, focus and tone;
     * `variant` is ghost (default) / accent / danger, `kbd` adds the shortcut
     * hint (hidden on a phone).
     */
    static actionButton(parent, o) {
        const variant = o.variant || 'ghost';
        const cls = 'sauce-btn'
            + (variant === 'accent' ? ' sauce-btn-accent' : '')
            + (variant === 'danger' ? ' sauce-btn-danger' : '')
            + (o.cls ? ' ' + o.cls : '');
        const b = parent.createEl('button', { cls });
        try { b.setAttribute('type', 'button'); } catch (_e) {}
        if (o.icon) { const ic = b.createSpan(); ic.style.cssText = 'display:inline-flex; align-items:center;'; ic.innerHTML = o.icon; }
        if (o.label) b.createSpan({ text: o.label });
        if (o.kbd) b.createSpan({ cls: 'sauce-task-kbd', text: o.kbd });
        return b;
    }

    /** ⌘↵ / Ctrl↵ (not mid-IME-composition). */
    static isCmdEnter(event) {
        return !!(event && event.key === 'Enter' && !event.isComposing && (event.metaKey || event.ctrlKey));
    }

    /**
     * A filter field over a fixed list of names with a scrolling result list
     * (at most 30 rows, list order kept). Clicking a row calls onPick(name).
     *   → { input, results, render }
     */
    static filterList(host, opts) {
        const o = opts || {};
        const names = Array.isArray(o.names) ? o.names : [];
        const input = host.createEl('input', { type: 'text' });
        input.placeholder = o.placeholder || '';
        input.style.cssText = TaskDialog.FIELD_CSS;
        const results = host.createDiv({ cls: 'sauce-task-picker-results' });
        const render = () => {
            results.empty();
            const q = (input.value || '').trim().toLowerCase();
            const hits = (q ? names.filter((n) => n.toLowerCase().indexOf(q) >= 0) : names).slice(0, 30);
            if (!hits.length) {
                results.createDiv({ cls: 'sauce-task-picker-empty', text: q ? 'No matches' : 'Nothing to pick' });
                return;
            }
            for (const n of hits) {
                const row = results.createDiv({ cls: 'sauce-task-picker-row ' + (o.rowCls || ''), text: n });
                row.onclick = () => { if (typeof o.onPick === 'function') o.onPick(n); };
            }
        };
        input.oninput = render;
        render();
        return { input, results, render };
    }

    /**
     * The Project section: a search field, a row of project chips (the
     * `recentNames` when the search is empty, the current project first if it
     * is not among them; matches while typing) and a caption. Clicking the
     * selected chip clears it; Enter in the search picks the first match.
     * Projects come from _loadProjectList(app) unless `projectNames` is given.
     * onChange(name) runs after every change ('' = no project).
     *   → { set(name), get(), projectNames, search }
     */
    static projectField(parent, opts) {
        const o = opts || {};
        const projectNames = Array.isArray(o.projectNames) ? o.projectNames
            : TaskDialog._loadProjectList(o.app).map((p) => p.name);
        const recentNames = Array.isArray(o.recentNames) ? o.recentNames : [];
        let value = String(o.value || '');
        const sec = parent.createDiv({ cls: 'sauce-task-section' });
        TaskDialog.sectionLabel(sec, o.label || 'Project');
        const search = sec.createEl('input', { type: 'text', cls: 'sauce-task-project-search' });
        search.placeholder = 'Search projects…';
        try { search.setAttribute('aria-label', 'Search projects'); } catch (_e) {}
        search.style.cssText = TaskDialog.FIELD_CSS;
        const chips = sec.createDiv({ cls: 'sauce-task-pill-row sauce-task-project-chips' });
        const caption = sec.createDiv({ cls: 'sauce-task-caption' });
        let hits = [];
        const CHIP = 'sauce-task-pill sauce-task-project-chip';
        const render = () => {
            chips.empty();
            const q = (search.value || '').trim();
            const cur = value.trim();
            let text;
            if (q) {
                hits = TaskDialog.projectMatches(projectNames, q, 8);
                text = hits.length ? '' : 'No matching projects';
            } else {
                hits = recentNames.slice();
                if (cur && hits.indexOf(cur) < 0) hits.unshift(cur);
                text = recentNames.length ? 'Your most-used projects, most recent first'
                    : (projectNames.length ? 'Type to search your projects' : 'No projects yet');
            }
            for (const n of hits) {
                const c = TaskDialog.pill(chips, CHIP, n);
                TaskDialog.setPressed(c, CHIP, n === cur);
                c.onclick = () => set(value === n ? '' : n);
            }
            caption.textContent = text;
            caption.style.display = text ? '' : 'none';
        };
        const set = (name) => {
            value = String(name || '');
            search.value = '';
            render();
            if (typeof o.onChange === 'function') { try { o.onChange(value); } catch (_e) {} }
        };
        search.oninput = render;
        // Enter in the search picks the first match instead of submitting
        // (SauceModal only treats Enter in the title as submit).
        search.addEventListener('keydown', (ev) => {
            if (ev && ev.key === 'Enter' && !ev.isComposing && !ev.metaKey && !ev.ctrlKey
                && (search.value || '').trim() && hits.length) {
                if (ev.preventDefault) ev.preventDefault();
                set(hits[0]);
            }
        });
        render();
        return { set, get: () => value, projectNames, search };
    }

    /** Today as YYYY-MM-DD: the caller's value, else moment(), else the local date. */
    static _todayStr(given) {
        if (given) return String(given);
        try {
            if (typeof window !== 'undefined' && window.moment) return window.moment().format('YYYY-MM-DD');
        } catch (_e) { /* fall through */ }
        const d = new Date();
        const p = (x) => String(x).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    /** "⌘↵" on Apple platforms, "Ctrl↵" elsewhere, "" on mobile (no hardware keyboard to hint at). */
    static _submitKeyHint(app) {
        try {
            if (app && app.isMobile) return '';
            if (typeof Platform !== 'undefined' && Platform && Platform.isMobile) return '';
        } catch (_e) { /* fall through to the desktop hint */ }
        try {
            const nav = typeof navigator !== 'undefined' ? navigator : null;
            const plat = String((nav && (nav.platform || nav.userAgent)) || '');
            return /Mac|iPhone|iPad|iPod/i.test(plat) ? '⌘↵' : 'Ctrl↵';
        } catch (_e) { return 'Ctrl↵'; }
    }

    /** Project names containing `query` (case-insensitive), list order kept, at most `limit` (default 8). */
    static projectMatches(names, query, limit) {
        const q = String(query == null ? '' : query).trim().toLowerCase();
        if (!q || !Array.isArray(names)) return [];
        const max = limit == null ? 8 : limit;
        return names.filter((n) => String(n).toLowerCase().indexOf(q) >= 0).slice(0, max);
    }

    /**
     * `{ project, created_at }` rows for recentProjects: task notes under
     * spice/tasks/ (any status, `type: task`, not _trash/) whose file was created within 45
     * days of todayStr, read from metadataCache (no Dataview in a
     * button-invoked dialog). Empty on any failure.
     */
    static _recentTaskRows(app, todayStr) {
        try {
            const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(todayStr == null ? '' : todayStr));
            if (!m || !app || !app.vault || typeof app.vault.getMarkdownFiles !== 'function') return [];
            const cutoff = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 45 * 86400000;
            const out = [];
            for (const f of app.vault.getMarkdownFiles() || []) {
                try {
                    const fp = String((f && f.path) || '');
                    if (fp.indexOf('spice/tasks/') !== 0 || fp.indexOf('spice/tasks/_trash/') === 0) continue;
                    const ctime = Number(f.stat && f.stat.ctime);
                    if (!(ctime >= cutoff)) continue;
                    const cache = app.metadataCache.getFileCache(f);
                    const fmx = cache && cache.frontmatter;
                    if (!fmx || fmx.type !== 'task') continue;
                    out.push({ project: fmx.project, created_at: fmx.created_at });
                } catch (_e) { /* skip one unreadable file */ }
            }
            return out;
        } catch (_e) {
            return [];
        }
    }

    /** Basename a parent_task value points at: `[[X]]`, `[[path/X|alias]]`, a Link, or plain text. */
    static _linkBasename(v) {
        return TaskDialog._projectDisplay(v).replace(/^.*\//, '').replace(/\.md$/i, '').trim();
    }

    /**
     * Basenames of open task notes at any depth under spice/tasks (not
     * _done/ or _trash/), most recently modified first — the Subtask of…
     * picker's candidates. When editing, the task itself, everything inside
     * its folder and (for flat legacy notes) every task whose parent_task
     * chain reaches it are excluded, so a pick can never make a cycle (the
     * walk is loop-guarded). Empty on any failure.
     */
    static _parentCandidates(app, editPath) {
        try {
            const PREFIX = 'spice/tasks/';
            const parentOf = new Map();
            const cand = [];
            for (const f of app.vault.getMarkdownFiles() || []) {
                const p = String((f && f.path) || '');
                if (p.indexOf(PREFIX) !== 0) continue;
                const cache = app.metadataCache.getFileCache(f);
                const fmx = cache && cache.frontmatter;
                if (!fmx || fmx.type !== 'task') continue;
                const name = String(f.basename || '');
                const parent = TaskDialog._linkBasename(fmx.parent_task);
                if (name && parent && !parentOf.has(name)) parentOf.set(name, parent);
                const rest = p.slice(PREFIX.length);
                if (rest.indexOf('_done/') === 0 || rest.indexOf('_trash/') === 0) continue;
                if (fmx.status && fmx.status !== 'open') continue;
                cand.push({ name, path: p, mtime: (f.stat && Number(f.stat.mtime)) || 0 });
            }
            const self = editPath ? String(editPath).replace(/^.*\//, '').replace(/\.md$/i, '') : '';
            const TE = TaskDialog._taskEntity();
            const ownTree = editPath && TE && TE.isFolderNote(String(editPath))
                ? TE.taskFolderOf(String(editPath)) + '/' : '';
            const reachesSelf = (name) => {
                const seen = new Set();
                let cur = name;
                while (cur && !seen.has(cur)) {
                    if (cur === self) return true;
                    seen.add(cur);
                    cur = parentOf.get(cur) || '';
                }
                return false;
            };
            cand.sort((a, b) => (b.mtime - a.mtime) || a.name.localeCompare(b.name));
            return cand
                .filter((c) => c.name && !(editPath && (c.path === editPath
                    || (ownTree && c.path.indexOf(ownTree) === 0) || reachesSelf(c.name))))
                .map((c) => c.name);
        } catch (_e) {
            return [];
        }
    }

    /** localStorage key for the per-device "open the note after creating" preference. */
    static get OPEN_AFTER_KEY() { return 'sauce-task-dialog:open-after'; }

    /** Per-device preference, default on ('1'); any storage failure reads as on. */
    static _readOpenAfterPref() {
        try {
            const ls = (typeof window !== 'undefined' && window.localStorage) || null;
            const v = ls ? ls.getItem(TaskDialog.OPEN_AFTER_KEY) : null;
            return v == null ? true : String(v) !== '0';
        } catch (_e) {
            return true;
        }
    }

    static _writeOpenAfterPref(on) {
        try {
            const ls = (typeof window !== 'undefined' && window.localStorage) || null;
            if (ls) ls.setItem(TaskDialog.OPEN_AFTER_KEY, on ? '1' : '0');
        } catch (_e) { /* private window / blocked storage: keep the in-dialog state only */ }
    }

    /** Open a just-created task note (`{ file?, path }` from _create). Never throws. */
    async _openCreated(app, res) {
        try {
            const file = (res && res.file) || (app.vault && typeof app.vault.getAbstractFileByPath === 'function'
                ? app.vault.getAbstractFileByPath(res.path) : null);
            if (file && app.workspace && typeof app.workspace.getLeaf === 'function') {
                await app.workspace.getLeaf(false).openFile(file);
            } else if (res && res.path && app.workspace && typeof app.workspace.openLinkText === 'function') {
                await app.workspace.openLinkText(res.path, '', false);
            }
        } catch (_e) { /* the task is saved; opening it is best-effort */ }
    }

    /** Inject (or refresh) the dialog stylesheet once per document head. */
    static _injectDialogCss(doc) {
        try {
            const head = doc && doc.head;
            if (!head || typeof doc.createElement !== 'function') return;
            const ID = 'sauce-task-dialog-css';
            let el = Array.from(head.children || []).find((c) => c && c.id === ID) || null;
            if (!el) {
                el = doc.createElement('style');
                el.id = ID;
                head.appendChild(el);
            }
            if (el.textContent !== TaskDialog._DIALOG_CSS) el.textContent = TaskDialog._DIALOG_CSS;
        } catch (_e) { /* unstyled is still usable */ }
    }

    /**
     * Two-column dialog stylesheet. Columns ≥ 720px, stacked below; the body
     * scrolls inside the modal while the header and footer stay put. Obsidian
     * CSS variables only, so it follows the active theme.
     */
    static get _DIALOG_CSS() {
        return [
            '.sauce-modal.sauce-task-dialog { position: relative; width: min(100%, 900px); max-height: min(92vh, 720px); padding: 0; display: flex; flex-direction: column; overflow: hidden; }',
            '.sauce-task-dialog > .sauce-modal-title { margin: 0; padding: 16px 56px 14px 20px; border-bottom: 1px solid var(--background-modifier-border); }',
            '.sauce-task-dialog > .sauce-modal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }',
            '.sauce-task-dialog > .sauce-modal-footer { box-sizing: border-box; flex: 0 0 auto; margin: 0; padding: 12px 20px; border-top: 1px solid var(--background-modifier-border); justify-content: space-between; align-items: center; }',
            '.sauce-task-dialog button.sauce-task-dialog-close { position: absolute; top: 10px; right: 12px; width: 32px; height: 32px; padding: 0; border: none; border-radius: var(--radius-s, 6px); background: transparent; box-shadow: none; color: var(--text-muted); font-size: 14px; cursor: pointer; }',
            '.sauce-task-dialog button.sauce-task-dialog-close:hover { background: var(--background-modifier-hover); color: var(--text-normal); }',
            '.sauce-modal.sauce-task-dialog.sauce-task-dialog-single { width: min(100%, 480px); }',
            '.sauce-task-dialog-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); min-height: 100%; }',
            '.sauce-task-dialog-left { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 18px 20px; }',
            '.sauce-task-dialog-right { display: flex; flex-direction: column; gap: 18px; min-width: 0; padding: 18px 20px; background: var(--background-secondary); border-left: 1px solid var(--background-modifier-border); }',
            '.sauce-task-dialog input.sauce-task-title { width: 100%; box-sizing: border-box; padding: 6px 0; border: none; border-bottom: 1px solid var(--background-modifier-border); border-radius: 0; background: transparent; box-shadow: none; color: var(--text-normal); font-size: 1.4em; font-weight: 600; }',
            '.sauce-task-dialog input.sauce-task-title:focus { border-bottom-color: var(--interactive-accent); box-shadow: none; }',
            '.sauce-task-hint { font-size: var(--font-ui-smaller, 12px); color: var(--text-faint); }',
            '.sauce-task-dialog textarea.sauce-task-notes { flex: 1 1 auto; width: 100%; min-height: 160px; box-sizing: border-box; padding: 8px 10px; resize: vertical; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px); color: var(--text-normal); font-size: 13px; line-height: 1.5; }',
            '.sauce-task-link-chips, .sauce-task-quiet-row, .sauce-task-pill-row { display: flex; flex-wrap: wrap; gap: 6px; }',
            '.sauce-task-link-chip, .sauce-task-parent { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; box-sizing: border-box; padding: 3px 6px 3px 10px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: var(--background-secondary); color: var(--text-normal); font-size: 12px; line-height: 1.3; align-self: flex-start; }',
            '.sauce-task-parent-label { color: var(--text-muted); }',
            '.sauce-task-dialog button.sauce-task-chip-x { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: none; border-radius: 999px; background: transparent; box-shadow: none; color: var(--text-muted); font-size: 11px; cursor: pointer; }',
            '.sauce-task-dialog button.sauce-task-chip-x:hover { background: var(--background-modifier-hover); color: var(--text-error); }',
            '.sauce-task-dialog button.sauce-task-quiet { min-height: 28px; padding: 4px 10px; border: 1px dashed var(--background-modifier-border); border-radius: var(--radius-s, 6px); background: transparent; box-shadow: none; color: var(--text-muted); font-size: 12px; cursor: pointer; }',
            '.sauce-task-dialog button.sauce-task-quiet:hover { background: var(--background-modifier-hover); color: var(--text-normal); }',
            '.sauce-task-picker-results { margin-top: 6px; max-height: 160px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px); }',
            '.sauce-task-picker-row { padding: 6px 8px; font-size: 13px; cursor: pointer; color: var(--text-normal); }',
            '.sauce-task-picker-row:hover { background: var(--background-modifier-hover); }',
            '.sauce-task-picker-empty { padding: 6px 8px; font-size: 12px; color: var(--text-muted); }',
            '.sauce-task-section-label { margin-bottom: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-muted); }',
            '.sauce-task-dialog button.sauce-task-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 4px 10px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: var(--background-primary); box-shadow: none; color: var(--text-muted); font-size: 12px; line-height: 1; cursor: pointer; }',
            '.sauce-task-dialog button.sauce-task-pill:hover { color: var(--text-normal); border-color: var(--interactive-accent); }',
            '.sauce-task-dialog button.sauce-task-pill.is-selected { background: var(--interactive-accent); border-color: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600; }',
            '.sauce-task-prio-swatch { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }',
            '.sauce-task-prio[data-prio="low"] .sauce-task-prio-swatch { background: var(--color-blue); }',
            '.sauce-task-prio[data-prio="medium"] .sauce-task-prio-swatch { background: var(--color-yellow); }',
            '.sauce-task-prio[data-prio="high"] .sauce-task-prio-swatch { background: var(--color-orange); }',
            '.sauce-task-prio[data-prio="highest"] .sauce-task-prio-swatch { background: var(--color-red); }',
            '.sauce-task-project-chips { margin-top: 8px; }',
            '.sauce-task-caption { margin-top: 6px; font-size: 11px; color: var(--text-faint); }',
            '.sauce-task-repeat-box { margin-top: 8px; }',
            '.sauce-task-footer-left, .sauce-task-footer-right { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }',
            '.sauce-task-footer-right { margin-left: auto; justify-content: flex-end; }',
            '.sauce-task-open-after-label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); cursor: pointer; }',
            '.sauce-task-kbd { margin-left: 6px; opacity: 0.75; font-size: 11px; }',
            '@media (max-width: 720px) {',
            '  .sauce-task-dialog-cols { grid-template-columns: minmax(0, 1fr); }',
            '  .sauce-task-dialog-right { border-left: none; border-top: 1px solid var(--background-modifier-border); }',
            '  .sauce-modal.sauce-task-dialog { max-height: calc(100vh - 32px); }',
            '}',
            // Phone: the sheet clears the status bar and home indicator, the
            // title and pills shrink to fit, a theme's tall phone buttons are
            // reset, and the footer stacks into two short rows (Open / Done /
            // Delete side by side, then the primary action full width).
            '@media (max-width: 600px) {',
            '  .sauce-modal-backdrop:has(> .sauce-task-dialog) { padding: calc(env(safe-area-inset-top, 0px) + 8px) 8px calc(env(safe-area-inset-bottom, 0px) + 8px); align-items: stretch; }',
            '  .sauce-modal.sauce-task-dialog { max-height: 100%; min-width: 0; }',
            '  .sauce-task-dialog > .sauce-modal-title { padding: 12px 52px 10px 16px; font-size: 1em; }',
            '  .sauce-task-dialog button.sauce-task-dialog-close { top: 6px; right: 8px; }',
            '  .sauce-task-dialog-left, .sauce-task-dialog-right { padding: 14px 16px; }',
            '  .sauce-task-dialog-right { gap: 14px; }',
            '  .sauce-task-dialog input.sauce-task-title { font-size: 1.15em; }',
            '  .sauce-task-dialog textarea.sauce-task-notes { min-height: 96px; }',
            '  .sauce-task-dialog button.sauce-task-pill, .sauce-task-dialog button.sauce-task-quiet { height: auto; min-height: 32px; padding: 5px 12px; font-size: 13px; }',
            '  .sauce-task-dialog > .sauce-modal-footer { flex-direction: column; align-items: stretch; gap: 8px; padding: 10px 16px; }',
            '  .sauce-task-dialog > .sauce-modal-footer > .sauce-task-footer-left, .sauce-task-dialog > .sauce-modal-footer > .sauce-task-footer-right { flex: 0 0 auto; min-width: 0; flex-wrap: nowrap; margin-left: 0; }',
            '  .sauce-task-footer-left > .sauce-btn, .sauce-task-footer-right > .sauce-btn { flex: 1 1 0; min-width: 0; }',
            '  .sauce-task-kbd { display: none; }',
            '}',
            // A phone theme can size every button to its touch height; these
            // out-rank such a `body.is-phone button` rule so pills stay pills.
            'body.is-phone .sauce-task-dialog button.sauce-task-pill, body.is-phone .sauce-task-dialog button.sauce-task-quiet { height: auto; min-height: 32px; }',
            'body.is-phone .sauce-task-dialog button.sauce-task-chip-x { height: 18px; min-height: 18px; }',
            'body.is-phone .sauce-task-dialog button.sauce-task-dialog-close { height: 32px; min-height: 32px; }',
            'body.is-phone .sauce-task-kbd { display: none; }',
            '',
        ].join('\n');
    }

    // Build a TaskEntity-shaped payload from the current form state.
    static _payloadFromState(state) {
        const s = state || {};
        const payload = {
            title: s.title,
            due: s.due || '',
            recurrence: s.recurrence || '',
            priority: s.priority || '',
            source: s.source || 'manual',
            source_note: s.source_note || '',
            // Structured card links (FIX 5) — always an array on the payload so the
            // create path (composeNote) + the edit path (processFrontMatter) both
            // write `links` deterministically.
            links: Array.isArray(s.links) ? s.links.slice() : [],
        };
        const name = (s.projectName || '').trim();
        if (name) payload.project = { name, slug: TaskDialog._slugify(name) };
        if (s.parentTask != null) payload.parent_task = String(s.parentTask).trim();
        const tripName = (s.tripName || '').trim();
        const tripSlug = (s.tripSlug || '').trim();
        if (tripName || tripSlug) payload.trip = { name: tripName || tripSlug, slug: tripSlug || TaskDialog._slugify(tripName) };
        return payload;
    }

    /**
     * Vault-wide clash check for a new task name: true when any markdown file
     * has that basename (case-insensitive) or the name is in `reservedLower`
     * (names already promised to in-flight creates). Candidates arrive
     * lowercased, without ".md". Files under the `excludeUnder` folder are
     * left out (the notes of a folder about to move, whose own names don't
     * count against it).
     */
    static _takenNames(app, reservedLower, excludeUnder) {
        const names = new Set();
        const skip = excludeUnder ? String(excludeUnder) + '/' : '';
        try {
            const files = app && app.vault && typeof app.vault.getMarkdownFiles === 'function'
                ? app.vault.getMarkdownFiles() : [];
            for (const f of files || []) {
                if (skip && f && String(f.path || '').indexOf(skip) === 0) continue;
                const base = f && f.basename != null ? f.basename
                    : String((f && f.path) || '').replace(/^.*\//, '').replace(/\.md$/i, '');
                if (base) names.add(String(base).toLowerCase());
            }
        } catch (_e) { /* an unreadable vault reports nothing taken */ }
        return (lowerBasename) => names.has(lowerBasename)
            || !!(reservedLower && reservedLower.has(lowerBasename));
    }

    /**
     * The note a `parent_task` link points at, with the title a subtask name
     * would carry: the note's `title` frontmatter, else its basename. Null for
     * an empty link or one that resolves to nothing.
     */
    static _resolveTaskParent(app, parentLink) {
        try {
            const name = TaskDialog._linkBasename(parentLink);
            if (!name || !app || !app.metadataCache
                || typeof app.metadataCache.getFirstLinkpathDest !== 'function') return null;
            const file = app.metadataCache.getFirstLinkpathDest(name, '');
            if (!file || !file.path) return null;
            let title = '';
            try {
                const cache = typeof app.metadataCache.getFileCache === 'function'
                    ? app.metadataCache.getFileCache(file) : null;
                const t = cache && cache.frontmatter && cache.frontmatter.title;
                if (t != null) title = String(t).trim();
            } catch (_e) { /* fall back to the basename */ }
            if (!title) title = file.basename != null ? String(file.basename)
                : String(file.path).replace(/^.*\//, '').replace(/\.md$/i, '');
            return { file, title };
        } catch (_e) {
            return null;
        }
    }

    /**
     * Where a subtask of `parentLink` is created: the parent's own folder when
     * the parent is a folder note in the live task tree. Null for no parent, an
     * unresolved parent, a still-flat parent, or one inside _done/ or _trash/ -
     * the subtask then goes to the task root and keeps `parent_task`.
     */
    static _parentFolderFor(app, parentLink) {
        const TE = TaskDialog._taskEntity();
        const parent = TaskDialog._resolveTaskParent(app, parentLink);
        if (!TE || !parent) return null;
        const path = String(parent.file.path);
        const root = TE.TASK_ROOT + '/';
        if (path.indexOf(root) !== 0 || !TE.isFolderNote(path)) return null;
        const rest = path.slice(root.length);
        if (rest.indexOf('_done/') === 0 || rest.indexOf('_trash/') === 0) return null;
        return { folder: TE.taskFolderOf(path), title: parent.title };
    }

    /** A note's cached frontmatter, or null. Never throws. */
    static _fmOf(app, file) {
        try {
            const cache = app && app.metadataCache && typeof app.metadataCache.getFileCache === 'function'
                ? app.metadataCache.getFileCache(file) : null;
            return (cache && cache.frontmatter) || null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * True for a task note in the folder layout: `<Name>/<Name>.md` inside a
     * top-level task folder (live, in a _done/YYYY/MM month, or in _trash).
     */
    static _isTaskFolderNote(path) {
        const TE = TaskDialog._taskEntity();
        return !!(TE && TE.isFolderNote(path) && TE.rootFolderOf(path));
    }

    /**
     * True when TaskEntity is not loaded yet and `path` has the folder-note
     * shape (`spice/tasks/…/<Name>/<Name>.md`). Done and delete refuse such a
     * note rather than move it with the flat rule into a folder that does
     * not exist.
     */
    static _folderNoteWhileCold(path) {
        if (TaskDialog._taskEntity()) return false;
        const segs = String(path == null ? '' : path).split('/');
        if (segs.length < 4 || segs[0] !== 'spice' || segs[1] !== 'tasks') return false;
        return segs[segs.length - 1].replace(/\.md$/i, '') === segs[segs.length - 2];
    }

    /**
     * Every task note (`type: task` folder note) inside `folder` at any
     * depth, not counting the folder's own note. Never throws.
     */
    static _taskNotesBelow(app, folder) {
        const out = [];
        const TE = TaskDialog._taskEntity();
        if (!TE || !folder) return out;
        const dir = String(folder);
        const prefix = dir + '/';
        const own = prefix + dir.slice(dir.lastIndexOf('/') + 1) + '.md';
        try {
            const files = app && app.vault && typeof app.vault.getMarkdownFiles === 'function'
                ? app.vault.getMarkdownFiles() : [];
            for (const f of files || []) {
                const p = String((f && f.path) || '');
                if (p.indexOf(prefix) !== 0 || p === own || !TE.isFolderNote(p)) continue;
                const fm = TaskDialog._fmOf(app, f);
                if (!fm || fm.type !== 'task') continue;
                out.push(f);
            }
        } catch (_e) { /* an unreadable vault reports none */ }
        return out;
    }

    /** The open task notes inside `folder` at any depth. Never throws. */
    static _openDescendants(app, folder) {
        const TE = TaskDialog._taskEntity();
        if (!TE) return [];
        return TaskDialog._taskNotesBelow(app, folder).filter((f) => {
            const fm = TaskDialog._fmOf(app, f) || {};
            return TE.isOpenTask({ type: fm.type, status: fm.status, path: f.path });
        });
    }

    /**
     * Move the task folder `folder` into `destParent` with ONE renameFile on
     * the folder, so links to every note inside follow. The year/month (or
     * _trash) folders are ensured first. When `<Name>` is already taken there,
     * the folder becomes `<Name> 2`, `<Name> 3`, … (also free vault-wide) and
     * its note is renamed with it, so folder and note keep one name.
     * Resolves { folder, name, oldFolder, oldName }.
     */
    async _moveTaskFolder(app, folder, destParent) {
        const oldFolder = String(folder);
        const oldName = oldFolder.slice(oldFolder.lastIndexOf('/') + 1);
        const parts = String(destParent).split('/');
        for (let i = 1; i <= parts.length; i++) await this._ensureFolder(app, parts.slice(0, i).join('/'));
        const exists = (p) => !!(app.vault && typeof app.vault.getAbstractFileByPath === 'function'
            && app.vault.getAbstractFileByPath(p));
        let name = oldName;
        if (exists(destParent + '/' + name)) {
            const taken = TaskDialog._takenNames(app);
            for (let n = 2; n < 10000; n++) {
                const candidate = oldName + ' ' + n;
                if (!exists(destParent + '/' + candidate) && !taken(candidate.toLowerCase())) { name = candidate; break; }
            }
        }
        const newFolder = destParent + '/' + name;
        await this._renameTaskFolder(app, oldFolder, newFolder, name);
        return { folder: newFolder, name, oldFolder, oldName };
    }

    /**
     * Move/rename the task folder `oldFolder` to `newFolder`, its note taking
     * `newName`. When the name changes the note is renamed FIRST, inside the
     * source folder, then the folder moves with one renameFile; if the folder
     * move fails the note gets its old name back. Either both steps land or
     * neither does, so folder and note never disagree. Throws on failure.
     */
    async _renameTaskFolder(app, oldFolder, newFolder, newName) {
        const get = (p) => app.vault.getAbstractFileByPath(p);
        const oldName = oldFolder.slice(oldFolder.lastIndexOf('/') + 1);
        const folderFile = get(oldFolder);
        if (!folderFile) throw new Error('task folder not found');
        let renamedNote = null;
        if (newName !== oldName) {
            const note = get(oldFolder + '/' + oldName + '.md');
            if (note) {
                await app.fileManager.renameFile(note, oldFolder + '/' + newName + '.md');
                renamedNote = note;
            }
        }
        try {
            await app.fileManager.renameFile(folderFile, newFolder);
        } catch (e) {
            if (renamedNote) {
                try { await app.fileManager.renameFile(renamedNote, oldFolder + '/' + oldName + '.md'); } catch (_e) { /* best effort */ }
            }
            throw e;
        }
    }

    /**
     * What an edit save does to a task FOLDER note's location, decided before
     * anything is written. Resolves { ok: true } when the note stays put (flat
     * notes, cold TaskEntity, nothing changed), { ok: true, folder, oldName,
     * destParent, name } for a move and/or rename, or { ok: false, reason }
     * when the new parent is the task itself or inside its own folder.
     * Re-parenting: a parent that resolves to a live folder note takes the
     * folder; a cleared parent, or one that cannot hold folders (flat,
     * unresolved, done, trashed), sends it to spice/tasks/ so the old
     * enclosing folder cannot keep winning on read (a task already at the top
     * level just gets parent_task written). A
     * rename happens only when the title changed and its sanitized form is not
     * already the folder name; the new name is vault-unique with this task's
     * own current name not counting as taken. Done and trashed tasks never
     * change parent folder, they only rename in place.
     */
    static _planEditMove(app, file, payload, prior) {
        const TE = TaskDialog._taskEntity();
        const notePath = String((file && file.path) || '');
        if (!TE || !TE.isFolderNote(notePath) || !TE.rootFolderOf(notePath)) return { ok: true };
        const fm = prior || {};
        const folder = TE.taskFolderOf(notePath);
        const oldName = folder.slice(folder.lastIndexOf('/') + 1);
        const currentParent = folder.slice(0, folder.lastIndexOf('/'));
        const live = notePath.indexOf(TE.TASK_ROOT + '/_done/') !== 0
            && notePath.indexOf(TE.TASK_ROOT + '/_trash/') !== 0;
        const hasParent = Object.prototype.hasOwnProperty.call(payload, 'parent_task');
        const newLink = hasParent ? String(payload.parent_task || '') : '';
        const oldLink = fm.parent_task == null ? '' : String(fm.parent_task);
        let destParent = currentParent;
        if (live && hasParent && newLink !== oldLink) {
            if (!newLink) {
                destParent = TE.TASK_ROOT;
            } else {
                const pf = TaskDialog._parentFolderFor(app, newLink);
                if (pf) {
                    if (pf.folder === folder || pf.folder.indexOf(folder + '/') === 0) {
                        return { ok: false, reason: 'a task cannot be a subtask of itself or of its own subtask' };
                    }
                    destParent = pf.folder;
                } else {
                    destParent = TE.TASK_ROOT;
                }
            }
        }
        const prevTitle = fm.title != null && String(fm.title).trim() !== '' ? String(fm.title).trim() : oldName;
        const newTitle = String(payload.title == null ? '' : payload.title).trim();
        let name = oldName;
        if (newTitle !== prevTitle && TE._sanitizeTitle(newTitle) !== oldName) {
            const link = hasParent ? newLink : oldLink;
            const info = link ? TaskDialog._resolveTaskParent(app, link) : null;
            const own = oldName.toLowerCase();
            const takenAll = TaskDialog._takenNames(app);
            name = TE.taskName(newTitle, {
                parentTitle: info ? info.title : undefined,
                createdAt: fm.created_at,
                taken: (n) => n !== own && takenAll(n),
            });
        }
        if (destParent === currentParent && name === oldName) return { ok: true };
        return { ok: true, folder, oldName, destParent, name };
    }

    /** Where a note at `path` landed after `_moveTaskFolder` returned `moved`. */
    static _movedPath(path, moved) {
        const p = String(path);
        if (p === moved.oldFolder + '/' + moved.oldName + '.md') return moved.folder + '/' + moved.name + '.md';
        return moved.folder + p.slice(moved.oldFolder.length);
    }

    /** Put back the status / completed_at values captured before a failed write. */
    static async _restoreFields(app, priors) {
        for (const prior of priors.slice().reverse()) {
            try {
                await app.fileManager.processFrontMatter(prior.file, (fm) => {
                    for (const key of Object.keys(prior.fields)) {
                        if (prior.fields[key] === undefined) delete fm[key];
                        else fm[key] = prior.fields[key];
                    }
                });
            } catch (_e) { /* best effort */ }
        }
    }

    /**
     * CREATE - write ONE new file. Compose via TaskEntity, validate, then build
     * the final body as CHROME (TaskChromeBar + TaskNoteView + marker) with the
     * typed user notes appended BELOW the `<!-- TASK_NOTES -->` marker. The
     * note is `<parent folder>/<Name>/<Name>.md`; `<Name>` is vault-unique
     * (TaskEntity.taskName) and reserved names (in-flight quick creates) count
     * as taken. Never touches any other note.
     */
    _prepareCreate(app, payload, notes, opts) {
        const TE = TaskDialog._taskEntity();
        if (!TE) { try { new Notice('task-entity mechanism not loaded'); } catch (_e) {} return; }
        // Stamp a moment so composeNote can derive created_at.
        const moment = (typeof window !== 'undefined' && window.moment) ? window.moment() : null;
        const payloadWithMoment = Object.assign({}, payload, { moment });
        const v = TE.validatePayload(payloadWithMoment);
        if (!v.valid) { try { new Notice('Invalid task: ' + v.reason); } catch (_e) {} return; }
        const { frontmatter, body } = TE.composeNote(payloadWithMoment);
        const reservedNames = opts && opts.reservedNames;
        const parentLink = payload && payload.parent_task;
        const parentInfo = parentLink ? TaskDialog._resolveTaskParent(app, parentLink) : null;
        const parentFolder = parentLink ? TaskDialog._parentFolderFor(app, parentLink) : null;
        const name = TE.taskName(payload.title, {
            parentTitle: parentInfo ? parentInfo.title : undefined,
            createdAt: frontmatter.created_at,
            taken: TaskDialog._takenNames(app, reservedNames),
        });
        const path = TE.folderNotePath(parentFolder ? parentFolder.folder : TE.TASK_ROOT, name);
        // Chrome first (from composeNote), then the typed notes below the marker.
        const chromeBody = body || '';
        const userNotes = String(notes == null ? '' : notes);
        const finalBody = userNotes ? chromeBody + userNotes + '\n' : chromeBody;
        const content = TaskDialog.renderNote(frontmatter, finalBody);
        return { path, content, frontmatter, nameKey: name.toLowerCase() };
    }

    async _commitCreate(app, plan, opts) {
        if (!app || !plan || !plan.path) return;
        try {
            const parts = plan.path.split('/');
            parts.pop();
            for (let i = 1; i <= parts.length; i++) {
                await this._ensureFolder(app, parts.slice(0, i).join('/'));
            }
            const file = await app.vault.create(plan.path, plan.content);
            try { new Notice('Task created'); } catch (_e) {}
            if (!opts || opts.reconcile !== false) {
                try { this._reconcileAfterCreate(app, plan.path); } catch (_e) {}
            }
            return { ok: true, path: plan.path, file };
        } finally {
            this.releaseQuickPlan(plan);
        }
    }

    async _create(app, payload, notes, opts) {
        const plan = this._prepareCreate(app, payload, notes);
        if (!plan) return;
        return this._commitCreate(app, plan, opts);
    }

    /**
     * L4: after a create, reconcile the surface WITHOUT waiting for Dataview's
     * ~2.5s refresh tick. The metadataCache 'changed' event only tells us
     * Obsidian re-parsed the file's frontmatter — Dataview's OWN index update
     * is a separate, later async step, so firing the force-refresh command
     * right on 'changed' can still race Dataview and redraw the list from its
     * stale (pre-create) index, permanently — nothing re-triggers afterward.
     * So: on 'changed' (or the 1200ms fallback if it's missed), POLL
     * `dv.page(path)` until Dataview itself reports the new page indexed
     * (bounded retries), THEN force-refresh. If the Dataview API is
     * unavailable, degrades immediately to the old fire-on-signal behavior.
     * Preserves scroll first. NEVER throws — degrades to the natural tick.
     */
    _reconcileAfterCreate(app, path) {
        try { (typeof window !== 'undefined' && window.customJS && window.customJS.RenderSafe
            && window.customJS.RenderSafe.captureScroll && window.customJS.RenderSafe.captureScroll()); } catch (_e) {}
        try {
            if (!app) return;
            const fire = () => {
                try {
                    if (app.commands && typeof app.commands.executeCommandById === 'function') {
                        app.commands.executeCommandById('dataview:dataview-force-refresh-views');
                    }
                } catch (_e) { /* ignore */ }
            };
            const dvHasPage = () => {
                try {
                    const dv = app.plugins && app.plugins.plugins && app.plugins.plugins.dataview
                        ? app.plugins.plugins.dataview.api : null;
                    if (!dv || typeof dv.page !== 'function') return true;
                    return !!dv.page(path);
                } catch (_e) { return true; }
            };
            const setT = app._setTimeout
                || (typeof window !== 'undefined' && window.setTimeout)
                || (typeof setTimeout !== 'undefined' ? setTimeout : null);
            if (typeof setT !== 'function') return;

            let fired = false;
            let ref = null;
            const detachMeta = () => {
                try { if (ref && app.metadataCache && typeof app.metadataCache.offref === 'function') app.metadataCache.offref(ref); } catch (_e) {}
            };
            const finish = () => {
                if (fired) return;
                fired = true;
                detachMeta();
                fire();
            };
            const poll = (attemptsLeft) => {
                if (fired) return;
                if (dvHasPage() || attemptsLeft <= 0) { finish(); return; }
                setT(() => poll(attemptsLeft - 1), 150);
            };
            if (app.metadataCache && typeof app.metadataCache.on === 'function') {
                ref = app.metadataCache.on('changed', (f) => {
                    if (fired) return;
                    if (f && f.path === path) poll(20);
                });
            }
            setT(() => poll(20), 1200);
        } catch (_e) { /* never throw */ }
    }

    /**
     * QUICK-CREATE — a modal-less one-gesture task create for the Home command
     * center's inline "Jot a task…" capture. Builds the minimal payload from the
     * typed title (due = today, no priority/project) and reuses the SAME
     * single-file `_create` path (composeNote → dedupe → one vault.create), so the
     * one-file-write invariant holds and the note appears in the Tasks panel on
     * the caller's re-render. `app` is grabbed from the runtime global (as
     * open()/_render do). A blank / whitespace-only title, or a cold-load with no
     * app, is a silent no-op. Returns a Promise (the caller awaits before it
     * re-renders). Never touches any surface note.
     */
    prepareQuick(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const title = String((opts && opts.title) || '').trim();
        if (!app || !title) return;
        const payload = {
            title,
            due: (opts && opts.today) || '',
            source: (opts && opts.source) || 'daily',
            parent_task: (opts && opts.parent_task) || '',
            links: [],
        };
        const reservations = this._quickCreateReservations || (this._quickCreateReservations = new Set());
        const plan = this._prepareCreate(app, payload, '', { reservedNames: reservations });
        if (!plan) return;
        reservations.add(plan.nameKey);
        plan._quickReservation = { owner: reservations, key: plan.nameKey };
        const fm = plan.frontmatter || {};
        plan.task = {
            title: String(fm.title || title),
            status: String(fm.status || 'open'),
            due: String(fm.due || ''),
            priority: String(fm.priority || ''),
            recurrence: String(fm.recurrence || ''),
            project: String(fm.project || ''),
            parent_task: String(fm.parent_task || payload.parent_task || ''),
            path: plan.path,
        };
        return plan;
    }

    releaseQuickPlan(plan) {
        const reservation = plan && plan._quickReservation;
        if (!reservation) return;
        try { reservation.owner.delete(reservation.key); } catch (_e) {}
        delete plan._quickReservation;
    }

    async createQuick(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        if (!app) return;
        const plan = opts && opts.plan ? opts.plan : this.prepareQuick(opts);
        if (!plan) return;
        return this._commitCreate(app, plan, { reconcile: !(opts && opts.reconcile === false) });
    }

    /**
     * EDIT/SAVE — mutate ONLY this file's frontmatter via processFrontMatter,
     * then (if notes were edited) swap ONLY this file's body via vault.process.
     * Both writes touch the task's OWN file only — never a surface note — so the
     * single-file-write invariant holds. The body write is guarded so a vault
     * without vault.process still saves the frontmatter.
     */
    async _saveEdit(app, file, payload, notes) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        const TE = TaskDialog._taskEntity();
        const v = TE ? TE.validatePayload(payload) : { valid: !!(payload.title && String(payload.title).trim()) };
        if (!v.valid) { try { new Notice('Invalid task: ' + v.reason); } catch (_e) {} return; }
        const prior = Object.assign({}, TaskDialog._fmOf(app, file) || {});
        const plan = TaskDialog._planEditMove(app, file, payload, prior);
        if (!plan.ok) { try { new Notice('Cannot save: ' + plan.reason); } catch (_e) {} return { ok: false, reason: plan.reason }; }
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.title = payload.title;
            const prevDue = fm.due == null ? '' : String(fm.due);
            fm.due = payload.due || '';
            if (prevDue !== String(fm.due)) fm.rank = '';
            fm.priority = payload.priority || '';
            fm.recurrence = payload.recurrence || '';
            if (payload.project && payload.project.name) {
                fm.project = '[[' + payload.project.name + ']]';
                fm.project_slug = payload.project.slug || TaskDialog._slugify(payload.project.name);
            } else {
                fm.project = '';
                fm.project_slug = '';
            }
            // trip linkage — parallel to project. Persist on edit so a trip task
            // keeps its trip / trip_slug (else it drops out of TaskTripList).
            if (payload.trip && (payload.trip.name || payload.trip.slug)) {
                const tName = payload.trip.name || payload.trip.slug;
                fm.trip = '[[' + tName + ']]';
                fm.trip_slug = payload.trip.slug || TaskDialog._slugify(tName);
            } else {
                fm.trip = '';
                fm.trip_slug = '';
            }
            // Structured card links (FIX 5) — a single-file frontmatter write,
            // preserving the one-file-write invariant. Always set (even to []) so
            // removing every chip persists as an empty list, not a stale value.
            fm.links = Array.isArray(payload.links) ? payload.links.slice() : [];
            // Subtask of… — written only when the dialog carried a parent and
            // it differs, so a save never adds an empty key to an older note.
            if (Object.prototype.hasOwnProperty.call(payload, 'parent_task')
                && String(fm.parent_task == null ? '' : fm.parent_task) !== String(payload.parent_task || '')) {
                fm.parent_task = payload.parent_task || '';
            }
        });
        // Persist the Notes body back into THIS file only. Prefer vault.process
        // (atomic read-modify-write of the single file); fall back to read+modify.
        if (notes != null) {
            const body = String(notes);
            try {
                if (app.vault && typeof app.vault.process === 'function') {
                    await app.vault.process(file, (data) => TaskDialog._replaceBody(data, body));
                } else if (app.vault && typeof app.vault.read === 'function' && typeof app.vault.modify === 'function') {
                    const data = await app.vault.read(file);
                    await app.vault.modify(file, TaskDialog._replaceBody(data, body));
                }
            } catch (_e) { /* frontmatter already saved; body write best-effort */ }
        }
        let finalPath = String(file.path || '');
        if (plan.folder) {
            const newFolder = plan.destParent + '/' + plan.name;
            try {
                await this._renameTaskFolder(app, plan.folder, newFolder, plan.name);
                finalPath = newFolder + '/' + plan.name + '.md';
            } catch (e) {
                const fields = { title: prior.title, parent_task: prior.parent_task };
                await TaskDialog._restoreFields(app, [{ file, fields }]);
                try { new Notice('Could not move or rename the task: ' + ((e && e.message) || e)); } catch (_e) {}
                return { ok: false, reason: 'move-failed' };
            }
        }
        try { new Notice('Task saved'); } catch (_e) {}
        return { ok: true, path: finalPath };
    }

    /**
     * DONE — set status=done + completed_at (processFrontMatter). A recurring
     * task rolls its due date forward instead and never moves. A task folder
     * note: its open subtasks are completed too (after confirmComplete unless
     * `opts.completeOpenSubtasks`; No resolves { ok: false, reason:
     * 'cancelled' } with nothing written); a subtask then stays in place and a
     * top-level task's whole folder moves to spice/tasks/_done/YYYY/MM/ by its
     * completion month. A flat note moves alone into spice/tasks/_done/.
     * Resolves { ok: true, path } with the note's final path.
     */
    async _markDone(app, file, opts) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return { ok: false, reason: 'task file not found' }; }
        // Read the CURRENT frontmatter (not the state object — markDone(path)
        // is also called directly from a row checkbox, with no open dialog) to
        // decide recurring vs. one-shot completion.
        let fm = null;
        try {
            const cache = app.metadataCache && typeof app.metadataCache.getFileCache === 'function'
                ? app.metadataCache.getFileCache(file) : null;
            fm = (cache && cache.frontmatter) || null;
        } catch (_e) { fm = null; }
        const recurrence = fm ? String(fm.recurrence || '').trim() : '';

        if (recurrence) {
            const todayStr = (typeof window !== 'undefined' && window.moment)
                ? window.moment().format('YYYY-MM-DD')
                : null;
            const anchorStr = fm && fm.created_at ? String(fm.created_at).slice(0, 10) : null;
            const RP = (typeof window !== 'undefined' && window.customJS && window.customJS.RecurrenceParser) || null;
            const matchesFn = (RP && typeof RP.matches === 'function' && typeof window !== 'undefined' && window.moment)
                ? (dateStr, anchorDateStr) => {
                    const dateMoment = window.moment(dateStr, 'YYYY-MM-DD');
                    const anchorMoment = anchorDateStr ? window.moment(anchorDateStr, 'YYYY-MM-DD') : null;
                    try { return RP.matches(recurrence, dateMoment, { registryCreatedAt: anchorMoment }); }
                    catch (_e) { return false; }
                }
                : null;
            const nextDate = todayStr ? TaskDialog._rollForwardDate(recurrence, todayStr, anchorStr, matchesFn) : null;
            if (nextDate) {
                // ROLL FORWARD — same file, never archived. Leaves status/priority/
                // project/links untouched; only due advances and completed_at
                // clears (so the note never carries a stale "last time" stamp).
                await app.fileManager.processFrontMatter(file, (fmw) => {
                    fmw.due = nextDate;
                    fmw.completed_at = '';
                });
                try { new Notice('Task rolled to ' + nextDate); } catch (_e) {}
                return { ok: true, path: file.path, rolled: nextDate };
            }
            // Grammar unsupported / never fires within the horizon — fall through
            // to normal one-shot archiving rather than silently doing nothing.
        }

        const iso = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ')
            : new Date().toISOString();

        const srcPath = String(file.path);
        if (TaskDialog._folderNoteWhileCold(srcPath)) return { ok: false, reason: 'task-entity-unavailable' };
        if (TaskDialog._isTaskFolderNote(srcPath)) {
            const TE = TaskDialog._taskEntity();
            const folder = TE.taskFolderOf(srcPath);
            const open = TaskDialog._openDescendants(app, folder);
            if (open.length && !(opts && opts.completeOpenSubtasks)) {
                let yes = false;
                try { yes = await this.confirmComplete(srcPath); } catch (_e) { yes = false; }
                if (!yes) return { ok: false, reason: 'cancelled' };
            }
            const priors = [];
            const stamp = async (f) => {
                await app.fileManager.processFrontMatter(f, (fm2) => {
                    priors.push({ file: f, fields: { status: fm2.status, completed_at: fm2.completed_at } });
                    fm2.status = 'done';
                    fm2.completed_at = iso;
                });
            };
            const rootDir = TE.rootFolderOf(srcPath);
            const live = rootDir.indexOf(TE.TASK_ROOT + '/_done/') !== 0
                && rootDir.indexOf(TE.TASK_ROOT + '/_trash/') !== 0;
            try {
                for (const f of open) await stamp(f);
                await stamp(file);
                if (!live || TE.parentNotePathOf(srcPath)) {
                    try { new Notice('Task done'); } catch (_e) {}
                    return { ok: true, path: srcPath };
                }
                const moved = await this._moveTaskFolder(app, folder, TE.doneFolderFor(iso));
                try { new Notice('Task done'); } catch (_e) {}
                return { ok: true, path: TaskDialog._movedPath(srcPath, moved) };
            } catch (e) {
                await TaskDialog._restoreFields(app, priors);
                throw e;
            }
        }

        await app.fileManager.processFrontMatter(file, (fm2) => {
            fm2.status = 'done';
            fm2.completed_at = iso;
        });
        await this._ensureFolder(app, 'spice/tasks/_done');
        const target = TaskDialog.donePath(file.path);
        await app.fileManager.renameFile(file, target);
        try { new Notice('Task done'); } catch (_e) {}
        return { ok: true, path: target };
    }

    /**
     * REOPEN — bring a done task back: status=open, completed_at cleared.
     *   - a done task outside _done/ (a finished subtask in place): status only;
     *   - a task note inside a _done/YYYY/MM/<Root>/ tree: it AND every
     *     ancestor up to <Root> reopen, then the <Root> folder moves back to
     *     spice/tasks/<Root> (name re-checked vault-wide, ignoring the moving
     *     notes; renamed with TaskEntity.taskName only when <Root> is taken);
     *   - a flat spice/tasks/_done/<f>: moves back to spice/tasks/<unique f>.
     * Each runs inside ONE RenderSafe.mutate write that restores the statuses
     * if the move fails. Refuses _trash/ and an open task outside _done/ with
     * 'not-done'. At most one reopen per path is in flight; a duplicate
     * resolves { ok: false, reason: 'in-flight' } without writing. Never
     * throws. Resolves { ok: true, path } | { ok: false, reason }.
     */
    async reopen(path) {
        const src = String(path == null ? '' : path);
        const ROOT = 'spice/tasks/';
        const DONE = 'spice/tasks/_done/';
        if (src.indexOf(ROOT) !== 0 || src.indexOf('spice/tasks/_trash/') === 0
            || src === DONE) return { ok: false, reason: 'not-done' };
        const RS = TaskDialog._renderSafe();
        if (!RS || typeof RS.mutate !== 'function') return { ok: false, reason: 'render-safe-unavailable' };
        const inFlight = TaskDialog._reopenInFlight || (TaskDialog._reopenInFlight = new Set());
        if (inFlight.has(src)) return { ok: false, reason: 'in-flight' };
        inFlight.add(src);
        try {
            const { app, file } = this._resolveFile(src);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            if (src.indexOf(DONE) !== 0) return await this._reopenInPlace(app, file, src, RS);
            const treeRoot = TaskDialog._isTaskFolderNote(src) ? TaskDialog._taskEntity().rootFolderOf(src) : '';
            if (/^spice\/tasks\/_done\/\d{4}\/\d{2}\/[^/]+$/.test(treeRoot)) {
                // One reopen per _done tree: a second note of the same tree
                // (another subtask's undo) would race the folder move.
                const treeKey = treeRoot + '/';
                if (inFlight.has(treeKey)) return { ok: false, reason: 'in-flight' };
                inFlight.add(treeKey);
                try {
                    return await this._reopenDoneTree(app, src, RS);
                } finally {
                    inFlight.delete(treeKey);
                }
            }
            const TE = TaskDialog._taskEntity();
            if (!TE || typeof TE._uniqueName !== 'function') return { ok: false, reason: 'task-entity-unavailable' };
            const exists = (p) => !!(app.vault && typeof app.vault.getAbstractFileByPath === 'function'
                && app.vault.getAbstractFileByPath(p));
            const target = 'spice/tasks/' + TE._uniqueName(src.slice(DONE.length), exists);
            let reopened = false;
            let prior = null;
            const result = await RS.mutate({
                app,
                path: src,
                failureMessage: 'Could not reopen task',
                write: async () => {
                    await app.fileManager.processFrontMatter(file, (fm) => {
                        prior = { status: fm.status, completed_at: fm.completed_at };
                        fm.status = 'open';
                        fm.completed_at = '';
                    });
                    reopened = true;
                    await app.fileManager.renameFile(file, target);
                    return target;
                },
                revert: async () => {
                    if (!reopened || !prior || file.path === target) return;
                    await app.fileManager.processFrontMatter(file, (fm) => {
                        fm.status = prior.status;
                        fm.completed_at = prior.completed_at;
                    });
                },
            });
            if (!result.ok) {
                return { ok: false, reason: (result.error && (result.error.message || String(result.error))) || 'write failed' };
            }
            return { ok: true, path: target };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        } finally {
            inFlight.delete(src);
        }
    }

    /** Reopen a done task where it is (a finished subtask): status only. */
    async _reopenInPlace(app, file, src, RS) {
        const fm = TaskDialog._fmOf(app, file);
        if (!fm || fm.status !== 'done') return { ok: false, reason: 'not-done' };
        let prior = null;
        const result = await RS.mutate({
            app,
            path: src,
            failureMessage: 'Could not reopen task',
            write: async () => {
                await app.fileManager.processFrontMatter(file, (w) => {
                    prior = { status: w.status, completed_at: w.completed_at };
                    w.status = 'open';
                    w.completed_at = '';
                });
                return src;
            },
        });
        if (!result.ok) {
            return { ok: false, reason: (result.error && (result.error.message || String(result.error))) || 'write failed' };
        }
        return prior ? { ok: true, path: src } : { ok: false, reason: 'write failed' };
    }

    /**
     * Reopen a task note inside spice/tasks/_done/YYYY/MM/<Root>/: the note
     * and each ancestor up to <Root> go back to open, then the <Root> folder
     * moves to spice/tasks/. <Root> keeps its name while that is free
     * vault-wide (the moving notes' own names don't count); otherwise
     * TaskEntity.taskName picks the name and the note is renamed with its
     * folder. Statuses are restored if the move fails.
     */
    async _reopenDoneTree(app, src, RS) {
        const TE = TaskDialog._taskEntity();
        if (!TE || typeof TE.taskName !== 'function') return { ok: false, reason: 'task-entity-unavailable' };
        const root = TE.TASK_ROOT;
        const rootFolder = TE.rootFolderOf(src);
        const rootName = rootFolder.slice(rootFolder.lastIndexOf('/') + 1);
        const rootNotePath = rootFolder + '/' + rootName + '.md';
        const chain = [src];
        for (let p = TE.parentNotePathOf(src); p && chain.length < 1000; p = TE.parentNotePathOf(p)) chain.push(p);
        if (chain.indexOf(rootNotePath) < 0) chain.push(rootNotePath);
        const get = (p) => (app.vault && typeof app.vault.getAbstractFileByPath === 'function'
            ? app.vault.getAbstractFileByPath(p) : null);
        const chainFiles = chain.map(get).filter((f) => f && f.path);

        const takenElsewhere = TaskDialog._takenNames(app, null, rootFolder);
        const topFolders = new Set();
        try {
            for (const f of app.vault.getMarkdownFiles() || []) {
                const p = String((f && f.path) || '');
                if (p.indexOf(root + '/') !== 0 || p.indexOf(rootFolder + '/') === 0) continue;
                const rest = p.slice(root.length + 1);
                if (rest.indexOf('/') > 0) topFolders.add(rest.slice(0, rest.indexOf('/')).toLowerCase());
            }
            const rootDir = get(root);
            for (const c of (rootDir && Array.isArray(rootDir.children)) ? rootDir.children : []) {
                if (c && c.name && !c.extension) topFolders.add(String(c.name).toLowerCase());
            }
        } catch (_e) { /* the name check falls back to basenames only */ }
        const taken = (lower) => takenElsewhere(lower) || topFolders.has(lower);
        let name = rootName;
        if (taken(rootName.toLowerCase()) || get(root + '/' + rootName)) {
            const rootFile = get(rootNotePath);
            const rfm = (rootFile && TaskDialog._fmOf(app, rootFile)) || {};
            const title = rfm.title != null && String(rfm.title).trim() !== '' ? rfm.title : rootName;
            name = TE.taskName(title, { createdAt: rfm.created_at, taken });
        }
        const moved = { folder: root + '/' + name, name, oldFolder: rootFolder, oldName: rootName };
        const target = TaskDialog._movedPath(src, moved);

        const priors = [];
        let movedFolder = false;
        const result = await RS.mutate({
            app,
            path: src,
            failureMessage: 'Could not reopen task',
            write: async () => {
                for (const f of chainFiles) {
                    await app.fileManager.processFrontMatter(f, (w) => {
                        priors.push({ file: f, fields: { status: w.status, completed_at: w.completed_at } });
                        w.status = 'open';
                        w.completed_at = '';
                    });
                }
                await this._renameTaskFolder(app, rootFolder, moved.folder, name);
                movedFolder = true;
                return target;
            },
            revert: async () => {
                if (movedFolder || !priors.length) return;
                await TaskDialog._restoreFields(app, priors);
            },
        });
        if (!result.ok) {
            return { ok: false, reason: (result.error && (result.error.message || String(result.error))) || 'write failed' };
        }
        return { ok: true, path: target };
    }

    /**
     * SET FIELDS — write exactly `fields` into one task's frontmatter through a
     * RenderSafe.mutate write (rank / priority / project from bulk and drag
     * gestures). When `fields` carries `due` and not `rank`, `rank` is cleared in
     * the same write: a date move invalidates a manual position. Never throws.
     * Resolves { ok: true } | { ok: false, reason }.
     */
    async setFields(path, fields) {
        try {
            if (!fields || typeof fields !== 'object' || Array.isArray(fields)
                || Object.keys(fields).length === 0) return { ok: false, reason: 'no-fields' };
            const RS = TaskDialog._renderSafe();
            if (!RS || typeof RS.mutate !== 'function') return { ok: false, reason: 'render-safe-unavailable' };
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            const patch = Object.assign({}, fields);
            if (Object.prototype.hasOwnProperty.call(patch, 'due')
                && !Object.prototype.hasOwnProperty.call(patch, 'rank')) patch.rank = '';
            const result = await RS.mutate({
                app,
                path: String(path),
                failureMessage: 'Could not update task',
                write: async () => {
                    await app.fileManager.processFrontMatter(file, (fm) => {
                        for (const key of Object.keys(patch)) fm[key] = patch[key];
                    });
                },
            });
            if (!result.ok) {
                return { ok: false, reason: (result.error && (result.error.message || String(result.error))) || 'write failed' };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        }
    }

    /**
     * DELETE (recoverable) — set status=deleted (processFrontMatter, this note
     * only), then move into spice/tasks/_trash/ (renameFile). A task folder
     * note takes its whole folder to spice/tasks/_trash/<Name>/ (subtasks keep
     * their statuses); a deleted subtask leaves its parent's tree and keeps
     * `parent_task`. A flat note moves alone. No hard delete; the note is
     * recoverable. Resolves { ok: true, path }.
     */
    async _markDeleted(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return { ok: false, reason: 'task file not found' }; }
        const srcPath = String(file.path);
        if (TaskDialog._folderNoteWhileCold(srcPath)) return { ok: false, reason: 'task-entity-unavailable' };
        if (TaskDialog._isTaskFolderNote(srcPath)) {
            const TE = TaskDialog._taskEntity();
            let prior;
            await app.fileManager.processFrontMatter(file, (fm) => {
                prior = { file, fields: { status: fm.status } };
                fm.status = 'deleted';
            });
            if (TE.rootFolderOf(srcPath).indexOf(TE.TASK_ROOT + '/_trash/') === 0) {
                try { new Notice('Task deleted'); } catch (_e) {}
                return { ok: true, path: srcPath };
            }
            try {
                const moved = await this._moveTaskFolder(app, TE.taskFolderOf(srcPath), TE.TASK_ROOT + '/_trash');
                try { new Notice('Task deleted'); } catch (_e) {}
                return { ok: true, path: TaskDialog._movedPath(srcPath, moved) };
            } catch (e) {
                if (prior) await TaskDialog._restoreFields(app, [prior]);
                throw e;
            }
        }
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.status = 'deleted';
        });
        await this._ensureFolder(app, 'spice/tasks/_trash');
        const target = TaskDialog.trashPath(file.path);
        await app.fileManager.renameFile(file, target);
        try { new Notice('Task deleted'); } catch (_e) {}
        return { ok: true, path: target };
    }

    /**
     * Ensure a folder exists. createFolder throws when the folder already exists,
     * so the throw is swallowed — the folder existing is the success case.
     */
    async _ensureFolder(app, folder) {
        try {
            if (app.vault && typeof app.vault.getAbstractFileByPath === 'function'
                && app.vault.getAbstractFileByPath(folder)) return;
            await app.vault.createFolder(folder);
        } catch (_e) { /* already exists — createFolder throws in that case */ }
    }

    /** Reach the stored RenderSafe instance (customJS), or null on cold-load. */
    static _renderSafe() {
        try {
            return (typeof window !== 'undefined' && window.customJS && window.customJS.RenderSafe) || null;
        } catch (_e) {
            return null;
        }
    }

    /** Reach the stored TaskEntity instance (customJS), or null on cold-load. */
    static _taskEntity() {
        try {
            return (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Read the edit file's `links` frontmatter into a clean string array for the
     * chip list (FIX 5). Prefers TaskEntity._normLinks (single source of truth —
     * coerces an array of strings and/or Dataview Link objects); falls back to a
     * local string-only coercion when customJS isn't ready. A null fm / absent
     * links → []. Never throws.
     */
    static _loadLinks(fm) {
        const raw = fm && fm.links;
        try {
            const TE = TaskDialog._taskEntity();
            if (TE && typeof TE._normLinks === 'function') return TE._normLinks(raw);
        } catch (_e) { /* fall through to the local coercion */ }
        if (!Array.isArray(raw)) return [];
        const out = [];
        for (const entry of raw) {
            if (entry == null) continue;
            const s = typeof entry === 'string' ? entry.trim() : String(entry).trim();
            if (s) out.push(s);
        }
        return out;
    }

    /** Strip surrounding `[[ ]]` from a wikilink for display in the edit form. */
    static _stripWikilink(v) {
        const s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]+)\]\]$/.exec(s);
        return m ? m[1] : s;
    }

    /**
     * Remove a leading `---\n...\n---\n` frontmatter block from a file's text,
     * returning just the body (for populating the Notes textarea in edit mode). A
     * file with no leading frontmatter block is returned unchanged.
     */
    static _stripFrontmatter(txt) {
        const s = String(txt == null ? '' : txt);
        const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(s);
        return m ? s.slice(m[0].length) : s;
    }

    /**
     * Return just the USER-NOTES portion of a task file's text: everything AFTER
     * the first `<!-- TASK_NOTES -->` marker (the chrome above it is regenerable).
     * A leading newline right after the marker is trimmed so the textarea doesn't
     * start with a blank line, and a trailing newline is trimmed for tidy edits.
     * A file with NO marker (legacy note pre-heal) falls back to the whole body
     * minus its frontmatter, so an edit before the heal ran never loses notes.
     * Pure string work.
     */
    static _bodyNotesBelowMarker(fileText) {
        const s = String(fileText == null ? '' : fileText);
        const MARKER = '<!-- TASK_NOTES -->';
        const idx = s.indexOf(MARKER);
        if (idx < 0) return TaskDialog._stripFrontmatter(s);
        let after = s.slice(idx + MARKER.length);
        after = after.replace(/^\r?\n/, '');   // drop the newline right after the marker
        after = after.replace(/\s+$/, '');     // trim trailing whitespace
        return after;
    }

    /**
     * Persist edited notes back into a task file, PRESERVING everything up to and
     * including the `<!-- TASK_NOTES -->` marker (frontmatter + chrome + marker)
     * and replacing only what's AFTER the marker with `\n` + newNotes. If the
     * file has no marker (legacy note being edited before the heal ran), we
     * re-inject the chrome+marker (so the edit also un-bares the note) and place
     * the notes below it. The frontmatter is preserved verbatim in both cases.
     * Single-file invariant intact — pure string work, called only against the
     * task's OWN file.
     */
    static _replaceBody(fileText, newNotes) {
        const s = String(fileText == null ? '' : fileText);
        const notes = String(newNotes == null ? '' : newNotes).replace(/\s+$/, '');
        const notesTail = notes ? '\n' + notes + '\n' : '\n';
        const MARKER = '<!-- TASK_NOTES -->';
        const idx = s.indexOf(MARKER);
        if (idx >= 0) {
            // Keep everything through the marker; swap only what follows it.
            const head = s.slice(0, idx + MARKER.length);
            return head + notesTail;
        }
        // No marker → legacy note. Preserve frontmatter, then inject the chrome +
        // marker (via TaskEntity when available; otherwise a byte-identical inline
        // fallback so an edit still un-bares a note even on cold-load), then notes.
        const m = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/.exec(s);
        const header = m ? m[1] : '';
        const chrome = TaskDialog._chromeBody();
        if (!header) {
            // No frontmatter either — chrome + marker + notes only.
            return chrome + (notes ? notes + '\n' : '');
        }
        return header + '\n' + chrome + (notes ? notes + '\n' : '');
    }

    /**
     * The canonical CHROME body for a task note. Prefers the TaskEntity instance
     * (single source of truth) and falls back to a BYTE-IDENTICAL inline copy so
     * _replaceBody's legacy path still works if customJS isn't ready. Keep this
     * in lockstep with TaskEntity._chromeBody + the install heal.
     */
    static _chromeBody() {
        const TE = TaskDialog._taskEntity();
        if (TE && typeof TE._chromeBody === 'function') {
            try { return TE._chromeBody(); } catch (_e) { /* fall through */ }
        }
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
}
