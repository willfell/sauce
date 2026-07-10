/**
 * SpaceNavButtons (CustomJS) — v2.9.0 (Go-to launcher)
 *
 * Thin renderer over ranch/nav-buttons-registry.json. Each blueprint or
 * mechanism declares nav_buttons[] in its manifest; the installer aggregates
 * declarations into the registry namespaced under contributions.<source>.
 * This class reads the registry at render time, orders entries by (order,
 * source, id), and dispatches click on action.type.
 *
 * Layout (v2.12.0): prev/next-day arrows on top (space-between, when the daily
 * blueprint is installed), then a fixed 3-COLUMN GRID of pinned quick-nav
 * buttons — Home | To-Do | Sticky Notes  /  Projects | Meetings | Go to… — where
 * the final cell is the "Go to…" launcher holding EVERY OTHER blueprint. Pins
 * are chosen by _partitionEntries via a fixed _source order; any pinned source
 * absent from the registry simply drops its cell (the grid reflows). Each pinned
 * button dispatches its own registry action; tapping "Go to…" opens a custom
 * launcher OVERLAY appended to document.body (so it is never clipped by the note
 * container): a full-width bottom sheet on mobile, an anchored dropdown on
 * desktop (min 300px), listing the rest with icon + full label. Backdrop-tap /
 * Escape / re-tap closes it. This replaces the v2.11.0 two-row even-split layout,
 * the v2.9.0 native-Menu reveal (cramped/truncating on mobile), and the
 * pre-v2.9.0 always-visible multi-row button grid.
 *
 * Action types (v0.4.2):
 *   - openLink             { target }
 *   - createFromTemplate   { target, template_source }
 *   - runTemplaterTemplate { template_source, folder_prefix, folder_date_pattern, filename_prefix, filename_date_pattern, filename_suffix }
 *     - v2.5.0: action date is sourced from the active file's basename if it matches /(\d{4}-\d{2}-\d{2})/
 *       AND parses as a valid ISO date; falls back to today otherwise. Lets users prepare future-dated
 *       to-do/meetings/journal files by clicking nav buttons on a future-dated daily note.
 *   - invoke_command       { command_id, args? } (v2.3.0; v2.6.0 adds optional args: {[k:string]:string})
 *
 * The daily-nav arrows (prev/next-day with skip-to-nearest-existing + grey-out)
 * read .obsidian/daily-notes.json at runtime to acquire daily folder + format.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
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

  // The ONE canonical nav comparator — null-safe. Sorts a COPY by
  // (order ?? 100, source, id). Identical output to the prior inline comparators
  // for well-formed registries (every _source/id present). Pure; Node-testable.
  _sortNavEntries(entries) {
    return (entries || []).slice().sort((a, b) =>
      (a.order ?? 100) - (b.order ?? 100)
      || String(a._source || "").localeCompare(String(b._source || ""))
      || String(a.id || "").localeCompare(String(b.id || "")));
  }

  // Flatten registry.contributions.<source>[] into a single array tagged with
  // _source, sorted by (order, source, id). Pure; Node-testable.
  _orderedEntries(registry) {
    const entries = [];
    const contributions = (registry && registry.contributions) || {};
    for (const [source, btns] of Object.entries(contributions)) {
      if (!Array.isArray(btns)) continue;
      for (const btn of btns) entries.push({ ...btn, _source: source });
    }
    return this._sortNavEntries(entries);
  }

  // ONE representative entry per source (the registry's list[0]), tagged _source,
  // sorted by (order, source, id). This is exactly what a Go-launcher Vault
  // section needs; consumed by ChromeBar.vaultEntries so the ordering rule lives
  // in one place. Pure; Node-testable.
  firstEntryPerSource(registry) {
    const reps = [];
    const contributions = (registry && registry.contributions) || {};
    for (const [src, list] of Object.entries(contributions)) {
      if (!Array.isArray(list) || list.length === 0) continue;
      reps.push({ ...list[0], _source: src });
    }
    return this._sortNavEntries(reps);
  }

  // Partition ordered entries into the fixed set of PINNED quick-nav buttons
  // (by _source, in this order) and the "rest" that live inside the Go to…
  // menu. Only the first entry per source can claim a pin slot. Pure;
  // Node-testable. Returns { pinned: entry[], rest: entry[] }.
  _partitionEntries(entries) {
    const PINNED_SOURCES = ["home", "to-do", "sticky-notes", "project", "meetings", "journal"];
    const firstBySource = {};
    for (const e of (entries || [])) {
      if (e && e._source && !firstBySource[e._source]) firstBySource[e._source] = e;
    }
    const pinned = [];
    const pinnedSet = new Set();
    for (const src of PINNED_SOURCES) {
      const e = firstBySource[src];
      if (e) { pinned.push(e); pinnedSet.add(e); }
    }
    const rest = (entries || []).filter((e) => !pinnedSet.has(e));
    return { pinned, rest };
  }

  // Gate the prev/next-day arrow row (and its whole-vault getMarkdownFiles sweep)
  // to notes actually INSIDE the daily folder — not every note merely because the
  // daily blueprint is installed. Folder-path predicate (a basename date regex
  // would leak meeting/sticky-note/to-do notes, which also carry date basenames).
  // Pure + Node-testable.
  static _shouldShowDayArrows(currentPath, dailyMeta) {
    return !!(dailyMeta && dailyMeta.folder && currentPath
      && String(currentPath).startsWith(dailyMeta.folder + "/"));
  }

  // Load + parse the nav-buttons registry, caching the parsed result for the
  // session (the registry changes only on `sauce install`, which requires an
  // Obsidian reload that resets this instance). Removes a ~2.8KB adapter.read from
  // EVERY note render. Returns { ok:true, registry } | { ok:false, empty:true }
  // (ENOENT / empty install → render nothing) | { ok:false, reason } (read/parse
  // error → render a notice). Never throws.
  async _loadRegistry(app) {
    if (this._registryCache) return { ok: true, registry: this._registryCache };
    let raw;
    try {
      raw = await app.vault.adapter.read("ranch/nav-buttons-registry.json");
    } catch (readErr) {
      const msg = (readErr && readErr.message) || String(readErr);
      if (/ENOENT|not\s*found|no such file/i.test(msg)) return { ok: false, empty: true };
      return { ok: false, reason: "read error: " + msg };
    }
    let registry;
    try { registry = JSON.parse(raw); }
    catch (parseErr) { return { ok: false, reason: "parse error: " + parseErr.message }; }
    this._registryCache = registry;
    return { ok: true, registry };
  }

  async render(dv) {
    const fallbackIcon = (label) =>
      `<span class="nav-fallback-icon">${(label && label[0] || "?").toUpperCase()}</span>`;

    // ── Read registry (cached for the session via _loadRegistry) ─────────
    const reg = await this._loadRegistry(app);
    if (!reg.ok) {
      if (reg.empty) return; // ENOENT / empty install → render nothing
      dv.el("div", `[nav-buttons] registry ${reg.reason}`, { cls: "nav-error" });
      return;
    }
    const registry = reg.registry;

    // ── Flatten + sort ───────────────────────────────────────────────────
    const entries = this._orderedEntries(registry);
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

    // Partition into pinned quick-nav buttons + the rest (Go to… menu).
    const { pinned, rest } = this._partitionEntries(entries);
    const dailyMeta = await this._readDailyNotesMeta();

    // ── Chrome: prev/next-day arrows on top; a fixed 3-column grid below —
    //    Home | To-Do | Sticky Notes  /  Projects | Meetings | Go to… (the rest). ──
    const chrome = container.createEl("div");
    chrome.style.cssText = `display: flex; flex-direction: column; gap: 8px;`;

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
    const chevronLeft = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
    const chevronRight = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

    // Row 1: prev/next-day arrows — only when VIEWING a note inside the daily
    // folder. Gating here (not merely on dailyMeta) avoids the whole-vault
    // getMarkdownFiles() sweep + per-file moment parsing on every non-daily note;
    // SpaceNavButtons renders on nearly every note.
    const currentFile = dv.current && dv.current();
    const curPath = (currentFile && currentFile.file && currentFile.file.path) || "";
    if (SpaceNavButtons._shouldShowDayArrows(curPath, dailyMeta)) {
      const arrowRow = chrome.createEl("div");
      arrowRow.style.cssText = `display: flex; align-items: center; justify-content: space-between; gap: 6px;`;

      const fileName = (currentFile && currentFile.file && currentFile.file.name) || "";
      const dm = fileName.match(/(\d{4}-\d{2}-\d{2})/);
      const currentDate = dm ? window.moment(dm[1], "YYYY-MM-DD", true) : window.moment();
      const allDailies = app.vault.getMarkdownFiles()
        .filter(f => f.path.startsWith(dailyMeta.folder + "/"))
        .map(f => { const fdm = f.name.match(/(\d{4}-\d{2}-\d{2})/); return fdm ? { file: f, m: window.moment(fdm[1], "YYYY-MM-DD", true) } : null; })
        .filter(x => x && x.m.isValid())
        .sort((a, b) => a.m.diff(b.m));
      const earlier = allDailies.filter(x => x.m.isBefore(currentDate, "day")).pop();
      const later = allDailies.filter(x => x.m.isAfter(currentDate, "day"))[0];

      const prevBtn = arrowRow.createEl("button");
      prevBtn.innerHTML = chevronLeft + `<span>${earlier ? earlier.m.format("ddd, MMM D") : "—"}</span>`;
      prevBtn.style.cssText = arrowBaseStyle + (earlier ? "cursor: pointer;" : "opacity: 0.4; cursor: default;");
      if (earlier) {
        prevBtn.onmouseenter = () => { prevBtn.style.color = "var(--text-normal)"; prevBtn.style.background = "var(--background-modifier-hover)"; };
        prevBtn.onmouseleave = () => { prevBtn.style.color = "var(--text-muted)"; prevBtn.style.background = "transparent"; };
        prevBtn.onclick = () => app.workspace.openLinkText(earlier.file.path, "");
      }

      const nextBtn = arrowRow.createEl("button");
      nextBtn.innerHTML = `<span>${later ? later.m.format("ddd, MMM D") : "—"}</span>` + chevronRight;
      nextBtn.style.cssText = arrowBaseStyle + (later ? "cursor: pointer;" : "opacity: 0.4; cursor: default;");
      if (later) {
        nextBtn.onmouseenter = () => { nextBtn.style.color = "var(--text-normal)"; nextBtn.style.background = "var(--background-modifier-hover)"; };
        nextBtn.onmouseleave = () => { nextBtn.style.color = "var(--text-muted)"; nextBtn.style.background = "transparent"; };
        nextBtn.onclick = () => app.workspace.openLinkText(later.file.path, "");
      }
    }

    // Row 2+: a fixed 3-column grid of pinned quick-nav buttons, with the
    // "Go to…" menu (holding every other blueprint) as the final cell.
    const grid = chrome.createEl("div");
    grid.style.cssText = `display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;`;
    const fillCell = (el) => {
      el.style.width = "100%";
      el.style.minWidth = "0";
      el.style.overflow = "hidden";
      el.style.justifyContent = "center";
    };
    for (const entry of pinned) fillCell(this._renderEntryButton(grid, entry, dv));
    if (rest.length > 0) fillCell(this._renderPill(grid, rest, dv));
  }

  // Shared pill styling (outline chip, accent on hover) for the Home + Go to…
  // chrome buttons.
  _stylePill(el) {
    el.style.cssText = `
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 6px;
      border: 1px solid var(--background-modifier-border);
      background: var(--background-primary);
      color: var(--text-muted);
      font-size: 0.82em;
      font-weight: 500;
      font-family: inherit;
      letter-spacing: 0.01em;
      transition: all 0.15s ease;
    `;
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
  }

  // Pinned quick-nav button for any entry (Home / To-Do / Sticky Notes / Projects /
  // Meetings). Dispatches the entry's own registry action via the unchanged
  // _dispatchAction. Label is ellipsised so it never overflows its grid cell.
  _renderEntryButton(row, entry, dv) {
    const btnEl = row.createEl("button");
    const icon = (customJS.Icons?.resolve?.(entry.icon)) || "";
    btnEl.innerHTML = icon + `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${entry.label || entry._source || ""}</span>`;
    this._stylePill(btnEl);
    btnEl.onclick = () => this._dispatchAction(entry, dv);
    return btnEl;
  }

  // Render the "Go to…" pill; wire its click to the launcher overlay.
  _renderPill(row, menuEntries, dv) {
    const pill = row.createEl("button");
    const gridIcon = (customJS.Icons?.resolve?.("layout-grid")) ||
      `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
    const chevronDown = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    pill.innerHTML = gridIcon + `<span>Go to…</span>` + chevronDown;
    this._stylePill(pill);
    pill.onclick = (evt) => this._openLauncher(evt, pill, menuEntries, dv);
    return pill;
  }

  // Open the launcher as a viewport overlay appended to document.body (so it is
  // never clipped by the note container): a full-width bottom sheet on mobile,
  // an anchored dropdown on desktop. Backdrop-tap / Escape / re-tap closes it.
  _openLauncher(evt, pill, menuEntries, dv) {
    if (evt && evt.stopPropagation) evt.stopPropagation();
    const doc = (typeof activeDocument !== "undefined" && activeDocument) || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.body) return;

    // Toggle: an already-open overlay means "close" — route through its own
    // teardown (__navClose) so the keydown listener is removed too.
    const open = doc.body.querySelector && doc.body.querySelector(".vault-nav-overlay");
    if (open) { if (open.__navClose) open.__navClose(); else if (open.remove) open.remove(); return; }

    const isMobile = !!(typeof app !== "undefined" && app && app.isMobile);

    const overlay = doc.createElement("div");
    overlay.className = "vault-nav-overlay";
    overlay.style.cssText = `position: fixed; inset: 0; z-index: 1000;`
      + (isMobile
        ? " background: rgba(0,0,0,0.45); display: flex; align-items: flex-end; justify-content: center;"
        : " background: transparent;");

    const panel = doc.createElement("div");
    panel.className = "vault-nav-panel";
    const panelBase = `box-sizing: border-box; background: var(--background-primary);`
      + ` border: 1px solid var(--background-modifier-border);`
      + ` box-shadow: 0 8px 30px rgba(0,0,0,0.30); overflow-y: auto;`
      + ` display: flex; flex-direction: column;`;
    if (isMobile) {
      panel.style.cssText = panelBase
        + ` width: 100%; max-width: 620px; max-height: 72vh;`
        + ` border-radius: 16px 16px 0 0;`
        + ` padding: 8px 8px calc(10px + env(safe-area-inset-bottom, 0px));`
        + ` gap: 2px;`;
      const handle = doc.createElement("div");
      handle.style.cssText = `flex: 0 0 auto; width: 40px; height: 4px; border-radius: 2px; background: var(--background-modifier-border); margin: 4px auto 8px;`;
      panel.appendChild(handle);
    } else {
      const rect = (pill && pill.getBoundingClientRect) ? pill.getBoundingClientRect() : { left: 0, bottom: 0, width: 0 };
      const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
      const width = Math.min(vw - 16, Math.max(300, Math.round(rect.width) || 0));
      let left = Math.round(rect.left || 0);
      if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
      panel.style.cssText = panelBase
        + ` position: fixed; top: ${Math.round((rect.bottom || 0) + 6)}px; left: ${left}px;`
        + ` width: ${width}px; max-height: 60vh; border-radius: 8px; padding: 6px; gap: 1px;`;
    }

    // Single teardown for ALL dismiss paths (backdrop, Escape, re-tap toggle,
    // row select) — removes the overlay AND the keydown listener so a stale
    // capture-phase Escape handler can never swallow keys elsewhere.
    const close = () => {
      if (overlay.remove) overlay.remove();
      if (doc.removeEventListener) doc.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e && e.key === "Escape") { if (e.preventDefault) e.preventDefault(); close(); } };
    overlay.__navClose = close;

    // Opening-gesture guard (mobile): a tap synthesizes a delayed "ghost" click
    // at the tap coordinates ~300ms after touchend; the full-screen backdrop now
    // covers that point, so it lands on the backdrop and self-dismisses the
    // just-opened sheet (opens-then-closes = "tapping does nothing"). Ignore any
    // backdrop dismiss within the opening window so only a deliberate later tap
    // closes it (Escape / re-tap / row-select still close immediately).
    const openedAt = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    const withinOpeningGesture = () => openedAt && ((typeof Date !== "undefined" && Date.now ? Date.now() : 0) - openedAt < 400);

    for (const btn of menuEntries) {
      panel.appendChild(this._buildOverlayRow(doc, btn, dv, close, isMobile));
    }

    overlay.onclick = (e) => { if (e && e.target === overlay && !withinOpeningGesture()) close(); };
    if (doc.addEventListener) doc.addEventListener("keydown", onKey, true);

    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
  }

  // Build a single overlay row (icon + full label). Label lives in a <span> so
  // it renders identically to the chrome glyphs; label text originates from
  // installer-validated registry declarations (trusted, same boundary as the
  // former grid). Full-width rows mean labels never truncate on mobile.
  _buildOverlayRow(doc, btn, dv, close, isMobile) {
    const row = doc.createElement("button");
    const svg = customJS.Icons?.resolve?.(btn.icon) || "";
    row.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 auto;">${svg}</span>`
      + `<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${btn.label}</span>`;
    row.style.cssText = `cursor: pointer; display: flex; align-items: center; gap: 10px;`
      + ` width: 100%; text-align: left; box-sizing: border-box; border: none;`
      + ` border-radius: 8px; background: transparent; color: var(--text-normal);`
      + ` font-family: inherit; line-height: 1.25;`
      + (isMobile ? " padding: 12px; font-size: 1em;" : " padding: 8px 10px; font-size: 0.9em;");
    row.onmouseenter = () => { row.style.background = "var(--background-modifier-hover)"; };
    row.onmouseleave = () => { row.style.background = "transparent"; };
    row.onclick = () => { close(); return this._dispatchAction(btn, dv); };
    return row;
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
      // If target already exists, just open it. Read-mode forcing is
      // intentionally scoped to NEW notes only (see new-file tail below) — an
      // already-existing note keeps whatever view mode the user left it in.
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
      // Open the just-created TFile on a captured leaf so the deferred
      // read-mode flip targets THIS note even if focus moves first.
      const f = app.vault.getAbstractFileByPath(action.target);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(f);
      customJS.OpenHelpers?.forceLeafPreview?.(leaf);
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

      // Read-mode forcing is intentionally scoped to NEW notes only (see tail
      // below) — an already-existing note keeps its current view mode.
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
      // Templater opened the note itself; capture the leaf it landed on NOW
      // (synchronously) so the deferred flip targets THIS note, not whatever
      // the active leaf becomes later.
      const leaf = app.workspace.activeLeaf;
      customJS.OpenHelpers?.forceLeafPreview?.(leaf);
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
      // v2.6.0: optional args object (string→string map). Validate shape; on
      // malformed, fall back to no-args dispatch (do NOT throw). On valid args,
      // best-effort dual-write: (1) JSON scratchpad at <vault>/.scratch/nav-button-pending-args.json
      // since Obsidian's current executeCommandById ignores extra args; (2) pass
      // args as second arg to executeCommandById for future-proofing.
      let argsToDispatch = null;
      if (action.args !== undefined && action.args !== null) {
        const isPlainObject = typeof action.args === "object" && !Array.isArray(action.args);
        const allStringValues = isPlainObject
          && Object.values(action.args).every((v) => typeof v === "string");
        if (isPlainObject && allStringValues && Object.keys(action.args).length > 0) {
          argsToDispatch = action.args;
        } else if (isPlainObject && Object.keys(action.args).length === 0) {
          // empty object → behave like no args (no scratchpad write)
          argsToDispatch = null;
        } else {
          new Notice(`nav-button invoke_command: invalid args shape, dispatching without args`, 8000);
          argsToDispatch = null;
        }
      }
      if (argsToDispatch) {
        try {
          await app.vault.adapter.mkdir(".scratch").catch(() => {});
          const payload = JSON.stringify({
            command_id: action.command_id,
            args: argsToDispatch,
            dispatched_at: new Date().toISOString(),
          }, null, 2);
          await app.vault.adapter.write(".scratch/nav-button-pending-args.json", payload);
        } catch (e) {
          // Best-effort; do not block command dispatch on scratchpad failure.
        }
        app.commands.executeCommandById(action.command_id, argsToDispatch);
      } else {
        app.commands.executeCommandById(action.command_id);
      }
      // Only force read mode when the nav entry opts in (note-opening commands
      // like daily/journal goto-today). Without the opt-in we'd risk flipping a
      // non-note command's active leaf to preview.
      if (action.read_mode_after === true) customJS.OpenHelpers?.forceActiveLeafPreview?.();
      return;
    }

    new Notice(`nav-buttons: unknown action.type "${type}" from ${btn._source}`, 8000);
  }
}
