# Blueprint Conformance — PR A (Foundation + Gates + Mechanical Fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the conformance standard + machine-checkable registry + the report-mode gate aggregator, then drive TPL-1/2/4/5, BTN-2, and CJS-3 to green and promote them into the blocking `release:preflight`.

**Architecture:** Each rule is a standalone `scripts/lint-*.js` gate with a `--self-test` proving zero false pos/neg against `platform/test/fixtures/<gate>/{pass,fail}/`. Gates first register under a non-blocking `npm run conformance:audit`; once a rule is green it is promoted into the blocking `release:preflight` chain. Exemptions are declared with reasons in `platform/conformance-index.json` and via per-line `// lint-<gate>:allow <reason>` comments.

**Tech Stack:** Node (CommonJS, zero-dep, matching existing `scripts/lint-*.js`), JSON registry (matching `platform/schemas-index.json`), Playwright for visual rules (PR B series only).

**Base branch:** `feature/blueprint-conformance-foundation` (worktree `.worktrees/conformance-foundation`), off `origin/main`.

**Out of scope (→ PR B…N):** BTN-1 (hand-rolled buttons), CHR-1/2/3 (note-chrome adoption), TPL-3 (`## H2`→SectionLabel — coupled to CHR-1 per blueprint). These change rendered output + need install heals + seed regression, and land as a per-blueprint PR series.

---

## File structure

**Create:**
- `Docs/agent-guides/blueprint-conformance.md` — the standard (prose).
- `platform/conformance-index.json` — rule/gate/exemption registry.
- `scripts/lint-conformance-index.js` — meta-gate validating the registry.
- `scripts/lint-path-variables.js` (TPL-1) + `platform/test/fixtures/lint-path-variables/{pass,fail}/`.
- `scripts/lint-token-leak.js` (TPL-2) + fixtures.
- `scripts/lint-empty-state.js` (TPL-4) + fixtures.
- `scripts/lint-trailing-hr.js` (TPL-5) + fixtures.
- `scripts/lint-buttons.js` (BTN-2 now; BTN-1 stub returns clean until PR B) + fixtures.
- `scripts/lint-dead-classes.js` (CJS-3) + fixtures.

**Modify:**
- `package.json` — add `conformance:audit` (report) + `test:*` self-test entries; promote green gates into `release:preflight`.
- `CLAUDE.md` — add `blueprint-conformance.md` to the further-reading router (outside marker regions).
- Blueprint templates/views carrying violations (TPL-1 ~50, TPL-2 5, TPL-4 2, TPL-5 3, BTN-2 few).

---

## Task 1: Conformance registry + meta-gate

**Files:**
- Create: `platform/conformance-index.json`
- Create: `scripts/lint-conformance-index.js`
- Modify: `package.json`

- [ ] **Step 1: Write the registry.** `platform/conformance-index.json`:

```json
{
  "schema_version": 1,
  "rules": [
    { "id": "TPL-1", "theme": "templates", "title": "path-variables", "gate": "scripts/lint-path-variables.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "TPL-2", "theme": "templates", "title": "no-token-leak", "gate": "scripts/lint-token-leak.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "TPL-4", "theme": "templates", "title": "render-nothing", "gate": "scripts/lint-empty-state.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "TPL-5", "theme": "templates", "title": "no-trailing-hr", "gate": "scripts/lint-trailing-hr.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "BTN-1", "theme": "buttons", "title": "no-hand-rolled-buttons", "gate": "scripts/lint-buttons.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "BTN-2", "theme": "buttons", "title": "icons-via-mechanism", "gate": "scripts/lint-buttons.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "CHR-1", "theme": "chrome", "title": "note-chrome-adoption", "gate": "scripts/lint-note-chrome.js", "severity": "error", "status": "report-only", "exemptions": [ { "target": "boards", "reason": "kanban-only blueprint; no chromed leaf notes" } ] },
    { "id": "CHR-2", "theme": "chrome", "title": "template-has-breadcrumb", "gate": "scripts/lint-note-chrome.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "CHR-3", "theme": "chrome", "title": "open-mode-routed", "gate": "scripts/lint-open-mode.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "TPL-3", "theme": "templates", "title": "no-content-h2", "gate": "scripts/lint-note-chrome.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "CJS-1", "theme": "customjs", "title": "loadable", "gate": "platform/test/run-customjs-loadable.js", "severity": "error", "status": "enforcing", "exemptions": [] },
    { "id": "CJS-2", "theme": "customjs", "title": "render-safe", "gate": "scripts/lint-cold-load.js", "severity": "error", "status": "enforcing", "exemptions": [] },
    { "id": "CJS-3", "theme": "customjs", "title": "no-dead-classes", "gate": "scripts/lint-dead-classes.js", "severity": "error", "status": "report-only", "exemptions": [] },
    { "id": "CJS-4", "theme": "customjs", "title": "contract", "gate": "platform/test/run-customjs-contract.js", "severity": "error", "status": "enforcing", "exemptions": [] }
  ]
}
```

