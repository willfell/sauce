---
name: cowork:gather-imessage
description: Pull last-24h unresponded inbound iMessage threads and emit an iMessages callout block.
inputs:
  engagement_id: string
  window_days: number
  scope: string
  inner_circle: string
outputs:
  markdown: string
  unanswered_count: number
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-imessage

Surfaces inbound iMessage threads from the last `lookback_hours` where the user has NOT yet replied. Emits a `[!example]+ iMessages` callout. Preferred backend is the user-wired `apple-mcp` server (supermemoryai/apple-mcp); legacy third-party variants are still probed as a fallback. If no backend is connected the sub-skill operates in degraded mode and emits a warning callout - see Errors.

## Inputs

- `engagement_id` (string, required): id of the engagement this gather runs for. **Type-gated**: early-exit silently with `{ markdown: "", unanswered_count: 0 }` if `engagement.type != "personal"` (iMessage gathering only applies to personal engagements; w2-fte / consulting types use different communication channels).
- `window_days` (number, optional, default `1`): window for the inbound scan, in days. Morning briefing typically passes `3`; weekly review passes `7`; monthly review passes `31`.
- `scope` (string, optional, default `"inner-circle-and-groups"`): one of `"inner-circle"` | `"inner-circle-and-groups"`. Constrains which threads are surfaced; weekly/monthly typically pass `"inner-circle"` for a frequency map.
- `inner_circle` (string, optional): comma-separated E.164 phone numbers (e.g. `+13035551212,+17205551313`) the orchestrator wants surfaced first when an MCP becomes available.

## Outputs

- `markdown` (string): a single `> [!example]+ iMessages` callout, paste-ready.
- `unanswered_count` (number): count of threads where the user has not yet replied.

## Steps

1. Detect whether an iMessage MCP is connected. Probe by name, preferring apple-mcp:
   - `mcp__apple-mcp__messages` (Variant C — preferred; supermemoryai/apple-mcp)
   - `mcp__Read_and_Send_iMessages__read_imessages` (Variant A — legacy)
   - `mcp__messages__tool_fuzzy_search_messages` (Variant B — legacy)
2. **If none available**: skip remaining steps and return the unavailable callout from Errors.
3. **(Variant C path — preferred):** call `mcp__apple-mcp__messages` with `operation: "unread"` and `limit: 25`. The tool returns inbound unread items with `displayName` already resolved from Contacts. Filter to the lookback window (`window_days * 24h`); when `scope = "inner-circle"`, additionally intersect against `inner_circle` handles. For deeper per-contact context, optionally follow up with `operation: "read"`, `phoneNumber: <e164>`, `limit: 5` per inner-circle number and keep only items where the latest message has `is_from_me: false`.
4. **(Variant A path — legacy):** call `mcp__Read_and_Send_iMessages__read_imessages` once per inner-circle number with `since_hours: <window_days * 24>`. Aggregate inbound messages where the user has NOT sent a reply after the latest inbound.
5. **(Variant B path — legacy):** call `mcp__messages__tool_fuzzy_search_messages` with a single query bounded to `since_hours: <window_days * 24>`; filter results to inbound-only and de-duplicate by chat handle. When `scope = "inner-circle"`, additionally filter to inner-circle handles only.
6. **Resolve each thread → person link.** For each unanswered thread surfaced in Steps 3-5, call `cowork:resolve-person` with:
   - `input: <displayName || handle>` (prefer apple-mcp's resolved `displayName`; fall back to the E.164 handle).
   - `prefer_type: "phone"` when the handle is E.164 (leading `+`); else `prefer_type: "name"`.
   - `engagement_id: <engagement_id>` (reserved; pass-through for slice E).

   Capture the output's `person_link` (wikilink string on hit, `null` on miss) and `resolved` boolean fields. Empty/whitespace input returns the null shape; treat as miss.
6.5. **Build per-thread bullet (uses resolution from Step 6).** For each unanswered thread:
   - **On resolve hit:** emit `**[[<person_basename>]]** - [HH:MM] - [first 80 chars, ellipsis-truncated]`.
   - **On resolve miss:** emit `**<displayName || handle>** - [HH:MM] - [first 80 chars, ellipsis-truncated]` (current plaintext behavior preserved).

   The bold-wrap (`**...**`) is preserved in BOTH branches so the resulting callout-table parses uniformly upstream. Prefer `displayName` from apple-mcp when present; fall back to the E.164 handle.
7. Compose the callout per Returns. Empty list -> empty-case callout.
8. Return the assembled string.

## Returns

Non-empty case:

```markdown
> [!example]+ iMessages - [N] unanswered
> - **[Contact]** - [HH:MM] - [preview]
> - **[Contact]** - [HH:MM] - [preview]
```

Empty case:

```markdown
> [!example]+ iMessages
> No unanswered iMessages in the last [window_days]d.
```

## Errors

- **No iMessage MCP connected** (e.g. remote / sandboxed runtime where `apple-mcp` is not wired): return:
  ```markdown
  > [!warning]+ iMessage unavailable
  > No iMessage MCP server connected on this host.
  ```
- **MCP tool call fails / returns malformed payload:** return:
  ```markdown
  > [!warning]+ iMessage unavailable
  > iMessage MCP error during fetch. Skipped this run.
  ```
- Never throw; always return a paste-ready callout string.

## MCP routing

This skill can pull iMessage data from any of the following MCPs, in priority order:

1. **apple-mcp** (supermemoryai/apple-mcp) — `mcp__apple-mcp__messages` with `operation: "unread" | "read"`. Preferred. Bundles Contacts so `displayName` is resolved automatically.
2. **Legacy Read_and_Send_iMessages** — `mcp__Read_and_Send_iMessages__read_imessages` (per-number).
3. **Legacy fuzzy messages** — `mcp__messages__tool_fuzzy_search_messages` (single-query fuzzy).

At runtime: introspect on the available tool list. If no iMessage MCP is available, do **NOT** attempt the call. Instead emit:

  gather-skipped: no imessage MCP available in this Claude Code runtime

Pass `warning: imessage_unavailable` up to the orchestrator.

iMessage is macOS-host-bound and not available in remote runtimes. When the host machine has apple-mcp wired, treat unanswered iMessages as a normal gather. When not (remote runtimes, sandboxed CI), treat the skip as routine — the orchestrator should not surface it as a degraded run.
