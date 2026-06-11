---
purpose: |
  Canonical orchestrator instructions for cowork:reconcile-cowork.
  Nightly reconciler — walks atomic notes + sidecars via Obsidian MCP,
  parses rating callouts, updates learned_weights frontmatter, runs
  heartbeat check, backfills missing sidecars, appends reconciler-log.
  Pure MCP — no Node helper at fire time.
schema_version: "1.0.0"
cadence: reconcile-cowork
---

{{shared.anti_delegation_clause}}

{{shared.prelude_block}}

# Cowork orchestrator — reconcile-cowork

## Substitution tokens

**Static (sync time):** `{{$engagement_id}}`, `{{$engagement_label}}`, `{{$timezone}}`, `{{$workshop_version}}`, `{{$cowork_version}}`, `{{$contract_version}}`, `{{$cadence}}` (fixed: `reconcile-cowork`).

**Fire-time (literal):** `{{$today_date}}`, `{{$today_weekday}}`, `{{$today_dirpath}}`, `{{$today_ymd_compact}}`, `{{$yesterday_date}}`, `{{$yesterday_dirpath}}`.

## Steps

### Step 0 — Pre-flight

1. Confirm `mcp__<obsidian>__obsidian_get_file_contents` is connected.
2. Read `spice/cowork/context/vault-config.md` frontmatter. Locate engagement record matching `id: "{{$engagement_id}}"`. Capture engagement (including `cadences` map).
3. Resolve today's date in `{{$timezone}}` (`today_date`/`today_weekday`/`today_dirpath`/`today_ymd_compact`); ALSO resolve `yesterday_date` (today - 1 day) and `yesterday_dirpath` for the scan target.

### Step 1 — List yesterday's atomic notes

4. Invoke `mcp__<obsidian>__obsidian_list_files_in_dir` on `spice/cowork/daily/{{$yesterday_dirpath}}/`. Capture lists of `.md` files + `.cowork.json` files.
5. If the directory doesn't exist (no atomic notes fired yesterday): SKIP to Step 6 (heartbeat check); reconciler-log will note "no notes scanned".

### Step 2 — Backfill missing sidecars

