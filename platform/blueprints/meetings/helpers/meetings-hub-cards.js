/**
 * Meetings Hub Cards (CustomJS)
 * Thin wrapper around BeaconCards. Enriches one meeting metadata snapshot with
 * one task metadata snapshot, then delegates rendering with layout: "row".
 * It never reads meeting bodies per row.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "MeetingsHubCards" });
 *
 * v0.2.0 (cards-cohesion cycle): migrated from hand-rolled card chrome to
 * BeaconCards.render call. Visual fidelity preserved via subtitle:{text,
 * secondaryText} + badges[].icon API extensions. LOC ~159 -> ~110.
 */
class MeetingsHubCards {
  static _values(value) {
    if (value == null || typeof value === "string") return [];
    try { return typeof value[Symbol.iterator] === "function" ? Array.from(value) : []; }
    catch (_e) { return []; }
  }

  static _name(value) {
    if (value == null) return "";
    if (typeof value === "object") {
      if (value.display) return String(value.display).trim();
      if (value.path) return String(value.path).split("/").pop().replace(/\.md$/i, "").trim();
      if (value.name) return String(value.name).replace(/\.md$/i, "").trim();
      return "";
    }
    let out = String(value).trim();
    const link = /^\[\[([^\]]*)\]\]$/.exec(out);
    if (link) out = link[1];
    if (out.includes("|")) out = out.split("|").pop();
    return out.trim();
  }

  static _attendeeNames(page) {
    let values = MeetingsHubCards._values(page && page.attendees);
    if (!values.length) values = MeetingsHubCards._values(page && page.people);
    return values.map(MeetingsHubCards._name).filter(Boolean);
  }

  static _sourceBasename(value) {
    if (value == null) return "";
    let out = typeof value === "object" ? (value.path || value.display || "") : String(value);
    out = String(out).trim();
    const link = /^\[\[([^\]]*)\]\]$/.exec(out);
    if (link) out = link[1];
    if (out.includes("|")) out = out.split("|")[0];
    return out.split("/").pop().replace(/\.md$/i, "").trim();
  }

  static _taskCountsBySource(dv) {
    const counts = {};
    try {
      const data = dv.pages('"spice/tasks"');
      const tasks = data && typeof data.array === "function" ? data.array() : Array.from(data || []);
      for (const task of tasks) {
        const path = task && task.file && task.file.path;
        if (!task || task.type !== "task" || !path || path.includes("/_trash/")) continue;
        const source = MeetingsHubCards._sourceBasename(task.source_note);
        if (!source) continue;
        const row = counts[source] || (counts[source] = { open: 0, done: 0 });
        const status = String(task.status || "").toLowerCase();
        if (status === "open") row.open += 1;
        else if (["done", "completed", "closed"].includes(status)) row.done += 1;
      }
    } catch (_e) { return {}; }
    return counts;
  }

  static _registeredPeople(dv) {
    const names = new Set();
    try {
      const data = dv.pages('"spice/people"');
      const people = data && typeof data.array === "function" ? data.array() : Array.from(data || []);
      for (const person of people) {
        const name = MeetingsHubCards._name(person && person.file);
        if (name) names.add(name);
      }
    } catch (_e) { /* bounded fallback stays empty */ }
    return names;
  }

  async render(dv) {
    try {
    if (!dv || typeof dv.pages !== "function") return;
    // Dataview may render before indexing the embedding note. RenderSafe keeps a
    // usable active-file shim when available; otherwise a missing page/file is a
    // quiet no-op rather than a rejected render promise.
    const cjs = (typeof globalThis !== "undefined" && globalThis.customJS)
      || (typeof window !== "undefined" && window.customJS) || null;
    const renderSafe = cjs && cjs.RenderSafe;
    let currentPage = null;
    try {
      currentPage = renderSafe && typeof renderSafe.page === "function"
        ? renderSafe.page(dv)
        : (typeof dv.current === "function" ? dv.current() : null);
    } catch (_e) { currentPage = null; }
    const currentFile = currentPage && currentPage.file;
    if (!currentFile || !currentFile.name) return;
    const dateMatch = String(currentFile.name).match(/(\d{4}-\d{2}-\d{2})/);
    const momentFn = (typeof window !== "undefined" && typeof window.moment === "function")
      ? window.moment : ((typeof globalThis !== "undefined" && typeof globalThis.moment === "function") ? globalThis.moment : null);
    const currentDateStr = dateMatch ? dateMatch[1]
      : (momentFn ? momentFn().format("YYYY-MM-DD") : new Date().toISOString().slice(0, 10));

    const icons = {
      clock: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      notes: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      task: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      pending: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    };

    const meetingsRaw = dv.pages('"spice/meetings/notes"')
      .where(p => p.file.name.endsWith(`-${currentDateStr}`))
      .sort(p => {
        if (p.date && momentFn) return momentFn(p.date.toString()).format("HH:mm");
        return p.file.name;
      })
      .array();

    // One task query for the whole hub and one bounded people snapshot. No
    // meeting body is read, so row count cannot increase vault I/O.
    const taskCounts = MeetingsHubCards._taskCountsBySource(dv);
    const registeredPeople = MeetingsHubCards._registeredPeople(dv);
    const enriched = meetingsRaw.map((p) => {
      const attendees = MeetingsHubCards._attendeeNames(p);
      const peopleAttendeeLinks = attendees.filter((name) => registeredPeople.has(name)).map((name) => `[[${name}]]`);
      const counts = taskCounts[(p.file && p.file.name) || ""] || { open: 0, done: 0 };
      let summary = p.summary || "";
      if (typeof summary === "string") {
        summary = summary.trim();
        if (summary === '""' || summary === "") summary = "";
      }
      let timeStr = "";
      if (p.date) {
        const dateStr = p.date.toString();
        const timePart = dateStr.split(" ")[1];
        if (timePart && momentFn) timeStr = momentFn(timePart, "HH:mm").format("h:mm A");
      }
      return {
        file: { name: p.file.name, path: p.file.path },
        attendees,
        peopleAttendeeLinks,
        openTasks: counts.open,
        doneTasks: counts.done,
        hasNotes: p.has_notes === true || p.notes_present === true,
        summary,
        timeStr,
        project: p.project
      };
    });

    // Local helper bound to the class instance — used by the meta callback below.
    // Using a local arrow keeps `this` access reliable inside BeaconCards opts.
    const renderProjectLabel = (field) => this._renderProjectLabel(field);

    if (!cjs?.BeaconCards || typeof cjs.BeaconCards.render !== "function") return;
    await cjs.BeaconCards.render(dv, {
      pages: enriched,
      layout: "row",
      columns: 1,
      title: p => p.file.name.replace(/-\d{4}-\d{2}-\d{2}$/, "") || p.file.name,
      meta: p => {
        const projectPill = p.project
          ? `<span class="meeting-project-pill" style="color: var(--text-accent); background: var(--background-modifier-active-hover); padding: 1px 6px; border-radius: 4px; font-size: 0.8em; margin-right: 6px;">${renderProjectLabel(p.project)}</span>`
          : "";
        const timeBlock = p.timeStr
          ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${icons.clock}<span>${p.timeStr}</span></span>`
          : "";
        return projectPill + timeBlock;
      },
      subtitle: p => {
        // v0.3.0 pilot: when at least one attendee is a registered Person, render chips via PeopleRendering callback.
        // Falls back to existing comma-string behavior when no registered People (or PeopleRendering unavailable).
        const truncatedSummary = p.summary && p.summary.length > 80 ? p.summary.substring(0, 77) + "..." : (p.summary || null);
        if (p.peopleAttendeeLinks && p.peopleAttendeeLinks.length > 0
            && cjs.PeopleRendering && typeof cjs.PeopleRendering.renderChip === "function") {
          return (parent) => {
            const row = parent.createEl("div");
            row.style.cssText = "display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px;";
            for (const link of p.peopleAttendeeLinks) {
              cjs.PeopleRendering.renderChip(row, link);
            }
            const unregistered = Math.max(0, p.attendees.length - p.peopleAttendeeLinks.length);
            if (unregistered > 0) {
              const moreEl = parent.createEl("span");
              moreEl.textContent = "+" + unregistered;
              moreEl.style.cssText = "color: var(--text-muted); font-size: 0.8em; padding-left: 4px;";
            }
            if (truncatedSummary) {
              const sec = parent.createEl("div");
              sec.textContent = truncatedSummary;
              sec.style.cssText = "color: var(--text-muted); font-size: 0.78em; font-style: italic; margin-top: 2px;";
            }
          };
        }
        const attendeesText = p.attendees.length === 0
          ? null
          : (p.attendees.length <= 3
              ? p.attendees.join(", ")
              : p.attendees.slice(0, 2).join(", ") + ` +${p.attendees.length - 2}`);
        if (!attendeesText && !p.summary) return null;
        if (!p.summary) return attendeesText;
        if (!attendeesText) return truncatedSummary;
        return { text: attendeesText, secondaryText: truncatedSummary };
      },
      badges: p => {
        const out = [];
        if (p.hasNotes) out.push({ label: "Notes", tone: "accent", icon: icons.notes });
        if (p.openTasks > 0) out.push({ label: `${p.openTasks} open`, tone: "error", icon: icons.pending });
        if (p.doneTasks > 0) out.push({ label: `${p.doneTasks} done`, tone: "accent", icon: icons.task });
        return out;
      },
      target: p => p.file.path,
      empty: "No meetings scheduled for today",
      sort: () => 0  // pre-sorted by Dataview .sort() above
    });
    } catch (_e) { /* every cold-load/missing-dependency path is a quiet no-op */ }
  }

  /**
   * #1: does the meeting body carry REAL notes content, ignoring scaffold?
   * Strips frontmatter, fenced code blocks, HTML comments, horizontal rules,
   * heading lines, task lines (any of -,*,+ markers), and lone/empty bullets;
   * "has notes" iff > 5 non-whitespace chars remain. Works on SectionLabel-shaped
   * AND legacy ## Notes notes. Keys on scaffold SHAPE, not on the "Notes" label
   * (lint-display-markers).
   */
  static _bodyHasNotes(content) {
    if (typeof content !== "string" || !content) return false;
    let body = content;
    const fmEnd = body.indexOf("\n---", 4);
    if (body.indexOf("---") === 0 && fmEnd >= 0) body = body.slice(fmEnd + 4);
    body = body.replace(/```[\s\S]*?```/g, "");          // fenced blocks
    body = body.replace(/<!--[\s\S]*?-->/g, "");          // HTML comments (markers)
    body = body
      .split("\n")
      .filter((l) => !/^\s*---+\s*$/.test(l))             // horizontal rules
      .filter((l) => !/^\s*[-*+]\s*\[[ xX]\]/.test(l))    // task lines (-,*,+)
      .filter((l) => !/^\s*[-*+]\s*$/.test(l))            // lone/empty bullets
      .filter((l) => !/^#+\s/.test(l))                    // heading lines
      .join("\n");
    return body.replace(/\s/g, "").length > 5;
  }

  /**
   * Normalise the `project` frontmatter field for display in the meta-slot pill.
   * Handles three Dataview field shapes:
   *   - Link object: { path: "spice/projects/Foo.md", display: "Foo" }
   *   - String: "[[Foo]]" or "[[Foo|Bar]]"
   *   - null / undefined
   * Strips wikilink wrapper and any `|alias` separator; returns "" for empty input.
   */
  _renderProjectLabel(field) {
    if (!field) return "";
    if (typeof field === "string") {
      return field.replace(/^\[\[|\]\]$/g, "").split("|")[0];
    }
    if (field.display) return field.display;
    if (field.path) return field.path.split("/").pop().replace(/\.md$/, "");
    return "";
  }
}
