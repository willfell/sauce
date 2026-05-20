---
type: cowork-vault-config
updated: {{bootstrap_date}}
updated_by: cowork:bootstrap-vault
cowork_version: 0.2.0
schema_version: 1
engagements: []
mcp_map:
  obsidian: missing
  gmail:    missing
  gcal:     missing
  imessage: missing
  whatsapp: missing
  finance:  missing
---

# Cowork vault config — schema seed

> [!info] Canonical engagement record
> Written + maintained by `cowork:bootstrap-vault`. The frontmatter `engagements[]` list is the source of truth for every cowork orchestrator's engagement lookup.
>
> This file is the schema seed shipped by the blueprint. Bootstrap-vault replaces it on first run with a fully-populated frontmatter (one entry per engagement chosen during the interview) + a human-readable body summarizing each engagement + the active MCP map.

## Engagements (post-bootstrap)

After bootstrap completes, this section is rewritten with one block per engagement:

```
### <engagement.label> (id: `<engagement.id>`, type: `<engagement.type>`)

- Cadences enabled: <morning?, midday?, eod?, weekly?, monthly?>
- Context dir: `spice/cowork/context/<engagement.id>/`
- Key fields: ...
```

## MCP map (post-bootstrap)

Active MCP connectivity at bootstrap time. Refreshed on every re-bootstrap pass.

## How to edit

- **Adding an engagement:** re-run `cowork:bootstrap-vault` and pick add-mode `a` (per spec §S2). Direct hand-edits to `engagements[]` are not recommended (the audit rule validates against the registered engagement-type schemas).
- **Editing per-engagement fields:** open the engagement's context dir at `spice/cowork/context/<engagement.id>/` — those files are the substantive content; this file is the index.
- **Removing an engagement:** re-run bootstrap-vault and pick drop-mode `c`. The bootstrap flow asks for confirmation per engagement.
