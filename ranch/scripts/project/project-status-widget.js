/**
 * Project Status Widget (CustomJS)
 * Renders a colored status chip on the project hub; click → 7-option
 * popup → writes back status + status_changed_at via processFrontMatter.
 *
 * Usage in DataviewJS (atlas note):
 *   await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
 */
class ProjectStatusWidget {
    async render(dv) {
        const STATUSES = ["idea", "planning", "in-progress", "blocked", "superseded", "cancelled", "done"];
        const COLORS = {
            idea:        "var(--text-muted)",
            planning:    "var(--color-blue)",
            "in-progress": "var(--color-green)",
            blocked:     "var(--color-red)",
            superseded:  "var(--color-orange)",
            cancelled:   "var(--text-faint)",
            done:        "var(--color-purple)",
        };

        const current = dv.current();
        if (!current || !current.file) return;
        const filePath = current.file.path;
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!file) return;

        const currentStatus = current.status || "idea";
        const updatedAt = current.status_changed_at
            ? (typeof current.status_changed_at === "string"
                ? current.status_changed_at
                : (current.status_changed_at.toISODate
                    ? current.status_changed_at.toISODate()
                    : String(current.status_changed_at)))
            : "";

        // Dedupe re-renders (Dataview re-fires on frontmatter writes).
        const previousRoot = dv.container.querySelector(":scope > .psw-root");
        if (previousRoot) previousRoot.remove();
        const root = dv.container.createEl("div", { cls: "psw-root" });

        const row = root.createEl("div");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; margin: 4px 0; padding: 0 2px; flex-wrap: wrap;";

        row.createEl("span", { text: "Status:" }).style.cssText = "font-size: 0.82em; color: var(--text-muted);";

        const chipColor = COLORS[currentStatus] || "var(--text-muted)";
        const chip = row.createEl("button");
        chip.innerHTML = `<span>${currentStatus}</span><span style="margin-left:6px;opacity:0.7;">▼</span>`;
        chip.style.cssText = `
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            background: ${chipColor}1A;
            color: ${chipColor};
            border: 1px solid ${chipColor}40;
            border-radius: 10px;
            padding: 2px 10px;
            font-size: 0.85em;
            font-weight: 600;
            white-space: nowrap;
            transition: all 0.15s ease;
        `;
        chip.onmouseenter = () => { chip.style.background = `${chipColor}33`; };
        chip.onmouseleave = () => { chip.style.background = `${chipColor}1A`; };

        if (updatedAt) {
            const upd = row.createEl("span", { text: `Updated ${updatedAt}` });
            upd.style.cssText = "font-size: 0.75em; color: var(--text-muted); margin-left: 4px;";
        }

        chip.onclick = () => this._openPicker(file, currentStatus, STATUSES, COLORS);
    }

    _openPicker(file, currentStatus, STATUSES, COLORS) {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";

        const dialog = document.createElement("div");
        dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 20px; min-width: 260px; max-width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 8px;";

        const heading = document.createElement("div");
        heading.textContent = "Set project status";
        heading.style.cssText = "font-size: 1em; font-weight: 600; margin-bottom: 6px;";
        dialog.appendChild(heading);

        for (const s of STATUSES) {
            const c = COLORS[s] || "var(--text-muted)";
            const btn = document.createElement("button");
            btn.innerHTML = `<span>${s}</span>` + (s === currentStatus ? ` <span style="opacity:0.7;font-size:0.85em;">(current)</span>` : "");
            btn.style.cssText = `
                cursor: ${s === currentStatus ? "default" : "pointer"};
                text-align: left;
                background: ${c}1A;
                color: ${c};
                border: 1px solid ${c}40;
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 0.9em;
                font-weight: 500;
                opacity: ${s === currentStatus ? "0.6" : "1"};
                transition: all 0.15s ease;
            `;
            if (s !== currentStatus) {
                btn.onmouseenter = () => { btn.style.background = `${c}33`; };
                btn.onmouseleave = () => { btn.style.background = `${c}1A`; };
                btn.onclick = async () => {
                    overlay.remove();
                    await this._writeStatus(file, s);
                };
            }
            dialog.appendChild(btn);
        }

        const cancelRow = document.createElement("div");
        cancelRow.style.cssText = "display: flex; justify-content: flex-end; margin-top: 6px;";
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "cursor: pointer; background: transparent; color: var(--text-muted); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 12px; font-size: 0.85em;";
        cancelBtn.onclick = () => overlay.remove();
        cancelRow.appendChild(cancelBtn);
        dialog.appendChild(cancelRow);

        overlay.appendChild(dialog);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
        const escHandler = (e) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", escHandler); } };
        document.addEventListener("keydown", escHandler);

        document.body.appendChild(overlay);
    }

    async _writeStatus(file, newStatus) {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        try {
            await app.fileManager.processFrontMatter(file, fm => {
                fm.status = newStatus;
                fm.status_changed_at = today;
            });
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            console.error("ProjectStatusWidget: failed to write status — " + msg);
            new Notice("Failed to update project status: " + msg, 8000);
        }
    }
}
