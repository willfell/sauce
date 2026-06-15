---
name: cowork:compose-body
description: Compose a canonical atomic-note body from gather/memory/closing inputs. Pure shape composer; deterministic; byte-identical golden fixtures per cadence. Hard-rejects on input validation errors.
inputs:
  cadence: string
  nav_buttons_block: string
  synopsis_md: string
  memory_callouts: object
  ordered_blocks: array
  engagement_type_blocks: array
  closing_md: string
outputs:
  body_md: string
  sidecar_json: object
  status: string
tags: [cowork, compose, atomic-note, pure-helper, body-shape]
---

# cowork:compose-body

Shape composer for cowork atomic-note bodies. Pure delegation to `compose-body-helper.js` — no I/O, no MCP, no LLM judgment. Returns canonical body markdown + a v1.0.0 sidecar payload object the downstream write-atomic-note-helper validates against the cadence's JSON schema (draft-07).

Use this sub-skill to convert structured gather/memory/closing inputs into the canonical body markdown that gets written by `cowork:write-run-note-<cadence>`. The orchestrator owns content (voice-shaped synopsis + closing prose, gather-pipeline output assembly); this skill owns SHAPE (callout wrapping, inter-section ordering, null-omit semantics, sidecar payload emission).

## Inputs

- `cadence` (string, required): one of `"morning-briefing"`, `"midday-tripwire"`, `"eod-review"`, `"weekly-review"`, `"monthly-review"`. Validated against whitelist; unknown → `failed:input:unknown-cadence:<value>`.
- `nav_buttons_block` (string, required): the canonical SpaceNavButtons dataviewjs block INCLUDING triple-backtick fences. Pre-rendered by orchestrator; spliced verbatim.
- `synopsis_md` (string, required): pre-rendered `> [!info]- <title>` callout from orchestrator. The orchestrator wraps the prose; composeBody just splices.
- `memory_callouts` (object, required): 4 optional pre-rendered callout strings:
  - `yesterday_md` — from `composeMemoryCallouts(...).yesterdayCalloutMd` (v0.85.0).
  - `overnight_md` — from `composeMemoryCallouts(...).overnightCalloutMd` (v0.85.0).
  - `echoes_md` — from `composeSemanticEchoesCallout(...)` (v0.87.0).
  - `backlink_md` — inline-composed `> [!quote]- Memory log` per v0.85.0 § 2.1.3.

  Empty/null fields are omitted cleanly (no orphan blank lines). yesterday/overnight/echoes render BETWEEN synopsis and ordered_blocks (the "top memory cluster"); backlink renders at the very END of body (after closing).

- `ordered_blocks` (array, required, may be empty): each entry `{ kind, callout_type, title, body_md }`. composeBody wraps each in `> [!<callout_type>]+ <title>` with body lines `> ` prefixed. `callout_type` MUST be one of `info|tip|quote|note|example|warning` (per v0.82.0 mapping; sourced by orchestrator from `prefs.mcps[kind].callout_type`).
- `engagement_type_blocks` (array, required, may be empty): same per-entry shape as ordered_blocks. Used for semantic_related / finance / future engagement-type-aspect blocks. Rendered AFTER all ordered_blocks.
- `closing_md` (string, required): pre-rendered `> [!tip] <title>` callout from orchestrator.

