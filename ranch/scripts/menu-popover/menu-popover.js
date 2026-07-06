/**
 * MenuPopover — the shared popup primitive.
 *
 * The DRY extraction of the desktop-dropdown / mobile-bottom-sheet overlay that
 * space-nav-buttons (_openLauncher), project-nav-buttons (_openMoreMenu) and
 * trip-nav-buttons (_openLauncher) all duplicated. Powers the `Go ▾` launcher,
 * hub `⋯` menus, and per-row task `⋯` menus.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan. Every
 * method is never-throw + cold-load-safe (missing DOM / doc.body → no-op).
 *
 * Interface:
 *   MenuPopover.open(entries, opts)
 *     entries: [{ label, icon?, onSelect(), danger?, sublabel? }]
 *              — a bare { section: "This project" } marker starts a new group.
 *              — { section: "Vault", layout: "grid" } renders THAT section's
 *                rows in a 2-column grid instead of a stacked full-width list
 *                (opt-in per section; every other marker/caller is unaffected).
 *     opts: { anchor?, doc?, isMobile?, title? }
 *       anchor   = trigger element for desktop getBoundingClientRect positioning
 *                  AND the toggle key (re-open with the same anchor closes the
 *                  prior overlay and opens none).
 *       doc      = document (default global document) — tests inject a stub.
 *       isMobile = force layout; when omitted, derives from Obsidian's
 *                  app.isMobile, falling back to _isMobile(doc) when `app` is
 *                  absent (Node tests / cold load).
 *       title    = optional muted header shown at the top of the panel.
 *     Returns the overlay element (with __navClose attached), or null on no-op.
 */
class MenuPopover {
  // NOTE (customjs static-vs-instance trap): the customJS plugin stores classes as
  // INSTANCES (`customJS.MenuPopover = new MenuPopover()`), so every method a caller
  // reaches via `customJS.MenuPopover.open(...)` MUST be an INSTANCE method (on the
  // prototype). These were originally `static`, which made `customJS.MenuPopover.open`
  // undefined at runtime → Go / ⋯ / per-row menus silently no-op'd on all platforms
  // (the guard `typeof customJS.MenuPopover.open === "function"` was false). They are
  // now instance methods; internal calls use `this._x(...)`. See code-conventions.md
  // "Dispatcher contracts". (Unit tests must therefore drive `new MenuPopover()`, not
  // the class — MP.open is undefined on the class now.)

  // Group entries by preceding { section } marker → [{ section, layout, rows }].
  // Rows that appear before any marker land in a leading section with section:null.
  // `layout` carries the marker's opt-in layout hint ("grid" | undefined) through
  // untouched — undefined for every existing caller, so behavior is unchanged
  // unless a caller explicitly asks for a grid section.
  _partitionSections(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const out = [];
    let current = null;
    for (const e of list) {
      if (e && typeof e === "object" && "section" in e && !("label" in e) && !("onSelect" in e)) {
        current = { section: e.section, layout: e.layout, rows: [] };
        out.push(current);
        continue;
      }
      if (!current) { current = { section: null, layout: undefined, rows: [] }; out.push(current); }
      current.rows.push(e);
    }
    return out;
  }

  // clientWidth <= 600 ⇒ mobile. Guarded; default false when doc/body absent.
  // This is only the FALLBACK: open() prefers explicit opts.isMobile, then
  // Obsidian's app.isMobile platform flag, and reaches for this heuristic only
  // when `app` is absent (Node tests / cold load).
  _isMobile(doc) {
    try {
      const cw = doc && doc.body && doc.body.clientWidth;
      return typeof cw === "number" && cw > 0 && cw <= 600;
    } catch (_e) { return false; }
  }

  // Build one muted, non-clickable uppercase section-header row.
  _sectionHeader(doc, label, isMobile) {
    const hdr = doc.createElement("div");
    hdr.className = "menu-popover-section";
    hdr.textContent = String(label == null ? "" : label);
    hdr.style.cssText = "flex: 0 0 auto; text-transform: uppercase; letter-spacing: 0.05em;"
      + " color: var(--text-muted); font-weight: 600; opacity: 0.75;"
      + (isMobile ? " font-size: 0.7em; padding: 8px 12px 4px;" : " font-size: 0.66em; padding: 6px 10px 2px;");
    return hdr;
  }

