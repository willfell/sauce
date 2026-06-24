/**
 * PlanBand v0.10.0 — the income-bound envelope flag at the top of every Budget note.
 * Marker comment used by installer migration: <!-- plan-band-v0.10.0 -->
 *
 * A thin read-only VIEW of customJS.FinanceMath.computePlanState for this budget's
 * month. Shows the computed envelope ceiling vs the budget's planned total and flags
 * red when the plan is underwater (planned > effective envelope). This is the
 * G1/G2/G8 "stop spending more than you make" warning, living where the monthly plan
 * happens. Renders nothing (silently) when no Finance Plan exists.
 *
 * CSS root: planband-root. Embed-deduped. Never writes.
 */
class PlanBand {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".planband-root");
            if (prev) prev.remove();
        }
        const page = dv.current() || {};
        if (page.type !== "budget") return;

        const fm = customJS.FinanceMath;
        if (!fm || !fm.computePlanState) return;
        const monthKey = fm._coerceMonthString ? fm._coerceMonthString(page.month) : page.month;
        const ps = fm.computePlanState(dv, monthKey);
        if (!ps || !ps.ok) return; // no plan → render nothing (degrade-gracefully)

        const e = ps.envelope;
        const money = (n, opts) => fm.fmtMoney(n, opts);
        const GREEN = "#16a34a", RED = "#dc2626";
        const over = e.governed && e.over > 0;

        const root = dv.container.createEl("div", { cls: "planband-root" });
        root.style.cssText = `margin: 10px 0 14px; padding: 10px 14px; border-radius: 10px; border: 1px solid ${over ? "rgba(220,38,38,0.35)" : "var(--background-modifier-border)"}; background: ${over ? "rgba(220,38,38,0.08)" : "var(--background-secondary-alt)"};`;

        const head = root.createEl("div");
        head.style.cssText = "display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 0.86em; font-variant-numeric: tabular-nums;";
        const left = head.createEl("span");
        left.innerHTML = `<span style="color: var(--text-muted);">Envelope</span> <b>${money(e.effective)}</b>` +
            (e.overageCarry > 0 ? ` <span style="color: var(--text-muted);">(base ${money(e.base)} − carry ${money(e.overageCarry)})</span>` : "") +
            ` &nbsp;·&nbsp; <span style="color: var(--text-muted);">Planned</span> <b>${money(e.planned)}</b>`;
        const right = head.createEl("span");
        right.innerHTML = `<span style="color: var(--text-muted);">Left</span> <b style="color: ${e.left < 0 ? RED : GREEN};">${money(e.left)}</b>`;

        if (over) {
            const flag = root.createEl("div");
            flag.textContent = `⚠ OVER ENVELOPE by ${money(e.over)} — trim a discretionary category, or this overage reduces next month's envelope.`;
            flag.style.cssText = `margin-top: 6px; color: ${RED}; font-size: 0.82em;`;
        } else if (!e.governed) {
            const note = root.createEl("div");
            note.textContent = `Baseline month — not scored against the envelope (governed from ${e.governedFrom || "—"}).`;
            note.style.cssText = "margin-top: 6px; color: var(--text-muted); font-size: 0.8em;";
        }
    }
}
