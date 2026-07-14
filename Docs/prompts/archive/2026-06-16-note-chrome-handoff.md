---
purpose: Fresh-chat handoff for the note-chrome standard arc. Paste the "Prompt to start the new chat" section into a new session to continue development with full context.
load_when: Resuming the note-chrome arc (breadcrumb / section-label / lint / project-heal / adoption waves).
---

# Note-chrome arc — handoff (2026-06-16)

## Mission (one line)

Bring ONE consistent top-of-note "chrome" grammar to every blueprint — breadcrumb → global nav → `---` → blueprint nav → `---` → [section nav → `---`] → content (SectionLabel sections, no `## H2`, no inter-section `---`) — plus icon/centered/wrapping buttons, breadcrumbs everywhere, and new notes opening in read mode. Driven by shared mechanisms, enforced by lint + per-blueprint heal migrations + seed tests.

## What already SHIPPED (live on main + deployed to all vaults)

- **v0.121.2** (tag pushed, brew tap merged, `brew upgrade sauce` done, installed to barebones + accuris + headspace + ero — all at v0.121.2, drift: none):
  - **Button UX fixes** (was v0.120.2): `accent-button` hover mutates individual style props (no `cssText` reassign → kills the New Doc/New Section jitter) + `overflow: hidden` clip; `nav-buttons` row `flex-wrap: wrap`. Tests BB6–BB8 + NAV-WRAP in `platform/test/run-renderer.js`.
  - **New-note read-mode** (was v0.120.3): new `open-helpers` mechanism — `customJS.OpenHelpers.forceLeafPreview(leaf)` / `forceActiveLeafPreview()` (deferred macrotask, markdown-guarded, never-throws, optional-chained at call sites for cold-load safety, captures the target leaf). Wired at every create-and-open site (entity-create ×2, nav-buttons createFromTemplate + runTemplaterTemplate, to-do create; `invoke_command` opt-in via `read_mode_after: true` on the daily nav entry). Unit-tested in `platform/test/run-open-helpers.js` (OH1–OH5).

> Note: these two slices were renumbered from v0.120.2/v0.120.3 to land above main's v0.121.0 (the parallel "test-coverage arc"). Intermediate commit messages still say the old numbers — cosmetic only; the merged state is v0.121.2.

## Canonical docs (READ THESE FIRST)

- **Design spec (the audit + standard + arc):** `Docs/plans/2026-06-16-v0.121.0-note-chrome-standard-design.md` — the canonical grammar, button rules, open-mode rule, the section-label + config-driven breadcrumb mechanism promotions, the **per-blueprint adoption + migration audit table** (§6), the seed-test plan, CLAUDE.md routing, and the cycle arc.
- **Plans already written:**
  - `Docs/plans/2026-06-16-v0.120.2-button-ux-fixes-plan.md` — DONE (shipped).
  - `Docs/plans/2026-06-16-v0.120.3-new-note-read-mode-plan.md` — DONE (shipped).
  - `Docs/plans/2026-06-16-v0.121.0-section-label-mechanism-plan.md` — **WRITTEN, NOT YET EXECUTED.** Renumber it to **v0.122.0** before executing (v0.121.x is taken).
- **Agent guides (the platform rules):** `Docs/agent-guides/project-blueprint-ui.md` (primitives to generalize), `code-conventions.md` (five non-negotiables, stable-anchors-vs-display-markers), `architecture.md`, `migration-regression-net.md` (seed authoring loop), `schemas.md` (register new registries), `build-test-verify.md` (release/tap/deploy), `vault-paths.md` (vault paths + deploy).

## What's NEXT (in order)

