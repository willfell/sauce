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
    if (!Array.isArray(raw)) {
      if (!raw || typeof raw === "string" || typeof raw[Symbol.iterator] !== "function") return [];
      try { raw = Array.from(raw); } catch (_e) { return []; }
    }
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

  _renderCardsInto(grid, links) {
    if (!grid || typeof grid.createEl !== "function") return;
    for (const card of this._linkCards(links)) {
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

      const ownerPath = String(page.file.path || "");
      if (c.dataset) c.dataset.tripLinksOwnerPath = ownerPath;
      if (c.classList?.add) c.classList.add("trip-links-owner");
      else if (!String(c.className || "").split(/\s+/).includes("trip-links-owner")) {
        c.className = `${c.className || ""} trip-links-owner`.trim();
      }

      const state = this._linksState(c, page);
      const cards = this._linkCards(state.model);
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

      const grid = c.createEl("div", { cls: "trip-links-grid" });
      if (grid.dataset) grid.dataset.sourcePath = ownerPath;
      if (grid.style) grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 4px;";
      this._renderCardsInto(grid, cards);
    } catch (_e) { /* never throw */ }
  }

  // ── data + write (operate on the CURRENT note — the trip atlas) ──────────
  _page(dv) {
    const renderSafe = globalThis.customJS?.RenderSafe;
    if (renderSafe && typeof renderSafe.page === "function") return renderSafe.page(dv);
    try { return dv && typeof dv.current === "function" ? dv.current() : null; }
    catch (_e) { return null; }
  }
  _file(dv) {
    const cur = this._page(dv);
    if (!cur || !cur.file) return null;
    return app.vault.getAbstractFileByPath(cur.file.path);
  }
  _currentLinks(dv) {
    const cur = this._page(dv);
    const filePath = cur && cur.file ? cur.file.path : "";
    const owner = filePath ? this._panelOwner(dv, filePath) : null;
    if (owner) return this._parse(this._linksState(owner, cur).model);
    return this._parse(cur ? cur.links : []);
  }
  _linkIndex(links, target) {
    const url = String(target?.url || "").trim();
    if (!url) return -1;
    return this._parse(links).findIndex((link) => link.url === url);
  }
  _panelOwner(dv, filePath) {
    const container = dv && dv.container;
    const scopes = [container];
    try {
      const noteView = container?.closest?.(".markdown-preview-view, .markdown-reading-view, .markdown-source-view, .workspace-leaf-content");
      if (noteView) scopes.push(noteView);
    } catch (_e) {}
    for (const scope of scopes) {
      try {
        const candidates = [];
        if (scope?.dataset?.tripLinksOwnerPath != null) candidates.push(scope);
        if (typeof scope?.querySelectorAll === "function") candidates.push(...scope.querySelectorAll(".trip-links-owner"));
        else {
          const owner = scope?.querySelector?.(".trip-links-owner");
          if (owner) candidates.push(owner);
        }
        const match = candidates.find((owner) =>
          String(owner?.dataset?.tripLinksOwnerPath || "") === String(filePath || ""));
        if (match) return match;
      } catch (_e) {}
    }
    return null;
  }
  _linksState(owner, page) {
    if (!this._linksMutationStates) this._linksMutationStates = new WeakMap();
    let state = this._linksMutationStates.get(owner);
    const incoming = this._parse(page && page.links);
    const path = String(page?.file?.path || owner?.dataset?.tripLinksOwnerPath || "");
    const metadataVersion = this._metadataVersion(path);
    if (!state || state.path !== path) {
      state = {
        path,
        model: incoming,
        tail: Promise.resolve(),
        queued: 0,
        epoch: 0,
        authority: null,
      };
      this._linksMutationStates.set(owner, state);
      return state;
    }
    if (state.queued === 0) {
      if (state.authority) {
        const matches = this._sameLinks(incoming, state.authority.expected);
        const incomingMtime = this._pageMtime(page);
        const externallyNewer = incomingMtime != null && state.authority.writeMtime != null
          && incomingMtime > state.authority.writeMtime;
        const cached = incomingMtime == null ? this._cachedLinks(path) : null;
        const cacheAdvanced = cached && metadataVersion > (state.authority.cacheVersion || 0);
        if (matches) {
          state.model = incoming;
          state.authority = null;
        } else if (externallyNewer) {
          state.model = incoming;
          state.authority = {
            expected: incoming,
            writeMtime: incomingMtime,
            cacheVersion: metadataVersion,
          };
        } else if (cacheAdvanced) {
          if (this._sameLinks(cached.model, state.authority.expected)) {
            state.authority.cacheVersion = metadataVersion;
            if (cached.mtime != null) state.authority.writeMtime = cached.mtime;
          } else {
            state.model = cached.model;
            state.authority = {
              expected: cached.model,
              writeMtime: cached.mtime,
              cacheVersion: metadataVersion,
            };
          }
        }
      } else {
        state.model = incoming;
      }
    }
    return state;
  }
  _sameLinks(left, right) {
    try { return JSON.stringify(this._parse(left)) === JSON.stringify(this._parse(right)); }
    catch (_e) { return false; }
  }
  _pageMtime(page) {
    const value = page?.file?.mtime;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    try {
      const numeric = value && typeof value.valueOf === "function" ? Number(value.valueOf()) : NaN;
      return Number.isFinite(numeric) ? numeric : null;
    } catch (_e) { return null; }
  }
  _fileMtime(file) {
    const value = file?.stat?.mtime;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  _cachedLinks(path) {
    try {
      if (typeof app === "undefined") return null;
      const file = app.vault?.getAbstractFileByPath?.(path);
      if (!file) return null;
      const frontmatter = app.metadataCache?.getFileCache?.(file)?.frontmatter;
      if (!frontmatter || typeof frontmatter !== "object") return null;
      return { mtime: this._fileMtime(file), model: this._parse(frontmatter.links) };
    } catch (_e) { return null; }
  }
  _metadataTracker() {
    try {
      if (typeof app === "undefined" || !app.metadataCache) return null;
      const cache = app.metadataCache;
      const slot = Symbol.for("sauce.trips.metadata-generations");
      let tracker = globalThis[slot];
      if (!tracker || tracker.cache !== cache) {
        const versions = tracker?.versions instanceof Map ? tracker.versions : new Map();
        if (tracker?.ref != null && typeof tracker.cache?.offref === "function") {
          tracker.cache.offref(tracker.ref);
          tracker.ref = null;
        }
        tracker = { cache, versions, ref: null };
        if (typeof cache.on === "function") {
          tracker.ref = cache.on("changed", (file) => {
            if (globalThis[slot] !== tracker) return;
            const path = String(file?.path || "");
            if (path) tracker.versions.set(path, (tracker.versions.get(path) || 0) + 1);
          });
        }
        globalThis[slot] = tracker;
      }
      return tracker;
    } catch (_e) { return null; }
  }
  _metadataVersion(path) {
    return this._metadataTracker()?.versions?.get(String(path || "")) || 0;
  }
  _queueLinksStructure(state, task) {
    const epoch = state.epoch;
    state.queued += 1;
    const run = async () => {
      try {
        if (epoch !== state.epoch) {
          new Notice("An earlier trip link change failed. Retry this action.", 6000);
          return false;
        }
        const ok = await task();
        if (!ok) state.epoch += 1;
        return ok;
      } catch (error) {
        state.epoch += 1;
        new Notice("Could not save links: " + (error?.message || error), 6000);
        return false;
      } finally {
        state.queued = Math.max(0, state.queued - 1);
      }
    };
    const result = (state.tail || Promise.resolve()).then(run, run);
    state.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  _rollbackPreview(receipt) {
    if (!receipt) return;
    if (receipt.owner) {
      if (typeof receipt.owner.replaceChildren === "function") receipt.owner.replaceChildren(...receipt.priorNodes);
      else {
        receipt.owner.empty?.();
        for (const node of receipt.priorNodes || []) receipt.owner.appendChild?.(node);
      }
    }
    if (receipt.page) {
      if (receipt.hadValue) receipt.page.links = receipt.priorValue;
      else delete receipt.page.links;
    }
    if (receipt.state) {
      receipt.state.model = receipt.priorModel;
      receipt.state.authority = receipt.priorAuthority;
    }
    try { receipt.focusTarget?.focus?.(); } catch (_e) {}
  }
  _previewDv(dv, owner, page) {
    const preview = Object.create((dv && typeof dv === "object") ? dv : null);
    preview.container = owner;
    preview.current = () => page;
    return preview;
  }
  async _write(dv, links, ui = {}) {
    const file = this._file(dv);
    if (!file) { new Notice("Could not resolve the trip atlas note."); return false; }
    const renderSafe = globalThis.customJS?.RenderSafe;
    if (!renderSafe || typeof renderSafe.mutateStructure !== "function") {
      new Notice("Could not save links: RenderSafe is unavailable.", 6000);
      return false;
    }
    const next = links.map((l) => ({ url: l.url, text: l.text }));
    const page = this._page(dv);
    if (!page) { new Notice("Could not save links: page metadata is unavailable.", 6000); return false; }
    const owner = this._panelOwner(dv, file.path);
    if (!owner) { new Notice("Could not save links: trip links panel is unavailable.", 6000); return false; }
    const state = this._linksState(owner, page);
    return this._queueLinksStructure(state, async () => {
      const previewPage = this._page(dv) || page;
      const result = await renderSafe.mutateStructure({
        app,
        dv,
        path: file.path,
        failureMessage: "Could not save links",
        apply: async () => {
          const hadValue = Object.prototype.hasOwnProperty.call(previewPage, "links");
          const priorValue = previewPage.links;
          const priorModel = state.model;
          const priorAuthority = state.authority;
          const focusTarget = ui.focusTarget
            || ((typeof document !== "undefined") ? document.activeElement : null);
          const priorNodes = Array.from(owner.childNodes || owner.children || []);
          const receipt = {
            page: previewPage, hadValue, priorValue, priorModel, priorAuthority,
            focusTarget, owner, priorNodes, state,
          };
          try {
            state.model = next;
            previewPage.links = next;
            if (typeof owner.replaceChildren === "function") owner.replaceChildren();
            else owner.empty?.();
            await this.render(this._previewDv(dv, owner, previewPage));
            return receipt;
          } catch (error) {
            this._rollbackPreview(receipt);
            throw error;
          }
        },
        rollback: (receipt) => this._rollbackPreview(receipt),
        write: () => app.fileManager.processFrontMatter(file, (fm) => { fm.links = next; }),
      });
      if (result.ok === true) {
        state.model = next;
        state.authority = {
          expected: next,
          writeMtime: this._fileMtime(file),
          cacheVersion: this._metadataVersion(state.path),
        };
        return true;
      }
      return false;
    });
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
      let pendingActions = 0;
      let transitioning = false;
      const queueState = () => {
        const page = this._page(dv);
        const path = page?.file?.path || "";
        const owner = path ? this._panelOwner(dv, path) : null;
        return owner ? this._linksState(owner, page) : null;
      };
      const modalOpen = () => typeof close.isOpen !== "function" || close.isOpen();
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:6px; margin:10px 0; max-height:52vh; overflow:auto;";
      links.forEach((link) => {
        const rowEl = list.createEl("div");
        rowEl.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; border:1px solid var(--background-modifier-border); border-radius:6px;";
        const label = rowEl.createEl("div");
        label.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        label.createEl("div", { text: link.text }).style.cssText = "font-weight:500; font-size:0.9em;";
        label.createEl("div", { text: link.url }).style.cssText = "font-size:0.75em; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;";
        const editBtn = rowEl.createEl("button", { text: "Edit" });
        editBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); cursor:pointer; font-size:0.8em;";
        editBtn.onclick = async () => {
          if (transitioning) return false;
          transitioning = true;
          pendingActions += 1;
          const state = queueState();
          const epoch = state?.epoch;
          if (state?.queued) await state.tail;
          pendingActions = Math.max(0, pendingActions - 1);
          if (!modalOpen()) return false;
          if (state && state.epoch !== epoch) {
            transitioning = false;
            new Notice("An earlier trip link change failed. Retry this action.", 6000);
            try { editBtn.focus?.(); } catch (_e) {}
            return false;
          }
          const current = this._currentLinks(dv);
          if (this._linkIndex(current, link) < 0) {
            transitioning = false;
            new Notice("That link changed. Reopen Manage links and retry.", 6000);
            try { editBtn.focus?.(); } catch (_e) {}
            return false;
          }
          close();
          this._openForm({ title: "Edit link", url: link.url, text: link.text }, async ({ url, text }) => {
            const current = this._currentLinks(dv);
            const res = TripLinks.updateLink(current, this._linkIndex(current, link), { url, text });
            if (!res.changed) { new Notice(res.reason === "duplicate" ? "That URL is already in the list." : "Enter a URL."); return false; }
            if (await this._write(dv, res.links)) { new Notice("Link updated."); return true; }
            return false;
          });
          return true;
        };
        const delBtn = rowEl.createEl("button", { text: "Delete" });
        delBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-error); cursor:pointer; font-size:0.8em;";
        delBtn.onclick = async () => {
          if (transitioning) return false;
          pendingActions += 1;
          let saved = false;
          try {
            const current = this._currentLinks(dv);
            const res = TripLinks.deleteLink(current, this._linkIndex(current, link));
            saved = Boolean(res.changed && await this._write(dv, res.links, { focusTarget: delBtn }));
          } finally {
            pendingActions = Math.max(0, pendingActions - 1);
          }
          if (saved) {
            new Notice("Link deleted.");
            if (modalOpen() && pendingActions === 0 && !transitioning) close();
            return true;
          }
          if (modalOpen()) try { delBtn.focus?.(); } catch (_e) {}
          return false;
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
    if (prior) {
      if (typeof prior._sauceClose === "function") prior._sauceClose();
      else prior.remove();
    }
    const overlay = document.body.createDiv({ cls: "sauce-links-modal-overlay" });
    overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 9999;";
    const modal = overlay.createDiv();
    modal.style.cssText = "background: var(--background-primary, #1c1c1c); color: var(--text-normal, #ddd); border: 1px solid var(--background-modifier-border, #444); border-radius: 10px; padding: 18px 20px; width: min(440px, 92vw); max-height: 80vh; overflow: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4);";
    const escListener = (ev) => { if (ev.key === "Escape") close(); };
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      document.removeEventListener("keydown", escListener);
      overlay.remove();
    };
    close.isOpen = () => open;
    overlay._sauceClose = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener("keydown", escListener);
    const h = modal.createEl("div", { text: title });
    h.style.cssText = "font-weight:600; font-size:1.05em; margin-bottom:4px;";
    build(modal, close);
  }
}
