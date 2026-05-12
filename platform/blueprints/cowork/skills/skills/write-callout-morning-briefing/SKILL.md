---
name: cowork:write-callout-morning-briefing
description: Engagement-aware composition. Stitches normalized gather-skill markdown fragments into one deterministic multi-callout morning block. Internal branch on engagement.type selects the callout layout (personal vs w2-fte vs consulting). No MCP calls.
inputs:
  engagement: object
  render_aspects: object
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
outputs:
  markdown: string
tags: [cowork, write-callout, engagement-aware]
---

# cowork:write-callout-morning-briefing

Composition-only sub-skill. Inputs are pre-rendered markdown fragments from upstream gather skills. This skill stitches them into one deterministic multi-callout block whose shape is selected by `engagement.type` (and refined by `render_aspects`). No MCP calls. No data lookups. Output shape is identical across runs for a given engagement type, so the user always knows what to expect.

## Inputs

- `engagement` (object, required) — the engagement record from vault-config.md. Used for label substitution + type branching.
- `render_aspects` (object, required) — the engagement-type's render-aspects map (e.g. `{ finance_block: "include", invoice_prep: "skip", inner_circle_imessage: "include" }`).
- `date` (string, required) — absolute `YYYY-MM-DD`.
- `weekday` (string, required) — full English weekday.
- `weather`, `calendar`, `gmail`, `imessage`, `threads_digest`, `finance_block`, `tasks`, `people` — pre-rendered markdown fragments from upstream gather/write skills. Each fragment's lines already begin with `> ` (caller-side gather skills return that shape; this skill does not re-indent).

## Outputs

- `markdown` (string) — single concatenated multi-callout block; each top-level callout separated by exactly one blank line.

## Steps

1. Substitute `{{DATE}}`, `{{WEEKDAY}}`, `{{ENGAGEMENT_LABEL}}` (= `engagement.label`) into the template selected by `engagement.type`.
2. For each optional gather-fragment slot, if the input is empty/missing, substitute `> Nothing notable.` (brand-voice fallback).
3. Skip any callout whose corresponding `render_aspects` flag is `skip` (e.g. for w2-fte engagements `inner_circle_imessage == "skip"` → omit the Messages callout entirely; for consulting and w2-fte `weather` is typically absent → omit the Weather callout).
4. Type-branch on `engagement.type`:
   - **`personal`** → emit the personal shape (Briefing → Weather → Schedule → Finance? → Inbox → Messages → Threads → Tasks → People → Action items).
   - **`w2-fte`** → emit the w2-fte shape (Briefing → Schedule → Inbox → Projects → Threads → Action items). No Finance, no Messages, no Weather.
   - **`consulting`** → emit the consulting shape (Briefing → Schedule → Inbox → Projects → Threads → Invoice → Action items). Invoice line consumed from `finance_block` if present; pure invoice posture handled by `write-summary-invoice-prep` upstream of weekly/monthly review, not this callout.
5. If `engagement.type` is none of those, hard-fail with Notice `cowork:write-callout-morning-briefing — unknown engagement.type '<type>'`.
6. Concatenate the assembled callouts with a single blank line between each. Return `{ markdown }`.

## Returns

### personal shape

```markdown
> [!abstract]+ {{DATE}} morning briefing — {{ENGAGEMENT_LABEL}} ({{WEEKDAY}})
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
{{TASKS}}

> [!example]+ People in flight
{{PEOPLE}}

> [!todo]+ {{DATE}}: Action items — {{ENGAGEMENT_LABEL}}
> - [ ] Triage Action-Required emails listed above
> - [ ] Reply to any unanswered inner-circle messages
> - [ ] Course-correct on any locked-card charge from Finance section
```

### w2-fte shape

```markdown
> [!abstract]+ {{DATE}} morning briefing — {{ENGAGEMENT_LABEL}} ({{WEEKDAY}})

> [!example]+ Schedule
{{CALENDAR}}

> [!info]+ Inbox ({{ENGAGEMENT_LABEL}})
{{GMAIL}}

> [!example]+ Projects
{{TASKS}}

> [!warning]+ Open threads
{{THREADS_DIGEST}}

> [!todo]+ {{DATE}}: Action items — {{ENGAGEMENT_LABEL}}
> - [ ] Unblock any project card flagged in Projects above
> - [ ] Address oldest open thread first
> - [ ] Triage Action-Required emails
```

### consulting shape

```markdown
> [!abstract]+ {{DATE}} morning briefing — {{ENGAGEMENT_LABEL}} ({{WEEKDAY}})

> [!example]+ Schedule
{{CALENDAR}}

> [!info]+ Inbox ({{ENGAGEMENT_LABEL}})
{{GMAIL}}

> [!example]+ Projects
{{TASKS}}

> [!warning]+ Open threads
{{THREADS_DIGEST}}

{{FINANCE_BLOCK}}

> [!todo]+ {{DATE}}: Action items — {{ENGAGEMENT_LABEL}}
> - [ ] Unblock any project card flagged in Projects above
> - [ ] Address oldest open thread first
> - [ ] Confirm hours logged for invoice cadence
```

## Errors

- All inputs missing: still emit the abstract header + a single `> [!warning]+ Gather degraded` callout listing which inputs were empty. Never omit the entire block.
- Malformed input (does not start with `> `): wrap inside `> [!warning]+ Gather degraded — <slot>` with the raw payload below it. Do not silently drop content.
- `engagement` or `render_aspects` missing: hard-fail. Composition is type-dependent.
- `engagement.type` unknown: hard-fail with the Notice above (no fallback shape).
