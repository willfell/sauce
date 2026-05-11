---
purpose: Brainstorm-session handoff. Refactor cowork:bootstrap-vault from a hard-coded life/ero interview into a dynamic, blueprint-schema-introspecting orchestrator that produces output aligned with whichever blueprints are installed — and that the user ALWAYS runs first when adopting any new Sauce-shape vault.
canonical: no
cycle: v0.31.0
slot: brainstorm-session-2 (bootstrap-vault dynamic refactor)
machine_note: paths assume `/Users/willfell/Documents/obsidian/sync/workshop/sauce` on this machine
related:
  - Docs/prompts/SESSION-START.md
  - Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md (draft surfaced today; resolves vault_scope binary)
  - Docs/plans/2026-05-10-v0.30.0-cowork-blueprint-design.md (locked design; v0.30.0 shipped 2026-05-10)
  - Docs/plans/2026-05-10-v0.30.0-cowork-blueprint-result.md (TBD — v0.30.0 S6 cycle close still pending)
---

# v0.31.0 — brainstorm session #2: bootstrap-vault dynamic refactor

> [!abstract] Where we are
> v0.30.0 cowork blueprint shipped 2026-05-10. accuris-tonight rollout (Goal A.2 of post-S4 handoff) paused 2026-05-11 mid-interview when the user surfaced a schema leak: cowork@0.1.0's `vault_scope: life | work | both | none-yet` axis hard-codes ero-consultant terminology, doesn't fit a W2-FTE engagement at Accuris, and forces a one-dimensional shape onto vaults that are inherently multi-archetype.
>
> A first draft addressed this with an `engagements: [{id, type, ...}]` schema (`Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md`, status: design-draft, 10 open Qs in §6). This session takes it further: refactor `cowork:bootstrap-vault` so it is DYNAMIC against the installed blueprints — not hard-coded against cowork — and becomes the canonical foundation a user always runs first when adopting any Sauce-shape vault.

---

