---
date: 2026-05-09
purpose: Onboard the next session to design + ship the **cowork blueprint** — productize the user's ad-hoc `Cowork/` automation layer (8 cron-driven prompts + 11 context files + thread-tracking primitive across 2 vaults) as a proper sauce blueprint at `spice/cowork/`, with a NEW subskill pattern that decomposes prompts into reusable Claude Code skills, then migrate all 3 consumer vaults onto it. Substantive multi-stage MINOR cycle (v0.30.0 candidate); needs brainstorming before plan-writing because subskill location + Claude Code skill discovery + per-vault context customization + cron-orchestrator coordination are all open design questions.
predecessors:
  - Docs/plans/2026-05-08-vault-baseline-rollup.md (3-vault session-1 close — ero/headspace/accuris all at baseline)
  - Docs/prompts/2026-05-08-ero-sauce-baseline-rollup-session-1-handoff.md (ero session-1 onboarding doc)
  - Docs/prompts/2026-05-08-post-v0.29.0-next-cycle-handoff.md (the predecessor next-cycle handoff that opened this design space)
  - Docs/plans/2026-05-08-v0.29.0-vault-audit-result.md (v0.29.0 cycle close — audit verb shipped, cowork-shaped paths surfaced as untracked residue across all 3 vaults)
  - Docs/prompts/SESSION-START.md (canonical session-start recipe)
gates:
  - workshop_version 0.29.0 (UNCHANGED at session start; cycle close bumps to 0.30.0)
  - blueprint count: 9 (boards/daily/journal/meetings/people/project/to-do/trips/finance) → 10 (NEW cowork@0.1.0)
  - all 7 harnesses GREEN at session start (bootstrap 58, cli 58, install-sh 14, helper-cases 429, migrate 104, audit 41, renderer 30 cases)
  - 3 vault snapshots retained from v0.29.0 + session-1 rollup work (`accuris-sauce.pre-cleanup-20260508-095654/`, `headspace-sauce.pre-cleanup-20260508-155853/`, `ero-sauce.pre-cleanup-20260508-221649/`)
  - landmines list 21 (UNCHANGED)
  - stub md5 invariant `ea23aa812503bfca66359d3b2b239ba8` UNCHANGED
required_sub_skill: superpowers:brainstorming FIRST (resolve the 11 open design questions in §5 below), then superpowers:writing-plans (S1-S6 implementation breakdown), then superpowers:executing-plans (stage-by-stage execution across multiple sessions, with checkpoint commits at each S close).
target_artifact: Docs/plans/2026-05-09-v0.30.0-cowork-blueprint-design.md → -plan.md → -result.md → tag v0.30.0 (USER APPROVAL gate per CLAUDE.md ask-before-acting). Vault-side rollouts under each consumer's `spice/cowork/` post-install. New `Cowork/` content migrated; legacy `Cowork/` dir removed (or sanctioned-allowlisted) after migration verified.
---

# Onboarding — cowork blueprint cycle (v0.30.0)

> [!info] Project identity
> - **Project name:** `sauce`
> - **GitHub remote:** `git@github-personal:willfell/sauce.git`
> - **Workshop dev repo:** `/Users/willfellhoelter/projects/repos/sauce`
> - **Consumer vaults (target for rollout):** `/Users/willfellhoelter/notes/sauce/{barebones,accuris-sauce,ero-sauce,headspace-sauce}`
> - **Vaults with active cowork content:** ero-sauce + headspace-sauce (each has `Cowork/` at vault root). accuris does NOT (per accuris session 1 audit — no `Cowork/` dir). barebones is the regression target — should pull cowork@0.1.0 cleanly post-install with no pre-existing content.

## Mission

Build `cowork@0.1.0` blueprint, productizing the ad-hoc `Cowork/` automation layer that drives 8 scheduled cron jobs across two vaults (5 life-* jobs in headspace, 3 ero-* jobs in ero — see "Existing system" §3). Decompose monolithic prompt files into a NEW **subskill pattern** (reusable Claude Code skills invoked from prompt orchestrators via the Skill tool). Migrate `Cowork/` content from each vault into the canonical `spice/cowork/` module directory. Update cron-job orchestrators (out-of-vault SKILL.md files at `/sessions/.../mnt/.scheduled/<job>/SKILL.md`) to reference new vault paths. Result: `sauce update` propagates cowork updates durably; new prompts can be added by writing a thin orchestrator that composes existing subskills; existing prompts shrink from 200-500 lines to ~30-100 lines each.

**State at session start:**
- `workshop_version: 0.29.0`
- Mechanisms (9, UNCHANGED): customjs-guard@1.0.0, validator@0.1.1, audit@0.1.1, nav-buttons@2.5.3, cards@0.2.4, accent-button@0.1.0, people-rendering@0.1.0, styling@0.1.2, convenience@0.1.0
- Blueprints (9, UNCHANGED): boards@0.1.0, daily@0.2.3, journal@0.1.2, meetings@0.3.0, people@0.1.0, project@1.3.8, to-do@0.1.4, trips@0.1.7, finance@0.2.10
- Harnesses GREEN: 7/7 (704 sub-asserts + 30 renderer cases + 41 audit + 104 migrate)
- Tag on origin: `v0.29.0`
- Working tree: clean on `main`
- 3 consumer vaults at session-1 rollup baseline (audit reports under each `<vault>/ranch/audits/`)

---

## Pre-flight checks

> [!todo] Run BEFORE touching code