**Asymmetry note.** synopsis_md + closing_md arrive PRE-WRAPPED (orchestrator owns those callout shapes — they're one-offs whose prose comes from prompt body + voice contract); ordered_blocks + engagement_type_blocks arrive as raw `{kind, callout_type, title, body_md}` quadruples that composeBody wraps. Rationale: ordered_blocks are N-ary and prefs-driven, so composeBody enforces shape correctness across all N entries.

## Pre-flight

Resolve helper path: `spice/cowork/helpers/compose-body-helper.js`. Consumer-side this materializes via the installer to either the pantry-clone path (`pantry/platform/blueprints/cowork/helpers/compose-body-helper.js`) or the canonical materialized path. This sub-skill carries NO side effects; safe to invoke in any context.

## Compose

1. **Validate input shape.** The helper's `_validateInput` enforces required-field presence + cadence whitelist + callout_type whitelist. Returns `failed:input:<reason>` on miss; `body_md = ""` and `sidecar_json = null` in that case.
2. **Invoke `composeBody(input)`** from the helper.
3. **Return the helper's output unchanged** to the caller.

**Hard rule:** This sub-skill MUST NOT compose body content directly. ALL shape work is delegated to the pure helper. If the helper isn't reachable (workshop path resolution failure), return `failed:helper-unreachable` — DO NOT fall back to inline composition. This is the v0.91.x "trust deterministic backstops over LLM prose" pattern enforced at the composer layer.

## Returns

```json
{
  "body_md": "<assembled markdown body, ends with newline>",
  "sidecar_json": {
    "schema_version": "1.0.0",
    "generated_by": "cowork:<cadence>@<version>",
    "generated_at": "<ISO timestamp>",
    "cadence": "<morning-briefing | midday-tripwire | eod-review | weekly-review | monthly-review>",
    "engagement_id": "<engagement_id>",
    "frontmatter": { /* mirror of .md frontmatter */ },
    "surfaced_kinds": ["<kind1>", "<kind2>"],
    "surfaced_items": [ /* aggregated from ordered_blocks[].items + engagement_type_blocks[].items */ ],
    "render_aspects_applied": [ /* "<key>:<value>" pairs */ ],
    "memory_used": { "yesterday_present": false, "drift_warning_present": false, "echoes_count": 0 },
    "plan_dispatch": { "mode": "prefs", "kinds_dispatched": 0, "warnings_emitted": 0 }
  },
  "status": "ok"
}
```

Status alphabet: `"ok"` or any `failed:<reason>` from `## Failure modes`.

- `body_md` is the empty string `""` when status is any `failed:*` value.
- `sidecar_json` is `null` when status is any `failed:*` value.

Validated against `<vault>/.claude/skills/cowork/data/schemas/<cadence>@1.0.0.json` by `write-atomic-note-helper` BEFORE write commits. See design §3.3 for full schema reference. The retired `body_assertions[]` field is subsumed by JSON-schema validation.

## Failure modes

- `failed:input:missing-cadence` — `cadence` field absent or empty.
- `failed:input:unknown-cadence:<value>` — cadence not in the 5 known cadences.
- `failed:input:missing-nav-buttons-block` — nav_buttons_block absent or empty.
- `failed:input:missing-synopsis` — synopsis_md absent or empty.
- `failed:input:missing-closing` — closing_md absent or empty.
- `failed:input:malformed-ordered-block:<index>:<field>` — ordered_blocks[index] missing/wrong-shape field (field = `kind` | `callout_type` | `title` | `body_md`).
- `failed:input:malformed-engagement-type-block:<index>:<field>` — engagement_type_blocks[index] same.
- `failed:input:unknown-callout-type:<value>:<index>` — callout_type not in the 6 canonical types.
- `failed:helper-unreachable` — workshop path resolution failed; helper module not found.

On any failure, the caller (orchestrator) emits a Notice + exits non-zero. NO partial body is written downstream.

## Harness testing

9 golden fixtures at `platform/blueprints/cowork/helpers/fixtures/compose-body/case-*/`:

- 5 per-cadence fixtures (`case-{morning-briefing,midday-tripwire,eod-review,weekly-review,monthly-review}/`) — each with `input.json` + `expected-body.md` + `expected-assertions.json`. `case-morning-briefing` derived byte-identically from accuris production morning-briefing run on 2026-06-05.
- 4 edge-case fixtures: `case-edge-empty-memory/`, `case-edge-empty-ordered-blocks/`, `case-edge-multiline-body-with-blanks/`, `case-edge-unknown-callout-type/`.

HC sub-asserts at `HC-V0920-COMPOSE-*` in `platform/test/run-helper-cases.js`. Production agents in consumer vaults execute the helper directly via `require()` — they do NOT depend on this SKILL.md prose for control flow.

## Notes

- Pure function: same inputs → byte-identical output. No I/O, no clock, no randomness.
- Replaces the v0.78.0 stub helper (`composeBody({dispatch_mode, prefs, ordered_blocks{markdown}, synopsis, tip})`) which is retired in v0.92.0. v0.78.0's HC-V0780-E1 smoke test is retired; HC-V0920-COMPOSE-* provides equivalent + more thorough coverage.
