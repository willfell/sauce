---
name: cowork:discover-people
description: Microscope-extraction first slice of WS2 people-discovery. Interactively enumerates inner-circle candidate people from per-mcp/<kind>/microscope.md ## What matters sections, per-mcp/<kind>/people-aliases.md tables, and vault-config.md engagement structured fields; classifies each candidate via cowork:resolve-person; batch-confirms with the user; writes person-note stubs + appends to engagement.inner_circle_people + flips sibling Promote? confirm to promoted. Reachable via /cowork discover-people [<engagement>]. User-invoked only; never cron-scheduled.
schedule: User-invoked
scope: shared
tags: [cowork, orchestrator, discovery, people, interactive]
---

# cowork:discover-people

Microscope-extraction first slice for populating the canonical `inner_circle_people` allowlist that v0.89.0+ gather skills + v0.89.1+ atomic-note orchestrators consume. Scans USER-AUTHORED microscope prose + sibling people-aliases tables + vault-config structured engagement fields, dedups across sources, classifies via the v0.89.0 `cowork:resolve-person` sub-skill, presents a batch-confirm review table, and on confirmation writes person-note stubs + appends names to `inner_circle_people` + flips `Promote? confirm` columns to `promoted` in user-aliases sibling files.

This skill does NOT make MCP discovery calls in v0.28.0 — that's WS-C's v0.29.0+ extension. The skill reads what the user has already authored in microscope.md + sibling files + vault-config and operationalizes it into the canonical allowlist shape.

## Inputs

```
{
  engagement_id?: string   // optional; default-if-one, ask-if-many
}
```

## Pre-flight

1. **Vault routing.** Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If status is not `"ready"`, emit Notice `cowork:discover-people aborted -- obsidian MCP unavailable` and exit.

