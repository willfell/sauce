---
name: cowork:write-run-note-weekly-review
description: Write the weekly-review run as an atomic note to spice/cowork/weekly/YYYY/YYYY-Www/weekly-review.md with canonical frontmatter (type cowork-weekly-review). Overwrites prior same-week run. One vault write; no gathers.
inputs:
  engagement: object
  week: string
  week_label: string
  year: string
  body: string
  body_assertions: array
  prompt_source: string
  warning: string | null
outputs:
  path: string
  status: string
tags: [cowork, write-run-note, atomic-note, engagement-aware]
---

# cowork:write-run-note-weekly-review

Atomic-note writer for the weekly-review run. Composes canonical frontmatter, stitches it with the pre-rendered `body` markdown, and writes a single vault file. Idempotent: deterministic path per `(engagement, week)`; re-runs overwrite. No data lookups. The orchestrator owns gather + render; this skill only writes.

## Inputs

- `engagement` (object, required): engagement record from `vault-config.md`. Uses `engagement.id` only.
- `week` (string, required): `YYYY-Www` (e.g. `2026-W20`) from `cowork:date-context`.
- `year` (string, required): 4-digit year (e.g. `2026`). Used only for path composition.
- `body` (string, required): pre-rendered Markdown body. May be empty when `warning == "empty_prompt"`.
- `body_assertions` (string[], required): List of canonical substrings the composed body MUST contain; computed by `cowork:compose-body` and passed through by the orchestrator. The body-shape write-guard verifies each one is present in body.
- `prompt_source` (string, required): vault-relative path to the prompt body that was read upstream (typically `spice/cowork/prompts/weekly-review.md`).
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Construct `mdPath` from `{ engagement, week, year }` per the v0.65.0 atomic-note write contract:
   `spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md`
2. Construct `sidecarPath` = `mdPath` with `.md` replaced by `.cowork.json`.
3. Construct full markdown via existing frontmatter + body assembly (frontmatter from input.frontmatter merged with cadence-canonical fields; body from `input.body`).
4. v0.91.x–v0.92.0 path + frontmatter + dvjs body-shape write-guards stay as belt-and-suspenders — apply them BEFORE the writeAtomicNote call. Abort with `failed:contract-violation:wrong-frontmatter:<field>` etc. on any miss.
5. Invoke `writeAtomicNote({ mdPath, sidecarPath, body_md, sidecar_json: input.sidecar_json, schemaPath: <vault>/.claude/skills/cowork/data/schemas/weekly-review@1.0.0.json })` from `write-atomic-note-helper.js`.
6. Return the helper's status verbatim. The helper's JSON-schema validation against the sidecar IS the authoritative new contract check (v0.96.0); the v0.91.x–v0.92.0 prose write-guards remain as belt-and-suspenders for path/frontmatter/dvjs body-shape.

## Returns

`{ path: "<vault-relative path>", status: "written" | "failed:<reason>" }`.

## Title composition

Before composing the body, set frontmatter `title` to: `Weekly Review — Week <##>, <Month> <D>–<D2>, <year>` where the week range is the Mon-Sun span, `<##>` is the ISO week number (no leading zero for single-digit weeks), and `<year>` is the 4-digit year. For this skill the display-name literal is **`Weekly Review`**. Use the `week_label` input (passed by the orchestrator per v0.71.0 conventions) to anchor the week range. Example for week 2026-W21 (Mon May 18 – Sun May 24): `"Weekly Review — Week 21, May 18–24, 2026"`.

## Adaptive body skeleton

Body shape is canonically produced by `cowork:compose-body`. See that skill + its golden fixtures (`platform/blueprints/cowork/helpers/fixtures/compose-body/`) for the authoritative shape. The body-shape write-guard (`## Pre-write self-check` v0.92.0 sub-section) enforces it at write time.

## Pre-write self-check

### v0.91.1 write-guard: canonical output path enforcement (FIRST CHECK)

Before any other pre-write check, validate the computed write path against the canonical shape:

`spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md`

REJECT and return `{ path, status: "failed:contract-violation:wrong-output-path" }` if the computed `path` argument:

1. Starts with `spice/daily/` — that's the daily-blueprint surface (hand-edited daily notes), NOT this sub-skill's output.
2. Doesn't contain the canonical prefix `spice/cowork/weekly/`.

