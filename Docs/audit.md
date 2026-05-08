---
purpose: User-facing reference for `sauce audit` — the v0.29.0 CLI verb that surfaces per-blueprint structural conformance gaps + untracked top-level directories across a sauce vault. Detection-only.
audience: Users running structural audits on their own vaults
since: v0.29.0
---

# `sauce audit` — User Guide

> [!abstract] What this does
> Walks a sauce-managed Obsidian vault and reports structural conformance gaps against the rule fragments declared by each installed blueprint — missing required frontmatter, missing required tags, naming-pattern violations, sub-section forbidden patterns — plus top-level directories that aren't in the sanctioned set (`spice/`, `pantry/`, `ranch/`, `assets/`, `.obsidian/`, `.claude/`).
>
> **Detection-only.** The audit verb makes zero filesystem mutations to the audited vault. The only exception is when the user passes `--output-file <path>` and the path falls inside the audited vault — and that's user-explicit. Fixes happen in subsequent cleanup sessions where Claude (or the user) edits files directly. See landmine #21.

---

## Quick start

```bash
# 1. From inside a sauce-managed vault (the cwd must contain ranch/platform-installed.json)
cd /path/to/<vault>
source pantry/Scripts/activate.sh   # OR equivalent activation

# 2. Run audit; default writes markdown report to stdout
sauce audit

# 3. Capture report to a file (useful for cleanup-session work-list)
mkdir -p ranch/audits
sauce audit --output-file ranch/audits/$(date +%Y-%m-%d-%H%M%S)-audit.md

# 4. Filter to one blueprint (incremental cleanup)
sauce audit --blueprint trips

# 5. CI / scripting — exit code only
sauce audit --quiet
echo "exit=$?"
```

---

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `--vault <path>` | cwd | Absolute path to the vault to audit. Must contain `ranch/platform-installed.json`. Use when running outside the vault directory. |
| `--blueprint <name>` | (all installed) | Restrict audit to one blueprint (e.g. `trips`, `project`, `people`, `meetings`, `daily`). Helpful for incremental cleanup — fix one bucket, re-run, move on. |
| `--output-file <path>` | (stdout) | Write the markdown report to a file. Prints a one-line summary to stdout (`audit: <V> violations, <U> untracked dirs — written to <path>`). Parent directory must exist. |
| `--no-untracked-check` | off | Skip the top-level untracked-directory scan. Use when you've accepted the residue of a partial migration and only want frontmatter/tag/naming gaps. |
| `--quiet` | off | Suppress all output. Exit code only. Intended for CI / scripting / re-audit at session close. |

---

## Exit codes

- `0` — zero violations + zero untracked dirs. Vault passes audit.
- `1` — one or more violations OR untracked dirs found. Inspect the report.
- `2` — invocation error: not a sauce vault, missing `ranch/platform-installed.json`, missing parent dir for `--output-file`, glob pattern syntax error in a rule fragment.

---

## Report format

```
# Audit report — /path/to/<vault>

**Date:** 2026-05-08 00:55
**Workshop version:** 0.29.0
**Vault platform-installed:** 0.29.0
**Blueprints installed:** boards, daily, meetings, people, project, trips, ...

## Summary

- Violations: 12
- Untracked top-level dirs: 3

## Untracked top-level directories

| Directory | File count | Note |
|---|---|---|
| Timestamps/ | 487 .md | not in sanctioned set |
| Extras/ | 73 .md | not in sanctioned set |
| boards/ | 12 .md | not in sanctioned set |

## Violations by blueprint

### trips (3 violations)

| File | Rule | Severity | Message |
|---|---|---|---|
| spice/trips/2026-paris/Trip Atlas.md | required_frontmatter.start_date | error | missing required key 'start_date' |
| spice/trips/2026-paris/Trip Atlas.md | required_frontmatter.type.equals | error | expected 'trip', got 'travel' |
| spice/trips/Trips.md | required_frontmatter.cssclasses.contains | error | missing required value 'wide' in cssclasses |

### project (5 violations)

| File | Rule | Severity | Message |
|---|---|---|---|
| spice/projects/q3-rollup/Project.md | required_frontmatter.description | error | missing required key 'description' |
| ...

### people (4 violations)

| File | Rule | Severity | Message |
|---|---|---|---|
| spice/people/john-doe.md | naming_pattern | error | basename does not match `^[A-Z][a-zA-Z'\- ]+ [A-Z][a-zA-Z'\- ]+\.md$` |
| ...
```

Within each blueprint section, violations are stable-sorted by `(file, rule)` so the same audit run reproduces byte-identical reports across machines (macOS APFS vs Linux ext4 readdir order would otherwise diff-shuffle).

---

## Integration with the cleanup workflow

The v0.29.0 audit verb is a **work-list generator** for a multi-session vault baseline rollup. The protocol mirrors `sauce migrate`'s backup-first discipline:

### Per-session protocol

