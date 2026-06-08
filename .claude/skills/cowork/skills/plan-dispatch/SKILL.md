---
name: cowork:plan-dispatch
description: Single pre-flight entry point for the 5 atomic-note orchestrators. Loads engagement record + engagement-type bundle + engagement.overrides, composes the layered preferences tree, reads microscopes/siblings, plans dispatch via dispatch-plan-helper, composes voice contract, resolves the inner-circle allowlist, and returns the 14-key contract that drives Gather + Write phases. v0.96.0 adds Rail-D kind-classifier integration (Step 0), the `pending_confirmations[]` 14th key, and Rail-L weight-aware cadence reordering (composeFinalPreferences reads `prefs.learned_weights` and reorders `cadence_order[*]` arrays via `effective_priority`; exposes `learned_weights_applied` telemetry). Never throws — degrades to `dispatch_mode: "legacy"` on prefs failure so the orchestrator can fall back cleanly.
inputs:
  engagement_id: string
  cadence: string
  reachable_namespaces: string[]
  tools_by_namespace: object
  vault_root: string
  yesterday_memory: object
  user_prefs.learned_weights: object
outputs:
  dispatch_plan: array
  voice_contract: string
  microscopes: object
  siblings: object
  allowlist: object
  render_aspects: object
  cadence_order: object
  tripwire_aspects: array
  kind_titles: object
  effective_hard_rules: array
  dispatch_mode: string
  prefs_status: string
  excluded_themes: array
  pending_confirmations: array
  learned_weights_applied: boolean
tags: [cowork, sub-skill, pre-flight, dispatch, knob-composition, rail-d, rail-l]
---

# cowork:plan-dispatch

Single pre-flight entry point for every atomic-note orchestrator (morning-briefing / midday-tripwire / eod-review / weekly-review / monthly-review). Replaces the ~100 lines of inline `3a memory → 3b read-prefs → 3c dispatch-plan → 3d microscopes → 3e inner-circle` pseudocode that v0.94.x carried byte-identical across all 5 orchestrators.

