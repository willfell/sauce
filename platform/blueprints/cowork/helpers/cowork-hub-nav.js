/**
 * CoworkHubNav (CustomJS)
 * Renders a 4-card cross-hub navigation row at the top of cowork hubs:
 *   Cowork | Daily Hub | Weekly Hub | Monthly Hub
 *
 * The card matching the current note is rendered with a muted "you are here"
 * subtitle and is non-clickable. Other cards openLinkText to the target hub.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
 */
class CoworkHubNav {
  async render(dv) {
    if (dv.container.closest(".markdown-embed")) return;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const ICONS = {
      cowork:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
      daily:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      weekly:  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2M14 18h2"/></svg>`,
      monthly: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`
    };

    const cur = dv.current();
    const curBase = (cur && cur.file && cur.file.name) || "";

    const items = [
      { label: "Cowork",       path: "spice/cowork/Cowork.md",      _icon: ICONS.cowork  },
      { label: "Daily Hub",    path: "spice/cowork/Daily Hub.md",   _icon: ICONS.daily   },
      { label: "Weekly Hub",   path: "spice/cowork/Weekly Hub.md",  _icon: ICONS.weekly  },
      { label: "Monthly Hub",  path: "spice/cowork/Monthly Hub.md", _icon: ICONS.monthly }
    ].map(it => ({
      ...it,
      _isCurrent: curBase === it.label,
      file: { name: it.label, path: it.path }
    }));

    if (typeof window.customJS === "undefined" || !window.customJS.BeaconCards) {
      for (const it of items) {
        const marker = it._isCurrent ? " (you are here)" : "";
        dv.paragraph(`- [[${it.path}|${it.label}]]${marker}`);
      }
      return;
    }

    await window.customJS.BeaconCards.render(dv, {
      pages: items,
      title:    (p) => p.label,
      icon:     (p) => p._icon,
      subtitle: (p) => p._isCurrent ? "you are here" : null,
      target:   (p) => p.path,
      onClick:  (p) => { if (!p._isCurrent) app.workspace.openLinkText(p.path, ""); },
      layout: "row",
      columns: 4
    });
  }
}
