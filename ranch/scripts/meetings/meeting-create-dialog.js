/**
 * MeetingCreateDialog (CustomJS) — "+ New Meeting" as one dialog.
 *
 * Every field is on screen at once, laid out like the task dialog: title
 * and attendees on the left; When (Now / Next hour / Tomorrow 9 AM /
 * Pick…, with a caption) and Project on the right; Cancel and
 * "Create meeting" in the footer. Enter in the title or ⌘↵ / Ctrl↵ anywhere
 * creates; Esc, ✕ and the backdrop close.
 *
 * It only gathers input. The answers go to EntityCreate.create() as
 * presetPrompts, which skips each prompt it is handed, so the note's
 * path, frontmatter, body, the `|links` pipe, the structural lifecycle and
 * its receipt are exactly what the old prompt chain produced for the same
 * answers.
 *
 * Built from the task dialog's parts (TaskDialog.openShell, pill, setPressed,
 * sectionLabel, actionButton, projectField, isCmdEnter; _DIALOG_CSS styles it,
 * phone block included) and the shared PeoplePicker. When any of those, or
 * EntityCreate, is not loaded, open() returns false and the caller falls back
 * to EntityCreate's prompts.
 *
 * BARE CLASS ONLY — the CustomJS loader evals the file as one expression.
 * customJS stores an INSTANCE, so every static has an instance delegate.
 */
class MeetingCreateDialog {

    whenOptions(nowValue) { return MeetingCreateDialog.whenOptions(nowValue); }
    whenKeyFor(value, nowValue) { return MeetingCreateDialog.whenKeyFor(value, nowValue); }
    whenCaption(value) { return MeetingCreateDialog.whenCaption(value); }
    payload(state) { return MeetingCreateDialog.payload(state); }
    isValid(state) { return MeetingCreateDialog.isValid(state); }
    recentProjects(app, todayStr) { return MeetingCreateDialog.recentProjects(app, todayStr); }
    get MEETING_CSS() { return MeetingCreateDialog.MEETING_CSS; }

