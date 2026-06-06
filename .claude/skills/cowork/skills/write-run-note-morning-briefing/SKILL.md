---
name: cowork:write-run-note-morning-briefing
description: Write today's morning-briefing run as an atomic note to spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/morning-briefing.md with canonical frontmatter (type cowork-morning-briefing). Overwrites prior same-day run. One vault write; no gathers.
inputs:
  engagement: object
  date: string
  weekday: string
  month_name: string
  body: string
  body_assertions: array
  prompt_source: string
  warning: string | null
outputs:
  path: string
  status: string
tags: [cowork, write-run-note, atomic-note, engagement-aware]
---

# cowork:write-run-note-morning-briefing

Atomic-note writer for the morning-briefing run. Composes canonical frontmatter, stitches it with the pre-rendered `body` markdown, and writes a single vault file. Idempotent: deterministic path per `(engagement, date)`; re-runs overwrite. No data lookups. The orchestrator owns gather + render; this skill only writes.

## Inputs

- `engagement` (object, required): engagement record from `vault-config.md`. Uses `engagement.id` only.
- `date` (string, required): `YYYY-MM-DD` from `cowork:date-context` (never local clock).
- `weekday` (string, required): full English weekday (e.g. `Tuesday`). Used only for path composition.
- `month_name` (string, required): full English month name (e.g. `May`). Used only for path composition.
- `body` (string, required): pre-rendered Markdown body. May be empty when `warning == "empty_prompt"`.
- `body_assertions` (string[], required): List of canonical substrings the composed body MUST contain; computed by `cowork:compose-body` and passed through by the orchestrator. The body-shape write-guard verifies each one is present in body.
- `prompt_source` (string, required): vault-relative path to the prompt body that was read upstream (typically `spice/cowork/prompts/morning-briefing.md`).
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Compose the path: `spice/cowork/daily/<YYYY>/<MM>-<MonthName>/<YYYY-MM-DD>/morning-briefing.md`, where `<YYYY>` and `<MM>` come from `date` and `<MonthName>` from `month_name`. Example for 2026-05-19 (Tuesday): `spice/cowork/daily/2026/05-May/2026-05-19/morning-briefing.md`.
2. Compose `created_at` as the current ISO-8601 timestamp with offset (e.g. `2026-05-19T07:05:14-06:00`). Use the local TZ resolved by `cowork:date-context`.
2a. **Inner-circle filter (computed upstream).** The morning-briefing orchestrator's Step 3e pre-resolves `engagement.inner_circle_people` via `cowork:resolve-person` + `composeInnerCircleAllowlist` (which unions each resolved entry's `aliases_by_type.phone` into the deterministic phone-filter list) and passes the resulting E.164 phone-list to `gather-imessage` via its `inner_circle` parameter (v0.89.1). NO resolution loop happens here. NO second `gather-imessage` call is made here. The `inner_circle_phones[]` list referenced by other steps is the same one passed into `gather-imessage` upstream. Unresolved-name handling (Notice emission + `inner_circle_unresolved:<name>` appended to the atomic note's `warnings:` array, v0.85.0 plumbing) is performed by the orchestrator's Step 3e, not here. If this skill is invoked outside the morning-briefing orchestrator (e.g., direct invocation), upstream pre-resolution must be performed by the caller before this skill runs.
3. Compose frontmatter as YAML:
   ```yaml
   ---
   type: cowork-morning-briefing
   created_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   day: "<date>"
   generator: "cowork:morning-briefing@1.0.0"
   prompt_source: "<prompt_source>"
   ```
   If `warning` is set, append `warning: "<warning>"` as the last frontmatter key. Close with `---`.
4. Compose the file contents: frontmatter block + one blank line + `body`. When `body` is empty AND `warning == "empty_prompt"`, use the literal body:
   ```
   (Prompt body empty — edit `<prompt_source>` to customize what this run emits.)
   ```
5. **Write the file** (3 sub-steps):
   a. **Ensure parent directory exists.** Use the Bash tool: `mkdir -p "<dirname(path)>"` where `<path>` is the composed vault-relative path resolved against cwd (the bash sandbox boundary IS the vault root for scheduled-jobs invocations).
   b. **Write the file.** Use the Write tool with `file_path: <path>` and the composed contents (frontmatter + body). The Write tool overwrites existing files (matches v0.65.0 atomic-note contract: overwrite-last-write-wins).
   c. **Verify.** Use the Bash tool: `wc -c "<path>"` and confirm the byte count is ≥ 500 (frontmatter alone is ~300; a real note clears). On undersized return `{ path, status: "failed:write-undersized:<bytes>" }`. On any Write tool failure return `{ path, status: "failed:filesystem:<reason>" }` where `<reason>` is normalized (`permission`, `enospc`, `path-collision`, `unknown`). On success return `{ path, status: "written" }`.

Pre-write self-check (see `## Pre-write self-check` below) MUST pass before sub-step (a). On self-check failure return `{ path, status: "failed:contract-violation:<field>" }` and do NOT call Bash or Write.

## Returns

`{ path: "<vault-relative path>", status: "written" | "failed:<reason>" }`.

## Title composition

Before composing the body, set frontmatter `title` to: `<Display Name> — <weekday>, <month_name> <D>, <year>` where `<D>` is the integer day (no leading zero) and `<year>` is the 4-digit year from `date`. For this skill the display-name literal is **`Morning Briefing`**. Example for Friday 2026-05-22: `"Morning Briefing — Friday, May 22, 2026"`.

## Adaptive body skeleton

Body shape is canonically produced by `cowork:compose-body`. See that skill + its golden fixtures (`platform/blueprints/cowork/helpers/fixtures/compose-body/`) for the authoritative shape. The body-shape write-guard (`## Pre-write self-check` v0.92.0 sub-section) enforces it at write time.

## Pre-write self-check

BEFORE calling the Write tool, verify your composed output against this checklist. If any item fails, return `{ path, status: "failed:contract-violation:<field>" }` and do NOT write.

### v0.91.1 write-guard: canonical output path enforcement (FIRST CHECK)

Before any other pre-write check, validate the computed write path against the canonical shape:

`spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md`

REJECT and return `{ path, status: "failed:contract-violation:wrong-output-path" }` if the computed `path` argument:

1. Starts with `spice/daily/` — that's the daily-blueprint surface (hand-edited daily notes), NOT this sub-skill's output.
2. Has a basename matching `<weekday>-<YYYY-MM-DD>.md` shape (e.g. `Friday-2026-06-05.md` — daily-blueprint naming convention).
3. Doesn't contain the canonical prefix `spice/cowork/daily/`.

Even if the orchestrator passes a wrong `path` argument, this guard catches it. This is the v0.91.1 deterministic backstop for v0.90.2's `[!warning]+ CRITICAL` orchestrator callout, which is prose-only and LLM-attention-bounded.

### v0.91.2 frontmatter write-guard: canonical frontmatter enforcement (SECOND CHECK)

After the path check passes, validate the composed frontmatter BEFORE the Write tool fires. The canonical frontmatter shape is:

```yaml
type: cowork-morning-briefing       # MUST be this EXACT string
engagement_id: <engagement_id>
day: "<YYYY-MM-DD>"                  # ISO date — NOT weekday name
generator: cowork:morning-briefing@1.0.0
prompt_source: <path>
title: <composed title>
summary: <1-2 sentence headline ~150-250 chars>
created_at: <ISO timestamp>
warnings: [<list>]                   # OPTIONAL — only when warnings exist
```

REJECT and return `{ path, status: "failed:contract-violation:wrong-frontmatter:<field>" }` if:

1. `type:` is missing OR is not the EXACT string `cowork-morning-briefing` (NOT `cowork-run-note`, NOT `cowork-briefing`, NOT any other variant).
2. Any of `engagement_id`, `day`, `generator`, `prompt_source`, `title`, `summary` is missing or empty.
3. Frontmatter contains non-canonical fields like `cadence:`, `date:` (use `day:` instead), `generated_at:` (use `created_at:` instead).
4. `day:` is not in `YYYY-MM-DD` ISO format (`Friday` is invalid; `2026-06-05` is valid).

This is the v0.91.2 deterministic backstop for the orchestrator's Step 17 post-write verify (which depends on the LLM reaching it). The write-guard runs BEFORE the file lands on disk; wrong frontmatter is refused at write time.

**Frontmatter checks:**
- [ ] `type:` matches the canonical value for this skill (`cowork-morning-briefing`)
- [ ] `title:` is present and non-empty (the formula-composed title from above)
- [ ] `summary:` is present and non-empty (1-2 sentences, ~150-250 chars)
- [ ] `engagement_id:`, `day:`, `generator:`, `prompt_source:` present

### v0.92.0 body-shape write-guard: canonical callout markers (FOURTH CHECK)

After the path / frontmatter / dvjs checks pass, validate the composed `body` against the canonical assertion list passed in via `body_assertions`.

REJECT and return `{ path, status: "failed:contract-violation:body-shape:<reason>" }` if:

1. `body_assertions` input is missing, null, or not an array → `body-shape:no-assertions-input` (indicates the orchestrator skipped `cowork:compose-body`).
2. `body_assertions` is an empty array → `body-shape:empty-assertions` (composeBody emitted no markers — defensive reject).
3. For each `assertion` in `body_assertions`: if `body.includes(assertion)` is false → `body-shape:missing-assertion:<index>:<first-40-chars-of-assertion>`.

The orchestrator surfaces this as a Notice + exit non-zero per the existing v0.91.x pattern.

**Body checks (regex-scan the composed body string):**
- [ ] First non-frontmatter line opens a dataviewjs fence containing the v0.91.3 CANONICAL SpaceNavButtons invocation EXACTLY: opening ` ```dataviewjs` + body line `await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });` + closing ` ``` `. REJECT any other shape — in particular REJECT `const { SpaceNavButtons } = customJS; SpaceNavButtons(dv, {...})` (produces runtime TypeError "SpaceNavButtons is not a function" because SpaceNavButtons is a class registered on customJS, not a callable export; only the customjs-guard view pattern handles the load + fallback correctly).
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
