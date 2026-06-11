---
purpose: |
  Comprehensive end-to-end walkthrough of how the cowork ecosystem works,
  from the cron tick that schedules a brief through the atomic note that
  lands in Obsidian, the check-marks the user fills in at the bottom of the
  brief, the reconciler that turns those check-marks into learned weights,
  and the compounding loop that makes tomorrow's brief tighter than
  today's.
load_when: |
  You want to understand the full cowork system end-to-end. You're
  onboarding a new contributor to the cowork blueprint. You're reasoning
  about which layer to modify for a behavior change. You're designing a
  cycle that touches the gather → compose → write → feedback → reconcile
  loop.
status: authoritative as of v0.98.1 (2026-06-11)
companion_docs:
  - Docs/cowork-vision.md (North Star + locked decisions)
  - Docs/agent-guides/architecture.md (mechanisms vs blueprints; installer)
  - Docs/cycle-history.md (chronological per-cycle change log)
  - Docs/landmines.md (22 non-negotiable traps)
versions_described:
  workshop: "0.98.1"
  cowork_blueprint: "0.37.0"
  eod_review_sidecar_schema: "1.0.0 + 1.1.0 (additive enum)"
  learned_weights_schema: "1.1.0 (nested per-engagement; Rail M)"
  scheduled_job_contract: "0.35.1"
---

# Cowork — end-to-end ecosystem

This document is a single-pass tour of how cowork actually works in production. It is HIGH-DETAIL on purpose: every concrete file, function, sentinel, schema field, and state transition that matters is named explicitly. Read this when you want to ground yourself in what's really happening end-to-end, before designing a change.

If you're new: read § 1 + § 2 first to orient. If you're designing a cycle: § 3 → § 7 → § 8 → § 9 will show you exactly which layer your change should land at. If you're debugging a misfire: § 4 + § 5 are the fastest path to "where in the pipeline did this break?"

## § 1 — TL;DR (one paragraph)

Cowork is a cron-driven, cadence-bound personal assistant that synthesizes a daily corpus of inputs (chat, calendar, email, github, ADO, finance, reminders, semantic memory) into structured atomic notes — one per (engagement, cadence, day) — landed in Obsidian. Each atomic note ends with a "Was today useful?" check-mark callout (**Rail L**). On the EOD cadence the rail captures per-item ticks + per-kind frequency knobs + free-text prose; on the other four cadences it captures coarser kind-level boolean ticks. A reconciler reads those check-marks, applies a deterministic weight-update formula to `learned_weights.json`, and the next day's brief consults those weights to decide what to surface vs. demote. Voice contract (vibe, personality, microscopes) layers on top of the structural rules. The system is **memory-compounding by design**: every tick is a weight nudge, and the corpus is the input to the LLM that writes tomorrow's brief.

## § 2 — The five cadences

Cowork fires five distinct atomic-note types on five cron schedules. Each is a separate orchestrator (`cowork:<cadence>`) with its own `content/data/orchestrator-instructions/<cadence>.md` file as the single source of truth for that cadence's contract.

| Cadence | When it fires (typical default) | What it is for | Atomic-note frontmatter type |
| --- | --- | --- | --- |
| `morning-briefing` | ~6:30am local | Predicts today's blocking actions; threads cross-kind dependencies as connective tissue | `cowork-morning-briefing` |
| `midday-tripwire` | ~12:30pm local | Compresses tripwire severities + new arrivals since morning | `cowork-midday-tripwire` |
| `eod-review` | ~5:30pm local | Reflects what landed today; flags what slipped; **the primary feedback-capture moment** | `cowork-eod-review` |
| `weekly-review` | ~Friday 5:00pm | What stalled, what advanced, what's queued | `cowork-weekly-review` |
| `monthly-review` | First-of-month 5:00am | Recurring patterns, blockers, throughput; the authoritative debt-payoff reconciliation moment for finance-tracking engagements | `cowork-monthly-review` |

The five cadences are **the contract**. Cowork is explicitly not a workflow engine — you can't add a custom cadence. Adding new cadences is a workshop-level cycle, not a per-engagement knob (see `Docs/cowork-vision.md` § 3 anti-goals).

Each cadence is **per-engagement**. If a user has 3 engagements (`headspace`, `accuris`, `life`), each gets its own scheduled job per cadence — 15 scheduled jobs total. Each engagement's run is independent: own `learned_weights`, own microscopes, own `brand-voice.md`, own `people.md`, own preferred MCP set.

## § 3 — The cron → atomic-note pipeline (end-to-end)

### 3.1 The cron tick

Cron is managed in claude.ai's Cowork UI, **not** by launchd or systemd. Each scheduled job is a wrapper that:

1. Encodes the orchestrator name + engagement_id as URL parameters
2. Triggers an LLM session (Claude) that opens with the wrapper body as its initial prompt
3. The wrapper body is generated at install time from `data/scheduled-job-contract.json` (contract_version 0.35.1) and the per-cadence template at `data/orchestrator-instructions/<cadence>.md`

The wrapper is the **only** thing the cron firing sees. It carries everything the LLM session needs to execute the cadence: orchestrator-instructions reference, engagement id, timezone, today's date, prelude-block, anti-delegation directive.

This indirection is what makes cowork **cross-machine consistent** (v0.97.x architecture). The wrapper body is byte-identical regardless of which machine the user is on, because it references the OI by URL rather than by local file path. The machine just needs an internet connection and an Anthropic API account.

### 3.2 The orchestrator-instructions file (the contract)

When the LLM session starts, the wrapper tells it to read the canonical orchestrator-instructions file for the cadence — e.g. `spice/cowork/data/orchestrator-instructions/morning-briefing.md` (refreshed on every `sauce update`). This file is **the single source of truth** for what the cadence does, structured as a numbered Steps section the LLM follows in order.

Anatomy of an orchestrator-instructions file (using morning-briefing as the canonical shape; the other four follow the same outline):

