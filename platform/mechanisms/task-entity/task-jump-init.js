/**
 * TaskJumpInit (CustomJS) — startup script.
 *
 * Registers one Obsidian command at customjs plugin init:
 *   `sauce:jump-to-task` → opens the Jump picker (customJS.TaskJump).
 *
 * Idempotency: `_registered` flag prevents re-registration when customjs's
 * "rerun startup scripts on file change" toggle fires.
 */
class TaskJumpInit {

    invoke() {
        if (this._registered) return;
        if (!window.app || !window.app.commands || !window.app.commands.addCommand) return;
        this._registered = true;
        try {
            window.app.commands.addCommand({
                id: 'sauce:jump-to-task',
                name: 'Sauce: Jump to task or note',
                callback: () => {
                    try {
                        customJS.TaskJump.open();
                    } catch (e) {
                        new Notice('Sauce: Jump to task or note — ' + (e.message || e), 6000);
                    }
                },
            });
        } catch (e) {
            console.error('TaskJumpInit register error:', e);
        }
    }
}
