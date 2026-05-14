# cowork nav consolidation — implementation plan (v0.43.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for tasks T1-T6 (each fits a single subagent dispatch). T7 + T8 are controller-direct (release tag + cross-repo deploy). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse cowork's 3 global nav-buttons to 1; relocate the `This Week` + `This Month` create-this-period actions inside `spice/cowork/Cowork.md` as 2 of 5 BeaconCards in a single Timeframes row. Bump `cowork@0.4.0 → 0.5.0` MINOR; bump workshop `0.42.0 → 0.43.0` MINOR; deploy to headspace consumer vault.

**Architecture:** Pure-additive UX cohesion. One new CustomJS class (`CoworkTimeframeButtons`) + targeted manifest delta + Cowork.md body rewrite. No new mechanisms; no installer changes. Mirrors `space-nav-buttons.js:323-382` (runTemplaterTemplate dispatch) for the 2 create-cards' onClick handlers.

**Tech Stack:** Obsidian + CustomJS + Dataview + Templater. Workshop monorepo at `/Users/willfellhoelter/projects/repos/sauce`. Test harnesses are Node CLIs under `platform/test/`. Release ritual: `npm run release:preflight` + annotated tag + `git push origin main && git push --tags`.

**Spec:** `Docs/plans/2026-05-14-cowork-nav-consolidation-design.md`. Read it before starting any task — task descriptions assume design familiarity.

---

## Task T1: Author the CoworkTimeframeButtons helper file

**Files:**
- Create: `platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js`

- [ ] **Step 1: Create the helper file with the exact body from the design doc.**

Write the file with this content (verbatim — the design doc specifies it):

```js
/**
 * CoworkTimeframeButtons (CustomJS)
 * Renders the inline Timeframes block on spice/cowork/Cowork.md.
 *
 * Five cards in one row (Candidate A from the v0.43.0 design):
 *   Daily Hub | Weekly Hub | This Week → | Monthly Hub | This Month →
 *
 * Behaviour:
 *   - 3 navigation cards default through BeaconCards' openLinkText to the hub.
 *   - 2 create-this-period cards mirror nav-buttons' runTemplaterTemplate
 *     semantics: if this-period's note exists, open it; otherwise Templater-create
 *     from ranch/templates/{Weekly Note,Monthly Note}.md, then open.
 *
 * Mirrors space-nav-buttons.js:323-382 (runTemplaterTemplate dispatch).
 */
class CoworkTimeframeButtons {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;
    while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

    const now = window.moment();
    const year = now.format("YYYY");
    const isoWeekLabel = now.format("YYYY-[W]ww");
    const monthLabel   = now.format("YYYY-MM");

    const items = [
      { _kind: "openLink",      file: { name: "Daily Hub",    path: "spice/cowork/Daily Hub.md"   }, _subtitle: "Card index of dailies" },
      { _kind: "openLink",      file: { name: "Weekly Hub",   path: "spice/cowork/Weekly Hub.md"  }, _subtitle: "Card index of weekly notes" },
      { _kind: "createWeekly",  file: { name: "This Week →",  path: `spice/cowork/weekly/${year}/${isoWeekLabel}.md` }, _subtitle: `Open or create ${isoWeekLabel}.md`, _templateSource: "ranch/templates/Weekly Note.md", _folder: `spice/cowork/weekly/${year}`, _filenameNoExt: isoWeekLabel },
      { _kind: "openLink",      file: { name: "Monthly Hub",  path: "spice/cowork/Monthly Hub.md" }, _subtitle: "Card index of monthly notes" },
      { _kind: "createMonthly", file: { name: "This Month →", path: `spice/cowork/monthly/${year}/${monthLabel}.md` }, _subtitle: `Open or create ${monthLabel}.md`, _templateSource: "ranch/templates/Monthly Note.md", _folder: `spice/cowork/monthly/${year}`, _filenameNoExt: monthLabel }
    ];

    if (typeof window.customJS === "undefined" || !window.customJS.BeaconCards) {
      for (const it of items) dv.paragraph(`- [[${it.file.path}|${it.file.name}]] — ${it._subtitle}`);
      return;
    }

    await window.customJS.BeaconCards.render(dv, {
      pages: items,
      title: (p) => p.file.name,
      subtitle: (p) => p._subtitle,
      target: (p) => p.file.path,
      onClick: (p) => this._dispatch(p),
      columns: "auto"
    });
  }

  async _dispatch(item) {
    if (item._kind === "openLink") {
      app.workspace.openLinkText(item.file.path, "");
      return;
    }

    const existing = app.vault.getAbstractFileByPath(item.file.path);
    if (existing) {
      app.workspace.openLinkText(item.file.path, "");
      return;
    }

    const tpPlugin = app.plugins.plugins["templater-obsidian"];
    if (!tpPlugin || !tpPlugin.templater) {
      new Notice("cowork-timeframe-buttons: Templater plugin not enabled", 8000);
      return;
    }

    if (!app.vault.getAbstractFileByPath(item._folder)) {
      try {
        await app.vault.createFolder(item._folder);
      } catch (folderErr) {
        if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
          new Notice(`cowork-timeframe-buttons: cannot create folder ${item._folder} — ${folderErr.message}`, 8000);
          return;
        }
      }
    }

    const templateFile = app.vault.getAbstractFileByPath(item._templateSource);
    if (!templateFile) {
      new Notice(`cowork-timeframe-buttons: template not found at ${item._templateSource}`, 8000);
      return;
    }

    try {
      await tpPlugin.templater.create_new_note_from_template(templateFile, item._folder, item._filenameNoExt, true);
    } catch (err) {
      const msg = (err && err.message) || "";
      if (!/already exists|exists/i.test(msg)) {
        new Notice(`cowork-timeframe-buttons: Templater create failed for ${item.file.path} — ${msg}`, 8000);
        return;
      }
      app.workspace.openLinkText(item.file.path, "");
    }
  }
}
```

