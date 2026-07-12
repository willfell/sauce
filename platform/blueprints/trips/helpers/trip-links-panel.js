// trip-links-panel.js — TripLinksPanel (Trip Links section, read-only).
//
// Read-only "Helpful Links" panel for a trip's Links section note. The note owns
// a `links` frontmatter array of { url, text } entries; this panel normalizes it
// and renders a read-only list of external anchors (added order, deduped by url).
// The add/delete/modify manager modals live in TripLinksManager.
//
// Ported verbatim from ProjectLinksPanel — only the render note-type guard
// changes (trip-section + section_kind:links). Trips has NO atlas mirror of a
// trip's links (each trip's Links section owns its own `links`), so the project
// version's sibling-mirror path (_resolveSiblingLinks over a project hub) is
// dropped: the panel always renders the current note's own `links`.
//
// The parse/render is INLINED here rather than depending on the `links`
// mechanism (Option B), keeping the trips blueprint's dependency-set unchanged so
// this ships to all vaults with zero subscription churn. The static `_parse` is
// reused by TripLinksManager at runtime.
//
// customJS stores classes as INSTANCES (customJS.TripLinksPanel = new …), so
// every method is an instance method (NOT static). Cold-load safe: reads the page
// through customJS.RenderSafe.page(dv) and never throws on a missing container.
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class TripLinksPanel {
  // Normalize a raw `links` frontmatter value into an ordered [{ url, text }].
  // Accepts an array of objects ({url,text} | {url,label} | {href,text} |
  // {link}/{title}/{name}), an array of bare URL strings, a JSON-encoded string
  // of either, or null/undefined/garbage (-> []). Entries without a usable url
  // are dropped; text defaults to the url; order is preserved; duplicate urls
  // keep the first.
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

  // Render the read-only "Helpful Links" panel as a responsive card grid. Each
  // link is a card anchor (opens in a new tab) showing the link text (bold) + the
  // host (muted). Reads the note's own `links`. Per the empty-state rule the
  // panel renders NOTHING when there are no links — no label, no divider, no
  // "No links yet." hint (the Add-link button above owns the empty affordance).
  render(dv, opts = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;              // cold-load guard
    if (page.type !== "trip-section" || page.section_kind !== "links") return;  // only on the Links section
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;

    const cards = this._linkCards(page.links);
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
