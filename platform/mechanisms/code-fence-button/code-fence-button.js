/**
 * CodeFenceButton — pure, Node-testable wrap logic for the code-fence view-header
 * button. No imports/exports (loaded by the customJS filesystem scan).
 *
 * customJS exposes each class as an INSTANCE (customJS.CodeFenceButton is
 * `new CodeFenceButton()`), so these are INSTANCE methods, not static — a static
 * method would be undefined on customJS.CodeFenceButton at runtime (that was the
 * v0.2.1 bug: clicking fired "CodeFenceButton unavailable"). Node tests + the
 * init both reach them via an instance. Methods remain pure (no app/DOM state on
 * `this`); internal self-calls use `this.`.
 */
class CodeFenceButton {
  // Longest run of consecutive backticks in `selection` → fence of max(4, N+1).
  computeFence(selection) {
    const s = typeof selection === "string" ? selection : "";
    let longest = 0;
    const runs = s.match(/`+/g);
    if (runs) for (const r of runs) if (r.length > longest) longest = r.length;
    const n = Math.max(4, longest + 1);
    return "`".repeat(n);
  }

  // Pure affordance decision for a view-header button, given the active view's
  // mode ("preview" = reading, "source" = editable), whether the editor has a
  // selection, and which button (`kind`: "fence" for the ``` block button,
  // "inline" for the single-backtick button). Reading mode can never wrap (no
  // editable selection), so it stays greyed with a hint to switch modes;
  // editable-without-selection is greyed with a "select text" hint;
  // editable-with-selection is lit. Disabled opacity is 0.55 (not 0.35) so the
  // greyed button is still discoverable in the header.
  buttonState(mode, hasSelection, kind) {
    const phrase = kind === "inline" ? "wrap in inline code" : "wrap in a code fence";
    const litLabel = kind === "inline" ? "Wrap selection in inline code" : "Wrap selection in code fence";
    if (mode === "preview") {
      return { enabled: false, opacity: 0.55, label: "Switch to editing mode to " + phrase };
    }
    if (!hasSelection) {
      return { enabled: false, opacity: 0.55, label: "Select text to " + phrase };
    }
    return { enabled: true, opacity: 1, label: litLabel };
  }

  wrapSelection(selection, opts) {
    const sel = typeof selection === "string" ? selection : "";
    if (sel.trim() === "") return null;
    const o = opts || {};
    const fence = this.computeFence(sel);
    const lead = o.atLineStart ? "" : "\n";
    const tail = o.atLineEnd ? "" : "\n";
    const text = lead + fence + "\n" + sel + "\n" + fence + tail;
    return { text: text, cursor: text.length };
  }

  // App-facing: wrap the active editor's selection in place. Never-throw.
  // Returns true if a wrap happened, false otherwise (no selection / no editor).
  wrapActiveEditor(view) {
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
      const wrapped = this.wrapSelection(sel, { atLineStart: atLineStart, atLineEnd: atLineEnd });
      if (!wrapped) return false;
      editor.replaceSelection(wrapped.text);
      return true;
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButton.wrapActiveEditor]", e);
      return false;
    }
  }

  // Inline-code delimiter length: a run of max(1, longest-inner-backtick-run + 1)
  // backticks. One backtick for plain text; more only if the selection itself
  // contains backticks (CommonMark: a code span's delimiter run must exceed any
  // backtick run inside it).
  computeInlineTicks(selection) {
    const s = typeof selection === "string" ? selection : "";
    let longest = 0;
    const runs = s.match(/`+/g);
    if (runs) for (const r of runs) if (r.length > longest) longest = r.length;
    return "`".repeat(Math.max(1, longest + 1));
  }

  // Wrap `selection` in inline code: a backtick delimiter before and after, on
  // the same line (no newlines). Pads a single space inside the delimiters when
  // the delimiter is multi-backtick or the content touches a backtick at an edge
  // (CommonMark requires this so the span parses). Returns { text, cursor } or
  // null for an empty/whitespace selection.
  wrapInline(selection) {
    const sel = typeof selection === "string" ? selection : "";
    if (sel.trim() === "") return null;
    const ticks = this.computeInlineTicks(sel);
    const needsPad = ticks.length > 1 || sel.startsWith("`") || sel.endsWith("`");
    const pad = needsPad ? " " : "";
    const text = ticks + pad + sel + pad + ticks;
    return { text: text, cursor: text.length };
  }

  // App-facing: wrap the active editor's selection in inline code in place.
  // Never-throw. Returns true if a wrap happened, false otherwise.
  wrapActiveEditorInline(view) {
    try {
      const editor = view && view.editor;
      if (!editor || typeof editor.getSelection !== "function") return false;
      const sel = editor.getSelection();
      if (!sel || sel.trim() === "") return false;
      const wrapped = this.wrapInline(sel);
      if (!wrapped) return false;
      editor.replaceSelection(wrapped.text);
      return true;
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButton.wrapActiveEditorInline]", e);
      return false;
    }
  }
}
