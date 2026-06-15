/**
 * BudgetSummary — Read-only three-band rollup at the top of every Budget note.
 *
 * v0.5.3 CF-3 polish pass:
 *   • "Variance" → "Difference" (more human; the value's sign + color already
 *     conveys over/under direction).
 *   • Per-group cards: title-case (Essential, not ESSENTIAL); subtle
 *     pill-style background tint at low opacity instead of just a top border.
 *   • Hardcoded color hex so red/green show regardless of Obsidian theme.
 *   • Tighter typography hierarchy; less SHOUTY uppercase labels.
 *
 * Band 1 — Planned / Actual / Difference ($ and %).
 * Band 2 — Day X of N month-elapsed bar + spent% bar + pace pill.
 * Band 3 — Per-group pill-cards (one per page.groups[] entry).
 *
 * Status-aware: Planning (future) skips Band 2; Done (past) swaps the pace
 * line for "Closed: spent X of planned Y".
 *
 * Pure derivation. Never writes. Embed-deduped.
 */
class BudgetSummary {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bs-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;

        const categories = Array.isArray(page.categories) ? page.categories : [];
        const groups = Array.isArray(page.groups) ? page.groups : [];

        const root = dv.container.createEl("div", { cls: "bs-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px 18px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);";

        if (categories.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "Empty budget — add categories below.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 6px 0; text-align: center;";
            return;
        }

        // ----- Compute totals -----
        const totalPlanned = categories.reduce((s, c) => s + ((typeof c?.planned === "number") ? c.planned : 0), 0);
        const totalActual = categories.reduce((s, c) => s + ((typeof c?.actual === "number") ? c.actual : 0), 0);
        const diff = totalActual - totalPlanned;
        const diffPct = totalPlanned > 0 ? (diff / totalPlanned) * 100 : 0;

        // ----- Status derivation (mirrors FinanceStatus.derive for "budget") -----
        const monthInfo = this._parseMonth(page.month);
        let status = "in-progress";
        if (monthInfo) {
            const now = window.moment ? window.moment() : null;
            const todayY = now ? now.year() : new Date().getFullYear();
            const todayM = now ? now.month() + 1 : (new Date().getMonth() + 1);
            if (monthInfo.year < todayY || (monthInfo.year === todayY && monthInfo.month < todayM)) status = "done";
            else if (monthInfo.year > todayY || (monthInfo.year === todayY && monthInfo.month > todayM)) status = "planning";
        }

        this._renderBand1(root, totalPlanned, totalActual, diff, diffPct, status);
        if (status !== "planning" && monthInfo) {
            this._renderBand2(root, totalPlanned, totalActual, monthInfo, status);
        }
        if (groups.length > 0) {
            this._renderBand3(root, categories, groups);
        }
    }

    // ----------------------------------------------------------------- helpers

    // Hardcoded color palette — independent of theme overrides. Calibrated for
    // both dark + light Obsidian themes (mid-saturation; readable on both).
    static PALETTE = {
        green: "#16a34a",
        greenBg: "rgba(22, 163, 74, 0.10)",
        amber: "#b45309",
        amberBg: "rgba(180, 83, 9, 0.10)",
        red: "#dc2626",
        redBg: "rgba(220, 38, 38, 0.10)",
        muted: "var(--text-muted)",
        mutedBg: "transparent"
    };

    _parseMonth(s) {
        if (typeof s !== "string") return null;
        const m = s.match(/^(\d{4})-(\d{2})$/);
        if (!m) return null;
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        if (!year || !month || month < 1 || month > 12) return null;
        const daysInMonth = new Date(year, month, 0).getDate();
        return { year, month, daysInMonth };
    }

    _fmtMoney(n) {
        const sign = n < 0 ? "-" : "";
        const abs = Math.abs(typeof n === "number" ? n : 0).toFixed(2);
        const parts = abs.split(".");
        return sign + "$" + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1];
    }

