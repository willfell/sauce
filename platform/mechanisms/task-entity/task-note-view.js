/**
 * TaskNoteView (CustomJS) — the clean, native-Obsidian card that a task note
 * renders in its own body. Fourth class of the task-entity mechanism (after
 * TaskEntity, TaskDialog, TaskTodayList). Without it a `type: task` note opens
 * bare; TaskNoteView turns the note into a real page:
 *
 *   - a HEADER block: a color-coded status pill (OPEN / DONE / DELETED) + the
 *     prominent task title,
 *   - a "DETAILS" section: a labelled row PER SET FIELD only, with HUMAN dates
 *     (never a raw ISO timestamp) + a muted relative hint ("Today", "in 8 days"),
 *     an overdue-red Due date, a colored Priority badge, and a clickable Project
 *     link,
 *   - a "SOURCE" line ("From <link>") when a source note is set,
 *   - a full-width primary "Edit task" button that opens the TaskDialog in edit
 *     mode.
 *
 * The user's freeform notes render natively BELOW this widget (below the
 * `<!-- TASK_NOTES -->` marker); the card ends cleanly so those flow beneath.
 *
 * Invoked via customjs-guard on the task note's body (the chrome that
 * TaskEntity.composeNote / the install heal write), so its entry method is the
 * instance `render(dv)`.
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the note
 * is indexed. We resolve the page via the render-safe mechanism
 * (window.customJS?.RenderSafe?.page(dv), optional-chained so a TDZ'd customJS
 * never throws) and read its frontmatter defensively — one bad/absent field must
 * not throw out of render. Falls back to dv.current() when RenderSafe isn't
 * registered yet.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "\nreturn TaskNoteView;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskNoteView._fieldRows(task)          → [{ label, value }, …] SET fields only
 *   TaskNoteView._humanDate(value,todayStr)→ { text, relative } (pure date math)
 *   TaskNoteView._priorityMeta(priority)   → { label, color } | null
 *
 * Instance API (browser-side):
 *   TaskNoteView.render(dv)   ← the customjs-guard entry point
 */
class TaskNoteView {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _fieldRows(task) { return TaskNoteView._fieldRows(task); }
    _subtaskProgressText(subtasks) { return TaskNoteView._subtaskProgressText(subtasks); }
    _humanDate(value, todayStr) { return TaskNoteView._humanDate(value, todayStr); }
    _priorityMeta(priority) { return TaskNoteView._priorityMeta(priority); }
    _linkEntries(task) { return TaskNoteView._linkEntries(task); }
    _renderInlineMarkdown(el, mdText, sourcePath) { return TaskNoteView._renderInlineMarkdown(el, mdText, sourcePath); }
    _renderInlineLinksLocal(el, mdText, sourcePath) { return TaskNoteView._renderInlineLinksLocal(el, mdText, sourcePath); }

    // ---------- Static pure helpers ----------

