/**
 * BeaconCards (CustomJS)
 * Shared mobile-aware card renderer. Decoupled from Dataview semantics;
 * caller supplies the pages array.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "BeaconCards", args: {...} });
 * OR (recommended — call .render directly from a wrapper class):
 *   await customJS.BeaconCards.render(dv, { pages, title: p => p.file.name, ... });
 *
 * Options:
 *   pages    — Array of Dataview pages OR hand-rolled objects (required)
 *   title    — (page) => string (required; plain text)
 *   subtitle — (page) => string|null|{text:string, secondaryText?:string} (optional)
 *              v0.2.0: object form renders a second muted-italic line below.
 *              Plain string + null retain prior behavior (backward-compatible).
 *   icon     — (page) => string (optional; inline SVG HTML rendered left of title)
 *   meta     — (page) => string (optional; HTML rendered right of title row when layout="row")
 *   badges   — (page) => Array<{label, tone?, icon?}> (optional; tone: "accent"|"warn"|"error"|"muted")
 *              v0.2.0: optional icon (inline SVG HTML) prepended inside chip.
 *   progress — (page) => {done, total}|null (optional; renders bar + count)
 *   target   — (page) => string (optional; default page.file.path; passed to openLinkText)
 *   sort     — (a, b) => number (optional; default mtime desc)
 *   group    — (page) => string|null (optional; cards grouped under heading)
 *   empty    — string (optional; empty-state copy; default "Nothing here yet.")
 *   columns  — number | "auto" (optional; default "auto" — auto-fit ~280px min; 1 = single column)
 *   layout   — "stacked" | "row" (optional; default "stacked"; "row" = title+meta on one row; columns defaults to 1)
 *   onClick  — (page, ev) => void (optional; overrides default openLinkText)
 *
 * Synthetic-page pattern (codified v0.2.0):
 *   pages may be hand-rolled objects rather than Dataview pages. Minimum
 *   shape is {file: {name, path}} for default target resolution. Custom
 *   onClick supports line-anchored or non-file destinations.
 *   Example: SpaceDailyDashboard tasks panel passes
 *   [{file: {name, path}, line, text, _isTask: true}, ...] with onClick
 *   that calls app.workspace.openLinkText(parentPath, "").
 */
class BeaconCards {
    async render(dv, opts) {
        opts = opts || {};
        const pages = opts.pages || [];
        const titleFn    = opts.title    || ((p) => p.file && p.file.name);
        const subtitleFn = opts.subtitle || (() => null);
        const iconFn     = opts.icon     || (() => "");
        const metaFn     = opts.meta     || (() => "");
        const badgesFn   = opts.badges   || (() => []);
        const progressFn = opts.progress || (() => null);
        const targetFn   = opts.target   || ((p) => p.file && p.file.path);
        const groupFn    = opts.group    || (() => null);
        const emptyMsg   = opts.empty    || "Nothing here yet.";
        const layout     = opts.layout   || "stacked";
        const columns    = opts.columns  || (layout === "row" ? 1 : "auto");
        const onClick    = opts.onClick  || null;

        const sortFn = opts.sort || ((a, b) => {
            const am = (a.file && a.file.mtime && a.file.mtime.ts) || 0;
            const bm = (b.file && b.file.mtime && b.file.mtime.ts) || 0;
            return bm - am;
        });

        const isMobile = !!app.isMobile;

        const sorted = [...pages].sort(sortFn);

        if (sorted.length === 0) {
            const empty = dv.container.createEl("div");
            empty.style.cssText = "padding: 16px; text-align: center; color: var(--text-faint); font-style: italic; border: 1px dashed var(--background-modifier-border); border-radius: 8px; margin-top: 8px;";
            empty.textContent = emptyMsg;
            return;
        }

        const grouped = {};
        const groupOrder = [];
        for (const page of sorted) {
            const gk = groupFn(page);
            const key = gk || "__ungrouped__";
            if (!grouped[key]) { grouped[key] = []; groupOrder.push(key); }
            grouped[key].push(page);
        }

        const root = dv.container.createEl("div");
        root.style.cssText = "display: flex; flex-direction: column; gap: 16px; margin-top: 16px;";

        for (const gk of groupOrder) {
            if (gk !== "__ungrouped__") {
                const heading = root.createEl("div");
                heading.style.cssText = "font-size: 0.85em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-top: 4px;";
                heading.textContent = gk;
            }
            const groupRoot = root.createEl("div");
            const gridStyle = isMobile || columns === 1
                ? "display: flex; flex-direction: column; gap: 10px;"
                : (columns === "auto"
                    ? "display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px;"
                    : `display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 10px;`);
            groupRoot.style.cssText = gridStyle;

            for (const page of grouped[gk]) {
                this._renderCard(groupRoot, page, { titleFn, subtitleFn, iconFn, metaFn, badgesFn, progressFn, targetFn, onClick, isMobile, layout });
            }
        }
    }

    _renderCard(parent, page, ctx) {
        const card = parent.createEl("div");
        const restingShadow = "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)";
        card.style.cssText = `background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 14px 16px; cursor: pointer; transition: all 0.18s ease; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; min-width: 0; min-height: 56px; box-shadow: ${restingShadow}; justify-content: center;`;
        card.onmouseenter = () => { card.style.transform = "translateY(-2px)"; card.style.boxShadow = "0 6px 16px rgba(0,0,0,0.18)"; card.style.borderColor = "var(--interactive-accent)"; card.style.background = "var(--background-secondary-alt, var(--background-secondary))"; };
        card.onmouseleave = () => { card.style.transform = "none"; card.style.boxShadow = restingShadow; card.style.borderColor = "var(--background-modifier-border)"; card.style.background = "var(--background-secondary)"; };
        card.onclick = (ev) => {
            if (ctx.onClick) { ctx.onClick(page, ev); return; }
            const t = ctx.targetFn(page);
            if (t) app.workspace.openLinkText(t, "");
        };

        if (ctx.layout === "row") {
            this._renderRowCard(card, page, ctx);
        } else {
            this._renderStackedCard(card, page, ctx);
        }
    }

