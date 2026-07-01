/**
 * ToDoCreateTask (CustomJS) — tabbed +New Task dialog.
 *
 *   Tabs: One-shot task / Recurring task.
 *   One-shot fields: title, destination (today's daily / project), priority chip,
 *                    optional due date, optional scheduled date.
 *   Recurring fields: title, frequency family, frequency arg (weekday-set /
 *                     day-of-month / N), optional project, priority chip.
 *
 * Static API (Node-testable):
 *   ToDoCreateTask.serializePayloadToLine(payload) → string
 *   ToDoCreateTask.destinationPath(payload, vault_paths) → string
 *   ToDoCreateTask.composeRecurrenceGrammar(payload) → string | null
 *   ToDoCreateTask.validatePayload(payload) → { valid, reason }
 *
 * Instance API (browser-side):
 *   ToDoCreateTask.open({ preselectTab?, preselectDestination? })
 */
class ToDoCreateTask {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.ToDoCreateTask, and
    // cross-class consumers (TaskInteractions mechanism at v0.127.0+) reach
    // serializePayloadToLine via that instance. Static-only declarations are
    // not on the prototype → call throws at runtime. Mirrors TaskParser +
    // RecurrenceParser delegator posture (instance method must precede the
    // static in source order so run-customjs-contract.js .find() returns the
    // non-static first; see customjs-guard semantics).

    serializePayloadToLine(payload) { return ToDoCreateTask.serializePayloadToLine(payload); }

    // ---------- Static pure helpers ----------

    /**
     * Serialize a payload to a `- [ ] ...` task line.
     * payload = {
     *   mode: 'one-shot' | 'recurring',
     *   title: string,
     *   destination: 'today' | { type: 'project', slug, name },
     *   priority?: 'low' | 'medium' | 'high' | 'highest',
     *   due?: 'YYYY-MM-DD',
     *   scheduled?: 'YYYY-MM-DD',
     *   recurrenceGrammar?: string,   // recurring-mode only
     *   project?: { slug, name },     // recurring-mode optional project link
     * }
     */
    static serializePayloadToLine(payload) {
        if (!payload || !payload.title) return null;
        const parts = [`- [ ] ${payload.title.trim()}`];
        if (payload.mode === 'recurring') {
            if (payload.recurrenceGrammar) parts.push(`[recurrence:: ${payload.recurrenceGrammar}]`);
            if (payload.project && payload.project.name) parts.push(`[project:: [[${payload.project.name}]]]`);
            if (payload.priority) parts.push(`[priority:: ${payload.priority}]`);
            return parts.join(' ');
        }
        // one-shot
        if (payload.destination && payload.destination.type === 'project' && payload.destination.name) {
            parts.push(`[project:: [[${payload.destination.name}]]]`);
        }
        if (payload.priority) parts.push(`[priority:: ${payload.priority}]`);
        if (payload.due) parts.push(`[due:: ${payload.due}]`);
        if (payload.scheduled) parts.push(`[scheduled:: ${payload.scheduled}]`);
        return parts.join(' ');
    }

    static destinationPath(payload, vaultMoment) {
        if (payload.mode === 'recurring') {
            return 'spice/to-do/Recurring Tasks.md';
        }
        if (payload.destination === 'today' || (payload.destination && payload.destination.type === 'today')) {
            const m = vaultMoment || (window && window.moment && window.moment());
            if (!m) return null;
            const dStr = m.format ? m.format('YYYY-MM-DD') : null;
            const folder = m.format ? m.format('YYYY/MM-MMMM') : null;
            if (!dStr || !folder) return null;
            return `spice/to-do/${folder}/ToDo-${dStr}.md`;
        }
        if (payload.destination && payload.destination.type === 'project') {
            return `spice/projects/${payload.destination.slug}/${payload.destination.name} To-Do.md`;
        }
        return null;
    }

    static composeRecurrenceGrammar(payload) {
        if (!payload || payload.mode !== 'recurring') return null;
        const { frequency, frequencyArg } = payload;
        if (!frequency) return null;
        switch (frequency) {
            case 'daily': return 'every day';
            case 'weekday-set': return frequencyArg ? `every ${frequencyArg}` : null;
            case 'weekday-block': return 'every weekday';
            case 'weekend-block': return 'every weekend';
            case 'monthly-day-of': {
                const n = parseInt(frequencyArg, 10);
                if (!n || n < 1 || n > 31) return null;
                const suffix = ToDoCreateTask._ordinalSuffix(n);
                return `every ${n}${suffix} of month`;
            }
            case 'every-n-weeks-on': {
                if (!frequencyArg || !frequencyArg.weeks || !frequencyArg.day) return null;
                return `every ${frequencyArg.weeks} weeks on ${frequencyArg.day}`;
            }
            default: return null;
        }
    }

