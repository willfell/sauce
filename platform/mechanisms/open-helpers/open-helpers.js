// open-helpers.js — shared post-open view-mode helper (sauce v0.120.3).
//
// Single API: customJS.OpenHelpers.forceActiveLeafPreview()
// Call it immediately AFTER a create-and-open dispatch. It defers one macrotask
// (so a plugin/Templater-driven open finishes claiming the leaf), then flips the
// active markdown leaf to reading (preview) mode. No-ops on non-markdown leaves
// (a kanban board takes over its leaf with a custom view type — forcing preview
// there blanked panes; see project-nav-buttons.js race note) and never throws.
class OpenHelpers {
  forceActiveLeafPreview() {
    setTimeout(() => {
      try {
        const leaf = app.workspace.activeLeaf;
        if (!leaf || typeof leaf.getViewState !== "function") return;
        const state = leaf.getViewState();
        if (!state || state.type !== "markdown") return;
        if (state.state && state.state.mode === "preview") return;
        leaf.setViewState({ ...state, state: { ...(state.state || {}), mode: "preview" } });
      } catch (_e) { /* convenience hook — never throw */ }
    }, 0);
  }
}
