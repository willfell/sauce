---
name: cowork:read-user-preferences
description: Read spice/cowork/context/user-preferences.md, parse YAML frontmatter, apply v1→v2 migration, return { prefs, status, reason }. Pure read — no side effects. Status one of `ok` | `empty` | `malformed`. Atomic-note orchestrators call this in pre-flight to drive priority-ordered dispatch.
inputs: {}
outputs:
  prefs: object | null
  status: string
  reason: string
tags: [cowork, sub-skill, pre-flight, prefs-consumer]
---

# cowork:read-user-preferences

Pre-flight sub-skill for the 5 atomic-note orchestrators. Parses the user-owned `spice/cowork/context/user-preferences.md` and returns a structured prefs object plus a status code. Never throws; failures degrade to a status code so the caller can fall back to legacy gather.

## Inputs

None. Vault-relative file path is fixed: `spice/cowork/context/user-preferences.md`.

## Outputs

```
{
  prefs: {
    priorities: [<kind_name>, ...],
    personality: { vibe, formality, pep_talk, length, notes, no_emojis, hard_rules },
    mcps: {
      <kind_name>: {
        served_by, what_matters, connected, captured_at,
        custom_kind, override_classified, callout_type,
        ...kind-specific answer fields preserved verbatim
      }
    },
    effective_hard_rules: [<string>, ...]
  } | null,
  status: "ok" | "empty" | "malformed",
  reason: <string when status != "ok">
}
```

When `status != "ok"`, `prefs` is `null` and the caller MUST treat as the legacy-fallback condition.

`effective_hard_rules` = `personality.hard_rules` plus a canonical no-emoji rule when `personality.no_emojis: true`; consumers MUST apply these verbatim to narrative, gather dispatch, and skeleton.

### Callout type per kind (v0.82.0)

Each kind block in `mcps.<kind>` may include an optional `callout_type: <type>` field that determines the Obsidian callout type used when the orchestrator renders that kind's section in atomic notes. Valid values: `info`, `note`, `tip`, `success`, `warning`, `caution`, `example`, `quote`, `danger`.

When absent or invalid, the helper falls back to a default per-kind mapping for visual differentiation:

| Kind | Default callout type | Why |
|---|---|---|
| `chat` | `info` | Blue — conversational signals |
| `finance` | `warning` | Amber — money matters |
| `calendar` | `tip` | Green — anchors / conflicts |
| `email` | `quote` | Gray — quiet / filtered |
| `ado` | `example` | Purple — board state |
| `github` | `note` | Sky blue — code state |

Unknown kinds default to `example` (preserves pre-v0.82.0 behavior). The resolved `callout_type` is exposed at `prefs.mcps[<kind_name>].callout_type` for orchestrator passthrough into `cowork:gather-from-served-by`.

## Hard rules

The `effective_hard_rules` output is a string array assembled from `personality.hard_rules` plus any platform-default rules the helper appends. Consumers MUST apply these verbatim to narrative composition, gather-from-served-by dispatch, and skeleton binding (voice-contract block, dispatch-contract `## Hard rules` section, write-run-note skeleton binding paragraph).

The canonical no-emoji rule is appended when `personality.no_emojis: true`. Its body is the fixed string: *"Do not use any emoji or pictographic characters anywhere in the output — not in section/callout titles, not in inline prose, not in table cells."*

### Canonical platform-default rule: `wikilink_people` (v0.89.0+, promoted v0.90.0)

The helper auto-prepends one platform-default rule to every engagement's `effective_hard_rules[]` regardless of user opt-in. **As of v0.90.0**, this rule occupies index 0 of the array (BEFORE user-authored `personality.hard_rules`) so it appears as the FIRST bullet in the dispatch contract's `## Hard rules` block — gaining first-bullet priority over later rules:

