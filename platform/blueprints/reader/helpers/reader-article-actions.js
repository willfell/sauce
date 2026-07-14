/**
 * ReaderArticleActions (CustomJS) — the reader-article leaf's action row. Second
 * class of the reader blueprint. Renders the navigation + status-control row at
 * the top of a `type: reader-article` note, as ONE centered horizontal row whose
 * buttons stretch to fill the width evenly (mirrors WikiLeafActions):
 *   [ Open article ↗ ] [ Mark reading ] [ Mark read ] [ Reader hub ]
 * The status buttons shown depend on the article's current status; a status write
 * routes through `_setStatus(path, next)` (processFrontMatter, this file only —
 * mirrors the to-do markDone write). An owned top+bottom hairline gives the row
 * breathing room so the template needs no literal `---`.
 *
 * Article creation is owned by the nav chrome-bar's "+ New article" button
 * (ReaderChromeBar → ReaderArticlePaste.open); this class no longer renders a
 * create-button row.
 *
 * COLD-LOAD SAFETY (landmines #1-2): guarded `dv.current()`; every other customJS
 * class reached via `window.customJS?.X`. The pure status-transition helpers
 * (_nextStatusForward / statusTransitions) never touch the DOM, so they're
 * Node-testable and can't be broken by a cold `app`.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader evals the whole
 * file as ONE expression; any trailer → the class never registers. To Node-test
 * the statics, load via `new Function(src + "\nreturn ReaderArticleActions;")()`.
 *
 * Static API (Node-testable, pure):
 *   ReaderArticleActions._nextStatusForward(status)  → next status string
 *   ReaderArticleActions.statusTransitions(status)   → [{ label, next }, …]
 *
 * Instance API (browser-side):
 *   ReaderArticleActions.render(dv)          ← the customjs-guard entry point
 */
class ReaderArticleActions {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _nextStatusForward(status) { return ReaderArticleActions._nextStatusForward(status); }
    statusTransitions(status) { return ReaderArticleActions.statusTransitions(status); }

    // ---------- Static pure helpers ----------

