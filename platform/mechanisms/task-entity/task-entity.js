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
    validatePayload(payload) { return TaskEntity.validatePayload(payload); }
    _toDateStr(v) { return TaskEntity._toDateStr(v); }
    _linkText(v) { return TaskEntity._linkText(v); }
    _normLinks(v) { return TaskEntity._normLinks(v); }
    _sanitizeTitle(title) { return TaskEntity._sanitizeTitle(title); }
    _uniqueName(baseFilename, existsFn) { return TaskEntity._uniqueName(baseFilename, existsFn); }
    _chromeBody() { return TaskEntity._chromeBody(); }

    // ---------- Static pure helpers ----------

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

    /**
     * Normalize any date-ish value to a `YYYY-MM-DD` string (or null). Dataview
     * parses an UNQUOTED frontmatter date (`scheduled: 2026-07-01`) into a Luxon
     * DateTime object, NOT a string — so comparing `page.scheduled` against a
     * string todayStr (buildBands / queryToday) always fails and every scheduled
     * task falls into neither band (empty daily list). parseNote runs every date
     * through this on READ so downstream comparisons see plain strings. Handles:
     * string (ISO or date), Luxon DateTime (toISODate / toFormat), moment
     * (format), and JS Date. Empty / null / unparseable → null.
     */
    static _toDateStr(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'string') {
            const s = v.trim();
            if (!s) return null;
            const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
            return m ? m[1] : s;
        }
        // Luxon DateTime (Dataview) — toISODate() → "yyyy-MM-dd" or null
        if (typeof v.toISODate === 'function') { const s = v.toISODate(); return s || null; }
        if (typeof v.toFormat === 'function') { return v.toFormat('yyyy-MM-dd'); }
        // moment
        if (typeof v.format === 'function') { const s = v.format('YYYY-MM-DD'); return s || null; }
        // JS Date
        if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
            const p = (n) => String(n).padStart(2, '0');
            return v.getFullYear() + '-' + p(v.getMonth() + 1) + '-' + p(v.getDate());
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
     * left as installer tokens. SpaceNavButtons gives vault-global nav; the
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
            'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '```dataviewjs\n' +
            'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });\n' +
            '```\n' +
            '\n' +
            '---\n' +
            '\n' +
            '<!-- TASK_NOTES -->\n';
    }

    /**
     * Compose a task note from a create payload. Returns:
     *   { path: "spice/tasks/<filename>", frontmatter: {...}, body: <chrome> }
     *
     * Frontmatter keys are emitted in the canonical schema order. Absent
     * scheduled / due / completed_at are emitted as EMPTY STRINGS (not omitted)
     * so downstream edits (setting a date) are a simple in-place field write.
     * The body is the CHROME body (SpaceNavButtons + TaskNoteView + the
     * `<!-- TASK_NOTES -->` marker) so a freshly-created task note is never
     * bare; the caller appends any typed user notes BELOW the marker.
     *
     * payload = {
     *   title, status?, scheduled?, due?, priority?,
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
            scheduled: p.scheduled || '',
            due: p.due || '',
            priority: p.priority || '',
            project: project,
            project_slug: projectSlug,
            source: p.source || '',
            source_note: p.source_note || '',
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
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            scheduled: TaskEntity._toDateStr(p.scheduled),
            due: TaskEntity._toDateStr(p.due),
            priority: p.priority || '',
            project: p.project != null ? p.project : null,
            project_slug: p.project_slug != null ? p.project_slug : null,
            source: p.source != null ? p.source : null,
            // Dataview surfaces a `[[Meeting]]` frontmatter value as a Link OBJECT,
            // not a string. Coerce to a comparable basename so the meeting task-list
            // filter (source_note === meetingBasename) actually matches. project is
            // left as-is (TaskNoteView strips its brackets); the reliable project
            // filter uses project_slug (a plain string) above.
            source_note: p.source_note != null ? TaskEntity._linkText(p.source_note) : null,
            // Structured card links (FIX 5) — normalized to a clean string array so
            // TaskNoteView can render them inside the card. Dataview may hand back an
            // array of strings and/or Link objects; _normLinks coerces both.
            links: TaskEntity._normLinks(p.links),
            created_at: p.created_at != null ? p.created_at : null,
            completed_at: blankToNull(p.completed_at),
            path: path,
        };
    }

    /**
     * Partition a list of task-like objects (raw frontmatter or parseNote output)
     * relative to `todayStr` (YYYY-MM-DD). Only status==="open" tasks are
     * considered. Returns { today, overdue }:
     *   today   — scheduled === todayStr
     *   overdue — scheduled truthy AND scheduled < todayStr (string compare of
     *             zero-padded ISO dates is chronologically correct)
     * Future-scheduled and unscheduled open tasks appear in NEITHER bucket.
     */
    static queryToday(tasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(tasks) ? tasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            const sched = t.scheduled;
            if (!sched) continue;
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            // sched > todayStr (future) → excluded from both buckets.
        }
        return { today: today, overdue: overdue };
    }

    /**
     * Validate a create/edit payload. `title` (non-empty after trim) is
     * required. `scheduled` / `due`, when present, must be strict YYYY-MM-DD.
     */
    static validatePayload(payload) {
        if (!payload) return { valid: false, reason: 'empty payload' };
        if (!payload.title || !String(payload.title).trim()) {
            return { valid: false, reason: 'title required' };
        }
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (payload.scheduled && !DATE_RE.test(payload.scheduled)) {
            return { valid: false, reason: 'invalid scheduled date' };
        }
        if (payload.due && !DATE_RE.test(payload.due)) {
            return { valid: false, reason: 'invalid due date' };
        }
        return { valid: true };
    }
}
