/**
 * ScratchHubCards (CustomJS)
 * Renders one card per day with at least one scratch, latest first.
 * Click a card → opens that day's day-index page.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchHubCards" });
 */
class ScratchHubCards {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        if (raw instanceof Date && !isNaN(raw)) {
            const y = raw.getFullYear();
            const m = String(raw.getMonth() + 1).padStart(2, "0");
            const d = String(raw.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }
        return null;
    }

    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const scratches = dv.pages('"spice/scratch"').where(p => p.type === "scratch");
        const byDay = new Map();
        for (const s of scratches) {
            const k = this._coerceDay(s.day);
            if (!k) continue;
            if (!byDay.has(k)) byDay.set(k, { day: k, count: 0, latestMtime: 0, sample: null });
            const e = byDay.get(k);
            e.count++;
            const mtime = (s.file.mtime && s.file.mtime.ts) || 0;
            if (mtime > e.latestMtime) { e.latestMtime = mtime; e.sample = s; }
        }

        const items = [...byDay.values()].map(e => {
            const m = window.moment(e.day, "YYYY-MM-DD", true);
            const dayName = m.isValid() ? m.format("dddd") : "Unknown";
            const monthFolder = m.isValid() ? m.format("YYYY/MM-MMMM") : "";
            const dayHubPath = `spice/scratch/${monthFolder}/${e.day}/Scratch-Day-${e.day}.md`;
            return {
                file: { name: `${dayName} ${e.day}`, path: dayHubPath, mtime: { ts: e.latestMtime } },
                _count: e.count,
                _day: e.day,
                _dayName: dayName
            };
        });

        const pencil = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

        await customJS.BeaconCards.render(dv, {
            pages: items,
            layout: "row",
            title: (p) => `${p._dayName}, ${p._day}`,
            icon: () => pencil,
            meta: (p) => {
                const when = window.moment(p.file.mtime.ts).fromNow();
                return `<span>${p._count} scratch${p._count === 1 ? "" : "es"}</span><span title="Latest">${when}</span>`;
            },
            target: (p) => p.file.path,
            sort: (a, b) => b._day.localeCompare(a._day),
            empty: "No scratches yet. Hit the Scratch nav-button to capture your first."
        });
    }
}
