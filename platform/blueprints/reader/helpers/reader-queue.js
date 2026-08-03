/**
 * ReaderQueue (CustomJS) — the reader-hub's status-grouped reading queue. First
 * class of the reader blueprint (a flat reading queue: spice/reader/Reader.md is
 * the reader-hub; reader-article notes are FLAT leaves in spice/reader/, never
 * nested; status — unread / reading / archived — lives in frontmatter, never a
 * folder).
 *
 * Renders on a `type: reader-hub` note (invoked via customjs-guard, so its entry
 * method is the instance `render(dv)`). Article creation lives on the nav
 * chrome-bar ("+ New article" → ReaderArticlePaste.open); this hub no longer
 * draws its own create button. In ONE container it draws, top to bottom:
 *   1. a DocSearch strip (scoped to spice/reader, non-recursive, entityType
 *      reader-article, persist:false, hideTags:true) whose onChange re-renders
 *      the results.
 *   2. glance pills (Unread N · Reading N · Archived N — any zero hidden).
 *   3. BROWSE mode (empty search): three bands — Reading, Unread, Archived (the
 *      Archived band shows a count caption + the most-recent handful).
 *   4. SEARCH mode (active filter): a flat newest-first results list.
 * Each article renders via the shared `_renderArticleRow` — a title link that
 * OPENS the note (same openLinkText pattern the to-do TaskTodayList row uses) +
 * a source-meta subtitle + a status-cycle control (unread→reading→archived→unread)
 * that moves the row optimistically through RenderSafe.mutateStructure before
 * writing frontmatter (stopPropagation so it doesn't also open the note).
 *
 * COLD-LOAD SAFETY (landmines #1-2): Dataview can run this block before the note
 * is indexed. We guard `dv.current()` early and resolve every other customJS class
 * via `window.customJS?.X` (property access can't hit the TDZ). The render NEVER
 * throws out of `render`; selectArticles is pure + tolerant of no pages.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → "Unexpected token" → the class never registers. `node --check`
 * won't catch it; the CJS-LOAD gate does. To Node-test the statics, load via
 * `new Function(src + "\nreturn ReaderQueue;")()`.
 *
 * Static API (Node-testable, pure):
 *   ReaderQueue.selectArticles(dv) → { reading, unread, archived, counts }
 *
 * Instance API (browser-side):
 *   ReaderQueue.render(dv)   ← the customjs-guard entry point
 */
class ReaderQueue {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.ReaderQueue; the Node
    // harness news the class and calls selectArticles through that instance. A
    // static-only declaration is not on the prototype → the call throws at
    // runtime. Instance method precedes its static in source order.

    selectArticles(dv) { return ReaderQueue.selectArticles(dv); }

    // ---------- Static pure helper ----------

