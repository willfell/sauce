/**
 * ToDoDailyUnassignedMeetings (CustomJS) — live-render aggregator for the
 * "Meeting Tasks (unassigned)" section in today's daily note. Surfaces open
 * `- [ ]` lines from meeting notes that have NO `project:` frontmatter (or
 * an empty one).
 *
 * v0.5.0 (workshop v0.117.0) — uses SectionLabel primitive + polished task rows.
 *
 * Empty section → renders nothing.
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

        if (window.customJS && window.customJS.SectionLabel) {
            window.customJS.SectionLabel.render(dv, { text: 'Meeting Tasks (unassigned)' });
        } else {
            const h = dv.container.createEl('div');
            h.textContent = 'MEETING TASKS (UNASSIGNED)';
            h.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:10px 0 6px; font-weight:600;';
        }

        for (const t of tasks) this._renderTaskRow(dv.container, t);
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

    _cleanTaskText(text) {
        return String(text || '').replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, '').trim();
    }
}