```bash
cd /Users/willfellhoelter/projects/repos/sauce
git fetch origin && git status                                # clean tree expected
git log --oneline -5                                          # latest: 94a62af docs(rollup): ero-sauce session 1
for h in run-bootstrap run-cli run-install-sh run-helper-cases run-migrate run-audit; do
  echo "--- $h ---"; node platform/test/$h.js 2>&1 | tail -2
done
node platform/test/run-renderer.js && echo "renderer exit 0"  # expect 30 PASS

# Verify 3 vaults' baseline retained
ls /Users/willfellhoelter/notes/sauce/{barebones,accuris-sauce,ero-sauce,headspace-sauce}/ranch/platform-installed.json
ls /Users/willfellhoelter/notes/sauce/*.pre-cleanup-*/         # 3 snapshots expected (one accuris, one headspace, one ero)

# Verify Cowork/ content unchanged in ero + headspace (the migration source)
ls /Users/willfellhoelter/notes/sauce/ero-sauce/Cowork/{context,prompts}/      | wc -l
ls /Users/willfellhoelter/notes/sauce/headspace-sauce/Cowork/{context,prompts}/ | wc -l
# Expect ~17 ero (7 context + 5 prompts + 5 archive prompts) and ~16 headspace (11 context + 5 prompts)
```

If anything fails, STOP and surface to user before proceeding.

---

## Existing system (read this before brainstorming)

### Cron-job catalogue (8 jobs across 2 vaults)

Source: thin SKILL.md orchestrators at `/sessions/.../mnt/.scheduled/<job>/SKILL.md` that load context + execute a prompt file in the vault's `Cowork/prompts/`. Each invocation writes collapsed callouts into the daily note + refreshes living context files (active-threads, weekly-snapshot, etc.).

**Headspace (life) — 5 jobs:**
| Job | Schedule | Prompt file | What it writes |
|---|---|---|---|
| life-morning | Daily 7:03 AM (~2.5min jitter) | `prompt-morning-briefing.md` | 4-5 collapsed callouts in today's daily note (Morning Briefing, Finance, Email, Messages, Open Threads) |
| life-midday-tripwire | Daily 1:08 PM (~8min jitter) | `prompt-midday-tripwire.md` | Single tripwire callout in today's daily IF locked-card charge OR ≥$50 SCHEELS discretionary posted; silent otherwise |
| life-nightly | Daily 7:10 PM (~10min jitter) | `prompt-eod-review.md` | EOD callout in today's daily (todo status, morning follow-up, tomorrow prep, late emails) |
| life-weekly | Sundays 6:06 PM (~6.5min jitter) | `prompt-weekly-review.md` | Standalone weekly summary file + patch today's daily; refresh active-threads, weekly-snapshot, finance-goals, people |
| life-monthly | 1st of month 8:00 AM | `prompt-monthly-review.md` | Standalone monthly review file + patch today's daily; deep credit-debt month-close addendum |

**ERO (work) — 3 jobs:**
| Job | Schedule | Prompt file | What it writes |
|---|---|---|---|
| ero-morning | Weekday 7:08 AM (~8min jitter) | `prompt-ero-morning.md` | Morning Briefing callout + Monday-only Week Ahead section; refresh active-projects, active-threads |
| ero-eod | Weekday 6:02 PM (~2.5min jitter) | `prompt-ero-eod.md` | EOD callout (thread lifecycle, invoice hour updates, full invoice-prep phase on the 25th+) |
| ero-weekly | Sundays 6:00 PM | `prompt-ero-weekly.md` | Standalone weekly summary + refresh all living context files |

**No ero-monthly job exists.** User flagged in session prep: "If you want a deeper month-close on the work side, that's a clean add — mirror life-monthly's shape." Bundle into the rewire OR treat as separate add — see brainstorm question §5-Q11.

### Existing Cowork directory shape (per vault)

```
ero-sauce/Cowork/
├── context/             7 files: about-will, ero-client, finance-guide, obsidian-vault-guide, active-projects, active-threads, weekly-snapshot
└── prompts/
    ├── prompt-ero-morning.md
    ├── prompt-ero-eod.md
    ├── prompt-ero-weekly.md
    ├── ero-invoice-prep.md            (referenced helper, not directly scheduled)
    └── archive/                       5 archived prompts (ero-session-start, ero-night, ero-morning, ero-session-end, ero-monday-briefing)

headspace-sauce/Cowork/
├── context/             11 files: about-me, people, weekly-snapshot, project-management, finance-goals, working-style, whatsapp-integration, brand-voice, mcp-integrations, obsidian-vault-guide, active-threads
└── prompts/             5 files: prompt-morning-briefing, prompt-midday-tripwire, prompt-eod-review, prompt-weekly-review, prompt-monthly-review
```

`accuris-sauce` does NOT have a `Cowork/` dir — accuris is unscheduled.

### Path-alignment problem (P0 — every prompt is broken post-migration)

Every prompt references LEGACY pre-v0.28.0 paths. Session-1 rollup work moved content TO sauce-shape paths but DID NOT update the cowork prompts (out of session-1 scope). So the prompts will write to and read from non-existent locations on the next cron run.

