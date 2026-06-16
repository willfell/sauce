// section-label.js — v1.21.0 helper (sauce v0.109.0 S2).
//
// Shared rendering primitive. Replaces every dv.header(3, ...) call across the
// project blueprint with a small uppercase muted label + hairline divider above.
// Consumed by ProjectMeetingsPanel, ProjectWorkstreamManager, ProjectDocsIndex,
// SectionHub. See Docs/agent-guides/project-blueprint-ui.md.
class SectionLabel {
  /**
   * @param dv     Dataview-like (real dv or proxyDv shim) — needs .container.
   * @param opts   { text: string, top?: boolean }
   *   text: label text (rendered as textContent — no markdown).
   *   top:  if true, no hairline above; default false.
   */
  render(dv, opts) {
    if (!opts || !opts.text) return;
    const c = dv.container || dv;
    if (!opts.top) {
      const hr = c.createEl("hr");
      hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 10px 0 6px 0;";
    }
    const lbl = c.createEl("div");
    lbl.textContent = String(opts.text);
    lbl.style.cssText = "font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 6px 0; font-weight: 600;";
  }
}
