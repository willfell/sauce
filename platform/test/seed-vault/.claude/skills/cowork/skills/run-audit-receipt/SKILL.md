---
name: cowork:run-audit-receipt
description: Dispatches `sauce audit --only cowork` against the current vault via Bash and returns a structured pass/fail report. Used by cowork:bootstrap-vault step 23 to embed an audit receipt into the bootstrap-report.
scope: shared
tags: [cowork, audit, sub-skill, receipt]
---

# cowork:run-audit-receipt

Runs `sauce audit` against the current vault and returns a structured receipt
listing per-rule_fragment PASS/FAIL/WARN status for the cowork target.

## Inputs
- `vault_path` (string, required) — absolute path of the vault being audited.
- `workshop_path` (string, optional) — absolute path of the sauce workshop dev
  repo. Defaults to the `SAUCE_WORKSHOP_ROOT` env var if set, else the parent
  of the running skill's location (resolved at runtime).

## Steps

1. Construct the audit command:
   `node <workshop_path>/platform/cli/sauce-cli.js audit --vault <vault_path> --only cowork --format json`
2. Dispatch via Bash. Capture stdout + stderr + exit code.
3. Parse stdout as JSON. Expected shape: `{ summary: { pass, fail, warn }, violations: [...] }`. If parse fails, return `{ status: "error", message: "audit output not parseable", raw_stdout, exit_code }`.
4. Build receipt: group violations by `blueprint == "cowork"` (filter); for each, format `<file>: <rule> — <severity>: <message>`.
5. Return structured object:
   ```
   {
     status: "pass" | "fail" | "warn",
     summary: { pass, fail, warn },
     receipt_lines: [<formatted line>, ...],
     raw_violations: [<violations array>]
   }
   ```
   Status logic: `fail` if any violation has `severity == "error"`; `warn` if no errors but >=1 warn; `pass` otherwise.

## Outputs
Structured object per step 5. Bootstrap-vault step 23 embeds `receipt_lines` verbatim into bootstrap-report §6.

## Failure modes
- Bash dispatch unavailable → return `{ status: "unavailable", message: "Bash unavailable; user must run 'sauce audit --vault <vault> --only cowork' manually" }`. Bootstrap-vault step 23 falls back to "emit run-instructions" mode.
- audit CLI returns non-zero exit code → surface stderr in the return; status="error".
