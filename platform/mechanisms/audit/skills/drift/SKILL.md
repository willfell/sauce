---
name: drift
description: Audit the sauce claude_surface deployment for drift. Shells `sauce audit --claude-surface --vault $(pwd)` and renders dead_path / orphan / stale_but_valid / consumer_edit_at_risk findings as severity-grouped callouts. Detection-only — never rewrites the deployed surface.
---

# audit:drift

Runs the claude-surface audit pass against the current vault. Parses the CLI report's findings + counts, groups them by severity, and emits one markdown callout per non-empty severity level. Does not auto-fix — surfaces the drift and lets the user decide which remedy applies (`/install` to re-deploy, edit `.commands.local/` to shadow, edit subscription to drop a stale mechanism, etc.).

## Pre-flight

1. **Confirm vault shape.** Read `ranch/platform-config.json`. If missing, abort with `[!warning] /audit requires a sauce vault — ranch/platform-config.json not found.` and stop. Do not shell out.

## Run

2. **Shell out.** Run `sauce audit --claude-surface --vault "$(pwd)"` via the Bash tool. Capture stdout, stderr, and exit code.
   - Exit `0` → clean vault, no findings. Skip to step 5.
   - Exit `1` → findings present (expected when drift exists). Continue.
   - Exit `2` → CLI error (not a vault, missing registry, etc.). Render stderr as a `[!failure]` callout and stop.

## Parse

3. **Read the report.** stdout contains a markdown report keyed by severity sections. The CLI also emits a single-line JSON summary on the last stdout line of the form `{"counts":{...},"findings_total":N}`. Use that for the counts; use the section bodies for the per-finding details.

## Render

4. **Emit one callout per non-empty severity.** Order: `dead_path` → `orphan` → `stale_but_valid` → `consumer_edit_at_risk`. Callout type:

   - `dead_path` → `[!failure] /audit — N dead-path findings` (registry-promised file missing on disk; deploy is broken)
   - `orphan` → `[!warning] /audit — N orphan files` (disk has files the registry doesn't claim; safe to leave but tidiness candidate)
   - `stale_but_valid` → `[!info] /audit — N stale-but-valid findings` (body version comment lags; `/install` will refresh)
   - `consumer_edit_at_risk` → `[!warning] /audit — N consumer-edit-at-risk findings` (deployed body differs from source AND no `.local/` shadow; next `/install` will overwrite the local change)

   Each callout body lists every finding as a numbered line:

   ```
   > 1. <path> — <message>
   ```

   Do NOT truncate. The user needs to see every drifted path.

5. **If no findings**, emit `[!success] /audit — claude_surface clean (<aligned> aligned entries)`.

## Done

6. Stop. Do not auto-fix. Mention the remedies inline (re-run `/install`, edit `.commands.local/<x>.md` to shadow, etc.) but do not act on them.
