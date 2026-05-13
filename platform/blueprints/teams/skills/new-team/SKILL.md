---
name: new-team
description: Create a new Team note under spice/teams/. Each team requires a product: wikilink. Use when adding a new org-chart team entity.
---

# new-team

Create a new Team note for the org-chart layer.

## Steps

1. Ask the user for the **team name** (free-form, e.g., "Platform Engineering", "Mobile").
2. Ask the user for the **product** this team belongs to. List existing products from `spice/products/` and let the user pick. If no products exist, refuse and direct the user to `/products` first — a team without a product violates the validator.
3. Verify destination `spice/teams/<Name>.md` does not exist.
4. Author the note with frontmatter:
   ```yaml
   ---
   type: team
   name: "<Name>"
   created: <today's YYYY-MM-DD>
   tags:
     - team
   product: "[[<Selected Product>]]"
   ---
   ```
5. Confirm to user.

## Frontmatter contract

Required: `type: team`, `name`, `created`, `tags` contains `team`, `product` (wikilink). Naming pattern: `^[A-Z][\w '\-&]+\.md$`. If `product` is omitted or empty, the validator emits an error.
