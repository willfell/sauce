class PeopleChromeBar {
  get ICON() {
    return {
      people: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      userPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>`,
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
      // "+ New Person" is the hub's own primary button (right of the compass) —
      // its old standalone EntityCreate block was retired (see People.md /
      // applyNoteChromeHeal's people-hub step). Person leaf notes create nothing.
      surfaceSpec: (ctx) => ({
        primary: ctx.context === "people-hub" ? { id: "new-person", label: "+ New Person", icon: ICON.userPlus } : null,
        overflow: [],
        leaf: ctx.context === "person",
      }),
      dispatch: (dv, ctx, id) => {
        if (id !== "new-person") return;
        try {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "person", dv });
          } else if (typeof Notice === "function") { new Notice("PeopleChromeBar: EntityCreate unavailable — reinstall people blueprint.", 6000); }
        } catch (_e) { /* never throw */ }
      },
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
