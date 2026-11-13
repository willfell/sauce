/**
 * ToDoCreateTaskInit (CustomJS) — startup script.
 *
 * Registers three Obsidian commands at customjs plugin init:
 *   `sauce:new-task`            → opens the dialog with One-shot tab preselected.
 *   `sauce:new-task-from-set`   → opens TaskSets' New from set dialog.
 *   `sauce:new-recurring-task`  → opens the dialog with Recurring tab preselected.
 *
 * Idempotency: `_registered` flag prevents re-registration when customjs's
 * "rerun startup scripts on file change" toggle fires.
 */
class ToDoCreateTaskInit {

    invoke() {
        if (this._registered) return;
        if (!window.app || !window.app.commands || !window.app.commands.addCommand) return;
        this._registered = true;
        try {
            window.app.commands.addCommand({
                id: 'sauce:new-task',
                name: 'Sauce: New task',
                callback: () => {
                    try {
                        customJS.ToDoCreateTask.open({ preselectTab: 'one-shot' });
                    } catch (e) {
                        new Notice('Sauce: New task — ' + (e.message || e), 6000);
                    }
                },
            });
            window.app.commands.addCommand({
                id: 'sauce:new-task-from-set',
                name: 'Sauce: New task from set',
                callback: () => {
                    try {
                        const TS = customJS.TaskSets;
                        if (!TS || typeof TS.open !== 'function') { new Notice('Tasks are still loading — try again in a moment', 4000); return; }
                        TS.open({ surface: 'daily', today: window.moment().format('YYYY-MM-DD') });
                    } catch (e) {
                        new Notice('Sauce: New task from set — ' + (e.message || e), 6000);
                    }
                },
            });
            window.app.commands.addCommand({
                id: 'sauce:new-recurring-task',
                name: 'Sauce: New recurring task',
                callback: () => {
                    try {
                        customJS.ToDoCreateTask.open({ preselectTab: 'recurring' });
                    } catch (e) {
                        new Notice('Sauce: New recurring task — ' + (e.message || e), 6000);
                    }
                },
            });
        } catch (e) {
            console.error('ToDoCreateTaskInit register error:', e);
        }
    }
}
