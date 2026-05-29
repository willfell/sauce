---
name: cowork:gather-from-served-by
description: Vendor-agnostic gather sub-skill for `override_classified` and `custom_kind` MCPs. Given { kind_name, kind_title, served_by, what_matters, question_set_answers?, today, range, timezone }, enumerates the agent's mcp__<served_by>__* tools, dispatches a gather per what_matters, returns a `> [!example]+ <kind_title>` markdown callout. Used by atomic-note orchestrators in their priority loop when the canonical-vendor gather path doesn't apply.
inputs:
  kind_name: string
  kind_title: string
  served_by: string
  what_matters: string
  question_set_answers: object | null
  today: string
  range: object
  timezone: string
outputs:
  markdown: string
  status: string
  served_by_used: string
  tools_used: list[string]
  reason: string | null
tags: [cowork, gather, sub-skill, vendor-agnostic]
---

# cowork:gather-from-served-by

Generic gather for MCPs whose tool surface doesn't match a canonical vendor (Outlook M365 UUID gateway, internal Azure DevOps gateways, etc.). Replaces the assumption that calendar lives at `mcp__claude_ai_Google_Calendar__*` — instead enumerates whatever tools the served_by namespace exposes and dispatches the gather inline.

## Inputs

- `kind_name` (string, required): one of `calendar` / `email` / `chat` / `finance` (override_classified case) OR a user-defined kind name (custom_kind case).
- `kind_title` (string, required): markdown section title for the `[!example]+` callout. Title-cased mechanically from `kind_name` for custom kinds; fixed lookup for known kinds (Calendar / Email / Chat / Finance).
- `served_by` (string, required): MCP namespace string (e.g., `45224a84-ce0e-459b-a016-909ab178ad8c` for M365, `github` for GitHub).
- `what_matters` (string, required): free-text gather contract pulled from `user-preferences.md` `mcps.<kind>.what_matters`.
- `question_set_answers` (object, optional): when kind is known (calendar/email/chat/finance), the captured answers for the kind's question set (e.g., `vip_senders`, `surface_event_kinds`). `null` for custom kinds.
- `today` (string, required): `YYYY-MM-DD` from `cowork:date-context`.
- `range` (object, required): `{ start: <YYYY-MM-DD>, end: <YYYY-MM-DD> }` window for the gather.
- `timezone` (string, optional, default `"America/Denver"`): IANA timezone.

## Outputs

- `markdown` (string): one `> [!example]+ <kind_title>` callout, paste-ready.
- `status` (string): one of `"ready"` | `"skipped:no-tools"` | `"failed:served-by-unreachable"` | `"failed:bad-output"` | `"failed:<reason>"`.
- `served_by_used` (string): echoes `served_by`.
- `tools_used` (list[string]): tool names the agent invoked, for audit.
- `reason` (string | null): present when status != "ready".

## Steps

1. **Enumerate available tools.** Inspect your current tool list. Filter to entries starting with `mcp__<served_by>__`. Capture as `available_tools[]`. If empty, return `{ status: "skipped:no-tools", reason: "served_by namespace exposes no tools in this session", served_by_used: <served_by>, tools_used: [] }`.

2. **Optional reachability probe.** Pick a cheap list/get-style tool from `available_tools` (e.g., `list_*` or `search_*` verb). Call it with a minimal argument. On `MCP_UNAVAILABLE` or equivalent, return `{ status: "failed:served-by-unreachable", reason: "<msg>", served_by_used, tools_used: [<probe_tool>] }`. Skip the probe when no obvious list-verb tool exists — degrade gracefully and let the subsequent gather calls surface unreachability.

3. **Compose dispatch contract (mental, not a tool call).** You are the gathering agent. Frame your gather task internally as:

   ```
   Gather <kind_name> data for <today> from MCP namespace <served_by>.

   **What matters**:
   <what_matters verbatim>

   **Captured answers** (if question_set_answers != null):
   <YAML dump of question_set_answers>

   **Available tools**:
   <list of available_tools>

   **Output contract**:
   Return ONE `> [!example]+ <kind_title>` markdown callout.
   - Aim for ≤200 words.
   - Bulleted lines preferred (no tables — cross-vendor portability).
   - Honor what_matters as the gather contract.
   - Window: <range.start> to <range.end> (timezone: <timezone>).
   ```

4. **Execute the gather.** Invoke whatever tools from `available_tools[]` best satisfy what_matters within the range/timezone. Compose the markdown callout per the output contract.

5. **Validate output.** The composed markdown MUST:
   - Start with `> [!example]+ <kind_title>\n`.
   - Contain no top-level triple-backticks (preserves callout integrity).
   - Be ≥ 80 characters (one-line "no data" callouts are acceptable; sub-minimum suggests truncation).

