class TaskMove {

    // Moving tasks and notes without opening the edit dialog: make a task a
    // subtask of another, make a subtask top-level, move a task to a project
    // or trip, and move a note to another task. Every move is a gesture write
    // through RenderSafe.mutate; the writers themselves are shared with the
    // edit dialog (TaskDialog.reparent, TaskDialog.projectFields /
    // tripFields through setFields) and the Notes section (TaskDocs.moveTo).
    // The drag side (zones, highlights, the Make top-level strip) lives in
    // TaskTodayList; this class owns the ⋯ menu entries and the pickers,
    // which work on every device. Spec:
    // Docs/superpowers/specs/2026-11-13-task-flow-design.md, section 6.

    nest(fromPath, parent, opts) { return TaskMove.nest(fromPath, parent, opts); }
    setProject(path, project, opts) { return TaskMove.setProject(path, project, opts); }
    setTrip(path, trip, opts) { return TaskMove.setTrip(path, trip, opts); }
    moveNote(docPath, taskPath, opts) { return TaskMove.moveNote(docPath, taskPath, opts); }
    pickParent(path, opts) { return TaskMove.pickParent(path, opts); }
    pickProject(path, opts) { return TaskMove.pickProject(path, opts); }
    pickNoteTask(docPath, opts) { return TaskMove.pickNoteTask(docPath, opts); }
    menuEntries(task, opts) { return TaskMove.menuEntries(task, opts); }
    noteMenuEntries(doc, opts) { return TaskMove.noteMenuEntries(doc, opts); }
    noteTargets(app, currentTaskPath) { return TaskMove.noteTargets(app, currentTaskPath); }
    parentChoices(app, path, currentParent) { return TaskMove.parentChoices(app, path, currentParent); }
    refusalText(reason) { return TaskMove.refusalText(reason); }
    hasParent(task) { return TaskMove.hasParent(task); }

    static _cjs() {
        try { return (typeof window !== 'undefined' && window.customJS) || null; } catch (_e) { return null; }
    }

    static _app(opts) {
        if (opts && opts.app) return opts.app;
        try { return (typeof window !== 'undefined' && window.app) || null; } catch (_e) { return null; }
    }

    static _notice(msg, ms) {
        try {
            const N = (typeof Notice === 'function' && Notice) || (typeof window !== 'undefined' && window.Notice) || null;
            if (N) new N(msg, ms || 5000);
        } catch (_e) { /* a Notice never breaks a gesture */ }
    }

    static _base(path) {
        return String(path == null ? '' : path).split('/').pop().replace(/\.md$/i, '');
    }

