/**
 * ToDoDailyUnassignedMeetings (CustomJS) — live-render aggregator for the
 * "Meeting Tasks (unassigned)" section in today's daily note. Surfaces open
 * `- [ ]` lines from meeting notes that have NO `project:` frontmatter.
 *
 * Empty section → renders nothing (empty-state policy).
 */
class ToDoDailyUnassignedMeetings {

    async render(dv) {
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'to-do') return;

        let meetings;
        try {
            meetings = dv.pages('"spice/meetings/notes"').where(m => {
                if (!m) return false;
                if (m.project == null) return true;
                const v = String(m.project).trim();
                return v.length === 0;
            }).array();
        } catch (e) { return; }

        const tasks = [];
        for (const meet of meetings) {
            if (meet.file && meet.file.tasks) {
                for (const t of meet.file.tasks) {
                    if (!t.completed) tasks.push({ text: t.text, source: meet.file.path });
                }
            }
        }
        if (!tasks.length) return;

        const h2 = dv.container.createEl('h2');
        h2.textContent = 'Meeting Tasks (unassigned)';
        const ul = dv.container.createEl('ul');
        ul.style.cssText = 'margin: 0; padding-left: 20px; list-style-type: none;';
        for (const t of tasks) {
            const li = ul.createEl('li');
            li.style.cssText = 'padding: 2px 0; cursor: pointer;';
            const text = this._cleanTaskText(t.text);
            const fname = t.source.split('/').pop().replace(/\.md$/, '');
            li.innerHTML = `☐ ${this._escapeHtml(text)} <small style="opacity:0.6">(${this._escapeHtml(fname)})</small>`;
            li.onclick = () => window.app.workspace.openLinkText(t.source, '', false);
        }
    }

    _cleanTaskText(text) {
        return String(text || '').replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, '').trim();
    }

    _escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
}
