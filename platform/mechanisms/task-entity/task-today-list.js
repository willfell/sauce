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
 *   - tomorrow action → processFrontMatter(file, fm => fm.due = tomorrowFor(task, viewedDay)),
 *     the day after the later of the viewed day and the task's own due date
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
    reschedule(row, task, newDue, viewedDay, TDref) { return TaskTodayList.reschedule(row, task, newDue, viewedDay, TDref); }
    rescheduleTomorrow(row, task, viewedDay, TDref) { return TaskTodayList.rescheduleTomorrow(row, task, viewedDay, TDref); }
    tomorrowFor(task, viewedDay) { return TaskTodayList.tomorrowFor(task, viewedDay); }
    dayLabel(ymd) { return TaskTodayList.dayLabel(ymd); }
    renderTaskRow(container, task, TDref, options) { return TaskTodayList.renderTaskRow(container, task, TDref, options); }
    renderInlineLinks(el, text, sourcePath) { return TaskTodayList.renderInlineLinks(el, text, sourcePath); }
    _parseInlineLinks(text) { return TaskTodayList._parseInlineLinks(text); }
    _renderTitleMarkdown(titleEl, mdText, sourcePath) { return TaskTodayList._renderTitleMarkdown(titleEl, mdText, sourcePath); }
    _stripWikilink(v) { return TaskTodayList._stripWikilink(v); }
    _projectChipText(v) { return TaskTodayList._projectChipText(v); }
    projectHue(name) { return TaskTodayList.projectHue(name); }
    projectTint(name) { return TaskTodayList.projectTint(name); }
    renderSubtaskMeter(slot, count) { return TaskTodayList.renderSubtaskMeter(slot, count); }
    get SILENT_REASONS() { return TaskTodayList.SILENT_REASONS; }
    classifyOutcome(res) { return TaskTodayList.classifyOutcome(res); }
    moveInOrder(list, path, dir) { return TaskTodayList.moveInOrder(list, path, dir); }
    reorderInOrder(list, fromPath, toPath) { return TaskTodayList.reorderInOrder(list, fromPath, toPath); }
    applyManualOrder(next, deps) { return TaskTodayList.applyManualOrder(next, deps); }
    manualOrder(deps) { return TaskTodayList.manualOrder(deps); }
    doneTimeLabel(task) { return TaskTodayList.doneTimeLabel(task); }
    renderDoneRow(container, task, options) { return TaskTodayList.renderDoneRow(container, task, options); }
    get SORT_OPTIONS() { return TaskTodayList.SORT_OPTIONS; }
    get GROUP_OPTIONS() { return TaskTodayList.GROUP_OPTIONS; }
    get DRAG_MIME() { return TaskTodayList.DRAG_MIME; }
    _isMobile(appRef) { return TaskTodayList._isMobile(appRef); }
    shortDueLabel(due) { return TaskTodayList.shortDueLabel(due); }
    _fromFormField(event) { return TaskTodayList._fromFormField(event); }
    clearDateLabel(task) { return TaskTodayList.clearDateLabel(task); }

    // ---------- Static pure helper ----------

    /**
     * Sort / Group menu entries shared by every task surface that offers them
     * (the To-Do daily view and the Today panel on Home and the daily note), so
     * the two never drift apart in wording.
     */
    static get SORT_OPTIONS() {
        return [
            { key: 'smart', label: 'Smart', sublabel: 'your order \u2192 priority \u2192 days late' },
            { key: 'manual', label: 'My order', sublabel: 'drag to arrange' },
            { key: 'priority', label: 'Priority', sublabel: 'highest first' },
            { key: 'due', label: 'Due date', sublabel: 'soonest first' },
            { key: 'oldest', label: 'Oldest first', sublabel: 'by created date' },
            { key: 'touched', label: 'Last touched', sublabel: 'recently edited first' },
        ];
    }

    static get GROUP_OPTIONS() {
        return [
            { key: 'none', label: 'None', sublabel: '' },
            { key: 'project', label: 'Project', sublabel: '' },
            { key: 'priority', label: 'Priority', sublabel: '' },
            { key: 'due', label: 'Due day', sublabel: '' },
        ];
    }

    /**
     * Drag payload type for a task row. A custom type (not text/plain) so a
     * row dropped into the editor inserts nothing.
     */
    static get DRAG_MIME() { return 'application/x-sauce-task-path'; }

    /** Obsidian mobile (app.isMobile or Platform.isMobile); false when unknown. */
    static _isMobile(appRef) {
        try {
            if (appRef && appRef.isMobile) return true;
            if (typeof Platform !== 'undefined' && Platform && Platform.isMobile) return true;
        } catch (_e) { /* treat as desktop */ }
        return false;
    }

    /** True when a drag starts inside a form field (e.g. the inline date picker). */
    static _fromFormField(event) {
        try {
            const target = event && event.target;
            return !!(target && typeof target.closest === 'function' && target.closest('input,textarea,select'));
        } catch (_e) { return false; }
    }

    /**
     * Label for the action that clears a task's due date. Only a personal task
     * lands in the Backlog (TaskEntity.isBacklog); a project, trip, meeting or
     * subtask just loses its date.
     */
    static clearDateLabel(task) {
        const t = Object.assign({}, task || {}, { due: null, status: 'open' });
        let backlog;
        try {
            const TE = TaskTodayList._rowTaskEntity();
            if (TE && typeof TE.isBacklog === 'function') backlog = !!TE.isBacklog(t);
        } catch (_e) { backlog = undefined; }
        if (backlog === undefined) {
            backlog = !(t.project_slug || t.trip_slug || t.parent_task || t.source === 'meeting');
        }
        return backlog ? 'Move to backlog' : 'Remove date';
    }

    /**
     * Refusals the write rails return silently, before any write (no Notice of
     * their own). A surface that starts a write adds its own Notice for these.
     */
    static get SILENT_REASONS() {
        return [
            'in-flight', 'render-safe-unavailable', 'not-done', 'task file not found',
            'app unavailable', 'no-fields', 'task-entity-unavailable',
        ];
    }

    /**
     * Today-surface failure policy. Returns:
     *   'ok'      - succeeded
     *   'skipped' - a no_op refusal (cold load, in flight, task no longer open)
     *   'silent'  - refused before writing with no Notice (see SILENT_REASONS),
     *               or the call itself threw past its own guard (null result)
     *   'noticed' - the write failed and its rail already told the user
     */
    static classifyOutcome(res) {
        if (res && res.ok === true) return 'ok';
        if (res && res.no_op) return 'skipped';
        if (!res) return 'silent';
        const reason = String(res.reason || '');
        return TaskTodayList.SILENT_REASONS.includes(reason) ? 'silent' : 'noticed';
    }

    // ---------- Manual order (shared by the daily panel and the To-Do view) ----------

    /**
     * `list` (tasks with a `path`, top to bottom) with the task at `path`
     * swapped one step up (dir < 0) or down; null when it is not in the list
     * or already at that edge. Pure; the input is not changed.
     */
    static moveInOrder(list, path, dir) {
        const current = Array.isArray(list) ? list : [];
        const i = current.findIndex((t) => t && path && t.path === path);
        const j = i + (dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= current.length) return null;
        const next = current.slice();
        next[i] = current[j];
        next[j] = current[i];
        return next;
    }

    /**
     * `list` with the task at `fromPath` taken out and inserted at the index
     * `toPath` held; null when either is missing or they are the same. Pure.
     */
    static reorderInOrder(list, fromPath, toPath) {
        const current = Array.isArray(list) ? list : [];
        const paths = current.map((t) => t && t.path);
        const from = paths.indexOf(fromPath);
        const to = paths.indexOf(toPath);
        if (from < 0 || to < 0 || from === to) return null;
        const next = current.slice();
        next.splice(to, 0, next.splice(from, 1)[0]);
        return next;
    }

    /**
     * Persist a manual order. `next` is the new top-to-bottom task list (each
     * `{ path, rank }`, mutated in place). deps:
     *   setFields(path, fields) -> result   the rank write (one task at a time)
     *   renumber(paths, rankByPath) -> [{ path, rank }]   only changed ranks
     *   repaint()                           redraw from the task objects
     *   notice(message)                     one Notice for silent failures
     *   lock: { set, key }                  refuses while `set` holds `key`
     *   classify(res)                       default TaskTodayList.classifyOutcome
     * Ranks apply optimistically (one repaint); a failed write restores that
     * task's prior rank and repaints once more. The lock is released in
     * `finally`. Resolves { written, failed } or null when refused / unchanged.
     */
    static async applyManualOrder(next, deps) {
        const d = deps || {};
        const list = Array.isArray(next) ? next.filter((t) => t && t.path) : [];
        const lockSet = d.lock && d.lock.set && typeof d.lock.set.has === 'function' ? d.lock.set : null;
        const lockKey = d.lock ? d.lock.key : undefined;
        if (lockSet && lockSet.has(lockKey)) return null;
        if (typeof d.setFields !== 'function' || typeof d.renumber !== 'function') return null;
        const classify = typeof d.classify === 'function' ? d.classify : (res) => TaskTodayList.classifyOutcome(res);
        const repaint = () => { try { if (typeof d.repaint === 'function') d.repaint(); } catch (_e) {} };
        if (lockSet) lockSet.add(lockKey);
        try {
            const rankByPath = {};
            for (const t of list) rankByPath[t.path] = t.rank;
            let changes = [];
            try { changes = d.renumber(list.map((t) => t.path), rankByPath) || []; } catch (_e) { changes = []; }
            if (!changes.length) return null;
            const prior = new Map(list.map((t) => [t.path, t.rank]));
            const byPath = new Map(list.map((t) => [t.path, t]));
            list.forEach((t, i) => { t.rank = i + 1; });
            repaint();
            const written = [];
            const failed = [];
            let silent = 0;
            for (const change of changes) {
                let res = null;
                try { res = await d.setFields(change.path, { rank: change.rank }); } catch (_e) { res = null; }
                let outcome = 'silent';
                try { outcome = classify(res); } catch (_e) { outcome = 'silent'; }
                if (outcome === 'ok') { written.push(change.path); continue; }
                failed.push(change.path);
                if (outcome === 'silent') silent += 1;
                const t = byPath.get(change.path);
                if (t) t.rank = prior.get(change.path);
            }
            if (failed.length) repaint();
            if (silent > 0 && typeof d.notice === 'function') {
                try { d.notice('Could not save the new task order'); } catch (_e) {}
            }
            return { written, failed };
        } finally {
            if (lockSet) lockSet.delete(lockKey);
        }
    }

    /**
     * Manual-order controller over a painted list. deps as applyManualOrder,
     * plus order() -> the painted tasks top to bottom and rows: Map(path ->
     * row). Only rows still attached take part: a row completed or rescheduled
     * by its own controls has already left the list. Returns
     * { move(task, dir), reorder(fromPath, toPath) }, each resolving like
     * applyManualOrder (undefined when the gesture is not a move).
     */
    static manualOrder(deps) {
        const d = deps || {};
        const visible = () => {
            let list = [];
            try { list = typeof d.order === 'function' ? (d.order() || []) : []; } catch (_e) { list = []; }
            return list.filter((t) => {
                const row = t && d.rows && typeof d.rows.get === 'function' ? d.rows.get(t.path) : null;
                return !!(row && row.parentNode);
            });
        };
        return {
            move: (task, dir) => {
                const next = TaskTodayList.moveInOrder(visible(), task && task.path, dir);
                return next ? TaskTodayList.applyManualOrder(next, d) : undefined;
            },
            reorder: (fromPath, toPath) => {
                const next = TaskTodayList.reorderInOrder(visible(), fromPath, toPath);
                return next ? TaskTodayList.applyManualOrder(next, d) : undefined;
            },
        };
    }

    /**
     * Local HH:mm of a task's completed_at (or of a bare completed_at value):
     * Luxon via toFormat, else the time part of an ISO string (written with its
     * own offset, so it is the local wall time). Missing / unparseable -> ''.
     */
    static doneTimeLabel(task) {
        try {
            let v = task;
            if (v && typeof v === 'object' && typeof v.toFormat !== 'function' && 'completed_at' in v) {
                v = v.completed_at;
            }
            if (v == null || v === '') return '';
            if (typeof v === 'object' && typeof v.toFormat === 'function') return String(v.toFormat('HH:mm') || '');
            const m = /T(\d{2}):(\d{2})/.exec(String(v));
            return m ? m[1] + ':' + m[2] : '';
        } catch (_e) { return ''; }
    }

    /**
     * One Done-today row: struck title (click opens the note), completion HH:mm
     * and, for a task archived under spice/tasks/_done/, an Undo button
     * (aria-label "Undo: <title>") that hands the reopen flow to
     * options.onUndo(task, button). options.undoLabel renames the button and
     * its aria-label prefix (default "Undo"); options.showProject adds the
     * project chip before the time. options.notice(msg) reports an open failure
     * (default: an Obsidian Notice). Never throws; returns the row or null.
     */
    static renderDoneRow(container, task, options) {
        if (!container || typeof container.createEl !== 'function' || !task) return null;
        const opts = options || {};
        const notice = typeof opts.notice === 'function'
            ? opts.notice
            : (msg) => { try { if (typeof Notice === 'function') new Notice(msg, 6000); } catch (_e) {} };
        const row = container.createEl('div', { cls: 'sauce-today-done-row' });
        row.dataset.sauceTaskPath = String(task.path || '');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 3px 6px; font-size: 0.9em;';
        const title = row.createEl('span', { cls: 'sauce-today-done-title' });
        title.style.cssText = 'flex: 1 1 auto; min-width: 0; text-decoration: line-through; color: var(--text-muted); overflow-wrap: anywhere; cursor: pointer;';
        const text = task.title || '(untitled)';
        try { TaskTodayList.renderInlineLinks(title, text, task.path); } catch (_e) { title.textContent = text; }
        title.addEventListener('click', () => {
            try {
                const appRef = (typeof window !== 'undefined' && window.app)
                    || (typeof app !== 'undefined' && app) || null;
                if (task.path && appRef && appRef.workspace) appRef.workspace.openLinkText(task.path, '');
            } catch (e) { notice('Could not open task: ' + (e && (e.message || e))); }
        });
        if (opts.showProject && task.project) {
            const projectText = TaskTodayList._projectChipText(task.project);
            if (projectText) {
                const chip = row.createEl('span', { cls: 'sauce-today-done-project' });
                chip.textContent = projectText;
                chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted); flex-shrink: 0;';
            }
        }
        // opts.stamp replaces the HH:mm label (a list spanning days passes the
        // completion day); null or undefined keeps the time.
        const time = opts.stamp != null && opts.stamp !== '' ? String(opts.stamp) : TaskTodayList.doneTimeLabel(task);
        if (time) {
            const stamp = row.createEl('span', { cls: 'sauce-today-done-time' });
            stamp.textContent = time;
            stamp.style.cssText = 'font-size: 0.8em; color: var(--text-faint); font-variant-numeric: tabular-nums; flex-shrink: 0;';
        }
        let TD = null;
        try {
            TD = opts.TD || (typeof window !== 'undefined' && window.customJS && window.customJS.TaskDialog) || null;
        } catch (_e) { TD = null; }
        const canUndo = String(task.path || '').indexOf('spice/tasks/_done/') === 0
            && !!TD && typeof TD.reopen === 'function' && typeof opts.onUndo === 'function';
        if (canUndo) {
            const undo = row.createEl('button', { cls: 'sauce-today-undo' });
            const undoLabel = opts.undoLabel ? String(opts.undoLabel) : 'Undo';
            undo.textContent = undoLabel;
            undo.style.cssText = 'font-size: 0.85em; font-weight: 500; text-transform: none; letter-spacing: 0; color: var(--text-accent); cursor: pointer; background: none; border: none; padding: 0; box-shadow: none; height: auto;';
            try { undo.setAttribute('type', 'button'); undo.setAttribute('aria-label', undoLabel + ': ' + text); } catch (_e) {}
            undo.addEventListener('click', (ev) => {
                try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
                try { return opts.onUndo(task, undo); } catch (_e) { return undefined; }
            });
        }
        return row;
    }

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

    static _removeRowReceipt(row, task, focusTarget) {
        TaskTodayList.markTaskRow(row, task);
        const parent = row && row.parentNode;
        const children = (() => {
            try { return Array.from((parent && (parent.childNodes || parent.children)) || []); }
            catch (_e) { return []; }
        })();
        const index = children.indexOf(row);
        const receipt = {
            parent, node: row, path: String((task && task.path) || ''),
            index, following: index >= 0 ? children.slice(index + 1) : [],
            preceding: index >= 0 ? children.slice(0, index).reverse() : [],
            order: Number(row && row.dataset && row.dataset.sauceTaskOrder),
            focusTarget,
        };
        try { if (row && typeof row.remove === 'function') row.remove(); } catch (_e) {}
        return receipt;
    }

    static _restoreRowReceipt(receipt) {
        const r = receipt || {};
        const parent = r.parent;
        const row = r.node;
        if (!parent || !row || row.parentNode) return false;
        if (typeof parent.isConnected === 'boolean' && !parent.isConnected) return false;
        const childList = () => {
            try { return Array.from((parent.childNodes || parent.children) || []); }
            catch (_e) { return []; }
        };
        const current = childList();
        if (r.path && current.some((node) => node !== row && node && node.dataset
            && String(node.dataset.sauceTaskPath || '') === r.path)) return true;
        const insert = (anchor) => {
            if (anchor != null && anchor.parentNode !== parent) return false;
            try { parent.insertBefore(row, anchor || null); return row.parentNode === parent; }
            catch (_e) { return false; }
        };
        const next = (r.following || []).find((node) => node && node.parentNode === parent);
        if (!(next && insert(next)) && Number.isFinite(r.order)) {
            const ordered = childList().filter((node) => node && node.dataset
                && Number.isFinite(Number(node.dataset.sauceTaskOrder)));
            const later = ordered.find((node) => Number(node.dataset.sauceTaskOrder) > r.order);
            if (later) insert(later);
            else {
                const earlier = ordered.filter((node) => Number(node.dataset.sauceTaskOrder) < r.order).pop();
                if (earlier) insert(earlier.nextSibling || null);
            }
        }
        if (!row.parentNode) {
            const previous = (r.preceding || []).find((node) => node && node.parentNode === parent);
            if (previous) insert(previous.nextSibling || null);
        }
        if (!row.parentNode) {
            const now = childList();
            const index = Number.isFinite(r.index) ? Math.max(0, Math.min(r.index, now.length)) : now.length;
            if (!insert(now[index] || null)) {
                try { parent.appendChild(row); } catch (_e) {}
            }
        }
        try { if (r.focusTarget && typeof r.focusTarget.focus === 'function') r.focusTarget.focus(); } catch (_e) {}
        return row.parentNode === parent;
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
        const tomorrow = TaskTodayList.tomorrowFor(task, viewedDay);
        if (!tomorrow) return { ok: false, no_op: true };
        return TaskTodayList.reschedule(row, task, tomorrow, viewedDay, TDref);
    }

    /**
     * The day "Move to tomorrow" sends a task to: the day after the later of
     * the viewed day and the task's own due date. A task already due ahead of
     * the viewed day moves one day further (due Wed → Thu, due Thu → Fri)
     * rather than staying put or moving back; an overdue or undated task goes
     * to the day after the viewed day. A missing or malformed viewedDay falls
     * back to the wall clock. '' when no day can be worked out. Pure apart
     * from that fallback.
     */
    static tomorrowFor(task, viewedDay) {
        let baseDay = String(viewedDay || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDay)) {
            const momentRef = (typeof window !== 'undefined' && window.moment) || null;
            try { baseDay = typeof momentRef === 'function' ? String(momentRef().format('YYYY-MM-DD') || '') : ''; } catch (_e) { baseDay = ''; }
        }
        const due = TaskTodayList._dueDay(task && task.due);
        if (due && TaskTodayList.nextDay(due) && due > baseDay) baseDay = due;
        return TaskTodayList.nextDay(baseDay);
    }

    /** A due value (string or Luxon-like) as YYYY-MM-DD, or ''. Pure. */
    static _dueDay(due) {
        let s = '';
        try {
            if (due && typeof due === 'object' && typeof due.toFormat === 'function') s = String(due.toFormat('yyyy-MM-dd') || '');
            else s = String(due == null ? '' : due);
        } catch (_e) { s = ''; }
        const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(s);
        return m ? m[1] : '';
    }

    /** "Thu Nov 12" for 2026-11-12; '' for anything else. Pure. */
    static dayLabel(ymd) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
        if (!m) return '';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + Number(m[3]);
    }

    /**
     * Reschedule one OPEN task to an explicit `newDue` (YYYY-MM-DD, or '' to move
     * it to the backlog) with the same optimistic-removal / rollback / in-flight
     * mechanics as rescheduleTomorrow, and clear any manual `rank` in the same
     * atomic frontmatter write. `viewedDay` is accepted for call-shape parity
     * with rescheduleTomorrow and is not otherwise used.
     */
    static async reschedule(row, task, newDue, viewedDay, TDref) {
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

            const target = newDue == null ? '' : String(newDue);
            if (target !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(target)) return { ok: false, no_op: true };
            const file = appRef.vault.getAbstractFileByPath(task.path);
            if (!file) return { ok: false, no_op: true };

            const taskPath = String(task.path);
            const inFlight = TaskTodayList._rescheduleInFlight
                || (TaskTodayList._rescheduleInFlight = new Set());
            // Claim synchronously before the row is detached or the first await
            // yields. This makes double-clicks and duplicate dispatch from a
            // rerendered row harmless while preserving concurrency by task path.
            if (inFlight.has(taskPath)) {
                return { ok: false, no_op: true, in_flight: true };
            }
            inFlight.add(taskPath);
            try {
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
                let liveStatus = null;
                let liveStatusChecked = false;
                let mutationApplied = false;
                const staleOpenNoOp = () => ({
                    ok: false,
                    no_op: true,
                    reason: 'task is no longer open',
                    live_status: liveStatus || 'missing'
                });
                try {
                    await appRef.fileManager.processFrontMatter(file, (fm) => {
                        liveStatusChecked = true;
                        liveStatus = fm && typeof fm.status === 'string' ? fm.status : null;
                        // The rendered task object can be stale by the time the
                        // optimistic action reaches the file. Revalidate and
                        // mutate within the same atomic frontmatter callback.
                        if (!fm || fm.status !== 'open') return;
                        fm.due = target;
                        fm.rank = '';
                        mutationApplied = true;
                    });
                    if (!mutationApplied) {
                        restore();
                        return staleOpenNoOp();
                    }
                    return { ok: true, due: target };
                } catch (e) {
                    restore();
                    if (liveStatusChecked && !mutationApplied) return staleOpenNoOp();
                    try { new Notice('Could not reschedule task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
                    return { ok: false, reason: String(e && (e.message || e) || 'write failed') };
                }
            } finally {
                inFlight.delete(taskPath);
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
            // The archives are excluded in the SOURCE so Dataview never builds a page
            // object for a finished or trashed task; the path checks below stay as a guard.
            const raw = dv.pages('"spice/tasks" and -"spice/tasks/_done" and -"spice/tasks/_trash"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/'));
            // Parse each task once (the old feature test mapped the whole list twice).
            const mapped = raw.map(p => TE.parseNote(p));
            parsed = typeof mapped.array === 'function' ? mapped.array() : Array.from(mapped);
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
     * Fixed widths (in the slot's own 0.8em font) for the metadata columns, so
     * project / priority / due line up down a list. Sized for "due: YYYY-MM-DD",
     * "highest", and a typical project name (longer names ellipsize).
     */
    /**
     * "Nov 10" for a due of 2026-11-10 (string, or a Luxon-like date): the
     * phone's due chip. '' when the value has no calendar date.
     */
    static shortDueLabel(due) {
        let s = '';
        try {
            if (due && typeof due === 'object' && typeof due.toFormat === 'function') s = String(due.toFormat('yyyy-MM-dd') || '');
            else s = String(due == null ? '' : due);
        } catch (_e) { s = ''; }
        const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (!m) return '';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = months[Number(m[2]) - 1];
        return month ? month + ' ' + Number(m[3]) : '';
    }

    static get META_SLOT_WIDTH() {
        return { project: '11em', priority: '5.6em', due: '9.8em' };
    }

    /**
     * Row-action and layout rules that inline styles cannot express (hover,
     * touch, narrow widths). Desktop: actions overlay the row's right edge on
     * hover/focus, and the priority + due columns they sit over step aside
     * (visibility, so nothing reflows), so the metadata columns stay flush
     * right at rest. Touch or a narrow pane: actions sit inline and always
     * visible, the title takes the full first line, and the metadata + actions
     * wrap below it, right-aligned, with natural (unfixed) widths.
     */
    static get _ROW_ACTIONS_CSS() {
        const touch = '.sauce-task-today-row .sauce-task-actions { position: static; opacity: 1; padding-left: 0; background: none; }'
            + ' .sauce-task-today-row .sauce-task-today-titlegroup { flex-basis: 100% !important; }'
            + ' .sauce-task-today-row .sauce-task-today-right { flex: 1 1 100% !important; flex-wrap: wrap; justify-content: flex-end; row-gap: 4px; }'
            + ' .sauce-task-today-row .sauce-task-today-chips { flex-wrap: wrap !important; flex-shrink: 1 !important; }'
            + ' .sauce-task-today-row .sauce-task-meta-slot { width: auto !important; visibility: visible !important; }'
            + ' .sauce-task-today-row .sauce-task-meta-slot:empty { display: none !important; }';
        // Phone: one line under the title. Chips sit left, actions right; the
        // priority chip steps aside (the coloured bar already says it), the
        // due chip shows its short date, and a long project name ellipsizes.
        const phone = ' .sauce-task-today-row .sauce-task-today-right { justify-content: flex-start !important; flex-wrap: nowrap; column-gap: 8px; }'
            + ' .sauce-task-today-row .sauce-task-today-chips { flex-wrap: nowrap !important; flex-shrink: 1 !important; min-width: 0; justify-content: flex-start !important; gap: 6px !important; }'
            + ' .sauce-task-today-row .sauce-task-meta-slot.is-priority { display: none !important; }'
            + ' .sauce-task-today-row .sauce-task-meta-slot.is-project { min-width: 0; flex-shrink: 1 !important; }'
            + ' .sauce-task-today-row .sauce-task-meta-slot.is-project > span { max-width: 9em; }'
            + ' .sauce-task-today-row .sauce-task-due[data-short] { font-size: 0 !important; }'
            + ' .sauce-task-today-row .sauce-task-due[data-short]::after { content: attr(data-short); font-size: 12px; }'
            + ' .sauce-task-today-row .sauce-task-actions { margin-left: auto; height: 28px !important; }'
            + ' .sauce-task-today-row .sauce-task-actions > button { height: 28px !important; min-height: 28px !important; }';
        const scoped = (prefix, css) => (css || touch).split(' .sauce-task-today-row').join(' ' + prefix + ' .sauce-task-today-row')
            .replace(/^\.sauce-task-today-row/, prefix + ' .sauce-task-today-row');
        const hover = (sel) => '.sauce-task-today-row:hover ' + sel + ', .sauce-task-today-row:focus-within ' + sel;
        return '.sauce-task-today-row .sauce-task-actions { position: absolute; top: 8px; right: 6px; padding-left: 8px;'
            + ' background: var(--background-secondary); border-radius: var(--radius-s, 4px); opacity: 0; transition: opacity 120ms ease; }'
            + ' ' + hover('.sauce-task-actions') + ' { opacity: 1; }'
            + ' ' + hover('.sauce-task-meta-slot.is-priority') + ', ' + hover('.sauce-task-meta-slot.is-due') + ' { visibility: hidden; }'
            + ' ' + scoped('.is-mobile')
            + ' @media (hover: none) { ' + touch + ' }'
            + ' @media (max-width: 560px) { ' + touch + ' }'
            + ' ' + scoped('.is-phone', phone.trim())
            + ' @media (max-width: 480px) { ' + phone + ' }';
    }

    static get _PRIO_BAR_COLOR() {
        return {
            highest: 'var(--color-red, #dc2626)',
            high: 'var(--color-red, #dc2626)',
            medium: 'var(--color-orange, #ea580c)',
            low: 'var(--text-muted, #666)',
            none: 'transparent',
        };
    }

    static _priorityLevel(task) {
        const raw = String(task && task.priority || '').trim().toLowerCase();
        return ['highest', 'high', 'medium', 'low'].includes(raw) ? raw : 'none';
    }

    static _rowTaskEntity() {
        try { return (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null; }
        catch (_e) { return null; }
    }

    /** Render entry: options.todayStr wins, else the wall clock (moment). */
    static _rowTodayStr(opts) {
        const given = opts && opts.todayStr;
        if (typeof given === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(given)) return given;
        try {
            const momentRef = typeof window !== 'undefined' ? window.moment : null;
            return typeof momentRef === 'function' ? String(momentRef().format('YYYY-MM-DD') || '') : '';
        } catch (_e) { return ''; }
    }

    /** Age chip for open rows: overdue -> 'N days', stale -> 'since Mon D'. */
    static _ageChip(task, todayStr, TE) {
        try {
            if (!task || !todayStr || !TE || typeof TE.bucketOf !== 'function') return null;
            const bucket = TE.bucketOf(task, todayStr);
            if (bucket === 'overdue') {
                const n = TE.daysLate(task, todayStr);
                return { text: n + (n === 1 ? ' day' : ' days'), cls: 'is-overdue' };
            }
            if (bucket === 'stale') {
                const due = typeof TE._toDateStr === 'function' ? TE._toDateStr(task.due) : String(task.due || '').slice(0, 10);
                const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(due || ''));
                if (!m) return null;
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return { text: 'since ' + months[Number(m[2]) - 1] + ' ' + Number(m[3]), cls: 'is-stale' };
            }
        } catch (_e) {}
        return null;
    }

    /**
     * Render one task row into `container` — SELF-CONTAINED (no dependence on
     * instance `this`), so any widget can draw a uniform task row by calling
     * `window.customJS.TaskTodayList.renderTaskRow(container, task)` cross-class.
     * Draws:
     *   - a functional done-checkbox → TaskDialog.markDone(path) (revert on fail;
     *     options.onDone(task) after a successful completion)
     *   - a title (title click → opens the task NOTE via app.workspace.openLinkText(path))
     *   - metadata chips for project(name) / priority / due when present.
     * `TDref` is an OPTIONAL TaskDialog reference; when omitted the method reads
     * `window.customJS.TaskDialog` at click-time (both markDone + open are lazily
     * resolved so a cold-load TDZ never throws out of the row build). Never throws.
     */
    static renderTaskRow(container, task, TDref, options) {
        if (!container || typeof container.createEl !== 'function') return null;
        const opts = options || {};
        const todayStr = TaskTodayList._rowTodayStr(opts);
        const TE = TaskTodayList._rowTaskEntity();
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
        // Layout: [title group | metadata columns]. The title group has a ZERO
        // flex basis, so a long title wraps inside its own column instead of
        // pushing the metadata onto a second line; the metadata stays on line 1,
        // flush right, in fixed-width slots so project / priority / due line up
        // down the list. Row actions overlay the right edge on hover (desktop) and
        // sit inline on touch / narrow layouts (see _ROW_ACTIONS_CSS), where the
        // metadata also drops below the title. flex-wrap stays on so the inline
        // date picker can take its own line.
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px 14px; padding: 10px 10px; border-radius: 6px; border: 1px solid transparent; border-bottom: 1px solid var(--background-modifier-border); width: 100%; box-sizing: border-box; position: relative;';
        if (!TaskTodayList._rowActionsStyleInjected && typeof document !== 'undefined' && document.head) {
            const s = document.createElement('style');
            s.textContent = TaskTodayList._ROW_ACTIONS_CSS;
            document.head.appendChild(s);
            TaskTodayList._rowActionsStyleInjected = true;
        }
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
        titleGroup.style.cssText = 'display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 10px; flex: 1 1 0%; min-width: 0;';

        if (opts.dragHandle) {
            const drag = titleGroup.createEl('span', { cls: 'sauce-task-drag' });
            drag.style.cssText = 'display: inline-flex; align-items: center; height: 1.5em; flex-shrink: 0; cursor: grab; color: var(--text-faint, #999); user-select: none; touch-action: none;';
            drag.draggable = true;
            const dragLabel = typeof opts.dragHandle === 'string' ? opts.dragHandle : 'Drag to reorder';
            try { drag.setAttribute('draggable', 'true'); drag.setAttribute('aria-label', dragLabel); } catch (_e) {}
            if (path) drag.dataset.path = String(path);
            drag.textContent = '\u22EE\u22EE';
        }
        if (opts.selectable) {
            const sel = titleGroup.createEl('input', { cls: 'sauce-task-select', type: 'checkbox' });
            sel.type = 'checkbox';
            sel.checked = !!opts.selected;
            sel.style.cssText = 'margin: 0; height: 1.5em; cursor: pointer; flex-shrink: 0;';
            try { sel.setAttribute('aria-label', 'Select task'); } catch (_e) {}
            sel.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} });
            sel.addEventListener('change', () => {
                try { if (typeof opts.onSelect === 'function') opts.onSelect(task, !!sel.checked); } catch (_e) {}
            });
        }

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
                } else {
                    // On success the file moves to _done/; the row is already
                    // gone. options.onDone lets the host repaint its counts.
                    try { if (typeof opts.onDone === 'function') opts.onDone(task); } catch (_e) {}
                }
            } catch (e) {
                revert();
                try { new Notice('Could not complete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        });

        const prioLevel = TaskTodayList._priorityLevel(task);
        const prioBar = titleGroup.createEl('span', { cls: 'sauce-task-prio-bar is-' + prioLevel });
        prioBar.style.cssText = 'width: 3px; align-self: stretch; min-height: 1.5em; border-radius: 2px; flex-shrink: 0; background: ' + TaskTodayList._PRIO_BAR_COLOR[prioLevel] + ';';
        try { prioBar.setAttribute('aria-hidden', 'true'); } catch (_e) {}

        // Title — clicking the title (not the checkbox) opens the task NOTE. The
        // text is rendered via renderInlineLinks so `[label](url)`, `[[wikilink]]`,
        // and bare `http(s)://` URLs become REAL clickable `<a>` elements. This is
        // deterministic (builds anchors directly, no dependence on Obsidian's
        // MarkdownRenderer — which is NOT a global in the customJS eval context, so
        // the old MarkdownRenderer path always fell back to raw text).
        const titleText = (task && task.title) || '(untitled)';
        const title = titleGroup.createEl('span', { cls: 'sauce-task-today-title' });
        // Title takes the remaining space and wraps WITHIN its column (break-word
        // wraps long words). The EXPLICIT line-height:1.5 must match the checkbox
        // wrapper's 1.5em height so the checkbox centers on the first line of the
        // title (see cbWrap above) regardless of theme defaults.
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

        // Right cluster — metadata slots + action icons. margin-left:auto hugs it
        // to the right edge on line 1; min-height matches the title's first line
        // so the chips sit level with it.
        const rightCluster = row.createEl('div', { cls: 'sauce-task-today-right' });
        rightCluster.style.cssText = 'display: flex; align-items: center; gap: 10px; flex: 0 0 auto; margin-left: auto; min-height: 1.5em;';

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

        // Metadata as right-aligned columns. Every row draws the same fixed-width
        // slots (extras / project / priority / due), empty or not, so each kind of
        // chip lines up vertically down a list; a chip right-aligns inside its
        // slot and an over-long project name ellipsizes (full name in title=).
        // Extras (subtask progress, age) sit in an auto-width slot on the left.
        const chips = rightCluster.createEl('div', { cls: 'sauce-task-today-chips' });
        chips.style.cssText = 'display: flex; gap: 8px; flex-wrap: nowrap; align-items: center; justify-content: flex-end; flex-shrink: 0;';
        const CHIP_CSS = 'display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; padding: 2px 8px; border-radius: 5px; background: var(--background-modifier-border); color: var(--text-muted); line-height: 1.4;';
        const mkSlot = (kind, width) => {
            const slot = chips.createEl('span', { cls: 'sauce-task-meta-slot is-' + kind });
            slot.style.cssText = 'display: inline-flex; justify-content: flex-end; align-items: center; gap: 6px; font-size: 0.8em; flex: 0 0 auto;' + (width ? ' width: ' + width + ';' : '');
            return slot;
        };
        const addChip = (slot, label, cls, color) => {
            const chip = slot.createEl('span', { text: label, cls: cls });
            chip.style.cssText = CHIP_CSS + (color ? ' color: ' + color + ';' : '');
            try { chip.setAttribute('title', label); } catch (_e) {}
            return chip;
        };
        const extras = mkSlot('extras', '');
        // Subtask-progress chip — OPTIONAL, attached by the caller (daily /
        // project / meeting render() via TaskEntity.subtaskCountsByParent), NOT
        // queried here (renderTaskRow stays dv-free by design). Shown only when
        // the task actually has ≥1 subtask.
        if (task && task.subtask_count && task.subtask_count.total > 0) {
            TaskTodayList.renderSubtaskMeter(extras, task.subtask_count);
        }
        if (opts.showAge !== false) {
            const age = TaskTodayList._ageChip(task, todayStr, TE);
            if (age) {
                addChip(extras, age.text, 'sauce-task-age ' + age.cls,
                    age.cls === 'is-stale' ? 'var(--color-orange, #ea580c)' : 'var(--text-error, #e05561)');
            }
        }
        // opts.showProject === false drops the project column entirely, for a
        // list that is already one project's (every chip would repeat it).
        if (opts.showProject !== false) {
            const projectSlot = mkSlot('project', TaskTodayList.META_SLOT_WIDTH.project);
            if (task && task.project) {
                const name = TaskTodayList._projectChipText(task.project);
                const chip = addChip(projectSlot, name, 'sauce-task-project');
                const tint = TaskTodayList.projectTint(name);
                // The chip stays the neutral grey; a small dot in the
                // project's colour sits before the name.
                if (chip && tint) {
                    chip.style.cssText += ' padding-left: 15px; background-image: radial-gradient(circle at 7px 50%, '
                        + tint.dot + ' 2.6px, transparent 3.2px);';
                }
            }
        }
        const prioritySlot = mkSlot('priority', TaskTodayList.META_SLOT_WIDTH.priority);
        if (task && task.priority) addChip(prioritySlot, String(task.priority), 'sauce-task-priority');
        const dueSlot = mkSlot('due', TaskTodayList.META_SLOT_WIDTH.due);
        if (task && task.due) {
            const dueChip = addChip(dueSlot, 'due: ' + task.due, 'sauce-task-due');
            const short = TaskTodayList.shortDueLabel(task.due);
            if (short && dueChip && dueChip.dataset) dueChip.dataset.short = short;
        }

        // Row actions at the FAR-RIGHT end of the cluster. Open rows render
        // tomorrow + next-Monday + edit + a "more" (⋯) button whose menu holds
        // backlog / pick date / move up-down / delete; completed/archive rows
        // render edit + a standalone delete only. The controls live in a fixed 1.5em-tall flex box
        // that vertically centers them against the FIRST line of the
        // (line-height:1.5) title — the same trick the checkbox wrapper uses — so
        // the row stays aligned even when a long title wraps, and every button is
        // flex-shrink:0 so it never collapses.
        //   - Open note → app.workspace.openLinkText(path) (same as the title click)
        //   - Edit      → TaskDialog.open({ edit: path })   (the edit dialog, NOT
        //                 the note — the note opens via the title click)
        //   - Tomorrow  → rescheduleTomorrow(row, task, viewedDay)
        //   - Delete    → TaskDialog.confirmDelete(path)     (via the ⋯ menu for
        //                 open rows; yes/no modal; on
        //                 confirm the row is removed optimistically)
        // Every gesture is lazily resolved (getTD() / window at click-time) + fully
        // guarded, so a cold-load just no-ops the tap. Never throws.
        const svg = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
        const ICON = {
            tomorrow: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m12 14 2 2-2 2"/><path d="M9 16h5"/>'),
            wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
            more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
            trash: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
        };
        const actions = rightCluster.createEl('div', { cls: 'sauce-task-today-actions sauce-task-actions' });
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
            const res = await TaskTodayList.rescheduleTomorrow(row, task, viewedDay, TDref);
            notifyRescheduled(res);
            return res;
        };
        const notifyRescheduled = (res) => {
            try { if (res && res.ok && typeof opts.onRescheduled === 'function') opts.onRescheduled(task, res.due); } catch (_e) {}
        };
        const doReschedule = async (newDue) => {
            const viewedDay = typeof opts.viewedDay === 'string' ? opts.viewedDay : '';
            const res = await TaskTodayList.reschedule(row, task, newDue, viewedDay, TDref);
            notifyRescheduled(res);
            return res;
        };
        const doPickDate = () => {
            if (!path) return;
            try {
                const existing = typeof row.querySelector === 'function' ? row.querySelector('.sauce-task-datepick') : null;
                if (existing) { existing.remove(); return; }
            } catch (_e) {}
            const input = row.createEl('input', { cls: 'sauce-task-datepick', type: 'date' });
            input.type = 'date';
            input.style.cssText = 'position: absolute; right: 8px; top: 100%; z-index: 20; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 4px); padding: 2px 6px;';
            let outside = null;
            const close = () => {
                try { input.remove(); } catch (_e) {}
                if (outside) {
                    try { document.removeEventListener('pointerdown', outside, true); } catch (_e) {}
                    outside = null;
                }
            };
            input.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} });
            try {
                if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
                    outside = (ev) => {
                        const t = ev && ev.target;
                        if (t && (t === input || (typeof input.contains === 'function' && input.contains(t)))) return;
                        close();
                    };
                    setTimeout(() => {
                        if (outside && input.parentNode) document.addEventListener('pointerdown', outside, true);
                    }, 0);
                }
            } catch (_e) {}
            input.addEventListener('change', async () => {
                const value = String(input.value || '');
                close();
                if (value) await doReschedule(value);
            });
            input.addEventListener('keydown', (ev) => { if (ev && ev.key === 'Escape') close(); });
            let picked = false;
            try { if (typeof input.showPicker === 'function') { input.showPicker(); picked = true; } } catch (_e) {}
            if (!picked) { try { if (typeof input.focus === 'function') input.focus(); } catch (_e) {} }
        };
        const doMore = (ev) => {
            let MP = null;
            try { MP = (typeof window !== 'undefined' && window.customJS && window.customJS.MenuPopover) || null; } catch (_e) { MP = null; }
            if (!MP || typeof MP.open !== 'function') return;
            try {
                const entries = [
                    { label: TaskTodayList.clearDateLabel(task), onSelect: () => doReschedule('') },
                    { label: 'Pick date\u2026', onSelect: () => doPickDate() },
                ];
                if (typeof opts.onMove === 'function') {
                    entries.push({ label: 'Move up', onSelect: () => { try { opts.onMove(task, -1); } catch (_e) {} } });
                    entries.push({ label: 'Move down', onSelect: () => { try { opts.onMove(task, 1); } catch (_e) {} } });
                }
                entries.push({ label: 'Delete', danger: true, onSelect: () => doDelete() });
                MP.open(entries, { anchor: moreBtn || (ev && ev.currentTarget) || undefined });
            } catch (e) {
                try { new Notice('Could not open menu: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
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
                // markDeleted predates deferred confirmation, so its presence
                // cannot prove that confirmDelete understands deferWrite. Bind
                // the two-call protocol to an explicit capability owned by the
                // same TaskDialog version; legacy dialogs keep their atomic
                // confirm-and-write behavior and are never written twice.
                let deferred = false;
                try {
                    deferred = typeof TD.markDeleted === 'function'
                        && typeof TD.supportsDeferredDelete === 'function'
                        && TD.supportsDeferredDelete() === true;
                } catch (_e) { deferred = false; }
                const res = await TD.confirmDelete(path, deferred ? { deferWrite: true } : undefined);
                if (!res || !res.ok) return;
                const RS = window.customJS && window.customJS.RenderSafe;
                if (RS && typeof RS.mutateStructure === 'function') {
                    await RS.mutateStructure({
                        path,
                        failureMessage: 'Could not delete task',
                        apply: () => TaskTodayList._removeRowReceipt(row, task, delBtn || moreBtn),
                        write: async () => {
                            if (!deferred) return res;
                            const deleted = await TD.markDeleted(path);
                            if (!deleted || deleted.ok !== true) {
                                throw new Error((deleted && deleted.reason) || 'delete failed');
                            }
                            return deleted;
                        },
                        rollback: (receipt) => { TaskTodayList._restoreRowReceipt(receipt); },
                    });
                } else if (!deferred) {
                    try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                    try { row.remove(); } catch (_e) {}
                } else {
                    const deleted = await TD.markDeleted(path);
                    if (deleted && deleted.ok) {
                        try { window.customJS?.RenderSafe?.captureScroll?.(); } catch (_e) {}
                        try { row.remove(); } catch (_e) {}
                    } else {
                        try { new Notice('Could not delete task: ' + ((deleted && deleted.reason) || 'delete failed'), 6000); } catch (_e) {}
                    }
                }
            } catch (e) {
                try { new Notice('Could not delete task: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        };

        const isOpen = !!(task && task.status === 'open');
        let delBtn = null;
        let moreBtn = null;
        if (isOpen) {
            const target = TaskTodayList.dayLabel(TaskTodayList.tomorrowFor(task, typeof opts.viewedDay === 'string' ? opts.viewedDay : ''));
            const tomorrowBtn = mkActionBtn('sauce-task-action-tomorrow', target ? 'Move to ' + target : 'Move to tomorrow', ICON.tomorrow, false);
            tomorrowBtn.addEventListener('click', async (ev) => {
                try { ev.stopPropagation(); } catch (_e) {}
                await doTomorrow();
            });
            const monday = TE && typeof TE.nextMonday === 'function' ? TE.nextMonday(todayStr) : null;
            if (monday) {
                const monBtn = mkActionBtn('sauce-task-action-nextmon', 'Move to next Monday', '', false);
                monBtn.style.width = 'auto';
                monBtn.style.padding = '0 6px';
                monBtn.style.fontSize = '0.78em';
                monBtn.textContent = '\u2192 Mon ' + Number(monday.slice(8, 10));
                monBtn.addEventListener('click', async (ev) => {
                    try { ev.stopPropagation(); } catch (_e) {}
                    await doReschedule(monday);
                });
            }
        }
        const editBtn = mkActionBtn('sauce-task-action-edit', 'Edit task', ICON.wrench, false);
        editBtn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} doEdit(); });
        if (isOpen) {
            moreBtn = mkActionBtn('sauce-task-action-more', 'More actions', ICON.more, false);
            moreBtn.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} doMore(ev); });
        } else {
            delBtn = mkActionBtn('sauce-task-action-delete', 'Delete task', ICON.trash, true);
            delBtn.addEventListener('click', async (ev) => { try { ev.stopPropagation(); } catch (_e) {} await doDelete(); });
        }

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
    /**
     * A project's own hue (0–359), the same for the same name on every
     * surface: a small string hash snapped to 24 evenly spaced hues so
     * neighbouring projects stay apart. Blank / "No project" → null. Pure.
     */
    static projectHue(name) {
        const s = String(name == null ? '' : name).trim().toLowerCase();
        if (!s || s === 'no project') return null;
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b) >>> 0;
        h = (h ^ (h >>> 13)) >>> 0;
        return (h % 24) * 15;
    }

    /**
     * The colours for a project's chip dot: a soft, low
     * saturation pastel of its hue, mixed into the theme's muted text so it
     * sits quietly beside the warm accent on light and dark themes:
     * { hue, base, dot, fg, bg, line }. Null without a project. Pure.
     */
    static projectTint(name) {
        const hue = TaskTodayList.projectHue(name);
        if (hue == null) return null;
        const base = 'hsl(' + hue + ' 30% 62%)';
        return {
            hue,
            base,
            dot: 'color-mix(in srgb, ' + base + ' 70%, var(--text-muted, #999))',
            fg: 'color-mix(in srgb, ' + base + ' 45%, var(--text-muted, #999))',
            bg: 'color-mix(in srgb, ' + base + ' 12%, transparent)',
            line: 'color-mix(in srgb, ' + base + ' 30%, transparent)',
        };
    }

    /**
     * The subtask progress chip on a row: a small bar that fills with the
     * share done, then "done/total". Green once every subtask is done. The
     * full count is in its title and aria-label. Returns the chip; never
     * throws.
     */
    static renderSubtaskMeter(slot, count) {
        try {
            const done = Math.max(0, Number(count && count.done) || 0);
            const total = Math.max(0, Number(count && count.total) || 0);
            if (!slot || !total) return null;
            const pct = Math.min(100, Math.round((done / total) * 100));
            const complete = done >= total;
            const chip = slot.createEl('span', { cls: 'sauce-task-today-subtask-chip' + (complete ? ' is-complete' : '') });
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; padding: 2px 8px; border-radius: 5px; background: var(--background-modifier-border); line-height: 1.4; white-space: nowrap;'
                + ' color: ' + (complete ? 'var(--color-green, #4c9a5a)' : 'var(--text-muted)') + ';';
            const bar = chip.createEl('span', { cls: 'sauce-task-subtask-bar' });
            bar.style.cssText = 'display: inline-block; width: 26px; height: 4px; border-radius: 2px; overflow: hidden; background: var(--background-modifier-border-hover, rgba(127,127,127,0.35)); flex-shrink: 0;';
            const fill = bar.createEl('span', { cls: 'sauce-task-subtask-fill' });
            fill.style.cssText = 'display: block; height: 100%; width: ' + pct + '%; border-radius: inherit; background: var(--color-green, #4c9a5a);';
            chip.createEl('span', { text: done + '/' + total });
            const label = done + ' of ' + total + ' subtasks done';
            try { chip.setAttribute('title', label); chip.setAttribute('aria-label', label); } catch (_e) {}
            return chip;
        } catch (_e) { return null; }
    }

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
