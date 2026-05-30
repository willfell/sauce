# Night plan (2026-05-30) — three sessions toward a headspace-ready morning

**Status:** approved scope, pre-implementation.
**Date:** 2026-05-30 evening.
**Predecessor:** v0.80.0 cowork-sibling-files (closed 2026-05-30, commit `f7cfa51`).
**Cohort summary entry-point:** `Docs/plans/2026-05-30-cowork-cohort-summary-and-headspace-onboarding.md`.

## Goal

By tomorrow morning, the user can sit down in the **headspace-sauce** vault and walk a known-good test path for the cowork microscope + sibling-files feature with:

- Concrete per-step expected outcomes (no "see if it works" steps).
- A pre-authored `hard_rules` + `no_emojis` block to paste into `user-preferences.md`.
- A reverse-audit skill that catches dangling `## References` and orphan siblings as Will authors them (live error-prevention, not after-the-fact debugging).
- Every documented landmine + FLN that would surface friction during the test, swept.
- Zero context gaps. Every doc cross-references every other doc.

Everything tonight is in service of that single goal.

---

## Out of scope (explicit)

Don't let scope creep eat the night:

- **VISUAL verification of FLN-v79-1 (callout colors)** — USER-ONLY task. I cannot eyeball Obsidian rendering.
- **WhatsApp MCP-swap follow-through** (v0.79 §2) — depends on Will installing `lharries/whatsapp-mcp` first; not tonight.
- **Cross-vault `inherits_from`** (v0.79 §7) — too large; ~8 hrs alone.
- **Canonical-gather × microscope hybrid** (v0.79 §8) — design-heavy; ~6 hrs.
- **Multiple-microscope-per-kind** (v0.80 §14) — schema rework; ~6 hrs.
- **Dedicated `/cowork sibling` slash command** (v0.80 §10) — explicitly considered + deferred during scoping; reverse-audit picked instead because it serves tomorrow's authoring experience directly.
- **Sibling-application post-processor** (v0.80 §12) — pre-emptive YAGNI until tomorrow's briefing actually shows compliance drift.
- **Expanded known-kinds catalog** (v0.79 §6) — none of those kinds are in headspace's priorities; would not help tomorrow.

All of the above remain on the carry-forward queue in `Docs/agent-guides/cycle-status.md` for v0.82+.

---

## Three sessions

Each session runs end-to-end (design → plan → execute → ship → verify) before the next begins. No interleaving. Each ends with everything pushed + deployed, so an interrupted night still leaves the work shippable.

### Session 1 — Stream A polish + headspace test plan (~1 hr)

**No version bump.** Pure docs + verification. Single commit at the end.

**Deliverables:**