6. **On validation failure**, return `{ status: "failed:bad-output", reason: "<which-check-failed>", served_by_used, tools_used }`.

7. **On success**, return `{ status: "ready", markdown: <composed>, served_by_used, tools_used: [<tools you invoked>] }`.

## Source URL requirements

The output `markdown` MUST include source URLs when the `served_by` MCP exposes them. The user reads briefings in Obsidian where inline markdown links open in the browser; URL-less prose is much less useful than a one-click jump to the source.

**How to find URLs in tool results:** when invoking tools from `available_tools`, inspect each return value for URL-shaped fields. Common field names across MCPs:

- `url`, `web_url`, `webUrl`, `webLink`, `html_url`, `htmlUrl`
- `permalink`, `permalink_url`
- `_links.html.href`, `_links.web.href` (HAL-style)
- `link`, `href`

If a tool result includes any of these, surface the URL inline in your `[!example]+ <kind_title>` callout as `**[<short-label>](<url>)**: <1-line context>`.

**Per-kind expected URL discipline:**

| kind_name | Strictness | Expected URL shape |
|---|---|---|
| `github` | **MUST** | `https://github.com/<owner>/<repo>/pull/<n>` or `/issues/<n>` per PR/issue bullet — `html_url` on GitHub API responses |
| `ado` | **MUST** | Work-item URL per ticket bullet — typically `https://dev.azure.com/<org>/<proj>/_workitems/edit/<id>`; surfaced as `_links.html.href` or `url` |
| `email` | **MUST** | Message permalink per surfaced thread — `webLink` field on the message resource (Outlook/M365 Graph) |
| `calendar` | **SHOULD** | Outlook web event link — `webLink` on the event resource (omit only when MCP genuinely lacks one) |
| `chat` | **SHOULD** | Teams chat/channel message permalink — `webUrl` on the message resource (omit only when MCP genuinely lacks one) |
| `finance` | **SHOULD** | Receipt/statement URL when exposed by the MCP |
| any custom kind beyond the above | **SHOULD** | Any URL field present in tool results |

**If a MUST-kind gather returns markdown with NO URLs:** that's a contract violation. Re-inspect tool results, verify whether the MCP genuinely exposes no URL field (the answer is almost always no for github/ado/email — they all expose URLs). Either include the URLs OR emit a brief explanatory line at the bottom of the callout: `> _Note: <served_by> did not expose URL fields on <tool_name> in this run._`

**Inline-link formatting examples:**

```
> [!example]+ Github
> - **[PR 234: Add NSP rules for hpcc-prod](https://github.com/accuris/internal-platform/pull/234)**: Hayden requested your review (filed Wed 16:42); 3 files touched, no test changes
> - **[PR 247: Decommission old document-registry-stage](https://github.com/accuris/internal-platform/pull/247)**: yours, awaiting Stefan; merged-into-target branch already
> - **[Issue 89: Bom Reporting CSV export](https://github.com/accuris/bom-reporting/issues/89)**: re-opened by Ying yesterday; you're on the assignees
```

```
> [!example]+ Ado
> - **[705679 — Document Registry Stage cutover bake step](https://dev.azure.com/accuris/EPD/_workitems/edit/705679)**: yours; moved to Active Tue; linked to feature 698094
> - **[704521 — Azure NSP rules round 5](https://dev.azure.com/accuris/EPD/_workitems/edit/704521)**: Hayden's; closed Wed 16:30
```

This URL requirement applies regardless of dispatch path. It binds the agent's gather output; the dry-run helper validates the markdown's structural shape but cannot validate URL presence (it can't know what URLs the MCP would have exposed in a real session).

## Dry-run mode

For test harnesses, this skill's helper at `platform/blueprints/cowork/helpers/gather-from-served-by-helper.js` exports `gatherFromServedBy({ ...inputs, dry_run_answers })`. The `dry_run_answers` shape:

```
dry_run_answers: {
  available_tools: [<full tool name>, ...],  // pre-supplied; skips step 1's enumeration
  agent_markdown: <string>,                   // pre-supplied composed markdown; skips step 4
  tools_used: [<tool name>, ...]              // pre-supplied audit list
}
```

The helper performs steps 5-7 (validate + return) but skips steps 1-4 (the live enumeration + agent dispatch).

## Returns

`{ markdown, status, served_by_used, tools_used, reason }` per Outputs.

## Test fixtures

HC-V0780-B1 (chat override), HC-V0780-B2 (ado custom), HC-V0780-B3 (no tools) in `platform/test/run-cowork-smoke.js`.