    static _unlink(v) {
        let s = String(v == null ? '' : v).trim();
        const m = /^\[\[([^\]]*)\]\]$/.exec(s);
        if (m) s = m[1];
        const pipe = s.indexOf('|');
        if (pipe >= 0) s = s.slice(0, pipe);
        return TaskMove._base(s.trim());
    }

    /** True when the task has a parent: a parent_task link or a parent folder. */
    static hasParent(task) {
        if (!task) return false;
        if (String(task.parent_task == null ? '' : task.parent_task).trim()) return true;
        if (String(task.parent_path == null ? '' : task.parent_path).trim()) return true;
        const cjs = TaskMove._cjs();
        const TE = cjs && cjs.TaskEntity;
        try { return !!(TE && typeof TE.parentNotePathOf === 'function' && task.path && TE.parentNotePathOf(String(task.path))); } catch (_e) { return false; }
    }

    /** The words a refusal reason shows to the user. */
    static refusalText(reason) {
        const r = String(reason || '');
        if (/subtask of itself|own subtask/.test(r)) return "A task can't go inside itself or its own subtask";
        if (r === 'parent task not found') return "Couldn't find that task";
        if (r === 'task file not found') return "Couldn't find the task";
        return r;
    }

    /**
     * Put the task at `fromPath` under `parent` (a task note path, a
     * `[[link]]`, or null for the top level) through TaskDialog.reparent,
     * the move the edit dialog's Subtask of… field uses. A loop is refused
     * with a Notice before anything is written. opts: { app, optimistic(),
     * revert(), onDone(result) }. Resolves the reparent result, or
     * { ok: false, reason }.
     */
    static async nest(fromPath, parent, opts) {
        const o = opts || {};
        const cjs = TaskMove._cjs();
        const app = TaskMove._app(o);
        const TD = cjs && cjs.TaskDialog;
        const RenderSafe = cjs && cjs.RenderSafe;
        const top = parent == null || parent === '';
        if (!app || !TD || typeof TD.reparent !== 'function' || !RenderSafe || typeof RenderSafe.mutate !== 'function') {
            TaskMove._notice('Could not move the task right now');
            return { ok: false, reason: 'unavailable' };
        }
        const refusal = typeof TD.reparentRefusal === 'function' ? TD.reparentRefusal(app, fromPath, top ? null : parent) : '';
        if (refusal) {
            TaskMove._notice(TaskMove.refusalText(refusal));
            return { ok: false, reason: refusal };
        }
        let out = null;
        const res = await RenderSafe.mutate({
            app,
            path: String(fromPath),
            failureMessage: top ? 'Could not make the task top-level' : 'Could not move the task',
            optimistic: () => { if (typeof o.optimistic === 'function') o.optimistic(); },
            write: async () => {
                const r = await TD.reparent(app, fromPath, top ? null : parent);
                if (!r || r.ok !== true) throw new Error(TaskMove.refusalText((r && r.reason) || 'move failed'));
                out = r;
                return r;
            },
            revert: () => { if (typeof o.revert === 'function') o.revert(); },
        });
        if (!res || !res.ok) return { ok: false, reason: (res && res.error && res.error.message) || 'write failed' };
        if (out && out.due) TaskMove._notice('Top-level now, due ' + out.due + ' like its old parent');
        try { if (typeof o.onDone === 'function') o.onDone(out); } catch (_e) {}
        return out;
    }

    /** Set or clear the task's project with the dialog's writer (TaskDialog.projectFields). */
    static async setProject(path, project, opts) {
        const cjs = TaskMove._cjs();
        const TD = cjs && cjs.TaskDialog;
        if (!TD || typeof TD.projectFields !== 'function') { TaskMove._notice('Could not move the task right now'); return { ok: false, reason: 'unavailable' }; }
        return TaskMove._writeFields(path, TD.projectFields(project), project ? 'Could not move the task to the project' : 'Could not clear the project', opts);
    }

    /** Set or clear the task's trip with the dialog's writer (TaskDialog.tripFields). */
    static async setTrip(path, trip, opts) {
        const cjs = TaskMove._cjs();
        const TD = cjs && cjs.TaskDialog;
        if (!TD || typeof TD.tripFields !== 'function') { TaskMove._notice('Could not move the task right now'); return { ok: false, reason: 'unavailable' }; }
        return TaskMove._writeFields(path, TD.tripFields(trip), 'Could not move the task to the trip', opts);
    }

    static async _writeFields(path, fields, failureMessage, opts) {
        const o = opts || {};
        const cjs = TaskMove._cjs();
        const app = TaskMove._app(o);
        const RenderSafe = cjs && cjs.RenderSafe;
        const file = app && app.vault && typeof app.vault.getAbstractFileByPath === 'function'
            ? app.vault.getAbstractFileByPath(String(path)) : null;
        if (!file || !RenderSafe || typeof RenderSafe.mutate !== 'function') {
            TaskMove._notice(failureMessage);
            return { ok: false, reason: file ? 'unavailable' : 'task file not found' };
        }
        const res = await RenderSafe.mutate({
            app,
            path: String(path),
            failureMessage,
            optimistic: () => { if (typeof o.optimistic === 'function') o.optimistic(); },
            write: () => app.fileManager.processFrontMatter(file, (fm) => { Object.assign(fm, fields); }),
            revert: () => { if (typeof o.revert === 'function') o.revert(); },
        });
        if (!res || !res.ok) return { ok: false, reason: 'write failed' };
        const out = { ok: true, path: String(path), fields };
        try { if (typeof o.onDone === 'function') o.onDone(out); } catch (_e) {}
        return out;
    }

    /**
     * Move the note at `docPath` to the task at `taskPath` (TaskDocs.moveTo:
     * into that task's notes/, `task:` set, renamed by the usual rule).
     * opts: { app, onDone(result) }.
     */
    static async moveNote(docPath, taskPath, opts) {
        const o = opts || {};
        const cjs = TaskMove._cjs();
        const app = TaskMove._app(o);
        const Docs = cjs && cjs.TaskDocs;
        const RenderSafe = cjs && cjs.RenderSafe;
        if (!app || !Docs || typeof Docs.moveTo !== 'function' || !RenderSafe || typeof RenderSafe.mutate !== 'function') {
            TaskMove._notice('Could not move the note right now');
            return { ok: false, reason: 'unavailable' };
        }
        let out = null;
        const res = await RenderSafe.mutate({
            app,
            path: String(taskPath),
            failureMessage: 'Could not move the note',
            write: async () => {
                const r = await Docs.moveTo(app, docPath, taskPath);
                if (!r || r.ok !== true) throw new Error((r && r.reason) || 'move failed');
                out = r;
                return r;
            },
        });
        if (!res || !res.ok) return { ok: false, reason: 'write failed' };
        try { if (typeof o.onDone === 'function') o.onDone(out); } catch (_e) {}
        return out;
    }

    // ----- Pickers -----

    /**
     * The open tasks a task can become a subtask of: TaskDialog's parent
     * candidates (never the task itself, its own subtasks, or done and
     * trashed tasks), without its current parent. [{ label, value }].
     */
    static parentChoices(app, path, currentParent) {
        const cjs = TaskMove._cjs();
        const TD = cjs && cjs.TaskDialog;
        let names = [];
        try { names = TD && typeof TD._parentCandidates === 'function' ? TD._parentCandidates(app, path) || [] : []; } catch (_e) { names = []; }
        const current = TaskMove._unlink(currentParent).toLowerCase();
        return names.filter((n) => String(n).toLowerCase() !== current).map((n) => ({ label: String(n), value: '[[' + n + ']]' }));
    }

    /**
     * Open tasks in the folder layout that a note can move to (notes live in
     * a task folder), leaving out `currentTaskPath`. Title order.
     * [{ label, value: path, sub }]. Never throws.
     */
    static noteTargets(app, currentTaskPath) {
        const out = [];
        const cjs = TaskMove._cjs();
        const TE = cjs && cjs.TaskEntity;
        try {
            for (const f of (app && app.vault && app.vault.getMarkdownFiles()) || []) {
                const p = String((f && f.path) || '');
                if (p.indexOf('spice/tasks/') !== 0 || p === currentTaskPath) continue;
                if (/^spice\/tasks\/(_done|_trash|_sets)\//.test(p)) continue;
                const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || null;
                if (!fm || fm.type !== 'task') continue;
                const open = TE && typeof TE.isOpenTask === 'function' ? TE.isOpenTask({ type: fm.type, status: fm.status, path: p }) : (fm.status || 'open') === 'open';
                if (!open) continue;
                const folderNote = TE && typeof TE.isFolderNote === 'function' ? TE.isFolderNote(p) : TaskMove._base(p) === p.split('/').slice(-2, -1)[0];
                if (!folderNote) continue;
                const title = fm.title != null && String(fm.title).trim() ? String(fm.title).trim() : TaskMove._base(p);
                let sub = '';
                try {
                    const up = TE && typeof TE.parentNotePathOf === 'function' ? TE.parentNotePathOf(p) : '';
                    if (up) sub = 'in ' + TaskMove._base(up);
                } catch (_e) { sub = ''; }
                out.push({ label: title, value: p, sub });
            }
        } catch (_e) { /* an unreadable vault offers none */ }
        out.sort((a, b) => a.label.localeCompare(b.label));
        return out;
    }

    /** The fuzzy picker class, built once from Obsidian's FuzzySuggestModal; null when missing. */
    static _pickerClass() {
        const cjs = TaskMove._cjs();
        const Base = cjs && cjs.obsidian && cjs.obsidian.FuzzySuggestModal;
        if (typeof Base !== 'function') return null;
        if (TaskMove._cls && TaskMove._clsBase === Base) return TaskMove._cls;
        const Picker = class extends Base {
            constructor(app, items, opts) {
                super(app);
                this._items = items;
                this._opts = opts || {};
                this.emptyStateText = this._opts.empty || 'Nothing matches.';
                try { this.setPlaceholder(this._opts.placeholder || ''); } catch (_e) {}
                try { if (this.modalEl && this.modalEl.classList) this.modalEl.classList.add('sauce-task-move-modal'); } catch (_e) {}
            }
            getItems() { return this._items; }
            getItemText(item) { return String((item && item.label) || ''); }
            renderSuggestion(match, el) {
                try { super.renderSuggestion(match, el); } catch (_e) { try { el.setText(this.getItemText(match && match.item)); } catch (_e2) {} }
                const sub = match && match.item && match.item.sub;
                if (sub) { try { el.createEl('small', { cls: 'sauce-task-move-sub', text: '  ' + sub }); } catch (_e) {} }
            }
            onChooseItem(item) {
                try { if (typeof this._opts.onChoose === 'function') this._opts.onChoose(item); } catch (_e) {}
            }
        };
        TaskMove._cls = Picker;
        TaskMove._clsBase = Base;
        return Picker;
    }

    /** Open a fuzzy picker over `items`; opts { placeholder, empty, onChoose(item) }. Returns the modal or null. */
    static _pick(app, items, opts) {
        try {
            const Picker = TaskMove._pickerClass();
            if (!app || !Picker) { TaskMove._notice('The picker is not ready yet. Try again in a moment.'); return null; }
            const modal = new Picker(app, items, opts);
            modal.open();
            return modal;
        } catch (e) {
            TaskMove._notice('Could not open the picker: ' + ((e && e.message) || e), 6000);
            return null;
        }
    }

    /** Make subtask of…: pick an open task, then nest. opts as nest, plus { current } (the parent link). */
    static pickParent(path, opts) {
        const o = opts || {};
        const app = TaskMove._app(o);
        const items = TaskMove.parentChoices(app, path, o.current);
        return TaskMove._pick(app, items, {
            placeholder: 'Make it a subtask of…',
            empty: 'No open task matches.',
            onChoose: (item) => { TaskMove.nest(path, item.value, o); },
        });
    }

    /** Move to project…: pick a project (or No project when it has one), then set it. */
    static pickProject(path, opts) {
        const o = opts || {};
        const app = TaskMove._app(o);
        const cjs = TaskMove._cjs();
        const TD = cjs && cjs.TaskDialog;
        let projects = [];
        try { projects = TD && typeof TD._loadProjectList === 'function' ? TD._loadProjectList(app) || [] : []; } catch (_e) { projects = []; }
        const current = TaskMove._unlink(o.current).toLowerCase();
        const items = projects.filter((p) => String(p.name).toLowerCase() !== current)
            .map((p) => ({ label: String(p.name), value: { name: String(p.name), slug: String(p.slug || '') } }));
        if (current) items.unshift({ label: 'No project', value: null });
        return TaskMove._pick(app, items, {
            placeholder: 'Move to project…',
            empty: 'No project matches.',
            onChoose: (item) => { TaskMove.setProject(path, item.value, o); },
        });
    }

    /** Move note to task…: pick an open task in the folder layout, then move the note. */
    static pickNoteTask(docPath, opts) {
        const o = opts || {};
        const app = TaskMove._app(o);
        const cjs = TaskMove._cjs();
        const Docs = cjs && cjs.TaskDocs;
        const current = Docs && typeof Docs.taskPathOf === 'function' ? Docs.taskPathOf(docPath) : '';
        return TaskMove._pick(app, TaskMove.noteTargets(app, current), {
            placeholder: 'Move the note to…',
            empty: 'No open task matches.',
            onChoose: (item) => { TaskMove.moveNote(docPath, item.value, o); },
        });
    }

    // ----- ⋯ menu entries -----

    /**
     * The move entries an open task row's ⋯ menu adds (every device):
     * Make subtask of…, Make top-level (only for a subtask) and Move to
     * project…. opts are passed to the move (onDone, app).
     */
    static menuEntries(task, opts) {
        if (!task || !task.path || String(task.status || 'open') !== 'open') return [];
        const o = opts || {};
        const out = [{ label: 'Make subtask of…', onSelect: () => TaskMove.pickParent(task.path, Object.assign({ current: task.parent_task }, o)) }];
        if (TaskMove.hasParent(task)) out.push({ label: 'Make top-level', onSelect: () => TaskMove.nest(task.path, null, o) });
        out.push({ label: 'Move to project…', onSelect: () => TaskMove.pickProject(task.path, Object.assign({ current: task.project }, o)) });
        return out;
    }

    /** The ⋯ menu entries of a Notes row: Move note to task…. */
    static noteMenuEntries(doc, opts) {
        if (!doc || !doc.path) return [];
        return [{ label: 'Move note to task…', onSelect: () => TaskMove.pickNoteTask(doc.path, opts) }];
    }
}
