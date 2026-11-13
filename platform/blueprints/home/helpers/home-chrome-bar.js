/**
 * HomeChromeBar (CustomJS) — the home blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / ⋯ bar on Home.md via
 * customJS.ChromeBar.makeAdapter(this._config()), replacing SpaceNavButtons.
 * Sits ABOVE SpaceHome's existing bespoke greeting + quick-capture header,
 * which is completely untouched — no primary/overflow actions here (explicit
 * user decision, 2026-07-11 brainstorm). One icon action: the Jump search,
 * which opens customJS.TaskJump. No dayNav — Home.md is a single
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
    const SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;
    return {
      detect: (dv, page) => {
        const p = (page && page.file && page.file.path) || "";
        if (p !== "spice/home/Home.md") return null;
        return { path: p };
      },
      surfaceSpec: () => ({
        primary: null,
        overflow: [],
        quickAdd: false,
        iconActions: [{ id: "jump", label: "Jump to task or note", icon: SEARCH }],
      }),
      dispatch: (dv, ctx, id) => {
        if (id !== "jump") return;
        try { window.customJS.TaskJump.open(); }
        catch (e) { if (typeof Notice === "function") new Notice("Could not open Jump: " + (e.message || e), 6000); }
      },
      destinations: () => ([]),
      rootClass: "home-chrome-root",
      btnClass: (v) => `home-chrome-btn home-chrome-btn-${v}`,
    };
  }
}
