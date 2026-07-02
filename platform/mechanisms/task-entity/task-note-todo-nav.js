/**
 * TaskNoteToDoNav (CustomJS) — one accent nav button on a task note that opens
 * TODAY's daily to-do note. Part of the task-note chrome (rendered between the
 * SpaceNavButtons row and the TaskNoteView card): from any task note the user
 * can jump straight back to the day's to-do surface in one tap.
 *
 * The daily path is derived from window.moment (the same scheme the to-do
 * blueprint uses): spice/to-do/YYYY/MM-MMMM/ToDo-YYYY-MM-DD.md. openLinkText
 * navigates to it (Obsidian resolves/creates per its normal link behavior), so
 * the button works whether or not today's note already exists.
 *
 * COLD-LOAD SAFETY (landmines #1-2): render never dereferences dv.current().file
 * — it only reads window.moment + app.workspace at CLICK time, all guarded, so a
 * stale pre-index render can't throw. The whole body is wrapped so it NEVER
 * throws out of render.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "\nreturn TaskNoteToDoNav;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskNoteToDoNav._dailyPath(moment) → "spice/to-do/YYYY/MM-MMMM/ToDo-YYYY-MM-DD.md"
 *
 * Instance API (browser-side):
 *   TaskNoteToDoNav.render(dv)   ← the customjs-guard entry point
 */
class TaskNoteToDoNav {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _dailyPath(moment) { return TaskNoteToDoNav._dailyPath(moment); }

    // ---------- Static pure helper ----------

    /**
     * Compute today's daily to-do note path from a moment-like object (anything
     * with `.format`). Mirrors the to-do blueprint's dated layout:
     *   spice/to-do/<YYYY>/<MM-MMMM>/ToDo-<YYYY-MM-DD>.md
     * A missing/format-less moment → '' (caller no-ops). Pure — no wall clock of
     * its own (the caller injects window.moment()).
     */
    static _dailyPath(moment) {
        if (!moment || typeof moment.format !== 'function') return '';
        const ym = moment.format('YYYY/MM-MMMM');
        const day = moment.format('YYYY-MM-DD');
        if (!ym || !day) return '';
        return 'spice/to-do/' + ym + '/ToDo-' + day + '.md';
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Renders ONE full-width,
     * left-aligned accent button "Today's To-Do" that opens today's daily note.
     * Fully guarded — never throws out of render.
     */
    async render(dv) {
        try {
            if (!dv || !dv.container) return;
            // Skip inside embeds — the host note renders its own chrome.
            if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

            while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

            // Calendar/list SVG icon (currentColor so it themes with the button).
            const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/></svg>';

            const openToday = () => {
                try {
                    const moment = (typeof window !== 'undefined' && window.moment) ? window.moment() : null;
                    const path = TaskNoteToDoNav._dailyPath(moment);
                    if (!path) { try { new Notice('Could not resolve today’s to-do note'); } catch (_e) {} return; }
                    const wsApp = (typeof window !== 'undefined' && window.app) || (typeof app !== 'undefined' ? app : null);
                    if (wsApp && wsApp.workspace && typeof wsApp.workspace.openLinkText === 'function') {
                        wsApp.workspace.openLinkText(path, '', false);
                    }
                } catch (e) {
                    try { new Notice('Could not open today’s to-do note: ' + (e && (e.message || e)), 6000); } catch (_e) {}
                }
            };

            // Left-aligned, full-width-ish row so the button anchors to the left.
            const row = dv.container.createEl('div', { cls: 'sauce-task-note-todo-nav' });
            row.style.cssText = 'display: flex; justify-content: flex-start; width: 100%; margin: 4px 0;';

            // Prefer the shared AccentButton renderer (visual cohesion); fall back
            // to an inline accent button if the mechanism isn't registered yet.
            const AB = window.customJS && window.customJS.AccentButton;
            if (AB && typeof AB.render === 'function') {
                AB.render(row, { label: "Today's To-Do", icon: icon, onClick: openToday });
                return;
            }
            const btn = row.createEl('button');
            btn.innerHTML = icon + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">Today’s To-Do</span>';
            btn.style.cssText = 'cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; overflow: hidden;';
            btn.onmouseenter = () => { btn.style.background = 'var(--interactive-accent)'; btn.style.color = 'var(--text-on-accent)'; };
            btn.onmouseleave = () => { btn.style.background = 'var(--background-primary)'; btn.style.color = 'var(--interactive-accent)'; };
            btn.onclick = openToday;
        } catch (_e) {
            // Never throw out of render (cold-load safety).
        }
    }
}