**Important:** Do NOT add any trailing whitespace on any line; the helper-cases harness's TW1 lint rejects trailing whitespace and will fail the cycle.

- [ ] **Step 2: Verify the file's content + sanity-grep.**

Run: `wc -l platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js`
Expected: ~95 lines (the literal file body above).

Run: `grep -n "class CoworkTimeframeButtons\|_dispatch\|create_new_note_from_template" platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js`
Expected: 3 hits (class declaration, `_dispatch` method, `create_new_note_from_template` invocation).

- [ ] **Step 3: Commit + push.**

```bash
git add platform/blueprints/cowork/helpers/cowork-timeframe-buttons.js
git commit -m "$(cat <<'EOF'
feat(cowork): v0.43.0 T1 — author CoworkTimeframeButtons helper

Renders 5 BeaconCards in spice/cowork/Cowork.md's Timeframes section:
3 navigation cards (Daily/Weekly/Monthly Hub via openLinkText) + 2
create-this-period cards (This Week / This Month via runTemplaterTemplate
mirror of space-nav-buttons.js:323-382). New customjs class registers
via cowork manifest's customjs_classes[] in T3.
EOF
)"
git push origin main
```

---

## Task T2: Rewrite Cowork.md Timeframes section

**Files:**
- Modify: `platform/blueprints/cowork/content/Cowork.md` (lines 47-69)

- [ ] **Step 1: Verify the current Timeframes section is exactly the v0.42.0 shape.**

Run: `awk 'NR>=47 && NR<=69' platform/blueprints/cowork/content/Cowork.md`
Expected first line: `## Timeframes`. Expected last line includes `}` closing the dataviewjs block. Body contains `BeaconCards.render` with `items: cardItems` and `titleField: ...`. If the file's structure has drifted from this expectation, STOP and report.

- [ ] **Step 2: Replace the Timeframes section with the customjs-guard one-liner.**

Use Edit tool: replace this exact block (lines 47-69, ~22 lines):

````
## Timeframes

```dataviewjs
const subs = [
  { name: "Daily Hub",   path: "spice/cowork/Daily Hub.md",   blurb: "Card index of dailies (spice/daily/**/*.md)" },
  { name: "Weekly Hub",  path: "spice/cowork/Weekly Hub.md",  blurb: "Card index of weekly notes (spice/cowork/weekly/)" },
  { name: "Monthly Hub", path: "spice/cowork/Monthly Hub.md", blurb: "Card index of monthly notes (spice/cowork/monthly/)" }
];
const cardItems = subs.map(s => ({
  file: { name: s.name, path: s.path, mtime: null },
  _blurb: s.blurb
}));
if (typeof window.customJS !== "undefined" && window.customJS.BeaconCards) {
  await window.customJS.BeaconCards.render(dv, {
    items: cardItems,
    titleField: p => p.file.name,
    subtitleField: p => p._blurb,
    linkField: p => p.file.path
  });
} else {
  for (const s of subs) dv.paragraph(`- [[${s.path}|${s.name}]] — ${s.blurb}`);
}
```
````

with this 3-line replacement:

````
## Timeframes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkTimeframeButtons" });
```
````

The section divider (`---`) above the heading and the `## Engagements + cadences` section below are NOT touched.

- [ ] **Step 3: Verify the rewrite.**

Run: `awk 'NR>=47 && NR<=51' platform/blueprints/cowork/content/Cowork.md`
Expected:
```
## Timeframes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkTimeframeButtons" });
```
```

Run: `grep -c "BeaconCards.render\|titleField\|subtitleField\|linkField" platform/blueprints/cowork/content/Cowork.md`
Expected: `0` (the broken inline calls have been removed).

Run: `grep -c "CoworkTimeframeButtons" platform/blueprints/cowork/content/Cowork.md`
Expected: `1`.

Run: `wc -l platform/blueprints/cowork/content/Cowork.md`
Expected: ~163 lines (was ~182 lines pre-rewrite; net -19 lines).

- [ ] **Step 4: Commit + push.**

```bash
git add platform/blueprints/cowork/content/Cowork.md
git commit -m "$(cat <<'EOF'
feat(cowork): v0.43.0 T2 — Cowork.md Timeframes section delegates to CoworkTimeframeButtons

