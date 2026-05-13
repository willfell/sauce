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
    async render(dv, args) {
        if (dv.container.closest(".markdown-embed")) return;
        const day = args && args.day;
        if (!day) {
            dv.paragraph("ScratchDayList: missing `day` arg.");
            return;
        }

        const scratches = dv.pages('"spice/scratch"')
            .where(p => p.type === "scratch" && p.day === day);

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
