---
name: cowork:write-run-note-monthly-review
description: Write the monthly-review run as an atomic note to spice/cowork/monthly/YYYY/YYYY-MM/monthly-review.md with canonical frontmatter (type cowork-monthly-review). Overwrites prior same-month run. One vault write; no gathers.
inputs:
  engagement: object
  month: string
  year: string
  body: string
  prompt_source: string
  warning: string | null
outputs:
  path: string
  status: string
tags: [cowork, write-run-note, atomic-note, engagement-aware]
---

# cowork:write-run-note-monthly-review

Atomic-note writer for the monthly-review run. Composes canonical frontmatter, stitches it with the pre-rendered `body` markdown, and writes a single vault file. Idempotent: deterministic path per `(engagement, month)`; re-runs overwrite. No data lookups. The orchestrator owns gather + render; this skill only writes.

## Inputs

- `engagement` (object, required): engagement record from `vault-config.md`. Uses `engagement.id` only.
- `month` (string, required): `YYYY-MM` (e.g. `2026-05`) from `cowork:date-context`.
- `year` (string, required): 4-digit year (e.g. `2026`). Used only for path composition.
- `body` (string, required): pre-rendered Markdown body. May be empty when `warning == "empty_prompt"`.
- `prompt_source` (string, required): vault-relative path to the prompt body that was read upstream (typically `spice/cowork/prompts/monthly-review.md`).
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Compose the path: `spice/cowork/monthly/<year>/<month>/monthly-review.md`. Example for `2026-05`: `spice/cowork/monthly/2026/2026-05/monthly-review.md`.
2. Compose `created_at` as the current ISO-8601 timestamp with offset (e.g. `2026-05-19T07:05:14-06:00`). Use the local TZ resolved by `cowork:date-context`.
3. Compose frontmatter as YAML:
   ```yaml
   ---
   type: cowork-monthly-review
   created_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   month: "<month>"
   generator: "cowork:monthly-review@1.0.0"
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
