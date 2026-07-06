/**
 * ChromeBar (CustomJS) — the shared per-surface chrome bar.
 *
 * The blueprint-agnostic extraction of ProjectChromeBar's chrome system: the
 * breadcrumb-left + Go/primary/overflow-right control, its button look, the
 * chrome glyphs, and the Go launcher's Vault section. Any blueprint renders the
 * identical bar by handing render(dv, adapter) an adapter that supplies the
 * blueprint-specific parts (which surface, what controls, where nav points, what
 * actions do, and its own marker classes). ProjectChromeBar is the first consumer.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan; the plugin
 * stores it as an INSTANCE, so every method is an INSTANCE method (internal calls
 * use this.*). Every method is never-throw + cold-load-safe.
 */
class ChromeBar {
  // ── CHROME_ICONS — the bar's own control glyphs (compass = Go, chevronDown =
  // the Go caret, moreHorizontal = the ⋯ overflow). Blueprint-destination glyphs
  // stay with each blueprint's helper.
  get CHROME_ICONS() {
    return {
      compass: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/></svg>`,
      chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
      moreHorizontal: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
    };
  }
}