1. **`Docs/plans/2026-05-30-headspace-test-plan.md`** — a self-contained test plan with:
   - **Step 0 (visual gate):** open headspace in Obsidian, paste a callout test note, eyeball FLN-v79-1 distinct colors. Fix paths if monochrome.
   - **Step 1:** paste pre-authored `hard_rules` + `no_emojis` block into `spice/cowork/context/user-preferences.md`. Expected outcome: file saves, no schema error, no Obsidian indexing complaint.
   - **Steps 2-5:** `/cowork microscope finance` → `chat` → `email` → `calendar` with per-kind:
     - "what the skill should ask"
     - "what gaps it should classify and how"
     - "what siblings it should suggest scaffolding" (if any)
     - "what `microscope.md` should contain at the end"
     - "what `## References` should list" (depending on whether siblings were scaffolded)
   - **Step 6:** trigger a morning-briefing (manually or wait for cron); compare output to 2026-05-29 briefing using a delta table.
   - Per-step "what to do if it's wrong" troubleshooting section.
   - (Step 7 — `/cowork audit-siblings` — is NOT included in Session 1's test plan. It will be appended as a separate commit at the end of Session 3 per the sequencing constraint below.)

2. **Pre-authored `hard_rules` + `no_emojis` draft** — a markdown block at the top of the test plan, copy-paste-ready. Sourced from Will's prior preferences + the v0.79.0 emoji-leak surface analysis.

3. **Slash-command smoke check** — run a quick `ls` against `.claude/skills/cowork/edit-microscope/SKILL.md` in headspace-sauce + confirm the helper at `platform/blueprints/cowork/helpers/edit-microscope-helper.js` is reachable from the materialized cowork install. No live MCP calls; just sanity that the wiring landed.

4. **Cross-reference sweep** — confirm `CLAUDE.md` router → `Docs/agent-guides/cycle-status.md` → cohort summary → tonight's design + test plan all link cleanly. Edit any stale references.

**Exit criteria:** test plan committed + pushed; quickcheck `ls` confirms slash commands are materialized in headspace; cross-references resolve.

### Session 2 — v0.80.1 PATCH (FLN cleanup bundle) (~1.5 hrs)

**Bumps:** workshop `0.80.0 → 0.80.1`. No mechanism or blueprint bumps. PATCH because the changes are cleanups, not new contract surface.

**Bundle (5 FLNs):**

| FLN | Change | Files |
|---|---|---|
| **FLN-v79-2** | Add CLI arg parsing to `install.js` so `node install.js --vault . --auto-approve` works (rather than silently no-op'ing). Detect the `tp` argument absence + the presence of `--vault` / `--auto-approve` flags; dispatch to a minimal CLI wrapper that mirrors `platform/test/run-install.js`'s adapter shape. | `platform/install.js` (+test in `run-install.js`) |
| **FLN-v80-1** | Soften the HC-V0800-A1 glob regex in `run-cowork-smoke.js` to accept either the literal `per-mcp/<kind_name>/*.md` glob string OR a split `per-mcp/<kind_name>/` + "matching `*.md`" phrasing. Pure test-side regex relaxation; production prose stays as-is. | `platform/test/run-cowork-smoke.js` |
| **FLN-v79-3** | Document the 80-char `agent_markdown` floor in the HC-case skeleton inside `Docs/agent-guides/build-test-verify.md` (or a new "writing HC cases" guide) so future plan authors don't trip the trap. | `Docs/agent-guides/build-test-verify.md` |
| **FLN-v79-4** | Add a one-line orchestrator-vs-sub-skill dest convention note to `Docs/agent-guides/architecture.md`: orchestrators flatten to `{{skills_dir}}/<name>/SKILL.md`; sub-skills nest under `{{skills_dir}}/skills/<name>/SKILL.md`. | `Docs/agent-guides/architecture.md` |
| **FLN-v80-2** | Update `Docs/landmines.md` entry #16 — the global `materializeClaudeSurface` step now appears to refresh SKILL.md dests per-install regardless of the per-item version short-circuit. Codify the actual behavior so future plans stop predicting "deferred catch-up." | `Docs/landmines.md` |

**HC additions:**

- One new install-harness case `HC-V0801-A1` verifying that `node install.js --vault <tmp> --auto-approve` actually runs to completion + writes the expected files (mirrors the v0.79 `caseV0790F1` synthetic-workshop scaffold pattern).
- Cowork-smoke regression check — A1 from v0.80 still passes after the regex softening (i.e., the production prose still matches).
- No CS-MIG-1 changes (no new claude_surface[]).

**Sequencing:** standard 6-8 stages — preflight → failing test for the install.js CLI handler → implement → soften A1 regex → docs updates (3 of them in one stage) → version bump (`0.80.0 → 0.80.1`) + dogfood → cycle-close artifacts.

**Release shape:** annotated tag `v0.80.1` (USER APPROVAL gate), tap PR auto-opens, merge tap PR, brew upgrade, `sauce update --bump-pins` on all 4 vaults.

**Exit criteria:** preflight `version-sync ok: 0.80.1` ALL GREEN; all 4 vaults at `0.80.1`; `node install.js --vault .` works.

### Session 3 — v0.81.0 MINOR (reverse audit + dangling-ref guard) (~2.5 hrs)

**Bumps:** workshop `0.80.1 → 0.81.0`; cowork blueprint `0.19.0 → 0.20.0` (MINOR — new skill + new claude_surface entry). Reverses the v0.80.0 "no claude_surface change" posture, so CS-MIG-1 counts WILL bump.

**New skill: `cowork:audit-siblings`** (`/cowork audit-siblings` or `/cowork audit-siblings <kind>`).

**Posture:** pure read-only sanity check. No writes, no MCP gather calls. Output is a single Claude Code response with structured findings.

**Scope:**

1. **Dangling-reference detection.** For each `microscope.md` present in `spice/cowork/prompts/per-mcp/<kind>/`, parse the `## References` section (regex: `^- \*\*(.+?)\*\* — .+$` lines under a `^## References\s*$` header). For each captured `<name>`, verify `spice/cowork/prompts/per-mcp/<kind>/<name>` exists via `mcp__obsidian__get_file_contents` (treat not-found as dangling). Emit:
   ```
   > [!warning] Dangling sibling reference
   > Kind: <kind>
   > microscope.md references `<name>` but no such file exists at `per-mcp/<kind>/<name>`.
   > Did you delete the sibling? Or forget to scaffold it? Re-run `/cowork microscope <kind>` to re-author + scaffold.
   ```
2. **Orphan-sibling detection.** For each per-kind dir, list all `*.md` files except `microscope.md` + `_*.md`. For each, check whether the corresponding `microscope.md` (if present) lists it in `## References`. If a sibling exists but isn't referenced, emit:
   ```
   > [!info] Orphan sibling file
   > Kind: <kind>
   > `<name>` exists at `per-mcp/<kind>/<name>` but is not listed in `microscope.md`'s `## References` section.
   > The gather will still inject it (siblings are glob-discovered, not microscope-driven), but `microscope.md` should document why this sibling exists. Re-run `/cowork microscope <kind>` to add a reference line.
   ```
3. **Clean state.** If no dangling + no orphans across all kinds, emit `[!success] All siblings consistent across N kind(s) checked.` Silence is also acceptable per cowork callout style; pick the more-useful UX.

**Helper:** new `platform/blueprints/cowork/helpers/audit-siblings-helper.js` exporting:
- `parseReferences(microscope_body) → string[]` — pure parser.
- `auditSiblings({ kinds_dir_listing, microscope_bodies }) → { dangling: [{kind, name}], orphans: [{kind, name}] }` — pure audit logic (no fs / no MCP).

**SKILL.md:** new `platform/blueprints/cowork/skills/orchestrators/audit-siblings/SKILL.md` — orchestrator-tier dest (per FLN-v79-4 convention being documented in Session 2). Steps:
1. List `prefs.priorities` kinds.
2. For each, list per-mcp dir + read microscope.md if present.
3. Call helper's `auditSiblings` with the gathered state.
4. Render dangling + orphan findings as `[!warning]` / `[!info]` callouts.
5. Final summary.

**Slash command:** `/cowork audit-siblings` (no positional → audit all kinds) and `/cowork audit-siblings <kind>` (single-kind audit).

**HC cases:**

- `HC-V0810-A1` — `parseReferences` extracts names from a v0.80-style `## References` block.
- `HC-V0810-A2` — `parseReferences` returns `[]` when no References section present.
- `HC-V0810-A3` — `parseReferences` tolerates `## References (added)` (deepen-pass).
- `HC-V0810-B1` — `auditSiblings` flags dangling refs.
- `HC-V0810-B2` — `auditSiblings` flags orphan files.
- `HC-V0810-B3` — `auditSiblings` returns clean state for consistent kind.
- `HC-V0810-B4` — `auditSiblings` skips kinds with no microscope.md (no dangling, but orphans still flagged if files exist).
- `HC-V0810-C1` — orchestrator SKILL.md prose-lint (has steps 1-5, declares helper import, mentions `## References` parsing).
- `HC-V0810-D1` — claude_surface entry materializes correctly (CS-MIG-1 counts bump 37→38 / 46→47).
- F1-style preservation guard NOT needed (read-only skill).

**Cowork-customization-contract update:** add a row for the audit skill (read-only, no consumer surface).

**Release shape:** annotated tag `v0.81.0` (USER APPROVAL gate), tap PR, merge, brew, vault updates.

**Exit criteria:** preflight `version-sync ok: 0.81.0` ALL GREEN; all 4 vaults at `0.81.0` / cowork `0.20.0`; `/cowork audit-siblings` invocable in headspace.

---

## Success criteria for the night

End-of-night, ALL of these must be true:

- [ ] Workshop on `v0.81.0` at `origin/main`; tap formula at `v0.81.0`; brew-installed sauce CLI at `0.81.0`.
- [ ] All 4 consumer vaults at workshop `0.81.0` / cowork `0.20.0`.
- [ ] `Docs/plans/2026-05-30-headspace-test-plan.md` exists, committed, pushed.
- [ ] `Docs/plans/2026-05-30-night-plan-design.md` (this file) exists, committed, pushed.
- [ ] v0.80.1 + v0.81.0 result + handoff docs exist + pushed; cycle-history.md prepended with both; cycle-status.md current bumped to v0.81.0.
- [ ] `node install.js --vault . --auto-approve` works (FLN-v79-2 closed).
- [ ] `/cowork audit-siblings` reachable from headspace as `.claude/skills/cowork/audit-siblings/SKILL.md`.
- [ ] FLN-v79-1 visual verification is the ONLY blocker for the test plan's Step 0.

---

## Out-of-night risks + mitigations

| Risk | Mitigation |
|---|---|
| **Brew tap PR auto-merge fails** | If preflight in `release.yml` fails, fix forward via patch commit + new tag. Don't force-push. |
| **Headspace `sauce update` fails** | Have backup: revert the headspace install via `git restore` inside the vault if it's git-tracked; OR re-run with previous version's subscription pin. |
| **v0.81.0 cycle blows time budget** | Hard-stop at 2.5 hrs. If incomplete, commit work-in-progress on a NEW branch (NOT main), document state in the handoff, defer to a future cycle. v0.81.0 is NOT mandatory for tomorrow's headspace test; v0.80.1 + test plan is the floor. |
| **Reverse-audit design surfaces unexpected gaps mid-implementation** | Apply v0.79.0-style "design uncovers during execution" pattern: pause, update the cycle's design doc inline, re-validate scope with the user, continue. |

---

## Sequencing constraint (one constraint, hard)

Session 1's test plan references `/cowork audit-siblings` (the v0.81.0 deliverable) in its Step 7. **Either** (a) write Step 7 first in skeleton form with "TBD pending v0.81.0" markers and patch them at the end of Session 3, **or** (b) defer Step 7 until Session 3 ships, then append it to the test plan as a separate commit.

Recommendation: (b). Cleaner. Session 1's test plan goes through Step 6 (the morning-briefing comparison). Step 7 is appended after Session 3's release. This is one extra commit, but the test plan stays internally consistent at each commit boundary.

---

## What gets carried into tomorrow

- The headspace test plan (the user-facing entry point for the test).
- The cohort summary (the deep-context entry point if the test surfaces questions).
- The cycle-history v0.80.0 + v0.80.1 + v0.81.0 narratives (the design-rationale source-of-truth).
- The four FLN closures + one new FLN (whatever emerges from v0.81.0 execution).
- Workshop at v0.81.0, all consumer vaults at v0.81.0 / cowork 0.20.0, brew CLI at v0.81.0.
- Zero context gaps. Every doc cross-references every other doc.