Even if the orchestrator passes a wrong `path` argument, this guard catches it. This is the v0.91.1 deterministic backstop for v0.90.2's `[!warning]+ CRITICAL` orchestrator callout, which is prose-only and LLM-attention-bounded.

### v0.91.2 frontmatter write-guard: canonical frontmatter enforcement (SECOND CHECK)

After the path check passes, validate the composed frontmatter BEFORE the Write tool fires. The canonical frontmatter shape is:

```yaml
type: cowork-weekly-review          # MUST be this EXACT string
engagement_id: <engagement_id>
week: "<YYYY-Www>"                   # e.g. 2026-W23
generator: cowork:weekly-review@1.0.0
prompt_source: <path>
title: <composed title>
summary: <1-2 sentence headline>
created_at: <ISO timestamp>
warnings: [<list>]                   # OPTIONAL
```

REJECT and return `{ path, status: "failed:contract-violation:wrong-frontmatter:<field>" }` if:

1. `type:` is missing OR != the EXACT string `cowork-weekly-review`.
2. Any of `engagement_id`, `week`, `generator`, `prompt_source`, `title`, `summary` is missing/empty.
3. Frontmatter contains non-canonical fields like `cadence:`, `date:`, `generated_at:`.
4. `week:` not in ISO `YYYY-Www` format (e.g. 2026-W23).

v0.91.2 deterministic backstop for Step 17 post-write verify.

### Original pre-write checklist

BEFORE calling the Write tool, verify your composed output against this checklist. If any item fails, return `{ path, status: "failed:contract-violation:<field>" }` and do NOT write.

**Frontmatter checks:**
- [ ] `type:` matches the canonical value for this skill (`cowork-weekly-review`)
- [ ] `title:` is present and non-empty (the formula-composed title from above)
- [ ] `summary:` is present and non-empty (1-2 sentences, ~150-250 chars)
- [ ] `engagement_id:`, `week:`, `generator:`, `prompt_source:` present

### v0.92.0 body-shape write-guard: canonical callout markers (FOURTH CHECK)

After the path / frontmatter / dvjs checks pass, validate the composed `body` against the canonical assertion list passed in via `body_assertions`.

REJECT and return `{ path, status: "failed:contract-violation:body-shape:<reason>" }` if:

1. `body_assertions` input is missing, null, or not an array → `body-shape:no-assertions-input` (indicates the orchestrator skipped `cowork:compose-body`).
2. `body_assertions` is an empty array → `body-shape:empty-assertions` (composeBody emitted no markers — defensive reject).
3. For each `assertion` in `body_assertions`: if `body.includes(assertion)` is false → `body-shape:missing-assertion:<index>:<first-40-chars-of-assertion>`.

The orchestrator surfaces this as a Notice + exit non-zero per the existing v0.91.x pattern.

**Body checks (regex-scan the composed body string):**
- [ ] First non-frontmatter line opens a dataviewjs fence containing the v0.91.3 CANONICAL SpaceNavButtons invocation EXACTLY: opening ` ```dataviewjs` + body line `await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });` + closing ` ``` `. REJECT any other shape — in particular REJECT `const { SpaceNavButtons } = customJS; SpaceNavButtons(dv, {...})` (produces runtime TypeError; only the customjs-guard view pattern handles the load + fallback correctly).
- [ ] At least one `> [!info]-` admonition present
- [ ] At least one `> [!example]+` admonition present
- [ ] Closing `> [!tip]` admonition present (last admonition in the body)
- [ ] For each entry in `warnings[]` (passed via frontmatter), a matching `> [!warning]` admonition is present in the body

On any failure, the returned `status` field names which check failed using a stable identifier:
- `failed:contract-violation:frontmatter-missing-title`
- `failed:contract-violation:frontmatter-missing-summary`
- `failed:contract-violation:body-missing-navbuttons`
- `failed:contract-violation:body-missing-info-admonition`
- `failed:contract-violation:body-missing-example-admonition`
- `failed:contract-violation:body-missing-tip-admonition`
- `failed:contract-violation:body-missing-warning-admonition-for-<key>`
- `failed:contract-violation:body-shape:no-assertions-input`
- `failed:contract-violation:body-shape:empty-assertions`
- `failed:contract-violation:body-shape:missing-assertion:<index>:<truncated-substring>`

The orchestrator surfaces this in a Notice and skips downstream state-update steps.
