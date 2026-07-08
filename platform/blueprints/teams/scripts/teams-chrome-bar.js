/**
 * TeamsChromeBar (CustomJS) — the teams blueprint's ChromeBar adapter config.
 * Mirrors ProductsChromeBar exactly: TeamActionButtons is currently
 * unreferenced by any template/content file (dead code); this adapter's
 * primary button inlines the same Templater create_new_note_from_template
 * call so "+ New Team" actually works for the first time. Instance methods;
 * never-throw; cold-load-safe.
 */
class TeamsChromeBar {
  get ICON() {
    return {
      users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
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
    const ROOT = "spice/teams";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "teams-hub" && t !== "team") return null;
        return { context: t, path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "teams-hub") {
          return { primary: { id: "new-team", label: "New Team", icon: ICON.users }, overflow: [], leaf: false };
        }
        return { primary: null, overflow: [], leaf: true };
      },
      dispatch: async (dv, ctx, id) => {
        if (id !== "new-team") return;
        const templaterPlugin = app.plugins.plugins["templater-obsidian"];
        const template = app.vault.getAbstractFileByPath("ranch/templates/Template, Team.md");
        if (!templaterPlugin || !template) {
          if (typeof Notice === "function") new Notice("Templater + Template, Team.md required for + New Team.");
          return;
        }
        try {
          await templaterPlugin.templater.create_new_note_from_template(template, "spice/teams", undefined, true);
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (typeof Notice === "function") new Notice("Failed to create team: " + msg);
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This teams" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Teams.md";
        if (ctx.path !== hubPath) out.push({ label: "Teams", icon: ICON.users, _navTarget: hubPath, onSelect: () => open(hubPath) });
        return out;
      },
      rootClass: "teams-chrome-root",
      btnClass: (v) => `teams-chrome-btn teams-chrome-btn-${v}`,
    };
  }
}
