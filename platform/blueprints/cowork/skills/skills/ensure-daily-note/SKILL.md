---
name: cowork:ensure-daily-note
description: Ensure today's daily note exists at the sauce-shape path; create from canonical template if missing.
inputs:
  date: string
  weekday: string
  month_name: string
  path: string
outputs:
  path: string
  status: string
tags: [cowork, routing, daily]
---

# cowork:ensure-daily-note

Idempotently guarantees today's daily note exists at the sauce-shape path so downstream callout writers have a target. FAT: orchestrator never sees raw obsidian-mcp errors; this sub-skill normalizes to a status string + the resolved path.

## Inputs
- `date` (required): today's date as `YYYY-MM-DD` (absolute, never relative).
- `path` (optional): pre-computed daily-note path (e.g., from `cowork:date-context.daily_path`). When provided, used verbatim and `weekday` / `month_name` are not required. When absent, the skill computes the path from `date` + `weekday` + `month_name`.
- `weekday` (optional when `path` provided; required otherwise): day-of-week long name (e.g. `Monday`, `Tuesday`).
- `month_name` (optional when `path` provided; required otherwise): long month name (e.g. `May`, `November`).

## Outputs
- `path`: vault-relative path to today's daily note (always returned, even on failure for diagnostics).
- `status`: one of `"exists"`, `"created"`, `"failed:<reason>"`.

## Steps
1. Resolve the daily-note path. If `path` input is non-empty, use it verbatim. Otherwise compute the canonical sauce-shape path: `spice/daily/<YYYY>/<MM>-<MonthName>/<weekday>-<YYYY>-<MM>-<DD>.md`. Example for `2026-05-12` (Tuesday): `spice/daily/2026/05-May/Tuesday-2026-05-12.md`. Both `<YYYY>` and `<MM>` are zero-padded; `<MonthName>` is the long form supplied via `month_name`. This matches the daily blueprint's `format: "YYYY/MM-MMMM/dddd-YYYY-MM-DD"` exactly.
2. Probe existence via `mcp__obsidian__read_note` (or backend-equivalent `obsidian_get_file_contents`) at the computed path.
   - On success: return `{ path, status: "exists" }`. STOP.
   - On not-found error: continue to step 3.
   - On other error (auth, timeout, malformed): return `{ path, status: "failed:read-error" }`. Do not attempt creation.
3. Read the canonical daily template at `ranch/templates/Daily Note.md` via `mcp__obsidian__read_note`. This template is materialized by the `daily` blueprint and ships the `<!-- COWORK_CALLOUTS -->` anchor (daily@0.2.5+).
   - If template missing: return `{ path, status: "failed:template-missing" }`. Do not write a hand-rolled note - the cowork callout writers depend on the anchor + nav-buttons block.
4. Substitute date variables in the template body. The daily template uses Templater syntax (`<% tp.date.now(...) %>`) but cron-fired sessions cannot run Templater, so this skill must perform string substitution BEFORE writing:
   - Replace `<% tp.date.now("YYYY-MM-DD") %>` and `<% tp.file.title %>`-derived expressions with the supplied `date`.
   - Replace `<% tp.date.now("dddd") %>` with `weekday`.
   - Replace `<% tp.date.now("MMMM") %>` with `month_name`.
   - If unsure which substitution applies for a given Templater expression, prefer substituting with `date` and emit a Notice listing unresolved expressions; do NOT leave raw `<% ... %>` in the materialized note (Obsidian will display it as literal text).
5. Write the substituted body to the computed path via `mcp__obsidian__write_note`.
   - On success: return `{ path, status: "created" }`.
   - On write error: return `{ path, status: "failed:write-error" }`.

## Returns
A JSON object: `{ "path": "spice/daily/2026/05-May/Tuesday-2026-05-12.md", "status": "exists" }` or `{ "path": "...", "status": "created" }` or `{ "path": "...", "status": "failed:<reason>" }`.

## Errors
- This sub-skill never raises. All failure modes return a `failed:<reason>` status string for the orchestrator to inspect.
- The orchestrator MUST check `status`. On `"failed:..."`, the orchestrator emits an Obsidian Notice (`cowork:<orchestrator-id> aborted - daily note unavailable: <reason>`) and exits before attempting any callout writes.
- Do NOT create parent directories explicitly. `mcp__obsidian__write_note` creates intermediate folders. If the obsidian backend rejects deep paths, surface that as `failed:write-error` and let the user widen the allowlist.
