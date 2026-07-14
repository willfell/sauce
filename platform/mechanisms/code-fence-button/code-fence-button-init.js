/**
 * CodeFenceButtonInit — customjs startup-script bootstrap for code-fence-button.
 * Registered in customjs_startup_scripts[]. customJS calls invoke() at plugin
 * init. Never-throw + cold-load-safe throughout.
 */
class CodeFenceButtonInit {
  invoke() {
    try {
      // Idempotent teardown across customJS reloads.
      const G = (typeof window !== "undefined") ? window : globalThis;
      const prev = G._sauceCodeFenceButton;
      if (prev && prev.teardown) { try { prev.teardown(); } catch (_e) {} }

      if (typeof app === "undefined" || !app.workspace) return;

      const state = { refs: [], onSel: null, debounce: null };
      const self = this;

      const syncButtons = () => { try { self._syncButtons(); } catch (_e) {} };
      const refreshEnabled = () => { try { self._refreshEnabled(); } catch (_e) {} };

      // Inject on startup + when panes/layout change + when a note opens in an
      // existing tab (file-open — active-leaf-change does NOT fire for same-tab
      // navigation, so without this a note opened in place could miss the button).
      state.refs.push(app.workspace.on("active-leaf-change", () => { syncButtons(); refreshEnabled(); }));
      state.refs.push(app.workspace.on("layout-change", () => { syncButtons(); refreshEnabled(); }));
      try { state.refs.push(app.workspace.on("file-open", () => { syncButtons(); refreshEnabled(); })); } catch (_e) {}

      // Live greying: one debounced document selectionchange listener.
      if (typeof document !== "undefined" && document.addEventListener) {
        state.onSel = () => {
          if (state.debounce) clearTimeout(state.debounce);
          state.debounce = setTimeout(refreshEnabled, 50);
        };
        document.addEventListener("selectionchange", state.onSel);
      }

      state.teardown = () => {
        try { for (const r of state.refs) app.workspace.offref(r); } catch (_e) {}
        try { if (state.onSel) document.removeEventListener("selectionchange", state.onSel); } catch (_e) {}
        if (state.debounce) { try { clearTimeout(state.debounce); } catch (_e) {} }
      };
      G._sauceCodeFenceButton = state;

      this._registerCommand();

      // Initial pass (workspace may already be laid out).
      syncButtons();
      refreshEnabled();

      if (typeof console !== "undefined") {
        console.log("[CodeFenceButtonInit] initialized at", new Date().toISOString());
      }
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButtonInit]", e);
    }
  }

  // Duck-typed markdown-view check (customJS has no MarkdownView symbol).
  _isMarkdownView(view) {
    try {
      return !!view && typeof view.getViewType === "function"
        && view.getViewType() === "markdown"
        && !!view.editor;
    } catch (_e) { return false; }
  }

  _markdownViews() {
    const out = [];
    try {
      const leaves = app.workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) if (leaf && this._isMarkdownView(leaf.view)) out.push(leaf.view);
    } catch (_e) {}
    return out;
  }

  // The two view-header buttons this mechanism injects. `method` is the
  // CodeFenceButton instance method the click delegates to; `kind` feeds
  // buttonState for the correct tooltip; `cmdId`/`cmdName` register the mirror
  // command.
  _buttonSpecs() {
    return [
      { cls: "sauce-code-fence-action", icon: "code-2", kind: "fence",
        method: "wrapActiveEditor",
        cmdId: "code-fence-button:wrap-selection", cmdName: "Sauce: Wrap selection in code fence" },
      { cls: "sauce-inline-code-action", icon: "braces", kind: "inline",
        method: "wrapActiveEditorInline",
        cmdId: "code-fence-button:wrap-inline-code", cmdName: "Sauce: Wrap selection in inline code" },
    ];
  }

  // On mobile, DON'T reorder the native view-header action row — forcing our
  // button to be the last child there displaced/promoted Obsidian's own
  // read/edit toggle. Desktop keeps the far-right placement.
  _isMobile() {
    try { return !!(typeof app !== "undefined" && app.isMobile); } catch (_e) { return false; }
  }

  // Ensure every markdown view carries the code-fence + inline-code actions.
  _syncButtons() {
    const mobile = this._isMobile();
    for (const view of this._markdownViews()) {
      try {
        const root = view.containerEl;
        if (!root) continue;
        const actions = root.querySelector(".view-header .view-actions") || root.querySelector(".view-actions");
        if (!actions) continue;
        if (typeof view.addAction !== "function") continue;
        for (const spec of this._buttonSpecs()) {
          const existing = actions.querySelector("." + spec.cls);
          if (existing) {
            // Desktop only: keep it far-right. Never reorder on mobile.
            if (!mobile && existing.parentElement === actions && existing !== actions.lastElementChild) {
              actions.appendChild(existing);
            }
            continue;
          }
          const el = view.addAction(spec.icon, "", () => this._onClick(view, spec));
          if (!el) continue;
          el.classList.add(spec.cls);
          // Desktop: far right (last child). Mobile: leave addAction's placement.
          if (!mobile && el.parentElement === actions) actions.appendChild(el);
        }
      } catch (_e) { /* never throw */ }
    }
  }

  // Per-view greying for BOTH buttons: lit only for the active EDITABLE view
  // with a selection. Reading-mode views stay greyed (can't wrap rendered
  // content) with a switch-to-editing tooltip; editable-without-selection is
  // greyed with a select-text tooltip. Delegates the decision to the pure
  // CodeFenceButton.buttonState so the affordance is unit-tested.
  _refreshEnabled() {
    const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
    let active = null;
    try {
      const leaf = app.workspace.activeLeaf;
      if (leaf && this._isMarkdownView(leaf.view)) active = leaf.view;
    } catch (_e) {}
    let activeHasSel = false;
    try {
      activeHasSel = !!(active && active.editor && typeof active.editor.somethingSelected === "function"
        && active.editor.somethingSelected());
    } catch (_e) { activeHasSel = false; }
    for (const view of this._markdownViews()) {
      try {
        const root = view.containerEl;
        if (!root) continue;
        let mode = "source";
        try { if (typeof view.getMode === "function") mode = view.getMode(); } catch (_e) {}
        const hasSel = (view === active) && activeHasSel;
        for (const spec of this._buttonSpecs()) {
          const el = root.querySelector("." + spec.cls);
          if (!el) continue;
          const st = (CFB && typeof CFB.buttonState === "function")
            ? CFB.buttonState(mode, hasSel, spec.kind)
            : { enabled: hasSel, opacity: hasSel ? 1 : 0.55, label: spec.cmdName.replace("Sauce: ", "") };
          el.classList.toggle("is-disabled", !st.enabled);
          el.style.opacity = String(st.opacity);
          el.style.color = st.enabled ? "var(--text-accent)" : "";
          el.style.cursor = st.enabled ? "" : "default";
          el.setAttribute("aria-disabled", st.enabled ? "false" : "true");
          el.setAttribute("aria-label", st.label);
        }
      } catch (_e) {}
    }
  }

  _onClick(view, spec) {
    try {
      if (!view || !view.editor) return;
      if (!view.editor.somethingSelected || !view.editor.somethingSelected()) return; // greyed → no-op
      const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
      if (!CFB || typeof CFB[spec.method] !== "function") {
        if (typeof Notice === "function") new Notice("CodeFenceButton unavailable — reinstall the mechanism.", 6000);
        return;
      }
      CFB[spec.method](view);
    } catch (_e) {}
  }

  _registerCommand() {
    if (this._commandRegistered) return;
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;
    for (const spec of this._buttonSpecs()) {
      app.commands.addCommand({
        id: spec.cmdId,
        name: spec.cmdName,
        callback: () => {
          try {
            const leaf = app.workspace && app.workspace.activeLeaf;
            const view = leaf && this._isMarkdownView(leaf.view) ? leaf.view : null;
            if (!view) { if (typeof Notice === "function") new Notice("Select text in a note first.", 4000); return; }
            const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
            if (!CFB || typeof CFB[spec.method] !== "function") { if (typeof Notice === "function") new Notice("CodeFenceButton unavailable.", 6000); return; }
            const did = CFB[spec.method](view);
            if (!did && typeof Notice === "function") new Notice("Select text in a note first.", 4000);
          } catch (_e) {}
        },
      });
    }
    this._commandRegistered = true;
  }
}
