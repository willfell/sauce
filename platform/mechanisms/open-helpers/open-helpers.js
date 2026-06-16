// open-helpers.js — shared post-open view-mode helper (sauce v0.120.3).
//
// Two APIs:
//   customJS.OpenHelpers.forceActiveLeafPreview()  — flips the ACTIVE leaf
//     (use when the open is driven by an async plugin/command and we hold no
//     leaf handle; the deferred activeLeaf read is the only handle available).
//   customJS.OpenHelpers.forceLeafPreview(leaf)     — flips a SPECIFIC leaf
//     captured at call time (use whenever we have a handle, e.g. the leaf
//     returned by getLeaf(false).openFile(...)). Capturing the leaf avoids a
//     race where focus moves before the deferred body runs and we flip the
//     wrong note.
//
// Both defer one macrotask (so a plugin/Templater-driven open finishes claiming
// the leaf), then flip the leaf to reading (preview) mode. Both no-op on
// non-markdown leaves (a kanban board takes over its leaf with a custom view
// type — forcing preview there blanked panes; see project-nav-buttons.js race
// note) and never throw.
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

  // Same deferred + guarded + never-throw logic as forceActiveLeafPreview, but
  // operates on the PASSED leaf (captured at call time) rather than re-reading
  // app.workspace.activeLeaf later. Never reads activeLeaf.
  forceLeafPreview(leaf) {
    if (!leaf || typeof leaf.getViewState !== "function") return;
    setTimeout(() => {
      try {
        const state = leaf.getViewState();
        if (!state || state.type !== "markdown") return;
        if (state.state && state.state.mode === "preview") return;
        leaf.setViewState({ ...state, state: { ...(state.state || {}), mode: "preview" } });
      } catch (_e) { /* convenience hook — never throw */ }
    }, 0);
  }
}
