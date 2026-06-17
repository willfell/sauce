---
type: meeting
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

## Notes

A meeting note that renders nav but carries no Breadcrumb (trips the
breadcrumb-first rule) AND uses a raw `## H2` content heading instead of a
`SectionLabel` (trips the no-H2 rule).

-
