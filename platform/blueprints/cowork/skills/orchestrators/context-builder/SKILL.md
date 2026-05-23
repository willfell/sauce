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

4. **Enumerate available MCP tools.** Inspect your current tool list. For each tool whose name starts with `mcp__`, capture the FULL name string (e.g., `mcp__Google_Calendar__list_events`). Build `available_tools[]`. Do NOT pre-strip namespaces — the helper handles namespace splitting.

5. **Read MCP-skill map.** Use Read on `spice/cowork/context/mcp-skill-map.json`. Verify `map.version === "2.0.0"`. Parse the `kinds[]` array; each entry has `kind`, `required_tools`, optional `tool_alternatives`, `gather_skill`, optional `rename_from_v1`.

6. **Detect capabilities.** Invoke the helper at `.local/blueprints/cowork/helpers/context-builder-dry-run.js` (or the materialized path in your vault) — specifically the `detectCapabilities(available_tools, map)` export. It returns `{ detected: [{kind, served_by, matched_tools, gather_skill}], unmapped_namespaces: [<ns>, ...] }`. Capability-subset model: a single namespace can satisfy multiple kinds (Outlook UUID = calendar + email + chat, all from one MCP).

   If running interactively without direct Node access to the helper, replicate the algorithm:
   - Group `available_tools[]` by namespace (the segment between `mcp__` and the right-most `__`).
   - For each `kind` in the map: a namespace satisfies the kind when (a) ALL of `required_tools` are present in the namespace's tool set, AND (b) at least one branch of `tool_alternatives[][]` is fully present (when `tool_alternatives` is defined).
   - Record `detected[]` entries. Any namespace not satisfying any kind goes in `unmapped_namespaces[]`.

   When `dry_run_answers` is provided, replace this whole step with: `detected = dry_run_answers.detected_mcps.map(k => ({kind: k, served_by: "<harness-supplied>", ...}))`. Unmapped namespaces become `[]`.

## Unknown-MCP loop

7. **For each `ns` in `unmapped_namespaces[]`:** the MCP is connected but doesn't match any known capability pattern. Surface it to the user for classification.

   For each unmapped namespace, gather the tool list for that namespace from `available_tools[]` (the tools whose name starts with `mcp__<ns>__`). Compose a prompt and ask via `AskUserQuestion`:

   > MCP `<ns>` is connected. Its tools:
   >   - <tool_a>
   >   - <tool_b>
   >   - <tool_c>
   >
   > Classify this MCP:
   >   - calendar — use the calendar question set
   >   - email — use the email question set
   >   - chat — use the chat question set
   >   - finance — use the finance question set
   >   - custom — define a new kind inline
   >   - skip — don't capture preferences for this MCP

   On a known classification (calendar / email / chat / finance):
   - Walk the matching `## Question set — <kind>` section below for this namespace.
   - Capture answers as `unknown_namespace_classifications[<ns>] = [{ kind: <known>, classification: "known-override", answers: <walked answers> }]`.
   - The user can supply MULTIPLE classifications for the same `<ns>` if it logically serves multiple kinds (e.g., classify Outlook UUID as `calendar` AND `email`) — re-prompt until the user picks `skip` or moves on.

   On `custom`:
   - Ask Q1: `What's a short name for this kind? (e.g., ado, newrelic, backstage)` — capture as `<custom-name>`.
   - Ask Q2: `Briefly describe what you care about from this MCP. (1-3 sentences)` — capture as `<what-matters-text>`.
   - Ask Q3: `Add another custom kind for this same MCP, or move on?` — options: `same-MCP-different-kind` (loop back to Q1 with a hint) | `move-on` (exit sub-flow for this namespace).
   - Append `unknown_namespace_classifications[<ns>] ||= []; unknown_namespace_classifications[<ns>].push({ kind: <custom-name>, classification: "custom", what_matters: <what-matters-text> });`.

   On `skip`: no entry — namespace stays in `unmapped_namespaces[]` for the audit-receipt only.

   When `dry_run_answers` is provided, replace this entire step with: take `dry_run_answers.unknown_namespace_classifications` (a `{ <ns>: [classification, ...] }` map) verbatim.

   After this loop, `detected[]` covers known-pattern matches; `unknown_namespace_classifications` covers user-classified namespaces (custom or known-override).

## Interview — per-MCP

8. **Order MCPs.** Sort `detected_mcp_kinds[]` by `existing_prefs.priorities` order (kinds appearing first in priorities go first); kinds not in priorities go last in alphabetical order. This gives the user a stable, intuitive walk order across runs.

9. **For each MCP-kind, decide action:**
   - **NEW (no existing block)**: action = "Walk".
   - **Existing block, MCP currently connected**: ask `AskUserQuestion`:
     > Update preferences for {{mcp_kind}}? (configured {{existing_prefs.mcps[mcp_kind].captured_at}})
     >   - Update — re-walk the question set with current answers as defaults
     >   - Skip — leave block unchanged
     >   - Clear — drop the block entirely
     Action = user's choice.
   - **Existing block, MCP NOT in detected_mcp_kinds**: action = "PreserveDisconnected". Don't ask. Set `connected: false` and `last_seen: {{existing_captured_at}}` on the block; leave answers untouched.

   When `dry_run_answers` is provided, replace this whole step with: action = `dry_run_answers.per_mcp_actions[mcp_kind] || "Walk"`.

