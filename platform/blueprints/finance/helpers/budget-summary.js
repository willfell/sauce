/**
 * BudgetSummary — Read-only three-band rollup at the top of every Budget note.
 *
 * Band 1 — Total Planned / Actual / Variance ($ and %).
 * Band 2 — Day X of N month-elapsed bar + spent-percentage bar + pace indicator
 *          (⚠ AHEAD / ✓ on pace / ↓ BEHIND at ±10 pts threshold).
 * Band 3 — Per-group mini-cards (one per page.groups[] entry) showing
 *          planned → actual + variance %, color-coded.
 *
 * Status-aware:
 *   • Planning  (future month) — Bands 1+3 only (planned), no pacing.
 *   • In Progress (current month) — full 3-band rollup with pace.
 *   • Done      (past month) — full 3-band with "CLOSED" tag; pace row swaps
 *                              to "Closed: spent X of planned Y".
 *
 * Pure derivation from page frontmatter. Never writes. Embed-deduped.
 * Obsidian's auto-rerender on frontmatter change keeps this in sync with
 * BudgetCategoriesEditor mutations (no explicit coupling needed).
 *
 * v0.107.0 S4.3.
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
        root.style.cssText = "margin: 12px 0 20px; padding: 16px; border: 1px solid var(--background-modifier-border); border-radius: 12px; background: var(--background-secondary-alt);";

        if (categories.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "Empty budget — add categories below.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 6px 0; text-align: center;";
            return;
        }

        // ----- Compute totals -----
        const totalPlanned = categories.reduce((s, c) => s + ((typeof c?.planned === "number") ? c.planned : 0), 0);
        const totalActual = categories.reduce((s, c) => s + ((typeof c?.actual === "number") ? c.actual : 0), 0);
        const variance = totalActual - totalPlanned;
        const variancePct = totalPlanned > 0 ? (variance / totalPlanned) * 100 : 0;

        // ----- Status derivation (mirrors FinanceStatus for "budget") -----
        const monthStr = page.month;
        const monthInfo = this._parseMonth(monthStr);
        let status = "in-progress";
        if (monthInfo) {
            const now = window.moment ? window.moment() : null;
            const todayY = now ? now.year() : new Date().getFullYear();
            const todayM = now ? now.month() + 1 : (new Date().getMonth() + 1);
            if (monthInfo.year < todayY || (monthInfo.year === todayY && monthInfo.month < todayM)) status = "done";
            else if (monthInfo.year > todayY || (monthInfo.year === todayY && monthInfo.month > todayM)) status = "planning";
        }

        // ----- Band 1: totals -----
        this._renderBand1(root, totalPlanned, totalActual, variance, variancePct, status);

        // ----- Band 2: month progress + pace (suppressed for planning) -----
        if (status !== "planning" && monthInfo) {
            this._renderBand2(root, totalPlanned, totalActual, monthInfo, status);
        }

        // ----- Band 3: per-group mini-cards -----
        if (groups.length > 0) {
            this._renderBand3(root, categories, groups);
        }
    }

    // ============================================================== helpers

    _parseMonth(s) {
        if (typeof s !== "string") return null;
        const m = s.match(/^(\d{4})-(\d{2})$/);
        if (!m) return null;
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        if (!year || !month || month < 1 || month > 12) return null;
        // Days in month (handles Feb leap year).
        const daysInMonth = new Date(year, month, 0).getDate();
        return { year, month, daysInMonth };
    }

    _fmtMoney(n) {
        const s = (typeof n === "number" ? n : 0).toFixed(2);
        const parts = s.split(".");
        return "$" + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1];
    }

    _varianceColor(planned, actual) {
        if (planned <= 0) return "var(--text-muted)";
        if (actual <= planned) return "var(--text-success, #16a34a)";
        if (actual <= 1.10 * planned) return "var(--text-warning, #b45309)";
        return "var(--text-error, #dc2626)";
    }

    // ----- Band 1 -----

    _renderBand1(root, planned, actual, variance, variancePct, status) {
        const band = root.createEl("div");
        band.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border);";

        const mk = (label, val, color) => {
            const cell = band.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 120px;";
            const labEl = cell.createEl("div");
            labEl.textContent = label;
            labEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.05em; font-weight: 600;";
            const valEl = cell.createEl("div");
            valEl.textContent = val;
            valEl.style.cssText = `font-size: 1.3em; font-variant-numeric: tabular-nums; margin-top: 2px;${color ? " color: " + color + ";" : ""}`;
            return { cell, valEl };
        };

        mk("PLANNED", this._fmtMoney(planned));
        mk("ACTUAL", this._fmtMoney(actual));
        const sign = variance >= 0 ? "+" : "";
        const varStr = `${sign}${this._fmtMoney(variance)} (${sign}${variancePct.toFixed(1)}%)`;
        mk("VARIANCE", varStr, this._varianceColor(planned, actual));

        if (status === "done") {
            const closed = band.createEl("div");
            closed.textContent = "CLOSED";
            closed.style.cssText = "flex: 0 0 auto; align-self: center; font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.05em; padding: 4px 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px;";
        }
    }

    // ----- Band 2 — month progress + pace -----

    _renderBand2(root, planned, actual, monthInfo, status) {
        const band = root.createEl("div");
        band.style.cssText = "padding: 12px 0; border-bottom: 1px solid var(--background-modifier-border);";

        // Day X of N — only for current month. For done (past), use full month.
        const now = window.moment ? window.moment() : null;
        const nowY = now ? now.year() : new Date().getFullYear();
        const nowM = now ? now.month() + 1 : (new Date().getMonth() + 1);
        const sameMonth = (nowY === monthInfo.year && nowM === monthInfo.month);
        const todayDay = sameMonth ? (now ? now.date() : new Date().getDate()) : monthInfo.daysInMonth;

        const elapsedPct = (todayDay / monthInfo.daysInMonth) * 100;
        const spentPct = planned > 0 ? (actual / planned) * 100 : 0;

        if (status === "done") {
            const closed = band.createEl("div");
            closed.textContent = `Closed: spent ${this._fmtMoney(actual)} of planned ${this._fmtMoney(planned)}.`;
            closed.style.cssText = "font-size: 0.95em; color: var(--text-muted);";
            return;
        }

        const dayLine = band.createEl("div");
        dayLine.textContent = `Day ${todayDay} of ${monthInfo.daysInMonth} — ${elapsedPct.toFixed(0)}% of month elapsed`;
        dayLine.style.cssText = "font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;";

        this._renderBar(band, "elapsed", elapsedPct, "var(--text-muted)");
        this._renderBar(band, "spent", spentPct, this._varianceColor(planned, actual));

        // Pace = spent% - elapsed% (positive = ahead = overspending).
        const pace = spentPct - elapsedPct;
        let symbol, label, color;
        if (pace > 10) {
            symbol = "⚠";
            label = `AHEAD by +${Math.abs(pace).toFixed(0)} pts`;
            color = "var(--text-error, #dc2626)";
        } else if (pace < -10) {
            symbol = "↓";
            label = `BEHIND by ${Math.abs(pace).toFixed(0)} pts`;
            color = "var(--text-muted)";
        } else {
            symbol = "✓";
            label = `on pace`;
            color = "var(--text-success, #16a34a)";
        }
        const paceLine = band.createEl("div");
        paceLine.style.cssText = `font-size: 0.9em; margin-top: 8px; color: ${color};`;
        paceLine.textContent = `${symbol} Pace: ${label}`;
    }

    _renderBar(parent, label, pct, fillColor) {
        const wrap = parent.createEl("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin: 2px 0;";

        const labEl = wrap.createEl("div");
        labEl.textContent = label;
        labEl.style.cssText = "flex: 0 0 60px; font-size: 0.8em; color: var(--text-muted);";

        const track = wrap.createEl("div");
        track.style.cssText = "flex: 1; height: 8px; background: var(--background-modifier-border); border-radius: 4px; overflow: hidden;";

        const fill = track.createEl("div");
        const clamped = Math.min(Math.max(pct, 0), 150);
        fill.style.cssText = `height: 100%; width: ${Math.min(clamped, 100)}%; background: ${fillColor}; transition: width 200ms;`;

        const valEl = wrap.createEl("div");
        valEl.textContent = `${pct.toFixed(0)}%`;
        valEl.style.cssText = "flex: 0 0 48px; text-align: right; font-size: 0.8em; font-variant-numeric: tabular-nums; color: var(--text-muted);";
    }

    // ----- Band 3 — per-group mini-cards -----

    _renderBand3(root, categories, groups) {
        const band = root.createEl("div");
        band.style.cssText = "padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;";

        for (const group of groups) {
            const inGroup = categories.filter((c) => c && c.group === group);
            const planned = inGroup.reduce((s, c) => s + ((typeof c.planned === "number") ? c.planned : 0), 0);
            const actual = inGroup.reduce((s, c) => s + ((typeof c.actual === "number") ? c.actual : 0), 0);
            const variance = actual - planned;

            const card = band.createEl("div");
            const tone = this._varianceColor(planned, actual);
            card.style.cssText = `padding: 8px 10px; border: 1px solid var(--background-modifier-border); border-radius: 8px; border-top: 3px solid ${tone};`;

            const nameEl = card.createEl("div");
            nameEl.textContent = group.toUpperCase();
            nameEl.style.cssText = "font-size: 0.7em; color: var(--text-muted); font-weight: 600; letter-spacing: 0.05em;";

            const valEl = card.createEl("div");
            valEl.textContent = `${this._fmtMoney(planned)} → ${this._fmtMoney(actual)}`;
            valEl.style.cssText = "font-size: 0.85em; font-variant-numeric: tabular-nums; margin-top: 4px;";

            const varEl = card.createEl("div");
            if (planned <= 0) {
                varEl.textContent = "—";
            } else {
                const sign = variance >= 0 ? "+" : "";
                const pct = (variance / planned) * 100;
                varEl.textContent = `${sign}${pct.toFixed(0)}%${actual > planned ? " over" : (actual < planned ? " under" : "")}`;
            }
            varEl.style.cssText = `font-size: 0.78em; margin-top: 2px; color: ${tone};`;
        }
    }
}
