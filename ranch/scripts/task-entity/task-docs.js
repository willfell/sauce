class TaskDocs {

    // Notes that belong to a task without being steps of it: the prompts,
    // handoffs, plans, context and findings that go with the work. Each lives
    // at spice/tasks/<Task>/notes/<Name>.md with `type: task-doc` and a
    // `kind`; it has no status, never counts toward the task's progress and
    // never lists as a to-do. The task card shows them in a Notes section
    // (render), with Copy prompt on prompt and handoff notes and a + Note
    // menu that creates one from its kind's template.
    // Spec: Docs/superpowers/specs/2026-11-12-task-notes-design.md.

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
    withHeader(text) { return TaskDocs.withHeader(text); }
    taskPathOf(docPath) { return TaskDocs.taskPathOf(docPath); }

    static get TYPE() { return 'task-doc'; }
    static get FOLDER() { return 'notes'; }

    /** The kinds, in card order. Anything else reads as `note`. */
    static get KINDS() {
        const svg = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        return [
            { key: 'prompt', label: 'Prompt', copy: true, icon: svg('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>') },
            { key: 'handoff', label: 'Handoff', copy: true, icon: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>') },
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

    /** The body a new note of `kind` starts with, under its header line. */
    static template(kind) {
        switch (TaskDocs.kindOf(kind)) {
            case 'prompt':
                return 'Write the prompt here. Copy prompt on the task card copies this whole section.\n';
            case 'handoff':
                return [
                    '> [!tip] Resume session',
                    '> ```bash',
                    '> cd ~/Documents/GitHub/<repo>',
                    '> claude --resume <session-id>',
                    '> ```',
                    '',
                    '## Prompt to paste', // lint-display-markers:allow starter text the user edits; extractPrompt matches any heading containing "prompt", not this string
                    '',
                    '````text',
                    'You are continuing work on <what>. Verify the current state read-only before changing anything.',
                    '',
                    'Done so far:',
                    '-',
                    '',
                    'Next, in order:',
                    '1.',
                    '````',
                    '',
                ].join('\n');
            case 'plan':
                return ['## Goal', '', '', '## Approach', '', '', '## Steps', '', '- [ ] ', '', '## Risks', '', ''].join('\n'); // lint-display-markers:allow starter text the user edits; nothing reads it back
            case 'context':
                return ['> [!abstract] Goal', '> ', '', '## Background', '', '', '## Links', '', '- ', ''].join('\n'); // lint-display-markers:allow starter text the user edits; nothing reads it back
            case 'findings':
                return ['> [!abstract] Summary', '> ', '', '## Details', '', ''].join('\n'); // lint-display-markers:allow starter text the user edits; nothing reads it back
            case 'questions':
                return ['## Open questions', '', '- [ ] ', '', '## Answers', '', ''].join('\n'); // lint-display-markers:allow starter text the user edits; nothing reads it back
            default:
                return '';
        }
    }

    /** A whole new note: frontmatter, a link back to the task, the template. */
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
            TaskDocs.template(k),
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
            out.push({ path: f.path, file: f, kind, title, mtime: (f.stat && f.stat.mtime) || 0 });
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
     * and Copy prompt (prompt and handoff notes) and Open task. The card is
     * tinted in the kind's colour (TONES). opts.app overrides window.app.
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

            card.createEl('div', { cls: 'sauce-tdv-title', text: title(file, fm) || '(untitled)' });

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

            const actions = card.createEl('div', { cls: 'sauce-tdv-actions' });
            const copyBtn = actions.createEl('button', { cls: 'sauce-btn sauce-tdv-copy' });
            try { copyBtn.setAttribute('type', 'button'); } catch (_e) {}
            const paintCopy = (label) => {
                copyBtn.innerHTML = ICON.copy;
                copyBtn.createEl('span', { text: label || 'Copy prompt' });
                copyBtn.style.display = TaskDocs._kind(kind).copy ? '' : 'none';
            };
            paintCopy();
            copyBtn.addEventListener('click', async () => {
                let text = '';
                try { text = TaskDocs.extractPrompt(await app.vault.read(file)); } catch (_e) { text = ''; }
                if (!text) { TaskDocs._notice('This note has no prompt to copy yet', 4000); return; }
                const ok = await TaskDocs._copyText(text);
                TaskDocs._notice(ok ? 'Prompt copied (' + text.length + ' characters)' : 'Could not copy the prompt', ok ? 2500 : 5000);
                if (!ok) return;
                try {
                    copyBtn.classList.add('is-copied');
                    paintCopy('Copied');
                    setTimeout(() => { try { copyBtn.classList.remove('is-copied'); paintCopy(); } catch (_e) {} }, 1400);
                } catch (_e) {}
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
                        const repaint = (to) => { kind = to; paintBadge(); paintCopy(); };
                        await RenderSafe.mutate({
                            app,
                            path,
                            failureMessage: 'Could not change the kind',
                            optimistic: () => repaint(k.key),
                            write: () => app.fileManager.processFrontMatter(file, (f) => { f.kind = k.key; }),
                            revert: () => repaint(prior),
                        });
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
     * (the task card): one row per note (kind icon, title, kind and age;
     * click opens it), Copy prompt on prompt and handoff notes, and + Note,
     * which picks a kind, creates the note and opens it. Nothing for a flat
     * task. Returns the section, or null. Never throws.
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
                for (const d of docs) {
                    const meta = TaskDocs._kind(d.kind);
                    const row = listEl.createEl('div', { cls: 'sauce-tnv-doc is-' + d.kind });
                    const ic = row.createEl('span', { cls: 'sauce-tnv-doc-icon' });
                    ic.innerHTML = meta.icon;
                    const main = row.createEl('div', { cls: 'sauce-tnv-doc-main' });
                    main.createEl('span', { cls: 'sauce-tnv-doc-title', text: d.title });
                    const ago = TaskDocs._ago(d.mtime, now);
                    main.createEl('span', { cls: 'sauce-tnv-doc-meta', text: meta.label + (ago ? ' · ' + ago : '') });
                    main.addEventListener('click', () => open(d.path));
                    try { main.setAttribute('title', 'Open ' + d.title); } catch (_e) {}
                    if (meta.copy) {
                        const btn = row.createEl('button', { cls: 'sauce-tnv-doc-copy', text: 'Copy prompt' });
                        try { btn.setAttribute('type', 'button'); } catch (_e) {}
                        btn.addEventListener('click', async (ev) => {
                            try { ev.stopPropagation(); } catch (_e) {}
                            let text = '';
                            try { text = TaskDocs.extractPrompt(await app.vault.cachedRead(d.file)); } catch (_e) { text = ''; }
                            if (!text) { TaskDocs._notice('This note has no prompt to copy yet', 4000); return; }
                            const ok = await TaskDocs._copyText(text);
                            TaskDocs._notice(ok ? 'Prompt copied (' + text.length + ' characters)' : 'Could not copy the prompt', ok ? 2500 : 5000);
                            if (!ok) return;
                            try {
                                btn.classList.add('is-copied');
                                btn.textContent = 'Copied';
                                setTimeout(() => { try { btn.classList.remove('is-copied'); btn.textContent = 'Copy prompt'; } catch (_e) {} }, 1400);
                            } catch (_e) {}
                        });
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
