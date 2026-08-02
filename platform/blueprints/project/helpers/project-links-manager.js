// project-links-manager.js — ProjectLinksManager (Project Links Wiring, PR2).
//
// Add / edit / delete link dialogs on the per-project Link Hub note. Renders an
// "Add link" + "Manage links" button row; the modals write the note's `links`
// frontmatter via RenderSafe.mutateStructure. The read-only list stays
// owned by ProjectLinksPanel (rendered below this in the Link Hub template).
//
// Option B (PR1 decision): NO project->`links` mechanism dependency. The link
// normalization reuses ProjectLinksPanel._parse at runtime (with a minimal
// fallback), so this ships to every vault with zero subscription churn.
//
// The pure link-mutation logic (addLink / updateLink / deleteLink) is static so
// the Node harness exercises it directly; the modals + mutation lifecycle are
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

    // Leading hairline so the action row reads as its own chrome tier (the
    // ProjectLinksPanel below renders its own leading divider for the trailing
    // boundary). Guarded — SectionLabel is absent in cold-load harnesses.
    if (customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") {
      customJS.SectionLabel.divider(c);
    }

    const row = c.createEl("div", { cls: "sauce-action-row" });
    const add = customJS.AccentButton.render(row, { label: "Add link", icon: plusIcon, onClick: () => this._onAdd(dv) });
    const manage = customJS.AccentButton.render(row, { label: "Manage links", icon: gearIcon, onClick: () => this._onManage(dv) });
    for (const btn of [add, manage]) {
      if (!btn) continue;
      if (btn.classList?.add) btn.classList.add("sauce-btn");
      else btn.className = `${btn.className || ""} sauce-btn`.trim();
      if (btn.style) btn.style.cssText = "";
      btn.onmouseenter = null;
      btn.onmouseleave = null;
    }
  }

  // ── data + write ─────────────────────────────────────────────────────────
  _file(dv) {
    const cur = globalThis.customJS?.RenderSafe?.page?.(dv);
    if (!cur || !cur.file) return null;
    return app.vault.getAbstractFileByPath(cur.file.path);
  }
  _currentLinks(dv) {
    const cur = globalThis.customJS?.RenderSafe?.page?.(dv);
    return this._parse(cur ? cur.links : []);
  }
  async _write(dv, links) {
    const file = this._file(dv);
    if (!file) { new Notice("Could not resolve the Link Hub note."); return false; }
    const renderSafe = globalThis.customJS?.RenderSafe;
    if (!renderSafe || typeof renderSafe.mutateStructure !== "function") {
      new Notice("Could not save links: RenderSafe is unavailable.", 6000);
      return false;
    }
    const next = links.map((l) => ({ url: l.url, text: l.text }));
    const page = renderSafe.page?.(dv);
    if (!page) { new Notice("Could not save links: page metadata is unavailable.", 6000); return false; }
    const result = await renderSafe.mutateStructure({
      app,
      dv,
      path: file.path,
      failureMessage: "Could not save links",
      apply: () => {
        const hadValue = Object.prototype.hasOwnProperty.call(page, "links");
        const priorValue = page.links;
        const focusTarget = (typeof document !== "undefined") ? document.activeElement : null;
        const root = dv && dv.container;
        let grid = root && root.querySelector ? root.querySelector(".project-links-grid") : null;
        let createdGrid = null;
        const panel = globalThis.customJS?.ProjectLinksPanel;
        if (!grid && root && typeof root.createEl === "function"
          && panel && typeof panel._renderCardsInto === "function") {
          grid = root.createEl("div", { cls: "project-links-grid project-links-grid-optimistic" });
          if (grid.style) grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:10px;";
          createdGrid = grid;
        }
        const priorNodes = grid ? Array.from(grid.childNodes || grid.children || []) : [];
        page.links = next;
        if (grid && panel && typeof panel._renderCardsInto === "function") panel._renderCardsInto(grid, next);
        return { page, hadValue, priorValue, focusTarget, grid, createdGrid, priorNodes };
      },
      rollback: (receipt) => {
        if (receipt && receipt.createdGrid) {
          receipt.createdGrid.remove?.();
        } else if (receipt && receipt.grid) {
          if (typeof receipt.grid.replaceChildren === "function") receipt.grid.replaceChildren(...receipt.priorNodes);
          else {
            receipt.grid.empty?.();
            for (const node of receipt.priorNodes || []) receipt.grid.appendChild?.(node);
          }
        }
        if (receipt && receipt.page) {
          if (receipt.hadValue) receipt.page.links = receipt.priorValue;
          else delete receipt.page.links;
        }
        try { receipt && receipt.focusTarget && receipt.focusTarget.focus?.(); } catch (_e) {}
      },
      write: () => app.fileManager.processFrontMatter(file, (fm) => { fm.links = next; }),
    });
    return result.ok === true;
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
    let acted = false;
    this._openModal({ title: "Manage links", buttons: [{ label: "Done", action: "cancel" }], build: (panel, close) => {
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:6px; margin:10px 0; max-height:52vh; overflow:auto;";
      links.forEach((link, index) => {
        const rowEl = list.createEl("div");
        rowEl.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--sauce-hairline); border-radius:var(--sauce-radius-btn);";
        const label = rowEl.createEl("div");
        label.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        label.createEl("div", { text: link.text }).style.cssText = "font-weight:500; font-size:0.9em;";
        label.createEl("div", { text: link.url }).style.cssText = "font-size:0.75em; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;";
        const editBtn = rowEl.createEl("button", { cls: "sauce-btn", text: "Edit" });
        editBtn.onclick = () => {
          if (acted) return false;
          acted = true;
          close();
          this._openForm({ title: "Edit link", url: link.url, text: link.text }, async ({ url, text }) => {
            const res = ProjectLinksManager.updateLink(this._currentLinks(dv), index, { url, text });
            if (!res.changed) { new Notice(res.reason === "duplicate" ? "That URL is already in the list." : "Enter a URL."); return false; }
            if (await this._write(dv, res.links)) { new Notice("Link updated."); return true; }
            return false;
          });
        };
        const delBtn = rowEl.createEl("button", { cls: "sauce-btn sauce-btn-danger", text: "Delete" });
        delBtn.onclick = async () => {
          if (acted) return false;
          acted = true;
          const res = ProjectLinksManager.deleteLink(this._currentLinks(dv), index);
          if (res.changed && await this._write(dv, res.links)) {
            new Notice("Link deleted.");
            close();
            return true;
          }
          acted = false;
          try { delBtn.focus(); } catch (_e) {}
          return false;
        };
      });
    }});
  }

  // ── modals ─────────────────────────────────────────────────────────────────
  _openForm({ title, url, text }, onSubmit) {
    let urlInput = null;
    let textInput = null;
    let submitting = false;
    const submit = async (handle) => {
      if (submitting) return false;
      submitting = true;
      try {
        const ok = await onSubmit({ url: urlInput.value, text: textInput.value });
        if (ok) handle.close("submit");
        return ok;
      } finally { submitting = false; }
    };
    return this._openModal({
      title,
      autofocus: true,
      buttons: [
        { label: "Cancel", action: "cancel" },
        { label: "Save", tone: "accent", close: false, onClick: (handle) => submit(handle) },
      ],
      build: (panel, close, handle) => {
      const mk = (labelText, value, placeholder) => {
        const wrap = panel.createEl("div");
        wrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-top:10px;";
        const l = wrap.createEl("label", { text: labelText });
        l.style.cssText = "font-size:0.85em; color:var(--text-muted);";
        const input = wrap.createEl("input"); input.type = "text"; input.value = value || ""; input.placeholder = placeholder;
        input.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
        return input;
      };
      urlInput = mk("URL", url, "https://example.com");
      textInput = mk("Link text (optional)", text, "Display text");
      urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); textInput.focus(); } });
      textInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(handle); } });
    }});
  }

  _openModal({ title, build, buttons, autofocus = false }) {
    const modal = (typeof globalThis !== "undefined" && globalThis.customJS)
      ? globalThis.customJS.SauceModal : null;
    if (!modal || typeof modal.open !== "function") {
      try { new Notice("Project links: SauceModal unavailable — reinstall the project blueprint.", 6000); } catch (_e) {}
      return null;
    }
    return modal.open({
      title,
      autofocus,
      buttons,
      body: (panel, handle) => build(panel, () => handle.close("cancel"), handle),
    });
  }
}
