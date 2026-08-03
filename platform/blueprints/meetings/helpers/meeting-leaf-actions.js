/**
 * MeetingLeafActions (CustomJS) — inline action bar on meeting leaf notes:
 *   • New Task        → opens the ToDoCreateTask dialog pre-targeted at the
 *                       meeting's project (graceful Notice if to-do absent)
 *   • Add to Project  → single-select project picker → writes `project:` FM
 *   • Edit Attendees  → multi-select people picker → writes `attendees`/`people` FM
 *
 * Mirrors ToDoLeafActions structural conventions (embed-safe early return,
 * render-gen counter, AccentButton flex row). Decision logic lives in static
 * methods (unit-tested headlessly); DOM/modals are dogfood-verified.
 */
class MeetingLeafActions {
  // ── static helpers (pure; unit-tested) ────────────────────────────────────
  static stripWikilink(s) {
    if (s == null) return "";
    return String(s).replace(/^\[\[|\]\]$/g, "").trim();
  }
  // cleanProjectName — extract the CLEAN project basename from a `project:`
  // frontmatter value that may be a Dataview Link OBJECT (a RESOLVED link, with
  // .path / .display), a `[[...]]` wikilink string, or a bare string. Dataview
  // hands a `[[Connectors]]` frontmatter value back as a Link whose `.path` is
  // the RESOLVED note path (`spice/projects/connectors/Connectors.md`); naively
  // stripping `[[ ]]` off `String(link)` leaves the whole path + `|alias`, which
  // then mangles into a path-slug. This mirrors TaskEntity._linkText semantics
  // (last `/` segment, drop `.md`, drop a trailing `|alias`) so meeting-created
  // tasks get the SAME clean {name, slug} a project-surface create would.
  //   - Link object → basename of .path (else .display)
  //   - "[[a/b/Connectors.md|Connectors]]" → "Connectors" (basename, .md + pipe stripped)
  //   - "[[Bar]]" → "Bar";  "Plain" → "Plain";  nullish/empty → ""
  static cleanProjectName(v) {
    if (v == null) return "";
    const baseOf = (s) => {
      let out = String(s == null ? "" : s).trim();
      const slash = out.lastIndexOf("/");
      if (slash >= 0) out = out.slice(slash + 1);
      return out.replace(/\.md$/i, "");
    };
    // Dataview Link object — has .path / .display / .subpath (not a string).
    if (typeof v === "object" && ("path" in v || "display" in v || "subpath" in v)) {
      if (v.path != null && String(v.path).trim() !== "") return baseOf(v.path);
      if (v.display != null) return String(v.display).trim();
      return "";
    }
    if (typeof v === "string") {
      let s = v.trim();
      const m = /^\[\[([^\]]*)\]\]$/.exec(s);
      if (m) s = m[1].trim();
      // Split off a `|label` alias → keep the target (before the pipe), then
      // take its basename. For "[[a/b/Connectors.md|Connectors]]" the target is
      // "a/b/Connectors.md" → basename "Connectors" (== the alias here).
      const pipe = s.indexOf("|");
      if (pipe >= 0) s = s.slice(0, pipe).trim();
      return baseOf(s);
    }
    return String(v);
  }
  // _slugify — the SAME slug shape composeNote / the project list use: lowercase,
  // non-alnum runs → "-", trimmed of leading/trailing "-". Pure.
  static _slugify(name) {
    return String(name == null ? "" : name)
      .toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  static resolveProjectPreselect(cur, projectList) {
    const name = MeetingLeafActions.cleanProjectName(cur && cur.project);
    if (!name) return "today";
    const hit = (projectList || []).find((p) => p.name === name);
    return hit ? { type: "project", slug: hit.slug, name: hit.name } : "today";
  }
  static buildAttendeeFrontmatter(selectedNames) {
    const seen = new Set();
    const attendees = [];
    for (const n of selectedNames || []) {
      const name = MeetingLeafActions.stripWikilink(n) || String(n || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      attendees.push(`[[${name}]]`);
    }
    return { attendees, people: attendees.slice() };
  }
  static canonicalLinkNames(values) {
    if (!values || typeof values[Symbol.iterator] !== "function") return [];
    try { return Array.from(values).map((value) => MeetingLeafActions.cleanProjectName(value)).filter(Boolean); }
    catch (_e) { return []; }
  }
  static personStubBody(name, isoNow) {
    return `---\ntype: person\ncreated_at: "${isoNow}"\naliases: []\n---\n\n# [[${name}]]\n\n## Notes\n-\n`;
  }
  static _enqueuePerson(queue, operation) {
    const run = () => Promise.resolve().then(operation);
    const result = (queue.tail || Promise.resolve()).then(run, run);
    queue.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  // ── render ─────────────────────────────────────────────────────────────────
  async render(dv) {
    try {
      if (!dv || !dv.container || typeof dv.container.createEl !== "function") return;
      if (dv.container.closest?.(".markdown-embed")) return;
      if (dv.container.closest?.(".markdown-preview-view")?.querySelector?.(".meeting-chrome-root")) return;
      const cjs = (typeof globalThis !== "undefined" && globalThis.customJS)
        || (typeof window !== "undefined" && window.customJS) || null;
      if (!cjs?.AccentButton || typeof cjs.AccentButton.render !== "function") return;
      const myGen = (dv.container.__meetingLeafRenderGen || 0) + 1;
      dv.container.__meetingLeafRenderGen = myGen;
      while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const usersIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

    // Chrome dividers owned by the helper (wiki methodology): render the action
    // row bracketed by a top + bottom <hr> INSIDE this one dataviewjs block, so the
    // separators hug the buttons (12px) instead of the big inter-block gap a
    // template `---` leaves. The Meeting.md template carries no `---` around this
    // block; a per-note install heal strips the legacy `---` from existing meetings.
    const DIVIDER = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 12px 0;";
    const wrap = dv.container.createEl("div");
    wrap.style.cssText = "margin: 0;";
    wrap.createEl("hr").style.cssText = DIVIDER;

    const row = wrap.createEl("div");
    row.style.cssText = "display: flex; gap: 12px; margin: 0 auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

      cjs.AccentButton.render(row, { label: "New Task", icon: plusIcon, onClick: () => this._onNewTask(dv), flex: true });
      cjs.AccentButton.render(row, { label: "Add to Project", icon: folderIcon, onClick: () => this._onAddToProject(dv), flex: true });
      cjs.AccentButton.render(row, { label: "Edit Attendees", icon: usersIcon, onClick: () => this._onEditAttendees(dv), flex: true });

      wrap.createEl("hr").style.cssText = DIVIDER;
    } catch (_e) { /* cold-load render entries never reject */ }
  }

  // ── data sources ───────────────────────────────────────────────────────────
  _listProjects(dv) {
    try {
      return dv.pages('"spice/projects"').where((p) => p && p.type === "project")
        .map((p) => ({ slug: p.project_slug || String(p.name || p.file.name).toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: p.name || p.file.name }))
        .array();
    } catch (_e) { return []; }
  }
  _listPeople() {
    try {
      return app.vault.getMarkdownFiles()
        .filter((f) => f.path.startsWith("spice/people/") && f.basename !== "People")
        .map((f) => f.basename).sort();
    } catch (_e) { return []; }
  }

  async _mutateFrontmatter(dv, file, opts) {
    const renderSafe = globalThis.customJS?.RenderSafe;
    if (!renderSafe || typeof renderSafe.mutate !== "function") {
      new Notice((opts.failureMessage || "Could not update meeting") + ": RenderSafe is unavailable.", 6000);
      return false;
    }
    const result = await renderSafe.mutate({
      app,
      dv,
      path: file.path,
      failureMessage: opts.failureMessage || "Could not update meeting",
      optimistic: opts.optimistic,
      revert: opts.revert,
      write: () => app.fileManager.processFrontMatter(file, opts.write),
      isCurrent: opts.isCurrent,
    });
    return result.ok === true;
  }

  _page(dv) {
    try {
      const renderSafe = globalThis.customJS?.RenderSafe;
      return renderSafe?.page?.(dv) || (dv && typeof dv.current === "function" ? dv.current() : null);
    } catch (_e) { return null; }
  }

  _personLifecycle({ name, selected, people, addInput, list, redrawList, updateAddButton }) {
    return {
      apply: () => {
        const receipt = {
          hadSelected: selected.has(name),
          peopleLength: people.length,
          inputValue: addInput.value,
          priorNodes: Array.from(list.childNodes || list.children || []),
          focusTarget: (typeof document !== "undefined") ? document.activeElement : addInput,
        };
        selected.add(name);
        people.push(name);
        addInput.value = "";
        redrawList("");
        updateAddButton();
        return receipt;
      },
      rollback: (receipt) => {
        if (!receipt) return;
        if (!receipt.hadSelected) selected.delete(name);
        people.splice(receipt.peopleLength);
        addInput.value = receipt.inputValue;
        if (typeof list.replaceChildren === "function") list.replaceChildren(...receipt.priorNodes);
        else {
          while (list.firstChild) list.removeChild(list.firstChild);
          for (const node of receipt.priorNodes) list.appendChild?.(node);
        }
        updateAddButton();
        try { (receipt.focusTarget || addInput)?.focus?.(); } catch (_e) {}
      },
    };
  }

  // ── handlers ───────────────────────────────────────────────────────────────
  // v0.13.0 (task-entity meetings wiring): + New Task now creates ONE task-note
  // via the task-entity mechanism's TaskDialog (surface: 'meeting'). No more
  // custom inline modal + dual-write of raw markdown into the meeting's Action
  // Items AND the project To-Do — the task lives as a single note under
  // spice/tasks/, stamped with source: meeting + source_note: [[<meeting>]] +
  // (when the meeting has a project: frontmatter) the project link/slug. The
  // meeting's TaskMeetingList block live-queries those task-notes by source_note;
  // the daily aggregators pick them up by source == meeting. Nothing is appended
  // to any surface note.
  _onNewTask(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) { new Notice("Open a meeting note to use this action."); return; }
    const TD = window.customJS && window.customJS.TaskDialog;
    if (!TD || typeof TD.open !== "function") {
      new Notice("Install the task-entity mechanism to create tasks from meetings.", 6000);
      return;
    }
    // Meeting basename (no .md) → source_note wikilink so the task-note's
    // TaskMeetingList query resolves back to this meeting.
    const meetingBasename = String(cur.file.name || "").replace(/\.md$/i, "");
    // Project (optional): only when the meeting carries a project: frontmatter.
    // cur.project may be a RESOLVED Dataview Link (its .path is the full note
    // path) — cleanProjectName extracts the CLEAN basename ("Connectors"), NOT
    // the path, so the list lookup succeeds and composeNote gets the same clean
    // {name, slug} a project-surface create would (no path-slug mangling).
    const projectName = MeetingLeafActions.cleanProjectName(cur.project);
    let project;
    if (projectName) {
      const hit = this._listProjects(dv).find((p) => p.name === projectName);
      project = {
        name: projectName,
        slug: hit ? hit.slug : MeetingLeafActions._slugify(projectName),
      };
    }
    try {
      TD.open({
        surface: "meeting",
        sourceNote: "[[" + meetingBasename + "]]",
        project,
      });
    } catch (e) {
      new Notice("Could not open task dialog: " + (e.message || e), 6000);
    }
  }

  _onAddToProject(dv) {
    const cur = this._page(dv);
    if (!cur || !cur.file) { new Notice("Open a meeting note to use this action."); return; }
    const file = app.vault.getAbstractFileByPath(cur.file.path);
    if (!file) { new Notice("Could not resolve the current note."); return; }
    const projects = this._listProjects(dv);
    this._openModal({ title: "Add meeting to project", build: (panel, close) => {
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-top:10px;";
      const choose = async (name, focusTarget) => {
        const prior = {
          disabled: focusTarget.disabled,
          text: focusTarget.textContent,
        };
        const saved = await this._mutateFrontmatter(dv, file, {
          failureMessage: "Could not set project",
          optimistic: () => { focusTarget.disabled = true; focusTarget.textContent = "Saving…"; },
          revert: () => {
            focusTarget.disabled = prior.disabled;
            focusTarget.textContent = prior.text;
            try { focusTarget?.focus?.(); } catch (_e) {}
          },
          write: (fm) => { fm.project = name ? `[[${name}]]` : ""; },
          isCurrent: (page) => MeetingLeafActions.cleanProjectName(page && page.project) === name,
        });
        if (saved) {
          new Notice(name ? `Added to ${name}` : "Cleared project");
          close();
        }
      };
      for (const opt of ["(none)", ...projects.map((p) => p.name)]) {
        const b = list.createEl("button", { text: opt });
        b.style.cssText = "text-align:left; padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); cursor:pointer;";
        b.onclick = () => choose(opt === "(none)" ? "" : opt, b);
      }
    }});
  }

  _onEditAttendees(dv) {
    const cur = this._page(dv);
    if (!cur || !cur.file) { new Notice("Open a meeting note to use this action."); return; }
    const file = app.vault.getAbstractFileByPath(cur.file.path);
    if (!file) { new Notice("Could not resolve the current note."); return; }
    const people = this._listPeople();
    const current = new Set(MeetingLeafActions.canonicalLinkNames(cur.attendees));
    const selected = new Set([...current].filter(Boolean));
    this._openModal({ title: "Edit attendees", build: (panel, close) => {
      const personQueue = { tail: Promise.resolve() };
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:4px; margin:10px 0; max-height:46vh; overflow:auto;";
      const renderRow = (name) => {
        const r = list.createEl("label");
        r.style.cssText = "display:flex; align-items:center; gap:8px; padding:3px 4px; cursor:pointer;";
        const cb = r.createEl("input"); cb.type = "checkbox"; cb.checked = selected.has(name);
        cb.onchange = () => { if (cb.checked) selected.add(name); else selected.delete(name); };
        r.createEl("span", { text: name });
      };
      const redrawList = (filter) => {
        while (list.firstChild) list.removeChild(list.firstChild);
        const q = (filter || "").toLowerCase();
        const candidates = [...new Set([...people, ...selected])].sort();
        const filtered = q
          ? candidates.filter((n) => n.toLowerCase().includes(q) || selected.has(n))
          : candidates;
        filtered.forEach(renderRow);
      };
      redrawList("");
      const addWrap = panel.createEl("div");
      addWrap.style.cssText = "display:flex; gap:6px; margin-top:8px;";
      const addInput = addWrap.createEl("input"); addInput.type = "text"; addInput.placeholder = "Search or add new…";
      addInput.style.cssText = "flex:1; padding:5px 8px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
      const addBtn = addWrap.createEl("button", { text: "Add" });
      const updateAddButton = () => {
        const typed = (addInput.value || "").trim();
        const typedLc = typed.toLowerCase();
        const matchesExisting = typed.length > 0 && people.some((n) => n.toLowerCase() === typedLc);
        const canAdd = typed.length > 0 && !matchesExisting;
        addBtn.disabled = !canAdd;
        addBtn.style.opacity = canAdd ? "1" : "0.5";
        addBtn.style.cursor = canAdd ? "pointer" : "not-allowed";
        addBtn.textContent = canAdd ? `Add "${typed}" as new person` : "Add";
      };
      addInput.oninput = () => { redrawList(addInput.value); updateAddButton(); };
      updateAddButton();
      addBtn.onclick = async () => {
        if (addBtn.disabled) return;
        const name = (addInput.value || "").trim(); if (!name) return;
        const stubPath = `spice/people/${name}.md`;
        const renderSafe = globalThis.customJS?.RenderSafe;
        if (!renderSafe || typeof renderSafe.mutateStructure !== "function") {
          new Notice("Could not add person: RenderSafe is unavailable.", 6000);
          return;
        }
        await MeetingLeafActions._enqueuePerson(personQueue, async () => {
          const existing = app.vault.getAbstractFileByPath(stubPath);
          if (existing) return true;
          const lifecycle = this._personLifecycle({
            name, selected, people, addInput, list, redrawList, updateAddButton,
          });
          const result = await renderSafe.mutateStructure({
            app,
            dv,
            path: stubPath,
            failureMessage: "Could not add person",
            apply: lifecycle.apply,
            rollback: lifecycle.rollback,
            write: () => {
              const now = (typeof window !== "undefined" && typeof window.moment === "function")
                ? window.moment().format("YYYY-MM-DDTHH:mm:ssZZ") : new Date().toISOString();
              return app.vault.create(stubPath, MeetingLeafActions.personStubBody(name, now));
            },
          });
          return result.ok === true;
        });
      };
      const save = panel.createEl("button", { text: "Save attendees" });
      save.style.cssText = "margin-top:12px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      save.onclick = async () => {
        await personQueue.tail;
        const selectedNames = [...selected];
        const { attendees, people: ppl } = MeetingLeafActions.buildAttendeeFrontmatter(selectedNames);
        const expected = JSON.stringify(selectedNames);
        const prior = {
          disabled: save.disabled,
          text: save.textContent,
        };
        const saved = await this._mutateFrontmatter(dv, file, {
          failureMessage: "Could not update attendees",
          optimistic: () => { save.disabled = true; save.textContent = "Saving…"; },
          revert: () => {
            save.disabled = prior.disabled;
            save.textContent = prior.text;
            try { save.focus?.(); } catch (_e) {}
          },
          write: (fm) => { fm.attendees = attendees; fm.people = ppl; },
          isCurrent: (page) => JSON.stringify(MeetingLeafActions.canonicalLinkNames(page && page.attendees)) === expected,
        });
        if (saved) {
          new Notice(`Attendees updated (${attendees.length})`);
          close();
        }
      };
    }});
  }

  // ── modal overlay (mirrors ToDoCreateTask._renderOverlay) ──────────────────
  _openModal({ title, build }) {
    const prior = document.querySelector(".sauce-meeting-modal-overlay");
    if (prior) prior.remove();
    const overlay = document.body.createDiv({ cls: "sauce-meeting-modal-overlay" });
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
