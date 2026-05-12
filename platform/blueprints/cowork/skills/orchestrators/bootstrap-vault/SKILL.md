---
name: cowork:bootstrap-vault
description: Canonical first-run entry point for any Sauce-shape vault hosting cowork. Interactively interviews the user, dynamically introspects installed blueprints + engagement-type registry, materializes per-engagement context dirs + nav-button table on Cowork.md, and emits a 7-section bootstrap report including inline audit-receipt. Phrasings = "bootstrap this vault", "set up cowork", "first-time cowork setup", "onboard this vault to cowork".
schedule: User-invoked (never cron-scheduled)
scope: shared
tags: [cowork, orchestrator, onboarding, bootstrap, engagement-aware]
---

# cowork:bootstrap-vault

The canonical first-run entry point for any Sauce-shape vault hosting cowork. Replaces the v0.30.0 binary `vault_scope` interview with a dynamic, blueprint-introspecting, engagement-aware flow. Interactively interviews the user one question at a time, probes MCP backends, introspects the engagement-type registry + each installed blueprint's `bootstrap_contributions[]`, materializes per-engagement context directories, renders an engagement × cadence nav-button table on `Cowork.md`, and emits a 7-section bootstrap report with an inline audit receipt. Runs serially (no parallel sub-skill dispatch from this orchestrator body). Idempotent on re-bootstrap via additive-merge semantics — never clobbers existing engagement context files.

## Inputs

```
{
  resume_from_step?: number,   // re-bootstrap continues mid-flow if interrupted
  debug_log?: boolean          // emit per-step Notices for tracing
}
```

If `resume_from_step` is set, skip steps `< resume_from_step` and pick up from there (caller is responsible for supplying any state the resumed step needs).

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"], bootstrapped_required: false }`. (NEW input arg `bootstrapped_required` — bootstrap-vault is the ONE skill that runs against an unbootstrapped vault.) If the return is not `"ready"`, emit the following Notice and exit:

   ```
   cowork:bootstrap-vault aborted -- obsidian MCP unavailable
   ```

2. Use Skill `cowork:date-context` with `{}`. Capture `context`. If `context.error` exists, emit Notice and exit.

3. Read `<vault>/ranch/platform-installed.json` via `mcp__obsidian__read_note`. If the cowork blueprint is NOT in the `blueprints[]` array, emit Notice `cowork not installed in this vault; run "sauce install cowork" first` and exit.

4. Check for prior bootstrap state via `mcp__obsidian__get_notes_info` on `<vault>/spice/cowork/context/vault-config.md`.

   - **Absent:** fresh bootstrap — continue to step 5 with `prior_state = "fresh"`.
   - **Present:** read frontmatter via `mcp__obsidian__get_frontmatter`. Parse:
     - **`engagements[]` present + non-empty:** `prior_state = "re-bootstrap"`. Capture `existing_engagements`. Continue with additive-merge semantics per §3-bis of the design doc.
     - **`vault_scope` present + `engagements[]` absent:** v0.30.0 legacy state. Emit the following Notice verbatim:

       ```
       cowork:bootstrap-vault aborted -- detected v0.30.0 vault_scope schema.
       Migrator not shipped in v0.31.0 (planned for v0.31.x).
       To proceed now: remove the vault_scope frontmatter from vault-config.md
       (or delete the file entirely) and re-run bootstrap to perform a fresh interview.
       Your existing context/*.md files will not be touched.
       ```

       Exit without writing.
     - **Neither present:** schema-invalid file. Ask user `vault-config.md exists but doesn't match expected shape; replace? (yes/no)`. `no` → exit. `yes` → `prior_state = "fresh"`, continue.