Replace the v0.42.0 inline 3-card BeaconCards block (which called the
mechanism with the wrong API — items/titleField/subtitleField/linkField
vs the actual pages/title/subtitle/target — and silently rendered the
empty-state copy) with a single customjs-guard one-liner that invokes
the new CoworkTimeframeButtons class. Class implementation lives at
helpers/cowork-timeframe-buttons.js (T1).
EOF
)"
git push origin main
```

---

## Task T3: Manifest delta (cowork@0.4.0 → 0.5.0)

**Files:**
- Modify: `platform/blueprints/cowork/manifest.json`

- [ ] **Step 1: Bump version + rewrite description.**

Use Edit to change the `version` field:
- old: `"version": "0.4.0"`
- new: `"version": "0.5.0"`

Use Edit to replace the existing `description` field. Replace this exact line:
- old: `"description": "Engagement-aware automation layer + timeframe scaffolding. v0.4.0 (MINOR): adds Daily / Weekly / Monthly hub-and-spoke navigation surface — Daily Hub (cards over spice/daily/), Weekly Hub + weekly note shells at spice/cowork/weekly/, Monthly Hub + monthly note shells at spice/cowork/monthly/, four prompt-file stubs at spice/cowork/prompts/, three global nav-buttons (Cowork / This Week / This Month), two new slash commands (/weekly, /monthly), one new sub-skill cowork:scaffold-timeframes composed into bootstrap-vault, three new CustomJS hub-card helpers, six new rule_fragments. Pure-additive: no existing files removed; engagement system + summaries/ unchanged. v0.3.0 (MINOR): 10 orchestrators (bootstrap-vault user-invoked + life: morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review + work: ero-morning, ero-eod, ero-weekly, ero-monthly) + 28 sub-skills.",`
- new: `"description": "Engagement-aware automation layer + timeframe scaffolding. v0.5.0 (MINOR): consolidates global nav footprint to 1 button (cowork-hub); the v0.4.0 cowork-weekly-this + cowork-monthly-this global nav-buttons are removed and their open-or-create-this-period behavior re-materializes inside Cowork.md as 2 of 5 BeaconCards in the Timeframes section (5-card row: Daily Hub | Weekly Hub | This Week → | Monthly Hub | This Month →). New CustomJS class CoworkTimeframeButtons mirrors space-nav-buttons.js runTemplaterTemplate semantics for the 2 create-this-period cards. Pure-additive otherwise — no path conventions changed, no skill APIs changed, no rule_fragments changed. v0.4.0 (MINOR): timeframe scaffolding — Daily / Weekly / Monthly hub-and-spoke, weekly + monthly note shells, prompt stubs, scaffold-timeframes sub-skill. v0.3.0 (MINOR): 10 orchestrators + 28 sub-skills.",`

- [ ] **Step 2: Add CoworkTimeframeButtons to customjs_classes[].**

Use Edit to change:
- old:
```
  "customjs_classes": [
    "CoworkDailyHubCards",
    "CoworkWeeklyHubCards",
    "CoworkMonthlyHubCards"
  ],
```
- new:
```
  "customjs_classes": [
    "CoworkDailyHubCards",
    "CoworkWeeklyHubCards",
    "CoworkMonthlyHubCards",
    "CoworkTimeframeButtons"
  ],
```

- [ ] **Step 3: Drop the 2 nav_buttons[] entries.**

Use Edit to change the entire `nav_buttons` array. Replace:
- old:
```
  "nav_buttons": [
    {
      "id": "cowork-hub",
      "label": "Cowork",
      "icon": "users-round",
      "order": 51,
      "action": { "type": "openLink", "target": "{{module_directory}}/Cowork.md" }
    },
    {
      "id": "cowork-weekly-this",
      "label": "This Week",
      "icon": "calendar-range",
      "order": 60,
      "action": {
        "type": "runTemplaterTemplate",
        "folder_prefix": "{{module_directory}}/weekly",
        "folder_date_pattern": "YYYY",
        "filename_prefix": "",
        "filename_date_pattern": "YYYY-[W]ww",
        "filename_suffix": "",
        "template_source": "Weekly Note.md"
      }
    },
    {
      "id": "cowork-monthly-this",
      "label": "This Month",
      "icon": "calendar",
      "order": 65,
      "action": {
        "type": "runTemplaterTemplate",
        "folder_prefix": "{{module_directory}}/monthly",
        "folder_date_pattern": "YYYY",
        "filename_prefix": "",
        "filename_date_pattern": "YYYY-MM",
        "filename_suffix": "",
        "template_source": "Monthly Note.md"
      }
    }
  ],
```
- new:
```
  "nav_buttons": [
    {
      "id": "cowork-hub",
      "label": "Cowork",
      "icon": "users-round",
      "order": 51,
      "action": { "type": "openLink", "target": "{{module_directory}}/Cowork.md" }
    }
  ],
```

- [ ] **Step 4: Add the helpers/cowork-timeframe-buttons.js entry to files[].**

The existing 3 hub-card helper entries are at the end of the `files[]` array. Add the new entry directly after the last one. Use Edit to change:
- old:
```
    { "source": "helpers/cowork-daily-hub-cards.js",                   "dest": "{{scripts_path}}/cowork/cowork-daily-hub-cards.js" },
    { "source": "helpers/cowork-weekly-hub-cards.js",                  "dest": "{{scripts_path}}/cowork/cowork-weekly-hub-cards.js" },
    { "source": "helpers/cowork-monthly-hub-cards.js",                 "dest": "{{scripts_path}}/cowork/cowork-monthly-hub-cards.js" }
  ],
