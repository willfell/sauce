class TaskSets {

    // Task sets: reusable starter bundles. A set is a note at
    // spice/tasks/_sets/<Name>.md with `type: task-set`. Its `- [ ]` lines
    // are subtasks (indent to nest, `(due +2)` for a due date two work days
    // out), its `## Prompt` section becomes a prompt note and its `## Comms`
    // section a comms note; `{{task}}` anywhere in it is the new task's
    // title. "New from set" (the + menus and the `Sauce: New task from set`
    // command) picks a set, asks for a title and an optional due date, and
    // creates the task, its subtasks and its notes in one step.
    // Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md, section 7.

    list(app) { return TaskSets.list(app); }
    parse(text) { return TaskSets.parse(text); }
    fill(text, title) { return TaskSets.fill(text, title); }
    addWorkDays(dateStr, n) { return TaskSets.addWorkDays(dateStr, n); }
    plan(text, opts) { return TaskSets.plan(text, opts); }
    apply(app, plan) { return TaskSets.apply(app, plan); }
    rollback(app, made) { return TaskSets.rollback(app, made); }
    appendBody(noteText, text) { return TaskSets.appendBody(noteText, text); }
    isSetPath(path) { return TaskSets.isSetPath(path); }
    summary(parsed) { return TaskSets.summary(parsed); }
    open(opts) { return TaskSets.open(opts); }
    get ROOT() { return TaskSets.ROOT; }
    get TYPE() { return TaskSets.TYPE; }
    get FAILED() { return TaskSets.FAILED; }

    static get ROOT() { return 'spice/tasks/_sets'; }
    static get FAILED() { return "Couldn't create from set; nothing was kept"; }
    static get TYPE() { return 'task-set'; }

    static _cjs() {
        try { return (typeof window !== 'undefined' && window.customJS) || (typeof globalThis !== 'undefined' && globalThis.customJS) || {}; }
        catch (_e) { return {}; }
    }

    static _notice(msg, ms) { try { new Notice(msg, ms); } catch (_e) {} }

    /** True for a path inside spice/tasks/_sets/, which no task list, heal or scan treats as a task. */
    static isSetPath(path) {
        return String(path == null ? '' : path).indexOf(TaskSets.ROOT + '/') === 0;
    }

    /**
     * The sets in this vault: every markdown file directly in
     * spice/tasks/_sets/ whose `type` is task-set or blank, by name.
     * → [{ path, name, file }]
     */
    static list(app) {
        const out = [];
        try {
            const files = app && app.vault && typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
            for (const f of files || []) {
                const p = String((f && f.path) || '');
                if (!TaskSets.isSetPath(p) || p.slice(TaskSets.ROOT.length + 1).indexOf('/') >= 0) continue;
                let type = '';
                try {
                    const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
                    if (fm && fm.type != null) type = String(fm.type).trim();
                } catch (_e) {}
                if (type && type !== TaskSets.TYPE) continue;
                const name = f.basename != null ? String(f.basename) : p.split('/').pop().replace(/\.md$/i, '');
                out.push({ path: p, name, file: f });
            }
        } catch (_e) {}
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }

    /** `text` with every `{{task}}` replaced by `title`. Pure. */
    static fill(text, title) {
        const t = String(title == null ? '' : title);
        return String(text == null ? '' : text).replace(/\{\{\s*task\s*\}\}/gi, () => t);
    }

    /**
     * Read a set note. → { steps, prompt, comms }
     *   steps  [{ title, depth, parent, dueOffset }] in file order: one per
     *          checkbox line (`- [ ]`, `- [x]` or `- [X]`; every step is
     *          created open) outside the Prompt and Comms sections and outside
     *          code fences. Indentation nests a line under the nearest step
     *          above it with less indentation (`parent` is that step's index,
     *          -1 for a direct subtask of the new task). A list item that is
     *          not a checkbox is skipped, and so is everything indented under
     *          it. A trailing `(due +N)` sets dueOffset N (work days);
     *          otherwise null. `{{task}}` is left as written (plan fills it
     *          in after parsing, so a title cannot change the structure).
     *   prompt the text of the Prompt section (a level 2 heading named Prompt),
     *          up to the next level 1 or 2 heading.
     *   comms  the text of the Comms section, the same way.
     * Frontmatter is skipped. Pure.
     */
    static parse(text) {
        let s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
        const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(s);
        if (fm) s = s.slice(fm[0].length);
        const steps = [];
        const sections = { prompt: [], comms: [] };
        const stack = [];
        let section = '';
        let fence = null;
        let skipIndent = null;
        const width = (ws) => ws.replace(/\t/g, '    ').length;
        for (const line of s.split('\n')) {
            const heading = fence === null ? /^(#{1,2})\s+(.*?)\s*#*\s*$/.exec(line) : null;
            if (heading) {
                const name = heading[2].trim().toLowerCase();
                section = name === 'prompt' || name === 'comms' ? name : '';
                skipIndent = null;
                continue;
            }
            const fenceMark = /^\s*(`{3,}|~{3,})/.exec(line);
            if (section) {
                sections[section].push(line);
                if (fenceMark) {
                    if (fence === null) fence = fenceMark[1];
                    else if (fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
                }
                continue;
            }
            if (fenceMark) {
                if (fence === null) fence = fenceMark[1];
                else if (fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
                continue;
            }
            if (fence !== null) continue;
            const item = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/.exec(line);
            if (!item) {
                const lead = /^([ \t]*)\S/.exec(line);
                if (lead && skipIndent !== null && width(lead[1]) <= skipIndent) skipIndent = null;
                continue;
            }
            const indent = width(item[1]);
            if (skipIndent !== null) {
                if (indent > skipIndent) continue;
                skipIndent = null;
            }
            const m = /^(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+(.*)$/.exec(line.slice(item[1].length));
            if (!m) {
                skipIndent = indent;
                continue;
            }
            let title = m[1];
            let dueOffset = null;
            const due = /\s*\(\s*due\s*\+\s*(\d{1,3})\s*\)\s*$/i.exec(title);
            if (due) { dueOffset = Number(due[1]); title = title.slice(0, due.index); }
            title = title.replace(/\s+/g, ' ').trim();
            if (!title) continue;
            while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
            const parent = stack.length ? stack[stack.length - 1].index : -1;
            steps.push({ title, depth: stack.length, parent, dueOffset });
            stack.push({ indent, index: steps.length - 1 });
        }
        const trim = (lines) => lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
        return { steps, prompt: trim(sections.prompt), comms: trim(sections.comms) };
    }

    /** "3 subtasks · prompt · comms", the line under a set in the picker. Pure. */
    static summary(parsed) {
        const p = parsed || {};
        const n = Array.isArray(p.steps) ? p.steps.length : 0;
        const parts = [n === 1 ? '1 subtask' : n + ' subtasks'];
        if (p.prompt) parts.push('prompt');
        if (p.comms) parts.push('comms');
        return parts.join(' · ');
    }

    /** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date. Pure, no Date. */
    static _weekday(y, m, d) {
        const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
        const yy = m < 3 ? y - 1 : y;
        return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + d) % 7;
    }

    /**
     * The date `n` work days (Monday to Friday) after `dateStr`; `dateStr`
     * itself for 0; null for an unreadable date. Pure, no Date.
     */
    static addWorkDays(dateStr, n) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr == null ? '' : dateStr));
        if (!m) return null;
        let y = +m[1];
        let mo = +m[2];
        let d = +m[3];
        let left = Math.max(0, Math.floor(Number(n) || 0));
        while (left > 0) {
            const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
            const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
            d += 1;
            if (d > dim) { d = 1; mo += 1; if (mo > 12) { mo = 1; y += 1; } }
            const wd = TaskSets._weekday(y, mo, d);
            if (wd !== 0 && wd !== 6) left -= 1;
        }
        const p = (x) => String(x).padStart(2, '0');
        return y + '-' + p(mo) + '-' + p(d);
    }

    /**
     * Work out every file a set makes, without writing anything.
     *   text  the set note.
     *   opts  { title, due, today, createdAt, source, taken }
     *         taken(lowerBasename) is the vault-wide name check
     *         (TaskDialog._takenNames); names given earlier in the plan count
     *         as taken too.
     * → { ok: true, root: { path, name, title }, folders, tasks: [{ path, name,
     *     title, content }], docs: [{ kind, text }] } parents before children,
     *   or { ok: false, reason }.
     * The task and subtasks are written the way TaskDialog writes them
     * (TaskEntity.composeNote, TaskDialog.renderNote) in the folder layout:
     * each subtask's folder sits inside its parent's.
     */
    static plan(text, opts) {
        const o = opts || {};
        const cjs = TaskSets._cjs();
        const TE = cjs.TaskEntity;
        const TD = cjs.TaskDialog;
        if (!TE || !TD || typeof TE.composeNote !== 'function' || typeof TD.renderNote !== 'function') {
            return { ok: false, reason: 'tasks are still loading' };
        }
        const title = String(o.title == null ? '' : o.title).replace(/\s+/g, ' ').trim();
        if (!title) return { ok: false, reason: 'a task needs a title' };
        const due = String(o.due == null ? '' : o.due).trim();
        const check = TE.validatePayload({ title, due });
        if (!check.valid) return { ok: false, reason: check.reason };
        const parsed = TaskSets.parse(text);
        const createdAt = String(o.createdAt || '');
        const source = String(o.source || 'manual');
        const reserved = new Set();
        const taken = (lower) => {
            if (reserved.has(lower)) return true;
            try { return typeof o.taken === 'function' ? !!o.taken(lower) : false; } catch (_e) { return false; }
        };
        const folders = [];
        const addFolders = (path) => {
            const parts = TE.taskFolderOf(path).split('/');
            for (let i = 1; i <= parts.length; i++) {
                const f = parts.slice(0, i).join('/');
                if (folders.indexOf(f) < 0) folders.push(f);
            }
        };
        const make = (stepTitle, stepDue, parent) => {
            const name = TE.taskName(stepTitle, { parentTitle: parent ? parent.title : undefined, createdAt, taken });
            reserved.add(name.toLowerCase());
            const path = TE.folderNotePath(parent ? TE.taskFolderOf(parent.path) : TE.TASK_ROOT, name);
            const note = TE.composeNote({
                title: stepTitle,
                due: stepDue || '',
                source,
                parent_task: parent ? '[[' + parent.name + ']]' : '',
                links: [],
                now: createdAt,
            });
            addFolders(path);
            return { path, name, title: stepTitle, content: TD.renderNote(note.frontmatter, note.body) };
        };
        const root = make(title, due, null);
        const tasks = [root];
        const byStep = [];
        for (const step of parsed.steps) {
            const parent = step.parent >= 0 ? byStep[step.parent] : root;
            const stepDue = step.dueOffset != null ? (TaskSets.addWorkDays(o.today, step.dueOffset) || '') : '';
            const t = make(TaskSets.fill(step.title, title).replace(/\s+/g, ' ').trim() || step.title, stepDue, parent);
            byStep.push(t);
            tasks.push(t);
        }
        const docs = [];
        if (parsed.prompt) docs.push({ kind: 'prompt', text: TaskSets.fill(parsed.prompt, title) });
        if (parsed.comms) docs.push({ kind: 'comms', text: TaskSets.fill(parsed.comms, title) });
        return { ok: true, root: { path: root.path, name: root.name, title }, folders, tasks, docs };
    }

    /** A new note's text with `text` added below its header. Pure. */
    static appendBody(noteText, text) {
        const body = String(noteText == null ? '' : noteText).replace(/\s*$/, '');
        return body + '\n\n' + String(text == null ? '' : text).replace(/\s+$/, '') + '\n';
    }

    /**
     * Write a plan: the folders, then the task and each subtask (parents
     * first), then each note through TaskDocs.create with the set's text
     * added below its header. All or nothing: when any write fails, every
     * file and folder this run made is moved to the trash, newest first
     * (rollback), and the error is rethrown with `kept` listing anything
     * that could not be removed. Called from RenderSafe.mutate; resolves
     * { path, tasks, notes }.
     */
    static async apply(app, plan) {
        if (!app || !app.vault || !plan || !plan.ok) throw new Error('nothing to create');
        const made = [];
        const exists = (p) => !!app.vault.getAbstractFileByPath(p);
        try {
            for (const folder of plan.folders) {
                if (exists(folder)) continue;
                try { await app.vault.createFolder(folder); } catch (_e) { /* made meanwhile */ }
                if (exists(folder)) made.push(folder);
            }
            for (const t of plan.tasks) {
                await app.vault.create(t.path, t.content);
                made.push(t.path);
            }
            const TDocs = TaskSets._cjs().TaskDocs;
            let notes = 0;
            for (const d of plan.docs) {
                if (!TDocs || typeof TDocs.create !== 'function') throw new Error('task notes are still loading');
                const label = d.kind === 'comms' ? 'Comms' : 'Prompt';
                const folder = typeof TDocs.notesFolder === 'function' ? TDocs.notesFolder(plan.root.path) : '';
                const hadFolder = !folder || exists(folder);
                const res = await TDocs.create(app, plan.root.path, d.kind, label);
                if (!hadFolder && exists(folder)) made.push(folder);
                if (!res || !res.ok) throw new Error('could not create the ' + label.toLowerCase() + ' note: ' + ((res && res.reason) || 'unknown'));
                made.push(res.path);
                const file = app.vault.getAbstractFileByPath(res.path);
                if (!file) throw new Error('could not find the ' + label.toLowerCase() + ' note');
                if (typeof app.vault.process === 'function') await app.vault.process(file, (data) => TaskSets.appendBody(data, d.text));
                else await app.vault.modify(file, TaskSets.appendBody(await app.vault.read(file), d.text));
                notes += 1;
            }
            return { path: plan.root.path, tasks: plan.tasks.length, notes };
        } catch (e) {
            const kept = await TaskSets.rollback(app, made);
            const err = e instanceof Error ? e : new Error(String(e));
            err.kept = kept;
            throw err;
        }
    }

    /**
     * Move the paths one apply made to the trash, newest first (notes, then
     * subtasks, then their parents, then folders), through
     * fileManager.trashFile when there is one, else vault.trash(file, true).
     * Resolves the paths that could not be removed.
     */
    static async rollback(app, made) {
        const kept = [];
        for (const p of (made || []).slice().reverse()) {
            const f = app.vault.getAbstractFileByPath(p);
            if (!f) continue;
            try {
                if (app.fileManager && typeof app.fileManager.trashFile === 'function') await app.fileManager.trashFile(f);
                else await app.vault.trash(f, true);
            } catch (_e) { kept.push(p); }
        }
        return kept;
    }

    static get SET_CSS() {
        return [
            '.sauce-modal.sauce-task-dialog.sauce-task-set-dialog { width: min(100%, 460px); }',
            '.sauce-task-set-dialog .sauce-task-set-field { display: flex; flex-direction: column; gap: 0; }',
            '.sauce-task-set-dialog .sauce-task-set-due-row { display: flex; align-items: center; gap: 8px; }',
            '@media (max-width: 600px) {',
            '  .sauce-task-dialog button.sauce-task-pill.sauce-task-set-pill, .sauce-task-dialog button.sauce-task-quiet.sauce-task-set-clear { min-height: 36px; }',
            '}',
            'body.is-phone .sauce-task-dialog button.sauce-task-pill.sauce-task-set-pill, body.is-phone .sauce-task-dialog button.sauce-task-quiet.sauce-task-set-clear { min-height: 36px; }',
        ].join('\n');
    }

    static _injectCss(doc) {
        try {
            const head = doc && doc.head;
            if (!head || typeof doc.createElement !== 'function') return;
            const ID = 'sauce-task-set-css';
            let el = Array.from(head.children || []).find((c) => c && c.id === ID) || null;
            if (!el) {
                el = doc.createElement('style');
                el.id = ID;
                head.appendChild(el);
            }
            if (el.textContent !== TaskSets.SET_CSS) el.textContent = TaskSets.SET_CSS;
        } catch (_e) { /* unstyled is still usable */ }
    }

    /**
     * The New from set dialog: pick a set, type the title, optionally a due
     * date, then Create task. opts { surface, today, title?, setPath?, due? };
     * the last three prefill the dialog (it reopens with them after a failed
     * create). Returns true when the dialog opened.
     */
    static open(opts) {
        try { return TaskSets._open(opts || {}); } catch (_e) { return false; }
    }

    static _open(opts) {
        const cjs = TaskSets._cjs();
        const TD = cjs.TaskDialog;
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        if (!app || !TD || typeof TD.openShell !== 'function') {
            TaskSets._notice('Tasks are still loading — try again in a moment', 4000);
            return false;
        }
        const sets = TaskSets.list(app);
        if (!sets.length) {
            TaskSets._notice('No task sets yet. Add a note to ' + TaskSets.ROOT + '/.', 6000);
            return false;
        }
        const now = (typeof window !== 'undefined' && typeof window.moment === 'function') ? window.moment() : null;
        const today = (opts.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today)) ? opts.today : (now ? now.format('YYYY-MM-DD') : '');
        const createdAt = now ? now.format('YYYY-MM-DDTHH:mm:ssZ') : '';
        const source = (typeof TD.defaultsForSurface === 'function' && (TD.defaultsForSurface({ surface: opts.surface }) || {}).source) || 'manual';
        const preset = sets.find((s) => s.path === opts.setPath) || null;
        const state = {
            set: preset || (sets.length === 1 ? sets[0] : null),
            title: String(opts.title == null ? '' : opts.title),
            due: /^\d{4}-\d{2}-\d{2}$/.test(String(opts.due || '')) ? String(opts.due) : '',
        };
        const doc = (typeof document !== 'undefined') ? document : null;

        let titleInput = null;
        let createBtn = null;
        let submitting = false;
        let detachKeys = () => {};

        const submit = async () => {
            if (submitting || !createBtn || createBtn.disabled || !state.set) return false;
            submitting = true;
            let text = '';
            try { text = await app.vault.cachedRead(state.set.file); } catch (_e) { text = ''; }
            const plan = TaskSets.plan(text, {
                title: state.title,
                due: state.due,
                today,
                createdAt,
                source,
                taken: typeof TD._takenNames === 'function' ? TD._takenNames(app) : null,
            });
            if (!plan.ok) {
                submitting = false;
                TaskSets._notice('Could not create the task: ' + plan.reason, 5000);
                return false;
            }
            shell.close();
            const RenderSafe = cjs.RenderSafe;
            if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskSets._notice('Could not create the task right now', 4000); return true; }
            const setName = state.set.name;
            const res = await RenderSafe.mutate({
                app,
                path: plan.root.path,
                mode: 'create',
                failureMessage: TaskSets.FAILED,
                write: () => TaskSets.apply(app, plan),
            });
            if (res && res.ok) {
                TaskSets._notice('Created ' + plan.root.title + ' from ' + setName, 3000);
                try { app.workspace.openLinkText(plan.root.path, '', false); } catch (_e) {}
                return true;
            }
            const kept = (res && res.error && Array.isArray(res.error.kept)) ? res.error.kept : [];
            if (kept.length) TaskSets._notice('Could not remove ' + kept.length + ' file(s): ' + kept.join(', '), 8000);
            TaskSets.open({ surface: opts.surface, today, title: state.title, setPath: state.set.path, due: state.due });
            return true;
        };

        const shell = TD.openShell({
            doc,
            title: 'New from set',
            columns: false,
            cls: 'sauce-task-set-dialog',
            closeReason: 'task-set',
            onSubmit: (_handle, event) => {
                if (!event) return false;
                if ((titleInput && event.target === titleInput)
                    || (createBtn && event.currentTarget === createBtn)
                    || TD.isCmdEnter(event)) return submit();
                return false;
            },
            onClose: () => { try { detachKeys(); } catch (_e) {} },
        });
        if (!shell) { TaskSets._notice('Could not open the dialog', 4000); return false; }
        TaskSets._injectCss(shell.doc);
        const left = shell.left;

        const setSec = left.createDiv({ cls: 'sauce-task-section sauce-task-set-field' });
        TD.sectionLabel(setSec, 'Set');
        const setRow = setSec.createDiv({ cls: 'sauce-task-pill-row' });
        const PILL = 'sauce-task-pill sauce-task-set-pill';
        const setCaption = setSec.createDiv({ cls: 'sauce-task-caption sauce-task-set-caption' });
        const pills = sets.map((s) => {
            const b = TD.pill(setRow, PILL, s.name);
            try { b.setAttribute('data-path', s.path); } catch (_e) {}
            b.onclick = () => { state.set = s; renderSets(); updateSubmit(); };
            return { el: b, set: s };
        });
        const renderSets = () => {
            for (const p of pills) TD.setPressed(p.el, PILL, !!state.set && p.set.path === state.set.path);
            setCaption.textContent = state.set ? 'Loading…' : 'Pick a set';
            const picked = state.set;
            if (!picked) return;
            Promise.resolve(app.vault.cachedRead(picked.file)).then((text) => {
                if (state.set === picked) setCaption.textContent = TaskSets.summary(TaskSets.parse(text));
            }, () => { if (state.set === picked) setCaption.textContent = ''; });
        };

        const titleSec = left.createDiv({ cls: 'sauce-task-section sauce-task-set-field' });
        TD.sectionLabel(titleSec, 'Title');
        titleInput = titleSec.createEl('input', { type: 'text', cls: 'sauce-task-title sauce-task-set-title' });
        titleInput.placeholder = 'Task title';
        try { titleInput.setAttribute('aria-label', 'Task title'); } catch (_e) {}
        titleInput.value = state.title;
        titleInput.oninput = () => { state.title = titleInput.value; updateSubmit(); };
        if (!(app.isMobile && !state.set)) setTimeout(() => { try { titleInput.focus(); } catch (_e) {} }, 50);

        const dueSec = left.createDiv({ cls: 'sauce-task-section sauce-task-set-field' });
        TD.sectionLabel(dueSec, 'Due');
        const dueRow = dueSec.createDiv({ cls: 'sauce-task-set-due-row' });
        const dueInput = dueRow.createEl('input', { type: 'date', cls: 'sauce-task-set-due' });
        try { dueInput.setAttribute('aria-label', 'Due date'); } catch (_e) {}
        dueInput.style.cssText = TD.DATE_CSS;
        const clearBtn = TD.pill(dueRow, 'sauce-task-quiet sauce-task-set-clear', 'Clear');
        dueSec.createDiv({ cls: 'sauce-task-caption', text: 'Optional. A (due +N) line counts N work days from today.' });
        dueInput.value = state.due;
        const renderDue = () => { clearBtn.style.display = state.due ? '' : 'none'; };
        dueInput.onchange = () => { state.due = dueInput.value || ''; renderDue(); };
        dueInput.oninput = dueInput.onchange;
        clearBtn.onclick = () => { dueInput.value = ''; state.due = ''; renderDue(); };
        renderDue();

        const footRight = shell.footer.createDiv({ cls: 'sauce-task-footer-right' });
        const cancelBtn = TD.actionButton(footRight, { label: 'Cancel', cls: 'sauce-task-set-cancel' });
        cancelBtn.onclick = () => shell.close();
        const kbd = typeof TD._submitKeyHint === 'function' ? TD._submitKeyHint(app) : '';
        createBtn = TD.actionButton(footRight, { label: 'Create task', kbd, variant: 'accent', cls: 'sauce-task-set-create' });
        try { createBtn.classList.add('mod-cta'); } catch (_e) {}
        createBtn.onclick = (event) => shell.handle.submit(event);
        const updateSubmit = () => { createBtn.disabled = !state.set || !String(state.title || '').trim(); };
        renderSets();
        updateSubmit();

        const modalEl = shell.modal;
        const onKey = (ev) => {
            try {
                if (!ev || !shell.handle.isOpen || !TD.isCmdEnter(ev)) return;
                const t = ev.target;
                const inside = !t || (doc && t === doc.body) || (modalEl && typeof modalEl.contains === 'function' && modalEl.contains(t));
                if (!inside) return;
                if (ev.preventDefault) ev.preventDefault();
                shell.handle.submit(ev);
            } catch (_e) { /* a key handler must never throw */ }
        };
        try {
            if (doc && typeof doc.addEventListener === 'function') {
                doc.addEventListener('keydown', onKey, true);
                detachKeys = () => { if (typeof doc.removeEventListener === 'function') doc.removeEventListener('keydown', onKey, true); };
            }
        } catch (_e) {}
        return true;
    }
}
