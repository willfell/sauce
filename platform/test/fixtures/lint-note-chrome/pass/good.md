---
type: meeting
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes", top: true }] });
```

A heading inside a fenced code block is fine and must NOT be flagged:

```text
## This is documentation, not a real heading
### Neither is this
```

-
