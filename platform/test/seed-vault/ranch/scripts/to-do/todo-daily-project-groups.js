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
 * Each rendered row is a click-through link that opens the source file via
 * app.workspace.openLinkText (no in-place checkbox toggle in v0.4.0 — see
 * carry-forward in design doc).
 *
 * Empty section → renders nothing (no info callout — empty-state policy).
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

        const h2 = dv.container.createEl('h2');
        h2.textContent = 'Open Project Tasks';
        for (const blk of blocks) {
            const anchor = document.createComment(` project-group-anchor-${blk.projSlug} `);
            dv.container.appendChild(anchor);
            const h3 = dv.container.createEl('h3');
            const a = h3.createEl('a');
            a.textContent = blk.projName;
            a.classList.add('internal-link');
            a.setAttribute('data-href', blk.projPath);
            a.onclick = (ev) => { ev.preventDefault(); window.app.workspace.openLinkText(blk.projPath, '', false); };
            const ul = dv.container.createEl('ul');
            ul.style.cssText = 'margin: 0; padding-left: 20px; list-style-type: none;';
            for (const t of blk.tasks) {
                const li = ul.createEl('li');
                li.style.cssText = 'padding: 2px 0; cursor: pointer;';
                const text = this._cleanTaskText(t.text);
                const fname = t.source.split('/').pop().replace(/\.md$/, '');
                li.innerHTML = `☐ ${this._escapeHtml(text)} <small style="opacity:0.6">(${this._escapeHtml(fname)})</small>`;
                li.onclick = () => window.app.workspace.openLinkText(t.source, '', false);
            }
        }
    }

    async _renderProjectTodoScope(dv) {
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'project-todo') return;
        const projName = cur.project ? String(cur.project).replace(/^\[\[|\]\]$/g, '') : null;
        if (!projName) return;

        const meetingTasks = this._collectMeetingTasksForProject(dv, projName);
        if (!meetingTasks.length) return;

        const ul = dv.container.createEl('ul');
        ul.style.cssText = 'margin: 0; padding-left: 20px; list-style-type: none;';
        for (const t of meetingTasks) {
            const li = ul.createEl('li');
            li.style.cssText = 'padding: 2px 0; cursor: pointer;';
            const text = this._cleanTaskText(t.text);
            const fname = t.source.split('/').pop().replace(/\.md$/, '');
            li.innerHTML = `☐ ${this._escapeHtml(text)} <small style="opacity:0.6">(${this._escapeHtml(fname)})</small>`;
            li.onclick = () => window.app.workspace.openLinkText(t.source, '', false);
        }
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
        const out = [];
        let meetings;
        try {
            meetings = dv.pages('"spice/meetings/notes"').where(m => {
                if (!m || !m.project) return false;
                const v = String(m.project).replace(/^\[\[|\]\]$/g, '');
                return v === projName;
            }).array();
        } catch (e) { return out; }
        for (const meet of meetings) {
            if (meet.file && meet.file.tasks) {
                for (const t of meet.file.tasks) {
                    if (!t.completed) out.push({ text: t.text, source: meet.file.path });
                }
            }
        }
        return out;
    }

    _cleanTaskText(text) {
        // Strip inline [field:: value] for display.
        return String(text || '').replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, '').trim();
    }

    _escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    _slugify(name) {
        return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
}
