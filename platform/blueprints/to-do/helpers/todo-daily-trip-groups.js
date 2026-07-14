/**
 * ToDoDailyTripGroups (CustomJS) — live-render aggregator for trip-linked
 * tasks in today's daily note. Surfaces open task-notes that carry a
 * trip_slug, grouped by trip name.
 *
 * Empty section → renders nothing.
 *
 * BARE CLASS ONLY — no trailing statements.
 */
class ToDoDailyTripGroups {

    async render(dv) {
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'to-do') return;

        const TE = window.customJS && window.customJS.TaskEntity;
        const TTL = window.customJS && window.customJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' || !TTL || typeof TTL.renderTaskRow !== 'function') return;

        let parsed;
        try {
            const raw = dv.pages('"spice/tasks"').where(p =>
                p && p.type === 'task' && p.status === 'open'
                && p.file && p.file.path
                && !p.file.path.includes('/_trash/')
                && !p.file.path.includes('/_done/'));
            parsed = raw.map(p => TE.parseNote(p)).array
                ? raw.map(p => TE.parseNote(p)).array()
                : Array.from(raw).map(p => TE.parseNote(p));
        } catch (_e) { return; }

        const tasks = parsed.filter(t =>
            t && String(t.trip_slug == null ? '' : t.trip_slug).trim() !== ''
            && String(t.project_slug == null ? '' : t.project_slug).trim() === '');
        if (!tasks.length) return;

        const byTrip = new Map();
        for (const t of tasks) {
            const slug = String(t.trip_slug).trim();
            if (!byTrip.has(slug)) byTrip.set(slug, []);
            byTrip.get(slug).push(t);
        }

        const TD = window.customJS && window.customJS.TaskDialog;
        const SL = window.customJS && window.customJS.SectionLabel;

        for (const [slug, tripTasks] of byTrip) {
            const label = tripTasks[0] && tripTasks[0].trip
                ? String(tripTasks[0].trip).replace(/^\[\[/, '').replace(/\]\]$/, '').split('/').pop()
                : slug;

            if (SL) {
                SL.render(dv, { text: label + ' Tasks' });
            } else {
                const h = dv.container.createEl('div');
                h.textContent = String(label + ' TASKS').toUpperCase();
                h.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:10px 0 6px; font-weight:600;';
            }

            for (const t of tripTasks) {
                try { TTL.renderTaskRow(dv.container, t, TD); } catch (_e) {}
            }
        }
    }
}
