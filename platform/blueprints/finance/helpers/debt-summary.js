/**
 * DebtSummary v0.6.0 (v0.108.0 S3)
 * Marker comment used by installer migration: <!-- debt-summary-v0.6.0 -->
 *
 * Per-debt entity three-band rollup widget.
 *
 * Band 1 — Numbers: balance / APR / monthly interest / planned attack /
 *          projected payoff date. "Edit balance" pill (opens DebtConfigEditor).
 * Band 2 — Sparkline of balance_history[]. Delta-from-prior pill.
 *          Placeholder if history.length < 2.
 * Band 3 — (CC only) Paydown progress bar + utilization chip.
 *
 * Math:
 *   monthlyInterest = balance * apr / 100 / 12
 *   payoff: per-debt date from FinanceMath.projectedPayoff().killOrder (avalanche roll),
 *           with isolation Math.ceil(balance / (planned - monthlyInterest)) as fallback.
 *
 * CSS root: dbt-sum-root. Embed-deduped. Never writes. Pure derivation.
 */
class DebtSummary {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".dbt-sum-root");
            if (prev) prev.remove();
        }

        const page = dv.current() || {};
        if (page.type !== "debt") return;

        const root = dv.container.createEl("div", { cls: "dbt-sum-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px; border: 1px solid var(--sauce-hairline); border-radius: 12px; background: var(--background-secondary-alt);";

        const balance = Number(page.current_balance) || 0;
        const apr = Number(page.apr) || 0;
        const planned = Number(page.planned_monthly_payment) || 0;
        const monthlyInterest = balance * apr / 100 / 12;
        const principalAttack = planned - monthlyInterest;

        // ----- Band 1 — Numbers -----
        const b1 = root.createEl("div", { cls: "dbt-band-1" });
        b1.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--sauce-hairline);";

        const mk = (label, val, color) => {
            const cell = b1.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 120px;";
            const labEl = cell.createEl("div");
            labEl.textContent = label;
            labEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.05em; font-weight: 600;";
            const valEl = cell.createEl("div");
            valEl.textContent = val;
            valEl.style.cssText = `font-size: 1.1em; font-variant-numeric: tabular-nums; margin-top: 2px;${color ? " color: " + color + ";" : ""}`;
        };

        mk("BALANCE", `$${balance.toFixed(2)}`);
        mk("APR", `${apr.toFixed(2)}%`);
        mk("MONTHLY INTEREST", `$${monthlyInterest.toFixed(2)}`);
        mk("PLANNED ATTACK", `$${planned.toFixed(2)}`);

        // Per-debt payoff comes from the canonical avalanche kill order (accounts for the roll
        // of freed minimums), not this card in isolation. Fall back to the isolation estimate
        // only when this debt isn't in the kill order (e.g. no plan + below-interest).
        const _now = new Date();
        const _monthKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
        let _ko = null;
        try {
            const _pp = customJS.FinanceMath.projectedPayoff(dv, _monthKey);
            _ko = (_pp && Array.isArray(_pp.killOrder))
                ? _pp.killOrder.find(k => k.slug === (page.file && page.file.name)) : null;
        } catch (_e) { _ko = null; }
        if (_ko && _ko.date) {
            const eta = new Date(_ko.date + "T00:00:00Z");
            const today = new Date();
            const months = Math.max(0,
                (eta.getUTCFullYear() - today.getFullYear()) * 12 + (eta.getUTCMonth() - today.getMonth()));
            mk("PROJECTED PAYOFF", `${months}mo (${_ko.date})`);
        } else if (principalAttack <= 0) {
            const warnEl = b1.createEl("div");
            warnEl.textContent = "Increase planned monthly attack — below interest";
            warnEl.style.cssText = "flex: 1 0 100%; font-size: 0.85em; color: #dc2626; margin-top: 4px;";
        } else {
            const months = Math.ceil(balance / principalAttack);
            const eta = new Date();
            eta.setMonth(eta.getMonth() + months);
            mk("PROJECTED PAYOFF", `${months}mo (${eta.toISOString().slice(0, 10)})`);
        }

        // Edit balance pill
        const editBtn = b1.createEl("button", { cls: "dbt-edit-btn sauce-btn", text: "Edit balance" });
        editBtn.style.cssText = "margin-top: 8px; align-self: flex-start;";
        editBtn.addEventListener("click", async () => {
            try {
                const file = app.vault.getAbstractFileByPath(page.file.path);
                if (file) await customJS.DebtConfigEditor.render(file, { onSave: () => {} });
            } catch (_e) {}
        });

        // ----- Band 2 — Sparkline + delta -----
        const history = Array.isArray(page.balance_history) ? page.balance_history : [];
        const b2 = root.createEl("div", { cls: "dbt-band-2" });
        b2.style.cssText = "padding: 12px 0; border-bottom: 1px solid var(--sauce-hairline);";

        if (history.length < 2) {
            const ph = b2.createEl("div", { cls: "dbt-placeholder" });
            ph.textContent = "No history yet — edit balance to start tracking";
            ph.style.cssText = "font-size: 0.85em; color: var(--text-muted); text-align: center;";
        } else {
            // Chronological order (oldest first) for sparkline
            const chronological = history.slice().reverse();
            const values = chronological.map(h => Number(h.balance) || 0);
            this._renderSparkline(b2, values);

            const prior = Number(history[0].balance) || 0;
            const delta = balance - prior;
            const sign = delta >= 0 ? "+" : "";
            const deltaPill = b2.createEl("span", { cls: "dbt-delta-pill sauce-pill" });
            deltaPill.textContent = `vs prior: ${sign}$${Math.abs(delta).toFixed(2)}`;
            deltaPill.style.cssText = `margin-left: 8px; color: ${delta > 0 ? "#dc2626" : "#16a34a"};`;
        }

        // ----- Band 3 — CC paydown progress -----
        if (page.kind === "credit-card" && Number(page.credit_limit) > 0) {
            const limit = Number(page.credit_limit);
            const paidPct = Math.max(0, Math.min(100, Math.round((1 - balance / limit) * 100)));
            const utilizationPct = 100 - paidPct;

            const b3 = root.createEl("div", { cls: "dbt-band-3" });
            b3.style.cssText = "padding-top: 12px;";

            const barWrap = b3.createEl("div");
            barWrap.style.cssText = "height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden; margin-bottom: 6px;";
            const fill = barWrap.createEl("div");
            fill.style.cssText = `height: 100%; width: ${paidPct}%; background: ${paidPct < 33 ? "#dc2626" : paidPct < 66 ? "#b45309" : "#16a34a"}; transition: width 200ms;`;

            const infoEl = b3.createEl("div");
            infoEl.textContent = `${paidPct}% paid down · Utilization ${utilizationPct}%`;
            infoEl.style.cssText = "font-size: 0.82em; color: var(--text-muted);";
        }
    }

    _renderSparkline(parent, values) {
        if (!values || values.length < 2) return;
        const w = 200, h = 40;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;
        const pts = values.map((v, i) =>
            `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`
        ).join(" ");
        const wrap = parent.createEl("div");
        wrap.style.cssText = "display: inline-block; vertical-align: middle;";
        wrap.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;"><polyline points="${pts}" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    }
}