```
## Substitution tokens          ← variables the LLM resolves at runtime ($engagement_id, $today_date, etc.)
## Shared clauses               ← {{shared.anti_delegation_clause}}, {{shared.prelude_block}}, etc.

# cowork:morning-briefing — orchestrator-instructions

## Steps
### Step 0: Pre-flight (vault routing, user-prefs, inner-circle aliases)
### Step 1: Memory (yesterday + overnight ticks + drift_warning)
### Step 2: Gather priority loop (per-kind MCP calls, microscope adherence)
### Step 3: Compose run-note body via cowork:compose-body
  3a. Prep synopsis_md
  3b. Prep memory_callouts
  3c. Prep ordered_blocks (per-kind callouts)
  3d. Prep engagement_type_blocks
  3e. Invoke composeBody (gets body_md, sidecar_json, status)
### Step 4: Rating callout (Rail L — idempotent re-fire)
  4a. Parse prior sentinel (idempotent state recovery)
  4b. Compute surfaced_kinds (or surfaced_items_by_kind on EOD)
  4c. composeBody emits the Rail L per the appropriate template
### Step 5: Detection callout (Rail D — new-MCP surface)
### Step 6: Anti-echo callout (v0.95.1 — eligible cadences only)
### Step 7: Write .md via obsidian_put_content (INLINE CONTRACT — do not delegate)
### Step 8: Write .cowork.json sidecar via obsidian_put_content (Rail S)
### Step 8.5: Verify (sidecar schema validation + v0.97.4 prose-invariant write-guards)
### Step 9: State updates (active-threads, weekly-snapshot)
### Step 10: Done notice

## Synopsis composition rules (v0.98.0 contract)   ← prose-rules the LLM follows for the synopsis lead callout
```

The orchestrator-instructions are **the only thing** the LLM session reads at the OI layer. Voice contract (vibe, personality, microscopes) is layered on top via `user-preferences.md` + the per-engagement `personality.md` + the per-kind `microscopes/*.md` files.

### 3.3 The sub-skill graph

Cowork ships **20 sub-skills** under `.claude/skills/cowork/skills/<name>/SKILL.md`. Each is a thin shim around a deterministic JS helper at `spice/cowork/helpers/<name>-helper.js`. The orchestrators invoke sub-skills from their Steps sections.

The 20 sub-skills, grouped by role:

| Group | Sub-skill | Helper | Role |
| --- | --- | --- | --- |
| **Pre-flight** | `check-vault-routing` | (inline) | Confirms the vault identity + engagement registration |
| | `date-context` | (inline) | Resolves $today_date and $timezone |
| | `ensure-daily-note` | (inline) | Confirms a daily note exists for the day (for backlink target) |
| | `check-heartbeat` | `check-heartbeat-helper.js` | Confirms the reconciler ran recently |
| | `capture-frame-drift` | `capture-frame-drift-helper.js` | Detects calendar/weather frame drift (sidecar evidence) |
| **Gather** | `gather-calendar` | (MCP-direct) | Calendar events for the cadence window |
| | `gather-imessage` | (MCP-direct) | iMessage threads via apple-mcp |
| | `gather-gmail` | (MCP-direct) | Gmail threads |
| | `gather-threads` | (MCP-direct) | Slack/Teams chat threads |
| | `gather-finance-cc-today` | (MCP-direct) | Credit-card transactions today |
| | `gather-finance-yesterday` | (MCP-direct) | Credit-card transactions yesterday (for EOD) |
| | `gather-cc-debt-snapshot` | (MCP-direct) | Debt + utilization snapshot |
| | `gather-weather` | (MCP-direct) | Weather frame for the cadence window |
| | `gather-projects` | (MCP-direct) | Project + status snapshot from `spice/projects/` |
| | `gather-from-served-by` | (MCP-direct) | "Served by X" routing for per-kind microscope selection |
| | `gather-semantic-memory` | (MCP-direct) | Yesterday's atomic notes (Echoes/Memory log inputs) |
| | `gather-semantic-related` | (MCP-direct) | Semantically-related historical notes (Smart Connections) |
| **Compose** | `compose-body` | `compose-body-helper.js` | Assembles the atomic-note body (nav-buttons + synopsis + memory cluster + per-kind callouts + engagement-type blocks + Rail L/D/anti-echo + backlink) |
| | `compose-feedback-capture` (v0.98.1) | `compose-feedback-capture-helper.js` | Builds the EOD-only rich Rail L (per-item ticks + frequency knob + free-text) |
| **Learn** | `learn-from-checks` | `learn-from-checks-helper.js` | Reads prior atomic notes' Rail L state; updates `learned_weights.json` via the deterministic formula |

The orchestrators are thin coordinators — most "logic" lives in the helpers, not in the OI prose. This is the v0.97.x **deterministic-helpers-for-shape, OI-prose-for-voice** architectural posture: structural contracts live in JS (testable, version-pinned via HC asserts); voice/composition contracts live in OI prose (LLM-followable).

### 3.4 Step-by-step warm-path walkthrough (using morning-briefing as the example)

What actually happens when a cron triggers `cowork:morning-briefing` for the `headspace` engagement at 6:30am on 2026-06-11:

**Step 0 — Pre-flight.** The LLM:
1. Reads `vault-config.md` to confirm `headspace` is a registered engagement
2. Reads `user-preferences.md` to load the per-engagement priorities, mcps, render_aspects
3. Reads `spice/cowork/context/headspace/people.md` + `people-aliases.md` to load the inner-circle aliases (for chat thread surfacing)
4. Reads `spice/cowork/context/headspace/{brand-voice,personality,working-style}.md` for the voice contract
5. Builds the substitution token map: `$engagement_id=headspace`, `$today_date=2026-06-11`, `$timezone=America/Denver`, etc.

**Step 1 — Memory.** The LLM:
1. Reads yesterday's eod-review atomic note (`spice/cowork/daily/2026/06-June/2026-06-10/eod-review.md`) if present
2. Parses its Rail L sentinel via `parseRatingCallout` (v0.96.0 kind-checkboxes) OR `parseFeedbackCapture` (v0.98.1+ rich shape) — depending on which sentinel is present
3. Reads any overnight scheduled-job heartbeat from `data/cowork-heartbeat.json`
4. Composes the **Memory log** callout: a `> [!quote]- Memory log` block containing yesterday's key signals + today's drift_warning