```
- new:
```
    { "source": "helpers/cowork-daily-hub-cards.js",                   "dest": "{{scripts_path}}/cowork/cowork-daily-hub-cards.js" },
    { "source": "helpers/cowork-weekly-hub-cards.js",                  "dest": "{{scripts_path}}/cowork/cowork-weekly-hub-cards.js" },
    { "source": "helpers/cowork-monthly-hub-cards.js",                 "dest": "{{scripts_path}}/cowork/cowork-monthly-hub-cards.js" },
    { "source": "helpers/cowork-timeframe-buttons.js",                 "dest": "{{scripts_path}}/cowork/cowork-timeframe-buttons.js" }
  ],
```

- [ ] **Step 5: Rewrite the post_install notice.**

Use Edit to replace the post_install entry. Change:
- old:
```
  "post_install": [
    {
      "type": "notice",
      "message": "cowork@0.4.0 installed. Timeframe surface scaffolded: spice/cowork/{Daily Hub,Weekly Hub,Monthly Hub}.md materialized; weekly/ + monthly/ directories created lazily on first note; 4 prompt stubs at spice/cowork/prompts/. Three new nav-buttons (Cowork / This Week / This Month); two new commands (/weekly /monthly); one new sub-skill cowork:scaffold-timeframes. Run cowork:scaffold-timeframes in a Claude session inside this vault to create this-week's + this-month's notes from templates (or it'll happen automatically next time you run cowork:bootstrap-vault). 38 sub-skills total (37 from v0.3.0 + scaffold-timeframes)."
    }
  ]
```
- new:
```
  "post_install": [
    {
      "type": "notice",
      "message": "cowork@0.5.0 installed. Global nav-bar footprint reduced: only the Cowork button remains (the v0.4.0 This Week + This Month global buttons are removed). Their open-or-create behavior is now inside spice/cowork/Cowork.md as 2 of 5 cards in the Timeframes section (Daily Hub | Weekly Hub | This Week → | Monthly Hub | This Month →). Path conventions unchanged (spice/cowork/{weekly,monthly}/YYYY/...) — existing weekly/monthly notes still open via the new cards. Re-render Cowork.md to see the new section."
    }
  ]
```

- [ ] **Step 6: Validate JSON shape.**

Run: `jq '.' platform/blueprints/cowork/manifest.json > /dev/null && echo "JSON valid"`
Expected: `JSON valid`.

Run: `jq '{version: .version, customjs_classes_len: (.customjs_classes | length), nav_buttons_len: (.nav_buttons | length), files_len: (.files | length), nav_button_ids: [.nav_buttons[].id]}' platform/blueprints/cowork/manifest.json`
Expected:
```json
{
  "version": "0.5.0",
  "customjs_classes_len": 4,
  "nav_buttons_len": 1,
  "files_len": 37,
  "nav_button_ids": ["cowork-hub"]
}
```

- [ ] **Step 7: Commit + push.**

```bash
git add platform/blueprints/cowork/manifest.json
git commit -m "$(cat <<'EOF'
feat(cowork): v0.43.0 T3 — manifest delta cowork@0.4.0 → 0.5.0 MINOR

- version 0.4.0 → 0.5.0 (MINOR — pure-additive UX cohesion)
- description rewritten (mentions 1 global nav-button + 5-card Timeframes)
- nav_buttons[]: 3 → 1 (drop cowork-weekly-this + cowork-monthly-this;
  keep cowork-hub with id/icon/label/order all unchanged)
- customjs_classes[]: 3 → 4 (+CoworkTimeframeButtons)
- files[]: 36 → 37 (+helpers/cowork-timeframe-buttons.js)
- post_install notice rewritten

claude_surface[] (41), rule_fragments[] (11), depends_on (4),
engagement_types (3) all unchanged.
EOF
)"
git push origin main
```

---

## Task T4: Drop 2 cowork renderer cases from run-renderer.js

**Files:**
- Modify: `platform/test/run-renderer.js`

- [ ] **Step 1: Verify the targets to drop.**

Run: `grep -n "R-COWORK-WEEKLY-THIS\|R-COWORK-MONTHLY-THIS\|testCoworkWeeklyThisRunTemplaterTemplate\|testCoworkMonthlyThisRunTemplaterTemplate\|cowork-weekly-this\|cowork-monthly-this" platform/test/run-renderer.js`

Expected matches:
- 2 doc-comment lines around line 23-24 listing the cases
- 1 selector list line around line 54
- 1 function declaration `testCoworkWeeklyThisRunTemplaterTemplate` around line 1613
- 1 function declaration `testCoworkMonthlyThisRunTemplaterTemplate` around line 1732
- 2 main-switch lines around lines 1857-1858
- Internal references inside the 2 function bodies

- [ ] **Step 2: Drop the doc-comment header lines.**

Use Edit to remove these two lines from the top-of-file comment block:
- old:
```
 *   R-COWORK-WEEKLY-THIS cowork-weekly-this runTemplaterTemplate composes YYYY folder + YYYY-Www filename (v0.42.0)
 *   R-COWORK-MONTHLY-THIS cowork-monthly-this runTemplaterTemplate composes YYYY folder + YYYY-MM filename (v0.42.0)