    /** "YYYY-MM-DDTHH:mm" → parts, or null. */
    static _parse(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value == null ? '' : value));
        if (!m) return null;
        return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
    }

    /** Parts (month 1-based, overflow allowed) → "YYYY-MM-DDTHH:mm" via Date.UTC. */
    static _format(y, mo, d, h, mi) {
        const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
        const p = (x) => String(x).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate())
            + 'T' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
    }

    /**
     * The quick When choices for a "YYYY-MM-DDTHH:mm" now. `value` is the
     * datetime each one sets (null for Pick…, which keeps the current value
     * and shows the picker).
     */
    static whenOptions(nowValue) {
        const n = MeetingCreateDialog._parse(nowValue);
        const F = MeetingCreateDialog._format;
        return [
            { key: 'now', label: 'Now', value: n ? F(n.y, n.mo, n.d, n.h, n.mi) : '' },
            { key: 'next-hour', label: 'Next hour', value: n ? F(n.y, n.mo, n.d, n.h + 1, 0) : '' },
            { key: 'tomorrow', label: 'Tomorrow 9 AM', value: n ? F(n.y, n.mo, n.d + 1, 9, 0) : '' },
            { key: 'pick', label: 'Pick…', value: null },
        ];
    }

    /** Which quick choice a value is ('pick' when none matches). */
    static whenKeyFor(value, nowValue) {
        const v = String(value == null ? '' : value);
        const hit = MeetingCreateDialog.whenOptions(nowValue).find((o) => o.value && o.value === v);
        return hit ? hit.key : 'pick';
    }

    /** "Tue Nov 10, 2:30 PM"; "Pick a date and time" when unparseable. */
    static whenCaption(value) {
        const p = MeetingCreateDialog._parse(value);
        if (!p) return 'Pick a date and time';
        const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
        const h12 = ((p.h + 11) % 12) + 1;
        return WD[day] + ' ' + MO[p.mo - 1] + ' ' + p.d + ', ' + h12 + ':' + String(p.mi).padStart(2, '0')
            + (p.h < 12 ? ' AM' : ' PM');
    }

    /**
     * The presetPrompts for EntityCreate's "meeting" spec, in the exact shape
     * its prompts resolve to: title as typed (trimmed), attendees as an array
     * of names, datetime as the datetime-local value, project as "[[Name]]"
     * or "" (what the all_projects select post-processes to).
     */
    static payload(state) {
        const s = state || {};
        const project = String(s.project || '').trim();
        return {
            title: String(s.title || '').trim(),
            attendees: Array.isArray(s.attendees) ? s.attendees.filter(Boolean).slice() : [],
            datetime: String(s.datetime || ''),
            project: project ? '[[' + project + ']]' : '',
        };
    }

    /** Create is allowed once the title has text (the title prompt was required). */
    static isValid(state) {
        return !!String((state && state.title) || '').trim();
    }

    /**
     * Projects of meetings created in the last 30 days, most used first (the
     * same ranking the task dialog uses for tasks). [] on any failure.
     */
    static recentProjects(app, todayStr) {
        const TD = MeetingCreateDialog._cjs().TaskDialog;
        if (!TD || typeof TD.recentProjects !== 'function') return [];
        try {
            const rows = [];
            for (const f of app.vault.getMarkdownFiles() || []) {
                const fp = String((f && f.path) || '');
                if (fp.indexOf('spice/meetings/notes/') !== 0) continue;
                const cache = app.metadataCache.getFileCache(f);
                const fm = cache && cache.frontmatter;
                if (!fm || fm.type !== 'meeting') continue;
                rows.push({ project: fm.project, created_at: fm.created_at });
            }
            return TD.recentProjects(rows, todayStr, 6);
        } catch (_e) {
            return [];
        }
    }

    static _cjs() {
        return (typeof globalThis !== 'undefined' && globalThis.customJS) || {};
    }

    static _injectCss(doc) {
        try {
            const head = doc && doc.head;
            if (!head || typeof doc.createElement !== 'function') return;
            const ID = 'sauce-meeting-create-css';
            let el = Array.from(head.children || []).find((c) => c && c.id === ID) || null;
            if (!el) {
                el = doc.createElement('style');
                el.id = ID;
                head.appendChild(el);
            }
            if (el.textContent !== MeetingCreateDialog.MEETING_CSS) el.textContent = MeetingCreateDialog.MEETING_CSS;
        } catch (_e) { /* unstyled is still usable */ }
    }

    /** The meeting dialog is narrower than the task dialog; everything else is _DIALOG_CSS. */
    static get MEETING_CSS() {
        return [
            '.sauce-modal.sauce-task-dialog.sauce-meeting-create-dialog { width: min(100%, 780px); }',
            '.sauce-meeting-create-dialog .sauce-task-dialog-left { gap: 16px; }',
            '.sauce-meeting-create-dialog .sauce-task-section { min-width: 0; }',
            '',
        ].join('\n');
    }

    /**
     * Open the dialog. opts: { dv, structuralLifecycle, now (a moment) }.
     * Returns true once the dialog is showing, false when a piece it needs is
     * not loaded (the caller then uses EntityCreate's prompts). Never throws.
     */
    open(opts) {
        try { return this._open(opts || {}); } catch (_e) { return false; }
    }

    _open(opts) {
        const cjs = MeetingCreateDialog._cjs();
        const TD = cjs.TaskDialog;
        const PP = cjs.PeoplePicker;
        const EC = cjs.EntityCreate;
        const app = (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
        if (!app || !TD || typeof TD.openShell !== 'function' || typeof TD.projectField !== 'function'
            || !PP || typeof PP.mount !== 'function' || !EC || typeof EC.create !== 'function') return false;

        const now = opts.now || ((typeof window !== 'undefined' && typeof window.moment === 'function') ? window.moment() : null);
        if (!now || typeof now.format !== 'function') return false;
        const nowValue = now.format('YYYY-MM-DDTHH:mm');
        const todayStr = now.format('YYYY-MM-DD');
        const state = { title: '', attendees: [], datetime: nowValue, whenKey: 'now', project: '' };

        let titleInput = null;
        let createBtn = null;
        let picker = null;
        let submitting = false;
        let detachKeys = () => {};
        const doc = (typeof document !== 'undefined') ? document : null;

        const submit = async () => {
            if (submitting || !createBtn || createBtn.disabled) return false;
            submitting = true;
            try { if (picker) await picker.whenIdle(); } catch (_e) {}
            const presetPrompts = MeetingCreateDialog.payload(state);
            shell.close();
            try {
                await EC.create({ instance: 'meeting', dv: opts.dv, presetPrompts, structuralLifecycle: opts.structuralLifecycle || null });
            } catch (e) {
                try { new Notice('Could not create meeting: ' + ((e && e.message) || e), 6000); } catch (_e) {}
            }
            return true;
        };

        const shell = TD.openShell({
            doc,
            title: 'New meeting',
            cls: 'sauce-meeting-create-dialog',
            closeReason: 'meeting-create',
            // SauceModal catches Enter in any field; only the title (and the
            // Create button, and ⌘↵) create. The people search and the
            // project search handle their own Enter.
            onSubmit: (_handle, event) => {
                if (!event) return false;
                if ((titleInput && event.target === titleInput)
                    || (createBtn && event.currentTarget === createBtn)
                    || TD.isCmdEnter(event)) return submit();
                return false;
            },
            onClose: () => { try { detachKeys(); } catch (_e) {} },
        });
        if (!shell) return false;
        MeetingCreateDialog._injectCss(shell.doc);
        const left = shell.left;
        const right = shell.right;

        // ----- Left: title, attendees -----
        titleInput = left.createEl('input', { type: 'text', cls: 'sauce-task-title sauce-meeting-title-input' });
        titleInput.placeholder = 'Meeting title';
        try { titleInput.setAttribute('aria-label', 'Meeting title'); } catch (_e) {}
        titleInput.oninput = () => { state.title = titleInput.value; updateSubmit(); };
        setTimeout(() => { try { titleInput.focus(); } catch (_e) {} }, 50);

        const attSec = left.createDiv({ cls: 'sauce-task-section sauce-meeting-attendees' });
        TD.sectionLabel(attSec, 'Attendees');
        picker = PP.mount(attSec, {
            app,
            now,
            onChange: (names) => { state.attendees = names; },
        });

        // ----- Right: When -----
        const whenSec = right.createDiv({ cls: 'sauce-task-section sauce-meeting-when-section' });
        TD.sectionLabel(whenSec, 'When');
        const whenRow = whenSec.createDiv({ cls: 'sauce-task-pill-row' });
        const WHEN = 'sauce-task-pill sauce-meeting-when';
        const whenOpts = MeetingCreateDialog.whenOptions(nowValue);
        const whenBtns = whenOpts.map((o) => {
            const b = TD.pill(whenRow, WHEN, o.label);
            try { b.setAttribute('data-key', o.key); } catch (_e) {}
            b.onclick = () => setWhen(o.key);
            return { el: b, key: o.key };
        });
        const whenInput = whenSec.createEl('input', { type: 'datetime-local', cls: 'sauce-meeting-when-input' });
        try { whenInput.setAttribute('aria-label', 'Date and time'); } catch (_e) {}
        whenInput.style.cssText = TD.DATE_CSS + ' margin-top:8px;';
        const whenCaption = whenSec.createDiv({ cls: 'sauce-task-caption sauce-meeting-when-caption' });
        const renderWhen = () => {
            for (const w of whenBtns) TD.setPressed(w.el, WHEN, w.key === state.whenKey);
            whenInput.style.display = state.whenKey === 'pick' ? '' : 'none';
            if (whenInput.value !== state.datetime) whenInput.value = state.datetime;
            whenCaption.textContent = MeetingCreateDialog.whenCaption(state.datetime);
        };
        const setWhen = (key) => {
            state.whenKey = key;
            const o = whenOpts.find((x) => x.key === key);
            if (o && o.value) state.datetime = o.value;
            renderWhen();
            if (key === 'pick') setTimeout(() => { try { whenInput.focus(); } catch (_e) {} }, 0);
        };
        whenInput.onchange = () => {
            // An emptied picker keeps the last datetime: the note always gets one.
            if (whenInput.value) state.datetime = whenInput.value;
            state.whenKey = 'pick';
            renderWhen();
        };
        whenInput.oninput = whenInput.onchange;
        renderWhen();

        // ----- Right: Project -----
        TD.projectField(right, {
            app,
            recentNames: MeetingCreateDialog.recentProjects(app, todayStr),
            value: '',
            onChange: (name) => { state.project = name; },
        });

        // ----- Footer -----
        const footRight = shell.footer.createDiv({ cls: 'sauce-task-footer-right' });
        const cancelBtn = TD.actionButton(footRight, { label: 'Cancel', cls: 'sauce-meeting-cancel' });
        cancelBtn.onclick = () => shell.close();
        const kbd = typeof TD._submitKeyHint === 'function' ? TD._submitKeyHint(app) : '';
        createBtn = TD.actionButton(footRight, { label: 'Create meeting', kbd, variant: 'accent', cls: 'sauce-meeting-create' });
        try { createBtn.classList.add('mod-cta'); } catch (_e) {}
        createBtn.onclick = (event) => shell.handle.submit(event);
        const updateSubmit = () => { createBtn.disabled = !MeetingCreateDialog.isValid(state); };
        updateSubmit();

        // ⌘↵ / Ctrl↵ from anywhere in the dialog (SauceModal never forwards a modified Enter).
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