| Prompt usage | Sauce canonical | Affects |
|---|---|---|
| `Timestamps/YYYY/MM-Month/YYYY-MM-DD-dddd.md` | `spice/daily/YYYY/MM-Month/dddd-YYYY-MM-DD.md` (day-first basename per sauce daily blueprint) | ALL 8 jobs |
| `Timestamps/Journal/Daily Journal, *` | `spice/journal/Journal-YYYY-MM-DD.md` (per blueprint convention; headspace Phase 5 routing already uses this) | life-weekly, life-monthly |
| `Timestamps/ToDo/Daily ToDo, *` | `spice/to-do/<YYYY>/<MM>/ToDo-YYYY-MM-DD.md` | life-morning, life-eod, life-weekly, life-monthly |
| `Timestamps/Summaries/Weekly/weekly-summary-YYYY-MM-DD.md` | `spice/daily/summaries/Weekly/weekly-summary-YYYY-MM-DD.md` (Phase 5 already routed existing files here) | life-weekly, ero-weekly |
| `Timestamps/Summaries/YYYY-MM/monthly-review-YYYY-MM.md` | `spice/daily/summaries/YYYY-MM/monthly-review-YYYY-MM.md` | life-monthly |
| `Timestamps/Meetings/<title>.md` | `spice/meetings/notes/<Y>/<MM>/<title>-<DATE>.md` | ero-morning, ero-weekly |
| `boards/To-Do.md` | `spice/boards/To-Do-Board.md` (per headspace Phase 10 consolidation) | life-morning, life-eod, life-weekly, life-monthly |
| `boards/side-quests/`, `boards/trips/`, `boards/to-do-cards/` | `spice/boards/...`, `spice/trips/<slug>/Trip Atlas.md` | life-morning, life-weekly, life-monthly |
| `Boards/planning/<slug>/<slug>-board.md` | `spice/projects/<slug>/<slug>-board.md` (now with canonical `Project.md` atlas + `name:` field per project@1.3.8) | ero-morning, ero-eod, ero-weekly |
| `Resources/Views/customjs-guard` | `ranch/views/customjs-guard` (cited in vault-guide auto-creation template) | All daily-note auto-creation |
| `Resources/People/Firstname Lastname.md` | `spice/people/<First Last>.md` (per people@0.1.0 blueprint) | vault-guide reference; people module migrated in v0.28.0 |
| Vault root path `/Users/willfell/Documents/obsidian/sync/headspace/` | `/Users/willfellhoelter/notes/sauce/{ero,headspace}-sauce/` | predecessor-machine drift in vault-guide line 18 |

`Finance/<...>` references (debt tracker, invoice notes, monthly budgets) STILL RESOLVE because `Finance/` is preserved untracked in both vaults. **Defer Finance path alignment to v0.30.x finance-migrator** (already a CLAUDE.md carry).

---

## Cowork blueprint design — proposed shape (anchor for brainstorming)

### Module directory + canonical paths

Per landmine #11 (module-directory invariant) + #19 (lowercase platform-managed dirs):

```
spice/cowork/                                    NEW module_directory: "cowork"
├── Cowork.md                                    Hub note (cowork-hub type) — install-time content, dataviewjs blocks for nav + status overview
├── context/                                     User-edited durable context (survives sauce update — like spice/projects/<slug>/Project.md)
│   ├── obsidian-vault-guide.md                  ← migrated from Cowork/context/obsidian-vault-guide.md, paths SWEPT to sauce-shape
│   ├── active-threads.md                        ← migrated; rule_fragment-validated schema
│   ├── weekly-snapshot.md                       ← migrated; rolling 1-week summary state
│   ├── about-me.md / about-will.md              ← migrated; per-vault user identity
│   ├── (per-vault context files — finance-goals, brand-voice, ero-client, working-style, whatsapp-integration, mcp-integrations, project-management, people, finance-guide, active-projects)
│   └── README.md                                ← shipped by blueprint (intent + customization guide)
└── prompts/                                     Job orchestrators (thin — invoke subskills via Skill tool)
    ├── prompt-morning-briefing.md               ~30-100 lines (down from ~520)
    ├── prompt-midday-tripwire.md
    ├── prompt-eod-review.md
    ├── prompt-weekly-review.md
    ├── prompt-monthly-review.md
    ├── prompt-ero-morning.md
    ├── prompt-ero-eod.md
    ├── prompt-ero-weekly.md
    └── (NEW) prompt-ero-monthly.md              if Q11 resolves "bundle"
```

Subskill location is OPEN — see brainstorm Q3.

### Per-vault customization model

Cowork content has TWO classes of files:

1. **Blueprint-shipped** (canonical, gets refreshed on `sauce update`): `Cowork.md` hub, `context/README.md`, `context/obsidian-vault-guide.md` template, `prompts/prompt-*.md` orchestrators (canonical bodies — same for every vault). Subscription'd.
2. **User-edited** (survives `sauce update` untouched, per existing project/trips precedent): `context/about-me.md`, `context/active-threads.md` (state), `context/weekly-snapshot.md` (state), `context/finance-goals.md` (user-curated), and other per-vault content.

Same shape as `spice/projects/<slug>/Project.md` (atlas — user-edited) vs `spice/projects/<slug>/<slug>-board.md` (kanban — also user-edited) vs the canonical `spice/projects/Projects.md` hub (blueprint-shipped, refreshed on update).

The blueprint `manifest.json files[]` list controls WHICH files refresh on `sauce update`. Files listed are blueprint-managed (overwritten); files NOT listed are user-managed (left alone).

### Required frontmatter schema (rule_fragments — proposed)

```json
{
  "rule_fragments": [
    {
      "target": "cowork",
      "fragment": {
        "scope": { "path_glob": "spice/cowork/Cowork.md" },
        "required_frontmatter": { "type": { "required": true, "type": "string" } },
        "required_tags": [{ "tag": "cowork-hub" }]
      }
    },
    {
      "target": "cowork",
      "fragment": {
        "scope": { "path_glob": "spice/cowork/prompts/*.md" },
        "required_frontmatter": {
          "type":     { "required": true, "type": "string" },   // expected: "cowork-prompt"
          "schedule": { "required": false, "type": "string" },  // human-readable cron description
          "scope":    { "required": false, "type": "string" }   // life | work | shared
        },
        "required_tags": []
      }
    },
    {
      "target": "cowork",
      "fragment": {
        "scope": { "path_glob": "spice/cowork/context/active-threads.md" },
        "required_frontmatter": {
          "type":       { "required": true, "type": "string" },  // "cowork-threads"
          "updated":    { "required": true, "type": "string" },
          "updated_by": { "required": true, "type": "string" }
        }
      }
    }
  ]
}
```

