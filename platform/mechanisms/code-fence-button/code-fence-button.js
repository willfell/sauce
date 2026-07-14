/**
 * CodeFenceButton — pure, Node-testable wrap logic for the code-fence view-header
 * button. No imports/exports (loaded by the customJS filesystem scan). Static
 * helpers only; no app/DOM dependency in computeFence / wrapSelection.
 */
class CodeFenceButton {
  // Longest run of consecutive backticks in `selection` → fence of max(4, N+1).
  static computeFence(selection) {
    const s = typeof selection === "string" ? selection : "";
    let longest = 0;
    const runs = s.match(/`+/g);
    if (runs) for (const r of runs) if (r.length > longest) longest = r.length;
    const n = Math.max(4, longest + 1);
    return "`".repeat(n);
  }

  static wrapSelection(selection, opts) {
    const sel = typeof selection === "string" ? selection : "";
    if (sel.trim() === "") return null;
    const o = opts || {};
    const fence = CodeFenceButton.computeFence(sel);
    const lead = o.atLineStart ? "" : "\n";
    const tail = o.atLineEnd ? "" : "\n";
    const text = lead + fence + "\n" + sel + "\n" + fence + tail;
    return { text: text, cursor: text.length };
  }

  // App-facing: wrap the active editor's selection in place. Never-throw.
  // Returns true if a wrap happened, false otherwise (no selection / no editor).
  static wrapActiveEditor(view) {
    try {
      const editor = view && view.editor;
      if (!editor || typeof editor.getSelection !== "function") return false;
      const sel = editor.getSelection();
      if (!sel || sel.trim() === "") return false;
      // Determine whether the selection starts at column 0 and ends at line end.
      let atLineStart = true, atLineEnd = true;
      try {
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        atLineStart = from.ch === 0;
        const toLine = editor.getLine(to.line) || "";
        atLineEnd = to.ch >= toLine.length;
      } catch (_e) { /* default to guarded (both false-safe) */ atLineStart = false; atLineEnd = false; }
      const wrapped = CodeFenceButton.wrapSelection(sel, { atLineStart: atLineStart, atLineEnd: atLineEnd });
      if (!wrapped) return false;
      editor.replaceSelection(wrapped.text);
      return true;
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButton.wrapActiveEditor]", e);
      return false;
    }
  }
}
