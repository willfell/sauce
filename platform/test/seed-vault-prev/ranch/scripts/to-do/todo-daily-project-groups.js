/**
 * ToDoDailyProjectGroups (CustomJS) — live-render aggregator for the per-project
 * "Open Project Tasks" section in today's daily note OR the "From Meetings"
 * section in a per-project To-Do note.
 *
 * Scope variant via opts.scope:
 *   "daily"        (default) — walk all `type: project` notes; per project group,
 *                  render Owned Tasks from the project To-Do note + meeting tasks
 *                  linked to that project.
 *   "project-todo" — render only the meeting tasks linked to THIS project (read
 *                  cur.project_slug); used inside Project To-Do note template.
 *
 * v0.5.0 (workshop v0.117.0) — section headers use SectionLabel primitive
 * (project blueprint v1.21.0+) instead of raw H2; rows render as styled flex
 * blocks with primary task text + muted source attribution chip.
 *
 * Each rendered row is a click-through link that opens the source file via
 * app.workspace.openLinkText (no in-place checkbox toggle in v0.5.x — see
 * carry-forward in design doc).
 *
 * Empty section → renders nothing.
 */
class ToDoDailyProjectGroups {

    async render(dv, opts) {
        const scope = (opts && opts.scope) || 'daily';
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;

        if (scope === 'project-todo') {
            return this._renderProjectTodoScope(dv);
        }
        return this._renderDailyScope(dv);
    }

    async _renderDailyScope(dv) {
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'to-do') return;

        const projects = dv.pages('"spice/projects"').where(p => p && p.type === 'project').array();
        if (!projects.length) return;

        const blocks = [];
        for (const proj of projects) {
            const projName = proj.file && proj.file.name;
            const projSlug = proj.project_slug || this._slugify(projName);
            const projPath = proj.file && proj.file.path;
            const tasks = this._collectProjectTasks(dv, projName, projSlug);
            if (!tasks.length) continue;
            blocks.push({ projSlug, projName, projPath, tasks });
        }
        if (!blocks.length) return;

