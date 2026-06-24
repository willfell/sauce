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
---
date: <% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
type: meeting
tags:
  - "seed-test-vault"
summary: ""
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
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingLeafActions" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Attendees", top: true }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "PeopleRendering",
  method: "renderMentionList",
  args: [{ mode: "mentioned_in_note", notePath: dv.current().file.path, scopePath: "spice/people" }, { style: "chips" }]
});
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Agenda" }] });
```

-

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });
```

<!-- ACTION_ITEMS_MARKER -->

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Action Items" }] });
```

