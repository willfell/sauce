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
