/**
 * ScratchDayList (CustomJS)
 * Renders all scratches for a given day, time-ordered ascending.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", {
 *     class: "ScratchDayList",
 *     args: { day: dv.current().day }
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
                preview = (firstLine || "(empty)").slice(0, 60);
            } catch (e) {
                preview = "(unreadable)";
            }
            items.push({
                file: s.file,
                _time: s.time || "??:??",
                _preview: preview
            });
        }

        await customJS.BeaconCards.render(dv, {
            pages: items,
            layout: "row",
            title: (p) => `${p._time}  ·  ${p._preview}`,
            target: (p) => p.file.path,
            sort: (a, b) => (a._time || "").localeCompare(b._time || ""),
            empty: "No scratches for this day yet."
        });
    }
}
