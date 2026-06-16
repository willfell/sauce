---
name: cowork:update-active-projects
description: Patch the active-projects state file for ero orchestrators; schema-preserve via read-validate-mutate-revalidate-write.
inputs:
  phase: string
  date_today: string
  writer: string
  changes: object
outputs:
  status: string
  project_count: int
tags: [cowork, state, ero]
---

# cowork:update-active-projects

Deterministic state mutator for `spice/cowork/context/active-projects.md`. Owns the same five-step schema-preservation gate as `cowork:update-active-threads`: Read → parse → mutate → re-validate → write. If post-mutation validation fails, abort with `schema-error:<reason>` and DO NOT WRITE. The cowork blueprint manifest declares a rule_fragment requiring `type: cowork-active-projects`, `updated`, `updated_by` frontmatter on this file.

## Inputs

- `phase` (string, required): one of `"morning-pass"` | `"eod-pass"` | `"weekly-pass"` | `"monthly-pass"` | `"explicit-update"`.
- `date_today` (string, required): today as `YYYY-MM-DD`. Used for `updated` frontmatter stamp.
- `writer` (string, required): caller skill id - populates `updated_by`. Examples: `"cowork:ero-morning"`, `"cowork:ero-eod"`, `"cowork:ero-weekly"`, `"cowork:ero-monthly"`.
- `changes` (object, optional): project-mutation payload. Shape varies by `phase`:
  - `"morning-pass"` / `"eod-pass"` / `"weekly-pass"` / `"monthly-pass"`: `{ projects: [<gather-projects payload>] }` - full rewrite of `## Current Projects` from a fresh `cowork:gather-projects` scan. The `## Reading Project Status` section is preserved verbatim.
  - `"explicit-update"`: `{ updates: [{ slug: string, action: "add" | "update" | "archive", body?: object }] }` for surgical mutations.

## Outputs

- `status` (string): `"ok"` on success; `"schema-error:<reason>"` on validation failure (no write); `"error:<reason>"` on read/write failure.
- `project_count` (int): count of project entries after the mutation.

## Steps

1. Compute `path = spice/cowork/context/active-projects.md`. Read via `mcp__obsidian__read_note`. If missing, return `{ status: "schema-error:file-missing", project_count: 0 }`.
2. Parse frontmatter into `fm`. Validate inbound: `fm.type === "cowork-active-projects"`, `fm.updated` present, `fm.updated_by` present. On any failure return `{ status: "schema-error:inbound-<key>", project_count: <parsed-count> }` without writing.
3. Parse body into two halves: `## Current Projects` (everything between `## Current Projects` and `## Reading Project Status`) and `## Reading Project Status` (preserved verbatim).
4. Apply mutation:
   - For `morning-pass` / `eod-pass` / `weekly-pass` / `monthly-pass`: rewrite `## Current Projects` from `changes.projects[]`. Render the summary table (`Project | Slug | Status | In Progress | Blocked | Last Activity`) followed by a `### <Project Name>` block per entry containing `Phase`, `In Progress`, `Blocked`, `In Planning`, `Recently Moved`, and `Next Step` lines from the gather-projects payload.
   - For `explicit-update`: walk `changes.updates[]`. For `add` append a new `### <name>` block; for `update` locate by slug and replace fields; for `archive` remove the H3 block.
   - Always preserve `## Reading Project Status` verbatim.
5. Bump `fm.updated = date_today` and `fm.updated_by = writer`.
6. Re-render the full buffer: frontmatter fence + `# Active Projects` H1 + `## Current Projects` (mutated) + `## Reading Project Status` (preserved).
7. Re-validate post-mutation: `fm.type === "cowork-active-projects"`, `fm.updated` matches `YYYY-MM-DD`, `fm.updated_by` non-empty. If any fails, return `{ status: "schema-error:post-<reason>", project_count }` and DO NOT WRITE.
8. Write the file (full replace via `mcp__obsidian__write_note`). On write failure, return `{ status: "error:write-failed", project_count }`.
9. Return `{ status: "ok", project_count }`.

## Returns

```json
{ "status": "ok" | "schema-error:<reason>" | "error:<reason>", "project_count": <int> }
```

Reasons (non-exhaustive): `file-missing`, `inbound-type`, `inbound-updated`, `inbound-updated_by`, `post-type`, `post-updated`, `write-failed`.

## Errors

- Never partial-write. Post-mutation schema check is the gate; failure aborts the write and preserves prior on-disk state.
- Sauce-shape path only (`spice/cowork/context/active-projects.md`). Legacy paths MUST NOT appear.
- This sub-skill never raises. All failure modes return a status string.
