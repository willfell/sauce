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

  _config() {
    const ICON = this.ICON;
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t !== "meeting") return null;
        return { context: "meeting", path: (page.file && page.file.path) || "" };
      },
      surfaceSpec: (ctx) => {
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
        const out = [{ section: "This meeting" }];
        return out;
      },
      rootClass: "meeting-chrome-root",
      btnClass: (v) => `meeting-chrome-btn meeting-chrome-btn-${v}`,
    };
  }
}
