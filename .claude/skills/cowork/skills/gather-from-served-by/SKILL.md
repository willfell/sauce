---
name: cowork:gather-from-served-by
description: Vendor-agnostic gather sub-skill for `override_classified` and `custom_kind` MCPs. Given { kind_name, kind_title, served_by, what_matters, question_set_answers?, today, range, timezone }, enumerates the agent's mcp__<served_by>__* tools, dispatches a gather per what_matters, returns a `> [!example]+ <kind_title>` markdown callout. Used by atomic-note orchestrators in their priority loop when the canonical-vendor gather path doesn't apply.
inputs:
  kind_name: string
  kind_title: string
  served_by: string
  what_matters: string
  question_set_answers: object | null
  hard_rules: list[string]
  siblings: list[{name,body}]
  callout_type: string
  inner_circle_resolved: list[{name, person_link, person_basename, aliases_by_type, matched_via, collision_warning}]
  engagement_id: string
  today: string
  range: object
  timezone: string
outputs:
  markdown: string
  status: string
  served_by_used: string
  tools_used: list[string]
  callout_type_used: string
  inner_circle_resolved_count: integer
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
- `inner_circle_resolved` (list, optional): pre-resolved inner-circle allowlist from `composeInnerCircleAllowlist` (see `cowork/helpers/resolve-inner-circle-helper.js`). Each entry: `{ name, person_link, person_basename, aliases_by_type: {phone, email, name, handle}, matched_via, collision_warning }`. Empty list / absent → no allowlist injected; ambient soft-prompt still applies.
- `engagement_id` (string, optional): forwarded into the dispatch contract so the per-emission resolver call inherits the orchestrator's engagement scope. Reserved field per v0.89.0 `cowork:resolve-person` contract; safe to omit.
- `today` (string, required): `YYYY-MM-DD` from `cowork:date-context`.
- `range` (object, required): `{ start: <YYYY-MM-DD>, end: <YYYY-MM-DD> }` window for the gather.
- `timezone` (string, optional, default `"America/Denver"`): IANA timezone.

## Outputs

