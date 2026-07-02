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

  // Best-effort hostname from a url string. Tries the URL parser, then a bare
  // "scheme://host" / "host" regex, and finally falls back to the trimmed url.
  // Never throws on a malformed value (cold-load / user-typed garbage safe).
  _host(url) {
    const s = String(url == null ? "" : url).trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      if (u.hostname) return u.hostname.replace(/^www\./, "");
    } catch (_e) { /* fall through to regex */ }
    const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i) || s.match(/^([^/?#\s]+)/);
    if (m && m[1]) return m[1].replace(/^www\./, "");
    return s;
  }

  // Pure card model for the responsive grid: normalize + dedupe (via _parse),
  // then derive a { text, url, host } per link. host = best-effort hostname;
  // text falls back to the host when the entry carries no display text (or the
  // text equals the raw url, so a bare-url entry shows the tidy host instead).
  // Insertion order preserved; duplicates removed. Never throws.
  _linkCards(links) {
    return this._parse(links).map((l) => {
      const host = this._host(l.url);
      const raw = String(l.text == null ? "" : l.text).trim();
      const text = raw && raw !== l.url ? raw : (host || l.url);
      return { text, url: l.url, host };
    });
  }

  // Resolve the links to display for the current note. On the Link Hub note
  // (type: links-hub) that's the note's own `links`; on a PROJECT hub it's the
  // sibling `Links Hub.md`'s links (PR2 read-only mirror — Option B, no `links`
  // dependency: reuse this class's own _parse over the sibling's frontmatter).
  // Guarded: any dv.pages failure (e.g. cold-load harness) yields [].
  _resolveSiblingLinks(dv, page) {
    try {
      const folder = page && page.file && page.file.folder ? String(page.file.folder) : "";
      if (!folder) return [];
      const hubs = dv.pages('"' + folder + '"').where((p) => p && p.type === "links-hub").array();
      return hubs.length ? this._parse(hubs[0].links) : [];
    } catch (_e) { return []; }
  }

  // Render the read-only "Helpful Links" panel as a responsive card grid. Each
  // link is a card anchor (opens in a new tab) showing the link text (bold) + the
  // host (muted). On the Link Hub note it reads the note's own `links`; on a
  // project hub it mirrors the sibling Link Hub's links. Per the empty-state rule
  // the panel renders NOTHING when there are no links — no label, no divider, no
  // "No links yet." hint (the Add-link button above owns the empty affordance).
  render(dv, opts = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;              // cold-load guard
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;

    // Sibling-mirror mode activates ONLY on an actual project hub (type:project);
    // the Link Hub note and any other note read their own `links` (backward-compat).
    const onProjectHub = page.type === "project";
    const raw = onProjectHub ? this._resolveSiblingLinks(dv, page) : this._parse(page.links);
    const cards = this._linkCards(raw);
    if (!cards.length) return;                    // empty-state: render nothing

    // Leading hairline + "Helpful Links" label via the shared SectionLabel
    // primitive (guarded — absent in cold-load harnesses; falls back to a plain
    // divider + muted label so the panel still heads up).
    if (customJS.SectionLabel && typeof customJS.SectionLabel.render === "function") {
      customJS.SectionLabel.render(dv, { text: "Helpful Links" });
    } else {
      if (customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") {
        customJS.SectionLabel.divider(c);
      }
      const lbl = c.createEl("div");
      lbl.textContent = "Helpful Links";
      if (lbl.style) lbl.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";
    }

    const grid = c.createEl("div");
    if (grid.style) grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 4px;";
    for (const card of cards) {
      const a = grid.createEl("a", { href: card.url });
      if (a && typeof a.setAttr === "function") {
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
      if (a && a.style) {
        a.style.cssText =
          "display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; " +
          "border: 1px solid var(--background-modifier-border); border-radius: 8px; " +
          "background: var(--background-primary); color: var(--text-normal); " +
          "text-decoration: none; transition: transform 0.08s ease, box-shadow 0.08s ease, border-color 0.08s ease;";
      }
      if (a && typeof a.addEventListener === "function") {
        a.addEventListener("mouseenter", () => { if (a.style) { a.style.transform = "translateY(-1px)"; a.style.boxShadow = "0 2px 8px rgba(0,0,0,0.18)"; a.style.borderColor = "var(--interactive-accent)"; } });
        a.addEventListener("mouseleave", () => { if (a.style) { a.style.transform = ""; a.style.boxShadow = ""; a.style.borderColor = "var(--background-modifier-border)"; } });
      }
      const title = a.createEl("div", { text: card.text });
      if (title && title.style) title.style.cssText = "font-weight: 600; font-size: 0.92em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      if (card.host) {
        const host = a.createEl("div", { text: card.host });
        if (host && host.style) host.style.cssText = "font-size: 0.76em; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
      }
    }
  }
}
