# Homepage Migration — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-install the `homepage` community plugin via the `convenience` mechanism and configure it to open **today's daily note in Reading view** (with a forced Dataview refresh), exposed via Homepage's native ribbon button + a hotkey — **additive and button-first** (`openOnStartup: false`, `daily` `autorun` untouched), so nothing about the current flow breaks.

**Architecture:** Extend the existing `convenience` mechanism — which already owns the `new-tab-default-page` auto-install + settings — with three additive manifest changes: `external_plugins[] += {id:"homepage"}` (fetch + enable at install), `community_plugin_settings[] += {id:"homepage", settings:{…}}` (write `.obsidian/plugins/homepage/data.json` declaratively via `applyCommunityPluginData`), and one `hotkeys[]` binding for `homepage:open-homepage`. The install path is identical to the proven `new-tab-default-page` precedent. Behavior is verified by a new isolated `CP7` helper-case; the seed-vault is intentionally NOT touched (the prereq-gate skips homepage when its dir is absent, keeping seed install green).

**Tech Stack:** Sauce installer (`platform/install.js` → `applyExternalPluginInstall`, `applyCommunityPluginData`, `applyHotkeys`), manifest JSON, `platform/test/run-helper-cases.js` (zero-dep Node harness), the Homepage plugin (`mirnovov/obsidian-homepage`, id `homepage`), release preflight.

**Source of truth for WHY:** `headspace-sauce/spice/projects/sauce/docs/daily-notes/Homepage Migration.md` (findings doc). This plan implements that doc's **Phase 1**.

---

## Release / versioning contract (read before committing)

Per `Docs/agent-guides/build-test-verify.md` § Release workflow — the pipeline is fully automatic. For this cycle:

- **DO** write conventional commits: `feat(convenience): …` (this is a MINOR — new external plugin + settings + hotkey).
- **DO NOT** edit any manifest `version` field, `package.json`, `ranch/platform-subscription.json` pins, the seed-vault pins, or `platform/test/fixtures/component-versions.snapshot.json`. The bumper writes all of them.
- **DO NOT** add a hardcoded version literal to any test assertion.
- **DO NOT** open/merge/tag the release PR.
- The manifest `description` field is prose changelog — append a sentence describing this change; keep it version-agnostic (do not hand-write a version number).

---

## File structure — what each touched file is responsible for

| File | Change | Responsibility |
| --- | --- | --- |
| `platform/mechanisms/convenience/manifest.json` | Modify | Declare homepage as an external plugin, its `data.json` settings, and a hotkey. Sole behavior-carrying change. |
| `platform/test/run-helper-cases.js` | Modify (add Case CP7) | Prove `applyCommunityPluginData` writes homepage's `data.json` with the intended Phase-1 config, in an isolated scratch vault. |
| `Docs/plans/2026-07-02-homepage-migration-phase1-plan.md` | (this file) | The plan. |
| `Docs/plans/2026-07-02-homepage-migration-phase1-result.md` | Create at close | Cycle result doc (manual-smoke receipt + what shipped). |

**Explicitly NOT touched:** `platform/test/seed-vault/**` (prereq-gate skip keeps seed install green — see Task 5 rationale), the `daily` blueprint (`autorun` stays on — button-first), and the nav-launcher (`nav-buttons` mechanism — the Sauce nav-strip "Home" button is a deferred follow-up, see § Deferred).

---

## Task 1: Capture the exact Homepage `data.json` shape (spike — no test)

**Files:** none (produces a value used in Tasks 2–3).

**Why:** The `HomepageData` field schema is known (below), but the top-level wrapper nests each homepage under a **name key** inside `homepages` (default believed to be `"Main Homepage"`, mobile `"Mobile Homepage"`, with `version: 4`, `separateMobile: bool`). We must confirm the exact wrapper — a wrong name key means the plugin ignores our config and regenerates defaults.

**Known `HomepageData` schema** (from `mirnovov/obsidian-homepage` `src/homepage.ts`):

| key | type / values we use |
| --- | --- |
| `value` | `""` (unused when `kind: "Daily Note"`) |
| `kind` | `"Daily Note"` |
| `openOnStartup` | `false` (button-first) |
| `openMode` | `"Replace last note"` |
| `manualOpenMode` | `"Replace last note"` |
| `view` | `"Reading view"` |
| `revertView` | `true` |
| `openWhenEmpty` | `false` |
| `refreshDataview` | `true` |
| `autoCreate` | `true` |
| `autoScroll` | `false` |
| `pin` | `false` |
| `commands` | `[]` |
| `alwaysApply` | `false` |
| `hideReleaseNotes` | `true` |

- [ ] **Step 1: Install + enable Homepage in a throwaway vault (or reuse an existing install).**