5. Check for prior bootstrap report at `<vault>/spice/cowork/bootstrap-report.md`. If present, do NOT prompt yet — additive-merge re-runs idempotently replace it. (v0.30.0's prompt-to-replace removed in v0.31.0.)

## Discover (MCP probing — no user interaction)

6. Probe each known MCP backend with one lightweight read; capture `mcp_map`:
   - gmail: `mcp__claude_ai_Gmail__list_labels` — success → `"connected"`, error → `"missing"`
   - google-calendar: `mcp__claude_ai_Google_Calendar__list_calendars` — same coding
   - brex: `mcp__claude_ai_Brex__get_user_myself` — same coding
   - imessage: no MCP available yet, mark `"unavailable"` unconditionally
   - obsidian: from step 1, always `"connected"` here

   On any backend missing, emit the exact Notice:

   ```
   cowork:bootstrap-vault -- <backend> MCP missing; will mark engagement-scoped questions for that backend as skip
   ```

7. Capture `blueprints_installed = []` from the `blueprints[]` array of platform-installed.json read in step 3.

8. **NEW** — Load engagement-type registry:
   - Read `platform/blueprints/cowork/engagement-types/*.json` via the workshop path resolution (substitution map already encodes `workshop_path`).
   - Read `<vault>/spice/cowork/engagement-types/*.json` via `mcp__obsidian__list_directory` then per-file read (consumer overrides — may be empty).
   - Merge by `id` — consumer wins on conflict. Capture `engagement_types_registry = { <id>: <manifest>, ... }`.

9. **NEW** — Load blueprint bootstrap_contributions:
   - For each blueprint in `blueprints_installed`:
     - Read its `manifest.json` from the workshop tree.
     - If `bootstrap_contributions[]` field is present + non-empty, accumulate into `contributions_registry = { <blueprint>: [...], ... }`.
     - Absent or empty → passive blueprint, skip.

10. Probe vault surface via `mcp__obsidian__list_directory` at `spice/`. For each `<module>` dir present, shallow `list_directory` to count entries. Capture `vault_surface = { <module>_count, ... }`. Read `<vault>/ranch/templates/Daily Note.md` and confirm `<!-- COWORK_CALLOUTS -->` anchor is present — if missing, emit the following Notice verbatim and exit:

    ```
    cowork:bootstrap-vault aborted -- daily blueprint upgrade required; run "sauce update" and re-invoke
    ```

## Interview (interactive — one question at a time)

11. If `prior_state == "re-bootstrap"`, present existing engagements summary table and Ask user:

    ```
    Found N existing engagement(s): <list of id (type) label>.
    What would you like to do?
      (a) Add a new engagement (existing untouched)
      (b) Update an existing engagement's fields
      (c) Drop an engagement (requires confirmation)
      (d) Re-run full interview (existing replaced)
    ```

    Capture `re_bootstrap_mode`. Drop mode (`c`) requires per-engagement confirmation `Drop engagement '<id>'? This deletes vault-config.md entry only; context dir spice/cowork/context/<id>/ stays untouched. (yes/no)`.

    For fresh state (`prior_state == "fresh"`), skip step 11; flow directly to step 12.

12. Ask user: `How many engagements does this vault host? (1, 2, 3, or "exploring" — add one for now with type=personal-exploring placeholder)`. Capture `engagement_count`.

13. **Per-engagement interview loop.** For each new engagement E (count from step 12, OR the single engagement being updated/added in re-bootstrap modes):

    - **13a.** Ask `Engagement ID (lowercase-hyphens, e.g., "accuris", "ero-acme", "personal"). Must be vault-unique.` Validate against `^[a-z][a-z0-9-]+$` and uniqueness against existing engagements. Re-ask on failure.
    - **13b.** Ask `Engagement type? Options: <list keys of engagement_types_registry, with labels>`. Validate against `engagement_types_registry`. Re-ask on failure. Capture `E.type`.
    - **13c.** Compute the field set for E:

      ```
      fields = engagement_types_registry[E.type].required_fields
             + engagement_types_registry[E.type].optional_fields
             + ⋃ {contributions_registry[B].engagement_field_offer : E.type ∈ that offer's consumed_by_types}
      ```

      Required fields ask without blank-allowed (re-ask on blank). Optional fields ask with blank-allowed (default applies per the offer's `default_value` if any; flag as `USING DEFAULT` for report §5).
    - **13d.** For each MCP backend marked `connected` in `mcp_map`, ask the engagement-scoped MCP question — but ONLY if the engagement type's `render_aspects` references that backend (or a blueprint's `engagement_field_offer` does). E.g., gmail: `Which gmail label/account does engagement '<id>' use?`. Skip backends whose `render_aspects` are all `"skip"` for this type.
    - **13e.** Cadence overrides: present `engagement_types_registry[E.type].default_cadences`. Ask user `Override any cadences for engagement '<id>'? (yes/no)`. If yes, walk cadences one at a time and capture overrides.
    - **13f.** Capture engagement E as a full record (id, type, type_schema_version, label, captured field map, cadences).

14. Vault-scoped questions (from `contributions_registry` where `vault_question` kind exists): ask once per vault, not per engagement. Capture into the vault-wide substitution map.

15. Ask `Where should I drop the cron-job SKILL.md bodies? Options: (a) print in bootstrap-report only [default]; (b) print AND copy to <vault>/.scratch/cron-bodies/ for easy paste`. Capture `cron_drop_mode`.

## Compose (write files)

16. Accumulate substitution maps:
    - Vault-wide: vault-question answers (step 14) + vault basename + today's date + `mcp_map`.
    - Per engagement E: `E.id` + `E.type` + E's captured field map.

17. Write/update `<vault>/spice/cowork/context/vault-config.md`:

    Frontmatter:

    ```yaml
    type: cowork-vault-config
    updated: <today>
    updated_by: cowork:bootstrap-vault
    cowork_version: 0.2.0
    schema_version: 1
    engagements:
      - id: <id>
        type: <type>
        type_schema_version: <from registry>
        label: <label>
        ...captured fields...
        cadences:
          morning: <bool>
          midday:  <bool>
          eod:     <bool>
          weekly:  <bool>
          monthly: <bool>
      - ...
    mcp_map:
      gmail: connected | missing
      ...
    ```

    Body: human-readable per-engagement summary block + MCP map block. Re-bootstrap modes: preserve any non-managed body content via patch-merge (use `mcp__obsidian__patch_note` if a fresh write would clobber; use `mcp__obsidian__write_note` for fresh state).

18. For each engagement E, ensure the directory `<vault>/spice/cowork/context/<E.id>/` exists. Then for each template file in `engagement-templates/<E.type>/`:
    - Read the template body from the workshop tree.
    - Substitute `{{<field>}}` placeholders using E's substitution map.
    - Unresolved placeholders → leave intact + FLAG for report §5.
    - Write to `<vault>/spice/cowork/context/<E.id>/<filename>.md` via `mcp__obsidian__write_note`.
    - **Idempotence (re-bootstrap):** if the target file already exists, do NOT clobber — instead write `<filename>.template.md` alongside so the user can diff + merge by hand.

    Plus apply `context_file_offer` contributions from blueprint manifests: each offer that targets engagement E (type match in `consumed_by_types`) materializes its declared template into the engagement's context dir.

19. Seed (or update) vault-wide files in `<vault>/spice/cowork/context/`:
    - `active-threads.md` — seed empty schema if absent; preserve if present.
    - `weekly-snapshot.md` — seed empty schema if absent; preserve if present.
    - `README.md` — overwrite from `engagement-shared-templates/README.md` (read-only template source).
    - `obsidian-vault-guide.md` — overwrite from template source.

20. Render the nav-button table on `<vault>/spice/cowork/Cowork.md`:
    - Header section with a `[!warning]` callout that auto-suppresses (dataviewjs guard: `if (vault-config.md exists && engagements[].length > 0) hide`).
    - Static markdown table: rows = engagements, columns = supported cadences (union across all engagements).
    - Each cell = nav-button using `invoke_command` action with `{ command_id: "cowork:<orchestrator-id>", args: { engagement_id: "<id>" } }` (requires nav-buttons@2.6.0 `args` passthrough — N1).
    - Below the table: dataviewjs block reading recent daily notes for engagement-tagged H2 callouts; surfaces a "Last run" timestamp column per (engagement, cadence) pair.

21. Write `<vault>/.claude/cowork-routing.md` (N3 resolution): NL routing cheat-sheet listing phrasings → skill IDs + engagement-id disambiguation rules. One section per engagement with engagement-aware phrasing examples.

22. Compose cron paste-blocks per (engagement, cadence) pair from the recommended-schedule table in design §3-sexies. If `cron_drop_mode == "b"`, also write each block to `<vault>/.scratch/cron-bodies/<engagement>-<cadence>.md`.

## Audit

23. **NEW** — Run audit inline via `Use Skill cowork:run-audit-receipt` with `{ vault_path: <vault>, workshop_path: <workshop> }`. The sub-skill wraps `node platform/cli/sauce-cli.js audit --vault <vault> --only cowork --format json` via Bash, parses the JSON, and returns `{ status, summary, receipt_lines, raw_violations }`. Capture `audit_receipt`. Embed `receipt_lines` verbatim into report §6.

    Alternative if Bash dispatch is unavailable in skill context (sub-skill returns `status: "unavailable"`): emit a placeholder + run-this-yourself instruction into §6 (degraded mode). Bootstrap continues either way — bootstrap-vault's job is to MATERIALIZE state; the audit surfaces any post-write drift but does not gate completion.

## Report

24. Compose the bootstrap report (7 sections per design §3-octies) and write to `<vault>/spice/cowork/bootstrap-report.md` via `mcp__obsidian__write_note` with frontmatter:

    ```yaml
    type: cowork-bootstrap-report
    generated: <today>
    generated_by: cowork:bootstrap-vault
    cowork_version: 0.2.0
    prior_state: fresh | re-bootstrap
    engagement_count: <N>
    engagements_summary: [<id (type)>, ...]
    audit_receipt: pass | fail | warn
    ```

    Sections:

    - **§1 What I discovered** — `mcp_map` as a table, `vault_surface` stats as a list, blueprints installed, daily-template marker presence (always confirmed by step 10 or we would have exited).
    - **§2 Engagements** — per-engagement subsection (id, type, label, captured fields, cadences).
    - **§3 Cron jobs** — per-engagement table with columns `cadence | schedule | job-name | SKILL.md body` populated from step 22.
    - **§4 Skipped** — per-(engagement, cadence) one-liner with reason: missing MCP / engagement-type opt-out / user override.
    - **§5 Unresolved fields** — per engagement, list every `{{...}}` placeholder still unresolved AND every `USING DEFAULT` flag, with the exact `ranch/platform-config.json` `variables` key the user should populate.
    - **§6 Audit receipt** — verbatim `receipt_lines` from step 23 (or the degraded-mode instruction if Bash was unavailable).
    - **§7 Manual Obsidian + natural-language parity** — pointer to `spice/cowork/Cowork.md` (nav-button table) + NL phrasing examples (drawn from `.claude/cowork-routing.md` written in step 21) + scheduled cron pointer to §3.

## Done

25. Emit final Notice: `Bootstrap complete (<engagement_count> engagement(s)). Open spice/cowork/bootstrap-report.md for next steps.` This orchestrator never patches the daily note and never mutates `active-threads.md` or `weekly-snapshot.md` beyond the empty-schema seed in step 19. Cadenced state writes are owned by the cron-scheduled orchestrators.

## Dependencies

This orchestrator depends on:

- `cowork:check-vault-routing` (extended in S2 with `bootstrapped_required` input)
- `cowork:date-context` (UNCHANGED from v0.30.0)
- `cowork:run-audit-receipt` (NEW sub-skill in S2 — wraps audit CLI invocation)

This orchestrator writes to (or seeds):

- `<vault>/spice/cowork/context/vault-config.md` (canonical engagement record)
- `<vault>/spice/cowork/context/<engagement-id>/<file>.md` (per-engagement materialization)
- `<vault>/spice/cowork/context/active-threads.md` (seed empty)
- `<vault>/spice/cowork/context/weekly-snapshot.md` (seed empty)
- `<vault>/spice/cowork/context/README.md` (overwrite from template)
- `<vault>/spice/cowork/context/obsidian-vault-guide.md` (overwrite from template)
- `<vault>/spice/cowork/Cowork.md` (nav-button table + dataviewjs last-run block)
- `<vault>/.claude/cowork-routing.md` (NL routing cheat-sheet)
- `<vault>/spice/cowork/bootstrap-report.md` (7-section report)

This orchestrator does NOT write to:

- `<vault>/ranch/platform-installed.json` (installer-owned)
- `<vault>/ranch/platform-config.json` (user-owned; bootstrap only READS placeholders for the report)
- `<vault>/.obsidian/*` (per landmine #12 allowlist; bootstrap-vault touches NONE of the allowlisted paths)
- `<vault>/ranch/templates/Daily Note.md` (daily blueprint owns)

## Error modes

| Mode | Behavior |
|---|---|
| `obsidian` MCP missing | Step 1 exits cleanly with Notice. No state written. |
| `platform-installed.json` lacks cowork | Step 3 exits cleanly with Notice. |
| v0.30.0 legacy state detected | Step 4 exits cleanly with the detailed Notice. No state mutated. |
| `<!-- COWORK_CALLOUTS -->` anchor missing in daily template | Step 10 exits cleanly with Notice prompting `sauce update`. |
| User-supplied invalid engagement ID | Step 13a re-asks until valid. |
| User-supplied unregistered engagement type | Step 13b re-asks until valid. |
| Required field left blank | Step 13c re-asks (required fields cannot default). |
| Audit (step 23) returns FAIL | Report §6 surfaces the failure verbatim; bootstrap continues — bootstrap-vault's job is to MATERIALIZE state; if audit detects post-write drift, the report makes it visible. User runs corrective action. |
| Existing context file conflict in re-bootstrap | Step 18 writes alongside (`.template.md`); never clobbers. |

## Outputs

Structured report frontmatter (per step 24) written to `<vault>/spice/cowork/bootstrap-report.md`. Final Notice (per step 25) confirms completion + engagement count.

## Reference

Canonical spec: `Docs/plans/2026-05-11-v0.31.0-bootstrap-vault-skill-spec.md` (spec-locked 2026-05-11). Architectural decisions: `Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md` (§3-bis through §3-novies). Cycle plan: `Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-plan.md` (S3).
