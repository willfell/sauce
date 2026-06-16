/**
 * ProjectTaskCreateListenerInit (CustomJS) — bootstrap for ProjectTaskCreateListener.
 *
 * Registered in customjs plugin's startupScriptNames[] field via the project
 * blueprint's customjs_startup_scripts[] manifest declaration. customjs invokes
 * this class's invoke() method at plugin init time, which in turn calls
 * ProjectTaskCreateListener.init() to subscribe the vault.create handler.
 *
 * v0.49.0 architectural note: this replaces v0.48.0's Templater startup_template
 * registration mechanism, which empirically failed to fire at consumer vaults.
 * The v0.48.0 Templater wiring + Template, Project Task Create Listener.md stay
 * in place as belt-and-suspenders backstop (idempotent init via _initialized flag).
 */
class ProjectTaskCreateListenerInit {
    invoke() {
        try {
            customJS.ProjectTaskCreateListener.init();
        } catch (e) {
            new Notice(`ProjectTaskCreateListenerInit error: ${String(e)}`, 8000);
            console.error('[ProjectTaskCreateListenerInit]', e);
        }
    }
}
