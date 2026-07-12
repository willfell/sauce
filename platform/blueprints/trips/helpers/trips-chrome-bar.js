/**
 * TripsChromeBar (CustomJS) — the trips blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / primary / ⋯ bar on trip surfaces via
 * customJS.ChromeBar.makeAdapter(this._config()). Reuses the EXISTING
 * TripNavButtons instance methods for trip/section creation (_createTrip,
 * _createTripSection, and their prompt dialogs) — no new creation code.
 * Section navigation moves to `destinations` (Go ▾); the "New Section" action
 * (available on every non-hub trip surface, mirroring the old launcher) moves
 * to `overflow`. Instance methods; never-throw; cold-load-safe.
 */
class TripsChromeBar {
  get ICON() {
    return {
      plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
      trip: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
      board: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/trips";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (!["trips-hub", "trip", "trip-section", "trip-board-card"].includes(t)) return null;
        return {
          context: t,
          path: (page.file && page.file.path) || "",
          tripSlug: page.trip_slug || null,
          tripName: page.name || null,
        };
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "trips-hub") {
          return { primary: { id: "new-trip", label: "New Trip", icon: ICON.plus }, overflow: [], leaf: false };
        }
        const newSection = { id: "new-section", label: "New Section", icon: ICON.plus };
        if (ctx.context === "trip") {
          return { primary: null, overflow: [newSection], leaf: false };
        }
        // trip-section / trip-board-card — New Section is atlas-only
        return { primary: null, overflow: [], leaf: true };
      },
      // Returns the underlying promise chain (harmless for production onClick
      // callers, which don't await it) so tests can `await cfg.dispatch(...)`
      // and deterministically observe the async outcome.
      dispatch: (dv, ctx, id) => {
        const TNB = customJS && customJS.TripNavButtons;
        if (id === "new-trip") {
          if (!TNB || typeof TNB._promptForTripDetails !== "function" || typeof TNB._createTrip !== "function") {
            if (typeof Notice === "function") new Notice("TripsChromeBar: TripNavButtons unavailable — reinstall trips blueprint.", 6000);
            return;
          }
          return TNB._promptForTripDetails().then((details) => {
            if (!details) return;
            return TNB._createTrip(details).then((atlasPath) => {
              if (atlasPath) {
                if (typeof Notice === "function") new Notice(`Created trip: ${details.name}`);
                try { app.workspace.openLinkText(atlasPath, ""); } catch (_e) { /* never throw */ }
              }
            });
          });
        }
        if (id === "new-section") {
          if (!TNB || typeof TNB._promptForSectionTitle !== "function" || typeof TNB._createTripSection !== "function") {
            if (typeof Notice === "function") new Notice("TripsChromeBar: TripNavButtons unavailable — reinstall trips blueprint.", 6000);
            return;
          }
          if (!ctx.tripSlug) {
            if (typeof Notice === "function") new Notice("TripsChromeBar: this trip note is missing trip_slug — cannot create a section.", 6000);
            return;
          }
          const tripDir = ROOT + "/" + ctx.tripSlug;
          return TNB._promptForSectionTitle(tripDir).then((title) => {
            if (!title) return;
            return TNB._createTripSection(tripDir, title, ctx.tripName, ctx.tripSlug).then((p) => {
              if (p) {
                if (typeof Notice === "function") new Notice(`Created section: ${title}`);
                try { app.workspace.openLinkText(p, ""); } catch (_e) { /* never throw */ }
              }
            });
          });
        }
      },
      // The Go ▾ "This trip" section: Trips Hub, the trip's own atlas (unless we ARE
      // the atlas), and sibling sections (queried by trip_slug, not path parsing).
      destinations: (dv, ctx) => {
        const out = [{ section: "This trip" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const hubPath = ROOT + "/Trips.md";
        if (ctx.path !== hubPath) out.push({ label: "Trips Hub", icon: ICON.board, _navTarget: hubPath, onSelect: () => open(hubPath) });
        if (ctx.context === "trips-hub" || !ctx.tripSlug) return out;
        let atlasPage = null;
        try {
          const atlases = dv.pages('"' + ROOT + '"').where((p) => p.type === "trip" && p.trip_slug === ctx.tripSlug).array();
          atlasPage = atlases.length ? atlases[0] : null;
        } catch (_e) { atlasPage = null; }
        const atlasPath = atlasPage && atlasPage.file && atlasPage.file.path;
        if (atlasPath && atlasPath !== ctx.path) {
          out.push({ label: (atlasPage.name || atlasPage.file.name), icon: ICON.trip, _navTarget: atlasPath, onSelect: () => open(atlasPath) });
        }
        if (ctx.context === "trip-section" || ctx.context === "trip-board-card") {
          let siblings = [];
          try { siblings = dv.pages('"' + ROOT + '"').where((p) => p.type === "trip-section" && p.trip_slug === ctx.tripSlug).array(); } catch (_e) { siblings = []; }
          for (const s of siblings) {
            const sPath = s.file && s.file.path;
            if (sPath && sPath !== ctx.path) {
              out.push({ label: s.section || s.file.name, icon: ICON.trip, _navTarget: sPath, onSelect: () => open(sPath) });
            }
          }
        }
        return out;
      },
      rootClass: "trips-chrome-root",
      btnClass: (v) => `trips-chrome-btn trips-chrome-btn-${v}`,
    };
  }
}
