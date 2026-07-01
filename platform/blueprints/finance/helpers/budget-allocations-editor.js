/**
 * BudgetAllocationsEditor — editable live/override Debt + Savings sections on
 * Budget atlas pages (finance "month reality", WS2).
 *
 * Renders a compact full-picture line (Income → Fixed → Debt → Savings →
 * Discretionary) atop an editable Debt section and Savings section. Each row is
 * live-derived from FinanceMath.budgetAllocations (plan allocation + savings
 * contribution) with per-row overrides pinned into the budget's
 * debt_allocations[] / savings_allocations[] frontmatter arrays.
 *
 * Body is fleshed out in Task 7. This stub establishes the class + registration
 * so the manifest/template wiring resolves and the block renders as a no-op.
 *
 * All writes via customJS.FinanceFrontmatter.update (atomic processFrontMatter).
 * Embed-deduped per v0.16.0 lesson.
 */
class BudgetAllocationsEditor {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;
        const previous = dv.container.querySelector(":scope > .bae-root");
        if (previous) previous.remove();
        // Implemented in Task 7.
    }
}
