/**
 * PeoplePicker (CustomJS) — the one attendee picker.
 *
 * Every place that picks people for a note uses this: the New meeting
 * dialog, Edit attendees on a meeting, and EntityCreate's `people-multi`
 * prompt. It renders into any host: a chip row of the people picked so
 * far, a search field, a scrolling list of people under spice/people/
 * (the People hub excluded) and a "＋ Add new person" button that creates
 * a person stub for a name nobody has yet.
 *
 * Names are trimmed and their inner whitespace collapsed. A name that
 * cannot be a note filename (/ \ : * ? " < > | # ^ [ ], or a leading dot)
 * is refused with a caption instead of leaving a broken wikilink. Nothing
 * here throws out of a click.
 *
 * Markup reuses TaskDialog's classes (sauce-task-link-chip, sauce-task-chip-x,
 * sauce-task-picker-results / -row, sauce-task-quiet, sauce-task-caption), so
 * inside a TaskDialog.openShell dialog it looks like the task dialog. Its own
 * layout rules are injected once as PICKER_CSS.
 *
 * BARE CLASS ONLY — the CustomJS loader evals the file as one expression.
 * customJS stores an INSTANCE, so every static has an instance delegate.
 */
class PeoplePicker {

    cleanName(raw) { return PeoplePicker.cleanName(raw); }
    isHostile(raw) { return PeoplePicker.isHostile(raw); }
    listPeople(app) { return PeoplePicker.listPeople(app); }
    stubBody(name, iso) { return PeoplePicker.stubBody(name, iso); }
    rows(people, selected, query) { return PeoplePicker.rows(people, selected, query); }
    addState(people, query) { return PeoplePicker.addState(people, query); }
    createStub(app, name, now) { return PeoplePicker.createStub(app, name, now); }
    mount(host, opts) { return PeoplePicker.mount(host, opts); }
    get PICKER_CSS() { return PeoplePicker.PICKER_CSS; }

    static get PEOPLE_DIR() { return 'spice/people/'; }