Easiest: open any Obsidian vault → Settings → Community plugins → Browse → search "Homepage" → Install → Enable. Then Settings → Homepage → set **Homepage** = *Daily note*, **Opening view** = *Reading view*, toggle *Refresh Dataview* on, *Open on startup* OFF.

- [ ] **Step 2: Read the written data.json and record the wrapper verbatim.**

```bash
cat "<that-vault>/.obsidian/plugins/homepage/data.json"
```

Expected shape (confirm the exact top-level name key + `version`):

```jsonc
{
  "version": 4,
  "homepages": {
    "Main Homepage": { "kind": "Daily Note", "view": "Reading view", "...": "..." }
  },
  "separateMobile": false
}
```

- [ ] **Step 3: Freeze the canonical settings object** for use in Tasks 2–3 (substitute the confirmed name key for `HOMEPAGE_NAME` below). If capture is impossible right now, proceed with `"Main Homepage"` and treat Task 7's manual smoke as the confirmation gate.

---

## Task 2: Add the failing helper-case (CP7)

**Files:**
- Modify: `platform/test/run-helper-cases.js` (insert after Case CP6, which ends at the `}` on/around line 3677)

- [ ] **Step 1: Write Case CP7**, mirroring CP6 exactly but for `homepage`. Insert immediately after CP6:

```javascript
  console.log("\n--- Case CP7: applyCommunityPluginData writes homepage data.json (daily→reading) ---");
  const scratchCP7 = await fsp.mkdtemp(path.join(os.tmpdir(), "beacon-caseCP7-"));
  try {
    const manifest = fixtureHotkeysManifest({
      external_plugins: [{ id: "homepage" }],
      community_plugin_settings: [
        {
          id: "homepage",
          settings: {
            version: 4,
            homepages: {
              "Main Homepage": {
                value: "",
                kind: "Daily Note",
                openOnStartup: false,
                openMode: "Replace last note",
                manualOpenMode: "Replace last note",
                view: "Reading view",
                revertView: true,
                openWhenEmpty: false,
                refreshDataview: true,
                autoCreate: true,
                autoScroll: false,
                pin: false,
                commands: [],
                alwaysApply: false,
                hideReleaseNotes: true,
              },
            },
            separateMobile: false,
          },
        },
      ],
    });
    await scaffoldVault(scratchCP7, {
      templaterData: TEMPLATER_DEFAULT,
      slashCommanderData: SC_DEFAULT,
      manifest,
    });
    // Seed plugin dir + community-plugins.json so the prereq gate passes.
    const hpDir = path.join(scratchCP7, ".obsidian/plugins/homepage");
    await fsp.mkdir(hpDir, { recursive: true });
    const cpPath = path.join(scratchCP7, ".obsidian/community-plugins.json");
    await fsp.writeFile(cpPath, JSON.stringify(["homepage"]), "utf8");
    const result = await runHarness(scratchCP7);
    assertTrue("CP7: install ran", result !== null);
    const dataPath = path.join(scratchCP7, ".obsidian/plugins/homepage/data.json");
    assertTrue("CP7: data.json written", fs.existsSync(dataPath));
    const data = await readJson(dataPath);
    const hp = data.homepages && data.homepages["Main Homepage"];
    assertTrue("CP7: homepages['Main Homepage'] present", !!hp);
    assertEq("CP7: kind=Daily Note", hp.kind, "Daily Note");
    assertEq("CP7: view=Reading view", hp.view, "Reading view");
    assertEq("CP7: refreshDataview true", hp.refreshDataview, true);
    assertEq("CP7: openOnStartup false (button-first)", hp.openOnStartup, false);
    assertEq("CP7: separateMobile false", data.separateMobile, false);
  } finally {
    await fsp.rm(scratchCP7, { recursive: true, force: true });
  }
```

- [ ] **Step 2: Ensure CP7 is invoked.** CP6 lives in a runner function that the harness calls (find where `Case CP6` runs and confirm CP7 sits in the same function body — inserting after CP6's closing `}` within that function suffices; no separate registration is needed since it's inline in the same async function).

- [ ] **Step 3: Run and verify it FAILS** (manifest not yet wired → but note: CP7 supplies its own fixture manifest, so it will actually PASS in isolation *if the applier already handles nested objects*). Run:

Run: `node platform/test/run-helper-cases.js`
Expected: CP7 **passes** on the applier logic alone (it feeds its own manifest). Its purpose is a **regression lock** on the nested-`homepages` shallow-merge write, not a red-first gate. If CP7 fails here, the bug is in `applyCommunityPluginData`'s handling of a nested-object `settings` value — investigate before proceeding (shallow merge should write the whole `homepages` object as one top-level key).

> Note: unlike a typical TDD red-first, the behavior-under-test (the applier) already exists; CP7 locks the exact Phase-1 payload. The red-first signal for the *product* change is Task 3's install-against-real-manifest smoke.

