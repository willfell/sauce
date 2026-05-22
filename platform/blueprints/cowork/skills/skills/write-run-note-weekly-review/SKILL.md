---
name: cowork:write-run-note-weekly-review
description: Write the weekly-review run as an atomic note to spice/cowork/weekly/YYYY/YYYY-Www/weekly-review.md with canonical frontmatter (type cowork-weekly-review). Overwrites prior same-week run. One vault write; no gathers.
inputs:
  engagement: object
  week: string
  year: string
  body: string
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
- `prompt_source` (string, required): vault-relative path to the prompt body that was read upstream (typically `spice/cowork/prompts/weekly-review.md`).
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Compose the path: `spice/cowork/weekly/<year>/<week>/weekly-review.md`. Example for `2026-W20`: `spice/cowork/weekly/2026/2026-W20/weekly-review.md`.
2. Compose `created_at` as the current ISO-8601 timestamp with offset (e.g. `2026-05-19T07:05:14-06:00`). Use the local TZ resolved by `cowork:date-context`.
3. Compose frontmatter as YAML:
   ```yaml
   ---
   type: cowork-weekly-review
   created_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   week: "<week>"
   generator: "cowork:weekly-review@1.0.0"
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

Before composing the body, set frontmatter `title` to: `Weekly Review — Week <##>, <Month> <D>–<D2>, <year>` where the week range is the Mon-Sun span, `<##>` is the ISO week number (no leading zero for single-digit weeks), and `<year>` is the 4-digit year. For this skill the display-name literal is **`Weekly Review`**. Use the `week_label` input (passed by the orchestrator per v0.71.0 conventions) to anchor the week range. Example for week 2026-W21 (Mon May 18 – Sun May 24): `"Weekly Review — Week 21, May 18–24, 2026"`.

## Adaptive body skeleton

The body MUST contain these 5 structural markers in this order; CONTENT inside each marker adapts to the engagement and the gather outputs. Skip sections whose gather output is empty; add custom sections inside `> [!example]+` blocks when the engagement has signal the standard sections don't cover.

1. **SpaceNavButtons dataviewjs block** (verbatim, first thing after frontmatter close):

   ````
   ```dataviewjs
   await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
   ```
   ````

2. **`> [!info]- Today at a glance`** admonition — one paragraph synopsis distilled from gather outputs:

   ```
   > [!info]- Today at a glance
   > <one-paragraph synopsis>
   ```

3. **≥1 `> [!example]+ <emoji> <Section title>`** per-section block with markdown table OR bullets. Standard sections (calendar / email / projects / threads / finance) are emitted ONLY when their gather has data. Table column headers (use literally):
   - Calendar: `| Time | Event | Attendees | Link |`
   - Email triage: `| Subject | Sender | Intent |`
   - Project status: `| Project | Status | Next action |`
   - Finance accounts: `| Account | Balance | Δ this week |`
   - Finance transactions: `| Date | Merchant | Amount | Category |`
   - Open threads: bulleted list (no table — items are heterogeneous)

4. **`> [!warning] <section> unavailable`** blocks for any `gather-skipped` returns, at the position the affected section would have rendered. Also append the reason to frontmatter `warnings:` array.

5. **`> [!tip] <emoji> Today's focus`** closing admonition — 2-3 sentence focus paragraph + concrete first action.

When `prompt_body` was empty upstream (`warning == "empty_prompt"`), the orchestrator composes a skeleton-compliant stub: info admonition body reads `(Prompt body empty — edit <prompt_source> to customize what this run emits.)`; example block reads `No prompt body to drive content; this run is a placeholder.`; tip block recommends editing the prompt source. Frontmatter `summary` reads `Stub run — prompt body at <prompt_source> is empty.` The self-check passes (5 markers + summary + title all present).

## Pre-write self-check

BEFORE calling the Write tool, verify your composed output against this checklist. If any item fails, return `{ path, status: "failed:contract-violation:<field>" }` and do NOT write.

**Frontmatter checks:**
- [ ] `type:` matches the canonical value for this skill (`cowork-weekly-review`)
- [ ] `title:` is present and non-empty (the formula-composed title from above)
- [ ] `summary:` is present and non-empty (1-2 sentences, ~150-250 chars)
- [ ] `engagement_id:`, `week:`, `generator:`, `prompt_source:` present

**Body checks (regex-scan the composed body string):**
- [ ] First non-frontmatter line opens a `SpaceNavButtons` dataviewjs fence (i.e. the line starts with ` ```dataviewjs` and is followed within 3 lines by `class: "SpaceNavButtons"`)
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

The orchestrator surfaces this in a Notice and skips downstream state-update steps.
