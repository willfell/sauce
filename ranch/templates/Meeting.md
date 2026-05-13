<%*
const attendeesInput = await tp.system.prompt("Attendees (comma-separated, e.g., Stefan de Pagter, Alex Palacios):", "");
const attendees = attendeesInput ? attendeesInput.split(",").map(a => a.trim()).filter(a => a.length > 0) : [];
-%>
---
date: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
type: meeting
tags:
  - "{{vault_identity_tag}}"
  - meeting
  - <% tp.date.now("YYYY/MM/DD") %>
<%* for (const attendee of attendees) {
  const tagName = attendee.replace(/\s+/g, "-");
  tR += `  - person/${tagName}\n`;
} -%>
summary: ""
attendees:
<%* for (const attendee of attendees) {
  tR += `  - "[[${attendee}]]"\n`;
} -%>
cssclasses:
  - wide
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

## Attendees

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "PeopleRendering",
  method: "renderMentionList",
  args: [dv, { mode: "mentioned_in_note", notePath: dv.current().file.path, scopePath: "spice/people" }, { style: "chips" }]
});
```

<%* for (const attendee of attendees) {
  tR += `- [[${attendee}]]\n`;
}
if (attendees.length === 0) {
  tR += `-\n`;
} -%>

---

## Agenda

-

---

## Notes



---

## Action Items

