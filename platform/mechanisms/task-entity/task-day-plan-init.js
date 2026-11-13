/**
 * TaskDayPlanInit (CustomJS) — startup script.
 *
 * Registers one Obsidian command at customjs plugin init:
 *   `sauce:shut-down-day` → opens the Shut down modal (customJS.TaskDayPlan).
 *
 * Idempotency: `_registered` flag prevents re-registration when customjs's
 * "rerun startup scripts on file change" toggle fires.
 */
class TaskDayPlanInit {

    invoke() {
        if (this._registered) return;
        if (!window.app || !window.app.commands || !window.app.commands.addCommand) return;
        this._registered = true;
        try {
            window.app.commands.addCommand({
                id: 'sauce:shut-down-day',
                name: 'Sauce: Shut down the day',
                callback: () => {
                    try {
                        const DP = customJS.TaskDayPlan;
                        if (!DP || typeof DP.openShutdown !== 'function') { new Notice('Tasks are still loading. Try again in a moment.', 4000); return; }
                        DP.openShutdown({ app: window.app });
                    } catch (e) {
                        new Notice('Sauce: Shut down the day — ' + (e.message || e), 6000);
                    }
                },
            });
        } catch (e) {
            console.error('TaskDayPlanInit register error:', e);
        }
    }
}
