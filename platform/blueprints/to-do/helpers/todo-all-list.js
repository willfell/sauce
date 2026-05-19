/**
 * ToDoAllList (CustomJS) — renders all uncompleted tasks from prior days under
 * spice/to-do/**\/ToDo-*.md (excluding today). Tasks are grouped by source
 * date desc, each group rendered as `## YYYY-MM-DD` heading + linked task
 * lines with `(from [[ToDo-YYYY-MM-DD]])` source pointers.
 *
 * Embeds-safe (returns early in markdown-embed contexts). Dual-fire-safe via
 * the __toDoAllRenderGen counter pattern other helpers use.
 */
class ToDoAllList {
    async render(dv) {
        if (dv.container.closest('.markdown-embed')) return;

        const myGen = (dv.container.__toDoAllRenderGen || 0) + 1;
        dv.container.__toDoAllRenderGen = myGen;
        const isStale = () => dv.container.__toDoAllRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const today = window.moment().format('YYYY-MM-DD');
        const pages = dv.pages('"spice/to-do"').where(p =>
            /^ToDo-\d{4}-\d{2}-\d{2}$/.test(p.file.name) && p.file.name !== `ToDo-${today}`
        );

        // Build a map: dateStr -> Array<task>. Tasks are Dataview SListItem
        // objects with .text and .completed; we filter to incomplete top-level
        // checkboxes only.
        const byDate = new Map();
        for (const p of pages) {
            const dateStr = p.file.name.replace(/^ToDo-/, '');
            const incomplete = p.file.tasks.where(t => !t.completed);
            for (const t of incomplete) {
                if (!byDate.has(dateStr)) byDate.set(dateStr, []);
                byDate.get(dateStr).push(t);
            }
        }
        if (isStale()) return;

        if (byDate.size === 0) {
            dv.paragraph('No backlog — all prior to-dos completed. ✅');
            return;
        }

        const sortedDates = [...byDate.keys()].sort().reverse(); // newest first
        for (const dateStr of sortedDates) {
            if (isStale()) return;
            const heading = dv.container.createEl('h2');
            heading.textContent = dateStr;
            const ul = dv.container.createEl('ul');
            for (const t of byDate.get(dateStr)) {
                const li = ul.createEl('li');
                const text = (t.text || '').trim();
                li.createSpan({ text: '☐ ' });
                li.createSpan({ text });
                li.createSpan({ text: '   (from ' });
                const link = li.createEl('a');
                link.textContent = `ToDo-${dateStr}`;
                link.classList.add('internal-link');
                link.setAttribute('data-href', `ToDo-${dateStr}`);
                link.setAttribute('href', `ToDo-${dateStr}`);
                link.onclick = (e) => {
                    e.preventDefault();
                    app.workspace.openLinkText(`ToDo-${dateStr}`, '');
                };
                li.createSpan({ text: ')' });
            }
        }
    }
}
