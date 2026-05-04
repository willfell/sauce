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
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

## Attendees

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

