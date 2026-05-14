/**
 * CoworkWeeklyHubCards (CustomJS)
 * Renders cards for weekly notes at spice/cowork/weekly/YYYY/YYYY-Www.md,
 * grouped by year, recent-first.
 */
class CoworkWeeklyHubCards {
    _stripNotesSnippet(body) {
        if (!body || typeof body !== "string") return "";
        const m = body.match(/^##\s+Notes\s*$([\s\S]*?)(?=^##\s+|\z)/m);
        if (!m) return "";
        return m[1].replace(/[#>\-*\[\]]/g, " ").trim().slice(0, 120);
    }

    _friendlyWeekName(fname) {
        const m = fname.match(/^(\d{4})-W(\d{2})$/);
        if (!m) return fname;
        return `Week ${m[2]}, ${m[1]}`;
    }

    _dateRangeLabel(weekLabel, weekStart, weekEnd) {
        if (weekStart && weekEnd) {
            const s = window.moment(weekStart, "YYYY-MM-DD");
            const e = window.moment(weekEnd, "YYYY-MM-DD");
            if (s.isValid() && e.isValid()) {
                return s.format("MMM D") + " – " + e.format("MMM D");
            }
        }
        return weekLabel || "";
    }

    async render(dv, opts) {
        if (dv.container.closest(".markdown-embed")) return;
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const weeklies = dv.pages('"spice/cowork/weekly"').where(p =>
            /^\d{4}-W\d{2}$/.test(p.file.name)
        );

        const groups = new Map();
        for (const p of weeklies) {
            const year = p.file.name.slice(0, 4);
            if (!groups.has(year)) groups.set(year, []);
            groups.get(year).push(p);
        }

        const sortedYears = [...groups.keys()].sort().reverse();
        for (const year of sortedYears) {
            const items = groups.get(year).sort((a, b) => b.file.name.localeCompare(a.file.name));
            dv.header(3, year);

            const cardItems = items.map(p => ({
                file: { name: p.week_label || this._friendlyWeekName(p.file.name), path: p.file.path, mtime: p.file.mtime },
                _subtitle: this._dateRangeLabel(p.week_label, p.week_start, p.week_end),
                _snippet: this._stripNotesSnippet(p.file && p.file.contents)
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
