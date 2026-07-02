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

        this._renderResults(dv, ctx, scopePath, cur);
    }

    _renderResults(dv, ctx, scopePath, cur) {
        const container = ctx.resultsContainer;
        const proxyDv = this._makeProxyDv(dv, container);

        const rawPages = dv.pages('"' + scopePath + '"');
        const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);

        // Sub-sections
        const subs = this._immediateChildFolders(scopePath, pages);
        if (subs.length) {
            customJS.SectionLabel.render(proxyDv, { text: "Sections" });
            const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
            customJS.BeaconCards.render(proxyDv, {
                pages: subs,
                layout: "stacked",
                columns: 2,
                title: (s) => s.title,
                icon: () => folderIcon,
                // BeaconCards navigates via `target` (→ openLinkText), NOT `link`.
                // Section entries are plain objects (no .file.path), so without an
                // explicit target the card had no destination → clicking did nothing.
                target: (s) => s.hubPath || (s.folder + "/" + s.title + ".md"),
                meta: (s) => {
                    if (s.pageCount === 0) return undefined;
                    const ago = window.moment ? window.moment(s.maxMtime).fromNow() : "";
                    const pc = s.pageCount;
                    return pc + " page" + (pc === 1 ? "" : "s") + (ago ? " · updated " + ago : "");
                },
            });
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
                meta: (p) => {
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
                    layout: "stacked",
                columns: 2,
                    title: (p) => p.title || p.file.name,
                    icon: () => recentIcon,
                    target: (p) => p.file.path,
                    meta: (p) => {
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
            if (!seen.has(child)) seen.set(child, { folder: child, title: segs[0], hubPath: null, pageCount: 0, maxMtime: 0 });
            const entry = seen.get(child);
            // Capture the child's section-hub note (the wiki-section living DIRECTLY in `child`).
            if (p.type === "wiki-section" && folder === child) {
                entry.title = (p.title && String(p.title).trim()) || (p.file.name ? String(p.file.name).replace(/\.md$/, "") : entry.title);
                entry.hubPath = p.file.path;
            }
            if (p.type === "wiki-page") {
                entry.pageCount++;
                const ts = p.file.mtime && p.file.mtime.ts != null ? p.file.mtime.ts : 0;
                if (ts > entry.maxMtime) entry.maxMtime = ts;
            }
        }
        return Array.from(seen.values()).sort((a, b) => a.folder.localeCompare(b.folder));
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