  // Build one actionable row button: icon + label (+ optional sublabel). Clicking
  // it closes the overlay first, then runs the entry's onSelect. danger:true
  // colors the label var(--text-error). `compact` (grid sections) trims the
  // padding/gap slightly so 2-up rows don't feel cramped in a narrower column.
  _buildRow(doc, entry, close, isMobile, compact) {
    const row = doc.createElement("button");
    const icon = (entry && entry.icon) || "";
    const label = (entry && entry.label) || "";
    const danger = !!(entry && entry.danger);
    const sublabel = (entry && entry.sublabel) || "";
    const labelColor = danger ? "var(--text-error)" : "var(--text-normal)";
    const labelSpan = `<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${labelColor};">${label}</span>`;
    const iconSpan = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 auto;">${icon}</span>`;
    if (sublabel) {
      row.innerHTML = iconSpan
        + `<span style="display:flex;flex-direction:column;min-width:0;flex:1 1 auto;">`
        + labelSpan
        + `<span style="color:var(--text-muted);font-size:0.8em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sublabel}</span>`
        + `</span>`;
    } else {
      row.innerHTML = iconSpan + labelSpan;
    }
    row.style.cssText = `cursor: pointer; display: flex; align-items: center; gap: ${compact ? "8" : "10"}px;`
      + " width: 100%; text-align: left; box-sizing: border-box; border: none;"
      + " border-radius: 8px; background: transparent; color: var(--text-normal);"
      + " font-family: inherit; line-height: 1.25;"
      + (isMobile
        ? " padding: 12px; font-size: 1em;"
        : (compact ? " padding: 8px; font-size: 0.88em;" : " padding: 8px 10px; font-size: 0.9em;"));
    row.onmouseenter = () => { row.style.background = "var(--background-modifier-hover)"; };
    row.onmouseleave = () => { row.style.background = "transparent"; };
    row.onclick = () => {
      close();
      try { if (entry && typeof entry.onSelect === "function") entry.onSelect(); }
      catch (_e) { /* never-throw: a bad handler must not wedge the popup */ }
    };
    return row;
  }

