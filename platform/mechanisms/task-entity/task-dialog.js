/**
 * TaskDialog (CustomJS) — the create/edit/done/delete dialog for a task note.
 *
 * Companion to TaskEntity (the pure note-per-task core). This class owns the
 * BROWSER-side gestures — but every gesture writes EXACTLY ONE file: the task's
 * own `spice/tasks/task-<id>.md`. It NEVER reads or rewrites any surface note
 * (daily / project / meeting); surfaces live-query the task notes instead. That
 * one-file invariant is the whole point of the redesign: a bad write on mobile
 * can only ever touch one task's file, never wipe a whole day's list.
 *
 * SAFE single-file primitives (no read+rewrite of the whole file, ever):
 *   - create → app.vault.create(path, content)                (one NEW file)
 *   - edit   → app.fileManager.processFrontMatter(file, mut)  (that file's FM only)
 *   - done   → processFrontMatter(status=done, completed_at) + renameFile → _done/
 *   - delete → processFrontMatter(status=deleted)            + renameFile → _trash/
 * `_done/` / `_trash/` folders are created on demand (createFolder guarded in a
 * try/catch — it throws if the folder already exists).
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate (run-customjs-loadable.js) does. To Node-test
 * the statics, load via `new Function(src + "; return TaskDialog;")()`.
 *
 * Static API (Node-testable, pure):
 *   TaskDialog.defaultsForSurface({surface, today, project, sourceNote}) → {...}
 *   TaskDialog.trashPath(path) → path under spice/tasks/_trash/
 *   TaskDialog.donePath(path)  → path under spice/tasks/_done/
 *
 * Instance API (browser-side):
 *   TaskDialog.open({ edit?, surface?, today?, project?, sourceNote? })
 */
class TaskDialog {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.TaskDialog, and any
    // cross-class consumer (surface buttons wired in a later task) reaches these
    // via that instance. A static-only declaration is not on the prototype → the
    // call throws at runtime. Each instance method precedes its static in source
    // order (mirrors TaskEntity / ToDoCreateTask posture).

    defaultsForSurface(opts) { return TaskDialog.defaultsForSurface(opts); }
    trashPath(path) { return TaskDialog.trashPath(path); }
    donePath(path) { return TaskDialog.donePath(path); }
    _loadProjectList(app) { return TaskDialog._loadProjectList(app); }

    // ---------- Static pure helpers ----------

    /**
     * Seed a create form from the surface that opened the dialog.
     *   daily   → { scheduled: today, source: "daily" }
     *   project → { project, source: "project" }        (NO scheduled)
     *   meeting → { source_note, project, source: "meeting" }
     *   manual / absent → { source: "manual" }
     * Only keys with a meaningful value are emitted (no empty scaffolding), so a
     * deep-equal against the minimal expected object holds.
     */
    static defaultsForSurface(opts) {
        const o = opts || {};
        switch (o.surface) {
            case 'daily':
                return { scheduled: o.today || '', source: 'daily' };
            case 'project':
                return { project: o.project, source: 'project' };
            case 'meeting': {
                const out = { source: 'meeting' };
                if (o.sourceNote != null) out.source_note = o.sourceNote;
                if (o.project != null) out.project = o.project;
                return out;
            }
            case 'manual':
            default:
                return { source: 'manual' };
        }
    }

    /**
     * Rewrite the `spice/tasks/` prefix of a task path into `spice/tasks/_trash/`,
     * keeping the filename. e.g. "spice/tasks/task-a.md" → "spice/tasks/_trash/task-a.md".
     * A path not under spice/tasks/ is returned unchanged.
     */
    static trashPath(path) {
        return TaskDialog._rebase(path, '_trash');
    }

    /**
     * Rewrite the `spice/tasks/` prefix of a task path into `spice/tasks/_done/`.
     * e.g. "spice/tasks/task-a.md" → "spice/tasks/_done/task-a.md".
     */
    static donePath(path) {
        return TaskDialog._rebase(path, '_done');
    }

    /** Shared prefix-rewriter for donePath / trashPath. */
    static _rebase(path, sub) {
        const p = String(path == null ? '' : path);
        const PREFIX = 'spice/tasks/';
        if (p.indexOf(PREFIX) !== 0) return p;
        return PREFIX + sub + '/' + p.slice(PREFIX.length);
    }

