/**
 * ReaderChromeBar (CustomJS) — the reader blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on reader surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Absorbs ReaderArticleActions'
 * status-transition row (Open article ↗ + the current status's transition
 * buttons) into the ⋯ overflow menu — reuses
 * ReaderArticleActions.statusTransitions(status) and ._setStatus(path, next)
 * directly, no new transition logic. The hub's
 * "+ New article" button dispatches to the same EntityCreate call
 * ReaderArticleActions.renderCreateRow already uses (which stays active,
 * unchanged, for ReaderQueue). Instance methods; never-throw; cold-load-safe.
 */
class ReaderChromeBar {
  get ICON() {
    return {
      filePlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>`,
      external: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
      book: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
      check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
      home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  // Status-transition pairs for the CURRENT status. Delegates to
  // ReaderArticleActions.statusTransitions — the single source of truth for
  // the labels/literals. No local mirror: when customJS isn't reachable
  // (cold-load ordering before other classes register, or a test context that
  // never stubs customJS), this degrades to an empty list rather than
  // duplicating the table. Never throws.
  _statusTransitions(status) {
    try {
      if (typeof customJS !== "undefined" && customJS && customJS.ReaderArticleActions
        && typeof customJS.ReaderArticleActions.statusTransitions === "function") {
        return customJS.ReaderArticleActions.statusTransitions(status) || [];
      }
    } catch (_e) { /* fall through to empty */ }
    return [];
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/reader";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "reader-hub" && t !== "reader-article") return null;
        return {
          context: t,
          path: (page.file && page.file.path) || "",
          url: page.url != null ? String(page.url).trim() : "",
          status: page.status != null ? String(page.status).trim().toLowerCase() : "unread",
        };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "reader-hub") {
          return { primary: { id: "new-article", label: "+ New article", icon: ICON.filePlus }, overflow: [], leaf: false };
        }
        const overflow = [];
        if (ctx.url) overflow.push({ id: "open-article", label: "Open article ↗", icon: ICON.external });
        const transitions = this._statusTransitions(ctx.status);
        for (const t of transitions) {
          overflow.push({ id: "status-" + t.next, label: t.label, icon: t.next === "archived" ? ICON.check : ICON.book });
        }
        return { primary: null, overflow, leaf: true };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-article") {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "reader-article", dv });
          } else if (typeof Notice === "function") { new Notice("ReaderChromeBar: EntityCreate unavailable — reinstall reader blueprint.", 6000); }
          return;
        }
        if (id === "open-article") {
          if (ctx.url) { try { window.open(ctx.url, "_blank", "noopener"); } catch (_e) {} }
          return;
        }
        if (id && id.indexOf("status-") === 0) {
          const next = id.slice("status-".length);
          if (customJS && customJS.ReaderArticleActions && typeof customJS.ReaderArticleActions._setStatus === "function") {
            customJS.ReaderArticleActions._setStatus(ctx.path, next);
          } else if (typeof Notice === "function") { new Notice("ReaderChromeBar: ReaderArticleActions unavailable — reinstall reader blueprint.", 6000); }
          return;
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This reader" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Reader.md";
        if (ctx.path !== hubPath) out.push({ label: "Reader Hub", icon: ICON.home, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "reader-chrome-root",
      btnClass: (v) => `reader-chrome-btn reader-chrome-btn-${v}`,
    };
  }
}
