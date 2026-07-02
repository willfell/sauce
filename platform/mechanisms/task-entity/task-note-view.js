/**
 * TaskNoteView (CustomJS) — the clean, native-Obsidian card that a task note
 * renders in its own body. Fourth class of the task-entity mechanism (after
 * TaskEntity, TaskDialog, TaskTodayList). Without it a `type: task` note opens
 * bare; TaskNoteView turns the note into a real page: a status pill + the task
 * title, a metadata grid of the set fields (Scheduled / Due / Priority /
 * Project), an "Edit task" button that opens the TaskDialog in edit mode, and a
 * "From:" link back to the source note when one is set.
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
 *   TaskNoteView._fieldRows(task) → [{ label, value }, …] for the SET fields only
 *
 * Instance API (browser-side):
 *   TaskNoteView.render(dv)   ← the customjs-guard entry point
 */
class TaskNoteView {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _fieldRows(task) { return TaskNoteView._fieldRows(task); }

    // ---------- Static pure helper ----------

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

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Reads the current
     * page's task frontmatter and draws the card. Fully guarded — returns quietly
     * on cold-load (no throw), and each field is read defensively so one bad
     * value can't break the whole card.
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

            // Read the task fields defensively straight off the page frontmatter.
            const task = {
                title: page.title != null ? String(page.title) : '',
                status: page.status != null ? String(page.status) : 'open',
                scheduled: page.scheduled != null ? String(page.scheduled) : '',
                due: page.due != null ? String(page.due) : '',
                priority: page.priority != null ? String(page.priority) : '',
                project: page.project != null ? String(page.project) : '',
                source_note: page.source_note != null ? String(page.source_note) : '',
            };
            const filePath = (page.file && page.file.path) || null;

            // ----- Card container -----
            const card = c.createEl('div', { cls: 'sauce-task-note-view' });
            card.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin: 4px 0 8px; width: 100%; box-sizing: border-box;';

            // ----- Header: status pill + title -----
            const header = card.createEl('div');
            header.style.cssText = 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap;';

            const pill = header.createEl('span', { text: this._statusLabel(task.status) });
            pill.style.cssText = 'font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: var(--radius-s, 4px); background: var(--background-modifier-border); color: var(--text-muted); flex-shrink: 0;';

            const titleEl = header.createEl('span', { text: task.title || '(untitled)' });
            titleEl.style.cssText = 'font-size: 1.35em; font-weight: 600; color: var(--text-normal); overflow-wrap: break-word; word-break: break-word;';

            // ----- Metadata grid (set fields only) -----
            const rows = TaskNoteView._fieldRows(task);
            if (rows.length) {
                const grid = card.createEl('div');
                grid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px;';
                for (const r of rows) {
                    try {
                        const chip = grid.createEl('div');
                        chip.style.cssText = 'display: flex; flex-direction: column; gap: 2px; padding: 4px 10px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 4px);';
                        const lab = chip.createEl('span', { text: r.label });
                        lab.style.cssText = 'font-size: 0.68em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);';
                        const value = chip.createEl('span', { text: r.value });
                        value.style.cssText = 'font-size: 0.9em; color: var(--text-normal);';
                    } catch (_e) { /* one bad field must not break the card */ }
                }
            }

            // ----- "From:" source-note link -----
            if (task.source_note) {
                try {
                    const target = this._stripWikilink(task.source_note);
                    if (target) {
                        const fromRow = card.createEl('div');
                        fromRow.style.cssText = 'font-size: 0.85em; color: var(--text-muted); display: flex; align-items: center; gap: 4px; flex-wrap: wrap;';
                        fromRow.createEl('span', { text: 'From:' });
                        const link = fromRow.createEl('a', { text: target });
                        link.style.cssText = 'color: var(--link-color, var(--text-accent)); cursor: pointer; text-decoration: none;';
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

            // ----- "Edit task" accent button -----
            const actions = card.createEl('div');
            actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';
            const editBtn = actions.createEl('button', { text: 'Edit task' });
            editBtn.style.cssText = 'padding: 6px 14px; border-radius: var(--radius-s, 4px); border: 1px solid var(--interactive-accent, #6a6abf); background: var(--interactive-accent, #6a6abf); color: white; cursor: pointer; font-size: 0.9em;';
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
