/**
 * ToDoLeafActions (CustomJS) — renders two AccentButtons (All To-Dos + Migrate)
 * in a centered flex row on a daily to-do note (ToDo-YYYY-MM-DD.md).
 *
 * v0.63.1 PATCH replaces v0.63.0's global nav-button approach. SpaceNavButtons
 * is a global registry that surfaces every blueprint's nav_buttons[] on every
 * note; v0.63.0 exposed All-To-Dos + Migrate everywhere, which was correct for
 * navigation buttons but wrong UX for these two (one is a backlog view, one is
 * a contextual action that only makes sense on a daily to-do). Both moved here
 * as inline AccentButtons embedded into Today To-Do.md via a new dataviewjs
 * block — only renders inside the daily template body.
 *
 * Mirrors the ScratchLeafActions pattern (`platform/blueprints/scratch/helpers/
 * scratch-leaf-actions.js`). Empties dv.container before rendering; embed-safe.
 */
class ToDoLeafActions {
    async render(dv) {
        if (dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__toDoLeafRenderGen || 0) + 1;
        dv.container.__toDoLeafRenderGen = myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const listIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
        const arrowIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;

        const row = dv.container.createEl('div');
        row.style.cssText = 'display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;';

        const openAllToDos = () => {
            app.workspace.openLinkText('spice/to-do/All-ToDos.md', '');
        };

        const openMigrate = () => {
            const id = 'sauce:to-do-migrate';
            if (app.commands.commands && app.commands.commands[id]) {
                app.commands.executeCommandById(id);
                return;
            }
            new Notice('Migrate command not registered. Reload Obsidian (Cmd-R) to re-run customjs startup scripts.', 8000);
        };

        customJS.AccentButton.render(row, { label: 'All To-Dos', icon: listIcon, onClick: openAllToDos, flex: true });
        customJS.AccentButton.render(row, { label: 'Migrate', icon: arrowIcon, onClick: openMigrate, flex: true });
    }
}
