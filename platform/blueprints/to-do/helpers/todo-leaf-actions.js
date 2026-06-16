/**
 * ToDoLeafActions (CustomJS) — inline action-bar with `+ New Task`,
 * `+ Recurring`, and `All To-Dos` AccentButtons. Renders on:
 *   - daily to-do notes (type: to-do — ToDo-YYYY-MM-DD.md)
 *   - per-project To-Do notes (type: project-todo — <Name> To-Do.md)
 *   - the Recurring Tasks registry (type: to-do-recurring)
 *
 * The button set adapts: on a project-todo, "All To-Dos" hides because the
 * backlog hub is daily-scoped. On the registry, "+ Recurring" is preselected
 * by `+ New Task` opening straight into the Recurring tab and "All To-Dos"
 * still works to navigate to backlog.
 *
 * v0.116.0 (was v0.63.x): retires the `Migrate` button (the Migrate-to-tomorrow
 * modal is gone — use [scheduled:: YYYY-MM-DD] on the task line instead).
 *
 * Mirrors the existing structural conventions: empty container before render,
 * embed-safe early return, render-gen counter.
 */
class ToDoLeafActions {
    async render(dv) {
        if (dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__toDoLeafRenderGen || 0) + 1;
        dv.container.__toDoLeafRenderGen = myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const cur = dv.current && dv.current();
        const noteType = cur && cur.type;

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const repeatIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
        const listIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;

        const row = dv.container.createEl('div');
        row.style.cssText = 'display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;';

        const defaultDestForCurrent = () => {
            if (noteType === 'project-todo' && cur && cur.project) {
                const name = String(cur.project).replace(/^\[\[|\]\]$/g, '');
                const slug = cur.project_slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                return { type: 'project', slug, name };
            }
            return 'today';
        };

        const openNewTask = () => {
            try {
                customJS.ToDoCreateTask.open({
                    preselectTab: noteType === 'to-do-recurring' ? 'recurring' : 'one-shot',
                    preselectDestination: defaultDestForCurrent(),
                });
            } catch (e) {
                new Notice('Could not open dialog: ' + (e.message || e), 6000);
            }
        };

        const openNewRecurring = () => {
            // v0.120.0: open the registry file directly instead of the create-task dialog.
            // Recurring tasks are managed by editing the registry markdown, not via a
            // dialog (user feedback 2026-06-16: registry is the source of truth; the
            // dialog round-trip added friction without value). The registry file is
            // materialized once at install and persists per-vault.
            const path = 'spice/to-do/Recurring Tasks.md';
            try {
                app.workspace.openLinkText(path, '', false);
            } catch (e) {
                new Notice('Could not open Recurring Tasks registry: ' + (e.message || e), 6000);
            }
        };

        const openAllToDos = async () => {
            const path = 'spice/to-do/All-ToDos.md';
            const file = app.vault.getAbstractFileByPath(path);
            const body = [
                '---',
                'type: to-do-hub',
                `created_at: "${window.moment().format('YYYY-MM-DDTHH:mm:ssZZ')}"`,
                'cssclasses:',
                '  - wide',
                '---',
                '',
                '```dataviewjs',
                'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
                '```',
                '',
                '```dataviewjs',
                'await dv.view("ranch/views/customjs-guard", { class: "ToDoHubActions" });',
                '```',
                '',
                '```dataviewjs',
                'await dv.view("ranch/views/customjs-guard", { class: "ToDoAllList" });',
                '```',
                '',
            ].join('\n');
            try {
                if (!file) {
                    await app.vault.create(path, body);
                } else {
                    const content = await app.vault.read(file);
                    if (!content.trim() || !/^---\s*$/m.test(content) || !/ToDoAllList/.test(content)) {
                        await app.vault.modify(file, body);
                        new Notice('All-ToDos.md was empty or missing the aggregator block — restored from template.', 6000);
                    }
                }
            } catch (e) {
                console.warn('[ToDoLeafActions] could not (re)write All-ToDos.md', e);
            }
            app.workspace.openLinkText(path, '');
        };

        // Render order: New Task, Recurring, All. Labels intentionally short so
        // 3 buttons fit on a single phone-width row without overlapping their
        // tap targets. Icons carry the action signal (+ for new, repeat for
        // recurring, list for backlog).
        customJS.AccentButton.render(row, { label: 'New Task', icon: plusIcon, onClick: openNewTask, flex: true });
        customJS.AccentButton.render(row, { label: 'Recurring', icon: repeatIcon, onClick: openNewRecurring, flex: true });
        if (noteType !== 'project-todo') {
            customJS.AccentButton.render(row, { label: 'All', icon: listIcon, onClick: openAllToDos, flex: true });
        }
    }
}
