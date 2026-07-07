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
    // _cleanProjectName — extract the CLEAN project basename from a `project:`
    // frontmatter value that may be a RESOLVED Dataview Link OBJECT (its .path is
    // the full note path), a `[[...]]` wikilink string, or a bare string. Naively
    // `String(link).replace(/^\[\[|\]\]$/g,'')` leaves the whole path (which then
    // mangles into a path-slug); this returns just the basename ("Connectors").
    // Mirrors TaskEntity._linkText / MeetingLeafActions.cleanProjectName.
    static _cleanProjectName(v) {
        if (v == null) return '';
        const baseOf = (s) => {
            let out = String(s == null ? '' : s).trim();
            const slash = out.lastIndexOf('/');
            if (slash >= 0) out = out.slice(slash + 1);
            return out.replace(/\.md$/i, '');
        };
        if (typeof v === 'object' && ('path' in v || 'display' in v || 'subpath' in v)) {
            if (v.path != null && String(v.path).trim() !== '') return baseOf(v.path);
            if (v.display != null) return String(v.display).trim();
            return '';
        }
        if (typeof v === 'string') {
            let s = v.trim();
            const m = /^\[\[([^\]]*)\]\]$/.exec(s);
            if (m) s = m[1].trim();
            const pipe = s.indexOf('|');
            if (pipe >= 0) s = s.slice(0, pipe).trim();
            return baseOf(s);
        }
        return String(v);
    }
    static _slugify(name) {
        return String(name == null ? '' : name)
            .toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
    async render(dv) {
        if (dv.container.closest('.markdown-embed')) return;
        try { if (dv.container.closest('.markdown-preview-view')?.querySelector('.todo-chrome-root')) return; } catch (_e) {}

        const myGen = (dv.container.__toDoLeafRenderGen || 0) + 1;
        dv.container.__toDoLeafRenderGen = myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const cur = dv.current && dv.current();
        const noteType = cur && cur.type;

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
        const repeatIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
        const listIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;

        // Chrome dividers owned by the helper (wiki methodology) — but ONLY on the
        // daily to-do note (type: to-do), whose template brackets this block with
        // `---`. Render the button bar between a top + bottom <hr> INSIDE this one
        // dataviewjs block so the separators hug the buttons (12px) instead of the
        // big inter-block gap the template `---` left; a per-note install heal
        // strips that legacy `---` from existing daily notes. Project To-Do
        // (project-todo) and Recurring (to-do-recurring) templates render this block
        // WITHOUT surrounding `---`, so they keep their divider-less layout.
        // Chrome-overhaul reconciliation (2026-07-02): the per-project To-Do note
        // (project-todo) also gets the hugging divider so there's a clear separator
        // between the project nav buttons and this action bar (user ask), and its
        // two buttons (New Task + Recurring; All is hidden here) share ONE
        // full-width row (below). Daily to-do + recurring keep their layout.
        const wantDividers = noteType === 'to-do' || noteType === 'project-todo';
        const oneRow = noteType === 'project-todo';
        const DIVIDER = 'border: none; border-top: 1px solid var(--background-modifier-border); margin: 12px 0;';
        const host = wantDividers ? dv.container.createEl('div') : dv.container;
        if (wantDividers) {
            host.style.cssText = 'margin: 0;';
            host.createEl('hr').style.cssText = DIVIDER;
        }

        // Two stacked rows: New Task on its OWN full-width row (so its label
        // reads in full — never truncated to "New T..." when 3 buttons shared one
        // phone-width flex row), then Recurring (+ All where applicable) on a
        // second row below. The outer element is a column that centers the rows.
        const bar = host.createEl('div');
        bar.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin: ' + (wantDividers ? '0' : '0.5em') + ' auto; align-items: stretch; max-width: 600px;';

        // project-todo: New Task + Recurring share ONE full-width row (both flex:true
        // fill it evenly, wrapping on a very narrow phone). Other surfaces keep New
        // Task on its OWN readable row (newRow) with Recurring on a second row below.
        const newRow = oneRow ? null : bar.createEl('div');
        if (newRow) newRow.style.cssText = 'display: flex; width: 100%;';

        const row = bar.createEl('div');
        row.style.cssText = 'display: flex; gap: ' + (oneRow ? '8px' : '12px') + '; ' + (oneRow ? '' : 'justify-content: center; ') + 'align-items: stretch; flex-wrap: wrap;';

        const defaultDestForCurrent = () => {
            if (noteType === 'project-todo' && cur && cur.project) {
                // cur.project may be a RESOLVED Dataview Link — take the clean
                // basename, and prefer the note's own project_slug frontmatter.
                const name = ToDoLeafActions._cleanProjectName(cur.project);
                const slug = cur.project_slug || ToDoLeafActions._slugify(name);
                return { type: 'project', slug, name };
            }
            return 'today';
        };

        const openNewTask = () => {
            // v0.14.0 (task-entity daily wiring, Phase 1): the daily to-do surface
            // (type: to-do) creates tasks as one-file-per-task notes via the
            // task-entity mechanism's TaskDialog.
            if (noteType === 'to-do') {
                try {
                    window.customJS.TaskDialog.open({
                        surface: 'daily',
                        today: window.moment().format('YYYY-MM-DD'),
                    });
                } catch (e) {
                    new Notice('Could not open task dialog: ' + (e.message || e), 6000);
                }
                return;
            }
            // task-entity projects wiring: a per-project To-Do note (type:
            // project-todo) now creates ONE task-note via TaskDialog with
            // surface: 'project'. The task lives under spice/tasks/ stamped with
            // source: project + project_slug; the project's TaskProjectList block
            // live-queries it by project_slug. No raw markdown is appended.
            if (noteType === 'project-todo') {
                // cur.project may be a RESOLVED Dataview Link (its .path is the
                // full note path). Take the CLEAN basename for the name, and
                // prefer the note's own project_slug frontmatter for the slug so
                // the task-note is stamped with the REAL slug (not a path-slug).
                const name = ToDoLeafActions._cleanProjectName(cur && cur.project);
                const slug = (cur && cur.project_slug)
                    || (name ? ToDoLeafActions._slugify(name) : '');
                try {
                    window.customJS.TaskDialog.open({
                        surface: 'project',
                        project: { name, slug },
                    });
                } catch (e) {
                    new Notice('Could not open task dialog: ' + (e.message || e), 6000);
                }
                return;
            }
            // The recurring registry stays on the legacy ToDoCreateTask path.
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

        // New Task is the primary action → its OWN full-width row so the label
        // reads fully (flex:true stretches it to fill newRow; a full-row button
        // has ample width, so AccentButton's ellipsis never triggers even on a
        // ~360px phone). Recurring (+ All where applicable) share a second row
        // below; icons carry the action signal (+ for new, repeat for recurring,
        // list for backlog).
        customJS.AccentButton.render(newRow || row, { label: 'New Task', icon: plusIcon, onClick: openNewTask, flex: true });
        customJS.AccentButton.render(row, { label: 'Recurring', icon: repeatIcon, onClick: openNewRecurring, flex: true });
        if (noteType !== 'project-todo') {
            customJS.AccentButton.render(row, { label: 'All', icon: listIcon, onClick: openAllToDos, flex: true });
        }

        if (wantDividers) host.createEl('hr').style.cssText = DIVIDER;
    }
}
