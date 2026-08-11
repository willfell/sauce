/**
 * StickyDayList (CustomJS)
 * Renders all sticky notes for a given day as BeaconCards in row layout.
 * Title = p.title frontmatter if present, else first non-fenced body line,
 *         else filename.
 * Meta = "edited X ago" relative time from file mtime.
 * Sort = mtime descending (most-recently-edited first).
 *
 * Tolerates day arg + p.day frontmatter as string | Date | Luxon.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", {
 *     class: "StickyDayList",
 *     args: [{ day: dv.current().day }]
 *   });
 */
class StickyDayList {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        // v0.5.2 (sauce v0.84.1): no Date branch. A bare JS Date carries no
        // timezone affinity — getFullYear/Month/Date pull LOCAL-time components
        // off a UTC-anchored instant, which silently shifts a YAML-parsed
        // unquoted "day: 2026-06-01" (= 2026-06-01T00:00:00Z) to 2026-05-31
        // for any user west of UTC. Returning null drops the sticky note from the
        // day-list rather than mis-attributing it; the migration helper
        // (StickyDayMigrate, Stage 3) rewrites unquoted YAML dates as quoted
        // strings so the dropped branch becomes unreachable in practice.
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
        let renderSafe = null;
        try {
            renderSafe = globalThis.customJS && globalThis.customJS.RenderSafe;
        } catch (_e) { renderSafe = null; }
        if (!day && (!renderSafe || typeof renderSafe.page !== "function")) return null;
        for (let i = 0; i < 40 && (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)); i++) {
            await new Promise(r => setTimeout(r, 50));
            try { day = this._coerceDay(renderSafe.page(dv)?.day); }
            catch (_e) { return null; }
        }
        return day;
    }

    async render(dv, args) {
        let isStale = () => false;
        try {
            const container = dv && dv.container;
            if (!container) return;
            if (typeof container.closest === "function" && container.closest(".markdown-embed")) return;

            const myGen = (container.__stickyRenderGen || 0) + 1;
            container.__stickyRenderGen = myGen;
            isStale = () => container.__stickyRenderGen !== myGen;

            while (container.firstChild) container.removeChild(container.firstChild);

            const day = await this._pollForDayArg(args, dv);
            if (isStale()) return;
            if (!day) {
                if (typeof dv.paragraph === "function") dv.paragraph("StickyDayList: missing `day` arg.");
                return;
            }

            if (typeof dv.pages !== "function") return;
            const stickies = dv.pages('"spice/sticky-notes"')
                .where(p => p.type === "sticky-note" && this._coerceDay(p.day) === day);

            const items = [];
            for (const s of stickies) {
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

            if (isStale()) return;

            const beaconCards = globalThis.customJS && globalThis.customJS.BeaconCards;
            if (!beaconCards || typeof beaconCards.render !== "function") return;
            await beaconCards.render(dv, {
                pages: items,
                layout: "row",
                title: (p) => p._title,
                meta: (p) => {
                    const when = p._mtime ? window.moment(p._mtime).fromNow() : "(unknown)";
                    return `<span title="Last edited">edited ${when}</span>`;
                },
                target: (p) => p.file.path,
                sort: (a, b) => (b._mtime || 0) - (a._mtime || 0),
                empty: "No sticky notes for this day yet. Hit + New Sticky Note above to capture one."
            });
        } catch (e) {
            if (isStale()) return;
            try { if (dv && typeof dv.paragraph === "function") dv.paragraph(`StickyDayList error: ${e && e.message ? e.message : e}`); } catch (_e) {}
        }
    }
}
