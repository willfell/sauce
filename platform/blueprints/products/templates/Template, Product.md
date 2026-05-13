<%*
const name = await tp.system.prompt("Product name");
if (!name) return;
await tp.file.rename(name);
%>---
type: product
name: "<% name %>"
created: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - product
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

# <% name %>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProductPageCards" });
```
