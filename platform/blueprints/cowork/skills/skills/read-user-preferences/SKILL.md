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
        custom_kind, override_classified,
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
   - Compose `effective_hard_rules` = `personality.hard_rules` (string entries, trimmed) plus the canonical no-emoji rule appended when `personality.no_emojis` is `true`. The canonical no-emoji rule is the fixed string: *"Do not use any emoji or pictographic characters anywhere in the output — not in section/callout titles, not in inline prose, not in table cells."* When neither is set, `effective_hard_rules` is `[]`.
   - For each `mcps[<kind>]`: `connected` defaults to `false`, `custom_kind` defaults to `false`, `override_classified` defaults to `false`. Preserve every other field on the mcps entry verbatim (kind-specific answer fields like `vip_senders`, `surface_event_kinds`, `inner_circle`, `inner_circle_channels`, `what_matters` etc.).

8. **Return `{ prefs, status: "ok" }`.** Canonical shape per the Outputs section above.

This skill is a PURE read — never modify the file, never write to disk, never call any MCP that mutates state. The orchestrator's dispatch planning depends on the canonical output shape.

## Harness testing

A helper at `platform/blueprints/cowork/helpers/read-user-preferences-helper.js` lives in the workshop dev repo (NOT materialized into consumer vaults) and exports `readUserPreferences({ vaultRoot })` for the HC-V0780-A* harness cases. Production agents in consumer vaults execute the algorithm above directly — they do NOT depend on the helper file existing.

## Returns

`{ prefs, status, reason }` as defined in Outputs.

## Test fixtures

HC-V0780-A1 (populated), HC-V0780-A2 (missing file), HC-V0780-A3 (seed shape), HC-V0780-A4 (malformed) in `platform/test/run-cowork-smoke.js`.
