/**
 * JournalHubCards (CustomJS)
 * The global journal hub. A "Days | All" segmented toggle sits above the
 * card area:
 *   - Days (default): one card per day with ≥1 journal entry, latest first;
 *     click → that day's day-hub page.
 *   - All: a flat, recursive, newest-first list of EVERY journal entry across
 *     all days, fronted by the doc-search strip. Typing filters by title AND
 *     entry body content (a title-miss but body-hit still matches) — search
 *     replaces the card list with results, mirroring the wiki blueprint's UX.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "JournalHubCards" });
 */
class JournalHubCards {
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

    // Local copy of JournalDayList._extractPreviewFromBody — kept in-class to
    // avoid cross-class load-order coupling (sticky-notes precedent explicitly
    // sanctions this duplication).
    _extractPreviewFromBody(raw) {
        const afterFrontmatter = String(raw || "").split(/^---\s*$/m).slice(2).join("---");
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

    _mode(container) {
        return container && container.__journalHubMode === "days" ? "days" : "all";
    }

    _matchesFilter(page, needle, body) {
        if (!needle) return true;
        const title = (page && page.title ? String(page.title) : "").toLowerCase();
        const name = (page && page.file && page.file.name ? page.file.name : "").toLowerCase();
        return title.includes(needle) || name.includes(needle) || (body || "").toLowerCase().includes(needle);
    }

    _renderToggle(dv, mode) {
        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 8px; justify-content: center; margin: 0 0 10px 0;";
        const mk = (key, label) => {
            const b = row.createEl("button", { text: label });
            const active = mode === key;
            b.style.cssText = "padding: 4px 14px; border-radius: 12px; border: 1px solid var(--background-modifier-border); cursor: pointer; font-size: 0.85em;"
                + (active
                    ? "background: var(--interactive-accent); color: var(--text-on-accent);"
                    : "background: var(--background-secondary); color: var(--text-muted);");
            b.addEventListener("click", () => {
                if (this._mode(dv.container) === key) return;
                dv.container.__journalHubMode = key;
                this.render(dv); // full re-render; generation stamp handles staleness
            });
        };
        mk("days", "Days");
        mk("all", "All");
    }

    async render(dv) {
        try {
            if (dv.container.closest(".markdown-embed")) return;

            const myGen = (dv.container.__journalRenderGen || 0) + 1;
            dv.container.__journalRenderGen = myGen;
            const isStale = () => dv.container.__journalRenderGen !== myGen;

            while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

            const mode = this._mode(dv.container);
            this._renderToggle(dv, mode);

            if (mode === "all") {
                await this._renderAll(dv, isStale);
            } else {
                await this._renderDays(dv, isStale);
            }
            if (isStale()) return;
        } catch (e) {
            try { dv.paragraph(`JournalHubCards error: ${e && e.message ? e.message : e}`); } catch (_e) {}
        }
    }

    async _renderDays(dv, isStale) {
        const body = dv.container.createEl("div");

        const entries = dv.pages('"spice/journal"').where(p => p.type === "journal-entry");
        const byDay = new Map();
        for (const s of entries) {
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
            const dayHubPath = `spice/journal/${monthFolder}/${e.day}/Journal-Day-${e.day}.md`;
            return {
                file: { name: `${dayName} ${e.day}`, path: dayHubPath, mtime: { ts: e.latestMtime } },
                _count: e.count,
                _day: e.day,
                _dayName: dayName
            };
        });

        if (isStale()) return;

        const pencil = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

        const proxyDv = {
            container: body,
            current: dv.current.bind(dv),
            pages: dv.pages.bind(dv)
        };

        await customJS.BeaconCards.render(proxyDv, {
            pages: items,
            layout: "row",
            title: (p) => `${p._dayName}, ${p._day}`,
            icon: () => pencil,
            meta: (p) => {
                const when = window.moment(p.file.mtime.ts).fromNow();
                return `<span>${p._count} entr${p._count === 1 ? "y" : "ies"}</span><span title="Latest">${when}</span>`;
            },
            target: (p) => p.file.path,
            sort: (a, b) => b._day.localeCompare(a._day),
            empty: "No journal entries yet. Hit the Journal nav-button to capture your first."
        });
    }

    async _renderAll(dv, isStale) {
        const bodyCache = new Map(); // path → body (per render pass)
        const readBody = async (p) => {
            if (bodyCache.has(p)) return bodyCache.get(p);
            let body = "";
            try {
                const file = app.vault.getAbstractFileByPath(p);
                if (file) body = await app.vault.cachedRead(file);
            } catch (_e) {}
            bodyCache.set(p, body);
            return body;
        };

        const renderResults = async (ctx) => {
            const gen = (dv.container.__journalAllGen || 0) + 1;
            dv.container.__journalAllGen = gen;
            const stale = () => dv.container.__journalAllGen !== gen || isStale();

            const pages = dv.pages('"spice/journal"').where((p) => p.type === "journal-entry");
            const needle = (ctx && ctx.text ? ctx.text : "").toLowerCase();

            const items = [];
            for (const s of pages) {
                const body = needle ? await readBody(s.file.path) : "";
                if (!this._matchesFilter(s, needle, body)) continue;
                let title = (s.title && String(s.title).trim())
                    || this._extractPreviewFromBody(needle ? body : await readBody(s.file.path))
                    || s.file.name;
                items.push({
                    file: s.file,
                    _title: title,
                    _day: this._coerceDay(s.day) || "",
                    _mtime: (s.file.mtime && s.file.mtime.ts) || 0
                });
            }
            if (stale()) return;

            if (ctx.resultsContainer.empty) ctx.resultsContainer.empty();
            else ctx.resultsContainer.innerHTML = "";

            const proxyDv = {
                container: ctx.resultsContainer,
                current: dv.current.bind(dv),
                pages: dv.pages.bind(dv)
            };

            await customJS.BeaconCards.render(proxyDv, {
                pages: items,
                layout: "row",
                title: (p) => p._title,
                meta: (p) => {
                    const when = p._mtime ? window.moment(p._mtime).fromNow() : "(unknown)";
                    return `<span>${p._day || ""}</span><span title="Last edited">edited ${when}</span>`;
                },
                target: (p) => p.file.path,
                sort: (a, b) => (b._mtime || 0) - (a._mtime || 0),
                empty: "No journal entries match."
            });
        };

        if (customJS && customJS.DocSearch && typeof customJS.DocSearch.render === "function") {
            const ctx = customJS.DocSearch.render(dv, {
                scopePath: "spice/journal",
                recursive: true,
                entityType: "journal-entry",
                persist: false,
                hideTags: true,
                placeholder: "Search journal entries (title + content)…",
                onChange: (c) => { renderResults(c); }
            });
            await renderResults(ctx);
        } else {
            // Degrade gracefully: no search strip, just the flat list.
            const resultsContainer = dv.container.createEl("div");
            await renderResults({ text: "", resultsContainer });
        }
    }
}
