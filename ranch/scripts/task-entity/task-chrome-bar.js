/**
 * TaskChromeBar (CustomJS) — task-entity's ChromeBar adapter config. Renders
 * the shared breadcrumb + Go ▾ bar on `type: task` notes (both top-level
 * tasks and their subtasks) via customJS.ChromeBar.makeAdapter(this._config()),
 * the same factory every other blueprint's <X>ChromeBar uses.
 *
 * Task notes are pure LEAF entities in the ChromeBar model: no primary
 * action (task creation lives in the daily's "+ New Task" nav button and the
 * SUBTASKS section's own "+ Add subtask" input; editing lives in the card's
 * own "Edit task" button) and no overflow menu. No "This task" cross-links
 * either — the card's own SOURCE / Part-of / SUBTASKS sections already cover
 * every task-to-task navigation need. Breadcrumb rendering itself is handled
 * entirely by ChromeBar.render reading task-entity's manifest breadcrumb.types.task
 * registry entry — this class supplies no breadcrumb logic of its own.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the
 * whole file in `( ... )` and evals it as ONE expression; any trailer
 * (module.exports, if, ...) → "Unexpected token" → the class never
 * registers. To Node-test the statics, load via
 * `new Function(src + "\nreturn TaskChromeBar;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskChromeBar._config() → { detect, surfaceSpec, dispatch, destinations, rootClass, btnClass }
 *
 * Instance API (browser-side):
 *   TaskChromeBar.render(dv) ← the customjs-guard entry point
 */
class TaskChromeBar {

    // ---------- Instance delegator (customJS stores INSTANCES) ----------

    _config() { return TaskChromeBar._config(); }

    // ---------- Static pure helper ----------

    /**
     * The adapter config consumed by ChromeBar.makeAdapter. `detect` matches
     * any `type: task` page (both top-level tasks and subtasks — they're
     * indistinguishable at this layer; the breadcrumb registry is what draws
     * the extra ancestor for a subtask, via its own parent_task predicate).
     * Pure; never throws.
     */
    static _config() {
        return {
            detect: (dv, page) => {
                if (page && page.type === 'task') {
                    return { context: 'task', path: (page.file && page.file.path) || '' };
                }
                return null;
            },
            surfaceSpec: () => ({ primary: null, overflow: [], leaf: true }),
            dispatch: () => {},
            destinations: () => [],
            rootClass: 'task-chrome-root',
            btnClass: (v) => 'task-chrome-btn task-chrome-btn-' + v,
        };
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Delegates entirely
     * to the shared ChromeBar mechanism. Cold-load safe (optional-chained
     * customJS lookups) and never throws.
     */
    render(dv) {
        try {
            if (!window.customJS || !window.customJS.ChromeBar
                || typeof window.customJS.ChromeBar.makeAdapter !== 'function'
                || typeof window.customJS.ChromeBar.render !== 'function') return;
            return window.customJS.ChromeBar.render(dv, window.customJS.ChromeBar.makeAdapter(TaskChromeBar._config()));
        } catch (_e) { /* never throw */ }
    }
}
