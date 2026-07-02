# Blueprint Conformance — Standard, Gates, Fix-to-Green

**Date:** 2026-07-02
**Status:** Design of record (approved for autonomous execution)
**Author:** autonomous session (Opus 4.8)
**Supersedes / builds on:** `spice/projects/sauce/…/Cross-blueprint templating and render consistency audit` (headspace, 2026-07-01, documentation-only)

## Problem

Sauce ships the canonical UI/loader primitives as mechanisms already — `nav-buttons`,
`entity-create`, `accent-button`, `breadcrumb`, `icons`, `section-label`, `open-helpers`,
`render-safe`. The defect is **inconsistent adoption**, not missing infrastructure. Blueprints
authored before a convention existed still hand-roll buttons, hardcode `ranch/views` paths, leak
`{{DATE}}` tokens, use `## H2` content headings, and never adopt note-chrome.

Critically, the one gate that could stop this — `scripts/lint-note-chrome.js` — is **opt-in by
construction** (`if (!manifest.breadcrumb) continue;`, line 230). It enforces the standard *only*
over blueprints that already declare a `breadcrumb` block. The 9 un-adopted blueprints drift
freely. A one-time human audit (2026-07-01) catalogued the debt but changed nothing and cannot
prevent regression.

## Goal

Make "the official right way" **machine-enforced forever**. Every convention becomes a
deterministic gate in `release:preflight`; the codebase is driven to green against every gate; new
blueprints cannot re-violate. Green is the proof — no LLM opinion in the acceptance criterion.

## Non-goals

- No new UI primitives — the mechanisms already exist; we enforce their use.
- No hand-versioning / tagging / release-PR merges — the auto-release pipeline owns that.
- No merging. Deliverables are **green PRs**; nothing reaches consumer vaults until the user merges.
- No refactoring beyond what a rule requires.

## The Standard (single source of truth)

Two committed artifacts define "the right way":

1. **`Docs/agent-guides/blueprint-conformance.md`** — the definitive prose spec. Per concern
   (buttons, templates, customjs) it names the one canonical mechanism and the rule-id that
   enforces it. Router entry added to `CLAUDE.md`'s further-reading list.

2. **`platform/conformance-index.json`** — machine-readable registry, mirroring the existing
   `platform/schemas-index.json` pattern. One entry per rule: `id`, `theme`, `gate` (script path),
   `severity`, `status` (enforcing | report-only), and `exemptions[]` — each exemption a
   `{ target, reason }` pair. **Exemptions are declared and reasoned, never silent skips.**
   Validated by a meta-check so a rule cannot claim `enforcing` without a wired gate.

### Canonical button answer (headline concern)

| Button kind | Right way | Forbidden (BTN gates) |
| --- | --- | --- |
| Nav / breadcrumb chrome | `nav_buttons[]` + `breadcrumb` block in manifest → `nav-buttons` / `breadcrumb` | hand-rolled nav rows |
| "New X" creation | `new_entity_buttons[]` in manifest → `entity-create` | hand-rolled "New" buttons |
| Action buttons (Edit/Open/Delete) | `accent-button` (`AccentButton`) | raw `<button>` + bespoke inline styles |
| Icons / glyphs | `icons` mechanism (Lucide kebab → SVG) | inline emoji / raw SVG as a glyph |

**Button strictness: STRICT** (approved). BTN-1 flags every hand-rolled button / bespoke nav row
outside the sanctioned mechanisms; BTN-2 flags every inline emoji / raw SVG used as a glyph.

## Rule catalog (12 rules → permanent gates)

Current violation counts are from the 2026-07-02 refresh against `main` (v0.169.0).

| Rule-id | Enforces | Gate | Now |
| --- | --- | --- | --- |
| **BTN-1** no-hand-rolled-buttons | nav/create/action buttons via sanctioned mechanisms | NEW `scripts/lint-buttons.js` | audit-driven |
| **BTN-2** icons-via-mechanism | no inline emoji / raw SVG glyphs | NEW `scripts/lint-buttons.js` | few |
| **CHR-1** note-chrome-adoption | every non-exempt blueprint declares a `breadcrumb` block | extend `lint-note-chrome.js` (mandatory + exemptions) | 8 blueprints |
| **CHR-2** template-has-breadcrumb | every note-type template renders Breadcrumb (close type-less blind spot) | extend `lint-note-chrome.js` | several |
| **CHR-3** open-mode-routed | new-note open via `open-helpers` / forceLeafPreview | NEW `scripts/lint-open-mode.js` | some |
| **TPL-1** path-variables | no hardcoded `ranch/…` / `spice/<module>/`; use `{{vars}}` | NEW `scripts/lint-path-variables.js` | ~50 |
| **TPL-2** no-token-leak | no unrendered `{{DATE}}` / `{{TIME}}` / `{{title}}` in rendered templates | NEW `scripts/lint-token-leak.js` | 5 (trips) |
| **TPL-3** no-content-h2 | `## H2` → `section-label` (kanban columns exempt) | extend `lint-note-chrome.js` / `lint-display-markers.js` | ~10 real |
| **TPL-4** render-nothing | no empty-state placeholder strings | NEW `scripts/lint-empty-state.js` | 2 |
| **TPL-5** no-trailing-hr | no trailing `---` at template end | NEW `scripts/lint-trailing-hr.js` | 3 |
| **CJS-1/2/4** loadable / render-safe / contract | already enforced | EXISTS | 0 |
| **CJS-3** no-dead-classes | defined ⇔ referenced, both directions | NEW `scripts/lint-dead-classes.js` | 0 (locks clean state) |

