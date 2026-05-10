---
name: cowork:bootstrap-vault
description: Onboards a vault to cowork by interviewing the user + probing MCP + reading vault state; emits a cron handoff bundle.
schedule: User-invoked (not cron-scheduled)
scope: shared
tags: [cowork, orchestrator, onboarding]
---

# cowork:bootstrap-vault

The missing link between "sauce install cowork" finishing and scheduled jobs running. This skill is INTERACTIVE — it prompts the user step by step. It probes MCP availability, reads vault state, asks scoped questions, then writes context files and a handoff report listing which orchestrators to enable, the cron SKILL.md body to paste for each, and any template variables still needing manual fill. The orchestrator never patches the daily note; this is one-shot setup. If the user provides incomplete answers, continue with sensible defaults and FLAG them in the final report.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If the return is not `"ready"`, emit Notice `cowork:bootstrap-vault aborted -- obsidian MCP unavailable` and exit.
2. Use Skill `cowork:date-context` with `{}`. Capture `context`. If `context.error` exists, emit Notice and exit.
3. Read `<vault>/ranch/platform-installed.json` via `mcp__obsidian__read_note`. If the cowork blueprint is NOT in the `blueprints[]` array, emit Notice `cowork not installed in this vault; run "sauce install cowork" first` and exit.
4. Check for prior bootstrap via `mcp__obsidian__get_notes_info` on `<vault>/spice/cowork/bootstrap-report.md`. If present, Ask user: `I see a prior bootstrap report from <updated date>. Replace it? (yes/no)`. If `no`, exit without writing.

## Discover (MCP probing -- no user interaction yet)
5. Probe each known MCP backend with one lightweight read; capture `mcp_map`:
   - gmail: `mcp__claude_ai_Gmail__list_labels` -- success => `"connected"`, error => `"missing"`
   - google-calendar: `mcp__claude_ai_Google_Calendar__list_calendars` -- same coding
   - brex: `mcp__claude_ai_Brex__get_user_myself` -- same coding
   - imessage: no MCP available yet, mark `"unavailable"` unconditionally
   - obsidian: from step 1, always `"connected"` here
6. Capture `blueprints_installed = []` from the `blueprints[]` array of the platform-installed.json read in step 3.
7. Probe vault surface via `mcp__obsidian__list_directory` at `spice/`. Enumerate which module dirs exist. For each known module dir present, shallow `list_directory` to count entries. Capture `vault_surface = { daily_note_count, project_count, trip_count, person_count, meeting_count, journal_count }` (zero out any module dir not present).
8. Read `<vault>/ranch/templates/Daily Note.md` via `mcp__obsidian__read_note`. Confirm the literal string `<!-- COWORK_CALLOUTS -->` is present. If not, emit Notice `cowork:bootstrap-vault aborted -- daily blueprint upgrade required; run "sauce update" and re-invoke` and exit.

## Interview (interactive -- ask the user)
9. Ask user: `What scope is this vault? Options: "life" (personal vault), "work" (ero-side vault), "both" (accuris-style), "none-yet" (just exploring).` Capture as `vault_scope`. If `none-yet`, skip steps 10-11 and only ask step 12's connected-MCP questions for posterity, then jump to step 13 with all orchestrators marked skip.

10. If `vault_scope` includes life, Ask user for each, one at a time (allow blank => USING DEFAULT flag):
    - `owner_name` (e.g. "Will Fellhoelter")
    - `home_city` (e.g. "Evergreen, CO" -- used by gather-weather)
    - `discretionary_categories` (comma-separated, used by tripwire-yellow thresholds)
    - `life_cc_active_cards` (cards user actively spends from, comma-separated)
    - `life_cc_locked_cards` (cards user has frozen, comma-separated)
    - `life_cc_ignored_cards` (cards user does not track, comma-separated)
    - `life_debt_weekly_target_usd` (numeric, e.g. 455)
    - `life_debt_monthly_target_usd` (numeric, e.g. 1964 -- consumed by gather-cc-debt-snapshot `on_pace` calculation)
    - `life_cc_focus_card` (single card name -- the highest-priority locked card; consumed by write-callout-finance Returns template)
    - `inner_circle_people` (comma-separated names for iMessage filtering)
    - `life_includes_wellness_prompts` (yes/no -- surface mood/sleep prompts in morning-briefing)

11. If `vault_scope` includes work, Ask user for each, one at a time:
    - `ero_role` (e.g. "Senior Data Engineer")
    - `ero_primary_client` (e.g. "Accuris")
    - `ero_hourly_rate_usd` (numeric)
    - `ero_ap_email` (e.g. "accountspayable@<client>.com")
    - `ero_stakeholders` (comma-separated names)
    - `ero_invoice_cadence` (`weekly` | `bi-weekly` | `monthly`)
    - `ero_25th_billing_cycle` (yes/no -- bill on 25th with delivery on 1st)

