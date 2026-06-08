---
purpose: Canonical orchestrator template — the structural contract every cowork atomic-note orchestrator must conform to. Authored alongside v0.95.0's cohesion sweep. Validated by HC-V0950-COHESION-A1..A5.
load_when: Authoring a new cowork orchestrator OR refactoring an existing one. Read end-to-end before any structural edit.
status: v1.0.0 — adopted 2026-06-07 by v0.95.0
informs: HC-V0950-COHESION-A1..A5 + future cowork:audit-cohesion candidate (v1.0.0+)
---

# Cowork orchestrator template (v1.0.0)

This is the single canonical shape every cowork atomic-note orchestrator (morning-briefing / midday-tripwire / eod-review / weekly-review / monthly-review) must conform to. Drift across orchestrators was the cohesion gap v0.95.0 closed; this template makes the contract explicit so future orchestrators land aligned from day one.

## Required H1 + critical-path callout

```markdown
# cowork:<orchestrator-name>

> [!warning]+ CRITICAL: output path (v0.90.2)
> This orchestrator writes ONE atomic note to:
>
> `spice/cowork/<cadence-dir>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/<orchestrator-name>.md`
>
> DO NOT write to legacy paths. ALWAYS delegate the write to
> `cowork:write-run-note-<orchestrator-name>` — never call `Write` / `Edit` /
> `mcp__obsidian__obsidian_put_content` directly from this orchestrator body.
```

## Required sections (in order)

| Order | Section | Notes |
|---|---|---|
| 1 | `## Inputs` | One required field: `engagement_id: string`. Keep tight. |
| 2 | `## Pre-flight` | Numbered steps 1, 1b, 2, 3, 3a, [3a.5], 3b, 4 (see below) |
| 3 | `## Gather` | Priority loop over `plan.dispatch_plan` + legacy gather fallback |
| 4 | `## Decide` | OPTIONAL — midday-tripwire only (severity computation) |
| 5 | `## Write` | Compose-body invocation + write-run-note delegation |
| 6 | `## Verify` | Re-read + structural assertion (path/frontmatter/body-shape) |
| 7 | `## State` | OPTIONAL — midday-tripwire omits |
| 8 | `## Done` | Final Notice emit |
| 9 | `## Harness testing` | Reference this template + cohesion HC group |

Section ordering is structurally load-bearing — HC-V0950-COHESION-A2 asserts presence + order.

## Required Pre-flight steps

```
1.    READ check-vault-routing
1b.   Verbal commitment Notice (v0.91.1 + v0.91.2)
2.    Resolve engagement record from vault-config.md
3.    READ date-context
3a.   Read recent memory (cadence-specific tier/window)
[3a.5] Gather semantic echoes (OPTIONAL — gated by render_aspects.semantic_related)
3b.   Plan dispatch — single READ of cowork:plan-dispatch
4.    READ ensure-daily-note
```

### Step 3b — the canonical plan-dispatch invocation

This is the load-bearing cohesion contract. The orchestrator MUST:

1. Capture `reachable_namespaces` from the agent's tool list (walk every `mcp__<ns>__<tool>` name; add `<ns>` to the set).
2. READ `.claude/skills/cowork/skills/plan-dispatch/SKILL.md` in full and follow its `## Steps` section with `{ engagement_id, cadence: "<this-cadence>", reachable_namespaces, vault_root: <vault-root-from-routing> }`. Capture the 12-key result as `plan`.
3. If `plan.dispatch_mode == "legacy"`, emit Obsidian Notice citing `<plan.prefs_status>` and fall through to legacy gather; otherwise consume `plan.dispatch_plan`, `plan.voice_contract`, `plan.microscopes`, `plan.siblings`, `plan.allowlist`, `plan.render_aspects`, `plan.cadence_order`, `plan.tripwire_aspects`, `plan.kind_titles`, and `plan.effective_hard_rules`.

**HARD RULE:** NO inline dispatch-plan composition lives in any orchestrator. HC-V0950-COHESION-A3 enforces this by regex-scanning for the legacy "Determine action" pseudocode block — its presence in any orchestrator body is a contract violation.

## Required body-shape markers (per-cadence output)

Every orchestrator's atomic-note output must contain:

