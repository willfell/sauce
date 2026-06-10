---
schema_version: "1.0.0"
purpose: |
  Cross-cadence reusable clause blocks referenced from per-cadence orchestrator-instructions
  files via {{shared.<key>}}. compose-scheduled-job-wrappers-helper.js substitutes these blocks
  into the wrapper template at sync time.
---

# Shared clauses for cowork orchestrator-instructions

## dataviewjs_block

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

## connectivity_authority_clause

CONNECTIVITY (NON-NEGOTIABLE): trust user-preferences.mcps served_by + connected as runtime authority; vault-config.mcp_map is bootstrap-time audit hint only. Load deferred MCP tools via ToolSearch BEFORE dispatch. Cross-reference resolved served_by names against reachable_namespaces[] before dispatching. NEVER emit "MCP unavailable" callouts when prefs + reachable show the served_by is connected.

## microscope_clause

MICROSCOPES (NON-NEGOTIABLE): for each kind in priorities, READ spice/cowork/prompts/per-mcp/<kind>/microscope.md and follow its ## Output shape directives verbatim. Resolve display names via people-aliases.md. Emit **[[Person Basename]]** for every inner-circle hit.

## voice_clause

VOICE (NON-NEGOTIABLE): apply spice/cowork/context/user-preferences.md personality.notes (or personality.vibe_notes) verbatim AND personality.{vibe, formality, length, pep_talk}. {{$voice_summary}}

## frontmatter_base

```yaml
---
type: {{$frontmatter_type}}
engagement_id: {{$engagement_id}}
day: "{{$today_date}}"
generator: cowork:{{$cadence}}@2.0.0
prompt_source: spice/cowork/prompts/{{$cadence}}.md
title: {{$title_template}}
summary: <1-2 sentence headline distilled from the body>
created_at: <NOW in {{$timezone}} as ISO timestamp>
---
```

## rating_callout_template

```
> [!todo]+ Was today useful?
> Tick the kinds that surfaced something you cared about. (One tick per kind per day; learned weights live in `spice/cowork/context/user-preferences.md`.)
{{$rating_kind_lines}}
> <!-- cowork:rating-block schema=1.0.0 cadence={{$cadence}} day={{$today_date}} -->
```

(Where `{{$rating_kind_lines}}` is computed at compose time per surfaced kind: e.g. `> - [ ] Calendar\n> - [ ] Email\n...`. If a prior file exists for this day, parse its existing cowork:rating-block sentinel and preserve `[x]` state per kind.)

## detection_callout_template

```
> [!info]+ Cowork detected a new MCP
> The following connected MCPs are not yet in your `user-preferences.mcps`. Edit `spice/cowork/context/user-preferences.md` to confirm and customize, or run `/cowork context-builder` to re-interview.
{{$pending_confirmation_lines}}
```

## anti_echo_callout_template

```
> [!question] Outside yesterday's frame
> {{One thing today's gather surfaced that yesterday's carry-forward did NOT name. If nothing qualifies, say so explicitly: "today's gather largely continued yesterday's threads."}}
```

## anti_delegation_clause

ANTI-DELEGATION (NON-NEGOTIABLE): You are running this entire orchestrator INLINE in the current context. DO NOT spawn subagents. DO NOT use Task(), Agent(), or any agent-launching tool. DO NOT summarize the work and hand it off. Every step below — including the per-kind gather loops — executes in THIS turn. If the wrapper feels long, that is intentional; follow it step-by-step rather than delegating. A delegated run produces structurally-wrong output (wrong path, wrong frontmatter type, missing callout structure, missing sidecar, missing rating block) and is treated as a failed fire.

## prelude_block

PRELUDE — fire-time setup (CRITICAL: do these first)

1. Resolve today's date in {{$timezone}}. Use the Bash tool (or equivalent in your environment) to get the actual current date — do NOT use any example value. Compute and capture:

     today_date           = YYYY-MM-DD  (run: date '+%Y-%m-%d')
     today_weekday        = long weekday name in {{$timezone}}  (run: TZ='{{$timezone}}' date '+%A')
     today_month_name     = long month name in {{$timezone}}  (run: TZ='{{$timezone}}' date '+%B')
     today_day            = day-of-month integer, no leading zero  (run: TZ='{{$timezone}}' date '+%-d')
     today_year           = 4-digit year  (run: TZ='{{$timezone}}' date '+%Y')
     today_dirpath        = "<today_year>/<MM>-<today_month_name>/<today_date>" where MM is zero-padded month  (e.g. "2026/06-June/2026-06-10")
     today_ymd_compact    = YYYYMMDD with no separators

   These are the values to substitute everywhere {{$today_*}} appears in the steps below. If you cannot run Bash in your environment, use any other tool that returns the actual current wall-clock date in {{$timezone}} — but DO NOT fabricate or guess. A wrong weekday/date means the atomic note goes to the wrong path and the daily dashboard cannot see it.

2. Read frontmatter from spice/cowork/context/vault-config.md via Obsidian MCP. Locate engagement record where id == "{{$engagement_id}}". Capture engagement.

3. Read spice/cowork/context/user-preferences.md frontmatter. Capture personality + priorities + mcps + learned_weights.

4. Read spice/cowork/context/{{$engagement_id}}/people-aliases.md (if exists) for inner-circle display-name resolution.

## done_block

DONE

N. Emit Obsidian Notice `cowork:{{$cadence}} complete -- {{$engagement_label}} {{$today_date}}`.

---

Generated against sauce {{$workshop_version}} + cowork {{$cowork_version}} + contract {{$contract_version}}.

## sidecar_schema_template

```json
{
  "schema_version": "1.0.0",
  "generated_by": "cowork:{{$cadence}}@2.0.0",
  "generated_at": "<NOW ISO timestamp in {{$timezone}}>",
  "cadence": "{{$cadence}}",
  "engagement_id": "{{$engagement_id}}",
  "frontmatter": { /* mirror of .md frontmatter exactly */ },
  "surfaced_kinds": [/* every kind that emitted a callout this fire */],
  "surfaced_items": [
    {
      "item_id": "<kind>-{{$engagement_id}}-<sha256(stable_key).slice(0,16)>",
      "kind": "<kind>",
      "callout_type": "example|warning|info|tip|todo|question|quote",
      "title": "<item's title>",
      "features": { /* per-kind feature bag from gather output */ }
    }
  ],
  "render_aspects_applied": [/* "<key>:<value>" pairs */],
  "memory_used": {
    "yesterday_present": <bool>,
    "drift_warning_present": <bool>,
    "echoes_count": <int>
  },
  "plan_dispatch": {
    "mode": "prefs",
    "kinds_dispatched": <int>,
    "warnings_emitted": <int>,
    "classifier_cache_hit": <bool>,
    "pending_confirmations_count": <int>
  }
}
```
