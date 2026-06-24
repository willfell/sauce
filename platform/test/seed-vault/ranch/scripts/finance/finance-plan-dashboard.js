/**
 * FinancePlanDashboard v0.10.0 — the unified planning cockpit.
 *
 * Renders on the Finance Plan.md singleton (type: finance-plan). A thin read-only
 * VIEW of customJS.FinanceMath.computePlanState — it computes nothing itself.
 *
 * Band 1 — Envelope: base − carry = effective · planned · spent · LEFT + over-flag.
 * Band 2 — Allocation: per-card min+attack=total (target highlighted) + savings
 *          contribution + tier chip + [ Apply to entities ] (one-click write).
 * Band 3 — Rollup: total debt · savings bal→target · weighted APR · zero-debt date
 *          + kill order · what-if line · overflow split (conditional).
 *
 * CSS root: fpd-root. Embed-deduped. Reads live; the ONLY writes are user-initiated
 * via the Apply confirm modal (debt planned_monthly_payment + Paycheck Defaults Savings row).
 */
class FinancePlanDashboard {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".fpd-root");
            if (prev) prev.remove();
        }
        const page = dv.current() || {};
        if (page.type !== "finance-plan") return;

        const fm = customJS.FinanceMath;
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const ps = fm.computePlanState(dv, monthKey);

        const root = dv.container.createEl("div", { cls: "fpd-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px; border: 1px solid var(--background-modifier-border); border-radius: 12px; background: var(--background-secondary-alt);";

        if (!ps || !ps.ok) {
            const setup = root.createEl("div");
            setup.textContent = "Set up your Finance Plan — fill in income_floor, fixed_living_monthly, attack_above_minimums, and savings_glide in this note's frontmatter, then re-render.";
            setup.style.cssText = "font-size: 0.9em; color: var(--text-muted); line-height: 1.5;";
            return;
        }

        const money = (n, opts) => fm.fmtMoney(n, opts);
        const GREEN = "#16a34a", AMBER = "#b45309", RED = "#dc2626";

        // ---------- Band 1 — Envelope ----------
        const e = ps.envelope;
        const b1 = root.createEl("div", { cls: "fpd-band-1" });
        b1.style.cssText = "padding-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border);";
        const b1head = b1.createEl("div");
        b1head.textContent = `${monthKey} DISCRETIONARY ENVELOPE`;
        b1head.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.06em; font-weight: 600; margin-bottom: 8px;";
        const grid = b1.createEl("div");
        grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 10px;";
        const cell = (label, val, color) => {
            const c = grid.createEl("div");
            const l = c.createEl("div"); l.textContent = label;
            l.style.cssText = "font-size: 0.68em; color: var(--text-muted); letter-spacing: 0.04em;";
            const v = c.createEl("div"); v.textContent = val;
            v.style.cssText = `font-size: 1.05em; font-variant-numeric: tabular-nums; margin-top: 2px;${color ? " color: " + color + ";" : ""}`;
        };
        cell("Base", money(e.base));
        if (e.overageCarry > 0) cell("Carry", money(-e.overageCarry), AMBER);
        cell("Effective", money(e.effective));
        cell("Planned", money(e.planned));
        cell("Spent", money(e.spent));
        cell("Left", money(e.left), e.left < 0 ? RED : GREEN);
        if (e.governed && e.over > 0) {
            const flag = b1.createEl("div");
            flag.textContent = `⚠ OVER by ${money(e.over)} — trim a discretionary line or it lands on next month's envelope`;
            flag.style.cssText = `margin-top: 10px; padding: 6px 10px; border-radius: 6px; background: rgba(220,38,38,0.10); color: ${RED}; font-size: 0.84em;`;
        } else if (!e.governed) {
            const note = b1.createEl("div");
            note.textContent = `Baseline month — not scored against the envelope (governed from ${e.governedFrom || "—"}).`;
            note.style.cssText = "margin-top: 10px; padding: 6px 10px; border-radius: 6px; background: var(--background-secondary); color: var(--text-muted); font-size: 0.82em;";
        }

        // ---------- Band 2 — Allocation ----------
        const b2 = root.createEl("div", { cls: "fpd-band-2" });
        b2.style.cssText = "padding: 12px 0; border-bottom: 1px solid var(--background-modifier-border);";
        const b2head = b2.createEl("div");
        b2head.textContent = "THIS CYCLE'S ALLOCATION";
        b2head.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.06em; font-weight: 600; margin-bottom: 8px;";
        const table = b2.createEl("div");
        table.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        for (const a of ps.allocation) {
            const row = table.createEl("div");
            row.style.cssText = `display: flex; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 5px; font-size: 0.88em;${a.isTarget ? " background: rgba(22,163,74,0.10); font-weight: 600;" : ""}`;
            const left = row.createEl("span");
            left.textContent = `${a.debt}${a.isTarget ? "  ◀ target" : ""}`;
            const right = row.createEl("span");
            right.textContent = a.attack > 0 ? `${money(a.min)} + ${money(a.attack)} = ${money(a.total)}` : `${money(a.total)} (min)`;
            right.style.cssText = "font-variant-numeric: tabular-nums; color: var(--text-muted);";
        }
        // savings line
        const sRow = table.createEl("div");
        sRow.style.cssText = "display: flex; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 5px; font-size: 0.88em;";
        const sLeft = sRow.createEl("span");
        sLeft.textContent = `Savings (Tier ${ps.savings.tier})${ps.attack.freed > 0 ? `  → ${money(ps.attack.freed)} freed to attack` : ""}`;
        const sRight = sRow.createEl("span");
        sRight.textContent = `${money(ps.savings.contribution)}/mo`;
        sRight.style.cssText = "font-variant-numeric: tabular-nums; color: var(--text-muted);";

        const applyBtn = b2.createEl("button", { text: "Apply to entities" });
        applyBtn.style.cssText = "cursor: pointer; margin-top: 10px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); font-size: 0.85em;";
        applyBtn.addEventListener("click", () => this._confirmAndApply(dv, ps));

        // ---------- Band 3 — Rollup ----------
        const b3 = root.createEl("div", { cls: "fpd-band-3" });
        b3.style.cssText = "padding-top: 12px; font-size: 0.85em; color: var(--text-muted); line-height: 1.6;";
        const debtTotal = ps.allocation.reduce((s, a) => s + (Number(a.balance) || 0), 0);
        b3.createEl("div").textContent = `Total debt ${money(debtTotal)} · Savings ${money(ps.savings.balance)} → ${money(ps.savings.target)} · Attack ${money(ps.attack.total)}/mo`;
        const payoffLine = b3.createEl("div");
        payoffLine.textContent = `Zero-debt date: ${ps.payoff.zeroDebtDate}${isFinite(ps.payoff.months) ? ` (~${ps.payoff.months} mo)` : ""}`;
        payoffLine.style.cssText = "color: var(--text-normal);";
        if (ps.payoff.killOrder && ps.payoff.killOrder.length) {
            b3.createEl("div").textContent = "Kill order: " + ps.payoff.killOrder.map(k => `${k.debt} ${k.date}`).join(" → ");
        }
        if (ps.whatIf && ps.whatIf.skipAttackThisMonth) {
            const w = ps.whatIf.skipAttackThisMonth;
            b3.createEl("div").textContent = `What-if: skip this month's attack → payoff slips ~${w.weeksSlipped} week${w.weeksSlipped === 1 ? "" : "s"} (to ${w.newZeroDebtDate})`;
        }
        if (ps.overflow) {
            const o = ps.overflow;
            const ov = b3.createEl("div");
            ov.textContent = `Overflow: income ${money(o.actualIncome)} > floor — surplus ${money(o.surplus)} → ${money(o.toAttack)} attack / ${money(o.toFlex)} flex`;
            ov.style.cssText = `color: ${GREEN};`;
        }
    }

    async _confirmAndApply(dv, ps) {
        const fm = customJS.FinanceMath;
        const money = (n) => fm.fmtMoney(n);
        // Gather "before" values.
        const debts = fm.readDebts(dv);
        const beforeBySlug = {};
        for (const d of debts) {
            const slug = (d.file && d.file.name) ? d.file.name : null;
            if (slug) beforeBySlug[slug] = Number(d.planned_monthly_payment) || 0;
        }
        let pcDefaults = null;
        try { pcDefaults = dv.pages('"spice/finance"').where(p => p && p.type === "paycheck-defaults").array()[0] || null; } catch (_e) {}
        let savingsBefore = null;
        if (pcDefaults && Array.isArray(pcDefaults.expenses)) {
            const row = pcDefaults.expenses.find(x => x && (String(x.category || "").toLowerCase() === "savings" || String(x.item || "").toLowerCase() === "savings"));
            if (row) savingsBefore = Number(row.amount) || 0;
        }

        const diffs = [];
        for (const t of ps.applyPlan.debtTargets) {
            const before = beforeBySlug[t.slug];
            diffs.push({ kind: "debt", label: t.slug.replace(/^Debt-/, ""), slug: t.slug, before, after: t.planned_monthly_payment });
        }
        diffs.push({ kind: "savings", label: "Paycheck Defaults · Savings row", before: savingsBefore, after: ps.applyPlan.savingsPerCheck });

        // ----- modal -----
        const overlay = document.body.createEl("div");
        overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;";
        const modal = overlay.createEl("div");
        modal.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 20px; max-width: 480px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3);";
        const h = modal.createEl("div"); h.textContent = "Apply allocation to entities?";
        h.style.cssText = "font-size: 1.05em; font-weight: 600; margin-bottom: 12px;";
        const list = modal.createEl("div");
        list.style.cssText = "display: flex; flex-direction: column; gap: 4px; font-size: 0.86em; font-variant-numeric: tabular-nums; margin-bottom: 16px;";
        let anyChange = false;
        for (const d of diffs) {
            const changed = d.before === null || Number(d.before) !== Number(d.after);
            if (changed) anyChange = true;
            const r = list.createEl("div");
            r.style.cssText = `display: flex; justify-content: space-between; gap: 12px;${changed ? "" : " color: var(--text-muted);"}`;
            r.createEl("span").textContent = d.label;
            r.createEl("span").textContent = `${d.before === null ? "—" : money(d.before)} → ${money(d.after)}${changed ? "" : "  (unchanged)"}`;
        }
        if (!anyChange) {
            const note = modal.createEl("div");
            note.textContent = "Nothing to change — entities already match the plan.";
            note.style.cssText = "font-size: 0.84em; color: var(--text-muted); margin-bottom: 12px;";
        }
        const btns = modal.createEl("div");
        btns.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
        const cancel = btns.createEl("button", { text: "Cancel" });
        cancel.style.cssText = "cursor: pointer; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary);";
        cancel.addEventListener("click", () => overlay.remove());
        const apply = btns.createEl("button", { text: anyChange ? "Apply" : "OK" });
        apply.style.cssText = "cursor: pointer; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
        apply.addEventListener("click", async () => {
            if (anyChange) await this._writeAll(diffs);
            overlay.remove();
            try { new Notice("Finance plan applied to entities."); } catch (_e) {}
            this.render(dv);
        });
    }

    async _writeAll(diffs) {
        for (const d of diffs) {
            try {
                if (d.before !== null && Number(d.before) === Number(d.after)) continue;
                if (d.kind === "debt") {
                    const file = app.vault.getAbstractFileByPath(`spice/finance/debts/${d.slug}.md`);
                    if (file) await customJS.FinanceFrontmatter.update(file, (fm) => { fm.planned_monthly_payment = Number(d.after); });
                } else if (d.kind === "savings") {
                    const file = app.vault.getAbstractFileByPath("spice/finance/Paycheck Defaults.md");
                    if (file) await customJS.FinanceFrontmatter.update(file, (fm) => {
                        if (!Array.isArray(fm.expenses)) return;
                        const row = fm.expenses.find(x => x && (String(x.category || "").toLowerCase() === "savings" || String(x.item || "").toLowerCase() === "savings"));
                        if (row) row.amount = Number(d.after);
                    });
                }
            } catch (_e) { /* per-write best-effort; failure-loud via console */ console.error("FinancePlanDashboard apply failed", d, _e); }
        }
    }
}
