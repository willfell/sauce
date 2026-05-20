---
name: cowork:scaffold-timeframes
description: Idempotently creates this-week's weekly note + this-month's monthly note from templates; reports prompt-stub presence. Standalone-invocable; also composed into cowork:bootstrap-vault. Inputs: optional dry_run bool. Phrasings = "scaffold cowork timeframes", "cowork timeframes scaffold".
scope: shared
tags: [cowork, sub-skill, scaffold, timeframes]
---

# cowork:scaffold-timeframes

Idempotent timeframe-shell scaffolder. Creates the current ISO-week's weekly note + the current month's monthly note from templates if missing; verifies the four prompt stubs exist under `spice/cowork/prompts/`. Returns a JSON receipt naming what was created vs. existed.

Composed into `cowork:bootstrap-vault` as a final step. Standalone-invocable for re-scaffolding after a date rollover (e.g., on the Monday of a new week) or to verify state.

## Inputs

```
{
  dry_run: bool  // optional, default false; when true, reports what WOULD be created without writing
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, emit Notice `cowork:scaffold-timeframes aborted -- <status>` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `context` (today, dddd, week_of, iso_week_label, etc.).

## Compute targets

3. Compute `weekly_target_path` = `spice/cowork/weekly/<YYYY>/<YYYY>-W<ww>.md` where `<YYYY>-W<ww>` is the ISO-week label from `context`. Example: today = 2026-05-13 → `spice/cowork/weekly/2026/2026-W20.md`.
4. Compute `monthly_target_path` = `spice/cowork/monthly/<YYYY>/<YYYY>-<MM>.md`. Example: today = 2026-05-13 → `spice/cowork/monthly/2026/2026-05.md`.

## Check + create weekly

5. Check existence of `weekly_target_path` via `mcp__obsidian__list_files` (or `mcp__obsidian__read_note` returning "not found"). If existing → record `existed.push(weekly_target_path)`. If missing AND not `dry_run`:
   - Read `ranch/templates/Weekly Note.md` body via `mcp__obsidian__read_note`.
   - Resolve Templater placeholders manually for this skill (the skill runs OUTSIDE Templater's auto-context):
     - `<% tp.file.creation_date("YYYY-MM-DD HH:mm") %>` → current timestamp formatted.
     - `<% tp.file.title %>` → `<YYYY>-W<ww>`.
     - `<% moment(tp.file.title, "YYYY-[W]ww").format("YYYY-[W]ww") %>` → `<YYYY>-W<ww>`.
     - `<% moment(...).startOf("isoWeek").format("YYYY-MM-DD") %>` → context.week_start.
     - `<% moment(...).endOf("isoWeek").format("YYYY-MM-DD") %>` → context.week_end.
     - `{{vault_identity_tag}}` → vault-config's identity tag.
     - `{{views_path}}` → `ranch/views`.
   - Write resolved body via `mcp__obsidian__create_note` at `weekly_target_path`.
   - Record `created.push(weekly_target_path)`.
6. If `dry_run` and file missing, record `would_create.push(weekly_target_path)`.

## Check + create monthly

7. Repeat step 5/6 for `monthly_target_path` using `ranch/templates/Monthly Note.md`. Substitute `tp.file.title` = `<YYYY>-<MM>`, `month_start` = first-of-month, `month_end` = last-of-month.

## Verify prompt stubs

8. For each of `morning-briefing.md`, `eod-review.md`, `weekly-review.md`, `monthly-review.md`:
   - Check existence at `spice/cowork/prompts/<name>`. If missing → record `missing_prompts.push(name)`.
9. The installer materializes these stubs at install time, so a missing prompt is a vault-config issue (installer didn't run, install was partial, or user deleted). Emit a Notice listing missing prompts; do not create them from this skill (the installer is the source of truth for prompt-stub bodies).

## Return

10. Return JSON:
   ```json
   {
     "created": ["<paths>"],
     "existed": ["<paths>"],
     "would_create": ["<paths>"],
     "missing_prompts": ["<names>"],
     "date_context": { "today": "...", "iso_week_label": "...", "month_label": "..." }
   }
   ```

## Errors

- `mcp__obsidian__create_note` failure (e.g., permission, disk full): emit Notice; capture failure in receipt as `failures: [{ path, error }]`; do NOT throw — return the partial receipt.
- Template missing at `ranch/templates/Weekly Note.md` or `Monthly Note.md`: hard-fail with explanatory Notice (install integrity issue).
- Vault-config tag resolution failure: substitute `{{vault_identity_tag}}` with literal `vault` as a fallback; record in receipt as `tag_fallback: true`.

## Idempotence

- Re-running after both notes exist: returns `created: [], existed: [weekly_path, monthly_path]`. No writes. No Notices unless prompt stubs are missing.