1. **Execute section-label mechanism** — the plan exists; renumber v0.121.0 → **v0.122.0**, then execute (promote `SectionLabel` from project helper to a shared mechanism; rewire project + to-do; no body migration since it's live-rendered).
2. **Config-driven breadcrumb mechanism (v0.122.x)** — NOT YET PLANNED. The big one. Generalize the project-only `platform/blueprints/project/helpers/breadcrumb.js` into a shared `breadcrumb` mechanism + `breadcrumb-registry.json` + schema + a per-blueprint trail declaration. **Decided in brainstorming:** trails INCLUDE the month segment for date-organized blueprints (e.g. `Journal / June 2026 / 2026-06-16`); resolver grammar `fm:`/`path:`/`hub:`/`file:`; project migrated onto it first as the proof (must reproduce `test-project / Docs / Architecture` exactly). Register the registry in `platform/schemas-index.json`.
3. **Lint gate + project cosmetic-heal migration + docs (v0.122.x)** — extend `scripts/lint-display-markers.js` for the nav-tier `---` grammar + no-`## H2`; add the project `applyXxxChromeHeal` migration (inject breadcrumb call, normalize `---`, `## H2`→SectionLabel, remove stray New Doc block) with an `HC-V0XYZ-SEED-MIGRATE-CHROME-*` seed family; generalize `project-blueprint-ui.md` → `note-chrome.md` + CLAUDE.md router row + a landmine.
4. **Adoption waves (v0.123.0 / v0.124.0)** — roll the standard into the remaining blueprints per the design spec §6 matrix (meetings, to-do, scratch; then daily, journal, trips, finance; then boards, people, products, teams, cowork). Each: breadcrumb declaration + template conformance + heal migration + seed family + dogfood.

## How to work (conventions learned this session — non-negotiable)

- **Worktree:** work in `.worktrees/note-chrome-foundation` on branch `feature/note-chrome-foundation` (already created off main @ v0.121.2). One arc branch.
- **No Claude trailer** in commits (repo rule). Conventional commits.
- **Subagent-driven execution** (superpowers:subagent-driven-development): one implementer per plan, then spec-compliance review, then code-quality review, then push → PR → CI green.
- **Version lockstep is load-bearing:** every source change bumps the component version AND the `platform/manifest.json` catalogue AND `package.json`/`workshop_version` AND `ranch/platform-subscription.json` + `platform/test/seed-vault/ranch/platform-subscription.json` pins (the installer SKIPS any item whose subscription pin lags the manifest — precedent commit `c5342408`). A NEW mechanism must be ADDED to both subscriptions. `node scripts/check-version-sync.js` is the gate. Seed subscription `workshop_version` stays lagged (only per-item pins move).
- **Live-render vs migration:** chrome is live-rendered via `dv.view(customjs-guard, {class})`, so changing renderer JS (or relocating a class with an unchanged name) reflects on Obsidian reload — NO note migration. Migrations are ONLY for static body text (`## H2`, literal `---`, injected breadcrumb call). Templates under `{{module_directory}}/` keep `materialize_once: true` so cosmetic diffs never overwrite user content.
- **Gate before any push:** `npm run release:preflight` (≈4400 asserts, run with a 600s timeout) must exit 0.
- **Release + deploy flow:** merge PR → main; push tag `vX.Y.Z` on the release commit (release.yml fires ONLY on `v*.*.*` tags → opens a tap PR on `willfell/homebrew-sauce`); merge the tap PR; `brew update && brew upgrade sauce`; `cd <vault> && sauce update --bump-pins && sauce status` per consumer (barebones, accuris-sauce, ero-sauce, headspace-sauce). The installer's `exit 1` "N error/skip" verdict is BENIGN when it's only `skipped_existing` (materialize_once) + `entity_create_block_missing` warnings with `errors:0` and `Drift: none` — that's pre-existing, not a deploy failure. Cmd+R in each Obsidian vault loads new CustomJS classes.

---

## Prompt to start the new chat

> Continue the **note-chrome standard arc** for the Sauce workshop (`/Users/willfellhoelter/projects/repos/sauce`). Read the handoff at `Docs/prompts/2026-06-16-note-chrome-handoff.md` and the design spec at `Docs/plans/2026-06-16-v0.121.0-note-chrome-standard-design.md` first.
>
> Shipped + deployed already (v0.121.2): button UX fixes + new-note read-mode. Work in the existing worktree `.worktrees/note-chrome-foundation` (branch `feature/note-chrome-foundation`, off main @ v0.121.2).
>
> Next, in order: (1) execute the existing section-label mechanism plan (`Docs/plans/2026-06-16-v0.121.0-section-label-mechanism-plan.md`) — renumber it to **v0.122.0** first since v0.121.x is taken; (2) author + execute the config-driven breadcrumb mechanism (month segment included; resolver grammar + registry + schema; project as proof); (3) lint gate + project cosmetic-heal migration + seed + `note-chrome.md` docs; (4) the adoption waves per design-spec §6.
>
> Use subagent-driven execution, honor the version-lockstep + no-Claude-trailer + live-render-vs-migration rules in the handoff, gate every push on `npm run release:preflight`, and follow the release+deploy flow (tag → tap PR → brew upgrade → `sauce update --bump-pins` per vault) when a cycle is ready. Ask me before merging to main or deploying.
