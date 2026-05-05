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
 *   title    — (page) => string (required)
 *   subtitle — (page) => string|null (optional)
 *   badges   — (page) => Array<{label, tone?}> (optional; tone: "accent"|"warn"|"error"|"muted")
 *   progress — (page) => {done, total}|null (optional; renders bar + count)
 *   target   — (page) => string (optional; default page.file.path; passed to openLinkText)
 *   sort     — (a, b) => number (optional; default mtime desc)
 *   group    — (page) => string|null (optional; cards grouped under heading)
 *   empty    — string (optional; empty-state copy; default "Nothing here yet.")
 *   columns  — number | "auto" (optional; default "auto" — auto-fit ~280px min)
 *   onClick  — (page, ev) => void (optional; overrides default openLinkText)
 */
class BeaconCards {
    async render(dv, opts) {
        opts = opts || {};
        const pages = opts.pages || [];
        const titleFn    = opts.title    || ((p) => p.file && p.file.name);
        const subtitleFn = opts.subtitle || (() => null);
        const badgesFn   = opts.badges   || (() => []);
        const progressFn = opts.progress || (() => null);
        const targetFn   = opts.target   || ((p) => p.file && p.file.path);
        const groupFn    = opts.group    || (() => null);
        const emptyMsg   = opts.empty    || "Nothing here yet.";
        const columns    = opts.columns  || "auto";
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
                this._renderCard(groupRoot, page, { titleFn, subtitleFn, badgesFn, progressFn, targetFn, onClick, isMobile });
            }
        }
    }

    _renderCard(parent, page, ctx) {
        const card = parent.createEl("div");
        card.style.cssText = "background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box; min-width: 0;";
        card.onmouseenter = () => { card.style.transform = "translateY(-2px)"; card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"; card.style.borderColor = "var(--interactive-accent)"; };
        card.onmouseleave = () => { card.style.transform = "none"; card.style.boxShadow = "none"; card.style.borderColor = "var(--background-modifier-border)"; };
        card.onclick = (ev) => {
            if (ctx.onClick) { ctx.onClick(page, ev); return; }
            const t = ctx.targetFn(page);
            if (t) app.workspace.openLinkText(t, "");
        };

        const titleEl = card.createEl("div");
        titleEl.style.cssText = `font-size: 1em; font-weight: 600; color: var(--text-normal); ${ctx.isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"}`;
        titleEl.textContent = ctx.titleFn(page) || "(untitled)";

        const sub = ctx.subtitleFn(page);
        if (sub) {
            const subEl = card.createEl("div");
            subEl.style.cssText = `font-size: 0.8em; color: var(--text-muted); ${ctx.isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"}`;
            subEl.textContent = sub;
        }

        const badges = ctx.badgesFn(page) || [];
        if (badges.length > 0) {
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
                chip.style.cssText = `display: inline-block; padding: 1px 8px; border-radius: 4px; font-size: 0.72em; font-weight: 500; background: ${p.bg}; color: ${p.text}; white-space: nowrap;`;
                chip.textContent = b.label;
            }
        }

        const prog = ctx.progressFn(page);
        if (prog && prog.total > 0) {
            const pct = Math.round((prog.done / prog.total) * 100);
            const wrap = card.createEl("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-top: 2px;";
            const bar = wrap.createEl("div");
            bar.style.cssText = "flex: 1; height: 3px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden; min-width: 0;";
            bar.createEl("div").style.cssText = `height: 100%; width: ${pct}%; background: var(--interactive-accent); border-radius: 2px;`;
            const count = wrap.createEl("span");
            count.style.cssText = "font-size: 0.75em; color: var(--text-muted); white-space: nowrap;";
            count.textContent = `${prog.done}/${prog.total} · ${pct}%`;
        }
    }
}