```
Delete both lines (no replacement). The line above (`R-COWORK-HUB ...`) and the line below stay.

- [ ] **Step 3: Drop selector names from the selector-help comment.**

Use Edit. Find the line beginning `*     all (default), empty, malformed, ...` (around line 54). Remove `, cowork-weekly-this, cowork-monthly-this` from it. Old:
```
 *     all (default), empty, malformed, unknown-action, invoke-command-args, scratch-day-hub, cowork-hub, cowork-weekly-this, cowork-monthly-this, lazy-scaffold, barebones-one-button, beacon-cards, date-aware, finance, accent-button
```
New:
```
 *     all (default), empty, malformed, unknown-action, invoke-command-args, scratch-day-hub, cowork-hub, lazy-scaffold, barebones-one-button, beacon-cards, date-aware, finance, accent-button
```

- [ ] **Step 4: Delete the testCoworkWeeklyThisRunTemplaterTemplate function.**

Find the function at approximately line 1610-1728. The function starts with the comment:
```
// R-COWORK-WEEKLY-THIS — runTemplaterTemplate composes the correct folder path
// (spice/cowork/weekly/<YYYY>) and ISO-week filename (<YYYY>-W<ww>) from the
// installed registry. Uses a frozen moment stub for 2026-05-13 (ISO week 20).
async function testCoworkWeeklyThisRunTemplaterTemplate() {
```

and ends with the closing `}` of the function (followed by an empty line, then the next test). Delete the entire function block (from the leading `//` comment line through the function-closing `}` and the blank line that follows).

After deletion, the next lines in the file should be:
```
// R-COWORK-MONTHLY-THIS — symmetric to R-COWORK-WEEKLY-THIS but for monthly
// notes: folder = spice/cowork/monthly/<YYYY>, filename = <YYYY-MM>.
async function testCoworkMonthlyThisRunTemplaterTemplate() {
```

- [ ] **Step 5: Delete the testCoworkMonthlyThisRunTemplaterTemplate function.**

Find the function at the now-adjusted line. It starts:
```
// R-COWORK-MONTHLY-THIS — symmetric to R-COWORK-WEEKLY-THIS but for monthly
// notes: folder = spice/cowork/monthly/<YYYY>, filename = <YYYY-MM>.
async function testCoworkMonthlyThisRunTemplaterTemplate() {
```

and ends with the function-closing `}`. Delete the entire block + the trailing blank line.

- [ ] **Step 6: Drop the 2 main-switch entries.**

Use Edit to change:
- old:
```
    if (which === 'cowork-hub' || which === 'all') results.push(['R-COWORK-HUB cowork-hub-openlink', await testCoworkHubOpenLink()]);
    if (which === 'cowork-weekly-this' || which === 'all') results.push(['R-COWORK-WEEKLY-THIS cowork-weekly-this-templater', await testCoworkWeeklyThisRunTemplaterTemplate()]);
    if (which === 'cowork-monthly-this' || which === 'all') results.push(['R-COWORK-MONTHLY-THIS cowork-monthly-this-templater', await testCoworkMonthlyThisRunTemplaterTemplate()]);
    if (which === 'lazy-scaffold' || which === 'all') results.push(['T4.0 lazy-scaffold', await testLazyScaffold()]);
```
- new:
```
    if (which === 'cowork-hub' || which === 'all') results.push(['R-COWORK-HUB cowork-hub-openlink', await testCoworkHubOpenLink()]);
    if (which === 'lazy-scaffold' || which === 'all') results.push(['T4.0 lazy-scaffold', await testLazyScaffold()]);
```

- [ ] **Step 7: Verify the deletes didn't damage the file.**

Run: `grep -c "cowork-weekly-this\|cowork-monthly-this\|testCoworkWeeklyThisRunTemplaterTemplate\|testCoworkMonthlyThisRunTemplaterTemplate\|R-COWORK-WEEKLY-THIS\|R-COWORK-MONTHLY-THIS" platform/test/run-renderer.js`
Expected: `0`.

Run: `node -c platform/test/run-renderer.js && echo "syntax OK"`
Expected: `syntax OK`.

Run the renderer suite to confirm green:
```
node platform/test/run-renderer.js
```
Expected: exit 0; PASS lines for all remaining cases including R-COWORK-HUB.

- [ ] **Step 8: Commit + push.**

```bash
git add platform/test/run-renderer.js
git commit -m "$(cat <<'EOF'
test(renderer): v0.43.0 T4 — drop 2 cowork runTemplaterTemplate cases

Remove R-COWORK-WEEKLY-THIS + R-COWORK-MONTHLY-THIS test functions +
their main-switch entries + their selector help-comment names + their
top-of-file documentation lines. The two nav-buttons being tested are
removed in T3 (cowork@0.5.0 manifest delta) so the cases no longer have
a target. R-COWORK-HUB stays.

Renderer case count: 39 → 37.
EOF
)"
git push origin main
```

---

## Task T5: Add Timeframe-helper assertions to run-cowork-smoke.js

**Files:**
- Modify: `platform/test/run-cowork-smoke.js`

- [ ] **Step 1: Inspect current shape.**

Run: `awk 'NR>=240 && NR<=297' platform/test/run-cowork-smoke.js`