10. **For each MCP-kind where action ∈ {Walk, Update}, walk the question set** described in the `## Question set — <mcp_kind>` section below. Each question is asked one at a time via `AskUserQuestion` (unless `dry_run_answers` is provided, in which case the answers come directly from `dry_run_answers.per_mcp_answers[mcp_kind]`). Capture answers into the per-MCP block.

11. **For each MCP-kind where action = "Clear"**, delete the block (it will be absent from the next file write).

12. **For each MCP-kind where action = "Skip" or "PreserveDisconnected"**, leave the existing block unchanged.

## Cross-cutting questions

13. **Priorities ranking.** Ask via `AskUserQuestion` (multiSelect = true; user reorders mentally and selects in order). Default order from `existing_prefs.priorities`. New MCPs added at the end. Question wording:
    > Rank these information sources by what you want to see first in your morning briefing. (Select in order: first = most important.)
    > Options = detected_mcp_kinds[] in their current default order.
    Capture as `priorities[]` in user-specified order.

    When `dry_run_answers` is provided: `priorities = dry_run_answers.priorities`.

14. **Personality — vibe.** AskUserQuestion (single-select):
    > Voice for your atomic-note narrative (Synopsis + Tip closes):
    >   - encouraging — uplifting; light enthusiasm
    >   - dry-and-factual — neutral; clinical
    >   - casual — conversational; warm
    >   - formal — structured; deferential
    Capture as `personality.vibe`. Default from existing if present.

15. **Personality — formality.** AskUserQuestion (single-select):
    > Formality level:
    >   - casual
    >   - formal
    Capture as `personality.formality`.

16. **Personality — pep_talk.** AskUserQuestion (single-select):
    > Pep-talk closes in `> [!tip]` callouts (yes = motivational; no = action-oriented):
    >   - yes
    >   - no
    Capture as `personality.pep_talk` (boolean).

17. **Personality — length.** AskUserQuestion (single-select):
    > Narrative length preference:
    >   - terse — 1-2 sentences max per section
    >   - balanced — 2-3 sentences
    >   - thorough — 3-5 sentences with context
    Capture as `personality.length`.

    When `dry_run_answers` is provided, steps 14-17 are replaced by `personality = dry_run_answers.personality`.

## Compose + Write

18. **Compose new preferences structure.** Build a frontmatter object:
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

19. **Write user-preferences.md.** Delegate to the helper at `platform/blueprints/cowork/helpers/context-builder-dry-run.js`:
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

20. **Emit audit-receipt.** Compose a 5-row markdown table summarizing the run:
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

21. Emit Obsidian Notice: `cowork:context-builder complete — preferences saved to spice/cowork/context/user-preferences.md`.

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

## Question set — email

### Q1 — surface_kinds (multi-select)

> What email patterns should the briefing surface?

- unanswered-24h — threads with no outgoing reply >24h
- action-required — explicit Q to you in last 24h
- vip-senders — emails from your inner-circle senders
- new-threads — newly-started threads (no prior context)
- attachment-only — emails primarily delivering files

Output field: `mcps.email.surface_kinds` (string[])

### Q2 — inbox_zero_threshold (single-select)

> What's your inbox-zero target? (Used to flag drift.)

- 0
- 5
- 10
- 25
- not-tracked

Output field: `mcps.email.inbox_zero_threshold` (string or int)

### Q3 — vip_senders (free-text)

> List up to 5 sender addresses or names that always count as VIP. (Comma-separated.)

Output field: `mcps.email.vip_senders` (string[])

### Q4 — ignore_lists (single-select)

> Skip newsletters and bulk-sender threads entirely?

- yes
- no — count them but don't elevate

Output field: `mcps.email.ignore_lists` (boolean)

## Question set — chat

### Q1 — inner_circle (free-text)

> List up to 8 contact names (names, handles, or IDs from whichever chat MCP you use — iMessage, Teams, Slack, etc.) that count as "inner circle". (Comma-separated. Used to elevate their threads.)

Output field: `mcps.chat.inner_circle` (string[])

### Q2 — surface_kinds (multi-select)

> Which message patterns should the briefing surface?

- reply-owed-24h — incoming message with no reply >24h from inner circle
- time-sensitive — messages mentioning today's date or this week
- group-only — messages where you were @-mentioned in a group chat or thread

Output field: `mcps.chat.surface_kinds` (string[])

### Q3 — quiet_hours_imessage (single-select)

> Suppress messages received during your quiet hours (late-night) from the briefing?

- yes — skip messages received 10pm-7am local
- no — count all messages

Output field: `mcps.chat.suppress_quiet_hours` (boolean)

## Question set — finance

### Q1 — cards_mine (free-text)

> List card IDs, last-4-digits, or account labels that count as "yours" (from whichever finance MCP you use — Brex, Mercury, etc.). (Comma-separated. Used to filter from a shared account view.)

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
