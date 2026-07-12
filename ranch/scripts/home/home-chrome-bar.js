/**
 * HomeChromeBar (CustomJS) — the home blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / ⋯ bar on Home.md via
 * customJS.ChromeBar.makeAdapter(this._config()), replacing SpaceNavButtons.
 * Sits ABOVE SpaceHome's existing bespoke greeting + quick-capture header,
 * which is completely untouched — no primary/overflow actions here (explicit
 * user decision, 2026-07-11 brainstorm). No dayNav — Home.md is a single
 * fixed page, not a per-day note, so the left slot renders nothing (empty
 * breadcrumb array — ChromeBar.render's existing empty-segments guard
 * already no-ops cleanly).
 */
class HomeChromeBar {
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
        const p = (page && page.file && page.file.path) || "";
        if (p !== "spice/home/Home.md") return null;
        return { path: p };
      },
      surfaceSpec: () => ({ primary: null, overflow: [] }),
      dispatch: () => {},
      destinations: () => ([]),
      rootClass: "home-chrome-root",
      btnClass: (v) => `home-chrome-btn home-chrome-btn-${v}`,
    };
  }
}
