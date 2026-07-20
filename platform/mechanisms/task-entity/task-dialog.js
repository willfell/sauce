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

    // ---------- Static pure helpers ----------

    /**
     * Seed a create form from the surface that opened the dialog.
     *   daily   → { due: today, source: "daily" }
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
                return { due: o.today || '', source: 'daily' };
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
     * Decide whether the dialog's "More options" section should start
     * EXPANDED: true iff any of Priority/Project/Repeats/Notes/Links already
     * has a value. Create mode always passes an all-blank state (nothing to
     * show yet) so this naturally returns false there. Pure, never throws.
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
            return '"' + s.replace(/"/g, '\\"') + '"';
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
     * edit-dialog's Done button uses (status=done + completed_at, then move to
     * spice/tasks/_done/). Consumed by surface widgets (TaskTodayList's row
     * checkbox) so a one-tap complete never opens the modal. Returns
     * { ok: true } on success or { ok: false, reason } so the caller can revert
     * its optimistic UI. Never throws.
     */
    async markDone(path) {
        try {
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            await this._markDone(app, file);
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        }
    }

    /**
     * Recoverable-delete a task by PATH (no dialog). Routes through the SAME
     * single-file _markDeleted internal that the edit-dialog's Delete button
     * uses (status=deleted, then move to spice/tasks/_trash/). Returns
     * { ok: true } / { ok: false, reason }. Never throws.
     */
    async markDeleted(path) {
        try {
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            await this._markDeleted(app, file);
            return { ok: true };
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
    async confirmDelete(path) {
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

                const handle = sauceModal.open({
                    doc,
                    title: 'Delete task?',
                    autofocus: '.sauce-task-confirm-cancel',
                    body: (body) => {
                        const copy = body.createEl('div', { cls: 'sauce-task-confirm-copy' });
                        copy.createSpan({ text: 'This moves ' });
                        copy.createEl('strong', { text: '“' + title + '”' });
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

        const defaults = editPath ? {} : TaskDialog.defaultsForSurface(opts);
        const state = {
            title: fm ? (fm.title || '') : '',
            due: fm ? (fm.due || '') : (defaults.due || ''),
            priority: fm ? (fm.priority || '') : (defaults.priority || ''),
            // project as a display name (strip [[ ]] if present)
            projectName: fm ? TaskDialog._stripWikilink(fm.project) : (defaults.project && defaults.project.name) || '',
            // trip linkage — parallel to project. On edit hydrate from the note's
            // trip / trip_slug frontmatter; on create seed from defaults.trip.
            tripName: fm ? TaskDialog._stripWikilink(fm.trip) : (defaults.trip && defaults.trip.name) || '',
            tripSlug: fm ? (fm.trip_slug || '') : (defaults.trip && defaults.trip.slug) || '',
            notes: '',
            // Structured card links (FIX 5) — load the edit file's `links[]` (via
            // TaskEntity._normLinks so a Dataview-array-of-Link-objects coerces to
            // clean strings); create mode starts empty. Rendered as removable chips.
            links: TaskDialog._loadLinks(fm),
            // carry create-only seeds forward into the payload
            source: fm ? (fm.source || '') : (defaults.source || 'manual'),
            source_note: fm ? (fm.source_note || '') : (defaults.source_note || ''),
            recurrence: fm ? (fm.recurrence || '') : '',
        };

        // ----- Shared SauceModal shell; TaskDialog owns only field internals. -----
        const doc = (typeof document !== 'undefined' && document) ? document : null;
        const sauceModal = (typeof globalThis !== 'undefined' && globalThis.customJS)
            ? globalThis.customJS.SauceModal : null;
        if (!doc || !sauceModal || typeof sauceModal.open !== 'function') {
            try { new Notice('TaskDialog: SauceModal unavailable'); } catch (_e) {}
            return;
        }
        let submitTask = async () => false;
        let saveBtn = null;
        const modalHandle = sauceModal.open({
            doc,
            title: editPath ? 'Edit Task' : 'New Task',
            buttons: [],
            // SauceModal listens in capture phase, so only the title field may
            // use Enter as the dialog-level Save gesture. Nested controls such
            // as the note filter and web-link mini-form own their own Enter
            // behavior and must not race a task save before target handlers run.
            onSubmit: (_handle, event) => event
                && (event.target === titleInput || event.target === saveBtn)
                ? submitTask()
                : false,
            closeOnSubmit: false,
        });
        if (!modalHandle) {
            try { new Notice('TaskDialog: could not open SauceModal'); } catch (_e) {}
            return;
        }
        const closeOverlay = () => modalHandle.close('task-dialog');
        const host = modalHandle.body;
        const fieldCss = 'width:100%; min-width:0; box-sizing:border-box; padding:7px 10px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:13px; line-height:1.4;';
        // Native iOS <input type="date"> has an intrinsic min-width and ignores
        // width:100% even with box-sizing+min-width:0 — the boxes overflow the
        // modal. `-webkit-appearance:none; appearance:none` strips the intrinsic
        // control chrome/sizing (the native date picker still opens on tap), so
        // the input finally respects the container width like the text fields.
        const dateCss = fieldCss + ' -webkit-appearance:none; appearance:none; max-width:100%; text-align:left;';
        const label = (text, container) => {
            const el = (container || host).createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.07em; font-weight:600; color:var(--text-muted, #999); margin-top:16px; margin-bottom:6px;';
            return el;
        };

        // Title
        label('Title');
        const titleInput = host.createEl('input', { type: 'text' });
        titleInput.style.cssText = fieldCss;
        titleInput.value = state.title;
        titleInput.oninput = () => { state.title = titleInput.value; updateSubmit(); };
        // Autofocus the title ONLY in create mode (FIX 4) — opening the dialog on an
        // existing task shouldn't grab focus (the title is already filled in).
        if (!editPath) setTimeout(() => titleInput.focus(), 50);

        // Due
        label('Due (optional)');
        const dueInput = host.createEl('input', { type: 'date' });
        dueInput.style.cssText = dateCss;
        dueInput.value = state.due;
        dueInput.onchange = () => { state.due = dueInput.value; updateSubmit(); };

        // ----- More options toggle (progressive disclosure) -----
        // Everything below (Repeats, Priority, Project, Notes, Links) lives
        // inside moreBox, which starts collapsed in create mode and starts
        // EXPANDED in edit mode when the task already has any of those fields
        // set (so existing data is never hidden by default).
        const moreToggleRow = host.createDiv();
        moreToggleRow.style.cssText = 'margin-top:14px;';
        const moreToggle = moreToggleRow.createEl('button', { text: 'More options ▾' });
        moreToggle.style.cssText = 'display:inline-flex; align-items:center; gap:4px; padding:2px 0; border:none; background:transparent; color:var(--text-muted,#999); font-size:11px; text-transform:uppercase; letter-spacing:0.06em; cursor:pointer;';
        try { moreToggle.setAttribute('type', 'button'); } catch (_e) {}

        const moreBox = host.createDiv();
        moreBox.style.cssText = 'overflow:hidden; max-height:0; opacity:0; transition:max-height 180ms ease, opacity 140ms ease; border-top:1px solid var(--background-modifier-border,#333); margin-top:0;';

        let moreExpanded = false;
        const setMoreExpanded = (expanded) => {
            moreExpanded = expanded;
            if (expanded) {
                moreBox.style.maxHeight = '2000px';
                moreBox.style.opacity = '1';
                moreBox.style.borderTopWidth = '1px';
                moreBox.style.marginTop = '10px';
                moreToggle.textContent = 'Less options ▴';
            } else {
                moreBox.style.maxHeight = '0';
                moreBox.style.opacity = '0';
                moreBox.style.borderTopWidth = '0';
                moreBox.style.marginTop = '0';
                moreToggle.textContent = 'More options ▾';
            }
        };
        moreToggle.onclick = () => setMoreExpanded(!moreExpanded);

        // Repeats — structured picker (dropdown + contextual day-of-week /
        // day-of-month controls). Composes the SAME RecurrenceParser grammar
        // string the backend already understands (TaskEntity.nextOccurrence,
        // _markDone's roll-forward) — no schema change, this is purely a
        // front-end grammar builder. state.recurrence stays the source of
        // truth written to frontmatter; state.recurrenceFreq/Days/Weeks/
        // DayOfMonth are picker-only UI state, recomposed on every change.
        label('Repeats (optional)', moreBox);
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

        const recurSelect = moreBox.createEl('select');
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

        const recurSubBox = moreBox.createDiv();
        recurSubBox.style.cssText = 'margin-top:8px;';
        const recurError = moreBox.createEl('div');
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
            updateSubmit();
        };

        const dayChipCss = 'flex:0 0 34px; box-sizing:border-box; text-align:center; padding:6px 0; border-radius:var(--radius-s,6px); font-size:12px; line-height:1; cursor:pointer; transition:background 120ms ease, color 120ms ease, border-color 120ms ease;';
        const dayChipOff = dayChipCss + ' border:1px solid var(--background-modifier-border,#444); background:transparent; color:var(--text-muted,#999);';
        const dayChipOn = dayChipCss + ' border:1px solid var(--interactive-accent,#6a6abf); background:var(--interactive-accent,#6a6abf); color:var(--text-on-accent,#fff); font-weight:600;';
        const DOW_LABELS = [
            { n: 0, l: 'S' }, { n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' },
            { n: 4, l: 'T' }, { n: 5, l: 'F' }, { n: 6, l: 'S' },
        ];

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
                const weeksLabel = weeksRow.createEl('span', { text: 'Every' });
                weeksLabel.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
                const weeksInput = weeksRow.createEl('input', { type: 'number' });
                weeksInput.style.cssText = 'width:52px; box-sizing:border-box; padding:5px 6px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:12px;';
                weeksInput.min = '1';
                weeksInput.max = '12';
                weeksInput.value = String(state.recurrenceWeeks || 1);
                weeksInput.onchange = () => {
                    const n = parseInt(weeksInput.value, 10);
                    state.recurrenceWeeks = Number.isInteger(n) && n >= 1 && n <= 12 ? n : 1;
                    weeksInput.value = String(state.recurrenceWeeks);
                    recomposeRecurrence();
                };
                const weeksLabel2 = weeksRow.createEl('span', { text: 'week(s)' });
                weeksLabel2.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
            } else if (state.recurrenceFreq === 'monthly') {
                const domRow = recurSubBox.createDiv();
                domRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
                const domLabel = domRow.createEl('span', { text: 'On day' });
                domLabel.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
                const domInput = domRow.createEl('input', { type: 'number' });
                domInput.style.cssText = 'width:60px; box-sizing:border-box; padding:5px 6px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:12px;';
                domInput.min = '1';
                domInput.max = '31';
                if (state.recurrenceDayOfMonth) domInput.value = String(state.recurrenceDayOfMonth);
                domInput.onchange = () => {
                    const n = parseInt(domInput.value, 10);
                    state.recurrenceDayOfMonth = (Number.isInteger(n) && n >= 1 && n <= 31) ? n : null;
                    recomposeRecurrence();
                };
                const domLabel2 = domRow.createEl('span', { text: 'of the month' });
                domLabel2.style.cssText = 'font-size:12px; color:var(--text-muted,#999);';
            }
        };
        renderRecurSubBox();

        recurSelect.onchange = () => {
            const opt = recurSelect.options[recurSelect.selectedIndex];
            state.recurrenceFreq = (opt && opt.value) || 'none';
            renderRecurSubBox();
            recomposeRecurrence();
        };

        // Priority chip row
        label('Priority', moreBox);
        const chipRow = moreBox.createDiv();
        chipRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px;';
        const chipOff = 'flex:1; min-width:52px; box-sizing:border-box; text-align:center; padding:7px 8px; border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); font-size:12px; line-height:1; cursor:pointer; background:transparent; color:var(--text-muted,#999); transition:background 120ms ease, color 120ms ease, border-color 120ms ease;';
        const chipOn = 'flex:1; min-width:52px; box-sizing:border-box; text-align:center; padding:7px 8px; border:1px solid var(--interactive-accent,#6a6abf); border-radius:var(--radius-s,6px); font-size:12px; line-height:1; cursor:pointer; background:var(--interactive-accent,#6a6abf); color:var(--text-on-accent,#fff); font-weight:600; transition:background 120ms ease, color 120ms ease, border-color 120ms ease;';
        const chips = [];
        for (const p of ['', 'low', 'medium', 'high', 'highest']) {
            const c = chipRow.createEl('div', { text: p || 'none' });
            c.style.cssText = state.priority === p ? chipOn : chipOff;
            chips.push({ el: c, val: p });
            c.onclick = () => {
                state.priority = p;
                for (const cc of chips) cc.el.style.cssText = cc.val === p ? chipOn : chipOff;
            };
        }

        // Project — dropdown of the vault's projects (restored parity with the old
        // ToDoCreateTask picker). Enumerated dependency-free via metadataCache
        // (no `dv` in a button-invoked dialog). First option is "— none —"; a
        // seeded/edited project not in the list is preserved via a temp option so
        // it's never silently lost.
        label('Project (optional)', moreBox);
        const projSelect = moreBox.createEl('select');
        projSelect.style.cssText = fieldCss;
        const projects = TaskDialog._loadProjectList(app);
        const noneOpt = projSelect.createEl('option', { text: '— none —' });
        noneOpt.value = '';
        const curName = (state.projectName || '').trim();
        let matched = !curName; // "none" pre-selected when there's no current project
        for (const p of projects) {
            const opt = projSelect.createEl('option', { text: p.name });
            opt.value = p.slug;
            if (curName && p.name === curName) { opt.selected = true; matched = true; }
        }
        // Preserve a seeded/edited project that isn't in the enumerated list.
        if (!matched && curName) {
            const tmp = projSelect.createEl('option', { text: curName });
            tmp.value = TaskDialog._slugify(curName);
            tmp.selected = true;
        }
        projSelect.onchange = () => {
            const opt = projSelect.options[projSelect.selectedIndex];
            state.projectName = (opt && opt.value) ? opt.text : '';
        };

        // Notes → note body (both modes). In edit mode we load the task file's
        // existing body (minus its frontmatter) just-in-time so notes/hyperlinks
        // can be added or edited on an existing task; the save path writes them
        // back into the task's OWN file only (single-file invariant intact).
        label('Notes (optional)', moreBox);
        const notesInput = moreBox.createEl('textarea');
        notesInput.style.cssText = fieldCss + ' min-height:60px; resize:vertical;';
        notesInput.value = state.notes;
        notesInput.oninput = () => { state.notes = notesInput.value; };
        if (editPath && editFile && app.vault && typeof app.vault.read === 'function') {
            app.vault.read(editFile).then((txt) => {
                // Load ONLY the user-notes portion (below <!-- TASK_NOTES -->), not
                // the regenerable chrome. A legacy note with no marker falls back
                // to the whole body (minus frontmatter) so nothing is lost.
                const body = TaskDialog._bodyNotesBelowMarker(txt);
                notesInput.value = body;
                state.notes = body;
            }).catch(() => { /* leave notes blank on read failure */ });
        }

        // ----- Structured LINKS (both modes) — FIX 5 -----
        // The ＋Link note / ＋Web link buttons no longer splice into the Notes
        // textarea; they PUSH a markdown link STRING onto state.links (via the pure
        // _addLink), which TaskNoteView renders INSIDE the card. The current links
        // show as small removable CHIPS (link text + an ✕). Insertion routes
        // through the PURE statics (_wikilink / _mdLink / _addLink / _removeLink)
        // so the browser shell stays thin. Everything is guarded — a bad DOM/vault
        // call never throws out of _render. Only ONE inserter is open at a time.
        try {
            label('Links (optional)', moreBox);

            // Chip list — one removable chip per entry in state.links, re-rendered
            // in place whenever the list changes.
            const chipsBox = moreBox.createDiv();
            chipsBox.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-bottom:2px;';
            const renderChips = () => {
                chipsBox.empty();
                if (!state.links.length) {
                    const empty = chipsBox.createDiv({ text: 'No links yet' });
                    empty.style.cssText = 'font-size:12px; color:var(--text-muted,#999); padding:2px 0;';
                    return;
                }
                state.links.forEach((entry, i) => {
                    const chip = chipsBox.createDiv();
                    chip.style.cssText = 'display:inline-flex; align-items:center; gap:6px; max-width:100%; box-sizing:border-box; padding:3px 6px 3px 10px; border:1px solid var(--background-modifier-border,#444); border-radius:999px; background:var(--background-secondary,#2a2a2a); font-size:12px; line-height:1.3; color:var(--text-normal,#ddd);';
                    const txt = chip.createEl('span', { text: entry });
                    txt.style.cssText = 'overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:280px;';
                    const x = chip.createEl('button', { text: '✕' });
                    x.setAttribute('aria-label', 'Remove link');
                    x.style.cssText = 'flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; padding:0; border:none; border-radius:999px; background:transparent; color:var(--text-muted,#999); font-size:11px; line-height:1; cursor:pointer;';
                    x.onmouseenter = () => { x.style.background = 'var(--background-modifier-hover,rgba(255,255,255,0.08))'; x.style.color = 'var(--text-error,#e05561)'; };
                    x.onmouseleave = () => { x.style.background = 'transparent'; x.style.color = 'var(--text-muted,#999)'; };
                    x.onclick = () => { state.links = TaskDialog._removeLink(state.links, i); renderChips(); };
                });
            };
            renderChips();

            const linkRow = moreBox.createDiv();
            linkRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;';
            // Small ghost buttons that match the footer button grammar (quiet,
            // native tokens, comfortable tap height).
            const GHOST_LINK = 'display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:30px; padding:5px 11px; border-radius:var(--radius-s,6px); font-size:12px; line-height:1; cursor:pointer; white-space:nowrap; border:1px solid var(--background-modifier-border,#444); background:transparent; color:var(--text-normal,#ddd); transition:background 120ms ease;';
            const mkGhost = (parent, text) => {
                const b = parent.createEl('button', { text });
                b.style.cssText = GHOST_LINK;
                b.onmouseenter = () => { b.style.background = 'var(--background-modifier-hover,rgba(255,255,255,0.06))'; };
                b.onmouseleave = () => { b.style.background = 'transparent'; };
                b.onfocus = () => { b.style.outline = '2px solid var(--interactive-accent,#6a6abf)'; b.style.outlineOffset = '1px'; };
                b.onblur = () => { b.style.outline = 'none'; };
                return b;
            };
            const noteBtn = mkGhost(linkRow, '＋ Link note');
            const webBtn = mkGhost(linkRow, '＋ Web link');

            // A single host div below the row that holds whichever inserter is open.
            const inserterBox = moreBox.createDiv();
            inserterBox.style.cssText = 'margin-top:8px;';
            let openKind = null;   // null | 'note' | 'web'
            const closeInserter = () => { inserterBox.empty(); openKind = null; };

            // Add `entry` to state.links (pure _addLink → new array), re-render the
            // chips, close the inserter. Deduped + trimmed by _addLink.
            const addLinkEntry = (entry) => {
                if (!entry) return;
                state.links = TaskDialog._addLink(state.links, entry);
                renderChips();
                closeInserter();
            };

            // ----- Note picker (FIX 6 — sorted MOST-RECENTLY-EDITED first) -----
            const openNotePicker = () => {
                if (openKind === 'note') { closeInserter(); return; }
                closeInserter();
                openKind = 'note';
                // Build the candidate list ONCE (basename + mtime), then filter in JS
                // on each keystroke. Sorted by f.stat.mtime DESCENDING so the notes
                // the user most recently touched surface at the top of the picker.
                let names = [];
                try {
                    const files = (app.vault && typeof app.vault.getMarkdownFiles === 'function')
                        ? app.vault.getMarkdownFiles() : [];
                    names = TaskDialog._buildNoteLinkCandidates(files, editPath);
                } catch (_e) { names = []; }

                const filterInput = inserterBox.createEl('input', { type: 'text' });
                filterInput.placeholder = 'Filter notes (recent first)…';
                filterInput.style.cssText = fieldCss;
                const results = inserterBox.createDiv();
                results.style.cssText = 'margin-top:6px; max-height:160px; overflow-y:auto; border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px);';
                const renderResults = () => {
                    results.empty();
                    const q = (filterInput.value || '').trim().toLowerCase();
                    // Filter preserves the mtime order (filter, then slice — no re-sort).
                    const hits = (q ? names.filter((n) => n.toLowerCase().indexOf(q) >= 0) : names).slice(0, 30);
                    if (!hits.length) {
                        const none = results.createDiv({ text: q ? 'No matches' : 'No notes' });
                        none.style.cssText = 'padding:6px 8px; font-size:12px; color:var(--text-muted,#999);';
                        return;
                    }
                    for (const n of hits) {
                        const row = results.createDiv({ text: n });
                        row.style.cssText = 'padding:6px 8px; font-size:13px; cursor:pointer; color:var(--text-normal,#ddd);';
                        row.onmouseenter = () => { row.style.background = 'var(--background-modifier-hover,rgba(255,255,255,0.06))'; };
                        row.onmouseleave = () => { row.style.background = 'transparent'; };
                        row.onclick = () => { addLinkEntry(TaskDialog._wikilink(n)); };
                    }
                };
                filterInput.oninput = renderResults;
                renderResults();
                setTimeout(() => { try { filterInput.focus(); } catch (_e) {} }, 30);
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
                const insertBtn = mkGhost(inserterBox, 'Add link');
                insertBtn.style.cssText = GHOST_LINK + ' margin-top:8px;';
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
        } catch (_e) { /* link chips are best-effort; never abort the render */ }

        setMoreExpanded(TaskDialog._moreOptionsShouldStartExpanded(state));

        // ----- Footer -----
        // A two-group flex row: item actions (Open / Done / Delete) grouped on the
        // LEFT as quiet ghost buttons, then Cancel + Save (the accent anchor) on the
        // RIGHT. `justify-content: space-between` pushes the groups apart; each group
        // wraps as a unit on a narrow phone so nothing overflows at 360px.
        const footer = modalHandle.footer;

        const leftGroup = editPath ? footer.createDiv() : null;
        if (leftGroup) leftGroup.style.cssText = 'display:flex; align-items:center; gap:6px; flex-wrap:wrap;';
        const rightGroup = footer.createDiv();
        rightGroup.style.cssText = 'display:flex; align-items:center; justify-content:flex-end; gap:8px; flex-wrap:wrap; margin-left:auto;'
            + (!editPath ? ' width:100%;' : '');

        // Icons: crisp inline Lucide SVGs at 16px, currentColor so they theme with
        // the button's text (matches ToDoLeafActions' icon convention).
        const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
        const ICON = {
            check: svg('<polyline points="20 6 9 17 4 12"/>'),
            trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
            open: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
        };

        // Sauce-core owns button geometry, state, focus, and tone presentation.
        const mkBtn = (parent, opts) => {
            const variant = opts.variant || 'ghost';
            const cls = 'sauce-btn'
                + (variant === 'accent' ? ' sauce-btn-accent' : '')
                + (variant === 'danger' ? ' sauce-btn-danger' : '');
            const b = parent.createEl('button', { cls });
            try { b.setAttribute('type', 'button'); } catch (_e) {}
            if (opts.icon) { const ic = b.createSpan(); ic.style.cssText = 'display:inline-flex; align-items:center;'; ic.innerHTML = opts.icon; }
            if (opts.label) b.createSpan({ text: opts.label });
            return b;
        };

        // Open note + Done + Delete (edit mode only) sit on the LEFT as quiet actions.
        if (editPath) {
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
                try { await this._markDone(app, editFile); closeOverlay(); }
                catch (e) { try { new Notice('Done failed: ' + (e.message || e), 6000); } catch (_e) {} }
            };
            const delBtn = mkBtn(leftGroup, { label: 'Delete', icon: ICON.trash, variant: 'danger' });
            delBtn.onclick = async () => {
                try { await this._markDeleted(app, editFile); closeOverlay(); }
                catch (e) { try { new Notice('Delete failed: ' + (e.message || e), 6000); } catch (_e) {} }
            };
        }

        const cancelBtn = mkBtn(rightGroup, { label: 'Cancel', variant: 'ghost' });
        cancelBtn.onclick = () => closeOverlay();

        saveBtn = mkBtn(rightGroup, { label: 'Save', icon: ICON.check, variant: 'accent' });
        saveBtn.classList.add('mod-cta');
        const buildPayload = () => this._payloadFromState(state);
        const updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const v = TE ? TE.validatePayload(buildPayload()) : { valid: !!(state.title && state.title.trim()) };
            const valid = v.valid && TaskDialog._recurrencePickerValid(state);
            saveBtn.disabled = !valid;
        };
        submitTask = async () => {
            if (saveBtn.disabled) return false;
            try {
                if (editPath) await this._saveEdit(app, editFile, buildPayload(), state.notes);
                else await this._create(app, buildPayload(), state.notes);
                closeOverlay();
                return true;
            } catch (e) {
                try { new Notice('Save failed: ' + (e.message || e), 6000); } catch (_e) {}
                return false;
            }
        };
        saveBtn.onclick = (event) => modalHandle.submit(event);

        updateSubmit();
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
        const tripName = (s.tripName || '').trim();
        const tripSlug = (s.tripSlug || '').trim();
        if (tripName || tripSlug) payload.trip = { name: tripName || tripSlug, slug: tripSlug || TaskDialog._slugify(tripName) };
        return payload;
    }

    /**
     * CREATE — write ONE new file. Compose via TaskEntity, validate, then build
     * the final body as CHROME (TaskChromeBar + TaskNoteView + marker) with the
     * typed user notes appended BELOW the `<!-- TASK_NOTES -->` marker. The
     * filename is the readable "<title>.md"; since titles can collide, dedupe the
     * base against the vault (" 2", " 3", …) so we never clobber an existing task.
     * Never touches any other note.
     */
    async _create(app, payload, notes) {
        const TE = TaskDialog._taskEntity();
        if (!TE) { try { new Notice('task-entity mechanism not loaded'); } catch (_e) {} return; }
        // Stamp a moment so composeNote can derive created_at.
        const moment = (typeof window !== 'undefined' && window.moment) ? window.moment() : null;
        const payloadWithMoment = Object.assign({}, payload, { moment });
        const v = TE.validatePayload(payloadWithMoment);
        if (!v.valid) { try { new Notice('Invalid task: ' + v.reason); } catch (_e) {} return; }
        const { frontmatter, body } = TE.composeNote(payloadWithMoment);
        // Human-readable filename, deduped against the vault (title collisions).
        const base = TE.taskFilename(payloadWithMoment);
        const finalName = TE._uniqueName(base, (pp) => !!(app.vault
            && typeof app.vault.getAbstractFileByPath === 'function'
            && app.vault.getAbstractFileByPath(pp)));
        const path = 'spice/tasks/' + finalName;
        // Chrome first (from composeNote), then the typed notes below the marker.
        const chromeBody = body || '';
        const userNotes = String(notes == null ? '' : notes);
        const finalBody = userNotes ? chromeBody + userNotes + '\n' : chromeBody;
        const content = TaskDialog.renderNote(frontmatter, finalBody);
        await this._ensureFolder(app, 'spice/tasks');
        await app.vault.create(path, content);
        try { new Notice('Task created'); } catch (_e) {}
        try { this._reconcileAfterCreate(app, path); } catch (_e) {}
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
    async createQuick(opts) {
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
        await this._create(app, payload, '');
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
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.title = payload.title;
            fm.due = payload.due || '';
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
        try { new Notice('Task saved'); } catch (_e) {}
    }

    /**
     * DONE — set status=done + completed_at (processFrontMatter, this file only),
     * then move the file into spice/tasks/_done/ (renameFile). No other note read.
     */
    async _markDone(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
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
                return;
            }
            // Grammar unsupported / never fires within the horizon — fall through
            // to normal one-shot archiving rather than silently doing nothing.
        }

        const iso = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ')
            : new Date().toISOString();
        await app.fileManager.processFrontMatter(file, (fm2) => {
            fm2.status = 'done';
            fm2.completed_at = iso;
        });
        await this._ensureFolder(app, 'spice/tasks/_done');
        await app.fileManager.renameFile(file, TaskDialog.donePath(file.path));
        try { new Notice('Task done'); } catch (_e) {}
    }

    /**
     * DELETE (recoverable) — set status=deleted (processFrontMatter, this file
     * only), then move into spice/tasks/_trash/ (renameFile). No hard delete; the
     * note is recoverable. No other note read.
     */
    async _markDeleted(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.status = 'deleted';
        });
        await this._ensureFolder(app, 'spice/tasks/_trash');
        await app.fileManager.renameFile(file, TaskDialog.trashPath(file.path));
        try { new Notice('Task deleted'); } catch (_e) {}
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