- [ ] **Step 4: Commit the test.**

```bash
git add platform/test/run-helper-cases.js
git commit -m "test(convenience): CP7 locks homepage data.json write (daily→reading view)"
```

---

## Task 3: Wire homepage into the `convenience` manifest

**Files:**
- Modify: `platform/mechanisms/convenience/manifest.json`

- [ ] **Step 1: Add `homepage` to `external_plugins[]`.** Change:

```json
"external_plugins": [
  { "id": "dataview" },
  { "id": "new-tab-default-page" }
]
```

to:

```json
"external_plugins": [
  { "id": "dataview" },
  { "id": "new-tab-default-page" },
  { "id": "homepage" }
]
```

- [ ] **Step 2: Add the homepage entry to `community_plugin_settings[]`.** Append after the `new-tab-default-page` entry (use the exact object confirmed in Task 1):

```json
{
  "id": "homepage",
  "settings": {
    "version": 4,
    "homepages": {
      "Main Homepage": {
        "value": "",
        "kind": "Daily Note",
        "openOnStartup": false,
        "openMode": "Replace last note",
        "manualOpenMode": "Replace last note",
        "view": "Reading view",
        "revertView": true,
        "openWhenEmpty": false,
        "refreshDataview": true,
        "autoCreate": true,
        "autoScroll": false,
        "pin": false,
        "commands": [],
        "alwaysApply": false,
        "hideReleaseNotes": true
      }
    },
    "separateMobile": false
  }
}
```

- [ ] **Step 3: Add the hotkey** to `hotkeys[]` (append; `Mod+Shift+H` is free — verify against the existing bindings, none use it):

```json
{
  "command_id": "homepage:open-homepage",
  "modifiers": ["Mod", "Shift"],
  "key": "h"
}
```

- [ ] **Step 4: Append a prose changelog sentence to the manifest `description`** (version-agnostic), e.g.:

> "MINOR: external_plugins[] +1 homepage (mirnovov/obsidian-homepage) + community_plugin_settings[] +1 homepage (kind=Daily Note, view=Reading view, refreshDataview=true, openOnStartup=false — button-first) + hotkeys[] +1 Mod+Shift+H → homepage:open-homepage. Opens today's daily note rendered (Reading view) on demand; daily-notes autorun untouched. Phase 1 of the Homepage migration."

- [ ] **Step 5: Run the helper harness** — CP7 + all HK/CP cases green.

Run: `npm run test:helpers`
Expected: PASS (CP7 + existing CP1–CP6 + HK cases all pass; no VERSION assertions touched).

- [ ] **Step 6: Commit.**

```bash
git add platform/mechanisms/convenience/manifest.json
git commit -m "feat(convenience): auto-install Homepage plugin, open daily in Reading view (Phase 1, button-first)"
```

---

## Task 4: Regression — seed install stays green (prereq-skip)

**Files:** none (verification only).

**Rationale:** `convenience` now declares `external_plugins: homepage` + a `community_plugin_settings` entry for it. When install runs against the seed-vault (which does NOT contain `.obsidian/plugins/homepage/`), `applyCommunityPluginData`'s prereq gate emits an **info** `skipped_missing_prereq` (or `skipped_plugin_dir_absent`) history event and writes nothing. This is expected and non-fatal — we intentionally do not add homepage to the seed (adding plugin artifacts risks the seed-rebaseline over-heal landmine, and the real behavior is covered by CP7).

- [ ] **Step 1: Run the install harness against the seed vault.**

Run: `node platform/test/run-install.js .`
Expected: PASS. No `error`-level history events for `community_plugin_data`. A `skipped_missing_prereq`/`skipped_plugin_dir_absent` **info** event for homepage is acceptable.

- [ ] **Step 2: Run the bootstrap harness** (it enumerates plugin wiring).

Run: `npm run test:bootstrap`
Expected: PASS.

- [ ] **Step 3: If either fails on a homepage-attributed assertion**, do NOT add homepage to the seed as the first fix — first confirm the failure is a genuine error vs. an info-event count. Only if a harness asserts "zero skipped events" (unlikely) revisit. Commit nothing here (verification task).

---

## Task 5: Full preflight + bumped-preflight (merge gate)

**Files:** none (verification only).

- [ ] **Step 1: Full preflight.**

Run: `npm run release:preflight`
Expected: PASS end-to-end (the `&&` chain stops at first failure; a clean run means all harnesses green).

- [ ] **Step 2: Bumped-preflight on a clean tree** (replicates `prepare-release`; refuses on a dirty tree, so commit Tasks 2–3 first).

Run: `npm run release:preflight-bumped`
Expected: PASS. Green here ⇒ the auto-release `prepare-release` job won't wedge on the bumped state.

---