**Step 2 — Gather priority loop.** For each kind in `user-preferences.priorities[]` (in priority order), the LLM:
1. Selects the appropriate MCP per `user-preferences.mcps[<kind>]` (runtime-authoritative; overrides `vault-config.mcp_map`)
2. Invokes the corresponding gather sub-skill
3. Applies the per-kind microscope at `spice/cowork/context/headspace/microscopes/<kind>.md` (if present) — microscopes own the per-kind output shape contract
4. Captures the per-kind block: `{ kind, callout_type, title, body_md, items[] (v0.98.1+ for EOD) }`
5. If `learning_enabled !== false`, captures the kind for `surfaced_kinds_for_rating[]` (used by Rail L on non-EOD) or builds `surfaced_items_by_kind` (used by Rail L on EOD)

**Step 3 — Compose run-note body.** The LLM calls `compose-body`'s `composeBody(input)` with all the assembled blocks:
1. Sub-step 3a: Synopsis_md is composed as `> [!info]+ What matters today` (v0.98.0 contract — open-by-default lead callout, ≤80 words, predictive, first-sentence-concrete; see `Docs/plans/2026-06-10-v0.98.0-synopsis-density-design.md`)
2. Sub-step 3b: Memory callouts assembled (yesterday cluster, semantic Echoes, backlink line)
3. Sub-step 3c: Ordered_blocks assembled in priority order — each per-kind block becomes a `> [!<callout_type>]- <Kind title>` callout (v0.98.0 `-` sigil = collapsed by default)
4. Sub-step 3d: Engagement-type blocks (per-engagement custom callouts, e.g. "📋 Today's standups")
5. Sub-step 3e: `composeBody` returns `{ body_md, sidecar_json, status: "ok" }` — body_md is the assembled rendered markdown; sidecar_json is the structured observability frame

**Step 4 — Rail L (the feedback rail).** This is where v0.98.1's split-by-cadence behavior kicks in:
- If `cadence === "eod-review"` AND `input.surfaced_items_by_kind` is non-empty → compose-body internally dispatches to `composeFeedbackCapture` (the v0.98.1 rich shape: per-item ticks + frequency knob + free-text + `<!-- cowork:feedback-capture v=1 -->` sentinel)
- Else → compose-body internally dispatches to `composeRatingCallout` (the v0.96.0 kind-checkbox shape + `<!-- cowork:rating-block schema=1.0.0 -->` sentinel)
- If `learning_enabled === false` → no Rail L emitted

**Step 5 — Rail D (detection callout).** If new MCP namespaces are detected that aren't in `user-preferences.mcps[]`, a `> [!info]+ Cowork detected a new MCP` callout is prepended.

**Step 6 — Anti-echo callout.** If the cadence is in `ANTI_ECHO_ELIGIBLE_CADENCES` AND `excluded_themes[]` is non-empty (semantically-similar themes from prior days that should be suppressed), an anti-echo callout is appended.

**Step 7 — Write `.md`.** The LLM calls `mcp__<vault>-obsidian__obsidian_put_content` with the full body_md (frontmatter + dataviewjs + body). The path is computed deterministically: `spice/cowork/daily/{{$today_dirpath}}/morning-briefing.md`. Path improvisation is FORBIDDEN — Step 8.5 verifies.

**Step 8 — Write `.cowork.json` sidecar.** The structured sidecar carrying { engagement_id, day, cadence, schema_version, surfaced_kinds, learned_weights snapshot, feedback_capture observability (v0.98.1+ EOD) } is written alongside. `write-atomic-note-helper.js` runs `validateSidecar` against the cadence schema (`data/schemas/<cadence>@1.0.0.json`) BEFORE committing either file. On schema violation, NO files are written.

**Step 8.5 — Verify.** v0.97.4 prose-invariant write-guards run as deterministic backstops. They re-read the just-written .md and assert: rating-callout sentinel present (or feedback-capture sentinel on EOD), anti-echo callout present if expected, coverage-gap warnings escalate to sidecar.

**Step 9 — State updates.** `active-threads.md` (the durable thread state across days) is touched-up; `weekly-snapshot.md` is appended if it's a weekly-review fire.

**Step 10 — Done.** The LLM emits a brief Notice and the session ends.

The whole pipeline typically takes 30-90 seconds from cron tick to atomic note rendered in Obsidian.

## § 4 — The atomic-note anatomy

Every cowork atomic note has the same structural skeleton (verified by `write-atomic-note-helper.js` regardless of cadence):

```
---
type: cowork-<cadence>
engagement_id: headspace
day: "2026-06-11"
generator: cowork:morning-briefing@2.0.0
prompt_source: spice/cowork/prompts/morning-briefing.md
title: <substituted>
summary: <1-2 sentence headline>
created_at: 2026-06-11T06:30:00-06:00
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

> [!info]+ What matters today           ← Synopsis lead (v0.98.0; OPEN by default; ≤80 words)
> <predictive paragraph>

> [!quote]- Memory log                  ← Rail M memory cluster (collapsed by default)
> ...

> [!example]- Chat (Teams)              ← per-kind callout (v0.98.0 `-` sigil = collapsed)
> - <person_block> ^item-chat-a7b3c9d   ← v0.98.1 block-ID anchor (EOD only; invisible in reading mode)

> [!info]- Calendar                     ← per-kind callout (collapsed)
> - <event line> ^item-calendar-e1f7031

> [!warning]- GitHub
> - PR #353 awaiting review ^item-github-c9d5e1f

> [!info]+ Cowork detected a new MCP    ← Rail D (only if applicable)
> ...

> [!info]+ Cowork v0.96.0 upgrade notice ← One-shot per engagement (only on first post-upgrade fire)
> ...

[!todo]+ ...                            ← Rail L — see § 5 for full shape

[[2026-06-11|backlink to today's daily note]]
```

Key structural invariants (enforced by helpers, not by LLM prose):

