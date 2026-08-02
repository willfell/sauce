# loop:block-review + dependency-hygiene rails — design

**Date:** 2026-08-02
**Status:** approved (brainstorming), pending spec review
**Worktree:** `loop-block-review-dep-hygiene`

## Problem

The delivery board carries **silent dangling-dependency debt**: slice cards whose
`depends_on` names a card that does not exist on the board. An initial sweep of the
sauce board found **48 dangling deps across 10 epics**. Whole epics
(Row Actions and Entity Management, Vault Doctor) hang off foundation cards that were
never minted, so they can never become claimable — yet the coordinator reports them as
merely `blocked_by_dependencies`, indistinguishable from "queued behind the frontier."

Danglers are born two ways:

1. **Supersession rename** — a card `X` is superseded by `X2`, but existing dependents
   keep `depends_on: X`. (e.g. `GA-R1a → GA-R1a2`, all `CSS-* → CSS-1` now `CSS-1b`.)
2. **Never-minted foundation** — intake mints a slice whose `depends_on` references a
   foundation card (`GA-M1`, `GA-I1`, `GA-C1/C3`, …) that was never created.

The coordinator's status meters (`frozen`/`waiting`/`parked`) and the frontier-first
`next` walk **do not traverse `depends_on` to check target existence**, so this debt is
invisible to `/loop:status` and `/loop:review`. The GraphView Blocking Lens
(`GraphInsights`, GV-R1) *does* traverse it and is the honest signal.

### Root cause of the mis-diagnosis (why the meters lie here)

`depends_on` lives in **slice frontmatter**; In-Planning slices are **untracked** by the
coordinator. No existing coordinator verb (`amend-contract`, `amend-park`, `reconcile`)
touches an untracked slice's `depends_on`. So there is currently **no sanctioned path**
to repair a dangling dependency, and nothing that detects one at the status layer.

## Goals

- **Repair:** a sanctioned mechanism to clear/re-point dangling deps, unblocking epics
  so the executor moves them back to In Progress and continues.
- **Prevent:** close both birth vectors at the source (mint-time + supersede-time).
- **Surface:** a `loop:block-review` skill that diagnoses, auto-fixes the provable
  cases, and escalates the judgment cases — for both the sauce board and the
  ero-egnyte-mcp board.
- **Distribute:** ship via the plugin (Claude) and brew (Codex/coordinator).

## Non-goals

- Reinventing dependency parsing/detection (reuse `GraphInsights`).
- Auto-minting foundation cards without a human decision.
- Changing how the coordinator claims/parks/deploys work.

## Design

### A. Detection — reuse `GraphInsights` (no bespoke parser)

The verb and skill call the **existing** canonical gather shipped by BL-1
("GraphInsights pure blocking analysis core") and GV-R1 ("honest gather filters archived
slices and stubs cross-epic danglings"). It normalizes every `depends_on` form
(`"[[Card]]"`, bare name, bracketed), filters archived/terminal cards, and reports
danglers + root-blockers + blast-radius. One source of truth, shared with the GraphView
lens. *(A throwaway scanner during design mis-parsed quoted wikilinks and inflated the
ero count — precisely the failure this reuse avoids.)*

### B. `reconcile-dependencies` — new coordinator verb (the only new writer)

Amend-park discipline, operating on In-Planning slice `depends_on` frontmatter.

- **Actions:** `clear` (remove a satisfied dep) · `repoint` (rewrite dead name →
  canonical/superseder).
- **Provable-only classification (verb-enforced):**
  - superseder is `deployed`/`discarded` → **clear**
  - superseder is pending/planned → **repoint** to it
  - target completed/archived on the board → **clear**
  - never-minted / ambiguous → **refuse** with `needs-decision` (escalation)
- **Safety:**
  - dry-run plan by default; `--apply` to execute
  - compare-and-swap on a board-state signature (concurrent edit → abort)
  - appends an audit record per change (from→to, reason, fate) to a reconciliation log
  - refuses tracked/parked/in-progress cards (those keep `amend-park`/`amend-contract`)
  - **never mints, never discards** — pure dependency-metadata repair
- **CLI shape (draft):**
  `node <coordinator> reconcile-dependencies [--card "<exact>"] [--all] --expected-signature <sig> --reason "<audit>" [--apply] --json`

### C. Prevention guards (card-intake)

1. **Mint-time guard (hard-refuse + external marker):** intake refuses to mint a slice
   whose `depends_on` names a card that does not exist. Within-the-same-batch sibling
   forward-refs resolve as legitimate. An explicit `external:` / terminal marker is the
   only escape hatch for legitimately off-board deps.
2. **Supersede-time auto-repoint:** when intake mints `supersedes: X`, it rewrites every
   existing dependent's `depends_on: X` → the new card name (or clears if the new card is
   already terminal). This directly kills the supersession-rename birth vector.

