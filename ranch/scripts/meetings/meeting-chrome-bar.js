class MeetingChromeBar {
  get ICON() {
    return {
      plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
      folder: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
      users: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  // meetings-hub notes have no `type:` frontmatter field (tag-based hub, not
  // type-based — see note-chrome.md §6), so hub detection reads tags instead.
  // Same page.tags / page.file.tags fallback shape doc-search.js already uses.
  _hasHubTag(page) {
    const tags = Array.isArray(page && page.tags) ? page.tags : ((page && page.file && page.file.tags) || []);
    return tags.map((t) => String(t).replace(/^#/, "")).includes("meetings-hub");
  }

  _config() {
    const ICON = this.ICON;
    const self = this;
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "meeting") return { context: "meeting", path: (page.file && page.file.path) || "" };
        // No `type:` on the hub — only reachable via the tag check above.
        if (!t && self._hasHubTag(page)) return { context: "meetings-hub", path: (page.file && page.file.path) || "" };
        return null;
      },
      surfaceSpec: (ctx) => {
        // MeetingsHubCards still owns the listing below the bar, but "+ New
        // Meeting" is now the bar's own primary (right of the compass) —
        // same shape as ReaderChromeBar's reader-hub "+ New article".
        if (ctx.context === "meetings-hub") return { primary: { id: "new-meeting", label: "+ New Meeting", icon: ICON.plus }, overflow: [], leaf: false };
        return {
          primary: { id: "new-task", label: "New Task", icon: ICON.plus },
          overflow: [
            { id: "add-project", label: "Add to Project", icon: ICON.folder },
            { id: "edit-attendees", label: "Edit Attendees", icon: ICON.users },
          ],
          leaf: true,
        };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-meeting") {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "meeting", dv });
          } else if (typeof Notice === "function") { new Notice("MeetingChromeBar: EntityCreate unavailable — reinstall meetings blueprint.", 6000); }
          return;
        }
        if (id === "new-task") {
          if (customJS && customJS.MeetingLeafActions && typeof customJS.MeetingLeafActions._onNewTask === "function") {
            customJS.MeetingLeafActions._onNewTask(dv);
          } else if (typeof Notice === "function") { new Notice("MeetingChromeBar: MeetingLeafActions unavailable — reinstall meetings blueprint.", 6000); }
          return;
        }
        if (id === "add-project") {
          if (customJS && customJS.MeetingLeafActions && typeof customJS.MeetingLeafActions._onAddToProject === "function") {
            customJS.MeetingLeafActions._onAddToProject(dv);
          } else if (typeof Notice === "function") { new Notice("MeetingChromeBar: MeetingLeafActions unavailable — reinstall meetings blueprint.", 6000); }
          return;
        }
        if (id === "edit-attendees") {
          if (customJS && customJS.MeetingLeafActions && typeof customJS.MeetingLeafActions._onEditAttendees === "function") {
            customJS.MeetingLeafActions._onEditAttendees(dv);
          } else if (typeof Notice === "function") { new Notice("MeetingChromeBar: MeetingLeafActions unavailable — reinstall meetings blueprint.", 6000); }
          return;
        }
      },
      destinations: (dv, ctx) => {
        if (ctx.context === "meetings-hub") return [];
        return [{ section: "This meeting" }];
      },
      rootClass: "meeting-chrome-root",
      btnClass: (v) => `meeting-chrome-btn meeting-chrome-btn-${v}`,
    };
  }
}
