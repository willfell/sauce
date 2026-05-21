---
name: cowork:write-run-note-eod-review
description: Write today's eod-review run as an atomic note to spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md with canonical frontmatter (type cowork-eod-review). Overwrites prior same-day run. One vault write; no gathers.
inputs:
  engagement: object
  date: string
  weekday: string
  month_name: string
  body: string
  prompt_source: string
  warning: string | null
outputs:
  path: string
  status: string
tags: [cowork, write-run-note, atomic-note, engagement-aware]
---

# cowork:write-run-note-eod-review

Atomic-note writer for the eod-review run. Composes canonical frontmatter, stitches it with the pre-rendered `body` markdown, and writes a single vault file. Idempotent: deterministic path per `(engagement, date)`; re-runs overwrite. No data lookups. The orchestrator owns gather + render; this skill only writes.

## Inputs

- `engagement` (object, required): engagement record from `vault-config.md`. Uses `engagement.id` only.
- `date` (string, required): `YYYY-MM-DD` from `cowork:date-context` (never local clock).
- `weekday` (string, required): full English weekday (e.g. `Tuesday`). Used only for path composition.
- `month_name` (string, required): full English month name (e.g. `May`). Used only for path composition.
- `body` (string, required): pre-rendered Markdown body. May be empty when `warning == "empty_prompt"`.
- `prompt_source` (string, required): vault-relative path to the prompt body that was read upstream (typically `spice/cowork/prompts/eod-review.md`).
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Compose the path: `spice/cowork/daily/<YYYY>/<MM>-<MonthName>/<YYYY-MM-DD>/eod-review.md`, where `<YYYY>` and `<MM>` come from `date` and `<MonthName>` from `month_name`. Example for 2026-05-19 (Tuesday): `spice/cowork/daily/2026/05-May/2026-05-19/eod-review.md`.
2. Compose `created_at` as the current ISO-8601 timestamp with offset (e.g. `2026-05-19T07:05:14-06:00`). Use the local TZ resolved by `cowork:date-context`.
3. Compose frontmatter as YAML:
   ```yaml
   ---
   type: cowork-eod-review
   created_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   day: "<date>"
   generator: "cowork:eod-review@1.0.0"
   prompt_source: "<prompt_source>"
   ```
   If `warning` is set, append `warning: "<warning>"` as the last frontmatter key. Close with `---`.
4. Compose the file contents: frontmatter block + one blank line + `body`. When `body` is empty AND `warning == "empty_prompt"`, use the literal body:
   ```
   (Prompt body empty — edit `<prompt_source>` to customize what this run emits.)
   ```
5. Write to the composed path via `mcp__obsidian__create_note` (or backend-equivalent `obsidian_put_content` with overwrite). On success return `{ path, status: "written" }`. On write error return `{ path, status: "failed:<reason>" }` where `<reason>` is normalized (`auth`, `timeout`, `path-collision`, `unknown`).

## Returns

`{ path: "<vault-relative path>", status: "written" | "failed:<reason>" }`.

## Body shape

After frontmatter close, emit these elements in this order. Every cowork atomic note follows the same shape.

### 1. SpaceNavButtons block (always first)

Immediately after the closing `---` of the frontmatter, before any heading:

````
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```
````

### 2. Top-of-body synopsis admonition

A collapsible info admonition with the one-paragraph synopsis of today's headline:

```
> [!info]- Today at a glance
> <one paragraph distilled from gather outputs>
```

### 3. Per-section blocks

Each section that has data renders as a collapsible example admonition wrapping a markdown table OR a short bullet list:

```
> [!example]+ <emoji> <Section title>
> <table or bullets>
```

Table column headers — use these literally so renderers and downstream readers stay consistent:

- **Calendar:**       `| Time | Event | Attendees | Link |`
- **Email triage:**   `| Subject | Sender | Intent |`
- **Project status:** `| Project | Status | Next action |`
- **Open threads:**   bulleted list (no table — items are heterogeneous)
- **Finance accounts:**     `| Account | Balance | Δ this week |`
- **Finance transactions:** `| Date | Merchant | Amount | Category |`

Skip a section entirely when its gather output is empty. If a section's data exists but is too small for a table (e.g., 1–2 calendar events), use bullets inside the admonition.

### 4. Warnings (only when any gather emitted gather-skipped)

When a gather skill emitted `gather-skipped: <reason>` (because no MCP was available, or it self-determined no data was reachable), emit a warning admonition at the position the affected section would have rendered:

```
> [!warning] <Section name> unavailable
> <one-line reason from the gather output>
```

Also append the reason to the atomic note's `warnings:` frontmatter array (e.g., `warnings: [calendar_unavailable]`).

### 5. Closing focus admonition

A tip admonition with the closing 2–3 sentence focus paragraph + a concrete first-action recommendation:

```
> [!tip] <emoji> Today's focus
> <closing paragraph + first-action recommendation>
```

### 6. summary: frontmatter emission

After the body is fully composed, write a 1–2 sentence summary (~150–250 characters) into the frontmatter `summary:` field. The summary is the curated TL;DR surfaced by CoworkLatestRuns and the daily/cowork-hub Activity panels.

**Per-cadence lead-in (EOD review):** Lead with the day's main win or miss + carryover into tomorrow. Example: "Punched through 9/10 production approvals on mcp-mesh; pipeline.engine queue carries forward to tomorrow. Karen handover slot is now confirmed for Wednesday."
