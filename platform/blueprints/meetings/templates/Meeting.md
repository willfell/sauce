<%*
// SUGGESTER_LOOP_V0880 — regression sentinel; do not remove.
const peopleFiles = app.vault.getMarkdownFiles()
  .filter(f => f.path.startsWith("spice/people/") && f.basename !== "People")
  .map(f => f.basename)
  .sort();

const SENTINEL_ADD = "+ Add new person…";
const SENTINEL_DONE = "Done — finish meeting";
const attendees = [];

while (true) {
  const options = [SENTINEL_DONE, SENTINEL_ADD, ...peopleFiles.filter(n => attendees.indexOf(n) === -1)];
  const labels  = options.slice();
  // throwOnCancel: false → Esc returns undefined, breaks the loop with
  // already-picked attendees preserved (instead of aborting template).
  const picked = await tp.system.suggester(labels, options, false,
    attendees.length === 0
      ? "Pick first attendee (or Done to skip)"
      : `Pick another attendee (${attendees.length} so far) or Done`);
  if (picked === undefined || picked === SENTINEL_DONE) break;
  if (picked === SENTINEL_ADD) {
    const newName = await tp.system.prompt("New person name (First Last, mononym OK):", "");
    if (!newName) continue;
    const trimmed = newName.trim();
    if (!trimmed) continue;
    const stubPath = `spice/people/${trimmed}.md`;
    const existing = app.vault.getAbstractFileByPath(stubPath);
    if (!existing) {
      try {
        await app.vault.create(stubPath, `---\ntype: person\ncreated_at: "${tp.date.now("YYYY-MM-DDTHH:mm:ssZ")}"\naliases: []\n---\n\n# [[${trimmed}]]\n\n## Notes\n-\n`);
        peopleFiles.push(trimmed);
        peopleFiles.sort();
      } catch (e) {
        // Stub-create failed (path-hostile chars like "/", or some other
        // create error). Skip the attendee add — pushing a name we couldn't
        // stub would leave a broken [[wikilink]] in the frontmatter.
        // User can retry with a sanitized name. See FLN-v88-4.
        continue;
      }
    }
    if (attendees.indexOf(trimmed) === -1) attendees.push(trimmed);
    continue;
  }
  if (attendees.indexOf(picked) === -1) attendees.push(picked);
}
-%>
<%*
// Optional explicit meeting date/time. Blank → creation time (prior behavior).
let _dtInput = await tp.system.prompt("Meeting date & time (optional, e.g. 2026-07-13 14:30) — blank = now:", "");
let _dt = null;
if (_dtInput && _dtInput.trim()) {
  const _m = window.moment(_dtInput.trim(), ["YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm", "YYYY-MM-DD"], true);
  if (_m.isValid()) _dt = _m;
}
const _dateIso = _dt ? _dt.format("YYYY-MM-DDTHH:mm:ssZ") : tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ");
-%>
---
date: <% _dateIso %>
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
type: meeting
tags:
  - "{{vault_identity_tag}}"
summary: ""
links: []
attendees:
<%* for (const attendee of attendees) {
  tR += `  - "[[${attendee}]]"\n`;
} -%>
people:
<%* for (const attendee of attendees) {
  tR += `  - "[[${attendee}]]"\n`;
} -%>
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MeetingChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Attendees", top: true }] });
```

```dataviewjs
const cur = dv.current();
const notePath = (cur && cur.file && cur.file.path) || (app.workspace.getActiveFile && app.workspace.getActiveFile()?.path);
if (notePath) {
  await dv.view("{{views_path}}/customjs-guard", {
    class: "PeopleRendering",
    method: "renderMentionList",
    args: [{ mode: "mentioned_in_note", notePath, scopePath: "spice/people" }, { style: "chips" }]
  });
}
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });
```

-

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Tasks" }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "TaskMeetingList" });
```

