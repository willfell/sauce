/**
 * TaskTodayList (CustomJS) — the daily live-query widget for the note-per-task
 * model. Third class of the task-entity mechanism (after TaskEntity, the pure
 * core, and TaskDialog, the create/edit/done/delete dialog).
 *
 * Renders on a `type: to-do` daily note (invoked via customjs-guard, so its
 * entry method is the instance `render(dv)`). It live-queries the task notes
 * under `spice/tasks/` (open only, excluding _done/ + _trash/), partitions them
 * into a "Today" band (rendered FIRST) and an "Overdue / Carryover" band, and
 * draws each task as a row with a functional done-checkbox + metadata chips.
 * Task CREATION lives in ToDoLeafActions' single nav-button "New Task" (this
 * widget renders no create button of its own). Every mutation is DELEGATED to
 * TaskDialog — the widget only READS the task notes; it never writes one
 * directly. That keeps the single-file-write invariant (a bad write can only
 * ever touch one task's file) entirely inside TaskDialog:
 *   - checkbox change → TaskDialog.markDone(path)   (status=done + move to _done/)
 *   - title click     → app.workspace.openLinkText(path)  (opens the task NOTE;
 *                       its TaskNoteView carries the Edit button for editing)
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the
 * embedding note is indexed. We resolve the page via the render-safe mechanism
 * (window.customJS?.RenderSafe?.page(dv), optional-chained so a TDZ'd customJS
 * never throws) and bail quietly if the customJS classes we need (TaskEntity /
 * TaskDialog) aren't registered yet. The widget NEVER throws
 * "Cannot read properties of undefined" out of render.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "\nreturn TaskTodayList;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskTodayList.buildBands(parsedTasks, todayStr) → { today, overdue }
 *
 * Instance API (browser-side):
 *   TaskTodayList.render(dv)   ← the customjs-guard entry point
 */
class TaskTodayList {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.TaskTodayList; the Node
    // harness news the class and calls buildBands through that instance. A
    // static-only declaration is not on the prototype → the call throws at
    // runtime. Instance method precedes its static in source order (mirrors
    // TaskEntity / TaskDialog).

    buildBands(parsedTasks, todayStr) { return TaskTodayList.buildBands(parsedTasks, todayStr); }
    renderTaskRow(container, task, TDref) { return TaskTodayList.renderTaskRow(container, task, TDref); }
    renderInlineLinks(el, text, sourcePath) { return TaskTodayList.renderInlineLinks(el, text, sourcePath); }
    _parseInlineLinks(text) { return TaskTodayList._parseInlineLinks(text); }
    _renderTitleMarkdown(titleEl, mdText, sourcePath) { return TaskTodayList._renderTitleMarkdown(titleEl, mdText, sourcePath); }
    _stripWikilink(v) { return TaskTodayList._stripWikilink(v); }
    _projectChipText(v) { return TaskTodayList._projectChipText(v); }

    // ---------- Static pure helper ----------

