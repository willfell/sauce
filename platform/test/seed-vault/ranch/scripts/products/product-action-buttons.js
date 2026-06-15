/**
 * ProductActionButtons (CustomJS)
 * Renders the "+ New Product" button on the Products hub (Products.md).
 * Mirrors NewPersonButton shape: AccentButton + Templater create_new_note_from_template.
 *
 * Per-product page actions (rename, delete) are out of scope for v0.39.0 — this
 * class only handles the hub-level "+ New Product" action. Per-product actions
 * can land in a future cycle if/when Tier 2 ops on Products are introduced.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "ProductActionButtons" });
 */
class ProductActionButtons {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    if (!customJS.AccentButton) {
      const warn = dv.container.createEl("div", { text: "accent-button mechanism not loaded" });
      warn.style.color = "var(--text-error)";
      return;
    }

    const packageIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4l-9-5.19"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

    const onClick = async () => {
      const templaterPlugin = dv.app.plugins.plugins["templater-obsidian"];
      const template = dv.app.vault.getAbstractFileByPath("ranch/templates/Template, Product.md");
      if (!templaterPlugin || !template) {
        new Notice("Templater + Template, Product.md required for + New Product.");
        return;
      }
      const templater = templaterPlugin.templater;
      try {
        // Filename is filled inside the template via `tp.file.rename(name)` after
        // prompting the user; pass undefined here so Templater opens the prompt.
        await templater.create_new_note_from_template(template, "spice/products", undefined, true);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        new Notice("Failed to create product: " + msg);
      }
    };

    customJS.AccentButton.render(dv.container, {
      label: "+ New Product",
      icon: packageIcon,
      onClick,
    });
  }
}
