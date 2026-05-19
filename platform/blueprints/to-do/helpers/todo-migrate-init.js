/**
 * ToDoMigrateInit (CustomJS) — bootstrap for the sauce:to-do-migrate Obsidian command.
 *
 * Registered in customjs plugin's startupScriptNames[] field via the to-do
 * blueprint's customjs_startup_scripts[] manifest declaration. customjs invokes
 * this class's invoke() method at plugin init time. The command opens
 * ToDoMigrateModal which lets the user pick unchecked tasks from today's note
 * to migrate to tomorrow.
 *
 * Idempotent — guarded by this._registered. customjs's "rerun startup scripts on
 * file change" toggle (off by default) would otherwise re-register the command on
 * every helper-file save; the guard makes that a no-op.
 */
class ToDoMigrateInit {
    invoke() {
        try {
            if (this._registered) return;
            this._registered = true;
            app.commands.addCommand({
                id: "sauce:to-do-migrate",
                name: "Sauce: Migrate to-dos to tomorrow",
                callback: () => {
                    try {
                        customJS.ToDoMigrateModal.open();
                    } catch (e) {
                        new Notice(`ToDoMigrateModal open failed: ${String(e)}`, 8000);
                        console.error('[ToDoMigrateInit] modal open error', e);
                    }
                },
            });
            console.log('[ToDoMigrateInit] sauce:to-do-migrate registered at', new Date().toISOString());
        } catch (e) {
            new Notice(`ToDoMigrateInit error: ${String(e)}`, 8000);
            console.error('[ToDoMigrateInit]', e);
        }
    }
}
