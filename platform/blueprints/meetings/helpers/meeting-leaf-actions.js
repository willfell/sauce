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
  static resolveProjectPreselect(cur, projectList) {
    const name = MeetingLeafActions.stripWikilink(cur && cur.project);
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
  static personStubBody(name, isoNow) {
    return `---\ntype: person\ncreated_at: "${isoNow}"\naliases: []\n---\n\n# [[${name}]]\n\n## Notes\n-\n`;
  }

  // ── render ─────────────────────────────────────────────────────────────────
  async render(dv) {
    if (dv.container.closest(".markdown-embed")) return;
    const myGen = (dv.container.__meetingLeafRenderGen || 0) + 1;
    dv.container.__meetingLeafRenderGen = myGen;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    const usersIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

    const row = dv.container.createEl("div");
    row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

    customJS.AccentButton.render(row, { label: "New Task", icon: plusIcon, onClick: () => this._onNewTask(dv), flex: true });
    customJS.AccentButton.render(row, { label: "Add to Project", icon: folderIcon, onClick: () => this._onAddToProject(dv), flex: true });
    customJS.AccentButton.render(row, { label: "Edit Attendees", icon: usersIcon, onClick: () => this._onEditAttendees(dv), flex: true });
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

  // ── handlers ───────────────────────────────────────────────────────────────
  _onNewTask(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) { new Notice("Open a meeting note to use this action."); return; }
    const meetingPath = cur.file.path;
    const projectName = MeetingLeafActions.stripWikilink(cur.project);
    const ti = window.customJS?.TaskInteractions;
    if (!ti) {
      new Notice("Install the task-interactions mechanism to create tasks from meetings.", 6000);
      return;
    }
    this._openTaskModal(dv, projectName, async (payload) => {
      if (!payload || !payload.title || !payload.title.trim()) return;
      const fullPayload = {
        mode: 'one-shot',
        title: payload.title.trim(),
        destination: projectName
          ? { type: 'project', slug: this._projectSlugFor(projectName, dv), name: projectName }
          : 'today',
        priority: payload.priority || '',
        due: payload.due || '',
      };
      const serializedLine = ti.serializeTaskLine(fullPayload);
      const mRes = await ti.appendTask(meetingPath, fullPayload, { serializedLine });
      let pRes = null;
      if (projectName) {
        const projectTodoPath = this._projectTodoPath(projectName, dv);
        if (projectTodoPath && app.vault.getAbstractFileByPath(projectTodoPath)) {
          pRes = await ti.appendTask(projectTodoPath, fullPayload, { serializedLine });
        } else {
          pRes = { ok: false, reason: 'project-todo-missing' };
        }
      }
      this._noticeDualWrite(meetingPath, projectName, mRes, pRes);
    });
  }

  _openTaskModal(dv, projectName, onSubmit) {
    this._openModal({ title: "New task", build: (panel, close) => {
      const state = { title: "", due: "", priority: "" };
      if (projectName) {
        const chip = panel.createEl("div", { text: `Will be linked to: ${projectName}` });
        chip.style.cssText = "margin:10px 0 4px; padding:5px 9px; border-radius:6px; background:var(--background-modifier-hover); color:var(--text-muted); font-size:0.85em; display:inline-block;";
      }
      const titleWrap = panel.createEl("div");
      titleWrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-top:10px;";
      const titleLabel = titleWrap.createEl("label", { text: "Title" });
      titleLabel.style.cssText = "font-size:0.85em; color:var(--text-muted);";
      const titleInput = titleWrap.createEl("input"); titleInput.type = "text"; titleInput.placeholder = "Task title…";
      titleInput.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
      const dueWrap = panel.createEl("div");
      dueWrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-top:10px;";
      const dueLabel = dueWrap.createEl("label", { text: "Due (optional)" });
      dueLabel.style.cssText = "font-size:0.85em; color:var(--text-muted);";
      const dueInput = dueWrap.createEl("input"); dueInput.type = "date";
      dueInput.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
      const prioWrap = panel.createEl("div");
      prioWrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-top:10px;";
      const prioLabel = prioWrap.createEl("label", { text: "Priority (optional)" });
      prioLabel.style.cssText = "font-size:0.85em; color:var(--text-muted);";
      const chipsRow = prioWrap.createEl("div");
      chipsRow.style.cssText = "display:flex; gap:6px; flex-wrap:wrap;";
      const chipButtons = {};
      const paintChips = () => {
        for (const [k, btn] of Object.entries(chipButtons)) {
          const active = state.priority === k;
          btn.style.background = active ? "var(--interactive-accent)" : "var(--background-primary)";
          btn.style.color = active ? "var(--text-on-accent)" : "var(--text-normal)";
          btn.style.borderColor = active ? "var(--interactive-accent)" : "var(--background-modifier-border)";
        }
      };
      for (const p of ["low", "medium", "high", "highest"]) {
        const b = chipsRow.createEl("button", { text: p });
        b.style.cssText = "padding:4px 10px; border-radius:14px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); cursor:pointer; font-size:0.85em;";
        b.onclick = (e) => { e.preventDefault(); state.priority = (state.priority === p ? "" : p); paintChips(); };
        chipButtons[p] = b;
      }
      paintChips();
      const save = panel.createEl("button", { text: "Add task" });
      save.style.cssText = "margin-top:14px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      const updateSaveState = () => {
        const enabled = !!(titleInput.value || "").trim();
        save.disabled = !enabled;
        save.style.opacity = enabled ? "1" : "0.5";
        save.style.cursor = enabled ? "pointer" : "not-allowed";
      };
      titleInput.oninput = () => { state.title = titleInput.value; updateSaveState(); };
      dueInput.oninput = () => { state.due = dueInput.value; };
      updateSaveState();
      save.onclick = async () => {
        if (save.disabled) return;
        try { await onSubmit({ title: state.title, due: state.due, priority: state.priority }); }
        catch (e) { new Notice("Could not add task: " + (e.message || e), 6000); }
        close();
      };
      // Enter in the Title field submits the task (skips the mouse). Ignore IME
      // composition Enter; no-op while the button is disabled (empty title).
      titleInput.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" || ev.isComposing) return;
        ev.preventDefault();
        if (!save.disabled) save.click();
      });
      setTimeout(() => titleInput.focus(), 0);
    }});
  }

  _projectSlugFor(name, dv) {
    const projects = this._listProjects(dv);
    const hit = projects.find((p) => p.name === name);
    return hit ? hit.slug : String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  _projectTodoPath(name, dv) {
    try {
      const hubs = dv.pages('"spice/projects"').where((p) => p && p.type === "project" && (p.name || p.file.name) === name).array();
      if (hubs.length === 0) return null;
      const folder = hubs[0].file.folder;
      return `${folder}/${name} To-Do.md`;
    } catch (_e) { return null; }
  }

  _noticeDualWrite(meetingPath, projectName, mRes, pRes) {
    const meetingBase = meetingPath.split('/').pop().replace(/\.md$/, '');
    if (mRes && !mRes.ok) {
      new Notice(`Could not write to meeting: ${mRes.reason || 'unknown'}`, 6000);
      return;
    }
    if (!projectName) {
      new Notice(`Added to ${meetingBase}`);
      return;
    }
    if (pRes && pRes.ok) {
      new Notice(`Added to ${meetingBase} and ${projectName} To-Do`);
      return;
    }
    if (pRes && pRes.reason === 'project-todo-missing') {
      new Notice(`Added to ${meetingBase}; ${projectName} To-Do not found`);
      return;
    }
    new Notice(`Added to ${meetingBase}; could not update ${projectName} To-Do: ${(pRes && pRes.reason) || 'unknown'}`);
  }

  _onAddToProject(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) { new Notice("Open a meeting note to use this action."); return; }
    const file = app.vault.getAbstractFileByPath(cur.file.path);
    if (!file) { new Notice("Could not resolve the current note."); return; }
    const projects = this._listProjects(dv);
    this._openModal({ title: "Add meeting to project", build: (panel, close) => {
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-top:10px;";
      const choose = async (name) => {
        try {
          await app.fileManager.processFrontMatter(file, (fm) => { fm.project = name ? `[[${name}]]` : ""; });
          new Notice(name ? `Added to ${name}` : "Cleared project");
        } catch (e) { new Notice("Could not set project: " + (e.message || e), 6000); }
        close();
      };
      for (const opt of ["(none)", ...projects.map((p) => p.name)]) {
        const b = list.createEl("button", { text: opt });
        b.style.cssText = "text-align:left; padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); cursor:pointer;";
        b.onclick = () => choose(opt === "(none)" ? "" : opt);
      }
    }});
  }

  _onEditAttendees(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) { new Notice("Open a meeting note to use this action."); return; }
    const file = app.vault.getAbstractFileByPath(cur.file.path);
    if (!file) { new Notice("Could not resolve the current note."); return; }
    const people = this._listPeople();
    const current = new Set(((cur.attendees) || []).map(MeetingLeafActions.stripWikilink));
    const selected = new Set([...current].filter(Boolean));
    this._openModal({ title: "Edit attendees", build: (panel, close) => {
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
        try { if (!app.vault.getAbstractFileByPath(stubPath)) await app.vault.create(stubPath, MeetingLeafActions.personStubBody(name, window.moment().format("YYYY-MM-DDTHH:mm:ssZZ"))); }
        catch (e) { new Notice("Could not add person: " + (e.message || e), 6000); return; }
        selected.add(name); people.push(name);
        addInput.value = "";
        redrawList("");
        updateAddButton();
      };
      const save = panel.createEl("button", { text: "Save attendees" });
      save.style.cssText = "margin-top:12px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      save.onclick = async () => {
        try {
          const { attendees, people: ppl } = MeetingLeafActions.buildAttendeeFrontmatter([...selected]);
          await app.fileManager.processFrontMatter(file, (fm) => { fm.attendees = attendees; fm.people = ppl; });
          new Notice(`Attendees updated (${attendees.length})`);
        } catch (e) { new Notice("Could not update attendees: " + (e.message || e), 6000); }
        close();
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