1. **Snapshot first.** Copy the target vault to `<vault>.pre-cleanup-<YYYYMMDD-HHmmss>/` (sibling, OUTSIDE the vault dir so Obsidian doesn't index it).
2. **Capture starting state.** `sauce audit --output-file <vault>/ranch/audits/<YYYY-MM-DD-HHmmss>-audit.md`.
3. **Walk the report top-down.** Fix violations one at a time. Claude can edit files directly during the session; manual edits are equally fine.
4. **Re-audit at session close.** Capture the closing report. Append a delta-summary entry to `Docs/plans/2026-05-08-vault-baseline-rollup.md` (vault, before-violation-count, after-violation-count, what-was-fixed, what-remains).
5. **Iterate across sessions** until each consumer vault passes `sauce audit --quiet` with exit 0.

### "Done" criterion

All 3 vaults (`accuris-sauce`, `ero-sauce`, `headspace-sauce`) report zero violations + zero untracked dirs (or the remaining untracked dirs are explicitly accepted as user-owned residue and would be allowlisted via a future `ranch/audit-allowlist.json` mechanism — deferred to v0.29.1 if signal-to-noise warrants).

---

## Read-only contract (landmine #21)

`platform/audit/*` makes zero filesystem mutations to the audited vault. Code review must reject any `writeFileSync` / `appendFileSync` / `mkdirSync` / `renameSync` / `unlinkSync` etc. in `platform/audit/*.js` whose target is rooted in the audited vault path.

Mirrors landmine #20's posture for `sauce migrate` source vaults — the audit verb runs untrusted-stable on production consumer vaults; users must be able to run it without taking a snapshot first.

The only sanctioned write is `--output-file <path>` when the user explicitly passes a path that resolves inside the audited vault (e.g. the cleanup-workflow `ranch/audits/` convention). The walker / rule-runner / report writers themselves never touch disk except via that single user-explicit channel.

---

## What v0.29.0 covers / doesn't cover

### Covered (5 blueprints with rule_fragments)

| Blueprint | Surface | Cycle |
|---|---|---|
| trips | entity (`Trip Atlas.md`) + hub (`Trips.md`) | v0.29.0 |
| project | entity (`Project.md`) | v0.29.0 |
| people | per-person notes (excludes hub) | v0.29.0 |
| meetings | per-meeting note + per-period hub (frontmatter_branch) | v0.29.0 |
| daily | daily-note shape + filename pattern | v0.29.0 |

### Not covered yet (v0.29.1 PATCH carries)

- **`journal` blueprint** — no `rule_fragments[]` declared yet. Authoring deferred until journal-migrator lands and shape stabilizes.
- **`to-do` blueprint** — no `rule_fragments[]` declared yet.
- **`boards` blueprint** — no `rule_fragments[]` declared yet (boards are path-translated only in v0.28.0; rule-fragment authoring waits on full Sauce-shape board ecosystem).
- **`finance` blueprint** — no `rule_fragments[]` declared yet (no real source content in any consumer vault).
- **Sub-section + task-note rule fragments** for trips (Flights/Stay/Activities/etc.) and project (`<slug>/board/<task>.md`) — entity + hub coverage shipped this cycle; sub-section coverage deferred.
- **Per-vault audit allowlist** (`ranch/audit-allowlist.json`) — v0.29.0 hard-flags every non-sanctioned top-level dir. Per-vault opt-out deferred to v0.29.1 if signal-to-noise across cleanup sessions warrants.

### Out of scope (this cycle's design)

- **No auto-fix tooling.** No `sauce audit --fix`, no `sauce conform` interactive verb. Detection-only by design — auto-fix is a separate feature surface that benefits from seeing real-world violations first.
- **No new migrators** (journal-migrator, finance-migrator, full Sauce-shape project ecosystem) — deferred to v0.30.0+.
- **No visual / UX audit.** Card rendering, nav-button wiring, hub feel — these are a manual visual smoke pass after the structural audit clears. The legacy in-vault `/audit` Templater command (workshop dogfood) covers the in-Obsidian render check.

---

## Schema reference (`rule_fragments[]`)

Each blueprint's manifest may declare a `rule_fragments[]` array. The installer (`install.js:applyRuleFragment`) accumulates all fragments from installed blueprints into `ranch/rules/<blueprint>.json`. The audit walker reads those files, applies each fragment to matching files, emits violations.

### Wrapper shape

```jsonc
{
  "rule_fragments": [
    {
      "scope": { "path_glob": "spice/<bp>/...", "exclude_basenames": ["..."] },
      "required_frontmatter": { "<key>": { "required": true, "type": "...", "<predicate>": "..." } },
      "required_tags": ["<tag>", ...],
      "naming_pattern": "^...$",
      "frontmatter_branch": [ { "when": {...}, "required_frontmatter": {...}, "required_tags": [...] }, ... ]
    }
  ]
}
```

### Scope

| Field | Type | Behavior |
|---|---|---|
| `scope.path_glob` | string | Glob the rule applies to (e.g. `spice/trips/*/Trip Atlas.md`, `spice/daily/**/*.md`). Files not matching are skipped for this fragment. |
| `scope.exclude_basenames` | string[] | Basenames excluded from the scope (e.g. exclude the hub `People.md` from the per-person naming pattern). |

### Frontmatter predicates

`required_frontmatter` is `{<key>: {required, type, ...predicate}}`. Predicates:

| Predicate | Applies to | Behavior |
|---|---|---|
| `required: true` | any | Key must be present in frontmatter. |
| `type: "string"\|"list"\|"number"\|"boolean"` | any | Coerced YAML value must match. |
| `equals: "<value>"` | strings | Exact-value match (e.g. `equals: "trip"`). |
| `matches: "<regex>"` | strings | Regex match against scalar string value. |
| `contains: ["<value>", ...]` | lists | All listed values must appear in the array. |

### Required tags

```jsonc
"required_tags": ["trip"]
```

Each tag must appear in the file's `tags:` frontmatter list (or as a `#trip` body tag). Object shape `{ "tag": "trip" }` is also accepted (test-fixture variant).

### Naming pattern

```jsonc
"naming_pattern": "^[A-Z][a-zA-Z'\\- ]+ [A-Z][a-zA-Z'\\- ]+\\.md$"
```

Regex applied to the **basename** (not the full path). The example above enforces "First Last" people-note basenames.

### Frontmatter branch

When a single scope contains heterogeneous note types distinguished by frontmatter shape, use `frontmatter_branch[]` for first-match resolution:

```jsonc
"frontmatter_branch": [
  {
    "when": { "frontmatter": { "type": "meeting" } },
    "required_frontmatter": { "date": { "required": true, "type": "string" } },
    "required_tags": ["meeting"]
  },
  {
    "when": { "tags_contains": "meetings-hub" },
    "required_tags": ["meetings-hub"]
  }
]
```

The first matching `when` predicate wins; the rest are skipped for that file. Unmatched files emit no violations from the branch (the outer fragment may still emit scope-level checks).

### Examples

See each blueprint's `manifest.json` for canonical examples:

- `platform/blueprints/trips/manifest.json` — entity + hub
- `platform/blueprints/project/manifest.json` — entity only
- `platform/blueprints/people/manifest.json` — exclude_basenames + naming_pattern
- `platform/blueprints/meetings/manifest.json` — frontmatter_branch
- `platform/blueprints/daily/manifest.json` — naming_pattern + path_glob `**/*.md`

---

## Common questions / troubleshooting

### "Audit reports `rules file missing for <blueprint>`"

Your consumer vault's `ranch/rules/<bp>.json` file doesn't exist. The vault was last installed against an older workshop version (pre-v0.29.0) that didn't materialize that blueprint's rule fragments. Run `sauce update --force` from inside the vault to re-materialize. Audit continues — the missing rules file is a warning, not a fatal error.

### "Audit refuses to run with `not a sauce vault: <path>`"

The audit verb requires `<vault>/ranch/platform-installed.json` to exist. Check:

```bash
ls /path/to/<vault>/ranch/platform-installed.json
```

If the file is missing, the directory isn't a sauce-managed vault yet. Bootstrap it first via `curl ... | bash` per `Docs/install.md`.

If you ran `sauce audit` from a parent directory or sibling, pass `--vault <path>` explicitly.

### "Audit reports zero violations but I see things wrong in Obsidian"

The v0.29.0 audit is **structural** — frontmatter / paths / tags / filenames. UX issues (cards rendering blank, nav buttons firing wrong, hubs missing dataviewjs queries) are **visual-only** and not in scope.

For in-vault visual smoke, run the legacy `/audit` Templater command from inside Obsidian. It walks the workshop dogfood notes and renders dataviewjs / customjs blocks in real time — that's the canonical UX audit channel.

The roadmap for shipping a unified audit (structural + visual / Obsidian-API-bound) is open; v0.30.0+ candidate.

### "Audit shows a violation, but the file is correct in Obsidian"

A few common gotchas:

- **YAML auto-parsing of dates.** `start_date: 2026-05-08` (unquoted) auto-parses to a `Date` object; the audit's string-type predicate sees a non-string. Fix: quote the value (`start_date: "2026-05-08"`).
- **NBSP from copy-paste.** Copy-pasting frontmatter through chat / markdown renderers can introduce U+00A0 (non-breaking space). The audit treats this as a string-mismatch. Re-type the value.
- **Empty list emitted as `key:` (null).** Sauce templates emit `key: []` (explicit empty list) so the audit walker recognizes the type. Hand-edited frontmatter that drops the `[]` parses as null and trips the `type: list` predicate. Restore `[]`.

---

## See also

- `Docs/plans/2026-05-08-v0.29.0-vault-audit-design.md` — design rationale + locked decisions
- `Docs/plans/2026-05-08-v0.29.0-vault-audit-plan.md` — implementation plan + harness coverage
- `Docs/plans/2026-05-08-vault-baseline-rollup.md` — multi-session cleanup work-list (post-cycle)
- `Docs/landmines.md` #21 — audit verb is read-only against the audited vault
- `Docs/landmines.md` #20 — sibling read-only posture for `sauce migrate` source vaults
- `Docs/migrate.md` — the v0.28.0 verb that produces the baselines audited here
- `Docs/install.md` — sauce platform install instructions