Brainstorm: what other rule_fragments are appropriate?

---

## Subskill pattern — proposed shape

### Why decompose

Current prompts are 200-520 lines each, with massive overlap (every prompt has its own "MCP Routing" section, every prompt re-derives "today's date in 4 formats", every prompt independently describes Copilot Money calls). DRY is broken; updating one shared concept (e.g., "no emojis") means touching N files. Subskills extract the reusable units.

### Discovery — `.skill` file format precedent

ERO already has 5 `.skill` files at vault root (`ero-invoice.skill`, `ero-meeting.skill`, `ero-session.skill`, `ero-status.skill`, `ero-task.skill`). **Format: ZIP archives containing `SKILL.md` inside** — Anthropic's standard Claude Code skill bundle format. Each is invokable via Claude Code's Skill tool when discoverable.

### Subskill catalogue (proposed — refine in brainstorm)

| Skill ID | Purpose | Used by |
|---|---|---|
| `cowork:check-vault-routing` | Verify the right vault MCP is connected (replaces the "MCP Routing (mandatory)" section in every prompt) | All 8 jobs |
| `cowork:date-context` | Compute today's date in all needed formats (YYYY-MM-DD, dddd, MM-Month, etc.) — single canonical implementation | All 8 jobs |
| `cowork:ensure-daily-note` | Create today's daily note from canonical sauce daily template if missing | All 8 jobs |
| `cowork:gather-weather` | Evergreen, CO weather (life only — see Q4) | life-morning |
| `cowork:gather-calendar` | GCal events for date range | All life + ero jobs |
| `cowork:gather-gmail` | Gmail digest with category filters | life-morning, life-eod |
| `cowork:gather-imessage` | iMessage digest (variant A/B handling) | life-morning |
| `cowork:gather-finance-yesterday` | Copilot Money yesterday's transactions + flagging | life-morning |
| `cowork:gather-finance-cc-today` | Copilot Money TODAY's CC transactions for tripwire | life-midday-tripwire |
| `cowork:gather-cc-debt-snapshot` | Per-card balances + Δ vs tracker rows | life-morning, life-monthly addendum |
| `cowork:gather-projects` | Read `spice/projects/*/(<slug>-board.md)` + extract status | ero-morning, ero-eod, ero-weekly |
| `cowork:gather-threads` | Read + classify active-threads.md by surfacing rules | All jobs that surface threads |
| `cowork:write-callout-morning-briefing-life` | Compose all life-morning data into the canonical 4-callout block | life-morning |
| `cowork:write-callout-morning-briefing-ero` | Compose ero-morning callout (with Monday Week Ahead) | ero-morning |
| `cowork:write-callout-finance` | Finance callout body (extends with debt-payoff per addenda) | life-morning |
| `cowork:write-callout-tripwire-red` | RED locked-card callout | life-midday-tripwire |
| `cowork:write-callout-tripwire-yellow` | YELLOW SCHEELS discretionary callout | life-midday-tripwire |
| `cowork:write-callout-eod-life` | EOD callout (life shape) | life-nightly |
| `cowork:write-callout-eod-ero` | EOD callout (ero shape, with invoice prep on 25th+) | ero-eod |
| `cowork:write-summary-weekly-life` | Standalone weekly file (life shape) | life-weekly |
| `cowork:write-summary-weekly-ero` | Standalone weekly file (ero shape) | ero-weekly |
| `cowork:write-summary-monthly-life` | Standalone monthly file (life shape) + debt addendum | life-monthly |
| `cowork:write-summary-monthly-ero` | (NEW) Standalone monthly file (ero shape) | ero-monthly (Q11) |
| `cowork:update-active-threads` | Apply morning/EOD/weekly thread state mutations | All thread-managing jobs |
| `cowork:update-weekly-snapshot` | Reset rolling 1-week state (Sunday only) | life-weekly, ero-weekly |
| `cowork:invoice-prep` | Aggregate hours + patch invoice frontmatter + Submission Checklist on 25th+ | ero-eod (conditional) |

**Estimate:** ~25-30 subskills covering the 8-job orchestrator surface. Each subskill: 30-100 lines.

### Prompt orchestrator shape (proposed)

```markdown
---
type: cowork-prompt
schedule: "Daily 7:03 AM MT"
scope: life
---

# Morning Briefing (orchestrator)

This is a thin orchestrator. Each step invokes a reusable subskill.

## Pre-flight
1. Use Skill `cowork:check-vault-routing` (asserts headspace-obsidian MCP is connected)
2. Use Skill `cowork:date-context` → returns today's date in all formats

## Gather
3. Use Skill `cowork:ensure-daily-note` (creates if missing)
4. Use Skill `cowork:gather-weather`
5. Use Skill `cowork:gather-calendar` with `range=today+next-2-days`
6. Use Skill `cowork:gather-gmail` with `query="-category:promotions newer_than:1d"`
7. Use Skill `cowork:gather-imessage`
8. Use Skill `cowork:gather-finance-yesterday`
9. Use Skill `cowork:gather-cc-debt-snapshot`     # debt addendum
10. Use Skill `cowork:gather-threads` with `classification=morning`

## Write
11. Use Skill `cowork:write-callout-morning-briefing-life` with the gathered data
12. Use Skill `cowork:update-active-threads` with `mutation=morning-pass`

## Done.
```

