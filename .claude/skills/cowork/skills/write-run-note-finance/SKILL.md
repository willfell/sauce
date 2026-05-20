---
name: cowork:write-run-note-finance
description: Write a finance-snapshot run as an atomic note to spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/finance.md with canonical frontmatter (type cowork-finance-snapshot). Reference template for the consumer-extension pattern (sprint-sync, custom snapshots) — copy this sub-skill, swap the type value, and adapt the body.
inputs:
  engagement: object
  date: string
  weekday: string
  month_name: string
  body: string
  prompt_source: string | null
  warning: string | null
outputs:
  path: string
  status: string
tags: [cowork, write-run-note, atomic-note, engagement-aware]
---

# cowork:write-run-note-finance

Atomic-note writer for the finance run. Composes canonical frontmatter, stitches it with the pre-rendered `body` markdown, and writes a single vault file. Idempotent: deterministic path per `(engagement, date)`; re-runs overwrite. No data lookups. The orchestrator owns gather + render; this skill only writes.

**Reference status:** this skill is the documented copy-paste template for consumer-defined atomic-note writers. See `Docs/cowork-consumer-extensions.md` for the worked sprint-sync example. The shape of frontmatter + path composition + write step is the canonical pattern; the value to vary per consumer is the `type:` literal + path slug.

## Inputs

- `engagement` (object, required): engagement record from `vault-config.md`. Uses `engagement.id` only.
- `date` (string, required): `YYYY-MM-DD` from `cowork:date-context` (never local clock).
- `weekday` (string, required): full English weekday (e.g. `Tuesday`). Used only for path composition.
- `month_name` (string, required): full English month name (e.g. `May`). Used only for path composition.
- `body` (string, required): pre-rendered Markdown body. May be empty when `warning == "empty_prompt"`.
- `prompt_source` (string, optional): vault-relative path to the prompt body if any. Finance snapshots are typically gather-driven (no prompt body); pass null when omitted.
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Compose the path: `spice/cowork/daily/<YYYY>/<MM>-<MonthName>/<YYYY-MM-DD>/finance.md`, where `<YYYY>` and `<MM>` come from `date` and `<MonthName>` from `month_name`. Example for 2026-05-19 (Tuesday): `spice/cowork/daily/2026/05-May/2026-05-19/finance.md`.
2. Compose `created_at` as the current ISO-8601 timestamp with offset (e.g. `2026-05-19T07:05:14-06:00`). Use the local TZ resolved by `cowork:date-context`.
3. Compose frontmatter as YAML:
   ```yaml
   ---
   type: cowork-finance-snapshot
   created_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   day: "<date>"
   generator: "cowork:morning-briefing@1.0.0"
   prompt_source: "<prompt_source>"
   ```
   (only emit `prompt_source` when non-null). If `warning` is set, append `warning: "<warning>"` as the last frontmatter key. Close with `---`.
4. Compose the file contents: frontmatter block + one blank line + `body`. When `body` is empty AND `warning == "empty_prompt"`, use the literal body:
   ```
   (Prompt body empty — edit `<prompt_source>` to customize what this run emits.)
   ```
5. Write to the composed path via `mcp__obsidian__create_note` (or backend-equivalent `obsidian_put_content` with overwrite). On success return `{ path, status: "written" }`. On write error return `{ path, status: "failed:<reason>" }` where `<reason>` is normalized (`auth`, `timeout`, `path-collision`, `unknown`).

## Returns

`{ path: "<vault-relative path>", status: "written" | "failed:<reason>" }`.
