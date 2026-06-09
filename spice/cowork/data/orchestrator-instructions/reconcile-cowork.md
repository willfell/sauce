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

### Step 3 — Parse rating callouts

7. For each `.md` matching `{{$engagement_id}}`:
   a. Read content (or reuse from Step 6).
   b. Find sentinel: `<!-- cowork:rating-block schema=1.0.0 cadence=<X> day=<Y> -->`.
   c. Scan upward from sentinel for `> - [x] Kind` and `> - [ ] Kind` lines. Build observations: `{ kind: <lowercase>, ticked: <bool> }`.

8. Aggregate observations across all of yesterday's notes per kind. Compute `tick_count` + `skip_count` per kind.

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

### Step 5 — Write .bak + updated user-preferences.md

14. Read current user-preferences.md content. Write verbatim to `spice/cowork/context/user-preferences.md.bak` via `obsidian_put_content` (backup before rewrite).
15. Compose new frontmatter — replace ONLY the `learned_weights:` block, preserve all other top-level keys (`priorities`, `personality`, `mcps`, etc.).
16. Write updated user-preferences.md via `obsidian_put_content`.

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

## Failure modes

- Yesterday's daily dir doesn't exist → SKIP Steps 2-5; still run heartbeat (Steps 6-7) which is the whole point on a "nothing fired" day.
- user-preferences.md unreadable → abort with `failed:contract-violation:prefs-unreadable`. Heartbeat + log still attempted.
- memory.md absent → heartbeat warning not written. Surface in reconciler-log instead.
- Corrupt JSON sidecar → skip + log warning; don't abort.

## Performance

~50-160 MCP calls per fire per engagement. Bounded by 30-day sidecar walk. Acceptable for nightly automation.