### D. `loop:block-review` skill (orchestrator)

Review-family, authorized to *drive* the verb (writer authority stays in the coordinator,
exactly as loop:run drives claim/park/resume).

1. Bind via `loop-config resolve` (refusal → `/loop:init`).
2. Gather via `GraphInsights` → dangling inventory + fate + root-blocker/blast-radius.
3. **Auto-fix provable:** drive `reconcile-dependencies --apply`; quote each receipt.
4. **Escalate judgment (one at a time, recommendation first):** never-minted +
   ambiguous danglers → mint the missing foundation via `/loop:intake` **or**
   confirm-clear. Never-minted foundation cards are decided **interactively per item**.
5. **Recompute + unblock:** trigger the coordinator's `reconcile` so any epic now fully
   resolvable flips `blocked_by_dependencies` → claimable and moves lane through the
   sanctioned writer (no hand-edited columns). Report which epics unblocked.
6. Never mints/discards/edits frontmatter itself.

### E. Rollout (this worktree)

1. Implement B, C, D + harnesses.
2. **Sauce board:** run block-review → auto-clear/repoint provable danglers; escalate
   each never-minted foundation for a mint-or-clear decision.
3. **Ero board:** supervised `observe_only` lift → block-review pass → provable repairs
   through the verb (full receipts) → restore `observe_only`. Ero's real danglers are
   mostly the supersession class (`EM-E1 → EM-E1a`).
4. **Plugin:** add `plugins/loop/skills/block-review/SKILL.md`; regenerate Codex routers
   (`gen-codex-routers.js`); update `Docs/agent-guides/loop-plugin.md` + skill-surface
   table + the `CLAUDE.md` router table.
5. **Release:** conventional commits → automatic pipeline bumps version + publishes brew
   → `brew upgrade` gives Codex the new verb + routers; `/plugin marketplace update`
   gives Claude the new skill.
6. **Verify:** `release:preflight` harnesses green; re-run block-review → zero provable
   danglers remain on either board.

### F. Testing

- `reconcile-dependencies` harness: clear / repoint / refuse-never-minted / CAS-abort /
  audit-record.
- mint-time guard harness: refuse dangling mint · allow within-batch forward-ref · allow
  external marker.
- supersede auto-repoint harness: dependents re-homed on supersession mint.
- Codex router `--check` byte-determinism gate (new skill's router).
- `test:loop-plugin-surface` updated for the new skill.
- Seed-vault regression if the guards touch the migration harness surface.

## Open items resolved in brainstorming

- Write authority → **new sanctioned coordinator verb** (not direct frontmatter edit).
- Autonomy → **auto-fix provable, escalate judgment**.
- Prevention → **repair skill + mint/supersede guards** (both vectors).
- Guard strictness → **hard-refuse + external marker**.
- Never-minted default → **decide each interactively**.
- Ero repair → **supervised observe_only lift**.

## Risks / watch-items

- **Verb scope creep:** must refuse tracked/parked cards — dependency repair on in-flight
  work is `amend-*` territory, not this verb.
- **Mint guard false-positives:** within-batch forward-refs and the external marker must
  be honored or legitimate mints break.
- **Ero observe_only:** the lift must be restored even if the pass aborts (wrap in
  restore-on-exit).
- **Epic posture recompute:** unblocking must go through `reconcile`, never a hand-edited
  kanban column, or board drift reappears.
