<%*
const name = await tp.system.prompt("Product name");
if (!name) return;
await tp.file.rename(name);
%>---
type: product
name: "<% name %>"
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

# <% name %>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProductPageCards" });
```

## Mentions

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "BacklinkPanel",
  method: "render",
  args: [{ entityType: "product" }]
});
```
