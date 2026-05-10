---
name: cowork:gather-imessage
description: Pull last-24h unresponded inbound iMessage threads and emit an iMessages callout block.
inputs:
  window_days: number
  scope: string
  inner_circle: string
outputs:
  markdown: string
  unanswered_count: number
tags: [cowork, gather]
---

# cowork:gather-imessage

Surfaces inbound iMessage threads from the last `lookback_hours` where the user has NOT yet replied. Emits a `[!example]+ iMessages` callout. Because Anthropic does not currently ship a managed iMessage MCP server, this sub-skill operates in degraded mode by default and emits a warning callout - see Errors.

# TODO(cycle): iMessage MCP integration TBD. Two known third-party variants exist (`mcp__Read_and_Send_iMessages__read_imessages` and `mcp__messages__tool_fuzzy_search_messages`) per the legacy headspace prompt; once one is bundled into the Sauce MCP layer, replace the warning-callout path in Steps + Errors with real tool calls. Until then this skill returns the unavailable callout in all cases.

## Inputs

- `window_days` (number, optional, default `1`): window for the inbound scan, in days. Morning briefing typically passes `3`; weekly review passes `7`; monthly review passes `31`.
- `scope` (string, optional, default `"inner-circle-and-groups"`): one of `"inner-circle"` | `"inner-circle-and-groups"`. Constrains which threads are surfaced; weekly/monthly typically pass `"inner-circle"` for a frequency map.
- `inner_circle` (string, optional): comma-separated E.164 phone numbers (e.g. `+13035551212,+17205551313`) the orchestrator wants surfaced first when an MCP becomes available.

## Outputs

- `markdown` (string): a single `> [!example]+ iMessages` callout, paste-ready.
- `unanswered_count` (number): count of threads where the user has not yet replied.

## Steps

1. Detect whether an iMessage MCP is connected. Probe by name:
   - `mcp__Read_and_Send_iMessages__read_imessages` (Variant A)
   - `mcp__messages__tool_fuzzy_search_messages` (Variant B)
2. **If neither available** (current default state): skip remaining steps and return the unavailable callout from Errors.
3. **(Variant A path, when wired):** call `mcp__Read_and_Send_iMessages__read_imessages` once per inner-circle number with `since_hours: <window_days * 24>`. Aggregate inbound messages where the user has NOT sent a reply after the latest inbound.
4. **(Variant B path, when wired):** call `mcp__messages__tool_fuzzy_search_messages` with a single query bounded to `since_hours: <window_days * 24>`; filter results to inbound-only and de-duplicate by chat handle. When `scope = "inner-circle"`, additionally filter to inner-circle handles only.
5. For each unanswered thread build: `**[Contact display]** - [HH:MM] - [first 80 chars of message, ellipsis-truncated]`.
6. Compose the callout per Returns. Empty list -> empty-case callout.
7. Return the assembled string.

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

- **No iMessage MCP connected (current default):** return:
  ```markdown
  > [!warning]+ iMessage unavailable
  > No iMessage MCP server connected. See cowork:gather-imessage TODO for integration status.
  ```
- **MCP tool call fails / returns malformed payload:** return:
  ```markdown
  > [!warning]+ iMessage unavailable
  > iMessage MCP error during fetch. Skipped this run.
  ```
- Never throw; always return a paste-ready callout string.
