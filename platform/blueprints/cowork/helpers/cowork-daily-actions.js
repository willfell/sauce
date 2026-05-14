/**
 * CoworkDailyActions (CustomJS)
 * Renders a single AccentButton on the Daily Hub: "+ Today" — opens or
 * creates today's cowork daily note at
 *   spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD.md
 * via Templater from ranch/templates/Daily Note.md.
 *
 * Mirrors CoworkTimeframeButtons._dispatch's create-this-period semantics.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkDailyActions" });
 */
class CoworkDailyActions {
  async render(dv) {
    if (dv.container.closest(".markdown-embed")) return;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    if (typeof window.customJS === "undefined" || !window.customJS.AccentButton) {
      dv.paragraph("- Today's daily note (AccentButton mechanism missing)");
      return;
    }

    const now = window.moment();
    const day = now.format("YYYY-MM-DD");
    const folder = `spice/cowork/daily/${now.format("YYYY/MM-MMMM")}`;
    const filenameNoExt = day;
    const filepath = `${folder}/${filenameNoExt}.md`;

    const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 14v4M10 16h4"/></svg>`;

    const row = dv.container.createEl("div");
    row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 480px; flex-wrap: wrap;";

    const open = async () => {
      const existing = app.vault.getAbstractFileByPath(filepath);
      if (existing) { app.workspace.openLinkText(filepath, ""); return; }

      const tpPlugin = app.plugins.plugins["templater-obsidian"];
      if (!tpPlugin || !tpPlugin.templater) {
        new Notice("cowork-daily-actions: Templater plugin not enabled", 8000);
        return;
      }

      if (!app.vault.getAbstractFileByPath(folder)) {
        try {
          await app.vault.createFolder(folder);
        } catch (folderErr) {
          if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
            new Notice(`cowork-daily-actions: cannot create folder ${folder} — ${folderErr.message}`, 8000);
            return;
          }
        }
      }

      const templatePath = "ranch/templates/Daily Note.md";
      const templateFile = app.vault.getAbstractFileByPath(templatePath);
      if (!templateFile) {
        new Notice(`cowork-daily-actions: template not found at ${templatePath}`, 8000);
        return;
      }

      try {
        await tpPlugin.templater.create_new_note_from_template(templateFile, folder, filenameNoExt, true);
      } catch (err) {
        const msg = (err && err.message) || "";
        if (!/already exists|exists/i.test(msg)) {
          new Notice(`cowork-daily-actions: Templater create failed for ${filepath} — ${msg}`, 8000);
          return;
        }
        app.workspace.openLinkText(filepath, "");
      }
    };

    customJS.AccentButton.render(row, {
      label: "+ Today",
      icon: plusIcon,
      onClick: open,
      flex: true
    });
  }
}