    /**
     * PURE "advance one step" transition: unread → reading → archived → unread.
     * Any unrecognized / blank input reads as "unread" (→ reading). Node-testable;
     * does NOT touch the DOM.
     */
    static _nextStatusForward(status) {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'unread') return 'reading';
        if (s === 'reading') return 'archived';
        if (s === 'archived') return 'unread';
        return 'reading';
    }

    /**
     * PURE — the list of status buttons to show for a given current status, as
     * `[{ label, next }, …]` (label = button text, next = the status to write):
     *   unread   → Mark reading (reading), Mark read (archived)
     *   reading  → Mark read (archived), Back to unread (unread)
     *   archived → Back to reading (reading), Mark unread (unread)
     * A blank / unknown status is treated as "unread". Node-testable; never touches
     * the DOM.
     */
    static statusTransitions(status) {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'reading') {
            return [
                { label: 'Mark read', next: 'archived' },
                { label: 'Back to unread', next: 'unread' },
            ];
        }
        if (s === 'archived') {
            return [
                { label: 'Back to reading', next: 'reading' },
                { label: 'Mark unread', next: 'unread' },
            ];
        }
        // unread (default)
        return [
            { label: 'Mark reading', next: 'reading' },
            { label: 'Mark read', next: 'archived' },
        ];
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Guards `reader-article`,
     * then draws the centered action row (Open article ↗ / status buttons / Reader
     * hub), owned top+bottom hairlines around it. Fully guarded — returns quietly
     * on cold-load. Never throws.
     */
    render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;
        try {
            if (dv.container.closest('.markdown-preview-view')?.querySelector('.reader-chrome-root')) return;
        } catch (_e) { /* best-effort guard */ }
        const cur = dv.current && dv.current();
        if (!cur || !cur.file || cur.type !== 'reader-article') return;

        const root = 'spice/reader';
        const filePath = cur.file.path;
        const status = String(cur.status == null ? '' : cur.status).trim().toLowerCase() || 'unread';

        const externalIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
        const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        const bookIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

        // Dual-fire guard: replace (not append) the row on Dataview re-render.
        const existing = dv.container.querySelector('.reader-article-actions');
        if (existing) existing.remove();

        const wrap = dv.container.createEl('div', { cls: 'reader-article-actions' });
        wrap.style.cssText = 'margin: 0;';
        const hr = wrap.createEl('hr');
        hr.style.cssText = 'border: none; border-top: 1px solid var(--background-modifier-border); margin: 12px 0;';
        // ONE centered, width-filling row (mirrors WikiLeafActions).
        const row = wrap.createEl('div');
        row.style.cssText = 'display: flex; gap: 10px; margin: 0 auto; justify-content: center; align-items: stretch; max-width: 640px; flex-wrap: wrap;';

        const AB = window.customJS && window.customJS.AccentButton;
        const addBtn = (label, icon, onClick) => {
            if (!AB || typeof AB.render !== 'function') return;
            this._styleLeafBtn(AB.render(row, { label: label, icon: icon, onClick: onClick }));
        };
        const open = (target) => {
            if (!target) return;
            try {
                const appRef = (typeof window !== 'undefined' && window.app) || (typeof app !== 'undefined' && app) || null;
                if (appRef && appRef.workspace && typeof appRef.workspace.openLinkText === 'function') {
                    appRef.workspace.openLinkText(target, '', false);
                }
            } catch (_e) { /* open best-effort */ }
        };

        // Open article ↗ — a real <a> ONLY when url is a non-empty string.
        const url = (cur.url != null) ? String(cur.url).trim() : '';
        if (url) {
            // AccentButton renders a <button>; for a real external link we build an
            // <a href target=_blank> styled to MATCH the leaf buttons so it reads as
            // one row. rel=noopener for safety.
            const link = row.createEl('a', { text: '', href: url, attr: { target: '_blank', rel: 'noopener' } });
            link.innerHTML = externalIcon + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">Open article ↗</span>';
            link.style.cssText = 'cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.9em; font-weight: 500; text-decoration: none; flex: 1 1 0; min-width: 0; overflow: hidden; white-space: nowrap;';
            link.addEventListener('mouseenter', () => { link.style.background = 'var(--interactive-accent)'; link.style.color = 'var(--text-on-accent)'; });
            link.addEventListener('mouseleave', () => { link.style.background = 'var(--background-primary)'; link.style.color = 'var(--interactive-accent)'; });
            this._mobilize(link);
        }

        // Status-aware buttons (pure transition list → buttons). Each writes status.
        const transitions = ReaderArticleActions.statusTransitions(status);
        for (const t of transitions) {
            const icon = (t.next === 'reading') ? bookIcon : (t.next === 'archived') ? checkIcon : bookIcon;
            addBtn(t.label, icon, () => { this._setStatus(filePath, t.next); });
        }

        // Reader hub — openLink to spice/reader/Reader.md (mirrors WikiLeafActions
        // "Wiki (home)").
        addBtn('Reader hub', homeIcon, () => open(root + '/Reader.md'));

        const hrBottom = wrap.createEl('hr');
        hrBottom.style.cssText = 'border: none; border-top: 1px solid var(--background-modifier-border); margin: 12px 0;';
    }

    /**
     * async _setStatus(path, next) — write the article's status frontmatter (this
     * file only) via processFrontMatter (mirrors the to-do markDone write). Resolve
     * the TFile from `path` (getAbstractFileByPath), then
     * app.fileManager.processFrontMatter(file, fm => { fm.status = next; }). Rely on
     * Obsidian reactivity to re-render the page/queue. Best-effort — cold-load /
     * missing file / missing app just no-ops. Never throws.
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
            try { new Notice('Status: ' + next); } catch (_e) {}
        } catch (e) {
            try { new Notice('Could not update status: ' + (e && (e.message || e)), 6000); } catch (_e) {}
        }
    }

    // Each button stretches to an equal share of the centered row (flex: 1) with a
    // readable label + tap target (mirrors WikiLeafActions._styleLeafBtn).
    _styleLeafBtn(btn) {
        if (!btn || !btn.style) return btn;
        btn.style.flex = '1 1 0';
        btn.style.minWidth = '0';
        btn.style.fontSize = '0.9em';
        btn.style.padding = '8px 14px';
        btn.style.overflow = 'hidden';
        btn.style.whiteSpace = 'nowrap';
        this._mobilize(btn);
        return btn;
    }

    // Mobile-legible sizing — a phone wraps the buttons 2-up rather than shrinking
    // every label to an ellipsis (mirrors WikiHubActions._mobilize; instance form
    // so both the <a> and the AccentButton <button> can share it).
    _mobilize(btn) {
        if (!btn || !btn.style) return btn;
        btn.style.flex = '1 1 calc(50% - 6px)';
        btn.style.minWidth = '128px';
        return btn;
    }
}
