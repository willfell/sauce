/**
 * ToDoHubActions (CustomJS) — renders a single AccentButton row on the
 * spice/to-do/All-ToDos.md hub note. The button label is
 * "← Back to Today's To-Do"; clicking invokes the same Templater template
 * the todo-today nav-button uses, so the "open-or-create today's note"
 * semantics are identical.
 *
 * Empties dv.container before rendering to avoid dual-fire duplicate rows.
 * Embeds-safe.
 */
class ToDoHubActions {
    async render(dv) {
        if (dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__toDoHubRenderGen || 0) + 1;
        dv.container.__toDoHubRenderGen = myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const backIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

        const row = dv.container.createEl('div');
        row.style.cssText = 'display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;';

        const goToday = () => {
            // Prefer the Templater command that the todo-today nav-button uses; this
            // creates today's note if missing AND opens it. Find the command by id
            // pattern `templater-obsidian:Today To-Do` (Templater registers per
            // template basename).
            const cmds = app.commands.commands || {};
            const id = Object.keys(cmds).find(k => /templater.*Today To-Do/.test(k));
            if (id) {
                app.commands.executeCommandById(id);
                return;
            }
            // Fallback: open-or-fail. If the file doesn't exist Obsidian will
            // create an empty placeholder, which the next "To Do" nav-button
            // click will resolve via Templater.
            const today = window.moment().format('YYYY-MM-DD');
            const folder = window.moment().format('YYYY/MM-MMMM');
            const path = `spice/to-do/${folder}/ToDo-${today}.md`;
            app.workspace.openLinkText(path, '');
        };

        customJS.AccentButton.render(row, { label: "Back to Today's To-Do", icon: backIcon, onClick: goToday, flex: true });
    }
}
