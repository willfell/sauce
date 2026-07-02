/**
 * MonthSetupChecklist — the Month-note cockpit (finance "make it make sense" #3).
 *
 * Renders month setup health ABOVE the MonthDashboard: a row per required step
 * (Budget created · Paycheck created · Deposits materialized · Deposit tags ·
 * Reconcile to income · Bills checked off), each with a ✓ / ⚠ / ✗ glyph, and —
 * when the entity is absent — a "Create Budget" / "Create Paycheck" action that
 * delegates to the existing entity-create seeded scaffold for THIS month (no
 * prompt) via customJS.EntityCreate.create({ instance, dv, presetPrompts:{month} }).
 *
 * DISPLAY-ONLY: all numbers come from customJS.FinanceMath.monthSetupStatus, a
 * pure read that never touches the discretionary envelope (envelope-isolation
 * invariant). This widget NEVER writes on render.
 *
 * customJS conventions: bare class only (no trailing statements — CJS-LOAD gate),
 * async render(dv), embed-dedup guard, render-safe (no bare dv.current() deref).
 */
class MonthSetupChecklist {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .msc-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.type !== "month") return;

        const month = this._resolveMonth(page);
        if (!month) return;

        const st = customJS.FinanceMath.monthSetupStatus(dv, month);
        if (!st) return;

        const root = dv.container.createEl("div", { cls: "msc-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px 18px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);";

        const head = root.createEl("div");
        head.textContent = st.ready ? `${month} — ready` : `${month} — setup`;
        head.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;";

        // Row 1 — Budget created (Create Budget when absent).
        this._row(root, dv, {
            state: st.budget.exists ? "ok" : "bad",
            label: st.budget.exists ? "Budget created" : "No budget yet",
            createInstance: st.budget.exists ? null : "budget",
            createLabel: "Create Budget",
            createIcon: "plus",
            openPath: st.budget.exists ? `spice/finance/budgets/${month}/Budget-${month}.md` : null,
            month,
        });

        // Row 2 — Paycheck created (Create Paycheck when absent).
        this._row(root, dv, {
            state: st.paycheck.exists ? "ok" : "bad",
            label: st.paycheck.exists ? "Paycheck created" : "No paycheck yet",
            createInstance: st.paycheck.exists ? null : "paycheck",
            createLabel: "Create Paycheck",
            createIcon: "wallet-plus",
            openPath: st.paycheck.exists ? `spice/finance/paychecks/${month}/Paycheck-${month}.md` : null,
            month,
        });

        // Row 3 — Deposits materialized (only meaningful once a paycheck exists).
        if (st.paycheck.exists) {
            this._row(root, dv, {
                state: st.paycheck.depositsMaterialized ? "ok" : "warn",
                label: st.paycheck.depositsMaterialized ? "Deposits materialized" : "Deposits not materialized yet",
                openPath: `spice/finance/paychecks/${month}/Paycheck-${month}.md`,
                month,
            });

            // Row 4 — Deposit tags (the Apple trap): untagged expenses fall to check 1.
            const untagged = st.guardrails.untaggedDeposits;
            this._row(root, dv, {
                state: untagged.count === 0 ? "ok" : "warn",
                label: untagged.count === 0
                    ? "Every expense deposit-tagged"
                    : `${untagged.count} expense${untagged.count === 1 ? "" : "s"} default to check 1: ${untagged.items.join(", ")}`,
                openPath: `spice/finance/paychecks/${month}/Paycheck-${month}.md`,
                month,
            });

            // Row 6 — Bills checked off (progress).
            const bills = st.bills;
            this._row(root, dv, {
                state: bills.total > 0 && bills.paidCount === bills.total ? "ok" : "warn",
                label: `Bills checked off — ${bills.paidCount}/${bills.total} (${bills.pct}%)`,
                openPath: `spice/finance/paychecks/${month}/Paycheck-${month}.md`,
                month,
            });
        }

        // Row 5 — Reconcile to income (meaningful once there is an income to
        // reconcile allocations against, i.e. a plan floor > 0).
        if (st.guardrails.reconcile.income > 0) {
            const rec = st.guardrails.reconcile;
            this._row(root, dv, {
                state: rec.ok ? "ok" : "warn",
                label: rec.ok
                    ? "Allocations reconcile to income"
                    : `Allocations over income by ${customJS.FinanceMath.fmtMoney(rec.deltaOver)}`,
                openPath: st.budget.exists ? `spice/finance/budgets/${month}/Budget-${month}.md` : null,
                month,
            });
        }
    }

    // ----------------------------------------------------------------- helpers

    _resolveMonth(page) {
        const m = customJS.FinanceMath && typeof customJS.FinanceMath._coerceMonthString === "function"
            ? customJS.FinanceMath._coerceMonthString(page.month)
            : (typeof page.month === "string" ? page.month.slice(0, 7) : null);
        if (m && /^\d{4}-\d{2}$/.test(m)) return m;
        const name = page.file && page.file.name;
        if (typeof name === "string") {
            const mm = name.match(/(\d{4}-\d{2})/);
            if (mm) return mm[1];
        }
        return null;
    }

    _glyph(state) {
        if (state === "ok") return { ch: "✓", color: "#16a34a" };   // ✓ green
        if (state === "warn") return { ch: "⚠", color: "#b45309" }; // ⚠ amber
        return { ch: "✗", color: "#dc2626" };                        // ✗ red
    }

    _row(root, dv, opts) {
        const row = root.createEl("div");
        row.style.cssText = "display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--background-modifier-border); font-size: 0.9em;";

        const g = this._glyph(opts.state);
        const glyph = row.createEl("span");
        glyph.textContent = g.ch;
        glyph.style.cssText = `flex: 0 0 auto; width: 1.2em; text-align: center; font-weight: 700; color: ${g.color};`;

        const labelEl = row.createEl("span");
        labelEl.textContent = opts.label;
        labelEl.style.cssText = "flex: 1; min-width: 0; color: var(--text-normal);";
        if (opts.openPath) {
            labelEl.style.cursor = "pointer";
            labelEl.onclick = () => { try { app.workspace.openLinkText(opts.openPath, ""); } catch (_e) { /* ignore */ } };
        }

        if (opts.createInstance) {
            const icon = customJS.Icons ? customJS.Icons.resolve(opts.createIcon) : null;
            customJS.AccentButton.render(row, {
                label: opts.createLabel,
                icon: icon || undefined,
                onClick: () => customJS.EntityCreate.create({ instance: opts.createInstance, dv, presetPrompts: { month: opts.month } }),
            });
        }
    }
}
