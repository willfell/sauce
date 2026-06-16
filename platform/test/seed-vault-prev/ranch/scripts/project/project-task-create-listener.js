/**
 * ProjectTaskCreateListener (CustomJS)
 *
 * One-shot subscription to vault.create for kanban-plugin-created files
 * under spice/projects/<slug>/tasks/<file>.md. On match, invokes Templater's
 * Replace-in-file command so the embedded <%* %> blocks in Template, Kanban Card.md
 * actually execute (kanban-plugin uses Obsidian's CORE template paste which does
 * NOT run Templater syntax).
 *
 * Registration: a Templater startup template (Template, Project Task Create
 * Listener.md) calls customJS.ProjectTaskCreateListener.init() at vault load.
 *
 * Idempotency:
 *   - init() is a no-op on second call (_initialized flag).
 *   - Handler path regex excludes nested files (tasks/<X>/<X>.md) — only
 *     top-level files directly under tasks/ trigger.
 *   - Handler content-check skips files with no raw <% text (covers the
 *     case where Templater already processed the file).
 *
 * Failure-loud:
 *   - new Notice if the Templater command id is missing (plugin not installed
 *     OR plugin update renamed the id).
 *   - new Notice + console.error on any exception in the handler body.
 */
class ProjectTaskCreateListener {
    constructor() {
        this._initialized = false;
        this._pathRegex = /^spice\/projects\/[^/]+\/tasks\/[^/]+\.md$/;
        this._templaterCommandId = 'templater-obsidian:replace-in-file-templater';
        this._postCreateDelayMs = 200; // S0 hedge: 4× the design's nominal 50ms (S10 will measure actual race timing at headspace)
    }

    init() {
        if (this._initialized) return;
        this._initialized = true;

        app.vault.on('create', async (file) => {
            try {
                if (!file || file.extension !== 'md') return;
                if (!this._pathRegex.test(file.path)) return;

                // Defer to let kanban-plugin finish pasting content
                await new Promise(r => setTimeout(r, this._postCreateDelayMs));

                const content = await app.vault.read(file);
                if (!content.includes('<%')) return; // idempotency / already-processed guard

                const cmd = app.commands.commands[this._templaterCommandId];
                if (!cmd) {
                    new Notice(`Templater command missing: ${this._templaterCommandId}. Task created without workstream prompt.`, 8000);
                    return;
                }

                // Open the file so it's the active file for Templater's replace-in-file
                await app.workspace.openLinkText(file.path, '');
                await app.commands.executeCommandById(this._templaterCommandId);
            } catch (e) {
                new Notice(`ProjectTaskCreateListener error: ${e.message}`, 8000);
                console.error('[ProjectTaskCreateListener]', e);
            }
        });

        console.log('[ProjectTaskCreateListener] subscribed to vault.create');
    }
}