## 0. Pre-flight (always)

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/sauce
git fetch origin && git status
git log --oneline -10
for h in run-bootstrap run-cli run-install-sh run-helper-cases run-migrate run-audit; do echo "--- $h ---"; node platform/test/$h.js 2>&1 | tail -2; done
node platform/test/run-renderer.js 2>&1 | tail -1
```

Expect clean tree on `main`, latest commit `docs(plans): v0.31.0 cowork engagement-model design draft` (or whatever the next push is), all 7 harnesses GREEN (58/58/14/439/104/41 + renderer pass).

Read in this order before brainstorming:
1. `Docs/prompts/SESSION-START.md`
2. `Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md` (the design draft this session refines)
3. `Docs/plans/2026-05-10-v0.30.0-cowork-blueprint-design.md` §3 (skill catalogue + manifest schema + rule_fragments — the dispatch shape this brainstorm must preserve)
4. `platform/blueprints/cowork/skills/orchestrators/bootstrap-vault/SKILL.md` (the current 102-line implementation)
5. `platform/blueprints/<blueprint>/manifest.json` for each of the 10 installed blueprints — observe the `rule_fragments[]`, `nav_buttons[]`, `files[]` shape (these are the schema sources the refactored bootstrap-vault must introspect)
6. `CLAUDE.md` (live state pointers + non-negotiables)

---

## Goal — what this brainstorm produces

A locked design for **cowork:bootstrap-vault v2** (ships in v0.31.0 S2) that satisfies these properties:

1. **Dynamic against installed blueprints.** Bootstrap-vault reads `<vault>/ranch/platform-installed.json` to enumerate which blueprints are present. For each present blueprint, it reads that blueprint's `manifest.json` (`rule_fragments[]`, schema-relevant fields, declared cadences if any) to learn what questions to ask and what context files to materialize. No hard-coded "ask for ero_hourly_rate" — that field comes from the consulting engagement type's manifest, and only fires if the user adds a consulting engagement.
2. **Engagement-list aware** (per the v0.31.0 draft §2-3): the interview produces `engagements[]` in `<vault>/spice/cowork/context/vault-config.md`, not a `vault_scope` string.
3. **Always-first foundation.** Bootstrap-vault is the user's canonical entry point for any Sauce-shape vault — barebones, accuris-sauce, ero-sauce, headspace-sauce, future-vault-N. CLAUDE.md (workshop + each consumer) directs both human readers AND Claude sessions to invoke it first. After bootstrap, every subsequent flow (manual nav-button click in Obsidian, natural-language ask to Claude, scheduled cron tick) operates against the engagement-aware vault state.
4. **Obsidian-manual ↔ Claude-natural-language parity.** A user clicking the "Daily" nav-button in Obsidian and a user asking Claude "give me today's morning briefing for Accuris" must produce the same output. The bootstrap-vault output (engagements[], context dirs, rule-fragment-validated state files) is the shared substrate.
5. **Schedule/job alignment.** The cron orchestrators (out-of-vault `.scheduled/<job>/SKILL.md` or future in-vault `<vault>/ranch/scheduled/...`) read the engagements[] + cadences and dispatch one orchestrator-invocation per (engagement × cadence). Bootstrap-vault emits the exact SKILL.md body to paste for each enabled (engagement, cadence) pair.
6. **Rule-fragment validated.** The vault-config.md schema is enforced by a cowork rule_fragment so `sauce audit` catches drift. Per-engagement context dirs are also audited.
7. **Consistent natural-language router contract.** When the user asks Claude in natural language ("morning briefing for Accuris", "what's open this week on the Acme retainer", "find the EOD report from last Friday"), Claude resolves the request via the engagement-aware orchestrator/sub-skill catalogue. The CLAUDE.md routing rules + orchestrator skills + rule_fragments + sub-skills compose into one mechanism.

---

## Topics for the brainstorm (work in this order)

### Topic 1 — "Always-first" mechanic

> Bootstrap-vault becomes the canonical entry point. How does that get enforced?

Sub-questions:
- Where is the "always run bootstrap-vault first" instruction surfaced? Candidates: (a) consumer's `CLAUDE.md` template adds a top-line directive, (b) `Cowork.md` hub note has a `[!warning] Run cowork:bootstrap-vault first` callout that auto-deletes once vault-config.md exists, (c) the installer's post-install Notice block names it explicitly, (d) all three.
- Is there a "vault is not bootstrapped" detection state (e.g., absence of vault-config.md frontmatter)? Should orchestrators refuse to run if vault is not bootstrapped — and surface a Notice pointing back to bootstrap-vault?
- Does bootstrap-vault re-run safely? (Re-bootstrap = additive merge or full replace?)

### Topic 2 — Dynamic blueprint introspection

> Bootstrap-vault reads installed blueprints' manifests at runtime. What does it actually read?

Sub-questions:
- Does every blueprint declare a `bootstrap_contributions` array in its `manifest.json` that bootstrap-vault consumes? Shape: `[{ kind: "question" | "context_file" | "engagement_field", ... }]`. This makes blueprints first-class contributors to the bootstrap flow, not just install-time recipients.
- Or: does bootstrap-vault only contribute its OWN questions (engagement-list), and each blueprint contributes via a separate hook (e.g., a sub-skill like `cowork:gather-<blueprint>-bootstrap-context`)?
- Per-blueprint cadence declaration: should `daily@0.2.5` manifest declare it owns the "daily-note" cadence, so bootstrap-vault auto-detects daily as available and asks engagement-by-engagement whether to surface it?
- For blueprints with no bootstrap relevance (e.g., `styling`), what's the no-op signal?

### Topic 3 — Engagement-type registry as schema-driven

> v0.31.0 draft §3.3 defines per-type manifests. Push further: does the engagement-type registry compose with the blueprint-bootstrap-contributions registry?

Sub-questions:
- A `personal` engagement composes with `daily` + `finance` + `journal` + `to-do`. A `w2-fte` engagement composes with `daily` + `meetings` + `project` + `to-do` + `people`. A `consulting` engagement composes with all of the above plus `finance` (invoicing). Where does this composition rule live — in the engagement-type manifest, or computed from the engagement's `render_aspects` + each blueprint's `bootstrap_contributions`?
- Can a user define a custom engagement type in their own vault (`<vault>/spice/cowork/engagement-types/<type>.json`)? Or must types ship via the platform?
- How does the engagement-type registry version? (Adding a required field to `w2-fte.json` is breaking for existing engagements.)

### Topic 4 — Obsidian-manual ↔ Claude-natural-language parity

> Two surfaces. One vault state. How do they stay symmetric?

Sub-questions:
- The nav-buttons mechanism renders templated buttons in Obsidian (`runTemplaterTemplate`, `openLink`, `invoke_command` actions). Should bootstrap-vault emit per-engagement nav-buttons on the Cowork.md hub (one row per engagement, columns = cadences) so manual invocation matches scheduled invocation?
- When a user asks Claude in natural language, what's the entry point? Candidates: (a) a `cowork:router` orchestrator that parses the ask and dispatches, (b) Claude Code's existing skill-name pattern matching against the cowork skill catalogue, (c) a CLAUDE.md routing table that maps phrasings to skills.
- Does the engagement label appear in natural-language asks? "Run my morning briefing for Accuris" vs "morning briefing for the Acme retainer" — should the router require an explicit engagement, or default to "all engagements with cadences.morning enabled"?
- Templater templates (manual Obsidian) vs sub-skill outputs (Claude) — do they share a rendering layer, or are they two parallel implementations?

### Topic 5 — Schedule/job model

> Per-engagement-per-cadence cron jobs. What's the canonical form?

Sub-questions:
- Out-of-vault scheduler (current) vs in-vault `<vault>/ranch/scheduled/<engagement>-<cadence>/` (v0.31.0 forecast). When does the migration land?
- Does bootstrap-vault auto-generate `<vault>/ranch/scheduled/<engagement>-<cadence>/SKILL.md` for each enabled pair (in-vault scheduler), even before the cron infrastructure picks them up?
- Job naming convention: `accuris-morning`, `accuris-eod`, `acme-consulting-monthly`, `personal-morning`?
- What does the bootstrap-report's Section 3 look like under engagement-aware scheduling? A table per engagement?

### Topic 6 — Rule-fragment posture for the new schema

> vault-config.md is the canonical engagement record. What does the rule_fragment look like?

Sub-questions:
- Required frontmatter: `type: cowork-vault-config`, `updated`, `updated_by`, `engagements` (array, min 1 if not exploring-mode).
- Per-engagement validation: each engagement must have `id` (lowercase-hyphens) + `type` (must match a registered engagement-type) + the engagement-type's `required_fields`. Where does cross-reference validation live — in `validate.js` (mechanism) or per-rule-fragment predicate (additive predicate handler)?
- Per-engagement context dir presence: `<vault>/spice/cowork/context/<engagement-id>/` must exist with the engagement-type's expected file set. Audit-mode rule_fragment.

### Topic 7 — Migration from v0.30.0 (carry from v0.31.0 §4)

> accuris-sauce has cowork@0.1.0 installed but never bootstrapped. Other vaults haven't seen cowork yet. How does the new bootstrap-vault handle each starting state?

Sub-questions:
- Fresh vault: standard interview.
- v0.30.0-installed-but-not-bootstrapped (accuris-sauce today): standard interview — no migration needed.
- v0.30.0-installed-AND-bootstrapped (forecast-only, no live cases): in-place promotion per draft §4. Resolve whether the in-place migrator ships in v0.31.0 or is deferred.
- Re-bootstrap after engagement-list mutates (user adds a new engagement, drops one): additive merge vs full replace. Probably additive merge for additions; explicit user confirm for drops.

### Topic 8 — Output shape (the bootstrap-report)

> What does the report look like under engagement-aware bootstrap?

Sub-questions:
- Per-engagement section (replaces v0.30.0's flat Section 2 "What you told me").
- Per-engagement-per-cadence cron job block (Section 3).
- "Unresolved fields" section keyed by engagement-id (Section 5).
- Audit-pass receipt (NEW — show the rule_fragment assertions that pass post-bootstrap).
- Manual-Obsidian readme block: "Open `Cowork.md` to see the engagement table. Click the nav-button for any engagement-cadence pair to invoke manually." Mirrors the cron section.

### Topic 9 — Naming/vocabulary cleanup

> "ero", "life", "work" appear in 11+ sub-skill IDs, 38 SKILL.md bodies, scope-template dir names, manifest fields. What renames are required?

Sub-questions:
- `ero-*` orchestrator names retire (per v0.31.0 draft §3.1 collapse 9 → 5).
- Sub-skill IDs `write-callout-*-life` / `write-callout-*-ero` collapse to single sub-skill per callout-purpose with internal type-branching.
- Template-var renames: `{{ero_owner_name}}` → `{{engagement.<id>.owner_name}}` or per-engagement substitution map (decide).
- Context-template dir rename: `{life,ero,shared}-context-templates/` → `engagement-templates/<type>/` (draft §3.4).
- Are there user-facing strings in `Cowork.md` hub or rule_fragments that need updating?

### Topic 10 — Open from v0.31.0 draft §6

Run through draft Q1-Q10. Some may close after Topics 1-9; some may need a separate sub-pass.

---

## Out of scope for THIS session

- Implementing any of the above (this is design, not S1).
- Touching `cowork@0.1.0` source files in the workshop.
- Re-running `bootstrap-vault` against any consumer.
- v0.30.0 S6 cycle close — that's a separate task; decide at the end of this brainstorm whether to close v0.30.0 standalone (ship the artifact + tag without the rollout) or fold into v0.31.0's close.
- v0.32+ forecast (sauce as Claude Code plugin) — referenced but not designed here.

---

## Deliverable

By end of this session:

1. **`Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md` promoted** from `status: design-draft` to `status: design-locked`. Body updated to incorporate Topic 1-10 resolutions. §6 open questions answered or explicitly carried to v0.31.x.
2. **Optional companion doc** `Docs/plans/2026-05-11-v0.31.0-bootstrap-vault-skill-spec.md` if the bootstrap-vault SKILL.md body needs its own detailed spec separate from the engagement-model doc (likely YES — bootstrap-vault is ~150-200 lines of orchestration logic when dynamic-blueprint-introspection lands).
3. **`Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-plan.md`** (NEW) — implementation plan with S1-S7 stage breakdown, harness deltas, USER APPROVAL gates, smoke fixtures.
4. **CLAUDE.md `## Status` table next-TBD pointer** updated to v0.31.0 with the next-cycle handoff doc referenced.
5. **Single cycle-prep commit** `docs(plans): v0.31.0 cowork engagement-model — design locked + plan + next-cycle handoff`.