- **Path:** `spice/cowork/{daily,weekly,monthly}/<YYYY>/<MM-Month>/<YYYY-MM-DD>/<cadence>.md` (daily) OR `spice/cowork/weekly/<YYYY>/<ISO-week>/weekly-review.md` (weekly) OR `spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md` (monthly).
- **Frontmatter keys:** exactly `type`, `engagement_id`, `day` (or `week`/`month`), `generator`, `prompt_source`, `title`, `summary`, `created_at`. FORBIDDEN keys: `cadence`, `date`, `engagement` (not `engagement_id`), `generated_at`, `week`/`month`/`year` (unless the actual cadence-key), `schema_version`.
- **DataviewJS block:** MUST be literally the customjs-guard view invocation, immediately after frontmatter.
- **Body:** every block is a callout (`> [!<type>]<sigil>`), NEVER a plain `## Heading`. Plain headings = delegation occurred mid-Step-7 = abort + Notice.
- **Lead callout (v0.98.0):** `> [!info]+ <per-cadence title>` carrying ≤80-word predictive synopsis. OPEN by default.
- **Per-kind callouts (v0.98.0):** every per-kind callout uses `-` sigil (collapsed by default). User expands the kind they want to see.
- **Block-IDs (v0.98.1, EOD only):** surfaced items in per-kind callouts have a trailing `^item-<kind>-<7-char-sha1>` block-ID anchor. Render invisibly. Wikilink-targetable as `[[#^item-<kind>-<7hex>]]` from the Rail L feedback rail.

## § 5 — Rail L (the feedback rail) — the check-mark mechanism

Rail L lives at the bottom of every atomic note. It is **the user-touched surface** — everything else in the note is read-only output. Rail L is where the user gives signal back to the system.

### 5.1 On non-EOD cadences (v0.96.0 kind-checkbox shape)

Morning-briefing, midday-tripwire, weekly-review, monthly-review all emit:

```markdown
> [!todo]+ Was today useful?
> Tick the kinds that surfaced something you cared about. (One tick per kind per day; learned weights live in `spice/cowork/context/user-preferences.md`.)
> - [ ] Chat
> - [ ] Calendar
> - [ ] GitHub
> - [ ] Email
> <!-- cowork:rating-block schema=1.0.0 cadence=morning-briefing day=2026-06-11 -->
```

- The lead callout is `> [!todo]+ Was today useful?` (OPEN by default — the rail is visible without expanding).
- One checkbox per surfaced kind (chat / calendar / github / email / ado / finance / reminders / etc.).
- The HTML-comment sentinel `<!-- cowork:rating-block schema=1.0.0 cadence=<c> day=<d> -->` is the parse target for `parseRatingCallout` in `learn-from-checks-helper.js`.
- **Idempotent re-fire:** if the same cadence re-fires on the same day (e.g. the user manually re-triggers), the helper parses the prior file's sentinel + tick state via `parseRatingCallout`, then preserves `[x]` per kind across the rewrite. The user never loses ticks they already entered.
- **Coarse signal:** kind-level boolean only. "Did chat surface something useful today?" is the question. No per-item granularity. No frequency tilt. No prose.

### 5.2 On EOD (v0.98.1 rich shape)

EOD-review emits a richer Rail L:

```markdown
> [!todo]+ Was today useful?
> Tick items that mattered. Set per-kind frequency. Type prose for nuance. Tomorrow's brief adjusts overnight.
> <!-- cowork:feedback-capture v=1 -->
>
> > [!summary]- Chat — items
> > - [ ] [[#^item-chat-a7b3c9d|Zhenzhen PR #353 thread]]
> > - [ ] [[#^item-chat-b8c4d0e|Ben/Stale Doc DB infra]]
> >
> > **Fire chat:** `[ ] less` `[ ] same` `[ ] more`
>
> > [!summary]- GitHub — items
> > - [ ] [[#^item-github-d0e6f20|PR #353 awaiting review]]
> >
> > **Fire GitHub:** `[ ] less` `[ ] same` `[ ] more`
>
> ### Free-text feedback
>
> ```feedback
> (Type prose here — anything you want cowork to know.)
> ```
```

Three new capture surfaces:

1. **Per-item ticks** — one checkbox per surfaced person-block / PR-row / ADO-story-row / etc. The wikilink target (`[[#^item-chat-a7b3c9d|<label>]]`) resolves to the block-ID emitted by compose-body at Step 3c. The block-ID itself renders invisibly; the user sees just `<label>` as a clickable link.
2. **Per-kind frequency knob** — `[ ] less` / `[ ] same` / `[ ] more` per kind. Single signed signal per kind. (See § 7.2.4 for how this becomes a weight delta.)
3. **Free-text feedback** — a tagged fenced ` ```feedback…``` ` block. The user types prose: "stop surfacing Diana's emails", "I never read calendar after 3pm", "Brex bills are too noisy". Captured this cycle; v0.98.2 reads it.

The sentinel `<!-- cowork:feedback-capture v=1 -->` at the top of the callout is the parse target for `parseFeedbackCapture` in `learn-from-checks-helper.js` (v0.98.1+). The `v=1` is intentional: v0.98.2's reconciler greps for it; future shape changes can bump to v=2 with a tolerant parser.