- [ ] **Step 2: Write the meta-gate.** `scripts/lint-conformance-index.js` validates: parseable, `schema_version === 1`, unique `id`s, each `gate` file exists on disk, `status ∈ {enforcing, report-only}`, `severity ∈ {error, warn}`, each exemption is `{target, reason}` with non-empty reason. A rule with `status: "enforcing"` MUST have its gate present in the `release:preflight` script string (read `package.json`); fail if an enforcing rule is not wired. Support `--self-test` with an inline good/bad registry fixture. Exit 1 on any hard failure.

- [ ] **Step 3: Wire npm scripts.** In `package.json` add:
  - `"lint-conformance-index": "node scripts/lint-conformance-index.js"`
  - `"conformance:audit": "node scripts/lint-conformance-index.js && node scripts/lint-path-variables.js && node scripts/lint-token-leak.js && node scripts/lint-empty-state.js && node scripts/lint-trailing-hr.js && node scripts/lint-buttons.js && node scripts/lint-dead-classes.js"` (report aggregator; `|| true` NOT used — this command is allowed to exit non-zero during the fix phase).

- [ ] **Step 4: Run meta-gate self-test.** `node scripts/lint-conformance-index.js --self-test` → PASS. Then `node scripts/lint-conformance-index.js` against the real registry → PASS (all gate files will exist after later tasks; if run now, expect failures naming not-yet-created gate files — that is the correct red state).

- [ ] **Step 5: Commit.** `git add platform/conformance-index.json scripts/lint-conformance-index.js package.json && git commit -m "feat(conformance): registry + meta-gate (report-mode)"`

---

## Task 2: The Standard doc

**Files:**
- Create: `Docs/agent-guides/blueprint-conformance.md`
- Modify: `CLAUDE.md` (further-reading router, OUTSIDE marker regions)

- [ ] **Step 1: Write `Docs/agent-guides/blueprint-conformance.md`** with a `purpose:`/`load_when:` frontmatter header (match sibling agent-guides). Sections: (a) the button table from the spec; (b) template rules (path variables, no token leak, no content H2, render-nothing, no trailing hr); (c) customjs rules (loadable/render-safe/contract/no-dead-classes); (d) note-chrome adoption; (e) "how enforcement works" pointing at `platform/conformance-index.json` + `npm run conformance:audit` + the per-line `// lint-<gate>:allow` convention. Each rule names its rule-id and canonical mechanism.

- [ ] **Step 2: Add router line to `CLAUDE.md`** in the "Further reading" list (hand-authored region, NOT inside any `@claude-surface` marker): `- [`Docs/agent-guides/blueprint-conformance.md`](Docs/agent-guides/blueprint-conformance.md) — the button/template/customjs conformance standard + the gate registry.`

- [ ] **Step 3: Verify no marker regions touched.** `git diff CLAUDE.md` — confirm the change is outside every `<!-- @claude-surface:* -->` pair.

- [ ] **Step 4: Commit.** `git commit -am "docs(conformance): authoritative blueprint-conformance standard + router entry"`

---

## Task 3: TPL-5 no-trailing-hr (smallest gate first — proves the pattern)

**Files:**
- Create: `scripts/lint-trailing-hr.js`, `platform/test/fixtures/lint-trailing-hr/{pass,fail}/*.md`
- Modify: 3 templates (meetings `Meeting Hub.md`, project `Kanban Card.md`, boards `Template, Board Card.md`)

