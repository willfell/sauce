---
name: cowork:plan-dispatch
description: Single pre-flight entry point for the 5 atomic-note orchestrators. Loads engagement record + engagement-type bundle + engagement.overrides, composes the layered preferences tree, reads microscopes/siblings, plans dispatch via dispatch-plan-helper, composes voice contract, resolves the inner-circle allowlist, and returns the 10-key contract that drives Gather + Write phases. Never throws — degrades to `dispatch_mode: "legacy"` on prefs failure so the orchestrator can fall back cleanly.
inputs:
  engagement_id: string
  cadence: string
  reachable_namespaces: string[]
  vault_root: string
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
tags: [cowork, sub-skill, pre-flight, dispatch, knob-composition]
---

# cowork:plan-dispatch

Single pre-flight entry point for every atomic-note orchestrator (morning-briefing / midday-tripwire / eod-review / weekly-review / monthly-review). Replaces the ~100 lines of inline `3a memory → 3b read-prefs → 3c dispatch-plan → 3d microscopes → 3e inner-circle` pseudocode that v0.94.x carried byte-identical across all 5 orchestrators.

The 12-key result tree returned by this sub-skill is the orchestrator's sole source of truth for Gather + Write. Knob composition (engagement-type defaults ⨁ engagement.overrides ⨁ ad-hoc runtime overrides) happens HERE, once, not scattered through gather/write skills.

## Inputs

```
{
  engagement_id:        string,    // REQUIRED — matches an entry in vault-config.md engagements[]
  cadence:              string,    // REQUIRED — one of "morning" | "midday" | "eod" | "weekly" | "monthly"
  reachable_namespaces: string[],  // REQUIRED — runtime MCP namespace set (e.g. ["iMCP", "brex", "github"])
  vault_root:           string,    // OPTIONAL — vault filesystem root; defaults to cwd-based resolution
}
```

## Steps

1. **Vault routing.** READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow its `## Steps` section with `{ required: ["obsidian"] }`. If the vault-routing check fails, propagate that failure verbatim — `plan-dispatch` cannot proceed without routing.

2. **Read user-preferences.** READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow its `## Steps` section with `{}`. Capture the result as `prefs_result = { prefs, status, reason }`.

3. **Decide dispatch mode.** Invoke `dispatchPlanHelper.decideDispatchMode({ prefsStatus: prefs_result.status })` → `dispatch_mode` (`"prefs"` when status === "ok", else `"legacy"`). If `dispatch_mode === "legacy"`, the orchestrator MUST fall through to its legacy gather sequence; this sub-skill still returns the full 10-key contract so the orchestrator can compose its fallback Notice from `prefs_status`.

4. **Read engagement + bundle.** Invoke `dispatchPlanHelper.readEngagement({ engagement_id, vault_root })` → `{ engagement, bundle, overrides, status, reason }`. If `status !== "ok"`, set `dispatch_mode = "legacy"` and capture `reason` for the fallback Notice; downstream steps still execute against the available data.

5. **Compose final preferences.** Invoke `dispatchPlanHelper.composeFinalPreferences({ bundle, overrides, ad_hoc_prefs: null })` → `{ render_aspects, cadence_order, voice, microscopes_registry, tripwire_aspects }`. This is the FINAL knob layer — Gather + Write read from here, not from the engagement-type JSON directly. Composition order: `bundle` (defaults) ⨁ `overrides` (per-key wins on objects, REPLACES on arrays) ⨁ `ad_hoc_prefs` (reserved; null today). `final.tripwire_aspects` propagates to the 12-key return for midday-tripwire's early-exit + per-aspect dispatch.

6. **Load kind titles.** Invoke `dispatchPlanHelper.loadKindTitles({ vault_root })` → `kind_titles` map (kind → display title). The data file at `spice/cowork/data/kind-titles.json` v1.0.0 is canonical; per-kind microscope `## Output shape` directives (`<! title: My Custom Title !>`) override the data-file value for THAT engagement's gather.