---

## Slash command for the next chat

```
Read Docs/prompts/SESSION-START.md then Docs/prompts/2026-05-11-cowork-bootstrap-vault-dynamic-refactor-brainstorm.md. Run brainstorm session #2: refactor cowork:bootstrap-vault into a dynamic, blueprint-schema-introspecting orchestrator that becomes the canonical "always run first" entry point for any Sauce-shape vault. Work through Topics 1-10 in order, surfacing decisions as you go. Use AskUserQuestion or plain-text questions per the user's preference. At end of session, promote the v0.31.0 design doc from draft to locked, write the v0.31.0 implementation plan, and prepare the cycle-prep commit. v0.30.0 S6 cycle close decision (close standalone vs fold into v0.31.0) is the final question. STOP before any workshop_version bump or tag.
```

---

## Stop conditions

STOP and ask the user before:

- Bumping `cowork` blueprint version 0.1.0 → 0.2.0 in workshop manifest.
- Bumping workshop_version 0.29.0 → anything.
- Tagging anything.
- Touching `platform/blueprints/cowork/skills/orchestrators/bootstrap-vault/SKILL.md` (this is design — implementation lives in v0.31.0 S2).
- Modifying any consumer vault's state (no re-bootstrap, no `sauce update`).
- Force-pushing or rewriting history on `origin/main`.

Done.
