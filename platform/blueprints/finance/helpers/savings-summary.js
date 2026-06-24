/**
 * SavingsSummary v0.10.0
 * Marker comment used by installer migration: <!-- savings-summary-v0.10.0 -->
 *
 * Per-savings-account entity three-band rollup widget.
 *
 * Band 1 — Numbers: name / balance / target / progress-to-target bar /
 *          tier chip (from FinanceMath.glide, if a plan exists).
 *          "Edit balance" pill (opens SavingsConfigEditor).
 * Band 2 — Sparkline of balance_history[]. Delta-from-prior pill.
 *          For savings a RISING balance is GOOD (inverted vs debt).
 *          Placeholder if history.length < 2.
 * Band 3 — To-target remaining (or "Target reached").
 *
 * CSS root: sav-sum-root. Embed-deduped. Never writes. Pure derivation.
 */
class SavingsSummary {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".sav-sum-root");
            if (prev) prev.remove();
        }

        const page = dv.current() || {};
        if (page.type !== "savings-account") return;

        const root = dv.container.createEl("div", { cls: "sav-sum-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px; border: 1px solid var(--background-modifier-border); border-radius: 12px; background: var(--background-secondary-alt);";

        const balance = Number(page.current_balance) || 0;
        const target = Number(page.target) || 0;
        const paidPct = target > 0 ? Math.min(100, (balance / target) * 100) : 0;

        // ----- Band 1 — Numbers -----
        const b1 = root.createEl("div", { cls: "sav-band-1" });
        b1.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border);";

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

        mk("NAME", page.name || "(unnamed)");
        mk("BALANCE", `$${balance.toFixed(2)}`);
        mk("TARGET", `$${target.toFixed(2)}`);

        // Progress-to-target bar
        const barWrap = b1.createEl("div");
        barWrap.style.cssText = "flex: 1 0 100%; height: 10px; background: #e5e7eb; border-radius: 5px; overflow: hidden; margin-top: 4px;";
        const fill = barWrap.createEl("div");
        fill.style.cssText = `height: 100%; width: ${paidPct}%; background: ${paidPct < 33 ? "#dc2626" : paidPct < 66 ? "#b45309" : "#16a34a"}; transition: width 200ms;`;

        // Tier chip (from FinanceMath glide, if a plan exists)
        const plan = customJS.FinanceMath && customJS.FinanceMath.readPlan ? customJS.FinanceMath.readPlan(dv) : null;
        const g = (plan && customJS.FinanceMath.glide) ? customJS.FinanceMath.glide(Number(page.current_balance) || 0, plan.savings_glide) : null;
        if (g) {
            const tierChip = b1.createEl("span", { cls: "sav-tier-chip" });
            tierChip.textContent = `Tier ${g.tier} · $${g.contribution}/mo`;
            tierChip.style.cssText = "display: inline-block; margin-top: 8px; font-size: 0.78em; padding: 2px 8px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);";
        }

        // Edit balance pill
        const editBtn = b1.createEl("button", { text: "Edit balance" });
        editBtn.style.cssText = "cursor: pointer; padding: 4px 10px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-muted); font-size: 0.8em; margin-top: 8px; align-self: flex-start;";
        editBtn.addEventListener("click", async () => {
            try {
                const file = app.vault.getAbstractFileByPath(page.file.path);
                if (file) await customJS.SavingsConfigEditor.render(file, { onSave: () => { this.render(dv); } });
            } catch (_e) {}
        });

        // ----- Band 2 — Sparkline + delta -----
        const history = Array.isArray(page.balance_history) ? page.balance_history : [];
        const b2 = root.createEl("div", { cls: "sav-band-2" });
        b2.style.cssText = "padding: 12px 0; border-bottom: 1px solid var(--background-modifier-border);";

        if (history.length < 2) {
            const ph = b2.createEl("div", { cls: "sav-placeholder" });
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
            const deltaPill = b2.createEl("span", { cls: "sav-delta" });
            deltaPill.textContent = `vs prior: ${sign}$${Math.abs(delta).toFixed(2)}`;
            // For savings, a RISING balance is GOOD (inverted vs debt).
            deltaPill.style.cssText = `font-size: 0.8em; margin-left: 8px; color: ${delta > 0 ? "#16a34a" : "#dc2626"};`;
        }

        // ----- Band 3 — To-target remaining -----
        const b3 = root.createEl("div", { cls: "sav-band-3" });
        b3.style.cssText = "padding-top: 12px;";

        const infoEl = b3.createEl("div");
        if (balance >= target) {
            infoEl.textContent = "Target reached";
            infoEl.style.cssText = "font-size: 0.82em; color: #16a34a;";
        } else {
            infoEl.textContent = `To target: $${Math.max(0, target - balance).toFixed(2)}`;
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