You'll see `checkTimeframeContracts()` (T1-T6) followed by the `main()` IIFE. The new asserts append to the END of `checkTimeframeContracts()` (so they execute alongside the existing T1-T6 timeframe surface checks).

- [ ] **Step 2: Append T7 + T8 asserts to checkTimeframeContracts().**

Use Edit. Replace the closing brace of `checkTimeframeContracts()` and the blank line + comment that follows. Find this exact block:
- old:
```
  // T6 — scaffold-timeframes SKILL.md source exists in claude_surface[]
  const scaffoldSkill = (manifest.claude_surface || []).find(
    e => e.kind === "skill" && e.source === "skills/skills/scaffold-timeframes/SKILL.md"
  );
  assertTrue(!!scaffoldSkill, "T6: claude_surface[] declares scaffold-timeframes skill");
  const scaffoldSrc = path.join(BP, "skills/skills/scaffold-timeframes/SKILL.md");
  assertTrue(fs.existsSync(scaffoldSrc), "T6: scaffold-timeframes SKILL.md source file exists");
}
```
- new:
```
  // T6 — scaffold-timeframes SKILL.md source exists in claude_surface[]
  const scaffoldSkill = (manifest.claude_surface || []).find(
    e => e.kind === "skill" && e.source === "skills/skills/scaffold-timeframes/SKILL.md"
  );
  assertTrue(!!scaffoldSkill, "T6: claude_surface[] declares scaffold-timeframes skill");
  const scaffoldSrc = path.join(BP, "skills/skills/scaffold-timeframes/SKILL.md");
  assertTrue(fs.existsSync(scaffoldSrc), "T6: scaffold-timeframes SKILL.md source file exists");

  // T7 — v0.43.0: CoworkTimeframeButtons helper file exists + manifest registers it.
  const tfHelperSrc = path.join(BP, "helpers/cowork-timeframe-buttons.js");
  assertTrue(fs.existsSync(tfHelperSrc), "T7: helpers/cowork-timeframe-buttons.js source exists");
  const tfHelperBody = fs.existsSync(tfHelperSrc) ? fs.readFileSync(tfHelperSrc, "utf8") : "";
  assertTrue(/class\s+CoworkTimeframeButtons\b/.test(tfHelperBody),
    "T7: helper body declares class CoworkTimeframeButtons");
  assertTrue(/_dispatch\s*\(/.test(tfHelperBody),
    "T7: helper body has _dispatch method");
  assertTrue(/create_new_note_from_template/.test(tfHelperBody),
    "T7: helper body invokes Templater.create_new_note_from_template (runTemplaterTemplate mirror)");
  const tfHelperEntry = filesArr.find(f => f.source === "helpers/cowork-timeframe-buttons.js");
  assertTrue(!!tfHelperEntry && tfHelperEntry.dest === "{{scripts_path}}/cowork/cowork-timeframe-buttons.js",
    "T7: manifest files[] maps helper to {{scripts_path}}/cowork/cowork-timeframe-buttons.js");
  const cjsClasses = manifest.customjs_classes || [];
  assertTrue(cjsClasses.includes("CoworkTimeframeButtons"),
    "T7: manifest customjs_classes[] includes CoworkTimeframeButtons");

  // T8 — v0.43.0: Cowork.md Timeframes section delegates via customjs-guard
  // to CoworkTimeframeButtons (replaces the v0.42.0 inline 3-card block).
  const coworkMdSrc = path.join(BP, "content/Cowork.md");
  const coworkMdBody = fs.existsSync(coworkMdSrc) ? fs.readFileSync(coworkMdSrc, "utf8") : "";
  assertTrue(/^##\s+Timeframes\s*$/m.test(coworkMdBody),
    "T8: Cowork.md retains the ## Timeframes heading");
  assertTrue(/customjs-guard.*class:\s*"CoworkTimeframeButtons"/.test(coworkMdBody),
    "T8: Cowork.md Timeframes section delegates to CoworkTimeframeButtons via customjs-guard");
  assertTrue(!/items:\s*cardItems/.test(coworkMdBody) && !/titleField/.test(coworkMdBody) && !/subtitleField/.test(coworkMdBody) && !/linkField/.test(coworkMdBody),
    "T8: Cowork.md no longer contains the v0.42.0 broken BeaconCards call (items/titleField/subtitleField/linkField)");

  // T9 — v0.43.0: nav_buttons[] retains only cowork-hub (the 2 timeframe-creation
  // buttons moved inside Cowork.md as cards in T2).
  const navBtns = manifest.nav_buttons || [];
  assertTrue(navBtns.length === 1,
    `T9: manifest.nav_buttons[].length === 1 (got ${navBtns.length})`);
  assertTrue(navBtns[0] && navBtns[0].id === "cowork-hub",
    "T9: nav_buttons[0].id === 'cowork-hub'");
  assertTrue(!navBtns.some(b => b.id === "cowork-weekly-this" || b.id === "cowork-monthly-this"),
    "T9: nav_buttons[] no longer contains cowork-weekly-this or cowork-monthly-this");
}
```

- [ ] **Step 3: Run the smoke harness.**

Run: `node platform/test/run-cowork-smoke.js`
Expected: exit 0. Result line: `Result: <N> passed, 0 failed.` where N grew by ~10 from the v0.42.0 baseline (T7 contributes 6, T8 contributes 3, T9 contributes 3).