> **`wikilink_people`** — PRECEDENCE OVERRIDE: This rule takes precedence over microscope `## Output shape` per-item-line format specs. When body composition mentions a person, always emit `**[[Person Basename]]**` if the person resolves (via `cowork:resolve-person` or via the dispatch contract's "Known people in scope" allowlist or via prior wikilink in the same atomic note); never use bare `**Name**` or plaintext for a resolved person. Even when a microscope's `## Output shape` instructs a specific per-item format (e.g., 'sender resolved to canonical display name'), the canonical name MUST be wrapped in `[[Basename]]` wikilink syntax. Unresolved people may emit `**Name**` or plain text. Preserve existing `[[Person Name]]` wikilinks verbatim when summarizing or distilling. This rule binds atomic-note bodies, synthesis bodies (synthesize-day / synthesize-week output), callout titles, table cells, narrative prose, and dispatch-contract output. Exempt: literal display strings inside calendar event titles, email subjects, message previews.

**Composition order at v0.90.0:** `effective_hard_rules[0]` = the canonical `wikilink_people` rule above (verbatim); `effective_hard_rules[1..N]` = user-authored `personality.hard_rules[]` entries in declared order; `effective_hard_rules[N+1]` = the canonical no-emoji rule when `personality.no_emojis: true`. This ordering propagates via the existing `effective_hard_rules[]` plumbing (v0.79.0) — voice-contract block, gather-from-served-by dispatch `## Hard rules` section, and write-run-note skeleton binding paragraph all receive it without per-rule special-casing. The wikilink rule's first-bullet position is structurally load-bearing: it grants the rule precedence over both user hard_rules and microscope `## Output shape` directives.

Users CAN override by adding `personality.hard_rules: [{id: "wikilink_people", disabled: true}]` to `spice/cowork/context/user-preferences.md` — `composeEffectiveHardRules` honors this disable flag and skips injection. The disable-path was promoted from "forward-looking breadcrumb" to live during v0.89.0 S3 implementation; HC-V0790-A3 in `run-cowork-smoke.js` asserts the disable behavior end-to-end (now expects the v0.90.0 order).

## Steps

1. **Read the user-preferences.md file.** Use the Read tool at `spice/cowork/context/user-preferences.md` (or `mcp__obsidian__get_file_contents` with that vault-relative path). If the file does not exist, return `{ prefs: null, status: "empty", reason: "file_not_found" }`.

2. **Extract the leading frontmatter block.** Match the YAML between leading `---` and the next `---` markers. If no frontmatter block is present, return `{ prefs: null, status: "malformed", reason: "no_frontmatter_block" }`.

3. **Parse the YAML frontmatter.** Treat as YAML 1.1 with the indentation conventions context-builder writes. On parse error, return `{ prefs: null, status: "malformed", reason: "yaml_parse_error: <error message>" }`.

4. **Assert the type tag.** If `type` is missing or not equal to `cowork-user-preferences`, return `{ prefs: null, status: "malformed", reason: "type_tag_missing_or_wrong" }`.

5. **Apply v1→v2 migration (idempotent).** If `mcps.gmail` is present, rename it to `mcps.email`. If `mcps.imessage` is present, rename it to `mcps.chat`. If both source and destination already exist, prefer the destination (don't overwrite). This step is a no-op for v2-shaped prefs (already-migrated).

6. **Apply seed-shape rule.** If after migration `priorities` is `[]` AND `mcps` is `{}`, return `{ prefs: null, status: "empty", reason: "unpopulated_seed" }`. This is the workshop-seed shape that install.js writes — it means context-builder has not been run yet.

7. **Coerce optional defaults.**
   - `personality.{vibe, formality, pep_talk, length, notes}` default to `null` when absent.
   - `personality.no_emojis` defaults to `false` (coerce any non-`true` value to `false`); `personality.hard_rules` defaults to `[]` (coerce any non-array to `[]`).
   - Compose `effective_hard_rules` per the v0.90.0 composition order: index 0 is the canonical `wikilink_people` rule (PRECEDENCE OVERRIDE-prefixed, see the `## Canonical platform-default rule: wikilink_people` section above for the verbatim body); indices 1..N are user-authored `personality.hard_rules[]` (string entries, trimmed) in declared order; the canonical no-emoji rule appends at the end when `personality.no_emojis` is `true`. The canonical no-emoji rule body is the fixed string: *"Do not use any emoji or pictographic characters anywhere in the output — not in section/callout titles, not in inline prose, not in table cells."* When `personality.hard_rules: [{id: "wikilink_people", disabled: true}]` is present, the wikilink rule is OMITTED (disable-path); user rules + no-emoji rule (if set) are still composed.
   - For each `mcps[<kind>]`: `connected` defaults to `false`, `custom_kind` defaults to `false`, `override_classified` defaults to `false`. `callout_type` is resolved per the per-kind table above (explicit override coerced to lowercase + validated against the 9 built-in types; default mapping when absent; `example` when both the kind is unknown and no explicit override is given). Preserve every other field on the mcps entry verbatim (kind-specific answer fields like `vip_senders`, `surface_event_kinds`, `inner_circle`, `inner_circle_channels`, `what_matters` etc.).

8. **Return `{ prefs, status: "ok" }`.** Canonical shape per the Outputs section above.

This skill is a PURE read — never modify the file, never write to disk, never call any MCP that mutates state. The orchestrator's dispatch planning depends on the canonical output shape.

## Harness testing

A helper at `platform/blueprints/cowork/helpers/read-user-preferences-helper.js` lives in the workshop dev repo (NOT materialized into consumer vaults) and exports `readUserPreferences({ vaultRoot })` for the HC-V0780-A* harness cases. Production agents in consumer vaults execute the algorithm above directly — they do NOT depend on the helper file existing.

## Returns

`{ prefs, status, reason }` as defined in Outputs.

## Test fixtures

HC-V0780-A1 (populated), HC-V0780-A2 (missing file), HC-V0780-A3 (seed shape), HC-V0780-A4 (malformed) in `platform/test/run-cowork-smoke.js`.
