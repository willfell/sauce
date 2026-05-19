# v0.63.0 S0 verification log

**Date:** 2026-05-19
**Cycle:** v0.63.0 (to-do All-To-Dos aggregator + Migrate-to-tomorrow dialog)
**Vault:** `/Users/willfellhoelter/notes/sauce/headspace-sauce`

## Smoke init deployed

- File: `ranch/scripts/sauce-v63-smoke-init.js` (class `SauceV63SmokeInit`)
- Registered in `.obsidian/plugins/customjs/data.json` `startupScriptNames[]`
- Body: registers Obsidian command `sauce:v63-smoke` with name `Sauce v0.63.0 smoke command`; callback shows a Notice toast on invoke

## User reload + verification

After Cmd-R reload at headspace, all three confirmations PASSED:

1. **Console log present** — `[sauce-v63-smoke] command registered at <ISO>` appeared in the dev console immediately after reload. Confirms `customjs` plugin invoked `SauceV63SmokeInit.invoke()` at boot.
2. **Command palette entry present** — Cmd-P → "sauce v0.63" matched "Sauce v0.63.0 smoke command". Confirms `app.commands.addCommand` from inside a customjs startup script registers a command that's visible to the palette.
3. **Toast on invoke** — selecting the command from Cmd-P produced the "sauce:v63-smoke fired" Notice toast. Confirms the command's callback runs as expected.

## Verdict

**S0 PASSED.** The registration vector for v0.63.0's `ToDoMigrateInit` → `sauce:to-do-migrate` chain is confirmed working at headspace. The same mechanism that's about to be deployed for the migrate dialog is empirically functional.

This addresses the v0.48.0 → v0.49.0 retrospect lesson: build only on registration vectors that have been verified at the target consumer, not just at workshop self-install.

## Cleanup

- `ranch/scripts/sauce-v63-smoke-init.js` deleted
- `startupScriptNames[]` restored to `["ProjectTaskCreateListenerInit"]` (v0.49.0 baseline preserved)
- User should Cmd-R reload at convenience to drop the smoke command from Obsidian's in-memory command registry (not blocking — won't re-register next boot since the init script + data.json entry are both gone).

## Next step

S1 — to-do manifest deltas. Subagent-dispatched.
