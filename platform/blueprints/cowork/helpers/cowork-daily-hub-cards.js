/**
 * CoworkDailyHubCards (CustomJS)
 * Renders cards for daily notes at spice/daily/**\/*.md, grouped by year/month, recent-first.
 * Click a card → opens that daily note.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkDailyHubCards" });
 */
class CoworkDailyHubCards {
    _stripNotesSnippet(body) {
        if (!body || typeof body !== "string") return "";
        const m = body.match(/^##\s+Notes\s*$([\s\S]*?)(?=^##\s+|\z)/m);
        if (!m) return "";
        return m[1].replace(/[#>\-*\[\]]/g, " ").trim().slice(0, 120);
    }

    _relativeLabel(day) {
        const m = window.moment(day, "YYYY-MM-DD", true);
        if (!m.isValid()) return "";
        const today = window.moment().startOf("day");
        const diff = today.diff(m, "days");
        if (diff === 0) return "Today";
        if (diff === 1) return "Yesterday";
        if (diff > 1 && diff < 14) return m.format("ddd") + " · " + diff + " days ago";
        return m.format("ddd · MMM D");
    }

    async render(dv, opts) {
        if (dv.container.closest(".markdown-embed")) return;
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const dailies = dv.pages('"spice/daily"').where(p =>
            /^\w+-\d{4}-\d{2}-\d{2}$/.test(p.file.name)
        );

        const groups = new Map();
        for (const p of dailies) {
            const m = p.file.name.match(/^(\w+)-(\d{4}-\d{2}-\d{2})$/);
            if (!m) continue;
            const day = m[2];
            const yyyymm = day.slice(0, 7);
            if (!groups.has(yyyymm)) groups.set(yyyymm, []);
            groups.get(yyyymm).push({ page: p, day, weekday: m[1] });
        }

        const sortedKeys = [...groups.keys()].sort().reverse();
        for (const yyyymm of sortedKeys) {
            const items = groups.get(yyyymm).sort((a, b) => b.day.localeCompare(a.day));
            const monthLabel = window.moment(yyyymm, "YYYY-MM").format("MMMM YYYY");
            dv.header(3, monthLabel);

            const cardItems = items.map(({ page, day, weekday }) => ({
                file: { name: weekday + " · " + day, path: page.file.path, mtime: page.file.mtime },
                _subtitle: this._relativeLabel(day),
                _snippet: this._stripNotesSnippet(page.file && page.file.contents)
            }));

            if (typeof window.customJS !== "undefined" && window.customJS.BeaconCards) {
                await window.customJS.BeaconCards.render(dv, {
                    pages: cardItems,
                    title: p => p.file.name,
                    subtitle: p => p._subtitle,
                    target: p => p.file.path,
                });
            } else {
                for (const item of cardItems) {
                    dv.paragraph(`- [[${item.file.path}|${item.file.name}]] — ${item._subtitle}`);
                }
            }
        }
    }
}
