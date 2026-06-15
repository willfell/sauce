<%*
const name = await tp.system.prompt("Team name");
if (!name) return;
const products = app.vault.getMarkdownFiles()
  .filter(f => f.path.startsWith("spice/products/") && !f.path.endsWith("Products.md"))
  .map(f => f.basename);
if (!products.length) {
  new Notice("No products found. Create at least one Product first.");
  return;
}
const product = await tp.system.suggester(products, products);
if (!product) return;
await tp.file.rename(name);
%>---
type: team
name: "<% name %>"
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
tags:
products:
  - "[[<% product %>]]"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

# <% name %>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TeamPageCards" });
```

## Mentions

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "BacklinkPanel",
  method: "render",
  args: [{ entityType: "team" }]
});
```
