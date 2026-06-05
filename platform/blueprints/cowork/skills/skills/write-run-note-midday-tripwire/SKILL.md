---
name: cowork:write-run-note-midday-tripwire
description: Write today's midday-tripwire run as an atomic note to spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md with canonical frontmatter (type cowork-midday-tripwire). Overwrites prior same-day run. One vault write; no gathers.
inputs:
  engagement: object
  date: string
  weekday: string
  month_name: string
  severity: string
  body: string
  prompt_source: string
  warning: string | null
outputs:
  path: string
  status: string
tags: [cowork, write-run-note, atomic-note, engagement-aware]
---

# cowork:write-run-note-midday-tripwire

Atomic-note writer for the midday-tripwire run. Composes canonical frontmatter, stitches it with the pre-rendered `body` markdown, and writes a single vault file. Idempotent: deterministic path per `(engagement, date)`; re-runs overwrite. No data lookups. The orchestrator owns gather + render; this skill only writes.

## Inputs

- `engagement` (object, required): engagement record from `vault-config.md`. Uses `engagement.id` only.
- `date` (string, required): `YYYY-MM-DD` from `cowork:date-context` (never local clock).
- `weekday` (string, required): full English weekday (e.g. `Tuesday`). Used only for path composition.
- `month_name` (string, required): full English month name (e.g. `May`). Used only for path composition.
- `severity` (string, required): one of `"yellow"` or `"red"`. The orchestrator only invokes this sub-skill when severity is yellow or red; green means no note is written.
- `body` (string, required): pre-rendered Markdown body. May be empty when `warning == "empty_prompt"`.
- `prompt_source` (string, required): vault-relative path to the prompt body that was read upstream (typically `spice/cowork/prompts/midday-tripwire.md`).
- `warning` (string, optional): set to `"empty_prompt"` when the orchestrator detected an empty prompt body upstream. Surfaces in frontmatter so the readiness panel can flag stub runs.

## Outputs

- `path` (string): vault-relative path to the written file.
- `status` (string): one of `"written"` | `"failed:<reason>"`.

## Steps

1. Compose the path: `spice/cowork/daily/<YYYY>/<MM>-<MonthName>/<YYYY-MM-DD>/midday-tripwire.md`, where `<YYYY>` and `<MM>` come from `date` and `<MonthName>` from `month_name`. Example for 2026-05-19 (Tuesday): `spice/cowork/daily/2026/05-May/2026-05-19/midday-tripwire.md`.
2. Compose `created_at` as the current ISO-8601 timestamp with offset (e.g. `2026-05-19T07:05:14-06:00`). Use the local TZ resolved by `cowork:date-context`.
3. Compose frontmatter as YAML:
   ```yaml
   ---
   type: cowork-midday-tripwire
   created_at: "<ISO+TZ>"
   engagement_id: "<engagement.id>"
   day: "<date>"
   severity: "<severity>"
   generator: "cowork:midday-tripwire@1.0.0"
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

Before composing the body, set frontmatter `title` to: `<Display Name> — <weekday>, <month_name> <D>, <year>` where `<D>` is the integer day (no leading zero) and `<year>` is the 4-digit year from `date`. For this skill the display-name literal is **`Midday Tripwire`**. Example for Friday 2026-05-22: `"Midday Tripwire — Friday, May 22, 2026"`.

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

   **Tripwire-specific section choices:** The `> [!example]+` per-section blocks reflect the aspects that triggered. For each non-null `signals.<aspect>`:
   - `signals.cc` non-null → `> [!example]+ 💳 Flagged charges` block with `| Time | Merchant | Amount | Card | Severity |` table.
   - `signals.calendar` non-null → `> [!example]+ 📅 Calendar drift` block with `| Event | Original start | Current start | Drift |` table.
   - `signals.queue` non-null → `> [!example]+ 📥 Queue growth` block with `| Source | New items | Top item |` table.

4. **`> [!warning] <section> unavailable`** blocks for any `gather-skipped` returns, at the position the affected section would have rendered. Also append the reason to frontmatter `warnings:` array.

5. **`> [!tip] <emoji> Today's focus`** closing admonition — 2-3 sentence focus paragraph + concrete first action.

### v0.78.0 prefs-driven additions

When the orchestrator passes `ordered_blocks[]` (priority-ordered, from `dispatch_mode == "prefs"`):