    _renderStackedCard(card, page, ctx) {
        const iconHtml = ctx.iconFn(page) || "";
        const titleEl = card.createEl("div");
        titleEl.style.cssText = `font-size: 1em; font-weight: 600; color: var(--text-normal); display: flex; align-items: center; gap: 8px; ${ctx.isMobile ? "" : "min-width: 0;"}`;
        const titleText = ctx.titleFn(page) || "(untitled)";
        const titleSpan = `<span style="${ctx.isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"}">${this._escape(titleText)}</span>`;
        titleEl.innerHTML = `${iconHtml}${titleSpan}`;

        this._renderSubtitle(card, page, ctx, { indent: "" });

        this._renderBadges(card, page, ctx);
        this._renderProgress(card, page, ctx);
    }

    _renderRowCard(card, page, ctx) {
        const isMobile = ctx.isMobile;
        const row = card.createEl("div");
        row.style.cssText = `display: flex; flex-direction: ${isMobile ? "column" : "row"}; align-items: ${isMobile ? "flex-start" : "center"}; gap: ${isMobile ? "6px" : "16px"};`;

        const left = row.createEl("div");
        left.style.cssText = `flex: 1; min-width: 0; ${isMobile ? "width: 100%;" : ""}`;

        const iconHtml = ctx.iconFn(page) || "";
        const titleText = ctx.titleFn(page) || "(untitled)";
        const titleEl = left.createEl("div");
        titleEl.style.cssText = "font-size: 1em; font-weight: 600; color: var(--text-normal); display: flex; align-items: center; gap: 8px;";
        const titleSpan = `<span style="overflow: hidden; text-overflow: ellipsis; ${isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap;"}">${this._escape(titleText)}</span>`;
        titleEl.innerHTML = `${iconHtml}${titleSpan}`;

        const indentCss = iconHtml ? "padding-left: 24px;" : "";
        this._renderSubtitle(left, page, ctx, { indent: indentCss });

        const metaHtml = ctx.metaFn(page) || "";
        if (metaHtml) {
            const meta = row.createEl("div");
            meta.style.cssText = `display: flex; gap: ${isMobile ? "12px" : "16px"}; font-size: 0.8em; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; ${isMobile && iconHtml ? "padding-left: 24px;" : ""}`;
            meta.innerHTML = metaHtml;
        }

        this._renderBadges(card, page, ctx);
        this._renderProgress(card, page, ctx);
    }

    _renderSubtitle(parent, page, ctx, opts) {
        opts = opts || {};
        const indent = opts.indent || "";
        const sub = ctx.subtitleFn(page);
        if (sub === null || sub === undefined || sub === "") return;
        let primaryText, secondaryText;
        if (typeof sub === "string") {
            primaryText = sub;
            secondaryText = null;
        } else if (typeof sub === "object" && sub !== null) {
            primaryText = sub.text || "";
            secondaryText = sub.secondaryText || null;
        } else {
            return;
        }
        if (!primaryText && !secondaryText) return;
        if (primaryText) {
            const subEl = parent.createEl("div");
            subEl.style.cssText = `font-size: 0.8em; color: var(--text-muted); margin-top: 2px; ${indent} ${ctx.isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"}`;
            subEl.textContent = primaryText;
        }
        if (secondaryText) {
            const sub2El = parent.createEl("div");
            sub2El.style.cssText = `font-size: 0.78em; font-style: italic; color: var(--text-faint); margin-top: 1px; ${indent} ${ctx.isMobile ? "white-space: normal; word-break: break-word;" : "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"}`;
            sub2El.textContent = secondaryText;
        }
    }

    _renderBadges(card, page, ctx) {
        const badges = ctx.badgesFn(page) || [];
        if (badges.length === 0) return;
        const badgeRow = card.createEl("div");
        badgeRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px;";
        for (const b of badges) {
            const tone = b.tone || "muted";
            const palette = {
                accent: { bg: "var(--interactive-accent)", text: "var(--text-on-accent)" },
                warn:   { bg: "#f59e0b", text: "#fff" },
                error:  { bg: "#dc2626", text: "#fff" },
                muted:  { bg: "var(--background-modifier-border)", text: "var(--text-muted)" }
            };
            const p = palette[tone] || palette.muted;
            const chip = badgeRow.createEl("span");
            const hasIcon = !!b.icon;
            chip.style.cssText = `display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 4px; font-size: 0.72em; font-weight: 500; background: ${p.bg}; color: ${p.text}; white-space: nowrap;`;
            if (hasIcon) {
                const iconSpan = chip.createEl("span");
                iconSpan.style.cssText = "display: inline-flex; align-items: center; line-height: 0;";
                iconSpan.innerHTML = b.icon;
                const labelSpan = chip.createEl("span");
                labelSpan.textContent = b.label;
            } else {
                chip.textContent = b.label;
            }
        }
    }

    _renderProgress(card, page, ctx) {
        const prog = ctx.progressFn(page);
        if (!prog || prog.total <= 0) return;
        const pct = Math.round((prog.done / prog.total) * 100);
        const bar = card.createEl("div");
        bar.style.cssText = "height: 3px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden; margin-top: 2px;";
        bar.createEl("div").style.cssText = `height: 100%; width: ${pct}%; background: var(--interactive-accent); border-radius: 2px;`;
    }

    _escape(s) {
        return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    }
}
