/**
 * ReaderArticleView (CustomJS) — the clean, native-Obsidian card a reader-article
 * note renders in its own body. Third class of the reader blueprint (after
 * ReaderQueue + ReaderArticleActions). Mirrors the to-do TaskNoteView card:
 *
 *   - a HEADER block: the article title (left) + a color-coded status pill (right;
 *     unread orange / reading accent / archived muted),
 *   - a "DETAILS" section: a labelled row PER SET FIELD only —
 *       Author / Site / Published (humanized) / "~N min read" (from word_count) —
 *     each row OMITTED when its field is empty,
 *   - an "AI TL;DR" callout (a prominent blockquote-ish block) when `summary` is
 *     non-empty.
 *   If EVERY detail field AND the summary are empty, the card renders NOTHING (no
 *   bare "undefined").
 *
 * The user's clipped highlights + article content render natively BELOW this
 * widget (below the READER_HIGHLIGHTS / READER_CONTENT markers).
 *
 * Invoked via customjs-guard on the article note's body, so its entry method is
 * the instance `render(dv)`.
 *
 * COLD-LOAD SAFETY (landmines #1-2): guarded `dv.current()`; read frontmatter
 * defensively (one bad/absent field must not throw). Never throws out of render.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader evals the whole
 * file as ONE expression; any trailer → the class never registers. To Node-test
 * the statics, load via `new Function(src + "\nreturn ReaderArticleView;")()`.
 *
 * Static API (Node-testable, pure):
 *   ReaderArticleView._humanDate(iso)       → { text, weekday? } (pure date math)
 *   ReaderArticleView._readingMinutes(words)→ number | null
 *
 * Instance API (browser-side):
 *   ReaderArticleView.render(dv)   ← the customjs-guard entry point
 */
class ReaderArticleView {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    _humanDate(iso) { return ReaderArticleView._humanDate(iso); }
    _readingMinutes(words) { return ReaderArticleView._readingMinutes(words); }

    // ---------- Static pure helpers (pure date math — NO new Date) ----------

