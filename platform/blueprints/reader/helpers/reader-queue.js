/**
 * ReaderQueue (CustomJS) — the reader-hub's status-grouped reading queue. First
 * class of the reader blueprint (a flat reading queue: spice/reader/Reader.md is
 * the reader-hub; reader-article notes are FLAT leaves in spice/reader/, never
 * nested; status — unread / reading / archived — lives in frontmatter, never a
 * folder).
 *
 * Renders on a `type: reader-hub` note (invoked via customjs-guard, so its entry
 * method is the instance `render(dv)`). In ONE container it draws, top to bottom:
 *   1. a best-effort "＋ New article" entity-create button row (delegates to
 *      ReaderArticleActions.renderCreateRow → EntityCreate; if that class is cold
 *      the search + queue below still render).
 *   2. a DocSearch strip (scoped to spice/reader, non-recursive, entityType
 *      reader-article, persist:false) whose onChange re-renders the results.
 *   3. glance pills (Unread N · Reading N · Archived N — any zero hidden).
 *   4. BROWSE mode (empty search): three bands — Reading, Unread, Archived (the
 *      Archived band shows a count caption + the most-recent handful).
 *   5. SEARCH mode (active filter): a flat newest-first results list.
 * Each article renders via the shared `_renderArticleRow` — a title link that
 * OPENS the note (same openLinkText pattern the to-do TaskTodayList row uses) +
 * a source-meta subtitle + a status-cycle control (unread→reading→archived→unread)
 * that writes frontmatter via processFrontMatter (stopPropagation so it doesn't
 * also open the note).
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
    static selectArticles(dv) {
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
                const status = String(p.status == null ? '' : p.status).trim().toLowerCase();
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
        if (!dv || !dv.container) return;
        // Skip rendering inside embeds — the host note renders its own queue.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const cur = dv.current && dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== 'reader-hub') return;

        // DocSearch strip — scoped to spice/reader, NON-recursive (flat leaves),
        // entityType reader-article, persist:false (search always starts empty).
        // onChange clears ONLY the results container + re-renders the queue.
        const DocSearch = window.customJS && window.customJS.DocSearch;
        if (!DocSearch || typeof DocSearch.render !== 'function') {
            // No search mechanism → render the browse view directly into the
            // container so the queue still shows (cold-load / missing dep).
            this._renderResults(dv, dv.container, null);
            return;
        }

        const ctx = DocSearch.render(dv, {
            scopePath: 'spice/reader',
            recursive: false,
            entityType: 'reader-article',
            persist: false,
            hideTags: true,
            onChange: (c) => {
                c.resultsContainer.empty();
                this._renderResults(dv, c.resultsContainer, c);
            },
        });

        // Match the wiki normalize: the shared strip ships a 2px top margin; give it
        // 12px so the create-buttons↔search spacing reads consistently.
        try {
            const strip = dv.container.querySelector('.doc-search-strip');
            if (strip && strip.style) strip.style.marginTop = '12px';
        } catch (_e) { /* cosmetic only */ }

        this._renderResults(dv, ctx.resultsContainer, ctx);
    }

    /**
     * Render the queue into `container`: the glance pills, then either the three
     * browse bands (empty search) or the flat search-results list (active filter).
     * `ctx` is the DocSearch filterContext (or null when search is unavailable).
     */
    _renderResults(dv, container, ctx) {
        if (!container || typeof container.createEl !== 'function') return;
        const sel = ReaderQueue.selectArticles(dv);

        // 3. Glance pills — Unread N · Reading N · Archived N (any zero hidden).
        this._renderGlancePills(container, sel.counts);

        // 5. SEARCH mode — a flat, newest-first list of matching articles.
        if (ctx && ctx.hasActiveFilter) {
            const DocSearch = window.customJS && window.customJS.DocSearch;
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
                try { this._renderArticleRow(dv, p, container); } catch (_e) { /* one bad row */ }
            }
            return;
        }

        // 4. BROWSE mode — three bands: Reading, Unread, Archived (in that order).
        this._renderBand(dv, container, 'Reading', sel.reading, null);
        this._renderBand(dv, container, 'Unread', sel.unread, 'No unread articles.');

        // Archived — a count caption + the most-recent handful (not the whole pile).
        if (sel.archived.length) {
            const shown = sel.archived.slice(0, 5);
            this._sectionLabel(container, 'Archived (' + sel.archived.length + ')');
            for (const p of shown) {
                try { this._renderArticleRow(dv, p, container); } catch (_e) { /* one bad row */ }
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
    _renderBand(dv, container, label, articles, emptyHint) {
        if ((!articles || !articles.length) && !emptyHint) return;
        this._sectionLabel(container, label);
        if (!articles || !articles.length) {
            const hint = container.createEl('div', { text: emptyHint });
            hint.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }
        for (const p of articles) {
            try { this._renderArticleRow(dv, p, container); } catch (_e) { /* one bad row */ }
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
    _renderArticleRow(dv, page, container) {
        if (!page || !container || typeof container.createEl !== 'function') return null;
        const path = (page.file && page.file.path) || null;
        const title = String((page.title != null && String(page.title).trim() !== '') ? page.title : (page.file && page.file.name) || '(untitled)');
        const status = String(page.status == null ? '' : page.status).trim().toLowerCase() || 'unread';

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
        try { toggle.setAttribute('type', 'button'); toggle.setAttribute('aria-label', 'Cycle status (currently ' + this._statusLabel(status) + ')'); toggle.setAttribute('title', 'Cycle status: unread → reading → archived'); } catch (_e) {}
        this._styleStatusToggle(toggle, status);
        toggle.addEventListener('click', async (ev) => {
            try { ev.stopPropagation(); } catch (_e) {}
            const next = ReaderQueue.nextStatus(status);
            await this._setStatus(path, next);
            // Optimistic label/style swap — the eventual Dataview re-render reconciles.
            try { toggle.textContent = this._statusLabel(next); this._styleStatusToggle(toggle, next); } catch (_e) {}
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

    /**
     * Write the article's status frontmatter (this file only) via
     * processFrontMatter — mirrors the to-do TaskDialog status-write. Resolves the
     * TFile from `path` (getAbstractFileByPath), then
     * app.fileManager.processFrontMatter(file, fm => { fm.status = next; }). Relies
     * on Obsidian reactivity to re-render the queue (like the task helpers).
     * Best-effort — a cold-load / missing file / missing app just no-ops. Never
     * throws.
     */
    async _setStatus(path, next) {
        if (!path) return;
        try {
            const appRef = (typeof window !== 'undefined' && window.app)
                || (typeof app !== 'undefined' && app)
                || null;
            const file = (appRef && appRef.vault && typeof appRef.vault.getAbstractFileByPath === 'function')
                ? appRef.vault.getAbstractFileByPath(String(path))
                : null;
            if (!appRef || !file || !appRef.fileManager || typeof appRef.fileManager.processFrontMatter !== 'function') return;
            await appRef.fileManager.processFrontMatter(file, (fm) => { fm.status = next; });
        } catch (e) {
            try { new Notice('Could not update status: ' + (e && (e.message || e)), 6000); } catch (_e) {}
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
