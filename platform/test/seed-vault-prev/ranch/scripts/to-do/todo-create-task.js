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
            // If RecurrenceParser is available, double-check.
            if (window.customJS && window.customJS.RecurrenceParser) {
                if (!window.customJS.RecurrenceParser.isSupported(g)) {
                    return { valid: false, reason: 'unsupported recurrence grammar' };
                }
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
        };

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
        updateSubmit();                         // evaluate initial state — submit enables once title+frequency are valid
    }

    _appendFooter(host, state, overlay) {
        const footer = host.createDiv();
        footer.style.cssText = 'margin-top:16px; padding-top:12px; border-top:1px solid var(--background-modifier-border,#333); display:flex; justify-content:flex-end; gap:8px;';
        const cancel = footer.createEl('button', { text: 'Cancel' });
        cancel.style.cssText = 'padding:6px 14px; border-radius:4px; border:1px solid var(--background-modifier-border,#444); background:var(--background-secondary,#2a2a2a); color:var(--text-normal,#ddd);';
        cancel.onclick = () => overlay.remove();

        const submit = footer.createEl('button', { text: 'Create' });
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
            try {
                await this._submit(payload);
                overlay.remove();
            } catch (e) {
                new Notice('Create failed: ' + (e.message || e), 6000);
            }
        };
        return { submitBtn: submit, updateSubmit };
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
        if (payload.mode !== 'recurring') {
            window.app.workspace.openLinkText(dest, '', false);
        }
    }

    _insertLineUnderSection(content, line, payload) {
        let heading;
        if (payload.mode === 'recurring') heading = '## Recurring Tasks';
        else if (payload.destination && payload.destination.type === 'project') heading = '## Owned Tasks';
        else heading = "## Today's Capture";

        const idx = content.indexOf(heading);
        if (idx === -1) {
            // No section — append at EOF.
            return content.replace(/\n+$/, '') + `\n\n${heading}\n\n${line}\n`;
        }
        // Find end of the section (next `## ` heading or EOF).
        const after = content.slice(idx + heading.length);
        const nextRel = after.search(/\n## /);
        const sectionEnd = nextRel === -1 ? content.length : idx + heading.length + nextRel;
        let head = content.slice(0, sectionEnd);
        let tail = content.slice(sectionEnd);
        head = head.replace(/\n+$/, '');
        return head + `\n${line}\n` + tail.replace(/^\n+/, '\n');
    }

    async _ensureFolder(filePath) {
        const folder = filePath.split('/').slice(0, -1).join('/');
        if (!folder) return;
        const adapter = window.app.vault.adapter;
        if (adapter && adapter.exists && !(await adapter.exists(folder))) {
            try { await adapter.mkdir(folder); } catch (e) { /* race-tolerant */ }
        }
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
        return [
            '---',
            'type: to-do',
            `created_at: "${new Date().toISOString()}"`,
            'cssclasses:',
            '  - wide',
            '---',
            '',
            "## Today's Capture",
            '',
        ].join('\n');
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
}