    /**
     * Slugify a project name the same way the rest of the platform does
     * (lowercase, runs of non-alphanumerics → single dash, trimmed). Used when a
     * free-text project name is typed in the create form so composeNote gets a
     * { name, slug } pair.
     */
    static _slugify(name) {
        return String(name == null ? '' : name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Enumerate the vault's projects (for the create/edit dialog's project
     * dropdown) dependency-free via metadataCache — TaskDialog is button-invoked
     * so there's no `dv` to query. Scans markdown files under spice/projects/
     * whose frontmatter `type === 'project'`, reading `{ name, slug }` (falling
     * back to basename / slugified name). Deduped by slug, sorted by name. Never
     * throws — a missing app / cache just yields [].
     */
    static _loadProjectList(app) {
        const out = [];
        try {
            const files = app.vault.getMarkdownFiles();
            for (const f of files) {
                if (f.path.indexOf('spice/projects/') !== 0) continue;
                const fm = app.metadataCache.getFileCache(f) && app.metadataCache.getFileCache(f).frontmatter;
                if (fm && fm.type === 'project') {
                    const name = fm.name || f.basename;
                    const slug = fm.slug || TaskDialog._slugify(name);
                    out.push({ name: String(name), slug: String(slug) });
                }
            }
        } catch (_e) {}
        // dedupe by slug, sort by name
        const seen = {}; const uniq = [];
        for (const p of out) { if (!seen[p.slug]) { seen[p.slug] = 1; uniq.push(p); } }
        uniq.sort((a, b) => a.name.localeCompare(b.name));
        return uniq;
    }

    /**
     * Render a { path, frontmatter, body } note (from TaskEntity.composeNote)
     * into the full file string. Frontmatter values are single-line and quoted
     * when they contain a YAML-hostile character (`[`, `]`, `:`, `#`, `"`, or a
     * leading space) so wikilinks (`[[Sauce]]`) and ISO timestamps (which contain
     * `:`) round-trip. Empty values emit a bare `key:` (matches the schema's
     * empty-string-not-omitted convention). Deterministic — pure string work.
     */
    static renderNote(frontmatter, body) {
        const fm = frontmatter || {};
        const lines = ['---'];
        for (const key of Object.keys(fm)) {
            const raw = fm[key];
            const val = raw == null ? '' : String(raw);
            if (val === '') { lines.push(key + ':'); continue; }
            lines.push(key + ': ' + TaskDialog._yamlScalar(val));
        }
        lines.push('---');
        const b = body == null ? '' : String(body);
        return lines.join('\n') + '\n' + (b ? b + '\n' : '');
    }

    /** Quote a scalar iff it contains a YAML-hostile char or a leading space. */
    static _yamlScalar(val) {
        const s = String(val);
        if (/[[\]:#"]|^\s/.test(s)) {
            return '"' + s.replace(/"/g, '\\"') + '"';
        }
        return s;
    }

    // ---------- Instance / browser API ----------

    /**
     * Open the create/edit dialog. opts:
     *   { edit?, surface?, today?, project?, sourceNote? }
     * `edit` is a task-file path string (edit mode); absent = create mode.
     * Fully guarded so it never throws on cold-load — window.customJS may not be
     * ready when a stale render fires, and a throw here would abort the render.
     */
    open(opts) {
        try {
            this._render(opts || {});
        } catch (e) {
            try { new Notice('TaskDialog error: ' + (e && (e.message || e)), 6000); } catch (_e) { /* no Notice in test/CLI */ }
        }
    }

    /**
     * Complete a task by PATH (no dialog). Resolves app + the task file from the
     * path, then routes through the SAME single-file _markDone internal that the
     * edit-dialog's Done button uses (status=done + completed_at, then move to
     * spice/tasks/_done/). Consumed by surface widgets (TaskTodayList's row
     * checkbox) so a one-tap complete never opens the modal. Returns
     * { ok: true } on success or { ok: false, reason } so the caller can revert
     * its optimistic UI. Never throws.
     */
    async markDone(path) {
        try {
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            await this._markDone(app, file);
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        }
    }

    /**
     * Recoverable-delete a task by PATH (no dialog). Routes through the SAME
     * single-file _markDeleted internal that the edit-dialog's Delete button
     * uses (status=deleted, then move to spice/tasks/_trash/). Returns
     * { ok: true } / { ok: false, reason }. Never throws.
     */
    async markDeleted(path) {
        try {
            const { app, file } = this._resolveFile(path);
            if (!app) return { ok: false, reason: 'app unavailable' };
            if (!file) return { ok: false, reason: 'task file not found' };
            await this._markDeleted(app, file);
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: (e && (e.message || String(e))) || 'unknown' };
        }
    }

    /** Resolve { app, file } from a vault-relative task path (browser-side). */
    _resolveFile(path) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        const file = (app && app.vault && typeof app.vault.getAbstractFileByPath === 'function')
            ? app.vault.getAbstractFileByPath(String(path == null ? '' : path))
            : null;
        return { app: app, file: file };
    }

    _render(opts) {
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app);
        if (!app) { try { new Notice('TaskDialog: app unavailable'); } catch (_e) {} return; }

        // Resolve edit-mode target + hydrate state from its frontmatter.
        const editPath = typeof opts.edit === 'string' ? opts.edit : null;
        let editFile = null;
        let fm = null;
        if (editPath) {
            editFile = app.vault && app.vault.getAbstractFileByPath ? app.vault.getAbstractFileByPath(editPath) : null;
            if (editFile && app.metadataCache && app.metadataCache.getFileCache) {
                const cache = app.metadataCache.getFileCache(editFile);
                fm = (cache && cache.frontmatter) || null;
            }
        }

        const defaults = editPath ? {} : TaskDialog.defaultsForSurface(opts);
        const state = {
            title: fm ? (fm.title || '') : '',
            scheduled: fm ? (fm.scheduled || '') : (defaults.scheduled || ''),
            due: fm ? (fm.due || '') : '',
            priority: fm ? (fm.priority || '') : (defaults.priority || ''),
            // project as a display name (strip [[ ]] if present)
            projectName: fm ? TaskDialog._stripWikilink(fm.project) : (defaults.project && defaults.project.name) || '',
            notes: '',
            // carry create-only seeds forward into the payload
            source: fm ? (fm.source || '') : (defaults.source || 'manual'),
            source_note: fm ? (fm.source_note || '') : (defaults.source_note || ''),
        };

        // ----- Overlay scaffolding (reuses ToDoCreateTask's mobile-capable DOM) -----
        const prior = document.querySelector('.sauce-todo-create-overlay');
        if (prior) prior.remove();

        const overlay = document.body.createDiv({ cls: 'sauce-todo-create-overlay' });
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,0.55);
            display: flex; align-items: center; justify-content: center; z-index: 9999;
        `;
        const modal = overlay.createDiv();
        modal.style.cssText = `
            background: var(--background-primary, #1c1c1c);
            color: var(--text-normal, #ddd);
            border: 1px solid var(--background-modifier-border, #444);
            border-radius: 10px; padding: 18px 20px; box-sizing: border-box;
            width: min(440px, 92vw); max-height: 80vh; overflow-y: auto; overflow-x: hidden;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        `;
        const closeOverlay = () => {
            try { document.removeEventListener('keydown', escListener); } catch (_e) {}
            overlay.remove();
        };
        overlay.onclick = (e) => { if (e.target === overlay) closeOverlay(); };
        const escListener = (ev) => { if (ev.key === 'Escape') closeOverlay(); };
        document.addEventListener('keydown', escListener);

        const heading = modal.createEl('h3', { text: editPath ? 'Edit Task' : '+ New Task' });
        heading.style.cssText = 'margin: 0 0 14px;';

        const host = modal.createDiv();
        const fieldCss = 'width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:4px; color:var(--text-normal,#ddd);';
        const label = (text) => {
            const el = host.createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted, #999); margin-top:10px; margin-bottom:4px;';
            return el;
        };

        // Title
        label('Title');
        const titleInput = host.createEl('input', { type: 'text' });
        titleInput.style.cssText = fieldCss;
        titleInput.value = state.title;
        titleInput.oninput = () => { state.title = titleInput.value; updateSubmit(); };
        setTimeout(() => titleInput.focus(), 50);

        // Scheduled
        label('Scheduled (optional)');
        const schedInput = host.createEl('input', { type: 'date' });
        schedInput.style.cssText = fieldCss;
        schedInput.value = state.scheduled;
        schedInput.onchange = () => { state.scheduled = schedInput.value; updateSubmit(); };

        // Due
        label('Due (optional)');
        const dueInput = host.createEl('input', { type: 'date' });
        dueInput.style.cssText = fieldCss;
        dueInput.value = state.due;
        dueInput.onchange = () => { state.due = dueInput.value; updateSubmit(); };

        // Priority chip row
        label('Priority');
        const chipRow = host.createDiv();
        chipRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;';
        for (const p of ['', 'low', 'medium', 'high', 'highest']) {
            const c = chipRow.createEl('div', { text: p || 'none' });
            c.style.cssText = 'flex:1; min-width:0; box-sizing:border-box; text-align:center; padding:4px 6px; border:1px solid var(--background-modifier-border,#444); border-radius:4px; font-size:11px; cursor:pointer;';
            if (state.priority === p) c.style.background = 'var(--interactive-accent, #6a6abf)';
            c.onclick = () => {
                state.priority = p;
                for (const cc of chipRow.children) cc.style.background = '';
                c.style.background = 'var(--interactive-accent, #6a6abf)';
            };
        }

        // Project — dropdown of the vault's projects (restored parity with the old
        // ToDoCreateTask picker). Enumerated dependency-free via metadataCache
        // (no `dv` in a button-invoked dialog). First option is "— none —"; a
        // seeded/edited project not in the list is preserved via a temp option so
        // it's never silently lost.
        label('Project (optional)');
        const projSelect = host.createEl('select');
        projSelect.style.cssText = fieldCss;
        const projects = TaskDialog._loadProjectList(app);
        const noneOpt = projSelect.createEl('option', { text: '— none —' });
        noneOpt.value = '';
        const curName = (state.projectName || '').trim();
        let matched = !curName; // "none" pre-selected when there's no current project
        for (const p of projects) {
            const opt = projSelect.createEl('option', { text: p.name });
            opt.value = p.slug;
            if (curName && p.name === curName) { opt.selected = true; matched = true; }
        }
        // Preserve a seeded/edited project that isn't in the enumerated list.
        if (!matched && curName) {
            const tmp = projSelect.createEl('option', { text: curName });
            tmp.value = TaskDialog._slugify(curName);
            tmp.selected = true;
        }
        projSelect.onchange = () => {
            const opt = projSelect.options[projSelect.selectedIndex];
            state.projectName = (opt && opt.value) ? opt.text : '';
        };

        // Notes → note body (both modes). In edit mode we load the task file's
        // existing body (minus its frontmatter) just-in-time so notes/hyperlinks
        // can be added or edited on an existing task; the save path writes them
        // back into the task's OWN file only (single-file invariant intact).
        label('Notes (optional)');
        const notesInput = host.createEl('textarea');
        notesInput.style.cssText = fieldCss + ' min-height:60px; resize:vertical;';
        notesInput.value = state.notes;
        notesInput.oninput = () => { state.notes = notesInput.value; };
        if (editPath && editFile && app.vault && typeof app.vault.read === 'function') {
            app.vault.read(editFile).then((txt) => {
                const body = TaskDialog._stripFrontmatter(txt);
                notesInput.value = body;
                state.notes = body;
            }).catch(() => { /* leave notes blank on read failure */ });
        }

        // ----- Footer -----
        const footer = host.createDiv();
        footer.style.cssText = 'margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border,#333); display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap;';

        const btnCss = (accent) => accent
            ? 'padding:6px 14px; border-radius:4px; border:1px solid var(--interactive-accent,#6a6abf); background:var(--interactive-accent,#6a6abf); color:white; cursor:pointer;'
            : 'padding:6px 14px; border-radius:4px; border:1px solid var(--background-modifier-border,#444); background:var(--background-secondary,#2a2a2a); color:var(--text-normal,#ddd); cursor:pointer;';

        // Open note + Done + Delete (edit mode only) sit on the LEFT.
        if (editPath) {
            const openBtn = footer.createEl('button', { text: 'Open note' });
            openBtn.style.cssText = btnCss(false);
            openBtn.onclick = async () => {
                try {
                    if (app.workspace && typeof app.workspace.getLeaf === 'function' && editFile) {
                        await app.workspace.getLeaf(false).openFile(editFile);
                    } else if (app.workspace && typeof app.workspace.openLinkText === 'function') {
                        await app.workspace.openLinkText(editPath, '', false);
                    }
                    closeOverlay();
                } catch (e) { try { new Notice('Could not open note: ' + (e && (e.message || e)), 6000); } catch (_e) {} }
            };
            const doneBtn = footer.createEl('button', { text: '✓ Done' });
            doneBtn.style.cssText = btnCss(false);
            doneBtn.onclick = async () => {
                try { await this._markDone(app, editFile); closeOverlay(); }
                catch (e) { try { new Notice('Done failed: ' + (e.message || e), 6000); } catch (_e) {} }
            };
            const delBtn = footer.createEl('button', { text: '🗑 Delete' });
            delBtn.style.cssText = btnCss(false);
            delBtn.onclick = async () => {
                try { await this._markDeleted(app, editFile); closeOverlay(); }
                catch (e) { try { new Notice('Delete failed: ' + (e.message || e), 6000); } catch (_e) {} }
            };
            const spacer = footer.createDiv();
            spacer.style.cssText = 'flex:1;';
        }

        const cancelBtn = footer.createEl('button', { text: 'Cancel' });
        cancelBtn.style.cssText = btnCss(false);
        cancelBtn.onclick = () => closeOverlay();

        const saveBtn = footer.createEl('button', { text: 'Save' });
        saveBtn.classList.add('mod-cta');
        saveBtn.style.cssText = btnCss(true);
        const buildPayload = () => this._payloadFromState(state);
        const updateSubmit = () => {
            const TE = TaskDialog._taskEntity();
            const v = TE ? TE.validatePayload(buildPayload()) : { valid: !!(state.title && state.title.trim()) };
            saveBtn.disabled = !v.valid;
        };
        saveBtn.onclick = async () => {
            try {
                if (editPath) await this._saveEdit(app, editFile, buildPayload(), state.notes);
                else await this._create(app, buildPayload(), state.notes);
                closeOverlay();
            } catch (e) {
                try { new Notice('Save failed: ' + (e.message || e), 6000); } catch (_e) {}
            }
        };

        // Enter-in-Title submits (mirrors ToDoCreateTask). Ignore IME composition.
        titleInput.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || ev.isComposing) return;
            ev.preventDefault();
            if (!saveBtn.disabled) saveBtn.click();
        });

        updateSubmit();
    }

    // Build a TaskEntity-shaped payload from the current form state.
    _payloadFromState(state) {
        const payload = {
            title: state.title,
            scheduled: state.scheduled || '',
            due: state.due || '',
            priority: state.priority || '',
            source: state.source || 'manual',
            source_note: state.source_note || '',
        };
        const name = (state.projectName || '').trim();
        if (name) payload.project = { name, slug: TaskDialog._slugify(name) };
        return payload;
    }

    /**
     * CREATE — write ONE new file. Compose via TaskEntity, validate, render the
     * note string (with the typed notes as the body), ensure spice/tasks/ exists,
     * then app.vault.create. Never touches any other note.
     */
    async _create(app, payload, notes) {
        const TE = TaskDialog._taskEntity();
        if (!TE) { try { new Notice('task-entity mechanism not loaded'); } catch (_e) {} return; }
        // Stamp a moment so composeNote can derive the filename + created_at.
        const moment = (typeof window !== 'undefined' && window.moment) ? window.moment() : null;
        const payloadWithMoment = Object.assign({}, payload, { moment });
        const v = TE.validatePayload(payloadWithMoment);
        if (!v.valid) { try { new Notice('Invalid task: ' + v.reason); } catch (_e) {} return; }
        const { path, frontmatter, body } = TE.composeNote(payloadWithMoment);
        const content = TaskDialog.renderNote(frontmatter, notes || body || '');
        await this._ensureFolder(app, 'spice/tasks');
        await app.vault.create(path, content);
        try { new Notice('Task created'); } catch (_e) {}
    }

    /**
     * EDIT/SAVE — mutate ONLY this file's frontmatter via processFrontMatter,
     * then (if notes were edited) swap ONLY this file's body via vault.process.
     * Both writes touch the task's OWN file only — never a surface note — so the
     * single-file-write invariant holds. The body write is guarded so a vault
     * without vault.process still saves the frontmatter.
     */
    async _saveEdit(app, file, payload, notes) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        const TE = TaskDialog._taskEntity();
        const v = TE ? TE.validatePayload(payload) : { valid: !!(payload.title && String(payload.title).trim()) };
        if (!v.valid) { try { new Notice('Invalid task: ' + v.reason); } catch (_e) {} return; }
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.title = payload.title;
            fm.scheduled = payload.scheduled || '';
            fm.due = payload.due || '';
            fm.priority = payload.priority || '';
            if (payload.project && payload.project.name) {
                fm.project = '[[' + payload.project.name + ']]';
                fm.project_slug = payload.project.slug || TaskDialog._slugify(payload.project.name);
            } else {
                fm.project = '';
                fm.project_slug = '';
            }
        });
        // Persist the Notes body back into THIS file only. Prefer vault.process
        // (atomic read-modify-write of the single file); fall back to read+modify.
        if (notes != null) {
            const body = String(notes);
            try {
                if (app.vault && typeof app.vault.process === 'function') {
                    await app.vault.process(file, (data) => TaskDialog._replaceBody(data, body));
                } else if (app.vault && typeof app.vault.read === 'function' && typeof app.vault.modify === 'function') {
                    const data = await app.vault.read(file);
                    await app.vault.modify(file, TaskDialog._replaceBody(data, body));
                }
            } catch (_e) { /* frontmatter already saved; body write best-effort */ }
        }
        try { new Notice('Task saved'); } catch (_e) {}
    }

    /**
     * DONE — set status=done + completed_at (processFrontMatter, this file only),
     * then move the file into spice/tasks/_done/ (renameFile). No other note read.
     */
    async _markDone(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        const iso = (typeof window !== 'undefined' && window.moment)
            ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ')
            : new Date().toISOString();
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.status = 'done';
            fm.completed_at = iso;
        });
        await this._ensureFolder(app, 'spice/tasks/_done');
        await app.fileManager.renameFile(file, TaskDialog.donePath(file.path));
        try { new Notice('Task done'); } catch (_e) {}
    }

    /**
     * DELETE (recoverable) — set status=deleted (processFrontMatter, this file
     * only), then move into spice/tasks/_trash/ (renameFile). No hard delete; the
     * note is recoverable. No other note read.
     */
    async _markDeleted(app, file) {
        if (!file) { try { new Notice('TaskDialog: task file not found'); } catch (_e) {} return; }
        await app.fileManager.processFrontMatter(file, (fm) => {
            fm.status = 'deleted';
        });
        await this._ensureFolder(app, 'spice/tasks/_trash');
        await app.fileManager.renameFile(file, TaskDialog.trashPath(file.path));
        try { new Notice('Task deleted'); } catch (_e) {}
    }

    /**
     * Ensure a folder exists. createFolder throws when the folder already exists,
     * so the throw is swallowed — the folder existing is the success case.
     */
    async _ensureFolder(app, folder) {
        try {
            if (app.vault && typeof app.vault.getAbstractFileByPath === 'function'
                && app.vault.getAbstractFileByPath(folder)) return;
            await app.vault.createFolder(folder);
        } catch (_e) { /* already exists — createFolder throws in that case */ }
    }

    /** Reach the stored TaskEntity instance (customJS), or null on cold-load. */
    static _taskEntity() {
        try {
            return (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null;
        } catch (_e) {
            return null;
        }
    }

    /** Strip surrounding `[[ ]]` from a wikilink for display in the edit form. */
    static _stripWikilink(v) {
        const s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]+)\]\]$/.exec(s);
        return m ? m[1] : s;
    }

    /**
     * Remove a leading `---\n...\n---\n` frontmatter block from a file's text,
     * returning just the body (for populating the Notes textarea in edit mode). A
     * file with no leading frontmatter block is returned unchanged.
     */
    static _stripFrontmatter(txt) {
        const s = String(txt == null ? '' : txt);
        const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(s);
        return m ? s.slice(m[0].length) : s;
    }

    /**
     * Swap the body of a task file's text while preserving its leading
     * frontmatter block verbatim. Keeps everything through the closing `---`
     * line, then appends `\n` + newBody. A file with no leading frontmatter is
     * treated as all-body. Pure string work — used by _saveEdit to persist the
     * Notes textarea back into the task's OWN file only.
     */
    static _replaceBody(fileText, newBody) {
        const s = String(fileText == null ? '' : fileText);
        const body = String(newBody == null ? '' : newBody);
        const m = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/.exec(s);
        const header = m ? m[1] : '';
        if (!header) return body ? body + (body.endsWith('\n') ? '' : '\n') : '';
        return header + '\n' + (body ? body + (body.endsWith('\n') ? '' : '\n') : '');
    }
}