- [ ] **Step 1: Write fixtures.** `fail/trailing.md` = a template body ending with `\n---\n`; `pass/clean.md` = same body without the trailing rule; `pass/frontmatter-only.md` = a file whose ONLY `---` are the frontmatter fences (must NOT flag).

- [ ] **Step 2: Write the gate.** Scan `platform/blueprints/**/templates/*.md`. Strip the leading frontmatter block (reuse the frontmatter-skip logic from `lint-note-chrome.js`). If the last non-blank line of the remaining body is exactly `---` (a horizontal rule, not a frontmatter fence), flag it. Honor `<!-- lint-trailing-hr:allow <reason> -->` on that line or the line above. `--self-test` over the fixtures.

- [ ] **Step 3: Run self-test.** `node scripts/lint-trailing-hr.js --self-test` → `fail/` flagged, `pass/` clean.

- [ ] **Step 4: Run against tree.** `node scripts/lint-trailing-hr.js` → expect exactly 3 violations (the known files). This red state is the work-list.

- [ ] **Step 5: Fix the 3 templates.** Remove the trailing `---` (and any trailing blank line it created) from each. Confirm the button/nav row above it is unaffected.

- [ ] **Step 6: Run gate green.** `node scripts/lint-trailing-hr.js` → `ok`. Flip TPL-5 `status` to `enforcing` in the registry and add `&& node scripts/lint-trailing-hr.js` to `release:preflight`.

- [ ] **Step 7: Commit.** `git commit -am "feat(conformance): TPL-5 no-trailing-hr gate + fix 3 templates"`

---

## Task 4: TPL-2 no-token-leak

**Files:**
- Create: `scripts/lint-token-leak.js`, fixtures
- Modify: trips templates `Trip To Do.md`, `Trip Flights.md`, `Trip Packing List.md`, `Trip Stay.md`, `Trip Notes.md`

- [ ] **Step 1: Fixtures.** `fail/leak.md` frontmatter `created: {{DATE}}`; `pass/rendered.md` frontmatter `created: <% tp.file.creation_date("YYYY-MM-DD") %>`; `pass/install-var.md` body referencing `{{views_path}}` (lowercase_snake install var — must NOT flag).

- [ ] **Step 2: Gate.** Scan `platform/blueprints/**/templates/*.md`. Flag `{{TOKEN}}` where TOKEN matches `/^[A-Z][A-Z_]*$/` (uppercase Templater-style runtime tokens: `DATE`, `TIME`, `DATETIME`, `TITLE`, …). Do NOT flag `{{lowercase_snake}}` (installer substitution vars). Honor `<!-- lint-token-leak:allow -->`. `--self-test`.

- [ ] **Step 3: Self-test** → pass. **Step 4: Run** → expect 5 (trips).

- [ ] **Step 5: Fix.** Replace `{{DATE}}` with the canonical rendered form. FIRST read how a sibling trips template or the entity-create path renders `created` correctly (grep trips templates for a non-leaking `created:`; if none, mirror `daily`/`scratch` template `created:` form). Apply the same expression to all 5.

- [ ] **Step 6: Green** → flip TPL-2 to `enforcing`, add to `release:preflight`. **Step 7: Commit** `feat(conformance): TPL-2 no-token-leak gate + fix trips`.

---

## Task 5: TPL-4 render-nothing

**Files:**
- Create: `scripts/lint-empty-state.js`, fixtures
- Modify: `platform/blueprints/project/helpers/project-workstreams.js:187`, `platform/blueprints/to-do/helpers/today-capture-editable-list.js:202`

- [ ] **Step 1: Fixtures.** `fail/placeholder.js` contains `el.setText("No tasks yet")`; `pass/silent.js` returns early rendering nothing when the collection is empty.

- [ ] **Step 2: Gate.** Scan `platform/blueprints/**/*.js` + `platform/mechanisms/**/*.js`. Flag string literals matching `/\b(no|nothing|none)\b.*\b(yet|items?|tasks?|entries|results?|found)\b/i` OR `/^\s*(no|none|nothing)\b/i` that are passed to a DOM-emit call (`setText`, `createEl`/`createDiv`/`createSpan` with `text:`, `textContent =`, `innerHTML =`, `append(... text ...)`). Honor `// lint-empty-state:allow <reason>`. `--self-test`.

