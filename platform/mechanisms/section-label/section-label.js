// section-label.js — section-label mechanism v0.1.0 (promoted from the project
// blueprint helper at sauce v0.122.0; originally shipped at sauce v0.109.0 S2).
//
// Shared rendering primitive. Replaces every dv.header(3, ...) call across any
// blueprint that depends_on section-label with a small uppercase muted label +
// hairline divider above. Consumed today by ProjectMeetingsPanel,
// ProjectWorkstreamManager, ProjectDocsIndex, SectionHub, and the to-do helpers.
// See Docs/agent-guides/project-blueprint-ui.md (planned to generalize to
// note-chrome.md in a later cycle).
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

  /**
   * Standalone chrome hairline — the canonical divider owned by helpers.
   * Replaces literal markdown `---` between chrome tiers so spacing is uniform
   * and tunable in one place. See Docs/agent-guides/note-chrome.md.
   * @param dv Dataview-like (real dv or proxyDv shim) with .container, OR a container element.
   * @returns the created <hr> element.
   */
  divider(dv) {
    const c = (dv && dv.container) || dv;
    const hr = c.createEl("hr");
    hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0;";
    return hr;
  }
}
