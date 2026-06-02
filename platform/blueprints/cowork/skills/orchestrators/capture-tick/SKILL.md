---
name: cowork:capture-tick
description: Hourly tick — captures lean deltas across the engagement's MCP kinds (calendar/email/chat/finance/projects/threads per prefs.priorities) within a tight 1-hour window. Appends a collapsed [!example]- callout to spice/cowork/memory/<engagement_id>/YYYY/MM-MMMM/YYYY-MM-DD/memory.md (creating the file on the first tick of the day). Background memory layer — does NOT write to spice/cowork/daily/, does NOT touch the daily note. Reused by cowork:morning-briefing and cowork:synthesize-day downstream as continuity context. Phrasings = "capture this hour", "tick", "memory dump", "log this hour for engagement".
schedule: Cron-driven hourly during waking hours (default 7am-10pm; 16 ticks/day per engagement)
scope: shared
tags: [cowork, orchestrator, tick, memory, background]
---

# cowork:capture-tick

Hourly background memory tick for one engagement. On each invocation, gathers lean deltas across the engagement's configured MCP kinds within a tight 1-hour window (from `last_tick_at` to now, or from midnight on the first tick of the day) and appends a single collapsed `[!example]-` callout to a single daily memory file at `spice/cowork/memory/<engagement_id>/YYYY/MM-MMMM/YYYY-MM-DD/memory.md`. The file is created on the first tick of the day with scaffolded frontmatter and placeholder synthesis sections; subsequent ticks append and update the running frontmatter counters.

This orchestrator is strictly background-only. It does NOT write to `spice/cowork/daily/`, does NOT call `ensure-daily-note`, does NOT touch the daily note in any way. Its output is a continuity context file consumed by `cowork:morning-briefing` (carry-forward reads) and `cowork:synthesize-day` (EOD synthesis). Re-firing within the same hour writes a new tick callout (no de-dup by design — each tick is a discrete snapshot); the tick callout title includes HH:MM so multiple same-hour ticks are distinguishable. The deltas-only contract is strict: any kind that returns empty markdown is excluded from the tick body entirely — silence is signal-free, not a bug.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If the return is not `"ready"`, exit silently.

