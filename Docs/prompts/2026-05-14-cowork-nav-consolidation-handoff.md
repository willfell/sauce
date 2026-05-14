# Handoff — cowork nav-button consolidation (3 buttons → 1)

**Prepared:** 2026-05-14
**For:** fresh Claude Code session
**Scope:** Workshop cycle. Bumps `cowork@0.4.0 → 0.5.0` (MINOR — pure-additive UX cohesion; no breaking changes to artifacts already in consumer vaults).
**Mandate:** Reduce global nav-bar visual weight. Cowork should contribute exactly ONE global button. All timeframe navigation + creation moves into the Cowork.md hub itself.

---

## The problem (from real-vault testing of v0.42.0)

After deploying v0.42.0 to a real consumer vault, the user observed that cowork's three global nav-buttons (`Cowork` · `This Week` · `This Month`) take too much real-estate in the global nav-bar. Combined with other blueprints' buttons (Daily, Project actions, etc.), the row is too dense. The user's UX preference: each blueprint contributes ONE button to the global nav. Sub-navigation belongs inside the blueprint's hub.

## The fix in one line

`cowork-hub` stays in the global nav-buttons-registry. `cowork-weekly-this` + `cowork-monthly-this` are REMOVED from the global registry. Their actions move into the Cowork.md hub body as inline interactive UI (callable cards or accent-buttons) that have IDENTICAL behavior to the old global buttons.

## What the new Cowork.md should look like

Top of hub: the existing scaffold-status callout (unchanged from v0.4.0).

Then a single consolidated "Timeframes" section. Two strong layout candidates — pick one in the design phase. Both achieve the same user-facing capability.

**Candidate A — single 5-card row (cleanest visually, recommended unless a design constraint pushes otherwise):**

```
### Timeframes

[Daily Hub]  [Weekly Hub]  [This Week →]  [Monthly Hub]  [This Month →]
```