7. **Read per-kind microscopes.** When `final.microscopes_registry` is a non-null object, iterate its `kind_name → microscope_path` entries and READ each file. When the registry is null, fall back to filesystem scan: for each kind in `prefs.priorities`, attempt `spice/cowork/prompts/per-mcp/<kind>/microscope.md` — if absent, that kind has no microscope. Collect into `microscopes = { kind_name: body_string }`.

8. **Read per-kind siblings.** For each kind in `prefs.priorities`, attempt to READ `spice/cowork/prompts/per-mcp/<kind>/siblings/` (a directory of supporting markdown files). Collect into `siblings = { kind_name: [{ name, body }, ...] }`. Missing directories yield empty arrays — not an error.

9. **Plan dispatch.** Invoke `dispatchPlanHelper.planDispatch({ prefs: prefs_result.prefs, reachableNamespaces: reachable_namespaces, mcpSkillMap, microscopes })` → `dispatch_plan[]` (ordered kind entries with per-entry action + served_by + warning reasons). `mcpSkillMap` is read from `spice/cowork/data/mcp-skill-map.json` v2.0.0.

10. **Reorder for cadence.** If `final.cadence_order[cadence]` is a non-empty array, reorder `dispatch_plan[]` to match that priority. Entries listed in `cadence_order[cadence]` come first in declared order; entries NOT listed retain their original relative order at the tail. This is how per-cadence knob composition surfaces — orchestrators DO NOT consult `cadence_order` directly.

11. **Compose voice contract.** Invoke `dispatchPlanHelper.composeVoiceContract(final.voice, prefs_result.prefs.effective_hard_rules)` → `voice_contract` (string). The Write phase prepends this verbatim to its compose-body invocation. Also capture `prefs_result.prefs.effective_hard_rules` as the 11th key on the return — `gather-from-served-by` consumes the rules array independently of the voice_contract formatted string.

12. **Resolve inner-circle allowlist.** When `engagement.inner_circle_people` is a non-empty array AND `final.render_aspects.inner_circle_imessage !== "skip"`, READ `.claude/skills/cowork/skills/resolve-person/SKILL.md` in full and follow its `## Steps` section per name. Then invoke `composeInnerCircleAllowlist(resolverOutputs)` from `helpers/resolve-inner-circle-helper.js` → `allowlist = { resolved, unresolved, phone_filter_list }`. When the gate is closed (no inner_circle_people or `inner_circle_imessage: skip`), return `allowlist = { resolved: [], unresolved: [], phone_filter_list: [] }`.

13. **Return the 12-key contract.** Per the `## Returns` section below. Every key MUST be present even when null/empty — defensive contract. Atomic-note orchestrators consume the result tree as their single source of truth for Gather + Write.

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
}
```

The orchestrator captures this as `plan`. Gather phase iterates `plan.dispatch_plan` and consults `plan.kind_titles[kind_name]` per emit; Write phase prepends `plan.voice_contract` to the compose-body invocation and passes `plan.microscopes` + `plan.allowlist` into the body composition.

## Backward-compatibility

- vault-config.md without `engagements[i].overrides` → `composeFinalPreferences` returns bundle defaults verbatim; observable behavior unchanged from v0.94.x. v0.95.1's `sauce update --migrate-config` adds an empty `overrides: {}` block to every engagement and drops backward-compat reads.
- `data/kind-titles.json` absent → `loadKindTitles` falls back to module-private `CANONICAL_TITLES` const (4 entries: calendar/email/chat/finance). Fresh consumer installs pick up the 7-entry data file at v0.95.0 deploy time.
- `engagement.inner_circle_people` absent → `allowlist` returns empty arrays (no resolver invocations).

## Failure-mode contract

This sub-skill NEVER throws. Failure modes map to the 10-key contract:

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

Cohesion regression across the 5 orchestrators is caught by `HC-V0950-COHESION-A1..A5` in the same harness (each orchestrator invokes `plan-dispatch` at pre-flight step 3b; canonical section order; no inline dispatch-plan pseudocode; orchestrator template doc exists).

This skill conforms to `Docs/agent-guides/cowork-orchestrator-template.md` (v1.0.0) — the canonical orchestrator template authored alongside v0.95.0.