    /**
     * Partition a list of ALREADY-PARSED task objects (parseNote output, or any
     * object with `{ scheduled, status, project_slug, source }`) relative to
     * `todayStr` (YYYY-MM-DD). Open-only, and PERSONAL-daily-only — a task that
     * belongs to another daily section is EXCLUDED so it doesn't render twice:
     *   today   — status "open", scheduled === todayStr, NO project, NOT meeting
     *   overdue — status "open", scheduled < todayStr, NO project, NOT meeting
     * (string compare of zero-padded ISO dates is chronologically correct.)
     * A task WITH a project_slug renders in its "Project Tasks" section
     * (ToDoDailyProjectGroups); a task with source "meeting" renders in "Meeting
     * Tasks" (ToDoDailyUnassignedMeetings) — both surface ALL open matching
     * task-notes, so excluding them here loses nothing. Future-scheduled +
     * unscheduled open tasks land in NEITHER band. Tolerates a null/non-array
     * input (→ empty bands); never throws.
     */
    static buildBands(parsedTasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            // Tasks that belong to another daily section are EXCLUDED here so they
            // don't show TWICE (once in Today/Overdue, once below). A project task
            // renders under its own "Project Tasks" section (ToDoDailyProjectGroups);
            // a meeting-sourced task renders under "Meeting Tasks"
            // (ToDoDailyUnassignedMeetings) — both of which surface ALL open matching
            // task-notes, so nothing vanishes. Today/Overdue bands are therefore the
            // PERSONAL daily tasks only: open, scheduled, NO project, NOT meeting.
            if (t.project_slug && String(t.project_slug).trim() !== '') continue; // shown in its Project section
            if (t.source === 'meeting') continue;                                 // shown in Meeting Tasks
            const sched = t.scheduled;
            if (!sched) continue;
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            // sched > todayStr (future) → excluded from both bands.
        }
        return { today: today, overdue: overdue };
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Live-queries the task
     * notes, partitions them, and draws the two bands. Fully guarded — returns
     * quietly on cold-load (no throw), and each row is wrapped in try/catch so
     * one bad task note can't break the whole list.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        // Skip rendering inside embeds — the host note renders its own list.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        // Clear container defensively (matches TodayCaptureEditableList).
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        // ----- Cold-load guard -----
        // RenderSafe resolves the embedding page (live or active-file shim); a
        // null page means we can't safely proceed → bail quietly. Optional
        // chaining so a TDZ'd customJS never throws here.
        const page = window.customJS && window.customJS.RenderSafe
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        // The classes we DELEGATE to. If either isn't registered yet (cold
        // load), render nothing and return — a later re-render will succeed.
        const TE = window.customJS && window.customJS.TaskEntity;
        const TD = window.customJS && window.customJS.TaskDialog;
        if (!TE || typeof TE.parseNote !== 'function' || !TD || typeof TD.open !== 'function') {
            return;
        }

        const today = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DD')
            : '';