    /**
     * Build the metadata rows to render for a task, INCLUDING ONLY fields that
     * are actually set (non-empty). Accepts either a parseNote() result or a raw
     * frontmatter object (Scheduled / Due / Priority / Project). Project is
     * displayed with any surrounding `[[ ]]` stripped. Pure + null-tolerant —
     * a null/empty task yields []. Returns [{ label, value }, …].
     */
    static _fieldRows(task) {
        const t = task || {};
        const rows = [];
        const val = (v) => {
            if (v == null) return '';
            const s = String(v).trim();
            return s;
        };
        const due = val(t.due);
        const recur = val(t.recurrence);
        const prio = val(t.priority);
        let proj = val(t.project);
        const pm = /^\[\[([^\]]+)\]\]$/.exec(proj);
        if (pm) proj = pm[1];
        if (due) rows.push({ label: 'Due', value: due });
        if (recur) rows.push({ label: 'Repeats', value: recur });
        if (prio) rows.push({ label: 'Priority', value: prio });
        if (proj) rows.push({ label: 'Project', value: proj });
        return rows;
    }

    /**
     * Build the "N/M subtasks done" progress string from a parsed-task array
     * (TaskEntity.parseNote output for each child). Empty/null input -> ''
     * (caller skips rendering the line entirely). Pure, never throws.
     */
    static _subtaskProgressText(subtasks) {
        const list = Array.isArray(subtasks) ? subtasks : [];
        if (!list.length) return '';
        const done = list.filter(t => t && t.status === 'done').length;
        return done + '/' + list.length + ' subtasks done';
    }

    /**
     * Parse a `YYYY-MM-DD` (or ISO / Luxon-ish) value into { y, m, d } integers,
     * or null when it isn't a recognizable date. PURE — never touches new Date /
     * Date.now. Accepts a leading date within a longer ISO timestamp so a raw
     * Dataview value like "2026-07-02T00:00:00.000-06:00" still coerces.
     */
    static _ymd(value) {
        if (value == null) return null;
        let s = '';
        if (typeof value === 'string') s = value.trim();
        else if (typeof value.toISODate === 'function') { s = value.toISODate() || ''; }
        else if (typeof value.toFormat === 'function') { s = value.toFormat('yyyy-MM-dd'); }
        else if (typeof value.format === 'function') { s = value.format('YYYY-MM-DD'); }
        else s = String(value);
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (!m) return null;
        return { y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10) };
    }

    /**
     * Convert a { y, mo, d } (1-based month) to an absolute DAY NUMBER — days
     * since a fixed epoch — via a pure civil-from-days algorithm (Howard Hinnant's
     * days_from_civil). Deterministic, leap-year correct, and NEVER uses new Date.
     * Used only for signed date differences (relative hint) + weekday.
     */
    static _dayNumber(ymd) {
        if (!ymd) return null;
        let y = ymd.y;
        const m = ymd.mo;
        const d = ymd.d;
        y -= m <= 2 ? 1 : 0;
        const era = Math.floor((y >= 0 ? y : y - 399) / 400);
        const yoe = y - era * 400;                                   // [0, 399]
        const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
        const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
        return era * 146097 + doe - 719468; // days since 1970-01-01 (0 == Thursday)
    }

    /**
     * Format a date-ish value into a human string + a relative hint, PURELY (no
     * wall clock). `value` may be a `YYYY-MM-DD` string, a longer ISO timestamp,
     * or a Luxon/moment-like object; `todayStr` (optional) is a `YYYY-MM-DD`
     * anchor for the relative hint. Returns:
     *   { text: "Thu, Jul 2, 2026", relative: "Today"|"Tomorrow"|"Yesterday"
     *                                          |"in N days"|"N days ago"|"" }
     * Unparseable / blank value → { text: '', relative: '' }. When todayStr is
     * absent or unparseable the text still formats and relative is "".
     */
    static _humanDate(value, todayStr) {
        const WD = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']; // dayNumber 0 == Thursday
        const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        try {
            const ymd = TaskNoteView._ymd(value);
            if (!ymd) return { text: '', relative: '' };
            const dn = TaskNoteView._dayNumber(ymd);
            let text = '';
            if (dn != null) {
                const wd = WD[((dn % 7) + 7) % 7];
                const mon = (ymd.mo >= 1 && ymd.mo <= 12) ? MO[ymd.mo - 1] : String(ymd.mo);
                text = wd + ', ' + mon + ' ' + ymd.d + ', ' + ymd.y;
            }
            let relative = '';
            const todayYmd = TaskNoteView._ymd(todayStr);
            if (todayYmd && dn != null) {
                const todayDn = TaskNoteView._dayNumber(todayYmd);
                if (todayDn != null) {
                    const delta = dn - todayDn;
                    if (delta === 0) relative = 'Today';
                    else if (delta === 1) relative = 'Tomorrow';
                    else if (delta === -1) relative = 'Yesterday';
                    else if (delta > 1) relative = 'in ' + delta + ' days';
                    else relative = (-delta) + ' days ago';
                }
            }
            return { text: text, relative: relative };
        } catch (_e) {
            return { text: '', relative: '' };
        }
    }

    /**
     * Map a priority string to a small badge descriptor { label, color } — the
     * label capitalized, the color an Obsidian token (with a hard fallback so it
     * renders even where the var is undefined). Unset / blank → null (no badge).
     * An unknown priority is tolerated: capitalized passthrough + neutral color.
     * Pure.
     */
    static _priorityMeta(priority) {
        const raw = String(priority == null ? '' : priority).trim();
        if (!raw) return null;
        const key = raw.toLowerCase();
        const cap = raw.charAt(0).toUpperCase() + raw.slice(1);
        const map = {
            low: { label: 'Low', color: 'var(--text-muted, #888)' },
            medium: { label: 'Medium', color: 'var(--text-normal, #ccc)' },
            high: { label: 'High', color: 'var(--color-orange, #d2884e)' },
            highest: { label: 'Highest', color: 'var(--color-red, var(--text-error, #e05252))' },
        };
        return map[key] || { label: cap, color: 'var(--text-normal, #ccc)' };
    }

    /**
     * Build the LINKS section entries for a task (FIX 5): an array of RENDERABLE
     * markdown link STRINGS read from the task's `links` frontmatter. Dataview may
     * hand back an array of plain strings AND/OR Link objects (a `[[wikilink]]`
     * inside a YAML array resolves to a Link object) — coerce each defensively:
     *   - a string            → trimmed, as-is (a note link `[[Note]]`, a web link
     *                           `[label](url)`, or `<url>`)
     *   - a Dataview Link obj  → `[[basename]]` (prefer TaskEntity._linkText for
     *                           the basename; local baseOf fallback on cold-load)
     * Blank / nullish entries are DROPPED; a null / empty / non-array task → [].
     * Pure + null-tolerant so one bad entry can't throw the card render.
     */
    static _linkEntries(task) {
        const t = task || {};
        const raw = t.links;
        if (!Array.isArray(raw)) return [];
        // Basename of a path-ish string (last `/` segment, trailing `.md` stripped).
        const baseOf = (s) => {
            let out = String(s == null ? '' : s).trim();
            const slash = out.lastIndexOf('/');
            if (slash >= 0) out = out.slice(slash + 1);
            return out.replace(/\.md$/i, '');
        };
        const out = [];
        for (const entry of raw) {
            if (entry == null) continue;
            let s = '';
            try {
                if (typeof entry === 'string') {
                    s = entry.trim();
                } else if (typeof entry === 'object'
                    && ('path' in entry || 'display' in entry || 'subpath' in entry)) {
                    // Prefer the shared coercion (basename); fall back to local baseOf.
                    let base = '';
                    try {
                        const TE = (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null;
                        if (TE && typeof TE._linkText === 'function') base = TE._linkText(entry);
                    } catch (_e) { base = ''; }
                    if (!base) {
                        base = (entry.path != null && String(entry.path).trim() !== '')
                            ? baseOf(entry.path)
                            : String(entry.display == null ? '' : entry.display).trim();
                    }
                    s = base ? '[[' + base + ']]' : '';
                } else {
                    s = String(entry).trim();
                }
            } catch (_e) { s = ''; }
            if (s) out.push(s);
        }
        return out;
    }

    /**
     * Render a LINKS-section entry (`[[Note]]` / `[label](url)` / bare `http(s)`)
     * as CLICKABLE (FIX 1). DELEGATES to the shared, deterministic
     * TaskTodayList.renderInlineLinks (builds REAL <a> anchors, no dependence on
     * Obsidian's MarkdownRenderer — which is NOT a global in the customJS eval
     * context, so the old MarkdownRenderer path always fell back to raw text).
     * When TaskTodayList isn't registered yet (cold load), a self-contained LOCAL
     * copy renders the same anchors so a link is always clickable. `sourcePath`
     * (the task-note path) resolves relative `[[wikilink]]` targets. Never throws.
     */
    static _renderInlineMarkdown(el, mdText, sourcePath) {
        if (!el) return;
        try {
            const TTL = (typeof window !== 'undefined' && window.customJS && window.customJS.TaskTodayList) || null;
            if (TTL && typeof TTL.renderInlineLinks === 'function') {
                TTL.renderInlineLinks(el, mdText, sourcePath);
                return;
            }
        } catch (_e) { /* fall through to the local copy */ }
        TaskNoteView._renderInlineLinksLocal(el, mdText, sourcePath);
    }

    /**
     * Self-contained cold-load fallback for _renderInlineMarkdown — a local copy of
     * TaskTodayList.renderInlineLinks used ONLY when TaskTodayList isn't registered
     * yet. Clears `el` and rebuilds it as plain-text nodes + real <a> anchors for
     * `[[wikilink]]` / `[label](url)` / bare `http(s)://…`. Never throws.
     */
    static _renderInlineLinksLocal(el, mdText, sourcePath) {
        if (!el) return;
        const str = String(mdText == null ? '' : mdText);
        const appRef = (typeof window !== 'undefined' && window.app)
            || (typeof app !== 'undefined' && app) || null;
        const appendText = (value) => {
            if (!value) return;
            if (typeof el.appendText === 'function') { el.appendText(value); return; }
            if (typeof el.createSpan === 'function') { el.createSpan({ text: value }); return; }
            el.textContent = (el.textContent || '') + value;
        };
        // Inline parser (mirror of TaskTodayList._parseInlineLinks).
        const parse = (s) => {
            const segs = [];
            const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]*)\]\(([^)\s]+)\)|(https?:\/\/[^\s)\]]+)/g;
            let last = 0; let m;
            while ((m = re.exec(s)) !== null) {
                if (m.index > last) segs.push({ type: 'text', value: s.slice(last, m.index) });
                if (m[1] != null) segs.push({ type: 'wikilink', target: m[1].trim(), alias: (m[2] != null ? m[2].trim() : null) });
                else if (m[3] != null && m[4] != null) segs.push({ type: 'mdlink', label: m[3], url: m[4] });
                else if (m[5] != null) segs.push({ type: 'url', url: m[5] });
                last = re.lastIndex;
            }
            if (last < s.length) segs.push({ type: 'text', value: s.slice(last) });
            return segs.length ? segs : [{ type: 'text', value: s }];
        };
        try {
            if (typeof el.empty === 'function') el.empty();
            else if ('textContent' in el) el.textContent = '';
            while (el.firstChild) el.removeChild(el.firstChild);
        } catch (_e) { /* clearing best-effort */ }
        try {
            for (const seg of parse(str)) {
                if (seg.type === 'text') { appendText(seg.value); continue; }
                if (seg.type === 'wikilink') {
                    const label = seg.alias || seg.target;
                    const a = el.createEl ? el.createEl('a', { cls: 'internal-link', text: label, href: '#' }) : null;
                    if (!a) { appendText(label); continue; }
                    try { if (a.dataset) a.dataset.href = seg.target; else a.setAttribute('data-href', seg.target); } catch (_e) {}
                    if (typeof a.addEventListener === 'function') {
                        a.addEventListener('click', (ev) => {
                            try { ev.preventDefault(); ev.stopPropagation(); } catch (_e) {}
                            try { if (appRef && appRef.workspace && appRef.workspace.openLinkText) appRef.workspace.openLinkText(seg.target, sourcePath || '', false); } catch (_e) {}
                        });
                    }
                    continue;
                }
                // mdlink / url
                const url = seg.url;
                const label = (seg.type === 'mdlink') ? seg.label : url;
                const a = el.createEl ? el.createEl('a', { text: label, href: url, attr: { target: '_blank', rel: 'noopener' } }) : null;
                if (!a) { appendText(label); continue; }
                if (typeof a.addEventListener === 'function') a.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} });
            }
        } catch (_e) {
            try { if (typeof el.setText === 'function') el.setText(str); else el.textContent = str; } catch (_e2) {}
        }
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Reads the current
     * page's task frontmatter and draws a sectioned card. Fully guarded — returns
     * quietly on cold-load (no throw), and each field is read defensively so one
     * bad value can't break the whole card.
     */
    async render(dv) {
        try {
            if (!dv || !dv.container) return;
            // Skip inside embeds — the host note renders its own card.
            if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

            // Resolve the embedding page (live or active-file shim). Optional
            // chaining so a TDZ'd customJS never throws.
            const page = (window.customJS && window.customJS.RenderSafe)
                ? window.customJS.RenderSafe.page(dv)
                : (dv.current && dv.current());
            if (!page) return;

            const c = dv.container;
            if (!c || typeof c.createEl !== 'function') return;

            // Prefer parseNote (coerces scheduled/due Luxon → YYYY-MM-DD strings);
            // fall back to reading the frontmatter directly if unavailable.
            let parsed = null;
            try {
                if (window.customJS && window.customJS.TaskEntity && typeof window.customJS.TaskEntity.parseNote === 'function') {
                    parsed = window.customJS.TaskEntity.parseNote(page);
                }
            } catch (_e) { parsed = null; }

            const str = (v) => (v == null ? '' : String(v));
            const task = {
                title: str(parsed ? parsed.title : page.title),
                status: str((parsed && parsed.status) || page.status || 'open'),
                due: str(parsed ? parsed.due : page.due),
                priority: str(parsed ? parsed.priority : page.priority),
                project: str(parsed ? parsed.project : page.project),
                source_note: str(parsed ? parsed.source_note : page.source_note),
                parent_task: str(parsed ? parsed.parent_task : page.parent_task),
                created_at: str(parsed ? parsed.created_at : page.created_at),
                // Structured card links (FIX 5) — read from the parsed view (already
                // normalized to a string array) or the raw page frontmatter (which
                // Dataview may surface as strings and/or Link objects).
                links: (parsed && Array.isArray(parsed.links)) ? parsed.links : page.links,
            };
            const filePath = (page.file && page.file.path) || (parsed && parsed.path) || null;
            let todayStr = '';
            try { todayStr = (window.moment && window.moment().format) ? window.moment().format('YYYY-MM-DD') : ''; } catch (_e) { todayStr = ''; }

            // ----- Card container -----
            const card = c.createEl('div', { cls: 'sauce-task-note-view' });
            card.style.cssText = [
                'display:flex', 'flex-direction:column', 'gap:14px',
                'margin:4px 0 10px', 'width:100%', 'box-sizing:border-box',
                'padding:16px', 'border:1px solid var(--background-modifier-border)',
                'border-radius:var(--radius-m, 8px)',
                'background:var(--background-secondary)',
            ].join(';') + ';';

            // ----- Header: title LEFT, status pill RIGHT (single flex row) -----
            // Title on the left (takes the row, wraps within its own column), pill
            // pinned top-right (never shrinks). align-items:flex-start keeps the pill
            // at the top of the first title line while a long title wraps below it.
            const header = card.createEl('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; gap:12px;';

            const status = task.status.trim().toLowerCase();

            // TITLE first (left column).
            const titleEl = header.createEl('div', { text: task.title || '(untitled)' });
            titleEl.style.cssText = 'flex:1 1 auto; min-width:0; font-size:1.3em; font-weight:700; line-height:1.25; color:var(--text-normal); overflow-wrap:break-word; word-break:break-word; text-align:left;';

            // PILL second (right column) — sits on the right, never shrinks. The
            // color-coding is preserved (OPEN accent / DONE green / DELETED muted).
            const pill = header.createEl('span', { text: this._statusLabel(task.status).toUpperCase() });
            const pillBase = 'flex-shrink:0; font-size:0.68em; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; padding:3px 10px; border-radius:999px; box-sizing:border-box; white-space:nowrap;';
            if (status === 'done') {
                pill.style.cssText = pillBase + 'background:var(--color-green, #4c9a5a); color:var(--text-on-accent, #fff);';
            } else if (status === 'deleted') {
                pill.style.cssText = pillBase + 'background:var(--background-modifier-border); color:var(--text-muted);';
            } else {
                pill.style.cssText = pillBase + 'background:var(--interactive-accent, #6a6abf); color:var(--text-on-accent, #fff);';
            }

            // ----- Divider -----
            const drawDivider = () => {
                const hr = card.createEl('div');
                hr.style.cssText = 'height:1px; background:var(--background-modifier-border); width:100%;';
            };

            // ----- DETAILS section (set fields only, human values) -----
            const overdue = (v) => {
                try {
                    if (status !== 'open') return false;
                    const d = TaskNoteView._ymd(v);
                    const t = TaskNoteView._ymd(todayStr);
                    if (!d || !t) return false;
                    return TaskNoteView._dayNumber(d) < TaskNoteView._dayNumber(t);
                } catch (_e) { return false; }
            };

            const hasDue = !!task.due;
            const prioMeta = TaskNoteView._priorityMeta(task.priority);
            // Clean, comparable link target for the Project row. Prefer
            // TaskEntity._linkText (coerces a Dataview Link object, a
            // `[[path/to/Note.md|alias]]`, or a bare string to the note BASENAME);
            // optional-chained so a TDZ'd customJS never throws, with the local
            // `^[[…]]$` strip as the cold-load fallback.
            let projName = '';
            try {
                const TE = window.customJS && window.customJS.TaskEntity;
                if (TE && typeof TE._linkText === 'function') {
                    projName = TE._linkText(parsed ? parsed.project : page.project);
                }
            } catch (_e) { projName = ''; }
            if (!projName) {
                projName = task.project.trim();
                const pm = /^\[\[([^\]]+)\]\]$/.exec(projName);
                if (pm) projName = pm[1];
            }
            projName = String(projName || '').trim();
            const hasProject = !!projName;
            const createdHuman = task.created_at ? TaskNoteView._humanDate(task.created_at, todayStr) : { text: '' };
            const hasCreated = !!createdHuman.text;

            // FIX 6 — DETAILS is gated on _fieldRows(task): the SINGLE source of truth
            // for what the section contains (Scheduled / Due / Priority / Project).
            // When _fieldRows is empty there are no set detail fields, so we render
            // NEITHER the DETAILS label NOR an empty grid — the card goes straight
            // from the header to SOURCE / LINKS / Edit. (Created is a trailing muted
            // stamp shown INSIDE the section when present; it never resurrects an
            // otherwise-empty DETAILS block.)
            const anyDetails = TaskNoteView._fieldRows(task).length > 0;
            if (anyDetails) {
                drawDivider();

                const sectionLabel = card.createEl('div', { text: 'DETAILS' });
                sectionLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';

                const grid = card.createEl('div');
                grid.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

                // Build one label→value row.
                const addRow = (label, buildValue) => {
                    try {
                        const row = grid.createEl('div');
                        row.style.cssText = 'display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px;';
                        const lab = row.createEl('span', { text: label });
                        lab.style.cssText = 'flex:0 0 84px; min-width:84px; font-size:0.72em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);';
                        const valWrap = row.createEl('span');
                        valWrap.style.cssText = 'flex:1 1 auto; min-width:0; font-size:0.95em; color:var(--text-normal); overflow-wrap:break-word; word-break:break-word;';
                        buildValue(valWrap);
                    } catch (_e) { /* one bad row must not break the card */ }
                };

                // Due — human date; overdue+open → text-error; muted relative hint.
                if (hasDue) {
                    addRow('Due', (wrap) => {
                        const h = TaskNoteView._humanDate(task.due, todayStr);
                        const isOverdue = overdue(task.due);
                        const dueEl = wrap.createEl('span', { text: h.text || task.due });
                        if (isOverdue) dueEl.style.cssText = 'color:var(--text-error, #e05252); font-weight:600;';
                        if (h.relative) {
                            const rel = wrap.createEl('span', { text: ' (' + h.relative + ')' });
                            rel.style.cssText = (isOverdue ? 'color:var(--text-error, #e05252);' : 'color:var(--text-muted);') + ' font-size:0.9em;';
                        }
                    });
                }

                // Priority — colored badge.
                if (prioMeta) {
                    addRow('Priority', (wrap) => {
                        const badge = wrap.createEl('span', { text: prioMeta.label });
                        badge.style.cssText = 'display:inline-block; font-size:0.82em; font-weight:600; padding:1px 9px; border-radius:999px; border:1px solid ' + prioMeta.color + '; color:' + prioMeta.color + ';';
                    });
                }

                // Project — clickable internal link.
                if (hasProject) {
                    addRow('Project', (wrap) => {
                        const link = wrap.createEl('a', { text: projName });
                        link.classList.add('internal-link');
                        link.style.cssText = 'color:var(--link-color, var(--text-accent)); cursor:pointer; text-decoration:none;';
                        link.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            try {
                                if (window.app && window.app.workspace && typeof window.app.workspace.openLinkText === 'function') {
                                    window.app.workspace.openLinkText(projName, filePath || '', false);
                                }
                            } catch (_e) { /* open best-effort */ }
                        });
                    });
                }

                // Created — small muted human date (bottom of the section).
                if (hasCreated) {
                    addRow('Created', (wrap) => {
                        wrap.style.cssText = 'flex:1 1 auto; min-width:0; font-size:0.82em; color:var(--text-muted);';
                        wrap.createEl('span', { text: createdHuman.text });
                    });
                }
            }

            // ----- SOURCE line ("From <link>") -----
            if (task.source_note) {
                try {
                    // Clean, comparable link target for the source meeting. Prefer
                    // TaskEntity._linkText (Link object / path / `[[…|alias]]` →
                    // BASENAME); optional-chained for cold-load, with the local
                    // wikilink strip as the fallback.
                    let target = '';
                    try {
                        const TE = window.customJS && window.customJS.TaskEntity;
                        if (TE && typeof TE._linkText === 'function') target = TE._linkText(task.source_note);
                    } catch (_e) { target = ''; }
                    if (!target) target = this._stripWikilink(task.source_note);
                    if (target) {
                        drawDivider();
                        const fromRow = card.createEl('div');
                        fromRow.style.cssText = 'font-size:0.88em; color:var(--text-muted); display:flex; align-items:center; gap:5px; flex-wrap:wrap;';
                        fromRow.createEl('span', { text: 'From' });
                        const link = fromRow.createEl('a', { text: target });
                        link.classList.add('internal-link');
                        link.style.cssText = 'color:var(--link-color, var(--text-accent)); cursor:pointer; text-decoration:none;';
                        link.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            try {
                                if (window.app && window.app.workspace && typeof window.app.workspace.openLinkText === 'function') {
                                    window.app.workspace.openLinkText(target, filePath || '', false);
                                }
                            } catch (_e) { /* open best-effort */ }
                        });
                    }
                } catch (_e) { /* source link best-effort */ }
            }

            // ----- "Part of" — a subtask's own note links back to its parent -----
            const isSubtask = !!task.parent_task;
            if (isSubtask) {
                try {
                    drawDivider();
                    const partOfRow = card.createEl('div');
                    partOfRow.style.cssText = 'font-size:0.88em; color:var(--text-muted); display:flex; align-items:center; gap:5px; flex-wrap:wrap;';
                    partOfRow.createEl('span', { text: 'Part of' });
                    const parentLink = partOfRow.createEl('a', { text: task.parent_task });
                    parentLink.classList.add('internal-link');
                    parentLink.style.cssText = 'color:var(--link-color, var(--text-accent)); cursor:pointer; text-decoration:none;';
                    parentLink.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        try {
                            if (window.app && window.app.workspace && typeof window.app.workspace.openLinkText === 'function') {
                                window.app.workspace.openLinkText(task.parent_task, filePath || '', false);
                            }
                        } catch (_e) { /* open best-effort */ }
                    });
                } catch (_e) { /* part-of link best-effort */ }
            }

            // ----- LINKS section (FIX 5) — structured links rendered INSIDE the card -----
            // Each entry is a markdown link string ([[Note]] / [label](url) / <url>)
            // rendered as CLICKABLE markdown so the user's added links live neatly in
            // the card (not as raw text at the bottom of the note). One bad entry
            // can't throw the card — _linkEntries + the per-entry try/catch guard it.
            try {
                const linkEntries = TaskNoteView._linkEntries(task);
                if (linkEntries.length) {
                    drawDivider();
                    const linksLabel = card.createEl('div', { text: 'LINKS' });
                    linksLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';
                    const linksWrap = card.createEl('div');
                    linksWrap.style.cssText = 'display:flex; flex-direction:column; gap:6px;';
                    for (const entry of linkEntries) {
                        try {
                            const row = linksWrap.createEl('div');
                            row.style.cssText = 'font-size:0.95em; line-height:1.35; color:var(--text-normal); overflow-wrap:break-word; word-break:break-word;';
                            TaskNoteView._renderInlineMarkdown(row, entry, filePath || '');
                        } catch (_e) { /* one bad link must not break the card */ }
                    }
                }
            } catch (_e) { /* LINKS section best-effort */ }

            // ----- SUBTASKS — only meaningful when NOT itself a subtask (one level
            // of nesting only, per design). Live-queries spice/tasks/ for every open
            // child whose parent_task points at THIS note, reuses the shared
            // TaskTodayList.renderTaskRow for each row (same checkbox/edit/delete/
            // badge behavior as every other task surface), and offers an inline
            // one-gesture "+ Add subtask" quick-create.
            if (!isSubtask && filePath) {
                try {
                    const thisBasename = filePath.split('/').pop().replace(/\.md$/i, '');
                    let allSubtasks = [];
                    try {
                        const raw = dv.pages('"spice/tasks"').where(p => {
                            if (!p || p.type !== 'task' || !p.file || !p.file.path) return false;
                            if (p.file.path.includes('/_trash/')) return false;
                            let pt = '';
                            try {
                                const TE2 = window.customJS && window.customJS.TaskEntity;
                                pt = (TE2 && typeof TE2._linkText === 'function') ? TE2._linkText(p.parent_task) : String(p.parent_task || '');
                            } catch (_e) { pt = ''; }
                            return pt === thisBasename;
                        });
                        const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
                        const TEsub = window.customJS && window.customJS.TaskEntity;
                        if (TEsub && typeof TEsub.parseNote === 'function') {
                            for (const child of arr) {
                                try {
                                    const parsedChild = TEsub.parseNote(child);
                                    if (parsedChild) allSubtasks.push(parsedChild);
                                } catch (_e) { /* one malformed child must not brick the task note */ }
                            }
                        }
                    } catch (_e) { allSubtasks = []; }
                    // FIX: only OPEN subtasks are rendered as rows. Without this
                    // filter, a just-completed subtask (moved to _done/, but still
                    // under spice/tasks/ so still fetched above) reappears unchecked
                    // on Dataview's next auto-refresh, and a second click calls
                    // markDone on the now-stale path — "task file not found" error.
                    // allSubtasks (open + done) still feeds the N/M progress count
                    // below, which is correct as-is.
                    const openSubtasks = allSubtasks.filter(t => {
                        if (!t || t.status !== 'open') return false;
                        const childPath = String(t.path || '');
                        return !childPath.includes('/_done/') && !childPath.includes('/_trash/');
                    });

                    drawDivider();
                    const subHeadRow = card.createEl('div');
                    subHeadRow.style.cssText = 'display:flex; align-items:baseline; justify-content:space-between; gap:8px;';
                    const subLabel = subHeadRow.createEl('div', { text: 'SUBTASKS' });
                    subLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';
                    const progressText = TaskNoteView._subtaskProgressText(allSubtasks);
                    if (progressText) {
                        const prog = subHeadRow.createEl('span', { text: progressText });
                        prog.style.cssText = 'font-size:0.78em; color:var(--text-muted);';
                    }

                    const subList = card.createEl('div');
                    subList.style.cssText = 'display:flex; flex-direction:column; gap:2px;';
                    const TTL = window.customJS && window.customJS.TaskTodayList;
                    if (TTL && typeof TTL.renderTaskRow === 'function') {
                        for (const st of openSubtasks) {
                            try { TTL.renderTaskRow(subList, st, null); } catch (_e) {}
                        }
                    }

                    const addRow = card.createEl('div');
                    addRow.style.cssText = 'display:flex; gap:8px; margin-top:2px;';
                    const addInput = addRow.createEl('input', { type: 'text' });
                    addInput.placeholder = '+ Add subtask…';
                    addInput.style.cssText = 'flex:1 1 auto; min-width:0; box-sizing:border-box; padding:6px 10px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:var(--radius-s,6px); color:var(--text-normal,#ddd); font-size:13px;';
                    let addSequence = 0;
                    const doAdd = async () => {
                        const title = String(addInput.value || '').trim();
                        if (!title) return;
                        const TD = window.customJS && window.customJS.TaskDialog;
                        if (!TD || typeof TD.createQuick !== 'function' || typeof TD.prepareQuick !== 'function') {
                            try { addInput.focus(); } catch (_e) {}
                            return;
                        }
                        const sequence = ++addSequence;
                        const quickOpts = { title, parent_task: '[[' + thisBasename + ']]' };
                        let plan = null;
                        try { plan = TD.prepareQuick(quickOpts); } catch (_e) { plan = null; }
                        if (!plan) {
                            try { addInput.focus(); } catch (_e) {}
                            return;
                        }
                        const optimisticTask = (plan && plan.task) || {
                            title, status: 'open', path: '', parent_task: quickOpts.parent_task,
                        };
                        const RS = window.customJS && window.customJS.RenderSafe;
                        if (RS && typeof RS.mutateStructure === 'function'
                            && TTL && typeof TTL.renderTaskRow === 'function') {
                            try {
                                const mutation = await RS.mutateStructure({
                                    path: filePath,
                                    failureMessage: 'Could not create subtask',
                                    apply: () => {
                                        const node = TTL.renderTaskRow(subList, optimisticTask, null);
                                        addInput.value = '';
                                        try { addInput.focus(); } catch (_e) {}
                                        return { parent: subList, node, focusTarget: addInput, title, sequence };
                                    },
                                    write: async () => {
                                        const created = await TD.createQuick({ plan: plan || undefined, title,
                                            parent_task: quickOpts.parent_task, reconcile: false });
                                        if (!created || created.ok !== true) {
                                            try { if (plan && typeof TD.releaseQuickPlan === 'function') TD.releaseQuickPlan(plan); } catch (_e) {}
                                            throw new Error('subtask create did not commit');
                                        }
                                        return created;
                                    },
                                    rollback: (receipt) => {
                                        try { if (receipt && receipt.node && receipt.node.parentNode) receipt.node.remove(); } catch (_e) {}
                                        if (receipt && receipt.sequence === addSequence && !String(addInput.value || '')) {
                                            addInput.value = receipt.title;
                                        }
                                        try { addInput.focus(); } catch (_e) {}
                                    },
                                });
                                if (!mutation || mutation.ok !== true) {
                                    try { if (plan && typeof TD.releaseQuickPlan === 'function') TD.releaseQuickPlan(plan); } catch (_e) {}
                                }
                            } catch (_e) {
                                try { if (plan && typeof TD.releaseQuickPlan === 'function') TD.releaseQuickPlan(plan); } catch (_e2) {}
                                try { addInput.focus(); } catch (_e2) {}
                            }
                        } else {
                            try {
                                const created = await TD.createQuick({ plan: plan || undefined, title,
                                    parent_task: quickOpts.parent_task, reconcile: false });
                                if (!created || created.ok !== true) {
                                    try { if (plan && typeof TD.releaseQuickPlan === 'function') TD.releaseQuickPlan(plan); } catch (_e) {}
                                    return;
                                }
                                addInput.value = '';
                            } catch (_e) {
                                try { if (plan && typeof TD.releaseQuickPlan === 'function') TD.releaseQuickPlan(plan); } catch (_e2) {}
                            }
                            try { addInput.focus(); } catch (_e) {}
                        }
                    };
                    addInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); doAdd(); } });

                    // ----- Completed subtasks — collapsible history (mirrors
                    // TaskDoneTodayList's exact convention: reuse the shared
                    // renderTaskRow for a uniform row, then pre-check the
                    // checkbox afterward since renderTaskRow always starts
                    // unchecked). Uses allSubtasks (unfiltered — open+done),
                    // NOT openSubtasks, so a completed subtask shows up here
                    // instead of vanishing with no trace. Rendered only when
                    // there's at least one done subtask — no empty clutter.
                    const doneSubtasks = allSubtasks.filter(t => t && t.status === 'done');
                    if (doneSubtasks.length) {
                        const doneDetails = card.createEl('details');
                        doneDetails.setAttribute('open', '');
                        doneDetails.style.cssText = 'width:100%; box-sizing:border-box; margin-top:6px;';
                        const doneSummary = doneDetails.createEl('summary');
                        doneSummary.style.cssText = 'cursor:pointer; user-select:none; list-style:none; font-size:0.68em; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted); font-weight:600;';
                        doneSummary.textContent = 'Completed (' + doneSubtasks.length + ')';
                        const doneList = doneDetails.createEl('div');
                        doneList.style.cssText = 'display:flex; flex-direction:column; gap:2px; margin-top:4px;';
                        if (TTL && typeof TTL.renderTaskRow === 'function') {
                            for (const st of doneSubtasks) {
                                try {
                                    const row = TTL.renderTaskRow(doneList, st, null);
                                    const cb = row && row.querySelector && row.querySelector('input[type="checkbox"]');
                                    if (cb) cb.checked = true;
                                } catch (_e) {}
                            }
                        }
                    }
                } catch (_e) { /* SUBTASKS section best-effort — never break the card */ }
            }

            // ----- Full-width "Mark done" button (OPEN tasks only) -----
            if (status === 'open') {
                drawDivider();
                const doneBtn = card.createEl('button', { text: 'Mark done' });
                doneBtn.style.cssText = [
                    'width:100%', 'box-sizing:border-box', 'min-height:38px',
                    'padding:9px 14px', 'border-radius:var(--radius-s, 4px)',
                    'border:1px solid var(--color-green, #4c9a5a)',
                    'background:var(--color-green, #4c9a5a)',
                    'color:var(--text-on-accent, #fff)', 'cursor:pointer',
                    'font-size:0.95em', 'font-weight:600',
                ].join(';') + ';';
                doneBtn.addEventListener('mouseenter', () => {
                    try { doneBtn.style.opacity = '0.85'; } catch (_e) {}
                });
                doneBtn.addEventListener('mouseleave', () => {
                    try { doneBtn.style.opacity = '1'; } catch (_e) {}
                });
                doneBtn.addEventListener('click', async () => {
                    try {
                        const TD = window.customJS && window.customJS.TaskDialog;
                        if (TD && typeof TD.markDone === 'function' && filePath) {
                            doneBtn.disabled = true;
                            doneBtn.textContent = 'Marking done…';
                            await TD.markDone(filePath);
                            try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                            try {
                                if (window.app && window.app.commands && typeof window.app.commands.executeCommandById === 'function') {
                                    window.app.commands.executeCommandById('dataview:dataview-force-refresh-views');
                                }
                            } catch (_e) {}
                        }
                    } catch (e) {
                        doneBtn.disabled = false;
                        doneBtn.textContent = 'Mark done';
                        try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
                    }
                });
            }

            // ----- Full-width primary "Edit task" button -----
            drawDivider();
            const editBtn = card.createEl('button', { text: 'Edit task' });
            editBtn.style.cssText = [
                'width:100%', 'box-sizing:border-box', 'min-height:38px',
                'padding:9px 14px', 'border-radius:var(--radius-s, 4px)',
                'border:1px solid var(--interactive-accent, #6a6abf)',
                'background:var(--interactive-accent, #6a6abf)',
                'color:var(--text-on-accent, #fff)', 'cursor:pointer',
                'font-size:0.95em', 'font-weight:600',
            ].join(';') + ';';
            editBtn.addEventListener('mouseenter', () => {
                try { editBtn.style.background = 'var(--interactive-accent-hover, var(--interactive-accent, #6a6abf))'; } catch (_e) {}
            });
            editBtn.addEventListener('mouseleave', () => {
                try { editBtn.style.background = 'var(--interactive-accent, #6a6abf)'; } catch (_e) {}
            });
            editBtn.addEventListener('click', () => {
                try {
                    if (window.customJS && window.customJS.TaskDialog && typeof window.customJS.TaskDialog.open === 'function' && filePath) {
                        window.customJS.TaskDialog.open({ edit: filePath });
                    }
                } catch (e) {
                    try { new Notice('Could not open task editor: ' + (e && (e.message || e)), 6000); } catch (_e) {}
                }
            });
        } catch (_e) {
            // Never throw out of render (cold-load safety).
        }
    }

    /** Map a raw status to a friendly pill label. */
    _statusLabel(status) {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'done') return 'Done';
        if (s === 'deleted') return 'Deleted';
        if (!s || s === 'open') return 'Open';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /** Strip surrounding `[[ ]]` from a wikilink for link display. */
    _stripWikilink(v) {
        const s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]+)\]\]$/.exec(s);
        return m ? m[1] : s;
    }
}