- `Daily Hub` / `Weekly Hub` / `Monthly Hub` cards → openLink to the corresponding hub note (existing behavior; just consolidating into one row instead of separate "navigate-to-hub" cards).
- `This Week →` / `This Month →` cards → invoke the runTemplaterTemplate action that the removed global nav-buttons used to perform (create this-period's note if missing, or open it if it already exists).

**Candidate B — two labeled rows (more explicit, slightly heavier):**

```
### Timeframes

#### Navigate
[Daily Hub]  [Weekly Hub]  [Monthly Hub]

#### Create this period
[This Week]  [This Month]
```

The implementer should pick A or B in the design doc and stick with it. Document the choice.

## Implementation routes (design-phase decisions)

The cards need to perform TWO action types:
- **openLink** (Daily Hub / Weekly Hub / Monthly Hub) — trivial; existing card framework supports `openLink` action via BeaconCards target field.
- **runTemplaterTemplate** (This Week / This Month) — this is currently nav-button-only behavior. We need to expose it from inside a hub body.

Three implementation strategies for the runTemplaterTemplate-equivalent in-hub UI:

### Route 1 — extend BeaconCards / accent-button to accept `runTemplaterTemplate` actions

- Pros: Cleanest reuse. Existing renderer / install pipeline already validates this action shape.
- Cons: Touches the cards mechanism + nav-buttons-registry semantics (cards become a callable action surface, not just a navigation surface). Bigger blast radius (cards is used by multiple blueprints).

### Route 2 — new dedicated `CoworkTimeframeButtons` CustomJS class

- Pros: Cowork-local; doesn't touch shared mechanisms. The class exposes two click handlers (`createThisWeek`, `createThisMonth`) that internally reproduce the resolution logic the nav-buttons renderer does today: compute `spice/cowork/{weekly,monthly}/<year>/<label>.md` path, check existence, invoke `Templater` via `app.commands.executeCommandById('templater-obsidian:replace-in-file-templater')` or the Templater API on the template file, then open.
- Cons: Duplicates the runTemplaterTemplate semantics that already exist in nav-buttons. If the nav-button semantics ever change (date-pattern handling, etc.), the cowork class drifts.

### Route 3 — invoke the Templater command directly via dataviewjs button

- Use Obsidian's `app.commands.executeCommandById` with a Templater command. Render a real HTML button inside a dataviewjs block in Cowork.md.
- Pros: No new CustomJS class; minimal code; uses Templater's existing public command.
- Cons: Requires the user to have a Templater "configured template" registered (or equivalent path-binding) — less self-contained than the runTemplaterTemplate manifest action which reads `template_source` directly. May need a Templater-side configuration step the installer would have to write.

**Recommended:** Route 2 (new `CoworkTimeframeButtons` CustomJS class). It's the lowest-coupling approach, keeps cowork's UX self-contained, and the duplicated runTemplaterTemplate logic is small (maybe 30-40 lines). Document the duplication explicitly so a future cycle can consolidate if the runTemplaterTemplate action ever needs centralizing.

## Files that will change (high-confidence)

### Workshop dev repo (`/Users/willfellhoelter/projects/repos/sauce`)

- `platform/blueprints/cowork/manifest.json` — bump `version: "0.4.0"` → `"0.5.0"`; remove the two `nav_buttons[]` entries for `cowork-weekly-this` + `cowork-monthly-this` (keep `cowork-hub`).
- `platform/blueprints/cowork/content/Cowork.md` — replace the existing Timeframes section (currently 3 cards: Daily Hub / Weekly Hub / Monthly Hub) with the new consolidated 5-card row (Candidate A) or two-row block (Candidate B), including the new interactive elements for This Week / This Month.
- **NEW** `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js` — the new `CoworkTimeframeButtons` CustomJS class (if Route 2). Exposes `renderInto(dv, opts)` that draws the 5 cards / accent-buttons and wires click handlers.
- `platform/blueprints/cowork/scripts/...` — register the helper if needed via the customjs-guard convention.
- `platform/manifest.json` — bump cowork entry to `0.5.0`.
- `package.json` + workshop `ranch/platform-subscription.json` — usual lockstep bumps. (Or — per FLN-1 in v0.42.0 result — confirm whether cowork is in the workshop's self-subscription before assuming subscription edits are needed. Last verified state: cowork NOT in workshop subscription.)
- `platform/test/run-cowork-smoke.js` — update to assert the new manifest shape (1 global button instead of 3) + the new Cowork.md body contains the consolidated section. Remove the 2 sub-asserts for the removed buttons; add ~4 sub-asserts for the new in-hub UI elements.
- `platform/test/run-renderer.js` — drop the `R-COWORK-WEEKLY-THIS` + `R-COWORK-MONTHLY-THIS` cases (the two buttons no longer exist in the global registry); add `R-COWORK-HUB-TIMEFRAMES` covering the new in-hub UI rendering if applicable.
- `platform/test/run-claude-surface.js` — confirm no `claude_surface[]` entries reference the removed buttons (probably nothing changes here, but verify).
- `platform/test/run-integration-smoke.js` — confirm post-bootstrap registry has 1 cowork-* global button instead of 3.
- `platform/test/run-audit.js` — if the rule_fragments reference the removed buttons, drop those. The 6 v0.42.0 rule_fragments covered the 3 hubs + 2 note-shells + 1 prompt-stub — none of those should change. The audit fragments for the global nav-buttons (if any) shrink from 3 → 1.
- `Docs/plans/2026-05-14-cowork-nav-consolidation-design.md` — NEW design doc.
- `Docs/plans/2026-05-14-cowork-nav-consolidation-plan.md` — NEW implementation plan.
- `CLAUDE.md` Status (live) — append `v0.5.0` cowork summary after close.

### Consumer vaults

- Post-cycle deploy via `sauce reinstall --vault <vault>` repopulates `<vault>/ranch/nav-buttons-registry.json` from the new manifest (the 2 removed buttons disappear from the registry automatically) and overwrites `<vault>/spice/cowork/Cowork.md` with the new body.
- Existing weekly + monthly notes created via the old buttons remain in place. Path conventions are unchanged.
- No data migration needed.

## Definition of done

1. `cowork@0.4.0 → 0.5.0` bumped in manifest + catalogue + (if applicable) workshop subscription.
2. Workshop self-install (`sauce reinstall --vault $PWD`) succeeds with `<workshop>/ranch/nav-buttons-registry.json contributions.cowork[].length === 1` (only `cowork-hub`).
3. Workshop `<workshop>/spice/cowork/Cowork.md` (workshop subscribes to cowork? if not, smoke against a tmp test vault) renders the new Timeframes section with the chosen Candidate A or B layout.
4. Whole-suite preflight green: `run-renderer.js` reflects the dropped + new cases; `run-cowork-smoke.js` reflects the new manifest shape; `run-integration-smoke.js` confirms 1 cowork-* global button post-bootstrap.
5. Manual Obsidian smoke documents (with screenshots if practical): clicking each of the 5 cards in Cowork.md does the right thing — 3 cards navigate to hubs, 2 cards create + open this-period's note from the corresponding template (or open the existing note if it's already there).
6. Tag `v0.5.0-cowork-nav-consolidation` (or roll into the next minor workshop bump that includes other changes — depends on the planning session's bundling decision). Release workflow auto-bumps the homebrew tap (per FLN-D3 from `2026-05-14-v0.42.0-headspace-deploy-result.md`, the tap PR may still need a manual merge until FLN-D3 ships).
7. Re-deploy to the headspace consumer vault via `sauce reinstall --vault /Users/willfellhoelter/notes/sauce/headspace-sauce` after subscription bumps `cowork: 0.4.0 → 0.5.0` (the same aggressive subscription-bump dance from `2026-05-14-v0.42.0-headspace-deploy-handoff.md`).
8. User-facing testing checklist (analogous to the v0.42.0 deploy testing checklist) confirming:
   - Global nav-bar has exactly ONE cowork button (`Cowork`).
   - Clicking `Cowork` opens the hub.
   - Hub shows the new Timeframes section with 5 interactive elements.
   - Daily Hub / Weekly Hub / Monthly Hub elements navigate to those sub-hubs.
   - This Week / This Month elements create + open this-period's note from the correct template (same observable behavior as the deleted global buttons).
   - Already-existing weekly / monthly notes still open correctly (no broken backlinks).

## Cycle-shape recommendation

Roughly **6-stage plan** modeled on v0.42.0's structure:

- **S1 — Author the new helper + Cowork.md body** (Route 2's `CoworkTimeframeButtons` + updated content/Cowork.md). Single commit. Test: lint passes, no obvious typos.
- **S2 — Manifest delta** (drop the 2 nav-button entries, register the new helper, bump version 0.4.0 → 0.5.0). Single commit.
- **S3 — Renderer + smoke harness updates** (run-renderer drop 2 cases + add 1; run-cowork-smoke +/- as needed; run-integration-smoke 1 cowork-* invariant). Single commit; test green.
- **S4 — Audit / rule_fragments / claude_surface drift check** (likely nothing changes; verify and commit any deltas).
- **S5 — Catalogue + lockstep bumps** (`platform/manifest.json` cowork@0.5.0; `package.json` version bump; subscription bump if cowork is in workshop subscription — re-check FLN-1 from v0.42.0).
- **S6 — Release** (tag `v0.5.0-...` or roll into next minor workshop bump; let release workflow fire; merge tap PR if FLN-D3 still requires manual merge; redeploy to headspace).

## What this is NOT

- This is NOT a breaking change. The path conventions (`spice/cowork/weekly/YYYY/YYYY-Www.md` etc.) don't change. Existing notes stay in place. Old slash commands (`/weekly`, `/monthly`) keep working since they're independent of the nav-button surface.
- This is NOT a rename of `cowork-hub`. Its `id`, `icon`, `label`, `order` all stay (`cowork-hub`, `users-round`, "Cowork", `51`).
- This is NOT addressing FLN-D1..D4 from the v0.42.0 headspace deploy. Those are a separate cycle bundle (`v0.42.1 deploy-hardening`). FLN-D2 (audit YAML parser inline-flow blindness) will continue to false-positive on the new Cowork.md's tags array; ignore the audit noise for this cycle, same as v0.42.0.
- This is NOT touching the daily / scratch / project blueprints' nav-buttons. Those are independent UX decisions per blueprint owner.

## Pre-flight reading order (recommended)

1. `Docs/plans/2026-05-13-v0.42.0-cowork-timeframes-skeleton-design.md` — full v0.42.0 design (what's being consolidated).
2. `Docs/plans/2026-05-13-v0.42.0-cowork-timeframes-skeleton-plan.md` — the implementation plan for v0.42.0.
3. `Docs/plans/2026-05-13-v0.42.0-result.md` — v0.42.0 cycle close + FLN-1..5.
4. `Docs/plans/2026-05-14-v0.42.0-headspace-deploy-result.md` — deploy event + FLN-D1..D4 (mostly for context on why FLN-D2 will pollute audit signal during this cycle's preflight).
5. `platform/blueprints/cowork/manifest.json` — current shape (3 global nav-buttons).
6. `platform/blueprints/cowork/content/Cowork.md` — current hub body (where the consolidated Timeframes section will live).
7. `platform/mechanisms/cards/...` — BeaconCards API (decide whether to extend it or stay self-contained per Route 2 recommendation).
8. `platform/mechanisms/nav-buttons/...` — runTemplaterTemplate semantics in the renderer (Route 2 needs to reproduce these in `CoworkTimeframeButtons`; identify the canonical 3-5 lines of resolution logic to mirror).

## Brainstorming-first reminder

The planning session should start with `superpowers:brainstorming` since this is a UX change with multiple viable layouts (Candidate A / B) and multiple viable implementation routes (1 / 2 / 3). Lock those decisions BEFORE writing the design doc. The user has indicated preference for "one button in the nav-bar, everything else inside the hub" — that's the only hard constraint. Everything else is open.

Good luck.
