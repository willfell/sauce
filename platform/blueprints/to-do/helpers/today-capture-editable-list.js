/**
 * TodayCaptureEditableList (CustomJS) — the SOLE Today-capture UI on a daily
 * to-do note. Renders the free-form Today `- [ ]` lines as a click-to-edit
 * list: each row carries a functional checkbox (clicking toggles `[ ]`/`[x]`
 * in the file via TaskInteractions.replaceTaskAt), metadata chips, and a pencil
 * that opens the ToDoCreateTask modal in editExisting mode.
 *
 * v0.132.x: previously the widget only ENHANCED the raw lines — Obsidian also
 * rendered the source `- [ ]` lines as native checkboxes, so the user saw the
 * task TWICE (raw + editable). Now `_hideRawCaptureLines` suppresses the native
 * rendering (reading mode) so this list is the only thing shown, and the
 * checkbox is functional (was read-only, which relied on the now-hidden native
 * checkbox for toggling). Live-preview still shows source while editing.
 *
 * Sister surface to ToDoLeafActions; consumed exclusively by
 * `type: to-do` daily notes between SectionLabel("Today", top:true) and
 * ToDoDailyCarryover.
 *
 * Anchor scope: TaskInteractions.findTaskLines(content, 'todayCapture')
 * (mechanism task-interactions@0.1.0) — bounded by the
 * <!-- TODAY_CAPTURE_MARKER --> sentinel that ships in the template and
 * is back-injected into existing notes by install.js step 6.
 */
class TodayCaptureEditableList {

    /**
     * Return `line` with its checkbox marker set to `[x]` (checked) or `[ ]`
     * (unchecked). Pure; preserves the bullet marker (-,*,+) and everything
     * after the checkbox. Returns the line unchanged if it is not a task line.
     */
    static _setChecked(line, checked) {
        if (typeof line !== 'string') return line;
        return line.replace(/^([-*+] \[)[ xX](\])/, (_m, p1, p2) => p1 + (checked ? 'x' : ' ') + p2);
    }

    /**
     * Best-effort: hide the native-rendered raw `- [ ]` capture lines so this
     * widget is the only Today list shown. Reading-mode only — feature-detected
     * and wrapped so it no-ops in live-preview, embeds, and test stubs, and
     * never throws out of render. The capture region is the only NATIVE task
     * list on a daily note (carryover/recurring/etc. are dataviewjs-rendered),
     * and it sits ABOVE this block, so we hide native `ul.contains-task-list`
     * elements that precede our container and are not inside a dataviewjs block.
     */
    _hideRawCaptureLines(container) {
        try {
            if (!container || typeof container.closest !== 'function') return;
            const preview = container.closest('.markdown-preview-view');
            if (!preview || typeof preview.querySelectorAll !== 'function') return;
            const ourBlock = container.closest('.block-language-dataviewjs');
            const lists = preview.querySelectorAll('ul.contains-task-list');
            for (const ul of lists) {
                if (ul.closest && ul.closest('.block-language-dataviewjs')) continue;
                // DOCUMENT_POSITION_PRECEDING (2): only hide lists BEFORE our block.
                if (ourBlock && typeof ourBlock.compareDocumentPosition === 'function'
                    && !(ourBlock.compareDocumentPosition(ul) & 2)) continue;
                ul.style.display = 'none';
            }
        } catch (_e) { /* best-effort; never break render */ }
    }

    async render(dv) {
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

        const entries = ti.findTaskLines(content, 'todayCapture');
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

            // Functional checkbox: this list is now the SOLE Today UI (the raw
            // native lines are hidden), so clicking toggles [ ]/[x] in the file
            // via TaskInteractions.replaceTaskAt. On failure, revert + notice.
            const cb = row.createEl('input');
            cb.type = 'checkbox';
            cb.checked = /^[-*+] \[[xX]\] /.test(entry.line);
            cb.style.cssText = 'margin: 0; cursor: pointer;';
            cb.addEventListener('change', async () => {
                const want = cb.checked;
                const newLine = TodayCaptureEditableList._setChecked(entry.line, want);
                const res = await ti.replaceTaskAt(filePath, entry.idx, newLine);
                if (!res || !res.ok) {
                    cb.checked = !want;
                    new Notice('Could not update task: ' + ((res && res.reason) || 'unknown'), 6000);
                }
                // On success, vault.modify re-renders this block with fresh state.
            });

            // Title.
            const title = row.createEl('span');
            const parsed = entry.parsed || {};
            title.textContent = parsed.title || entry.line.replace(/^[-*+] \[[ xX]\] /, '');
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

        // Suppress the native-rendered raw capture checkboxes so this list is
        // the only Today UI. Retries catch raw lines that render after us.
        this._hideRawCaptureLines(dv.container);
        if (typeof setTimeout === 'function') {
            setTimeout(() => this._hideRawCaptureLines(dv.container), 60);
            setTimeout(() => this._hideRawCaptureLines(dv.container), 250);
        }
    }
}
