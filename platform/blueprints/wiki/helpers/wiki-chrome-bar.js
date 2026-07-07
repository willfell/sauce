/**
 * WikiChromeBar (CustomJS) — the wiki blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on wiki surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Reuses the EXISTING wiki
 * helpers for actions (EntityCreate for New Page/New Section, WikiLeafActions
 * for Move + parent-section resolution) — no new action code. Instance methods;
 * never-throw; cold-load-safe.
 */
class WikiChromeBar {
  get ICON() {
    return {
      folderPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
      filePlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>`,
      move: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
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
    const ROOT = "spice/wiki";
    return {
      // Classify by frontmatter type; null → not a wiki surface (render nothing).
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "wiki-hub" && t !== "wiki-section" && t !== "wiki-page") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "wiki-page") {
          return { primary: null, overflow: [{ id: "move", label: "Move", icon: ICON.move }], leaf: true };
        }
        // wiki-hub / wiki-section
        return {
          primary: { id: "new-page", label: "New Page", icon: ICON.filePlus },
          overflow: [{ id: "new-section", label: "New Section", icon: ICON.folderPlus }],
          leaf: false,
        };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-page" || id === "new-section") {
          const instance = id === "new-page" ? "wiki-page" : "wiki-section";
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance, dv });
          } else if (typeof Notice === "function") { new Notice("WikiChromeBar: EntityCreate unavailable — reinstall wiki blueprint.", 6000); }
          return;
        }
        if (id === "move") {
          let cur = null; try { cur = dv && dv.current ? dv.current() : null; } catch (_e) { cur = null; }
          const p = (cur && cur.file && cur.file.path) || (ctx && ctx.path) || "";
          if (customJS && customJS.WikiLeafActions && typeof customJS.WikiLeafActions._openMoveDialog === "function") {
            customJS.WikiLeafActions._openMoveDialog(dv, p);
          } else if (typeof Notice === "function") { new Notice("WikiChromeBar: WikiLeafActions unavailable — reinstall wiki blueprint.", 6000); }
          return;
        }
      },
      // The Go ▾ "This wiki" section: Wiki home + (on section/page) the parent
      // section hub. Reuses WikiLeafActions._resolveSectionHub. The current surface
      // omits its own self-link.
      destinations: (dv, ctx) => {
        const out = [{ section: "This wiki" }];
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const wikiHome = ROOT + "/Wiki.md";
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        // Wiki home — omit when we ARE the root hub.
        if (curPath !== wikiHome) {
          out.push({ label: "Wiki", icon: ICON.filePlus, _navTarget: wikiHome, onSelect: () => open(wikiHome) });
        }
        // Up to parent section (section/page only), via the existing resolver.
        if (ctx.context !== "wiki-hub" && curPath) {
          const folder = curPath.slice(0, curPath.lastIndexOf("/"));
          const parent = ctx.context === "wiki-section" ? folder.slice(0, folder.lastIndexOf("/")) : folder;
          if (parent && parent !== ROOT && parent.startsWith(ROOT + "/")
            && customJS && customJS.WikiLeafActions && typeof customJS.WikiLeafActions._resolveSectionHub === "function") {
            try {
              const hub = customJS.WikiLeafActions._resolveSectionHub(dv, parent);
              if (hub && hub.path && hub.path !== curPath) {
                out.push({ label: hub.label, icon: ICON.folderPlus, _navTarget: hub.path, onSelect: () => open(hub.path) });
              }
            } catch (_e) { /* best-effort up-nav */ }
          }
        }
        return out;
      },
      rootClass: "wiki-chrome-root",
      btnClass: (v) => `wiki-chrome-btn wiki-chrome-btn-${v}`,
    };
  }
}
