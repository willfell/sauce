class WikiTree {
    render(dv) {
      try {
        if (!dv || typeof dv.current !== "function" || typeof dv.pages !== "function" || !dv.container) return;
        const cur = dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== "wiki-hub" && cur.type !== "wiki-section") return;

        // The create/nav buttons (+ New Section / + New Page) now live in the
        // WikiChromeBar bar at the top of the note (chrome-bar adoption), so WikiTree
        // renders ONLY the search strip + page tree (content) below it.

        const filePath = cur.file.path;
        const scopePath = filePath.slice(0, filePath.lastIndexOf("/"));

        this._config = this._buildConfig(dv, cur);

        const ctx = customJS.DocSearch.render(dv, {
            scopePath,
            recursive: true,
            entityType: "wiki-page",
            persist: false,   // don't remember search text across visits to the note
            hideTags: true,   // hide the tag-filter chips under the search bar (match project)
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
      } catch (_e) { /* never throw during CustomJS/Dataview cold load */ }
    }

    _renderResults(dv, ctx, scopePath, cur) {
      try {
        if (!ctx || !ctx.resultsContainer || !dv || typeof dv.pages !== "function") return;
        const container = ctx.resultsContainer;
        const proxyDv = this._makeProxyDv(dv, container);

        const rawPages = dv.pages('"' + scopePath + '"');
        const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);

        // SEARCH MODE — with an active query, search this note's WHOLE subtree
        // recursively: a flat list of every matching doc, each tagged with its section.
        // `pages` is already the full recursive subtree under scopePath, so the query
        // naturally scopes to "the folder you're in, and everything below it". An empty
        // query falls through to the normal browse view (SectionExplorer).
        if (ctx && ctx.hasActiveFilter) {
            this._renderSearchResults(dv, proxyDv, scopePath, pages, ctx);
            return;
        }

        // Browse view — delegate the rail (sections) + page pane (this folder's docs +
        // pinned links) to the shared SectionExplorer mechanism.
        if (!customJS || !customJS.SectionExplorer || typeof customJS.SectionExplorer.makeAdapter !== "function"
            || typeof customJS.SectionExplorer.render !== "function") return;
        const adapter = customJS.SectionExplorer.makeAdapter(this._config);
        // NOTE: do NOT use `{ ...dv, container }` here — Obsidian's real `dv` is
        // a class instance; `pages`/`current` live on its prototype, not as own
        // enumerable properties, so a plain object-spread silently drops them
        // (adapter.listSections/listPages then throw or no-op, rendering an
        // empty rail even though matching pages exist). Rebuild explicitly,
        // matching the _makeProxyDv idiom used everywhere else in this codebase.
        customJS.SectionExplorer.render({
            container,
            current: dv.current.bind(dv),
            pages: dv.pages.bind(dv),
        }, adapter);

        // The hub's cross-subtree recent grid moved INTO SectionExplorer's page
        // pane (the adapter config's listRecent) — nothing else renders here.
      } catch (_e) { /* stale callback or missing dependency: fail closed */ }
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

    // Recursive search results: every wiki-page in the subtree (most-recent first)
    // whose name/tags match the active query, as a flat grid. Each card's subtitle is
    // the section trail (relative to where you searched) so you can tell WHERE a hit
    // lives. Replaces the browse view while a query is active.
    _renderSearchResults(dv, proxyDv, scopePath, pages, ctx) {
        // folder → section display title, for the "in <trail>" subtitle.
        const sectionByFolder = {};
        for (const p of pages) {
            if (p && p.type === "wiki-section" && p.file && p.file.path) {
                const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                sectionByFolder[f] = (p.title && String(p.title).trim()) || p.file.path.slice(p.file.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
            }
        }
        const matches = pages
            .filter(p => p && p.type === "wiki-page" && p.file && p.file.path && customJS.DocSearch.matches(p, ctx))
            .sort((a, b) => {
                const at = a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
                const bt = b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
                return bt - at;
            });

        customJS.SectionLabel.render(proxyDv, { text: "Results (" + matches.length + ")" });
        if (!matches.length) {
            const empty = proxyDv.container.createEl("div");
            empty.style.cssText = "padding: 16px; text-align: center; color: var(--text-faint); font-style: italic; border: 1px dashed var(--background-modifier-border); border-radius: 8px; margin-top: 8px;";
            empty.textContent = "No matching docs in this section or below.";
            return;
        }
        const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        customJS.BeaconCards.render(proxyDv, {
            pages: matches,
            layout: "stacked",
            columns: 2,
            sort: () => 0,   // keep OUR most-recent-first order
            title: (p) => p.title || p.file.name,
            icon: () => fileIcon,
            target: (p) => p.file.path,
            subtitle: (p) => {
                const where = this._sectionTrail(p, scopePath, sectionByFolder);
                const ago = (p.file.mtime && window.moment) ? window.moment(p.file.mtime.ts).fromNow() : "";
                if (where) return ago ? (where + " · " + ago) : where;
                return ago ? ("edited " + ago) : "";
            },
        });
    }

    // "in <section> / <sub-section>" trail for a page, relative to the search root
    // (scopePath). Uses each folder's section-hub display title, falling back to the
    // folder slug. A page directly in the search root reads "here".
    _sectionTrail(p, scopePath, sectionByFolder) {
        const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
        if (folder === scopePath) return "here";
        if (!folder.startsWith(scopePath + "/")) return "";
        const rel = folder.slice(scopePath.length + 1).split("/");
        const parts = [];
        let acc = scopePath;
        for (const seg of rel) {
            acc = acc + "/" + seg;
            parts.push((sectionByFolder && sectionByFolder[acc]) || seg);
        }
        return "in " + parts.join(" / ");
    }

    // ── SectionExplorer adapter config — builds the wiki-specific
    // resolveContext/listSections/listPages/getLinks/writeLinks/canDelete/
    // deleteSection/renameSection/icons that SectionExplorer.render needs.
    _buildConfig(dv, cur) {
        const filePath = cur.file.path;
        const scopePath = filePath.slice(0, filePath.lastIndexOf("/"));
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
        const dotsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;

        return {
            structuralOwnerKey: filePath,
            resolveContext: () => ({ scopePath }),
            listSections: (dv2, ctx) => {
                const rawPages = dv2.pages('"' + ctx.scopePath + '"');
                const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);
                return this._immediateChildFolders(ctx.scopePath, pages).map((s) => ({
                    title: s.title,
                    hubPath: s.hubPath,
                    folder: s.folder,
                    pageCount: s.pageCount,
                    subSectionCount: s.subSectionCount,
                    maxMtime: s.maxMtime,
                    materialized: !!s.hubPath,
                }));
            },
            listPages: (dv2, ctx) => {
                const rawPages = dv2.pages('"' + ctx.scopePath + '"');
                const pages = rawPages.array ? rawPages.array() : Array.from(rawPages);
                return this._immediatePages(ctx.scopePath, pages);
            },
            getLinks: (target) => {
                if (!target || !target.hubPath) return [];
                const page = dv.page ? dv.page(target.hubPath) : null;
                return (page && Array.isArray(page.links)) ? page.links : [];
            },
            writeLinks: (target, links) => {
                if (!target || !target.hubPath) return Promise.resolve();
                const f = app.vault.getAbstractFileByPath(target.hubPath);
                if (!f) return Promise.resolve();
                return app.fileManager.processFrontMatter(f, (fm) => { fm.links = links; });
            },
            // Recursive-doc-count delete gate: only allow deleting a materialized
            // section (has a hub note) whose whole subtree contains NO wiki-pages.
            // Empty sub-sections are fine (no docs lost) — see emptySubsectionCount.
            canDelete: (section) => {
                if (!section || !section.hubPath) return false;
                try {
                    // dv-independent: dispatch-time (⋯ Delete) query via metadataCache.
                    const arr = customJS.SectionExplorer.pagesUnder(section.folder);
                    return customJS.SectionExplorer.subtreeDocCount(arr, section.folder, "wiki-page") === 0;
                } catch (_e) { return false; }
            },
            // Count of child section folders under this section (folder-is-truth):
            // used by the delete-confirm wording ("and N empty sub-section(s)").
            emptySubsectionCount: (section) => {
                try {
                    const arr = customJS.SectionExplorer.pagesUnder(section.folder);
                    return customJS.SectionExplorer.childSectionFolders(arr, section.folder, "wiki-section").length;
                } catch (_e) { return 0; }
            },
            // Shared-mechanism move block: wiki is folder-is-truth, so doc/section
            // moves are pure folder renames (no frontmatter rewrite), and any depth
            // is a legal destination.
            move: {
                root: "spice/wiki",
                sectionType: "wiki-section",
                docType: "wiki-page",
                rootLabel: "Wiki (root)",
                enumerateSectionTargets: () => {
                    // dv-independent: dispatch-time (⋯ Move section / leaf Move) query
                    // via metadataCache so a torn-down mobile dv can't blank the list.
                    const arr = customJS.SectionExplorer.pagesUnder("spice/wiki");
                    return customJS.SectionExplorer.sectionTargets(arr, {
                        root: "spice/wiki", sectionType: "wiki-section", rootLabel: "Wiki (root)",
                        labelOf: (p) => (p.title && String(p.title).trim()) || "",
                    });
                },
                rewriteOnDocMove: () => null,      // folder-is-truth: no frontmatter rewrite
                rewriteOnSectionMove: () => null,
                canAcceptSection: () => true,      // arbitrary depth
            },
            structural: true,
            deleteSection: (section) => {
                const f = app.vault.getAbstractFileByPath(section.folder);
                if (!f) return Promise.resolve();
                return app.fileManager.trashFile ? app.fileManager.trashFile(f) : Promise.resolve();
            },
            renameSection: (section, newTitle) => {
                const parent = section.folder.slice(0, section.folder.lastIndexOf("/"));
                const newSlug = this._slugify(newTitle);
                const newFolder = parent + "/" + newSlug;
                const folderFile = app.vault.getAbstractFileByPath(section.folder);
                const renamePromise = folderFile ? app.fileManager.renameFile(folderFile, newFolder) : Promise.resolve();
                const hubFile = app.vault.getAbstractFileByPath(section.hubPath);
                const fmPromise = hubFile ? app.fileManager.processFrontMatter(hubFile, (fm) => { fm.title = newTitle; }) : Promise.resolve();
                return Promise.all([renamePromise, fmPromise]);
            },
            icons: { folder: folderIcon, file: fileIcon, dots: dotsIcon },
            rootClass: "se-root",
            pageLabel: "Pages",
            // Recent mode for the pane: recent wiki-pages across THIS scope's
            // subtree (hub = whole wiki; section = its own subtree), each tagged
            // with the section it lives in. Replaces the hub-only grid WikiTree
            // used to draw below SectionExplorer.
            listRecent: (dv2, ctx) => {
                try {
                    const rawPages = dv2.pages('"' + ctx.scopePath + '"');
                    const all = rawPages.array ? rawPages.array() : Array.from(rawPages);
                    const sectionByFolder = {};
                    for (const p of all) {
                        if (p && p.type === "wiki-section" && p.file && p.file.path) {
                            const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                            sectionByFolder[f] = (p.title && String(p.title).trim()) || p.file.path.slice(p.file.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
                        }
                    }
                    return this._recentPages(all, 8).map((p) => {
                        const f = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                        const where = (f && f !== ctx.scopePath) ? (sectionByFolder[f] || f.slice(f.lastIndexOf("/") + 1)) : "";
                        return {
                            title: p.title || p.file.name,
                            path: p.file.path,
                            mtime: (p.file.mtime && p.file.mtime.ts != null) ? p.file.mtime.ts : 0,
                            where: where || null,
                        };
                    });
                } catch (_e) { return []; }
            },
        };
    }

    _slugify(label) {
        return String(label || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    // Aggregates each immediate child section: pageCount (docs, recursive),
    // subSectionCount (immediate sub-section folders), and maxMtime (last edit of
    // ANY note in the subtree). Ported verbatim (still used by _buildConfig.listSections).
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
