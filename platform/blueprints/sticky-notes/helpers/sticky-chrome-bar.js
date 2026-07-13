class StickyChromeBar {
  get ICON() {
    return {
      pencilPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`,
      today: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`,
      home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      back: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
      link: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
      trash: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      const out = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
      this._maybeRenderBanner(dv);
      this._maybeRenderPinnedLinks(dv);
      return out;
    } catch (_e) { /* never throw */ }
  }

  _maybeRenderPinnedLinks(dv) {
    try {
      const page = customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function"
        ? customJS.RenderSafe.page(dv)
        : (dv && dv.current ? dv.current() : null);
      if (!page || page.type !== "sticky-note") return;
      if (customJS && customJS.SectionExplorer && typeof customJS.SectionExplorer.renderNoteLinks === "function") {
        customJS.SectionExplorer.renderNoteLinks(dv);
      }
    } catch (_e) { /* never throw */ }
  }

  // On a leaf sticky note, render a clickable title banner below the chrome bar.
  _maybeRenderBanner(dv) {
    try {
      if (!dv || !dv.container) return;
      const page = customJS && customJS.RenderSafe ? customJS.RenderSafe.page(dv) : (dv.current ? dv.current() : null);
      if (!page || page.type !== "sticky-note") return;
      const filePath = page.file && page.file.path;
      if (!filePath) return;
      const file = (typeof app !== "undefined" && app.vault && typeof app.vault.getAbstractFileByPath === "function")
        ? app.vault.getAbstractFileByPath(filePath) : null;
      this._renderTitleBanner(dv.container, page, file);
    } catch (_e) { /* never throw */ }
  }

  _bannerText(page) {
    const t = page && page.title != null ? String(page.title).trim() : "";
    if (t.length > 0) return t;
    const fn = page && page.file && page.file.name ? String(page.file.name).trim() : "";
    return fn.length > 0 ? fn : null;
  }

  _renderTitleBanner(container, page, file) {
    if (!container || typeof container.createEl !== "function") return;
    try {
      if (typeof container.querySelectorAll === "function") {
        (container.querySelectorAll(".sticky-title-banner") || []).forEach((e) => { try { e.remove(); } catch (_e) {} });
      }
    } catch (_e) {}
    const banner = container.createEl("div", { cls: "sticky-title-banner" });
    banner.style.cssText = "margin: 6px 0 0 0;";
    const text = this._bannerText(page);
    const placeholder = "Untitled — click to name";
    const labelBase = "font-size: 0.78em; color: var(--text-muted); font-weight: 600; margin: 4px 0 6px 0; cursor: pointer;";
    const labelWhenText = "text-transform: uppercase; letter-spacing: 0.05em;";
    const labelWhenPlaceholder = "font-style: italic;";
    const h = banner.createEl("div", { text: text || placeholder });
    h.style.cssText = labelBase + " " + (text ? labelWhenText : labelWhenPlaceholder);
    h.title = "Click to rename";
    const hr = banner.createEl("hr");
    hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border-hover); margin: 0 0 12px 0;";
    h.addEventListener("click", () => this._openRenameDialog(file, text || "", (newTitle) => {
      const nt = newTitle && String(newTitle).trim();
      h.textContent = nt || placeholder;
      h.style.cssText = labelBase + " " + (nt ? labelWhenText : labelWhenPlaceholder);
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
      box.createEl("div", { text: "Sticky note title" }).style.cssText = "font-weight: 600;";
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
    const ROOT = "spice/sticky-notes";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "sticky-hub") return { context: "sticky-hub", path: (page.file && page.file.path) || "" };
        if (t === "sticky-day") return { context: "sticky-day", path: (page.file && page.file.path) || "", day: page.day };
        if (t === "sticky-note") return { context: "sticky-note", path: (page.file && page.file.path) || "", day: page.day };
        return null;
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "sticky-hub") {
          return { primary: { id: "today", label: "Today", icon: ICON.today }, overflow: [], leaf: false };
        }
        if (ctx.context === "sticky-day") {
          return {
            primary: { id: "new-sticky-note", label: "+ New Sticky Note", icon: ICON.pencilPlus },
            overflow: [{ id: "hub", label: "Hub", icon: ICON.home }],
            leaf: false,
          };
        }
        if (ctx.context === "sticky-note") {
          return {
            primary: null,
            overflow: [
              { id: "back-day", label: "Back to Day", icon: ICON.back },
              { id: "hub", label: "Hub", icon: ICON.home },
              { id: "rename", label: "Change title…", icon: ICON.pencilPlus },
              { id: "add-link", label: "Add link…", icon: ICON.link },
              { id: "move-day", label: "Move to another day…", icon: ICON.today },
              { id: "delete", label: "Delete sticky note…", icon: ICON.trash },
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
        if (id === "new-sticky-note") {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "sticky-note", dv });
          } else if (typeof Notice === "function") { new Notice("StickyChromeBar: EntityCreate unavailable.", 8000); }
          return;
        }
        if (id === "hub") {
          try { app.workspace.openLinkText("spice/sticky-notes/Sticky.md", ""); } catch (_e) {}
          return;
        }
        if (id === "back-day") {
          const day = this._resolveDay(dv, ctx);
          if (!day) return;
          const mo = window.moment(day, "YYYY-MM-DD", true);
          if (!mo.isValid()) return;
          const folder = mo.format("YYYY/MM-MMMM");
          const dayHubPath = `spice/sticky-notes/${folder}/${day}/Sticky-Day-${day}.md`;
          try { app.workspace.openLinkText(dayHubPath, ""); } catch (_e) {}
          return;
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This sticky note" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const hubPath = "spice/sticky-notes/Sticky.md";
        if (curPath !== hubPath) {
          out.push({ label: "Sticky Notes Hub", icon: ICON.home, _navTarget: hubPath, onSelect: () => open(hubPath) });
        }
        if (ctx.context !== "sticky-hub") {
          const day = this._resolveDay(dv, ctx);
          if (day) {
            const mo = window.moment(day, "YYYY-MM-DD", true);
            if (mo.isValid()) {
              const folder = mo.format("YYYY/MM-MMMM");
              const dayHubPath = `spice/sticky-notes/${folder}/${day}/Sticky-Day-${day}.md`;
              if (curPath !== dayHubPath) {
                out.push({ label: "Day Hub", icon: ICON.today, _navTarget: dayHubPath, onSelect: () => open(dayHubPath) });
              }
            }
          }
        }
        return out;
      },
      rootClass: "sticky-chrome-root",
      btnClass: (v) => `sticky-chrome-btn sticky-chrome-btn-${v}`,
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
    const folder = `spice/sticky-notes/${monthFolder}/${day}`;
    const dayHubPath = `${folder}/Sticky-Day-${day}.md`;
    const existing = app.vault.getAbstractFileByPath(dayHubPath);
    if (existing) { app.workspace.openLinkText(dayHubPath, ""); return; }
    const tpPlugin = app.plugins.plugins["templater-obsidian"];
    if (!tpPlugin || !tpPlugin.templater) {
      if (typeof Notice === "function") new Notice("StickyChromeBar: Templater plugin not enabled.", 8000);
      return;
    }
    const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Sticky Day Hub.md");
    if (!templateFile) {
      if (typeof Notice === "function") new Notice("StickyChromeBar: template not found.", 8000);
      return;
    }
    if (!app.vault.getAbstractFileByPath(folder)) {
      try { await app.vault.createFolder(folder); }
      catch (e) { if (!/already exists|exists/i.test((e && e.message) || "")) { if (typeof Notice === "function") new Notice("StickyChromeBar: cannot create folder — " + (e.message || e), 8000); return; } }
    }
    try { await tpPlugin.templater.create_new_note_from_template(templateFile, folder, `Sticky-Day-${day}`, true); }
    catch (e) {
      if (/already exists|exists/i.test((e && e.message) || "")) { app.workspace.openLinkText(dayHubPath, ""); return; }
      if (typeof Notice === "function") new Notice("StickyChromeBar: Templater create failed — " + (e.message || e), 8000);
    }
  }
}
