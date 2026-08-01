// trip-links.js — TripLinks (links on the trip ATLAS note).
//
// Links live in the trip atlas's (type: trip) `links` frontmatter array of
// { url, text } entries. This one class owns all three concerns:
//   - static addLink / updateLink / deleteLink — pure link-mutation ops (a
//     verbatim port of ProjectLinksManager's, unit-tested in the Node harness);
//   - instance openAdd(dv) / openManage(dv) — the add / edit / delete modals,
//     wired from the atlas nav bar in a later task; they read + write the
//     CURRENT note's `links` via app.fileManager.processFrontMatter;
//   - instance render(dv) — a read-only card grid drawn on the atlas body,
//     firing only when page.type === "trip", hidden when empty.
//
// Option B (no `links` mechanism dependency): the parse/render is INLINED so the
// trips blueprint's dependency-set is unchanged and this ships to all vaults
// with zero subscription churn.
//
// customJS stores classes as INSTANCES (customJS.TripLinks = new …), so the
// modals + render are instance methods and the pure ops are static. This file
// MUST stay a bare class expression with NO trailing statements — the customJS
// loader evals the whole file as one expression `("+file+")`; a trailer would
// make it "Unexpected token" and the class would silently never register
// (lesson: customjs-no-trailing-statements). Never throws.
class TripLinks {
  // ── pure link-mutation ops (unit-tested; operate on a parsed [{url,text}]) ──
  // Each returns { links, changed, reason? }; `links` is always a NEW array so
  // callers never mutate the source. url is trimmed + required; text defaults to
  // the url; a url that duplicates an EXISTING entry is rejected.
  static addLink(links, entry) {
    const list = Array.isArray(links) ? links.slice() : [];
    const url = String((entry && entry.url) || "").trim();
    const text = String((entry && entry.text) || "").trim();
    if (!url) return { links: list, changed: false, reason: "empty-url" };
    if (list.some((l) => l.url === url)) return { links: list, changed: false, reason: "duplicate" };
    list.push({ url, text: text || url });
    return { links: list, changed: true };
  }
  static updateLink(links, index, entry) {
    const list = Array.isArray(links) ? links.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return { links: list, changed: false, reason: "bad-index" };
    const url = String((entry && entry.url) || "").trim();
    const text = String((entry && entry.text) || "").trim();
    if (!url) return { links: list, changed: false, reason: "empty-url" };
    if (list.some((l, i) => i !== index && l.url === url)) return { links: list, changed: false, reason: "duplicate" };
    list[index] = { url, text: text || url };
    return { links: list, changed: true };
  }
  static deleteLink(links, index) {
    const list = Array.isArray(links) ? links.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return { links: list, changed: false, reason: "bad-index" };
    list.splice(index, 1);
    return { links: list, changed: true };
  }

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
  // text equals the raw url). Insertion order preserved; duplicates removed.
  _linkCards(links) {
    return this._parse(links).map((l) => {
      const host = this._host(l.url);
      const raw = String(l.text == null ? "" : l.text).trim();
      const text = raw && raw !== l.url ? raw : (host || l.url);
      return { text, url: l.url, host };
    });
  }

  // ── read-only render ─────────────────────────────────────────────────────
  // Draws the "Helpful Links" card grid on the trip ATLAS body. Fires ONLY when
  // page.type === "trip"; reads the note's own `links`. Per the empty-state rule
  // the panel renders NOTHING when there are no links (the nav-bar Add-link
  // affordance owns the empty state). Cold-load safe; never throws.
  render(dv, opts = {}) {
    try {
      const page = customJS.RenderSafe.page(dv);
      if (!page || !page.file) return;              // cold-load guard
      if (page.type !== "trip") return;             // only on the atlas note
      const c = (dv && dv.container) ? dv.container : dv;
      if (!c || typeof c.createEl !== "function") return;
      if (c.closest && c.closest(".markdown-embed")) return;

      const cards = this._linkCards(page.links);
      if (!cards.length) return;                    // empty-state: render nothing

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
    } catch (_e) { /* never throw */ }
  }

