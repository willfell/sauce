/**
 * New Meeting Button (CustomJS)
 * Creates a button to add new meeting notes with date prefix.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "NewMeetingButton" });
 */
class NewMeetingButton {
  async render(dv) {
    const currentFile = dv.current();
    const dateMatch = currentFile.file.name.match(/(\d{4}-\d{2}-\d{2})/);
    const currentDateStr = dateMatch ? dateMatch[1] : window.moment().format("YYYY-MM-DD");

    // (no spacePrefix — beacon has no Life/ namespace)
    const datePart = window.moment(currentDateStr);
    const folder = `beacon/meetings/notes/${datePart.format("YYYY")}/${datePart.format("MM-MMMM")}`;

    const newMeetingIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>`;

    const inputModal = (promptText) => {
      return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-container";
        overlay.style.cssText = "position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center;";

        const bg = document.createElement("div");
        bg.className = "modal-bg";
        bg.style.cssText = "position: absolute; inset: 0; background: var(--background-modifier-cover); opacity: 0.8;";
        overlay.appendChild(bg);

        const modal = document.createElement("div");
        modal.className = "modal";
        modal.style.cssText = "position: relative; background: var(--background-primary); border-radius: 8px; padding: 20px; min-width: 300px; max-width: 500px; box-shadow: 0 4px 24px rgba(0,0,0,0.3);";
        overlay.appendChild(modal);

        const title = document.createElement("h3");
        title.textContent = promptText;
        title.style.cssText = "margin: 0 0 16px 0; color: var(--text-normal);";
        modal.appendChild(title);

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Enter meeting title...";
        input.style.cssText = "width: 100%; padding: 8px 12px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-primary); color: var(--text-normal); font-size: 14px; box-sizing: border-box; margin-bottom: 16px;";
        modal.appendChild(input);

        const btnContainer = document.createElement("div");
        btnContainer.style.cssText = "display: flex; justify-content: flex-end; gap: 8px;";
        modal.appendChild(btnContainer);

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "padding: 8px 16px; border-radius: 4px; border: none; background: var(--background-modifier-hover); color: var(--text-normal); cursor: pointer;";
        btnContainer.appendChild(cancelBtn);

        const createBtn = document.createElement("button");
        createBtn.textContent = "Create";
        createBtn.style.cssText = "padding: 8px 16px; border-radius: 4px; border: none; background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer;";
        btnContainer.appendChild(createBtn);

        const cleanup = (result) => {
          overlay.remove();
          resolve(result);
        };

        bg.addEventListener("click", () => cleanup(null));
        cancelBtn.addEventListener("click", () => cleanup(null));
        createBtn.addEventListener("click", () => {
          if (input.value.trim()) cleanup(input.value.trim());
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && input.value.trim()) {
            cleanup(input.value.trim());
          } else if (e.key === "Escape") {
            cleanup(null);
          }
        });

        document.body.appendChild(overlay);
        input.focus();
      });
    };

    const container = dv.el("div", "");
    const btn = container.createEl("button");
    btn.innerHTML = newMeetingIcon + `<span style="margin-left: 8px;">New Meeting</span>`;
    btn.style.cssText = "cursor: pointer; padding: 12px 24px; border-radius: 8px; font-size: 1em; display: inline-flex; align-items: center; justify-content: center;";
    btn.onclick = async () => {
      const title = await inputModal("Meeting title:");
      if (!title) return;

      const meetingFilename = `${title}-${currentDateStr}`;
      const template = app.vault.getAbstractFileByPath("Docs/Meta/Templates/Meeting.md");
      if (template) {
        const templater = app.plugins.plugins["templater-obsidian"];
        await templater.templater.create_new_note_from_template(template, folder, meetingFilename, true);
      }
    };
  }
}
