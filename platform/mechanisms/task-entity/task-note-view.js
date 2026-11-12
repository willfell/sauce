/**
 * TaskNoteView (CustomJS) — the clean, native-Obsidian card that a task note
 * renders in its own body. Fourth class of the task-entity mechanism (after
 * TaskEntity, TaskDialog, TaskTodayList). Without it a `type: task` note opens
 * bare; TaskNoteView turns the note into a real page:
 *
 *   - a HEADER: "Part of <parent>" on a subtask, the title, and one wrapping
 *     row of chips (status, due as "Due today" / "Overdue · N days", priority,
 *     repeats, a clickable project). The card's left edge carries the
 *     priority colour, as task rows do.
 *   - LINKS: one row per link, its label and the site it goes to,
 *   - SUBTASKS (top-level tasks): a progress bar, the open children as shared
 *     task rows, "+ Add subtask…", and the finished ones as done rows with
 *     Reopen (five, then "Show N more"),
 *   - a footer of Mark done (or Reopen once archived) beside Edit, and a quiet
 *     line: created, done, and the source note.
 *   Styles live in one injected stylesheet (_CSS) with phone rules, so the
 *   card fits a phone and follows the theme.
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

    // ---------- Card helpers (pure) ----------

    /**
     * Short calendar label for a date-ish value: "Nov 12", or "Nov 12, 2025"
     * when its year differs from todayStr's. Blank / unparseable → ''. Pure.
     */
    static _shortDate(value, todayStr) {
        const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const ymd = TaskNoteView._ymd(value);
        if (!ymd || ymd.mo < 1 || ymd.mo > 12) return '';
        const today = TaskNoteView._ymd(todayStr);
        const base = MO[ymd.mo - 1] + ' ' + ymd.d;
        return today && today.y !== ymd.y ? base + ', ' + ymd.y : base;
    }

    /**
     * The due chip for the card header: { text, tone } where tone is
     * 'danger' (an open task past its date), 'accent' (due today) or ''.
     * "Due today" / "Due tomorrow" / "Overdue · N days" / "Due Thu, Nov 12".
     * A done or deleted task never reads as overdue. No due → null. Pure.
     */
    static _dueChip(due, todayStr, status) {
        const ymd = TaskNoteView._ymd(due);
        if (!ymd) return null;
        const open = String(status || 'open').trim().toLowerCase() === 'open';
        const dn = TaskNoteView._dayNumber(ymd);
        const today = TaskNoteView._ymd(todayStr);
        const delta = today ? dn - TaskNoteView._dayNumber(today) : null;
        if (delta === 0) return { text: 'Due today', tone: open ? 'accent' : '' };
        if (delta === 1) return { text: 'Due tomorrow', tone: '' };
        if (delta != null && delta < 0 && open) {
            const n = -delta;
            return { text: 'Overdue · ' + n + (n === 1 ? ' day' : ' days'), tone: 'danger' };
        }
        const WD = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed'];
        const wd = WD[((dn % 7) + 7) % 7];
        return { text: 'Due ' + wd + ', ' + TaskNoteView._shortDate(due, todayStr), tone: '' };
    }

    /**
     * Subtask progress: { done, total, pct, text } with text "1 of 3 done"
     * ('' when there are none) and pct a whole number 0–100. Pure.
     */
    static _progress(subtasks) {
        const list = (Array.isArray(subtasks) ? subtasks : []).filter(Boolean);
        const total = list.length;
        const done = list.filter((t) => t.status === 'done').length;
        return {
            done, total,
            pct: total ? Math.round((done / total) * 100) : 0,
            text: total ? done + ' of ' + total + ' done' : '',
        };
    }

    /**
     * What a link entry points at: { kind: 'note' | 'web', host } where host is
     * the bare hostname of a web link ("github.com"). Pure; never throws.
     */
    static _linkMeta(entry) {
        const s = String(entry == null ? '' : entry).trim();
        if (/^\[\[/.test(s)) return { kind: 'note', host: '' };
        const m = /\]\((https?:\/\/[^)\s]+)\)/.exec(s) || /^<?(https?:\/\/[^\s>]+)>?$/.exec(s);
        if (!m) return { kind: 'note', host: '' };
        const host = /^https?:\/\/([^/?#:]+)/i.exec(m[1]);
        return { kind: 'web', host: host ? host[1].replace(/^www\./i, '') : '' };
    }

    /**
     * The card's footer buttons for a status and note path: an open task gets
     * Mark done + Edit; a done task gets Reopen + Edit; anything else gets Edit alone. Pure.
     */
    static _actionsFor(status, path) {
        const s = String(status || 'open').trim().toLowerCase();
        if (s === 'open') return ['done', 'edit'];
        if (s === 'done') return ['reopen', 'edit'];
        return ['edit'];
    }

    /** How long the Mark done celebration plays before the views refresh (ms). */
    static get _CELEBRATE_MS() { return 650; }

    /** Basename of a task path ("spice/tasks/_done/A.md" → "A"). Pure. */
    static _baseOf(path) {
        return String(path == null ? '' : path).split('/').pop().replace(/\.md$/i, '');
    }

    /**
     * Index parsed tasks for the card: { children, byName }. children maps a
     * parent to its subtasks (open and done): by the parent note's PATH when
     * the task carries a parent_path (folder-derived), by the parent's
     * basename otherwise (a flat note's parent_task link), so two parents
     * that share a name never share children. byName maps a basename to its
     * task. `linkText` turns a parent_task value into a basename. Read a
     * node's children with _kidsOf. Pure; never throws.
     */
    static _taskIndex(tasks, linkText) {
        const children = new Map();
        const byName = new Map();
        const toName = typeof linkText === 'function' ? linkText : (v) => String(v == null ? '' : v);
        for (const t of Array.isArray(tasks) ? tasks : []) {
            if (!t) continue;
            const name = TaskNoteView._baseOf(t.path);
            if (name && !byName.has(name)) byName.set(name, t);
            let parent = '';
            const parentPath = String(t.parent_path == null ? '' : t.parent_path).trim();
            if (parentPath) {
                parent = parentPath;
            } else {
                try { parent = String(toName(t.parent_task) || '').trim(); } catch (_e) { parent = ''; }
            }
            if (!parent || parent === name || parent === t.path) continue;
            if (!children.has(parent)) children.set(parent, []);
            children.get(parent).push(t);
        }
        return { children, byName };
    }

    /**
     * The subtasks of the note at `path`: its path key first, then its
     * basename key. Pure; never throws.
     */
    static _kidsOf(index, path) {
        const kids = index && index.children;
        if (!kids || typeof kids.get !== 'function' || !path) return [];
        return kids.get(path) || kids.get(TaskNoteView._baseOf(path)) || [];
    }

    /**
     * The chain of parents above a subtask, outermost first, ending with its
     * own parent: ["Launch", "Help Henry", "Review PR"]. Stops at a loop, at
     * `self`, or after five. Pure.
     */
    static _ancestors(parentName, byName, linkText, self) {
        const toName = typeof linkText === 'function' ? linkText : (v) => String(v == null ? '' : v);
        const chain = [];
        const seen = new Set(self ? [self] : []);
        let cur = String(parentName || '').trim();
        while (cur && !seen.has(cur) && chain.length < 5) {
            chain.unshift(cur);
            seen.add(cur);
            const t = byName && byName.get ? byName.get(cur) : null;
            let next = '';
            try { next = t ? String(toName(t.parent_task) || '').trim() : ''; } catch (_e) { next = ''; }
            cur = next;
        }
        return chain;
    }

    /**
     * Draw or update the header ring for a subtask progress. The first call
     * (applyValue false) builds the ring empty and sets its label; the second
     * sets the arc, so the arc sweeps in. Hidden with no subtasks. Never throws.
     */
    static _paintRing(ring, prog, applyValue) {
        try {
            if (!ring) return;
            if (!prog || !prog.total) { ring.style.display = 'none'; return; }
            ring.style.display = '';
            const C = 97.39;
            let arc = ring.querySelector ? ring.querySelector('.sauce-tnv-ring-arc') : null;
            if (!arc) {
                ring.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true">'
                    + '<circle class="sauce-tnv-ring-track" cx="18" cy="18" r="15.5"/>'
                    + '<circle class="sauce-tnv-ring-arc" cx="18" cy="18" r="15.5" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" transform="rotate(-90 18 18)"/>'
                    + '</svg><span class="sauce-tnv-ring-text"></span>';
                arc = ring.querySelector ? ring.querySelector('.sauce-tnv-ring-arc') : null;
            }
            const text = ring.querySelector ? ring.querySelector('.sauce-tnv-ring-text') : null;
            if (text) text.textContent = prog.pct + '%';
            ring.setAttribute('aria-label', prog.pct + '% of subtasks done');
            if (ring.dataset) ring.dataset.pct = String(prog.pct);
            if (applyValue && arc) arc.style.strokeDashoffset = String(Math.round(C * (1 - prog.pct / 100) * 100) / 100);
            if (prog.done === prog.total) ring.classList.add('is-complete');
            else if (ring.classList.remove) ring.classList.remove('is-complete');
        } catch (_e) { /* the ring is decoration */ }
    }

    static get _ICONS() {
        const svg = (d) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        return {
            check: svg('<path d="M20 6 9 17l-5-5"/>'),
            edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
            reopen: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
            up: svg('<path d="m18 15-6-6-6 6"/>'),
            web: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
            note: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
            repeat: svg('<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
        };
    }

    /**
     * The card stylesheet. Theme variables only, so it follows the active
     * theme. Phone rules sit under body.is-phone and a 480px query; the
     * button and input rules repeat their class to outrank a theme's phone
     * control height.
     */
    static get _CSS() {
        return [
            '.sauce-task-note-view { --tnv-prio: transparent; position: relative; display: flex; flex-direction: column; gap: 14px; width: 100%; box-sizing: border-box; margin: 4px 0 12px; padding: 18px 18px 14px 20px; border: 1px solid var(--background-modifier-border); border-radius: var(--sauce-radius-modal, 12px); background: var(--background-secondary); }',
            '.sauce-task-note-view::before { content: ""; position: absolute; left: -1px; top: 18px; bottom: 18px; width: 3px; border-radius: 0 3px 3px 0; background: var(--tnv-prio); pointer-events: none; }',
            '.sauce-task-note-view[data-priority="highest"], .sauce-task-note-view[data-priority="high"] { --tnv-prio: var(--color-red, #dc2626); }',
            '.sauce-task-note-view[data-priority="medium"] { --tnv-prio: var(--color-orange, #ea580c); }',
            '.sauce-task-note-view[data-priority="low"] { --tnv-prio: var(--text-faint, #888); }',
            '@keyframes sauce-tnv-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
            '@keyframes sauce-tnv-strike { to { background-size: 100% 2px; } }',
            '@keyframes sauce-tnv-burst { 0% { opacity: 0; transform: scale(0.4); } 45% { opacity: 1; transform: scale(1.12); } 70% { transform: scale(0.96); } 100% { opacity: 1; transform: scale(1); } }',
            '@keyframes sauce-tnv-ripple { from { opacity: 0.55; transform: scale(0.6); } to { opacity: 0; transform: scale(2.2); } }',
            '@keyframes sauce-tnv-glow { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-green, #4c9a5a) 45%, transparent); } 50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--color-green, #4c9a5a) 0%, transparent); } }',
            '@keyframes sauce-tnv-bump { 0% { filter: brightness(1); } 35% { filter: brightness(1.45) saturate(1.2); } 100% { filter: brightness(1); } }',
            '@keyframes sauce-tnv-sheen { from { transform: translateX(-100%); } to { transform: translateX(260%); } }',
            '.sauce-tnv-head { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }',
            '.sauce-tnv-head-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; }',
            '.sauce-tnv-parent { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; max-width: 100%; font-size: 0.8em; color: var(--text-muted); }',
            '.sauce-tnv-parent > svg { flex-shrink: 0; }',
            '.sauce-tnv-parent-name { max-width: 16em; color: var(--text-accent); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }',
            '.sauce-tnv-parent-sep { color: var(--text-faint); }',
            '.sauce-tnv-title { margin: 0; font-size: 1.35em; font-weight: 700; line-height: 1.25; color: var(--text-normal); overflow-wrap: anywhere; }',
            '.sauce-tnv-title-text { background-image: linear-gradient(currentColor, currentColor); background-repeat: no-repeat; background-position: 0 58%; background-size: 0 2px; }',
            '.sauce-task-note-view[data-status="done"] .sauce-tnv-title, .sauce-task-note-view[data-status="deleted"] .sauce-tnv-title { color: var(--text-muted); }',
            '.sauce-task-note-view[data-status="done"] .sauce-tnv-title-text { background-size: 100% 2px; }',
            '.sauce-task-note-view.is-completing .sauce-tnv-title { color: var(--text-muted); transition: color 300ms ease; }',
            '.sauce-task-note-view.is-completing .sauce-tnv-title-text { animation: sauce-tnv-strike 420ms var(--sauce-ease, ease) forwards; }',
            '.sauce-tnv-ring { position: relative; flex: 0 0 auto; width: 54px; height: 54px; }',
            '.sauce-tnv-ring > svg { display: block; width: 100%; height: 100%; }',
            '.sauce-tnv-ring-track { fill: none; stroke: var(--background-modifier-border); stroke-width: 3.4; }',
            '.sauce-tnv-ring-arc { fill: none; stroke: var(--color-green, #4c9a5a); stroke-width: 3.4; stroke-linecap: round; transition: stroke-dashoffset 900ms var(--sauce-ease, cubic-bezier(0.2, 0.9, 0.25, 1)); filter: drop-shadow(0 0 3px color-mix(in srgb, var(--color-green, #4c9a5a) 40%, transparent)); }',
            '.sauce-tnv-ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.74em; font-weight: 700; color: var(--text-normal); font-variant-numeric: tabular-nums; }',
            '.sauce-tnv-ring.is-complete .sauce-tnv-ring-text { color: var(--color-green, #4c9a5a); }',
            '.sauce-tnv-ring.is-complete > svg { animation: sauce-tnv-burst 520ms var(--sauce-spring, ease) both; }',
            '.sauce-tnv-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }',
            '.sauce-tnv-chip { box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; min-height: 24px; max-width: 100%; padding: 2px 10px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: var(--background-primary); color: var(--text-muted); font-size: 0.78em; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }',
            '.sauce-tnv-chip > svg { flex-shrink: 0; }',
            '.sauce-tnv-chip.is-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--interactive-accent); flex-shrink: 0; }',
            '.sauce-tnv-chip.is-status.is-done::before { background: var(--color-green, #4c9a5a); }',
            '.sauce-tnv-chip.is-status.is-deleted::before { background: var(--text-faint, #888); }',
            '.sauce-tnv-chip.is-accent { border-color: color-mix(in srgb, var(--interactive-accent) 55%, transparent); color: var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 12%, transparent); }',
            '.sauce-tnv-chip.is-danger { border-color: color-mix(in srgb, var(--color-red, #dc2626) 55%, transparent); color: var(--color-red, #dc2626); background: color-mix(in srgb, var(--color-red, #dc2626) 12%, transparent); }',
            '.sauce-tnv-chip.is-prio-highest, .sauce-tnv-chip.is-prio-high { color: var(--color-red, #dc2626); }',
            '.sauce-tnv-chip.is-prio-medium { color: var(--color-orange, #ea580c); }',
            'a.sauce-tnv-chip.is-project { color: var(--text-accent); cursor: pointer; }',
            '@media (hover: hover) { a.sauce-tnv-chip.is-project:hover, .sauce-tnv-link:hover, .sauce-tnv-parent:hover > .sauce-tnv-parent-name { border-color: var(--background-modifier-border-hover); text-decoration: none; filter: brightness(1.08); } }',
            '.sauce-tnv-section { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid var(--background-modifier-border); }',
            '.sauce-tnv-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }',
            '.sauce-tnv-label { font-size: 0.72em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }',
            '.sauce-tnv-count { font-size: 0.78em; color: var(--text-muted); font-variant-numeric: tabular-nums; }',
            '.sauce-tnv-links { display: flex; flex-direction: column; gap: 6px; }',
            '.sauce-tnv-link { box-sizing: border-box; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 10px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m, 8px); background: var(--background-primary); color: var(--text-muted); transition: border-color 120ms ease, filter 120ms ease; }',
            '.sauce-tnv-link > svg { flex-shrink: 0; color: var(--text-faint); }',
            '.sauce-tnv-link-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.92em; }',
            '.sauce-tnv-link-text a { color: var(--text-accent); text-decoration: none; }',
            '.sauce-tnv-link-host { flex-shrink: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.76em; color: var(--text-faint); }',
            '.sauce-tnv-progress { height: 6px; border-radius: 999px; background: var(--background-modifier-border); overflow: hidden; }',
            '.sauce-tnv-progress > span { position: relative; display: block; height: 100%; width: 0; overflow: hidden; border-radius: inherit; background: linear-gradient(90deg, var(--color-green, #4c9a5a), color-mix(in srgb, var(--color-green, #4c9a5a) 70%, #fff)); transition: width 620ms var(--sauce-ease, cubic-bezier(0.2, 0.9, 0.25, 1)); }',
            '.sauce-tnv-progress > span::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent); animation: sauce-tnv-sheen 2.6s ease-in-out 600ms infinite; }',
            '.sauce-tnv-progress.is-bump > span { animation: sauce-tnv-bump 640ms ease; }',
            '.sauce-tnv-subtasks { display: flex; flex-direction: column; gap: 0; }',
            '.sauce-tnv-nest { margin: 0 0 2px 16px; padding-left: 10px; border-left: 2px solid var(--background-modifier-border); }',
            '.sauce-tnv-row-in { animation: sauce-tnv-rise 360ms var(--sauce-ease, ease) both; }',
            '.sauce-tnv-empty { font-size: 0.85em; font-style: italic; color: var(--text-muted); }',
            'body .sauce-tnv-add.sauce-tnv-add { box-sizing: border-box; width: 100%; height: auto; min-height: 34px; padding: 6px 12px; border: 1px dashed var(--background-modifier-border-hover, var(--background-modifier-border)); border-radius: var(--radius-m, 8px); background: transparent; color: var(--text-normal); font-size: 0.9em; box-shadow: none; transition: border-color 120ms ease, background 120ms ease; }',
            'body .sauce-tnv-add.sauce-tnv-add:focus { border-style: solid; border-color: var(--interactive-accent); background: var(--background-primary); outline: none; }',
            '.sauce-tnv-done-list { display: flex; flex-direction: column; gap: 2px; }',
            '.sauce-tnv-done-list:not(:empty) { margin-top: 6px; }',
            '.sauce-tnv-done-list .sauce-today-done-row { padding: 4px 6px; }',
            'body .sauce-tnv-more.sauce-tnv-more { align-self: flex-start; height: auto; min-height: 0; padding: 2px 6px; border: none; background: none; box-shadow: none; color: var(--text-accent); font-size: 0.85em; cursor: pointer; }',
            '.sauce-tnv-actions { display: flex; gap: 8px; padding-top: 14px; border-top: 1px solid var(--background-modifier-border); }',
            '.sauce-tnv-actions > .sauce-btn { flex: 0 0 auto; }',
            '.sauce-tnv-actions > .sauce-btn.sauce-tnv-primary { flex: 1 1 auto; }',
            'body .sauce-btn.sauce-btn.sauce-btn.sauce-tnv-done { border-color: var(--color-green, #4c9a5a); background: var(--color-green, #4c9a5a); color: var(--text-on-accent, #fff); }',
            '@media (hover: hover) { body .sauce-btn.sauce-btn.sauce-btn.sauce-tnv-done:hover { border-color: var(--color-green, #4c9a5a); background: var(--color-green, #4c9a5a); color: var(--text-on-accent, #fff); filter: brightness(1.08); } }',
            'body .sauce-btn.sauce-btn.sauce-btn.sauce-tnv-reopen { border-color: var(--interactive-accent); color: var(--interactive-accent); }',
            '.sauce-tnv-done.is-completing > svg { animation: sauce-tnv-burst 420ms var(--sauce-spring, cubic-bezier(0.34, 1.56, 0.5, 1)) both; }',
            'body .sauce-btn.sauce-btn.sauce-btn.sauce-tnv-done.is-ready { animation: sauce-tnv-glow 1.8s ease-in-out infinite; }',
            '.sauce-tnv-burst { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; border-radius: inherit; background: color-mix(in srgb, var(--background-secondary) 55%, transparent); }',
            '.sauce-tnv-burst-mark { position: relative; display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; background: var(--color-green, #4c9a5a); color: #fff; box-shadow: 0 6px 24px color-mix(in srgb, var(--color-green, #4c9a5a) 45%, transparent); animation: sauce-tnv-burst 520ms var(--sauce-spring, cubic-bezier(0.34, 1.56, 0.5, 1)) both; }',
            '.sauce-tnv-burst-mark > svg { width: 30px; height: 30px; stroke-width: 3; }',
            '.sauce-tnv-burst-mark::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--color-green, #4c9a5a); animation: sauce-tnv-ripple 700ms ease-out 120ms both; }',
            '.sauce-tnv-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 0.78em; color: var(--text-faint); }',
            '.sauce-tnv-meta a { color: var(--text-muted); text-decoration: none; cursor: pointer; }',
            '.sauce-tnv-meta-sep { opacity: 0.6; }',
            'body.is-phone .sauce-task-note-view { padding: 16px 14px 12px 16px; gap: 12px; }',
            'body.is-phone .sauce-tnv-title { font-size: 1.25em; }',
            'body.is-phone .sauce-tnv-actions > .sauce-btn.sauce-btn.sauce-btn.sauce-btn { flex: 1 1 0; height: auto; min-height: 42px; }',
            'body.is-phone .sauce-tnv-add.sauce-tnv-add.sauce-tnv-add { height: auto; min-height: 40px; font-size: 16px; }',
            'body.is-phone .sauce-tnv-chip { min-height: 26px; }',
            'body.is-phone .sauce-tnv-ring { width: 46px; height: 46px; }',
            'body.is-phone .sauce-tnv-nest { margin-left: 8px; padding-left: 8px; }',
            '@media (max-width: 480px) { .sauce-tnv-actions > .sauce-btn { flex: 1 1 0; } .sauce-tnv-nest { margin-left: 8px; padding-left: 8px; } }',
            '@media (prefers-reduced-motion: reduce) { .sauce-tnv-progress > span, .sauce-tnv-progress > span::after, .sauce-tnv-link, .sauce-tnv-add, .sauce-task-note-view.sauce-anim-reveal, .sauce-tnv-done, .sauce-tnv-done > svg, .sauce-tnv-row-in, .sauce-tnv-ring-arc, .sauce-tnv-ring > svg, .sauce-tnv-title-text, .sauce-tnv-burst-mark, .sauce-tnv-burst-mark::after { transition: none !important; animation: none !important; } .sauce-task-note-view.is-completing .sauce-tnv-title-text { background-size: 100% 2px; } }',
        ].join('\n');
    }

    /** Inject (or refresh) the card stylesheet once per document head. */
    static _injectCss(doc) {
        try {
            const head = doc && doc.head;
            if (!head || typeof doc.createElement !== 'function') return;
            const ID = 'sauce-task-note-css';
            let el = Array.from(head.children || []).find((c) => c && c.id === ID) || null;
            if (!el) {
                el = doc.createElement('style');
                el.id = ID;
                head.appendChild(el);
            }
            if (el.textContent !== TaskNoteView._CSS) el.textContent = TaskNoteView._CSS;
        } catch (_e) { /* unstyled is still usable */ }
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Reads the current
     * page's task frontmatter and draws the card. Fully guarded — returns
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
                recurrence: str(parsed ? parsed.recurrence : page.recurrence),
                priority: str(parsed ? parsed.priority : page.priority),
                project: str(parsed ? parsed.project : page.project),
                source_note: str(parsed ? parsed.source_note : page.source_note),
                parent_task: str(parsed ? parsed.parent_task : page.parent_task),
                created_at: str(parsed ? parsed.created_at : page.created_at),
                completed_at: str(parsed ? parsed.completed_at : page.completed_at),
                // Structured card links — read from the parsed view (already
                // normalized to a string array) or the raw page frontmatter (which
                // Dataview may surface as strings and/or Link objects).
                links: (parsed && Array.isArray(parsed.links)) ? parsed.links : page.links,
            };
            const filePath = (page.file && page.file.path) || (parsed && parsed.path) || null;
            let todayStr = '';
            try { todayStr = (window.moment && window.moment().format) ? window.moment().format('YYYY-MM-DD') : ''; } catch (_e) { todayStr = ''; }
            const status = task.status.trim().toLowerCase() || 'open';
            const ICON = TaskNoteView._ICONS;
            const TE = window.customJS && window.customJS.TaskEntity;
            const linkText = (v) => {
                let out = '';
                try { if (TE && typeof TE._linkText === 'function') out = TE._linkText(v); } catch (_e) { out = ''; }
                return String(out || this._stripWikilink(v) || '').trim();
            };
            const openLink = (target) => (ev) => {
                try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
                try {
                    if (window.app && window.app.workspace && typeof window.app.workspace.openLinkText === 'function') {
                        window.app.workspace.openLinkText(target, filePath || '', false);
                    }
                } catch (_e) { /* open best-effort */ }
            };
            const icon = (el, name) => { try { if (el && ICON[name]) el.insertAdjacentHTML('afterbegin', ICON[name]); } catch (_e) {} return el; };
            const notice = (msg) => { try { new Notice(msg, 6000); } catch (_e) {} };
            const refresh = () => {
                try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                try {
                    if (window.app && window.app.commands && typeof window.app.commands.executeCommandById === 'function') {
                        window.app.commands.executeCommandById('dataview:dataview-force-refresh-views');
                    }
                } catch (_e) {}
            };

            try { if (typeof document !== 'undefined') TaskNoteView._injectCss(document); } catch (_e) {}

            // ----- Card container -----
            // Replace any card an earlier execution left in this container.
            // Dataview clears the block and then awaits the view-file read, so a
            // refresh that starts inside that gap runs this render a second time
            // into the same container; without this the card shows twice until
            // the next refresh. Same dedupe ChromeBar.render does for the bar.
            try {
                const stale = c.querySelectorAll ? c.querySelectorAll(':scope > .sauce-task-note-view') : [];
                for (const prev of Array.from(stale || [])) { if (prev && prev.remove) prev.remove(); }
            } catch (_e) { /* best-effort */ }
            const card = c.createEl('div', { cls: 'sauce-task-note-view' });
            // The card rises in once per note per session, not on every
            // Dataview refresh.
            const seen = TaskNoteView._seen || (TaskNoteView._seen = new Set());
            const firstOpen = !!filePath && !seen.has(filePath);
            if (firstOpen) { seen.add(filePath); card.classList.add('sauce-anim-reveal'); }
            let prioLevel = 'none';
            try {
                const TTLp = window.customJS && window.customJS.TaskTodayList;
                prioLevel = TTLp && typeof TTLp._priorityLevel === 'function' ? TTLp._priorityLevel(task) : String(task.priority || '').trim().toLowerCase() || 'none';
            } catch (_e) { prioLevel = 'none'; }
            try { card.setAttribute('data-priority', prioLevel); card.setAttribute('data-status', status); } catch (_e) {}

            // ----- Every task under spice/tasks, parsed once. The subtask tree
            // below this note and the chain of parents above it both come from
            // this one map, so a subtask can have subtasks of its own.
            const thisBasename = filePath ? filePath.split('/').pop().replace(/\.md$/i, '') : '';
            let index = { children: new Map(), byName: new Map() };
            if (filePath) {
                try {
                    const raw = dv.pages('"spice/tasks"').where(p => !!(p && p.type === 'task' && p.file && p.file.path
                        && (TE && typeof TE.taskState === 'function' ? TE.taskState(p) !== 'deleted' : p.status !== 'deleted')));
                    const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
                    const parsedAll = [];
                    if (TE && typeof TE.parseNote === 'function') {
                        for (const p of arr) {
                            try { const t = TE.parseNote(p); if (t) parsedAll.push(t); } catch (_e) { /* one malformed task must not brick the note */ }
                        }
                    }
                    index = TaskNoteView._taskIndex(parsedAll, linkText);
                } catch (_e) { /* no tree: the card still draws */ }
            }

            // ----- Header: the parent chain, the title and chips, and a ring
            // that fills as the subtasks close -----
            const head = card.createEl('div', { cls: 'sauce-tnv-head' });
            const headMain = head.createEl('div', { cls: 'sauce-tnv-head-main' });
            const isSubtask = !!task.parent_task;
            if (isSubtask) {
                try {
                    const parentName = linkText(task.parent_task);
                    const chain = TaskNoteView._ancestors(parentName, index.byName, linkText, thisBasename);
                    const partOf = headMain.createEl('div', { cls: 'sauce-tnv-parent' });
                    icon(partOf, 'up');
                    partOf.createEl('span', { text: 'Part of' });
                    chain.forEach((name, i) => {
                        if (i) partOf.createEl('span', { cls: 'sauce-tnv-parent-sep', text: '›' });
                        const a = partOf.createEl('a', { cls: 'sauce-tnv-parent-name', text: name, href: '#' });
                        a.addEventListener('click', openLink(name));
                    });
                } catch (_e) { /* part-of link best-effort */ }
            }
            const titleEl = headMain.createEl('div', { cls: 'sauce-tnv-title' });
            titleEl.createEl('span', { cls: 'sauce-tnv-title-text', text: task.title || '(untitled)' });
            const ring = head.createEl('div', { cls: 'sauce-tnv-ring' });
            ring.style.display = 'none';
            try { ring.setAttribute('role', 'img'); } catch (_e) {}

            const chips = headMain.createEl('div', { cls: 'sauce-tnv-chips' });
            chips.createEl('span', { cls: 'sauce-tnv-chip is-status is-' + status, text: this._statusLabel(task.status) });
            try {
                const dueChip = TaskNoteView._dueChip(task.due, todayStr, status);
                if (dueChip) {
                    const el = chips.createEl('span', { cls: 'sauce-tnv-chip is-due' + (dueChip.tone ? ' is-' + dueChip.tone : ''), text: dueChip.text });
                    const full = TaskNoteView._humanDate(task.due, todayStr).text;
                    if (full) el.setAttribute('title', full);
                }
            } catch (_e) {}
            const prioMeta = TaskNoteView._priorityMeta(task.priority);
            if (prioMeta) chips.createEl('span', { cls: 'sauce-tnv-chip is-prio-' + prioLevel, text: prioMeta.label + ' priority' });
            if (task.recurrence.trim()) {
                const rep = chips.createEl('span', { cls: 'sauce-tnv-chip is-repeat', text: task.recurrence.trim() });
                icon(rep, 'repeat');
            }
            const projName = task.project.trim() ? linkText(parsed ? parsed.project : page.project) : '';
            if (projName) {
                const proj = chips.createEl('a', { cls: 'sauce-tnv-chip is-project', text: projName, href: '#' });
                proj.classList.add('internal-link');
                proj.addEventListener('click', openLink(projName));
            }

            // ----- Links: one row each, label then the site it goes to -----
            try {
                const linkEntries = TaskNoteView._linkEntries(task);
                if (linkEntries.length) {
                    const section = card.createEl('div', { cls: 'sauce-tnv-section' });
                    section.createEl('div', { cls: 'sauce-tnv-label', text: 'Links' });
                    const list = section.createEl('div', { cls: 'sauce-tnv-links' });
                    for (const entry of linkEntries) {
                        try {
                            const meta = TaskNoteView._linkMeta(entry);
                            const row = list.createEl('div', { cls: 'sauce-tnv-link' });
                            icon(row, meta.kind === 'web' ? 'web' : 'note');
                            const text = row.createEl('span', { cls: 'sauce-tnv-link-text' });
                            TaskNoteView._renderInlineMarkdown(text, entry, filePath || '');
                            if (meta.host) row.createEl('span', { cls: 'sauce-tnv-link-host', text: meta.host });
                        } catch (_e) { /* one bad link must not break the card */ }
                    }
                }
            } catch (_e) { /* Links section best-effort */ }

            // ----- SUBTASKS — on every task note, subtasks included, so a
            // subtask can be broken down further. Direct children draw with the
            // shared TaskTodayList.renderTaskRow (same checkbox/edit/badge
            // behaviour as every task surface), each with its own progress
            // meter; an open child's open children nest under it, indented, up
            // to three levels. Finished children draw with renderDoneRow and
            // Reopen. The bar and the header ring fill as they close.
            let subtaskList = [];
            let syncReady = () => {};
            if (filePath) {
                try {
                    const allSubtasks = TaskNoteView._kidsOf(index, filePath);
                    subtaskList = allSubtasks;
                    const TTL = window.customJS && window.customJS.TaskTodayList;

                    const section = card.createEl('div', { cls: 'sauce-tnv-section is-subtasks' });
                    const subHead = section.createEl('div', { cls: 'sauce-tnv-section-head' });
                    subHead.createEl('div', { cls: 'sauce-tnv-label', text: 'Subtasks' });
                    const countEl = subHead.createEl('span', { cls: 'sauce-tnv-count' });
                    const bar = section.createEl('div', { cls: 'sauce-tnv-progress' });
                    const fill = bar.createEl('span');
                    try { bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Subtasks done'); } catch (_e) {}
                    const subList = section.createEl('div', { cls: 'sauce-tnv-subtasks' });
                    const addInput = section.createEl('input', { cls: 'sauce-tnv-add', type: 'text' });
                    addInput.placeholder = '+ Add subtask…';
                    try { addInput.setAttribute('aria-label', 'Add subtask'); addInput.setAttribute('enterkeyhint', 'done'); } catch (_e) {}
                    const doneHost = section.createEl('div', { cls: 'sauce-tnv-done-list' });
                    let doneAll = false;

                    // The bar starts empty and fills on the next frame, so it
                    // animates on open; a later repaint slides from the old width.
                    const paintProgress = (first) => {
                        const prog = TaskNoteView._progress(allSubtasks);
                        countEl.textContent = prog.total && prog.done === prog.total ? 'All ' + prog.total + ' done' : prog.text;
                        bar.style.display = prog.total ? '' : 'none';
                        try { bar.setAttribute('aria-valuenow', String(prog.pct)); } catch (_e) {}
                        TaskNoteView._paintRing(ring, prog, false);
                        const apply = () => { fill.style.width = prog.pct + '%'; TaskNoteView._paintRing(ring, prog, true); };
                        if (first && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(apply));
                        else apply();
                        syncReady(prog);
                    };
                    // A subtask ticked off flashes the bar as it fills.
                    const bump = () => {
                        try {
                            bar.classList.remove('is-bump');
                            void bar.offsetWidth;
                            bar.classList.add('is-bump');
                        } catch (_e) {}
                    };
                    const isOpenTask = (t) => {
                        if (!t) return false;
                        if (TE && typeof TE.isOpenTask === 'function') return TE.isOpenTask(t);
                        return t.status === 'open';
                    };
                    let rowIndex = 0;
                    const markDoneLocally = (doneTask) => {
                        doneTask.status = 'done';
                        try { doneTask.completed_at = window.moment().format('YYYY-MM-DDTHH:mm:ssZ'); } catch (_e) {}
                        bump();
                        paintSubtasks();
                    };
                    // One open subtask row, then its own open subtasks nested
                    // under it. `trail` stops a parent loop; depth caps at three.
                    const drawRow = (host, st, depth, first, trail) => {
                        const key = st.path || '';
                        const kids = TaskNoteView._kidsOf(index, key);
                        st.subtask_count = kids.length
                            ? { done: kids.filter((k) => k && k.status === 'done').length, total: kids.length }
                            : null;
                        const row = TTL.renderTaskRow(host, st, null, { showProject: false, showParent: false, todayStr, onDone: markDoneLocally });
                        if (row && first) {
                            try {
                                row.classList.add('sauce-tnv-row-in');
                                row.style.animationDelay = (Math.min(rowIndex++, 10) * 45) + 'ms';
                            } catch (_e) {}
                        }
                        const next = new Set(trail);
                        if (key) next.add(key);
                        const openKids = kids.filter((k) => isOpenTask(k) && !next.has(k.path));
                        if (openKids.length && depth < 3 && key && !trail.has(key)) {
                            const nest = host.createEl('div', { cls: 'sauce-tnv-nest' });
                            for (const kid of openKids) {
                                try { drawRow(nest, kid, depth + 1, first, next); } catch (_e) {}
                            }
                        }
                    };
                    const reopenSub = async (st, undo) => {
                        if (undo.disabled) return;
                        undo.disabled = true;
                        let res = null;
                        try {
                            const TDr = window.customJS && window.customJS.TaskDialog;
                            res = TDr && typeof TDr.reopen === 'function' ? await TDr.reopen(st.path) : null;
                        } catch (_e) { res = null; }
                        if (res && res.ok) {
                            st.status = 'open';
                            st.completed_at = null;
                            st.path = res.path || st.path;
                            paintSubtasks();
                            return;
                        }
                        undo.disabled = false;
                        notice('Could not reopen subtask: ' + ((res && res.reason) || 'unknown'));
                    };
                    const paintSubtasks = (first) => {
                        while (subList.firstChild) subList.removeChild(subList.firstChild);
                        while (doneHost.firstChild) doneHost.removeChild(doneHost.firstChild);
                        // Only OPEN subtasks are rendered as rows. Without this
                        // filter, a just-completed subtask (still under spice/tasks/
                        // so still fetched above)
                        // reappears unchecked on Dataview's next auto-refresh, and
                        // a second click calls markDone on the now-stale path —
                        // "task file not found". allSubtasks (open + done) still
                        // feeds the progress count.
                        const openSubtasks = allSubtasks.filter(t => isOpenTask(t));
                        if (TTL && typeof TTL.renderTaskRow === 'function') {
                            rowIndex = 0;
                            for (const st of openSubtasks) {
                                try { drawRow(subList, st, 1, first, new Set([filePath])); } catch (_e) {}
                            }
                        }
                        if (!allSubtasks.length) {
                            subList.createEl('div', { cls: 'sauce-tnv-empty', text: 'Break this into steps. Add one below.' });
                        }
                        paintProgress(first);

                        // Finished subtasks, newest first: the first five, then
                        // "Show N more". Reopen puts one back in the list above.
                        const doneSubtasks = allSubtasks.filter(t => t && t.status === 'done');
                        if (doneSubtasks.length && TTL && typeof TTL.renderDoneRow === 'function') {
                            const stampOf = (t) => {
                                try { return (TE && typeof TE.completedDay === 'function') ? TE.completedDay(t) : String(t.completed_at || '').slice(0, 10); } catch (_e) { return ''; }
                            };
                            doneSubtasks.sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
                            doneHost.createEl('div', { cls: 'sauce-tnv-label', text: 'Done · ' + doneSubtasks.length });
                            const shown = doneAll ? doneSubtasks : doneSubtasks.slice(0, 5);
                            for (const st of shown) {
                                try {
                                    const day = stampOf(st);
                                    const stamp = day && day !== todayStr ? TaskNoteView._shortDate(day, todayStr) : null;
                                    TTL.renderDoneRow(doneHost, st, { notice, onUndo: reopenSub, undoLabel: 'Reopen', stamp });
                                } catch (_e) {}
                            }
                            if (shown.length < doneSubtasks.length) {
                                const more = doneHost.createEl('button', { cls: 'sauce-tnv-more', text: 'Show ' + (doneSubtasks.length - shown.length) + ' more' });
                                try { more.setAttribute('type', 'button'); } catch (_e) {}
                                more.addEventListener('click', () => { doneAll = true; paintSubtasks(); });
                            }
                        }
                    };
                    paintSubtasks(firstOpen);

                    let addSequence = 0;
                    let addInputRevision = 0;
                    addInput.addEventListener('input', () => { addInputRevision++; });
                    const doAdd = async () => {
                        const title = String(addInput.value || '').trim();
                        if (!title) return;
                        const TD = window.customJS && window.customJS.TaskDialog;
                        if (!TD || typeof TD.createQuick !== 'function' || typeof TD.prepareQuick !== 'function') {
                            try { addInput.focus(); } catch (_e) {}
                            return;
                        }
                        const sequence = ++addSequence;
                        const inputRevision = addInputRevision;
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
                                        // A cross-class renderer can fail after appending but before it
                                        // returns the row receipt. Snapshot the live child identities so
                                        // that no receipt still means exact, local rollback rather than a
                                        // phantom optimistic row that duplicates on warm retry.
                                        const beforeChildren = Array.from(subList.children || []);
                                        const restoreChildren = () => {
                                            const owned = new Set(beforeChildren);
                                            for (const child of Array.from(subList.children || [])) {
                                                if (!owned.has(child)) {
                                                    try { child.remove(); } catch (_e) {
                                                        try { subList.removeChild(child); } catch (_e2) {}
                                                    }
                                                }
                                            }
                                            for (let index = 0; index < beforeChildren.length; index++) {
                                                const child = beforeChildren[index];
                                                if ((subList.children || [])[index] === child) continue;
                                                try {
                                                    if (child.parentNode === subList) subList.removeChild(child);
                                                    subList.insertBefore(child, (subList.children || [])[index] || null);
                                                } catch (_e) {}
                                            }
                                        };
                                        let node = null;
                                        try {
                                            node = TTL.renderTaskRow(subList, optimisticTask, null, { showProject: false, showParent: false, todayStr });
                                            if (!node || node.parentNode !== subList) {
                                                throw new Error('subtask row render did not return an attached row');
                                            }
                                        } catch (error) {
                                            restoreChildren();
                                            throw error;
                                        }
                                        try { node.classList.add('sauce-anim-reveal'); } catch (_e) {}
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
                                    const reason = created && (created.reason || (created.error && created.error.message));
                                    try { new Notice('Could not create subtask' + (reason ? ': ' + reason : ''), 6000); } catch (_e) {}
                                    return;
                                }
                                if (sequence === addSequence && inputRevision === addInputRevision
                                    && String(addInput.value || '').trim() === title) {
                                    addInput.value = '';
                                }
                            } catch (_e) {
                                try { if (plan && typeof TD.releaseQuickPlan === 'function') TD.releaseQuickPlan(plan); } catch (_e2) {}
                                try { new Notice('Could not create subtask: ' + (_e && (_e.message || _e)), 6000); } catch (_e2) {}
                            }
                            try { addInput.focus(); } catch (_e) {}
                        }
                    };
                    addInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); doAdd(); } });
                } catch (_e) { /* SUBTASKS section best-effort — never break the card */ }
            }

            // ----- Footer: Mark done / Reopen + Edit on one row -----
            const actions = card.createEl('div', { cls: 'sauce-tnv-actions' });
            const button = (cls, text, iconName) => {
                const b = actions.createEl('button', { cls: 'sauce-btn ' + cls });
                try { b.setAttribute('type', 'button'); } catch (_e) {}
                icon(b, iconName);
                b.createEl('span', { text });
                return b;
            };
            for (const action of TaskNoteView._actionsFor(status, filePath)) {
                if (action === 'done') {
                    const doneBtn = button('sauce-tnv-done sauce-tnv-primary', 'Mark done', 'check');
                    // Once every subtask is done, Mark done glows to say so.
                    syncReady = (prog) => {
                        try {
                            const ready = !!(prog && prog.total && prog.done === prog.total);
                            if (ready) doneBtn.classList.add('is-ready');
                            else if (doneBtn.classList.remove) doneBtn.classList.remove('is-ready');
                        } catch (_e) {}
                    };
                    syncReady(TaskNoteView._progress(subtaskList));
                    doneBtn.addEventListener('click', async () => {
                        const TD = window.customJS && window.customJS.TaskDialog;
                        if (!TD || typeof TD.markDone !== 'function' || !filePath || doneBtn.disabled) return;
                        const label = doneBtn.querySelector ? doneBtn.querySelector('span') : null;
                        doneBtn.disabled = true;
                        if (label) label.textContent = 'Marking done…';
                        try {
                            const res = await TD.markDone(filePath);
                            if (res && res.ok === false && res.reason === 'cancelled') {
                                // The user kept the task open (said No to its open subtasks).
                                doneBtn.disabled = false;
                                if (label) label.textContent = 'Mark done';
                                return;
                            }
                            if (res && res.ok === false) throw new Error(res.reason || 'unknown');
                            // Celebrate, then let Dataview redraw the done card:
                            // the title strikes through and a check pops.
                            doneBtn.classList.add('is-completing');
                            card.classList.add('is-completing');
                            try {
                                const burst = card.createEl('div', { cls: 'sauce-tnv-burst' });
                                icon(burst.createEl('span', { cls: 'sauce-tnv-burst-mark' }), 'check');
                            } catch (_e) {}
                            if (label) label.textContent = 'Done';
                            if (typeof setTimeout === 'function') setTimeout(refresh, TaskNoteView._CELEBRATE_MS);
                            else refresh();
                        } catch (e) {
                            doneBtn.disabled = false;
                            if (label) label.textContent = 'Mark done';
                            notice('Could not complete task: ' + (e && (e.message || e)));
                        }
                    });
                } else if (action === 'reopen') {
                    const reopenBtn = button('sauce-tnv-reopen sauce-tnv-primary', 'Reopen', 'reopen');
                    reopenBtn.addEventListener('click', async () => {
                        const TD = window.customJS && window.customJS.TaskDialog;
                        if (!TD || typeof TD.reopen !== 'function' || reopenBtn.disabled) return;
                        reopenBtn.disabled = true;
                        let res = null;
                        try { res = await TD.reopen(filePath); } catch (e) { res = { ok: false, reason: e && (e.message || e) }; }
                        if (res && res.ok) { refresh(); return; }
                        reopenBtn.disabled = false;
                        notice('Could not reopen task: ' + ((res && res.reason) || 'unknown'));
                    });
                } else {
                    const editBtn = button('sauce-tnv-edit', 'Edit', 'edit');
                    editBtn.addEventListener('click', () => {
                        try {
                            if (window.customJS && window.customJS.TaskDialog && typeof window.customJS.TaskDialog.open === 'function' && filePath) {
                                window.customJS.TaskDialog.open({ edit: filePath });
                            }
                        } catch (e) {
                            notice('Could not open task editor: ' + (e && (e.message || e)));
                        }
                    });
                }
            }

            // ----- Quiet footer: when it was made, done, and where it came from -----
            try {
                const bits = [];
                const created = TaskNoteView._shortDate(task.created_at, todayStr);
                if (created) bits.push({ text: 'Created ' + created });
                if (status === 'done') {
                    const finished = TaskNoteView._shortDate(task.completed_at, todayStr);
                    if (finished) bits.push({ text: 'Done ' + finished });
                }
                const source = task.source_note ? linkText(task.source_note) : '';
                if (source) bits.push({ text: 'From ', link: source });
                if (bits.length) {
                    const meta = card.createEl('div', { cls: 'sauce-tnv-meta' });
                    bits.forEach((bit, i) => {
                        if (i) meta.createEl('span', { cls: 'sauce-tnv-meta-sep', text: '·' });
                        const span = meta.createEl('span', { text: bit.text });
                        if (bit.link) {
                            const a = span.createEl('a', { text: bit.link, href: '#' });
                            a.classList.add('internal-link');
                            a.addEventListener('click', openLink(bit.link));
                        }
                    });
                }
            } catch (_e) { /* footer best-effort */ }
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
