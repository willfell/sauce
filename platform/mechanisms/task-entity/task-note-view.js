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
    _humanDate(value, todayStr) { return TaskNoteView._humanDate(value, todayStr); }
    _priorityMeta(priority) { return TaskNoteView._priorityMeta(priority); }

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
        const sched = val(t.scheduled);
        const due = val(t.due);
        const prio = val(t.priority);
        let proj = val(t.project);
        const pm = /^\[\[([^\]]+)\]\]$/.exec(proj);
        if (pm) proj = pm[1];
        if (sched) rows.push({ label: 'Scheduled', value: sched });
        if (due) rows.push({ label: 'Due', value: due });
        if (prio) rows.push({ label: 'Priority', value: prio });
        if (proj) rows.push({ label: 'Project', value: proj });
        return rows;
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
                scheduled: str(parsed ? parsed.scheduled : page.scheduled),
                due: str(parsed ? parsed.due : page.due),
                priority: str(parsed ? parsed.priority : page.priority),
                project: str(parsed ? parsed.project : page.project),
                source_note: str(parsed ? parsed.source_note : page.source_note),
                created_at: str(parsed ? parsed.created_at : page.created_at),
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

            // ----- Header: status pill + title -----
            const header = card.createEl('div');
            header.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

            const status = task.status.trim().toLowerCase();
            const pill = header.createEl('span', { text: this._statusLabel(task.status).toUpperCase() });
            const pillBase = 'align-self:flex-start; font-size:0.68em; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; padding:3px 10px; border-radius:999px; box-sizing:border-box;';
            if (status === 'done') {
                pill.style.cssText = pillBase + 'background:var(--color-green, #4c9a5a); color:var(--text-on-accent, #fff);';
            } else if (status === 'deleted') {
                pill.style.cssText = pillBase + 'background:var(--background-modifier-border); color:var(--text-muted);';
            } else {
                pill.style.cssText = pillBase + 'background:var(--interactive-accent, #6a6abf); color:var(--text-on-accent, #fff);';
            }

            const titleEl = header.createEl('div', { text: task.title || '(untitled)' });
            titleEl.style.cssText = 'font-size:1.3em; font-weight:700; line-height:1.25; color:var(--text-normal); overflow-wrap:break-word; word-break:break-word;';

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

            const hasScheduled = !!task.scheduled;
            const hasDue = !!task.due;
            const prioMeta = TaskNoteView._priorityMeta(task.priority);
            let projName = task.project.trim();
            const pm = /^\[\[([^\]]+)\]\]$/.exec(projName);
            if (pm) projName = pm[1];
            const hasProject = !!projName;
            const createdHuman = task.created_at ? TaskNoteView._humanDate(task.created_at, todayStr) : { text: '' };
            const hasCreated = !!createdHuman.text;

            const anyDetails = hasScheduled || hasDue || !!prioMeta || hasProject || hasCreated;
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

                // Scheduled — human date + muted relative hint.
                if (hasScheduled) {
                    addRow('Scheduled', (wrap) => {
                        const h = TaskNoteView._humanDate(task.scheduled, todayStr);
                        wrap.createEl('span', { text: h.text || task.scheduled });
                        if (h.relative) {
                            const rel = wrap.createEl('span', { text: ' (' + h.relative + ')' });
                            rel.style.cssText = 'color:var(--text-muted); font-size:0.9em;';
                        }
                    });
                }

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
                    const target = this._stripWikilink(task.source_note);
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
