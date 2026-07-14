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
}
