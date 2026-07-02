/**
 * TaskMeetingList (CustomJS) — the live-query task list a MEETING note renders
 * of its own tasks. Sibling of TaskTodayList (the daily) + TaskProjectList (the
 * project). Where the daily partitions into Today / Overdue bands, a meeting
 * shows a FLAT list of ALL its open tasks (no date bands) — a meeting is a
 * source, not a schedule.
 *
 * A task note carries `source_note: [[<Meeting>]]` when it was created from a
 * meeting surface. This widget resolves the CURRENT meeting's basename, then
 * live-queries the task notes under spice/tasks/ (open only, excluding _done/ +
 * _trash/), keeps those whose coerced source_note basename matches, and renders
 * each via the shared TaskTodayList.renderTaskRow so every surface draws a
 * uniform row (checkbox → markDone, click → edit dialog).
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the
 * meeting note is indexed. We resolve the page via the render-safe mechanism
 * (window.customJS?.RenderSafe?.page(dv), optional-chained so a TDZ'd customJS
 * never throws) and bail quietly if the classes we need (TaskEntity /
 * TaskDialog / TaskTodayList) aren't registered yet. NEVER throws out of render.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "\nreturn TaskMeetingList;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskMeetingList._matches(task, meetingBasename) → bool
 *
 * Instance API (browser-side):
 *   TaskMeetingList.render(dv)   ← the customjs-guard entry point
 */
class TaskMeetingList {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _matches(task, meetingBasename) { return TaskMeetingList._matches(task, meetingBasename); }

    // ---------- Static pure helper ----------

    /**
     * Does a PARSED task (parseNote output — source_note already coerced to a
     * basename string by TaskEntity._linkText) belong to the meeting whose
     * basename is `meetingBasename`? Open-only is enforced by the caller's query;
     * this is a pure source_note-basename equality. A blank meeting basename or a
     * task with no source_note → false. Never throws.
     */
    static _matches(task, meetingBasename) {
        if (!task) return false;
        const want = String(meetingBasename == null ? '' : meetingBasename).trim();
        if (!want) return false;
        const got = String(task.source_note == null ? '' : task.source_note).trim();
        return got !== '' && got === want;
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Resolves the current
     * meeting's basename, live-queries the open task notes, keeps the ones whose
     * source_note matches, and draws a flat list. Fully guarded — returns quietly
     * on cold-load (no throw); each row is drawn by the shared static renderer.
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

        // Current meeting basename (strip a trailing .md defensively).
        const rawName = (page.file && page.file.name) || '';
        const meetingBasename = String(rawName).replace(/\.md$/i, '').trim();
        if (!meetingBasename) return;

        // ----- Live query: open task notes (exclude _trash/ + _done/). -----
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

        const mine = parsed.filter(t => TaskMeetingList._matches(t, meetingBasename));

        // ----- Render -----
        const wrap = dv.container.createEl('div', { cls: 'sauce-task-meeting' });
        wrap.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0; width: 100%; box-sizing: border-box;';

        const cap = wrap.createEl('div', { cls: 'sauce-task-meeting-label', text: 'Tasks' });
        cap.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted, #999); margin-bottom: 2px;';

        if (!mine.length) {
            const hint = wrap.createEl('div', { text: 'No tasks yet — use + New Task above.' });
            hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }

        const TD = window.customJS && window.customJS.TaskDialog;
        for (const t of mine) {
            try {
                TTL.renderTaskRow(wrap, t, TD);
            } catch (_e) {
                // One bad task note must not break the whole list.
            }
        }
    }
}