Down from ~520 lines to ~25.

---

## §5 — Open design questions for brainstorming (DO NOT SKIP)

### Q1 — Subskill discovery + materialization location

Claude Code Skill tool resolves skills from `.claude/skills/` (project-local) or `~/.claude/skills/` (user-global) — NOT from arbitrary vault paths. So vault-internal `spice/cowork/skills/` files won't auto-load via the Skill tool. Three options:

- **(A)** Blueprint installer materializes skill bodies to `<vault>/.claude/skills/cowork/<skill-id>.md` per Claude Code convention. Requires expanding allowlist (landmine #12) `.claude/` paths from current 13 to 14 (`.claude/skills/` subtree). Mirror precedent: v0.21.1 added `.claude/plugins/dataview/data.json` + `.claude/hotkeys.json`. Cleanest semantically.
- **(B)** Subskills are NOT Skill-tool skills — they're text fragments at `spice/cowork/skills/` that prompt orchestrators reference via `Read` tool inline (essentially @-mention-style). No Skill-tool integration. Less DRY benefit (orchestrator has to read + interpret each fragment manually) but no allowlist expansion.
- **(C)** Skills package as `.skill` ZIP bundles per the existing ero-*.skill precedent + ship inside `spice/cowork/skills/<skill>.skill`. Claude Code can load `.skill` files from arbitrary paths if explicitly invoked. Bundle format gives versioning + dependencies + supporting files in one archive.

Recommend resolving via Q1 brainstorm with one prototype skill before committing.

### Q2 — Subskill format (Markdown vs YAML-frontmatter MD vs ZIP)

If Q1 = (A) or (B): Markdown with YAML frontmatter (`name`, `description`, `inputs`, `outputs`, `tags`). If Q1 = (C): SKILL.md inside ZIP per Anthropic Skill Bundle Format. Document the format choice + provide a skill template under `platform/blueprints/cowork/templates/Template, Cowork Skill.md`.

### Q3 — Per-vault context divergence

Some context files are SAME-shape per vault (about-me/about-will, active-threads, weekly-snapshot — schema identical, content per-vault). Others are PRESENT in one vault but not the other (ero has `ero-client.md` + `finance-guide.md`; headspace has `mcp-integrations.md` + `whatsapp-integration.md` + `brand-voice.md` + `working-style.md`). Two options:

- **(A)** Blueprint ships ALL context-file templates; consumers get them all on install but only fill in the ones their scope needs. Permissive — extras are harmless.
- **(B)** Blueprint ships templates by category (`life-context/*` + `ero-context/*` + `shared-context/*`); consumer's `platform-subscription.json` declares which category to install. Stricter; aligns with multi-scope future.
- **(C)** Per-scope sub-blueprints: `cowork-life@0.1.0` + `cowork-ero@0.1.0` + `cowork-shared@0.1.0`, each independently versionable. Heaviest; only if appetite for per-scope evolution.

Recommend (B) with `cowork-scope: ["life", "ero", "shared"]` field in subscription. Simple + extensible.

### Q4 — Cron-job orchestrator coordination (out-of-vault SKILL.md files)

Each cron job runs a SKILL.md orchestrator at `/sessions/.../mnt/.scheduled/<job>/SKILL.md` that references prompts inside the vault at `Cowork/prompts/<file>.md`. Once cowork content moves to `spice/cowork/prompts/`, those orchestrators break. Three options:

- **(A)** Update each of 8 SKILL.md orchestrators to point at new `spice/cowork/prompts/` paths. Requires user to apply the changes (out-of-vault SKILL.md edits exceed sauce repo scope). Documented as a manual step in the result doc.
- **(B)** Ship a wrapper script in the vault at `spice/cowork/run.sh <job-name>` that the cron orchestrator invokes; the wrapper handles path resolution. Lets SKILL.md become path-agnostic. New runtime dependency.
- **(C)** Move the cron orchestrators INTO the vault at `ranch/scheduled/<job>/SKILL.md` (sanctioned `ranch/`) + have the cron just call `<vault>/ranch/scheduled/<job>/SKILL.md` directly. Heavy but aligns the runtime layer with the rest of the vault.

Recommend (A) for v0.30.0; consider (C) for v0.31.0+ if cron-orchestrator-vault-coupling becomes desirable.

### Q5 — `Cowork/` legacy dir disposition

After migration, three options:
- **(A)** `git rm -rf Cowork/` (or vault-rm; not git-managed) once content verified at `spice/cowork/`. Clean.
- **(B)** Leave `Cowork/` in place as deprecated; allowlist via v0.29.x audit-allowlist mechanism if it ships first. Risky — divergence opportunity.
- **(C)** Symlink `Cowork/ -> spice/cowork/` to support cron orchestrators that haven't been updated yet. Bridging — tear out after cron migration done.

Recommend (A) post-migration; do migration in single-stage to minimize divergence window.

### Q6 — Active-threads frontmatter formalization

`active-threads.md` currently has user-defined H3 schema (kebab-id, type, created, target, status, last-surfaced, context). The vault-guide describes it inline. Should we formalize as:

- **(A)** Frontmatter-validated rule_fragment per S4 design above. Consistent with sauce blueprint patterns.
- **(B)** Custom JSON schema at `ranch/cowork/threads-schema.json` parsed by a NEW dataviewjs view — lets the threads list render as cards/tables per blueprint convention.

Recommend (A) for v0.30.0 + (B) as a v0.30.x extension if the user wants threads to render as a sauce hub-cards-style view.

### Q7 — Daily-note callout coordination

The cowork prompts INSERT collapsed callouts into daily notes. The daily blueprint ships a daily-note auto-creation template. They need to coordinate the anchor:

- Daily template currently has a `## Notes` section as the anchor (per vault-guide auto-creation rules).
- Cowork prompts insert callouts BEFORE `## Notes` (morning/eod/finance) and AFTER `## Notes` (Open Threads).
- Question: should the daily blueprint ship a hidden "callout zone" comment-marker (e.g., `<!-- COWORK_CALLOUTS -->`) so cowork prompts can target it deterministically instead of relying on `## Notes` heading parsing?

Recommend brainstorm — small but worth resolving before S3.

### Q8 — Finance/ path defer vs handle in-cycle

Cowork prompts reference `Finance/Debt/Credit Debt Payoff Tracker.md`, `Finance/YYYY-MM/YYYY-MM-Invoice.md`, `Finance/Budgets/Budget, YYYY-MM.md`. These STILL RESOLVE because `Finance/` is preserved untracked. Three options:

- **(A)** Leave Finance/ paths AS-IS in cowork prompts; document as v0.30.x finance-migrator coordination. Cleanest scope.
- **(B)** Bundle finance-migrator into v0.30.0 cycle (large scope expansion). User judgment.
- **(C)** Move JUST the cowork-referenced finance files (debt tracker + invoice + budgets) to `spice/finance/` ad-hoc, deferring the rest. Risky — half-migration.

Recommend (A) — defer finance-migrator to v0.30.x as separate cycle. Cowork@0.1.0 prompts continue referencing `Finance/` paths; finance-migrator cycle later updates the prompts (small sweep).

### Q9 — barebones rollout

barebones is the workshop's primary regression target. Cowork@0.1.0 install on barebones should produce a clean `spice/cowork/` with shipped templates + empty-but-valid context files + the 8 prompt orchestrators (or 9 with ero-monthly per Q11) — but with no scheduled jobs (barebones isn't cron-targeted). barebones is the "what does fresh cowork look like out-of-the-box" reference.

