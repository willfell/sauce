---
title: Sauce Claude Cohesion — Design
date: 2026-05-12
version_target: v0.32.0 (wave 1), v0.33.0 (wave 2), v0.34.0 (wave 3)
status: design-locked
supersedes: hand-maintained .claude/commands/* + Docs/Meta/*-System.md
---

# Sauce Claude Cohesion — Design

> [!abstract] Goal
> Make sauce slash commands the single user-facing entry point to the whole platform. Blueprints declare what they contribute to the Claude agent surface (slash commands, SKILL.md bodies, CLAUDE.md rows, context docs) via a new typed `claude_surface[]` manifest field. The installer aggregates contributions into a registry, materializes the files, regenerates marker-bounded sections of CLAUDE.md, and `/audit` walks the registry to detect drift. Lifecycle commands (`/install`, `/upgrade`, `/audit`, `/bootstrap`) ship from a new `platform-claude` mechanism so the agent surface stays in lockstep with the platform CLI it wraps.

> [!info] Driving inputs
> - Consumer-side Phase-1 audit (accuris-sauce): `spice/projects/sauce-claude-cohesion/tasks/Phase 1 Inventory Report/`
> - Worst-case drift example: `.claude/commands/project.md` pinned to pre-v1.4 paths (`boards/planning/`, `Extras/Scripts/`) two minor versions out of date
> - Existing precedents inside pantry: `nav-buttons-registry` subscription-aware prune, `bootstrap_contributions[]` cross-cutting contribution field, `manifest.skills[]` cowork pattern
> - Existing pantry CLI: `platform/cli/sauce-cli.js` already has `bootstrap`, `audit`, `migrate`, `status`, `update`, `wizard`, `help` verbs

---

## 1. Decisions locked

| Question | Decision |
|----|----|
| **(a) Manifest shape** | NEW typed `claude_surface[]` field with kinds `{command, skill, context_doc, claude_md_row}`. Replaces ad-hoc `files[]` + `skills[]` for Claude artifacts. |
| **(b) Meta-doc fate** | **Retire** `Docs/Meta/<X>-System.md` entirely. Content folds into SKILL.md OR a `kind: context_doc` entry under `{{module_directory}}/context/`. Wave 3 deletes the legacy files. |
| **(c) Orphan commands migration** | `/project` → project blueprint (wave 2). `/audit` → audit mechanism (wave 1). `/ticket` → defer (no clear owner yet; revisit). |
| **(d) `/audit` blueprint-awareness** | YES. Audit mechanism 0.1.1 → 0.2.0 gains `claude-surface-walker.js` + new CLI flag `sauce audit --claude-surface` + 4-level severity report. |
| **(e) CLAUDE.md generation** | **Hybrid.** Preamble hand-maintained; three marker-bounded auto-regenerated sections: `directory-map`, `resolvers`, `skills-index`. |
| **(f) Lifecycle command owner** | NEW mechanism `platform-claude@0.1.0` (`required: true`, mirrors `customjs-guard` posture). Ships `/install`, `/upgrade`, `/bootstrap`. `/audit` ships from the audit mechanism (cleaner: walker + command + skill all co-located). |
| **First-touch UX** | Global `sauce` CLI installed via `curl … install.sh \| bash`. Fresh-vault flow: `cd <new-vault> && sauce bootstrap`. Slash commands always available after that. |
| **Override policy** | Hard overwrite on install. `.claude/commands.local/` and `.claude/skills.local/` shadow paths preserved across installs; post-install copy-over step applies shadows. Direct edits to canonical paths are surfaced by `/audit` as "consumer edit at risk". |

---

## 2. Architecture & data flow

```
blueprint manifest.claude_surface[]    ─┐
mechanism manifest.claude_surface[]    ─┤── installer aggregates ──┐
platform-claude (lifecycle commands)   ─┘                          │
                                                                   ▼
                                            ranch/claude-surface-registry.json
                                                                   │
                       ┌──────────────────┬────────────────────────┤
                       ▼                  ▼                        ▼
              materialize files     regenerate CLAUDE.md      /audit drift
              .claude/commands/**   marker-bounded sections   classifier
              .claude/skills/**     (directory-map, resolvers, (dead path,
              {{module_dir}}/context/** skills-index)          orphan, stale,
                                                                consumer edit
                                                                at risk, aligned)
                       │
                       ▼
              post-install pass:
              .claude/commands.local/** + .claude/skills.local/**
              copy-over → canonical paths (.local takes precedence)
```

> [!example]- Source-of-truth invariant
> Every command, SKILL.md, CLAUDE.md row, context-doc is authored under `platform/{blueprints,mechanisms}/<x>/...` and declared in that manifest's `claude_surface[]`. **The registry is a derived artifact** — rebuilt fresh on every install from `(subscription, manifests)`, never hand-edited. Mirrors `pruneNavButtonsRegistry`'s posture.

---

## 3. `claude_surface[]` schema

```jsonc
"claude_surface": [
  {
    "kind":   "command",                  // → .claude/commands/<x>.md
    "source": "commands/project.md",
    "dest":   ".claude/commands/project.md"
  },
  {
    "kind":   "skill",                    // → {{skills_dir}}/<x>/SKILL.md
    "source": "skills/new-project/SKILL.md",
    "dest":   "{{skills_dir}}/new-project/SKILL.md"
  },
  {
    "kind":   "context_doc",              // operator-facing system doc
    "source": "docs/project-system.md",
    "dest":   "{{module_directory}}/context/project-system.md"
  },
  {
    "kind":   "claude_md_row",            // contributes to a generated CLAUDE.md section
    "table":  "resolvers",                // one of: directory-map | resolvers | skills-index
    "row":    { "topic": "Projects", "path": "{{module_directory}}/", "command": "/project" }
  }
]
```

> [!info] Typed `claude_md_row` (not raw markdown)
> Renderer formats the table; blueprint declares facts. Keeps generation logic in one place, lets `/audit` reason about each cell (e.g. the `path` field must resolve on the filesystem), avoids markdown-injection from blueprint authors.

> [!info] Substitution variables available
> - `{{module_directory}}` — already overlaid for blueprints (`spice/<bare-name>`)
> - `{{skills_dir}}` — already overlaid for blueprints; **generalized in this design** to apply to mechanisms that declare a `skills_dir` field (today only blueprints do)
> - `{{templates_path}}`, `{{scripts_path}}`, `{{views_path}}` — unchanged

> [!info] Migration of existing `manifest.skills[]`
> cowork is the only consumer. Its `skills[]` rewrites 1:1 into `claude_surface[]` with `kind: skill`. The `skills_dir` field stays as-is. Old `skills[]` field deprecated in wave 1, removed in wave 2.

---

## 4. Registry — `ranch/claude-surface-registry.json`

```jsonc
{
  "schema_version": 1,
  "generated_at": "2026-05-12T14:32:00Z",
  "workshop_version": "0.32.0",
  "contributions": {
    "project":         [ { "kind": "command", "dest": ".claude/commands/project.md", "version": "1.5.0" }, … ],
    "daily":           [ … ],
    "platform-claude": [ … ],
    "audit":           [ { "kind": "command", "dest": ".claude/commands/audit.md", "version": "0.2.0" }, … ]
  }
}
```

> [!tip] Subscription-aware prune
> Built fresh from `(subscription, manifests)` on every install. No merge with previous state. Installer diffs old → new registry to delete files that disappeared (mirrors `pruneNavButtonsRegistry` exactly).

---

## 5. Installer changes

> [!todo]- Steps in install.js (per blueprint loop already exists at L227)
> - [ ] **Step 6b (NEW)** — `aggregateClaudeSurface(perItemManifest, subscription, installedNow)` builds the new registry, returns flattened materialization list.
> - [ ] **Step 6c (NEW)** — `materializeClaudeSurface(list, vault)` writes the four kinds. `command` + `skill` + `context_doc` are file copies with substitution; `claude_md_row` rows feed step 6d.
> - [ ] **Step 6d (NEW)** — `regenerateClaudeMd(rows, vault)` rewrites marker-bounded sections in CLAUDE.md.
> - [ ] **Step 6e (NEW)** — `pruneClaudeSurface(prevRegistry, newRegistry)` deletes files that left the registry.
> - [ ] **Step 6f (NEW)** — `applyLocalShadows(vault)` copies `.claude/commands.local/**` → `.claude/commands/**` (and same for skills), OVERWRITING canonical. Runs AFTER materialize.
> - [ ] **Step 7** (existing nav-buttons prune) — unchanged.
> - [ ] **Step 8** (existing ledger prune) — unchanged.

> [!warning] `installItem` handlers
> Today `installItem` handles `files[]`, `customjs_classes[]`, `nav_buttons[]`, `templater_hotkeys[]`, etc. The `claude_surface[]` field is processed OUTSIDE `installItem` (in the aggregate step above) so the registry can see all blueprints' contributions before any materialization runs. This is important for `claude_md_row` row ordering and prune logic.

---

## 6. `platform-claude` mechanism

```
platform/mechanisms/platform-claude/
├── manifest.json                       (NEW; required: true)
├── commands/
│   ├── install.md                      → .claude/commands/install.md
│   ├── upgrade.md                      → .claude/commands/upgrade.md
│   └── bootstrap.md                    → .claude/commands/bootstrap.md
├── skills/
│   ├── install/SKILL.md
│   ├── upgrade/SKILL.md
│   └── bootstrap/SKILL.md
├── claude-md-renderer.js               (called from install.js step 6d)
└── claude-md-template.md               (scaffolding for fresh-vault CLAUDE.md; used by /bootstrap only)
```

> [!info] What each slash command does
>
> | Slash | SKILL.md orchestration | CLI verb |
> |----|----|----|
> | `/install` | Re-runs install for current subscription; reports per-blueprint changed/unchanged | `sauce install` |
> | `/upgrade` | Interactive: which blueprint, to what version; updates `ranch/platform-subscription.json`; re-runs install | `sauce update` |
> | `/audit` | Walks `claude-surface-registry.json` + filesystem + CLAUDE.md; emits 4-level severity report | `sauce audit --claude-surface` |
> | `/bootstrap` | Re-runs first-run wizard (changing subscription set, re-scaffolding plugins). True first-touch is always `sauce bootstrap` from raw CLI. | `sauce bootstrap` |

> [!warning] `/audit` ownership
> Lives in the **audit mechanism** (`platform/mechanisms/audit/`), NOT in `platform-claude`. Reason: walker + command + skill all co-located in one mechanism. `platform-claude` ships only `/install`, `/upgrade`, `/bootstrap`. Avoids two mechanisms claiming overlapping artifacts.

---

## 7. Audit mechanism 0.1.1 → 0.2.0

> [!todo]- New source files in `platform/mechanisms/audit/`
> - [ ] `claude-surface-walker.js` — walks registry, FS, CLAUDE.md; emits drift report
> - [ ] `commands/audit.md` — slash command body
> - [ ] `skills/audit/SKILL.md` — orchestrator that shells to `sauce audit --claude-surface` and renders the report
> - [ ] CLI flag `--claude-surface` on `sauce audit` (default off; slash command always passes it)

### Four severity levels (read-only — landmine #21 posture)

| Severity | Means |
|----|----|
| **dead path** | Registry says file should exist at `X` but FS doesn't have it. OR a `claude_md_row.path` doesn't resolve. |
| **orphan** | File exists at `.claude/commands/<x>.md` or `.claude/skills/<bp>/.../SKILL.md` but NO registry entry claims it. |
| **stale-but-valid** | Registry version disagrees with version embedded in the deployed body (opt-in v1; body-embedded version string optional). |
| **consumer edit at risk** | Canonical file content differs from blueprint source AND no matching `.local/` shadow exists. Next install will wipe it. |
| **aligned** | Reported as count only, confirms cohesion. |

---

## 8. CLAUDE.md marker contract

```markdown
<!-- @claude-surface:directory-map BEGIN -->
## Directory map
| Path | Blueprint | Purpose |
| spice/projects/ | project | Per-project atlas + map + Kanban |
| …
<!-- @claude-surface:directory-map END -->

<!-- @claude-surface:resolvers BEGIN -->
## When working on X, read Y
| Topic | Path | Slash command |
| …
<!-- @claude-surface:resolvers END -->

<!-- @claude-surface:skills-index BEGIN -->
## Skills index
| Command | SKILL.md | Blueprint/Mechanism |
| …
<!-- @claude-surface:skills-index END -->
```

> [!warning] Render rules
> - Anything outside marker pairs is preserved verbatim
> - Stable alphabetic sort by topic / command (clean diffs)
> - Missing marker pair → renderer APPENDS a new section at end of file
> - Half-open marker pair (`BEGIN` without `END`) → renderer fails loud rather than corrupt
> - Workshop CLAUDE.md and consumer CLAUDE.md both get this treatment (dogfooding)
> - Platform-level directory-map rows (`pantry/`, `ranch/`, `spice/`, `.claude/skills/`) are pre-seeded by the renderer; blueprint rows append

---

## 9. `.local/` shadow shim

> [!info] Implementation reality
> Claude Code's slash-command and skill loaders don't natively prefer `.commands.local/`. Resolution is install-time, not runtime.

### How it works

1. Installer materializes canonical content to `.claude/commands/<x>.md` and `.claude/skills/<bp>/.../SKILL.md` from blueprint source (steps 6b-c).
2. **Post-install step (6f)** scans `.claude/commands.local/` and `.claude/skills.local/` and copies each matching file OVERWRITING the canonical it just installed.
3. Every install does both passes — removing a `.local/` file restores the canonical on next install.
4. Edge case: consumer edits canonical directly → install wipes it. `/audit` surfaces this as "consumer edit at risk" before they lose work.

---

## 10. Rollout — three waves

> [!todo]- Wave 1 — v0.32.0 (foundation)
> - [ ] Installer: `claude_surface[]` field + registry build + four-kind materializer + CLAUDE.md marker renderer + `.local/` shadow shim
> - [ ] New mechanism `platform-claude@0.1.0` with `/install`, `/upgrade`, `/bootstrap` commands + skills
> - [ ] Audit mechanism 0.1.1 → 0.2.0 with `/audit` command + skill + `claude-surface-walker.js`
> - [ ] Workshop CLAUDE.md gains three marker pairs (dogfood — also seeds initial generated rows for cowork)
> - [ ] cowork 0.2.1 → 0.3.0 MINOR: `skills[]` → `claude_surface[]` (kind=skill); slash-command `files[]` entry → `claude_surface[]` (kind=command)
> - [ ] NEW harness `platform/test/run-claude-surface.js`; extend `run-install.js` for materializer; extend `run-audit.js` for new classifier
> - [ ] `workshop_version` 0.31.0 → 0.32.0; tag `v0.32.0` after USER APPROVAL

> [!todo]- Wave 2 — v0.33.0 (three highest-traffic blueprints)
> - [ ] `project` 1.4.1 → 1.5.0: canonical `/project` command + new-project SKILL.md authored at `platform/blueprints/project/{commands,skills}/`. Replaces stale consumer-side bodies on next install.
> - [ ] `daily` 0.2.6 → 0.3.0: `/daily` command + skill
> - [ ] `meetings` 0.3.1 → 0.4.0: `/meetings` command + skill
> - [ ] Each adds `claude_md_row` entries for resolvers + skills-index + directory-map

> [!todo]- Wave 3 — v0.34.0 (remaining blueprints + Meta-doc retirement)
> - [ ] `boards`, `people`, `to-do`, `finance`, `journal`, `trips` ship `claude_surface[]` entries
> - [ ] One-time migration: content in `Docs/Meta/<X>-System.md` folds into per-blueprint `context_doc` entries OR SKILL.md bodies
> - [ ] Legacy `Docs/Meta/*-System.md` files flagged as orphans by `/audit` → user deletes them
> - [ ] `/ticket` orphan command — final disposition decided this wave (likely new `tickets` blueprint OR fold into project)

---

## 11. First-install / re-install / cohesion-fix UX

### Brand-new vault (zero state)
```
$ curl -sSL https://sauce.willfellhoelter.com/install.sh | bash    # once per machine
  → clones sauce workshop to ~/sauce, links `sauce` binary on PATH

$ mkdir ~/notes/new-vault && cd ~/notes/new-vault
$ sauce bootstrap
  → first-run wizard
  → writes ranch/platform-{config,subscription}.json
  → runs installer (full platform install)
  → materializes .claude/commands/{install,upgrade,audit,bootstrap}.md + SKILL.mds
  → generates initial CLAUDE.md from claude-md-template.md + marker sections
  → "Open this vault in Claude Code. Try /audit to confirm."
```

### Ongoing vault management
```
/install   — re-runs install against current subscription
/upgrade   — interactive blueprint+version selection; updates subscription; re-installs
/audit     — 4-level cohesion + content audit report
/bootstrap — re-runs first-run wizard (changing subscriptions, re-scaffolding plugins)
```

### Cohesion-fix flow for an existing v0.31 vault (e.g., accuris-sauce today)
```
$ cd ~/sauce && git pull                  # pull v0.32.0
$ cd ~/notes/accuris-sauce
$ sauce install                            # one-time raw CLI (slash commands not yet present in 0.31 vault)
  → installs platform-claude mechanism
  → materializes .claude/commands/{install,upgrade,audit,bootstrap}.md
  → regenerates CLAUDE.md marker sections
[from here, slash commands]
/audit     → drift report against new registry
/upgrade   → bump project / daily / meetings to wave-2 versions when they ship
```

---

## 12. Version bumps, landmines, allowlist

> [!warning] Version bumps requiring USER APPROVAL
> - `workshop_version`: 0.31.0 → 0.32.0 (wave 1) → 0.33.0 (wave 2) → 0.34.0 (wave 3)
> - NEW mechanism `platform-claude@0.1.0` (mechanism count 9 → 10)
> - Audit 0.1.1 → 0.2.0 MINOR (additive walker + new command/skill)
> - cowork 0.2.1 → 0.3.0 MINOR (skills[] → claude_surface[] migration)

> [!warning] NEW landmine #22 — `.local/` is the only override seam
> Direct edits to canonical `.claude/commands/<x>.md` or `.claude/skills/<bp>/**/SKILL.md` are REVERTED on next install. The ONLY supported customization path is `.claude/commands.local/<x>.md` or `.claude/skills.local/<bp>/<skill>/SKILL.md`. Surfaced by `/audit` as "consumer edit at risk".

> [!warning] Landmine #12 allowlist expansion (USER APPROVAL required)
> Current allowlist (13 paths) expands to add:
> - `.claude/commands/**`
> - `.claude/skills/**` (already implicit via cowork skills_dir; making it explicit)
> - `.claude/commands.local/**`
> - `.claude/skills.local/**`
> - `CLAUDE.md` write region: between marker pairs only; outside markers preserved bit-for-bit

---

## 13. Open questions

> [!warning] Resolve during wave-1 implementation plan
> 1. **`directory-map` table seeding** — platform-level rows (`pantry/`, `ranch/`, `spice/`, `.claude/skills/`) need a non-blueprint source. Resolution proposal: hard-code in `claude-md-renderer.js` as a fixed pre-seed list; blueprint rows append. Confirm during plan-writing.
> 2. **Workshop self-dogfooding** — workshop's own `commands/new-project.md` and any other workshop-root slash commands need a place in the model. Audit during wave-1 S0; likely fold into `platform-claude` claude_surface.
> 3. **`/bootstrap` asymmetry** — slash version is for re-bootstrap only; true first-touch is always raw CLI. Document this clearly in `bootstrap/SKILL.md`.
> 4. **`/ticket` disposition** — orphan today; no clear owner. Defer to wave 3.
> 5. **Body-embedded version strings** — `stale-but-valid` severity requires deployed files to carry their blueprint version. Opt-in v1; revisit which blueprints actually need this.
