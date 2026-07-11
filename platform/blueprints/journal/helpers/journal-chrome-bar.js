/**
 * JournalChromeBar (CustomJS) — the journal blueprint's ChromeBar adapter
 * config. v0.4.0: rebuilt for the multi-entry day-hub shape (three surfaces:
 * journal-hub, journal-day, journal-entry), mirroring StickyChromeBar
 * including the leaf title-banner (click-to-rename).
 */
class JournalChromeBar {
  get ICON() {
    return {
      notebook: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/></svg>`,
      pencilPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`,
      today: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`,
      home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      back: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      const out = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
      this._maybeRenderBanner(dv);
      return out;
    } catch (_e) { /* never throw */ }
  }

  // On a leaf journal entry, render a clickable title banner below the chrome bar.
  _maybeRenderBanner(dv) {
    try {
      if (!dv || !dv.container) return;
      const page = customJS && customJS.RenderSafe ? customJS.RenderSafe.page(dv) : (dv.current ? dv.current() : null);
      if (!page || page.type !== "journal-entry") return;
      const filePath = page.file && page.file.path;
      if (!filePath) return;
      const file = (typeof app !== "undefined" && app.vault && typeof app.vault.getAbstractFileByPath === "function")
        ? app.vault.getAbstractFileByPath(filePath) : null;
      this._renderTitleBanner(dv.container, page, file);
    } catch (_e) { /* never throw */ }
  }

  _bannerText(page) {
    const t = page && page.title != null ? String(page.title).trim() : "";
    return t.length > 0 ? t : null;
  }

  _headingStyle(hasTitle) {
    return hasTitle
      ? "font-size: 1.35em; font-weight: 700; color: var(--text-normal); line-height: 1.3;"
      : "font-size: 1.1em; font-weight: 500; color: var(--text-muted); font-style: italic;";
  }

  _renderTitleBanner(container, page, file) {
    if (!container || typeof container.createEl !== "function") return;
    // Dedup across Dataview dual-fire re-renders.
    try {
      if (typeof container.querySelectorAll === "function") {
        (container.querySelectorAll(".journal-title-banner") || []).forEach((e) => { try { e.remove(); } catch (_e) {} });
      }
    } catch (_e) {}
    const banner = container.createEl("div", { cls: "journal-title-banner" });
    banner.style.cssText = "cursor: pointer; max-width: 640px; margin: 6px auto 10px; padding: 4px 2px;";
    const text = this._bannerText(page);
    const placeholder = "Untitled journal entry — click to name";
    const h = banner.createEl("div", { text: text || placeholder });
    h.style.cssText = this._headingStyle(!!text);
    banner.title = "Click to rename";
    banner.addEventListener("click", () => this._openRenameDialog(file, text || "", (newTitle) => {
      const nt = newTitle && String(newTitle).trim();
      h.textContent = nt || placeholder;
      h.style.cssText = this._headingStyle(!!nt);
    }));
  }

  _openRenameDialog(file, current, onDone) {
    try {
      if (!file || typeof app === "undefined" || !app.fileManager
        || typeof app.fileManager.processFrontMatter !== "function") return;
      if (typeof document === "undefined" || !document.body || typeof document.body.createEl !== "function") return;
      const overlay = document.body.createEl("div");
      overlay.style.cssText = "position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;";
      const box = overlay.createEl("div");
      box.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; width: min(420px, 90vw); display: flex; flex-direction: column; gap: 10px;";
      box.createEl("div", { text: "Journal entry title" }).style.cssText = "font-weight: 600;";
      const input = box.createEl("input", { type: "text", value: current || "" });
      input.style.cssText = "padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
      const row = box.createEl("div");
      row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
      const close = () => { try { overlay.remove(); } catch (_e) {} };
      const save = async () => {
        const v = (input.value || "").trim();
        try { await app.fileManager.processFrontMatter(file, (fm) => { fm.title = v; }); } catch (_e) {}
        close();
        try { if (typeof onDone === "function") onDone(v); } catch (_e) {}
      };
      const cancelBtn = row.createEl("button", { text: "Cancel" });
      cancelBtn.addEventListener("click", close);
      const saveBtn = row.createEl("button", { text: "Save" });
      saveBtn.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer;";
      saveBtn.addEventListener("click", () => { save(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); save(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      setTimeout(() => { try { input.focus(); } catch (_e) {} }, 0);
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "journal-hub") return { context: "journal-hub", path: (page.file && page.file.path) || "" };
        if (t === "journal-day") return { context: "journal-day", path: (page.file && page.file.path) || "", day: page.day };
        if (t === "journal-entry") return { context: "journal-entry", path: (page.file && page.file.path) || "", day: page.day };
        return null;
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "journal-hub") {
          return { primary: { id: "today", label: "Today", icon: ICON.today }, overflow: [], leaf: false };
        }
        if (ctx.context === "journal-day") {
          return {
            primary: { id: "new-journal-entry", label: "+ New Journal Entry", icon: ICON.pencilPlus },
            overflow: [{ id: "hub", label: "Hub", icon: ICON.home }],
            leaf: false,
          };
        }
        if (ctx.context === "journal-entry") {
          return {
            primary: null,
            overflow: [
              { id: "back-day", label: "Back to Day", icon: ICON.back },
              { id: "hub", label: "Hub", icon: ICON.home },
            ],
            leaf: true,
          };
        }
        return { primary: null, overflow: [], leaf: false };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "today") {
          this._openToday(dv);
          return;
        }
        if (id === "new-journal-entry") {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "journal-entry", dv });
          } else if (typeof Notice === "function") { new Notice("JournalChromeBar: EntityCreate unavailable.", 8000); }
          return;
        }
        if (id === "hub") {
          try { app.workspace.openLinkText("spice/journal/Journal.md", ""); } catch (_e) {}
          return;
        }
        if (id === "back-day") {
          const day = this._resolveDay(dv, ctx);
          if (!day) return;
          const mo = window.moment(day, "YYYY-MM-DD", true);
          if (!mo.isValid()) return;
          const folder = mo.format("YYYY/MM-MMMM");
          const dayHubPath = `spice/journal/${folder}/${day}/Journal-Day-${day}.md`;
          try { app.workspace.openLinkText(dayHubPath, ""); } catch (_e) {}
          return;
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This journal entry" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const hubPath = "spice/journal/Journal.md";
        if (curPath !== hubPath) {
          out.push({ label: "Journal Hub", icon: ICON.home, _navTarget: hubPath, onSelect: () => open(hubPath) });
        }
        if (ctx.context !== "journal-hub") {
          const day = this._resolveDay(dv, ctx);
          if (day) {
            const mo = window.moment(day, "YYYY-MM-DD", true);
            if (mo.isValid()) {
              const folder = mo.format("YYYY/MM-MMMM");
              const dayHubPath = `spice/journal/${folder}/${day}/Journal-Day-${day}.md`;
              if (curPath !== dayHubPath) {
                out.push({ label: "Day Hub", icon: ICON.today, _navTarget: dayHubPath, onSelect: () => open(dayHubPath) });
              }
            }
          }
        }
        return out;
      },
      rootClass: "journal-chrome-root",
      btnClass: (v) => `journal-chrome-btn journal-chrome-btn-${v}`,
    };
  }

  _resolveDay(dv, ctx) {
    if (ctx && ctx.day) {
      const d = this._coerceDay(ctx.day);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    }
    try {
      const page = customJS.RenderSafe.page(dv);
      const d = this._coerceDay(page && page.day);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    } catch (_e) {}
    return null;
  }

  _coerceDay(raw) {
    if (typeof raw === "string") return raw.slice(0, 10);
    if (raw && typeof raw.toISODate === "function") return raw.toISODate();
    if (raw instanceof Date && !isNaN(raw)) {
      const y = raw.getFullYear();
      const m = String(raw.getMonth() + 1).padStart(2, "0");
      const d = String(raw.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  async _openToday(dv) {
    const day = window.moment().format("YYYY-MM-DD");
    const mo = window.moment(day, "YYYY-MM-DD", true);
    const monthFolder = mo.format("YYYY/MM-MMMM");
    const folder = `spice/journal/${monthFolder}/${day}`;
    const dayHubPath = `${folder}/Journal-Day-${day}.md`;
    const existing = app.vault.getAbstractFileByPath(dayHubPath);
    if (existing) { app.workspace.openLinkText(dayHubPath, ""); return; }
    const tpPlugin = app.plugins.plugins["templater-obsidian"];
    if (!tpPlugin || !tpPlugin.templater) {
      if (typeof Notice === "function") new Notice("JournalChromeBar: Templater plugin not enabled.", 8000);
      return;
    }
    const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Journal Day Hub.md");
    if (!templateFile) {
      if (typeof Notice === "function") new Notice("JournalChromeBar: template not found.", 8000);
      return;
    }
    if (!app.vault.getAbstractFileByPath(folder)) {
      try { await app.vault.createFolder(folder); }
      catch (e) { if (!/already exists|exists/i.test((e && e.message) || "")) { if (typeof Notice === "function") new Notice("JournalChromeBar: cannot create folder — " + (e.message || e), 8000); return; } }
    }
    try { await tpPlugin.templater.create_new_note_from_template(templateFile, folder, `Journal-Day-${day}`, true); }
    catch (e) {
      if (/already exists|exists/i.test((e && e.message) || "")) { app.workspace.openLinkText(dayHubPath, ""); return; }
      if (typeof Notice === "function") new Notice("JournalChromeBar: Templater create failed — " + (e.message || e), 8000);
    }
  }
}