2. **Resolve target engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__obsidian_get_file_contents`.

   - Parse frontmatter `engagements[]`.
   - If `engagement_id` input provided AND valid → use it.
   - Else if exactly 1 engagement → **auto-pick** (default-if-one). Emit Notice `cowork:discover-people: defaulting to engagement <id> (single-engagement vault)`.
   - Else (more than 1 engagement) → ask user one question listing options (id + label) and wait for selection.
   - If engagement not found in vault-config.md → emit Notice `cowork:discover-people aborted -- engagement <id> not found in vault-config.md` and exit.
   - Capture `engagement` + `engagement_id` + `vaultConfigBody`.

## Discover

3. **Enumerate per-mcp directories.** Call `mcp__obsidian__obsidian_list_files_in_dir` on `spice/cowork/prompts/per-mcp/`. For each subdirectory (`<kind>`):

   3a. Read `spice/cowork/prompts/per-mcp/<kind>/microscope.md` via `mcp__obsidian__obsidian_get_file_contents`. Treat a not-found error as absent. Capture body as `microscopes[<kind>]`.

   3b. Read `spice/cowork/prompts/per-mcp/<kind>/people-aliases.md`. Treat not-found as absent. Capture body as `siblings[<kind>]`.

4. **Parse + aggregate.** Require the pure helper:

   ```js
   const DPH = require("<workshop>/platform/blueprints/cowork/helpers/discover-people-helper.js");
   ```

   For each kind present:
   - `microscopeNames[<kind>] = DPH.parseInnerCircleFromMicroscope(microscopes[<kind>] || "")`
   - `parsed = DPH.parsePromotionRowsFromSibling(siblings[<kind>] || "")`
   - `siblingRows[<kind>] = parsed.rows`
   - Accumulate `parsed.suppress_list` into a vault-wide `suppress_list[]`.

   Then from the vault-config body (read in pre-flight step 2):
   - `vaultConfigNames = DPH.parseStakeholdersFromVaultConfig(vaultConfigBody, engagement_id)` (stakeholders + manager + direct_reports)
   - `current_inner_circle = DPH.parseCurrentInnerCircle(vaultConfigBody, engagement_id)`

   Aggregate:
   - `candidates = DPH.aggregateCandidates({ microscopeNames, siblingRows, vaultConfigNames })`

## Classify

5. For each candidate, call sub-skill `cowork:resolve-person` with `{ input: candidate.canonical_name, prefer_type: "name", engagement_id }`. Capture `resolveResult`.

   Compute status: `DPH.classifyCandidate({ candidate, resolveResult, current_inner_circle, suppress_list })` → one of `CREATE_AND_PROMOTE`, `PROMOTE_EXISTING`, `ALREADY_PROMOTED`, `SUPPRESS`.

   Annotate each candidate with `status` and `resolveResult`. Build `candidates_with_status[]`.

## Review

6. **Compose review table** via `DPH.composeReviewTable(candidates_with_status)`. Print to the chat for user inspection. The table groups by status (CREATE_AND_PROMOTE, PROMOTE_EXISTING, ALREADY_PROMOTED, SUPPRESS), one section per group, each row numbered for the batch-confirm question.

7. **Ask user (single batch-confirm question):**

   ```
   Apply these N actions? Respond with one of:
     - "y"             → apply all
     - "n"             → apply none (exit without writes)
     - "skip 3,7,12"   → apply all EXCEPT rows 3, 7, 12
   ```

   Parse response:
   - `n` → emit Notice `cowork:discover-people exited without writes` and stop.
   - `y` → all proposed actions (CREATE_AND_PROMOTE + PROMOTE_EXISTING entries) apply; ALREADY_PROMOTED + SUPPRESS are no-ops by definition.
   - `skip <list>` → apply all EXCEPT the named row numbers.

   Build `apply_set[]` = candidates whose row number is in the apply set AND whose status is in {CREATE_AND_PROMOTE, PROMOTE_EXISTING}.

## Apply

8. **Person-note stubs.** For each candidate in `apply_set` with status `CREATE_AND_PROMOTE`:
   - Pre-check existence via `mcp__obsidian__obsidian_get_file_contents` on `spice/people/<canonical_name>.md`. If the file exists, log Notice `cowork:discover-people: spice/people/<name>.md already exists; skipping stub creation` and continue (still proceed with vault-config promotion below).
   - If absent: call `DPH.composePersonNoteStub({ canonical_name, aliases: [], sources: candidate.sources })`. Write to `spice/people/<canonical_name>.md` via `mcp__obsidian__obsidian_put_content`.

9. **Vault-config promotion.** Collect `names_to_append` = canonical names of every candidate in `apply_set` (both CREATE_AND_PROMOTE and PROMOTE_EXISTING). If non-empty:
   - Write `<vault>/spice/cowork/context/vault-config.md.bak` via Bash `cp` per landmine #12 backup convention.
   - `updated = DPH.composeUpdatedVaultConfig(vaultConfigBody, engagement_id, names_to_append)`. The helper dedups against existing `inner_circle_people` entries — re-runs do not duplicate.
   - Write `updated` back to `spice/cowork/context/vault-config.md` via `mcp__obsidian__obsidian_put_content`.

10. **Sibling column flips.** For each kind where any applied candidate had a sibling-row provenance with `sibling_status: "confirm"`:
    - Write `<vault>/spice/cowork/prompts/per-mcp/<kind>/people-aliases.md.bak` per landmine #12.
    - Build `name_status_map = { <canonical_name>: "promoted" }` for applied candidates.
    - `updated = DPH.composeUpdatedSibling(siblings[<kind>], name_status_map)`. The helper only flips `confirm → promoted`; rows with `promoted` or `skip` status are untouched (idempotent).
    - Write `updated` back via `mcp__obsidian__obsidian_put_content`.

## Report

11. **Compose final report** via `DPH.composeReport({ applied, skipped, sources_scanned, engagement_id })`. Print to chat. Emit final Notice: `cowork:discover-people complete -- <N applied> applied, <M skipped> skipped for engagement <id>`.

## Idempotence + re-run

- The helper's `composeUpdatedVaultConfig` dedups against existing `inner_circle_people` entries — re-running is safe.
- The helper's `composeUpdatedSibling` only flips `confirm → promoted`; rows already `promoted` or `skip` are preserved verbatim.
- Person-note stubs pre-check existence at Step 8; never overwrite.
- Naive re-discovery: previously declined candidates re-appear in the next run's review table. User re-declines. v1 does not persist a per-candidate skip list (FLN-v90-1 candidate).

## Sibling-file safety (landmine #12 backup)

Both `vault-config.md` and `people-aliases.md` are USER-AUTHORED surfaces (vault-config is `materialize_once: true` in the cowork manifest; people-aliases is not in `files[]` at all — pure user creation via `cowork:edit-microscope`). Before any modification: Bash `cp <file> <file>.bak` per landmine #12 backup convention. User can revert from `.bak` if they object. Microscope.md is USER-OWNED and is **READ-ONLY** — this skill never modifies it.

Per landmine #19, all paths are hardcoded relative to the vault root (`spice/people/`, `spice/cowork/context/vault-config.md`, `spice/cowork/prompts/per-mcp/<kind>/people-aliases.md`); no glob walk from arbitrary parents.

## Dependencies

- `cowork:check-vault-routing` (pre-flight Step 1) — required.
- `cowork:resolve-person` (Step 5, per-candidate) — required. Returns `null`-shape on miss; this skill treats null-shape as `resolved: false`.

Helper: `platform/blueprints/cowork/helpers/discover-people-helper.js` (pure, materialized to `spice/cowork/helpers/discover-people-helper.js` on consumer vaults per the canonical `{{module_directory}}/helpers/...` + `tag: platform` pattern).

## Outputs

- Side-effect writes (Steps 8-10): new person-note stubs under `spice/people/`, updated `vault-config.md` (with `.bak`), updated `people-aliases.md` files per-kind (with `.bak`).
- Stdout: review table (Step 6), report (Step 11).
- Notice: final completion confirmation with applied + skipped counts.

## Errors

| Mode | Behavior |
|---|---|
| Obsidian MCP missing | Pre-flight Step 1 exits cleanly with Notice. No state mutated. |
| vault-config.md missing | Pre-flight Step 2 exits cleanly with Notice. |
| Specified `engagement_id` not in vault-config | Pre-flight Step 2 exits cleanly with Notice. |
| Multiple engagements + no input | Pre-flight Step 2 prompts user; selection required. |
| `cowork:resolve-person` failure | Treat as `resolved: false` and continue (sub-skill never throws). |
| `mcp__obsidian__obsidian_put_content` write failure | Log Notice; exit. `.bak` backups preserve prior state. |

## Reference

- Canonical design: `Docs/plans/2026-06-04-v0.90.0-wikilink-eod-discover-people-design.md` (§3 Workstream C).
- Brainstorm anchor: `Docs/prompts/2026-06-04-post-v0.89.1-ws2-discovery-brainstorm-handoff.md` (§Workstream 2).
- Helper: `platform/blueprints/cowork/helpers/discover-people-helper.js`.
- HC sub-asserts: HC-V0900-DISCOVER-HELPER-A1..I1 (helper) + HC-V0900-DISCOVER-SKILL-A1..A5 (this SKILL.md).
