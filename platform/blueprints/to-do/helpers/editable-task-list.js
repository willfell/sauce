/**
 * EditableTaskList (CustomJS) — renders a bounded section of a note's
 * free-form checkbox rows as a click-to-edit list. Each row exposes a
 * pencil icon that opens the ToDoCreateTask modal in editExisting mode
 * (v0.127.0 §F), letting users update inline-field metadata (project, due,
 * priority, scheduled) without raw markdown editing.
 *
 * Provenance: v0.127.0 §F introduced this surface as TodayCaptureEditableList
 * scoped to the daily-note `## Today` section via the
 * <!-- TODAY_CAPTURE_MARKER --> sentinel. v0.128.0 §B generalized the surface
 * into EditableTaskList driven by a `sectionAnchor` opts argument so the same
 * renderer can target multiple bounded scopes. Two consumer surfaces ship at
 * v0.128.0:
 *   - Today To-Do (daily note `## Today` section) via `sectionAnchor: "todayCapture"`
 *   - Project To-Do (project-todo note Owned Tasks section) via `sectionAnchor: "ownedTasks"`
 *
 * Anchor scope: TaskInteractions.findTaskLines(content, sectionAnchor)
 * (mechanism task-interactions@>=0.2.0) — bounded by the matching sentinel
 * marker that ships in each template and is back-injected into existing notes
 * by install.js heal step 6 (todayCapture) and step 7 (ownedTasks).
 *
 * Back-compat alias: a TodayCaptureEditableList subclass is registered at the
 * bottom of this file so legacy notes materialized at v0.127.0/v0.127.1 keep
 * rendering until heal step 6's class-rewrite pass (v0.128.0 §D) migrates
 * their invocations to the canonical EditableTaskList form with explicit
 * sectionAnchor arg.
 */
class EditableTaskList {
    async render(dv, opts) {
        const sectionAnchor = (opts && opts.sectionAnchor) || "todayCapture";
        if (!dv || !dv.container) return;
        // Skip rendering inside embeds — the host note already renders its own list.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        // Clear container defensively.
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const ti = window.customJS && window.customJS.TaskInteractions;
        if (!ti || typeof ti.findTaskLines !== 'function') {
            const note = dv.container.createEl('div', { text: 'task-interactions mechanism not loaded' });
            note.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }

        // Resolve current file path. dv.current() returns the dataview page for
        // the active note; .file.path is the canonical vault-relative path.
        const cur = dv.current && dv.current();
        if (!cur || !cur.file || !cur.file.path) return;
        const filePath = cur.file.path;

        const vault = window.app && window.app.vault;
        if (!vault) return;
        const file = vault.getAbstractFileByPath(filePath);
        if (!file) return;

        let content;
        try {
            content = await vault.read(file);
        } catch (_e) {
            return;
        }

        const entries = ti.findTaskLines(content, sectionAnchor);
        if (!entries || entries.length === 0) {
            const empty = dv.container.createEl('div', { text: 'No tasks yet. Add a checkbox above.' });
            empty.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 6px 0;';
            return;
        }

        const list = dv.container.createEl('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0;';

        for (const entry of entries) {
            const row = list.createEl('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent;';
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-secondary)'; });
            row.addEventListener('mouseleave', () => { row.style.background = ''; });

            // Checkbox state visual (read-only — toggling stays in raw markdown
            // via Obsidian's built-in reading-view click handler on the line itself).
            const cb = row.createEl('input');
            cb.type = 'checkbox';
            cb.checked = /^- \[[xX]\] /.test(entry.line);
            cb.disabled = true;
            cb.style.cssText = 'margin: 0;';

            // Title.
            const title = row.createEl('span');
            const parsed = entry.parsed || {};
            title.textContent = parsed.title || entry.line.replace(/^- \[[ xX]\] /, '');
            title.style.cssText = 'flex: 1; ' + (cb.checked
                ? 'text-decoration: line-through; color: var(--text-muted);'
                : 'color: var(--text-normal);');

            // Metadata chips (only render when set).
            const chips = row.createEl('div');
            chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center;';
            const addChip = (label) => {
                const chip = chips.createEl('span', { text: label });
                chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
            };
            if (parsed.project) addChip(parsed.project);
            if (parsed.priority) addChip(parsed.priority);
            if (parsed.due) addChip('due: ' + parsed.due);
            if (parsed.scheduled) addChip('scheduled: ' + parsed.scheduled);

            // Pencil edit button — opens the modal in editExisting mode.
            const editBtn = row.createEl('span');
            editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
            editBtn.style.cssText = 'cursor: pointer; color: var(--text-muted); padding: 2px;';
            editBtn.addEventListener('mouseenter', () => { editBtn.style.color = 'var(--text-normal)'; });
            editBtn.addEventListener('mouseleave', () => { editBtn.style.color = 'var(--text-muted)'; });
            editBtn.addEventListener('click', () => {
                const tcd = window.customJS && window.customJS.ToDoCreateTask;
                if (!tcd || typeof tcd.open !== 'function') {
                    new Notice('ToDoCreateTask not loaded; cannot open editor', 6000);
                    return;
                }
                tcd.open({
                    editExisting: {
                        filePath,
                        lineIdx: entry.idx,
                        parsed: entry.parsed,
                    },
                });
            });
        }
    }
}

// ── v0.128.0 back-compat alias ──────────────────────────────────────────────
// Legacy notes materialized at v0.127.0/v0.127.1 invoke this class name via
// `class: "TodayCaptureEditableList"`. The customjs registry needs both names
// to keep those notes rendering until heal step 6's class-rewrite pass
// (v0.128.0 §D) migrates them to the canonical EditableTaskList invocation
// with explicit sectionAnchor arg.
class TodayCaptureEditableList extends EditableTaskList {}