The 14-key result tree returned by this sub-skill (v0.95.0's 12-key contract + v0.95.1's `excluded_themes[]` + v0.96.0's `pending_confirmations[]`) is the orchestrator's sole source of truth for Gather + Write. Knob composition (engagement-type defaults ⨁ engagement.overrides ⨁ ad-hoc runtime overrides) happens HERE, once, not scattered through gather/write skills.

v0.96.0 adds Rail D (kind classifier) integration: Step 0 invokes `classifyConnectedKinds` to identify which connected MCP namespaces have not yet been confirmed in `user-preferences.mcps`, surfacing them as `pending_confirmations[]` so compose-body can render an in-note detection callout (gated by `render_aspects.new_mcp_notice`).

## Inputs

```
{
  engagement_id:        string,    // REQUIRED — matches an entry in vault-config.md engagements[]
  cadence:              string,    // REQUIRED — one of "morning" | "midday" | "eod" | "weekly" | "monthly"
  reachable_namespaces: string[],  // REQUIRED — runtime MCP namespace set (e.g. ["iMCP", "brex", "github"])
  tools_by_namespace:   object,    // OPTIONAL (v0.96.0) — { <namespace>: [<tool short name>, ...] }
                                   //   derived from the orchestrator's agent tool list by stripping
                                   //   the `mcp__<ns>__` prefix. Required for Step 0's classifier
                                   //   invocation. When absent, classifier is skipped and
                                   //   `pending_confirmations[]` defaults to [].
  vault_root:           string,    // OPTIONAL — vault filesystem root; defaults to cwd-based resolution
  yesterday_memory:     object,    // OPTIONAL (v0.95.1) — return value of cowork:read-memory for the
                                   //   prior day; supplies the carry-forward bullets that become
                                   //   `excluded_themes[]` when `render_aspects.anti_echo == "include"`.
                                   //   When omitted (or null), `excluded_themes` defaults to [].
                                   //   Orchestrators that already invoke read-memory at pre-flight 3a
                                   //   pass their captured `yesterdayMemory` straight through.
  user_prefs.learned_weights: object, // OPTIONAL (v0.96.0 Rail L) — per-engagement learned weight
                                   //   state captured by read-user-preferences from user-preferences.md
                                   //   frontmatter. Shape:
                                   //     { schema_version, totals, per_kind: { <kind>: {
                                   //         weight: number, ticks: int, skips: int, warmup: bool,
                                   //         last_surfaced?: "YYYY-MM-DD",
                                   //         last_updated?: "YYYY-MM-DD"
                                   //       } } }
                                   //   When present, composeFinalPreferences reorders each cadence
                                   //   array via `effective_priority`. When absent / null, cadence
                                   //   ordering is unchanged (bundle ⨁ overrides only).
}
```

## Steps

0. **Classify connected kinds (Rail D, v0.96.0).** When BOTH `reachable_namespaces` AND `tools_by_namespace` are present, invoke `classifyConnectedKinds({ reachable_namespaces, tools_by_namespace, vault_root })` from `helpers/kind-classifier-helper.js`. The classifier consults `spice/cowork/data/kind-patterns.json` (consumer-vault path, falling back to the workshop module path) for deterministic namespace+tool-name globs, an optional LLM fallback (currently unwired), and persists per-namespace results in `spice/cowork/data/kind-classifier-cache.json` keyed by `classifier_version`. Result shape: `{ classified, unclassified, new_since_last_fire, cache_hits }`. Step 14 below converts `new_since_last_fire` into the 14th contract key. Failures inside the classifier are swallowed and replaced by an empty 4-key shell — `plan-dispatch` never throws on Rail-D problems.

   This step is implemented inside `dispatchPlanHelper.planDispatch` so the helper owns the contract; the orchestrator does not invoke the classifier directly. Callers that have already classified (e.g. unit-harness tests, integration tools) may pass `classifier_result` directly to `planDispatch` to bypass the classifier invocation while still surfacing `pending_confirmations[]`.

1. **Vault routing.** READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow its `## Steps` section with `{ required: ["obsidian"] }`. If the vault-routing check fails, propagate that failure verbatim — `plan-dispatch` cannot proceed without routing.

2. **Read user-preferences.** READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow its `## Steps` section with `{}`. Capture the result as `prefs_result = { prefs, status, reason }`.

3. **Decide dispatch mode.** Invoke `dispatchPlanHelper.decideDispatchMode({ prefsStatus: prefs_result.status })` → `dispatch_mode` (`"prefs"` when status === "ok", else `"legacy"`). If `dispatch_mode === "legacy"`, the orchestrator MUST fall through to its legacy gather sequence; this sub-skill still returns the full 14-key contract so the orchestrator can compose its fallback Notice from `prefs_status`.

4. **Read engagement + bundle.** Invoke `dispatchPlanHelper.readEngagement({ engagement_id, vault_root })` → `{ engagement, bundle, overrides, status, reason }`. If `status !== "ok"`, set `dispatch_mode = "legacy"` and capture `reason` for the fallback Notice; downstream steps still execute against the available data.

5. **Compose final preferences.** Invoke `dispatchPlanHelper.composeFinalPreferences({ bundle, overrides, ad_hoc_prefs: null, learned_weights: prefs.learned_weights })` → `{ render_aspects, cadence_order, voice, microscopes_registry, tripwire_aspects, learned_weights_applied }`. This is the FINAL knob layer — Gather + Write read from here, not from the engagement-type JSON directly. Composition order: `bundle` (defaults) ⨁ `overrides` (per-key wins on objects, REPLACES on arrays) ⨁ `ad_hoc_prefs` (reserved; null today). `final.tripwire_aspects` propagates to the 13-key return for midday-tripwire's early-exit + per-aspect dispatch. `final.render_aspects.anti_echo` propagates downstream to step 9's `planDispatch` call where it gates `excluded_themes` derivation.

   **v0.96.0 Rail L — weight-aware cadence reorder.** When `learned_weights` is provided, the helper rewrites each `cadence_order[<cadence>]` array using per-kind `effective_priority`:
   - `base_priority = i` (declared index inside the bundle ⨁ overrides cadence array)
   - **Out-of-warmup, high-deviation gate (`warmup === false` AND `abs(weight - 1.00) > 0.20`)**: `effective_priority = base_priority - (weight * 5)`. A kind whose weight has drifted significantly above 1.00 leaps forward in cadence (and below 1.00 drops back).
   - **Warmup or low-deviation**: `effective_priority = base_priority` (unchanged). Cadence preserves the bundle ⨁ overrides order.
   - **Day-14 must-surface backstop**: the lowest-weight non-warmup kind, when `days_since_last_surfaced` (or `last_updated`) is a positive multiple of 14, gets `effective_priority = base_priority - 25` (`PRIORITY_BUMP * BACKSTOP_MULTIPLIER` = `5 * 5`). Guarantees a long-buried low-weight kind cannot permanently fall off cadence.
   - Each cadence is re-sorted by `effective_priority` ascending; ties preserve declared order. The composed result exposes `learned_weights_applied: boolean` so callers can verify the helper actually consulted `learned_weights` versus ignored it.

6. **Load kind titles.** Invoke `dispatchPlanHelper.loadKindTitles({ vault_root })` → `kind_titles` map (kind → display title). The data file at `spice/cowork/data/kind-titles.json` v1.0.0 is canonical; per-kind microscope `## Output shape` directives (`<! title: My Custom Title !>`) override the data-file value for THAT engagement's gather.

7. **Read per-kind microscopes.** When `final.microscopes_registry` is a non-null object, iterate its `kind_name → microscope_path` entries and READ each file. When the registry is null, fall back to filesystem scan: for each kind in `prefs.priorities`, attempt `spice/cowork/prompts/per-mcp/<kind>/microscope.md` — if absent, that kind has no microscope. Collect into `microscopes = { kind_name: body_string }`.

8. **Read per-kind siblings.** For each kind in `prefs.priorities`, attempt to READ `spice/cowork/prompts/per-mcp/<kind>/siblings/` (a directory of supporting markdown files). Collect into `siblings = { kind_name: [{ name, body }, ...] }`. Missing directories yield empty arrays — not an error.

9. **Plan dispatch.** Invoke `dispatchPlanHelper.planDispatch({ prefs: prefs_result.prefs, reachableNamespaces: reachable_namespaces, tools_by_namespace, vault_root, engagement_id, mcpSkillMap, microscopes, engagement, bundle, overrides: engagement.overrides, yesterdayMemory: yesterday_memory, learned_weights: prefs_result.prefs.learned_weights })` → `{ dispatch_plan, excluded_themes, pending_confirmations, classifier_cache_hit, classifier_result, learned_weights_applied }` (the v0.96.0 contract object). `mcpSkillMap` is read from `spice/cowork/data/mcp-skill-map.json` v2.0.0. `dispatch_plan[]` is the ordered kind entries with per-entry action + served_by + warning reasons (unchanged from v0.94.x shape). `excluded_themes` is the raw carry-forward bullet strings from `yesterday_memory.carry_forward_bullets` when `render_aspects.anti_echo == "include"`, else `[]`. `pending_confirmations[]` is the raw new-since-last-fire namespaces from Step 0's classifier_result. `learned_weights_applied` is true when Rail-L weight-aware cadence reordering or the day-14 backstop fired during composeFinalPreferences (else false). All keys are ALWAYS present, even when null/empty inputs would leave them vacuous — defensive contract. The helper falls back to `prefs.learned_weights` when the explicit `learned_weights` kwarg is undefined/null, so orchestrators that forget to thread it still observe Rail-L behavior from read-user-preferences's parsed frontmatter.

   When the helper is called without v0.95.1+ inputs (`engagement`/`bundle`/`overrides`/`yesterdayMemory`/`classifier_result`/`tools_by_namespace` all absent), it returns the legacy raw array form for backward compatibility with pre-v0.95.1 unit harnesses. Within this sub-skill we ALWAYS pass `engagement` + `bundle`, so we ALWAYS receive the v0.96.0 contract object.

14. **Compose pending_confirmations.** The planDispatch helper (called in Step 9) already surfaces `pending_confirmations` derived from `classifier_result.new_since_last_fire`, and best-effort-writes the `spice/cowork/context/<engagement_id>/pending-mcps.md` state file via `_upsertPendingMcps`. This sub-skill emits the value verbatim — orchestrators consume it via `plan.pending_confirmations` and pass it through Step 14f's compose-body invocation alongside `render_aspects.new_mcp_notice` so compose-body can gate the detection callout. State-file write failures are non-fatal.

10. **Reorder for cadence.** If `final.cadence_order[cadence]` is a non-empty array, reorder `dispatch_plan[]` to match that priority. Entries listed in `cadence_order[cadence]` come first in declared order; entries NOT listed retain their original relative order at the tail. This is how per-cadence knob composition surfaces — orchestrators DO NOT consult `cadence_order` directly.

11. **Compose voice contract.** Invoke `dispatchPlanHelper.composeVoiceContract(final.voice, prefs_result.prefs.effective_hard_rules)` → `voice_contract` (string). The Write phase prepends this verbatim to its compose-body invocation. Also capture `prefs_result.prefs.effective_hard_rules` as the 11th key on the return — `gather-from-served-by` consumes the rules array independently of the voice_contract formatted string.

12. **Resolve inner-circle allowlist.** When `engagement.inner_circle_people` is a non-empty array AND `final.render_aspects.inner_circle_imessage !== "skip"`, for each name call `cowork:resolve-person { input: <name>, prefer_type: "name", engagement_id }`. Thread the original name as `_input` so the helper can surface unresolved names verbatim. Accumulate outputs and invoke `composeInnerCircleAllowlist(resolverOutputs)` from `helpers/resolve-inner-circle-helper.js` → `allowlist = { resolved, unresolved, phone_filter_list }`. When the gate is closed (no inner_circle_people or `inner_circle_imessage: skip`), return `allowlist = { resolved: [], unresolved: [], phone_filter_list: [] }`.

   Orchestrators pass `allowlist.resolved` as `inner_circle_resolved` to every `gather-from-served-by` invocation (along with `engagement_id`). morning-briefing also passes `allowlist.phone_filter_list.join(",")` as `gather-imessage`'s existing `inner_circle:` input. For each name in `allowlist.unresolved[]`, the orchestrator emits Notice `cowork: inner-circle name "<name>" unresolved` AND appends `inner_circle_unresolved:<name>` to the atomic note's `warnings:` array (v0.85.0 plumbing).

13. **Return the 14-key contract.** Per the `## Returns` section below. Every key MUST be present even when null/empty — defensive contract. Atomic-note orchestrators consume the result tree as their single source of truth for Gather + Write.

## Returns

```
{
  dispatch_plan:   [...],          // ordered kind entries; per-entry shape per dispatch-plan-helper
  voice_contract:  "...",          // composed personality + hard_rules header (or "" when voice absent)
  microscopes:     {...},          // kind_name → microscope body string
  siblings:        {...},          // kind_name → [{ name, body }]
  allowlist:       {...},          // inner-circle resolver { resolved, unresolved, phone_filter_list }
  render_aspects:  {...},          // FINAL composed (bundle ⨁ overrides ⨁ ad_hoc)
  cadence_order:   {...},          // FINAL composed per-cadence (the orchestrator only needs cadence_order[cadence])
  tripwire_aspects: [...],         // FINAL composed (overrides REPLACES bundle's array); midday-tripwire's early-exit gate + per-aspect dispatcher
  kind_titles:     {...},          // kind_name → title (data file v1.0.0, falls back to CANONICAL_TITLES const)
  effective_hard_rules: [...],     // string[] — pass-through from read-user-preferences; consumed by gather-from-served-by `## Hard rules` block
  dispatch_mode:   "prefs" | "legacy",  // legacy when prefs unreadable OR engagement_not_found OR bundle_missing
  prefs_status:    "...",          // pass-through from read-user-preferences for the orchestrator's Notice composition
  excluded_themes: [...],          // v0.95.1 — raw carry-forward bullet strings from yesterday's memory.md
                                   //   when render_aspects.anti_echo == "include" for this engagement;
                                   //   [] otherwise. ALWAYS present, never undefined/null. Consumed by
                                   //   compose-body's anti-echo callout injection in the
                                   //   morning-briefing / midday-tripwire / eod-review orchestrators.
  pending_confirmations: [...],    // v0.96.0 (14th key) — raw namespace strings flagged by Rail D's
                                   //   classifier as "new since last fire" (cache miss this cycle).
                                   //   [] when no new MCPs detected OR Rail-D inputs absent.
                                   //   compose-body gates the in-note detection callout on
                                   //   pending_confirmations.length > 0 AND
                                   //   render_aspects.new_mcp_notice == "include".
  learned_weights_applied: bool,   // v0.96.0 Rail L (telemetry, 15th surface field) — true when
                                   //   composeFinalPreferences re-ordered at least one cadence array
                                   //   via the weight-aware effective_priority gate (high-deviation
                                   //   bump OR day-14 backstop). false when learned_weights was
                                   //   absent, all kinds were in warmup, or every kind had deviation
                                   //   ≤ 0.20. Consumed by HC-V0960-L-15/-16 to prove the helper
                                   //   actually consulted learned_weights; orchestrators may also
                                   //   surface this in Step 14f telemetry blocks.
}
```

The orchestrator captures this as `plan`. Gather phase iterates `plan.dispatch_plan` and consults `plan.kind_titles[kind_name]` per emit; Write phase prepends `plan.voice_contract` to the compose-body invocation and passes `plan.microscopes` + `plan.allowlist` + `plan.excluded_themes` + `plan.pending_confirmations` into the body composition. The helper also exposes additional pass-through fields (`classifier_cache_hit`, `classifier_result`) for orchestrator telemetry in Step 14f.

Reference: design §5 (Rail D classifier integration) and §6.3 (14-key contract surface) in `Docs/plans/2026-06-07-v0.96.0-cowork-rethought-1-design.md`.

## Backward-compatibility

- vault-config.md without `engagements[i].overrides` → `composeFinalPreferences` returns bundle defaults verbatim; observable behavior unchanged from v0.94.x. v0.95.1's `sauce update --migrate-config` adds an empty `overrides: {}` block to every engagement and drops backward-compat reads.
- `data/kind-titles.json` absent → `loadKindTitles` falls back to module-private `CANONICAL_TITLES` const (4 entries: calendar/email/chat/finance). Fresh consumer installs pick up the 7-entry data file at v0.95.0 deploy time.
- `engagement.inner_circle_people` absent → `allowlist` returns empty arrays (no resolver invocations).

## Connectivity signal authority (v0.91.3)

This sub-skill must trust `prefs.mcps[<kind>].served_by` + `prefs.mcps[<kind>].connected` (from `read-user-preferences`) for namespace + connectivity. DO NOT trust `vault-config.mcp_map` for connectivity — that field is bootstrap-time-only, stale-prone, an audit hint not a runtime signal. Cross-reference `prefs.mcps[<kind>].served_by` with `reachable_namespaces` (passed in by the orchestrator) for the final dispatch action.

This authority chain replaces v0.94.x's per-orchestrator inline assertion of the same contract — orchestrators now delegate ALL connectivity reasoning to plan-dispatch.

### Deferred MCP tool loading

MANDATORY (v0.91.3): load deferred MCP tools UPFRONT. Before the orchestrator's priority loop fires, for each kind in `dispatch_plan` with `action == "gather_from_served_by"` or `action == "gather_canonical"`, load the required deferred tools from the kind's `served_by` namespace via Tool Search / Load. M365 (UUID like `45224a84-...`): `chat_message_search`, `outlook_calendar_search`, `outlook_email_search`. ADO (UUID like `1151913a-...`): `list_workitems`, `search_workitems`. github: `search_pull_requests`, `search_issues`. If a tool isn't loaded when its gather sub-skill needs it, the sub-skill cannot execute and you silently fall back to a warning callout — the deterministic fix for the "MCP tools require loading" failure.

## Inner-circle wiring contract (Known people in scope)

`allowlist.resolved[]` (a list of `{ name, person_link, person_basename, aliases_by_type, matched_via, collision_warning }`) is the "Known people in scope" list that orchestrators thread into every `gather-from-served-by` invocation. Downstream `cowork:gather-from-served-by` injects the allowlist into its dispatch contract so the LLM emits `**[[Name]]**` wikilinks for resolved people (per the `wikilink_people` canonical hard rule from v0.89.0+/v0.90.0).

In `dispatch_mode == "legacy"` (prefs unreadable / engagement-not-found / bundle-missing), the inner-circle pipeline does NOT fire — orchestrators emit a Notice citing "inner-circle wikilink emission will NOT occur" so the user knows resolved-person wikilinking is degraded for that run.

## Failure-mode contract

This sub-skill NEVER throws. Failure modes map to the 14-key contract:

| Condition | dispatch_mode | prefs_status | Orchestrator behavior |
|---|---|---|---|
| prefs_result.status === "ok" + readEngagement.status === "ok" | `"prefs"` | `"ok"` | Normal dispatch |
| prefs_result.status !== "ok" | `"legacy"` | (passed through) | Emit fallback Notice; legacy gather sequence |
| readEngagement.status !== "ok" | `"legacy"` | `"ok"` | Emit `engagement-not-found` Notice; legacy gather sequence |
| microscope file unreadable | `"prefs"` | `"ok"` | That kind has no microscope override; dispatch proceeds |

## Harness testing

This sub-skill exercises three pre-existing helper exports + three NEW helper exports added in v0.95.0 (`composeFinalPreferences`, `readEngagement`, `loadKindTitles`). Test cases live in `platform/test/run-helper-cases.js`:

- `HC-V0950-OVERRIDES-A1..A4` — `composeFinalPreferences` composition contract (no overrides → bundle defaults; empty overrides; per-key override win; malformed overrides fall back).
- `HC-V0950-PLAN-DISPATCH-A1..A6` — helper chain end-to-end (5-key shell; render_aspects/cadence_order/voice/tripwire_aspects override behavior; w2-fte bundle defaults; tripwire_aspects REPLACES not merges).
- `HC-V0950-PLAN-DISPATCH-B1..B3` — `loadKindTitles` data-file vs fallback behavior.
- `HC-V0950-PLAN-DISPATCH-C1..C2` — defensive contract (`decideDispatchMode` legacy fallback; `composeFinalPreferences` null inputs yield 5-key shell, no throw).
- `HC-V0960-L-14..L-17` — v0.96.0 Rail-L weight-aware `composeFinalPreferences` (high-deviation reorder; warmup keeps base order; deviation ≤ 0.20 keeps base order with `learned_weights_applied` field reported; day-14 must-surface backstop bumps lowest-weight kind forward).

Cohesion regression across the 5 orchestrators is caught by `HC-V0950-COHESION-A1..A5` in the same harness (each orchestrator invokes `plan-dispatch` at pre-flight step 3b; canonical section order; no inline dispatch-plan pseudocode; orchestrator template doc exists).

This skill conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0) — the canonical orchestrator template authored alongside v0.95.0.