    /** Characters a person note's filename (and so its wikilink) cannot hold. */
    static get HOSTILE_RE() { return /[\\/:*?"<>|#^[\]]/; }

    /** True when `raw`, once trimmed, cannot be a person filename. */
    static isHostile(raw) {
        const s = String(raw == null ? '' : raw).trim();
        return !!s && (PeoplePicker.HOSTILE_RE.test(s) || s.charAt(0) === '.');
    }

    /** Trimmed name with inner whitespace collapsed; '' when empty or path-hostile. */
    static cleanName(raw) {
        const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
        if (!s || PeoplePicker.isHostile(s)) return '';
        return s;
    }

    /** Basenames of spice/people/*.md (the People hub excluded), sorted. [] on any failure. */
    static listPeople(app) {
        try {
            return app.vault.getMarkdownFiles()
                .filter((f) => f.path.startsWith(PeoplePicker.PEOPLE_DIR) && f.basename !== 'People')
                .map((f) => f.basename)
                .sort((a, b) => a.localeCompare(b));
        } catch (_e) {
            return [];
        }
    }

    /** The person stub a new name gets (same body Edit attendees writes). */
    static stubBody(name, iso) {
        return `---\ntype: person\ncreated_at: "${iso}"\naliases: []\n---\n\n# [[${name}]]\n\n## Notes\n-\n`;
    }

    /**
     * The list rows: everyone in `people` plus anyone already selected, sorted,
     * narrowed to names containing every word of `query` (selected people
     * always stay listed so they can be unticked).
     *   → [{ name, selected }]
     */
    static rows(people, selected, query) {
        const sel = selected instanceof Set ? selected : new Set(selected || []);
        const all = Array.from(new Set([].concat(people || [], Array.from(sel)))).filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        const words = String(query == null ? '' : query).toLowerCase().split(/\s+/).filter(Boolean);
        return all
            .filter((n) => sel.has(n) || words.every((w) => n.toLowerCase().indexOf(w) >= 0))
            .map((n) => ({ name: n, selected: sel.has(n) }));
    }

    /**
     * Whether the typed text can become a new person.
     *   { canAdd, name, reason: '' | 'empty' | 'exists' | 'hostile' }
     */
    static addState(people, query) {
        const typed = String(query == null ? '' : query).trim();
        if (!typed) return { canAdd: false, name: '', reason: 'empty' };
        if (PeoplePicker.isHostile(typed)) return { canAdd: false, name: '', reason: 'hostile' };
        const name = PeoplePicker.cleanName(typed);
        const lc = name.toLowerCase();
        if ((people || []).some((n) => String(n).toLowerCase() === lc)) return { canAdd: false, name, reason: 'exists' };
        return { canAdd: true, name, reason: '' };
    }

    /**
     * Create spice/people/<name>.md unless it exists. `now` is a moment (or
     * anything with format()); without one the stub carries an ISO time.
     * Resolves true when the person note exists afterwards, false otherwise.
     * Never throws.
     */
    static async createStub(app, name, now) {
        const clean = PeoplePicker.cleanName(name);
        if (!clean || !app || !app.vault) return false;
        const path = PeoplePicker.PEOPLE_DIR + clean + '.md';
        try {
            if (app.vault.getAbstractFileByPath(path)) return true;
            let iso = '';
            try { iso = (now && typeof now.format === 'function') ? now.format('YYYY-MM-DDTHH:mm:ssZ') : new Date().toISOString(); }
            catch (_e) { iso = ''; }
            // gesture-write-ok: creates one new person stub, never rewrites an existing note.
            await app.vault.create(path, PeoplePicker.stubBody(clean, iso));
            return true;
        } catch (_e) {
            return false;
        }
    }

    /**
     * Render the picker into `host`.
     *   opts.app        — Obsidian app (defaults to the global)
     *   opts.people     — candidate names (defaults to listPeople(app)); the
     *                     array is shared, so a host can see added people
     *   opts.selected   — a Set or array of names already picked (a Set is shared)
     *   opts.onChange   — called with the picked names after every change
     *   opts.onAdd      — async (name, api) → true when the person now exists.
     *                     Defaults to createStub. On true the picker selects
     *                     the name, clears the search and redraws.
     *   opts.now        — moment for the default stub's created_at
     *   opts.placeholder, opts.autofocus
     * Returns { root, input, list, chips, addBtn, note, people, selected,
     *           names(), redraw(), refreshAdd(), add(), whenIdle() }.
     */
    static mount(host, opts) {
        const o = opts || {};
        const app = o.app || ((typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null);
        const people = Array.isArray(o.people) ? o.people : PeoplePicker.listPeople(app);
        const selected = o.selected instanceof Set ? o.selected : new Set((o.selected || []).filter(Boolean));
        PeoplePicker._injectCss(host);

        const TD = (typeof globalThis !== 'undefined' && globalThis.customJS) ? globalThis.customJS.TaskDialog : null;
        const fieldCss = (TD && TD.FIELD_CSS) || 'width:100%; min-width:0; box-sizing:border-box;';

        const root = host.createDiv({ cls: 'sauce-people-picker' });
        const chips = root.createDiv({ cls: 'sauce-task-link-chips sauce-people-picker-chips' });
        const input = root.createEl('input', { type: 'text', cls: 'sauce-people-picker-search' });
        input.placeholder = o.placeholder || 'Search or add a person…';
        try { input.setAttribute('aria-label', 'Search people'); } catch (_e) {}
        try { input.setAttribute('autocomplete', 'off'); } catch (_e) {}
        input.style.cssText = fieldCss;
        const list = root.createDiv({ cls: 'sauce-task-picker-results sauce-people-picker-list' });
        try { list.setAttribute('role', 'listbox'); list.setAttribute('aria-multiselectable', 'true'); } catch (_e) {}
        const addBtn = root.createEl('button', { cls: 'sauce-task-quiet sauce-people-picker-add', text: '＋ Add new person' });
        try { addBtn.setAttribute('type', 'button'); } catch (_e) {}
        const note = root.createDiv({ cls: 'sauce-task-caption sauce-people-picker-note' });

        let chain = Promise.resolve();
        const names = () => Array.from(selected);
        const changed = () => { if (typeof o.onChange === 'function') { try { o.onChange(names()); } catch (_e) {} } };

        const renderChips = () => {
            chips.empty();
            for (const name of selected) {
                const chip = chips.createDiv({ cls: 'sauce-task-link-chip sauce-people-picker-chip' });
                chip.createSpan({ text: name });
                const x = chip.createEl('button', { cls: 'sauce-task-chip-x', text: '✕' });
                try { x.setAttribute('type', 'button'); x.setAttribute('aria-label', 'Remove ' + name); } catch (_e) {}
                x.onclick = () => { selected.delete(name); redraw(); changed(); };
            }
            chips.style.display = selected.size ? '' : 'none';
        };
        const renderList = () => {
            list.empty();
            const rows = PeoplePicker.rows(people, selected, input.value);
            if (!rows.length) {
                list.createDiv({ cls: 'sauce-task-picker-empty', text: people.length ? 'No one matches' : 'No people yet' });
                return;
            }
            for (const r of rows) {
                const row = list.createDiv({ cls: 'sauce-task-picker-row sauce-people-picker-row' + (r.selected ? ' is-selected' : '') });
                try { row.setAttribute('role', 'option'); row.setAttribute('aria-selected', r.selected ? 'true' : 'false'); } catch (_e) {}
                row.createSpan({ cls: 'sauce-people-picker-check', text: r.selected ? '✓' : '' });
                row.createSpan({ cls: 'sauce-people-picker-name', text: r.name });
                row.onclick = () => {
                    if (selected.has(r.name)) selected.delete(r.name); else selected.add(r.name);
                    redraw();
                    changed();
                };
            }
        };
        const refreshAdd = () => {
            const st = PeoplePicker.addState(people, input.value);
            addBtn.textContent = st.canAdd ? '＋ Add new person “' + st.name + '”' : '＋ Add new person';
            addBtn.disabled = !st.canAdd;
            addBtn.style.display = st.canAdd ? '' : 'none';
            const text = st.reason === 'hostile' ? 'A name can’t contain / \\ : * ? " < > | # ^ [ ] or start with a dot.' : '';
            note.textContent = text;
            note.style.display = text ? '' : 'none';
        };
        const redraw = () => { renderChips(); renderList(); refreshAdd(); };

        const add = () => {
            const st = PeoplePicker.addState(people, input.value);
            if (!st.canAdd) { refreshAdd(); return chain; }
            const name = st.name;
            const run = async () => {
                let ok = false;
                try {
                    ok = typeof o.onAdd === 'function'
                        ? await o.onAdd(name, api)
                        : await PeoplePicker.createStub(app, name, o.now);
                } catch (_e) { ok = false; }
                if (ok === true) {
                    if (people.indexOf(name) < 0) { people.push(name); people.sort((a, b) => a.localeCompare(b)); }
                    selected.add(name);
                    if (PeoplePicker.cleanName(input.value).toLowerCase() === name.toLowerCase()) input.value = '';
                    redraw();
                    changed();
                }
                return ok === true;
            };
            const result = chain.then(run, run);
            chain = result.then(() => undefined, () => undefined);
            return result;
        };

        input.oninput = () => { renderList(); refreshAdd(); };
        // Enter picks the person the search narrows to (an exact name, or the
        // only match); otherwise it adds the typed name as a new person. It
        // never submits the dialog around the picker.
        input.addEventListener('keydown', (ev) => {
            if (!ev || ev.key !== 'Enter' || ev.isComposing || ev.metaKey || ev.ctrlKey) return;
            if (ev.preventDefault) ev.preventDefault();
            if (ev.stopPropagation) ev.stopPropagation();
            const q = PeoplePicker.cleanName(input.value).toLowerCase();
            const hits = q ? PeoplePicker.rows(people, new Set(), input.value) : [];
            const target = hits.find((h) => h.name.toLowerCase() === q) || (hits.length === 1 ? hits[0] : null);
            if (target) {
                selected.add(target.name);
                input.value = '';
                redraw();
                changed();
                return;
            }
            add();
        });
        addBtn.onclick = () => add();

        const api = {
            root, input, list, chips, addBtn, note, people, selected,
            names, redraw, renderChips, refreshAdd, add,
            whenIdle: () => chain,
        };
        redraw();
        if (o.autofocus) setTimeout(() => { try { input.focus(); } catch (_e) {} }, 30);
        return api;
    }

    static _injectCss(host) {
        try {
            const doc = (host && host.ownerDocument) || (typeof document !== 'undefined' ? document : null);
            const head = doc && doc.head;
            if (!head || typeof doc.createElement !== 'function') return;
            const ID = 'sauce-people-picker-css';
            let el = Array.from(head.children || []).find((c) => c && c.id === ID) || null;
            if (!el) {
                el = doc.createElement('style');
                el.id = ID;
                head.appendChild(el);
            }
            if (el.textContent !== PeoplePicker.PICKER_CSS) el.textContent = PeoplePicker.PICKER_CSS;
        } catch (_e) { /* unstyled is still usable */ }
    }

    /**
     * Picker layout. The list scrolls inside the dialog (overscroll contained),
     * a long name ellipsizes instead of widening the dialog, and on a phone the
     * list is shorter so the search field stays above the keyboard.
     */
    static get PICKER_CSS() {
        return [
            '.sauce-people-picker { display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
            '.sauce-people-picker-chips { min-width: 0; }',
            '.sauce-people-picker-chip { min-width: 0; max-width: 100%; }',
            '.sauce-people-picker-chip > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-people-picker-list.sauce-task-picker-results { margin-top: 0; max-height: 200px; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }',
            '.sauce-people-picker-row { display: flex; align-items: center; gap: 8px; min-width: 0; }',
            '.sauce-people-picker-row.is-selected { font-weight: 600; }',
            '.sauce-people-picker-check { flex: 0 0 14px; color: var(--interactive-accent); }',
            '.sauce-people-picker-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            'button.sauce-people-picker-add { align-self: flex-start; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sauce-people-picker-note { margin-top: 0; color: var(--text-error); }',
            '@media (max-width: 600px) { .sauce-people-picker-list.sauce-task-picker-results { max-height: 168px; } }',
            'body.is-phone .sauce-people-picker-list.sauce-task-picker-results { max-height: 168px; }',
            '',
        ].join('\n');
    }
}