Question: should barebones get cowork-life-only, cowork-ero-only, or cowork-all (per Q3 sub-blueprint decision)?

Recommend cowork-all on barebones for completeness; consumer vaults declare scope subscription.

### Q10 — Subskill-to-MCP-tool dispatch

Many subskills are direct wrappers around MCP tools (gcal_list_events, gmail_search_messages, copilot money calls, obsidian MCP file ops). The skill body's job is mostly to "call this MCP tool with these args + return shape." Question: is there value in making the skill body THIN ("call X, return Y") vs FAT ("call X, parse Y, classify Z, format W") for orchestrator simplicity?

Recommend FAT skills — the orchestrator should never see raw MCP tool returns; the skill is responsible for normalizing. Reduces orchestrator surface.

### Q11 — Add ero-monthly job in this cycle?

User said: "If you want a deeper month-close on the work side, that's a clean add — mirror life-monthly's shape." Two options:

- **(A)** Bundle `prompt-ero-monthly.md` + `cowork:write-summary-monthly-ero` skill + ero-monthly cron orchestrator into v0.30.0. ~10% scope expansion; same context-file deps; clean parallel to life-monthly.
- **(B)** Ship ero-monthly as a v0.30.x patch after cowork@0.1.0 lands. Lower risk; faster v0.30.0 close.

Recommend (A) — the cycle's already paying the integration cost; one more prompt + one more skill is cheap.

---

## §6 — Cycle stages (post-brainstorming sketch)

Refine in `superpowers:writing-plans` after Q1-Q11 resolved. Tentative shape:

| Stage | Scope | Sub-skill | Tests | Commit |
|---|---|---|---|---|
| **S0** | Brainstorm Q1-Q11 → design doc | `superpowers:brainstorming` | (none) | docs commit |
| **S1** | Workshop blueprint scaffolding: `platform/blueprints/cowork/{manifest.json,templates/,content/,helpers/?}`, `platform/manifest.json` catalogue, +N rule_fragments, harness updates | `superpowers:executing-plans` | run-helper-cases (templates-no-trailing-whitespace, manifest-shape), run-cli (subscription validation), run-audit (rule_fragment fixture) | feat(cowork): S1 — blueprint scaffolding |
| **S2** | Subskill framework: subskill template + ~25-30 skill bodies + installer materialization (whichever location resolves Q1) | `superpowers:executing-plans` | run-helper-cases (skill-template), run-install-sh if `.claude/skills/` allowlisted | feat(cowork): S2 — subskill catalogue |
| **S3** | Prompt orchestrators: rewrite all 8 (or 9 w/ Q11) prompts as thin orchestrators referencing subskills + sweep all cited paths to sauce-shape | `superpowers:executing-plans` | manual smoke-trace per orchestrator | feat(cowork): S3 — prompt orchestrators |
| **S4** | Cowork.md hub + obsidian-vault-guide.md rewrite + per-vault context templates + active-threads schema rule_fragment | `superpowers:executing-plans` | run-audit (rule_fragments populate violations correctly) | feat(cowork): S4 — hub + vault-guide + threads |
| **S5** | 3-vault rollout: install cowork@0.1.0 to barebones (regression), then ero-sauce, then headspace-sauce. Migrate `Cowork/{context,prompts}/` content to `spice/cowork/{context,prompts}/` per Q3 scope subscription. Hand-script reuses workshop `rewriteString()` per accuris/headspace/ero session-1 precedent. Run audit on each vault: ZERO new violations expected post-install. | `superpowers:executing-plans` | manual: install-then-audit per vault | feat(cowork): S5 — 3-vault rollout |
| **S6** | Cycle close: result + handoff + tag + documentation. Cron-orchestrator update notes per Q4. | (none) | full-suite green | docs(v0.30.0): cycle close |

