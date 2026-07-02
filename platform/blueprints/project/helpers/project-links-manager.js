// project-links-manager.js — ProjectLinksManager (Project Links Wiring, PR2).
//
// Add / edit / delete link dialogs on the per-project Link Hub note. Renders an
// "Add link" + "Manage links" button row; the modals write the note's `links`
// frontmatter via app.fileManager.processFrontMatter. The read-only list stays
// owned by ProjectLinksPanel (rendered below this in the Link Hub template).
//
// Option B (PR1 decision): NO project->`links` mechanism dependency. The link
// normalization reuses ProjectLinksPanel._parse at runtime (with a minimal
// fallback), so this ships to every vault with zero subscription churn.
//
// The pure link-mutation logic (addLink / updateLink / deleteLink) is static so
// the Node harness exercises it directly; the modals + processFrontMatter are
// dogfood-only (untestable in the harness), mirroring ProjectWorkstreamManager.
//
// customJS stores classes as INSTANCES (customJS.ProjectLinksManager = new …),
// so render + handlers are instance methods. This file MUST stay a bare class
// expression with NO trailing statements — the customJS loader evals the whole
// file as one expression `("+file+")` (lesson: customjs-no-trailing-statements).
class ProjectLinksManager {
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

  // Reuse PR1's canonical parse (Option B inline); minimal fallback if absent.
  _parse(value) {
    const P = window.customJS && window.customJS.ProjectLinksPanel;
    if (P && typeof P._parse === "function") return P._parse(value);
    if (!Array.isArray(value)) return [];
    return value
      .filter((x) => x && (x.url || typeof x === "string"))
      .map((x) => (typeof x === "string" ? { url: x, text: x } : { url: String(x.url), text: String(x.text || x.url) }));
  }

  // ── render ─────────────────────────────────────────────────────────────────
  async render(dv, opts = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;              // cold-load guard
    if (page.type !== "links-hub") return;        // only on the Link Hub note
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;
    if (c.closest && c.closest(".markdown-embed")) return;

    const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
    const gearIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4h2l.4 2.3a7 7 0 0 1 2 1.2l2.2-.9 1 1.7-1.7 1.5a7 7 0 0 1 0 2.4l1.7 1.5-1 1.7-2.2-.9a7 7 0 0 1-2 1.2L13 20h-2l-.4-2.3a7 7 0 0 1-2-1.2l-2.2.9-1-1.7 1.7-1.5a7 7 0 0 1 0-2.4L3.4 8.3l1-1.7 2.2.9a7 7 0 0 1 2-1.2z"/><circle cx="12" cy="12" r="3"/></svg>`;

    const row = c.createEl("div");
    row.style.cssText = "display: flex; gap: 8px; margin: 0.4em 0 0.2em;";
    customJS.AccentButton.render(row, { label: "Add link", icon: plusIcon, onClick: () => this._onAdd(dv) });
    customJS.AccentButton.render(row, { label: "Manage links", icon: gearIcon, onClick: () => this._onManage(dv) });
  }

  // ── data + write ─────────────────────────────────────────────────────────
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
    if (!file) { new Notice("Could not resolve the Link Hub note."); return false; }
    try {
      await app.fileManager.processFrontMatter(file, (fm) => { fm.links = links.map((l) => ({ url: l.url, text: l.text })); });
      return true;
    } catch (e) { new Notice("Could not save links: " + (e.message || e), 6000); return false; }
  }

  // ── handlers ───────────────────────────────────────────────────────────────
  _onAdd(dv) {
    this._openForm({ title: "Add link", url: "", text: "" }, async ({ url, text }) => {
      const res = ProjectLinksManager.addLink(this._currentLinks(dv), { url, text });
      if (!res.changed) { new Notice(res.reason === "duplicate" ? "That URL is already in the list." : "Enter a URL."); return false; }
      if (await this._write(dv, res.links)) { new Notice("Link added."); return true; }
      return false;
    });
  }

  _onManage(dv) {
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
            const res = ProjectLinksManager.updateLink(this._currentLinks(dv), index, { url, text });
            if (!res.changed) { new Notice(res.reason === "duplicate" ? "That URL is already in the list." : "Enter a URL."); return false; }
            if (await this._write(dv, res.links)) { new Notice("Link updated."); return true; }
            return false;
          });
        };
        const delBtn = rowEl.createEl("button", { text: "Delete" });
        delBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-error); cursor:pointer; font-size:0.8em;";
        delBtn.onclick = async () => {
          const res = ProjectLinksManager.deleteLink(this._currentLinks(dv), index);
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
