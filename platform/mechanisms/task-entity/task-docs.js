class TaskDocs {

    // Notes that belong to a task without being steps of it: the prompts,
    // handoffs, plans, context and findings that go with the work. Each lives
    // at spice/tasks/<Task>/notes/<Name>.md with `type: task-doc` and a
    // `kind`; it has no status, never counts toward the task's progress and
    // never lists as a to-do. The task card shows them in a Notes section
    // (render), with Copy prompt on prompt and handoff notes, Copy message on
    // comms notes (the message to send others about the task), and a + Note
    // menu that creates one, blank under its header.
    // Spec: Docs/superpowers/specs/2026-11-12-task-notes-design.md.
    // A comms note is marked sent from its header card and waits for a reply
    // (To-Do's Waiting tab); a prompt note copies with its task context for
    // a Claude session; a note changed since this device last opened it shows
    // New; a handoff with session: offers Resume.
    // Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md §1-2.

    render(container, opts) { return TaskDocs.render(container, opts); }
    create(app, taskPath, kind, title) { return TaskDocs.create(app, taskPath, kind, title); }
    list(app, taskPath) { return TaskDocs.list(app, taskPath); }
    extractPrompt(text) { return TaskDocs.extractPrompt(text); }
    kindOf(value) { return TaskDocs.kindOf(value); }
    notesFolder(taskPath) { return TaskDocs.notesFolder(taskPath); }
    compose(kind, title, taskName, createdAt) { return TaskDocs.compose(kind, title, taskName, createdAt); }
    isDoc(fm) { return TaskDocs.isDoc(fm); }
    titleKind(title) { return TaskDocs.titleKind(title); }
    candidates(app, taskPath) { return TaskDocs.candidates(app, taskPath); }
    convert(app, taskPath, items) { return TaskDocs.convert(app, taskPath, items); }
    openReview(app, taskPath, cands) { return TaskDocs.openReview(app, taskPath, cands); }
    renderHeader(dv, opts) { return TaskDocs.renderHeader(dv, opts); }
    rename(app, docPath, title) { return TaskDocs.rename(app, docPath, title); }
    moveTo(app, docPath, taskPath) { return TaskDocs.moveTo(app, docPath, taskPath); }
    withHeader(text) { return TaskDocs.withHeader(text); }
    taskPathOf(docPath) { return TaskDocs.taskPathOf(docPath); }
    commsState(fm, followUps, today) { return TaskDocs.commsState(fm, followUps, today); }
    commsChip(st) { return TaskDocs.commsChip(st); }
    waitingText(days) { return TaskDocs.waitingText(days); }
    commsItem(page) { return TaskDocs.commsItem(page); }
    waiting(items, tasks, today) { return TaskDocs.waiting(items, tasks, today); }
    followUps(app, docPath, index) { return TaskDocs.followUps(app, docPath, index); }
    replyNotice(res) { return TaskDocs.replyNotice(res); }
    followUpDate(choice, today) { return TaskDocs.followUpDate(choice, today); }
    followUpTitle(to, noteTitle) { return TaskDocs.followUpTitle(to, noteTitle); }
    firstNames(to) { return TaskDocs.firstNames(to); }
    addWorkDays(day, n) { return TaskDocs.addWorkDays(day, n); }
    markSent(app, docPath, opts) { return TaskDocs.markSent(app, docPath, opts); }
    gotReply(app, docPath, stamp) { return TaskDocs.gotReply(app, docPath, stamp); }
    openSendPanel(opts) { return TaskDocs.openSendPanel(opts); }
    renderWaitingRow(container, item, opts) { return TaskDocs.renderWaitingRow(container, item, opts); }
    claudeContext(info) { return TaskDocs.claudeContext(info); }
    forClaude(prompt, info) { return TaskDocs.forClaude(prompt, info); }
    resumeAction(session) { return TaskDocs.resumeAction(session); }
    isNew(mtime, seenAt, now) { return TaskDocs.isNew(mtime, seenAt, now); }
    readSeen(storage) { return TaskDocs.readSeen(storage); }
    markSeen(path, at, storage) { return TaskDocs.markSeen(path, at, storage); }
    newNotes(app, taskPath, now, seen) { return TaskDocs.newNotes(app, taskPath, now, seen); }

    static get TYPE() { return 'task-doc'; }
    static get FOLDER() { return 'notes'; }

    /** The kinds, in card order. Anything else reads as `note`. */
    static get KINDS() {
        const svg = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        return [
            { key: 'prompt', label: 'Prompt', copy: true, copyLabel: 'Copy prompt', copied: 'Prompt', icon: svg('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>') },
            { key: 'handoff', label: 'Handoff', copy: true, copyLabel: 'Copy prompt', copied: 'Prompt', icon: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>') },
            { key: 'comms', label: 'Comms', copy: true, copyLabel: 'Copy message', copied: 'Message', icon: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/>') },
            { key: 'plan', label: 'Plan', copy: false, icon: svg('<path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15"/><path d="M15 6v15"/>') },
            { key: 'context', label: 'Context', copy: false, icon: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>') },
            { key: 'findings', label: 'Findings', copy: false, icon: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>') },
            { key: 'questions', label: 'Questions', copy: false, icon: svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>') },
            { key: 'note', label: 'Note', copy: false, icon: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>') },
        ];
    }

    static kindOf(value) {
        const k = String(value == null ? '' : value).trim().toLowerCase();
        return TaskDocs.KINDS.some((x) => x.key === k) ? k : 'note';
    }

    static _kind(value) {
        const k = TaskDocs.kindOf(value);
        return TaskDocs.KINDS.find((x) => x.key === k);
    }

    static isDoc(fm) { return !!fm && String(fm.type || '').trim() === TaskDocs.TYPE; }

    static _te() {
        try { return (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null; }
        catch (_e) { return null; }
    }

    /** The notes folder of a task folder note; '' for a flat or non-task path. */
    static notesFolder(taskPath) {
        const TE = TaskDocs._te();
        const p = String(taskPath == null ? '' : taskPath);
        if (TE && typeof TE.isFolderNote === 'function') {
            if (!TE.isFolderNote(p)) return '';
            return TE.taskFolderOf(p) + '/' + TaskDocs.FOLDER;
        }
        const parts = p.split('/');
        if (parts.length < 3 || parts[parts.length - 2] !== parts[parts.length - 1].replace(/\.md$/i, '')) return '';
        return parts.slice(0, -1).join('/') + '/' + TaskDocs.FOLDER;
    }

    /**
     * A whole new note: frontmatter, then the header (breadcrumb bar and header
     * card) and nothing else, so the note starts blank under the header.
     */
    static compose(kind, title, taskName, createdAt) {
        const k = TaskDocs.kindOf(kind);
        const t = String(title == null || String(title).trim() === '' ? TaskDocs._kind(k).label : title).trim();
        const task = String(taskName == null ? '' : taskName);
        return [
            '---',
            'type: ' + TaskDocs.TYPE,
            'kind: ' + k,
            'title: ' + JSON.stringify(t),
            'task: ' + JSON.stringify('[[' + task + ']]'),
            'created_at: ' + (createdAt || ''),
            '---',
            '',
            TaskDocs.HEADER,
            '',
        ].join('\n');
    }

    /**
     * The header every note starts with: the breadcrumb bar (TaskChromeBar,
     * To-Do › task › note) and the note's header card (renderHeader).
     * The installer adds the same text to notes made before it existed;
     * run-task-docs.js checks the two copies match.
     */
    static get HEADER() {
        return [
            '```dataviewjs',
            'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });',
            '```',
            '',
            '```dataviewjs',
            'await dv.view("ranch/views/customjs-guard", { class: "TaskDocs", method: "renderHeader" });',
            '```',
            '',
        ].join('\n');
    }

    /**
     * `text` (a whole note) with HEADER right after its frontmatter, in place
     * of the one-line "> [!info] <Kind> for [[Task]]" header older notes
     * started with. Unchanged when the header is already there. Pure.
     */
    static withHeader(text) {
        const s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
        if (/method:\s*"renderHeader"/.test(s)) return s;
        const m = /^---\n[\s\S]*?\n---\n?/.exec(s);
        const fm = m ? m[0] : '';
        let body = s.slice(fm.length).replace(/^\s*\n/, '');
        body = body.replace(/^> \[!info\] [A-Za-z]+ for \[\[[^\]\n]*\]\][ \t]*\n(?:[ \t]*\n)?/, '');
        return (fm && !fm.endsWith('\n') ? fm + '\n' : fm) + '\n' + TaskDocs.HEADER + '\n' + body;
    }

    /** The task note a note at `docPath` belongs to, from its folder; '' if none. */
    static taskPathOf(docPath) {
        const parts = String(docPath == null ? '' : docPath).split('/');
        if (parts.length < 4 || parts[parts.length - 2] !== TaskDocs.FOLDER) return '';
        const dir = parts.slice(0, -2);
        return dir.join('/') + '/' + dir[dir.length - 1] + '.md';
    }

    /**
     * The text Copy prompt puts on the clipboard, from a note's markdown:
     * the fenced block under a heading or callout whose title says "prompt",
     * else the first fenced block with no language or text / markdown,
     * else the body with its frontmatter, code-run blocks, header callout and
     * "Resume session" callout taken out. Callout `> ` prefixes are removed.
     * '' when nothing is left. Pure.
     */
    static extractPrompt(text) {
        let s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
        s = s.replace(/^---\n[\s\S]*?\n---\n?/, '');
        const lines = s.split('\n');
        const unq = (l) => l.replace(/^\s*>\s?/, '');
        const fenceAt = (i) => {
            const m = /^(\s*>\s?)?\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/.exec(lines[i]);
            return m ? { quoted: !!m[1], fence: m[2], lang: m[3].toLowerCase() } : null;
        };
        const blockFrom = (i) => {
            const open = fenceAt(i);
            const out = [];
            for (let j = i + 1; j < lines.length; j++) {
                const raw = open.quoted ? unq(lines[j]) : lines[j];
                if (raw.trim().indexOf(open.fence) === 0 && raw.trim().replace(/[`~]/g, '') === '') return { text: out.join('\n'), end: j };
                out.push(raw);
            }
            return { text: out.join('\n'), end: lines.length - 1 };
        };
        let promptTitled = false;
        let firstPlain = null;
        for (let i = 0; i < lines.length; i++) {
            const plain = unq(lines[i]);
            if (/^#{1,6}\s/.test(lines[i]) || /^\s*>\s*\[!/.test(lines[i])) promptTitled = /prompt/i.test(plain) && !/ for \[\[/.test(plain);
            const f = fenceAt(i);
            if (!f) continue;
            const block = blockFrom(i);
            if (promptTitled && block.text.trim()) return block.text.trim();
            if (firstPlain == null && (f.lang === '' || f.lang === 'text' || f.lang === 'markdown' || f.lang === 'md') && block.text.trim()) firstPlain = block.text.trim();
            i = block.end;
        }
        if (firstPlain) return firstPlain;
        const kept = [];
        let skipCallout = false;
        let inCode = null;
        for (const line of lines) {
            if (inCode) { if (line.trim().indexOf(inCode) === 0) inCode = null; continue; }
            const code = /^\s*(`{3,})\s*dataviewjs\s*$/.exec(line);
            if (code) { inCode = code[1]; continue; }
            if (/^\s*>\s*\[!(info|tip)\]/i.test(line) && (/\bfor \[\[/.test(line) || /resume session/i.test(line))) { skipCallout = true; continue; }
            if (skipCallout) { if (/^\s*>/.test(line)) continue; skipCallout = false; }
            if (/<!-- TASK_NOTES -->/.test(line)) continue;
            kept.push(line);
        }
        return kept.join('\n').trim();
    }

    /** The notes of the task at `taskPath`, in kind order then newest first. */
    static list(app, taskPath) {
        const folder = TaskDocs.notesFolder(taskPath);
        if (!folder || !app || !app.vault || typeof app.vault.getAbstractFileByPath !== 'function') return [];
        const dir = app.vault.getAbstractFileByPath(folder);
        if (!dir || !Array.isArray(dir.children)) return [];
        const order = TaskDocs.KINDS.map((k) => k.key);
        const out = [];
        for (const f of dir.children) {
            if (!f || Array.isArray(f.children) || !/\.md$/i.test(String(f.path || ''))) continue;
            let fm = null;
            try { fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || null; } catch (_e) { fm = null; }
            if (fm && String(fm.type || '') === 'task') continue;
            const kind = TaskDocs.kindOf(fm && fm.kind);
            const base = String(f.basename != null ? f.basename : f.path.split('/').pop().replace(/\.md$/i, ''));
            const title = fm && fm.title != null && String(fm.title).trim() !== '' ? String(fm.title).trim() : base;
            out.push({ path: f.path, file: f, kind, title, mtime: (f.stat && f.stat.mtime) || 0, fm: fm || {} });
        }
        out.sort((a, b) => (order.indexOf(a.kind) - order.indexOf(b.kind)) || (b.mtime - a.mtime) || a.title.localeCompare(b.title));
        return out;
    }

    static _takenNames(app) {
        const names = new Set();
        try { for (const f of app.vault.getMarkdownFiles()) names.add(String(f.basename || '').toLowerCase()); } catch (_e) {}
        return (n) => names.has(String(n).toLowerCase());
    }

    static _stamp() {
        try {
            if (typeof window !== 'undefined' && typeof window.moment === 'function') return window.moment().format('YYYY-MM-DDTHH:mm:ssZ');
        } catch (_e) {}
        return new Date().toISOString();
    }

    /**
     * Create a note of `kind` titled `title` under the task at `taskPath`.
     * Its file name is TaskEntity.taskName(title, { parentTitle: task's
     * title }): the plain title while it is unique in the vault, else
     * `Title (Task)`. Resolves { ok, path } or { ok: false, reason }.
     */
    static async create(app, taskPath, kind, title) {
        const folder = TaskDocs.notesFolder(taskPath);
        if (!folder) return { ok: false, reason: 'notes need a task in the folder layout' };
        const TE = TaskDocs._te();
        const k = TaskDocs.kindOf(kind);
        const t = String(title == null || String(title).trim() === '' ? TaskDocs._kind(k).label : title).trim();
        let taskTitle = '';
        let taskName = String(taskPath).split('/').pop().replace(/\.md$/i, '');
        try {
            const tf = app.vault.getAbstractFileByPath(taskPath);
            const fm = tf ? (app.metadataCache.getFileCache(tf) || {}).frontmatter : null;
            if (fm && fm.title != null) taskTitle = String(fm.title).trim();
        } catch (_e) {}
        if (!taskTitle) taskTitle = taskName;
        const taken = TaskDocs._takenNames(app);
        const name = TE && typeof TE.taskName === 'function'
            ? TE.taskName(t, { parentTitle: taskTitle, taken })
            : t.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Note';
        const path = folder + '/' + name + '.md';
        try {
            if (!app.vault.getAbstractFileByPath(folder)) {
                try { await app.vault.createFolder(folder); } catch (_e) { /* exists */ }
            }
            await app.vault.create(path, TaskDocs.compose(k, t, taskName, TaskDocs._stamp()));
            return { ok: true, path };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
    }

    /**
     * Rename the note at `docPath` to `title`: its frontmatter title, and its
     * file name by the rule create uses (the plain title while it is unique
     * in the vault, else `Title (Task)`), moved with fileManager.renameFile
     * so links to it follow. The note stays in its notes folder. Resolves
     * { ok, path } or { ok: false, reason }.
     */
    static async rename(app, docPath, title) {
        const t = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
        if (!t) return { ok: false, reason: 'a note needs a name' };
        const file = app && app.vault ? app.vault.getAbstractFileByPath(docPath) : null;
        if (!file || Array.isArray(file.children)) return { ok: false, reason: 'note not found' };
        const TE = TaskDocs._te();
        const taskPath = TaskDocs.taskPathOf(docPath);
        let taskTitle = taskPath ? taskPath.split('/').pop().replace(/\.md$/i, '') : '';
        try {
            const tf = taskPath ? app.vault.getAbstractFileByPath(taskPath) : null;
            const tfm = tf ? TaskDocs._fmOf(app, tf) : null;
            if (tfm && tfm.title != null && String(tfm.title).trim()) taskTitle = String(tfm.title).trim();
        } catch (_e) {}
        const own = String(file.basename || '').toLowerCase();
        const taken = TaskDocs._takenNames(app);
        const name = TE && typeof TE.taskName === 'function'
            ? TE.taskName(t, { parentTitle: taskTitle, taken: (n) => String(n).toLowerCase() !== own && taken(n) })
            : t.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Note';
        const to = String(docPath).slice(0, String(docPath).lastIndexOf('/') + 1) + name + '.md';
        try {
            await app.fileManager.processFrontMatter(file, (fm) => { fm.title = t; });
            if (to !== String(docPath)) await app.fileManager.renameFile(file, to);
            return { ok: true, path: to };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
    }

    /**
     * Move the note at `docPath` to the task at `taskPath`: into that task's
     * notes/ folder (made when missing) with fileManager.renameFile, so links
     * follow; `task:` set to the new task; and named by the rule create uses
     * with the new task as parent (the plain title while unique, else
     * `Title (Task)`). The task must be in the folder layout. If the move
     * fails, `task:` is put back. Resolves { ok, path } or { ok: false, reason }.
     */
    static async moveTo(app, docPath, taskPath) {
        const file = app && app.vault ? app.vault.getAbstractFileByPath(docPath) : null;
        if (!file || Array.isArray(file.children)) return { ok: false, reason: 'note not found' };
        const folder = TaskDocs.notesFolder(taskPath);
        if (!folder) return { ok: false, reason: 'notes need a task in the folder layout' };
        const taskFile = app.vault.getAbstractFileByPath(taskPath);
        if (!taskFile || Array.isArray(taskFile.children)) return { ok: false, reason: 'task not found' };
        if (TaskDocs.taskPathOf(docPath) === String(taskPath)) return { ok: true, path: String(docPath), unchanged: true };
        const TE = TaskDocs._te();
        const fm = TaskDocs._fmOf(app, file) || {};
        const base = String(file.basename != null ? file.basename : String(docPath).split('/').pop().replace(/\.md$/i, ''));
        const title = fm.title != null && String(fm.title).trim() !== '' ? String(fm.title).trim() : base;
        const taskName = String(taskFile.basename != null ? taskFile.basename : String(taskPath).split('/').pop().replace(/\.md$/i, ''));
        const tfm = TaskDocs._fmOf(app, taskFile) || {};
        const taskTitle = tfm.title != null && String(tfm.title).trim() !== '' ? String(tfm.title).trim() : taskName;
        const own = base.toLowerCase();
        const taken = TaskDocs._takenNames(app);
        const name = TE && typeof TE.taskName === 'function'
            ? TE.taskName(title, { parentTitle: taskTitle, taken: (n) => String(n).toLowerCase() !== own && taken(n) })
            : title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Note';
        const to = folder + '/' + name + '.md';
        const priorTask = Object.prototype.hasOwnProperty.call(fm, 'task') ? fm.task : undefined;
        try {
            if (!app.vault.getAbstractFileByPath(folder)) {
                try { await app.vault.createFolder(folder); } catch (_e) { /* exists */ }
            }
            await app.fileManager.processFrontMatter(file, (f) => { f.task = '[[' + taskName + ']]'; });
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
        try {
            await app.fileManager.renameFile(file, to);
            return { ok: true, path: to };
        } catch (e) {
            try {
                await app.fileManager.processFrontMatter(file, (f) => {
                    if (priorTask === undefined) delete f.task; else f.task = priorTask;
                });
            } catch (_e) { /* best effort */ }
            return { ok: false, reason: String((e && e.message) || e) };
        }
    }

    /**
     * Swap `textEl` for a text input holding `current`; Enter or leaving the
     * field saves through `save(newTitle)` when the name changed, Escape
     * cancels. Clicks in the field never reach the row under it.
     */
    static _editTitle(host, textEl, current, save) {
        const input = host.createEl('input', { cls: 'sauce-tdv-rename-input', type: 'text' });
        input.value = current;
        try { input.setAttribute('aria-label', 'Note name'); input.setAttribute('enterkeyhint', 'done'); } catch (_e) {}
        textEl.style.display = 'none';
        host.classList.add('is-renaming');
        let done = false;
        const finish = async (commit) => {
            if (done) return;
            done = true;
            const v = String(input.value || '').replace(/\s+/g, ' ').trim();
            try { if (input.remove) input.remove(); else if (host.removeChild) host.removeChild(input); } catch (_e) {}
            textEl.style.display = '';
            host.classList.remove('is-renaming');
            if (commit && v && v !== current) await save(v);
        };
        const stop = (ev) => { try { ev.stopPropagation(); } catch (_e) {} };
        input.addEventListener('click', stop);
        input.addEventListener('mousedown', stop);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { try { ev.preventDefault(); } catch (_e) {} finish(true); }
            else if (ev.key === 'Escape') { try { ev.preventDefault(); } catch (_e) {} finish(false); }
        });
        input.addEventListener('blur', () => { finish(true); });
        try { input.focus(); input.select(); } catch (_e) {}
        return { input, finish };
    }

    // ----- Converting note-like subtasks -----

    /**
     * The kind a subtask titled `title` reads as when it is really a note,
     * or '' when it reads as a step. A trailing "(…)" clash qualifier is
     * ignored. Conservative on purpose: the user reviews every match.
     */
    static titleKind(title) {
        const t = String(title == null ? '' : title).replace(/\s*\([^()]*\)\s*(\d+)?\s*$/, '').trim().toLowerCase();
        if (!t) return '';
        if (/^hand-?off( prompt)?$/.test(t) || /^hand-?off prompt\b/.test(t) || /\bhand-?off$/.test(t)) return 'handoff';
        if (/^(the |initial |kickoff |major theme initial )?prompt\b/.test(t) || /\bprompt$/.test(t)) return 'prompt';
        if (/^(comms|communications?|message|messages|slack message|email|email draft|announcement)$/.test(t) || /\bcomms$/.test(t)) return 'comms';
        if (/^(proposed |the |initial )?plan$/.test(t)) return 'plan';
        if (/^questions?$/.test(t)) return 'questions';
        if (/^(context|explanation|background|summary)$/.test(t)) return 'context';
        if (/\b(impact|findings|analysis)$/.test(t)) return 'findings';
        return '';
    }

    static _fmOf(app, f) {
        try { return (app.metadataCache.getFileCache(f) || {}).frontmatter || null; } catch (_e) { return null; }
    }

    /** The task folder notes directly under the folder `dir` (not notes/). */
    static _childTasks(app, dir) {
        const folder = app.vault.getAbstractFileByPath(dir);
        const out = [];
        for (const c of (folder && folder.children) || []) {
            if (!Array.isArray(c.children)) continue;
            const name = String(c.path).split('/').pop();
            if (name === TaskDocs.FOLDER) continue;
            const note = app.vault.getAbstractFileByPath(c.path + '/' + name + '.md');
            const fm = note ? TaskDocs._fmOf(app, note) : null;
            if (note && fm && String(fm.type || '') === 'task') out.push({ file: note, folder: c, fm });
        }
        return out;
    }

    /**
     * Whether the subtask `node` ({ file, folder, fm }) can become a note:
     * its title reads as a note, its folder holds only its own note and
     * subtasks that can become notes too (no steps, no attachments, no notes
     * folder of its own), and it is not recurring.
     */
    static _convertible(app, node) {
        const title = node.fm.title != null && String(node.fm.title).trim() !== '' ? String(node.fm.title) : node.file.basename;
        if (!TaskDocs.titleKind(title) || String(node.fm.recurrence || '').trim()) return false;
        const name = String(node.folder.path).split('/').pop();
        for (const c of node.folder.children || []) {
            if (Array.isArray(c.children)) {
                const cname = String(c.path).split('/').pop();
                if (cname === TaskDocs.FOLDER) return false;
                const kid = TaskDocs._childTasks(app, node.folder.path).find((k) => k.folder === c);
                if (!kid || !TaskDocs._convertible(app, kid)) return false;
            } else if (c.path !== node.folder.path + '/' + name + '.md') {
                return false;
            }
        }
        return true;
    }

    /**
     * The subtasks of the task at `taskPath` that read as notes, with the
     * convertible subtasks under them, deepest last:
     * [{ path, title, kind, depth }]. Only for a live task in the folder
     * layout; [] otherwise. Never throws.
     */
    static candidates(app, taskPath) {
        try {
            const notesDir = TaskDocs.notesFolder(taskPath);
            if (!notesDir || !app || !app.vault) return [];
            const dir = notesDir.slice(0, -('/' + TaskDocs.FOLDER).length);
            const TE = TaskDocs._te();
            const parentPath = TE && typeof TE.parentNotePathOf === 'function' ? TE.parentNotePathOf(taskPath) : '';
            if (parentPath) {
                const self = TaskDocs._childTasks(app, parentPath.slice(0, parentPath.lastIndexOf('/'))).find((k) => k.file.path === taskPath);
                if (self && TaskDocs._convertible(app, self)) return [];
            }
            const out = [];
            const walk = (folderPath, depth) => {
                for (const kid of TaskDocs._childTasks(app, folderPath)) {
                    if (!TaskDocs._convertible(app, kid)) continue;
                    const title = kid.fm.title != null && String(kid.fm.title).trim() !== '' ? String(kid.fm.title).trim() : kid.file.basename;
                    out.push({ path: kid.file.path, title, kind: TaskDocs.titleKind(title), depth });
                    walk(kid.folder.path, depth + 1);
                }
            };
            walk(dir, 1);
            return out;
        } catch (_e) { return []; }
    }

    /** `text` with the task chrome taken out and the note header put in. */
    static _docBody(text, kind, taskName) {
        const s = String(text == null ? '' : text).replace(/\r\n/g, '\n');
        const m = /^---\n[\s\S]*?\n---\n?/.exec(s);
        const fm = m ? m[0] : '';
        let body = s.slice(fm.length);
        body = body.replace(/```dataviewjs\n[^`]*?class:\s*"(TaskChromeBar|TaskNoteView)"[^`]*?\n```\n?/g, '');
        body = body.replace(/^[ \t]*<!-- TASK_NOTES -->[ \t]*\n?/m, '');
        body = body.replace(/^\s+/, '');
        return TaskDocs.withHeader((fm.endsWith('\n') || !fm ? fm : fm + '\n') + '\n' + body);
    }

    static get _TASK_KEYS() {
        return ['status', 'due', 'recurrence', 'priority', 'project', 'project_slug', 'trip', 'trip_slug', 'source',
            'source_note', 'parent_task', 'links', 'completed_at', 'rank', 'scheduled'];
    }

    /**
     * Turn the subtasks `items` ([{ path, kind }], from candidates) into
     * notes of the task at `taskPath`: each note's frontmatter becomes a
     * task-doc (task-only keys dropped, title and created_at kept), its task
     * chrome is replaced by the note header, and it moves into the task's
     * notes folder with fileManager.renameFile so links follow. Deepest
     * first; emptied subtask folders are removed after. Resolves
     * { converted: [{ from, to }], failed: [{ path, reason }] }.
     */
    static async convert(app, taskPath, items) {
        const out = { converted: [], failed: [] };
        const notesDir = TaskDocs.notesFolder(taskPath);
        if (!notesDir) { out.failed.push({ path: taskPath, reason: 'not a task in the folder layout' }); return out; }
        const TE = TaskDocs._te();
        const taskFile = app.vault.getAbstractFileByPath(taskPath);
        const taskFm = taskFile ? TaskDocs._fmOf(app, taskFile) : null;
        const taskName = String(taskPath).split('/').pop().replace(/\.md$/i, '');
        const taskTitle = taskFm && taskFm.title != null && String(taskFm.title).trim() ? String(taskFm.title).trim() : taskName;
        const list = (items || []).slice().sort((a, b) => String(b.path).split('/').length - String(a.path).split('/').length);
        const emptied = [];
        if (!app.vault.getAbstractFileByPath(notesDir)) {
            try { await app.vault.createFolder(notesDir); } catch (_e) { /* exists */ }
        }
        for (const item of list) {
            const file = app.vault.getAbstractFileByPath(item.path);
            if (!file || Array.isArray(file.children)) { out.failed.push({ path: item.path, reason: 'not found' }); continue; }
            const kind = TaskDocs.kindOf(item.kind);
            try {
                await app.fileManager.processFrontMatter(file, (fm) => {
                    for (const k of TaskDocs._TASK_KEYS) delete fm[k];
                    fm.type = TaskDocs.TYPE;
                    fm.kind = kind;
                    if (fm.title == null || String(fm.title).trim() === '') fm.title = file.basename;
                    fm.task = '[[' + taskName + ']]';
                });
                await app.vault.process(file, (text) => TaskDocs._docBody(text, kind, taskName));
                const fm = TaskDocs._fmOf(app, file) || {};
                const title = fm.title != null && String(fm.title).trim() ? String(fm.title).trim() : file.basename;
                const own = String(file.basename).toLowerCase();
                const taken = TaskDocs._takenNames(app);
                const name = TE && typeof TE.taskName === 'function'
                    ? TE.taskName(title, { parentTitle: taskTitle, taken: (n) => n !== own && taken(n) })
                    : file.basename;
                const from = file.path;
                const oldDir = from.slice(0, from.lastIndexOf('/'));
                const to = notesDir + '/' + name + '.md';
                await app.fileManager.renameFile(file, to);
                emptied.push(oldDir);
                out.converted.push({ from, to });
            } catch (e) {
                out.failed.push({ path: item.path, reason: String((e && e.message) || e) });
            }
        }
        for (const dir of emptied) {
            try {
                const folder = app.vault.getAbstractFileByPath(dir);
                if (folder && Array.isArray(folder.children) && folder.children.length === 0) await app.vault.delete(folder);
            } catch (_e) { /* an emptied folder left behind is harmless */ }
        }
        return out;
    }

    /** The Review dialog: tick, pick a kind, Convert. Resolves the convert result or null. */
    static openReview(app, taskPath, cands) {
        return new Promise((resolve) => {
            const SM = window.customJS && window.customJS.SauceModal;
            const doc = typeof document !== 'undefined' ? document : null;
            if (!SM || typeof SM.open !== 'function' || !doc) { resolve(null); return; }
            const picks = cands.map((c) => ({ path: c.path, kind: c.kind, on: true }));
            let settled = false;
            const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
            const handle = SM.open({
                doc,
                title: 'Turn subtasks into notes',
                body: (body) => {
                    body.createEl('div', { cls: 'sauce-tnv-review-copy', text: 'These subtasks read like notes. Converted ones move into this task\'s notes, stop counting as steps, and keep their links.' });
                    const list = body.createEl('div', { cls: 'sauce-tnv-review' });
                    cands.forEach((c, i) => {
                        const row = list.createEl('label', { cls: 'sauce-tnv-review-row' });
                        row.style.paddingLeft = (8 + (c.depth - 1) * 18) + 'px';
                        const box = row.createEl('input', { type: 'checkbox' });
                        box.checked = true;
                        box.addEventListener('change', () => { picks[i].on = !!box.checked; });
                        row.createEl('span', { cls: 'sauce-tnv-review-title', text: c.title });
                        const sel = row.createEl('select', { cls: 'sauce-tnv-review-kind dropdown' });
                        for (const k of TaskDocs.KINDS) {
                            const opt = sel.createEl('option', { text: k.label });
                            opt.value = k.key;
                            if (k.key === c.kind) opt.selected = true;
                        }
                        sel.addEventListener('change', () => { picks[i].kind = sel.value; });
                    });
                },
                buttons: [
                    { label: 'Cancel', action: 'cancel' },
                    {
                        label: 'Convert',
                        tone: 'primary',
                        close: false,
                        onClick: async (api, event) => {
                            const button = event && (event.currentTarget || event.target);
                            try { if (button) button.disabled = true; } catch (_e) {}
                            const chosen = picks.filter((p) => p.on).map((p) => ({ path: p.path, kind: p.kind }));
                            const res = chosen.length ? await TaskDocs.convert(app, taskPath, chosen) : { converted: [], failed: [] };
                            const n = res.converted.length;
                            TaskDocs._notice(n ? 'Converted ' + n + (n === 1 ? ' subtask' : ' subtasks') + ' into notes'
                                + (res.failed.length ? '; ' + res.failed.length + ' could not be converted' : '') : 'Nothing converted', 5000);
                            finish(res);
                            api.close('convert');
                        },
                    },
                ],
                onClose: () => finish(null),
            });
            if (!handle) finish(null);
        });
    }

    // ----- Comms: Mark sent, follow-up, Waiting -----
    // Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md §1.
    // A comms note carries to, via, sent_at and replied_at. It is waiting
    // while sent_at is set, replied_at is blank and no follow-up task linked
    // to it (source: comms, source_note: [[note]]) is done, so finishing the
    // follow-up in To-Do counts as a reply without writing to the note.

    static get VIAS() { return ['Slack', 'Email', 'Teams', 'Other']; }

    static get FOLLOW_UPS() {
        return [
            { key: 'none', label: 'None' },
            { key: 'tomorrow', label: 'Tomorrow' },
            { key: 'two', label: 'In 2 work days' },
            { key: 'monday', label: 'Next Monday' },
        ];
    }

    /** One of VIAS for `value` (any case), or '' when it is none of them. */
    static _via(value) {
        const v = String(value == null ? '' : value).trim().toLowerCase();
        return TaskDocs.VIAS.find((x) => x.toLowerCase() === v) || '';
    }

    /** A frontmatter date (string, Luxon DateTime or Date) as its ISO text; '' when blank. */
    static _isoOf(v) {
        if (v == null) return '';
        if (typeof v === 'string') return v.trim();
        try { if (typeof v.toISO === 'function') return String(v.toISO() || ''); } catch (_e) {}
        try { if (typeof v.toISOString === 'function') return String(v.toISOString()); } catch (_e) {}
        return String(v).trim();
    }

    static _dayOf(v) {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(TaskDocs._isoOf(v));
        return m ? m[1] : '';
    }

    static _daysBetween(from, to) {
        const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from || ''));
        const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(to || ''));
        if (!a || !b) return null;
        return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
    }

    static _shortDay(day) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
        return m ? TaskDocs._MONTHS[+m[2] - 1] + ' ' + (+m[3]) : '';
    }

    static _weekdayDay(day) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
        if (!m) return '';
        const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
        return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow] + ' ' + TaskDocs._shortDay(day);
    }

    static _linkBase(v) {
        let s = String(v == null ? '' : (typeof v === 'object' && v.path ? v.path : v)).trim();
        s = s.replace(/^\[\[|\]\]$/g, '').split('|')[0];
        return s.split('/').pop().replace(/\.md$/i, '').trim();
    }

    /**
     * Where a comms note stands: { state: 'unsent' } before Mark sent, else
     * { state: 'waiting' | 'answered', sentDay, sentLabel, via, to, days,
     * repliedDay }. `followUps` are its follow-up tasks ([{ status }]); one
     * that is done answers it. `days` counts calendar days from the sent day
     * to `today` (null without a today). Pure.
     */
    static commsState(fm, followUps, today) {
        const f = fm || {};
        const sentAt = TaskDocs._isoOf(f.sent_at);
        if (!sentAt) return { state: 'unsent' };
        const sentDay = TaskDocs._dayOf(sentAt);
        const repliedDay = TaskDocs._dayOf(f.replied_at);
        const answered = !!TaskDocs._isoOf(f.replied_at)
            || (Array.isArray(followUps) && followUps.some((t) => t && String(t.status || '').toLowerCase() === 'done'));
        const diff = TaskDocs._daysBetween(sentDay, today);
        return {
            state: answered ? 'answered' : 'waiting',
            sentDay,
            sentLabel: sentDay ? 'Sent ' + TaskDocs._shortDay(sentDay) : 'Sent',
            via: String(f.via == null ? '' : f.via).trim(),
            to: Array.isArray(f.to) ? f.to.join(', ') : String(f.to == null ? '' : f.to).trim(),
            days: diff == null ? null : Math.max(0, diff),
            repliedDay,
        };
    }

    /** `Waiting 2d`, or `Waiting` on the day it was sent or with no day. Pure. */
    static waitingText(days) {
        return Number.isFinite(days) && days > 0 ? 'Waiting ' + days + 'd' : 'Waiting';
    }

    /** The header card chip: `Sent Nov 13 · Slack · waiting 2d` (or `· replied …`). '' when unsent. Pure. */
    static commsChip(st) {
        if (!st || st.state === 'unsent') return '';
        const tail = st.state === 'waiting'
            ? TaskDocs.waitingText(st.days).toLowerCase()
            : 'replied' + (st.repliedDay ? ' ' + TaskDocs._shortDay(st.repliedDay) : '');
        return [st.sentLabel, st.via, tail].filter(Boolean).join(' · ');
    }

    /** A Dataview page of a comms note as the plain item `waiting` reads. */
    static commsItem(page) {
        const p = page || {};
        const path = String((p.file && p.file.path) || p.path || '');
        const name = path.split('/').pop().replace(/\.md$/i, '');
        const str = (v) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join(', ') : String(v == null ? '' : v).trim());
        return {
            path,
            kind: TaskDocs.kindOf(p.kind),
            title: str(p.title) || name,
            to: str(p.to),
            via: str(p.via),
            sent_at: TaskDocs._isoOf(p.sent_at),
            replied_at: TaskDocs._isoOf(p.replied_at),
        };
    }

    /**
     * The comms notes in `items` (commsItem shape) that are waiting, oldest
     * sent first, each with its task: { …item, taskPath, taskTitle, days }.
     * `tasks` are parsed task notes; a done one with source: comms and a
     * source_note naming the note answers it. Notes under _done/ or _trash/
     * are skipped: their task is finished. Pure.
     */
    static waiting(items, tasks, today) {
        const list = Array.isArray(tasks) ? tasks : [];
        const answered = new Set();
        const byPath = new Map();
        for (const t of list) {
            if (!t) continue;
            if (t.path) byPath.set(String(t.path), t);
            if (String(t.source || '') === 'comms' && String(t.status || '').toLowerCase() === 'done') {
                const base = TaskDocs._linkBase(t.source_note);
                if (base) answered.add(base.toLowerCase());
            }
        }
        const out = [];
        for (const item of Array.isArray(items) ? items : []) {
            if (!item || TaskDocs.kindOf(item.kind) !== 'comms') continue;
            const path = String(item.path || '');
            if (!path || TaskDocs._closed(path)) continue;
            const base = path.split('/').pop().replace(/\.md$/i, '').toLowerCase();
            const st = TaskDocs.commsState(item, answered.has(base) ? [{ status: 'done' }] : [], today);
            if (st.state !== 'waiting') continue;
            const taskPath = TaskDocs.taskPathOf(path);
            const task = taskPath ? byPath.get(taskPath) : null;
            const taskTitle = task && task.title ? String(task.title) : (taskPath ? taskPath.split('/').pop().replace(/\.md$/i, '') : '');
            out.push(Object.assign({}, item, { taskPath, taskTitle, days: st.days, sentDay: st.sentDay }));
        }
        const when = (x) => { const t = Date.parse(x.sent_at); return Number.isFinite(t) ? t : Infinity; };
        out.sort((a, b) => (when(a) - when(b)) || String(a.sent_at).localeCompare(String(b.sent_at)) || a.title.localeCompare(b.title));
        return out;
    }

    /**
     * Every comms follow-up task in the vault by the note it names: a map of
     * lower-cased source_note basename to [{ path, status }]. The same match
     * `waiting` makes over Dataview's tasks, so the header card, the Notes
     * rows and the Waiting tab always agree. Never throws.
     */
    static _followUpIndex(app) {
        const map = new Map();
        try {
            for (const f of app.vault.getMarkdownFiles() || []) {
                if (!f || !/^spice\/tasks\//.test(String(f.path || ''))) continue;
                const fm = TaskDocs._fmOf(app, f);
                if (!fm || String(fm.type || '') !== 'task' || String(fm.source || '') !== 'comms') continue;
                const base = TaskDocs._linkBase(fm.source_note).toLowerCase();
                if (!base) continue;
                if (!map.has(base)) map.set(base, []);
                map.get(base).push({ path: f.path, status: String(fm.status || 'open').trim().toLowerCase() || 'open' });
            }
        } catch (_e) {}
        return map;
    }

    /** The follow-up tasks of the comms note at `docPath`: any task with source: comms naming it in source_note. */
    static followUps(app, docPath, index) {
        try {
            if (!app || !app.vault) return [];
            const name = String(docPath).split('/').pop().replace(/\.md$/i, '').toLowerCase();
            return ((index || TaskDocs._followUpIndex(app)).get(name) || []).slice();
        } catch (_e) { return []; }
    }

    static _closed(path) { return /(^|\/)_(done|trash)\//.test(String(path || '')); }

    /** The notice after Got reply when some follow-up tasks could not be closed; '' when all were. Pure. */
    static replyNotice(res) {
        const n = res && Number.isFinite(res.failed) ? res.failed : 0;
        return n > 0 ? 'Reply saved; ' + n + (n === 1 ? ' follow-up' : ' follow-ups') + ' still open' : '';
    }

    /** `day` plus `n` working days (Saturday and Sunday skipped). Pure. */
    static addWorkDays(day, n) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
        if (!m) return '';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        let left = Math.max(0, Number(n) || 0);
        while (left > 0) {
            d.setUTCDate(d.getUTCDate() + 1);
            const dow = d.getUTCDay();
            if (dow !== 0 && dow !== 6) left -= 1;
        }
        const p = (x) => String(x).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }

    /**
     * The follow-up task's due date for a Follow up choice: 'none' → '',
     * 'tomorrow', 'two' (in 2 work days), 'monday' (next Monday, a week on
     * from a Monday), or a YYYY-MM-DD date as itself. Pure.
     */
    static followUpDate(choice, today) {
        const c = String(choice == null ? '' : choice).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return c;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))) return '';
        if (c === 'tomorrow') return TaskDocs._plusDays(today, 1);
        if (c === 'two') return TaskDocs.addWorkDays(today, 2);
        if (c === 'monday') {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
            const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
            return TaskDocs._plusDays(today, ((1 - dow + 7) % 7) || 7);
        }
        return '';
    }

    static _plusDays(day, n) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
        if (!m) return '';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(n) || 0)));
        const p = (x) => String(x).padStart(2, '0');
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    }

    /** The first names in a `to:` value: `Jason Batai, Matt Hemingway` → `Jason and Matt`. Pure. */
    static firstNames(to) {
        const names = String(to == null ? '' : to)
            .split(/\s*(?:,|;|&|\+|\/|\band\b)\s*/i)
            .map((part) => part.trim().split(/\s+/)[0] || '')
            .map((word) => word.replace(/^@/, '').replace(/@.*$/, ''))
            .filter(Boolean);
        if (names.length <= 1) return names[0] || '';
        return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    }

    /** `Hear back from <first name(s)>: <note title>`; `Hear back: <note title>` with no one named. Pure. */
    static followUpTitle(to, noteTitle) {
        const who = TaskDocs.firstNames(to);
        const what = String(noteTitle == null ? '' : noteTitle).trim() || 'Comms';
        return (who ? 'Hear back from ' + who : 'Hear back') + ': ' + what;
    }

    static _td() {
        try { return (typeof window !== 'undefined' && window.customJS && window.customJS.TaskDialog) || null; }
        catch (_e) { return null; }
    }

    /**
     * Mark the comms note at `docPath` sent: writes to, via, sent_at (opts.stamp)
     * and a blank replied_at, then, when opts.due is set, creates the
     * follow-up subtask of the note's task through TaskDialog.createQuick
     * (the + subtask path): `Hear back from …: <title>`, due opts.due,
     * source: comms, source_note: [[note]]. Resolves { ok, followUp } where
     * followUp is the new task's path, '' when none was asked for, or null
     * when it could not be made; { ok: false, reason } when the note could
     * not be written.
     */
    static async markSent(app, docPath, opts) {
        const o = opts || {};
        const file = app && app.vault ? app.vault.getAbstractFileByPath(docPath) : null;
        if (!file || Array.isArray(file.children)) return { ok: false, reason: 'note not found' };
        const to = String(o.to == null ? '' : o.to).replace(/\s+/g, ' ').trim();
        const via = TaskDocs._via(o.via) || String(o.via || '').trim();
        const stamp = String(o.stamp || TaskDocs._stamp());
        let title = String(file.basename || '');
        try {
            await app.fileManager.processFrontMatter(file, (fm) => {
                if (fm.title != null && String(fm.title).trim()) title = String(fm.title).trim();
                fm.to = to;
                fm.via = via;
                fm.sent_at = stamp;
                fm.replied_at = '';
            });
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
        const due = String(o.due || '').trim();
        if (!due) return { ok: true, followUp: '' };
        const taskPath = TaskDocs.taskPathOf(docPath);
        const TD = TaskDocs._td();
        if (!taskPath || !TD || typeof TD.createQuick !== 'function') return { ok: true, followUp: null };
        try {
            const res = await TD.createQuick({
                title: TaskDocs.followUpTitle(to, title),
                today: due,
                source: 'comms',
                source_note: '[[' + file.basename + ']]',
                parent_task: '[[' + taskPath.split('/').pop().replace(/\.md$/i, '') + ']]',
            });
            return { ok: true, followUp: res && res.ok && res.path ? res.path : null };
        } catch (_e) {
            return { ok: true, followUp: null };
        }
    }

    /**
     * Got reply on the comms note at `docPath`: sets replied_at to `stamp`
     * and marks each of its open follow-up tasks done (TaskDialog.markDone).
     * Resolves { ok, closed, failed } or { ok: false, reason }.
     */
    static async gotReply(app, docPath, stamp) {
        const file = app && app.vault ? app.vault.getAbstractFileByPath(docPath) : null;
        if (!file || Array.isArray(file.children)) return { ok: false, reason: 'note not found' };
        try {
            await app.fileManager.processFrontMatter(file, (fm) => { fm.replied_at = String(stamp || TaskDocs._stamp()); });
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
        const TD = TaskDocs._td();
        let closed = 0;
        let failed = 0;
        for (const t of TaskDocs.followUps(app, docPath)) {
            if (t.status !== 'open') continue;
            let res = null;
            try { res = TD && typeof TD.markDone === 'function' ? await TD.markDone(t.path) : null; } catch (_e) { res = null; }
            if (res && res.ok !== false) closed += 1; else failed += 1;
        }
        return { ok: true, closed, failed };
    }

    static _isPhone(app) {
        try {
            if (app && app.isMobile) return true;
            return typeof document !== 'undefined' && !!document.body && !!document.body.classList && document.body.classList.contains('is-phone');
        } catch (_e) { return false; }
    }

    /**
     * A small panel anchored under `opts.anchor` (a bottom sheet on a phone),
     * built by opts.build(body, close). Escape, a click outside it, or close()
     * dismisses it; one is open at a time. Returns { panel, body, close } or
     * null with no document.
     */
    static _openPanel(opts) {
        const o = opts || {};
        const doc = o.doc || (typeof document !== 'undefined' ? document : null);
        if (!doc || !doc.body || typeof doc.body.createEl !== 'function') return null;
        TaskDocs._injectCss();
        try { if (TaskDocs._panel) TaskDocs._panel.close(); } catch (_e) {}
        const sheet = TaskDocs._isPhone(o.app);
        const overlay = doc.body.createEl('div', { cls: 'sauce-tdv-pop-overlay' + (sheet ? ' is-sheet' : '') });
        const panel = overlay.createEl('div', { cls: 'sauce-tdv-pop' + (o.cls ? ' ' + o.cls : '') });
        try { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', o.title || 'Panel'); } catch (_e) {}
        if (o.title) panel.createEl('div', { cls: 'sauce-tdv-pop-title', text: o.title });
        const body = panel.createEl('div', { cls: 'sauce-tdv-pop-body' });
        let closed = false;
        const onKey = (ev) => { if (ev && ev.key === 'Escape') { try { ev.preventDefault(); } catch (_e) {} close(); } };
        const close = () => {
            if (closed) return;
            closed = true;
            try { doc.removeEventListener('keydown', onKey, true); } catch (_e) {}
            try { overlay.remove(); } catch (_e) {}
            if (TaskDocs._panel && TaskDocs._panel.panel === panel) TaskDocs._panel = null;
        };
        try { doc.addEventListener('keydown', onKey, true); } catch (_e) {}
        overlay.addEventListener('mousedown', (ev) => { if (ev && ev.target === overlay) close(); });
        overlay.addEventListener('click', (ev) => { try { ev.stopPropagation(); } catch (_e) {} });
        if (typeof o.build === 'function') o.build(body, close);
        if (!sheet) {
            try {
                const r = o.anchor && typeof o.anchor.getBoundingClientRect === 'function' ? o.anchor.getBoundingClientRect() : null;
                const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
                const vh = (typeof window !== 'undefined' && window.innerHeight) || 768;
                const w = Math.min(320, vw - 16);
                const h = panel.offsetHeight || 0;
                const left = r ? Math.max(8, Math.min(r.left, vw - w - 8)) : (vw - w) / 2;
                let top = r ? r.bottom + 6 : 80;
                if (r && h && top + h > vh - 8) top = Math.max(8, r.top - h - 6);
                panel.style.left = left + 'px';
                panel.style.top = top + 'px';
            } catch (_e) {}
        }
        const handle = { panel, body, close };
        TaskDocs._panel = handle;
        return handle;
    }

    /**
     * The Mark sent panel: To (prefilled), Via (four choices) and Follow up
     * (None, Tomorrow, In 2 work days, Next Monday, or a date). Saving closes
     * it and calls opts.onSave({ to, via, due }) with due '' for no follow-up.
     * Returns the panel handle, or null.
     */
    static openSendPanel(opts) {
        const o = opts || {};
        const today = String(o.today || '');
        const state = { to: String(o.to == null ? '' : o.to).trim(), via: TaskDocs._via(o.via) || 'Slack', follow: 'two', date: '' };
        return TaskDocs._openPanel({
            app: o.app, anchor: o.anchor, doc: o.doc, title: 'Mark sent', cls: 'is-send',
            build: (body, close) => {
                const field = (label) => {
                    const wrap = body.createEl('div', { cls: 'sauce-tdv-pop-field' });
                    wrap.createEl('div', { cls: 'sauce-tdv-pop-label', text: label });
                    return wrap;
                };
                const toInput = field('To').createEl('input', { cls: 'sauce-tdv-pop-input', type: 'text' });
                toInput.value = state.to;
                try { toInput.setAttribute('placeholder', 'Who it went to'); toInput.setAttribute('aria-label', 'To'); toInput.setAttribute('enterkeyhint', 'done'); } catch (_e) {}
                toInput.addEventListener('input', () => { state.to = String(toInput.value || ''); });
                const pills = (host, items, isOn, pick) => {
                    const group = host.createEl('div', { cls: 'sauce-tdv-pop-pills' });
                    const buttons = items.map((it) => {
                        const b = group.createEl('button', { cls: 'sauce-tdv-pill', text: it.label });
                        try { b.setAttribute('type', 'button'); } catch (_e) {}
                        b.addEventListener('click', () => { pick(it.key); paint(); });
                        return { b, key: it.key };
                    });
                    const paint = () => {
                        for (const x of buttons) {
                            const on = isOn(x.key);
                            x.b.className = 'sauce-tdv-pill' + (on ? ' is-on' : '');
                            try { x.b.setAttribute('aria-pressed', on ? 'true' : 'false'); } catch (_e) {}
                        }
                    };
                    paint();
                    return { group, paint };
                };
                pills(field('Via'), TaskDocs.VIAS.map((v) => ({ key: v, label: v })), (k) => state.via === k, (k) => { state.via = k; });
                const followField = field('Follow up');
                let hint = null;
                let dateInput = null;
                const paintHint = () => {
                    const due = TaskDocs.followUpDate(state.follow === 'date' ? state.date : state.follow, today);
                    if (hint) hint.textContent = state.follow === 'none' ? 'No follow-up task' : (due ? 'Follow-up task due ' + TaskDocs._weekdayDay(due) : 'Pick a date');
                };
                const follow = pills(followField, TaskDocs.FOLLOW_UPS, (k) => state.follow === k, (k) => {
                    state.follow = k;
                    if (dateInput) dateInput.value = '';
                    state.date = '';
                    paintHint();
                });
                dateInput = follow.group.createEl('input', { cls: 'sauce-tdv-pop-date', type: 'date' });
                try { dateInput.setAttribute('aria-label', 'Follow up on a date'); } catch (_e) {}
                const onDate = () => {
                    state.date = String(dateInput.value || '');
                    state.follow = state.date ? 'date' : 'two';
                    follow.paint();
                    paintHint();
                };
                dateInput.addEventListener('change', onDate);
                dateInput.addEventListener('input', onDate);
                hint = followField.createEl('div', { cls: 'sauce-tdv-pop-hint' });
                paintHint();
                const foot = body.createEl('div', { cls: 'sauce-tdv-pop-foot' });
                const cancel = foot.createEl('button', { cls: 'sauce-btn', text: 'Cancel' });
                const save = foot.createEl('button', { cls: 'sauce-btn sauce-btn-accent sauce-tdv-pop-save', text: 'Mark sent' });
                try { cancel.setAttribute('type', 'button'); save.setAttribute('type', 'button'); } catch (_e) {}
                cancel.addEventListener('click', () => close());
                let saving = false;
                const submit = async () => {
                    if (saving) return;
                    const due = state.follow === 'none' ? '' : TaskDocs.followUpDate(state.follow === 'date' ? state.date : state.follow, today);
                    if (state.follow !== 'none' && !due) { paintHint(); return; }
                    saving = true;
                    close();
                    if (typeof o.onSave === 'function') await o.onSave({ to: String(state.to || '').replace(/\s+/g, ' ').trim(), via: state.via, due });
                };
                save.addEventListener('click', submit);
                toInput.addEventListener('keydown', (ev) => {
                    if (ev && ev.key === 'Enter' && !ev.isComposing) { try { ev.preventDefault(); } catch (_e) {} submit(); }
                });
                if (!TaskDocs._isPhone(o.app)) { try { toInput.focus(); } catch (_e) {} }
            },
        });
    }

    /**
     * One row of To-Do's Waiting tab for `item` (from waiting): the comms
     * icon and title (opens the note), to whom and via what, how long ago it
     * was sent, the parent task (opens it), and Got reply, which writes
     * through RenderSafe.mutate, takes the row out at once and puts it back
     * if the write fails. opts.onReplied(item, stamp) runs after a reply is
     * saved. Returns the row.
     */
    static renderWaitingRow(container, item, opts) {
        if (!container || typeof container.createEl !== 'function' || !item) return null;
        const o = opts || {};
        const app = o.app || (typeof window !== 'undefined' ? window.app : null);
        TaskDocs._injectCss();
        const open = (target) => (ev) => {
            try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
            try { app.workspace.openLinkText(target, '', false); } catch (_e) {}
        };
        const row = container.createEl('div', { cls: 'sauce-tdv-wait' });
        try { if (row.dataset) row.dataset.path = String(item.path || ''); } catch (_e) {}
        const ic = row.createEl('span', { cls: 'sauce-tdv-wait-icon' });
        ic.innerHTML = TaskDocs._kind('comms').icon;
        const main = row.createEl('div', { cls: 'sauce-tdv-wait-main' });
        const titleEl = main.createEl('a', { cls: 'sauce-tdv-wait-title', text: item.title || 'Comms', href: '#' });
        titleEl.addEventListener('click', open(item.path));
        const meta = main.createEl('div', { cls: 'sauce-tdv-wait-meta' });
        const sent = Number.isFinite(item.days) ? (item.days > 0 ? 'Sent ' + item.days + 'd ago' : 'Sent today') : 'Sent';
        const parts = [item.to ? 'To ' + item.to : '', item.via, sent].filter(Boolean);
        meta.createEl('span', { text: parts.join(' · ') });
        if (item.taskPath) {
            meta.createEl('span', { cls: 'sauce-tdv-sep', text: '·' });
            const t = meta.createEl('a', { cls: 'sauce-tdv-wait-task', text: '↳ ' + (item.taskTitle || 'Task'), href: '#' });
            t.addEventListener('click', open(item.taskPath));
        }
        const reply = row.createEl('button', { cls: 'sauce-tdv-wait-reply', text: 'Got reply' });
        try { reply.setAttribute('type', 'button'); reply.setAttribute('aria-label', 'Got reply: ' + (item.title || 'Comms')); } catch (_e) {}
        reply.addEventListener('click', async (ev) => {
            try { if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
            const RenderSafe = typeof window !== 'undefined' && window.customJS ? window.customJS.RenderSafe : null;
            if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskDocs._notice('Could not mark the reply right now', 4000); return; }
            const stamp = TaskDocs._stamp();
            const parent = row.parentNode;
            const next = row.nextSibling;
            const res = await RenderSafe.mutate({
                app,
                path: item.path,
                failureMessage: 'Could not mark the reply',
                optimistic: () => { try { row.remove(); } catch (_e) {} },
                write: async () => {
                    const r = await TaskDocs.gotReply(app, item.path, stamp);
                    if (!r.ok) throw new Error(r.reason);
                    return r;
                },
                revert: () => { try { if (parent) parent.insertBefore(row, next && next.parentNode === parent ? next : null); } catch (_e) {} },
            });
            if (res && res.ok) {
                TaskDocs.markSeen(item.path);
                const warn = TaskDocs.replyNotice(res.value);
                if (warn) TaskDocs._notice(warn, 6000);
                try { if (typeof o.onReplied === 'function') o.onReplied(item, stamp); } catch (_e) {}
            }
        });
        return row;
    }

    // ----- Claude loop: Copy for Claude, New notes, Resume -----
    // Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md §2.

    /**
     * The context block Copy for Claude adds after a prompt: where the task
     * is, where its notes go, and how to write results there. info =
     * { taskTitle, taskName, taskPath, notesPath }. Pure.
     */
    static claudeContext(info) {
        const i = info || {};
        const name = String(i.taskName || i.taskTitle || '').trim();
        const notes = String(i.notesPath || '').replace(/[\\/]+$/, '');
        return [
            '---',
            'Task: ' + String(i.taskTitle || name).trim() + ' (' + String(i.taskPath || '').trim() + ')',
            'Notes folder: ' + notes + '/',
            'Write results there as new notes with frontmatter type: task-doc, kind: findings, comms or handoff, title:, task: "[[' + name + ']]" and created_at: (ISO), then the two dataviewjs header blocks the other notes in that folder start with.',
            'On a handoff, also set session: to this session\'s URL or id.',
        ].join('\n');
    }

    /** `prompt`, a blank line, then claudeContext(info). Pure. */
    static forClaude(prompt, info) {
        return String(prompt == null ? '' : prompt).replace(/\s+$/, '') + '\n\n' + TaskDocs.claudeContext(info);
    }

    /**
     * What Resume does with a handoff's `session:` value: { kind: 'url', url }
     * for an http(s) link or a bare claude.ai/ one (https added),
     * { kind: 'id', id, command: 'claude --resume <id>' } for an id of
     * letters, digits, _ and -, { kind: 'invalid', value } for anything else,
     * null when blank. Pure.
     */
    static resumeAction(session) {
        const s = String(session == null ? '' : session).trim();
        if (!s) return null;
        if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s };
        if (/^claude\.ai\//i.test(s)) return { kind: 'url', url: 'https://' + s };
        if (/^[A-Za-z0-9_-]+$/.test(s)) return { kind: 'id', id: s, command: 'claude --resume ' + s };
        return { kind: 'invalid', value: s };
    }

    static get SEEN_KEY() { return 'sauce-taskdoc-seen'; }
    static get NEW_DAYS() { return 14; }

    static _storage() {
        try { return typeof window !== 'undefined' ? window.localStorage : null; } catch (_e) { return null; }
    }

    /** This device's { path: epochMs } of when each note was last viewed. Never throws. */
    static readSeen(storage) {
        const S = storage !== undefined ? storage : TaskDocs._storage();
        let raw = null;
        try { raw = S && typeof S.getItem === 'function' ? S.getItem(TaskDocs.SEEN_KEY) : null; } catch (_e) { raw = null; }
        const memo = TaskDocs._seenMemo;
        if (memo && memo.store === S && memo.raw === raw) return memo.map;
        const map = {};
        try {
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                for (const [k, v] of Object.entries(parsed)) if (Number.isFinite(v)) map[k] = v;
            }
        } catch (_e) {}
        TaskDocs._seenMemo = { store: S, raw, map };
        return map;
    }

    /**
     * Record that the note at `path` was viewed at `at` (default now), and
     * drop records older than NEW_DAYS: a note changed before then is never
     * new, seen or not. Best effort; never throws.
     */
    static markSeen(path, at, storage) {
        const p = String(path == null ? '' : path);
        if (!p) return;
        const S = storage !== undefined ? storage : TaskDocs._storage();
        const when = Number.isFinite(at) ? at : Date.now();
        const map = Object.assign({}, TaskDocs.readSeen(S));
        map[p] = Math.max(when, map[p] || 0);
        const keep = TaskDocs.NEW_DAYS * 86400000;
        for (const k of Object.keys(map)) if (when - map[k] > keep) delete map[k];
        try { if (S && typeof S.setItem === 'function') S.setItem(TaskDocs.SEEN_KEY, JSON.stringify(map)); } catch (_e) {}
    }

    static _moveSeen(from, to, storage) {
        const S = storage !== undefined ? storage : TaskDocs._storage();
        const map = Object.assign({}, TaskDocs.readSeen(S));
        if (!from || !to || !map[from]) return;
        map[to] = Math.max(map[to] || 0, map[from]);
        delete map[from];
        try { if (S && typeof S.setItem === 'function') S.setItem(TaskDocs.SEEN_KEY, JSON.stringify(map)); } catch (_e) {}
    }

    /** Whether a note changed at `mtime` is new: later than `seenAt` and within NEW_DAYS of `now`. Pure. */
    static isNew(mtime, seenAt, now) {
        const m = Number(mtime) || 0;
        const n = Number(now) || 0;
        if (!m || !n || n - m > TaskDocs.NEW_DAYS * 86400000) return false;
        return m > (Number(seenAt) || 0);
    }

    /** The task's new notes ([{ path, title, mtime }], newest first) on this device. Never throws. */
    static newNotes(app, taskPath, now, seen) {
        try {
            const folder = TaskDocs.notesFolder(taskPath);
            if (!folder || !app || !app.vault || typeof app.vault.getAbstractFileByPath !== 'function') return [];
            const dir = app.vault.getAbstractFileByPath(folder);
            if (!dir || !Array.isArray(dir.children)) return [];
            const map = seen || TaskDocs.readSeen();
            const out = [];
            for (const f of dir.children) {
                if (!f || Array.isArray(f.children) || !/\.md$/i.test(String(f.path || ''))) continue;
                const mtime = (f.stat && f.stat.mtime) || 0;
                if (!TaskDocs.isNew(mtime, map[f.path], now)) continue;
                const fm = TaskDocs._fmOf(app, f);
                if (fm && String(fm.type || '') === 'task') continue;
                const base = String(f.basename != null ? f.basename : f.path.split('/').pop().replace(/\.md$/i, ''));
                out.push({ path: f.path, title: fm && fm.title != null && String(fm.title).trim() ? String(fm.title).trim() : base, mtime });
            }
            out.sort((a, b) => b.mtime - a.mtime);
            return out;
        } catch (_e) { return []; }
    }

    /**
     * Keep the seen record in step with what happens on this device: an edit
     * to a note while it is the open file counts as seeing it (your own
     * typing never marks it new), and a renamed note keeps its record.
     * Installed once per app; a reloaded class replaces the old listeners.
     */
    static _installSeenHook(app) {
        try {
            if (typeof window === 'undefined' || !app || !app.vault || typeof app.vault.on !== 'function') return;
            const prior = window.__sauceTaskDocSeenHook;
            if (prior && prior.cls === TaskDocs && prior.app === app) return;
            if (prior && prior.app && prior.app.vault && typeof prior.app.vault.offref === 'function') {
                for (const ref of prior.refs || []) { try { prior.app.vault.offref(ref); } catch (_e) {} }
            }
            const isNote = (p) => /^spice\/tasks\/.*\/notes\/[^/]+\.md$/i.test(String(p || ''));
            const refs = [
                app.vault.on('modify', (f) => {
                    try {
                        if (!f || !isNote(f.path)) return;
                        const active = app.workspace && typeof app.workspace.getActiveFile === 'function' ? app.workspace.getActiveFile() : null;
                        if (active && active.path === f.path) TaskDocs.markSeen(f.path);
                    } catch (_e) {}
                }),
                app.vault.on('rename', (f, oldPath) => {
                    try { if (f && isNote(f.path)) TaskDocs._moveSeen(oldPath, f.path); } catch (_e) {}
                }),
            ];
            window.__sauceTaskDocSeenHook = { cls: TaskDocs, app, refs };
        } catch (_e) {}
    }

    static _today() {
        try { return typeof window !== 'undefined' && typeof window.moment === 'function' ? window.moment().format('YYYY-MM-DD') : ''; }
        catch (_e) { return ''; }
    }

    static _ago(mtime, now) {
        const ms = Math.max(0, (now || Date.now()) - (mtime || 0));
        const min = Math.floor(ms / 60000);
        if (!mtime) return '';
        if (min < 1) return 'just now';
        if (min < 60) return min + 'm ago';
        const h = Math.floor(min / 60);
        if (h < 24) return h + 'h ago';
        const d = Math.floor(h / 24);
        if (d < 30) return d + 'd ago';
        try { return new Date(mtime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (_e) { return ''; }
    }

    static get _CSS() {
        return [
            '.sauce-tnv-notes { display: flex; flex-direction: column; gap: 2px; }',
            '.sauce-tnv-doc { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--radius-s, 6px); min-width: 0; }',
            '@media (hover: hover) { .sauce-tnv-doc:hover { background: var(--background-modifier-hover); } }',
            '.sauce-tnv-doc-icon { display: inline-flex; flex-shrink: 0; color: var(--text-muted); }',
            ...Object.entries(TaskDocs.TONES).map(([k, c]) => '.sauce-tnv-doc.is-' + k + ', .sauce-tdv[data-kind="' + k + '"] { --tdv-accent: ' + c + '; }'),
            '.sauce-tnv-doc .sauce-tnv-doc-icon { color: var(--tdv-accent, var(--text-muted)); }',
            '.sauce-tdv { --tdv-accent: var(--text-muted); position: relative; display: flex; flex-direction: column; gap: 12px; width: 100%; box-sizing: border-box; margin: 4px 0 14px; padding: 16px 18px 14px 20px; border: 1px solid color-mix(in srgb, var(--tdv-accent) 34%, var(--background-modifier-border)); border-radius: var(--sauce-radius-modal, 12px); background: linear-gradient(135deg, color-mix(in srgb, var(--tdv-accent) 13%, var(--background-secondary)) 0%, var(--background-secondary) 62%); }',
            '.sauce-tdv::before { content: ""; position: absolute; left: -1px; top: 16px; bottom: 16px; width: 3px; border-radius: 0 3px 3px 0; background: var(--tdv-accent); pointer-events: none; }',
            '.sauce-tdv-for { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 5px; min-width: 0; font-size: 0.8em; color: var(--text-muted); }',
            '.sauce-tdv-for > svg { flex-shrink: 0; }',
            '.sauce-tdv-crumb { max-width: 16em; color: var(--text-accent); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }',
            '.sauce-tdv-crumb.is-task { font-weight: 600; }',
            '.sauce-tdv-sep { color: var(--text-faint); }',
            '.sauce-tdv-top { display: flex; align-items: center; gap: 10px; min-width: 0; }',
            'body .sauce-tdv-kind.sauce-tdv-kind { display: inline-flex; align-items: center; gap: 6px; height: auto; min-height: 24px; padding: 2px 10px 2px 8px; border: 1px solid color-mix(in srgb, var(--tdv-accent) 45%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--tdv-accent) 16%, transparent); box-shadow: none; color: var(--tdv-accent); font-size: 0.72em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }',
            '@media (hover: hover) { body .sauce-tdv-kind.sauce-tdv-kind:hover { background: color-mix(in srgb, var(--tdv-accent) 24%, transparent); } }',
            '.sauce-tdv-kind > svg { flex-shrink: 0; }',
            '.sauce-tdv-sibs { display: flex; align-items: center; gap: 6px; margin-left: auto; min-width: 0; font-size: 0.78em; color: var(--text-faint); }',
            '.sauce-tdv-sib { display: inline-flex; align-items: center; gap: 2px; min-width: 0; max-width: 11em; color: var(--text-accent); text-decoration: none; cursor: pointer; }',
            '.sauce-tdv-sib > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-tdv-sib > svg { flex-shrink: 0; }',
            '.sauce-tdv-pos { flex-shrink: 0; font-variant-numeric: tabular-nums; }',
            '.sauce-tdv-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }',
            'body .sauce-tdv-rename.sauce-tdv-rename, body .sauce-tnv-doc-rename.sauce-tnv-doc-rename { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; min-height: 0; padding: 0; border: none; border-radius: var(--radius-s, 6px); background: transparent; box-shadow: none; color: var(--text-faint); cursor: pointer; }',
            '@media (hover: hover) { body .sauce-tdv-rename.sauce-tdv-rename:hover, body .sauce-tnv-doc-rename.sauce-tnv-doc-rename:hover { color: var(--text-normal); background: var(--background-modifier-hover); } }',
            '.sauce-tdv-title-row.is-renaming .sauce-tdv-rename { display: none; }',
            '@media (hover: hover) { .sauce-tnv-doc .sauce-tnv-doc-rename { opacity: 0; transition: opacity 120ms ease; } .sauce-tnv-doc:hover .sauce-tnv-doc-rename, .sauce-tnv-doc .sauce-tnv-doc-rename:focus-visible { opacity: 1; } }',
            'body.is-mobile .sauce-tnv-doc .sauce-tnv-doc-rename { opacity: 1; }',
            'body .sauce-tdv-rename-input.sauce-tdv-rename-input { box-sizing: border-box; width: 100%; min-width: 0; height: auto; min-height: 32px; padding: 4px 8px; border: 1px solid var(--interactive-accent); border-radius: var(--radius-s, 6px); background: var(--background-primary); color: var(--text-normal); font: inherit; }',
            'body .sauce-tdv-title-row .sauce-tdv-rename-input.sauce-tdv-rename-input { font-size: 1.2em; font-weight: 700; }',
            'body.is-phone .sauce-tdv-rename-input.sauce-tdv-rename-input { font-size: 16px; }',
            '.sauce-tdv-title { margin: 0; font-size: 1.35em; font-weight: 700; line-height: 1.25; color: var(--text-normal); overflow-wrap: anywhere; }',
            '.sauce-tdv-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }',
            '.sauce-tdv-chip { box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; min-height: 24px; max-width: 100%; padding: 2px 10px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: var(--background-primary); color: var(--text-muted); font-size: 0.78em; font-weight: 600; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }',
            '.sauce-tdv-chip.is-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--interactive-accent); flex-shrink: 0; }',
            '.sauce-tdv-chip.is-status.is-done::before { background: var(--color-green, #4c9a5a); }',
            '.sauce-tdv-chip.is-status.is-deleted::before { background: var(--text-faint, #888); }',
            '.sauce-tdv-chip.is-accent { border-color: color-mix(in srgb, var(--interactive-accent) 55%, transparent); color: var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 12%, transparent); }',
            '.sauce-tdv-chip.is-danger { border-color: color-mix(in srgb, var(--color-red, #dc2626) 55%, transparent); color: var(--color-red, #dc2626); background: color-mix(in srgb, var(--color-red, #dc2626) 12%, transparent); }',
            '.sauce-tdv-chip.is-prio-highest, .sauce-tdv-chip.is-prio-high { color: var(--color-red, #dc2626); }',
            '.sauce-tdv-chip.is-prio-medium { color: var(--color-orange, #ea580c); }',
            'a.sauce-tdv-chip.is-project { color: var(--text-accent); cursor: pointer; }',
            '.sauce-tdv-meta { font-size: 0.78em; color: var(--text-faint); }',
            '.sauce-tdv-actions { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--tdv-accent) 22%, var(--background-modifier-border)); }',
            '.sauce-tdv-actions > .sauce-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }',
            'body .sauce-btn.sauce-btn.sauce-btn.sauce-tdv-copy { flex: 1 1 auto; border-color: var(--tdv-accent); background: var(--tdv-accent); color: var(--text-on-accent, #fff); }',
            '@media (hover: hover) { body .sauce-btn.sauce-btn.sauce-btn.sauce-tdv-copy:hover { border-color: var(--tdv-accent); background: var(--tdv-accent); color: var(--text-on-accent, #fff); filter: brightness(1.08); } }',
            'body .sauce-btn.sauce-btn.sauce-btn.sauce-tdv-copy.is-copied { border-color: var(--color-green, #4c9a5a); background: var(--color-green, #4c9a5a); }',
            '.sauce-tdv-actions > .sauce-btn > svg { flex-shrink: 0; }',
            '@media (prefers-reduced-motion: no-preference) { .sauce-tdv.is-reveal { animation: sauce-tdv-rise 320ms var(--sauce-ease, ease) both; } }',
            '@keyframes sauce-tdv-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }',
            'body.is-phone .sauce-tdv { padding: 14px 14px 12px 16px; gap: 10px; }',
            'body.is-phone .sauce-tdv-title { font-size: 1.25em; }',
            'body.is-phone .sauce-tdv-top { flex-wrap: wrap; }',
            'body.is-phone .sauce-tdv-sibs { margin-left: 0; width: 100%; }',
            'body.is-phone .sauce-tdv-actions > .sauce-btn.sauce-btn.sauce-btn.sauce-btn { flex: 1 1 0; height: auto; min-height: 42px; }',
            '@media (max-width: 480px) { .sauce-tdv-top { flex-wrap: wrap; } .sauce-tdv-sibs { margin-left: 0; width: 100%; } .sauce-tdv-actions > .sauce-btn { flex: 1 1 0; } }',
            '.sauce-tnv-doc-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; cursor: pointer; }',
            '.sauce-tnv-doc-title { color: var(--text-normal); font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-tnv-doc-meta { color: var(--text-faint, var(--text-muted)); font-size: 0.75em; }',
            'body .sauce-tnv-doc-copy.sauce-tnv-doc-copy { flex-shrink: 0; height: 26px; min-height: 26px; padding: 0 9px; font-size: 0.78em; border-radius: var(--radius-s, 6px); border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); box-shadow: none; cursor: pointer; }',
            '@media (hover: hover) { body .sauce-tnv-doc-copy.sauce-tnv-doc-copy:hover { color: var(--text-normal); border-color: var(--background-modifier-border-hover); } }',
            'body .sauce-tnv-doc-copy.sauce-tnv-doc-copy.is-copied { color: var(--color-green, #4c9a5a); border-color: var(--color-green, #4c9a5a); }',
            'body .sauce-tnv-doc-add.sauce-tnv-doc-add { align-self: flex-start; height: 30px; min-height: 30px; padding: 0 12px; margin-top: 4px; font-size: 0.85em; border: 1px dashed var(--background-modifier-border-hover, var(--background-modifier-border)); border-radius: var(--radius-m, 8px); background: transparent; color: var(--text-muted); box-shadow: none; cursor: pointer; }',
            '.sauce-tnv-notes-empty { color: var(--text-faint, var(--text-muted)); font-size: 0.85em; padding: 2px 8px; }',
            '.sauce-tnv-notes-hint { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 6px 8px; border-radius: var(--radius-s, 6px); background: var(--background-secondary); color: var(--text-muted); font-size: 0.85em; }',
            'body .sauce-tnv-doc-review.sauce-tnv-doc-review { height: 26px; min-height: 26px; padding: 0 10px; font-size: 0.85em; border-radius: var(--radius-s, 6px); border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); box-shadow: none; cursor: pointer; }',
            '.sauce-tnv-review-copy { color: var(--text-muted); font-size: 0.9em; margin-bottom: 10px; }',
            '.sauce-tnv-review { display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow-y: auto; }',
            '.sauce-tnv-review-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius-s, 6px); cursor: pointer; }',
            '@media (hover: hover) { .sauce-tnv-review-row:hover { background: var(--background-modifier-hover); } }',
            '.sauce-tnv-review-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-tnv-review-kind { flex-shrink: 0; }',
            '.sauce-tnv-doc-new { flex-shrink: 0; display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--interactive-accent) 16%, transparent); color: var(--text-accent); font-size: 0.72em; font-weight: 700; letter-spacing: 0.04em; }',
            '.sauce-tdv-chip.is-sent.is-waiting { border-color: color-mix(in srgb, var(--tdv-accent) 50%, transparent); color: var(--tdv-accent); background: color-mix(in srgb, var(--tdv-accent) 10%, transparent); }',
            '.sauce-tdv-chip.is-sent.is-answered::before { content: "✓"; color: var(--color-green, #4c9a5a); }',
            '.sauce-tdv-pop-overlay { position: fixed; inset: 0; z-index: var(--layer-menu, 65); }',
            '.sauce-tdv-pop { position: fixed; box-sizing: border-box; width: 320px; max-width: calc(100vw - 16px); display: flex; flex-direction: column; gap: 10px; padding: 12px 14px 14px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-l, 12px); background: var(--background-primary); box-shadow: var(--shadow-l, 0 10px 30px rgba(0, 0, 0, 0.25)); }',
            '.sauce-tdv-pop-overlay.is-sheet { background: rgba(0, 0, 0, 0.35); }',
            '.sauce-tdv-pop-overlay.is-sheet .sauce-tdv-pop { left: 0; right: 0; bottom: 0; top: auto; width: 100%; max-width: none; border-radius: 14px 14px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }',
            '.sauce-tdv-pop-title { font-weight: 700; font-size: 0.95em; color: var(--text-normal); }',
            '.sauce-tdv-pop-body { display: flex; flex-direction: column; gap: 12px; }',
            '.sauce-tdv-pop-field { display: flex; flex-direction: column; gap: 6px; }',
            '.sauce-tdv-pop-label { font-size: 0.72em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }',
            'body .sauce-tdv-pop-input.sauce-tdv-pop-input, body .sauce-tdv-pop-date.sauce-tdv-pop-date { box-sizing: border-box; width: 100%; min-height: 32px; padding: 4px 8px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px); background: var(--background-primary); color: var(--text-normal); font: inherit; }',
            'body .sauce-tdv-pop-date.sauce-tdv-pop-date { width: auto; flex: 1 1 9em; min-width: 9em; }',
            '.sauce-tdv-pop-pills { display: flex; flex-wrap: wrap; gap: 6px; }',
            'body .sauce-tdv-pill.sauce-tdv-pill { height: auto; min-height: 30px; padding: 3px 11px; border: 1px solid var(--background-modifier-border); border-radius: 999px; background: transparent; box-shadow: none; color: var(--text-muted); font-size: 0.85em; cursor: pointer; }',
            '@media (hover: hover) { body .sauce-tdv-pill.sauce-tdv-pill:hover { color: var(--text-normal); background: var(--background-modifier-hover); } }',
            'body .sauce-tdv-pill.sauce-tdv-pill.is-on { border-color: var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 16%, transparent); color: var(--text-accent); font-weight: 600; }',
            '.sauce-tdv-pop-hint { font-size: 0.8em; color: var(--text-faint, var(--text-muted)); }',
            '.sauce-tdv-pop-foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }',
            'body.is-mobile .sauce-tdv-pill.sauce-tdv-pill, body.is-mobile .sauce-tdv-pop-foot > .sauce-btn, body.is-mobile .sauce-tdv-pop-input.sauce-tdv-pop-input, body.is-mobile .sauce-tdv-pop-date.sauce-tdv-pop-date { min-height: 40px; font-size: 16px; }',
            'body.is-mobile .sauce-tdv-pop-foot > .sauce-btn { flex: 1 1 0; }',
            '.sauce-tdv-wait { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-bottom: 1px solid var(--background-modifier-border); min-width: 0; }',
            '.sauce-tdv-wait:last-child { border-bottom: none; }',
            '.sauce-tdv-wait-icon { display: inline-flex; flex-shrink: 0; color: ' + TaskDocs.TONES.comms + '; }',
            '.sauce-tdv-wait-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }',
            '.sauce-tdv-wait-title { color: var(--text-normal); text-decoration: none; overflow-wrap: anywhere; cursor: pointer; }',
            '.sauce-tdv-wait-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font-size: 0.78em; color: var(--text-muted); min-width: 0; }',
            '.sauce-tdv-wait-task { color: var(--text-accent); text-decoration: none; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 18em; }',
            'body .sauce-tdv-wait-reply.sauce-tdv-wait-reply { flex-shrink: 0; height: auto; min-height: 28px; padding: 2px 11px; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s, 6px); background: transparent; box-shadow: none; color: var(--text-muted); font-size: 0.82em; cursor: pointer; }',
            '@media (hover: hover) { body .sauce-tdv-wait-reply.sauce-tdv-wait-reply:hover { color: var(--text-normal); border-color: var(--background-modifier-border-hover); } }',
            'body.is-mobile .sauce-tdv-wait-reply.sauce-tdv-wait-reply { min-height: 36px; }',
        ].join('\n');
    }

    static _injectCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            let s = document.getElementById('sauce-task-docs-css');
            if (!s) {
                s = document.createElement('style');
                s.id = 'sauce-task-docs-css';
                document.head.appendChild(s);
            }
            if (s.textContent !== TaskDocs._CSS) s.textContent = TaskDocs._CSS;
        } catch (_e) {}
    }

    static _copyText(text) {
        try {
            const TTL = window.customJS && window.customJS.TaskTodayList;
            if (TTL && typeof TTL.copyText === 'function') return TTL.copyText(text);
        } catch (_e) {}
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) return navigator.clipboard.writeText(String(text)).then(() => true, () => false);
        } catch (_e) {}
        return Promise.resolve(false);
    }

    static _notice(msg, ms) { try { new Notice(msg, ms); } catch (_e) {} }

    /** Each kind's colour: the header card's tint and its icon on the task card. */
    static get TONES() {
        return {
            prompt: 'var(--color-purple, #8b5cf6)',
            handoff: 'var(--color-cyan, #0891b2)',
            comms: 'var(--color-pink, #db2777)',
            plan: 'var(--color-orange, #ea580c)',
            context: 'var(--color-blue, #2563eb)',
            findings: 'var(--color-green, #4c9a5a)',
            questions: 'var(--color-yellow, #ca8a04)',
            note: 'var(--text-muted)',
        };
    }

    static get _ICONS() {
        const svg = (d, n) => '<svg viewBox="0 0 24 24" width="' + (n || 14) + '" height="' + (n || 14) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        return {
            up: svg('<path d="m18 15-6-6-6 6"/>', 13),
            prev: svg('<path d="m15 18-6-6 6-6"/>', 12),
            next: svg('<path d="m9 18 6-6-6-6"/>', 12),
            copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>', 15),
            task: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>', 15),
            pencil: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>', 14),
            send: svg('<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>', 15),
            reply: svg('<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', 15),
            claude: svg('<path d="M12 3v3"/><path d="M12 18v3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 18.4 2.1-2.1"/><path d="m16.3 7.7 2.1-2.1"/>', 15),
            resume: svg('<polygon points="6 3 20 12 6 21 6 3"/>', 15),
        };
    }

    /**
     * The due chip for the task a note belongs to, against `today`
     * (YYYY-MM-DD): { text, tone } with tone 'danger' (open and past),
     * 'accent' (open and today) or ''; null with no due date. Pure.
     */
    static dueChip(due, today, status) {
        const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(due == null ? '' : due).trim());
        if (!d) return null;
        const when = Date.UTC(+d[1], +d[2] - 1, +d[3]);
        const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(today || ''));
        const label = TaskDocs._MONTHS[+d[2] - 1] + ' ' + (+d[3]);
        const open = String(status || 'open') === 'open';
        if (!t) return { text: 'Due ' + label, tone: '' };
        const delta = Math.round((when - Date.UTC(+t[1], +t[2] - 1, +t[3])) / 86400000);
        if (delta === 0) return { text: 'Due today', tone: open ? 'accent' : '' };
        if (delta === 1) return { text: 'Due tomorrow', tone: '' };
        if (delta < 0 && open) return { text: 'Overdue · ' + label, tone: 'danger' };
        return { text: 'Due ' + label, tone: '' };
    }

    static get _MONTHS() { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; }

    /**
     * Draw the header card at the top of a note (dv.container): the trail
     * up to its task (To-Do › … › task), the kind as a coloured badge that
     * changes the kind when clicked, previous and next notes of the same
     * task, the title, the task's status, due date, priority and project,
     * and Copy prompt (prompt and handoff) or Copy message (comms) and Open
     * task. The card is
     * tinted in the kind's colour (TONES). A prompt note also has Copy for
     * Claude (the prompt plus its task context); a comms note has Mark sent
     * before it is sent, then a `Sent Nov 13 · Slack · waiting 2d` chip and
     * Got reply; a handoff with session: has Resume. Drawing the card records
     * the note as seen on this device. opts.app overrides window.app.
     * Returns the card, or null. Never throws.
     */
    static renderHeader(dv, opts) {
        try {
            if (!dv || !dv.container || typeof dv.container.createEl !== 'function') return null;
            const c = dv.container;
            if (c.closest && c.closest('.markdown-embed')) return null;
            const app = (opts && opts.app) || (typeof window !== 'undefined' ? window.app : null);
            if (!app || !app.vault) return null;
            let page = null;
            try {
                const RS = window.customJS && window.customJS.RenderSafe;
                page = RS && typeof RS.page === 'function' ? RS.page(dv) : (dv.current && dv.current());
            } catch (_e) { page = null; }
            const path = String((page && page.file && page.file.path) || '');
            const file = path ? app.vault.getAbstractFileByPath(path) : null;
            if (!file) return null;
            const fm = TaskDocs._fmOf(app, file) || {};
            const ICON = TaskDocs._ICONS;
            const TE = TaskDocs._te();
            const open = (target) => (ev) => {
                try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
                try { app.workspace.openLinkText(target, path, false); } catch (_e) {}
            };
            const title = (f, m) => (m && m.title != null && String(m.title).trim() !== '' ? String(m.title).trim() : String(f.basename || ''));
            const unlink = (v) => String(v == null ? '' : v).trim().replace(/^\[\[|\]\]$/g, '');

            let taskPath = TaskDocs.taskPathOf(path);
            let taskFile = taskPath ? app.vault.getAbstractFileByPath(taskPath) : null;
            if (!taskFile && fm.task) {
                try {
                    taskFile = app.metadataCache.getFirstLinkpathDest(unlink(fm.task).split('|')[0], path) || null;
                    taskPath = taskFile ? taskFile.path : '';
                } catch (_e) { taskFile = null; }
            }
            const taskFm = taskFile ? TaskDocs._fmOf(app, taskFile) || {} : {};

            TaskDocs._injectCss();
            try {
                const stale = c.querySelectorAll ? c.querySelectorAll(':scope > .sauce-tdv') : [];
                for (const prev of Array.from(stale || [])) { if (prev && prev.remove) prev.remove(); }
            } catch (_e) {}
            let kind = TaskDocs.kindOf(fm.kind);
            const card = c.createEl('div', { cls: 'sauce-tdv' });
            card.setAttribute('data-kind', kind);
            const seen = TaskDocs._seen || (TaskDocs._seen = new Set());
            if (!seen.has(path)) { seen.add(path); card.classList.add('is-reveal'); }
            TaskDocs.markSeen(path);
            TaskDocs._installSeenHook(app);

            if (taskFile) {
                const trail = card.createEl('div', { cls: 'sauce-tdv-for' });
                trail.insertAdjacentHTML('afterbegin', ICON.up);
                trail.createEl('span', { text: 'Note for' });
                let rootPath = 'spice/to-do/All-ToDos.md';
                try {
                    const m = window.moment && window.moment();
                    const today = m ? 'spice/to-do/' + m.format('YYYY/MM-MMMM') + '/ToDo-' + m.format('YYYY-MM-DD') + '.md' : '';
                    if (today && app.vault.getAbstractFileByPath(today)) rootPath = today;
                } catch (_e) {}
                const root = trail.createEl('a', { cls: 'sauce-tdv-crumb', text: 'To-Do', href: '#' });
                root.addEventListener('click', open(rootPath));
                const chain = [];
                let up = TE && typeof TE.parentNotePathOf === 'function' ? TE.parentNotePathOf(taskFile.path) : '';
                for (let i = 0; up && i < 8; i++) {
                    const pf = app.vault.getAbstractFileByPath(up);
                    if (!pf) break;
                    chain.unshift({ path: up, name: title(pf, TaskDocs._fmOf(app, pf)) });
                    up = TE.parentNotePathOf(up);
                }
                chain.push({ path: taskFile.path, name: title(taskFile, taskFm), task: true });
                for (const level of chain) {
                    trail.createEl('span', { cls: 'sauce-tdv-sep', text: '›' });
                    const a = trail.createEl('a', { cls: 'sauce-tdv-crumb' + (level.task ? ' is-task' : ''), text: level.name, href: '#' });
                    a.addEventListener('click', open(level.path));
                }
            }

            const top = card.createEl('div', { cls: 'sauce-tdv-top' });
            const badge = top.createEl('button', { cls: 'sauce-tdv-kind' });
            try { badge.setAttribute('type', 'button'); badge.setAttribute('aria-haspopup', 'menu'); badge.setAttribute('title', 'Change what kind of note this is'); } catch (_e) {}
            const paintBadge = () => {
                const meta = TaskDocs._kind(kind);
                badge.innerHTML = meta.icon;
                badge.createEl('span', { text: meta.label });
                card.setAttribute('data-kind', kind);
            };
            paintBadge();
            const docs = taskPath ? TaskDocs.list(app, taskPath) : [];
            const at = docs.findIndex((d) => d.path === path);
            if (at >= 0 && docs.length > 1) {
                const sibs = top.createEl('div', { cls: 'sauce-tdv-sibs' });
                const jump = (d, cls) => {
                    const a = sibs.createEl('a', { cls: 'sauce-tdv-sib ' + cls, href: '#' });
                    if (cls === 'is-prev') a.insertAdjacentHTML('afterbegin', ICON.prev);
                    a.createEl('span', { text: d.title });
                    if (cls === 'is-next') a.insertAdjacentHTML('beforeend', ICON.next);
                    try { a.setAttribute('title', (cls === 'is-prev' ? 'Previous note: ' : 'Next note: ') + d.title); } catch (_e) {}
                    a.addEventListener('click', open(d.path));
                };
                if (at > 0) jump(docs[at - 1], 'is-prev');
                sibs.createEl('span', { cls: 'sauce-tdv-pos', text: (at + 1) + ' of ' + docs.length + ' notes' });
                if (at < docs.length - 1) jump(docs[at + 1], 'is-next');
            }

            const titleRow = card.createEl('div', { cls: 'sauce-tdv-title-row' });
            const titleEl = titleRow.createEl('div', { cls: 'sauce-tdv-title', text: title(file, fm) || '(untitled)' });
            const renameBtn = titleRow.createEl('button', { cls: 'sauce-tdv-rename' });
            try { renameBtn.setAttribute('type', 'button'); renameBtn.setAttribute('aria-label', 'Rename note'); renameBtn.setAttribute('title', 'Rename note'); } catch (_e) {}
            renameBtn.innerHTML = ICON.pencil;
            const startRename = () => {
                if (titleRow.classList.contains && titleRow.classList.contains('is-renaming')) return;
                const prior = titleEl.textContent;
                TaskDocs._editTitle(titleRow, titleEl, prior, async (next) => {
                    const RenderSafe = window.customJS && window.customJS.RenderSafe;
                    if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskDocs._notice('Could not rename the note right now', 4000); return; }
                    const done = await RenderSafe.mutate({
                        app,
                        path,
                        failureMessage: 'Could not rename the note',
                        optimistic: () => { titleEl.textContent = next; },
                        write: async () => {
                            const res = await TaskDocs.rename(app, path, next);
                            if (!res.ok) throw new Error(res.reason);
                            return res;
                        },
                        revert: () => { titleEl.textContent = prior; },
                    });
                    if (done && done.ok && done.value && done.value.path) TaskDocs.markSeen(done.value.path);
                });
            };
            renameBtn.addEventListener('click', startRename);
            titleEl.addEventListener('dblclick', startRename);

            if (taskFile) {
                const chips = card.createEl('div', { cls: 'sauce-tdv-chips' });
                const st = /\/_trash\//.test(taskFile.path) ? 'deleted' : (String(taskFm.status || 'open').trim().toLowerCase() || 'open');
                const stLabel = { open: 'Task open', done: 'Task done', deleted: 'Task deleted' }[st] || 'Task ' + st;
                chips.createEl('span', { cls: 'sauce-tdv-chip is-status is-' + st, text: stLabel });
                let todayStr = '';
                try { todayStr = window.moment ? window.moment().format('YYYY-MM-DD') : ''; } catch (_e) { todayStr = ''; }
                const due = TaskDocs.dueChip(taskFm.due, todayStr, st);
                if (due) chips.createEl('span', { cls: 'sauce-tdv-chip is-due' + (due.tone ? ' is-' + due.tone : ''), text: due.text });
                const prio = String(taskFm.priority || '').trim().toLowerCase();
                if (prio && prio !== 'none' && prio !== 'normal') chips.createEl('span', { cls: 'sauce-tdv-chip is-prio-' + prio, text: prio.charAt(0).toUpperCase() + prio.slice(1) + ' priority' });
                const projLink = unlink(taskFm.project);
                if (projLink) {
                    const p = chips.createEl('a', { cls: 'sauce-tdv-chip is-project', text: projLink.split('|').pop().trim(), href: '#' });
                    p.addEventListener('click', open(projLink.split('|')[0]));
                }
            }
            const made = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fm.created_at || ''));
            const ago = TaskDocs._ago(file.stat && file.stat.mtime, Date.now());
            const metaText = [made ? 'Created ' + TaskDocs._MONTHS[+made[2] - 1] + ' ' + (+made[3]) : '', ago ? 'Edited ' + ago : ''].filter(Boolean).join(' · ');
            if (metaText) card.createEl('div', { cls: 'sauce-tdv-meta', text: metaText });

            const today = TaskDocs._today();
            const sent = { to: fm.to, via: fm.via, sent_at: fm.sent_at, replied_at: fm.replied_at };
            const follow = TaskDocs.followUps(app, path);
            const commsRow = card.createEl('div', { cls: 'sauce-tdv-chips is-comms' });
            let commsChip = null;

            const actions = card.createEl('div', { cls: 'sauce-tdv-actions' });
            const copyBtn = actions.createEl('button', { cls: 'sauce-btn sauce-tdv-copy' });
            try { copyBtn.setAttribute('type', 'button'); } catch (_e) {}
            const paintCopy = (label) => {
                copyBtn.innerHTML = ICON.copy;
                copyBtn.createEl('span', { text: label || TaskDocs._kind(kind).copyLabel || 'Copy' });
                copyBtn.style.display = TaskDocs._kind(kind).copy ? '' : 'none';
            };
            paintCopy();
            copyBtn.addEventListener('click', async () => {
                let text = '';
                try { text = TaskDocs.extractPrompt(await app.vault.read(file)); } catch (_e) { text = ''; }
                const what = TaskDocs._kind(kind).copied || 'Text';
                if (!text) { TaskDocs._notice('This note has nothing to copy yet', 4000); return; }
                const ok = await TaskDocs._copyText(text);
                TaskDocs._notice(ok ? what + ' copied (' + text.length + ' characters)' : 'Could not copy the ' + what.toLowerCase(), ok ? 2500 : 5000);
                if (!ok) return;
                try {
                    copyBtn.classList.add('is-copied');
                    paintCopy('Copied');
                    setTimeout(() => { try { copyBtn.classList.remove('is-copied'); paintCopy(); } catch (_e) {} }, 1400);
                } catch (_e) {}
            });

            const extraBtn = (cls, icon, label) => {
                const b = actions.createEl('button', { cls: 'sauce-btn ' + cls });
                try { b.setAttribute('type', 'button'); } catch (_e) {}
                b.innerHTML = icon;
                b.createEl('span', { text: label });
                return b;
            };
            const claudeBtn = extraBtn('sauce-tdv-claude', ICON.claude, 'Copy for Claude');
            try { claudeBtn.setAttribute('title', 'Copy the prompt with where this task\'s notes go'); } catch (_e) {}
            const sentBtn = extraBtn('sauce-tdv-sent', ICON.send, 'Mark sent');
            try { sentBtn.setAttribute('aria-haspopup', 'dialog'); } catch (_e) {}
            const replyBtn = extraBtn('sauce-tdv-reply', ICON.reply, 'Got reply');
            const resumeBtn = extraBtn('sauce-tdv-resume', ICON.resume, 'Resume');
            const paintExtras = () => {
                const st = kind === 'comms' ? TaskDocs.commsState(sent, follow, today) : null;
                const chip = TaskDocs.commsChip(st);
                if (chip && !commsChip) commsChip = commsRow.createEl('span', { cls: 'sauce-tdv-chip is-sent' });
                if (commsChip) {
                    commsChip.textContent = chip;
                    commsChip.className = 'sauce-tdv-chip is-sent' + (st && st.state !== 'unsent' ? ' is-' + st.state : '');
                }
                commsRow.style.display = chip ? '' : 'none';
                claudeBtn.style.display = kind === 'prompt' && taskFile ? '' : 'none';
                const closed = TaskDocs._closed(path);
                sentBtn.style.display = st && st.state === 'unsent' && !closed ? '' : 'none';
                replyBtn.style.display = st && st.state === 'waiting' && !closed ? '' : 'none';
                const ra = kind === 'handoff' ? TaskDocs.resumeAction(fm.session) : null;
                resumeBtn.style.display = ra ? '' : 'none';
                try { resumeBtn.setAttribute('title', ra ? (ra.kind === 'url' ? 'Open the session' : ra.kind === 'id' ? 'Copy ' + ra.command : 'Not a session id or link') : ''); } catch (_e) {}
            };
            paintExtras();

            claudeBtn.addEventListener('click', async () => {
                let text = '';
                try { text = TaskDocs.extractPrompt(await app.vault.read(file)); } catch (_e) { text = ''; }
                if (!text) { TaskDocs._notice('This note has nothing to copy yet', 4000); return; }
                if (!taskFile) return;
                const TTL = window.customJS && window.customJS.TaskTodayList;
                const full = (p) => (TTL && typeof TTL.fullPath === 'function' ? TTL.fullPath(p, app) : p);
                const taskName = String(taskFile.basename || taskFile.path.split('/').pop().replace(/\.md$/i, ''));
                const all = TaskDocs.forClaude(text, {
                    taskTitle: title(taskFile, taskFm),
                    taskName,
                    taskPath: full(taskFile.path),
                    notesPath: full(TaskDocs.notesFolder(taskFile.path) || path.slice(0, path.lastIndexOf('/'))),
                });
                const ok = await TaskDocs._copyText(all);
                TaskDocs._notice(ok ? 'Prompt and task context copied (' + all.length + ' characters)' : 'Could not copy the prompt', ok ? 2500 : 5000);
            });

            resumeBtn.addEventListener('click', async () => {
                const ra = TaskDocs.resumeAction(fm.session);
                if (!ra) return;
                if (ra.kind === 'url') {
                    try { window.open(ra.url); } catch (_e) { TaskDocs._notice('Could not open the session', 4000); }
                    return;
                }
                if (ra.kind !== 'id') { TaskDocs._notice('This session value isn\'t a session id or link', 5000); return; }
                const ok = await TaskDocs._copyText(ra.command);
                TaskDocs._notice(ok ? 'Copied: ' + ra.command : 'Could not copy the resume command', ok ? 3500 : 5000);
            });

            sentBtn.addEventListener('click', () => {
                TaskDocs.openSendPanel({
                    app,
                    anchor: sentBtn,
                    to: sent.to,
                    via: sent.via,
                    today,
                    onSave: async (v) => {
                        const RenderSafe = window.customJS && window.customJS.RenderSafe;
                        if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskDocs._notice('Could not mark it sent right now', 4000); return; }
                        const prior = Object.assign({}, sent);
                        const stamp = TaskDocs._stamp();
                        const res = await RenderSafe.mutate({
                            app,
                            path,
                            failureMessage: 'Could not mark the message sent',
                            optimistic: () => { Object.assign(sent, { to: v.to, via: v.via, sent_at: stamp, replied_at: '' }); paintExtras(); },
                            write: async () => {
                                const r = await TaskDocs.markSent(app, path, { to: v.to, via: v.via, due: v.due, stamp });
                                if (!r.ok) throw new Error(r.reason);
                                return r;
                            },
                            revert: () => { Object.assign(sent, prior); paintExtras(); },
                        });
                        if (!res || !res.ok) return;
                        TaskDocs.markSeen(path);
                        const out = res.value || {};
                        if (v.due && !out.followUp) TaskDocs._notice('Marked sent, but the follow-up task could not be made', 6000);
                        else TaskDocs._notice(v.due ? 'Marked sent. Follow up ' + TaskDocs._weekdayDay(v.due) : 'Marked sent', 3000);
                    },
                });
            });

            replyBtn.addEventListener('click', async () => {
                const RenderSafe = window.customJS && window.customJS.RenderSafe;
                if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskDocs._notice('Could not mark the reply right now', 4000); return; }
                const prior = sent.replied_at;
                const stamp = TaskDocs._stamp();
                const res = await RenderSafe.mutate({
                    app,
                    path,
                    failureMessage: 'Could not mark the reply',
                    optimistic: () => { sent.replied_at = stamp; paintExtras(); },
                    write: async () => {
                        const r = await TaskDocs.gotReply(app, path, stamp);
                        if (!r.ok) throw new Error(r.reason);
                        return r;
                    },
                    revert: () => { sent.replied_at = prior; paintExtras(); },
                });
                if (res && res.ok) {
                    TaskDocs.markSeen(path);
                    const warn = TaskDocs.replyNotice(res.value);
                    if (warn) TaskDocs._notice(warn, 6000);
                }
            });

            if (taskFile) {
                const taskBtn = actions.createEl('button', { cls: 'sauce-btn sauce-tdv-task' });
                try { taskBtn.setAttribute('type', 'button'); } catch (_e) {}
                taskBtn.innerHTML = ICON.task;
                taskBtn.createEl('span', { text: 'Open task' });
                taskBtn.addEventListener('click', open(taskFile.path));
            }

            badge.addEventListener('click', () => {
                const MP = window.customJS && window.customJS.MenuPopover;
                if (!MP || typeof MP.open !== 'function') return;
                const entries = TaskDocs.KINDS.map((k) => ({
                    label: k.label + (k.key === kind ? '  ✓' : ''),
                    icon: k.icon,
                    onSelect: async () => {
                        if (k.key === kind) return;
                        const RenderSafe = window.customJS && window.customJS.RenderSafe;
                        if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskDocs._notice('Could not change the kind right now', 4000); return; }
                        const prior = kind;
                        const repaint = (to) => { kind = to; paintBadge(); paintCopy(); paintExtras(); };
                        const done = await RenderSafe.mutate({
                            app,
                            path,
                            failureMessage: 'Could not change the kind',
                            optimistic: () => repaint(k.key),
                            write: () => app.fileManager.processFrontMatter(file, (f) => { f.kind = k.key; }),
                            revert: () => repaint(prior),
                        });
                        if (done && done.ok) TaskDocs.markSeen(path);
                    },
                }));
                MP.open(entries, { anchor: badge, title: 'Kind of note', animate: true });
            });
            return card;
        } catch (_e) {
            return null;
        }
    }

    /**
     * Draw the Notes section of the task at opts.taskPath into `container`
     * (the task card): one row per note (kind icon, title, kind and age, or
     * Sent Nov 13 / Waiting 2d on a sent comms note, and a New pill when it
     * changed since this device last opened it; click opens it), Copy prompt
     * on prompt and handoff notes, and + Note,
     * which picks a kind, creates the note and opens it. Nothing for a flat
     * task. opts.decorateRow(row, doc, repaint) adds to each row (the task
     * card's drag handle and ⋯ menu). Returns the section, or null. Never
     * throws.
     */
    static render(container, opts) {
        try {
            const o = opts || {};
            const app = o.app || (typeof window !== 'undefined' ? window.app : null);
            const taskPath = String(o.taskPath || '');
            if (!container || typeof container.createEl !== 'function' || !app || !TaskDocs.notesFolder(taskPath)) return null;
            TaskDocs._injectCss();
            const section = container.createEl('div', { cls: 'sauce-tnv-section is-notes' });
            const head = section.createEl('div', { cls: 'sauce-tnv-section-head' });
            head.createEl('div', { cls: 'sauce-tnv-label', text: 'Notes' });
            const countEl = head.createEl('span', { cls: 'sauce-tnv-count' });
            const listEl = section.createEl('div', { cls: 'sauce-tnv-notes' });
            const open = (path) => {
                try { app.workspace.openLinkText(path, taskPath, false); } catch (_e) {}
            };
            const paint = () => {
                while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
                const docs = TaskDocs.list(app, taskPath);
                countEl.textContent = docs.length ? String(docs.length) : '';
                if (!docs.length) {
                    listEl.createEl('div', { cls: 'sauce-tnv-notes-empty', text: 'Prompts, handoffs, plans and findings for this task go here.' });
                    return;
                }
                const now = Date.now();
                const today = TaskDocs._today();
                const seenAt = TaskDocs.readSeen();
                let followIndex = null;
                for (const d of docs) {
                    const meta = TaskDocs._kind(d.kind);
                    const row = listEl.createEl('div', { cls: 'sauce-tnv-doc is-' + d.kind });
                    const ic = row.createEl('span', { cls: 'sauce-tnv-doc-icon' });
                    ic.innerHTML = meta.icon;
                    const main = row.createEl('div', { cls: 'sauce-tnv-doc-main' });
                    const titleSpan = main.createEl('span', { cls: 'sauce-tnv-doc-title', text: d.title });
                    let status = TaskDocs._ago(d.mtime, now);
                    if (d.kind === 'comms') {
                        if (!followIndex) followIndex = TaskDocs._followUpIndex(app);
                        const st = TaskDocs.commsState(d.fm, TaskDocs.followUps(app, d.path, followIndex), today);
                        if (st.state === 'waiting') status = TaskDocs.waitingText(st.days);
                        else if (st.state === 'answered') status = st.sentLabel;
                    }
                    main.createEl('span', { cls: 'sauce-tnv-doc-meta', text: meta.label + (status ? ' · ' + status : '') });
                    main.addEventListener('click', () => open(d.path));
                    try { main.setAttribute('title', 'Open ' + d.title); } catch (_e) {}
                    if (TaskDocs.isNew(d.mtime, seenAt[d.path], now)) {
                        const pill = row.createEl('span', { cls: 'sauce-tnv-doc-new', text: 'New' });
                        try { pill.setAttribute('title', 'Changed since you last opened it on this device'); } catch (_e) {}
                    }
                    const ren = row.createEl('button', { cls: 'sauce-tnv-doc-rename' });
                    try { ren.setAttribute('type', 'button'); ren.setAttribute('aria-label', 'Rename ' + d.title); ren.setAttribute('title', 'Rename'); } catch (_e) {}
                    ren.innerHTML = TaskDocs._ICONS.pencil;
                    ren.addEventListener('click', (ev) => {
                        try { ev.stopPropagation(); } catch (_e) {}
                        if (main.classList.contains && main.classList.contains('is-renaming')) return;
                        TaskDocs._editTitle(main, titleSpan, d.title, async (next) => {
                            const RenderSafe = window.customJS && window.customJS.RenderSafe;
                            if (!RenderSafe || typeof RenderSafe.mutate !== 'function') { TaskDocs._notice('Could not rename the note right now', 4000); return; }
                            const res = await RenderSafe.mutate({
                                app,
                                path: taskPath,
                                failureMessage: 'Could not rename the note',
                                optimistic: () => { titleSpan.textContent = next; },
                                write: async () => {
                                    const r = await TaskDocs.rename(app, d.path, next);
                                    if (!r.ok) throw new Error(r.reason);
                                    return r;
                                },
                                revert: () => { titleSpan.textContent = d.title; },
                            });
                            if (res && res.ok) {
                                if (!TaskDocs.isNew(d.mtime, seenAt[d.path], now) && res.value && res.value.path) TaskDocs.markSeen(res.value.path);
                                paint();
                            }
                        });
                    });
                    if (meta.copy) {
                        const btn = row.createEl('button', { cls: 'sauce-tnv-doc-copy', text: meta.copyLabel });
                        try { btn.setAttribute('type', 'button'); } catch (_e) {}
                        btn.addEventListener('click', async (ev) => {
                            try { ev.stopPropagation(); } catch (_e) {}
                            let text = '';
                            try { text = TaskDocs.extractPrompt(await app.vault.cachedRead(d.file)); } catch (_e) { text = ''; }
                            if (!text) { TaskDocs._notice('This note has nothing to copy yet', 4000); return; }
                            const ok = await TaskDocs._copyText(text);
                            TaskDocs._notice(ok ? meta.copied + ' copied (' + text.length + ' characters)' : 'Could not copy the ' + meta.copied.toLowerCase(), ok ? 2500 : 5000);
                            if (!ok) return;
                            try {
                                btn.classList.add('is-copied');
                                btn.textContent = 'Copied';
                                setTimeout(() => { try { btn.classList.remove('is-copied'); btn.textContent = meta.copyLabel; } catch (_e) {} }, 1400);
                            } catch (_e) {}
                        });
                    }
                    if (typeof o.decorateRow === 'function') {
                        try { o.decorateRow(row, d, paint); } catch (_e) { /* the row still works */ }
                    }
                }
            };
            paint();
            const hint = section.createEl('div', { cls: 'sauce-tnv-notes-hint' });
            const paintHint = () => {
                while (hint.firstChild) hint.removeChild(hint.firstChild);
                const cands = TaskDocs.candidates(app, taskPath);
                hint.style.display = cands.length ? '' : 'none';
                if (!cands.length) return;
                hint.createEl('span', { text: cands.length + (cands.length === 1 ? ' subtask reads like a note' : ' subtasks read like notes') });
                const review = hint.createEl('button', { cls: 'sauce-tnv-doc-review', text: 'Review' });
                try { review.setAttribute('type', 'button'); } catch (_e) {}
                review.addEventListener('click', async () => {
                    const res = await TaskDocs.openReview(app, taskPath, cands);
                    if (res && res.converted.length) { paint(); paintHint(); }
                });
            };
            paintHint();
            const add = section.createEl('button', { cls: 'sauce-tnv-doc-add', text: '+ Note' });
            try { add.setAttribute('type', 'button'); add.setAttribute('aria-haspopup', 'menu'); } catch (_e) {}
            add.addEventListener('click', () => {
                const MP = window.customJS && window.customJS.MenuPopover;
                const make = async (kind) => {
                    const res = await TaskDocs.create(app, taskPath, kind, TaskDocs._kind(kind).label);
                    if (!res.ok) { TaskDocs._notice('Could not create the note: ' + res.reason, 6000); return; }
                    TaskDocs.markSeen(res.path);
                    open(res.path);
                };
                const entries = TaskDocs.KINDS.map((k) => ({ label: k.label, icon: k.icon, onSelect: () => { make(k.key); } }));
                if (MP && typeof MP.open === 'function') MP.open(entries, { anchor: add, title: 'New note', animate: true });
                else make('note');
            });
            section.__repaint = paint;
            return section;
        } catch (_e) {
            return null;
        }
    }
}