2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up `engagement` by id. If not found, exit silently. Read the engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (substitute `<engagement.type>` from the resolved engagement; expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `render_aspects` (informational only — tick does NOT honor render_aspects gating; it captures everything available). If the file is missing or fails to parse, emit Notice `cowork:capture-tick aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit.

3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture the returned `context` object. If `context.error` exists, exit silently.

3b. READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture as `prefs_result = { prefs, status, reason }`. Capture `prefs = prefs_result.prefs` (may be null when `status != "ok"`). If `status != "ok"`, exit silently with Notice `cowork:capture-tick aborted -- user-preferences unavailable; tick requires prefs.priorities to dispatch gathers`.

3c. **Determine `last_tick_at`.** Compose `today_memory_path` = `spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md` (using values from `context`: `<YYYY>` = `context.yyyy`, `<MM-Month>` = `context["MM-Month"]`, `<YYYY-MM-DD>` = `context.today`). Read the file via the Read tool; treat not-found as absent. If present, parse frontmatter; extract `last_tick_at`; verify the `day` field matches today (`context.today`) — if `day` doesn't match, treat as missing (new day). If `last_tick_at` is present and valid (ISO string), set `range.start = last_tick_at`. Else set `range.start = <context.today>T00:00:00<engagement.timezone or America/Denver offset>`. Set `range.end = <now as ISO-8601 with TZ offset>`.

3d. **Plan dispatch.** Mirror midday-tripwire's step 3c logic verbatim — same `dispatch_mode`, same `dispatch_plan[]` build, same microscope-routing detection, same `composeVoiceContract`. The tick orchestrator does NOT call `ensure-daily-note` (tick writes to the memory file, not the daily note).

   Compute `dispatch_mode`:

   ```
   dispatch_mode = (prefs_result.status === "ok") ? "prefs" : "legacy"
   ```

   When `dispatch_mode == "prefs"`:

   1. From `check-vault-routing`'s prior result (pre-flight step 1), capture `reachable_namespaces` as the set of MCP namespace segments the agent has tools for in this session. Extract by walking your tool list: for every `mcp__<ns>__<tool>` name, add `<ns>` to the set.

   2. Read `mcp-skill-map.json` from `spice/cowork/context/mcp-skill-map.json` via the Read tool. Capture as `mcp_skill_map`.

   2b. **Read per-kind microscope contracts.** For each `kind_name` in `prefs.priorities`, check whether `spice/cowork/prompts/per-mcp/<kind_name>/microscope.md` exists (via `mcp__obsidian__get_file_contents`; treat a not-found error as absent). When present, strip any leading frontmatter and capture the body as `microscopes[kind_name]`. Kinds without a file are simply absent from the map.

   2c. **Read per-kind sibling files.** For each `kind_name` in `prefs.priorities`, list the contents of `spice/cowork/prompts/per-mcp/<kind_name>/` via `mcp__obsidian__list_files_in_dir` (treat dir-not-found as empty). Filter to files matching the `per-mcp/<kind_name>/*.md` glob, then exclude `microscope.md` and any filename matching `^_.*\.md$`. For each remaining file, read its body via `mcp__obsidian__get_file_contents`, strip any leading frontmatter, and append `{ name: <filename>, body: <stripped body> }` to `siblings[kind_name]`. Kinds without a per-mcp dir get `siblings[kind_name] = []`. This step is PURE — no MCP gather calls, no writes.

   3. Build `dispatch_plan[]` as an ordered array. For each `kind_name` in `prefs.priorities` (in order):

      ```
      mcps_entry = prefs.mcps[kind_name]    # may be undefined

      # Compute kind_title
      if kind_name in {calendar, email, chat, finance}:
          kind_title = canonical lookup ("Calendar", "Email", "Chat", "Finance")
      else:
          kind_title = title-case of kind_name (whitespace/underscore-split; "ado" -> "Ado", "github" -> "Github", "monitoring" -> "Monitoring")

      # Determine action
      if mcps_entry is undefined:
          push { kind_name, action: "warn", reason: "not_classified", kind_title, mcps_entry: null }
          continue
      if mcps_entry.connected == false:
          push { kind_name, action: "warn", reason: "not_connected", kind_title, mcps_entry }
          continue
      if mcps_entry.served_by is set and not in reachable_namespaces:
          push { kind_name, action: "warn", reason: "served_by_unreachable", kind_title, mcps_entry }
          continue
      # v0.79.0: a per-kind microscope contract forces served-by routing with the
      # microscope body as the deep what_matters (notes preserved as baseline_notes)
      if microscopes[kind_name] is present and non-empty:
          push {
            kind_name,
            action: "gather_from_served_by",
            served_by: mcps_entry.served_by,
            what_matters: microscopes[kind_name],
            baseline_notes: mcps_entry.what_matters or "",
            question_set_answers: null,
            kind_title,
            microscope: true,
            mcps_entry,
          }
          continue
      if mcps_entry.custom_kind == true OR mcps_entry.override_classified == true:
          bookkeeping = {served_by, what_matters, connected, captured_at, custom_kind, override_classified}
          question_set_answers = {k: v for k, v in mcps_entry if k not in bookkeeping}
          push {
            kind_name,
            action: "gather_from_served_by",
            served_by: mcps_entry.served_by,
            what_matters: mcps_entry.what_matters or "",
            question_set_answers: mcps_entry.custom_kind ? null : (question_set_answers if non-empty else null),
            kind_title,
            mcps_entry,
          }
          continue
      # Default: known canonical-vendor kind (kind_name in mcp_skill_map.kinds[].kind)
      if any entry in mcp_skill_map.kinds has .kind == kind_name:
          push {
            kind_name,
            action: "gather_canonical",
            gather_skill: <that entry>.gather_skill,
            kind_title,
            mcps_entry,
          }
      else:
          # Rare: kind name not recognized and not flagged custom — treat as gather_from_served_by
          push { kind_name, action: "gather_from_served_by", served_by, what_matters, question_set_answers: null, kind_title, mcps_entry }
      ```

   4. Capture `voice_contract` from `prefs.personality` and `prefs.effective_hard_rules`: if every personality field (`vibe`, `formality`, `pep_talk`, `length`, `notes`) is null/undefined AND `prefs.effective_hard_rules` is empty, `voice_contract = ""`. Otherwise compose the same voice contract block as midday-tripwire step 3c point 4.

   This step is PURE — no MCP calls, no file writes.

## Gather

When `dispatch_mode == "legacy"`, exit silently with Notice `cowork:capture-tick skipped -- prefs in legacy mode; tick requires prefs dispatch`.

When `dispatch_mode == "prefs"`, iterate `dispatch_plan[]` with these tick-specific differences from midday-tripwire's gather phase:

- Pass `range: { start: range.start, end: range.end }` (the tight 1-hour window) to every gather call.
- DO NOT run engagement-type-aspect gathers (semantic_related, finance from render_aspects). Those are eod-review's job.
- Capture each kind's output as `tick_blocks[kind_name] = { markdown, status, kind_title }`.

```
tick_blocks = {}
for entry in dispatch_plan:
  if entry.action == "warn":
    tick_blocks[entry.kind_name] = { markdown: "", status: entry.reason, kind_title: entry.kind_title }
  elif entry.action == "gather_canonical":
    READ `.claude/skills/cowork/skills/<entry.gather_skill-after-cowork-prefix>/SKILL.md`
    in full and follow its `## Steps` section with the kind's canonical input shape,
    passing `range: { start: range.start, end: range.end }` to scope the window.
    tick_blocks[entry.kind_name] = { markdown: result.markdown, status: result.status or "ready", kind_title: entry.kind_title }
  elif entry.action == "gather_from_served_by":
    READ `.claude/skills/cowork/skills/gather-from-served-by/SKILL.md` in full
    and follow its `## Steps` section with {
      kind_name:            entry.kind_name,
      kind_title:           entry.kind_title,
      served_by:            entry.served_by,
      what_matters:         entry.what_matters,
      question_set_answers: entry.question_set_answers,
      hard_rules:           prefs.effective_hard_rules,
      siblings:             siblings[entry.kind_name] || [],
      callout_type:         prefs.mcps[entry.kind_name].callout_type,
      today:                context.today,
      range:                { start: range.start, end: range.end },
      timezone:             engagement.timezone || "America/Denver"
    }
    tick_blocks[entry.kind_name] = { markdown: result.markdown, status: result.status, kind_title: entry.kind_title }
```

Outcome classification after the loop:
- Kinds with `status == "ready"` AND non-empty markdown → emit a tick line (included in tick body).
- Kinds with `status == "ready"` AND empty markdown → EXCLUDED from tick body (deltas-only contract — silence means no delta).
- Kinds with `status != "ready"` → emit a `[!warning]` line referencing the reason (not classified, not connected, unreachable, or gather error).

## Decide

Compute `tick_summary`: a ≤140 character one-liner derived from the non-empty tick_blocks. Enumerate the kinds with non-empty output and compose a plain summary line. Examples: `"2 new emails; 1 calendar event; threads stable"`, `"Finance: 1 charge ($45); calendar quiet"`, `"All kinds quiet — no deltas this hour"` (when all are empty). The summary is the running frontmatter summary replaced each tick; `cowork:synthesize-day` will overwrite it with a full synthesis at EOD.

Compose `tick_block_md` as a collapsed `[!example]-` callout titled `HH:MM Tick` (where `HH:MM` is derived from `range.end`'s hour + `:00` — e.g., `09:00 Tick` for a tick ending at 09:xx):

```
> [!example]- HH:MM Tick
> **KindTitle:** <one-line delta summary for this kind>
> **KindTitle:** <one-line delta summary>
```

Include only kinds with non-empty output. For kinds with `status != "ready"` (warnings), emit:
```
> [!warning] KindTitle unavailable — <reason>
```
as a separate line in the tick callout body (not a nested callout). Kinds with empty deltas are omitted entirely.

## Write

1. Compose `today_memory_path` = `spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md` (same formula as step 3c, substituting from `context`). Example: `spice/cowork/memory/personal/2026/06-June/2026-06-01/memory.md`.

2. Read the file via the Read tool. Determine whether to SCAFFOLD (new file) or APPEND (existing file):

   **SCAFFOLD** when: file not found OR `day` frontmatter doesn't match `context.today`. Write a brand-new memory file with this exact structure:

   ```markdown
   ---
   type: cowork-memory
   engagement_id: <engagement_id>
   day: <context.today>
   created_at: <range.end>
   last_tick_at: <range.end>
   tick_count: 1
   synthesized: false
   summary: <tick_summary>
   ---

   # Daily memory — <context.dddd>, <month_name> <D>, <YYYY>

   > [!info]- Today's pattern (synthesis)
   > Synthesis pending — will fire at synthesize-day cron time (default 19:15).

   > [!tip] Carry-forward to tomorrow's morning-briefing
   > Pending synthesis.

   ## Ticks

   <tick_block_md>
   ```

   Where `<D>` is the integer day with no leading zero, `<YYYY>` is the 4-digit year, `<month_name>` is the full English month name (from `context["MM-Month"].split("-")[1]`), and `<context.dddd>` is the full English weekday.

   **APPEND** when: file exists AND `day` frontmatter matches `context.today`. Append the new `tick_block_md` to the `## Ticks` section (at end of file). Update frontmatter: increment `tick_count` by 1; set `last_tick_at: <range.end>`; replace `summary: <tick_summary>` (running summary replaced each tick).

3. Write the file back via the Write tool (for SCAFFOLD: `mkdir -p <dirname>` via Bash first, then Write; for APPEND: reconstruct the full file with updated frontmatter + existing body + new tick callout, then Write to overwrite).

**Pre-write self-check.** Before calling the Write tool, verify the composed file content has all of these:
- Frontmatter fields: `type` (equals `cowork-memory`), `engagement_id`, `day` (YYYY-MM-DD), `created_at` (ISO string), `tick_count` (number ≥ 1), `last_tick_at` (ISO string), `summary` (non-empty string).
- Body H1: `# Daily memory —` (regex: `/^# Daily memory —/m`).
- `[!info]- Today's pattern (synthesis)` callout (regex: `/^> \[!info\]- Today's pattern \(synthesis\)/m`).
- `[!tip] Carry-forward to tomorrow's morning-briefing` callout (regex: `/^> \[!tip\] Carry-forward/m`).
- `## Ticks` header (regex: `/^## Ticks/m`).
- At least one `[!example]-` tick callout (regex: `/^> \[!example\]-/m`).

On any miss: return `failed:contract-violation:<field>` + emit Notice `cowork:capture-tick aborted -- contract-violation: <field>` + exit non-zero. Do NOT call Write.

## Verify

After a successful Write:

a. Read the just-written file at `today_memory_path` via the Read tool.
b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.
c. Assert required frontmatter fields exist and match expected types:
   - `type` equals `cowork-memory`
   - `engagement_id` is a non-empty string
   - `day` matches regex `^\d{4}-\d{2}-\d{2}$`
   - `created_at` is a non-empty string (ISO-8601 format)
   - `tick_count` is a number ≥ 1
   - `last_tick_at` is a non-empty string (ISO-8601 format)
d. Regex-scan `body` for required structural markers:
   - H1 present: `/^# Daily memory —/m`
   - `[!info]- Today's pattern (synthesis)` callout: `/^> \[!info\]- Today's pattern \(synthesis\)/m`
   - `[!tip] Carry-forward` callout: `/^> \[!tip\] Carry-forward/m`
   - `## Ticks` header: `/^## Ticks/m`
   - At least `tick_count` `[!example]-` callout titles: count of `/^> \[!example\]-/gm` matches ≥ `tick_count`
e. On ANY frontmatter-field miss or marker miss:
   - Emit Notice `cowork:capture-tick aborted -- contract-violation: <field>`.
   - If the file was newly SCAFFOLDED this run (first tick of the day), delete it: `rm -f <today_memory_path>`.
   - Exit non-zero. Do NOT run subsequent steps.
f. On all-pass: continue to Done.

## Done

## Harness testing

S1 HC-V0840-A1..A3 sub-asserts in `run-cowork-smoke.js` validate this SKILL.md's prose contract (presence at canonical dest, required sections, canonical memory path + range pattern + dest filename references). Runtime behavior is validated post-deploy via the consumer-side tick fire — the first tick on a consumer vault should scaffold the daily memory file with all required frontmatter and body markers; subsequent ticks should append tick callouts cleanly without disturbing the synthesis placeholder section.
