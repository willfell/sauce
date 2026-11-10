/**
 * TaskTripList (CustomJS) — the live-query task list a TRIP note renders
 * of its own tasks. Sibling of TaskTodayList (the daily) + TaskProjectList
 * (the project). A trip shows a FLAT list of ALL its open tasks (no date
 * bands).
 *
 * A task note carries `trip_slug: <slug>` (a plain string — NOT the Link-
 * valued `trip`) when it was created from a trip surface. trip_slug is
 * the RELIABLE filter key: it's a string in frontmatter and stays a string
 * through parseNote, so we can compare it directly without Dataview-Link
 * coercion. This widget resolves the current note's trip_slug, live-queries
 * the open task notes under spice/tasks/ (excluding _done/ + _trash/) whose
 * trip_slug matches, and renders each via the shared TaskTodayList.renderTaskRow
 * so every surface draws a uniform row (checkbox → markDone, click → edit dialog).
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the
 * trip note is indexed. We resolve the page via the render-safe mechanism
 * (window.customJS?.RenderSafe?.page(dv), optional-chained so a TDZ'd customJS
 * never throws) and bail quietly if the classes we need (TaskEntity /
 * TaskDialog / TaskTodayList) aren't registered yet. NEVER throws out of render.
 *
 * "From Meetings" split: mirrors TaskProjectList — a trip To-Do note may ALSO
 * render a meeting-sourced section elsewhere. To avoid a task appearing in
 * both lists, the "Trip Tasks" list here EXCLUDES meeting-sourced tasks
 * (`source === 'meeting'`). So Trip Tasks = trip_slug matches AND
 * source !== 'meeting'.
 *
 * Static API (Node-testable, pure):
 *   TaskTripList._matches(task, tripSlug) → bool  (raw-slug equality AND non-meeting)
 *
 * Instance API (browser-side):
 *   TaskTripList.render(dv)   ← the customjs-guard entry point; draws the shared
 *                          To-Do view's 'trip' surface when it is loaded,
 *                          else _renderFlat(dv), the original flat list
 */
class TaskTripList {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _matches(task, tripSlug) { return TaskTripList._matches(task, tripSlug); }

    // ---------- Static pure helper ----------

    /**
     * Does a task (parseNote output OR a raw Dataview page — either exposes a
     * plain-string `trip_slug` + `source`) belong to the "Trip Tasks" list
     * of the trip whose slug is `tripSlug`? True when trip_slug matches
     * AND the task is NOT meeting-sourced (`source !== 'meeting'`) — meeting tasks
     * render only in the "From Meetings" section, so excluding them here prevents
     * a duplicate. A blank target slug, a task with no trip_slug, or a
     * meeting-sourced task → false. Pure; never throws.
     */
    static _matches(task, tripSlug) {
        if (!task) return false;
        const want = String(tripSlug == null ? '' : tripSlug).trim();
        if (!want) return false;
        const got = String(task.trip_slug == null ? '' : task.trip_slug).trim();
        if (got === '' || got !== want) return false;
        // Meeting-sourced tasks belong to "From Meetings", not "Trip Tasks".
        const src = String(task.source == null ? '' : task.source).trim();
        return src !== 'meeting';
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Resolves the current
     * note's trip_slug, live-queries the open task notes matching it, and draws
     * a flat list. Fully guarded — returns quietly on cold-load (no throw); each
     * row is drawn by the shared static renderer.
     */
    /**
     * The shared To-Do view (to-do blueprint) when it is loaded and knows the
     * 'trip' surface, else null. customJS stores instances, so the
     * surface table is read off the constructor.
     */
    static _sharedView() {
        try {
            const View = typeof window !== 'undefined' && window.customJS && window.customJS.ToDoDailyFilterView;
            const ctor = View && View.constructor;
            const surfaces = ctor && ctor.SURFACES;
            return View && typeof View.render === 'function' && surfaces && surfaces.trip ? View : null;
        } catch (_e) { return null; }
    }

    /**
     * Entry point invoked by customjs-guard. With the shared To-Do view loaded
     * this note's tasks draw on its 'trip' surface (pills, Select,
     * recently done), with TaskTripList._matches as the membership rule. A vault
     * without the to-do blueprint keeps the flat list in _renderFlat.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;
        const View = TaskTripList._sharedView();
        if (!View) return this._renderFlat(dv);
        const page = (window.customJS && window.customJS.RenderSafe)
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;
        const ourSlug = String(page.trip_slug == null ? '' : page.trip_slug).trim();
        if (!ourSlug) return;
        return View.render(dv, {
            surface: 'trip',
            scope: { id: ourSlug, match: (task) => TaskTripList._matches(task, ourSlug) },
        });
    }

    async _renderFlat(dv) {
        if (!dv || !dv.container) return;
        // Skip inside embeds — the host note renders its own list.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        // ----- Cold-load guard -----
        const page = (window.customJS && window.customJS.RenderSafe)
            ? window.customJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' || !TTL || typeof TTL.renderTaskRow !== 'function') {
            return;
        }

        // The reliable trip key: trip_slug is a plain string in frontmatter
        // (unlike the Link-valued `trip`), so compare it raw.
        const ourSlug = String(page.trip_slug == null ? '' : page.trip_slug).trim();
        if (!ourSlug) return;

        // ----- Live query: open task notes for this trip (exclude _trash/ + _done/). -----
        // Filter on the RAW page.trip_slug (a plain string) BEFORE parseNote —
        // simplest + avoids any Link coercion. EXCLUDE meeting-sourced tasks
        // (`source === 'meeting'`): they render in the "From Meetings" section,
        // so including them here too would duplicate them. Mirrors _matches's
        // meeting exclusion.
        let parsed = [];
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/')
                && String(p.trip_slug == null ? '' : p.trip_slug).trim() === ourSlug
                && String(p.source == null ? '' : p.source).trim() !== 'meeting');
            parsed = raw.map(p => TE.parseNote(p)).array
                ? raw.map(p => TE.parseNote(p)).array()
                : Array.from(raw).map(p => TE.parseNote(p));
        } catch (_e) {
            parsed = [];
        }

        // Attach an optional subtask-count summary to each task — one shared
        // vault-wide query, not a per-row query (mirrors TaskTodayList.render).
        const subtaskCounts = (typeof TE.subtaskCountsByParent === 'function') ? TE.subtaskCountsByParent(dv) : {};
        for (const t of parsed) {
            const basename = t && t.path ? t.path.split('/').pop().replace(/\.md$/i, '') : '';
            t.subtask_count = subtaskCounts[basename] || null;
        }

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-trip' });
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0; width: 100%; box-sizing: border-box;';

        const cap = wrap.createEl('div', { cls: 'sauce-task-trip-label', text: 'Trip Tasks' });
        cap.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #999); margin-bottom: 2px;';

        if (!parsed.length) {
            const hint = wrap.createEl('div', { text: 'No tasks yet — use + New Task above.' });
            hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }

        const TD = window.customJS && window.customJS.TaskDialog;
        for (const t of parsed) {
            try {
                TTL.renderTaskRow(wrap, t, TD);
            } catch (_e) {
                // One bad task note must not break the whole list.
            }
        }
    }
}
