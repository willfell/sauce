---
name: cowork:gather-gmail
description: Pull last-window Gmail threads for one engagement (scoped by engagement.gmail_label when set), categorize Action / Awaiting / FYI, emit Inbox digest callout.
inputs:
  engagement_id: string
  window: string
  filters: list[string]
  max_threads: number
  exclude_categories: list[string]
outputs:
  markdown: string
  action_required: list[object]
  fyi: list[object]
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-gmail

Searches Gmail for human-relevant threads from the last `lookback` window, categorizes each into **Action needed**, **Awaiting reply**, or **FYI**, and emits a single `[!example]+ Inbox digest` callout for the daily note.

## Inputs

- `engagement_id` (string, required): id of the engagement this gather runs for. Resolves to per-engagement Gmail scope.
- `window` (string, optional, default `"newer_than:1d"`): a Gmail search-query fragment specifying the time window. Examples: `"newer_than:1d"`, `"newer_than:12h"`, `"newer_than:7d"`. Caller passes the full `newer_than:<value>` clause.
- `filters` (list[string], optional, default `["-category:promotions", "-category:social", "-category:updates", "-category:forums"]`): list of additional Gmail search-query fragments appended verbatim. Caller controls exclusion / inclusion patterns.
- `exclude_categories` (list[string], optional): alternate input shape for the same purpose as `filters`. When both are present, `filters` wins.
- `max_threads` (number, optional, default `25`): hard cap on threads to fully expand via `get_thread`.

## Outputs

- `markdown` (string): a single `> [!example]+ Inbox digest` callout, paste-ready.
- `action_required` (list[object]): structured rows `{ from, subject, snippet, action_hint }` for the morning Email callout's Action-Required table.
- `fyi` (list[object]): same shape, populated for the FYI table.

## Steps

1. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`. Look up `engagements[]` entry where `id == engagement_id`. Capture `engagement`. If not found, return the Gmail-unavailable warning callout + Notice `cowork:gather-gmail — engagement '<id>' not in vault-config.md`.
2. Compose query: `{{window}} <space-joined filters>`. If `engagement.gmail_label` is set, append `label:<engagement.gmail_label>` to the filter list. (When only `exclude_categories` is provided, treat it as the filter list.)
3. Call `mcp__claude_ai_Gmail__search_threads` with `query: <composed>`, `max_results: {{max_threads}}`.
3. For each returned thread id, call `mcp__claude_ai_Gmail__get_thread` with `thread_id: <id>` and capture: latest `from`, `subject`, `snippet`, whether the user is the latest sender (= awaiting reply from them) or recipient (= action may be needed).
4. Classify each thread:
   - **Action needed**: latest message is FROM someone else AND snippet contains imperative phrasing (`please`, `can you`, `need`, `?`, `due`, `deadline`, `confirm`, `reply`).
   - **Awaiting reply**: latest message is FROM the user (the user already replied; waiting on the other party).
   - **FYI**: everything else.
5. **Resolve sender + build per-thread bullet.** For each thread:
   - Extract `<sender_name>` and `<sender_email>` from the latest message's `from` field.
   - Call `cowork:resolve-person` with `input: <sender_email>`, `prefer_type: "email"`, `engagement_id: <engagement_id>`. On miss, retry with `input: <sender_name>`, `prefer_type: "name"`, `engagement_id: <engagement_id>`.
   - **On resolve hit:** emit `**[[<person_basename>]]** - <Subject> - [first 80 chars of snippet, ellipsis-truncated]`.
   - **On resolve miss:** emit `**<sender_name>** - <Subject> - [first 80 chars of snippet, ellipsis-truncated]` (current plaintext behavior preserved).

   The bold-wrap (`**...**`) is preserved in BOTH branches for callout-table parsability.
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

## MCP routing

This skill can pull email data from any of the following MCPs, in priority order:

1. **Gmail** — `mcp__claude_ai_Gmail__search_threads` (Anthropic-managed; available in personal vaults).
2. **Outlook mail** — `mcp__claude_ai_Outlook__*` (when wired by the user).

At runtime: introspect on the available tool list. Pick the first MCP whose primary thread-search tool is available. If none are available, do **NOT** attempt the call. Instead emit:

  gather-skipped: no email MCP available in this Claude Code runtime

Pass `warning: gmail_unavailable` (or `warning: email_unavailable` for non-Gmail providers — the orchestrator normalizes) up to the orchestrator.
