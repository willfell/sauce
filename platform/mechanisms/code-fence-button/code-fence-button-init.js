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

      // Inject on startup + when panes/layout change.
      state.refs.push(app.workspace.on("active-leaf-change", () => { syncButtons(); refreshEnabled(); }));
      state.refs.push(app.workspace.on("layout-change", () => { syncButtons(); }));

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

  // Ensure every markdown view carries exactly one far-right code-fence action.
  _syncButtons() {
    for (const view of this._markdownViews()) {
      try {
        const root = view.containerEl;
        if (!root) continue;
        const actions = root.querySelector(".view-header .view-actions") || root.querySelector(".view-actions");
        if (!actions) continue;
        if (actions.querySelector(".sauce-code-fence-action")) {
          // already present — just make sure it's still far-right
          const existing = actions.querySelector(".sauce-code-fence-action");
          if (existing && existing.parentElement === actions && existing !== actions.lastElementChild) {
            actions.appendChild(existing);
          }
          continue;
        }
        if (typeof view.addAction !== "function") continue;
        const el = view.addAction("code-2", "Wrap selection in code fence", () => this._onClick(view));
        if (!el) continue;
        el.classList.add("sauce-code-fence-action");
        // Far right: last child of the actions row.
        if (el.parentElement === actions) actions.appendChild(el);
      } catch (_e) { /* never throw */ }
    }
  }

  // Grey every button; enable only the active view's when it has a selection.
  _refreshEnabled() {
    let active = null;
    try {
      // Active markdown view = the one whose editor currently has selection focus.
      const leaf = app.workspace.activeLeaf;
      if (leaf && this._isMarkdownView(leaf.view)) active = leaf.view;
    } catch (_e) {}
    let enabled = false;
    try {
      enabled = !!(active && active.editor && typeof active.editor.somethingSelected === "function"
        && active.editor.somethingSelected());
    } catch (_e) { enabled = false; }
    for (const view of this._markdownViews()) {
      try {
        const root = view.containerEl;
        const el = root && root.querySelector(".sauce-code-fence-action");
        if (!el) continue;
        const on = (view === active) && enabled;
        el.classList.toggle("is-disabled", !on);
        el.style.opacity = on ? "" : "0.35";
        el.style.cursor = on ? "" : "default";
        el.setAttribute("aria-disabled", on ? "false" : "true");
      } catch (_e) {}
    }
  }

  _onClick(view) {
    try {
      if (!view || !view.editor) return;
      if (!view.editor.somethingSelected || !view.editor.somethingSelected()) return; // greyed → no-op
      const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
      if (!CFB || typeof CFB.wrapActiveEditor !== "function") {
        if (typeof Notice === "function") new Notice("CodeFenceButton unavailable — reinstall the mechanism.", 6000);
        return;
      }
      CFB.wrapActiveEditor(view);
    } catch (_e) {}
  }

  _registerCommand() {
    if (this._commandRegistered) return;
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;
    app.commands.addCommand({
      id: "code-fence-button:wrap-selection",
      name: "Sauce: Wrap selection in code fence",
      callback: () => {
        try {
          const leaf = app.workspace && app.workspace.activeLeaf;
          const view = leaf && this._isMarkdownView(leaf.view) ? leaf.view : null;
          if (!view) { if (typeof Notice === "function") new Notice("Select text in a note first.", 4000); return; }
          const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
          if (!CFB) { if (typeof Notice === "function") new Notice("CodeFenceButton unavailable.", 6000); return; }
          const did = CFB.wrapActiveEditor(view);
          if (!did && typeof Notice === "function") new Notice("Select text in a note first.", 4000);
        } catch (_e) {}
      },
    });
    this._commandRegistered = true;
  }
}
