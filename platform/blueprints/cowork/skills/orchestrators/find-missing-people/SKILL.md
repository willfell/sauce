---
name: cowork:find-missing-people
description: Scans recent atomic notes (morning-briefing, eod-review, midday-tripwire, weekly-review, monthly-review) for [[Name]] wikilinks pointing to person notes that don't exist in spice/people/. Filters to person-name-shaped wikilinks (rejects path-shaped, abbreviations, cards, products); batch-confirms with user; creates person-note stubs with discovered_from frontmatter + source-listing callout. Complementary to cowork:discover-people (which populates from microscopes/siblings/vault-config); this orchestrator populates from atomic-note emission. Reachable via /cowork find-missing-people [<engagement_id>] [days_back=30]. User-invoked only.
schedule: User-invoked
scope: shared
tags: [cowork, orchestrator, discovery, people, wikilink, atomic-notes]
---

# cowork:find-missing-people

> [!warning]+ CRITICAL: output path (v0.91.0)
> This orchestrator writes person-note stubs to:
>
> `spice/people/<basename>.md`
>
> ONE file per missing person. Files are USER-OWNED after creation; this skill never overwrites existing notes. DO NOT write atomic notes from this orchestrator — it does NOT produce a cowork-cadence atomic note. The only writes are person-note stubs + an optional vault-config.md update (when user opts to also promote discovered people to `engagement.inner_circle_people`).
>
> Path safety: `.bak` backups per landmine #12 when modifying vault-config.md. Never overwrite existing `spice/people/<name>.md` files (pre-check existence at write time).

Complementary to `cowork:discover-people` (microscope-extraction first slice). discover-people populates `inner_circle_people` from microscope prose + sibling tables + vault-config structured fields. find-missing-people fills the GAP between what's emitted and what exists: atomic notes (morning-briefing / eod-review / etc.) emit `[[Name]]` wikilinks for people surfaced from memory ticks + gather output. When the target `spice/people/<Name>.md` doesn't exist, Obsidian renders the wikilink dim. This skill scans recent atomic notes for those dim-wikilink targets and offers to batch-create stubs.

## Inputs

```
{
  engagement_id?: string   // optional; default-if-one, ask-if-many
  days_back?: number       // optional; default 30
}
```

## Pre-flight

1. **Vault routing.** Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. Not `"ready"` → emit Notice and exit.