6. For each `.md` file in yesterday's directory:
   a. Check if companion `.cowork.json` exists at same dirpath.
   b. If MISSING: read the `.md` via `obsidian_get_file_contents`. Parse frontmatter (`type:` + `engagement_id:`). If `engagement_id != "{{$engagement_id}}"`, skip (not our engagement's note).
   c. Extract `surfaced_kinds[]` from `> [!example]+` and `> [!warning]+` callout headers via heuristic kind-inference (calendar/email/chat/messages/finance/projects/threads/github/ado).
   d. Compose sidecar JSON: `generated_by: "<orig generator> (reconciler-backfill@0.97.1)"`, `cadence` per `CADENCE_BY_TYPE`, `frontmatter` mirror, `surfaced_kinds[]` as computed, `surfaced_items: []`, `plan_dispatch.mode: "reconciler-backfill"`.
   e. Write sidecar via `obsidian_put_content`.

### Step 3 — Parse rating + feedback callouts

7. For each `.md` matching `{{$engagement_id}}`:
   a. Read content (or reuse from Step 6).
   b. Detect the sentinel:
      - `<!-- cowork:rating-block schema=1.0.0 cadence=<X> day=<Y> -->` → kind-checkbox
        parse (sub-step c). The 4 non-EOD cadences emit this shape.
      - `<!-- cowork:feedback-capture v=1 -->` or `v=2` → rich parse (sub-step d).
        EOD emits this shape (v0.98.1+).
      - Neither → 0 observations for this note.
   c. Kind-checkbox parse: scan the `> [!todo]+ Was today useful?` callout for
      `> - [x] Kind` / `> - [ ] Kind` lines. The kind is the FIRST whitespace
      token of the label, lowercased — the Obsidian Tasks plugin appends
      `✅ YYYY-MM-DD` to ticked lines (`Chat ✅ 2026-06-10` → kind `chat`).
      Build observations `{ kind, ticked }`.
   d. Rich parse (per `parseFeedbackCapture` in
      `spice/cowork/helpers/learn-from-checks-helper.js` — re-stated here for
      pure-MCP execution): collect per-item tick lines
      `> > - [x|.] [[#^item-<kind>-<7hex>|<label>]]` with section context —
      lines after a `> > Mattered:` header are MATTERED ticks; after
      `> > Didn't like:` they are DOWNVOTES; a new `> > [!summary]-` header
      resets the section (v=1 bodies have no section headers: all ticks are
      mattered, downvotes empty). Trailing Tasks-plugin annotations ignored.
      Collect per-kind knob rows (`**Fire <kind>:** \`[x?] less\` ...`) →
      less / same / more / ambiguous (>1 ticked). Collect the
      ` ```feedback ``` ` fence content as free_text.
      KIND-LEVEL MAPPING for sub-step 8's aggregation: a kind with ≥1
      mattered tick → `{ kind, ticked: true }`; a surfaced kind with 0
      mattered ticks → `{ kind, ticked: false }`.

8. Aggregate kind observations across all of yesterday's notes per kind.
   Compute `tick_count` + `skip_count` per kind.

### Step 3.5 — Deterministic feedback rollup (EOD notes with feedback-capture sentinel only)

8a. Read the EOD sidecar's `feedback_capture` field. Fast-path: skip this step
    entirely when the field is absent OR `item_count == 0` (and free_text is
    empty). Identity registry = `feedback_capture.items[]`
    (`{item_id, kind, identifier, label}`; sidecar schema 1.2.0+). For
    pre-1.2.0 sidecars (the v=1-era corpus), recover identity from the
    wikilink labels in the .md: `[[#^<item_id>|<label>]]` → use the label as
    a per_topic entity. If identity is unrecoverable, keep the kind-level
    signal and drop only the entity-level delta.

8b. Skip every item-ID listed in sidecar `feedback_capture.ambiguous_items[]`
    (ticked in BOTH lists — contradictory, no signal) and every kind in
    `ambiguous_knobs[]`.

8c. Roll up per the `cowork:ingest-feedback` contract
    (`spice/cowork/helpers/ingest-feedback-helper.js` — re-stated for
    pure-MCP execution):
    - Mattered tick → entity delta **+0.05** on the item's entity under its kind.
    - Didn't-like tick → entity delta **−0.10**.
    - Entity classification (first match wins): identifier `person:<name>` →
      per_person `<name>`; github `org/repo#N` → per_topic `org/repo`; ado
      `org/proj:<id>` → per_topic `org/proj`; chat `<chan>:<ts>` →
      per_channel `<chan>`; else per_topic by label.
    - Knob `less` → kind delta −0.05; `more` → +0.05; `same`/absent/ambiguous → none.
      Knob deltas apply AFTER Step 4's formula pass, then re-clamp to [0.10, 3.00].
    - Idempotency: skip the whole rollup if `{{$yesterday_date}}` is already in
      `totals.feedback_ingested_days[]`.

### Step 3.6 — Free-text intent extraction (LLM pass, inline in this session)

8d. When `free_text` is non-empty: read it and extract a JSON intent list —
    each entry `{ intent, kind?, entity?, source_quote, proposed_target,
    confidence }` where `intent` ∈ uprank | downrank | voice_correction |
    coverage_gap | frequency | other; `source_quote` is a VERBATIM substring
    of the user's prose; `proposed_target` ∈ `learned_weights` |
    `microscope:<kind>` | `voice-proposals` | `coverage-queue`; `confidence`
    ∈ high | medium | low.

8e. VALIDATE every intent (deterministic rules — the `validateIntents`
    contract; the LLM proposes, this layer disposes):
    - unknown intent → REJECT
    - `source_quote` missing or not found verbatim in free_text → REJECT
    - `proposed_target` outside the four-value allowlist → REJECT
    - uprank / downrank / frequency without a `kind` → REJECT
    - intent `other` OR confidence `low` → PENDING (logged, never applied)
    Rejected + pending intents are recorded in the Step 5.5 audit log with
    their reason. ONLY accepted intents proceed.

8f. Accepted intent dispositions:
    - uprank / downrank naming an entity → entity delta (+0.05 / −0.10); a
      hard suppression phrasing ("stop surfacing", "never show") → floor-set
      the entity weight to **0.10** directly.
    - frequency → kind delta ±0.05 (same channel as the knob).
    - voice_correction → compose a proposal entry (Step 5.5c). NEVER applied
      directly.
    - coverage_gap → queue entry (Step 5.5d).

### Step 4 — Update learned_weights in user-preferences.md

9. Read `spice/cowork/context/user-preferences.md` frontmatter via Obsidian MCP. Parse `learned_weights:` block (may be absent → initialize skeleton; may be legacy single-engagement shape → normalize to nested per v0.96.1).
10. Locate `learned_weights.engagements["{{$engagement_id}}"]`. If absent, initialize skeleton with empty `per_kind: {}` + `totals` block (warmup_until = yesterday + 7 days, etc.).
11. Apply update formula per kind that surfaced an observation:
    ```
    w_old = prev.weight || 1.00
    w_raw = w_old * 0.98 + 0.15 * (tick_count - 0.5 * skip_count) / (tick_count + skip_count + 5)
    w_new = clamp(w_raw, 0.10, 3.00) rounded to 3 decimals (banker's rounding)
    ```
    Update `per_kind[<kind>]`: weight, ticks += tick_count, skips += skip_count, warmup preserved, last_updated = `{{$yesterday_date}}`.
12. Evaluate warmup graduation: if `days_since_first >= 7` AND `ticks + skips >= 7`, set `warmup: false`.
13. Update `totals`: `notes_scanned += <yesterday's note count>`, `notes_with_any_tick += <count of notes with any [x]>`, `scanned_days.push("{{$yesterday_date}}")` (dedup-aware).

13a. SCHEMA 3 NORMALIZE (v0.98.2): before applying updates, normalize the
     parsed `learned_weights:` block per `normalizeLearnedWeightsV3` —
     tolerate on-disk `schema_version: 2` (headspace), a MISSING version
     field (accuris), legacy `"1.1.0"`, or `3`. Result shape: top-level
     `schema_version: 3`; every `per_kind.<kind>` gains empty
     `per_person: {}` / `per_channel: {}` / `per_topic: {}` maps when absent;
     `totals` gains `feedback_ingested_days: []` when absent. NOTHING
     existing is dropped.

13b. Apply Step 3.5's entity deltas: per entity,
     `weight = clamp(round3(weight + delta), 0.10, 3.00)`; increment `ticks`
     (positive delta) or `downvotes` (negative); set `last_updated`.
     Floor-sets (Step 3.6/8f) write `weight: 0.100` + `floor_set: true`.

13c. Apply entity decay TOWARD 1.00 to EVERY entity under this engagement:
     `weight = round3(1.00 + (weight − 1.00) × 0.995)`. (NOT weight × 0.995 —
     that would decay toward zero.) Once per ingested day (idempotent via
     `feedback_ingested_days`).

13d. Apply Step 3.5's knob deltas AFTER the per-kind formula (sub-step 11):
     `weight = clamp(round3(weight + delta), 0.10, 3.00)`.

13e. Append `{{$yesterday_date}}` to `totals.feedback_ingested_days[]`
     (dedup-aware).

### Step 5 — Write .bak + updated user-preferences.md

14. Read current user-preferences.md content. Write verbatim to `spice/cowork/context/user-preferences.md.bak` via `obsidian_put_content` (backup before rewrite).
15. Compose new frontmatter — replace ONLY the `learned_weights:` block, preserve all other top-level keys (`priorities`, `personality`, `mcps`, etc.).
16. Write updated user-preferences.md via `obsidian_put_content`.

### Step 5.5 — Apply non-weight deltas + audit trail

16a. AUDIT LOG (always, even on a no-signal day): read
     `spice/cowork/memory/{{$engagement_id}}/feedback-deltas.md` via
     `obsidian_get_file_contents` (absent → initialize with frontmatter
     `---\ntype: cowork-feedback-deltas\nengagement_id: {{$engagement_id}}\n---\n\n# Feedback deltas\n`).
     PREPEND a new section per the `composeAuditEntry` contract:
     `## {{$today_date}} (run-id: fd-{{$today_ymd_compact}}-0300)` + one
     `- [tag] ...` bullet per delta — tags: `[weights]` (old → new + source),
     `[knob]`, `[microscope]`, `[voice]`, `[coverage]`, `[rejected]`,
     `[pending]`. A zero-signal day logs the single line
     `- no feedback signal for {{$yesterday_date}}`. Write via
     `obsidian_put_content`.

16b. MICROSCOPE APPENDS (accepted intents targeting `microscope:<kind>`):
     read `spice/cowork/prompts/per-mcp/<kind>/microscope.md`. If ABSENT, do
     NOT create it — log the delta as `[pending] microscope:<kind> absent`
     in 16a and move on. If present, APPEND under its `## What matters`
     section (create the section header at EOF when missing):
     `- ({{$today_date}} via feedback) <distilled rule> — source: "<source_quote>"`.
     APPEND-ONLY — never rewrite or reorder existing content; the user
     prunes later.

16c. VOICE PROPOSALS (accepted voice_correction intents): read
     `spice/cowork/memory/{{$engagement_id}}/voice-proposals.md` (absent →
     initialize with frontmatter `type: cowork-voice-proposals`). APPEND one
     entry per proposal:

     ## vp-{{$today_ymd_compact}}-<n> — PENDING (expires <today + 7 days>)
     - target: <file to append to — e.g. spice/cowork/context/<engagement>/brand-voice.md, or user-preferences personality.notes>
     - proposal: "<the EXACT append text>"
     - source: "<source_quote>" (eod-review {{$yesterday_date}})
     - status: pending

     NEVER apply the proposal in this step. The morning brief renders pending
     proposals (its Step 4.5); approval is the user's tick.

16d. COVERAGE QUEUE (accepted coverage_gap intents): read
     `spice/cowork/memory/{{$engagement_id}}/coverage-queue.md` (absent →
     initialize with frontmatter `type: cowork-coverage-queue`). APPEND:
     `- [ ] ({{$today_date}}) <gap description> — source: "<source_quote>"`.

### Step 5.6 — Voice-proposal approval sweep

16e. Read yesterday's morning-briefing `.md`. Scan for proposal lines:
     `- [x|.] <summary> <!-- cowork:voice-proposal id=vp-... -->`.
     Per line with `[x]` (trailing Tasks annotations tolerated): look up the
     proposal in voice-proposals.md; APPEND its exact `proposal:` text to its
     `target:` file (append-only — for `personality.notes` targets, append to
     the notes string; for context files, append a dated line at EOF); set
     `status: applied {{$today_date}}`; log `[voice] APPLIED vp-...` in 16a.

16f. Per PENDING proposal past its expiry date: set `status: expired`
     (visible-but-inert; no further renders). Log `[voice] EXPIRED vp-...`.

### Step 6 — Heartbeat check (walk 30-day sidecar window)

17. Build expected_cadences[] from `engagement.cadences`:
    - `morning` → `morning-briefing`
    - `midday` → `midday-tripwire`
    - `eod` → `eod-review`
    - `weekly` → `weekly-review`
    - `monthly` → `monthly-review`
    - `lens_shift` → `lens_shift`

18. For each day in the last 30 days, list `spice/cowork/daily/<dirpath>/`. For each `.cowork.json` file: read JSON, extract `frontmatter.type` + `generated_at`. Map type→cadence per CADENCE_BY_TYPE (cowork-morning-briefing → morning-briefing; cowork-morning-briefing-cold → lens_shift; etc.). If `engagement_id` matches, track `last_fire_at[<cadence>] = max(prior, generated_at)`.

19. Evaluate freshness:
    - Windows (hours): morning-briefing/midday-tripwire/eod-review/capture-tick = 36; weekly-review/synthesize-week/lens_shift = 192; monthly-review = 840.
    - missed = [cadence for cadence in expected_cadences where last_fire_at[cadence] is absent OR `(now - last_fire_at[cadence]) > window_hours`]

### Step 7 — Emit heartbeat warning callout to memory.md (if any missed)

20. If `missed.length > 0`:
    a. Read today's `spice/cowork/memory/{{$engagement_id}}/{{$today_dirpath}}/memory.md` via `obsidian_get_file_contents`. If absent, skip this step (synthesize-day creates memory.md; reconciler doesn't).
    b. Compose `> [!warning]+ Cron heartbeat anomaly — {{$today_date}}` callout body with per-cadence "last fired <X> OR never fired" lines + "Investigate in claude.ai Cowork UI OR run `/cowork sync-scheduled-jobs`" tail. First-fire intro when no sidecars at all in 30-day window: "No v0.96.0+ sidecars found yet — this may be the first post-upgrade fire. Revisit tomorrow."
    c. Locate existing `> [!warning]+ Cron heartbeat anomaly` callout in memory.md (regex). REPLACE if present; else append after synthesis section (before `## Ticks` if present).
    d. Write updated memory.md via `obsidian_put_content`.