## Task 6: Dogfood install + manual smoke (the real red→green for the product)

**Files:** none until the result doc (Task 7).

- [ ] **Step 1: Install the workshop onto itself (or a consumer test vault).**

Run: `sauce install --vault /Users/willfellhoelter/projects/repos/sauce` (or a scratch consumer). The `external_plugins` fetch downloads `homepage` from the obsidian-releases index into `.obsidian/plugins/homepage/` and appends `"homepage"` to `.obsidian/community-plugins.json`; `applyCommunityPluginData` then writes its `data.json`.

- [ ] **Step 2: Verify the fetch + settings landed.**

```bash
ls .obsidian/plugins/homepage/            # main.js + manifest.json present
cat .obsidian/plugins/homepage/data.json  # homepages['Main Homepage'].kind == "Daily Note", .view == "Reading view"
grep homepage .obsidian/community-plugins.json
```

- [ ] **Step 3: In Obsidian (Cmd+R first), confirm behavior:**
  - Homepage's **ribbon button** (or `Mod+Shift+H`, or Command palette → *Homepage: Open homepage*) opens **today's daily note in Reading mode** (rendered dashboard, not the editor). ← the fix.
  - The `SpaceDailyDashboard` panel renders fresh (Refresh Dataview).
  - **No double-open on app restart** — `openOnStartup:false` means Homepage does NOT fire on launch; `daily-notes` `autorun` still opens the daily as before. Confirm exactly one daily opens on startup.

- [ ] **Step 4: If the daily opens in editor via the ribbon**, check that Task 1's `homepages` name key matches what the installed plugin expects (mismatch → plugin ignored our config). Correct the key in `convenience/manifest.json` + CP7, re-run Tasks 3 & 5.

---

## Task 7: Close the cycle

**Files:**
- Create: `Docs/plans/2026-07-02-homepage-migration-phase1-result.md`

- [ ] **Step 1: Write the result doc** — what shipped, the manual-smoke receipt ("Manual smoke: COMPLETED on <vault>" with the three Task-6 checks), the confirmed `homepages` name key, and the deferred items (§ Deferred).

- [ ] **Step 2: Commit + push the branch; open a PR to `main`.**

```bash
git add Docs/plans/2026-07-02-homepage-migration-phase1-result.md
git commit -m "docs(convenience): Homepage migration Phase 1 result"
git push -u origin feature/homepage-migration
gh pr create --title "feat(convenience): Homepage plugin — open daily in Reading view (Phase 1)" --body "Implements Phase 1 of the Homepage migration (findings doc in headspace). Auto-installs the homepage plugin via convenience, opens today's daily in Reading view on demand (button-first; daily autorun untouched). Verified by CP7 + full preflight + bumped-preflight + manual smoke."
```

- [ ] **Step 3: Let the release pipeline run** — do NOT touch versions/tags/the release PR. Merge feature PR to `main` once CI is green (per build-test-verify.md).

---

## Deferred (explicitly out of Phase 1 scope — flag to user)

1. **Sauce nav-strip "Home" button.** Adding a pinned "Home" entry touches the tuned nav-launcher fixed grid (`_partitionEntries`, the `Daily|To-Do|Scratch / Projects|Meetings|Go to…` layout in the `nav-buttons` mechanism). Its own mini-cycle. Phase 1 relies on Homepage's native ribbon + the `Mod+Shift+H` hotkey.
2. **Flip startup ownership.** Once Phase 1 feels right: set `daily` `autorun: false` **and** homepage `openOnStartup: true` in one change so Homepage cleanly owns the startup landing (resolves the double-open conflict). This is Phase 1.5.
3. **Phase 2 — dedicated `Home.md` command-center** (`kind: "File"`, `autoCreate`, likely a new `home` blueprint). Separate spec → plan → cycle.

---

## Self-review

- **Spec coverage:** findings §7 Phase 1 (Homepage → daily in Reading, additive, button-first) ⇒ Tasks 1–6. Findings §5 distribution-fit (external_plugins + community_plugin_settings) ⇒ Task 3. Findings §6 conflict (autorun vs startup) ⇒ handled by `openOnStartup:false` + Task 6 Step 3 + Deferred #2. Findings §6 new-tab-default-page overlap ⇒ untouched (complementary triggers). Nav-strip button + dedicated Home ⇒ Deferred (findings §7 Phase 2 / §8). ✔
- **Placeholder scan:** `HOMEPAGE_NAME`/`"Main Homepage"` is a captured value (Task 1), not a TODO. No "add error handling"-style gaps. ✔
- **Type/name consistency:** the `homepages["Main Homepage"]` shape + field names/values are identical across Task 2 (test), Task 3 (manifest), and Task 6 (smoke). Command id `homepage:open-homepage` consistent in hotkey + smoke. ✔