- Emit `[!example]+` and `[!warning]` callouts from `ordered_blocks[]` in array order. The first block is the highest-priority kind, the last is the lowest. Engagement-type-aspect blocks (semantic_related, finance_block from render_aspects) render AFTER all priority-ordered blocks.
- `[!example]+ <title>` callouts no longer require the title to match a known section name. Title may be any short string (≤60 chars, no newlines). The pre-write self-check's `body-missing-example-admonition` rule still applies (≥1 example admonition required), but no longer scopes the match to a fixed title set.
- When the orchestrator-composed body includes a `Voice contract:` prefix block in the prompt body (introduced by the literal line `Voice contract (from spice/cowork/context/user-preferences.md):`), apply that voice ONLY to: frontmatter `summary` (1-2 sentences), the synopsis paragraph, the closing tip and action. Do NOT apply to: SpaceNavButtons block (verbatim), `[!example]+` callouts (gather-shaped content), `[!warning]` callouts (canonical wording from the orchestrator).

When `dispatch_mode == "legacy"` (no `ordered_blocks[]`), use the v0.77.0 section ordering unchanged.

When `prompt_body` was empty upstream (`warning == "empty_prompt"`), the orchestrator composes a skeleton-compliant stub: info admonition body reads `(Prompt body empty — edit <prompt_source> to customize what this run emits.)`; example block reads `No prompt body to drive content; this run is a placeholder.`; tip block recommends editing the prompt source. Frontmatter `summary` reads `Stub run — prompt body at <prompt_source> is empty.` The self-check passes (5 markers + summary + title all present).

**Addition (v0.79.0): Hard rules bind all agent-authored text.** When the orchestrator-composed body includes a `Hard rules (non-negotiable` block in its voice-contract prefix, those rules bind ALL agent-authored text — including `[!example]+` / `[!info]` / `[!tip]` callout titles and bodies, not only the narrative paragraphs. A `no emoji` hard rule therefore forbids pictographic glyphs in section titles and tables as well. Canonical `[!warning]` callout strings (composed by the orchestrator from a fixed contract) are exempt.

## Pre-write self-check

### v0.91.1 write-guard: canonical output path enforcement (FIRST CHECK)

Before any other pre-write check, validate the computed write path against the canonical shape:

`spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md`

REJECT and return `{ path, status: "failed:contract-violation:wrong-output-path" }` if the computed `path` argument:

1. Starts with `spice/daily/` — that's the daily-blueprint surface (hand-edited daily notes), NOT this sub-skill's output.
2. Has a basename matching `<weekday>-<YYYY-MM-DD>.md` shape (e.g. `Friday-2026-06-05.md` — daily-blueprint naming convention).
3. Doesn't contain the canonical prefix `spice/cowork/daily/`.

Even if the orchestrator passes a wrong `path` argument, this guard catches it. This is the v0.91.1 deterministic backstop for v0.90.2's `[!warning]+ CRITICAL` orchestrator callout, which is prose-only and LLM-attention-bounded.

### v0.91.2 frontmatter write-guard: canonical frontmatter enforcement (SECOND CHECK)

After the path check passes, validate the composed frontmatter BEFORE the Write tool fires. The canonical frontmatter shape is:

```yaml
type: cowork-midday-tripwire        # MUST be this EXACT string
engagement_id: <engagement_id>
day: "<YYYY-MM-DD>"
severity: <warn|alert>
generator: cowork:midday-tripwire@1.0.0
prompt_source: <path>
title: <composed title>
summary: <1-2 sentence headline>
created_at: <ISO timestamp>
warnings: [<list>]                   # OPTIONAL
```

REJECT and return `{ path, status: "failed:contract-violation:wrong-frontmatter:<field>" }` if:

1. `type:` is missing OR != the EXACT string `cowork-midday-tripwire`.
2. Any of `engagement_id`, `day`, `severity`, `generator`, `prompt_source`, `title`, `summary` is missing/empty.
3. Frontmatter contains non-canonical fields like `cadence:`, `date:`, `generated_at:`.
4. `day:` not in ISO `YYYY-MM-DD` format; `severity:` not in `{warn, alert}`.

v0.91.2 deterministic backstop for Step 17 post-write verify.

### Original pre-write checklist

BEFORE calling the Write tool, verify your composed output against this checklist. If any item fails, return `{ path, status: "failed:contract-violation:<field>" }` and do NOT write.

**Frontmatter checks:**
- [ ] `type:` matches the canonical value for this skill (`cowork-midday-tripwire`)
- [ ] `title:` is present and non-empty (the formula-composed title from above)
- [ ] `summary:` is present and non-empty (1-2 sentences, ~150-250 chars)
- [ ] `engagement_id:`, `day:`, `generator:`, `prompt_source:` present

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

The orchestrator surfaces this in a Notice and skips downstream state-update steps.