**Idempotent re-fire — richer than v0.96.0.** When EOD re-fires on the same day, `compose-feedback-capture-helper.js`'s `_parsePrior` reads the prior file's `cowork:feedback-capture v=1` block and preserves:
- `[x]` state per item-ID (the user's per-item ticks)
- Knob position per kind (which `[x]` is set on the `less / same / more` row)
- Free-text content (the prose stays verbatim)
- **Ambiguous-knob guard:** if the user has `[x] less [x] more` for a kind (transitioning their opinion mid-day), the rendered output preserves both `[x]` AND the sidecar's `feedback_capture.ambiguous_knobs[]` array gains the kind name — so the v0.98.2 reconciler treats it as no-signal rather than computing `(-1) + (+1) = 0`.

### 5.3 The sentinel system — why two sentinels coexist

v0.98.1 chose NOT to migrate the v0.96.0 rating-block sentinel to the v=1 feedback-capture sentinel on the four non-EOD cadences. Reasons:

1. **MVP discipline.** Capture is the v0.98.1 goal; ingest is v0.98.2. Adding per-item ticks to MB/midday/weekly/monthly expands scope to 5 OIs + 5 fixtures.
2. **Reversibility.** EOD-only is the smallest reversible diff. Expanding later is additive; narrowing back is a contract break.
3. **Semantic fit.** Per-item ticks make most sense retrospectively (EOD looks back at the day's items). Morning/midday are forward-looking; per-item ticks on them have ambiguous semantics ("which surfaced items look relevant?" is a different question than "which surfaced items were useful?").

Result: `parseRatingCallout` + `RATING_SENTINEL_RX` continue to drive the reconciler for 4 cadences; `parseFeedbackCapture` + `FEEDBACK_SENTINEL_RX` drive EOD. Both functions are exported from `learn-from-checks-helper.js` (v0.98.1+) and live alongside each other forever.

## § 6 — The sidecar (`.cowork.json`)

Every atomic note has a companion `.cowork.json` sidecar at the same path with `.md` → `.cowork.json`. The sidecar is the **structured observability frame** that the reconciler (and any future downstream consumer) reads instead of re-parsing markdown.

Shape (schema_version 1.0.0 baseline; 1.1.0 additive on EOD):

```json
{
  "schema_version": "1.0.0",
  "engagement_id": "headspace",
  "day": "2026-06-11",
  "cadence": "morning-briefing",
  "generator": "cowork:morning-briefing@2.0.0",
  "surfaced_kinds": ["chat", "calendar", "github"],
  "render_aspects": { "synopsis": "include", "memory_log": "include", ... },
  "learning_enabled": true,
  "learned_weights_snapshot": {
    "per_kind": { "chat": { "weight": 1.15, "ticks": 5, "skips": 2, "warmup": false }, ... },
    "totals": { "notes_scanned": 12, "notes_with_any_tick": 8, "warmup_until": "2026-06-15", ... }
  },
  "anti_echo_themes": [],
  "pending_confirmations": []
}
```

EOD additional field (v0.98.1+, additive):

```json
"feedback_capture": {
  "sentinel_version": "v=1",
  "item_count": 11,
  "kinds_with_knobs": ["chat", "github", "calendar"],
  "ambiguous_knobs": []
}
```

The sidecar validates via `validateSidecar` against `data/schemas/<cadence>@1.0.0.json` BEFORE the .md is committed. On schema violation, neither file is written and the orchestrator aborts with a Notice. The schema accepts both `schema_version: "1.0.0"` (pre-v0.98.1 sidecars; no feedback_capture field) AND `schema_version: "1.1.0"` (post-v0.98.1; field present) — additive enum.

**Why the sidecar matters for the feedback loop:** the reconciler doesn't need to re-parse markdown to know whether a given EOD has feedback to ingest. It reads `sidecar.feedback_capture.item_count > 0` and that's the fast-path. Markdown re-parsing only happens once it's confirmed there's signal to extract.

## § 7 — The feedback loop — current state

This is the core mechanism the user asked about: **how check-marks at the end of a brief feed back to make tomorrow's brief better.**

### 7.1 What the user actually does

The user opens the atomic note in Obsidian (typically the EOD review around 6pm, or other cadences as they fire). Workflow:

1. **Read the lead callout.** The `> [!info]+ <per-cadence title>` synopsis paragraph is open by default (v0.98.0 contract) and carries the brief's predictive load on its own.
2. **Optionally expand per-kind callouts.** All `> [!<type>]- <Kind>` are collapsed by default; the user clicks to expand only the kinds they want to drill into.
3. **Tick Rail L at the bottom.** This is the explicit feedback gesture:
   - On non-EOD cadences: tick the kind-level boxes that surfaced something useful
   - On EOD (v0.98.1+): tick the per-item boxes that mattered, set the per-kind frequency knob if they want to nudge, optionally type prose into the free-text block
4. **Save the file.** Obsidian persists. The next cron fire (the reconciler) sees the updated atomic note.

That's it. No slash commands. No buttons to click. No external UI. The Markdown is the interface; the check-marks are the signal.

### 7.2 What the reconciler does (cowork:learn-from-checks — currently shipping)

The reconciler is itself a scheduled job, **run as one of the cron cadences**. It currently fires daily (warmup phase) or weekly (post-warmup) — see `reconcile-cowork.md` orchestrator-instructions.

When it fires:

#### 7.2.1 Scan atomic notes

`learn-from-checks-helper.js` `scanAtomicNotes({ dir, engagement_id, since_day })` walks the atomic-note directory tree, opens each `.md`, calls `parseRatingCallout(md)` (or `parseFeedbackCapture(md)` for EOD with v=1 sentinel), and returns an observation set:

```js
{
  observations: [
    { kind: "chat", ticked: true },
    { kind: "calendar", ticked: false },
    { kind: "github", ticked: true },
    ...
  ],
  notes_scanned: 12,
  notes_with_any_tick: 8
}
```

Sidecar engagement-id filtering: the helper reads the `.cowork.json` sidecar alongside each .md and skips notes whose `sidecar.engagement_id` doesn't match the requested engagement (multi-engagement vault hygiene).

#### 7.2.2 Apply the deterministic weight update formula

`updateWeights(prev_per_kind, observations, opts)` runs the v0.96.0 formula. Per kind:

```
w_old   = previous weight (1.00 if kind never seen)
ticks   = count of observations with ticked=true for this kind
skips   = count of observations with ticked=false for this kind

numerator   = ticks - 0.5 * skips
denominator = ticks + skips + smoothing       (smoothing=5)
w_raw       = w_old * decay + lr * (numerator / denominator)
                                                ↑           ↑
                                            decay=0.98   lr=0.15
w_new       = clamp(w_raw, 0.10, 3.00)
w_new       = round_half_to_even(w_new, 3 decimal places)
```

Concrete examples (drawn from HC asserts):
- **First fire, no prior state, 3 ticks 0 skips for `chat`:** `w_old=1.00`, `numerator=3-0=3`, `denominator=3+0+5=8`, `w_raw = 1.00 * 0.98 + 0.15 * (3/8) = 0.98 + 0.05625 = 1.03625`, clamped → `1.036`.
- **Established kind at 1.50, 0 ticks 5 skips:** `w_raw = 1.50 * 0.98 + 0.15 * (-2.5 / 10) = 1.47 - 0.0375 = 1.4325`, clamped → `1.433`.
- **Hot kind at 3.00, 5 ticks 0 skips:** `w_raw = 3.00 * 0.98 + 0.15 * (5/10) = 2.94 + 0.075 = 3.015`, clamped to ceiling → `3.000`.

The decay term (`* 0.98`) is the **drift-toward-1.00 pressure** — without ticks, a hot kind cools by 2%/day. The smoothing term in the denominator prevents noisy early days from over-weighting (a single tick on day 1 shouldn't yank the weight by 0.15; smoothing softens it).

#### 7.2.3 Warmup behavior

`evaluateWarmup(per_kind_state, days_since_first, opts)`:
- A kind stays in `warmup: true` until BOTH `days_since_first >= 7` AND `ticks + skips >= 7`.
- During warmup, downstream consumers (the orchestrators' Step 2 priority loop) treat the weight as advisory only — they fire the kind regardless of weight, to accumulate signal.
- After graduation, the weight becomes authoritative: weight ≥ 1.20 promotes the kind earlier in the priority loop; weight ≤ 0.50 demotes (still fires, but ordered last; very low weights may be skipped entirely on quiet days).

#### 7.2.4 Apply v0.98.1 frequency-knob signal

When v0.98.2 ships (currently sketched, not yet implemented), the per-kind frequency knobs from the EOD Rail L become direct weight deltas added to the formula's output:

```
knob = "less"  → w_new := w_new - 0.05
knob = "same"  → w_new unchanged
knob = "more"  → w_new := w_new + 0.05
knob = "ambiguous" → no signal (skipped)
```

These deltas are applied AFTER the formula + clamp pass, then re-clamped to [0.10, 3.00]. They're "direct user intent" — a stronger signal than the formula's gradual ticks-driven movement.

#### 7.2.5 Write the result

The new `per_kind` state is written to `spice/cowork/memory/<engagement>/learned_weights.json`:

```json
{
  "schema_version": "1.1.0",
  "engagements": {
    "headspace": {
      "per_kind": {
        "chat": { "weight": 1.150, "ticks": 12, "skips": 4, "warmup": false, "last_updated": "2026-06-11" },
        "github": { "weight": 0.820, "ticks": 5, "skips": 8, "warmup": false, "last_updated": "2026-06-11" },
        ...
      },
      "totals": {
        "notes_scanned": 89,
        "notes_with_any_tick": 67,
        "warmup_until": "2026-06-18",
        "upgrade_notice_emitted": true,
        "scanned_days": ["2026-06-10", "2026-06-11"]
      }
    },
    "life": { ... },
    "accuris": { ... }
  }
}
```

The schema is **nested per-engagement** (v1.1.0; introduced at v0.96.1 / Rail M). Each engagement has its own weight space — your accuris weights don't influence your life weights. Migration from v0.96.0's flat shape is automatic via `_normalizeLearnedWeights`.

### 7.3 How the new weights affect tomorrow's brief

Tomorrow morning, when the cron fires `cowork:morning-briefing` for `headspace`:

- Step 0 reads `learned_weights.json` → `engagements.headspace.per_kind`
- Step 2's priority loop CONSULTS the weights to decide:
  - **Kind ordering:** highest weights surface first in the brief
  - **Kind inclusion:** very-low weights may skip the gather sub-skill entirely (quiet-day mode)
  - **Microscope sensitivity:** some microscopes' `## Output shape` rules consume the per-kind weight to adjust verbosity (e.g. "if chat.weight ≥ 1.5, surface up to 8 person-blocks; if ≤ 0.8, cap at 3")
- **Render_aspects gating:** the orchestrator reads `user-preferences.render_aspects[<aspect>]` to decide what to include — the user can override per-aspect (e.g. `"include"` / `"omit"` / `"auto"` where `"auto"` consults learned_weights)

Net effect: every tick is a weight nudge; every weight nudge shifts what tomorrow's brief surfaces, in what order, with what verbosity.

## § 8 — The compounding mechanic — why it gets better every day

Cowork's North Star (per `Docs/cowork-vision.md` § 1) is **memory-compounding**: the system's value increases over time because each day's signal (ticks, skips, knobs, prose) is durable input to tomorrow.

Concretely, three compounding loops are in motion:

**Loop 1 — Per-kind weights compound.** Each day's ticks/skips update `learned_weights.per_kind`. After 30 days, the weights are an empirical model of "which kinds matter to this user." After 90 days, the weights are stable enough that frequency-knob signals (v0.98.2+) become the primary tilt mechanism.

**Loop 2 — Atomic-note corpus compounds.** Every day's atomic note (and sidecar) is durable input to:
- The Memory log callout (yesterday's signal seeds today's brief)
- Smart Connections (semantic retrieval — tomorrow's Echoes callout pulls in semantically-related historical notes)
- Coverage-gap detection (gaps in tick-coverage trigger Rail L's `## Coverage gap` sub-callout from v0.97.4)
- The v0.98.2 reconciler (rolls up per-item ticks longitudinally — "user ticked Zhenzhen's chat thread 12 times in 30 days → upweight that person")

**Loop 3 — Microscopes evolve.** Microscopes (`spice/cowork/context/<engagement>/microscopes/<kind>.md`) carry the per-kind output-shape contract. Today they're hand-authored. v0.98.2's reconciler will APPEND to microscope `## What matters` sections based on free-text feedback — never rewrite, just append. The user prunes later. Over months, the microscopes become a hand-curated representation of the user's preferences distilled through the LLM's understanding of their prose feedback.

**The key invariant: nothing in the system overwrites the user's authored content silently.** Numeric weights update directly (the user can read them in `learned_weights.json` and edit them if they want). Microscope `what_matters` strings append (the user prunes). Voice/personality changes are PROPOSED, not auto-applied (v0.98.2 surfaces them in the next morning brief as a callout: "Voice tweak proposed: [...]. Apply via /cowork apply-voice-deltas?"). Coverage gaps land in a separate file (`spice/cowork/memory/<engagement>/coverage-queue.md`) that the user reviews on their schedule.

## § 9 — The feedback loop — coming in v0.98.2

v0.98.1 (shipped) is **capture only**: structured signal lands in the EOD atomic note's Rail L + sidecar's `feedback_capture` field. No writes back to learned_weights / microscopes / voice. The corpus accumulates.

v0.98.2 (next cycle) will be **the reconciler ingest** — closing the loop the user's 2026-06-10 vision described:

> "another job took what i liked, what i didn't like, my feedback, then updated the relevant files so that all scheduled jobs would then adjust the next day"

Sketched pipeline (full design at the v0.98.2 cycle's brainstorm):

1. **Trigger.** Existing reconciler cron, fired daily (warmup) or weekly (post-warmup). Reads N days of EOD reviews where `sidecar.feedback_capture.item_count > 0`.
2. **Parse structured signal (deterministic — no LLM).** Per-item ticks → looked up against the item-ID hash registry → rolled up per-kind, per-person, per-channel weight nudges. Frequency knobs → direct ±0.05 delta. Ambiguous-knobs skipped.
3. **Parse free-text (LLM pass).** NEW sub-skill `cowork:ingest-feedback` runs Sonnet 4.6 (cost-fast, open question) with a structured-output prompt: "Read this user's feedback prose. Extract structured intents: (a) per-person/channel/topic uprank/downrank, (b) voice corrections, (c) coverage gaps, (d) other. Return as deltas with proposed write-targets."
4. **Apply with audit trail.**
   - All deltas logged to `spice/cowork/memory/<engagement>/feedback-deltas.md` (append-only changelog: date + delta + source quote from prose)
   - `learned_weights` numeric updates: applied directly with clamp + log. Schema bumps 1.1.0 → 1.2.0 (adds `per_person.<name>.weight`, `per_channel.<id>.weight`, `per_topic.<topic>.weight` maps under each engagement)
   - Microscope `what_matters` strings: append-only — never rewrite the contract
   - Personality/voice changes: PROPOSED only — next-day morning brief shows a callout
   - Coverage gaps: written to `spice/cowork/memory/<engagement>/coverage-queue.md`

The user explicitly raised the per-item DOWNVOTE row as part of the same vision — that's queued as a v0.98.1.x PATCH candidate or v0.98.2 brainstorm seed: should Rail L gain a parallel "what I didn't like" row per kind, or should downvote signal flow purely through the free-text + LLM ingest?

## § 10 — Cross-machine + cross-engagement

### 10.1 Cross-machine consistency (v0.97.x architecture)

The wrappers (the cron-triggered job bodies) are byte-identical regardless of machine because:
- They reference the canonical OI by URL (claude.ai / Anthropic API endpoint), not by local path
- The `claude.ai` Cowork UI is the single source of scheduling (Rail A — claude.ai sync)
- `cowork:sync-scheduled-jobs` is the user-invocable orchestrator that pushes scheduled-job definitions FROM the local vault TO claude.ai

The implication: the user can have 3 machines (MBP, desktop, work laptop) all running the same cowork system. They share the same wrappers, the same OI references, the same MCP namespaces (assuming they've signed into the same accounts). What differs per-machine: which Obsidian vault is open locally. The wrappers ALWAYS know which engagement (via the wrapper's `$engagement_id` substitution token) and which vault (via Obsidian's open-vault state at fire time).

There's an open question for v0.99.0+: how to handle the case where two machines are both online when a cron fires. Today the wrappers race-condition; first-to-write wins (the second writes are silently ignored because the file already exists with content). Open issue: should the wrappers use lockfile semantics? See `Docs/cowork-vision.md` § 2 quality bar.

### 10.2 Multi-engagement (Rail M)

`learned_weights.json` is **nested per-engagement** (schema 1.1.0). Same atomic-note path-tree (`spice/cowork/daily/...`) but the sidecar carries `engagement_id` and the reconciler filters by it when scanning.

Each engagement has its own:
- Microscope set (`spice/cowork/context/<engagement>/microscopes/<kind>.md`)
- People (`spice/cowork/context/<engagement>/people.md` + `people-aliases.md`)
- Brand voice (`spice/cowork/context/<engagement>/brand-voice.md`)
- Personality (`spice/cowork/context/<engagement>/personality.md`)
- Preferred MCP set (`user-preferences.mcps[<engagement>]`)
- Learned weights (nested under `engagements.<engagement_id>` in `learned_weights.json`)

What's SHARED across engagements:
- The 20 sub-skills + their helpers
- The 5 cadence orchestrator-instructions (cadence contracts)
- `_shared-clauses.md` (anti-delegation, prelude, rating template, feedback-capture template)
- Mechanism count (17 mechanisms across the platform; not engagement-scoped)

## § 11 — The architectural posture — why this works

Three load-bearing posture choices make cowork work the way it does.

### 11.1 Deterministic helpers for shape; OI prose for voice

After v0.97.4 (prose-invariant write-guards) and v0.98.0 (synopsis-density rewrite), the layering is clean:

| Concern | Layer | Why |
| --- | --- | --- |
| Structural shape (frontmatter, dataviewjs, path, callout sigil, sentinel placement, item-ID hash) | JS helpers + JSON schema | Deterministic; testable via HC asserts; can't drift across LLM sessions |
| Voice (synopsis prose style, personality, microscope output shape, per-kind verbosity) | OI prose + per-engagement context files | LLM-followable; engagement-flavored; bounded by the structural rules |
| Reconciler math (weight formula, warmup) | JS helpers | Pure data; no LLM; version-pinned via HC asserts |
| Feedback-parsing (sentinel detection, tick extraction, knob parsing, free-text fence) | JS helpers | Deterministic; tolerant of both old and new sentinel shapes |
| LLM-driven content extraction (v0.98.2 free-text intent → structured deltas) | LLM via `cowork:ingest-feedback` sub-skill | Inherently fuzzy; that's the point; bounded by structured-output schema |

When in doubt: put structure in helpers, put voice in OI prose. v0.98.0 lesson #2 ("helper code can encode shape contracts that should be at the OI layer" — i.e. the OPPOSITE trap, where structure leaked into prose) is mitigated by the design's S1.0 pre-design grep audit pattern.

### 11.2 Cron-driven cadence, not slash-command-driven

Cowork is **explicitly NOT** a slash-command interface (vision § 3 anti-goals). The 5 cadences are the contract. Slash commands exist for tooling (`/cowork discover-people`, `/cowork find-missing-people`, `/cowork sync-scheduled-jobs`) but they support the cadence flow — they're not the everyday surface.

This is what makes cowork **assistant-like, not chatbot-like**. The user doesn't summon cowork; cowork shows up at the right cadences with the right shape. The user doesn't type prompts; the user reads briefs and ticks check-marks. The interface is the Markdown file, not a conversation.

### 11.3 Explicit user-content guarantees (4 safeguards, v0.98.1)

Three structural layers guarantee the installer cannot touch user-authored content:

1. **Manifest `files[]` allowlist.** The cowork blueprint declares 109+ explicit destinations. The installer can only write to declared paths. Zero entries match `context/<engagement-id>/`, `memory/`, `daily/`, `weekly/`, `monthly/`, `snapshots/`, or `summaries/`.
2. **`materialize_once: true`** on `context/user-preferences.md` and the 5 `prompts/<cadence>.md` files. Installer ships them on first install, never overwrites on update.
3. **Module-directory invariant (landmine #11).** Cowork blueprint declares `module_directory: "cowork"` — confined to `spice/cowork/`.

v0.98.1 added 4 operational safeguards on top:

| | Safeguard | What it does |
| --- | --- | --- |
| 1 | Pre-deploy snapshot recipe (`tar -czf` of user-owned dirs) | Durable rollback point outside the vault tree |
| 2 | Post-install diff verification (`find ... -newer pre-update-marker`) | Sanity check that the structural guarantees held |
| 3 | **Automated** forbidden-paths guard at `scripts/check-files-forbidden-paths.js` | Wired into `release:preflight`; fails CI if any blueprint's `files[]` introduces a forbidden dest |
| 4 | `.bak` tripwire | Single-shot "did the installer touch this?" check (NOT durable rollback) |

The combination guarantees: even if a future cycle accidentally introduces a `files[]` entry under `context/<engagement>/`, the Safeguard 3 grep fails CI before the cycle can ship. Belt and suspenders.

## § 12 — Roadmap (where this is going)

| Cycle | Scope | Status |
| --- | --- | --- |
| **v0.98.1** ⭐ | Questionnaire expansion + free-text capture (THIS CYCLE) | **SHIPPED 2026-06-11** |
| **v0.98.2** | Reconciler free-text + per-item-tick ingest — closes the loop the user's vision described | NEXT (brainstorm seeded at `Docs/prompts/2026-06-11-post-v0.98.1-next-cycle-handoff.md`) |
| **v0.98.1.x candidates** | Per-item DOWNVOTE row; bare-fence vs `>`-prefix visual UX; end-to-end integration fixture for cadence dispatch | Queued (PATCH-sized) |
| **v0.99.0+** | Cross-machine wrappers; `cowork:doctor` observability skill; `cowork:audit-cohesion` enforcement; per-skill SemVer | Queued; depends on memory write-side maturation |

The substance arc (v0.98.x) is the most directly user-visible direction since the platform's launch. Density first (v0.98.0), capture surface second (v0.98.1), ingest + write-side third (v0.98.2). Then the platform shifts focus to observability + cross-machine durability (v0.99.0+).

## § 13 — Where to look next

If you want to trace a specific path through the system:

- **A specific cadence's contract:** `platform/blueprints/cowork/content/data/orchestrator-instructions/<cadence>.md`
- **Shared substitutions (anti-delegation, prelude, rating template, feedback-capture template):** `_shared-clauses.md` in the same dir
- **Body assembly:** `platform/blueprints/cowork/helpers/compose-body-helper.js`
- **Feedback rail build (v0.98.1):** `platform/blueprints/cowork/helpers/compose-feedback-capture-helper.js`
- **Sentinel parsing + weight update math:** `platform/blueprints/cowork/helpers/learn-from-checks-helper.js`
- **Sidecar shape + write-guards:** `platform/blueprints/cowork/helpers/write-atomic-note-helper.js`
- **Per-cadence sidecar schemas:** `platform/blueprints/cowork/data/schemas/<cadence>@1.0.0.json`
- **How a real EOD looks:** `/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/cowork/daily/<recent-date>/eod-review.md`
- **What ships on update:** `platform/blueprints/cowork/manifest.json` § `files[]`
- **Why decisions were made the way they were:** `Docs/cowork-vision.md` (North Star + locked decisions)
- **What changed when:** `Docs/cycle-history.md`
- **Past cycle full designs:** `Docs/plans/<date>-v<version>-*-design.md`
- **22 traps to avoid:** `Docs/landmines.md`

## § 14 — What this doc deliberately does NOT cover

- **Bootstrap flow (first-time install).** See `Docs/cowork-onboarding.md` + `commands/install.md`.
- **Mechanism architecture (17 mechanisms across the platform).** See `Docs/agent-guides/architecture.md` § Two building blocks.
- **Slash commands + their handlers.** See `commands/<name>.md` + `Docs/cowork-vision.md` § 3 (anti-goal).
- **Specific microscope contracts per kind.** See per-engagement `microscopes/<kind>.md`.
- **The MCP integration layer (apple-mcp, Brex, Gmail, Calendar, Slack, Teams, Drive, Context7, Playwright).** See per-MCP integration docs + `user-preferences.mcps`.
- **Smart Connections / semantic retrieval mechanics.** See its own dedicated cycle docs (v0.93.x family).
- **Workshop self-install (dogfood loop).** See `Docs/agent-guides/build-test-verify.md`.

These are tangential to the **front-to-end + feedback loop** focus of this doc. Each has its own canonical reference.