        // ----- Live query -----
        // Open tasks under spice/tasks/, excluding the recoverable _trash/ and
        // completed _done/ archives. Guard each predicate against half-indexed
        // pages (p / p.file may be undefined on cold load).
        let parsed = [];
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/'));
            parsed = raw.map(p => TE.parseNote(p)).array
                ? raw.map(p => TE.parseNote(p)).array()
                : Array.from(raw).map(p => TE.parseNote(p));
        } catch (_e) {
            parsed = [];
        }

        const bands = TaskTodayList.buildBands(parsed, today);

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-today' });
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 10px; margin: 4px 0; width: 100%;';

        // NOTE: the widget no longer renders its own "+ New Task" button — task
        // creation is consolidated into the single ToDoLeafActions "New Task"
        // button in the nav-button section (avoids two create buttons on the
        // daily). This widget only READS + partitions the task notes.

        // Today band FIRST — the tasks the user made for today are the primary
        // focus; always shown, with an empty hint. The label is null because the
        // daily template already renders a SectionLabel "Today" above this widget;
        // a "Today" band caption here would show "Today" TWICE (FIX 2).
        this._renderBand(wrap, null, bands.today, 'No tasks scheduled today');

        // Overdue / Carryover band below (only when non-empty).
        if (bands.overdue.length) {
            this._renderBand(wrap, 'Overdue / Carryover', bands.overdue, null);
        }
    }

    /**
     * Render one labeled band (a SectionLabel-ish caption + the task rows). When
     * `label` is falsy the caption div is SKIPPED (the Today band relies on the
     * template's SectionLabel "Today" — rendering a caption here too would double
     * the "Today" heading; FIX 2). When `tasks` is empty and `emptyHint` is
     * provided, show a subtle hint instead of rows; when empty and no hint, render
     * nothing (skips empty overdue bands).
     */
    _renderBand(wrap, label, tasks, emptyHint) {
        const band = wrap.createEl('div', { cls: 'sauce-task-today-band' });
        band.style.cssText = 'display: flex; flex-direction: column; gap: 4px; width: 100%; box-sizing: border-box;';

        if (label) {
            const cap = band.createEl('div', { cls: 'sauce-task-today-label', text: label });
            cap.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #999); margin-bottom: 2px;';
        }

        if (!tasks || !tasks.length) {
            if (!emptyHint) { band.remove(); return; }
            const hint = band.createEl('div', { text: emptyHint });
            hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }

        for (const t of tasks) {
            try {
                this._renderRow(band, t);
            } catch (_e) {
                // One bad task note must not break the whole list.
            }
        }
    }

    /**
     * Render one task row (instance) — thin delegator to the SELF-CONTAINED static
     * renderTaskRow so the daily still renders identically. The static is what any
     * OTHER widget (TaskMeetingList / TaskProjectList) calls cross-class via
     * window.customJS.TaskTodayList.renderTaskRow(...).
     */
    _renderRow(band, task) {
        return TaskTodayList.renderTaskRow(band, task);
    }

    /**
     * Render one task row into `container` — SELF-CONTAINED (no dependence on
     * instance `this`), so any widget can draw a uniform task row by calling
     * `window.customJS.TaskTodayList.renderTaskRow(container, task)` cross-class.
     * Draws:
     *   - a functional done-checkbox → TaskDialog.markDone(path) (revert on fail)
     *   - a title (title click → opens the task NOTE via app.workspace.openLinkText(path))
     *   - metadata chips for project(name) / priority / due when present.
     * `TDref` is an OPTIONAL TaskDialog reference; when omitted the method reads
     * `window.customJS.TaskDialog` at click-time (both markDone + open are lazily
     * resolved so a cold-load TDZ never throws out of the row build). Never throws.
     */
    static renderTaskRow(container, task, TDref) {
        if (!container || typeof container.createEl !== 'function') return null;
        // Resolve TaskDialog lazily at click-time so a passed ref OR the global
        // both work; a cold-load (customJS not ready) just no-ops the gesture.
        const getTD = () => {
            try {
                return TDref
                    || (typeof window !== 'undefined' && window.customJS && window.customJS.TaskDialog)
                    || null;
            } catch (_e) { return null; }
        };
        const path = task && task.path;
        const row = container.createEl('div', { cls: 'sauce-task-today-row' });
        // No flex-wrap: the chips (especially DUE) stay on the SAME row as the
        // title even on a narrow (mobile) container. align-items:flex-start pins
        // the chips to the top-right while a long title wraps within its own
        // column (title = flex:1 min-width:0; chips = flex-shrink:0).
        row.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent; width: 100%; box-sizing: border-box;';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-secondary)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        // Functional done-checkbox — starts UNCHECKED (open tasks only). On
        // change → delegate the write to TaskDialog.markDone(path); revert +
        // notice on failure. Stop propagation so the checkbox doesn't also
        // trigger the title-click note-open.
        //
        // The row stays align-items:flex-start (so the chips pin top-right and a
        // long title wraps within its own column), but a bare checkbox then sits
        // ABOVE the first line of the (line-height:1.5) title. Wrap the checkbox
        // in a fixed 1.5em-tall flex box that centers it against that first line —
        // the wrapper height MUST equal the title's first-line line-height so the
        // math holds for BOTH a short title and a wrapping one.
        const cbWrap = row.createEl('div', { cls: 'sauce-task-today-cbwrap' });
        cbWrap.style.cssText = 'display: flex; align-items: center; flex-shrink: 0; height: 1.5em; min-height: 1.5em;';
        const cb = cbWrap.createEl('input');
        cb.type = 'checkbox';
        cb.checked = false;
        cb.style.cssText = 'margin: 0; cursor: pointer; flex-shrink: 0;';
        cb.addEventListener('click', (ev) => { ev.stopPropagation(); });
        cb.addEventListener('change', async () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.markDone !== 'function') { cb.checked = false; return; }
            // Optimistic (L2): preserve scroll, then detach the row NOW so the
            // gesture feels instant — do NOT wait for the write + Dataview's
            // re-render. Re-insert at the original DOM index on failure. The
            // eventual re-render (natural or forced) reconciles authoritatively;
            // RenderSafe holds the scroll across it.
            try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
            const parent = row.parentNode;
            const next = row.nextSibling;
            const revert = () => {
                cb.checked = false;
                if (parent) { try { parent.insertBefore(row, next); } catch (_e) {} }
            };
            try { row.remove(); } catch (_e) {}
            try {
                const res = await TD.markDone(path);
                if (res && res.ok === false) {
                    revert();
                    try { new Notice('Could not complete task: ' + (res.reason || 'unknown'), 6000); } catch (_e) {}
                }
                // On success the file moves to _done/; the row is already gone.
            } catch (e) {
                revert();
                try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        });

        // Title — clicking the title (not the checkbox) opens the task NOTE. The
        // text is rendered via renderInlineLinks so `[label](url)`, `[[wikilink]]`,
        // and bare `http(s)://` URLs become REAL clickable `<a>` elements. This is
        // deterministic (builds anchors directly, no dependence on Obsidian's
        // MarkdownRenderer — which is NOT a global in the customJS eval context, so
        // the old MarkdownRenderer path always fell back to raw text).
        const titleText = (task && task.title) || '(untitled)';
        const title = row.createEl('span', { cls: 'sauce-task-today-title' });
        // Title takes the remaining space (flex:1 1 auto) and wraps WITHIN its
        // column (min-width:0 lets it shrink; break-word wraps long words) so the
        // chips never get pushed off the row. The EXPLICIT line-height:1.5 must
        // match the checkbox wrapper's 1.5em height so the checkbox centers on the
        // first line of the title (see cbWrap above) regardless of theme defaults.
        title.style.cssText = 'flex: 1 1 auto; min-width: 0; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; color: var(--text-normal); cursor: pointer;';
        TaskTodayList.renderInlineLinks(title, titleText, path);

        // Title click → OPEN THE TASK NOTE (its TaskNoteView carries an Edit button
        // for editing). Resolve `app` from window/global (same as renderInlineLinks)
        // and route through openLinkText(path). A click on a real `<a>` link inside
        // the title is handled by renderInlineLinks' stopPropagation, so opening a
        // link doesn't ALSO open the note. Cold-load / no app → no-op (never throws).
        const openNote = () => {
            if (!path) return;
            try {
                const appRef = (typeof window !== 'undefined' && window.app)
                    || (typeof app !== 'undefined' && app)
                    || null;
                if (appRef && appRef.workspace && typeof appRef.workspace.openLinkText === 'function') {
                    appRef.workspace.openLinkText(path, '', false);
                }
            } catch (e) {
                try { new Notice('Could not open task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        };
        title.addEventListener('click', openNote);

        // Metadata chips (only when set): project / priority / due. flex-shrink:0
        // so the chips never shrink or wrap off — DUE stays on the task's row.
        const chips = row.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center; flex-shrink: 0;';
        const addChip = (label) => {
            const chip = chips.createEl('span', { text: label });
            chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
        };
        if (task && task.project) addChip(TaskTodayList._projectChipText(task.project));
        if (task && task.priority) addChip(String(task.priority));
        if (task && task.due) addChip('due: ' + task.due);
        return row;
    }

    /**
     * PURE, Node-testable inline-link PARSER. Scans `text` for these inline link
     * forms ANYWHERE in the string and returns an ORDERED array of segments:
     *   { type: 'text',     value }          — plain text between/around links
     *   { type: 'wikilink', target, alias }  — `[[target]]` / `[[target|alias]]`
     *   { type: 'mdlink',   label, url }     — `[label](url)`
     *   { type: 'url',      url }            — a bare `http(s)://…` URL
     * The three link forms are matched by a single alternation so their relative
     * order in the source is preserved and the gaps between them become text
     * segments. Null / non-string / empty input → a single-element list (empty
     * text) or `[]` for empty; never throws. renderInlineLinks consumes these
     * segments to build the DOM, so the DOM builder and the parser are testable
     * independently.
     */
    static _parseInlineLinks(text) {
        const s = String(text == null ? '' : text);
        if (!s) return [];
        const segs = [];
        // Alternation (order matters): wikilink | markdown link | bare URL.
        //   [[target]] or [[target|alias]]  — target/alias are non-`]`/non-`|` runs
        //   [label](url)                    — label non-`]`, url non-`)`/non-space
        //   http(s)://…                     — bare URL, stops at whitespace/`)`/`]`
        const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]*)\]\(([^)\s]+)\)|(https?:\/\/[^\s)\]]+)/g;
        let last = 0;
        let m;
        while ((m = re.exec(s)) !== null) {
            if (m.index > last) segs.push({ type: 'text', value: s.slice(last, m.index) });
            if (m[1] != null) {
                // Wikilink. m[1] = target, m[2] = optional alias.
                segs.push({ type: 'wikilink', target: m[1].trim(), alias: (m[2] != null ? m[2].trim() : null) });
            } else if (m[3] != null && m[4] != null) {
                // Markdown link. m[3] = label, m[4] = url.
                segs.push({ type: 'mdlink', label: m[3], url: m[4] });
            } else if (m[5] != null) {
                // Bare URL.
                segs.push({ type: 'url', url: m[5] });
            }
            last = re.lastIndex;
        }
        if (last < s.length) segs.push({ type: 'text', value: s.slice(last) });
        return segs.length ? segs : [{ type: 'text', value: s }];
    }

    /**
     * DETERMINISTIC inline-link RENDERER (FIX 1). Clears `el` and rebuilds it as a
     * mix of plain-text nodes + REAL `<a>` anchors, parsing the inline link forms
     * (`[[wikilink]]`, `[label](url)`, bare `http(s)://…`) via _parseInlineLinks.
     * Builds anchors DIRECTLY — it does NOT depend on Obsidian's MarkdownRenderer
     * (which is NOT a global in the customJS eval context, so the old
     * MarkdownRenderer path always fell back to raw text). Anchors:
     *   - wikilink → an `.internal-link` <a> with data-href = target; on click
     *     preventDefault + stopPropagation + app.workspace.openLinkText(target,
     *     sourcePath, false) (so a link click doesn't ALSO open the row editor).
     *   - mdlink / url → an <a href=url target=_blank rel=noopener; on click just
     *     stopPropagation (let the href navigate; don't open the editor).
     * Fully guarded: on ANY failure, falls back to el.setText(text). Uses Obsidian
     * DOM helpers (createEl / appendText / createSpan) with a document.createElement
     * fallback so it also works under a DOM stub. Never throws.
     */
    static renderInlineLinks(el, text, sourcePath) {
        if (!el) return;
        const str = String(text == null ? '' : text);
        // Plain-text fallback: prefer setText, then textContent.
        const setPlain = () => {
            try {
                if (typeof el.setText === 'function') el.setText(str);
                else el.textContent = str;
            } catch (_e) { /* last-resort no-op */ }
        };
        // Resolve `app` from window / global (for openLinkText on wikilink click).
        const appRef = (typeof window !== 'undefined' && window.app)
            || (typeof app !== 'undefined' && app)
            || null;
        // Append a plain-text child (Obsidian appendText/createSpan, DOM fallback).
        const appendText = (value) => {
            if (!value) return;
            if (typeof el.appendText === 'function') { el.appendText(value); return; }
            if (typeof el.createSpan === 'function') { el.createSpan({ text: value }); return; }
            if (typeof document !== 'undefined' && document.createTextNode && el.appendChild) {
                el.appendChild(document.createTextNode(value)); return;
            }
            el.textContent = (el.textContent || '') + value;
        };
        // Build one <a> via createEl (Obsidian) or document.createElement fallback.
        const makeAnchor = (opts) => {
            if (typeof el.createEl === 'function') return el.createEl('a', opts);
            if (typeof document !== 'undefined' && document.createElement && el.appendChild) {
                const a = document.createElement('a');
                if (opts) {
                    if (opts.cls) a.className = opts.cls;
                    if (opts.text != null) a.textContent = opts.text;
                    if (opts.href != null) a.setAttribute('href', opts.href);
                    if (opts.attr) { for (const k of Object.keys(opts.attr)) a.setAttribute(k, opts.attr[k]); }
                }
                el.appendChild(a);
                return a;
            }
            return null;
        };
        try {
            // Clear el (works for DOM nodes AND stubs exposing empty/setText).
            if (typeof el.empty === 'function') el.empty();
            else if (typeof el.setText === 'function') el.setText('');
            else if ('textContent' in el) el.textContent = '';
            while (el.firstChild) el.removeChild(el.firstChild);
        } catch (_e) { /* clearing best-effort */ }
        try {
            const segs = TaskTodayList._parseInlineLinks(str);
            for (const seg of segs) {
                if (!seg) continue;
                if (seg.type === 'text') { appendText(seg.value); continue; }
                if (seg.type === 'wikilink') {
                    const target = seg.target;
                    const label = seg.alias || target;
                    const a = makeAnchor({ cls: 'internal-link', text: label, href: '#' });
                    if (!a) { appendText(label); continue; }
                    try { if (a.dataset) a.dataset.href = target; else if (a.setAttribute) a.setAttribute('data-href', target); } catch (_e) { try { a.setAttribute('data-href', target); } catch (_e2) {} }
                    if (typeof a.addEventListener === 'function') {
                        a.addEventListener('click', (ev) => {
                            try { ev.preventDefault(); ev.stopPropagation(); } catch (_e) {}
                            try {
                                const w = appRef;
                                if (w && w.workspace && typeof w.workspace.openLinkText === 'function') {
                                    w.workspace.openLinkText(target, sourcePath || '', false);
                                }
                            } catch (_e) { /* open best-effort */ }
                        });
                    }
                    continue;
                }
                if (seg.type === 'mdlink' || seg.type === 'url') {
                    const url = seg.url;
                    const label = (seg.type === 'mdlink') ? seg.label : url;
                    const a = makeAnchor({ text: label, href: url, attr: { target: '_blank', rel: 'noopener' } });
                    if (!a) { appendText(label); continue; }
                    if (typeof a.addEventListener === 'function') {
                        a.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} });
                    }
                    continue;
                }
            }
        } catch (_e) {
            setPlain();
        }
    }

    /**
     * DEPRECATED alias kept for source-compat — the title/LINKS renderers now use
     * the deterministic renderInlineLinks. Delegates so any lingering caller still
     * gets real clickable anchors (was a MarkdownRenderer path that always fell
     * back to raw text in the customJS eval context). Never throws.
     */
    static _renderTitleMarkdown(titleEl, mdText, sourcePath) {
        const text = String(mdText == null ? '' : mdText) || '(untitled)';
        return TaskTodayList.renderInlineLinks(titleEl, text, sourcePath);
    }

    /** Strip surrounding `[[ ]]` from a wikilink for chip display (static). */
    static _stripWikilink(v) {
        const s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]+)\]\]$/.exec(s);
        return m ? m[1] : s;
    }

    /**
     * Clean project label for the chip. Dataview resolves a `[[Connectors]]`
     * frontmatter value to a full-path Link (`spice/projects/connectors/
     * Connectors.md|Connectors`), so `_stripWikilink` alone would show the whole
     * path. Prefer TaskEntity._linkText (the canonical basename extractor —
     * handles Link objects + path + `|alias` + `.md`) so the chip reads
     * `Connectors`. Falls back to a self-contained basename extract when
     * TaskEntity isn't loaded (cold load / Node), so the chip is always clean.
     * Never throws.
     */
    static _projectChipText(v) {
        try {
            const TE = (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null;
            if (TE && typeof TE._linkText === 'function') {
                const out = TE._linkText(v);
                if (out) return out;
            }
        } catch (_e) { /* fall through to local extract */ }
        // Local fallback: basename of a Link object / wikilink / path string.
        const baseOf = (s) => {
            let out = String(s == null ? '' : s).trim();
            const slash = out.lastIndexOf('/');
            if (slash >= 0) out = out.slice(slash + 1);
            return out.replace(/\.md$/i, '');
        };
        if (v && typeof v === 'object' && ('path' in v || 'display' in v)) {
            if (v.path != null && String(v.path).trim() !== '') return baseOf(v.path);
            if (v.display != null) return String(v.display).trim();
            return '';
        }
        let s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]*)\]\]$/.exec(s);
        if (m) s = m[1].trim();
        const pipe = s.indexOf('|');
        if (pipe >= 0) s = s.slice(0, pipe).trim();
        return baseOf(s);
    }
}
