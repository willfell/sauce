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
            // The archives are excluded in the SOURCE so Dataview never builds a page
            // object for a finished or trashed task; the status check below decides the rest.
            const raw = dv.pages('"spice/tasks" and -"spice/tasks/_done" and -"spice/tasks/_trash" and -"spice/tasks/_sets"').where(p =>
                p && p.type === 'task'
                && p.file && p.file.path
                && (typeof TE.isOpenTask === 'function' ? TE.isOpenTask(p) : p.status === 'open'));
            // Parse each task once (the old feature test mapped the whole list twice).
            const mapped = raw.map(p => TE.parseNote(p));
            parsed = typeof mapped.array === 'function' ? mapped.array() : Array.from(mapped);
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
        // Desktop drag and drop (TaskMove loaded): a row's handle drags it
        // onto another task (nest) or onto a trip label, which sets its trip
        // with the edit dialog's writer. The phone uses the row's ⋯ menu.
        const TM = window.customJS && window.customJS.TaskMove;
        const mobile = typeof TTL._isMobile === 'function' && TTL._isMobile(window.app);
        const canDrag = !mobile && !!TM && typeof TM.nest === 'function' && typeof TM.setTrip === 'function'
            && typeof TTL.wireRowDrag === 'function' && typeof TTL.wireGroupDrop === 'function';

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
            if (canDrag) {
                const trip = { name: label, slug };
                TTL.wireGroupDrop(dv.container.lastElementChild, {
                    label: 'Move to ' + label,
                    refuse: (p) => (tripTasks.some((t) => t && t.path === p) ? 'Already in ' + label : ''),
                    apply: (p) => TM.setTrip(p, trip),
                });
            }

            for (const t of tripTasks) {
                try {
                    const row = TTL.renderTaskRow(dv.container, t, TD, canDrag ? { dragHandle: 'Drag onto a task or trip' } : undefined);
                    if (canDrag) TTL.wireRowDrag(row, t, {});
                } catch (_e) {}
            }
        }
    }
}