    _toneFor(planned, actual) {
        if (planned <= 0) return "muted";
        if (actual <= planned) return "green";
        if (actual <= 1.10 * planned) return "amber";
        return "red";
    }

    _colorFor(tone) {
        return BudgetSummary.PALETTE[tone] || BudgetSummary.PALETTE.muted;
    }

    _bgFor(tone) {
        return BudgetSummary.PALETTE[`${tone}Bg`] || "transparent";
    }

    // ----- Band 1: planned / actual / difference -----

    _renderBand1(root, planned, actual, diff, diffPct, status) {
        const band = root.createEl("div");
        band.style.cssText = "display: flex; gap: 24px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--background-modifier-border);";

        const mk = (label, val, valColor) => {
            const cell = band.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 120px;";
            const labEl = cell.createEl("div");
            labEl.textContent = label;
            labEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 500; text-transform: uppercase;";
            const valEl = cell.createEl("div");
            valEl.textContent = val;
            valEl.style.cssText = `font-size: 1.35em; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 4px;${valColor ? " color: " + valColor + ";" : ""}`;
        };

        mk("Planned", this._fmtMoney(planned));
        mk("Actual", this._fmtMoney(actual));

        // "Difference" with sign-aware color. Under-budget renders green
        // (saved); over-budget renders amber/red depending on severity.
        const tone = this._toneFor(planned, actual);
        const diffStr = `${this._fmtMoney(diff)} (${diff >= 0 ? "+" : ""}${diffPct.toFixed(1)}%)`;
        mk("Difference", diffStr, this._colorFor(tone));

        if (status === "done") {
            const closed = band.createEl("div");
            closed.textContent = "Closed";
            closed.style.cssText = "flex: 0 0 auto; align-self: center; font-size: 0.7em; color: var(--text-muted); letter-spacing: 0.04em; padding: 3px 9px; border: 1px solid var(--background-modifier-border); border-radius: 999px; text-transform: uppercase;";
        }
    }

    // ----- Band 2: month progress + pace -----

    _renderBand2(root, planned, actual, monthInfo, status) {
        const band = root.createEl("div");
        band.style.cssText = "padding: 14px 0; border-bottom: 1px solid var(--background-modifier-border);";

        const now = window.moment ? window.moment() : null;
        const nowY = now ? now.year() : new Date().getFullYear();
        const nowM = now ? now.month() + 1 : (new Date().getMonth() + 1);
        const sameMonth = (nowY === monthInfo.year && nowM === monthInfo.month);
        const todayDay = sameMonth ? (now ? now.date() : new Date().getDate()) : monthInfo.daysInMonth;

        const elapsedPct = (todayDay / monthInfo.daysInMonth) * 100;
        const spentPct = planned > 0 ? (actual / planned) * 100 : 0;
        const tone = this._toneFor(planned, actual);

        if (status === "done") {
            const closed = band.createEl("div");
            closed.textContent = `Closed: spent ${this._fmtMoney(actual)} of planned ${this._fmtMoney(planned)}.`;
            closed.style.cssText = "font-size: 0.92em; color: var(--text-muted);";
            return;
        }

        const dayLine = band.createEl("div");
        dayLine.textContent = `Day ${todayDay} of ${monthInfo.daysInMonth} · ${elapsedPct.toFixed(0)}% of month elapsed`;
        dayLine.style.cssText = "font-size: 0.84em; color: var(--text-muted); margin-bottom: 10px;";

        this._renderBar(band, "elapsed", elapsedPct, BudgetSummary.PALETTE.muted, "#9ca3af");
        this._renderBar(band, "spent", spentPct, this._colorFor(tone), this._colorFor(tone));

        // Pace pill (single horizontal element; matches the per-group pill aesthetic).
        const pace = spentPct - elapsedPct;
        let label, paceTone;
        if (pace > 10) { label = `Spending ahead of pace by ${Math.abs(pace).toFixed(0)} points`; paceTone = "red"; }
        else if (pace < -10) { label = `Spending behind pace by ${Math.abs(pace).toFixed(0)} points`; paceTone = "muted"; }
        else { label = "On pace"; paceTone = "green"; }

        const paceWrap = band.createEl("div");
        paceWrap.style.cssText = "margin-top: 10px;";
        const paceTag = paceWrap.createEl("span");
        paceTag.textContent = label;
        paceTag.style.cssText = `display: inline-block; font-size: 0.82em; padding: 3px 10px; border-radius: 999px; color: ${this._colorFor(paceTone)}; background: ${this._bgFor(paceTone)}; border: 1px solid ${this._colorFor(paceTone)}33;`;
    }

