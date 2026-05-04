/**
 * SpaceNavButtons (CustomJS) — v2.0.0
 *
 * Thin renderer over Docs/Meta/nav-buttons-registry.json. Each blueprint or
 * mechanism declares nav_buttons[] in its manifest; the installer aggregates
 * declarations into the registry namespaced under contributions.<source>.
 * This class reads the registry at render time, sorts entries by (order,
 * source, id), and dispatches click on action.type.
 *
 * Action types (v0.4.0):
 *   - openLink             { target }
 *   - createFromTemplate   { target, template_source }
 *   - runTemplaterTemplate { template_source, folder, filename }
 *
 * For runTemplaterTemplate, folder + filename are moment.format strings
 * resolved at click-time. Square brackets escape literals (e.g., "[ToDo]").
 * Idempotent: re-click on same day opens the existing dated file.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
 */
class SpaceNavButtons {
  async render(dv) {
    // ── Icons (Lucide, 15x15 stroke-based) ──────────────────────────────
    const ICONS = {
      board:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/></svg>`,
      daily:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      todo:     `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      meetings: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      summary:  `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      projects: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
      planning: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`,
      plus:     `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`
    };

    const fallbackIcon = (label) =>
      `<span class="nav-fallback-icon">${(label && label[0] || "?").toUpperCase()}</span>`;

    // ── Read registry ────────────────────────────────────────────────────
    const REGISTRY_PATH = "Docs/Meta/nav-buttons-registry.json";
    let registry;
    try {
      const raw = await app.vault.adapter.read(REGISTRY_PATH);
      try {
        registry = JSON.parse(raw);
      } catch (parseErr) {
        dv.el("div", `[nav-buttons] registry parse error: ${parseErr.message}`, { cls: "nav-error" });
        return;
      }
    } catch (readErr) {
      const msg = (readErr && readErr.message) || String(readErr);
      // ENOENT (or any "not found"-shaped error) → empty install, render nothing.
      if (/ENOENT|not\s*found|no such file/i.test(msg)) return;
      dv.el("div", `[nav-buttons] registry read error: ${msg}`, { cls: "nav-error" });
      return;
    }

    // ── Flatten + sort ───────────────────────────────────────────────────
    const entries = [];
    for (const [source, btns] of Object.entries(registry.contributions || {})) {
      if (!Array.isArray(btns)) continue;
      for (const btn of btns) entries.push({ ...btn, _source: source });
    }
    entries.sort((a, b) =>
      (a.order ?? 100) - (b.order ?? 100) ||
      a._source.localeCompare(b._source) ||
      a.id.localeCompare(b.id)
    );
    if (entries.length === 0) return;

    // ── Render container (carry-over grid styling from v1.0.0) ───────────
    // Guard against Dataview double-execution.
    const existingNav = dv.container.querySelector(".vault-nav");
    if (existingNav) existingNav.remove();

    const container = dv.el("div", "", { cls: "vault-nav" });
    container.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 4px 0 12px 0;
    `;

    const rowStyle = `
      display: flex;
      flex-wrap: nowrap;
      gap: 6px;
    `;

    const btnBase = `
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-primary);
      color: var(--text-muted);
      font-size: 0.82em;
      font-weight: 500;
      font-family: inherit;
      letter-spacing: 0.01em;
      transition: all 0.15s ease;
      min-width: 0;
      flex: 1;
    `;

    // Mobile splits across more rows; desktop uses 2 rows.
    const isMobile = app.isMobile;
    const rowCount = isMobile ? 3 : 2;
    const baseSize = Math.floor(entries.length / rowCount);
    const remainder = entries.length % rowCount;
    const rows = [];
    let idx = 0;
    for (let r = 0; r < rowCount; r++) {
      const size = baseSize + (r < remainder ? 1 : 0);
      if (size > 0) rows.push(entries.slice(idx, idx + size));
      idx += size;
    }

    const btnGrid = container.createEl("div");
    btnGrid.style.cssText = `display: flex; flex-direction: column; gap: 6px;`;

    for (const rowButtons of rows) {
      const row = btnGrid.createEl("div");
      row.style.cssText = rowStyle;

      for (const btn of rowButtons) {
        const el = row.createEl("button");
        const iconHtml = ICONS[btn.icon] || fallbackIcon(btn.label);
        el.innerHTML = iconHtml + `<span>${btn.label}</span>`;
        el.style.cssText = btnBase;

        el.onmouseenter = () => {
          el.style.background = "var(--interactive-accent)";
          el.style.color = "var(--text-on-accent)";
          el.style.borderColor = "var(--interactive-accent)";
        };
        el.onmouseleave = () => {
          el.style.background = "var(--background-primary)";
          el.style.color = "var(--text-muted)";
          el.style.borderColor = "var(--background-modifier-border)";
        };

        el.onclick = () => this._dispatchAction(btn);
      }
    }
  }

  // ── Action dispatcher ──────────────────────────────────────────────────
  async _dispatchAction(btn) {
    const action = (btn && btn.action) || {};
    const type = action.type;

    if (type === "openLink") {
      app.workspace.openLinkText(action.target, "");
      return;
    }

    if (type === "createFromTemplate") {
      // If target already exists, just open it.
      const existing = app.vault.getAbstractFileByPath(action.target);
      if (existing) {
        app.workspace.openLinkText(action.target, "");
        return;
      }

      // Read template body. If missing, Notice and abort (no empty file).
      let body;
      try {
        body = await app.vault.adapter.read(action.template_source);
      } catch (err) {
        new Notice(`nav-buttons: cannot read template ${action.template_source} (from ${btn._source}) — ${err.message}`, 8000);
        return;
      }

      // Ensure parent folder exists.
      const folder = action.target.split("/").slice(0, -1).join("/");
      if (folder && !app.vault.getAbstractFileByPath(folder)) {
        try {
          await app.vault.createFolder(folder);
        } catch (folderErr) {
          // Race: another caller may have just created it. Ignore "exists" errors.
          if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
            new Notice(`nav-buttons: cannot create folder ${folder} — ${folderErr.message}`, 8000);
            return;
          }
        }
      }

      // Create the file. Race: concurrent click may have already created it —
      // treat "already exists" as success and open.
      try {
        await app.vault.create(action.target, body);
      } catch (createErr) {
        const msg = (createErr && createErr.message) || "";
        if (!/already exists|exists/i.test(msg)) {
          new Notice(`nav-buttons: cannot create ${action.target} — ${msg}`, 8000);
          return;
        }
      }
      app.workspace.openLinkText(action.target, "");
      return;
    }

    if (type === "runTemplaterTemplate") {
      const tpPlugin = app.plugins.plugins["templater-obsidian"];
      if (!tpPlugin || !tpPlugin.templater) {
        new Notice(`nav-buttons: Templater plugin not enabled (from ${btn._source})`, 8000);
        return;
      }

      const folder = (action.folder || "").trim()
        ? window.moment().format(action.folder)
        : "";
      const filenameNoExt = (action.filename || "").trim()
        ? window.moment().format(action.filename)
        : "Untitled";
      const target = folder ? `${folder}/${filenameNoExt}.md` : `${filenameNoExt}.md`;

      const existingTarget = app.vault.getAbstractFileByPath(target);
      if (existingTarget) {
        app.workspace.openLinkText(target, "");
        return;
      }

      if (folder && !app.vault.getAbstractFileByPath(folder)) {
        try {
          await app.vault.createFolder(folder);
        } catch (folderErr) {
          if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
            new Notice(`nav-buttons: cannot create folder ${folder} — ${folderErr.message}`, 8000);
            return;
          }
        }
      }

      const templateFile = app.vault.getAbstractFileByPath(action.template_source);
      if (!templateFile) {
        new Notice(`nav-buttons: template not found at ${action.template_source} (from ${btn._source})`, 8000);
        return;
      }

      try {
        await tpPlugin.templater.create_new_note_from_template(templateFile, folder, filenameNoExt, true);
      } catch (err) {
        const msg = (err && err.message) || "";
        if (!/already exists|exists/i.test(msg)) {
          new Notice(`nav-buttons: Templater create failed for ${target} (from ${btn._source}) — ${msg}`, 8000);
          return;
        }
        app.workspace.openLinkText(target, "");
      }
      return;
    }

    new Notice(`nav-buttons: unknown action.type "${type}" from ${btn._source}`, 8000);
  }
}
