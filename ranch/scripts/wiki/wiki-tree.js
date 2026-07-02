class WikiTree {
    render(dv) {
        const cur = dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== "wiki-hub" && cur.type !== "wiki-section") return;

        // Render the create/nav buttons at the top of THIS block (they used to live
        // in a separate WikiHubActions dataviewjs block followed by a "---"). Keeping
        // them in the same block as the search bar makes the buttons↔search divider
        // tight — no cross-block line gap. Best-effort: if WikiHubActions is cold,
        // the search + cards below still render.
        try {
            if (customJS && customJS.WikiHubActions && typeof customJS.WikiHubActions.render === "function") {
                customJS.WikiHubActions.render(dv);
            }
        } catch (_e) { /* buttons are best-effort */ }

        const filePath = cur.file.path;
        const scopePath = filePath.slice(0, filePath.lastIndexOf("/"));

        const ctx = customJS.DocSearch.render(dv, {
            scopePath,
            recursive: true,
            entityType: "wiki-page",
            persist: false,   // don't remember search text across visits to the note
            onChange: (c) => {
                c.resultsContainer.empty();
                this._renderResults(dv, c, scopePath, cur);
            },
        });

        // Match the search bar's top gap to the wiki buttons↔divider gap (12px) so the
        // spacing above the search is IDENTICAL to the spacing around the wiki buttons.
        // (The shared doc-search strip ships a 2px top margin; wiki wants 12px.)
        try {
            const strip = dv.container.querySelector(".doc-search-strip");
            if (strip && strip.style) strip.style.marginTop = "12px";
        } catch (_e) { /* cosmetic only */ }

        this._renderResults(dv, ctx, scopePath, cur);
    }

    _renderResults(dv, ctx, scopePath, cur) {
        const container = ctx.resultsContainer;
        const proxyDv = this._makeProxyDv(dv, container);

        const rawPages = dv.pages('"' + scopePath + '"');
        const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);

        // Sub-sections — rows, sorted by last-edited (default) with a Recent | A–Z toggle.
        const subs = this._immediateChildFolders(scopePath, pages);
        if (subs.length) {
            customJS.SectionLabel.render(proxyDv, { text: "Sections" });
            const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
            this._renderSectionCards(dv, proxyDv, subs, folderIcon);
        }

        // Pages in this folder
        const docs = this._immediatePages(scopePath, pages).filter(p => customJS.DocSearch.matches(p, ctx));
        if (docs.length) {
            if (subs.length) {
                customJS.SectionLabel.render(proxyDv, { text: "Pages" });
            }
            const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
            customJS.BeaconCards.render(proxyDv, {
                pages: docs,
                layout: "stacked",
                columns: 2,
                title: (p) => p.title || p.file.name,
                icon: () => fileIcon,
                target: (p) => p.file.path,
                // subtitle (not meta) — meta only renders in row layout; grid cards
                // surface the detail as a muted second line.
                subtitle: (p) => {
                    const created = p.created_at ? (window.moment ? window.moment(typeof p.created_at.toISO === "function" ? p.created_at.toISO() : String(p.created_at)).format("MMM D") : "") : "";
                    const edited = (p.file.mtime && window.moment) ? window.moment(p.file.mtime.ts).fromNow() : "";
                    return created ? "created " + created + " · edited " + edited : (edited ? "edited " + edited : "");
                },
            });
        }

        // Recently updated — hub only. Rendered as cards (like sections/pages),
        // each tagged with the section the page came from.
        if (cur.type === "wiki-hub") {
            const allPages = dv.pages('"spice/wiki"');
            const allArr = allPages.array ? allPages.array() : Array.from(allPages);
            const recent = this._recentPages(allArr, 8).filter(p => customJS.DocSearch.matches(p, ctx));
            if (recent.length) {
                customJS.SectionLabel.render(proxyDv, { text: "Recently updated" });
                // Map each folder → its section display title (from the wiki-section hub there).
                const sectionByFolder = {};
                for (const p of allArr) {
                    if (p && p.type === "wiki-section" && p.file && p.file.path) {
                        const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                        sectionByFolder[f] = (p.title && String(p.title).trim()) || p.file.path.slice(p.file.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
                    }
                }
                const sectionOf = (p) => {
                    if (!p.file || !p.file.path) return "";
                    const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                    if (!f || f === scopePath) return "";   // scopePath is "spice/wiki" on the hub → root-level page
                    return sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1);
                };
                // Use the note (file) icon — same as the page cards — so recent items read as notes.
                const recentIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
                customJS.BeaconCards.render(proxyDv, {
                    pages: recent,
                    // Stays a GRID (2 columns); the section + when-updated detail shows
                    // as a muted second line (subtitle — meta only renders in row layout).
                    layout: "stacked",
                    columns: 2,
                    title: (p) => p.title || p.file.name,
                    icon: () => recentIcon,
                    target: (p) => p.file.path,
                    subtitle: (p) => {
                        const sec = sectionOf(p);
                        const ago = (p.file.mtime && window.moment) ? window.moment(p.file.mtime.ts).fromNow() : "";
                        const where = sec ? ("in " + sec) : "in Wiki";
                        return ago ? (where + " · " + ago) : where;
                    },
                });
            }
        }
    }

    _makeProxyDv(dv, container) {
        return {
            container,
            current: dv.current.bind(dv),
            pages: dv.pages.bind(dv),
            el: (tag, txt, opts) => {
                const el = container.createEl(tag, { ...(opts || {}) });
                if (txt !== undefined && txt !== null && txt !== "") el.textContent = String(txt);
                return el;
            },
            header: (lvl, txt) => container.createEl("h" + lvl, { text: String(txt) }),
            paragraph: (txt) => {
                const p = container.createEl("p");
                p.innerHTML = String(txt);
                return p;
            },
        };
    }

    // Section cards as full-width ROWS (title left, sub-sections · docs · edited right),
    // sorted by LAST-EDITED by default with a "Recent | A–Z" toggle. The chosen mode
    // lives on dv.container so it survives search-driven re-renders; toggling re-sorts
    // only these cards. This is the single Sections renderer, so the toggle is
    // consistent on the hub AND every section / sub-section note.
    _renderSectionCards(dv, proxyDv, subs, folderIcon) {
        const host = proxyDv.container;
        const meta = (s) => {
            const parts = [];
            if (s.subSectionCount) parts.push(s.subSectionCount + " section" + (s.subSectionCount === 1 ? "" : "s"));
            parts.push(s.pageCount + " doc" + (s.pageCount === 1 ? "" : "s"));
            if (s.maxMtime && window.moment) parts.push("edited " + window.moment(s.maxMtime).fromNow());
            return parts.join(" · ");
        };
        const renderCards = (container, ordered) => {
            const cdv = this._makeProxyDv(dv, container);
            customJS.BeaconCards.render(cdv, {
                pages: ordered,
                layout: "row",
                sort: () => 0,   // keep OUR order (synthetic pages have no file.mtime for BeaconCards' default sort)
                title: (s) => s.title,
                icon: () => folderIcon,
                // BeaconCards navigates via `target` (→ openLinkText), NOT `link`. Section
                // entries are plain objects (no .file.path) → need an explicit target.
                target: (s) => s.hubPath || (s.folder + "/" + s.title + ".md"),
                meta,
            });
        };

        // A single section → no toggle, just the card.
        if (subs.length < 2) { renderCards(host, subs); return; }

        const sortRecent = (list) => [...list].sort((a, b) => (b.maxMtime || 0) - (a.maxMtime || 0));
        const sortAlpha  = (list) => [...list].sort((a, b) => String(a.title).localeCompare(String(b.title)));

        const toggle = host.createEl("div");
        toggle.style.cssText = "display: flex; gap: 6px; justify-content: flex-end; margin: -2px 0 0 0;";
        const cardsWrap = host.createEl("div");

        const modes = [{ key: "recent", label: "Recent" }, { key: "alpha", label: "A–Z" }];
        const pills = {};
        const getMode = () => (dv.container.__wikiSectionSort === "alpha" ? "alpha" : "recent");
        const paint = () => {
            const mode = getMode();
            for (const m of modes) {
                const active = m.key === mode;
                pills[m.key].style.cssText = "cursor: pointer; font-size: 0.72em; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--background-modifier-border); " +
                    (active ? "background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent);"
                            : "background: transparent; color: var(--text-muted);");
            }
            cardsWrap.empty();
            renderCards(cardsWrap, mode === "alpha" ? sortAlpha(subs) : sortRecent(subs));
        };
        for (const m of modes) {
            const pill = toggle.createEl("span");
            pill.textContent = m.label;
            pill.onclick = () => { dv.container.__wikiSectionSort = m.key; paint(); };
            pills[m.key] = pill;
        }
        paint();
    }

    // Aggregates each immediate child section: pageCount (docs, recursive),
    // subSectionCount (immediate sub-section folders), and maxMtime (last edit of
    // ANY note in the subtree). The card meta surfaces all three.
    _immediateChildFolders(scopePath, pages) {
        const seen = new Map();
        for (const p of pages) {
            if (!p || !p.file || !p.file.path) continue;
            const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
            if (!folder.startsWith(scopePath + "/")) continue;
            const segs = folder.slice(scopePath.length + 1).split("/");
            if (segs.length < 1) continue;
            const child = scopePath + "/" + segs[0];
            // Default title = folder slug; real title/link resolved from the child's own
            // section-hub note below (folders are slugified, hub notes are Display-Case, so
            // reconstructing folder+slug+".md" would 404 on case-sensitive filesystems).
            if (!seen.has(child)) seen.set(child, { folder: child, title: segs[0], hubPath: null, pageCount: 0, subSections: new Set(), maxMtime: 0 });
            const entry = seen.get(child);
            // Capture the child's section-hub note (the wiki-section living DIRECTLY in `child`).
            if (p.type === "wiki-section" && folder === child) {
                entry.title = (p.title && String(p.title).trim()) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : entry.title);
                entry.hubPath = p.file.path;
            }
            // segs[1] (when present) is an immediate sub-section folder of `child`.
            if (segs.length >= 2 && segs[1]) entry.subSections.add(segs[1]);
            if (p.type === "wiki-page") entry.pageCount++;
            // "last edited" reflects any note in the subtree (docs + section hubs).
            const ts = p.file.mtime && p.file.mtime.ts != null ? p.file.mtime.ts : 0;
            if (ts > entry.maxMtime) entry.maxMtime = ts;
        }
        return Array.from(seen.values())
            .map(({ subSections, ...rest }) => ({ ...rest, subSectionCount: subSections.size }))
            .sort((a, b) => a.folder.localeCompare(b.folder));
    }

    _immediatePages(scopePath, pages) {
        return (pages || []).filter(p => {
            if (!p || !p.file || !p.file.path) return false;
            if (p.type !== "wiki-page") return false;
            const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
            return folder === scopePath;
        }).sort((a, b) => {
            const at = a.file && a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
            const bt = b.file && b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
            return bt - at;
        });
    }

    _recentPages(pages, n) {
        return (pages || [])
            .filter(p => p && p.type === "wiki-page")
            .sort((a, b) => {
                const at = a.file && a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
                const bt = b.file && b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
                return bt - at;
            })
            .slice(0, n);
    }
}
