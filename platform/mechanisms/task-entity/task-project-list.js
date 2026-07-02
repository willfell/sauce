/**
 * TaskProjectList (CustomJS) — the live-query task list a PROJECT note renders
 * of its own tasks. Sibling of TaskTodayList (the daily) + TaskMeetingList (the
 * meeting). A project shows a FLAT list of ALL its open tasks (no date bands).
 *
 * A task note carries `project_slug: <slug>` (a plain string — NOT the Link-
 * valued `project`) when it was created from a project surface. project_slug is
 * the RELIABLE filter key: it's a string in frontmatter and stays a string
 * through parseNote, so we can compare it directly without Dataview-Link
 * coercion. This widget resolves the current note's project_slug, live-queries
 * the open task notes under spice/tasks/ (excluding _done/ + _trash/) whose
 * project_slug matches, and renders each via the shared TaskTodayList.renderTaskRow
 * so every surface draws a uniform row (checkbox → markDone, click → edit dialog).
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the
 * project note is indexed. We resolve the page via the render-safe mechanism
 * (window.customJS?.RenderSafe?.page(dv), optional-chained so a TDZ'd customJS
 * never throws) and bail quietly if the classes we need (TaskEntity /
 * TaskDialog / TaskTodayList) aren't registered yet. NEVER throws out of render.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "\nreturn TaskProjectList;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskProjectList._matches(task, projectSlug) → bool  (raw-slug string equality)
 *
 * Instance API (browser-side):
 *   TaskProjectList.render(dv)   ← the customjs-guard entry point
 */
class TaskProjectList {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _matches(task, projectSlug) { return TaskProjectList._matches(task, projectSlug); }

    // ---------- Static pure helper ----------

    /**
     * Does a task (parseNote output OR a raw Dataview page — either exposes a
     * plain-string `project_slug`) belong to the project whose slug is
     * `projectSlug`? Pure string equality on project_slug. A blank target slug or
     * a task with no project_slug → false. Never throws.
     */
    static _matches(task, projectSlug) {
        if (!task) return false;
        const want = String(projectSlug == null ? '' : projectSlug).trim();
        if (!want) return false;
        const got = String(task.project_slug == null ? '' : task.project_slug).trim();
        return got !== '' && got === want;
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Resolves the current
     * note's project_slug, live-queries the open task notes matching it, and draws
     * a flat list. Fully guarded — returns quietly on cold-load (no throw); each
     * row is drawn by the shared static renderer.
     */
    async render(dv) {
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

        // The reliable project key: project_slug is a plain string in frontmatter
        // (unlike the Link-valued `project`), so compare it raw.
        const ourSlug = String(page.project_slug == null ? '' : page.project_slug).trim();
        if (!ourSlug) return;

        // ----- Live query: open task notes for this project (exclude _trash/ + _done/). -----
        // Filter on the RAW page.project_slug (a plain string) BEFORE parseNote —
        // simplest + avoids any Link coercion.
        let parsed = [];
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/')
                && String(p.project_slug == null ? '' : p.project_slug).trim() === ourSlug);
            parsed = raw.map(p => TE.parseNote(p)).array
                ? raw.map(p => TE.parseNote(p)).array()
                : Array.from(raw).map(p => TE.parseNote(p));
        } catch (_e) {
            parsed = [];
        }

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-project' });
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0; width: 100%; box-sizing: border-box;';

        const cap = wrap.createEl('div', { cls: 'sauce-task-project-label', text: 'Project Tasks' });
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
