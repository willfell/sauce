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
status: authoritative as of v0.98.2 (2026-06-11)
companion_docs:
  - Docs/cowork-vision.md (North Star + locked decisions)
  - Docs/agent-guides/architecture.md (mechanisms vs blueprints; installer)
  - Docs/cycle-history.md (chronological per-cycle change log)
  - Docs/landmines.md (22 non-negotiable traps)
versions_described:
  workshop: "0.98.2"
  cowork_blueprint: "0.38.0"
  eod_review_sidecar_schema: "1.0.0 + 1.1.0 + 1.2.0 (additive enum; v=2 sentinel + items[] registry)"
  learned_weights_schema: "3 (nested per-kind entity maps; lives in user-preferences.md frontmatter)"
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

### 5.1 On the four non-EOD cadences (v0.101.0 — v=4 shape)

Morning-briefing, midday-tripwire, weekly-review, monthly-review all emit the same v=4 feedback section (one shape on all five briefs as of v0.101.0):

```markdown
> [!todo]+ Was this useful?
> One tap, a line of prose, or ticks — anything counts. Tomorrow's brief adjusts overnight.
> <!-- cowork:feedback-capture v=4 -->
> Useful: `[ ] yes` `[ ] no`
>
> ### Free-text feedback
>
> ```feedback
> (Type prose here — name a section to scope it, e.g. `finance: too long`.)
> ```
>
> > [!summary]- Kinds — quick ticks
> > - [ ] Chat
> > - [ ] Calendar
> > - [ ] GitHub
> > - [ ] Email
```

