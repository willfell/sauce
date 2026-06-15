---
name: new-product
description: Create a new Product note under spice/products/. Use when adding a new org-chart product entity.
---

# new-product

Create a new Product note for the org-chart layer.

## Steps

1. Ask the user for the **product name** (free-form, e.g., "Sauce", "Acme Mobile App"). Title-case is conventional but not required.
2. Compute the destination path: `spice/products/<Name>.md` (the file basename = display name).
3. Verify it does not already exist. If it does, surface the existing path and offer to navigate there instead.
4. Author the new note with frontmatter:
   ```yaml
   ---
   type: product
   name: "<Name>"
   created: <today's YYYY-MM-DD>
   tags:
     - product
   ---
   ```
   Body: a single H1 heading with the product name, then an empty line, then a dataviewjs block invoking `ProductPageCards` for the rollup.

5. Confirm to the user that the note is created and offer to open it.

## Frontmatter contract

The validator requires `type: product`, `name` (string), `created` (YYYY-MM-DD), and `tags` contains `product`. The naming pattern enforces a capitalized basename (`^[A-Z][\w '\-&]+\.md$`).
