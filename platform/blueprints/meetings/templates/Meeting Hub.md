---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
tags:
  - "{{vault_identity_tag}}"
  - meetings-hub
  - <% tp.date.now("YYYY/MM/DD") %>
cssclasses:
  - wide
  - cards
  - cards-cols-2
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

<!-- entity-create:meeting -->


---

## Today's Meetings

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MeetingsHubCards" });
```

---