    /**
     * Parse a `YYYY-MM-DD` (or ISO / Luxon-ish) value into { y, mo, d } integers,
     * or null when it isn't a recognizable date. PURE — never touches new Date /
     * Date.now. Accepts a leading date within a longer ISO timestamp. (Copied from
     * TaskNoteView._ymd — the same pure day-math contract.)
     */
    static _ymd(value) {
        if (value == null) return null;
        let s = '';
        if (typeof value === 'string') s = value.trim();
        else if (typeof value.toISODate === 'function') { s = value.toISODate() || ''; }
        else if (typeof value.toFormat === 'function') { s = value.toFormat('yyyy-MM-dd'); }
        else if (typeof value.format === 'function') { s = value.format('YYYY-MM-DD'); }
        else s = String(value);
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
        if (!m) return null;
        return { y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10) };
    }

    /**
     * Convert a { y, mo, d } (1-based month) to an absolute DAY NUMBER via Howard
     * Hinnant's days_from_civil (deterministic, leap-year correct, NEVER new Date).
     * Used only for the weekday. (Copied from TaskNoteView._dayNumber.)
     */
    static _dayNumber(ymd) {
        if (!ymd) return null;
        let y = ymd.y;
        const m = ymd.mo;
        const d = ymd.d;
        y -= m <= 2 ? 1 : 0;
        const era = Math.floor((y >= 0 ? y : y - 399) / 400);
        const yoe = y - era * 400;
        const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
        const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
        return era * 146097 + doe - 719468; // days since 1970-01-01 (0 == Thursday)
    }

    /**
     * Format a date-ish value into a human string, PURELY (no wall clock). `value`
     * may be a `YYYY-MM-DD` string, a longer ISO timestamp, or a Luxon/moment-like
     * object. Returns { text: "Thu, Jul 2, 2026", weekday: "Thu" } (the weekday is
     * folded into text). Unparseable / blank value → { text: '' }. Mirrors the
     * to-do TaskNoteView._humanDate day-math (relative-hint arm dropped — a reader
     * article's Published date needs no "in N days" hint).
     */
    static _humanDate(value) {
        const WD = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']; // dayNumber 0 == Thursday
        const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        try {
            const ymd = ReaderArticleView._ymd(value);
            if (!ymd) return { text: '' };
            const dn = ReaderArticleView._dayNumber(ymd);
            let weekday = '';
            let text = '';
            if (dn != null) {
                weekday = WD[((dn % 7) + 7) % 7];
                const mon = (ymd.mo >= 1 && ymd.mo <= 12) ? MO[ymd.mo - 1] : String(ymd.mo);
                text = weekday + ', ' + mon + ' ' + ymd.d + ', ' + ymd.y;
            }
            return { text: text, weekday: weekday };
        } catch (_e) {
            return { text: '' };
        }
    }

    /**
     * PURE reading-minutes estimate: ~200 words/min, floored at 1. Returns null
     * (omit the "~N min read" row) when word_count is absent / non-positive.
     * Node-testable. `Math.max(1, Math.round((Number(words)||0)/200))` but with the
     * null short-circuit for no word_count.
     */
    static _readingMinutes(words) {
        const n = Number(words);
        if (!Number.isFinite(n) || n <= 0) return null;
        return Math.max(1, Math.round(n / 200));
    }

    // ---------- Instance / browser render ----------

    /**
     * Entry point invoked by customjs-guard: `render(dv)`. Reads the article
     * frontmatter and draws a sectioned card (or NOTHING when every detail field +
     * summary are empty). Fully guarded — returns quietly on cold-load, each field
     * read defensively. Never throws.
     */
    async render(dv) {
        try {
            if (!dv || !dv.container) return;
            if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

            const page = (window.customJS && window.customJS.RenderSafe)
                ? window.customJS.RenderSafe.page(dv)
                : (dv.current && dv.current());
            if (!page || !page.file) return;
            if (page.type !== 'reader-article') return;

            const c = dv.container;
            if (!c || typeof c.createEl !== 'function') return;

            const str = (v) => (v == null ? '' : String(v).trim());
            const title = str(page.title) || (page.file && page.file.name) || '(untitled)';
            const status = str(page.status).toLowerCase() || 'unread';
            const author = str(page.author);
            const site = str(page.site);
            const published = str(page.published);
            const summary = str(page.summary);
            const mins = ReaderArticleView._readingMinutes(page.word_count);

            const publishedHuman = published ? ReaderArticleView._humanDate(published) : { text: '' };
            const hasPublished = !!publishedHuman.text || !!published;
            const anyDetail = !!author || !!site || hasPublished || (mins != null);

            // If EVERY detail field AND summary are empty → render nothing.
            if (!anyDetail && !summary) return;

            // ----- Card container (mirrors TaskNoteView) -----
            const card = c.createEl('div', { cls: 'sauce-reader-article-view' });
            card.style.cssText = [
                'display:flex', 'flex-direction:column', 'gap:14px',
                'margin:4px 0 10px', 'width:100%', 'box-sizing:border-box',
                'padding:16px', 'border:1px solid var(--background-modifier-border)',
                'border-radius:var(--radius-m, 8px)',
                'background:var(--background-secondary)',
            ].join(';') + ';';

            // ----- Header: title LEFT, status pill RIGHT -----
            const header = card.createEl('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:flex-start; gap:12px;';

            const titleEl = header.createEl('div', { text: title });
            titleEl.style.cssText = 'flex:1 1 auto; min-width:0; font-size:1.3em; font-weight:700; line-height:1.25; color:var(--text-normal); overflow-wrap:break-word; word-break:break-word; text-align:left;';

            const pill = header.createEl('span', { text: this._statusLabel(status).toUpperCase() });
            const pillBase = 'flex-shrink:0; font-size:0.68em; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; padding:3px 10px; border-radius:999px; box-sizing:border-box; white-space:nowrap;';
            if (status === 'archived') {
                pill.style.cssText = pillBase + 'background:var(--background-modifier-border); color:var(--text-muted);';
            } else if (status === 'reading') {
                pill.style.cssText = pillBase + 'background:var(--interactive-accent, #6a6abf); color:var(--text-on-accent, #fff);';
            } else {
                pill.style.cssText = pillBase + 'background:var(--color-orange, #d2884e); color:var(--text-on-accent, #fff);';
            }

            const drawDivider = () => {
                const hr = card.createEl('div');
                hr.style.cssText = 'height:1px; background:var(--background-modifier-border); width:100%;';
            };

            // ----- DETAILS section (set fields only) -----
            if (anyDetail) {
                drawDivider();
                const sectionLabel = card.createEl('div', { text: 'DETAILS' });
                sectionLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';

                const grid = card.createEl('div');
                grid.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

                const addRow = (label, buildValue) => {
                    try {
                        const row = grid.createEl('div');
                        row.style.cssText = 'display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px;';
                        const lab = row.createEl('span', { text: label });
                        lab.style.cssText = 'flex:0 0 84px; min-width:84px; font-size:0.72em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);';
                        const valWrap = row.createEl('span');
                        valWrap.style.cssText = 'flex:1 1 auto; min-width:0; font-size:0.95em; color:var(--text-normal); overflow-wrap:break-word; word-break:break-word;';
                        buildValue(valWrap);
                    } catch (_e) { /* one bad row must not break the card */ }
                };

                if (author) addRow('Author', (wrap) => { wrap.createEl('span', { text: author }); });
                if (site) addRow('Site', (wrap) => { wrap.createEl('span', { text: site }); });
                if (hasPublished) {
                    addRow('Published', (wrap) => {
                        wrap.createEl('span', { text: publishedHuman.text || published });
                    });
                }
                if (mins != null) {
                    addRow('Length', (wrap) => {
                        wrap.createEl('span', { text: '~' + mins + ' min read' });
                    });
                }
            }

            // ----- AI TL;DR callout (prominent) when summary is non-empty -----
            if (summary) {
                drawDivider();
                const summaryLabel = card.createEl('div', { text: 'AI TL;DR' });
                summaryLabel.style.cssText = 'font-size:0.68em; font-weight:600; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted);';
                const callout = card.createEl('div', { text: summary });
                // Blockquote-ish prominent block: accent left border + tinted bg.
                callout.style.cssText = 'font-size:0.98em; line-height:1.5; color:var(--text-normal); padding:10px 14px; border-left:3px solid var(--interactive-accent, #6a6abf); border-radius:var(--radius-s, 4px); background:var(--background-primary-alt, var(--background-primary)); overflow-wrap:break-word; word-break:break-word;';
            }
        } catch (_e) {
            // Never throw out of render (cold-load safety).
        }
    }

    /** Map a raw status to a friendly pill label. */
    _statusLabel(status) {
        const s = String(status == null ? '' : status).trim().toLowerCase();
        if (s === 'reading') return 'Reading';
        if (s === 'archived') return 'Archived';
        return 'Unread';
    }
}
