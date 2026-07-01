/**
 * TaskTodayList (CustomJS) — the daily live-query widget for the note-per-task
 * model. Third class of the task-entity mechanism (after TaskEntity, the pure
 * core, and TaskDialog, the create/edit/done/delete dialog).
 *
 * Renders on a `type: to-do` daily note (invoked via customjs-guard, so its
 * entry method is the instance `render(dv)`). It live-queries the task notes
 * under `spice/tasks/` (open only, excluding _done/ + _trash/), partitions them
 * into an "Overdue / Carryover" band and a "Today" band, and draws each task as
 * a row with a functional done-checkbox + metadata chips. Every mutation is
 * DELEGATED to TaskDialog — the widget only READS the task notes; it never
 * writes one directly. That keeps the single-file-write invariant (a bad write
 * can only ever touch one task's file) entirely inside TaskDialog:
 *   - checkbox change → TaskDialog.markDone(path)   (status=done + move to _done/)
 *   - row click       → TaskDialog.open({ edit: path })
 *   - + New Task      → TaskDialog.open({ surface: 'daily', today })
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

        // + New Task button (top) → delegate to TaskDialog with the daily surface.
        const newBtn = wrap.createEl('button', { cls: 'sauce-task-today-new', text: '+ New Task' });
        newBtn.style.cssText = 'align-self: flex-start; padding: 4px 12px; border-radius: 4px; border: 1px solid var(--interactive-accent, #6a6abf); background: var(--interactive-accent, #6a6abf); color: white; cursor: pointer; font-size: 0.85em;';
        newBtn.addEventListener('click', () => {
            try {
                window.customJS.TaskDialog.open({ surface: 'daily', today });
            } catch (e) {
                try { new Notice('Could not open task dialog: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        });

        // Overdue / Carryover band (only when non-empty).
        if (bands.overdue.length) {
            this._renderBand(wrap, 'Overdue / Carryover', bands.overdue, null);
        }

        // Today band — always shown, with an empty hint.
        this._renderBand(wrap, 'Today', bands.today, 'No tasks scheduled today');
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
     * Render one task row: functional done-checkbox → TaskDialog.markDone(path);
     * title text (row click → TaskDialog.open({ edit: path })); chips for
     * project / priority / due when present.
     */
    _renderRow(band, task) {
        const path = task && task.path;
        const row = band.createEl('div', { cls: 'sauce-task-today-row' });
        // flex-wrap so a long title + its chips never squeeze the title into a
        // one-char-per-line column on a narrow (mobile) container: the title
        // holds line 1, chips flow onto line 2 when there isn't room.
        row.style.cssText = 'display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent; width: 100%; box-sizing: border-box;';
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
            if (!path) { cb.checked = false; return; }
            try {
                const res = await window.customJS.TaskDialog.markDone(path);
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

        // Title — clicking the row (not the checkbox) opens the editor.
        const title = row.createEl('span', { cls: 'sauce-task-today-title', text: (task && task.title) || '(untitled)' });
        // flex-basis 60% + a readable min-width keeps the title the dominant
        // column; break-word wraps only long words (not every character).
        title.style.cssText = 'flex: 1 1 60%; min-width: 8em; overflow-wrap: break-word; word-break: break-word; color: var(--text-normal); cursor: pointer;';

        const openEditor = () => {
            if (!path) return;
            try {
                window.customJS.TaskDialog.open({ edit: path });
            } catch (e) {
                try { new Notice('Could not open task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        };
        title.addEventListener('click', openEditor);

        // Metadata chips (only when set): project / priority / due.
        const chips = row.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center;';
        const addChip = (label) => {
            const chip = chips.createEl('span', { text: label });
            chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
        };
        if (task && task.project) addChip(this._stripWikilink(task.project));
        if (task && task.priority) addChip(String(task.priority));
        if (task && task.due) addChip('due: ' + task.due);
    }

    /** Strip surrounding `[[ ]]` from a wikilink for chip display. */
    _stripWikilink(v) {
        const s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]+)\]\]$/.exec(s);
        return m ? m[1] : s;
    }
}