    /**
     * PURE selection. Queries every reader-article under spice/reader, buckets
     * each into reading / archived / else→unread (any unrecognized/blank status
     * reads as "unread"), and sorts each bucket newest-first by `captured_at`
     * (string ISO compare; a missing captured_at sorts last via an empty-string
     * fallback). Returns:
     *   { reading:[…], unread:[…], archived:[…], counts:{ unread, reading, archived } }
     * COLD-LOAD SAFE — a null dv, a dv with no `pages`, or zero matching pages
     * all yield empty buckets + zero counts. Never throws.
     */
    static selectArticles(dv, statusOverrides) {
        const empty = { reading: [], unread: [], archived: [], counts: { unread: 0, reading: 0, archived: 0 } };
        try {
            if (!dv || typeof dv.pages !== 'function') return empty;
            let list = [];
            try {
                const raw = dv.pages('"spice/reader"').where(p => p && p.type === 'reader-article');
                list = raw && typeof raw.array === 'function' ? raw.array() : Array.from(raw || []);
            } catch (_e) {
                list = [];
            }
            const reading = [];
            const unread = [];
            const archived = [];
            for (const p of list) {
                if (!p) continue;
                const path = p.file && p.file.path ? String(p.file.path) : '';
                let rawStatus = p.status;
                try {
                    if (path && statusOverrides && typeof statusOverrides.has === 'function'
                        && statusOverrides.has(path)) rawStatus = statusOverrides.get(path);
                } catch (_e) { /* authority snapshot remains the fallback */ }
                const status = String(rawStatus == null ? '' : rawStatus).trim().toLowerCase();
                if (status === 'reading') reading.push(p);
                else if (status === 'archived') archived.push(p);
                else unread.push(p);   // unread + any unrecognized/blank status
            }
            const cap = (p) => {
                try {
                    const v = p && p.captured_at;
                    if (v == null) return '';
                    if (typeof v === 'string') return v;
                    if (typeof v.toISO === 'function') return v.toISO() || '';
                    return String(v);
                } catch (_e) { return ''; }
            };
            const byCapturedDesc = (a, b) => {
                const av = cap(a);
                const bv = cap(b);
                if (av < bv) return 1;
                if (av > bv) return -1;
                return 0;
            };
            reading.sort(byCapturedDesc);
            unread.sort(byCapturedDesc);
            archived.sort(byCapturedDesc);
            return {
                reading: reading,
                unread: unread,
                archived: archived,
                counts: { unread: unread.length, reading: reading.length, archived: archived.length },
            };
        } catch (_e) {
            return { reading: [], unread: [], archived: [], counts: { unread: 0, reading: 0, archived: 0 } };
        }
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Guards `reader-hub`,
     * then draws the create row + search strip + glance pills + status bands (or a
     * flat search-results list). Fully guarded — returns quietly on cold-load (no
     * throw), and each row is wrapped in try/catch so one bad article can't break
    * the whole queue.
     */
    render(dv) {
      try {
        if (!dv || !dv.container) return;
        // Skip rendering inside embeds — the host note renders its own queue.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        let cur = null;
        try {
            const renderSafe = globalThis.customJS?.RenderSafe;
            cur = renderSafe && typeof renderSafe.page === 'function'
                ? renderSafe.page(dv)
                : (dv.current && dv.current());
        } catch (_e) { return; }
        if (!cur || !cur.file) return;
        if (cur.type !== 'reader-hub') return;

        const state = {
            statuses: new Map(), structuralQueue: null, toggles: new Map(),
            container: null, ctx: null, renderGeneration: 0,
        };

        // DocSearch strip — scoped to spice/reader, NON-recursive (flat leaves),
        // entityType reader-article, persist:false (search always starts empty).
        // onChange clears ONLY the results container + re-renders the queue.
        const DocSearch = globalThis.customJS?.DocSearch;
        if (!DocSearch || typeof DocSearch.render !== 'function') {
            // No search mechanism → render the browse view directly into the
            // container so the queue still shows (cold-load / missing dep).
            state.container = dv.container;
            this._renderResults(dv, dv.container, null, state);
            return;
        }

        const ctx = DocSearch.render(dv, {
            scopePath: 'spice/reader',
            recursive: false,
            entityType: 'reader-article',
            persist: false,
            hideTags: true,
            onChange: (c) => {
                state.container = c.resultsContainer;
                state.ctx = c;
                this._clearContainer(c.resultsContainer);
                this._renderResults(dv, c.resultsContainer, c, state);
            },
        });

        // Match the wiki normalize: the shared strip ships a 2px top margin; give it
        // 12px so the create-buttons↔search spacing reads consistently.
        try {
            const strip = dv.container.querySelector('.doc-search-strip');
            if (strip && strip.style) strip.style.marginTop = '12px';
        } catch (_e) { /* cosmetic only */ }

        if (!ctx || !ctx.resultsContainer) return;
        state.container = ctx.resultsContainer;
        state.ctx = ctx;
        this._renderResults(dv, ctx.resultsContainer, ctx, state);
      } catch (_e) { /* never throw from a Dataview entry point */ }
    }

    /**
     * Render the queue into `container`: the glance pills, then either the three
     * browse bands (empty search) or the flat search-results list (active filter).
     * `ctx` is the DocSearch filterContext (or null when search is unavailable).
     */
    _renderResults(dv, container, ctx, state) {
        if (!container || typeof container.createEl !== 'function') return;
        if (state) {
            state.renderGeneration = (Number.isSafeInteger(state.renderGeneration) ? state.renderGeneration : 0) + 1;
            state.toggles = new Map();
        }
        const sel = ReaderQueue.selectArticles(dv, state && state.statuses);

        // 3. Glance pills — Unread N · Reading N · Archived N (any zero hidden).
        this._renderGlancePills(container, sel.counts);

        // 5. SEARCH mode — a flat, newest-first list of matching articles.
        if (ctx && ctx.hasActiveFilter) {
            const DocSearch = globalThis.customJS?.DocSearch;
            const all = sel.reading.concat(sel.unread, sel.archived).sort((a, b) => {
                const av = this._capturedStr(a);
                const bv = this._capturedStr(b);
                if (av < bv) return 1;
                if (av > bv) return -1;
                return 0;
            });
            const matches = all.filter(p => {
                try { return !DocSearch || typeof DocSearch.matches !== 'function' || DocSearch.matches(p, ctx); }
                catch (_e) { return true; }
            });
            this._sectionLabel(container, 'Results (' + matches.length + ')');
            if (!matches.length) {
                const empty = container.createEl('div');
                empty.style.cssText = 'padding: 16px; text-align: center; color: var(--text-faint); font-style: italic; border: 1px dashed var(--background-modifier-border); border-radius: 8px; margin-top: 8px;';
                empty.textContent = 'No matching articles.';
                return;
            }
            for (const p of matches) {
                try { this._renderArticleRow(dv, p, container, state); } catch (_e) { /* one bad row */ }
            }
            return;
        }

        // 4. BROWSE mode — three bands: Reading, Unread, Archived (in that order).
        this._renderBand(dv, container, 'Reading', sel.reading, null, state);
        this._renderBand(dv, container, 'Unread', sel.unread, 'No unread articles.', state);

        // Archived — a count caption + the most-recent handful (not the whole pile).
        if (sel.archived.length) {
            const shown = sel.archived.slice(0, 5);
            this._sectionLabel(container, 'Archived (' + sel.archived.length + ')');
            for (const p of shown) {
                try { this._renderArticleRow(dv, p, container, state); } catch (_e) { /* one bad row */ }
            }
            if (sel.archived.length > shown.length) {
                const more = container.createEl('div', { text: '+ ' + (sel.archived.length - shown.length) + ' more archived' });
                more.style.cssText = 'font-size: 0.8em; color: var(--text-faint); font-style: italic; padding: 4px 6px;';
            }
        }
    }

    /**
     * Glance pills line — Unread N · Reading N · Archived N (any zero hidden). Uses
     * inline-styled minimal spans (the daily/home `.sauce-section-*-pill` classes
     * are scoped to those blueprints' CSS, so they wouldn't apply here). Renders
     * nothing when all three counts are zero.
     */
    _renderGlancePills(container, counts) {
        const c = counts || { unread: 0, reading: 0, archived: 0 };
        if (!c.unread && !c.reading && !c.archived) return;
        const line = container.createEl('div', { cls: 'sauce-reader-glance' });
        line.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 2px 0 8px 0;';
        const pill = (label, n, bg, fg) => {
            if (!n) return;
            const el = line.createEl('span', { text: label + ' ' + n });
            el.style.cssText = 'font-size: 0.76em; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: ' + bg + '; color: ' + fg + ';';
        };
        pill('Unread', c.unread, 'var(--color-orange, #d2884e)', 'var(--text-on-accent, #fff)');
        pill('Reading', c.reading, 'var(--interactive-accent, #6a6abf)', 'var(--text-on-accent, #fff)');
        pill('Archived', c.archived, 'var(--background-modifier-border)', 'var(--text-muted)');
    }

    /**
     * Render one labeled browse band (a SectionLabel-ish caption + the rows). When
     * `articles` is empty and `emptyHint` is provided, show a subtle hint instead
     * of rows; when empty and no hint, render nothing (skips an empty Reading band).
     */
    _renderBand(dv, container, label, articles, emptyHint, state) {
        if ((!articles || !articles.length) && !emptyHint) return;
        this._sectionLabel(container, label);
        if (!articles || !articles.length) {
            const hint = container.createEl('div', { text: emptyHint });
            hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }
        for (const p of articles) {
            try { this._renderArticleRow(dv, p, container, state); } catch (_e) { /* one bad row */ }
        }
    }

    /**
     * Render one article row into `container`:
     *   - a title link that OPENS the note (app.workspace.openLinkText(path,'',false)
     *     — the SAME cold-cache-safe open pattern the to-do TaskTodayList row uses).
     *   - a source-meta subtitle: `site · author · ~N min` (missing parts omitted
     *     cleanly).
     *   - a small status-toggle control that cycles unread → reading → archived →
     *     unread, writing frontmatter via processFrontMatter (stopPropagation so it
     *     doesn't also open the note).
     * Never throws.
     */
    _renderArticleRow(dv, page, container, state) {
        if (!page || !container || typeof container.createEl !== 'function') return null;
        const path = (page.file && page.file.path) || null;
        const title = String((page.title != null && String(page.title).trim() !== '') ? page.title : (page.file && page.file.name) || '(untitled)');
        const pageStatus = String(page.status == null ? '' : page.status).trim().toLowerCase() || 'unread';
        let status = pageStatus;
        try {
            if (path && state && state.statuses.has(path)) status = state.statuses.get(path);
            else if (path && state) state.statuses.set(path, pageStatus);
        } catch (_e) { status = pageStatus; }

        const row = container.createEl('div', { cls: 'sauce-reader-row' });
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 5px 6px; border-radius: 4px; border: 1px solid transparent; width: 100%; box-sizing: border-box;';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-secondary)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });

        // Left column — title (opens the note) + source-meta subtitle.
        const main = row.createEl('div', { cls: 'sauce-reader-row-main' });
        main.style.cssText = 'display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 8em;';

        const titleEl = main.createEl('span', { cls: 'sauce-reader-row-title', text: title });
        titleEl.style.cssText = 'line-height: 1.4; overflow-wrap: break-word; word-break: break-word; color: var(--text-normal); cursor: pointer; font-weight: 500;';
        // Title click → OPEN THE ARTICLE NOTE. Resolve `app` from window/global (same
        // as the to-do row) and route through openLinkText(path, '', false). The
        // explicit '' sourcePath + false is the cold-cache-safe form that avoids the
        // doubled-path bug. Cold-load / no app → no-op (never throws).
        const openNote = () => {
            if (!path) return;
            try {
                const appRef = (typeof window !== 'undefined' && window.app)
                    || (typeof app !== 'undefined' && app)
                    || null;
                if (appRef && appRef.workspace && typeof appRef.workspace.openLinkText === 'function') {
                    appRef.workspace.openLinkText(path, '', false);
                }
            } catch (e) {
                try { new Notice('Could not open article: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            }
        };
        titleEl.addEventListener('click', openNote);

        // Source-meta subtitle: site · author · ~N min (omit missing parts cleanly).
        const metaText = this._metaText(page);
        if (metaText) {
            const meta = main.createEl('span', { cls: 'sauce-reader-row-meta', text: metaText });
            meta.style.cssText = 'font-size: 0.78em; color: var(--text-muted); overflow-wrap: break-word; word-break: break-word;';
        }

        // Right — status-toggle control. Cycles unread → reading → archived → unread.
        const cluster = row.createEl('div', { cls: 'sauce-reader-row-right' });
        cluster.style.cssText = 'display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: auto;';
        const toggle = cluster.createEl('button', { cls: 'sauce-reader-status-toggle', text: this._statusLabel(status) });
        try {
            toggle._readerStatusPath = path;
            if (path && state) state.toggles.set(path, toggle);
        } catch (_e) {}
        try { toggle.setAttribute('type', 'button'); toggle.setAttribute('aria-label', 'Cycle status (currently ' + this._statusLabel(status) + ')'); toggle.setAttribute('title', 'Cycle status: unread → reading → archived'); } catch (_e) {}
        this._styleStatusToggle(toggle, status);
        toggle.addEventListener('click', async (ev) => {
            try { ev.stopPropagation(); } catch (_e) {}
            const next = ReaderQueue.nextStatus(status);
            await this._queueStatusTransition(dv, state, path, status, next, toggle);
        });

        return row;
    }

    // ---------- Small pure/render helpers ----------

    /**
     * PURE status cycle: unread → reading → archived → unread. Any unrecognized /
     * blank input is treated as "unread" (→ reading). Node-testable.
     */
    static nextStatus(status) {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'unread') return 'reading';
        if (s === 'reading') return 'archived';
        if (s === 'archived') return 'unread';
        return 'reading';   // blank / unknown reads as unread → reading
    }

    nextStatus(status) { return ReaderQueue.nextStatus(status); }

    async _queueStatusTransition(dv, state, path, expected, next, focusTarget) {
        if (!state || !path) return false;
        // Every receipt owns the whole rendered results container, not just one
        // row. Serialize at the surface boundary so a late rollback for article A
        // cannot restore a pre-A container over article B's successful preview.
        const prior = state.structuralQueue || Promise.resolve(true);
        const run = prior.then(() => {
            if (String(state.statuses.get(path) || 'unread') !== String(expected || 'unread')) return false;
            return this._setStatus(dv, state, path, next, focusTarget);
        }, () => false);
        state.structuralQueue = run;
        try { return await run; }
        finally { if (state.structuralQueue === run) state.structuralQueue = null; }
    }

    /**
     * Move an article between queue bands before persistence through the shared
     * structural lifecycle. The receipt owns the exact prior child nodes, status
     * model, toggle map, and triggering focus so rejection restores identity and
     * position instead of rebuilding a lookalike from a stale Dataview page.
     */
    async _setStatus(dv, state, path, next, focusTarget) {
        if (!path || !state || !state.container) return false;
        try {
            const appRef = (typeof window !== 'undefined' && window.app)
                || (typeof app !== 'undefined' && app)
                || null;
            const file = (appRef && appRef.vault && typeof appRef.vault.getAbstractFileByPath === 'function')
                ? appRef.vault.getAbstractFileByPath(String(path))
                : null;
            if (!appRef || !file || !appRef.fileManager || typeof appRef.fileManager.processFrontMatter !== 'function') return false;
            const renderSafe = globalThis.customJS?.RenderSafe;
            if (!renderSafe || typeof renderSafe.mutateStructure !== 'function') {
                try { new Notice('Could not update status: RenderSafe is unavailable.', 6000); } catch (_e) {}
                return false;
            }
            const container = state.container;
            const result = await renderSafe.mutateStructure({
                app: appRef,
                dv,
                path: String(path),
                failureMessage: 'Could not update status',
                apply: async () => {
                    const receipt = {
                        container,
                        children: this._childNodes(container),
                        priorStatus: state.statuses.get(path),
                        toggles: state.toggles,
                        appliedRenderGeneration: null,
                        // A prior queued receipt may have replaced or restored the
                        // whole container since this gesture was clicked. Rebind
                        // at execution time so rollback focuses the currently live
                        // control rather than a detached click-time node.
                        focusTarget: this._liveFocusTarget(state, path, focusTarget),
                    };
                    try {
                        state.statuses.set(path, next);
                        this._clearContainer(container);
                        this._renderResults(dv, container, state.ctx, state);
                        receipt.appliedRenderGeneration = state.renderGeneration;
                        try { state.toggles.get(path)?.focus?.(); } catch (_e) {}
                        return receipt;
                    } catch (error) {
                        state.statuses.set(path, receipt.priorStatus);
                        state.toggles = receipt.toggles;
                        this._restoreChildren(container, receipt.children);
                        this._bumpRenderGeneration(state);
                        throw error;
                    }
                },
                rollback: async (receipt) => {
                    if (!receipt) return;
                    state.statuses.set(path, receipt.priorStatus);
                    if (this._receiptOwnsSurface(state, receipt)) {
                        state.toggles = receipt.toggles;
                        this._restoreChildren(receipt.container, receipt.children);
                        this._bumpRenderGeneration(state);
                    } else {
                        // DocSearch (or another surface owner) rendered after this
                        // receipt applied. Keep that newest mode/context authoritative
                        // and redraw it from the rolled-back status model instead of
                        // restoring stale whole-container children.
                        const liveContainer = state.container || receipt.container;
                        this._clearContainer(liveContainer);
                        this._renderResults(dv, liveContainer, state.ctx, state);
                    }
                    const liveFocusTarget = this._liveFocusTarget(state, path, receipt.focusTarget, true);
                    try {
                        if (liveFocusTarget === state.container && typeof state.container?.setAttribute === 'function') {
                            state.container.setAttribute('tabindex', '-1');
                        }
                    } catch (_e) {}
                    try { liveFocusTarget?.focus?.(); } catch (_e) {}
                },
                write: () => appRef.fileManager.processFrontMatter(file, (fm) => {
                    fm.status = next;
                    try { fm.status_changed_at = new Date().toISOString(); } catch (_e) {}
                }),
            });
            return !!(result && result.ok === true);
        } catch (e) {
            try { new Notice('Could not update status: ' + (e && (e.message || e)), 6000); } catch (_e) {}
            return false;
        }
    }

    _liveFocusTarget(state, path, clickTarget, preserveConnectedActive) {
        const container = state && state.container;
        const isLive = (node) => {
            if (!node || !container) return false;
            if (node === container) return true;
            try { if (typeof container.contains === 'function') return container.contains(node); } catch (_e) {}
            try {
                for (let cur = node; cur; cur = cur.parentNode) if (cur === container) return true;
            } catch (_e) {}
            return false;
        };
        // Persistence can settle after the user has moved into the permanent
        // DocSearch strip (or another live control). Preserve that newer focus;
        // only rebind when the active node was detached by a results rerender.
        try {
            const doc = typeof document !== 'undefined' ? document : null;
            const active = doc && doc.activeElement;
            const activeIsConnected = active && active !== doc.body
                && (typeof active.isConnected === 'boolean'
                    ? active.isConnected
                    : (typeof doc.contains === 'function' && doc.contains(active)));
            const owned = state.toggles && state.toggles.get(path);
            if (preserveConnectedActive && activeIsConnected && active !== owned) return active;
        } catch (_e) {}
        try {
            const owned = state.toggles && state.toggles.get(path);
            if (isLive(owned)) return owned;
        } catch (_e) {}
        if (isLive(clickTarget)) return clickTarget;
        try {
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            if (isLive(active)) return active;
        } catch (_e) {}
        try {
            for (const toggle of (state.toggles && state.toggles.values()) || []) if (isLive(toggle)) return toggle;
        } catch (_e) {}
        return container || null;
    }

    _receiptOwnsSurface(state, receipt) {
        return !!(state && receipt
            && state.container === receipt.container
            && Number.isSafeInteger(receipt.appliedRenderGeneration)
            && state.renderGeneration === receipt.appliedRenderGeneration);
    }

    _bumpRenderGeneration(state) {
        if (!state) return 0;
        state.renderGeneration = (Number.isSafeInteger(state.renderGeneration) ? state.renderGeneration : 0) + 1;
        return state.renderGeneration;
    }

    _childNodes(container) {
        try { return Array.from(container.childNodes || container.children || []); }
        catch (_e) { return []; }
    }

    _clearContainer(container) {
        if (!container) return;
        if (typeof container.removeChild === 'function') {
            while (container.firstChild) container.removeChild(container.firstChild);
            return;
        }
        if (typeof container.empty === 'function') container.empty();
        else if (Array.isArray(container.children)) container.children.splice(0);
    }

    _restoreChildren(container, children) {
        if (!container) return;
        this._clearContainer(container);
        for (const child of children || []) {
            try {
                if (typeof container.appendChild === 'function') container.appendChild(child);
                else if (Array.isArray(container.children)) container.children.push(child);
            } catch (_e) { /* restore the remaining exact nodes */ }
        }
    }

    /** Build the "site · author · ~N min" subtitle, omitting missing parts. */
    _metaText(page) {
        const parts = [];
        const site = page && page.site != null ? String(page.site).trim() : '';
        const author = page && page.author != null ? String(page.author).trim() : '';
        if (site) parts.push(site);
        if (author) parts.push(author);
        const mins = ReaderQueue._readingMinutes(page && page.word_count);
        if (mins != null) parts.push('~' + mins + ' min');
        return parts.join(' · ');
    }

    /**
     * PURE reading-minutes estimate: ~200 words/min, floored at 1. Returns null
     * (omit the "~N min" part) when word_count is absent / non-positive. Mirrors
     * ReaderArticleView._readingMinutes. Node-testable.
     */
    static _readingMinutes(words) {
        const n = Number(words);
        if (!Number.isFinite(n) || n <= 0) return null;
        return Math.max(1, Math.round(n / 200));
    }

    /** Friendly capitalized status label. */
    _statusLabel(status) {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'reading') return 'Reading';
        if (s === 'archived') return 'Archived';
        return 'Unread';
    }

    /** Style the status-toggle pill by status (color-coded, matches glance pills). */
    _styleStatusToggle(btn, status) {
        if (!btn || !btn.style) return;
        const s = String(status == null ? '' : status).trim().toLowerCase();
        let bg = 'var(--color-orange, #d2884e)';
        let fg = 'var(--text-on-accent, #fff)';
        if (s === 'reading') { bg = 'var(--interactive-accent, #6a6abf)'; fg = 'var(--text-on-accent, #fff)'; }
        else if (s === 'archived') { bg = 'var(--background-modifier-border)'; fg = 'var(--text-muted)'; }
        btn.style.cssText = 'font-size: 0.72em; font-weight: 600; padding: 2px 10px; border-radius: 999px; border: none; cursor: pointer; white-space: nowrap; background: ' + bg + '; color: ' + fg + ';';
    }

    /** captured_at as a comparable string (mirrors selectArticles' `cap`). */
    _capturedStr(p) {
        try {
            const v = p && p.captured_at;
            if (v == null) return '';
            if (typeof v === 'string') return v;
            if (typeof v.toISO === 'function') return v.toISO() || '';
            return String(v);
        } catch (_e) { return ''; }
    }

    /** SectionLabel via the shared mechanism, with a local caption fallback. */
    _sectionLabel(container, text) {
        try {
            const SL = window.customJS && window.customJS.SectionLabel;
            if (SL && typeof SL.render === 'function') {
                SL.render({ container: container }, { text: text });
                return;
            }
        } catch (_e) { /* fall through to local caption */ }
        const cap = container.createEl('div', { text: text });
        cap.style.cssText = 'font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 10px 0 6px 0; font-weight: 600;';
    }
}
