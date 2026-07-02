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
 *   - row click       → TaskDialog.open({ edit: path })
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
    _renderTitleMarkdown(titleEl, mdText, sourcePath) { return TaskTodayList._renderTitleMarkdown(titleEl, mdText, sourcePath); }
    _stripWikilink(v) { return TaskTodayList._stripWikilink(v); }

    // ---------- Static pure helper ----------

    /**
     * Partition a list of ALREADY-PARSED task objects (parseNote output, or any
     * object with `{ scheduled, status }`) relative to `todayStr` (YYYY-MM-DD).
     * Mirrors TaskEntity.queryToday exactly, but is inlined here so the pure
     * partition is Node-testable without loading TaskEntity. Open-only:
     *   today   — status === "open" AND scheduled === todayStr
     *   overdue — status === "open" AND scheduled truthy AND scheduled < todayStr
     * (string compare of zero-padded ISO dates is chronologically correct.)
     * Future-scheduled + unscheduled open tasks land in NEITHER band. Tolerates
     * a null/non-array input (→ empty bands); never throws.
     */
    static buildBands(parsedTasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
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
        // focus; always shown, with an empty hint.
        this._renderBand(wrap, 'Today', bands.today, 'No tasks scheduled today');

        // Overdue / Carryover band below (only when non-empty).
        if (bands.overdue.length) {
            this._renderBand(wrap, 'Overdue / Carryover', bands.overdue, null);
        }
    }

    /**
     * Render one labeled band (a SectionLabel-ish caption + the task rows). When
     * `tasks` is empty and `emptyHint` is provided, show a subtle hint instead of
     * rows; when empty and no hint, render nothing (skips empty overdue bands).
     */
    _renderBand(wrap, label, tasks, emptyHint) {
        const band = wrap.createEl('div', { cls: 'sauce-task-today-band' });
        band.style.cssText = 'display: flex; flex-direction: column; gap: 4px; width: 100%; box-sizing: border-box;';

        const cap = band.createEl('div', { cls: 'sauce-task-today-label', text: label });
        cap.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #999); margin-bottom: 2px;';

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
     *   - a title (row/title click → TaskDialog.open({ edit: path }))
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
        // trigger the row-click editor.
        const cb = row.createEl('input');
        cb.type = 'checkbox';
        cb.checked = false;
        cb.style.cssText = 'margin: 0; cursor: pointer; flex-shrink: 0;';
        cb.addEventListener('click', (ev) => { ev.stopPropagation(); });
        cb.addEventListener('change', async () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.markDone !== 'function') { cb.checked = false; return; }
            try {
                const res = await TD.markDone(path);
                if (res && res.ok === false) {
                    cb.checked = false;
                    try { new Notice('Could not complete task: ' + (res.reason || 'unknown'), 6000); } catch (_e) {}
                }
                // On success the file moves to _done/; the live query drops it
                // and re-renders this block without the row.
            } catch (e) {
                cb.checked = false;
                try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        });

        // Title — clicking the row (not the checkbox) opens the editor. The title
        // text is rendered as MARKDOWN so `[Chat](url)` + `[[wikilink]]` become
        // clickable links (was plain text → they showed literally). Renders inline
        // (block margins stripped) and falls back to plain text where the
        // MarkdownRenderer API is unavailable.
        const titleText = (task && task.title) || '(untitled)';
        const title = row.createEl('span', { cls: 'sauce-task-today-title' });
        // Title takes the remaining space (flex:1 1 auto) and wraps WITHIN its
        // column (min-width:0 lets it shrink; break-word wraps long words) so the
        // chips never get pushed off the row.
        title.style.cssText = 'flex: 1 1 auto; min-width: 0; overflow-wrap: break-word; word-break: break-word; color: var(--text-normal); cursor: pointer;';
        TaskTodayList._renderTitleMarkdown(title, titleText, path);

        const openEditor = () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.open !== 'function') return;
            try {
                TD.open({ edit: path });
            } catch (e) {
                try { new Notice('Could not open task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        };
        // Row/title click → open the editor, EXCEPT a click on a real `<a>` link
        // inside the title (handled by _renderTitleMarkdown's stopPropagation), so
        // opening a link doesn't ALSO pop the edit dialog.
        title.addEventListener('click', openEditor);

        // Metadata chips (only when set): project / priority / due. flex-shrink:0
        // so the chips never shrink or wrap off — DUE stays on the task's row.
        const chips = row.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center; flex-shrink: 0;';
        const addChip = (label) => {
            const chip = chips.createEl('span', { text: label });
            chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
        };
        if (task && task.project) addChip(TaskTodayList._stripWikilink(task.project));
        if (task && task.priority) addChip(String(task.priority));
        if (task && task.due) addChip('due: ' + task.due);
        return row;
    }

    /**
     * Render `mdText` as inline MARKDOWN into `titleEl` so `[label](url)` +
     * `[[wikilink]]` in a task title become CLICKABLE links (was plain text →
     * they showed literally). SELF-CONTAINED + feature-guarded:
     *   - Uses Obsidian's MarkdownRenderer.render(app, md, el, sourcePath, comp)
     *     when present (newer API), falling back to the older
     *     MarkdownRenderer.renderMarkdown(md, el, sourcePath, comp). `component`
     *     is a lightweight no-op stub (Obsidian only needs addChild/register).
     *   - If neither API is reachable (or the render throws), falls back to plain
     *     text (titleEl.textContent = mdText) so a title always shows.
     *   - Strips block margins on the injected <p> so the title stays on ONE row.
     *   - Stops propagation on `<a>` clicks inside the title so following a real
     *     link doesn't ALSO trigger the row-click edit dialog.
     * `sourcePath` (the task-note path) resolves relative `[[wikilink]]` targets.
     * Never throws.
     */
    static _renderTitleMarkdown(titleEl, mdText, sourcePath) {
        if (!titleEl) return;
        const text = String(mdText == null ? '' : mdText);
        const plain = () => { try { titleEl.textContent = text || '(untitled)'; } catch (_e) {} };
        let MR = null;
        try {
            MR = (typeof MarkdownRenderer !== 'undefined' && MarkdownRenderer)
                || (typeof window !== 'undefined' && window.MarkdownRenderer)
                || null;
        } catch (_e) { MR = null; }
        const appRef = (typeof app !== 'undefined' && app)
            || (typeof window !== 'undefined' && window.app)
            || null;
        // Lightweight Component stub — Obsidian's renderer only calls
        // addChild/register/load on it; no-ops are fine for a transient row.
        const comp = { addChild() {}, register() {}, load() {}, onload() {}, unload() {} };
        let rendered = false;
        try {
            if (MR && typeof MR.render === 'function' && appRef) {
                // Newer signature: render(app, markdown, el, sourcePath, component).
                MR.render(appRef, text, titleEl, sourcePath || '', comp);
                rendered = true;
            } else if (MR && typeof MR.renderMarkdown === 'function') {
                // Older signature: renderMarkdown(markdown, el, sourcePath, component).
                MR.renderMarkdown(text, titleEl, sourcePath || '', comp);
                rendered = true;
            }
        } catch (_e) { rendered = false; }
        if (!rendered) { plain(); return; }
        // Strip block margins so the rendered <p> sits inline on the row, and
        // stop `<a>` click bubbling so a link click doesn't open the editor too.
        try {
            const kids = titleEl.querySelectorAll ? titleEl.querySelectorAll('p') : [];
            kids.forEach((p) => { p.style.margin = '0'; p.style.display = 'inline'; });
            const anchors = titleEl.querySelectorAll ? titleEl.querySelectorAll('a') : [];
            anchors.forEach((a) => {
                a.style.cursor = 'pointer';
                a.addEventListener('click', (ev) => { ev.stopPropagation(); });
            });
        } catch (_e) { /* cosmetic — tolerate */ }
    }

    /** Strip surrounding `[[ ]]` from a wikilink for chip display (static). */
    static _stripWikilink(v) {
        const s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]+)\]\]$/.exec(s);
        return m ? m[1] : s;
    }
}
