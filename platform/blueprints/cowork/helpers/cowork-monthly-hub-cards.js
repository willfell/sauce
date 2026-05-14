/**
 * CoworkMonthlyHubCards (CustomJS)
 * Renders cards for monthly notes at spice/cowork/monthly/YYYY/YYYY-MM.md,
 * grouped by year, recent-first.
 */
class CoworkMonthlyHubCards {
    _stripNotesSnippet(body) {
        if (!body || typeof body !== "string") return "";
        const m = body.match(/^##\s+Notes\s*$([\s\S]*?)(?=^##\s+|\z)/m);
        if (!m) return "";
        return m[1].replace(/[#>\-*\[\]]/g, " ").trim().slice(0, 120);
    }

    _monthLabel(monthName) {
        const m = window.moment(monthName, "YYYY-MM");
        return m.isValid() ? m.format("MMMM YYYY") : monthName;
    }

    async render(dv, opts) {
        if (dv.container.closest(".markdown-embed")) return;
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const monthlies = dv.pages('"spice/cowork/monthly"').where(p =>
            /^\d{4}-\d{2}$/.test(p.file.name)
        );

        const groups = new Map();
        for (const p of monthlies) {
            const year = p.file.name.slice(0, 4);
            if (!groups.has(year)) groups.set(year, []);
            groups.get(year).push(p);
        }

        const sortedYears = [...groups.keys()].sort().reverse();
        for (const year of sortedYears) {
            const items = groups.get(year).sort((a, b) => b.file.name.localeCompare(a.file.name));
            dv.header(3, year);

            const cardItems = items.map(p => ({
                file: { name: this._monthLabel(p.file.name), path: p.file.path, mtime: p.file.mtime },
                _subtitle: p.file.name,
                _snippet: this._stripNotesSnippet(p.file && p.file.contents)
            }));

            if (typeof window.customJS !== "undefined" && window.customJS.BeaconCards) {
                await window.customJS.BeaconCards.render(dv, {
                    items: cardItems,
                    titleField: p => p.file.name,
                    subtitleField: p => p._subtitle,
                    bodyField: p => p._snippet,
                    linkField: p => p.file.path,
                });
            } else {
                for (const item of cardItems) {
                    dv.paragraph(`- [[${item.file.path}|${item.file.name}]] — ${item._subtitle}`);
                }
            }
        }

        if (sortedYears.length === 0) {
            dv.paragraph("> [!info]+ No monthly notes yet · Click **This Month** in the nav row to create one.");
        }
    }
}
