class TaskJump {

    // Jump to task or note: a fuzzy picker over every task (open, then done,
    // then trashed) and every task note under spice/tasks. Each row shows a
    // checkbox glyph (task) or the kind icon (note), the title, the parent
    // trail and the status or due date. Enter opens the note; Mod+Enter opens
    // it in a new tab. Opened by the `Sauce: Jump to task or note` command
    // (TaskJumpInit) and the search button on the To-Do and Home bars.
    // Spec: Docs/superpowers/specs/2026-11-13-task-flow-design.md, section 8.
    //
    // build() and rank() are pure: build turns metadata-cache records into
    // ordered rows, rank orders rows for a query. collect() reads the
    // metadata cache; open() builds the modal from Obsidian's SuggestModal,
    // reached through customJS.obsidian.

    open(opts) { return TaskJump.open(opts); }
    collect(app) { return TaskJump.collect(app); }
    build(records, opts) { return TaskJump.build(records, opts); }
    rank(items, query) { return TaskJump.rank(items, query); }
    score(query, title, extra) { return TaskJump.score(query, title, extra); }
    renderRow(item, el) { return TaskJump.renderRow(item, el); }
    isNewTab(evt) { return TaskJump.isNewTab(evt); }
    openItem(app, item, newTab) { return TaskJump.openItem(app, item, newTab); }
    get LIMIT() { return TaskJump.LIMIT; }
    get ICON() { return TaskJump.ICON; }

    static get ROOT() { return 'spice/tasks'; }
    static get SKIP() { return ['spice/tasks/_sets/']; }
    static get LIMIT() { return 100; }
    static get GROUPS() { return { open: 0, done: 1, deleted: 2, doc: 3 }; }
    static get _MONTHS() { return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; }

    static get ICON() {
        const svg = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
        return {
            search: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
            open: svg('<rect x="3" y="3" width="18" height="18" rx="3"/>'),
            done: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>'),
            deleted: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m9 9 6 6"/><path d="m15 9-6 6"/>'),
        };
    }

    static _cjs() {
        try { return (typeof window !== 'undefined' && window.customJS) || null; } catch (_e) { return null; }
    }

    static _te() { const c = TaskJump._cjs(); return (c && c.TaskEntity) || null; }
    static _td() { const c = TaskJump._cjs(); return (c && c.TaskDocs) || null; }

    static _str(v) { return v == null ? '' : String(v).trim(); }

