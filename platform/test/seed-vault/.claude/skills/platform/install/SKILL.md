---
name: install
description: Re-run sauce installer against the current vault's subscription. Invokes `sauce update --vault $(pwd)` and renders the install-ledger delta as a callout.
---

# platform:install

Re-runs the sauce installer against the current vault. Captures the install-ledger (`ranch/platform-installed.json`) before and after, diffs them, and renders the delta plus any error events as a markdown callout.

## Pre-flight

1. **Confirm vault shape.** Read `ranch/platform-config.json`. If missing, abort with `[!warning] /install requires a sauce vault — ranch/platform-config.json not found. Use raw \`sauce bootstrap\` from a terminal for first-touch.` and stop. Do not shell out.

## Snapshot

2. **Read pre-install ledger.** Read `ranch/platform-installed.json` if it exists. Capture `before.mechanisms[]`, `before.blueprints[]`, and `before.history.length` (length only — history tail is large). If the file does not exist, treat `before = { mechanisms: [], blueprints: [], history_length: 0 }`.

## Run

3. **Shell out.** Run `sauce update --vault "$(pwd)"` via the Bash tool. Capture stdout, stderr, and exit code. If exit code is non-zero, render the captured stderr as a `[!failure]` callout and stop. Do NOT proceed to the diff step — the ledger may be partially written.

## Diff

4. **Read post-install ledger.** Read `ranch/platform-installed.json` again. Capture `after.mechanisms[]`, `after.blueprints[]`, and `after.history` (full).
5. **Compute delta.** For each item in `after.mechanisms[]` + `after.blueprints[]`:
   - **Newly installed**: name not in `before` lists.
   - **Upgraded**: name in `before` lists but `after.version !== before.version`.
   - **Unchanged**: same name + version on both sides.
   Capture `installed[]`, `upgraded[]`, `unchanged[]` (count only).
6. **Capture new history events.** Slice `after.history` from index `before.history_length` to end. Filter for `event === "error"` rows.

## Render

7. **Emit summary callout.** A two-section markdown response:

   ```
   > [!success] /install — sauce update complete
   > **Installed:** <comma-list of newly-installed name@version, or "none">
   > **Upgraded:** <comma-list of upgraded name from→to, or "none">
   > **Unchanged:** <count> items
   ```

8. **If error events present**, append a second callout:

   ```
   > [!failure] /install — N error events
   > - <step>: <message>
   > - ...
   ```

   List every error row with its `step` field. Do NOT truncate — the user needs to see exactly what failed.

## Done

9. Stop. Do not re-run; do not "auto-fix" errors. Surface them and let the user decide next steps.