    static _ordinalSuffix(n) {
        const j = n % 10, k = n % 100;
        if (j === 1 && k !== 11) return 'st';
        if (j === 2 && k !== 12) return 'nd';
        if (j === 3 && k !== 13) return 'rd';
        return 'th';
    }

    /**
     * Compose a Markdown hyperlink `[label](url)` for the +New Task inserter.
     * Returns null when the URL is empty (after trim). When the label is empty,
     * falls back to the URL itself so the link still renders.
     */
    static composeMarkdownLink(label, url) {
        const u = (url || '').trim();
        if (!u) return null;
        const l = (label || '').trim() || u;
        return `[${l}](${u})`;
    }

    static validatePayload(payload) {
        if (!payload) return { valid: false, reason: 'empty payload' };
        if (!payload.title || !payload.title.trim()) return { valid: false, reason: 'title required' };
        if (payload.mode === 'one-shot') {
            if (!payload.destination) return { valid: false, reason: 'destination required' };
            if (payload.destination !== 'today' && payload.destination.type !== 'today' && payload.destination.type !== 'project') {
                return { valid: false, reason: 'invalid destination' };
            }
        }
        if (payload.mode === 'recurring') {
            const g = ToDoCreateTask.composeRecurrenceGrammar(payload);
            if (!g) return { valid: false, reason: 'invalid recurrence' };
            // If RecurrenceParser is available, double-check. The grammar was
            // already composed + validated by composeRecurrenceGrammar above, so
            // a throwing/missing parser must NOT disable the Create button —
            // swallow the error and fall through to { valid: true }.
            try {
                if (window.customJS && window.customJS.RecurrenceParser) {
                    if (!window.customJS.RecurrenceParser.isSupported(g)) {
                        return { valid: false, reason: 'unsupported recurrence grammar' };
                    }
                }
            } catch (_e) {
                // Parser double-check failed (e.g. static-only method on the stored
                // instance); skip it. composeRecurrenceGrammar already vetted g.
            }
        }
        if (payload.due && !/^\d{4}-\d{2}-\d{2}$/.test(payload.due)) {
            return { valid: false, reason: 'invalid due date' };
        }
        if (payload.scheduled && !/^\d{4}-\d{2}-\d{2}$/.test(payload.scheduled)) {
            return { valid: false, reason: 'invalid scheduled date' };
        }
        return { valid: true };
    }

    // ---------- Instance API ----------

    open(opts) {
        try {
            this._renderOverlay(opts || {});
        } catch (e) {
            new Notice('ToDoCreateTask error: ' + (e.message || e), 6000);
        }
    }

