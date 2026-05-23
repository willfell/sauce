---
name: cowork:context-builder
description: Engagement-aware, idempotent, additive interactive interview that captures user preferences for cowork's atomic-note rendering. Detects connected MCPs via the available tool list; maps each to its corresponding cowork gather skill via `spice/cowork/context/mcp-skill-map.json`; walks hand-curated question sets per MCP-kind; captures cross-cutting priorities and personality. Writes structured frontmatter into the user-owned `spice/cowork/context/user-preferences.md`. v0.76.0 establishes the file shape; v0.77.0 wires the 5 atomic-note orchestrators to consume it. Phrasings = "set up cowork preferences", "update my cowork preferences", "cowork context builder", invoked automatically by cowork:onboard-scheduled-jobs.
scope: shared
tags: [cowork, orchestrator, personalization, interactive]
---

# cowork:context-builder

Engagement-aware MCP-preferences interview. Re-runnable, idempotent, additive. On every run:
- Detects currently-connected MCPs.
- Asks tailored questions only for MCPs that (a) have a corresponding cowork gather skill and (b) are not already captured in the existing `user-preferences.md` (unless the user opts to update).
- Always re-asks cross-cutting priorities + personality (these are cheap and reflect intent at interview time).
- Preserves blocks for MCPs that were captured previously but are no longer connected (e.g., a temporary disconnect — the user's prefs stay intact).

Writes `spice/cowork/context/user-preferences.md` — a user-owned file that NEVER gets overwritten by `sauce update` or `sauce reinstall` (carried by `materialize_once: true` in the cowork manifest entry).

## Inputs

```
{
  dry_run_answers: object | null   // OPTIONAL: when present, suppresses AskUserQuestion
                                   // and feeds canned answers. Used by HC-V0760-F1..F2
                                   // harness. Production callers leave null.
}
```

## Pre-flight

1. **Confirm vault is cowork-bootstrapped.** Use Read to verify `spice/cowork/context/vault-config.md` exists. If not, emit:
   > `cowork:context-builder requires vault-config.md — run cowork:onboard-scheduled-jobs first (it auto-delegates to bootstrap-vault).`
   Exit.

2. **Read current state.** Use Read on `spice/cowork/context/user-preferences.md`. Parse YAML frontmatter; capture as `existing_prefs`. Distinguish three cases:
   - File missing → `existing_prefs = null; is_fresh = true`.
   - File present with `updated_by: install.js` → `existing_prefs = null; is_fresh = true` (this is the materialized seed template; treat as empty).
   - File present with `updated_by: cowork:context-builder` → `existing_prefs = parsed; is_fresh = false`.

3. **Read MCP-skill map.** Use Read on `spice/cowork/context/mcp-skill-map.json`. Parse as `mcp_skill_map` (array of entries each with `mcp_kind`, `mcp_namespace_match`, `gather_skill`).

## Detect

4. **Enumerate available MCP tools.** Inspect your current tool list. For each tool whose name starts with `mcp__`, capture the namespace segment (e.g., `mcp__Google_Calendar__list_events` → namespace `Google_Calendar`). Build `available_mcp_namespaces[]` deduplicated.

5. **Map namespaces to MCP-kinds.** For each entry in `mcp_skill_map`, check whether its `mcp_namespace_match` regex matches ANY string in `available_mcp_namespaces[]`. Build `detected_mcp_kinds[]` (set of mcp_kinds with at least one matching namespace). Each kind has a corresponding `gather_skill` from the map.

   When `dry_run_answers` is provided, replace this whole step with: `detected_mcp_kinds = dry_run_answers.detected_mcps`.

6. **List unmapped MCPs.** For each namespace in `available_mcp_namespaces[]` not matched by any map entry, collect in `unmapped_namespaces[]`. These are reported in the audit-receipt but no questions are asked.

## Interview — per-MCP

7. **Order MCPs.** Sort `detected_mcp_kinds[]` by `existing_prefs.priorities` order (kinds appearing first in priorities go first); kinds not in priorities go last in alphabetical order. This gives the user a stable, intuitive walk order across runs.

8. **For each MCP-kind, decide action:**
   - **NEW (no existing block)**: action = "Walk".
   - **Existing block, MCP currently connected**: ask `AskUserQuestion`:
     > Update preferences for {{mcp_kind}}? (configured {{existing_prefs.mcps[mcp_kind].captured_at}})
     >   - Update — re-walk the question set with current answers as defaults
     >   - Skip — leave block unchanged
     >   - Clear — drop the block entirely
     Action = user's choice.
   - **Existing block, MCP NOT in detected_mcp_kinds**: action = "PreserveDisconnected". Don't ask. Set `connected: false` and `last_seen: {{existing_captured_at}}` on the block; leave answers untouched.

   When `dry_run_answers` is provided, replace this whole step with: action = `dry_run_answers.per_mcp_actions[mcp_kind] || "Walk"`.

9. **For each MCP-kind where action ∈ {Walk, Update}, walk the question set** described in the `## Question set — <mcp_kind>` section below. Each question is asked one at a time via `AskUserQuestion` (unless `dry_run_answers` is provided, in which case the answers come directly from `dry_run_answers.per_mcp_answers[mcp_kind]`). Capture answers into the per-MCP block.

10. **For each MCP-kind where action = "Clear"**, delete the block (it will be absent from the next file write).

11. **For each MCP-kind where action = "Skip" or "PreserveDisconnected"**, leave the existing block unchanged.

## Cross-cutting questions

12. **Priorities ranking.** Ask via `AskUserQuestion` (multiSelect = true; user reorders mentally and selects in order). Default order from `existing_prefs.priorities`. New MCPs added at the end. Question wording:
    > Rank these information sources by what you want to see first in your morning briefing. (Select in order: first = most important.)
    > Options = detected_mcp_kinds[] in their current default order.
    Capture as `priorities[]` in user-specified order.

    When `dry_run_answers` is provided: `priorities = dry_run_answers.priorities`.

13. **Personality — vibe.** AskUserQuestion (single-select):
    > Voice for your atomic-note narrative (Synopsis + Tip closes):
    >   - encouraging — uplifting; light enthusiasm
    >   - dry-and-factual — neutral; clinical
    >   - casual — conversational; warm
    >   - formal — structured; deferential
    Capture as `personality.vibe`. Default from existing if present.

14. **Personality — formality.** AskUserQuestion (single-select):
    > Formality level:
    >   - casual
    >   - formal
    Capture as `personality.formality`.

15. **Personality — pep_talk.** AskUserQuestion (single-select):
    > Pep-talk closes in `> [!tip]` callouts (yes = motivational; no = action-oriented):
    >   - yes
    >   - no
    Capture as `personality.pep_talk` (boolean).

16. **Personality — length.** AskUserQuestion (single-select):
    > Narrative length preference:
    >   - terse — 1-2 sentences max per section
    >   - balanced — 2-3 sentences
    >   - thorough — 3-5 sentences with context
    Capture as `personality.length`.

    When `dry_run_answers` is provided, steps 13-16 are replaced by `personality = dry_run_answers.personality`.

## Compose + Write

17. **Compose new preferences structure.** Build a frontmatter object:
    ```
    {
      type: "cowork-user-preferences",
      updated: <today's date in YYYY-MM-DD>,
      updated_by: "cowork:context-builder",
      priorities: [<user's order>],
      personality: { vibe, formality, pep_talk, length },
      mcps: {
        // For each MCP-kind, either the walked block, the preserved-disconnected block,
        // or absent (if Cleared).
      },
    }
    ```

18. **Write user-preferences.md.** Delegate to the helper at `platform/blueprints/cowork/helpers/context-builder-dry-run.js`:
    ```
    const helper = require("<workshop>/platform/blueprints/cowork/helpers/context-builder-dry-run.js");
    helper.run({ vaultRoot, dryRunAnswers: {
      detected_mcps,
      per_mcp_answers,
      per_mcp_actions,
      priorities,
      personality,
    } });
    ```
    The helper performs the merge (existing prefs + new answers → final structure) and writes the file. Live invocation passes the computed answers as `dryRunAnswers` for symmetry — same code path serves both live and harness.

## Audit

19. **Emit audit-receipt.** Compose a 5-row markdown table summarizing the run:
    ```
    | aspect             | value                              |
    | ------------------ | ---------------------------------- |
    | mcps_added         | [calendar, gmail]                  |
    | mcps_updated       | []                                 |
    | mcps_preserved     | [imessage]                         |
    | mcps_cleared       | []                                 |
    | unmapped_namespaces| [context7]                         |
    ```
    Emit as a Notice/output for the user.

## Done

20. Emit Obsidian Notice: `cowork:context-builder complete — preferences saved to spice/cowork/context/user-preferences.md`.

## Question set — calendar

### Q1 — surface_event_kinds (multi-select)

> Which calendar event kinds matter most for your morning briefing?

- conflicts — overlapping events
- focus-blocks — 1+ hour gaps marked as focus time
- prep-needed — meetings missing agenda/notes
- travel — events with a location field
- external — events with attendees outside your org
- all-day — full-day events (out-of-office, holidays)

Output field: `mcps.calendar.surface_event_kinds` (string[])

### Q2 — include_all_day (single-select)

> Include all-day events (OOO, holidays) in the briefing's calendar callout?

- yes
- no

Output field: `mcps.calendar.include_all_day` (boolean)

### Q3 — quiet_hours (single-select)

> Should the morning briefing surface evening events too, or only working-hours events?

- working-hours-only — 8am-6pm local
- all-day-window — everything until midnight

Output field: `mcps.calendar.quiet_hours_strategy` (string)

## Question set — gmail

### Q1 — surface_kinds (multi-select)

> What email patterns should the briefing surface?

- unanswered-24h — threads with no outgoing reply >24h
- action-required — explicit Q to you in last 24h
- vip-senders — emails from your inner-circle senders
- new-threads — newly-started threads (no prior context)
- attachment-only — emails primarily delivering files

Output field: `mcps.gmail.surface_kinds` (string[])

### Q2 — inbox_zero_threshold (single-select)

> What's your inbox-zero target? (Used to flag drift.)

- 0
- 5
- 10
- 25
- not-tracked

Output field: `mcps.gmail.inbox_zero_threshold` (string or int)

### Q3 — vip_senders (free-text)

> List up to 5 sender addresses or names that always count as VIP. (Comma-separated.)

Output field: `mcps.gmail.vip_senders` (string[])

### Q4 — ignore_lists (single-select)

> Skip newsletters and bulk-sender threads entirely?

- yes
- no — count them but don't elevate

Output field: `mcps.gmail.ignore_lists` (boolean)

## Question set — imessage

### Q1 — inner_circle (free-text)

> List up to 8 contact names (Apple Contacts names or numbers) that count as "inner circle". (Comma-separated. Used to elevate their threads.)

Output field: `mcps.imessage.inner_circle` (string[])

### Q2 — surface_kinds (multi-select)

> Which message patterns should the briefing surface?

- reply-owed-24h — incoming message with no reply >24h from inner circle
- time-sensitive — messages mentioning today's date or this week
- group-only — group-chat messages where you were @-mentioned or quoted

Output field: `mcps.imessage.surface_kinds` (string[])

### Q3 — quiet_hours_imessage (single-select)

> Suppress messages received during your quiet hours (late-night) from the briefing?

- yes — skip messages received 10pm-7am local
- no — count all messages

Output field: `mcps.imessage.suppress_quiet_hours` (boolean)

## Question set — finance

### Q1 — cards_mine (free-text)

> List Brex card IDs or last-4-digits that count as "yours". (Comma-separated. Used to filter from a shared account view.)

Output field: `mcps.finance.cards_mine` (string[])

### Q2 — surface_kinds (multi-select)

> Which spending patterns should the briefing surface?

- category-outliers — categories ≥2x your trailing-7-day median
- daily-spend — yesterday's total vs your trailing-7-day average
- approval-queue — expenses awaiting your approval
- recurring-changes — recurring charges that changed amount or frequency

Output field: `mcps.finance.surface_kinds` (string[])

### Q3 — daily_threshold_usd (single-select)

> Surface a daily-spend callout only when total exceeds:

- 100
- 250
- 500
- always

Output field: `mcps.finance.daily_threshold_usd` (string or int)

### Q4 — category_ignore (free-text)

> Categories to ignore entirely from outlier detection. (Comma-separated. Examples: "rent", "groceries-amazon".)

Output field: `mcps.finance.category_ignore` (string[])