Per-stage commit + push. Tag `v0.30.0` at S6 close (USER APPROVAL).

---

## Constraints carried forward

- **Workshop dogfoods every release** (CLAUDE.md non-negotiable). Cowork install on workshop's self-vault must succeed BEFORE rollout to consumer vaults.
- **No personal content in workshop** (CLAUDE.md non-negotiable). Templates must be content-free with `{{template_variables}}`; NO real names, finance data, etc.
- **Module-directory invariant** (landmine #11). All cowork content under `spice/cowork/` only. No new top-level dirs.
- **Sanctioned new top-level vault dirs UNCHANGED** — `spice/`, `pantry/`, `ranch/`. If Q1 = (A) `.claude/skills/` allowlist expansion lands, that's expanding landmine #12 paths (currently 13), NOT adding a new top-level dir.
- **JSON-not-YAML** (CLAUDE.md non-negotiable). Manifest schema, rule_fragments, etc. — JSON only.
- **Lowercase platform-managed dirs** (landmine #19). `spice/cowork/` lowercase. `cowork:check-vault-routing` skill ID lowercase-with-colons. Subskill filenames kebab-case.
- **Stub md5 invariant** (`ea23aa812503bfca66359d3b2b239ba8`) — must be UNCHANGED through this cycle. Don't touch `platform/installer-stub.js`.
- **Source vaults read-only** (landmine #20) — legacy ero `/Users/willfellhoelter/notes/ero-sync/ero` + headspace `/Users/willfellhoelter/notes/headspace` are read-only; never write.
- **Audit verb read-only** (landmine #21) — `sauce audit` is detection-only.
- **No force-push, no Claude attribution, no --no-verify** (CLAUDE.md git workflow).
- **Per-stage commit at S close** (CLAUDE.md git workflow). USER APPROVAL gate at workshop_version bump (S6 close) and tag.

---

## Cross-cutting carries surfaced this session prep

### v0.29.1 candidates (smaller patches that could batch before v0.30.0 close)

- **LEGACY_PATH_SUBSTITUTIONS — `Projects/<TitleCase>/` rule** (ero session 1). Pre-migration ero stored projects at root-level `Projects/<TitleCase>/`, not in `boards/planning/<kebab>/`. Migrator rewrite-table missed these.
- **LEGACY_PATH_SUBSTITUTIONS — `Resources/Views/`, `Resources/Templates/`, `Resources/Scripts/`, headspace `boards/side-quests/`, no-trailing-slash variants** (headspace session 1 + b22c390 + ero session 1) — already shipped in `b22c390`. Verify no further extensions needed.
- **CustomJS class-name rename table** (headspace Phase 6 — `TripsBoard` → `TripsHubCards`, `TripJournalActions` → `TripSectionsCards`). Per-blueprint `class_renames` map, applied during `rewrite_blueprint` migrator entries.
- **Migrator frontmatter scalar-path rewrite** (headspace Phase 10 — 26 to-do cards with stale `source_board: <legacy-path>`). Migrator rewriteString() doesn't touch frontmatter scalar-shaped path values.
- **`sauce audit` exit code** — currently exits 0 even when untracked dirs > 0. Spec says exit 1 when violations OR untracked > 0.
- **Title Case vs kebab-case slug coexistence in `spice/projects/`** (ero session 1) — design discussion item; v0.30.x carry.

### v0.30.x candidates (bigger items, separate cycles)

- **Finance-migrator** (CLAUDE.md carry) — needs to land before cowork prompt finance-path sweep can complete. Per Q8, defer cowork-Finance-path coordination to that cycle.
- **`audit-allowlist.json` mechanism** (per-vault accepted-residue for the 4-7 untracked dirs each vault has post-rollup).
- **`sauce migrate-orphans` verb** (3-vault precedent for `require()`-ing `platform/migrate/wikilink-rewrite.js` from one-off cleanup scripts; productize the pattern).

### v0.31.0+ candidates

- **Cron orchestrators in vault** (Q4 option C) — move `/sessions/.../mnt/.scheduled/<job>/SKILL.md` to `<vault>/ranch/scheduled/<job>/SKILL.md`.
- **Threads as a sauce blueprint** (Q6 option B + standalone) — `threads@0.1.0` with hub note + cards rendering. Currently cowork-internal state.
- **Per-scope sub-blueprints** (Q3 option C) — `cowork-life@0.1.0` + `cowork-ero@0.1.0` + `cowork-shared@0.1.0`. Currently single cowork@0.1.0.
- **Journal-migrator + meetings-hub source-shape audit + full Sauce-shape project ecosystem** (existing CLAUDE.md v0.30.0 plan — DEFER to v0.31.0+ since this cycle uses the v0.30.0 slot).

---

## End-of-session checklist (cycle close — applies to S6 only)

Before closing the cycle, confirm:

- [ ] `Docs/plans/2026-05-09-v0.30.0-cowork-blueprint-design.md` written (S0 output)
- [ ] `Docs/plans/2026-05-09-v0.30.0-cowork-blueprint-plan.md` written (post-S0; S1-S6 breakdown)
- [ ] `Docs/plans/2026-05-09-v0.30.0-cowork-blueprint-result.md` written (S6 cycle close)
- [ ] `CLAUDE.md` Status (live) updated — workshop_version 0.29.0 → 0.30.0, blueprint count 9 → 10 (cowork@0.1.0 added), landmines list updated if Q1 expanded the allowlist
- [ ] `Docs/install.md` Upgrading-from-v0.29.0 section
- [ ] `Docs/landmines.md` history block update (#12 if Q1 added `.claude/skills/`; consider new landmine for cowork-specific gotchas)
- [ ] `Docs/prompts/2026-05-09-post-v0.30.0-next-cycle-handoff.md` (the NEXT cycle's onboarding doc — see SESSION-START.md)
- [ ] All 7 harnesses GREEN with NEW sub-asserts for cowork (target +N per stage)
- [ ] Audit on all 4 vaults (workshop + 3 consumers) — ZERO new violations from cowork install
- [ ] `Cowork/` legacy dir removed in ero + headspace (per Q5 resolution)
- [ ] Snapshot retained at each consumer's `<vault>.pre-cowork-<YYYYMMDD-HHmmss>/` BEFORE migration
- [ ] Cron-orchestrator update (Q4) — documented in result doc as a manual user step OR completed
- [ ] Tag `v0.30.0` at HEAD (USER APPROVAL gate)

---

## Slash command for the next session

When ready to start, paste this into a fresh Claude session:

> Read `Docs/prompts/SESSION-START.md` for canonical session-start, then `Docs/prompts/2026-05-09-cowork-blueprint-handoff.md` (this file) for cycle-specific carry. Begin v0.30.0 cowork blueprint cycle: invoke `superpowers:brainstorming` first to resolve the 11 open design questions in §5 of the handoff (subskill discovery + materialization, format, per-vault customization, cron-orchestrator coordination, legacy-dir disposition, threads schema, daily-note callout coordination, Finance/ defer, barebones rollout, subskill-to-MCP-dispatch, ero-monthly bundling). Output the design doc at `Docs/plans/2026-05-09-v0.30.0-cowork-blueprint-design.md`. Surface workshop changes to user before applying.

## Stop conditions

STOP and ask the user before:

- Expanding landmine #12 allowlist (if Q1 = A, adding `.claude/skills/`).
- Adding a NEW top-level vault dir (if Q4 = C, moving cron orchestrators in-vault).
- Bumping workshop_version 0.29.0 → 0.30.0 at S6 close.
- Tagging `v0.30.0` (annotated tag at HEAD requires explicit approval per CLAUDE.md).
- Force-pushing or rewriting history on `origin/main`.
- Deleting `Cowork/` content in any consumer vault BEFORE the migration is verified to have moved everything to `spice/cowork/` (Q5 resolution must explicitly approve `rm -rf` step).
- Touching anything in `.obsidian/` outside the 13-path allowlist.
- Modifying out-of-vault cron orchestrator SKILL.md files (Q4 — that's user-managed infrastructure).

---

## Lessons carried from session-1 rollup work (3 vaults × 1 session each)

- **Always snapshot first.** All three session-1 cleanups used `cp -R <vault> <vault>.pre-cleanup-<ts>/`. Cheap insurance.
- **Reuse workshop `rewriteString()` from one-off scripts.** All 3 vaults' Phase 5 (Timestamps cleanup) `require()`-ed `platform/migrate/wikilink-rewrite.js` directly. Pattern generalizes to any vault-cleanup script that needs LEGACY_PATH_SUBSTITUTIONS. Apply the same pattern in S5 cowork migration.
- **In-vault `ranch/` byte-equivalence patches** (headspace Phase 9 + ero Phase 3 project schema migration) — when shipping a workshop blueprint update, hand-patch the in-vault `ranch/scripts/<bp>/*` + `ranch/templates/Template, *.md` to byte-match the new workshop spec, so `sauce update` is no-op-effectively. Apply to cowork's S5 rollout.
- **Defer aggressively when in doubt** — user-owned content (Cowork, Docs, MOCs, Resources, Files, Finance, Extras) is appropriate "explicitly accepted residue" until v0.30.x audit-allowlist mechanism. Don't try to force into spice/ blueprints unless it cleanly maps.
- **Atlas/board/section file rename + `name:` field + canonical schema migration is now a known recipe** (trips@0.1.7 + project@1.3.8 precedent). If cowork has analogous filename/schema split surface during S1 design, the playbook is: shipped canonical filename + display `name:` field + `p.name || p.file.name` fallback in any helper that uses `.file.name` for titles.
- **Per-stage commit + push discipline** — mid-cycle commits with clear stage tags (`feat(cowork): v0.30.0 S2 — ...`) make in-flight handoffs cheap if a session ends mid-cycle.
- **Brainstorm before plan-writing for first-of-its-kind blueprints** — the plan can't be written until subskill location/format and cron-orchestrator coordination are decided. Don't skip S0.

---

> [!example]+ Why this is a v0.30.0 candidate (not v0.29.x patch)
> v0.29.x has been used heavily for in-cycle re-process bumps + small patches (per landmine #16). Cowork ships a NEW blueprint (cowork@0.1.0), expanding the catalogue from 9 → 10 — that's MINOR per semver + per the people@0.1.0 v0.27.0 NEW-blueprint precedent. Plus a NEW subskill pattern is a substantive cross-cutting addition; warrants the MINOR slot. The existing CLAUDE.md v0.30.0 plan (journal-migrator + meetings-hub audit + full project ecosystem) defers to v0.31.0+ — if the user prefers to keep the original v0.30.0 plan in slot, this cycle can run as v0.30.x or v0.30.0 + v0.31.0 swap; brainstorm Q-meta if needed.
