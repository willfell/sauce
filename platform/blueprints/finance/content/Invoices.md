---
type: invoices-hub
tags:
  - finance
  - invoice
cssclasses:
  - wide
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
// entity-create:invoice — installer-managed; do not delete this comment
await customJS.EntityCreate.render(dv, { instance: "invoice" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "InvoicesCards" });
```