    static _base(path) {
        const p = String(path == null ? '' : path);
        return p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '');
    }

    static _unlink(v) {
        let s = TaskJump._str(v);
        const m = /^\[\[([^\]]*)\]\]$/.exec(s);
        if (m) s = m[1];
        const pipe = s.indexOf('|');
        if (pipe >= 0) s = s.slice(0, pipe);
        return TaskJump._base(s.trim());
    }

    static _date(v) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(TaskJump._str(v));
        return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
    }

    static _taskPathOf(docPath) {
        const TD = TaskJump._td();
        if (TD && typeof TD.taskPathOf === 'function') return TD.taskPathOf(docPath);
        const parts = String(docPath == null ? '' : docPath).split('/');
        if (parts.length < 4 || parts[parts.length - 2] !== 'notes') return '';
        const dir = parts.slice(0, -2);
        return dir.join('/') + '/' + dir[dir.length - 1] + '.md';
    }

    /** A TaskDocs static (KINDS, TONES), read through the stored instance's class. */
    static _tdStatic(name, fallback) {
        try {
            const TD = TaskJump._td();
            if (!TD) return fallback;
            if (TD[name] != null) return TD[name];
            const C = TD.constructor;
            return C && C[name] != null ? C[name] : fallback;
        } catch (_e) { return fallback; }
    }

    static _kinds() {
        const k = TaskJump._tdStatic('KINDS', []);
        return Array.isArray(k) ? k : [];
    }

    /**
     * open, done or deleted. Status decides; a note under _trash/ is
     * deleted, and a note with no status under _done/ is done.
     */
    static stateOf(path, fm) {
        const p = String(path == null ? '' : path);
        const status = TaskJump._str(fm && fm.status).toLowerCase();
        if (p.indexOf(TaskJump.ROOT + '/_trash/') === 0 || status === 'deleted') return 'deleted';
        if (status === 'done') return 'done';
        if (!status && p.indexOf(TaskJump.ROOT + '/_done/') === 0) return 'done';
        return 'open';
    }

    /** "Nov 20", with the year when it is not today's year. */
    static fmtDay(dateStr, todayStr) {
        const d = TaskJump._date(dateStr);
        if (!d) return '';
        const label = TaskJump._MONTHS[Number(d.slice(5, 7)) - 1] + ' ' + Number(d.slice(8, 10));
        const t = TaskJump._date(todayStr);
        return t && t.slice(0, 4) !== d.slice(0, 4) ? label + ', ' + d.slice(0, 4) : label;
    }

    /**
     * Metadata-cache records for every markdown file under spice/tasks:
     * { path, basename, mtime, fm }. No file reads. Never throws.
     */
    static collect(app) {
        const out = [];
        try {
            const files = app && app.vault && typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
            const root = TaskJump.ROOT + '/';
            for (const f of files || []) {
                const p = String((f && f.path) || '');
                if (p.indexOf(root) !== 0) continue;
                let fm = null;
                try { fm = (app.metadataCache.getFileCache(f) || {}).frontmatter || null; } catch (_e) { fm = null; }
                if (!fm) continue;
                out.push({ path: p, basename: f.basename, mtime: (f.stat && f.stat.mtime) || 0, fm });
            }
        } catch (_e) {}
        return out;
    }

    /**
     * The picker rows, in order: open tasks (by due date, undated last),
     * done tasks (newest completed first), trashed tasks (newest first),
     * then task notes (newest first). Tasks are `type: task`, notes
     * `type: task-doc`, both under spice/tasks; spice/tasks/_sets/ is left
     * out. opts.today (YYYY-MM-DD) marks late due dates. Pure.
     */
    static build(records, opts) {
        const today = TaskJump._date(opts && opts.today);
        const root = TaskJump.ROOT + '/';
        const recs = (Array.isArray(records) ? records : []).filter((r) => {
            const p = String((r && r.path) || '');
            if (p.indexOf(root) !== 0 || !/\.md$/i.test(p)) return false;
            if (TaskJump.SKIP.some((s) => p.indexOf(s) === 0)) return false;
            const type = TaskJump._str(r.fm && r.fm.type);
            return type === 'task' || type === 'task-doc';
        });
        const byPath = new Map(recs.map((r) => [r.path, r]));
        const titleOf = (r) => {
            const t = TaskJump._str(r && r.fm && r.fm.title);
            return t || TaskJump._str(r && r.basename) || TaskJump._base(r && r.path);
        };
        const titleAt = (p) => (byPath.has(p) ? titleOf(byPath.get(p)) : TaskJump._base(p));
        const TE = TaskJump._te();
        const parentOf = (p) => (TE && typeof TE.parentNotePathOf === 'function' ? TE.parentNotePathOf(p) : '');
        const chainAbove = (p) => {
            const chain = [];
            let up = parentOf(p);
            for (let i = 0; up && i < 12; i++) {
                chain.unshift(titleAt(up));
                up = parentOf(up);
            }
            return chain;
        };
        const kinds = TaskJump._kinds();
        const kindMeta = (k) => kinds.find((x) => x.key === k) || kinds.find((x) => x.key === 'note') || { key: 'note', label: 'Note', icon: '' };
        const kindKey = (v) => {
            const k = TaskJump._str(v).toLowerCase();
            return kinds.some((x) => x.key === k) ? k : 'note';
        };

        const items = [];
        for (const r of recs) {
            const fm = r.fm || {};
            const title = titleOf(r);
            if (TaskJump._str(fm.type) === 'task') {
                const state = TaskJump.stateOf(r.path, fm);
                let trail = chainAbove(r.path);
                if (!trail.length && fm.parent_task) {
                    const parent = TaskJump._unlink(fm.parent_task);
                    if (parent) trail = [parent];
                }
                const due = TaskJump._date(fm.due);
                let meta = 'Open';
                let late = false;
                if (state === 'done') meta = 'Done';
                else if (state === 'deleted') meta = 'Trashed';
                else if (due) {
                    meta = 'Due ' + TaskJump.fmtDay(due, today);
                    late = !!today && due < today;
                }
                items.push({
                    path: r.path, title, task: true, state, kind: 'task', group: TaskJump.GROUPS[state],
                    trail, meta, late, due, done: TaskJump._str(fm.completed_at), mtime: Number(r.mtime) || 0,
                });
            } else {
                const k = kindKey(fm.kind);
                const meta = kindMeta(k);
                const taskPath = TaskJump._taskPathOf(r.path);
                let trail = [];
                if (taskPath) trail = chainAbove(taskPath).concat([titleAt(taskPath)]);
                else if (fm.task) {
                    const t = TaskJump._unlink(fm.task);
                    if (t) trail = [t];
                }
                items.push({
                    path: r.path, title, task: false, state: null, kind: k, group: TaskJump.GROUPS.doc,
                    trail, meta: meta.label, late: false, due: '', done: '', mtime: Number(r.mtime) || 0,
                });
            }
        }
        const byTitle = (a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
        const within = (a, b) => {
            if (a.group === TaskJump.GROUPS.open) {
                if (a.due !== b.due) {
                    if (!a.due) return 1;
                    if (!b.due) return -1;
                    return a.due < b.due ? -1 : 1;
                }
                return byTitle(a, b);
            }
            if (a.group === TaskJump.GROUPS.done && a.done !== b.done) return a.done < b.done ? 1 : -1;
            return (b.mtime - a.mtime) || byTitle(a, b);
        };
        items.sort((a, b) => (a.group - b.group) || within(a, b));
        return items;
    }

    static _norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

    static _fuzzy(q, t) {
        let at = -1;
        let first = -1;
        let gaps = 0;
        let starts = 0;
        for (const ch of q) {
            const i = t.indexOf(ch, at + 1);
            if (i < 0) return null;
            if (first < 0) first = i;
            else gaps += i - at - 1;
            if (i === 0 || !/[a-z0-9]/.test(t[i - 1])) starts++;
            at = i;
        }
        return starts * 3 - gaps * 2 - first;
    }

    /**
     * How well `query` matches a row whose title is `title` and whose other
     * text (trail, kind) is `extra`: { tier, bonus }, or null for no match.
     * Higher tier wins: 7 exact title, 6 title starts with it, 5 a title
     * word starts with it, 4 inside the title, 3 every word inside the
     * title, 2 every word inside the title or trail, 1 its letters in order
     * in the title. Bonus breaks ties within a tier. Pure.
     */
    static score(query, title, extra) {
        const q = TaskJump._norm(query);
        if (!q) return { tier: 0, bonus: 0 };
        const t = TaskJump._norm(title);
        const x = TaskJump._norm(extra);
        if (t === q) return { tier: 7, bonus: 0 };
        if (t.indexOf(q) === 0) return { tier: 6, bonus: -t.length };
        let at = t.indexOf(q, 1);
        while (at > 0) {
            if (!/[a-z0-9]/.test(t[at - 1])) return { tier: 5, bonus: -at };
            at = t.indexOf(q, at + 1);
        }
        const i = t.indexOf(q);
        if (i >= 0) return { tier: 4, bonus: -i };
        const words = q.split(' ');
        if (words.length > 1 && words.every((w) => t.indexOf(w) >= 0)) return { tier: 3, bonus: -t.length };
        if (x) {
            const both = t + ' ' + x;
            if (words.every((w) => both.indexOf(w) >= 0)) return { tier: 2, bonus: -t.length };
        }
        const f = TaskJump._fuzzy(q.replace(/ /g, ''), t);
        if (f != null) return { tier: 1, bonus: f };
        return null;
    }

    /**
     * Rows matching `query`, best first: by tier, then group (open, done,
     * trashed, notes), then bonus, then build order. An empty query keeps
     * every row in build order. Pure.
     */
    static rank(items, query) {
        const list = Array.isArray(items) ? items : [];
        if (!TaskJump._norm(query)) return list.slice();
        const scored = [];
        list.forEach((item, index) => {
            const extra = (item.trail || []).join(' ') + (item.task ? '' : ' ' + item.meta);
            const s = TaskJump.score(query, item.title, extra);
            if (s) scored.push({ item, index, tier: s.tier, bonus: s.bonus });
        });
        scored.sort((a, b) => (b.tier - a.tier) || (a.item.group - b.item.group) || (b.bonus - a.bonus) || (a.index - b.index));
        return scored.map((s) => s.item);
    }

    static isNewTab(evt) { return !!(evt && (evt.metaKey || evt.ctrlKey)); }

    /** Fill one suggestion element. Never throws. */
    static renderRow(item, el) {
        try {
            if (!item || !el || typeof el.createEl !== 'function') return;
            if (el.classList) el.classList.add('mod-complex', 'sauce-tj-item');
            const iconBox = el.createEl('div', { cls: 'suggestion-icon' });
            const icon = iconBox.createEl('span', { cls: 'suggestion-flair sauce-tj-icon' + (item.task ? ' is-task is-' + item.state : ' is-doc') });
            if (icon.setAttribute) icon.setAttribute('data-kind', item.kind);
            let glyph = '';
            if (item.task) glyph = TaskJump.ICON[item.state] || TaskJump.ICON.open;
            else {
                const k = TaskJump._kinds().find((x) => x.key === item.kind);
                glyph = (k && k.icon) || '';
            }
            icon.innerHTML = glyph;
            const content = el.createEl('div', { cls: 'suggestion-content' });
            content.createEl('div', { cls: 'suggestion-title sauce-tj-title' + (item.state === 'deleted' ? ' is-trashed' : ''), text: item.title });
            if (item.trail && item.trail.length) content.createEl('div', { cls: 'suggestion-note sauce-tj-trail', text: item.trail.join(' › ') });
            const aux = el.createEl('div', { cls: 'suggestion-aux' });
            aux.createEl('span', { cls: 'sauce-tj-meta' + (item.late ? ' is-late' : '') + (item.state === 'done' ? ' is-done' : ''), text: item.meta });
        } catch (_e) {}
    }

    /** Open the row's note; in a new tab when newTab. Never throws. */
    static openItem(app, item, newTab) {
        try {
            if (!app || !item || !item.path) return;
            const f = app.vault && typeof app.vault.getAbstractFileByPath === 'function' ? app.vault.getAbstractFileByPath(item.path) : null;
            if (f && app.workspace && typeof app.workspace.getLeaf === 'function') {
                app.workspace.getLeaf(newTab ? 'tab' : false).openFile(f);
                return;
            }
            app.workspace.openLinkText(item.path, '', !!newTab);
        } catch (_e) {}
    }

    static get _CSS() {
        const tones = TaskJump._tdStatic('TONES', {}) || {};
        return [
            '.sauce-tj-modal .sauce-tj-item { min-height: 36px; align-items: center; }',
            '.sauce-tj-icon { display: inline-flex; align-items: center; color: var(--text-muted); }',
            '.sauce-tj-icon.is-done { color: var(--color-green, var(--text-muted)); }',
            '.sauce-tj-icon.is-deleted { color: var(--text-faint); }',
            ...Object.entries(tones).map(([k, c]) => '.sauce-tj-icon.is-doc[data-kind="' + k + '"] { color: ' + c + '; }'),
            '.sauce-tj-title.is-trashed { color: var(--text-muted); text-decoration: line-through; }',
            '.sauce-tj-trail { color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-tj-meta { font-size: var(--font-ui-smaller, 0.8em); color: var(--text-muted); white-space: nowrap; }',
            '.sauce-tj-meta.is-late { color: var(--text-error); }',
        ].join('\n');
    }

    static _injectCss() {
        try {
            if (typeof document === 'undefined' || !document.head) return;
            let s = document.getElementById('sauce-task-jump-css');
            if (!s) {
                s = document.createElement('style');
                s.id = 'sauce-task-jump-css';
                document.head.appendChild(s);
            }
            const css = TaskJump._CSS;
            if (s.textContent !== css) s.textContent = css;
        } catch (_e) {}
    }

    static _choose(modal, evt) {
        try {
            if (typeof modal.selectActiveSuggestion === 'function') { modal.selectActiveSuggestion(evt); return; }
            if (modal.chooser && typeof modal.chooser.useSelectedItem === 'function') modal.chooser.useSelectedItem(evt);
        } catch (_e) {}
    }

    /** The picker class, built once from Obsidian's SuggestModal; null when it is missing. */
    static _modalClass() {
        const cjs = TaskJump._cjs();
        const Base = cjs && cjs.obsidian && cjs.obsidian.SuggestModal;
        if (typeof Base !== 'function') return null;
        if (TaskJump._cls && TaskJump._clsBase === Base) return TaskJump._cls;
        const J = TaskJump;
        const Picker = class extends Base {
            constructor(app, items) {
                super(app);
                this._items = items;
                this._newTab = false;
                this.limit = J.LIMIT;
                this.emptyStateText = 'No task or note matches.';
                try { this.setPlaceholder('Jump to a task or note'); } catch (_e) {}
                try { if (this.modalEl && this.modalEl.classList) this.modalEl.classList.add('sauce-tj-modal'); } catch (_e) {}
                try {
                    this.scope.register(['Mod'], 'Enter', (evt) => {
                        this._newTab = true;
                        J._choose(this, evt);
                        return false;
                    });
                } catch (_e) {}
                try {
                    if (!(app && app.isMobile)) {
                        const mac = !!(cjs.obsidian.Platform && cjs.obsidian.Platform.isMacOS);
                        this.setInstructions([
                            { command: '↑↓', purpose: 'to move' },
                            { command: '↵', purpose: 'to open' },
                            { command: (mac ? '⌘' : 'Ctrl') + ' ↵', purpose: 'to open in a new tab' },
                            { command: 'esc', purpose: 'to close' },
                        ]);
                    }
                } catch (_e) {}
            }
            getSuggestions(query) { return J.rank(this._items, query).slice(0, J.LIMIT); }
            renderSuggestion(item, el) { J.renderRow(item, el); }
            onChooseSuggestion(item, evt) { J.openItem(this.app, item, this._newTab || J.isNewTab(evt)); }
        };
        TaskJump._cls = Picker;
        TaskJump._clsBase = Base;
        return Picker;
    }

    /** Open the picker. opts.app overrides window.app. Returns the modal, or null. */
    static open(opts) {
        try {
            const app = (opts && opts.app) || (typeof window !== 'undefined' ? window.app : null);
            const Picker = TaskJump._modalClass();
            if (!app || !Picker) {
                if (typeof Notice === 'function') new Notice('Jump is not available yet. Try again in a moment.', 5000);
                return null;
            }
            let today = '';
            try { today = window.moment ? window.moment().format('YYYY-MM-DD') : ''; } catch (_e) { today = ''; }
            TaskJump._injectCss();
            const modal = new Picker(app, TaskJump.build(TaskJump.collect(app), { today }));
            modal.open();
            return modal;
        } catch (e) {
            try { if (typeof Notice === 'function') new Notice('Could not open Jump: ' + ((e && e.message) || e), 6000); } catch (_e) {}
            return null;
        }
    }
}
