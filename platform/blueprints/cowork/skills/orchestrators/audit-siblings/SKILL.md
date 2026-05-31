---
name: cowork:audit-siblings
description: Pure read-only audit of per-kind sibling files vs `microscope.md` `## References` sections. Detects dangling references (named but file absent) + orphan files (present but unreferenced). Emits `[!warning]` per dangling + `[!info]` per orphan + `[!success]` when clean. Invoked as `/cowork audit-siblings` (all kinds) or `/cowork audit-siblings <kind>` (single kind).
inputs:
  kind: string | null
outputs:
  dangling: list[{kind, name}]
  orphans: list[{kind, name}]
  kinds_audited: int
tags: [cowork, audit, orchestrator, read-only]
---

# cowork:audit-siblings

Pure read-only audit. No writes, no MCP gather calls. Surfaces inconsistency between `microscope.md` `## References` entries and the actual sibling files in `spice/cowork/prompts/per-mcp/<kind>/`. Use after a microscope-authoring round to confirm what you wrote is consistent on disk.

## When to run

- After running `/cowork microscope <kind>` and scaffolding new siblings, to verify the new `## References` lines all point at extant files.
- After hand-editing a sibling file (renamed, deleted, added) to verify `microscope.md` still describes the right set.
- Periodically, before a high-stakes morning briefing, as a sanity check.

## Inputs

- `kind` (string, optional): a single kind name to audit. When omitted, audits all kinds in `prefs.priorities`.

## Outputs

- `dangling` (list[{kind, name}]): entries from `microscope.md`'s `## References` that don't have a corresponding file on disk.
- `orphans` (list[{kind, name}]): files in `per-mcp/<kind>/` (excluding `microscope.md` and `_*.md`) that aren't named in `microscope.md`'s `## References` section.
- `kinds_audited` (int): how many kinds were checked.

## Steps

1. **Read preferences.** Call `cowork:read-user-preferences` to load `prefs`. Capture `prefs.priorities` (the ordered kind list).

2. **Resolve scope.** If the `kind` input is set:
   - Verify it appears in `prefs.priorities`. If not, emit `[!warning]` "Kind `<kind>` is not in your `prefs.priorities`. Available kinds: <list>." and exit cleanly.
   - Set `kinds = [kind]`.

   Otherwise, set `kinds = prefs.priorities`.

   If `kinds.length === 0`, emit `[!info]` "No kinds in `prefs.priorities` — nothing to audit. Run `/cowork preferences` first." and exit cleanly.

3. **Gather per-kind state.** Initialize empty objects `kinds_dir_listing = {}` and `microscope_bodies = {}`. For each `kind_name` in `kinds`:
   - List `spice/cowork/prompts/per-mcp/<kind_name>/` via `mcp__obsidian__list_files_in_dir`. Treat a not-found error as an empty listing.
   - Filter to `*.md`, excluding `microscope.md` and any filename matching `^_.*\.md$`. Assign the remaining list to `kinds_dir_listing[kind_name]`.
   - Read `spice/cowork/prompts/per-mcp/<kind_name>/microscope.md` via `mcp__obsidian__get_file_contents` (treat not-found as absent). When present, strip leading frontmatter and assign the body to `microscope_bodies[kind_name]`.

   This step is PURE — no MCP gather calls, no writes.

4. **Audit.** Call `auditSiblings({ kinds_dir_listing, microscope_bodies })` from `platform/blueprints/cowork/helpers/audit-siblings-helper.js`. The helper returns `{ dangling: [{kind, name}, ...], orphans: [{kind, name}, ...] }`, both arrays sorted deterministically by `(kind, name)`.

5. **Render findings.** Emit one callout per finding, in the order returned.

   For each entry in `dangling`:

   > [!warning] Dangling sibling reference
   > Kind: `<kind>`
   > `microscope.md`'s `## References` names `<name>` but no such file exists at `spice/cowork/prompts/per-mcp/<kind>/<name>`.
   > Did you delete the sibling? Or forget to scaffold it? Re-run `/cowork microscope <kind>` to re-author + scaffold, or hand-edit `microscope.md` to remove the dangling reference line.

   For each entry in `orphans`:

   > [!info] Orphan sibling file
   > Kind: `<kind>`
   > `<name>` exists at `spice/cowork/prompts/per-mcp/<kind>/<name>` but is not listed in `microscope.md`'s `## References` section.
   > The gather will still inject it (siblings are glob-discovered, not microscope-driven), but `microscope.md` should document why this sibling exists. Re-run `/cowork microscope <kind>` to re-record the reference, or hand-add a `- **<name>** — <your role description>` line to `microscope.md`'s `## References` section.

   **Note on em-dash:** the `## References` parser requires an em-dash (`—`, U+2014) between `**<name>**` and the role description, matching what `composeMicroscope` emits. If you hand-edit a `## References` bullet with a hyphen (`-`) or en-dash (`–`), the audit will silently flag the sibling as an orphan (the entry is unparseable; the file is still on disk). Use em-dash to keep audit-siblings honest.

6. **Summary.** Emit one final callout:

   - If `dangling.length === 0 && orphans.length === 0`:

     > [!success] All sibling files consistent
     > Audited `<N>` kind(s) — no dangling references, no orphan files.

   - Otherwise:

     > [!info] Audit summary
     > Audited `<N>` kinds; `<D>` dangling reference(s), `<O>` orphan file(s).

## Returns

`{ dangling, orphans, kinds_audited }` per Outputs.

## Test fixtures

HC-V0810-A1..A4 (parseReferences), HC-V0810-B1..B6 (auditSiblings), HC-V0810-C1 (this SKILL.md prose-lint), HC-V0810-D1 (claude_surface materialization + CS-MIG-1 count bump) in the workshop's harness suite.