        this._renderLabel(dv, 'Open Project Tasks');
        for (const blk of blocks) {
            const anchor = document.createComment(` project-group-anchor-${blk.projSlug} `);
            dv.container.appendChild(anchor);
            this._renderLabel(dv, blk.projName, { link: blk.projPath });
            for (const t of blk.tasks) this._renderTaskRow(dv.container, t);
        }
    }

    async _renderProjectTodoScope(dv) {
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'project-todo') return;
        const projName = ToDoDailyProjectGroups._normalizeProjectName(cur.project);
        if (!projName) return;

        const meetingTasks = this._collectMeetingTasksForProject(dv, projName);
        if (!meetingTasks.length) return;

        // Note: no SectionLabel here; the "From Meetings" label is in the template
        // directly above this block. Helper just renders the rows.
        for (const t of meetingTasks) this._renderTaskRow(dv.container, t);
    }

    // ---------- Render helpers ----------

    _renderLabel(dv, text, opts) {
        opts = opts || {};
        // Prefer SectionLabel primitive (small uppercase + hairline above).
        if (window.customJS && window.customJS.SectionLabel) {
            // Project name labels are NOT top (visual separator between projects).
            window.customJS.SectionLabel.render(dv, { text });
        } else {
            // Fallback: muted h3.
            const h = dv.container.createEl('div');
            h.textContent = String(text || '').toUpperCase();
            h.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:10px 0 6px; font-weight:600;';
        }
        // Convert the label into a clickable link if a project hub path was provided.
        if (opts.link) {
            const labelEl = dv.container.lastElementChild;
            if (labelEl && labelEl.tagName !== 'A') {
                labelEl.style.cursor = 'pointer';
                labelEl.onclick = (ev) => {
                    ev.preventDefault();
                    if (window.app && window.app.workspace) window.app.workspace.openLinkText(opts.link, '', false);
                };
            }
        }
    }

    _renderTaskRow(container, t) {
        const row = container.createEl('div');
        row.style.cssText = 'display:flex; align-items:baseline; gap:8px; padding:4px 0; cursor:pointer; line-height:1.45;';
        row.onclick = () => {
            if (window.app && window.app.workspace) window.app.workspace.openLinkText(t.source, '', false);
        };

        const box = row.createEl('span');
        box.textContent = '☐';
        box.style.cssText = 'flex-shrink:0; opacity:0.6; font-size:0.95em;';

        const txt = row.createEl('span');
        txt.textContent = this._cleanTaskText(t.text);
        txt.style.cssText = 'flex:1; color:var(--text-normal); overflow-wrap:anywhere;';

        const src = row.createEl('span');
        const fname = t.source.split('/').pop().replace(/\.md$/, '');
        src.textContent = `‹${fname}›`;
        src.style.cssText = 'font-size:0.85em; opacity:0.6; font-style:italic; flex-shrink:0; max-width:50%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    }

    // ---------- Collection helpers ----------

    _collectProjectTasks(dv, projName, projSlug) {
        const tasks = [];
        const todoPath = `spice/projects/${projSlug}/${projName} To-Do.md`;
        try {
            const todoPage = dv.page(todoPath);
            if (todoPage && todoPage.file && todoPage.file.tasks) {
                for (const t of todoPage.file.tasks) {
                    if (!t.completed) tasks.push({ text: t.text, source: todoPath });
                }
            }
        } catch (e) { /* ignore */ }
        for (const mt of this._collectMeetingTasksForProject(dv, projName)) tasks.push(mt);
        return tasks;
    }

    _collectMeetingTasksForProject(dv, projName) {
        // v0.5.3: iterate all meetings without a where-clause and do the project
        // match per-meeting inside try/catch. The prior where-clause used
        // `String(m.project)` which broke on certain Dataview Link object
        // representations (Link.toString() returns "Sauce" in some versions and
        // "[[Sauce]]" in others; the strip-brackets regex handled both, but a
        // throwing toString on a different field broke the whole array).
        // Also normalizes projName comparison to handle the Link-vs-string drift.
        const out = [];
        const targetName = ToDoDailyProjectGroups._normalizeProjectName(projName);
        if (!targetName) return out;
        let allMeetings;
        try { allMeetings = dv.pages('"spice/meetings/notes"').array(); }
        catch (e) { return out; }
        for (const meet of allMeetings) {
            try {
                if (!meet || meet.project == null) continue;
                const meetProj = ToDoDailyProjectGroups._normalizeProjectName(meet.project);
                if (!meetProj || meetProj !== targetName) continue;
                if (meet.file && meet.file.tasks) {
                    for (const t of meet.file.tasks) {
                        if (!t.completed) out.push({ text: t.text, source: meet.file.path });
                    }
                }
            } catch (_e) { /* skip this meeting; don't blank the rest */ }
        }
        return out;
    }

    /**
     * Normalize a project reference into a bare project name string.
     * Handles: plain strings, "[[Name]]" wikilink strings, Dataview Link
     * objects (.path / .display), arrays (takes first element), nulls.
     * Returns "" when nothing usable can be extracted.
     */
    static _normalizeProjectName(value) {
        if (value == null) return '';
        // Dataview Link object — has .path, possibly .display.
        if (typeof value === 'object' && !Array.isArray(value)) {
            if (typeof value.path === 'string') {
                // Strip "spice/projects/<slug>/<Name>.md" → "<Name>"
                const last = value.path.split('/').pop() || '';
                return last.replace(/\.md$/, '').replace(/^\[\[|\]\]$/g, '').trim();
            }
            if (typeof value.display === 'string') return value.display.trim();
            // Fallback toString.
            try { return String(value).replace(/^\[\[|\]\]$/g, '').trim(); }
            catch (_e) { return ''; }
        }
        if (Array.isArray(value)) {
            if (!value.length) return '';
            return ToDoDailyProjectGroups._normalizeProjectName(value[0]);
        }
        // String/number/etc.
        const s = String(value).trim();
        // Strip surrounding wikilink brackets if present (`[[Name]]` or `[[path|display]]`).
        const wl = /^\[\[([^\]]+)\]\]$/.exec(s);
        if (wl) {
            const inner = wl[1];
            const pipe = inner.indexOf('|');
            if (pipe !== -1) return inner.slice(pipe + 1).trim();
            return inner.split('/').pop().replace(/\.md$/, '').trim();
        }
        return s.replace(/\.md$/, '').trim();
    }

    _cleanTaskText(text) {
        // Strip inline [field:: value] for display (project / from / recurring_from / etc.).
        return String(text || '').replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, '').trim();
    }

    _slugify(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
}