  // Open the popup as a viewport overlay appended to opts.doc.body (default
  // document.body) so it is never clipped by the note container: a full-width
  // bottom sheet on mobile, an anchored dropdown on desktop. Backdrop-tap /
  // Escape / re-open (same anchor) closes it.
  open(entries, opts = {}) {
    const doc = opts.doc
      || (typeof activeDocument !== "undefined" && activeDocument)
      || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.body) return null;
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) return null;

    const anchor = opts.anchor || null;
    // A grid section needs 2 real columns of room; widen the desktop dropdown's
    // minimum width so neither column feels squeezed (mobile is already a
    // near-full-width sheet — untouched).
    const hasGridSection = list.some((e) => e && typeof e === "object" && "section" in e && e.layout === "grid");

    // Toggle: if an overlay from THIS anchor is already open, close it and open
    // none — route through its own teardown (__navClose) so the keydown listener
    // is removed too. (Mirrors the guards in the three source implementations.)
    let existing = null;
    try {
      const opened = doc.body.querySelectorAll ? doc.body.querySelectorAll(".menu-popover-overlay") : [];
      for (const o of opened) { if (o && o.__navAnchor === anchor) { existing = o; break; } }
    } catch (_e) { existing = null; }
    if (existing) {
      if (existing.__navClose) existing.__navClose();
      else if (existing.remove) existing.remove();
      return null;
    }

    // Mobile flag precedence (match the source overlays): explicit opts.isMobile
    // → Obsidian's app.isMobile platform flag → the _isMobile(doc) clientWidth
    // fallback (used only when `app` is absent, e.g. Node tests / cold load).
    const isMobile = (typeof opts.isMobile === "boolean")
      ? opts.isMobile
      : ((typeof app !== "undefined" && app && typeof app.isMobile === "boolean")
          ? app.isMobile
          : this._isMobile(doc));

    const overlay = doc.createElement("div");
    overlay.className = "menu-popover-overlay";
    overlay.__navAnchor = anchor;
    overlay.style.cssText = "position: fixed; inset: 0; z-index: 1000;"
      + (isMobile
        ? " background: rgba(0,0,0,0.45); display: flex; align-items: flex-end; justify-content: center;"
        : " background: transparent;");

    const panel = doc.createElement("div");
    panel.className = "menu-popover-panel";
    const panelBase = "box-sizing: border-box; background: var(--background-primary);"
      + " border: 1px solid var(--background-modifier-border);"
      + " box-shadow: 0 8px 30px rgba(0,0,0,0.30); overflow-y: auto;"
      + " display: flex; flex-direction: column;";
    if (isMobile) {
      panel.style.cssText = panelBase
        + " width: 100%; max-width: 620px; max-height: 72vh;"
        + " border-radius: 16px 16px 0 0;"
        + " padding: 8px 8px calc(10px + env(safe-area-inset-bottom, 0px));"
        + " gap: 2px;";
      const handle = doc.createElement("div");
      handle.style.cssText = "flex: 0 0 auto; width: 40px; height: 4px; border-radius: 2px; background: var(--background-modifier-border); margin: 4px auto 8px;";
      panel.appendChild(handle);
    } else {
      const rect = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : { left: 0, bottom: 0, width: 0 };
      const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
      const minWidth = hasGridSection ? 340 : 300;
      const width = Math.min(vw - 16, Math.max(minWidth, Math.round(rect.width) || 0));
      let left = Math.round(rect.left || 0);
      if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
      panel.style.cssText = panelBase
        + ` position: fixed; top: ${Math.round((rect.bottom || 0) + 6)}px; left: ${left}px;`
        + ` width: ${width}px; max-height: 60vh; border-radius: 8px; padding: 6px; gap: 1px;`;
    }

    // Single teardown for ALL dismiss paths (backdrop, Escape, re-open toggle,
    // row select) — removes the overlay AND the capture-phase keydown listener
    // so a stale Escape handler can never swallow keys elsewhere.
    const close = () => {
      if (overlay.remove) overlay.remove();
      else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (doc.removeEventListener) doc.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => { if (e && e.key === "Escape") { if (e.preventDefault) e.preventDefault(); close(); } };
    overlay.__navClose = close;

    // Opening-gesture guard (mobile). A tap synthesizes a delayed "ghost" click
    // at the tap coordinates ~300ms after touchend; the full-screen backdrop now
    // covers that point, so that click lands on the backdrop and self-dismisses
    // the just-opened sheet (opens-then-closes = "tapping does nothing"). Ignore
    // any backdrop dismiss within the opening window so only a deliberate later
    // tap / Escape / re-open closes it. Belt-and-suspenders vs the trigger's own
    // click (sync callers) AND the ~300ms ghost (both sync + async callers).
    const openedAt = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    const withinOpeningGesture = () => {
      if (!openedAt) return false;
      const now = (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
      return now - openedAt < 400;
    };
    overlay.__navOpenedAt = openedAt;

    // Optional muted title header at the very top of the panel.
    if (opts.title) {
      const titleEl = doc.createElement("div");
      titleEl.className = "menu-popover-title";
      titleEl.textContent = String(opts.title);
      titleEl.style.cssText = "flex: 0 0 auto; color: var(--text-muted); font-weight: 600;"
        + (isMobile ? " font-size: 0.9em; padding: 4px 12px 6px;" : " font-size: 0.8em; padding: 2px 10px 4px;");
      panel.appendChild(titleEl);
    }

    // Render each section (a leading header when named) followed by its rows.
    // A section marked layout:"grid" (desktop only — mobile's near-full-width
    // sheet keeps a single stacked column, where 2-up would cramp long labels)
    // renders its rows into a 2-column grid wrapper instead of appending them
    // straight to the panel.
    const sections = this._partitionSections(list);
    for (const sec of sections) {
      if (sec.section != null && sec.section !== "") {
        panel.appendChild(this._sectionHeader(doc, sec.section, isMobile));
      }
      const useGrid = sec.layout === "grid" && !isMobile;
      const rowHost = useGrid ? doc.createElement("div") : panel;
      if (useGrid) {
        rowHost.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 1px 6px;";
        panel.appendChild(rowHost);
      }
      for (const entry of sec.rows) {
        rowHost.appendChild(this._buildRow(doc, entry, close, isMobile, useGrid));
      }
    }

    overlay.onclick = (e) => {
      if (!e || e.target !== overlay) return;
      if (withinOpeningGesture()) return; // ignore the opening tap's ghost/bleed-through click
      close();
    };
    if (doc.addEventListener) doc.addEventListener("keydown", onKey, true);

    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
    return overlay;
  }
}
