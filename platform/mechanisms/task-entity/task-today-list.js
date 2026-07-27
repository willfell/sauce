/**
 * TaskTodayList (CustomJS) — the daily live-query widget for the note-per-task
 * model. Third class of the task-entity mechanism (after TaskEntity, the pure
 * core, and TaskDialog, the create/edit/done/delete dialog).
 *
 * Renders on a `type: to-do` daily note (invoked via customjs-guard, so its
 * entry method is the instance `render(dv)`). It live-queries the task notes
 * under `spice/tasks/` (open only, excluding _done/ + _trash/), partitions them
 * into a "Today" band (rendered FIRST), an "Overdue / Carryover" band, and an
 * "Upcoming" band (future-due, rendered LAST), and draws each task as a row
 * with a functional done-checkbox + metadata chips.
 * Task CREATION lives in ToDoLeafActions' single nav-button "New Task" (this
 * widget renders no create button of its own). Mutations are either delegated
 * to TaskDialog or, for the narrow move-to-tomorrow row action, use Obsidian's
 * processFrontMatter rail against the resolved task file. Every gesture keeps
 * the single-file-write invariant (a bad write can only ever touch one task):
 *   - checkbox change → TaskDialog.markDone(path)   (status=done + move to _done/)
 *   - tomorrow action → processFrontMatter(file, fm => fm.due = nextDay(viewedDay))
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
 *   TaskTodayList.nextDay(todayStr) → next YYYY-MM-DD calendar date
 *   TaskTodayList.buildBands(parsedTasks, todayStr) → { today, overdue, upcoming }
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
    nextDay(todayStr) { return TaskTodayList.nextDay(todayStr); }
    markTaskRow(row, task) { return TaskTodayList.markTaskRow(row, task); }
    rescheduleTomorrow(row, task, viewedDay, TDref) { return TaskTodayList.rescheduleTomorrow(row, task, viewedDay, TDref); }
    renderTaskRow(container, task, TDref, options) { return TaskTodayList.renderTaskRow(container, task, TDref, options); }
    renderInlineLinks(el, text, sourcePath) { return TaskTodayList.renderInlineLinks(el, text, sourcePath); }
    _parseInlineLinks(text) { return TaskTodayList._parseInlineLinks(text); }
    _renderTitleMarkdown(titleEl, mdText, sourcePath) { return TaskTodayList._renderTitleMarkdown(titleEl, mdText, sourcePath); }
    _stripWikilink(v) { return TaskTodayList._stripWikilink(v); }
    _projectChipText(v) { return TaskTodayList._projectChipText(v); }

    // ---------- Static pure helper ----------

    /**
     * Return the next calendar date after a normalized YYYY-MM-DD string.
     * Calendar arithmetic is performed directly rather than through Date/Luxon,
     * so the result cannot shift with the host timezone. Invalid dates fail
     * closed with an empty string; never throws.
     */
    static nextDay(todayStr) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayStr || ''));
        if (!match) return '';
        let year = Number(match[1]);
        let month = Number(match[2]);
        let day = Number(match[3]);
        const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        const daysInMonth = (y, m) =>
            [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] || 0;
        const maxDay = daysInMonth(year, month);
        if (!maxDay || day < 1 || day > maxDay) return '';
        day += 1;
        if (day > maxDay) {
            day = 1;
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        }
        return String(year).padStart(4, '0') + '-'
            + String(month).padStart(2, '0') + '-'
            + String(day).padStart(2, '0');
    }

    /**
     * Stamp a rendered row with stable task identity + render order. The identity
     * prevents an in-flight rollback from duplicating a replacement row after a
     * Dataview rerender. Render order lets concurrent adjacent failures recover
     * correctly even when every original sibling anchor is temporarily detached.
     */
    static markTaskRow(row, task) {
        try {
            if (!row || !row.dataset || !task || !task.path) return row;
            row.dataset.sauceTaskPath = String(task.path);
            if (!row.dataset.sauceTaskOrder) {
                TaskTodayList._rescheduleRowSequence =
                    Number(TaskTodayList._rescheduleRowSequence || 0) + 1;
                row.dataset.sauceTaskOrder = String(TaskTodayList._rescheduleRowSequence);
            }
        } catch (_e) {}
        return row;
    }

    /**
     * Reschedule one OPEN task to the day after `viewedDay`, using the canonical
     * Obsidian processFrontMatter rail. This is shared by TaskTodayList's own
     * row and SpaceDailyDashboard's private row renderer.
     *
     * The row is removed before awaiting the write for instant feedback. On
     * failure, rollback selects only a still-valid anchor, falls back to stable
     * render order when adjacent rows are also in flight, and recognizes a
     * rerendered replacement so it never inserts a stale duplicate. TaskDialog
     * remains the readiness boundary: before it or the app/file rail exists,
     * this is a silent no-op. Completed/archive rows are rejected even if a
     * caller invokes this method directly.
     */
    static async rescheduleTomorrow(row, task, viewedDay, TDref) {
        try {
            if (!row || !task || task.status !== 'open' || !task.path) return { ok: false, no_op: true };
            const TD = TDref
                || (typeof window !== 'undefined' && window.customJS && window.customJS.TaskDialog)
                || null;
            if (!TD || typeof TD.open !== 'function') return { ok: false, no_op: true };

            const appRef = (typeof window !== 'undefined' && window.app)
                || (typeof globalThis !== 'undefined' && globalThis.app)
                || null;
            if (!appRef || !appRef.vault || typeof appRef.vault.getAbstractFileByPath !== 'function'
                || !appRef.fileManager || typeof appRef.fileManager.processFrontMatter !== 'function') {
                return { ok: false, no_op: true };
            }

            let baseDay = String(viewedDay || '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDay)) {
                const momentRef = (typeof window !== 'undefined' && window.moment) || null;
                baseDay = typeof momentRef === 'function' ? String(momentRef().format('YYYY-MM-DD') || '') : '';
            }
            const tomorrow = TaskTodayList.nextDay(baseDay);
            const file = appRef.vault.getAbstractFileByPath(task.path);
            if (!tomorrow || !file) return { ok: false, no_op: true };

            try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
            TaskTodayList.markTaskRow(row, task);
            const parent = row.parentNode;
            const childList = (node) => {
                try { return Array.from((node && (node.childNodes || node.children)) || []); }
                catch (_e) { return []; }
            };
            const originalChildren = childList(parent);
            const originalIndex = originalChildren.indexOf(row);
            const following = originalIndex >= 0 ? originalChildren.slice(originalIndex + 1) : [];
            const preceding = originalIndex >= 0 ? originalChildren.slice(0, originalIndex).reverse() : [];
            const taskPath = String(task.path);
            const rowOrder = Number(row.dataset && row.dataset.sauceTaskOrder);
            const restore = () => {
                if (!parent || row.parentNode) return false;
                // A detached old render tree must not receive stale DOM after
                // Dataview has replaced it with a new connected tree.
                if (typeof parent.isConnected === 'boolean' && !parent.isConnected) return false;

                const current = childList(parent);
                const replacementExists = current.some((node) =>
                    node !== row && node && node.dataset
                    && String(node.dataset.sauceTaskPath || '') === taskPath);
                if (replacementExists) return true;

                const insert = (anchor) => {
                    if (anchor != null && anchor.parentNode !== parent) return false;
                    try {
                        parent.insertBefore(row, anchor || null);
                        return row.parentNode === parent;
                    } catch (_e) {
                        return false;
                    }
                };

                // Prefer the nearest surviving original anchor. Saving the full
                // suffix (not only nextSibling) handles adjacent removals.
                const next = following.find((node) => node && node.parentNode === parent);
                if (next && insert(next)) return true;

                // If every original following sibling is detached, stable render
                // order still locates this row relative to concurrently restored
                // task rows (including when these were the final two rows).
                if (Number.isFinite(rowOrder)) {
                    const orderedRows = childList(parent).filter((node) =>
                        node && node.dataset && Number.isFinite(Number(node.dataset.sauceTaskOrder)));
                    const later = orderedRows.find((node) =>
                        Number(node.dataset.sauceTaskOrder) > rowOrder);
                    if (later && insert(later)) return true;
                    const earlier = orderedRows.filter((node) =>
                        Number(node.dataset.sauceTaskOrder) < rowOrder).pop();
                    if (earlier) {
                        const afterEarlier = earlier.nextSibling;
                        if ((afterEarlier == null || afterEarlier.parentNode === parent)
                            && insert(afterEarlier)) return true;
                    }
                }

                const previous = preceding.find((node) => node && node.parentNode === parent);
                if (previous) {
                    const afterPrevious = previous.nextSibling;
                    if ((afterPrevious == null || afterPrevious.parentNode === parent)
                        && insert(afterPrevious)) return true;
                }

                // Final deterministic fallback for a still-live container. Clamp
                // the original ordinal to its current child count, then append if
                // a host-specific insertBefore implementation still rejects it.
                const now = childList(parent);
                const ordinal = Math.max(0, Math.min(
                    originalIndex >= 0 ? originalIndex : now.length,
                    now.length
                ));
                if (insert(now[ordinal] || null)) return true;
                if (!row.parentNode && typeof parent.appendChild === 'function') {
                    try { parent.appendChild(row); } catch (_e) {}
                }
                return row.parentNode === parent;
            };
            try { row.remove(); } catch (_e) {}
            try {
                await appRef.fileManager.processFrontMatter(file, (fm) => { fm.due = tomorrow; });
                return { ok: true, due: tomorrow };
            } catch (e) {
                restore();
                try { new Notice('Could not reschedule task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
                return { ok: false, reason: String(e && (e.message || e) || 'write failed') };
            }
        } catch (_e) {
            return { ok: false, no_op: true };
        }
    }

    /**
     * Partition a list of ALREADY-PARSED task objects (parseNote output, or any
     * object with `{ due, status, project_slug, source }`) relative to
     * `todayStr` (YYYY-MM-DD). Open-only, and PERSONAL-daily-only — a task that
     * belongs to another daily section is EXCLUDED so it doesn't render twice:
     *   today    — status "open", due === todayStr, NO project, NOT meeting
     *   overdue  — status "open", due < todayStr, NO project, NOT meeting
     *   upcoming — status "open", due > todayStr, NO project, NOT meeting
     * (string compare of zero-padded ISO dates is chronologically correct.)
     * A task WITH a project_slug renders in its "Project Tasks" section
     * (ToDoDailyProjectGroups); a task with source "meeting" renders in "Meeting
     * Tasks" (ToDoDailyUnassignedMeetings) — both surface ALL open matching
     * task-notes, so excluding them here loses nothing. A task WITH a
     * parent_task is a subtask and renders in its parent's "Subtasks" section
     * instead, so it is excluded here too. Unscheduled open tasks land in
     * Today. Tolerates a null/non-array input (→ empty bands); never throws.
     */
    static buildBands(parsedTasks, todayStr) {
        const PRIO_RANK = { highest: 4, high: 3, medium: 2, low: 1 };
        const prioOf = (t) => PRIO_RANK[String(t.priority || '').toLowerCase()] || 0;

        const today = [];
        const overdue = [];
        const upcoming = [];
        const list = Array.isArray(parsedTasks) ? parsedTasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            if (t.project_slug && String(t.project_slug).trim() !== '') continue;
            if (t.source === 'meeting') continue;
            if (t.parent_task && String(t.parent_task).trim() !== '') continue;
            if (t.trip_slug && String(t.trip_slug).trim() !== '') continue;
            const due = t.due;
            if (!due) { today.push(t); continue; }
            if (due === todayStr) today.push(t);
            else if (due < todayStr) overdue.push(t);
            else upcoming.push(t);
        }
        const sortBand = (arr) => {
            arr.sort((a, b) => {
                const pa = prioOf(a), pb = prioOf(b);
                if (pa !== pb) return pb - pa;
                const ad = a.due || '', bd = b.due || '';
                if (ad !== bd) {
                    if (ad === '') return 1;
                    if (bd === '') return -1;
                    return ad < bd ? -1 : 1;
                }
                return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
            });
        };
        sortBand(overdue);
        sortBand(today);
        // Upcoming is sorted purely soonest-first (chronological), not by
        // priority — its whole purpose is "what's coming next," so date order
        // is the useful order here (unlike Today/Overdue, which are same-day
        // buckets where priority is the more useful tiebreak).
        upcoming.sort((a, b) => {
            const ad = a.due || '', bd = b.due || '';
            if (ad !== bd) return ad < bd ? -1 : 1;
            return String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase());
        });
        return { today: today, overdue: overdue, upcoming: upcoming };
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Live-queries the task
     * notes, partitions them, and draws the three bands. Fully guarded — returns
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

        // Attach an optional subtask-count summary to each task BEFORE banding
        // it — one shared vault-wide query (TaskEntity.subtaskCountsByParent),
        // not a per-row query, so N tasks cost one extra dv.pages() call, not N.
        const subtaskCounts = (typeof TE.subtaskCountsByParent === 'function') ? TE.subtaskCountsByParent(dv) : {};
        for (const t of parsed) {
            const basename = t && t.path ? t.path.split('/').pop().replace(/\.md$/i, '') : '';
            t.subtask_count = subtaskCounts[basename] || null;
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

        // Upcoming band LAST — future-due personal tasks with no other home
        // on this daily (only when non-empty).
        if (bands.upcoming.length) {
            this._renderBand(wrap, 'Upcoming', bands.upcoming, null);
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
    static renderTaskRow(container, task, TDref, options) {
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
        TaskTodayList.markTaskRow(row, task);
        // The right cluster (chips + action icons) sits beside the title when the
        // row is wide enough, and WRAPS to its own right-aligned line when the title
        // is long — flex-wrap + a title min-width floor. Without the floor a long
        // title would collapse to one character per line to make room for the wide
        // cluster (project + due chips + two icons); the floor keeps the title
        // readable and forces the cluster to wrap instead. align-items:flex-start
        // pins the cluster to the top of the first title line while a long title
        // wraps within its own column.
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 4px 6px 8px; border-radius: 4px; border: 1px solid transparent; border-bottom: 1px solid var(--background-modifier-border); width: 100%; box-sizing: border-box;';
        if (!TaskTodayList._rowDividerStyleInjected && typeof document !== 'undefined' && document.head) {
            const s = document.createElement('style');
            s.textContent = '.sauce-task-today-row:last-child { border-bottom: none !important; }';
            document.head.appendChild(s);
            TaskTodayList._rowDividerStyleInjected = true;
        }
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-secondary)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        // Checkbox + title grouped in a NON-wrapping sub-container so they are
        // never split across lines from each other (FIX: a long title used to
        // push the whole `title` flex item to its own line, stranding the
        // checkbox alone on line 1 — CSS flex-wrap decides breaks using an
        // item's UNSHRUNK width, not its post-wrap rendered width). `flex: 1 1
        // auto; min-width: 0` lets the group take the remaining row width while
        // still allowing the title's own text to wrap internally.
        const titleGroup = row.createEl('div', { cls: 'sauce-task-today-titlegroup' });
        titleGroup.style.cssText = 'display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 8px; flex: 1 1 auto; min-width: 0;';

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
        const cbWrap = titleGroup.createEl('div', { cls: 'sauce-task-today-cbwrap' });
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
        const title = titleGroup.createEl('span', { cls: 'sauce-task-today-title' });
        // Title takes the remaining space (flex:1 1 auto) and wraps WITHIN its
        // column (break-word wraps long words). The min-width:8em FLOOR keeps a long
        // title readable and forces the right cluster (chips + icons) to wrap to its
        // own line rather than crushing the title to one character per line. The
        // EXPLICIT line-height:1.5 must match the checkbox wrapper's 1.5em height so
        // the checkbox centers on the first line of the title (see cbWrap above)
        // regardless of theme defaults.
        title.style.cssText = 'flex: 1 1 auto; min-width: 8em; line-height: 1.5; overflow-wrap: break-word; word-break: break-word; color: var(--text-normal); cursor: pointer;';
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

        // Right cluster — chips + action icons grouped so they wrap together (below
        // the title, right-aligned) when the row is tight, instead of each squeezing
        // the title independently. margin-left:auto hugs it to the right on line 1.
        const rightCluster = row.createEl('div', { cls: 'sauce-task-today-right' });
        rightCluster.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto;';

        // Metadata chips (only when set): project / priority / due. flex-shrink:0
        // so the chips never shrink or clip — DUE stays intact.
        // Repeat badge — a small icon (not a text chip) shown when the task has
        // a recurrence grammar set, so a recurring task is visually distinct at
        // a glance without opening the note.
        if (task && task.recurrence) {
            const badge = rightCluster.createEl('span', { cls: 'sauce-task-today-recur-badge' });
            badge.style.cssText = 'display:inline-flex; align-items:center; flex-shrink:0; color:var(--text-muted);';
            try { badge.setAttribute('title', 'Repeats: ' + task.recurrence); } catch (_e) {}
            badge.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
        }

        const chips = rightCluster.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center; justify-content: flex-end; flex-shrink: 0;';
        const addChip = (label, cls) => {
            const chip = chips.createEl('span', { text: label, cls: cls });
            chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
        };
        if (task && task.project) addChip(TaskTodayList._projectChipText(task.project));
        if (task && task.priority) addChip(String(task.priority));
        if (task && task.due) addChip('due: ' + task.due);
        // Subtask-progress chip — OPTIONAL, attached by the caller (daily /
        // project / meeting render() via TaskEntity.subtaskCountsByParent), NOT
        // queried here (renderTaskRow stays dv-free by design). Shown only when
        // the task actually has ≥1 subtask.
        if (task && task.subtask_count && task.subtask_count.total > 0) {
            addChip(task.subtask_count.done + '/' + task.subtask_count.total + ' subtasks', 'sauce-task-today-subtask-chip');
        }

        // Row actions at the FAR-RIGHT end of the cluster. Open rows render
        // tomorrow + edit + delete; completed/archive rows render edit + delete
        // only. The controls live in a fixed 1.5em-tall flex box
        // that vertically centers them against the FIRST line of the
        // (line-height:1.5) title — the same trick the checkbox wrapper uses — so
        // the row stays aligned even when a long title wraps, and every button is
        // flex-shrink:0 so it never collapses.
        //   - Open note → app.workspace.openLinkText(path) (same as the title click)
        //   - Edit      → TaskDialog.open({ edit: path })   (the edit dialog, NOT
        //                 the note — the note opens via the title click)
        //   - Tomorrow  → rescheduleTomorrow(row, task, viewedDay)
        //   - Delete    → TaskDialog.confirmDelete(path)     (yes/no modal; on
        //                 confirm the row is removed optimistically)
        // Every gesture is lazily resolved (getTD() / window at click-time) + fully
        // guarded, so a cold-load just no-ops the tap. Never throws.
        const svg = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
        const ICON = {
            tomorrow: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m12 14 2 2-2 2"/><path d="M9 16h5"/>'),
            wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
            trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
        };
        const actions = rightCluster.createEl('div', { cls: 'sauce-task-today-actions' });
        actions.style.cssText = 'display: flex; align-items: center; gap: 2px; flex-shrink: 0; height: 1.5em; min-height: 1.5em;';
        const ACTION_BASE = 'display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 100%; min-height: 24px; padding: 0; border: none; border-radius: var(--radius-s, 4px); background: transparent; color: var(--text-faint, #999); cursor: pointer; flex-shrink: 0; transition: background 120ms ease, color 120ms ease;';
        const mkActionBtn = (cls, aria, icon, danger) => {
            const b = actions.createEl('button', { cls: cls });
            b.style.cssText = ACTION_BASE;
            try { b.setAttribute('type', 'button'); b.setAttribute('aria-label', aria); b.setAttribute('title', aria); } catch (_e) {}
            b.innerHTML = icon;
            const hoverFg = danger ? 'var(--text-error, #e05561)' : 'var(--text-normal, #ddd)';
            b.addEventListener('mouseenter', () => { b.style.background = 'var(--background-modifier-hover, rgba(255,255,255,0.06))'; b.style.color = hoverFg; });
            b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = 'var(--text-faint, #999)'; });
            b.addEventListener('focus', () => { b.style.outline = '2px solid var(--interactive-accent, #6a6abf)'; b.style.outlineOffset = '1px'; b.style.color = hoverFg; });
            b.addEventListener('blur', () => { b.style.outline = 'none'; b.style.color = 'var(--text-faint, #999)'; });
            return b;
        };

        // Row gestures share lazy dependency resolution. A cold-load tap is a
        // silent no-op; only status:open rows receive the tomorrow control.
        const doTomorrow = async () => {
            const viewedDay = options && typeof options.viewedDay === 'string'
                ? options.viewedDay
                : '';
            return TaskTodayList.rescheduleTomorrow(row, task, viewedDay, TDref);
        };
        const doEdit = () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.open !== 'function') return;
            try { TD.open({ edit: path }); }
            catch (e) { try { new Notice('Could not open task editor: ' + (e && (e.message || e)), 6000); } catch (_e) {} }
        };
        const doDelete = async () => {
            const TD = getTD();
            if (!path || !TD || typeof TD.confirmDelete !== 'function') return;
            try {
                const res = await TD.confirmDelete(path);
                if (res && res.ok) {
                    try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                    try { row.remove(); } catch (_e) {}
                }
            } catch (e) {
                try { new Notice('Could not delete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        };

        if (task && task.status === 'open') {
            const tomorrowBtn = mkActionBtn('sauce-task-action-tomorrow', 'Move to tomorrow', ICON.tomorrow, false);
            tomorrowBtn.addEventListener('click', async (ev) => {
                try { ev.stopPropagation(); } catch (_e) {}
                await doTomorrow();
            });
        }
        const editBtn = mkActionBtn('sauce-task-action-edit', 'Edit task', ICON.wrench, false);
        editBtn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} doEdit(); });
        const delBtn = mkActionBtn('sauce-task-action-delete', 'Delete task', ICON.trash, true);
        delBtn.addEventListener('click', async (ev) => { try { ev.stopPropagation(); } catch (_e) {} await doDelete(); });

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
