/**
 * BoardsChromeBar (CustomJS) — the boards blueprint's ChromeBar adapter
 * config. Board cards have a single surface (one card note per kanban
 * item, no hub, no nav beyond the global vault launcher) — no primary
 * action, no overflow, always leaf. Mirrors JournalChromeBar exactly.
 * Instance methods; never-throw; cold-load-safe.
 */
class BoardsChromeBar {
  get ICON() {
    return {
      trello: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><rect width="4" height="10" x="7" y="7" rx="1"/><rect width="4" height="6" x="13" y="7" rx="1"/></svg>`,
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
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "board-card") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: () => ({ primary: null, overflow: [], leaf: true }),
      dispatch: () => { /* no actions on this surface */ },
      destinations: () => [{ section: "This boards" }],
      rootClass: "boards-chrome-root",
      btnClass: (v) => `boards-chrome-btn boards-chrome-btn-${v}`,
    };
  }
}