### Step 8 — Append reconciler-log entry

21. Read `spice/cowork/context/reconciler-log.md` via `obsidian_get_file_contents` (may not exist; treat as empty).
22. Compose new entry: `## {{$today_date}} 03:00 MT (run-id: rl-{{$today_ymd_compact}}-0300)` + engagement processed + yesterday processed + sidecar status (scanned/backfilled/validated) + rating callouts (sentinel found/missing per note + aggregated observations) + learned_weights deltas + heartbeat verdict.
23. Prepend new entry. Split content on `^## ` headers; cap to last 30 entries (prepend mine, slice to 30).
24. Compose full file with frontmatter `---\ntype: cowork-reconciler-log\n---\n\n# Reconciler log\n\n` + entries joined.
25. Write via `obsidian_put_content`.

### Step 9 — Done notice

26. Emit Obsidian Notice: `cowork:reconcile-cowork complete -- {{$engagement_label}} {{$today_date}} | <N> sidecars backfilled | <K> learned_weights deltas | <heartbeat verdict>`.

## Idempotency

- Sidecar backfill: idempotent (creates `.cowork.json` only if absent).
- learned_weights update: skip if `{{$yesterday_date}}` already in `totals.scanned_days[]`.
- check-heartbeat: regex-replaces prior callout in memory.md same-day.
- reconciler-log: dedup by run-id (skip if today's run already logged).
- feedback ingest: skip when `{{$yesterday_date}}` already in `totals.feedback_ingested_days[]`.
- feedback-deltas log: dedup by run-id (skip if today's `fd-` run already logged).
- voice apply: a proposal applies at most once (`status: applied` gates re-apply).

## Failure modes

- Yesterday's daily dir doesn't exist → SKIP Steps 2-5; still run heartbeat (Steps 6-7) which is the whole point on a "nothing fired" day.
- user-preferences.md unreadable → abort with `failed:contract-violation:prefs-unreadable`. Heartbeat + log still attempted.
- memory.md absent → heartbeat warning not written. Surface in reconciler-log instead.
- Corrupt JSON sidecar → skip + log warning; don't abort.
- EOD sidecar lacks `feedback_capture` / pre-1.2.0 → kind-level signal from the markdown only; entity rollup degrades to labels; never aborts.
- Free-text extraction yields invalid JSON → log `[rejected] extraction-unparseable` + skip Step 3.6 entirely; deterministic rollup (3.5) still applies.
- microscope.md absent for an accepted append → `[pending]` log line; never create the file.
- ZERO signal (no ticks, no downvotes, no knobs, empty free_text — the accuris reality) → no deltas, no writes except the single audit line.

## Performance

~50-160 MCP calls per fire per engagement. Bounded by 30-day sidecar walk. Acceptable for nightly automation.

{{shared.done_block}}
