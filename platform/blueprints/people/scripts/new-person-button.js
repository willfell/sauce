/**
 * NewPersonButton — AccentButton + overlay-dialog for creating a new person note.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "NewPersonButton" });
 *
 * Mirrors NewMeetingButton + NewBudgetButton precedent:
 *   - Embed-dedup short-circuit (suppress duplicates inside ![[X]] embeds).
 *   - AccentButton render via customJS.AccentButton.
 *   - Overlay-dialog single-field modal (Name).
 *   - Validation (non-empty + safe filename chars).
 *   - Templater create_new_note_from_template with race-tolerance try/catch.
 *   - Hardcoded "spice/people" target folder per landmine #19.
 */
class NewPersonButton {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;

    const userPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`;

    const openOverlay = () => {
      const overlay = document.createElement("div");
      overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";

      const dialog = document.createElement("div");
      dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; max-width: 480px; width: calc(100% - 32px); margin: 0 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); box-sizing: border-box;";

      const heading = document.createElement("div");
      heading.textContent = "New Person";
      heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
      dialog.appendChild(heading);

      const wrap = document.createElement("div");
      wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 16px;";
      const lab = document.createElement("label");
      lab.textContent = "Name";
      lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 60px;";
      wrap.appendChild(lab);
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Jane Doe";
      input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
      wrap.appendChild(input);
      dialog.appendChild(wrap);

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
      const closeOverlay = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
      cancelBtn.onclick = closeOverlay;

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";

      const onSave = async () => {
        const name = (input.value || "").trim();
        const safe = /^[A-Za-z0-9 .,\-'()]+$/;
        if (!name || !safe.test(name)) {
          new Notice("Name must be non-empty and avoid / \\ : * ? \" < > |");
          return;
        }

        const templaterPlugin = dv.app.plugins.plugins["templater-obsidian"];
        const template = dv.app.vault.getAbstractFileByPath("ranch/templates/Template, People.md");
        if (!templaterPlugin || !template) {
          new Notice("Templater + Template, People.md required for + New Person.");
          closeOverlay();
          return;
        }
        const templater = templaterPlugin.templater;

        closeOverlay();

        try {
          await templater.create_new_note_from_template(template, "spice/people", name, true);
        } catch (e) {
          const msg = (e && e.message) || String(e);
          if (/already exists/i.test(msg)) {
            await dv.app.workspace.openLinkText(name, "");
          } else {
            new Notice("Failed to create person: " + msg);
          }
        }
      };

      saveBtn.onclick = onSave;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") onSave();
        if (e.key === "Escape") cancelBtn.click();
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });
      document.body.appendChild(overlay);
      setTimeout(() => input.focus(), 0);
    };

    customJS.AccentButton.render(dv.container, {
      label: "+ New Person",
      icon: userPlusIcon,
      onClick: openOverlay,
    });
  }
}
