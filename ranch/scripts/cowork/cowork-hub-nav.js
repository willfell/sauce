/**
 * CoworkHubNav (CustomJS)
 * Renders a centered flex row of AccentButtons for cross-hub navigation:
 *   Cowork | Daily Hub | Weekly Hub | Monthly Hub
 *
 * The button corresponding to the CURRENT note is omitted (so each hub
 * renders 3 buttons pointing at the other 3). Mirrors ScratchDayActions
 * aesthetic.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
 */
class CoworkHubNav {
  async render(dv) {
    if (dv.container.closest(".markdown-embed")) return;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const ICONS = {
      cowork:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
      daily:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      weekly:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2M14 18h2"/></svg>`,
      monthly: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`
    };

    const cur = dv.current();
    const curBase = (cur && cur.file && cur.file.name) || "";

    const all = [
      { key: "cowork",  label: "Cowork",       path: "spice/cowork/Cowork.md",      icon: ICONS.cowork  },
      { key: "daily",   label: "Daily Hub",    path: "spice/cowork/Daily Hub.md",   icon: ICONS.daily   },
      { key: "weekly",  label: "Weekly Hub",   path: "spice/cowork/Weekly Hub.md",  icon: ICONS.weekly  },
      { key: "monthly", label: "Monthly Hub",  path: "spice/cowork/Monthly Hub.md", icon: ICONS.monthly }
    ];
    const buttons = all.filter(it => curBase !== it.label);

    if (typeof window.customJS === "undefined" || !window.customJS.AccentButton) {
      for (const it of buttons) dv.paragraph(`- [[${it.path}|${it.label}]]`);
      return;
    }

    const row = dv.container.createEl("div");
    row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 720px; flex-wrap: wrap;";

    for (const it of buttons) {
      customJS.AccentButton.render(row, {
        label: it.label,
        icon: it.icon,
        onClick: () => app.workspace.openLinkText(it.path, ""),
        flex: true
      });
    }
  }
}
