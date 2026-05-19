---
description: "Engagement-aware cowork bootstrap interview. Drives the 25-step `cowork:bootstrap-vault` skill against this vault: interviews you for engagement (id, type, required + optional fields, cadences), writes vault-config.md, materializes per-engagement context dirs, renders the nav-button table on Cowork.md, emits a 7-section bootstrap report with audit-receipt. Use when you want to set up cowork for the first time OR re-bootstrap (add/drop/modify engagement)."
---

# /cowork — engagement-aware bootstrap

Drives the v0.31.0+ cowork bootstrap-vault skill against the current vault.

## Readiness panel (v0.65.0+)

The Cowork hub now surfaces a live readiness panel — engagement bootstrap status, prompt-stub presence, MCP-routing status, and per-orchestrator last-run timestamps. Open `Cowork.md` to view.

## Timeframes

The cowork blueprint owns three timeframe sub-hubs under `spice/cowork/`:

- `[[Daily Hub]]` — card-listed index of `spice/daily/**/*.md` notes (read-only view; daily blueprint owns the writes).
- `[[Weekly Hub]]` — card-listed index of `spice/cowork/weekly/**/*.md`. Use `/weekly` to open this week's note; `/weekly hub` to open this index.
- `[[Monthly Hub]]` — card-listed index of `spice/cowork/monthly/**/*.md`. Use `/monthly` to open this month's note; `/monthly hub` to open this index.

The `cowork:scaffold-timeframes` skill creates this-week's + this-month's notes on demand. `cowork:bootstrap-vault` calls it as a final step.

## What this does

Invokes the canonical `cowork:bootstrap-vault` SKILL.md materialized at `<vault>/.claude/skills/cowork/bootstrap-vault/SKILL.md`. The skill is the 25-step engagement-aware interview (per `pantry/Docs/plans/2026-05-11-v0.31.0-bootstrap-vault-skill-spec.md`):

1. **Pre-flight** — verify obsidian MCP routing + check for prior bootstrap state.
2. **Interview** — one question at a time:
   - engagement id (e.g., `accuris`, `personal`, `clientco`)
   - engagement type (one of `personal` / `w2-fte` / `consulting`)
   - required fields per type (from `engagement-types/<type>.json#required_fields`)
   - optional fields per type
   - cadences to enable (morning / midday / eod / weekly / monthly)
   - cron drop mode
3. **MCP probe** — check connected backends (obsidian + gmail + gcal + brex + imessage + whatsapp depending on engagement type).
4. **Compose + write** — `<vault>/spice/cowork/context/vault-config.md` with engagement[] frontmatter; per-engagement context files from `engagement-templates/<type>/*.md`; nav-button table on `<vault>/spice/cowork/Cowork.md`; cron paste-blocks.
5. **Report** — emit 7-section bootstrap report with inline audit-receipt.

## Pre-flight (run BEFORE this slash command)

The skill assumes the vault is up-to-date with the workshop. From a terminal in the vault root:

```bash
sauce-refresh
find .claude/skills/cowork -name SKILL.md | wc -l    # expect: 32
```

If the count is less than 32 (or you've never installed cowork@0.2.0+), run `sauce-refresh` until clean. Then return to this slash command.

## How to invoke

In Claude Code (this vault), type:

```
/cowork
```

Claude will read the bootstrap-vault SKILL.md and drive the interview one question at a time. Answer each prompt; the skill will surface USER APPROVAL gates before writing the canonical engagement record + before mutating `Cowork.md`.

## Engagement type quick-reference

| Type | Required fields | Default cadences | Render aspects |
|---|---|---|---|
| `personal` | `owner_name`, `home_city` | morning / midday / eod / weekly / monthly | finance ✓ / invoice ✗ / imessage ✓ |
| `w2-fte` | `role`, `employer`, `stakeholders[]` | morning / eod / weekly | finance ✗ / invoice ✗ / ai_committee ✓ |
| `consulting` | `role`, `primary_client`, `hourly_rate_usd`, `ap_email`, `invoice_cadence` | morning / eod / weekly / monthly | finance ✓ / invoice ✓ |

(Full schema lives in `pantry/platform/blueprints/cowork/engagement-types/<type>.json`.)

## Re-bootstrap

Running `/cowork` against a vault that already has `engagements[]` in `vault-config.md` enters re-bootstrap mode. The skill detects the prior state and asks whether to:
- **Add** a new engagement (additive merge)
- **Modify** an existing engagement (fields + cadences)
- **Drop** an engagement (frontmatter-only; preserves the per-engagement context dir for hand-merge)

## Handoff doc

If you want broader context on what's happening + cycle metadata + the cross-machine handoff plan, read `pantry/Docs/prompts/2026-05-12-accuris-cowork-bootstrap-handoff.md`. The slash command flow is canonical going forward; the handoff doc is a fallback for when you need the full narrative.
