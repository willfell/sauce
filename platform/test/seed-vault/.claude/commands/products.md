---
description: Manage the products blueprint — create new products, navigate the Products hub, browse per-product rollup pages
---

# /products

Use this command to navigate the products blueprint in this vault.

## Common operations

- **Open the Products hub** — `spice/products/Products.md` lists all products with team + active-project counts. Use this as the entry point when you're orienting on the org-chart.
- **Create a new product** — Use the embedded `new-product` skill (`.claude/skills/products/new-product/SKILL.md`) to step through naming + initial description.
- **Open a per-product rollup** — Navigate to `spice/products/<Name>.md` directly (or click into a card from the hub). The body shows two sections: Teams under this Product + Projects touching this Product.

## Related blueprints

- `/teams` — per-team rollups; each Team is anchored to exactly one Product.
- `/project` — project hub with filter/group by product.