    _renderBar(parent, label, pct, fillColor, _ignored) {
        const wrap = parent.createEl("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 10px; margin: 3px 0;";

        const labEl = wrap.createEl("div");
        labEl.textContent = label;
        labEl.style.cssText = "flex: 0 0 60px; font-size: 0.78em; color: var(--text-muted);";

        const track = wrap.createEl("div");
        track.style.cssText = "flex: 1; height: 6px; background: var(--background-modifier-border); border-radius: 999px; overflow: hidden;";

        const fill = track.createEl("div");
        const clamped = Math.min(Math.max(pct, 0), 150);
        fill.style.cssText = `height: 100%; width: ${Math.min(clamped, 100)}%; background: ${fillColor}; transition: width 200ms; border-radius: 999px;`;

        const valEl = wrap.createEl("div");
        valEl.textContent = `${pct.toFixed(0)}%`;
        valEl.style.cssText = "flex: 0 0 48px; text-align: right; font-size: 0.78em; font-variant-numeric: tabular-nums; color: var(--text-muted);";
    }

    // ----- Band 3: per-group pill-cards -----

    _renderBand3(root, categories, groups) {
        const band = root.createEl("div");
        band.style.cssText = "padding-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;";

        for (const group of groups) {
            const inGroup = categories.filter((c) => c && c.group === group);
            const planned = inGroup.reduce((s, c) => s + ((typeof c.planned === "number") ? c.planned : 0), 0);
            const actual = inGroup.reduce((s, c) => s + ((typeof c.actual === "number") ? c.actual : 0), 0);
            const diff = actual - planned;
            const tone = this._toneFor(planned, actual);
            const fg = this._colorFor(tone);
            const bg = this._bgFor(tone);

            const card = band.createEl("div");
            card.style.cssText = `padding: 9px 11px; border-radius: 8px; border: 1px solid ${fg}26; background: ${bg};`;

            const nameEl = card.createEl("div");
            nameEl.textContent = group;
            nameEl.style.cssText = `font-size: 0.78em; font-weight: 600; color: ${fg}; letter-spacing: 0.01em;`;

            const valEl = card.createEl("div");
            valEl.textContent = `${this._fmtMoney(planned)} → ${this._fmtMoney(actual)}`;
            valEl.style.cssText = "font-size: 0.86em; font-variant-numeric: tabular-nums; margin-top: 4px; color: var(--text-normal);";

            const dirEl = card.createEl("div");
            if (planned <= 0) {
                dirEl.textContent = "—";
                dirEl.style.cssText = "font-size: 0.76em; margin-top: 2px; color: var(--text-muted);";
            } else if (actual === planned) {
                dirEl.textContent = "On plan";
                dirEl.style.cssText = `font-size: 0.76em; margin-top: 2px; color: ${fg};`;
            } else {
                const overUnder = actual > planned ? "over" : "under";
                const pct = Math.abs((diff / planned) * 100);
                dirEl.textContent = `${this._fmtMoney(Math.abs(diff))} ${overUnder} (${pct.toFixed(0)}%)`;
                dirEl.style.cssText = `font-size: 0.76em; margin-top: 2px; color: ${fg};`;
            }
        }
    }
}
