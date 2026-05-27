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
    personality: { vibe, formality, pep_talk, length, notes },
    mcps: {
      <kind_name>: {
        served_by, what_matters, connected, captured_at,
        custom_kind, override_classified,
        ...kind-specific answer fields preserved verbatim
      }
    }
  } | null,
  status: "ok" | "empty" | "malformed",
  reason: <string when status != "ok">
}
```

When `status != "ok"`, `prefs` is `null` and the caller MUST treat as the legacy-fallback condition.

## Steps

1. Resolve vault root from the caller's working directory (the bash sandbox boundary IS the vault root for scheduled-jobs invocations).
2. Delegate to the helper at `.local/blueprints/cowork/helpers/read-user-preferences-helper.js` (or the materialized path), calling `readUserPreferences({ vaultRoot })`.
3. Return the helper's output verbatim. Do NOT post-process — the caller's dispatch planning (orchestrator step 3c) depends on the canonical shape.

The helper:

1. Reads `<vaultRoot>/spice/cowork/context/user-preferences.md` via `fs.readFileSync`. If missing → `{ status: "empty", reason: "file_not_found" }`.
2. Strips leading `---` … `---`; parses via the shared `parseYamlIsh` helper. On parse error → `{ status: "malformed", reason: "yaml_parse_error: <msg>" }`.
3. Asserts `type: cowork-user-preferences`. If missing → `{ status: "malformed", reason: "type_tag_missing_or_wrong" }`.
4. Loads `mcp-skill-map.json` (best-effort from vault path then helper-sibling fallback) and applies `migrateV1ToV2` (renames `mcps.gmail` → `mcps.email`, `mcps.imessage` → `mcps.chat`). Idempotent — calling with already-migrated prefs is a no-op.
5. If `priorities == []` AND `mcps == {}` → `{ status: "empty", reason: "unpopulated_seed" }`.
6. Coerces optional defaults: `personality.{vibe,formality,pep_talk,length,notes}` to null; per-mcp `connected` to false, `custom_kind` to false, `override_classified` to false.
7. Returns `{ prefs, status: "ok" }`.

## Returns

`{ prefs, status, reason }` as defined in Outputs.

## Test fixtures

HC-V0780-A1 (populated), HC-V0780-A2 (missing file), HC-V0780-A3 (seed shape), HC-V0780-A4 (malformed) in `platform/test/run-cowork-smoke.js`.
