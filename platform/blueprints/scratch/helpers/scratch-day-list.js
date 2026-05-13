/**
 * ScratchDayList (CustomJS)
 * Renders all scratches for a given day as BeaconCards in row layout.
 * Title = p.title frontmatter if present, else first non-fenced body line,
 *         else filename.
 * Meta = "edited X ago" relative time from file mtime.
 * Sort = mtime descending (most-recently-edited first).
 *
 * Tolerates day arg + p.day frontmatter as string | Date | Luxon.
 *
 * Usage:
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

    _extractPreviewFromBody(raw) {
        const afterFrontmatter = raw.split(/^---\s*$/m).slice(2).join("---");
        const lines = afterFrontmatter.split("\n");
        let inFence = false;
        for (const rawLine of lines) {
            const l = rawLine.trim();
            if (l.startsWith("```")) { inFence = !inFence; continue; }
            if (inFence) continue;
            if (!l) continue;
            if (l.startsWith("---")) continue;
            if (l.startsWith("← ") || l.startsWith("[[")) continue;
            return l.slice(0, 80);
        }
        return "";
    }

    async _pollForDayArg(args, dv) {
        let day = this._coerceDay(args && args.day);
        for (let i = 0; i < 40 && (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)); i++) {
            await new Promise(r => setTimeout(r, 50));
            day = this._coerceDay(dv.current().day);
        }
        return day;
    }

    async render(dv, args) {
        if (dv.container.closest(".markdown-embed")) return;
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = await this._pollForDayArg(args, dv);
        if (!day) {
            dv.paragraph("ScratchDayList: missing `day` arg.");
            return;
        }

        const scratches = dv.pages('"spice/scratch"')
            .where(p => p.type === "scratch" && this._coerceDay(p.day) === day);

        const items = [];
        for (const s of scratches) {
            let title = (s.title && String(s.title).trim()) || "";
            if (!title) {
                try {
                    const raw = await app.vault.read(app.vault.getAbstractFileByPath(s.file.path));
                    title = this._extractPreviewFromBody(raw);
                } catch (e) {
                    title = "";
                }
            }
            if (!title) title = s.file.name;
            items.push({
                file: s.file,
                _title: title,
                _mtime: (s.file.mtime && s.file.mtime.ts) || 0
            });
        }

        await customJS.BeaconCards.render(dv, {
            pages: items,
            layout: "row",
            title: (p) => p._title,
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