    _renderOverlay(opts) {
        // Remove any existing overlay defensively.
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
            border-radius: 10px; padding: 18px 20px;
            width: min(440px, 92vw); max-height: 80vh; overflow: auto;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        `;
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        document.addEventListener('keydown', this._escListener = (ev) => {
            if (ev.key === 'Escape') overlay.remove();
        });
        overlay.addEventListener('remove', () => document.removeEventListener('keydown', this._escListener));

        const title = modal.createEl('h3', { text: '+ New Task' });
        title.style.cssText = 'margin: 0 0 14px;';

        // Tabs
        const tabs = modal.createDiv();
        tabs.style.cssText = 'display:flex; gap:2px; margin-bottom:14px; border-bottom:1px solid var(--background-modifier-border, #333);';
        const tabOne = tabs.createEl('div', { text: 'One-shot task' });
        const tabRec = tabs.createEl('div', { text: 'Recurring task' });
        for (const t of [tabOne, tabRec]) {
            t.style.cssText = 'padding: 6px 12px; font-size: 11px; cursor:pointer; border-bottom: 2px solid transparent;';
        }
        const formHost = modal.createDiv();

        const state = {
            mode: opts.preselectTab || 'one-shot',
            title: '',
            destination: opts.preselectDestination || 'today',
            priority: '',
            due: '',
            scheduled: '',
            frequency: 'daily',
            frequencyArg: null,
            project: null,
            editExisting: null,
        };

        // v0.127.0 §F: editExisting mode — opening the modal pre-filled to update
        // an existing `- [ ] ` line in place. Forces one-shot tab (recurring edit
        // is out of scope for this cycle); hydrates state from the parsed task.
        // The submit handler in _appendFooter branches on state.editExisting and
        // dispatches to customJS.TaskInteractions.replaceTaskAt instead of the
        // create-path. Destination cross-file moves are disabled — the source
        // file path is the SAME file we're editing.
        if (opts && opts.editExisting && opts.editExisting.parsed) {
            const p = opts.editExisting.parsed;
            state.editExisting = opts.editExisting;
            state.mode = 'one-shot';
            state.title = p.title || '';
            state.priority = p.priority || '';
            state.due = p.due || '';
            state.scheduled = p.scheduled || '';
            if (p.project) {
                const slug = String(p.project).toLowerCase().replace(/[^a-z0-9]+/g, '-');
                state.destination = { type: 'project', slug, name: p.project };
            } else {
                state.destination = 'today';
            }
        }

        const setTab = (which) => {
            state.mode = which;
            for (const t of [tabOne, tabRec]) t.style.borderBottomColor = 'transparent';
            (which === 'one-shot' ? tabOne : tabRec).style.borderBottomColor = 'var(--interactive-accent, #6a6abf)';
            formHost.innerHTML = '';
            if (which === 'one-shot') this._renderOneShotForm(formHost, state, overlay);
            else this._renderRecurringForm(formHost, state, overlay);
        };
        tabOne.onclick = () => setTab('one-shot');
        tabRec.onclick = () => setTab('recurring');
        setTab(state.mode);
    }

    _renderOneShotForm(host, state, overlay) {
        // Forward-declare updateSubmit so input-handler closures see a stable
        // binding from the moment they're attached. The real updateSubmit is
        // assigned after _appendFooter; let-rebinding propagates to all
        // closures because they capture the binding, not the value.
        let updateSubmit = () => {};

        const label = (text) => {
            const el = host.createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted, #999); margin-top:10px; margin-bottom:4px;';
            return el;
        };

        label('Title');
        const titleInput = host.createEl('input', { type: 'text' });
        titleInput.style.cssText = 'width:100%; padding:6px 8px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:4px; color:var(--text-normal,#ddd);';
        titleInput.value = state.title;
        titleInput.oninput = () => { state.title = titleInput.value; updateSubmit(); };
        setTimeout(() => titleInput.focus(), 50);

        // Optional inserters (note-link picker + URL hyperlink) append to the title.
        // Pass a getter so handlers call the REAL updateSubmit rebound below.
        this._renderInserters(host, state, titleInput, () => updateSubmit);

        label('Destination');
        const destSelect = host.createEl('select');
        destSelect.style.cssText = titleInput.style.cssText;
        const projects = this._loadProjectList();
        const opt0 = destSelect.createEl('option', { text: "Today's daily" });
        opt0.value = 'today';
        for (const p of projects) {
            const o = destSelect.createEl('option', { text: `Project: ${p.name}` });
            o.value = `project:${p.slug}:${p.name}`;
        }
        if (state.destination && state.destination !== 'today' && state.destination.type === 'project') {
            destSelect.value = `project:${state.destination.slug}:${state.destination.name}`;
        }
        // v0.127.0 §F: in editExisting mode, destination is the file we're
        // editing — cross-file moves are out of scope for the inline edit modal.
        if (state.editExisting) {
            destSelect.disabled = true;
            destSelect.style.opacity = '0.5';
        }
        destSelect.onchange = () => {
            if (destSelect.value === 'today') state.destination = 'today';
            else {
                const [_, slug, name] = destSelect.value.split(':');
                state.destination = { type: 'project', slug, name };
            }
            updateSubmit();
        };

        label('Priority');
        const chipRow = host.createDiv();
        chipRow.style.cssText = 'display:flex; gap:4px; margin-top:4px;';
        for (const p of ['', 'low', 'medium', 'high', 'highest']) {
            const c = chipRow.createEl('div', { text: p || 'none' });
            c.style.cssText = 'flex:1; text-align:center; padding:4px 6px; border:1px solid var(--background-modifier-border,#444); border-radius:4px; font-size:11px; cursor:pointer;';
            if (state.priority === p) c.style.background = 'var(--interactive-accent, #6a6abf)';
            c.onclick = () => {
                state.priority = p;
                for (const cc of chipRow.children) cc.style.background = '';
                c.style.background = 'var(--interactive-accent, #6a6abf)';
                updateSubmit();
            };
        }

        label('Due (optional)');
        const dueInput = host.createEl('input', { type: 'date' });
        dueInput.style.cssText = titleInput.style.cssText;
        dueInput.value = state.due;
        dueInput.onchange = () => { state.due = dueInput.value; updateSubmit(); };

        label('Scheduled (optional)');
        const schedInput = host.createEl('input', { type: 'date' });
        schedInput.style.cssText = titleInput.style.cssText;
        schedInput.value = state.scheduled;
        schedInput.onchange = () => { state.scheduled = schedInput.value; updateSubmit(); };

        const footer = this._appendFooter(host, state, overlay);
        updateSubmit = footer.updateSubmit;     // bind closures to the real evaluator
        host.appendChild(footer.submitBtn.parentNode);
        this._wireEnterSubmit(titleInput, footer.submitBtn);   // Enter in Title submits
        updateSubmit();                         // evaluate initial state (in case of presets)
    }

    _renderRecurringForm(host, state, overlay) {
        // Forward-declare updateSubmit (see _renderOneShotForm for rationale).
        let updateSubmit = () => {};

        const label = (text) => {
            const el = host.createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted, #999); margin-top:10px; margin-bottom:4px;';
            return el;
        };

        label('Title');
        const titleInput = host.createEl('input', { type: 'text' });
        titleInput.style.cssText = 'width:100%; padding:6px 8px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:4px; color:var(--text-normal,#ddd);';
        titleInput.value = state.title;
        titleInput.oninput = () => { state.title = titleInput.value; updateSubmit(); };
        setTimeout(() => titleInput.focus(), 50);

        // Optional inserters (note-link picker + URL hyperlink) append to the title.
        // Pass a getter so handlers call the REAL updateSubmit rebound below.
        this._renderInserters(host, state, titleInput, () => updateSubmit);

        label('Frequency');
        const freqSel = host.createEl('select');
        freqSel.style.cssText = titleInput.style.cssText;
        const FREQS = [
            ['daily', 'Daily'],
            ['weekday-set', 'Weekly (pick day)'],
            ['weekday-block', 'Weekdays (Mon-Fri)'],
            ['weekend-block', 'Weekends (Sat-Sun)'],
            ['monthly-day-of', 'Monthly (day of month)'],
            ['every-n-weeks-on', 'Every N weeks on day'],
        ];
        for (const [v, t] of FREQS) {
            const o = freqSel.createEl('option', { text: t });
            o.value = v;
        }
        freqSel.value = state.frequency;
        const freqArgRow = host.createDiv();
        const rebuildArgRow = () => {
            freqArgRow.innerHTML = '';
            if (state.frequency === 'weekday-set') {
                label('On');
                const sel = freqArgRow.createEl('select');
                sel.style.cssText = titleInput.style.cssText;
                for (const d of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
                    sel.createEl('option', { text: d }).value = d;
                }
                sel.onchange = () => { state.frequencyArg = sel.value; updateSubmit(); };
                state.frequencyArg = sel.value;
            } else if (state.frequency === 'monthly-day-of') {
                label('Day of month');
                const inp = freqArgRow.createEl('input', { type: 'number' });
                inp.min = '1'; inp.max = '31'; inp.value = '1';
                inp.style.cssText = titleInput.style.cssText;
                inp.onchange = () => { state.frequencyArg = inp.value; updateSubmit(); };
                state.frequencyArg = inp.value;
            } else if (state.frequency === 'every-n-weeks-on') {
                label('N');
                const inpN = freqArgRow.createEl('input', { type: 'number' });
                inpN.min = '1'; inpN.max = '12'; inpN.value = '2';
                inpN.style.cssText = titleInput.style.cssText;
                label('On');
                const selD = freqArgRow.createEl('select');
                selD.style.cssText = titleInput.style.cssText;
                for (const d of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
                    selD.createEl('option', { text: d }).value = d;
                }
                const update = () => { state.frequencyArg = { weeks: inpN.value, day: selD.value }; updateSubmit(); };
                inpN.onchange = update;
                selD.onchange = update;
                update();
            } else {
                state.frequencyArg = null;
            }
        };
        freqSel.onchange = () => { state.frequency = freqSel.value; rebuildArgRow(); updateSubmit(); };
        rebuildArgRow();

        label('Project (optional)');
        const projSel = host.createEl('select');
        projSel.style.cssText = titleInput.style.cssText;
        const noneOpt = projSel.createEl('option', { text: '(none)' });
        noneOpt.value = '';
        for (const p of this._loadProjectList()) {
            const o = projSel.createEl('option', { text: p.name });
            o.value = `${p.slug}:${p.name}`;
        }
        projSel.onchange = () => {
            if (!projSel.value) state.project = null;
            else {
                const [slug, name] = projSel.value.split(':');
                state.project = { slug, name };
            }
            updateSubmit();
        };

        label('Priority');
        const chipRow = host.createDiv();
        chipRow.style.cssText = 'display:flex; gap:4px; margin-top:4px;';
        for (const p of ['', 'low', 'medium', 'high', 'highest']) {
            const c = chipRow.createEl('div', { text: p || 'none' });
            c.style.cssText = 'flex:1; text-align:center; padding:4px 6px; border:1px solid var(--background-modifier-border,#444); border-radius:4px; font-size:11px; cursor:pointer;';
            c.onclick = () => {
                state.priority = p;
                for (const cc of chipRow.children) cc.style.background = '';
                c.style.background = 'var(--interactive-accent, #6a6abf)';
                updateSubmit();
            };
        }

        const footer = this._appendFooter(host, state, overlay);
        updateSubmit = footer.updateSubmit;     // bind closures to the real evaluator
        host.appendChild(footer.submitBtn.parentNode);
        this._wireEnterSubmit(titleInput, footer.submitBtn);   // Enter in Title submits
        updateSubmit();                         // evaluate initial state — submit enables once title+frequency are valid
    }

    _appendFooter(host, state, overlay) {
        const footer = host.createDiv();
        footer.style.cssText = 'margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border,#333); display:flex; justify-content:flex-end; gap:8px;';
        const cancel = footer.createEl('button', { text: 'Cancel' });
        cancel.style.cssText = 'padding:6px 14px; border-radius:4px; border:1px solid var(--background-modifier-border,#444); background:var(--background-secondary,#2a2a2a); color:var(--text-normal,#ddd);';
        cancel.onclick = () => overlay.remove();

        // v0.127.0 §F: submit label is 'Save' when editing an existing task
        // line in place, 'Create' for the default create-path. state.editExisting
        // is set BEFORE _appendFooter is called from setTab/_renderOneShotForm.
        const submitLabel = state.editExisting ? 'Save' : 'Create';
        const submit = footer.createEl('button', { text: submitLabel });
        submit.classList.add('mod-cta');
        submit.style.cssText = 'padding:6px 14px; border-radius:4px; border:1px solid var(--interactive-accent,#6a6abf); background:var(--interactive-accent,#6a6abf); color:white;';
        submit.disabled = true;
        const updateSubmit = () => {
            const payload = this._payloadFromState(state);
            const v = ToDoCreateTask.validatePayload(payload);
            submit.disabled = !v.valid;
        };
        submit.onclick = async () => {
            const payload = this._payloadFromState(state);
            const v = ToDoCreateTask.validatePayload(payload);
            if (!v.valid) { new Notice('Invalid task: ' + v.reason); return; }
            // v0.127.0 §F: editExisting branch — serialize the payload and call
            // TaskInteractions.replaceTaskAt instead of the create-path. On
            // success, close overlay + focus the source file (reuses the
            // forceLeafPreview pattern from _submit). On failure, notice the
            // reason; never throw — TaskInteractions never throws either.
            if (state.editExisting) {
                try {
                    await this._submitEdit(payload, state.editExisting);
                    overlay.remove();
                } catch (e) {
                    new Notice('Save failed: ' + (e.message || e), 6000);
                }
                return;
            }
            try {
                await this._submit(payload);
                overlay.remove();
            } catch (e) {
                new Notice('Create failed: ' + (e.message || e), 6000);
            }
        };
        return { submitBtn: submit, updateSubmit };
    }

    // Wire Enter-in-Title to the submit button so the task can be created
    // without reaching for the mouse. Mirrors MeetingLeafActions' task modal.
    // Guards: ignore IME composition Enter; no-op when submit is disabled
    // (empty/invalid title) so an empty Enter never creates a blank task.
    _wireEnterSubmit(input, submitBtn) {
        if (!input || !submitBtn) return;
        input.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' || ev.isComposing) return;
            ev.preventDefault();
            if (!submitBtn.disabled) submitBtn.click();
        });
    }

    /**
     * v0.127.0 §F: edit-existing submit path. Serializes the payload, dispatches
     * to customJS.TaskInteractions.replaceTaskAt, and on success opens the
     * source file on a captured leaf (mirrors _submit's auto-open posture).
     * NEVER throws past the wrapping try/catch in the click handler — every
     * recoverable error surfaces as a Notice.
     */
    async _submitEdit(payload, editExisting) {
        const ti = window.customJS && window.customJS.TaskInteractions;
        if (!ti || typeof ti.replaceTaskAt !== 'function') {
            new Notice('task-interactions mechanism not loaded; cannot save edit', 6000);
            return;
        }
        const line = ToDoCreateTask.serializePayloadToLine(payload);
        if (!line) {
            new Notice('Could not serialize task line', 6000);
            return;
        }
        const res = await ti.replaceTaskAt(editExisting.filePath, editExisting.lineIdx, line);
        if (!res || !res.ok) {
            new Notice('Could not update task: ' + ((res && res.reason) || 'unknown'), 6000);
            return;
        }
        new Notice('Task updated');
        // Mirror _submit's auto-open posture: focus the source file so the
        // user sees the updated line. Defensive: skip when app.vault is absent
        // (CLI / test contexts) — the overlay close still happens upstream.
        try {
            const vault = window.app && window.app.vault;
            if (!vault) return;
            const file = vault.getAbstractFileByPath(editExisting.filePath);
            if (!file) return;
            const leaf = window.app.workspace.getLeaf(false);
            await leaf.openFile(file);
            window.customJS.OpenHelpers?.forceLeafPreview?.(leaf);
        } catch (_e) { /* swallow — focus is best-effort */ }
    }

    _payloadFromState(state) {
        const out = { mode: state.mode, title: state.title, priority: state.priority || undefined };
        if (state.mode === 'one-shot') {
            out.destination = state.destination;
            if (state.due) out.due = state.due;
            if (state.scheduled) out.scheduled = state.scheduled;
        } else {
            out.frequency = state.frequency;
            out.frequencyArg = state.frequencyArg;
            const g = ToDoCreateTask.composeRecurrenceGrammar(out);
            if (g) out.recurrenceGrammar = g;
            if (state.project) out.project = state.project;
        }
        return out;
    }

    async _submit(payload) {
        const vault = window.app.vault;
        const dest = ToDoCreateTask.destinationPath(payload);
        if (!dest) throw new Error('cannot resolve destination path');

        // Ensure file exists (or create from template).
        let file = vault.getAbstractFileByPath(dest);
        if (!file) {
            await this._ensureFolder(dest);
            await vault.create(dest, await this._initialBodyFor(payload, dest));
            file = vault.getAbstractFileByPath(dest);
        }
        if (!file) throw new Error(`failed to create ${dest}`);

        const content = await vault.read(file);
        const line = ToDoCreateTask.serializePayloadToLine(payload);
        const updated = this._insertLineUnderSection(content, line, payload);
        await vault.modify(file, updated);
        new Notice(`Created task in ${dest.split('/').pop()}`);
        // Auto-open the destination for context, unless it's the registry (background quietly).
        // Open the TFile on a captured leaf so the deferred read-mode flip
        // targets THIS note even if focus moves first.
        if (payload.mode !== 'recurring') {
            const leaf = window.app.workspace.getLeaf(false);
            await leaf.openFile(file);
            window.customJS.OpenHelpers?.forceLeafPreview?.(leaf);
        }
    }

    _insertLineUnderSection(content, line, payload) {
        // #3 + project Owned Tasks: insert AFTER the stable capture marker so the
        // new task falls inside TodayCaptureEditableList's scan window
        // (findTaskLines scans only below the marker) — TODAY_CAPTURE_MARKER for a
        // daily Today capture, OWNED_TASKS_MARKER for a project-todo Owned Tasks
        // note. Mirrors TaskInteractions.appendTask. Without the project case a
        // dialog-created project task would land ABOVE the marker: outside the
        // editable-list scope AND hidden by _hideRawCaptureLines (invisible in
        // reading mode). The SectionLabel-anchor logic below remains the fallback
        // for notes that predate the marker (unhealed — no renderer either, so the
        // native checkbox still renders).
        const isRecurring = payload.mode === 'recurring';
        const isProject = !!(payload.destination && payload.destination.type === 'project');
        const captureMarker = isRecurring ? null
            : (isProject ? '<!-- OWNED_TASKS_MARKER -->' : '<!-- TODAY_CAPTURE_MARKER -->');
        if (captureMarker) {
            const mi = content.indexOf(captureMarker);
            if (mi !== -1) {
                const insertPos = mi + captureMarker.length;
                const head = content.slice(0, insertPos);
                const tail = content.slice(insertPos).replace(/^\n+/, '');
                return head + `\n${line}\n` + (tail ? '\n' + tail : '');
            }
        }
        // v0.5.2: anchor on the SectionLabel dataviewjs block (not a legacy `## H2`
        // markdown heading). Templates ship SectionLabel("Today") /
        // SectionLabel("Owned Tasks") / SectionLabel("Recurring Tasks") instead of
        // raw H2; the dialog must insert immediately AFTER the closing
        // ``` of the matching SectionLabel block.
        let labelText;
        if (payload.mode === 'recurring') labelText = 'Recurring Tasks';
        else if (payload.destination && payload.destination.type === 'project') labelText = 'Owned Tasks';
        else labelText = 'Today';

        // Match a dataviewjs block carrying SectionLabel + the labelText. We escape
        // the apostrophe in "Today's Capture" too for backward compat during the
        // transition window.
        const labelRe = new RegExp(
            '(```dataviewjs[^`]*class:\\s*"SectionLabel"[^`]*text:\\s*"' +
            labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '"[^`]*```\\n?)'
        );
        const m = labelRe.exec(content);
        if (m) {
            const insertPos = m.index + m[0].length;
            const head = content.slice(0, insertPos).replace(/\n+$/, '\n');
            const tail = content.slice(insertPos).replace(/^\n+/, '');
            // v0.120.0: emit single-newline separator (was `\n\n` which produced an
            // empty blank line BETWEEN consecutive task entries on the daily — user
            // feedback 2026-06-16). Trailing `\n` keeps the task line terminated.
            return head + `\n${line}\n` + tail;
        }
        // Legacy fallback — match an `## H2` heading; preserved for transition
        // window so older notes still get the task inserted in a sensible place.
        let heading;
        if (payload.mode === 'recurring') heading = '## Recurring Tasks';
        else if (payload.destination && payload.destination.type === 'project') heading = '## Owned Tasks';
        else heading = '## Today';
        const idx = content.indexOf(heading);
        if (idx !== -1) {
            const after = content.slice(idx + heading.length);
            const nextRel = after.search(/\n## /);
            const sectionEnd = nextRel === -1 ? content.length : idx + heading.length + nextRel;
            let head = content.slice(0, sectionEnd).replace(/\n+$/, '');
            let tail = content.slice(sectionEnd).replace(/^\n+/, '\n');
            return head + `\n${line}\n` + tail;
        }
        // Last-resort fallback — append at EOF with NO new heading (rely on the
        // SectionLabel block at the top of the file rather than creating an H2).
        return content.replace(/\n+$/, '') + `\n${line}\n`;
    }

    async _ensureFolder(filePath) {
        const folder = filePath.split('/').slice(0, -1).join('/');
        if (!folder) return;
        const adapter = window.app.vault.adapter;
        if (adapter && adapter.exists && !(await adapter.exists(folder))) {
            try { await adapter.mkdir(folder); } catch (e) { /* race-tolerant */ }
        }
    }

    /**
     * #2: build the full daily-to-do body. If `templateContent` looks like the
     * materialized Today To-Do template, substitute the Templater creation_date
     * token (inherits the correct vault tag + live block list). Otherwise emit a
     * hardcoded full scaffold. `isoNow` is the YYYY-MM-DDTHH:mm:ssZ timestamp.
     */
    static _todayBody(templateContent, isoNow) {
        const TOKEN = /<%\s*tp\.file\.creation_date\([^)]*\)\s*%>/g;
        if (typeof templateContent === 'string'
            && templateContent.includes('TODAY_CAPTURE_MARKER')
            && templateContent.includes('TodayCaptureEditableList')) {
            return templateContent.replace(TOKEN, isoNow);
        }
        return [
            '---', 'type: to-do', `created_at: "${isoNow}"`, 'cssclasses:', '  - wide', '---', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', '```', '',
            '---', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoLeafActions" });', '```', '',
            '---', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });', '```', '',
            '<!-- TODAY_CAPTURE_MARKER -->', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyRecurring" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyUnassignedMeetings" });', '```', '',
        ].join('\n');
    }

    async _initialBodyFor(payload, dest) {
        // Per-destination minimal body (fallback when template not picked up by Templater).
        if (payload.mode === 'recurring') {
            return [
                '---',
                'type: to-do-recurring',
                `created_at: "${new Date().toISOString()}"`,
                'cssclasses:',
                '  - wide',
                '---',
                '',
                '## Recurring Tasks',
                '',
            ].join('\n');
        }
        if (payload.destination && payload.destination.type === 'project') {
            return [
                '---',
                'type: project-todo',
                `project: "[[${payload.destination.name}]]"`,
                `project_slug: ${payload.destination.slug}`,
                `created_at: "${new Date().toISOString()}"`,
                'cssclasses:',
                '  - wide',
                '---',
                '',
                '## Owned Tasks',
                '',
                '## From Meetings',
                '',
            ].join('\n');
        }
        // #2: full daily scaffold. Try the materialized template (correct vault
        // tag + live blocks), fall back to the hardcoded scaffold.
        const isoNow = (window && window.moment) ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ') : new Date().toISOString();
        let tpl = null;
        try {
            const tf = window.app && window.app.vault && window.app.vault.getAbstractFileByPath('ranch/templates/Today To-Do.md');
            if (tf) tpl = await window.app.vault.read(tf);
        } catch (_e) { /* fall back to hardcoded */ }
        return ToDoCreateTask._todayBody(tpl, isoNow);
    }

    _loadProjectList() {
        try {
            const dv = window.app.plugins.plugins.dataview && window.app.plugins.plugins.dataview.api;
            if (!dv) return [];
            return dv.pages('"spice/projects"').where(p => p && p.type === 'project').map(p => ({
                slug: p.project_slug || String(p.file.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                name: p.file.name,
            })).array();
        } catch (e) {
            return [];
        }
    }

    /**
     * Return ALL vault markdown notes as { name, path, mtime }. No cap — the
     * filter pipeline below handles pruning. mtime carries the file's last
     * modified timestamp (ms) so the picker can default to recently-modified.
     *
     * v0.8.1 PATCH: previously hard-capped at .slice(0, 200) AFTER an
     * alphabetical sort — vaults with >200 notes silently lost everything past
     * "D"-ish in the alphabet, regardless of what the user typed in the filter.
     * The filter ran over the already-capped subset, so even verbatim matches
     * past the cap returned nothing. Reported on accuris 2026-06-16.
     * Any failure → [].
     */
    _loadNoteList() {
        try {
            const vault = window.app && window.app.vault;
            if (!vault || typeof vault.getMarkdownFiles !== 'function') return [];
            const files = vault.getMarkdownFiles() || [];
            return files.map(f => ({
                name: f.basename,
                path: f.path,
                mtime: (f.stat && f.stat.mtime) || 0,
            }));
        } catch (e) {
            return [];
        }
    }

    /**
     * Append `text` to the running title (state + input), inserting a single
     * separating space when the title is non-empty. Does NOT call updateSubmit —
     * the caller is responsible for re-evaluating the submit button.
     */
    _appendToTitle(state, titleInput, text) {
        state.title = (state.title ? state.title.trimEnd() + ' ' : '') + text;
        titleInput.value = state.title;
    }

    /**
     * Shared inserter UI rendered immediately after the Title input on BOTH the
     * one-shot and recurring forms. Provides:
     *   - "Link a note (optional)": filter box + <select> → appends [[Note Name]]
     *   - "Add link (optional)": label + url + button → appends [label](url)
     *
     * `getUpdateSubmit` returns the REAL (rebound) updateSubmit at call time. The
     * forms forward-declare `updateSubmit` as a `let` and rebind it after the
     * footer is built, so we must re-read it through the getter rather than
     * capturing its initial no-op value.
     */
    _renderInserters(host, state, titleInput, getUpdateSubmit) {
        const label = (text) => {
            const el = host.createEl('div', { text });
            el.style.cssText = 'font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted, #999); margin-top:10px; margin-bottom:4px;';
            return el;
        };
        const fieldCss = 'width:100%; padding:6px 8px; background:var(--background-secondary,#2a2a2a); border:1px solid var(--background-modifier-border,#444); border-radius:4px; color:var(--text-normal,#ddd);';

        // --- Link a note (optional): filter + select → [[Note Name]] ---
        label('Link a note (optional)');
        const notes = this._loadNoteList();
        const noteFilter = host.createEl('input', { type: 'text' });
        noteFilter.placeholder = notes.length
            ? `Filter ${notes.length} note${notes.length === 1 ? '' : 's'}…`
            : 'Filter notes…';
        noteFilter.style.cssText = fieldCss;
        const noteSelect = host.createEl('select');
        noteSelect.style.cssText = fieldCss + ' margin-top:4px;';

        // v0.8.1: the filter pipeline now runs over the FULL note list (was
        // capped to 200 alphabetically pre-filter). When no filter is set,
        // show the 50 most-recently-modified notes (recency-first default).
        // When a filter is set, substring-match the full list (case-insensitive
        // on the basename) and cap the rendered options at 50; surface a hint
        // option when matches exceed the cap so the user knows to refine.
        const CAP = 50;
        const repopulate = (filter) => {
            noteSelect.innerHTML = '';
            const none = noteSelect.createEl('option', { text: '(none)' });
            none.value = '';
            const f = (filter || '').trim().toLowerCase();
            let matches;
            if (!f) {
                // Recency-first default — top 50 by mtime DESC.
                matches = notes.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
            } else {
                matches = notes.filter(n => String(n.name).toLowerCase().includes(f));
                // Prefer "starts-with" matches over "contains" for relevance.
                matches.sort((a, b) => {
                    const aStarts = String(a.name).toLowerCase().startsWith(f) ? 0 : 1;
                    const bStarts = String(b.name).toLowerCase().startsWith(f) ? 0 : 1;
                    if (aStarts !== bStarts) return aStarts - bStarts;
                    return String(a.name).localeCompare(String(b.name));
                });
            }
            const total = matches.length;
            const shown = matches.slice(0, CAP);
            for (const n of shown) {
                const o = noteSelect.createEl('option', { text: n.name });
                o.value = n.name;
            }
            if (total > CAP) {
                const more = noteSelect.createEl('option', {
                    text: `… ${total - CAP} more — refine the filter to narrow`
                });
                more.value = '';
                more.disabled = true;
            } else if (f && total === 0) {
                const hint = noteSelect.createEl('option', { text: '(no matches)' });
                hint.value = '';
                hint.disabled = true;
            }
        };
        repopulate('');
        noteFilter.oninput = () => repopulate(noteFilter.value);
        noteSelect.onchange = () => {
            const value = noteSelect.value;
            if (value) {
                this._appendToTitle(state, titleInput, '[[' + value + ']]');
                noteSelect.value = '';
                getUpdateSubmit()();
            }
        };

        // --- Add link (optional): label + url + button → [label](url) ---
        label('Add link (optional)');
        const labelInput = host.createEl('input', { type: 'text' });
        labelInput.placeholder = 'Label';
        labelInput.style.cssText = fieldCss;
        const urlInput = host.createEl('input', { type: 'text' });
        urlInput.placeholder = 'https://…';
        urlInput.style.cssText = fieldCss + ' margin-top:4px;';
        const insertBtn = host.createEl('button', { text: 'Insert link' });
        insertBtn.style.cssText = 'margin-top:6px; padding:5px 12px; border-radius:4px; border:1px solid var(--background-modifier-border,#444); background:var(--background-secondary,#2a2a2a); color:var(--text-normal,#ddd); cursor:pointer;';
        insertBtn.onclick = () => {
            const md = ToDoCreateTask.composeMarkdownLink(labelInput.value, urlInput.value);
            if (md) {
                this._appendToTitle(state, titleInput, md);
                labelInput.value = '';
                urlInput.value = '';
                getUpdateSubmit()();
            }
        };
    }
}