- **SpaceNavButtons block** at the top — canonical pattern (v0.91.3): `dataviewjs` block calling `await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" })`. The pre-v0.91.3 hallucination `const { SpaceNavButtons } = customJS` is REJECTED by the write-run-note write-guard.
- **`> [!info]- ` synopsis callout** (voice-shaped one-paragraph summary at the top).
- **`> [!example]+ ` per-section callouts** (one per `dispatch_plan` entry; warning-callouts in-position for `action: "warn"` entries).
- **`> [!tip] ` closing callout** (focus / recalibration / decompression — cadence-dependent).

These markers are validated by the v0.92.0 body-shape write-guard inside `cowork:write-run-note-<orchestrator>`. Missing any of the four → write-run-note returns `failed:contract-violation:<marker-name>` and the orchestrator emits an aborted-with-cause Notice.

## Required failure-token vocabulary

When the orchestrator catches a sub-skill failure, it must pattern-match on these canonical tokens:

| Token | Source | Recovery |
|---|---|---|
| `failed:engagement:not-found` | step 2 | Exit silently — engagement record absent |
| `failed:filesystem:<reason>` | any filesystem helper | Emit Notice; do NOT proceed to State |
| `failed:contract-violation:<field>` | write-run-note pre-write self-check | Emit Notice with field; abort |
| `failed:write-undersized:<bytes>` | write-run-note byte-count guard | Emit Notice; abort |
| `failed:compose-body:<status>` | compose-body sub-skill | Emit Notice; do NOT call write-run-note |
| `failed:verify:<missing-field-or-marker>` | post-write structural verify | Delete the written file + emit Notice |

## What lives inside `cowork:plan-dispatch` (not in the orchestrator)

The v0.95.0 cohesion sweep moved the following load-bearing surfaces from each orchestrator into the single owner sub-skill:

- Reading `spice/cowork/context/user-preferences.md` (read-user-preferences invocation)
- Reading `spice/cowork/context/vault-config.md` engagement record (readEngagement)
- Reading `spice/cowork/context/engagement-types/<type>.json` (engagement-type bundle)
- Composing FINAL preferences (composeFinalPreferences — bundle ⨁ overrides ⨁ ad_hoc)
- Reading `spice/cowork/data/kind-titles.json` (loadKindTitles, with fallback)
- Reading per-kind microscopes (`spice/cowork/prompts/per-mcp/<kind>/microscope.md`)
- Reading per-kind siblings (`spice/cowork/prompts/per-mcp/<kind>/`)
- Reading `spice/cowork/context/mcp-skill-map.json`
- Connectivity signal authority (v0.91.3): trust `prefs.mcps[<kind>].served_by` + `prefs.mcps[<kind>].connected`; DO NOT trust `vault-config.mcp_map`
- Deferred MCP tool loading (M365 / ADO / github tool catalogue)
- Inner-circle resolution (cowork:resolve-person per name + composeInnerCircleAllowlist)
- voice_contract composition (composeVoiceContract from personality + effective_hard_rules)

Orchestrators consume the 12-key result tree. Orchestrators DO NOT re-read or re-compose any of the above.

## Backward-compat posture

The 12-key contract is additive over v0.94.x's per-orchestrator reads. Existing consumer vaults without `engagement.overrides` blocks experience zero behavior change — `composeFinalPreferences` falls through to bundle defaults verbatim. v0.95.1's `sauce update --migrate-config` adds an empty `overrides: {}` block to every engagement; v0.95.1 drops backward-compat reads.

## Future-proof slots

- **Per-cadence first-class voice** — not in this template (rejected in 2026-06-07 cowork-vision Q4 brainstorm). Achievable through `engagement.overrides.voice` at runtime.
- **cowork:doctor observability skill** — v0.96.0+ candidate. Will read this template + assert aggregate KPIs against each orchestrator's output.
- **cowork:audit-cohesion enforcement skill** — v1.0.0+ candidate. Will treat this template as the authoritative source and emit per-deviation diagnostics.

## Cross-references

- `Docs/cowork-vision.md` — long-term direction + locked decisions
- `Docs/plans/2026-06-07-v0.95.0-cowork-spine-design.md` — the cycle that authored this template
- `platform/blueprints/cowork/skills/skills/plan-dispatch/SKILL.md` — the load-bearing sub-skill
- HC-V0950-COHESION-A1..A5 in `platform/test/run-helper-cases.js` — automated conformance checks (added v0.96.0+ when cohesion automation lands)
