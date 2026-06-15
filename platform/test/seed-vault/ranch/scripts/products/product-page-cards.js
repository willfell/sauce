/**
 * Product Page Cards (CustomJS) — STUB shipped in v0.39.0 S2.3.
 * Full implementation (Teams under this Product + Projects touching this Product)
 * lands in S8. Stub renders a placeholder so the Templater-materialized Product
 * page doesn't error on the customjs invocation.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "ProductPageCards" });
 */
class ProductPageCards {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    const stub = dv.container.createEl("div", {
      text: "Rollup pending — full Teams + Projects view ships in v0.39.0 S8."
    });
    stub.style.cssText = "color: var(--text-muted); font-style: italic; padding: 8px;";
  }
}