12. For each MCP backend marked `connected` in mcp_map, Ask user the scoped questions:
    - gmail connected: `Which gmail account is this?`, `How many threads should the morning digest scan? (default newer_than:1d)`, `Which categories filter out? (default: promotions, social, updates, forums)`
    - google-calendar connected: `Which calendar(s) should be scanned? (single or comma-separated)`, `Which entries are "AI committee" events to surface separately? (regex or substring; blank = none)`
    - brex connected: `Brex is your <work | life | both> finance backend?`, `Should morning-briefing surface yesterday's brex transactions? (yes/no)`, `Should midday-tripwire run? (yes/no)`
    - imessage unavailable: surface `iMessage MCP isn't connected; skipping iMessage gather skills` to the user (no question).

13. Build a recommendation table for all 9 orchestrators. Mark each `recommend: enable | skip` per rules below, then Ask user: `I recommend enabling [<enable list>]. Skipping [<skip list>]. Want to change any? (yes/no, then per-id overrides)`. Capture overrides.
    - Recommend rules:
      - Life orchestrators (`morning-briefing`, `midday-tripwire`, `eod-review`, `weekly-review`, `monthly-review`): require `vault_scope` includes life.
      - Ero orchestrators (`ero-morning`, `ero-eod`, `ero-weekly`, `ero-monthly`): require `vault_scope` includes work.
      - Subtract any orchestrator whose required MCP is missing. Heuristics: `morning-briefing` needs gmail + google-calendar + brex; `midday-tripwire` needs brex; `eod-review` needs gmail + google-calendar; `weekly-review` + `monthly-review` need brex; ero-* mirror their life counterparts but skip brex except `ero-monthly` (invoice-cadence dependent).
      - If `vault_scope == "none-yet"`, all 9 marked skip.

14. Ask user: `Where should I drop the cron-job SKILL.md bodies? (default: I just print them in the report; you copy them to your cron infrastructure manually).` Capture `cron_drop_mode` (`report-only` is the default).

## Compose (write files + emit report)
15. Accumulate a substitution map from steps 10-12 answers. Write `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__write_note` with frontmatter `{ type: cowork-vault-config, updated: <context.today>, updated_by: cowork:bootstrap-vault, vault_scope, enabled_orchestrators: [<list from step 13>], mcp_map }` and body listing every captured key-value in a human-readable format grouped by section (Identity / Life / Work / MCP).

16. For each per-scope context template under `<vault>/spice/cowork/context/<scope>-context-templates/<id>.md` matching the active `vault_scope`, read the template, substitute every `{{...}}` placeholder using the captured map (leave unmatched placeholders intact and FLAG them for step 18's section 5), and write the result to `<vault>/spice/cowork/context/<id>.md`. Use `mcp__obsidian__write_note` for each.

17. Seed `<vault>/spice/cowork/context/active-threads.md` and `<vault>/spice/cowork/context/weekly-snapshot.md` with empty schemas (frontmatter present, body has the `# Active threads` and `# Weekly snapshot` headings respectively, ready for first orchestrator run to populate). Skip if either already exists from a prior bootstrap (do not clobber state).

18. Compose the bootstrap report markdown body with these sections:
    - **Header:** `# Cowork bootstrap for <vault basename> -- <context.today>`
    - **Section 1 -- What I discovered:** mcp_map as a table, vault_surface stats as a list, daily-template marker presence (always confirmed by step 8 or we would have exited).
    - **Section 2 -- What you told me:** captured template var answers from steps 10-12 in a clean per-section list.
    - **Section 3 -- What you should set up next:** for each ENABLED orchestrator (from step 13), emit a fenced block in the form:
      ````
      ### Enable: cowork:<orchestrator-id>

      **Schedule:** <copied from that orchestrator's SKILL.md frontmatter>
      **Scope:** <copied from frontmatter>

      **Cron SKILL.md body** (paste at `/sessions/.../mnt/.scheduled/<job-name>/SKILL.md`):

      ```markdown
      # Cron orchestrator -- <job-name>

      Invoke skill `cowork:<orchestrator-id>` in the <vault basename> Obsidian vault.
      ```
      ````
    - **Section 4 -- What I skipped (and why):** per-skipped-orchestrator one-liner: missing MCP / scope mismatch / user override.
    - **Section 5 -- Template variables to fill in:** list every `{{...}}` placeholder still unresolved AND every USING DEFAULT flag from steps 10-12, with the exact `ranch/platform-config.json` `variables` key the user should populate.

19. Write the report to `<vault>/spice/cowork/bootstrap-report.md` via `mcp__obsidian__write_note` with frontmatter `{ type: cowork-bootstrap-report, generated: <context.today>, generated_by: cowork:bootstrap-vault, vault_scope, mcp_map, enabled_orchestrators, skipped_orchestrators }`. Surface final Notice: `Bootstrap complete. Open spice/cowork/bootstrap-report.md for next steps.`

## Done
This orchestrator never patches the daily note and never mutates active-threads.md or weekly-snapshot.md beyond the empty-schema seed in step 17. Cadenced state writes are owned by cron-scheduled orchestrators.
