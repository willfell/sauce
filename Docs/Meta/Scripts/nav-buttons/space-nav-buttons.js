/**
 * SpaceNavButtons (CustomJS) — v2.3.0
 *
 * Thin renderer over Docs/Meta/nav-buttons-registry.json. Each blueprint or
 * mechanism declares nav_buttons[] in its manifest; the installer aggregates
 * declarations into the registry namespaced under contributions.<source>.
 * This class reads the registry at render time, sorts entries by (order,
 * source, id), and dispatches click on action.type.
 *
 * Action types (v0.4.2):
 *   - openLink             { target }
 *   - createFromTemplate   { target, template_source }
 *   - runTemplaterTemplate { template_source, folder_prefix, folder_date_pattern, filename_prefix, filename_date_pattern, filename_suffix }
 *     - v2.5.0: action date is sourced from the active file's basename if it matches /(\d{4}-\d{2}-\d{2})/
 *       AND parses as a valid ISO date; falls back to today otherwise. Lets users prepare future-dated
 *       to-do/meetings/journal files by clicking nav buttons on a future-dated daily note.
 *   - invoke_command       { command_id }       (v2.3.0)
 *
 * v2.3.0 also adds a top arrow row for daily-nav (prev/next-day with
 * skip-to-nearest-existing + grey-out) when daily blueprint installed.
 * Renders ABOVE the registry button list. Reads .obsidian/daily-notes.json
 * at runtime to acquire daily folder + format.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
 */
class SpaceNavButtons {
  // ── _readDailyNotesMeta — read .obsidian/daily-notes.json. Returns null if
  // absent, unreadable, or malformed; never throws. Used to gate the top
  // arrow-row rendering: if daily blueprint not installed, no arrows.
  async _readDailyNotesMeta() {
    const path = ".obsidian/daily-notes.json";
    try {
      if (!(await app.vault.adapter.exists(path))) return null;
      const raw = await app.vault.adapter.read(path);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.folder !== "string" || typeof parsed.format !== "string") return null;
      if (parsed.folder.length === 0 || parsed.format.length === 0) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  // Resolve the date used by runTemplaterTemplate folder/filename substitutions.
  // If the active file's basename matches /(\d{4}-\d{2}-\d{2})/ AND the captured
  // string is a valid ISO date, return it verbatim. Otherwise fall back to today.
  // Returned shape: 'YYYY-MM-DD' string. Caller parses via window.moment(s, "YYYY-MM-DD", true).format(pattern).
  _resolveActionDate(dv) {
    const currentFile = dv && dv.current && dv.current();
    const fileName = (currentFile && currentFile.file && currentFile.file.name) || "";
    const dm = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    if (dm) {
      const m = window.moment(dm[1], "YYYY-MM-DD", true);
      if (m.isValid()) return dm[1];
    }
    return window.moment().format("YYYY-MM-DD");
  }

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
      plus:     `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
      journal:  `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
      trips:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
      trip:     `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`,
      finance:  `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`
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

    // ── Top arrow row (daily-nav prev/next; rendered when daily blueprint installed) ──
    const dailyMeta = await this._readDailyNotesMeta();
    if (dailyMeta) {
      const currentFile = dv.current && dv.current();
      const fileName = (currentFile && currentFile.file && currentFile.file.name) || "";
      const dm = fileName.match(/(\d{4}-\d{2}-\d{2})/);
      const currentDate = dm
        ? window.moment(dm[1], "YYYY-MM-DD", true)
        : window.moment();

      // Scan daily folder for existing dailies; sort by date.
      const allDailies = app.vault.getMarkdownFiles()
        .filter(f => f.path.startsWith(dailyMeta.folder + "/"))
        .map(f => {
          const fdm = f.name.match(/(\d{4}-\d{2}-\d{2})/);
          return fdm ? { file: f, m: window.moment(fdm[1], "YYYY-MM-DD", true) } : null;
        })
        .filter(x => x && x.m.isValid())
        .sort((a, b) => a.m.diff(b.m));

      const earlier = allDailies.filter(x => x.m.isBefore(currentDate, "day")).pop();
      const later = allDailies.filter(x => x.m.isAfter(currentDate, "day"))[0];

      const chevronLeft = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
      const chevronRight = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

      const arrowBaseStyle = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-muted);
        font-size: 0.8em;
        font-family: inherit;
        transition: color 0.15s, background 0.15s;
      `;

      const topRow = container.createEl("div");
      topRow.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
      `;

      // Prev button
      const prevBtn = topRow.createEl("button");
      const prevLabel = earlier ? earlier.m.format("ddd, MMM D") : "—";
      prevBtn.innerHTML = chevronLeft + `<span>${prevLabel}</span>`;
      const prevDisabled = !earlier;
      prevBtn.style.cssText = arrowBaseStyle + (prevDisabled ? "opacity: 0.4; cursor: default;" : "cursor: pointer;");
      if (!prevDisabled) {
        prevBtn.onmouseenter = () => { prevBtn.style.color = "var(--text-normal)"; prevBtn.style.background = "var(--background-modifier-hover)"; };
        prevBtn.onmouseleave = () => { prevBtn.style.color = "var(--text-muted)"; prevBtn.style.background = "transparent"; };
        prevBtn.onclick = () => app.workspace.openLinkText(earlier.file.path, "");
      }

      // Next button
      const nextBtn = topRow.createEl("button");
      const nextLabel = later ? later.m.format("ddd, MMM D") : "—";
      nextBtn.innerHTML = `<span>${nextLabel}</span>` + chevronRight;
      const nextDisabled = !later;
      nextBtn.style.cssText = arrowBaseStyle + (nextDisabled ? "opacity: 0.4; cursor: default;" : "cursor: pointer;");
      if (!nextDisabled) {
        nextBtn.onmouseenter = () => { nextBtn.style.color = "var(--text-normal)"; nextBtn.style.background = "var(--background-modifier-hover)"; };
        nextBtn.onmouseleave = () => { nextBtn.style.color = "var(--text-muted)"; nextBtn.style.background = "transparent"; };
        nextBtn.onclick = () => app.workspace.openLinkText(later.file.path, "");
      }
    }

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

