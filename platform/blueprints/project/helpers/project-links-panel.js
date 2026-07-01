// project-links-panel.js — ProjectLinksPanel (Project Links, PR1).
//
// Read-only "Helpful Links" panel for a per-project Link Hub note. The note owns
// a `links` frontmatter array of { url, text } entries; this panel normalizes it
// and renders a read-only list of external anchors (added order, deduped by url),
// exactly like the shipped `links` mechanism's render output. PR2 adds the
// add/delete/modify manager modals; PR3 backfills a Link Hub note into existing
// projects.
//
// Option B (user decision 2026-07-01): the parse/render is INLINED here rather
// than depending on the `links` mechanism (customJS.Links). Making the project
// blueprint depend on `links` would freeze project-blueprint updates on every
// consumer vault that hasn't subscribed to `links` (install.js checkDeps marks a
// blueprint with an unsubscribed depends_on `unfit` and skips it; bump-pins never
// adds a new transitive dep). Inlining keeps the project blueprint dependency-set
// unchanged, so this ships to all vaults with zero subscription churn. The ~20-line
// duplication mirrors links.js and is trivially promotable to the real dependency
// later. Keep the two renders' external-anchor output in sync.
//
// customJS stores classes as INSTANCES (customJS.ProjectLinksPanel = new …), so
// every method is an instance method (NOT static). Cold-load safe: reads the page
// through customJS.RenderSafe.page(dv) and never throws on a missing container.
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class ProjectLinksPanel {
  // Normalize a raw `links` frontmatter value into an ordered [{ url, text }].
  // Mirrors customJS.Links.parse: accepts an array of objects
  // ({url,text} | {url,label} | {href,text} | {link}/{title}/{name}), an array of
  // bare URL strings, a JSON-encoded string of either, or null/undefined/garbage
  // (-> []). Entries without a usable url are dropped; text defaults to the url;
  // order is preserved; duplicate urls keep the first.
  _parse(value) {
    let raw = value;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return [];
      try { raw = JSON.parse(s); }
      catch (_e) { raw = [s]; }
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
      let url = "";
      let text = "";
      if (entry && typeof entry === "object") {
        url = entry.url || entry.href || entry.link || "";
        text = entry.text || entry.label || entry.title || entry.name || "";
      } else if (typeof entry === "string") {
        url = entry;
      }
      url = String(url == null ? "" : url).trim();
      text = String(text == null ? "" : text).trim();
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, text: text || url });
    }
    return out;
  }

  // Render the read-only "Helpful Links" panel for the current note.
  // Reads `links` off the note's frontmatter (via the render-safe page shim).
  // Empty-renders-nothing when there is no usable container; when the note has
  // no links it shows the label + a muted hint so the Link Hub note isn't blank.
  render(dv, opts = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;              // cold-load guard
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;

    const links = this._parse(page.links);

    // Label via the shared SectionLabel primitive (guarded — absent in cold-load
    // harnesses). Falls back to a plain muted label so the panel still heads up.
    if (customJS.SectionLabel && typeof customJS.SectionLabel.render === "function") {
      customJS.SectionLabel.render(dv, { text: "Helpful Links" });
    } else {
      const lbl = c.createEl("div");
      lbl.textContent = "Helpful Links";
      if (lbl.style) lbl.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";
    }

    if (!links.length) {
      const em = c.createEl("div");
      em.textContent = "No links yet.";
      if (em.style) em.style.cssText = "color: var(--text-muted); font-style: italic;";
      return;
    }

    const list = c.createEl("div");
    if (list.style) list.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
    for (const link of links) {
      const a = list.createEl("a", { text: link.text, href: link.url });
      if (a && typeof a.setAttr === "function") {
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
      if (a && a.style) a.style.cssText = "color: var(--text-accent);";
    }
  }
}
