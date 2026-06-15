/**
 * TeamActionButtons (CustomJS)
 * Renders the "+ New Team" button on the Teams hub (Teams.md).
 * Mirrors ProductActionButtons shape: AccentButton + Templater create_new_note_from_template.
 *
 * Per-team page actions (rename, delete) are out of scope for v0.39.0 — this
 * class only handles the hub-level "+ New Team" action. Per-team actions can
 * land in a future cycle if/when Tier 2 ops on Teams are introduced.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "TeamActionButtons" });
 */
class TeamActionButtons {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    if (!customJS.AccentButton) {
      const warn = dv.container.createEl("div", { text: "accent-button mechanism not loaded" });
      warn.style.color = "var(--text-error)";
      return;
    }

    const usersIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

    const onClick = async () => {
      const templaterPlugin = dv.app.plugins.plugins["templater-obsidian"];
      const template = dv.app.vault.getAbstractFileByPath("ranch/templates/Template, Team.md");
      if (!templaterPlugin || !template) {
        new Notice("Templater + Template, Team.md required for + New Team.");
        return;
      }
      const templater = templaterPlugin.templater;
      try {
        // Filename is filled inside the template via `tp.file.rename(name)` after
        // prompting the user; pass undefined here so Templater opens the prompt.
        await templater.create_new_note_from_template(template, "spice/teams", undefined, true);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        new Notice("Failed to create team: " + msg);
      }
    };

    customJS.AccentButton.render(dv.container, {
      label: "+ New Team",
      icon: usersIcon,
      onClick,
    });
  }
}
