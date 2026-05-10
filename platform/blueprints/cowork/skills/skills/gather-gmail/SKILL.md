---
name: cowork:gather-gmail
description: Pull last-24h Gmail threads, categorize Action / Awaiting / FYI, emit Inbox digest callout.
inputs:
  window: string
  filters: list[string]
  max_threads: number
  exclude_categories: list[string]
outputs:
  markdown: string
  action_required: list[object]
  fyi: list[object]
tags: [cowork, gather]
---

# cowork:gather-gmail

Searches Gmail for human-relevant threads from the last `lookback` window, categorizes each into **Action needed**, **Awaiting reply**, or **FYI**, and emits a single `[!example]+ Inbox digest` callout for the daily note.

## Inputs

- `window` (string, optional, default `"newer_than:1d"`): a Gmail search-query fragment specifying the time window. Examples: `"newer_than:1d"`, `"newer_than:12h"`, `"newer_than:7d"`. Caller passes the full `newer_than:<value>` clause.
- `filters` (list[string], optional, default `["-category:promotions", "-category:social", "-category:updates", "-category:forums"]`): list of additional Gmail search-query fragments appended verbatim. Caller controls exclusion / inclusion patterns.
- `exclude_categories` (list[string], optional): alternate input shape for the same purpose as `filters`. When both are present, `filters` wins.
- `max_threads` (number, optional, default `25`): hard cap on threads to fully expand via `get_thread`.

## Outputs

- `markdown` (string): a single `> [!example]+ Inbox digest` callout, paste-ready.
- `action_required` (list[object]): structured rows `{ from, subject, snippet, action_hint }` for the morning Email callout's Action-Required table.
- `fyi` (list[object]): same shape, populated for the FYI table.

## Steps

1. Compose query: `{{window}} <space-joined filters>`. (When only `exclude_categories` is provided, treat it as the filter list.)
2. Call `mcp__claude_ai_Gmail__search_threads` with `query: <composed>`, `max_results: {{max_threads}}`.
3. For each returned thread id, call `mcp__claude_ai_Gmail__get_thread` with `thread_id: <id>` and capture: latest `from`, `subject`, `snippet`, whether the user is the latest sender (= awaiting reply from them) or recipient (= action may be needed).
4. Classify each thread:
   - **Action needed**: latest message is FROM someone else AND snippet contains imperative phrasing (`please`, `can you`, `need`, `?`, `due`, `deadline`, `confirm`, `reply`).
   - **Awaiting reply**: latest message is FROM the user (the user already replied; waiting on the other party).
   - **FYI**: everything else.
5. For each thread, build a one-line bullet: `**[Sender]** - [Subject] - [first 80 chars of snippet, ellipsis-truncated]`.
6. Compose the callout per Returns. Omit empty categories. If all three categories are empty, emit the empty-case callout.
7. Return the assembled markdown.

## Returns

Non-empty case:

```markdown
> [!example]+ Inbox digest - last [lookback]
>
> **Action needed**
> - **[Sender]** - [Subject] - [snippet excerpt]
>
> **Awaiting reply**
> - **[Sender]** - [Subject] - [snippet excerpt]
>
> **FYI**
> - **[Sender]** - [Subject] - [snippet excerpt]
> - +N more not expanded
```

Empty case:

```markdown
> [!example]+ Inbox digest
> No notable email in the last [lookback].
```

## Errors

- **Gmail MCP unavailable / not authenticated / search error:** return:
  ```markdown
  > [!warning]+ Gmail unavailable
  > Gmail MCP not connected. Re-authenticate via the Anthropic connectors UI.
  ```
- **Missing `window`:** fall back to `"newer_than:1d"` silently (no warning).
- Never throw; always return a paste-ready callout string.
