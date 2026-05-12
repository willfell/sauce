---
name: cowork:check-vault-routing
description: Verify required MCP backends are reachable AND (v0.31.0) the vault is bootstrapped under the engagement-aware schema; abort orchestrator cleanly if not.
inputs:
  required: list[string]
  bootstrapped_required: boolean (default true)
outputs:
  status: string
tags: [cowork, routing]
---

# cowork:check-vault-routing

Confirms the orchestrator can proceed by probing each named MCP backend with a lightweight read. FAT: never returns raw MCP error objects to the orchestrator; only the normalized status string. The orchestrator MUST check the return value and abort cleanly if not `"ready"`.

## Inputs
- `required`: list of MCP backend identifiers. Valid names:
  - `obsidian` - vault read/write surface
  - `gmail` - Gmail search + read
  - `google-calendar` - calendar event listing
  - `brex` - Brex card limits / banking transactions (the real finance backend)
  - `imessage` - iMessage activity (variant A or B per `spice/cowork/context/mcp-integrations.md`)
- `bootstrapped_required` (v0.31.0; boolean; default `true`): when `true`, in addition to the
  MCP-availability probes the routing check also asserts the vault is bootstrapped under the
  cowork@0.2.0+ engagement-aware schema. The check reads
  `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter` and
  requires the `engagements[]` array to be present and non-empty. When `false`, the
  bootstrap-state check is skipped — `cowork:bootstrap-vault` itself uses this path to
  invoke routing without recursion.

> [!warning]+ Personal-card debt tracking is DEGRADED
> Personal cards (Apple, Discover, Capital One, SCHEELS) have NO MCP integration in the Anthropic-managed catalog at this time. The `brex` probe only validates Brex-issued card connectivity. `cowork:gather-cc-debt-snapshot` returns partial data (Brex totals only) and renders a `> [!warning]+` callout in place of the missing personal-card block. See `gather-cc-debt-snapshot/SKILL.md:24` `# TODO(cycle)` for the integration gap.

## Outputs
- `status`: one of:
  - `"ready"` - every probed backend responded successfully AND (when `bootstrapped_required: true`) the vault has a non-empty `engagements[]` in `vault-config.md`
  - `"missing:<name>"` - first backend that failed connectivity (probe order = input order)
  - `"not-bootstrapped"` (v0.31.0) - `bootstrapped_required: true` AND `vault-config.md` is absent or has an empty/missing `engagements[]`. Return shape (when callers handle it as a structured object) is `{ status: "not-bootstrapped", message: "Vault not bootstrapped; run 'Use Skill cowork:bootstrap-vault'." }`.
  - `"error:<message>"` - unexpected exception during probing

## Steps
1. For each `name` in `required`, in order:
   - `obsidian`: call `mcp__obsidian__get_vault_stats` with no args. Success = any non-error return.
   - `gmail`: call `mcp__claude_ai_Gmail__list_labels` with no args. Success = list returned.
   - `google-calendar`: call `mcp__claude_ai_Google_Calendar__list_calendars` with no args. Success = list returned.
   - `brex`: call `mcp__claude_ai_Brex__get_user_myself` with no args. Success = a user object returned. (Lightweight read; no side effects.)
   - `imessage`: probe variant A (`mcp__Read_and_Send_iMessages__get_unread_imessages`) first; on tool-not-found error, probe variant B (`mcp__messages__tool_fuzzy_search_messages` with empty term). Success = either variant returns.
2. On the FIRST failure (tool-not-found, not-connected, auth-error, or any non-zero error response), return `"missing:<name>"` IMMEDIATELY. Do NOT continue probing - fail fast.
3. (v0.31.0) If `bootstrapped_required` is `true` (default): call `mcp__obsidian__get_frontmatter` with path `spice/cowork/context/vault-config.md`.
   - If the call returns a not-found / file-absent error, return `{ status: "not-bootstrapped", message: "Vault not bootstrapped; run 'Use Skill cowork:bootstrap-vault'." }`.
   - If the call returns frontmatter but `engagements` is missing OR `engagements` is not an array OR `engagements.length === 0`, return the same `not-bootstrapped` object.
   - On any unexpected exception, treat as `"error:<message>"`.
4. If all probes succeed AND (when applicable) the bootstrap-state assertion passed, return `"ready"`.

## Returns
A single string (legacy paths) OR a structured object (v0.31.0 not-bootstrapped path). Examples:
- `"ready"`
- `"missing:gmail"`
- `"missing:brex"`
- `"error:rate-limited"`
- `{ "status": "not-bootstrapped", "message": "Vault not bootstrapped; run 'Use Skill cowork:bootstrap-vault'." }` (v0.31.0)

## Errors
- Unexpected exception during probe (e.g., network timeout, malformed response): catch and return `"error:<short message>"` where `<short message>` is the exception's first 60 chars.
- This sub-skill never raises. The orchestrator's contract: check return; if not `"ready"`, emit Notice via Obsidian (e.g., `cowork:morning-briefing aborted - <status>`) and exit before any write.
- `imessage` variant absence is NOT a hard fail at the routing layer - the gather sub-skill handles graceful degradation. Only return `"missing:imessage"` if BOTH variants fail.