- **Section order is contract:** (1) the one-tap `Useful:` line, (2) the typing box (the PRIMARY channel — same `<kind>:` prefix-scoping convention as EOD), (3) ONE collapsed `Kinds — quick ticks` sub-callout carrying the old kind checkboxes demoted to garnish (one checkbox per surfaced kind, same source as the legacy shape's `{{$rating_kind_lines}}` token — ZERO new substitution tokens), (4) the marker (sentinel) `<!-- cowork:feedback-capture v=4 -->` near the top.
- **Kind semantics unchanged:** ticked kind → `{kind, ticked: true}`; surfaced-but-unticked → `{kind, ticked: false}` — identical to the legacy rating parse, now extracted via the `kind_ticks` checklist section of `parseFeedbackCapture`.
- **Idempotent re-fire** preserves tap state, typed prose, and kind-checklist ticks. **Upgrade-day transition:** the first v=4 fire over a same-day prior carrying only the LEGACY rating-block marker preserves the prior's kind ticks into the new checklist via `parseRatingCallout` — nothing is lost on upgrade day.
- **No per-item granularity, no knobs** — those remain EOD-only by design (you haven't lived the day yet on morning/midday; weekly/monthly per-item ticks stay demand-gated).

**Historical (pre-v0.101.0).** From v0.96.0 through v0.100.1 these four cadences emitted a kind-checkbox-only rating callout (`> [!todo]+ Was today useful?` + one checkbox per kind + the `<!-- cowork:rating-block schema=1.0.0 cadence=<c> day=<d> -->` marker). That shape's EMISSION is retired at v0.101.0; `parseRatingCallout` lives forever for the historical corpus (§ 5.3).

### 5.2 On EOD (v=4 — prose-first shape since v0.99.0)

EOD-review emits a prose-first feedback section (v=4 marker as of v0.101.0; the prose-first order shipped at v0.99.0): a one-tap satisfaction line and the free-text typing box render ON TOP; the per-kind Mattered/Didn't-like lists + knobs keep their exact v=2 mechanics but render below, collapsed. The v=4 EOD body is byte-comparable to v=3 modulo the marker + the cadence-neutral title (`Was this useful?`):

```markdown
> [!todo]+ Was this useful?
> One tap, a line of prose, or ticks — anything counts. Tomorrow's brief adjusts overnight.
> <!-- cowork:feedback-capture v=4 -->
> Useful: `[ ] yes` `[ ] no`
>
> ### Free-text feedback
>
> ```feedback
> (Type prose here — name a section to scope it, e.g. `finance: too long`.)
> ```
>
> > [!summary]- Chat — items
> > Mattered:
> > - [ ] [[#^item-chat-a7b3c9d|Zhenzhen PR #353 thread]]
> > - [ ] [[#^item-chat-b8c4d0e|Ben/Stale Doc DB infra]]
> >
> > Didn't like:
> > - [ ] [[#^item-chat-a7b3c9d|Zhenzhen PR #353 thread]]
> > - [ ] [[#^item-chat-b8c4d0e|Ben/Stale Doc DB infra]]
> >
> > **Fire chat:** `[ ] less` `[ ] same` `[ ] more`
>
> > [!summary]- GitHub — items
> > Mattered:
> > - [ ] [[#^item-github-d0e6f20|PR #353 awaiting review]]
> >
> > Didn't like:
> > - [ ] [[#^item-github-d0e6f20|PR #353 awaiting review]]
> >
> > **Fire GitHub:** `[ ] less` `[ ] same` `[ ] more`
```

Five capture surfaces (v0.99.0 adds the first; the order is contract):

1. **One-tap satisfaction (v0.99.0; per-cadence since v0.101.0)** — `Useful: [ ] yes [ ] no` at the very top. SATISFACTION LOG ONLY: it feeds the `totals.satisfaction[]` series (§ 7.2.7 — entries are `{day, cadence, useful}`, so up to five taps a day coexist) but does NOT count as a full engagement day — a bare tap can never demote anything (see § 9's Step 3.4 gate). `yes` → true; `no` → false; BOTH ticked → ambiguous (preserved visually, no signal); NEITHER → null.
2. **Free-text feedback (PRIMARY channel, v0.99.0 moves it to the top)** — a tagged fenced ` ```feedback…``` ` block directly under the tap. The user types prose: "stop surfacing Diana's emails", "finance: too long", "Brex bills are too noisy". A line starting with `<kind>:` (where the prefix case-insensitively matches a kind in the engagement's dispatch set) is **deterministically scoped to that section** by the nightly reconciler (`parseKindPrefixLines` — the LLM interprets intent but cannot mis-route the kind; non-matching prefixes like a person's name fall through to unmodified LLM extraction). An uprank-intent prose line scoped to a kind counts as that kind's tick; as of v0.101.0, a DOWNRANK-intent prose line scoped to a kind WITHOUT a named entity counts as that kind's skip (`applyIntentKindObservations` — renamed from `applyIntentKindTicks` because it now emits skips, not just ticks).
3. **Per-item Mattered ticks** — one checkbox per surfaced person-block / PR-row / ADO-story-row / etc. The wikilink target (`[[#^item-chat-a7b3c9d|<label>]]`) resolves to the block-ID emitted by compose-body at Step 3c. The block-ID itself renders invisibly; the user sees just `<label>` as a clickable link.
4. **Per-item Didn't-like ticks (v0.98.2)** — second checkbox row per kind sharing the SAME `^item-<kind>-<sha>` IDs as the Mattered list. Block-ID anchors are defined ONCE in the body; the rail only links. Section-context state machine in the parser: tick lines after `Mattered:` → `ticks{}`; after `Didn't like:` → `downvotes{}`.
5. **Per-kind frequency knob** — `[ ] less` / `[ ] same` / `[ ] more` per kind. Single signed signal per kind. (See § 7.2.4 for how this becomes a weight delta.)

The marker `<!-- cowork:feedback-capture v=4 -->` near the top of the callout is the parse target for `parseFeedbackCapture` in `learn-from-checks-helper.js`. The parser is **tolerant by construction**: v=4 → full parse including the non-EOD `kind_ticks` checklist section (empty `{}` on item-mode EOD bodies); v=3 → full parse including the satisfaction tap; v=2 → full parse with downvotes, satisfaction null; v=1 → parse with empty `downvotes{}` map (the entire pre-v=4 corpus stays readable forever); legacy `rating-block` → existing `parseRatingCallout` path (pre-v0.101.0 non-EOD notes).

**Tasks-plugin trailing-annotation tolerance (v0.98.2; extended to the tap line at v0.99.0).** Obsidian's Tasks plugin appends `✅ YYYY-MM-DD` to ticked lines (live in headspace 2026-06-10 EOD: `- [x] Chat ✅ 2026-06-10`). All tick regexes anchor on the prefix-through-wikilink and ignore trailing annotations — applies to `parseFeedbackCapture` tick lines, `parseRatingCallout` kind-checkbox lines (the 4 non-EOD cadences also get the suffix tolerance as a parse-side fix), AND the v=3 `Useful:` tap line.

**Idempotent re-fire — richer than v0.96.0.** When EOD re-fires on the same day, `compose-feedback-capture-helper.js`'s `_parsePrior` reads the prior file's `cowork:feedback-capture` block (v=1 through v=4) and preserves:
- Tap state on the `Useful:` line (v0.99.0; a v=2/v=1 prior renders the tap fresh-unticked)
- `[x]` state per item-ID in BOTH the Mattered AND Didn't-like lists (v0.98.2)
- Knob position per kind (which `[x]` is set on the `less / same / more` row)
- Free-text content (the prose stays verbatim)
- **Ambiguous-knob guard:** if the user has `[x] less [x] more` for a kind (transitioning their opinion mid-day), the rendered output preserves both `[x]` AND the sidecar's `feedback_capture.ambiguous_knobs[]` array gains the kind name — so the reconciler treats it as no-signal rather than computing `(-1) + (+1) = 0`.
- **Ambiguous-items guard (v0.98.2):** if the user ticks an item in BOTH the Mattered AND Didn't-like lists, the UI state is preserved AND the sidecar's `feedback_capture.ambiguous_items[]` array gains the item-ID — ingest treats as no-signal (mirrors ambiguous-knob).

### 5.3 The marker (sentinel) system — one emitted marker, two parsed forever

v0.101.0 ended the two-marker emission era: ALL FIVE cadences now emit the `feedback-capture` marker (v=4). The legacy `rating-block` marker is **historical corpus only** — nothing emits it anymore, but it stays parseable forever:

- **Emission:** `<!-- cowork:feedback-capture v=4 -->` on every brief (one shape, § 5.1/§ 5.2).
- **Parse:** `parseFeedbackCapture` handles v=1 through v=4 (`FEEDBACK_SENTINEL_RX` matches `v=(\d+)` generically, and the parser degrades gracefully per version: v=4 adds the non-EOD kind-checklist section, v=3 added the satisfaction tap, v=2 added downvotes, v=1 is ticks/knobs/prose only). `parseRatingCallout` + `RATING_SENTINEL_RX` keep parsing the pre-v0.101.0 rating-block corpus (with v0.98.2 Tasks-suffix tolerance on kind-checkbox lines). Both functions are exported from `learn-from-checks-helper.js` and live alongside each other forever — the reconciler's Step 3 parses BOTH marker families across yesterday's notes.
- **Write-guard (either-marker, v0.101.0):** `write-atomic-note-helper.js` carries a NEW `FEEDBACK_SENTINEL` const alongside `RATING_SENTINEL`; Guard 2 passes when the body carries EITHER marker. Gate condition unchanged (`surfaced_kinds_for_rating.length > 0 && learning_enabled !== false`); the failure token stays `missing-rating-callout` (downstream OI prose references it). Rating-marker acceptance is **permanent legacy tolerance, not a deprecation window**. The either-marker guard also resolved STRUCTURALLY a v0.99.0-era discrepancy: eod-review.md Step 8.5 said to pass `surfaced_kinds_for_rating`, yet EOD bodies carried no rating-block marker — all five orchestrators now pass the array uniformly and the guard accepts the marker every cadence actually emits.

Historical context: v0.98.1 + v0.98.2 deliberately kept the rating-block marker on the four non-EOD cadences (smallest reversible diff; per-item ticks fit EOD's retrospective frame). v0.101.0 expanded the feedback-capture shape ADDITIVELY instead of narrowing anything — the kind checkboxes survive as the collapsed checklist, so no capture power was retired. Per-item ticks on weekly/monthly remain queued (demand-gated).

**v0.98.2 regression restored — reconciler now parses BOTH sentinels.** v0.98.1's EOD sentinel switch (rating-block → feedback-capture v=1) had silently broken reconciler EOD signal — `reconcile-cowork.md` Step 3 grepped only `cowork:rating-block`, so post-v0.98.1 EOD notes contributed ZERO signal to per-kind learning. v0.98.2's Step 3 extension parses BOTH `rating-block` (4 non-EOD cadences) AND `feedback-capture` (v=1 + v=2 EOD) sentinels — restoring EOD signal to per-kind learning AND extending into per-entity learning under each kind.

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
3. **Touch the feedback section (Rail L) at the bottom.** This is the explicit feedback gesture — as of v0.101.0 the same v=4 shape on every brief:
   - On EVERY cadence: tap `Useful: yes/no` and/or type prose into the typing box (the PRIMARY channel)
   - On EOD additionally: tick the per-item boxes that mattered / didn't, set the per-kind frequency knob to nudge
   - On the four non-EOD cadences additionally: tick the collapsed kind checklist (the old kind-level boxes, demoted to garnish)
4. **Save the file.** Obsidian persists. The next cron fire (the reconciler) sees the updated atomic note.

That's it. No slash commands. No buttons to click. No external UI. The Markdown is the interface; the check-marks are the signal.

### 7.2 What the reconciler does (cowork:learn-from-checks — currently shipping)

The reconciler is itself a scheduled job, **run as one of the cron cadences**. It currently fires daily (warmup phase) or weekly (post-warmup) — see `reconcile-cowork.md` orchestrator-instructions.

When it fires:

#### 7.2.1 Scan atomic notes

`learn-from-checks-helper.js` `scanAtomicNotes({ dir, engagement_id, since_day })` walks the atomic-note directory tree, opens each `.md`, calls `parseFeedbackCapture(md)` (feedback-capture notes — all five cadences as of v0.101.0) or `parseRatingCallout(md)` (legacy rating-block notes), and returns an observation set:

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

#### 7.2.3 Warmup behavior (v0.99.0 — engaged-day-driven graduation)

`evaluateWarmup(per_kind_state, days_since_first, opts)`:
- **Graduation rule (v0.99.0):** a kind stays in `warmup: true` until BOTH `totals.engaged_days.length >= 7` AND the kind's `ticks + skips >= 7`. Calendar days NO LONGER graduate — the caller passes the engaged-day count (not days-since-first) as the second argument; `evaluateWarmup`'s code is unchanged from v0.96.0. Because observation counters only grow on ENGAGED days (§ 9 Step 3.4 gate) and the schema-4 migration zeroed silence-built skips (§ 7.2.6), both counts are silence-free by construction: **silence cannot build authority**.
- During warmup, downstream consumers (the orchestrators' Step 2 priority loop) treat the weight as advisory only — they fire the kind regardless of weight, to accumulate signal.
- After graduation, the weight becomes authoritative: weight ≥ 1.20 promotes the kind earlier in the priority loop; weight ≤ 0.50 demotes (still fires, but ordered last; very low weights may be skipped entirely on quiet days).
- `totals.warmup_until` (the v0.96.0 date-based driver) is retired at schema 4 — kept for shape tolerance, set null.

#### 7.2.4 Apply v0.98.1 frequency-knob signal (SHIPPED v0.98.2)

The per-kind frequency knobs from the EOD Rail L become direct weight deltas added to the formula's output (SHIPPED v0.98.2 — the v0.98.1 capture surface now feeds the reconciler):

```
knob = "less"  → w_new := w_new - 0.05
knob = "same"  → w_new unchanged
knob = "more"  → w_new := w_new + 0.05
knob = "ambiguous" → no signal (skipped)
```

These deltas are applied AFTER the v0.96.0 formula + clamp pass, then re-clamped to [0.10, 3.00]. They're "direct user intent" — a stronger signal than the formula's gradual ticks-driven movement. Implementation in `ingest-feedback-helper.js` (NEW v0.98.2), wired into `reconcile-cowork.md` Step 3.5 (deterministic rollup).

#### 7.2.5 Write the result (v0.98.2 — schema 3, user-preferences.md frontmatter)

The new state is written **in-place** to the `learned_weights:` block of `spice/cowork/context/user-preferences.md` FRONTMATTER. **The location is NOT `spice/cowork/memory/<engagement>/learned_weights.json`** — that was an aspirational sketch in earlier drafts of this doc. Absorption against live consumer vaults (headspace + accuris) at the v0.98.2 brainstorm confirmed the file lives in user-preferences frontmatter and the reconciler already owns this write path (block-scoped `.bak`-first rewrite).

Schema 3 shape (SHIPPED v0.98.2 — nested per-kind entity maps; in-place additive migration from schema 2; legacy `"1.1.0"` and missing-version shapes still normalize cleanly):

```yaml
learned_weights:
  schema_version: 3
  updated_by: cowork:reconcile-cowork
  engagements:
    headspace:
      per_kind:
        chat:
          weight: 1.150          # existing v0.96.0 per-kind formula, unchanged
          ticks: 12
          skips: 4
          warmup: false
          last_updated: 2026-06-12
          per_person:
            "Zhenzhen Su": { weight: 1.050, ticks: 1, downvotes: 0, last_updated: 2026-06-12 }
          per_channel:
            "Dev Enablement Channels": { weight: 0.900, ticks: 0, downvotes: 1, last_updated: 2026-06-12 }
          per_topic: {}
        github:
          weight: 0.820
          ticks: 5
          skips: 8
          warmup: false
          last_updated: 2026-06-12
          per_person: {}
          per_channel: {}
          per_topic: {}
      totals:
        notes_scanned: 89
        notes_with_any_tick: 67
        scanned_days: ["2026-06-10", "2026-06-11", "2026-06-12"]
        feedback_ingested_days: ["2026-06-12"]
        warmup_until: 2026-06-18
    life: { ... }
    accuris: { ... }
```

The schema is **nested per-engagement** (introduced at v0.96.1 / Rail M; promoted to schema 3 at v0.98.2 with per-kind entity nesting). Each engagement has its own weight space — your accuris weights don't influence your life weights. Each kind has its own entity space — your chat-person weights don't influence your email-person weights. Migration is in-place + additive: `per_person/per_channel/per_topic` maps initialize empty; nothing existing is dropped. `_normalizeLearnedWeights` (v0.98.2) tolerates on-disk `schema_version: 2` (headspace), missing version (accuris), legacy `"1.1.0"` (helper-era), AND `3`.

**Entity weight math (v0.98.2):** start 1.00; clamp [0.10, 3.00]; banker's rounding (3 places); +0.05 per Mattered tick; −0.10 per Didn't-like tick (rarer + stronger signal); light daily decay TOWARD 1.00 — explicitly `w' = 1.00 + (w − 1.00) × 0.995` (NOT `w × 0.995`, which would decay toward zero) — applied once per ingest run to every entity under the engagement, idempotent via `totals.feedback_ingested_days[]`. Free-text floor-set ("stop surfacing X's emails") bypasses deltas (direct `weight = 0.10` with audit). Entity warmup analog: advisory until the entity has ≥3 observations. **As of v0.99.0, entity decay (like everything else in the weight pipeline) runs ONLY on ENGAGED days** (§ 9 Step 3.4 gate).

#### 7.2.6 Schema 4 (v0.99.0 — engaged days + satisfaction series + silence-reset migration)

`learned_weights` bumps schema 3 → 4 via `normalizeLearnedWeightsV4` (ingest-feedback-helper.js; tolerates on-disk 2 / missing / `"1.1.0"` / 3 / 4 — same block-scoped `.bak`-first write contract on `user-preferences.md` frontmatter). The `per_kind` shape is UNCHANGED from schema 3; `totals` is where schema 4 lives:

```yaml
learned_weights:
  schema_version: 4
  engagements:
    <eng>:
      per_kind: { ... unchanged schema-3 shape (weights, ticks, skips, warmup,
                  per_person/per_channel/per_topic) ... }
      totals:
        notes_scanned: N
        notes_with_any_tick: N
        scanned_days: [...]            # unchanged — every PROCESSED day (all three day classes)
        engaged_days: [...]            # NEW — rolling; ENGAGED days only (the graduation driver)
        feedback_ingested_days: [...]  # unchanged idempotency key
        satisfaction: [                # NEW — rolling 30 entries; same-day re-log overwrites
          { day: "2026-06-12", useful: true },
        ]
        warmup_until: null             # retired at schema 4 (kept for shape tolerance)
```

- **`engaged_days[]`** records only days classified ENGAGED by the § 9 Step 3.4 gate. It is the graduation input (§ 7.2.3) — `scanned_days[]` keeps recording every processed day so the re-run guard stays gate-independent (a re-fired tap-only/silent day is a clean no-op).
- **`satisfaction[]`** is the rolling-30 yes/no series fed by the v=3 one-tap via `appendSatisfaction` (same-day overwrite; ambiguous dual-tap or no tap → no entry). It is the platform's first cheap KPI and the primary input for the v0.99.1 doctor's self-grading digest.
- **ONE-TIME silence-reset migration (3 → 4, applied at the first post-deploy ingest).** Per engagement, per kind: **keep** `weight` and `ticks` (real signal), **zero** `skips` (silence-contaminated under the pre-gate semantics, where every surfaced-but-unticked kind counted as a skip), **force** `warmup: true`. `engaged_days[]` + `satisfaction[]` initialize empty. Effect: a vault with sparse real signal keeps its ticks but sheds all silence-built demotion pressure and re-enters warmup with a 7-engaged-day runway. The migration is idempotent — the `schema_version` stamp gates it, with `Number()` coercion so a string `"4"` (plausible after LLM/YAML round-trips) never re-triggers the reset. This is BY DESIGN, not data loss: the zeroed skips were never user signal.

#### 7.2.7 Schema 5 (v0.101.0 — per-cadence satisfaction)

`learned_weights` bumps schema 4 → 5 via `normalizeLearnedWeightsV5` (ingest-feedback-helper.js; extends the tolerance chain to on-disk 2 / missing / `"1.1.0"` / 3 / 4 / 5, string-or-number versions with `Number()`-coerced gates; deep-copies everything returned; same block-scoped `.bak`-first write contract). The 4 → 5 step is **PURELY ADDITIVE — no skip-zeroing, no warmup reset, no counter changes** (unlike the 3 → 4 silence-reset): satisfaction entries gain a `cadence` field, and schema-4-era `{day, useful}` entries normalize to `cadence: "eod-review"` (the only cadence that had a tap):

```yaml
satisfaction:                     # window trims by DAY (30); belt-and-suspenders cap: 200 entries
  - { day: "2026-06-13", cadence: "morning-briefing", useful: true }
  - { day: "2026-06-13", cadence: "eod-review", useful: false }
```

- **Per-cadence entries.** Up to five taps a day coexist — one per cadence; same-(day, cadence) re-log overwrites (`appendSatisfaction(totals, day, useful, {cadence})`, `opts.cadence` required for new writes). The doctor (next cycle) can grade each cadence separately ("morning trends yes, midday trends no").
- **Prose wins over tap.** A global-sentiment prose line in the typing box ("great brief today" — the NEW `satisfaction` intent, no kind required; `proposed_target: satisfaction-series`) writes to the same channel for the note's cadence; on disagreement with that note's tap, the typed word wins — it is higher-intent than a tap. Global sentiment moves satisfaction + engagement ONLY; kind weights move only on kind/entity-scoped prose.
- **Per-note ingest + dedup (v0.101.0).** The reconciler extracts intents from up to five typing boxes per day, each tagged `source_cadence` (recorded in `feedback-deltas.md` audit lines + voice-proposal `source:` fields — data accrual for the doctor; no per-cadence rendering machinery yet). An accepted intent applies at most once per (day, intent, kind, entity) across ALL of yesterday's notes — "github: too much" typed at midday AND EOD is one delta; both occurrences appear in the audit log (second tagged `[pending] dedup`).
- **Downrank-skip symmetry (v0.101.0).** Downrank prose scoped to a kind WITHOUT a named entity counts as that kind's SKIP — the mirror of v0.99.0's uprank-counts-as-tick. Downrank naming an entity keeps the entity-delta-only path (a complaint about one person must not skip the whole kind). Implemented by `applyIntentKindObservations` (renamed from `applyIntentKindTicks` — it now emits skips, not just ticks).
- Graduation rules untouched (`engaged_days.length >= 7` AND `ticks + skips >= 7`); `classifyEngagementDay` semantics unchanged — five taps without other signal across several notes is still TAP-ONLY.

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

**Loop 3 — Microscopes evolve.** Microscopes (`spice/cowork/prompts/per-mcp/<kind>/microscope.md` — engagement-agnostic per vault) carry the per-kind output-shape contract. Today they're hand-authored. v0.98.2's reconciler APPENDS to microscope `## What matters` sections based on free-text feedback — never rewrites, just appends. The user prunes later. Over months, the microscopes become a hand-curated representation of the user's preferences distilled through the LLM's understanding of their prose feedback.

**The key invariant: nothing in the system overwrites the user's authored content silently.** Numeric weights update directly (the user can read them in `learned_weights.json` and edit them if they want). Microscope `what_matters` strings append (the user prunes). Voice/personality changes are PROPOSED, not auto-applied (v0.98.2 surfaces them in the next morning brief as a callout: "Voice tweak proposed: [...]. Apply via /cowork apply-voice-deltas?"). Coverage gaps land in a separate file (`spice/cowork/memory/<engagement>/coverage-queue.md`) that the user reviews on their schedule.

## § 9 — The feedback loop — SHIPPED v0.98.2

The compounding-assistant loop is **LIVE as of v0.98.2 (2026-06-11)**. v0.98.1 shipped the capture surface; v0.98.2 shipped the reconciler ingest, the v=2 downvote list, the voice-proposal tick-to-approve mechanism, and `learned_weights` schema 3 (nested per-kind entity maps). **v0.99.0 (2026-06-12) made the loop CORRECT on sparse signal** — the Step 3.4 engagement gate (below) ensures only ENGAGED days move weights, so silence never demotes and lazy taps never count as judgment. **v0.101.0 (2026-06-13) put the channel EVERYWHERE** — v=4 capture on all five cadences, per-cadence satisfaction (schema 5), and per-note prose ingest with dedup. The user's 2026-06-10 vision is now fully satisfied across the v0.98.x arc:

> "another job took what i liked, what i didn't like, my feedback, then updated the relevant files so that all scheduled jobs would then adjust the next day"

### 9.1 Architecture overview

The ingest pipeline lives inside the existing nightly `reconcile-cowork` cadence (03:00 local, per-engagement, daily forever). No new scheduled job; no contract bump (0.35.1 holds). Architectural posture preserved: **deterministic helpers carry shape; OI prose carries voice; structural rules WIN on conflict.** The reconciler stays pure-MCP at fire time (per its v0.97.1 posture) — `ingest-feedback-helper.js` is the testable reference implementation whose contract the OI re-states inline. The LLM proposes (free-text intents); the deterministic layer disposes (validation rules + clamps + allowlisted write-targets).

```
              5 orchestrators (each fire)                           3:00am reconciler (cowork:reconcile-cowork)
                          │                                                        │
            Step 4: composeFeedbackCapture v=4                 Step 3: parse EVERY note
              (one shape: tap + typing box on top;               feedback-capture v=1..v=4 (all 5 cadences) +
               EOD per-item lists; non-EOD ONE                   legacy rating-block (pre-v0.101.0 corpus)
               collapsed kind checklist)                                       │
                          │                                    Step 3.4 (v0.99.0): classify the day per engagement
            Step 8: sidecar — EOD 1.4.0                          ENGAGED   — ≥1 item/kind tick, knob ≠ same,
              (sentinel_version "v=4"; items[]                               or non-empty typing box (ANY note)
               registry); other 4 gain slim                      TAP-ONLY  — taps only (even ×5) → satisfaction
               feedback_capture {sentinel_version,                           appends (13f, per-cadence), NOTHING else
               kinds_listed}                                     SILENT    — audit line + totals bookkeeping only
                          │                                                    │ (ENGAGED days only below)
                          ▼                                    Step 3.5: deterministic rollup
              user taps + types + (optionally) ticks             cowork:ingest-feedback →
              on ANY of the day's five briefs                    ingest-feedback-helper.js contract
                                                                 (kind obs — v=4 checklist ticks join the same
                                                                  channel as EOD mattered-ticks; entity + knob
                                                                  deltas EOD-only; <kind>: prefix lines kind-bound)
                                                                               │
                                                               Step 3.6: free-text intent extraction PER NOTE
                                                                 (INLINE LLM; schema-validated by helper rules;
                                                                  intents tagged source_cadence; dedup ONE
                                                                  application per (day, intent, kind, entity);
                                                                  uprank-prose = kind tick; downrank-kind-no-
                                                                  entity = kind skip; NEW satisfaction intent →
                                                                  satisfaction-series, prose WINS over tap)
                                                                               │
                                                               Step 4-5: apply learned_weights
                                                                 schema 5 in-place; clamp; .bak
                                                                 (decay + warmup run ONLY here — gated)
                                                                               │
                                                               Step 5.5: apply non-weight deltas
                                                                 microscope appends · voice proposals ·
                                                                 coverage queue · feedback-deltas audit log
                                                                 (+ [satisfaction] audit tag)
                                                                               │
                                                               Step 5.6: voice-proposal approvals
                                                                 (parse yesterday's MB callout ticks → apply)

              6:30am morning-briefing: Step 2 consults per-kind + per-entity weights;
              renders pending voice-proposals callout (tick-to-approve)
```

### 9.2 The pipeline in detail

1. **Trigger.** Existing reconciler cron (03:00 local, per-engagement, daily — the v0.97.1 cadence). Reads yesterday's `.md` notes for the engagement.

2. **Step 3 — parse EVERY note (per-cadence sweep, v0.101.0).** All five cadences emit the `feedback-capture` marker as of v0.101.0; the reconciler parses each of yesterday's notes via `parseFeedbackCapture` (v=1 through v=4 — v=4 adds the non-EOD `kind_ticks` checklist section; v=3 added the one-tap satisfaction collection: yes / no / ambiguous / null) and falls back to `parseRatingCallout` for legacy `rating-block` notes (pre-v0.101.0 corpus; Tasks-suffix tolerance on kind lines). Kind-level observations join one channel regardless of source: **kind tick = ≥1 mattered-tick in that kind (EOD), ≥1 ticked checklist box (non-EOD v=4), OR ≥1 uprank-intent prose line scoped to it; kind skip = surfaced-but-unticked, OR a downrank-intent prose line scoped to the kind with no named entity (v0.101.0 symmetry, `applyIntentKindObservations`).** Per-item/knob mechanics remain EOD-only.

2.5. **Step 3.4 (v0.99.0) — classify the day per engagement (THE GATE).** Deterministic contract (`classifyEngagementDay`, restated inline in the OI per the reconciler's pure-MCP posture):
   - **ENGAGED** — any note for that engagement/day shows ≥1 item tick (Mattered or Didn't-like), ≥1 kind-checkbox tick (v=4 checklist or legacy rating-block), ≥1 knob ≠ `same`, or a non-empty typing box. The FULL pipeline below runs: observations (ticks AND skips), entity deltas, knob deltas, decay, warmup progress, `engaged_days[]` append.
   - **TAP-ONLY** — the only signal is `Useful:` yes/no taps (even all five notes tapped — multi-note taps without other signal are still TAP-ONLY; semantics UNCHANGED at v0.101.0). Satisfaction appends (`totals.satisfaction[]`, per-cadence) + `[satisfaction]` audit lines ONLY — no `updateWeights` call, no decay, no warmup, no `engaged_days[]` entry. The `per_kind` subtree is untouched.
   - **SILENT** — nothing. Audit section still written with the `no feedback signal` line + totals bookkeeping; no weight pipeline. (A pre-schema-4 weights file still gets the one-time normalize/migration on first touch — the silence-reset must not wait for an engaged day.)
   The gate lives at the CALL SITE because `updateWeights` decays unconditionally inside (2%/day toward 1.00) — passing empty observations would still decay every kind. **Silence = no signal, ever:** a never-ticking user stays advisory-forever; the day the user DOES engage, that day's skips become meaningful ("I looked, finance didn't matter today").

3. **Step 3.5 — deterministic rollup (ENGAGED days only; per `ingest-feedback-helper.js` contract).** `<kind>:` prose-prefix lines (e.g. `finance: too long`) arrive kind-bound via `parseKindPrefixLines` — deterministic section scoping the LLM cannot override.
   - **Per-item Mattered tick** → entity delta **+0.05** on the item's person/channel/topic under its kind (identity via the sidecar's 1.2.0 `items[]` registry; wikilink-label fallback for v=1-era sidecars; kind-only rollup fallback when identity resolution fails).
   - **Per-item Didn't-like tick** → entity delta **−0.10** (dislikes are rarer + stronger signal) AND counts toward the kind-skip side of the kind-level formula.
   - **Frequency knobs** → direct **±0.05** per-kind delta applied AFTER the v0.96.0 formula + re-clamped. `ambiguous` → no signal.
   - **Ambiguous items** (sidecar `ambiguous_items[]` flag — user dual-ticked Mattered AND Didn't-like) → no entity signal.
   - **Idempotency** via `totals.feedback_ingested_days[]` alongside existing `scanned_days[]`.

4. **Step 3.6 — free-text intent extraction (INLINE LLM pass, PER NOTE; ENGAGED days only).** No separate API call, no model pin — the reconciler IS an LLM session (its pure-MCP posture). As of v0.101.0 the pass runs over up to five typing boxes per day; every extracted intent is tagged with the `source_cadence` of the note whose box produced it (recorded in `feedback-deltas.md` audit lines + voice-proposal `source:` fields). Prefix-scoped lines arrive kind-bound (Step 3.5) — the LLM classifies intent but cannot re-scope the kind. The OI carries a strict structured-intent schema:

   ```json
   [{ "intent": "uprank | downrank | voice_correction | coverage_gap | frequency | satisfaction | other",
      "kind": "<kind, when scoped>", "entity": "<person/channel/topic, when named>",
      "source_quote": "<verbatim substring of the user's prose>",
      "proposed_target": "learned_weights | microscope:<kind> | voice-proposals | coverage-queue | satisfaction-series",
      "confidence": "high | medium | low" }]
   ```

   The deterministic helper's validation rules (re-stated in OI) REJECT: unknown intent / missing or non-verbatim `source_quote` / target outside the five-value allowlist / `learned_weights` intent naming no kind / `low` confidence (logged pending, not applied). The NEW `satisfaction` intent (v0.101.0) requires NO kind — global sentiment routes to the `satisfaction-series` target for the note's cadence and WINS over that note's tap on disagreement; it moves satisfaction + engagement ONLY, never kind weights. **Dedup (v0.101.0):** an accepted intent applies at most once per (day, intent, kind, entity) across ALL of yesterday's notes — dedup at the disposition layer; both occurrences audit-logged (second tagged `[pending] dedup`). Hard suppression intents ("stop surfacing X's emails") → direct floor-set `weight = 0.10` on the named entity under the named kind.

5. **Steps 4-5 — apply learned_weights schema 5 in-place (signal sub-steps ENGAGED days only).** Same `user-preferences.md`, same `.bak`-first rewrite of ONLY the `learned_weights:` block. `normalizeLearnedWeightsV5` tolerates all on-disk shapes (2, missing, "1.1.0", 3, 4, 5); the 4 → 5 step is purely additive (see § 7.2.7); the one-time 3 → 4 silence-reset still runs on first touch of pre-schema-4 files regardless of day class (see § 7.2.6). Per-entity weight math (see § 7.2.5) + the v0.96.0 kind formula + decay + warmup graduation (engaged-day-driven, § 7.2.3) run ONLY on ENGAGED days; totals bookkeeping (notes_scanned, scanned_days) runs on all day classes; the satisfaction append (sub-step 13f) runs PER NOTE with a boolean tap, on ANY day class, tagged with the note's cadence (per-cadence entries, same-(day, cadence) overwrite, day-window trim).

6. **NEW Step 5.5 — apply non-weight deltas.**

   | Target | Posture | Path |
   | --- | --- | --- |
   | Microscope `## What matters` | **APPEND-only** — one dated line per delta with source quote; never rewrites; user prunes later. If the kind has no microscope file → delta parks as `pending` (this cycle never CREATES microscope files) | `spice/cowork/prompts/per-mcp/<kind>/microscope.md` |
   | Voice/personality corrections | **PROPOSED only** — durable entry in `voice-proposals.md` (id, exact append text, target file, source quote, status, expiry = +7 days) | `spice/cowork/memory/<eng>/voice-proposals.md` |
   | Coverage gaps | Queued for user-schedule triage | `spice/cowork/memory/<eng>/coverage-queue.md` |
   | Everything (applied / proposed / rejected / pending) | **Append-only audit log** — date · delta · old → new · source quote · target | `spice/cowork/memory/<eng>/feedback-deltas.md` |

   All four files are **runtime-created by the reconciler session via Obsidian MCP** when absent (frontmatter `type: cowork-feedback-deltas` etc.) — they are NOT installer-materialized and gain NO `files[]` entries (Safeguard 3 stays green by construction).

   Audit entry format (one section per run):

   ```markdown
   ## 2026-06-12 (run-id: fd-20260612-0300)
   - [weights] chat.per_person."Zhenzhen Su" 1.000 → 1.050 (+0.05 mattered ^item-chat-a7b3c9d "Zhenzhen PR #353 thread")
   - [weights] email.per_person."Diana" 1.000 → 0.100 (floor-set; source: "stop surfacing Diana's emails")
   - [knob] chat +0.05 (Fire chat: more)
   - [microscope] chat APPEND: "<line>" (source: "<quote>")
   - [voice] PROPOSED vp-20260612-1 → voice-proposals.md (source: "<quote>")
   - [coverage] QUEUED: "<gap>" → coverage-queue.md
   - [rejected] intent other/"<...>" — target outside allowlist
   ```

7. **NEW Step 5.6 — voice-proposal approval sweep.** Parse yesterday's morning-briefing `.md` for the voice-proposals callout. Per proposal line: `[x]` → apply the exact append text to the proposal's target file (append-only), mark `applied` in `voice-proposals.md`, audit-log. Untouched + past expiry → mark `expired` (inert, visible in the file). Proposals named in free-text as rejected ("no, don't change that") → `dismissed`.

### 9.3 Morning-briefing voice-proposals callout

Rendered ONLY when `voice-proposals.md` has `pending` entries (collapsed; compact):

```markdown
> [!note]- Voice proposals pending (1)
> Tick to approve — applies overnight. Untouched proposals expire 7 days after proposal.
> - [ ] Stop numbered marching orders in chat sections — append to headspace/brand-voice.md <!-- cowork:voice-proposal id=vp-20260612-1 -->
```

The per-line HTML-comment id is the deterministic parse key (same pattern as every other cowork sentinel). Suffix-tolerant tick parsing applies here too.

### 9.4 Consumption — how tomorrow's brief actually changes

One new rule in the shared microscope/voice clause + Step 2 of morning-briefing and eod-review OIs: when composing per-kind blocks, consult `per_kind.<kind>.per_person/per_channel/per_topic`:

- **≥ 1.20** → lead the section (surface first, fuller rendering)
- **≤ 0.50** → cap to one line
- **≤ 0.25** → omit, UNLESS the item carries a hard signal (direct @-mention, money movement, inner-circle going-dark per existing microscope contracts)
- Entities in warmup (<3 observations) → advisory only

Structural rules still WIN over voice on conflict; the thresholds are OI prose consumed at gather/compose time, deliberately NOT helper-enforced (rendering judgment is the LLM's lane; the WEIGHTS are deterministic).

### 9.5 Carry-forward (post-v0.101.0)

- **`cowork:doctor` (NEXT — displaced ONE cycle by v0.101.0; shape stays locked).** Embedded in the nightly reconciler; 4 checks locked at the 2026-06-11 brainstorm: wrapper/sidecar version-drift vs installed; sidecar schema conformance over a rolling window (the v0.98.2 `coverage_gap: []` write-guard-bypass finding); align-audit staleness; self-grading digest — **satisfaction-series trend, NOW PER-CADENCE** (the v0.101.0 KPI upgrade: grade morning vs midday vs EOD separately) + top entity-weight movers. Anomalies → one collapsed morning-brief callout; details → reconciler log.
- **Per-item ticks on weekly / monthly cadences.** Still demand-gated — the v=4 checklist gives those cadences tap + prose + kind ticks; per-item identity is the remaining gap.
- **Per-cadence rendering knobs.** `source_cadence` is data accrual only this cycle; gated on doctor evidence that a cadence-level rendering fix is needed.
- **Cross-machine lockfiles + path-relative wrappers.** Vision § 2 dimension 8 (Cross-machine consistency); bundled, queued behind doctor.
- **Entity-weight + satisfaction live-grading.** The platform can now grade itself empirically per cadence — entity maps and the per-cadence satisfaction series populate post-deploy; formula-constant tuning stays data-gated until the doctor reads them.

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
| **v0.98.0** | Synopsis-density rewrite — predictive lead, collapsed per-kind, closing removed | SHIPPED 2026-06-10 |
| **v0.98.1** | Questionnaire expansion + free-text capture — per-item ticks + knobs + fenced free-text + sentinel v=1 | SHIPPED 2026-06-11 |
| **v0.98.2** ⭐ | **Feedback-loop closure (THIS CYCLE)** — Rail L v=2 (+ Didn't-like list); reconciler ingest steps 3/3.5/3.6/5.5/5.6; learned_weights schema 2 → 3 nested per-kind entity maps; voice changes PROPOSED + tick-to-approve in next morning brief; sidecar 1.2.0 with items[] registry | **SHIPPED 2026-06-11** |
| **v0.98.2.x candidates** | `cowork:doctor` minimum scope (sidecar conformance scan); per-item ticks on weekly/monthly cadences; strict-mode adoption for helpers (workshop-wide hygiene) | Queued (PATCH-sized) |
| **v0.99.0+** | Cross-machine wrappers + lockfile semantics; `cowork:doctor` full scope (also grade learned_weights movement; embed cadence vs separate fire); entity-weight live-grading after 7 days of dogfood; v0.95.1-migrator carry-forward | NEXT (queued); 4 open brainstorm questions at `Docs/prompts/2026-06-11-post-v0.98.2-next-cycle-handoff.md` |

The substance arc (v0.98.x) is the most directly user-visible direction since the platform's launch. Density first (v0.98.0), capture surface second (v0.98.1), ingest + write-side third (v0.98.2). **The v0.98.x arc is now CLOSED — the compounding-assistant loop is LIVE.** The platform now shifts focus to observability + cross-machine durability (v0.99.0+).

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
- **Specific microscope contracts per kind.** See `spice/cowork/prompts/per-mcp/<kind>/microscope.md` (engagement-agnostic per vault — NOT a per-engagement `context/<eng>/microscopes/` path; that was an aspirational sketch in earlier drafts).
- **The MCP integration layer (apple-mcp, Brex, Gmail, Calendar, Slack, Teams, Drive, Context7, Playwright).** See per-MCP integration docs + `user-preferences.mcps`.
- **Smart Connections / semantic retrieval mechanics.** See its own dedicated cycle docs (v0.93.x family).
- **Workshop self-install (dogfood loop).** See `Docs/agent-guides/build-test-verify.md`.

These are tangential to the **front-to-end + feedback loop** focus of this doc. Each has its own canonical reference.
