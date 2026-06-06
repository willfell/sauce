---
name: upgrade
description: Interactively upgrade one or more blueprints/mechanisms. Walks subscription vs. catalogue, prompts for targets, edits subscription, invokes `sauce update`.
---

# platform:upgrade

Interactive upgrade flow. Reads the current vault's subscription, compares against the workshop catalogue, lets the user pick which items to upgrade and to what version, atomically edits `ranch/platform-subscription.json`, then invokes `sauce update`.

## Pre-flight

1. **Confirm vault shape.** Read `ranch/platform-config.json` and `ranch/platform-subscription.json`. If either is missing, abort with `[!warning] /upgrade requires a sauce vault with an existing subscription.` and stop.

## Discover

2. **Read catalogue.** Read the workshop's `platform/manifest.json` (path resolved from `ranch/platform-config.json#workshop_path`, or default `~/sauce/platform/manifest.json`). Capture `catalogue.mechanisms[]` and `catalogue.blueprints[]`.
3. **Compute available updates.** For each item in `subscription.mechanisms[]` + `subscription.blueprints[]`:
   - Match by `name` against the catalogue.
   - If `catalogue.version > subscription.version` (semver compare), add to `updates[]` with `{ kind, name, from_version, to_version }`.
4. **Empty case.** If `updates.length === 0`, emit:

   ```
   > [!success] /upgrade — subscription is up to date
   > All <N> subscribed items match the workshop catalogue.
   ```

   And stop.

## Choose

5. **Render menu.** Numbered list of available updates:

   ```
   ## Available updates

   1. [mechanism] validator   0.1.1 → 0.1.2
   2. [blueprint] cowork      0.2.0 → 0.2.1
   ...
   ```

6. **Prompt user.** Ask "Which to upgrade? (comma-separated numbers, or `all`)". Wait for response. Parse into selection set.
7. **Per-selection version prompt.** For each selected item, ask "Target version for `<name>` (default: `<catalogue.version>`)?". Default = catalogue version on empty input.

## Edit subscription

8. **Mutate in memory.** Read `ranch/platform-subscription.json` again (defensive re-read). For each selected `{ kind, name, target_version }`, update the matching `mechanisms[]` or `blueprints[]` entry's `version` field. Preserve all other fields.
9. **Atomic write.** Write the mutated JSON to `ranch/platform-subscription.json.tmp` (pretty-printed, 2-space indent, trailing newline), then rename to `ranch/platform-subscription.json`. If the rename fails, surface the error and abort — do NOT leave the `.tmp` file behind (best-effort cleanup).

## Apply

10. **Invoke install.** Shell `sauce update --vault "$(pwd)"`. Capture stdout/stderr/exit code. If non-zero, surface stderr as `[!failure]` and stop — the subscription is updated but the install did not complete.

## Report

11. **Emit summary callout.**

    ```
    > [!success] /upgrade — N items upgraded
    > - validator: 0.1.1 → 0.1.2
    > - cowork: 0.2.0 → 0.2.1
    >
    > Subscription edited at ranch/platform-subscription.json. Install ran successfully.
    ```

## Done

12. Stop. Do NOT recursively re-run; the user can fire `/upgrade` again if more items remain.