- [ ] **Step 4: Commit + push.**

```bash
git add platform/test/run-cowork-smoke.js
git commit -m "$(cat <<'EOF'
test(cowork-smoke): v0.43.0 T5 — add T7/T8/T9 nav-consolidation asserts

T7 — CoworkTimeframeButtons helper file present + class declared +
  _dispatch method + Templater invocation + customjs_classes[]
  registration + files[] mapping.
T8 — Cowork.md Timeframes section delegates via customjs-guard to
  CoworkTimeframeButtons; no v0.42.0 broken BeaconCards call shape
  (items/titleField/subtitleField/linkField) remains.
T9 — nav_buttons[] is exactly cowork-hub; the 2 v0.4.0 timeframe-
  creation buttons are absent.
EOF
)"
git push origin main
```

---

## Task T6: Add nav-button registry assertion to run-integration-smoke.js

**Files:**
- Modify: `platform/test/run-integration-smoke.js`

- [ ] **Step 1: Locate the post-reinstall section.**

Run: `awk 'NR>=100 && NR<=125' platform/test/run-integration-smoke.js`

You'll find the existing `smoke-cowork-{daily,weekly,monthly}-hub-exists` asserts after the reinstall step. The new assertion goes immediately after them — before any subsequent setup or tear-down.

- [ ] **Step 2: Add the registry assertion.**

Use Edit. Find this exact block (the line numbers may shift slightly; match the literal text):
- old:
```
    ok("smoke-cowork-monthly-hub-exists",
        fs.existsSync(path.join(coworkDir, "Monthly Hub.md")),
        `path=${path.join(coworkDir, "Monthly Hub.md")}`);
```
- new:
```
    ok("smoke-cowork-monthly-hub-exists",
        fs.existsSync(path.join(coworkDir, "Monthly Hub.md")),
        `path=${path.join(coworkDir, "Monthly Hub.md")}`);

    // v0.43.0: nav-button consolidation. cowork@0.5.0 contributes exactly
    // 1 global nav-button (cowork-hub); the v0.4.0 cowork-weekly-this +
    // cowork-monthly-this entries should NOT appear in the registry after
    // a fresh install.
    const navRegPath = path.join(vault, "ranch", "nav-buttons-registry.json");
    let navReg = null;
    try { navReg = JSON.parse(fs.readFileSync(navRegPath, "utf8")); }
    catch (e) { /* leave null; assertion below will surface */ }
    const coworkContribs = (navReg && navReg.contributions && Array.isArray(navReg.contributions.cowork))
        ? navReg.contributions.cowork : [];
    ok("smoke-cowork-nav-contributions-length-1",
        coworkContribs.length === 1,
        `expected contributions.cowork[].length === 1, got ${coworkContribs.length} (registry path=${navRegPath})`);
    ok("smoke-cowork-nav-only-cowork-hub",
        coworkContribs.length === 1 && coworkContribs[0] && coworkContribs[0].id === "cowork-hub",
        `expected contributions.cowork[0].id === "cowork-hub", got id=${coworkContribs[0] && coworkContribs[0].id}`);
```

- [ ] **Step 3: Run the harness (note: this test bootstraps a tmp vault — it is slow but self-contained).**

Run: `node platform/test/run-integration-smoke.js`
Expected: exit 0. Final summary shows the new `smoke-cowork-nav-contributions-length-1` + `smoke-cowork-nav-only-cowork-hub` lines as PASS.

- [ ] **Step 4: Commit + push.**

```bash
git add platform/test/run-integration-smoke.js
git commit -m "$(cat <<'EOF'
test(integration-smoke): v0.43.0 T6 — assert cowork nav contribution = 1

After bootstrap-then-reinstall-with-cowork, ranch/nav-buttons-registry.json
must show contributions.cowork[].length === 1 and the single entry must
be cowork-hub. Catches future regressions if the manifest re-introduces
sub-blueprint global nav-buttons.
EOF
)"
git push origin main
```

---

## Task T7: Workshop catalogue + lockstep bumps + tag (controller-direct)

**Files:**
- Modify: `platform/manifest.json`
- Modify: `package.json`
- Tag: `v0.43.0` annotated

This task is controller-direct (NOT a subagent dispatch) because tag creation + push interact with the release workflow.

- [ ] **Step 1: Bump cowork row in workshop blueprint catalogue.**

In `platform/manifest.json`, find the blueprint catalogue section. Use Edit to change the cowork row's version from `0.4.0` to `0.5.0`. The exact line will look like:
- old: `    { "name": "cowork", "version": "0.4.0" },`
- new: `    { "name": "cowork", "version": "0.5.0" },`

(The exact spacing matches the existing rows — preserve it.)

- [ ] **Step 2: Bump workshop_version + date.**

In `platform/manifest.json`, change:
- `"workshop_version": "0.42.0"` → `"workshop_version": "0.43.0"`
- `"date": "2026-05-13"` → `"date": "2026-05-14"` (or whatever the close date is)

- [ ] **Step 3: Bump package.json version.**

In `package.json`, change `"version": "0.42.0"` → `"version": "0.43.0"`.

- [ ] **Step 4: Run release preflight.**

```
npm run release:preflight
```

