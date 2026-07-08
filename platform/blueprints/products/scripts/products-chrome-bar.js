/**
 * ProductsChromeBar (CustomJS) — the products blueprint's ChromeBar adapter
 * config. Renders the shared Go ▾ / primary bar on product surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). ProductActionButtons is
 * currently unreferenced by any template/content file (dead code) — this
 * adapter's primary button inlines the same Templater
 * create_new_note_from_template call so "+ New Product" actually works for
 * the first time. Instance methods; never-throw; cold-load-safe.
 */
class ProductsChromeBar {
  get ICON() {
    return {
      package: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/products";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "products-hub" && t !== "product") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "products-hub") {
          return { primary: { id: "new-product", label: "New Product", icon: ICON.package }, overflow: [], leaf: false };
        }
        return { primary: null, overflow: [], leaf: true };
      },
      dispatch: async (dv, ctx, id) => {
        if (id !== "new-product") return;
        const templaterPlugin = app.plugins.plugins["templater-obsidian"];
        const template = app.vault.getAbstractFileByPath("ranch/templates/Template, Product.md");
        if (!templaterPlugin || !template) {
          if (typeof Notice === "function") new Notice("Templater + Template, Product.md required for + New Product.");
          return;
        }
        try {
          await templaterPlugin.templater.create_new_note_from_template(template, "spice/products", undefined, true);
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (typeof Notice === "function") new Notice("Failed to create product: " + msg);
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This products" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Products.md";
        if (ctx.path !== hubPath) out.push({ label: "Products", icon: ICON.package, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "products-chrome-root",
      btnClass: (v) => `products-chrome-btn products-chrome-btn-${v}`,
    };
  }
}
