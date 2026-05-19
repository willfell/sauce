/**
 * ToDoMigrateModal (CustomJS) — opens an overlay listing today's unchecked
 * tasks; selected tasks (with their indented child lines) are removed from
 * today's note and appended to tomorrow's ## Tasks section, creating
 * tomorrow's note from template if it doesn't exist.
 *
 * Exposes two static pure helpers for parser + applier logic:
 *   ToDoMigrateModal.parseTasks(content) -> Array<{ topLine, childLines, startIdx, endIdx }>
 *   ToDoMigrateModal.applyMigration(today, tomorrow, indices) -> { today, tomorrow }
 *
 * Both are exercised by platform/test/run-todo-modal.js (Node-only; no
 * Obsidian/customjs/window references inside these two functions).
 *
 * Modal UI: plain-DOM overlay (backdrop + centered modal div attached to
 * document.body). Avoids constructor-fetch tricks around Obsidian's Modal
 * class inside the customjs sandbox.
 */
class ToDoMigrateModal {
    // ---------- Static pure helpers (Node-testable) ----------

    /**
     * parseTasks: extract top-level unchecked tasks (with their indented
     * children) from the ## Tasks section of `content`.
     *
     * Returns an array of blocks. Each block:
     *   { topLine: string, childLines: string[], startIdx: number, endIdx: number }
     * where startIdx/endIdx are inclusive line indices into the SPLIT content
     * (content.split('\n')).
     *
     * Rules:
     * - Operates only on lines INSIDE the `## Tasks` heading (until next `## `
     *   heading or EOF).
     * - Top-level task = line matching `^- \[ \] ` (unchecked only).
     * - `- [x] ` lines (completed) are skipped, including their children.
     * - Child = any line whose first non-whitespace character is reached after
     *   at least one space or tab of indentation, AND that follows a top-level
     *   task line or another child line. Blank line followed by a non-indented
     *   line terminates the children. A blank line followed by another
     *   indented line continues the children.
     * - A top-level task with zero children is valid.
     */
    static parseTasks(content) {
        const lines = content.split('\n');
        // Find ## Tasks section bounds.
        let tasksStart = -1;
        let tasksEnd = lines.length; // exclusive
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '## Tasks') {
                tasksStart = i + 1;
                break;
            }
        }
        if (tasksStart === -1) return [];
        for (let i = tasksStart; i < lines.length; i++) {
            if (/^## /.test(lines[i])) {
                tasksEnd = i;
                break;
            }
        }

        const blocks = [];
        let i = tasksStart;
        while (i < tasksEnd) {
            const line = lines[i];
            const isUnchecked = /^- \[ \] /.test(line);
            const isChecked = /^- \[x\] /i.test(line);
            if (isUnchecked) {
                const start = i;
                const topLine = line;
                const childLines = [];
                let j = i + 1;
                while (j < tasksEnd) {
                    const next = lines[j];
                    // Stop on next top-level task line (checked OR unchecked).
                    if (/^- \[(?: |x)\] /i.test(next)) break;
                    // Top-level non-task line at column 0 (no leading whitespace) AND non-blank
                    // terminates children.
                    if (next.length > 0 && !/^[ \t]/.test(next)) break;
                    childLines.push(next);
                    j++;
                }
                // Trim trailing blank child lines for cleanliness when appending later.
                while (childLines.length && childLines[childLines.length - 1].trim() === '') {
                    childLines.pop();
                }
                blocks.push({ topLine, childLines, startIdx: start, endIdx: start + childLines.length });
                i = start + 1 + childLines.length;
                continue;
            }
            if (isChecked) {
                // Skip the checked top line + its children.
                let j = i + 1;
                while (j < tasksEnd) {
                    const next = lines[j];
                    if (/^- \[(?: |x)\] /i.test(next)) break;
                    if (next.length > 0 && !/^[ \t]/.test(next)) break;
                    j++;
                }
                i = j;
                continue;
            }
            i++;
        }
        return blocks;
    }

    /**
     * applyMigration: produce { today, tomorrow } string pair after moving the
     * selected blocks from today to the end of tomorrow's ## Tasks section.
     *
     * - selectedIndices: array of block indices into parseTasks(today).
     * - Removes the (topLine + childLines) range from today's lines (using the
     *   startIdx/endIdx the parser returned).
     * - Appends each block's topLine + childLines to the end of tomorrow's
     *   ## Tasks section (immediately before the next `## ` heading or EOF).
     * - Tomorrow MUST contain a `## Tasks` heading. If absent, returns tomorrow
     *   unchanged (caller should have created it from template first).
     */
    static applyMigration(todayContent, tomorrowContent, selectedIndices) {
        const blocks = ToDoMigrateModal.parseTasks(todayContent);
        const indices = [...selectedIndices].sort((a, b) => a - b);
        // 1) Strip selected blocks from today (back-to-front so indices stay valid).
        const todayLines = todayContent.split('\n');
        const toRemove = new Set();
        for (const idx of indices) {
            const b = blocks[idx];
            if (!b) continue;
            for (let k = b.startIdx; k <= b.endIdx; k++) toRemove.add(k);
        }
        const todayKept = todayLines.filter((_, i) => !toRemove.has(i));
        const todayOut = todayKept.join('\n');

        // 2) Append selected blocks to end of tomorrow's ## Tasks section.
        const tomorrowLines = tomorrowContent.split('\n');
        let tasksStart = -1;
        let tasksEnd = tomorrowLines.length;
        for (let i = 0; i < tomorrowLines.length; i++) {
            if (tomorrowLines[i].trim() === '## Tasks') {
                tasksStart = i + 1;
                break;
            }
        }
        if (tasksStart === -1) {
            return { today: todayOut, tomorrow: tomorrowContent };
        }
        for (let i = tasksStart; i < tomorrowLines.length; i++) {
            if (/^## /.test(tomorrowLines[i])) {
                tasksEnd = i;
                break;
            }
        }
        // Insertion point: just before tasksEnd, but skip trailing blank lines
        // that immediately precede the next heading, so appended tasks attach
        // cleanly to the task list.
        let insertAt = tasksEnd;
        while (insertAt > tasksStart && tomorrowLines[insertAt - 1].trim() === '') {
            insertAt--;
        }
        const appended = [];
        for (const idx of indices) {
            const b = blocks[idx];
            if (!b) continue;
            appended.push(b.topLine, ...b.childLines);
        }
        const before = tomorrowLines.slice(0, insertAt);
        const after = tomorrowLines.slice(insertAt);
        const tomorrowOut = [...before, ...appended, ...after].join('\n');

        return { today: todayOut, tomorrow: tomorrowOut };
    }

    // ---------- Instance methods (browser/Obsidian-side; opaque to Node harness) ----------

    async open() {
        const active = app.workspace.getActiveFile();
        if (!active || !/^ToDo-\d{4}-\d{2}-\d{2}$/.test(active.basename)) {
            new Notice("Open today's to-do note first.");
            return;
        }
        let content;
        try {
            content = await app.vault.read(active);
        } catch (e) {
            new Notice(`Cannot read ${active.path}: ${e.message}`, 8000);
            return;
        }
        const blocks = ToDoMigrateModal.parseTasks(content);
        // Tomorrow date (one day after today's filename, not "today" wallclock).
        const todayStr = active.basename.replace(/^ToDo-/, '');
        const tomorrow = window.moment(todayStr, 'YYYY-MM-DD').add(1, 'day');
        const tomorrowStr = tomorrow.format('YYYY-MM-DD');

        this._renderOverlay({
            sourceFile: active,
            sourceContent: content,
            blocks,
            tomorrowStr,
            tomorrowMoment: tomorrow,
        });
    }

    _renderOverlay({ sourceFile, sourceContent, blocks, tomorrowStr, tomorrowMoment }) {
        // Remove any prior overlay (defensive against rapid re-opens).
        const prior = document.body.querySelector('.sauce-todo-migrate-overlay');
        if (prior) prior.remove();

        const overlay = document.createElement('div');
        overlay.className = 'sauce-todo-migrate-overlay';
        overlay.style.cssText = [
            'position: fixed', 'inset: 0', 'background: rgba(0,0,0,0.5)',
            'display: flex', 'align-items: center', 'justify-content: center',
            'z-index: 9999',
        ].join(';');

        const modal = document.createElement('div');
        modal.style.cssText = [
            'background: var(--background-primary, #fff)',
            'color: var(--text-normal, #222)',
            'border-radius: 8px',
            'padding: 16px 20px',
            'min-width: 420px',
            'max-width: 640px',
            'max-height: 80vh',
            'display: flex',
            'flex-direction: column',
            'gap: 12px',
            'box-shadow: 0 8px 32px rgba(0,0,0,0.3)',
        ].join(';');

        const header = document.createElement('h3');
        header.textContent = `Migrate to-dos to ${tomorrowStr}`;
        header.style.cssText = 'margin: 0; font-size: 1.1em;';
        modal.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;';

        if (blocks.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'Nothing to migrate. No unchecked tasks on this note.';
            empty.style.cssText = 'color: var(--text-muted, #888); font-style: italic;';
            body.appendChild(empty);
        } else {
            blocks.forEach((b, idx) => {
                const row = document.createElement('label');
                row.style.cssText = 'display: flex; gap: 8px; padding: 4px 0; cursor: pointer; align-items: flex-start;';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = String(idx);
                cb.dataset.blockIdx = String(idx);
                cb.style.cssText = 'margin-top: 4px;';
                row.appendChild(cb);
                const textCol = document.createElement('div');
                textCol.style.cssText = 'flex: 1;';
                const top = document.createElement('div');
                top.textContent = b.topLine.replace(/^- \[ \] /, '');
                textCol.appendChild(top);
                if (b.childLines.length) {
                    const childPreview = document.createElement('div');
                    childPreview.textContent = b.childLines.join('\n');
                    childPreview.style.cssText = 'color: var(--text-muted, #888); font-size: 0.85em; white-space: pre-wrap; margin-top: 2px;';
                    textCol.appendChild(childPreview);
                }
                row.appendChild(textCol);
                body.appendChild(row);
            });
        }
        modal.appendChild(body);

        const footer = document.createElement('div');
        footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => overlay.remove();
        const migrateBtn = document.createElement('button');
        migrateBtn.textContent = blocks.length ? 'Migrate 0 tasks' : 'Migrate';
        migrateBtn.disabled = true;
        migrateBtn.classList.add('mod-cta');
        footer.appendChild(cancelBtn);
        footer.appendChild(migrateBtn);
        modal.appendChild(footer);

        // Wire checkbox change -> live update button label + disabled state.
        body.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const selected = Array.from(body.querySelectorAll('input[type="checkbox"]:checked'));
                migrateBtn.textContent = selected.length === 1 ? 'Migrate 1 task' : `Migrate ${selected.length} tasks`;
                migrateBtn.disabled = selected.length === 0;
            });
        });

        migrateBtn.addEventListener('click', async () => {
            migrateBtn.disabled = true;
            const original = migrateBtn.textContent;
            migrateBtn.textContent = 'Migrating…';
            try {
                const selected = Array.from(body.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(c => parseInt(c.dataset.blockIdx, 10));
                await this._submit({ sourceFile, blocks, selected, tomorrowStr, tomorrowMoment });
                overlay.remove();
            } catch (e) {
                new Notice(`Migration failed: ${e.message || String(e)}`, 8000);
                console.error('[ToDoMigrateModal] submit error', e);
                migrateBtn.textContent = original;
                migrateBtn.disabled = false;
            }
        });

        // Esc to dismiss.
        overlay.tabIndex = -1;
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
            }
        });
        // Outside-click dismiss.
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        // Focus first checkbox so Space-toggles work immediately.
        const firstCb = body.querySelector('input[type="checkbox"]');
        if (firstCb) firstCb.focus();
        else cancelBtn.focus();
    }

    async _submit({ sourceFile, blocks, selected, tomorrowStr, tomorrowMoment }) {
        if (!selected.length) return;
        // Re-read today (handles concurrent edits between modal-open and submit).
        const fresh = await app.vault.read(sourceFile);
        const freshBlocks = ToDoMigrateModal.parseTasks(fresh);

        // Match modal-time blocks to fresh-blocks by top-line exact string.
        // For each selected modal-block, find first fresh-block with same topLine
        // that hasn't been matched yet.
        const claimed = new Set();
        const matched = [];
        const unmatched = [];
        for (const idx of selected) {
            const mb = blocks[idx];
            const found = freshBlocks.findIndex((fb, i) => !claimed.has(i) && fb.topLine === mb.topLine);
            if (found >= 0) {
                claimed.add(found);
                matched.push(found);
            } else {
                unmatched.push(mb.topLine.replace(/^- \[ \] /, ''));
            }
        }
        if (!matched.length) {
            new Notice('Migration skipped: none of the selected tasks could be matched (note was edited).', 8000);
            return;
        }

        // Compute tomorrow's path.
        const tomorrowFolder = `spice/to-do/${tomorrowMoment.format('YYYY/MM-MMMM')}`;
        const tomorrowPath = `${tomorrowFolder}/ToDo-${tomorrowStr}.md`;
        let tomorrowFile = app.vault.getAbstractFileByPath(tomorrowPath);
        if (!tomorrowFile) {
            // Ensure folder exists.
            await this._ensureFolder(tomorrowFolder);
            const body = this._renderTomorrowTemplate(tomorrowMoment);
            tomorrowFile = await app.vault.create(tomorrowPath, body);
        }

        const tomorrowContent = await app.vault.read(tomorrowFile);
        const { today: newToday, tomorrow: newTomorrow } = ToDoMigrateModal.applyMigration(fresh, tomorrowContent, matched);

        await app.vault.modify(sourceFile, newToday);
        await app.vault.modify(tomorrowFile, newTomorrow);

        const total = selected.length;
        const moved = matched.length;
        const msg = unmatched.length === 0
            ? `Migrated ${moved} task(s) to ToDo-${tomorrowStr}.`
            : `Migrated ${moved} of ${total}; ${unmatched.length} could not be matched (note may have been edited).`;
        new Notice(msg);

        // Open tomorrow's note in the workspace so the user immediately sees the result.
        // Without this, the user has to manually navigate to spice/to-do/<YYYY>/<MM-MMMM>/
        // to find the newly-created or newly-updated file — confusing on first encounter.
        try {
            await app.workspace.openLinkText(tomorrowFile.path, '');
        } catch (e) {
            console.warn('[ToDoMigrateModal] could not open tomorrow note', e);
        }
    }

    async _ensureFolder(folder) {
        const exists = await app.vault.adapter.exists(folder);
        if (!exists) {
            try {
                await app.vault.createFolder(folder);
            } catch (e) {
                // May race with concurrent createFolder; ignore "already exists" errors.
                if (!/already exists/i.test(String(e))) throw e;
            }
        }
    }

    /**
     * Renders the tomorrow-note body inline (NOT via Templater). Duplicates the
     * Today To-Do.md template's stable body — see FLN-todo-1 in the design doc.
     * The vault_identity_tag substitution is read from a vault-level config; we
     * don't have access to install-time variables here, so we infer the tag from
     * the active file's frontmatter when present, else omit the tag.
     */
    _renderTomorrowTemplate(tomorrowMoment) {
        const iso = tomorrowMoment.format('YYYY-MM-DDT00:00:00ZZ').replace(/ZZ$/, '+00:00');
        const lines = [];
        lines.push('---');
        lines.push('type: to-do');
        lines.push(`created_at: "${iso}"`);
        // Best-effort: copy tags from today's note if it has any frontmatter tags.
        const active = app.workspace.getActiveFile();
        const cache = active ? app.metadataCache.getFileCache(active) : null;
        const tags = cache?.frontmatter?.tags;
        if (Array.isArray(tags) && tags.length) {
            lines.push('tags:');
            tags.forEach(t => lines.push(`  - "${t}"`));
        }
        lines.push('cssclasses:');
        lines.push('  - wide');
        lines.push('---');
        lines.push('');
        lines.push('```dataviewjs');
        lines.push('await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });');
        lines.push('```');
        lines.push('');
        lines.push('```dataviewjs');
        lines.push('await dv.view("ranch/views/customjs-guard", { class: "ToDoLeafActions" });');
        lines.push('```');
        lines.push('');
        lines.push('## Tasks');
        lines.push('');
        lines.push('- [ ]');
        lines.push('');
        lines.push('## Notes');
        lines.push('');
        return lines.join('\n');
    }
}