- [ ] **Step 3: Self-test** → pass. **Step 4: Run** → expect the 2 known (plus surface any others; if a legit informational hint appears, add it to the registry exemption with a reason after adversarial confirmation, do NOT blanket-allow).

- [ ] **Step 5: Fix the 2.** Replace the empty-state string emit with an early `return` / render-nothing branch. Verify the surrounding widget still renders correctly when non-empty (the string only appeared in the empty branch).

- [ ] **Step 6: Green** → enforcing + preflight. **Step 7: Commit** `feat(conformance): TPL-4 render-nothing gate + fix 2 widgets`.

---

## Task 6: BTN-2 icons-via-mechanism (BTN-1 stubbed clean until PR B)

**Files:**
- Create: `scripts/lint-buttons.js`, fixtures
- Modify: any view emitting emoji/raw-svg glyphs (audit-driven)

- [ ] **Step 1: Read the icons mechanism API.** `platform/mechanisms/icons/` — confirm the call shape (`customJS.Icons.get('check')` or similar) and the kebab vocabulary, so fixes use the real API.

- [ ] **Step 2: Fixtures.** `fail/emoji-glyph.js` renders a button label containing an emoji (`"✅ Done"`) or `innerHTML = '<svg …>'` as a glyph; `pass/icons.js` uses `customJS.Icons.get('check')`; `pass/prose-emoji.md` has an emoji in plain note prose (must NOT flag — only glyph/button contexts).

- [ ] **Step 3: Gate.** `scripts/lint-buttons.js` runs BOTH checks (BTN-1 + BTN-2), keyed by which rule-ids are `enforcing`/reporting. BTN-2: scan `platform/blueprints/**/*.js` + `platform/mechanisms/**/*.js` (EXCLUDE `platform/mechanisms/icons/`), flag emoji unicode ranges and raw `<svg` literals appearing in a button/label emit context. BTN-1: for THIS PR return no violations (stub with a `// PR B` comment) — its real logic (raw `<button>` / bespoke nav rows outside sanctioned mechanisms) lands with the note-chrome series. `--self-test` covers BTN-2 only.

- [ ] **Step 4: Self-test** → pass. **Step 5: Run** → enumerate BTN-2 violations.

- [ ] **Step 6: Fix** each by routing through `customJS.Icons.get(...)`. Verify rendered glyph visually is equivalent (record which kebab name replaced which emoji).

- [ ] **Step 7: Green (BTN-2)** → flip BTN-2 to `enforcing`, add `lint-buttons.js` to preflight (BTN-1 stays report-only in registry). **Step 8: Commit** `feat(conformance): BTN-2 icons-via-mechanism gate + fixes (BTN-1 stub)`.

---

## Task 7: CJS-3 no-dead-classes (locks the current clean state)

**Files:**
- Create: `scripts/lint-dead-classes.js`, fixtures

- [ ] **Step 1: Fixtures.** `fail/undefined-ref/` = a template referencing `customJS.Ghost` with no defining file; `fail/orphan/` = a `class Orphan {}` file never referenced; `pass/` = a class defined and referenced.

- [ ] **Step 2: Gate.** Build DEFINED = set of class names from top-level `class X` in every `platform/{blueprints,mechanisms}/**/{views,helpers,scripts}/*.js` (and any dir customJS loads). Build REFERENCED = every `customJS.<Name>` token across all `*.md` templates/content, `*.js`, and manifest `customjs_startup_scripts[]`/`inline_body`. Flag REFERENCED∖DEFINED (breaking) and DEFINED∖REFERENCED (dead). Honor registry exemptions (e.g., a class referenced only via a startup-script string) and `// lint-dead-classes:allow <reason>`. `--self-test`.

- [ ] **Step 3: Self-test** → pass. **Step 4: Run** → expect CLEAN (0). If it flags anything, that is a real latent defect — investigate before exempting; only exempt with a confirmed reason in the registry.