TPL-3 is coupled to CHR-1: `## H2`→SectionLabel only fires once a blueprint is adopted, so the
two travel together per-blueprint.

## Gate architecture

- **Report-mode aggregator first.** New/extended gates land under `npm run conformance:audit`
  (non-blocking) so `release:preflight` never goes red mid-flight. A gate is promoted into the
  *blocking* `release:preflight` chain only once its rule reaches green.
- **Every gate ships a `--self-test`** (the platform convention; see `lint-note-chrome.js`,
  `lint-cold-load.js`) with `pass`/`fail` fixtures proving it flags the known violations AND
  exempts the legit set — verified *before* any file is edited. This is the false-positive seatbelt.
- **Exemptions** live in `platform/conformance-index.json` plus the established per-line opt-out
  comment convention (`// lint-<gate>:allow <reason>` / `<!-- lint-<gate>:allow <reason> -->`).
- **Wiring:** new gates register in `package.json` — `conformance:audit` (report) and, once green,
  the `release:preflight` chain, matching existing lint placement (static lints before test
  harnesses).

## The fix loop (autonomous Workflow)

Per rule, as a pipeline:

1. **Write the gate** (TDD: `--self-test` green against pass/fail fixtures) — proves no false
   pos/neg.
2. **Gate enumerates violations** — the deterministic work-list.
3. **Fan out fixers** — one agent per offending blueprint, worktree-isolated where edits collide.
4. **Adversarial verify** each fix (skeptic subagent: did it use the sanctioned mechanism, or just
   silence the linter?).
5. **Gate green + full `release:preflight` green.**
6. **Commit.** Promote the gate into the blocking chain.

Loop terminates on the red→green transition per rule; the initiative terminates when every rule is
`enforcing` and green.

## Verification bar (per fix / per PR)

- Target gate green **and** full `release:preflight` green (all lints + 70+ harnesses).
- Adversarial `superpowers:code-reviewer` subagent per PR.
- **Visual rules** (BTN-1, CHR-1/2/3): Playwright screenshots at 360/390px, light + dark, on the
  workshop dogfood vault — matching the task-entity / nav-buttons cycles.
- **Install heals** (note-chrome adoption): version-gated + backup-first + idempotent, exercised by
  the seed-vault regression harness (`platform/test/seed-vault/`) per
  `Docs/agent-guides/migration-regression-net.md`.

## PR structure (what lands in the review queue)

- **PR A — Foundation + mechanical fixes.** The standard doc, `conformance-index.json`, all gates
  (report mode), and the low-risk additive fixes: TPL-1 (path vars, ~50), TPL-2 (tokens, 5),
  TPL-4 (empty-state, 2), TPL-5 (trailing hr, 3), BTN-2 (icons), CJS-3 (dead-class lock). No note
  rewrites, no heals. Each of these gates is promoted to blocking within this PR.
- **PR B…N — note-chrome adoption.** CHR-1/2/3 + TPL-3 + BTN-1, landing as a short series of green
  PRs (≈ one per blueprint: finance → trips → cowork → people → products → teams → daily →
  journal), each with a version-gated heal + seed regression, independently reviewable. Boards is
  exempt (kanban-only) and recorded as such in the registry.

## Trust anchors

1. Green is machine-proof; the loop terminates on red→green, not on agent say-so.
2. Every gate's `--self-test` proves zero false pos/neg before any edit.
3. Exemptions are explicit + reasoned in `conformance-index.json`.
4. Nothing merges — the user reviews green PRs.
5. Per-PR adversarial review + full preflight per commit.
6. Visual + seed-regression verification for output-changing rules.
7. Heals are version-gated, backup-first, idempotent (platform standard).

## Open risks

- **CHR-1 exemption calls.** Boards (kanban) is clearly exempt. Finance carries its own `FinanceNav`
  chrome and many note types — its adoption is the largest single blueprint; if it proves
  disproportionate it lands as its own PR and, if needed, is flagged for a design call rather than
  forced.
- **BTN-1 strictness false-positives.** Strict mode may flag legitimate widget-internal buttons; the
  self-test + exemption registry absorb these with reasons, and the adversarial reviewer checks that
  a fix used `accent-button`, not an exemption escape hatch.
- **Scale.** The note-chrome wave (8 blueprints × heal + seed regression) is the bulk of the effort
  and lands incrementally as a PR series, not a mega-PR.
