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
sauce update
find .claude/skills/cowork -name SKILL.md | wc -l    # expect: 32+
```

If the count is less than 32 (or you've never installed cowork@0.2.0+), run `sauce update` until clean. If `sauce update` reports `skip <name> — subscription pins X but workshop has Y`, run `sauce wizard` first to refresh the vault's subscription pins against the current workshop catalogue, then `sauce update` again. Then return to this slash command.

## How to invoke

In Claude Code (this vault), type:

```
/cowork
```

Claude will read the bootstrap-vault SKILL.md and drive the interview one question at a time. Answer each prompt; the skill will surface USER APPROVAL gates before writing the canonical engagement record + before mutating `Cowork.md`.

## /cowork microscope <kind> (v0.79.0)

```
/cowork microscope <kind>
```

Drives the `cowork:edit-microscope` skill materialized at `<vault>/.claude/skills/cowork/edit-microscope/SKILL.md`. It is an MCP-tool-aware, iterative capture loop that authors (or deepens) a USER-OWNED per-kind "microscope" gather contract at `spice/cowork/prompts/per-mcp/<kind>/microscope.md`. The skill enumerates the kind's `served_by` tools, consent-gated samples your real data to ask grounded questions, surfaces data gaps with resolution paths (resolvable-in-gather / MCP-ceiling / user-supplied), and writes the deep contract the atomic-note orchestrators read. When a microscope exists for a prioritized kind, the orchestrators route that kind through `cowork:gather-from-served-by` with the microscope body as the deep `what_matters`. Re-run anytime to go deeper. The microscope file is never overwritten by `sauce update`/`reinstall` (it is not in cowork's `files[]`). If `<kind>` is omitted, the skill lists the kinds in `user-preferences.md` and asks which one.

## /cowork audit-siblings [<kind>] (v0.81.0)

```
/cowork audit-siblings
/cowork audit-siblings <kind>
```

Drives the `cowork:audit-siblings` skill materialized at `<vault>/.claude/skills/cowork/audit-siblings/SKILL.md`. It is a PURE READ-ONLY audit that detects (a) **dangling references** — entries in `microscope.md`'s `## References` section naming sibling files that don't exist on disk — and (b) **orphan files** — sibling files in `spice/cowork/prompts/per-mcp/<kind>/` not named in `microscope.md`'s `## References`. Emits one `[!warning]` callout per dangling finding + one `[!info]` callout per orphan + `[!success]` when clean.

No writes, no MCP gather calls. Run after every `/cowork microscope <kind>` round (especially after the user-supplied sibling-scaffold sub-flow) to confirm `microscope.md` and the per-mcp dir are consistent. When `<kind>` is omitted, audits every kind in `user-preferences.md` `priorities:`.

**Em-dash note:** the parser requires em-dash (`—`, U+2014) between `**<name>**` and the role description in `## References` bullets, matching what `composeMicroscope` emits. If you hand-edit a bullet with a hyphen (`-`) or en-dash (`–`), the audit silently flags the sibling as an orphan. Use em-dash.

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

## /cowork discover-people [<engagement>] (v0.28.0)

Microscope-extraction first slice of the people-discovery surface. Scans `spice/cowork/prompts/per-mcp/<*>/microscope.md` `## What matters` sections + `per-mcp/<*>/people-aliases.md` tables + vault-config.md `engagements[<id>].stakeholders/manager/direct_reports` for candidate inner-circle people, classifies via `cowork:resolve-person`, batch-confirms, and writes person-note stubs + appends to `inner_circle_people` + flips sibling `Promote? confirm → promoted`.

Engagement defaults if the vault has exactly one; otherwise prompts to pick. USER-AUTHORED `microscope.md` files are READ-ONLY (never modified). `vault-config.md` + `people-aliases.md` get `.bak` backups before edit per landmine #12.

Run this after authoring or deepening microscopes via `/cowork microscope <kind>` to operationalize the inner-circle prose into the canonical allowlist that v0.89.0+ atomic-note gather skills consume. Re-runs are idempotent: previously-promoted names are skipped, previously-declined names re-appear in the review table for re-decision.

## /cowork find-missing-people [<engagement>] [days_back=30] (v0.29.0)

Complementary write-side discovery: scans the last N days of atomic notes (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) under `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/*.md` for `[[Name]]` wikilinks pointing to person notes that don't exist in `spice/people/`. Filters out path-shaped, abbreviation, card, and product wikilinks; presents a HIGH/MEDIUM/LOW-tier review table (by surface count) for batch-confirm; on confirm, creates person-note stubs with `discovered_from` frontmatter listing the source atomic notes.

Closes the dim-wikilink loop: atomic notes emit `[[Ellen Senders]]` from memory ticks, but if the person note doesn't exist, Obsidian renders it dim. After running this skill, every previously-dim wikilink resolves to a real (stub) person note. Optional Step 11 also offers to promote discovered names to `engagement.inner_circle_people`.

Re-runs are idempotent: previously-created person notes pre-check existence (never overwrite), so subsequent days only surface NEW dim wikilinks.

## /cowork sync-scheduled-jobs [<engagement_id>] (v0.31.0)

Emits paste-ready Cowork scheduled-job wrapper bodies for an engagement, fully aligned with the current sauce + cowork versions + the engagement's actual `prefs.mcps` state. Reads `spice/cowork/context/vault-config.md` + `spice/cowork/context/user-preferences.md` + `spice/cowork/context/engagement-types/<type>.json` + `spice/cowork/data/scheduled-job-contract.json` + `ranch/platform-installed.json`, then writes a single file at `spice/cowork/scheduled-job-wrappers/<engagement_id>.md` containing 5 fenced wrapper bodies (one per cowork cadence — morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review).

Re-run after every cowork blueprint MINOR bump — the cron contract may have shifted (v0.91.1 path-guard / v0.91.2 frontmatter-guard / v0.91.3 connectivity + dvjs / v0.92.0 body-shape). The user copies each fenced block into the matching task in claude.ai's Cowork UI; schedule is not changed.

Engagement defaults if the vault has exactly one; otherwise prompts to pick (matches `/cowork discover-people` resolution). Backup-on-edit: any prior `<engagement_id>.md` is copied to `<engagement_id>.md.sauce-backup` per landmine #12 mechanic #2 before overwrite. Dispatch lines are computed kind-by-kind from `prefs.mcps` (FULLY DYNAMIC — no brand-string special-casing; novel MCP kinds work without contract changes).

Invokes `cowork:sync-scheduled-jobs`.