        el.onclick = () => this._dispatchAction(btn, dv);
      }
    }
  }

  // ── Action dispatcher ──────────────────────────────────────────────────
  async _dispatchAction(btn, dv) {
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

      // v0.4.2 split-field schema. Literal text never reaches moment.format().
      const folderPrefix = action.folder_prefix || "";
      const folderDatePattern = action.folder_date_pattern || "";
      const filenamePrefix = action.filename_prefix || "";
      const filenameDatePattern = action.filename_date_pattern || "";
      const filenameSuffix = action.filename_suffix || "";

      const actionDate = this._resolveActionDate(dv);
      const actionMoment = window.moment(actionDate, "YYYY-MM-DD", true);
      const folder = folderDatePattern
        ? `${folderPrefix}/${actionMoment.format(folderDatePattern)}`
        : folderPrefix;
      const filenameComposed =
        filenamePrefix
        + (filenameDatePattern ? actionMoment.format(filenameDatePattern) : "")
        + filenameSuffix;
      const filenameNoExt = filenameComposed.trim() ? filenameComposed : "Untitled";
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

    if (type === "invoke_command") {
      if (!action.command_id) {
        new Notice(`nav-buttons: invoke_command missing command_id (from ${btn._source})`, 8000);
        return;
      }
      if (!app.commands.commands[action.command_id]) {
        new Notice(`nav-buttons: command not found "${action.command_id}" (from ${btn._source})`, 8000);
        return;
      }
      app.commands.executeCommandById(action.command_id);
      return;
    }

    new Notice(`nav-buttons: unknown action.type "${type}" from ${btn._source}`, 8000);
  }
}
