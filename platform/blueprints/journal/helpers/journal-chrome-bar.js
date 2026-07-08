/**
 * JournalChromeBar (CustomJS) — the journal blueprint's ChromeBar adapter
 * config. Journal has a single surface (one entry per day, no hub, no nav
 * beyond the global vault launcher) — no primary action, no overflow, always
 * leaf. This is the simplest adapter in the cycle-3 batch: it replaces the
 * bare SpaceNavButtons block that was the journal template's only chrome.
 * Instance methods; never-throw; cold-load-safe.
 */
class JournalChromeBar {
  get ICON() {
    return {
      notebook: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/></svg>`,
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
        if (t !== "journal") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: () => ({ primary: null, overflow: [], leaf: true }),
      dispatch: () => { /* no actions on this surface */ },
      destinations: () => [{ section: "This journal" }],
      rootClass: "journal-chrome-root",
      btnClass: (v) => `journal-chrome-btn journal-chrome-btn-${v}`,
    };
  }
}
