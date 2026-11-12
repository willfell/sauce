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
            '> [!info] ' + TaskDocs._kind(k).label + ' for [[' + task + ']]',
            '',
            TaskDocs.template(k),
        ].join('\n');
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
            '.sauce-tnv-doc.is-prompt .sauce-tnv-doc-icon, .sauce-tnv-doc.is-handoff .sauce-tnv-doc-icon { color: var(--text-accent); }',
            '.sauce-tnv-doc-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; cursor: pointer; }',
            '.sauce-tnv-doc-title { color: var(--text-normal); font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-tnv-doc-meta { color: var(--text-faint, var(--text-muted)); font-size: 0.75em; }',
            'body .sauce-tnv-doc-copy.sauce-tnv-doc-copy { flex-shrink: 0; height: 26px; min-height: 26px; padding: 0 9px; font-size: 0.78em; border-radius: var(--radius-s, 6px); border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted); box-shadow: none; cursor: pointer; }',
            '@media (hover: hover) { body .sauce-tnv-doc-copy.sauce-tnv-doc-copy:hover { color: var(--text-normal); border-color: var(--background-modifier-border-hover); } }',
            'body .sauce-tnv-doc-copy.sauce-tnv-doc-copy.is-copied { color: var(--color-green, #4c9a5a); border-color: var(--color-green, #4c9a5a); }',
            'body .sauce-tnv-doc-add.sauce-tnv-doc-add { align-self: flex-start; height: 30px; min-height: 30px; padding: 0 12px; margin-top: 4px; font-size: 0.85em; border: 1px dashed var(--background-modifier-border-hover, var(--background-modifier-border)); border-radius: var(--radius-m, 8px); background: transparent; color: var(--text-muted); box-shadow: none; cursor: pointer; }',
            '.sauce-tnv-notes-empty { color: var(--text-faint, var(--text-muted)); font-size: 0.85em; padding: 2px 8px; }',
        ].join('\n');
    }

    static _injectCss() {
        try {
            if (typeof document === 'undefined' || !document.head || document.getElementById('sauce-task-docs-css')) return;
            const s = document.createElement('style');
            s.id = 'sauce-task-docs-css';
            s.textContent = TaskDocs._CSS;
            document.head.appendChild(s);
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
