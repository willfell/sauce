class PeopleChromeBar {
  get ICON() {
    return {
      people: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
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
    const ROOT = "spice/people";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "people-hub" && t !== "person") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => ({ primary: null, overflow: [], leaf: ctx.context === "person" }),
      dispatch: (dv, ctx, id) => { /* no actions on this surface */ },
      destinations: (dv, ctx) => {
        const out = [{ section: "This people" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/People.md";
        if (ctx.path !== hubPath) out.push({ label: "People", icon: ICON.people, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "people-chrome-root",
      btnClass: (v) => `people-chrome-btn people-chrome-btn-${v}`,
    };
  }
}