- `markdown` (string): one `> [!example]+ <kind_title>` callout, paste-ready.
- `status` (string): one of `"ready"` | `"skipped:no-tools"` | `"failed:served-by-unreachable"` | `"failed:bad-output"` | `"failed:<reason>"`.
- `served_by_used` (string): echoes `served_by`.
- `tools_used` (list[string]): tool names the agent invoked, for audit.
- `inner_circle_resolved_count` (integer): echoes the count of validated `inner_circle_resolved` entries (0 when absent / empty). Audit aid.
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
   Return ONE `> [!<callout_type>]+ <kind_title>` markdown callout (where `<callout_type>` is the input field; defaults to `example` when absent or invalid).
   - Aim for ≤200 words.
   - Render data in tables OR bullets, whichever gives the highest information density per vertical inch. Use tables for structured data with 3+ columns per item (IDs, timestamps, lanes, links); use bullets for narrative or single-axis lists. Mixed within one callout is fine (e.g., a table for items + bullet narrative for cross-item context).
   - Honor what_matters as the gather contract — microscope `## Output shape` directives ALWAYS WIN over this default rendering guidance.
   - Window: <range.start> to <range.end> (timezone: <timezone>).
   ```

**Known people in scope.** When the orchestrator passes a non-empty `inner_circle_resolved[]` input, inject it into the dispatch contract (Step 3) directly AFTER the `**Hard rules ...**` block and BEFORE the closing window line, formatted as:

````
**Known people in scope (resolve-time allowlist):**

- **<name>** → `<person_link>` (aliases by type: phone=<JSON>, email=<JSON>, handle=<JSON>; <name_aliases JSON if any>; collision: <basename | basename> when present)
- …

When you emit a bullet or table cell that mentions one of these names — directly, OR via any of the typed aliases listed (phone / email / handle / name variants observed in tool results) — render the bold-wrapped wikilink: `**[[<person_basename>]]**`. Preserve bold for callout-table parsability.

When you emit a bullet that mentions a person NOT in this allowlist, call `cowork:resolve-person { input: <observed_name_or_handle>, prefer_type: <"email" | "phone" | "name" | "handle" inferred from data shape>, engagement_id: <engagement_id> }`. On `resolved: true`, emit `**[[<person_basename>]]**`; on `resolved: false`, emit plaintext `**<observed>**`. This rule binds the callout BODY only; literal display strings inside event titles, email subjects, message previews remain verbatim per the canonical `wikilink_people` rule.
````

When `inner_circle_resolved` is absent / empty, omit the preamble + bullet-list entirely. The ambient soft-prompt paragraph (per-emission resolver call) still applies so any kind can still emit wikilinks for ambient mentions.

4. **Execute the gather.** Invoke whatever tools from `available_tools[]` best satisfy what_matters within the range/timezone. Compose the markdown callout per the output contract.

5. **Validate output.** The composed markdown MUST:
   - Start with `> [!<callout_type>]+ <kind_title>\n` (where `<callout_type>` is the resolved input field).
   - Contain no top-level triple-backticks (preserves callout integrity).
   - Be ≥ 80 characters (one-line "no data" callouts are acceptable; sub-minimum suggests truncation).

6. **On validation failure**, return `{ status: "failed:bad-output", reason: "<which-check-failed>", served_by_used, tools_used }`.

7. **On success**, return `{ status: "ready", markdown: <composed>, served_by_used, tools_used: [<tools you invoked>] }`.

## Microscope output-shape contract (INLINE — do not delegate to a separate read)

v0.97.4: under wrapper-load the LLM was skipping the read-microscope step entirely and improvising flat reverse-chronological output. The four mandatory structural elements below are now INLINED into this SKILL body so they reach the agent regardless of whether the microscope file is opened.

BEFORE composing the per-kind callout, READ the microscope file in full at `spice/cowork/prompts/per-mcp/<kind_name>/microscope.md` AND echo back the four section headers verbatim as a Notice (e.g. `cowork:gather-from-served-by: microscope sections for chat = "Utilization snapshot" / "REPLY OWED - DIRECT" / "REPLY OWED - GROUP" / "TIME-SENSITIVE"`). If you cannot find the microscope file, emit Notice `cowork:gather-from-served-by: microscope file not found for <kind_name> — applying structured fallback` and continue with a structured fallback per the FOUR mandatory elements below — do NOT improvise a flat list.

**The FOUR mandatory structural elements** every per-kind `> [!<callout_type>]+ <kind_title>` callout MUST carry:

1. **Utilization snapshot lead-in.** A 1-line situation lead-in distilled from the gather window (e.g. for chat: `> 47 messages across 8 threads; 3 direct mentions, 1 reply owed since yesterday afternoon.`). This is the FIRST line under the callout header — NOT a generic "Recent activity:" placeholder. The microscope file's narrative dictates the exact phrasing; the fallback when no microscope is found is `> <window summary>: <N items> across <M sources>; <X> needing response.`.

2. **Urgency-tiered subsections with bold subheads when the microscope specifies tiers.** For chat specifically, the microscope mandates these verbatim tier labels as bold subheads, in declared order:
   - `**REPLY OWED - DIRECT**` — direct messages or @mentions awaiting your reply
   - `**REPLY OWED - GROUP**` — group threads awaiting your reply
   - `**TIME-SENSITIVE**` — items with embedded deadlines or time anchors
   - `**FYI - actionable**` — items you should know about that may need action later
   - `**FYI - ambient**` — context-only items, no action implied

   For email: `**REPLY OWED**` / `**TIME-SENSITIVE**` / `**FYI**`. For ado/github: `**MINE - OPEN**` / `**MINE - BLOCKED**` / `**REVIEW REQUESTED**` / `**FYI**`. When the microscope file declares different labels, the microscope wins; when it declares NONE, use the kind's default labels above. NEVER emit a single flat reverse-chronological list under any tier-bearing kind.

3. **Inner-circle hits wrapped as `**[[Person Basename]]**`.** When the dispatch contract's "Known people in scope" allowlist is non-empty, every mention of a listed person (directly OR via any of their typed aliases — phone / email / handle / name variants) MUST render as the bold-wrapped Obsidian wikilink `**[[Person Basename]]**`. Preserve bold for callout-table parsability. Plaintext-only people-names indicate the wikilink_people hard rule was violated.

4. **For calendar specifically: a MARKDOWN TABLE — NOT a bulleted list.** Columns: `| Time | Event | Organizer | Status |`. One row per surfaced event, ordered chronologically. The leading "Utilization snapshot" line above the table still applies (e.g. `> 4 events today; 2 with you as organizer, 1 conflict at 14:00.`). Calendar in bullet form indicates the microscope's `## Output shape` directive was ignored — re-render as table before validation.

### Pre-render self-check (last-mile prose-invariant audit)

After composing the callout and BEFORE returning it to the orchestrator, run this four-point checklist mentally:

1. **Snapshot line present?** First content line under the callout header is a Utilization snapshot, not a generic placeholder.
2. **Urgency tiers / subheads present per microscope?** When the kind's microscope (or the fallback default) specifies tiered subheads, they appear in declared order as bold subheads — NOT a flat list.
3. **Inner-circle wikilinks intact?** Every name from the `Known people in scope` allowlist that appears in the body is wrapped as `**[[Basename]]**`.
4. **For calendar: table format used?** When kind_name == "calendar", the body contains a markdown table with the columns above — NOT a bulleted list of events.

If any point fails, RE-RENDER the callout before returning. The structural backstops at Step 5 (output validation) cannot detect prose-invariant drift; the write-helper guards added in v0.97.4 catch rating + anti-echo prose invariants but the per-kind output shape is yours.

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

## Hard rules

When the orchestrator passes a non-empty `hard_rules[]` input, inject it into the dispatch contract (Step 3) under `**Hard rules (bind this callout's TITLE and BODY, apply verbatim):**` and obey every rule when composing the `[!example]+ <kind_title>` callout. These bind BOTH the callout title and its body — e.g. a "no emoji anywhere" rule means the title is `> [!example]+ Finance` (never `> [!example]+ 💰 Finance`) and no table cell or bullet carries a pictographic glyph. `hard_rules[]` is sourced from `prefs.effective_hard_rules` (see `cowork:read-user-preferences`). When empty or absent, compose normally.

**Precedence note (v0.90.0):** the FIRST hard rule in `hard_rules[]` is the canonical `wikilink_people` rule (PRECEDENCE OVERRIDE prefix in its body) injected at the top of `effective_hard_rules[]` by `read-user-preferences-helper.js`. It governs person-name format unconditionally: when a person is in the `Known people in scope` allowlist OR resolves via `cowork:resolve-person`, emit `**[[Basename]]**` even when a microscope's `## Output shape` instructs a different per-item format. The "microscope `## Output shape` directives ALWAYS WIN" phrasing in Step 3 above refers to STRUCTURAL layout choice (table vs bullet, which fields per item, grouping order) — it does NOT override hard rules. Microscope output shape governs LAYOUT; the wikilink hard rule governs IDENTIFIER format. Both can apply to the same callout simultaneously.

## User-supplied reference

When the orchestrator passes a non-empty `siblings[]` input (`list[{name, body}]`), inject each entry into the dispatch contract (Step 3) directly AFTER the `<what_matters verbatim>` block (and after the optional `**Captured answers**` block when `question_set_answers != null`) and BEFORE the `**Hard rules ...**` block, formatted as:

```
**User-supplied reference: <name>**

<body>
```

(One block per sibling, in array order, with one blank line between entries.) These are USER-owned context files that live alongside `microscope.md` at `spice/cowork/prompts/per-mcp/<kind>/`. The agent reads each as additional context and applies it per the microscope.md narrative (which by convention names each sibling and its role — e.g., "Use `contacts-map.md` to resolve sender phone numbers to display names before composing the callout"). Empty or absent `siblings[]` → omit the section entirely. Sibling files bind the agent's INPUT, not its OUTPUT structure: do not let them rewrite the `[!example]+ <kind_title>` callout shape. The helper return echoes back the injected filenames as `siblings_used: list[string]`.

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

### Structured items (NEW v0.96.0)

In addition to `markdown`, return `items[]` — one entry per surfaced row. Items[].kind === input.kind_name (passed by the caller). The default_features per kind come from `data/kind-patterns.json` (S2.2 — `default_features: [...]` per kind). At v0.96.0 ship-time, treat all features beyond `is_warning` as best-effort; the kind classifier's default_features list is the authoritative source post-S2.

```json
{
  "items": [
    {
      "item_id": "<deriveItemId({ kind: input.kind_name, engagement_id, day, stable_key: <kind-appropriate stable id from result row> })>",
      "kind": "<input.kind_name>",
      "callout_type": "<input.callout_type — already provided>",
      "title": "<row.title or composed>",
      "features": {
        "is_warning": <bool>
      }
    }
  ]
}
```

For S1.5, the structural contract is the deliverable. Per-kind features[] population deferred to S2.2 when kind-patterns.json's `default_features:` mapping lands.

## Test fixtures

HC-V0780-B1 (chat override), HC-V0780-B2 (ado custom), HC-V0780-B3 (no tools) in `platform/test/run-cowork-smoke.js`.