- [ ] **Step 5: Green** → enforcing + preflight. **Step 6: Commit** `feat(conformance): CJS-3 no-dead-classes gate (locks clean state)`.

---

## Task 8: TPL-1 path-variables (the big one, ~50)

**Files:**
- Create: `scripts/lint-path-variables.js`, fixtures
- Modify: ~50 occurrences across products, project, teams, trips, cowork, meetings, boards templates/content

- [ ] **Step 1: Fixtures.** `fail/hardcoded.md` contains `"ranch/views/customjs-guard"`; `pass/var.md` contains `"{{views_path}}/customjs-guard"`; `pass/manifest-dest.json` a manifest `files[]` dest using `{{module_directory}}` (must NOT flag).

- [ ] **Step 2: Gate.** Scan `platform/blueprints/**/{templates,content}/*.md` + `platform/blueprints/**/*.js`. Flag literal `ranch/views`, `ranch/scripts`, `ranch/templates` occurrences NOT immediately preceded by `{{...}}` (i.e., the hardcoded form rather than `{{views_path}}`). Map each to its variable: `ranch/views`→`{{views_path}}`, `ranch/scripts`→`{{scripts_path}}`, `ranch/templates`→`{{templates_path}}`. Honor `<!-- lint-path-variables:allow <reason> -->`. `--self-test`.

- [ ] **Step 3: Self-test** → pass. **Step 4: Run** → expect ~50; capture the exact file:line list as the work-list.

- [ ] **Step 5: Fix — fan out one fixer per blueprint** (worktree-isolated per `superpowers:dispatching-parallel-agents`). Each fixer: replace `ranch/views`→`{{views_path}}` (etc.) in its blueprint's flagged lines ONLY; do NOT touch anything else; re-run the gate scoped to its blueprint; report file:line diffs. IMPORTANT: verify the variable resolves — grep one installed consumer or `install.js` path-map to confirm `{{views_path}}` substitutes to `ranch/views` (so behavior is byte-identical post-install).

- [ ] **Step 6: Adversarial verify.** A skeptic subagent confirms each replaced path is a genuine variable substitution (not a semantic change) and that no `ranch/views` remains except registry-exempted.

- [ ] **Step 7: Green** → enforcing + preflight. **Step 8: Commit** `feat(conformance): TPL-1 path-variables gate + sweep ~50 hardcoded paths`.

---

## Task 9: Full preflight + adversarial review + open PR A

- [ ] **Step 1: Full preflight.** `npm run release:preflight` → all lints + 70+ harnesses green. Fix any regression before proceeding (a path-var sweep or empty-state edit must not break a harness).
- [ ] **Step 2: Registry meta-gate.** `node scripts/lint-conformance-index.js` → PASS (every `enforcing` rule wired into preflight).
- [ ] **Step 3: `npm run conformance:audit`** → PASS for TPL-1/2/4/5, BTN-2, CJS-3 (CHR-*/BTN-1/TPL-3 remain report-only, expected non-blocking).
- [ ] **Step 4: Adversarial code review.** Dispatch `superpowers:code-reviewer` over the branch diff vs `origin/main`: check no silent gate weakening, no unreasoned exemptions, no behavior change from the path sweep, self-tests genuinely bidirectional.
- [ ] **Step 5: Push + open PR.** `git push -u origin feature/blueprint-conformance-foundation` then `gh pr create` titled `feat(conformance): blueprint conformance foundation + gates + mechanical fixes` with a body summarizing rules landed, counts fixed, and the "report-only remainder → PR B series" note. **Do NOT merge.** Confirm CI goes green.

---

## Self-review notes
- **Spec coverage:** TPL-1/2/4/5, BTN-2, CJS-3 + standard + registry all have tasks (PR A scope). CHR-1/2/3, TPL-3, BTN-1 explicitly deferred to PR B series (documented, not dropped).
- **Sequencing:** smallest gate (TPL-5, 3 fixes) first proves the write-gate→self-test→red→fix→green→promote loop before the ~50-fix TPL-1.
- **Verification:** every gate has a bidirectional self-test; every fix re-runs its gate; Task 9 runs full preflight + adversarial review before the PR.
- **Trust:** gates promoted to blocking only when green; exemptions reasoned in the registry; nothing merges.
