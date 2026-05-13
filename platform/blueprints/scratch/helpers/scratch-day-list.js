/**
 * ScratchDayList (CustomJS)
 * Renders all scratches for a given day as BeaconCards in row layout.
 * Title = first-line preview snippet (or filename if empty).
 * Meta = "edited X ago" relative time from file mtime.
 * Sort = mtime descending (most-recently-edited first).
 *
 * Tolerates day arg + p.day frontmatter as string | Date | Luxon
 * (Obsidian auto-parses unquoted YAML dates).
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", {
 *     class: "ScratchDayList",
 *     args: [{ day: dv.current().day }]
 *   });
 */
class ScratchDayList {
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

    async render(dv, args) {
        if (dv.container.closest(".markdown-embed")) return;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = this._coerceDay(args && args.day);
        if (!day) {
            dv.paragraph("ScratchDayList: missing `day` arg.");
            return;
        }

        const scratches = dv.pages('"spice/scratch"')
            .where(p => p.type === "scratch" && this._coerceDay(p.day) === day);

        const items = [];
        for (const s of scratches) {
            let preview = "";
            try {
                const raw = await app.vault.read(app.vault.getAbstractFileByPath(s.file.path));
                const body = raw.split(/^---\s*$/m).slice(2).join("---");
                const firstLine = body.split("\n").map(l => l.trim()).find(l => l && !l.startsWith("```") && !l.startsWith("---") && !l.startsWith("← ") && !l.startsWith("[["));
                preview = (firstLine || s.file.name).slice(0, 80);
            } catch (e) {
                preview = s.file.name;
            }
            items.push({
                file: s.file,
                _preview: preview,
                _mtime: (s.file.mtime && s.file.mtime.ts) || 0
            });
        }

        await customJS.BeaconCards.render(dv, {
            pages: items,
            layout: "row",
            title: (p) => p._preview,
            meta: (p) => {
                const when = p._mtime ? window.moment(p._mtime).fromNow() : "(unknown)";
                return `<span title="Last edited">edited ${when}</span>`;
            },
            target: (p) => p.file.path,
            sort: (a, b) => (b._mtime || 0) - (a._mtime || 0),
            empty: "No scratches for this day yet. Hit + New Scratch above to capture one."
        });
    }
}