  // ── data + write (operate on the CURRENT note — the trip atlas) ──────────
  _file(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) return null;
    return app.vault.getAbstractFileByPath(cur.file.path);
  }
  _currentLinks(dv) {
    const cur = dv.current && dv.current();
    return this._parse(cur ? cur.links : []);
  }
  async _write(dv, links) {
    const file = this._file(dv);
    if (!file) { new Notice("Could not resolve the trip atlas note."); return false; }
    const renderSafe = globalThis.customJS?.RenderSafe;
    if (!renderSafe || typeof renderSafe.mutate !== "function") {
      new Notice("Could not save links: RenderSafe is unavailable.", 6000);
      return false;
    }
    const next = links.map((l) => ({ url: l.url, text: l.text }));
    const expected = JSON.stringify(next);
    const result = await renderSafe.mutate({
      app,
      dv,
      path: file.path,
      write: () => app.fileManager.processFrontMatter(file, (fm) => { fm.links = next; }),
      isCurrent: (page) => {
        const current = page && page.links;
        if (!current || typeof current[Symbol.iterator] !== "function") return false;
        try { return JSON.stringify(Array.from(current).map((l) => ({ url: l.url, text: l.text }))) === expected; }
        catch (_e) { return false; }
      },
    });
    return result.ok === true;
  }

  // ── entry points (wired from the atlas nav bar) ──────────────────────────
  openAdd(dv) {
    this._openForm({ title: "Add link", url: "", text: "" }, async ({ url, text }) => {
      const res = TripLinks.addLink(this._currentLinks(dv), { url, text });
      if (!res.changed) { new Notice(res.reason === "duplicate" ? "That URL is already in the list." : "Enter a URL."); return false; }
      if (await this._write(dv, res.links)) { new Notice("Link added."); return true; }
      return false;
    });
  }

  openManage(dv) {
    const links = this._currentLinks(dv);
    if (!links.length) { new Notice("No links yet — use Add link."); return; }
    this._openModal({ title: "Manage links", build: (panel, close) => {
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:6px; margin:10px 0; max-height:52vh; overflow:auto;";
      links.forEach((link, index) => {
        const rowEl = list.createEl("div");
        rowEl.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--background-modifier-border); border-radius:6px;";
        const label = rowEl.createEl("div");
        label.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        label.createEl("div", { text: link.text }).style.cssText = "font-weight:500; font-size:0.9em;";
        label.createEl("div", { text: link.url }).style.cssText = "font-size:0.75em; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;";
        const editBtn = rowEl.createEl("button", { text: "Edit" });
        editBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); cursor:pointer; font-size:0.8em;";
        editBtn.onclick = () => {
          close();
          this._openForm({ title: "Edit link", url: link.url, text: link.text }, async ({ url, text }) => {
            const res = TripLinks.updateLink(this._currentLinks(dv), index, { url, text });
            if (!res.changed) { new Notice(res.reason === "duplicate" ? "That URL is already in the list." : "Enter a URL."); return false; }
            if (await this._write(dv, res.links)) { new Notice("Link updated."); return true; }
            return false;
          });
        };
        const delBtn = rowEl.createEl("button", { text: "Delete" });
        delBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-error); cursor:pointer; font-size:0.8em;";
        delBtn.onclick = async () => {
          const res = TripLinks.deleteLink(this._currentLinks(dv), index);
          if (res.changed && await this._write(dv, res.links)) { new Notice("Link deleted."); }
          close();
        };
      });
      const done = panel.createEl("button", { text: "Done" });
      done.style.cssText = "margin-top:10px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      done.onclick = close;
    }});
  }

  // ── modals ─────────────────────────────────────────────────────────────────
  _openForm({ title, url, text }, onSubmit) {
    this._openModal({ title, build: (panel, close) => {
      const mk = (labelText, value, placeholder) => {
        const wrap = panel.createEl("div");
        wrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-top:10px;";
        const l = wrap.createEl("label", { text: labelText });
        l.style.cssText = "font-size:0.85em; color:var(--text-muted);";
        const input = wrap.createEl("input"); input.type = "text"; input.value = value || ""; input.placeholder = placeholder;
        input.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
        return input;
      };
      const urlInput = mk("URL", url, "https://example.com");
      const textInput = mk("Link text (optional)", text, "Display text");
      const save = panel.createEl("button", { text: "Save" });
      save.style.cssText = "margin-top:14px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      const submit = async () => {
        const ok = await onSubmit({ url: urlInput.value, text: textInput.value });
        if (ok) close();
      };
      save.onclick = submit;
      urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); textInput.focus(); } });
      textInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
      setTimeout(() => urlInput.focus(), 0);
    }});
  }

  _openModal({ title, build }) {
    const prior = document.querySelector(".sauce-links-modal-overlay");
    if (prior) prior.remove();
    const overlay = document.body.createDiv({ cls: "sauce-links-modal-overlay" });
    overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 9999;";
    const modal = overlay.createDiv();
    modal.style.cssText = "background: var(--background-primary, #1c1c1c); color: var(--text-normal, #ddd); border: 1px solid var(--background-modifier-border, #444); border-radius: 10px; padding: 18px 20px; width: min(440px, 92vw); max-height: 80vh; overflow: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4);";
    const escListener = (ev) => { if (ev.key === "Escape") close(); };
    const close = () => { document.removeEventListener("keydown", escListener); overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener("keydown", escListener);
    const h = modal.createEl("div", { text: title });
    h.style.cssText = "font-weight:600; font-size:1.05em; margin-bottom:4px;";
    build(modal, close);
  }
}
