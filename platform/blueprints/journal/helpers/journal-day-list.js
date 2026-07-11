/**
 * JournalDayList (CustomJS)
 * Renders all journal entries for a given day as BeaconCards in row layout.
 * Title = p.title frontmatter if present, else first non-fenced body line,
 *         else filename.
 * Meta = "edited X ago" relative time from file mtime.
 * Sort = mtime descending (most-recently-edited first).
 *
 * Tolerates day arg + p.day frontmatter as string | Date | Luxon.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", {
 *     class: "JournalDayList",
 *     args: [{ day: dv.current().day }]
 *   });
 */
class JournalDayList {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        // No Date branch — see StickyDayList's identical guard for rationale:
        // a bare JS Date carries no timezone affinity, so returning null here
        // (rather than reading local getFullYear/Month/Date off a UTC-anchored
        // instant) avoids silently misattributing a YAML-parsed unquoted
        // "day: 2026-06-01" to the wrong calendar day for users west of UTC.
        // The install-time migration always writes `day` as a quoted string,
        // so this branch is unreachable in practice post-migration.
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
            day = this._coerceDay(customJS.RenderSafe.page(dv)?.day);
        }
        return day;
    }

    async render(dv, args) {
        if (dv.container.closest(".markdown-embed")) return;

        const myGen = (dv.container.__journalRenderGen || 0) + 1;
        dv.container.__journalRenderGen = myGen;
        const isStale = () => dv.container.__journalRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = await this._pollForDayArg(args, dv);
        if (isStale()) return;
        if (!day) {
            dv.paragraph("JournalDayList: missing `day` arg.");
            return;
        }

        const entries = dv.pages('"spice/journal"')
            .where(p => p.type === "journal-entry" && this._coerceDay(p.day) === day);

        const items = [];
        for (const s of entries) {
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
            empty: "No journal entries for this day yet. Hit + New Journal Entry above to capture one."
        });
    }
}
