/**
 * people-rendering@0.1.0 — shared CustomJS rendering helpers for People notes.
 *
 * S1 SCAFFOLD ONLY — full implementation in v0.27.0 plan T2.1.
 * All four methods throw "not yet implemented"; the renderer harness will FAIL
 * its 6 PR cases (PR1-PR6) until T2.1 lands the real bodies. This is the
 * intended TDD-RED state for v0.27.0 S1.
 *
 * Loaded via customjs-guard pattern (avoids landmines #1 / #2 cold-load TDZ).
 */
class PeopleRendering {
  /**
   * Render a single Person as an inline chip (name + hover tooltip).
   * @param {HTMLElement} parent
   * @param {string} personLink
   * @param {object} [opts]
   * @returns {HTMLSpanElement}
   */
  renderChip(parent, personLink, opts) {
    throw new Error("PeopleRendering.renderChip: not yet implemented (v0.27.0 T2.1)");
  }

  /**
   * Render a single Person as a BeaconCards row card.
   */
  renderCard(dv, personLink, opts) {
    throw new Error("PeopleRendering.renderCard: not yet implemented (v0.27.0 T2.1)");
  }

  /**
   * Render notes mentioning a person OR people mentioned in a note.
   */
  renderMentionList(dv, query, opts) {
    throw new Error("PeopleRendering.renderMentionList: not yet implemented (v0.27.0 T2.1)");
  }

  /**
   * Extract [[Person]] wikilinks from markdown body, filter to spice/people/.
   */
  extractMentions(markdownBody, opts) {
    throw new Error("PeopleRendering.extractMentions: not yet implemented (v0.27.0 T2.1)");
  }
}
