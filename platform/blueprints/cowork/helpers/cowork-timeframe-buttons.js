/**
 * CoworkTimeframeButtons (CustomJS)
 * Renders the inline Timeframes block on spice/cowork/Cowork.md.
 *
 * Five cards in one row (Candidate A from the v0.43.0 design):
 *   Daily Hub | Weekly Hub | This Week | Monthly Hub | This Month
 *
 * Behaviour:
 *   - 3 navigation cards default through BeaconCards' openLinkText to the hub.
 *   - 2 create-this-period cards mirror nav-buttons' runTemplaterTemplate
 *     semantics: if this-period's note exists, open it; otherwise Templater-create
 *     from ranch/templates/{Weekly Note,Monthly Note}.md, then open.
 *
 * Mirrors space-nav-buttons.js:323-382 (runTemplaterTemplate dispatch).
 */
class CoworkTimeframeButtons {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const now = window.moment();
    const year = now.format("YYYY");
    const isoWeekLabel = now.format("YYYY-[W]ww");
    const monthLabel   = now.format("YYYY-MM");

    const items = [
      { _kind: "openLink",      file: { name: "Daily Hub",    path: "spice/cowork/Daily Hub.md"   }, _subtitle: "Card index of dailies" },
      { _kind: "openLink",      file: { name: "Weekly Hub",   path: "spice/cowork/Weekly Hub.md"  }, _subtitle: "Card index of weekly notes" },
      { _kind: "createWeekly",  file: { name: "This Week",  path: `spice/cowork/weekly/${year}/${isoWeekLabel}.md` }, _subtitle: `Open or create ${isoWeekLabel}.md`, _templateSource: "ranch/templates/Weekly Note.md", _folder: `spice/cowork/weekly/${year}`, _filenameNoExt: isoWeekLabel },
      { _kind: "openLink",      file: { name: "Monthly Hub",  path: "spice/cowork/Monthly Hub.md" }, _subtitle: "Card index of monthly notes" },
      { _kind: "createMonthly", file: { name: "This Month", path: `spice/cowork/monthly/${year}/${monthLabel}.md` }, _subtitle: `Open or create ${monthLabel}.md`, _templateSource: "ranch/templates/Monthly Note.md", _folder: `spice/cowork/monthly/${year}`, _filenameNoExt: monthLabel }
    ];

    if (typeof window.customJS === "undefined" || !window.customJS.BeaconCards) {
      for (const it of items) dv.paragraph(`- [[${it.file.path}|${it.file.name}]] — ${it._subtitle}`);
      return;
    }

    await window.customJS.BeaconCards.render(dv, {
      pages: items,
      title: (p) => p.file.name,
      subtitle: (p) => p._subtitle,
      target: (p) => p.file.path,
      onClick: (p) => this._dispatch(p),
      columns: "auto"
    });
  }

  async _dispatch(item) {
    if (item._kind === "openLink") {
      app.workspace.openLinkText(item.file.path, "");
      return;
    }

    const existing = app.vault.getAbstractFileByPath(item.file.path);
    if (existing) {
      app.workspace.openLinkText(item.file.path, "");
      return;
    }

    const tpPlugin = app.plugins.plugins["templater-obsidian"];
    if (!tpPlugin || !tpPlugin.templater) {
      new Notice("cowork-timeframe-buttons: Templater plugin not enabled", 8000);
      return;
    }

    if (!app.vault.getAbstractFileByPath(item._folder)) {
      try {
        await app.vault.createFolder(item._folder);
      } catch (folderErr) {
        if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
          new Notice(`cowork-timeframe-buttons: cannot create folder ${item._folder} — ${folderErr.message}`, 8000);
          return;
        }
      }
    }

    const templateFile = app.vault.getAbstractFileByPath(item._templateSource);
    if (!templateFile) {
      new Notice(`cowork-timeframe-buttons: template not found at ${item._templateSource}`, 8000);
      return;
    }

    try {
      await tpPlugin.templater.create_new_note_from_template(templateFile, item._folder, item._filenameNoExt, true);
    } catch (err) {
      const msg = (err && err.message) || "";
      if (!/already exists|exists/i.test(msg)) {
        new Notice(`cowork-timeframe-buttons: Templater create failed for ${item.file.path} — ${msg}`, 8000);
        return;
      }
      app.workspace.openLinkText(item.file.path, "");
    }
  }
}