Expected: exit 0. The `scripts/check-version-sync.js` check runs first and confirms package.json + workshop_version match. The full whole-suite (run-claude-surface, run-helper-cases, run-renderer, run-bootstrap, run-cli, run-install-sh, run-migrate, run-migrate-layout, run-registry, run-doctor-self, run-audit, run-cowork-smoke, run-seed, run-integration-smoke) all run. If anything fails, STOP and investigate.

- [ ] **Step 5: Commit lockstep bumps.**

```bash
git add platform/manifest.json package.json
git commit -m "$(cat <<'EOF'
chore(release): v0.43.0 — workshop_version + package.json lockstep + cowork catalogue

- platform/manifest.json: workshop_version 0.42.0 → 0.43.0; date
  2026-05-14; cowork blueprint catalogue row 0.4.0 → 0.5.0
- package.json: 0.42.0 → 0.43.0 (lockstep, gated by
  scripts/check-version-sync.js)

Cycle: cowork nav consolidation. cowork@0.4.0 → 0.5.0 (MINOR).
Spec: Docs/plans/2026-05-14-cowork-nav-consolidation-design.md
Plan: Docs/plans/2026-05-14-cowork-nav-consolidation-plan.md
EOF
)"
git push origin main
```

- [ ] **Step 6: Tag v0.43.0 annotated and push the tag.**

```bash
git tag -a v0.43.0 -m "v0.43.0 — cowork nav consolidation: 3 global nav-buttons → 1"
git push origin v0.43.0
```

The release.yml preflight job + bump-tap job will run on the tag push. Per FLN-D3 the resulting tap PR may need manual merge until that fix lands.

---

## Task T8: Deploy to headspace (controller-direct)

**Files (in headspace consumer vault, NOT this repo):**
- Modify: `/Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/platform-subscription.json`

Controller-direct because this task touches a separate repo / vault outside the workshop.

- [ ] **Step 1: Verify headspace's current cowork pin.**

Run: `jq '.workshop_version, (.blueprints[] | select(.name == "cowork"))' /Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/platform-subscription.json`
Expected: `"0.42.0"` then `{"name": "cowork", "version": "0.4.0"}`.

If the workshop_version pin or cowork pin differs from these values, STOP and reconcile manually before proceeding (out-of-band drift may indicate other deploys happened mid-cycle).

- [ ] **Step 2: Bump pins.**

Use Edit on `/Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/platform-subscription.json`:
- `"workshop_version": "0.42.0"` → `"workshop_version": "0.43.0"`
- `"name": "cowork", "version": "0.4.0"` → `"name": "cowork", "version": "0.5.0"`

- [ ] **Step 3: Run sauce reinstall.**

```
sauce reinstall --vault /Users/willfellhoelter/notes/sauce/headspace-sauce
```

Expected: exit 0. Install side effects (look for these in the output):
- `[Notice] cowork@0.5.0 installed. Global nav-bar footprint reduced...` (the new post_install notice).
- 1 file overwrite for `Cowork.md` (with `.bak` written by installer).
- 1 new file at `ranch/scripts/cowork/cowork-timeframe-buttons.js`.

- [ ] **Step 4: Verify nav-buttons-registry shrank.**

Run: `jq '.contributions.cowork | length, [.contributions.cowork[].id]' /Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/nav-buttons-registry.json`
Expected:
```
1
[
  "cowork-hub"
]
```

- [ ] **Step 5: Verify the helper materialized.**

Run: `ls -la /Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/scripts/cowork/cowork-timeframe-buttons.js`
Expected: file present, non-zero size.

Run: `grep -c "class CoworkTimeframeButtons\|_dispatch\|create_new_note_from_template" /Users/willfellhoelter/notes/sauce/headspace-sauce/ranch/scripts/cowork/cowork-timeframe-buttons.js`
Expected: `3`.

- [ ] **Step 6: Verify the Cowork.md body updated.**

Run: `grep -nE "^## Timeframes|customjs-guard.*CoworkTimeframeButtons|titleField|subtitleField|linkField" /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/cowork/Cowork.md`
Expected: 2 lines:
- the `## Timeframes` heading
- the `await dv.view("ranch/views/customjs-guard", { class: "CoworkTimeframeButtons" });` line
- (no `titleField` / `subtitleField` / `linkField` matches — the broken inline call is gone)

- [ ] **Step 7: Done — write the result doc (next, not part of this task's checklist).**

The result doc T9 captures the deploy outcome + user-facing testing checklist for in-Obsidian smoke validation.

---

## Self-review notes (post-plan-write)

- **Spec coverage:** every section of the design doc maps to a task: helper body → T1; Cowork.md rewrite → T2; manifest delta → T3; harness deltas (renderer drop, smoke add, integration assert) → T4-T6; lockstep bumps + tag → T7; headspace deploy → T8.
- **Placeholder scan:** none.
- **Type consistency:** the helper class name `CoworkTimeframeButtons` is referenced consistently across T1 (declaration), T2 (Cowork.md customjs-guard arg), T3 (`customjs_classes[]` registration), T5 (smoke assertion), T8 (post-deploy verification).
- **Task pacing:** T1-T6 each fit a single subagent dispatch. T7 + T8 are controller-direct (release tag + cross-repo deploy). After T8 completes, controller writes the result doc + commits + pushes.
