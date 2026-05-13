/**
 * Team Page Cards (CustomJS) — STUB shipped in v0.39.0 S4.3.
 * Full implementation (Sibling Teams under the same Product + member Projects
 * that tag this team) lands in S8. Stub renders a placeholder so the
 * Templater-materialized Team page doesn't error on the customjs invocation.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "TeamPageCards" });
 */
class TeamPageCards {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    const stub = dv.container.createEl("div", {
      text: "Rollup pending — full Sibling Teams + Projects view ships in v0.39.0 S8."
    });
    stub.style.cssText = "color: var(--text-muted); font-style: italic; padding: 8px;";
  }
}