2. **Resolve target engagement.** Read `<vault>/spice/cowork/context/vault-config.md`. Resolve engagement via input or default-if-one or ask-if-many (identical to `cowork:discover-people`'s pre-flight Step 2). Capture `engagement`, `engagement_id`, `vaultConfigBody`, `current_inner_circle` (via `cowork:discover-people-helper.parseCurrentInnerCircle`).

3. **Resolve date window.** Use `cowork:date-context` to get `today` (YYYY-MM-DD). Compute `days_back = input.days_back || 30`. Build the date range = today's date - days_back through today.

## Discover

4. **Enumerate atomic notes.** For each date in the date range:
   - Compute the path `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/` (substitute from date-context shape).
   - List files via `mcp__obsidian__obsidian_list_files_in_dir`. Treat not-found as empty.
   - For each `.md` file in the dir, capture as `noteSurfaces[]` entry `{path, body (read via mcp__obsidian__obsidian_get_file_contents), date}`.

5. **Aggregate wikilinks.** Require the pure helper:

   ```js
   const FMP = require("<workshop>/platform/blueprints/cowork/helpers/find-missing-people-helper.js");
   ```

   - `candidatesRaw = FMP.aggregateWikilinksAcrossNotes(noteSurfaces)` — dedups + tracks surface_count + first_seen + last_seen + surfaced_in[].
   - For each candidate.name, apply person-shape filter: `personCandidates = candidatesRaw.filter(c => FMP.filterToPersonShapedWikilinks([c.name]).length > 0)`. This drops path-shaped (`[[spice/cowork/...]]`), embedded references, .md extensions, abbreviations (AWS, EMS), cards (Cap1 Platinum, SCHEELS), products (GitHub, iMCP), and known non-person nouns.

6. **Enumerate existing person notes.** Call `mcp__obsidian__obsidian_list_files_in_dir` for `spice/people/`. Capture file basenames (strip `.md`). Capture as `existing_basenames[]`.

7. **Filter to missing.** `missing = FMP.filterToMissingPeople(personCandidates, existing_basenames)`. The result is the set of candidate names whose `spice/people/<name>.md` does NOT exist.

## Review

8. **Compose review table.** `tableMd = FMP.composeReviewTable(missing)`. Print to chat. Table groups by surface-count tier (HIGH > 5; MEDIUM 2-5; LOW = 1) with columns `# | Name | Mentions | First seen | Last seen | Sources`.

9. **Ask user (batch confirm):**

   ```
   Apply these N actions? Respond with one of:
     - "y"             → create all listed stubs
     - "n"             → exit without writes
     - "skip 3,7,12"   → create all EXCEPT listed rows
   ```

   Parse response. On `n` → emit Notice `cowork:find-missing-people exited without writes` + stop. On `y` → all proposed candidates apply. On `skip <list>` → drop named rows from the apply set.

## Apply

10. **Create person-note stubs.** For each candidate in apply_set:
    - Pre-check existence via `mcp__obsidian__obsidian_get_file_contents` on `spice/people/<candidate.name>.md`. If exists, log Notice `cowork:find-missing-people: spice/people/<name>.md already exists; skipping` and continue.
    - If absent: `stubMd = FMP.composePersonNoteStubFromSurfaces(candidate)`. Write to `spice/people/<candidate.name>.md` via `mcp__obsidian__obsidian_put_content`.

11. **Optional inner-circle promotion.** Ask user: `Promote any of these to engagement '<engagement_id>'.inner_circle_people? (y/n/skip <rows>)`. On y: collect promoted names; on skip: drop named rows. If non-empty:
    - Back up vault-config: `cp <vault>/spice/cowork/context/vault-config.md <vault>/spice/cowork/context/vault-config.md.bak` (landmine #12 backup convention).
    - `updated = DPH.composeUpdatedVaultConfig(vaultConfigBody, engagement_id, promoted_names)` (uses `cowork:discover-people-helper`'s v0.90.3 fixed function — handles inline-empty arrays + preserves closing fence).
    - Write back via `mcp__obsidian__obsidian_put_content`.

## Report

12. **Compose final report.** `reportMd = FMP.composeReport({applied, skipped, scanned_count: noteSurfaces.length, days_back, engagement_id})`. Print to chat. Emit final Notice: `cowork:find-missing-people complete -- <N applied> applied, <M skipped> skipped for engagement <id> (scanned <X> atomic notes over last <Y> days)`.

## Idempotence + re-run

- Person-note stubs pre-check existence; never overwrite.
- vault-config inner_circle_people append (when user opts in) dedups via `composeUpdatedVaultConfig`.
- Re-runs the next day will only surface NEW dim wikilinks (today's previously-promoted names now resolve).

## Sibling-file safety (landmine #12)

`vault-config.md` is materialized once + USER-OWNED. Before modification (Step 11 only): Bash `cp <file> <file>.bak` per landmine #12. Person-note files are CREATED fresh (no existing user content to back up).

## Dependencies

- `cowork:check-vault-routing` (pre-flight Step 1) — required
- `cowork:date-context` (Step 3) — required

Helper: `platform/blueprints/cowork/helpers/find-missing-people-helper.js` (pure, materialized to `spice/cowork/helpers/find-missing-people-helper.js` on consumer vaults per the canonical `{{module_directory}}/helpers/...` + `tag: platform` pattern).

Also requires `cowork:discover-people-helper` (via require) for `composeUpdatedVaultConfig` in Step 11 optional path AND for `parseCurrentInnerCircle` in pre-flight Step 2.

## Outputs

- Side-effect writes (Steps 10-11): new person-note stubs under `spice/people/`; optional vault-config update with `.bak` backup.
- Stdout: review table (Step 8), report (Step 12).
- Notice: final completion confirmation.

## Errors

| Mode | Behavior |
|---|---|
| Obsidian MCP missing | Pre-flight Step 1 exits cleanly with Notice |
| vault-config.md missing | Pre-flight Step 2 exits cleanly with Notice |
| Specified `engagement_id` not in vault-config | Pre-flight Step 2 exits cleanly |
| No atomic notes in date range | Step 4 yields empty noteSurfaces[]; Step 8 prints "No missing person notes found." and exits cleanly |
| `mcp__obsidian__obsidian_put_content` write failure | Log Notice; continue with remaining writes |

## Reference

- Canonical design: `Docs/plans/2026-06-05-v0.91.0-find-missing-people-design.md`
- Sibling skill: `cowork:discover-people` (microscope-extraction first slice; v0.28.0)
- Helper: `platform/blueprints/cowork/helpers/find-missing-people-helper.js`
- HC sub-asserts: HC-V0910-A1..G1 (helper) + HC-V0910-SKILL-A1 (this SKILL.md)
