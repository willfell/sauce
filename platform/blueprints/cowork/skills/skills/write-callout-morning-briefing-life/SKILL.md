---
name: cowork:write-callout-morning-briefing-life
description: Compose the life-vault morning briefing as a multi-callout markdown block ready for paste at COWORK_CALLOUTS anchor.
inputs:
  date: string
  weekday: string
  weather: string
  calendar: string
  gmail: string
  imessage: string
  threads_digest: string
  finance_block: string
  tasks: string
  people: string
  patterns: string
outputs:
  markdown: string
tags: [cowork, write-callout]
---

# cowork:write-callout-morning-briefing-life

Composition-only sub-skill. Inputs are already-normalized markdown fragments produced by upstream gather skills. This skill stitches them into one deterministic multi-callout block. No MCP calls. No data lookups. Output shape is identical across runs so the user always knows what to expect.

## Inputs

- `date` (string, required) - absolute `YYYY-MM-DD`. Substituted verbatim into callout titles.
- `weekday` (string, required) - full English weekday like `Wednesday`. Substituted verbatim.
- `weather` (string, optional) - markdown fragment from `cowork:gather-weather`. Inner content of the Weather sub-callout.
- `calendar` (string, optional) - markdown fragment from `cowork:gather-calendar`. Schedule rows + coming-up tail.
- `gmail` (string, optional) - markdown fragment from `cowork:gather-gmail`. Action-Required + FYI tables.
- `imessage` (string, optional) - markdown fragment from `cowork:gather-imessage`. Inner-circle table + unanswered count.
- `threads_digest` (string, optional) - markdown fragment from `cowork:gather-threads`. Open-threads table.
- `finance_block` (string, optional) - full multi-line markdown returned by `cowork:write-callout-finance`. Embedded as-is between Calendar and Inbox.
- `tasks` (string, optional) - pre-rendered Tasks sub-section markdown ready to embed (each line begins with `> ` so it slots inside a callout). Sourced from `cowork:gather-projects` in-progress + todo + blocked. Empty fragment is acceptable.
- `people` (string, optional) - pre-rendered People-nudges sub-section markdown ready to embed (each line begins with `> `). Sourced from `cowork:gather-projects.people_nudges`.
- `patterns` (string, optional) - pre-rendered Patterns sub-section markdown ready to embed (each line begins with `> `). Derived from finance + cc-debt + threads signals.

## Outputs

- `markdown` (string) - single concatenated multi-callout block. Each top-level callout separated by exactly one blank line.

## Steps

1. Substitute `{{DATE}}` → `date` and `{{WEEKDAY}}` → `weekday` in the literal template under `## Returns`.
2. For each optional gather-fragment slot (`{{WEATHER}}`, `{{CALENDAR}}`, `{{GMAIL}}`, `{{IMESSAGE}}`, `{{THREADS_DIGEST}}`), if the corresponding input is empty / missing, replace the slot with the literal string `> Nothing notable.` (brand-voice rule).
3. Substitute `{{TASKS_BLOCK}}` → `tasks`, `{{PEOPLE_BLOCK}}` → `people`, `{{PATTERNS_BLOCK}}` → `patterns`. For any of these three that is empty / missing, substitute `> Nothing notable.` (same brand-voice fallback).
4. If `finance_block` is empty, omit the Finance section entirely (do not render an empty wrapper).
5. Concatenate the assembled callouts with a single blank line between each.
6. Return `{ markdown: <assembled string> }`. No frontmatter, no trailing whitespace.

## Returns

Literal output shape (deterministic order, no emoji, no em dashes, absolute dates only):

```markdown
> [!abstract]+ {{DATE}} morning briefing - {{WEEKDAY}}
> Direct read of the day. Lead with what needs attention.
>
> - One-sentence shape of the day, derived from highest-priority gather signal.

> [!info]+ Weather
{{WEATHER}}

> [!example]+ Schedule
{{CALENDAR}}

{{FINANCE_BLOCK}}

> [!info]+ Inbox digest
{{GMAIL}}

> [!example]+ Messages digest
{{IMESSAGE}}

> [!warning]+ Open threads
{{THREADS_DIGEST}}

> [!todo]+ Tasks for {{DATE}}
{{TASKS_BLOCK}}

> [!example]+ People in flight
{{PEOPLE_BLOCK}}

> [!info]- Patterns
{{PATTERNS_BLOCK}}

> [!todo]+ {{DATE}}: Action items
> - [ ] Triage Action-Required emails listed above
> - [ ] Reply to any unanswered inner-circle messages
> - [ ] Course-correct on any locked-card charge from Finance section
```

Each `{{...}}` slot is the corresponding input's full markdown content, indented so every line begins with `> ` (caller-side gather skills already return that shape; this skill does not re-indent).

## Errors

- All inputs missing: still emit the abstract header + a single Action-items callout reading `> - [ ] No data sources reported. Investigate gather-skill failures.` Never omit the entire block - the orchestrator depends on at least one callout being present at the anchor.
- Malformed input (does not start with `> `): wrap the offending fragment inside `> [!warning]+ Gather degraded` with the raw payload below it. Do not silently drop content.
- `tasks` / `people` / `patterns` empty or missing: render the corresponding callout body as `> Nothing notable.` (consistent with the brand-voice fallback used for other gather fragments). Do NOT omit the wrapper; the user expects all three sub-callouts to appear in every morning briefing for visual rhythm.
- Date or weekday missing: hard-fail. Composition is meaningless without a stable header.
