# Meetings Blueprint Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the meetings blueprint — drop Agenda + dead Action Items, add pinned-links (sticky pattern), an optional date/time prompt, and a single persistent browsable Meetings hub — with a backup-first install heal that updates every existing meeting note across all vaults.

**Architecture:** Mirror two existing blueprints exactly. **Reader** is the reference for the single-persistent-hub pattern (`nav_buttons` `openLink` + a `scaffold` install heal that creates the hub note). **Sticky-notes** is the reference for pinned-links (`ChromeBar` calls `SectionExplorer.renderNoteLinks` + an `add-link` overflow action). A new backup-first idempotent install heal (`applyMeetingChromeModernizeHeal`, sentinel `<!-- meeting-chrome-modernized -->`) rewrites existing leaf notes; a hub scaffold+archive heal creates `Meetings.md` and moves old per-day hubs to `_archive/`.

**Tech Stack:** CustomJS (bare-class files, no trailing statements), Templater templates, Dataview, Obsidian vault adapter API, Node test harnesses (`platform/test/run-*.js`), JSON manifests.

---

## File Structure

**Modify:**
- `platform/blueprints/meetings/templates/Meeting.md` — leaf template: drop Agenda + Action Items, add optional datetime prompt, `links: []` frontmatter.
- `platform/blueprints/meetings/manifest.json` — `new_entity_buttons` (datetime prompt, links, body, `render_in`→persistent hub), `nav_buttons` (→`openLink` persistent hub), `depends_on` (+section-explorer), version bump.
- `platform/blueprints/meetings/helpers/meeting-chrome-bar.js` — leaf: call `renderNoteLinks`; add `add-link` overflow + dispatch (sticky pattern).
- `platform/migrate/migrators/meetings-note.js` — `_renderBody`: fold legacy Agenda into Notes, drop Action Items.
- `platform/migrate/migrators/meetings-hub.js` — retarget to persistent-hub model.
- `platform/install.js` — register two new heals; extend the leaf heal ordering.

**Create:**
- `platform/blueprints/meetings/templates/Meetings.md` — persistent hub template (scaffolded by heal).
- `platform/blueprints/meetings/helpers/meetings-browse-list.js` — `MeetingsBrowseList` (all-meetings, frontmatter-sourced, month-grouped).
- `platform/test/run-meetings-browse-list.js` — browse-list harness.
- `platform/test/run-meetings-chrome-modernize-heal.js` — leaf-heal harness.
- `platform/test/run-meetings-hub-scaffold-archive-heal.js` — hub scaffold+archive harness.

**Retire (keep file, stop wiring):**
- `platform/blueprints/meetings/helpers/meetings-hub-cards.js` — superseded by `MeetingsBrowseList`; leave in place for archived hubs but remove from the new hub template.

---

## Task 1: Add `section-explorer` dependency + `links` schema to meetings manifest

**Files:**
- Modify: `platform/blueprints/meetings/manifest.json`
- Modify: `platform/schemas-index.json` (or the meeting frontmatter schema it points at)

- [ ] **Step 1: Add section-explorer to `depends_on`**

In `platform/blueprints/meetings/manifest.json`, the `depends_on` array currently lists `nav-buttons, customjs-guard, accent-button, people-rendering, section-label, task-interactions, chrome-bar` (and others). Add an entry for `section-explorer` matching the existing entry shape (copy the shape of a sibling entry — likely `{"name":"section-explorer","version":">=0.6.0"}` or a bare string, whichever the file uses). Verify the current shape first:

```bash
python3 -c "import json;print(json.dumps(json.load(open('platform/blueprints/meetings/manifest.json'))['depends_on'],indent=1))"
```

Match that exact shape. section-explorer is at `0.6.0`.

- [ ] **Step 2: Add `links` to the meeting frontmatter schema**

```bash
grep -rn "\"meeting\"\|meeting frontmatter\|type.*meeting" platform/schemas-index.json | head
```

Locate the meeting schema (or the schema file it references). Add a `links` field: an array of `{url:string, text:string}` objects, optional, default `[]`. Follow the exact schema-entry shape used by sticky-notes' `links` (grep `platform/blueprints/sticky-notes/manifest.json` and the schema for `links` and copy it).

- [ ] **Step 3: Lint schemas**

Run: `npm run lint-schemas`
Expected: PASS (no schema errors).

- [ ] **Step 4: Commit**

```bash
git add platform/blueprints/meetings/manifest.json platform/schemas-index.json
git commit -m "feat(meetings): declare section-explorer dep + links frontmatter schema"
```

---

## Task 2: Rewrite the leaf template `Meeting.md`

**Files:**
- Modify: `platform/blueprints/meetings/templates/Meeting.md`

- [ ] **Step 1: Add the optional datetime prompt to the Templater header**

Immediately after the attendee-picker loop closes (`-%>` on the line before the `---` frontmatter open, currently line 47), and before the `---`, add:

```
<%*
// Optional explicit meeting date/time. Blank → creation time (prior behavior).
let _dtInput = await tp.system.prompt("Meeting date & time (optional, e.g. 2026-07-13 14:30) — blank = now:", "");
let _dt = null;
if (_dtInput && _dtInput.trim()) {
  const _m = window.moment(_dtInput.trim(), ["YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm", "YYYY-MM-DD"], true);
  if (_m.isValid()) _dt = _m;
}
const _dateIso = _dt ? _dt.format("YYYY-MM-DDTHH:mm:ssZ") : tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ");
-%>
```

- [ ] **Step 2: Use `_dateIso` for the `date` frontmatter and add `links: []`**

Change the frontmatter `date:` line (currently `date: <% tp.file.creation_date(...) %>`) to `date: <% _dateIso %>`. Leave `created_at` as the creation date. Add `links: []` to the frontmatter (after `summary: ""`).

- [ ] **Step 3: Remove the Agenda + Action Items body blocks**

Delete these blocks entirely (current lines 91–97): the `-` seed under Notes stays, but remove the standalone `SectionLabel "Action Items"` fence AND the `<!-- ACTION_ITEMS_MARKER -->` line. There is no "Agenda" block in the current workshop template (already dropped) — confirm none remains. Final body order must be: `MeetingChromeBar` → `SectionLabel "Attendees" {top}` + PeopleRendering chips → `SectionLabel "Notes"` + `-` → `SectionLabel "Tasks"` → `TaskMeetingList`.

- [ ] **Step 4: Verify template shape**

Run:
```bash
grep -c "Action Items\|ACTION_ITEMS_MARKER\|Agenda" platform/blueprints/meetings/templates/Meeting.md
```
Expected: `0`

```bash
grep -c "TaskMeetingList\|_dateIso\|links: \[\]" platform/blueprints/meetings/templates/Meeting.md
```
Expected: `3`

- [ ] **Step 5: Commit**

```bash
git add platform/blueprints/meetings/templates/Meeting.md
git commit -m "feat(meetings): drop Agenda/Action-Items from template, add optional date/time prompt + links frontmatter"
```

---

## Task 3: Wire pinned-links into `MeetingChromeBar` (sticky pattern)

**Files:**
- Modify: `platform/blueprints/meetings/helpers/meeting-chrome-bar.js`
- Test: `platform/test/run-meeting-chrome-bar.js`

- [ ] **Step 1: Read the sticky reference exactly**

```bash
sed -n '15,35p;245,310p' platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js
```
Note: sticky calls `this._maybeRenderPinnedLinks(dv)` after `ChromeBar.render`, and has an `add-link` overflow item `{ id:"add-link", label:"Add link…", icon: ICON.link }` whose dispatch calls `customJS.SectionExplorer._openAddLinkForm(dv, customJS.SectionExplorer._noteSelfAdapter(page), null)`.

- [ ] **Step 2: Add a `link` icon to `MeetingChromeBar.ICON`**

In the `ICON` getter, add (copy the exact SVG from sticky's `ICON.link`):

```js
link: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
```

- [ ] **Step 3: Render pinned links after the bar (leaf only)**

Change `render(dv)` so that after `customJS.ChromeBar.render(...)` returns, it renders links for the leaf context. Wrap in a guard that only runs when the page is a meeting leaf (not the hub). Add:

```js
render(dv) {
  try {
    if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
      || typeof customJS.ChromeBar.render !== "function") return;
    const out = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    this._maybeRenderPinnedLinks(dv);
    return out;
  } catch (_e) { /* never throw */ }
}

_maybeRenderPinnedLinks(dv) {
  try {
    const page = (customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function")
      ? customJS.RenderSafe.page(dv) : (dv.current && dv.current());
    if (!page || page.type !== "meeting") return; // leaf only; hub has no type
    if (customJS && customJS.SectionExplorer && typeof customJS.SectionExplorer.renderNoteLinks === "function") {
      customJS.SectionExplorer.renderNoteLinks(dv);
    }
  } catch (_e) { /* never throw */ }
}
```

- [ ] **Step 4: Add the `add-link` overflow item + dispatch**

In `surfaceSpec` for the leaf (non-hub) branch, add to the `overflow` array (after `edit-attendees`):

```js
{ id: "add-link", label: "Add link…", icon: ICON.link },
```

In `dispatch`, add a handler (after the `edit-attendees` block):

```js
if (id === "add-link") {
  const page = (customJS && customJS.RenderSafe && typeof customJS.RenderSafe.page === "function")
    ? customJS.RenderSafe.page(dv) : (dv.current && dv.current());
  if (customJS && customJS.SectionExplorer && typeof customJS.SectionExplorer._openAddLinkForm === "function"
    && typeof customJS.SectionExplorer._noteSelfAdapter === "function" && page) {
    customJS.SectionExplorer._openAddLinkForm(dv, customJS.SectionExplorer._noteSelfAdapter(page), null);
  } else if (typeof Notice === "function") { new Notice("MeetingChromeBar: SectionExplorer unavailable — reinstall meetings blueprint.", 6000); }
  return;
}
```

- [ ] **Step 5: Extend the harness**

In `platform/test/run-meeting-chrome-bar.js`, add an assertion that the leaf `surfaceSpec` overflow includes an item with `id === "add-link"`, and that `dispatch(dv, ctx, "add-link")` calls a `SectionExplorer._openAddLinkForm` spy. Follow the existing harness's stub style (grep the file for how it stubs `customJS`).

- [ ] **Step 6: Run harness**

Run: `node platform/test/run-meeting-chrome-bar.js`
Expected: all assertions PASS.

- [ ] **Step 7: Run the customjs-loadable gate for the edited helper**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS (no bare-class trailer regressions).

- [ ] **Step 8: Commit**

```bash
git add platform/blueprints/meetings/helpers/meeting-chrome-bar.js platform/test/run-meeting-chrome-bar.js
git commit -m "feat(meetings): pinned links + Add-link action on meeting notes (sticky pattern)"
```

---

## Task 4: Create the persistent hub template + `MeetingsBrowseList` helper

**Files:**
- Create: `platform/blueprints/meetings/templates/Meetings.md`
- Create: `platform/blueprints/meetings/helpers/meetings-browse-list.js`
- Test: `platform/test/run-meetings-browse-list.js`

- [ ] **Step 1: Write the browse-list harness first (TDD)**

Create `platform/test/run-meetings-browse-list.js`. Load the helper via `new Function(src + "\nreturn MeetingsBrowseList;")()` (the CustomJS bare-class pattern — see the header comment in `task-meeting-list.js`). Assert the static pure helper `MeetingsBrowseList._monthKey(dateStr)` groups `"2026-07-13T09:00:00Z"` → `"2026-07"`, and `MeetingsBrowseList._attendeeNames(page)` reads names from `page.attendees` (array of `"[[Name]]"` strings) → `["Name"]`, falling back to `page.people`. Assert an empty/undefined page yields `[]` (never throws).

- [ ] **Step 2: Run harness to verify it fails**

Run: `node platform/test/run-meetings-browse-list.js`
Expected: FAIL (`MeetingsBrowseList is not defined` / file missing).

- [ ] **Step 3: Implement `MeetingsBrowseList`**

Create `platform/blueprints/meetings/helpers/meetings-browse-list.js` as a bare class (NO trailing statements — the CustomJS loader wraps the file in `(...)`). Model the render method on `MeetingsHubCards` (BeaconCards row layout) but:
- Query ALL meetings: `dv.pages('"spice/meetings/notes"')` (NO date filter).
- Sort by `date` desc (fall back to filename).
- Attendees from frontmatter via the static `_attendeeNames(page)` (strip `[[ ]]`, prefer `attendees`, fall back to `people`) — NOT body regex.
- Open-task count via the same live query `TaskMeetingList` uses: `dv.pages('"spice/tasks"').where(p => p.type==='task' && p.status==='open' && !p.file.path.includes('/_trash/') && !p.file.path.includes('/_done/'))`, matched by `source_note` basename === the meeting basename. Compute a `{basename: count}` map once, not per-row.
- Group cards under month sub-headings using `_monthKey`.
- Cold-load safe (`RenderSafe.page` guard, never throw).

Static pure helpers (Node-testable): `_monthKey(dateStr)`, `_attendeeNames(page)`.

- [ ] **Step 4: Run harness to verify it passes**

Run: `node platform/test/run-meetings-browse-list.js`
Expected: PASS.

- [ ] **Step 5: Run the customjs-loadable gate**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 6: Write the persistent hub template**

Create `platform/blueprints/meetings/templates/Meetings.md` (model on `Reader.md` — read it first: `cat platform/blueprints/reader/templates/Reader.md`). Frontmatter: `tags: ["{{vault_identity_tag}}", meetings-hub]`, `cssclasses: [wide]`, NO `type:`. Body:

```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MeetingChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Meetings", top: true }] });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "MeetingsBrowseList" });
```
```

NO trailing literal `---`.

- [ ] **Step 7: Commit**

```bash
git add platform/blueprints/meetings/helpers/meetings-browse-list.js platform/blueprints/meetings/templates/Meetings.md platform/test/run-meetings-browse-list.js
git commit -m "feat(meetings): persistent Meetings hub + MeetingsBrowseList (all meetings, frontmatter-sourced, month-grouped)"
```

---

## Task 5: Point creation + nav at the persistent hub

**Files:**
- Modify: `platform/blueprints/meetings/manifest.json`

- [ ] **Step 1: Change `nav_buttons` to open the persistent hub**

Read the reader reference: `python3 -c "import json;print(json.load(open('platform/blueprints/reader/manifest.json'))['nav_buttons'])"`. Change the meetings `nav_buttons[0].action` from the `runTemplaterTemplate` (dated-hub) block to:

```json
{ "type": "openLink", "target": "{{module_directory}}/Meetings.md" }
```

Keep `id`, `label`, `icon`, `order` unchanged.

- [ ] **Step 2: Retarget the EntityCreate `render_in`**

In `new_entity_buttons[0].render_in`, change `target_path` from `{{templates_path}}/Meeting Hub.md` to `{{templates_path}}/Meetings.md` (so a newly created meeting refreshes/opens the persistent hub, matching reader's `+ New article` behavior). Keep `kind: "hub"`.

- [ ] **Step 3: Rewrite the EntityCreate `inline_body` to match the leaf template**

Set `new_entity_buttons[0].inline_body` to the Section-1 body shape (drop Agenda + Action Items + dead marker). The body must be:

```
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MeetingChromeBar" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Attendees", top: true }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
 class: "PeopleRendering",
 method: "renderMentionList",
 args: [{ mode: "mentioned_in_note", notePath: (dv.current()?.file?.path || app.workspace.getActiveFile()?.path), scopePath: "spice/people" }, { style: "chips" }]
});
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });
```

-

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Tasks" }] });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskMeetingList" });
```
```

Set it as the JSON string value of `inline_body` (escaped `\n`). Also add `"links": []` to `frontmatter_template` and add an optional datetime prompt to `prompts` (a `{"key":"datetime","label":"Date & time (optional, blank = now)","type":"string","required":false}`), and set `frontmatter_template.date` to `{{prompts.datetime|default:now.YYYY-MM-DDTHH:mm:ssZ}}` IF EntityCreate supports a `|default:` filter — otherwise leave `date` as `{{now...}}` and note that the button path uses now (the Templater path honors the prompt). Verify filter support:

```bash
grep -n "default:\|prompts\.\|_applyFilter\|split('|')" platform/mechanisms/entity-create/*.js | head
```
If no filter support exists, keep `date: {{now.YYYY-MM-DDTHH:mm:ssZ}}` and rely on the Templater path for backdating (acceptable — the button is the quick path).

- [ ] **Step 4: Bump the meetings blueprint version**

Bump `version` in `platform/blueprints/meetings/manifest.json` by one minor (e.g. `0.X.0` → `0.(X+1).0`). Do NOT touch any other version file — the release pipeline owns umbrella/pin bumps.

- [ ] **Step 5: Validate the manifest parses**

Run: `python3 -c "import json;json.load(open('platform/blueprints/meetings/manifest.json'));print('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add platform/blueprints/meetings/manifest.json
git commit -m "feat(meetings): single persistent hub — nav openLink + EntityCreate render_in + modern body"
```

---

## Task 6: Leaf-note install heal `applyMeetingChromeModernizeHeal`

**Files:**
- Modify: `platform/install.js`
- Test: `platform/test/run-meetings-chrome-modernize-heal.js`

- [ ] **Step 1: Study the reference heal + folding helpers**

```bash
sed -n '11564,11675p' platform/install.js   # applyMeetingTasksToEntityMigration (posture, _backupAndWrite, sentinel)
grep -n "_backupAndWrite\|_listAllMarkdownRecursive\|_localIsoNoMillis" platform/install.js | head
```
Reuse `_backupAndWrite`, `_walk`/`_listAllMarkdownRecursive`. The new heal MUST run AFTER `applyMeetingTaskListHeal` (so the `Tasks`/`TaskMeetingList` block exists) and AFTER `applyMeetingTasksToEntityMigration` (so `- [ ]` lines are already converted). Register the call right after `applyMeetingTaskListHeal(...)` (line ~596 region).

- [ ] **Step 2: Write the heal harness first (TDD)**

Create `platform/test/run-meetings-chrome-modernize-heal.js`. It must load the pure transform from install.js. Extract a PURE function `_modernizeMeetingBody(body)` (added in Step 3) and test it via `new Function`. Assert:
1. A body with an `Agenda` `SectionLabel` fence + non-empty `- Discuss X` seed → Agenda content `Discuss X` appears under the Notes section, Agenda fence removed.
2. A body with an `Action Items` `SectionLabel` fence + `<!-- ACTION_ITEMS_MARKER -->` → both removed.
3. Tasks block (`TaskMeetingList`) preserved and present exactly once.
4. Idempotency: `_modernizeMeetingBody(_modernizeMeetingBody(x)) === _modernizeMeetingBody(x)`.
5. A body with no Agenda/Action-Items → returned unchanged.

- [ ] **Step 3: Run harness to verify it fails**

Run: `node platform/test/run-meetings-chrome-modernize-heal.js`
Expected: FAIL (`_modernizeMeetingBody is not defined`).

- [ ] **Step 4: Implement `_modernizeMeetingBody` (pure) + `applyMeetingChromeModernizeHeal`**

In `platform/install.js`, add a pure function:

```js
// _modernizeMeetingBody — pure, idempotent. Removes the legacy "Agenda" and
// "Action Items" SectionLabel fences + the dead <!-- ACTION_ITEMS_MARKER -->,
// folding any non-empty Agenda seed content into the Notes section. Leaves the
// Tasks/TaskMeetingList block (and everything else) intact. Returns input
// unchanged when neither legacy section is present.
function _modernizeMeetingBody(body) {
  if (typeof body !== "string") return body;
  let out = body;
  // 1. Capture Agenda seed content (lines between the Agenda fence and the next fence/marker).
  const agendaRe = /```dataviewjs\n[^`]*?class:\s*"SectionLabel",\s*args:\s*\[\{\s*text:\s*"Agenda"[^`]*?```\n?([\s\S]*?)(?=```dataviewjs|<!-- ACTION_ITEMS_MARKER -->|$)/;
  let agendaContent = "";
  const am = out.match(agendaRe);
  if (am && am[1]) {
    agendaContent = am[1].split("\n").map(l => l.trim())
      .filter(l => l && l !== "-").join("\n").trim();
    out = out.replace(agendaRe, "");
  }
  // 2. Remove the Action Items SectionLabel fence + dead marker.
  out = out.replace(/```dataviewjs\n[^`]*?class:\s*"SectionLabel",\s*args:\s*\[\{\s*text:\s*"Action Items"[^`]*?```\n?/g, "");
  out = out.replace(/<!--\s*ACTION_ITEMS_MARKER\s*-->\n?/g, "");
  // 3. Fold captured Agenda content into the Notes section (append after the Notes fence).
  if (agendaContent) {
    const notesRe = /(```dataviewjs\n[^`]*?class:\s*"SectionLabel",\s*args:\s*\[\{\s*text:\s*"Notes"[^`]*?```\n)/;
    if (notesRe.test(out)) {
      out = out.replace(notesRe, `$1\n${agendaContent}\n`);
    }
  }
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}
```

Then add the heal (model the wrapper on `applyMeetingTasksToEntityMigration`), sentinel `<!-- meeting-chrome-modernized -->`, root `spice/meetings/notes`, backup-first via `_backupAndWrite`, per-note try/catch, idempotent skip on sentinel, ensure frontmatter `links:` exists (add `links: []` after `summary:` if absent — string-level insert), stamp sentinel, never throw. Register the call:

```js
await applyMeetingChromeModernizeHeal(tp, installedNow.history, git);
```
directly after `await applyMeetingTaskListHeal(tp, installedNow.history, git);`.

- [ ] **Step 5: Run harness to verify it passes**

Run: `node platform/test/run-meetings-chrome-modernize-heal.js`
Expected: PASS (all 5 assertions).

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/test/run-meetings-chrome-modernize-heal.js
git commit -m "feat(meetings): install heal — remove Agenda/Action-Items from existing notes, fold Agenda into Notes, add links fm"
```

---

## Task 7: Hub scaffold + archive heal

**Files:**
- Modify: `platform/install.js`
- Test: `platform/test/run-meetings-hub-scaffold-archive-heal.js`

- [ ] **Step 1: Study the reader scaffold heal reference**

```bash
grep -n "applyReaderScaffoldHeal" platform/install.js
sed -n "$(grep -n 'async function applyReaderScaffoldHeal' platform/install.js | head -1 | cut -d: -f1),+60p" platform/install.js
```
Mirror its create-if-missing posture for `spice/meetings/Meetings.md` from the `Meetings.md` template content (read the installed template via the same mechanism reader uses).

- [ ] **Step 2: Write the harness first (TDD)**

Create `platform/test/run-meetings-hub-scaffold-archive-heal.js`. Test the PURE archive-path helper `_archivedHubPath(fpath)` (added Step 3): `spice/meetings/hubs/2026/07-July/Meetings-2026-07-13.md` → `spice/meetings/hubs/_archive/2026/07-July/Meetings-2026-07-13.md`; a path already under `_archive/` → returned unchanged (idempotent). Assert non-hub paths outside `spice/meetings/hubs/` are returned unchanged.

- [ ] **Step 3: Run harness to verify it fails**

Run: `node platform/test/run-meetings-hub-scaffold-archive-heal.js`
Expected: FAIL.

- [ ] **Step 4: Implement `_archivedHubPath` + `applyMeetingsHubScaffoldArchiveHeal`**

Add pure helper:

```js
// _archivedHubPath — pure. Maps a per-day hub note under spice/meetings/hubs/
// into the _archive/ subtree, preserving the relative path. Idempotent: a path
// already under _archive/ (or outside the hubs root) is returned unchanged.
function _archivedHubPath(fpath) {
  if (typeof fpath !== "string") return fpath;
  const ROOT = "spice/meetings/hubs/";
  if (!fpath.startsWith(ROOT)) return fpath;
  const rel = fpath.slice(ROOT.length);
  if (rel.startsWith("_archive/")) return fpath;
  return ROOT + "_archive/" + rel;
}
```

Then `applyMeetingsHubScaffoldArchiveHeal(tp, history, git)`:
1. Scaffold `spice/meetings/Meetings.md` if missing (from template content; backup-first not needed on create, but skip if exists).
2. Enumerate `spice/meetings/hubs/**` markdown (excluding anything already under `_archive/`), and for each, `adapter.write(_archivedHubPath(fp), content)` then remove the original — OR use `app.vault.rename`/`adapter` move if available; if only read/write/remove exist, write-then-remove with a backup snapshot first. Idempotent (skip already-archived), per-file try/catch, never throw. Push history entries like the other heals.

Register the call directly after `applyMeetingsHubChromeBarHeal(...)` (line ~547):

```js
await applyMeetingsHubScaffoldArchiveHeal(tp, installedNow.history, git);
```

- [ ] **Step 5: Run harness to verify it passes**

Run: `node platform/test/run-meetings-hub-scaffold-archive-heal.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/test/run-meetings-hub-scaffold-archive-heal.js
git commit -m "feat(meetings): scaffold persistent Meetings hub + archive legacy per-day hubs"
```

---

## Task 8: Update the legacy migrators

**Files:**
- Modify: `platform/migrate/migrators/meetings-note.js`
- Modify: `platform/migrate/migrators/meetings-hub.js`

- [ ] **Step 1: Drop Agenda/Action-Items emission in `meetings-note.js`**

In `_renderBody(rest, attendees)`, remove the `## Action Items` heading + its `extractSection` output entirely (task-entity owns action items). For `## Agenda/Questions`: keep extracting its content but fold it INTO the Notes section output instead of emitting a separate `## Agenda` heading. The rendered body must match the new leaf shape (chrome + Attendees + Notes[+folded agenda] + Tasks). Confirm no `## Agenda` / `## Action Items` string remains:

```bash
grep -c "## Agenda\|## Action Items" platform/migrate/migrators/meetings-note.js
```
Expected: `0` (Agenda extraction may reference the SOURCE heading `"## Agenda/Questions"` as a search key — that's a legacy-input match, keep it; only the OUTPUT headings must go). Adjust the assertion to check the output template literal specifically if the search key trips it.

- [ ] **Step 2: Retarget `meetings-hub.js` to the persistent model**

The per-day hub concept is retired. Change `meetings-hub.js` so it does NOT emit a per-day dated hub body that conflicts with the persistent hub. Simplest conforming change: have it write into the `_archive/` subtree (reusing the same relative scheme as the heal) so a fresh `sauce migrate` lands legacy hubs pre-archived, and let the install's `applyMeetingsHubScaffoldArchiveHeal` create the live `Meetings.md`. Update `_buildBody` only if archived hubs still need to render (they can keep the existing body — they're historical). If simpler, make the migrator a no-op for hubs with a logged note that the persistent hub is scaffolded on install.

- [ ] **Step 3: Run any migrator tests**

```bash
ls platform/test | grep -i "migrat\|meetings-note\|meetings-hub"
```
Run any that exist for these migrators. Expected: PASS. If none exist, verify both files still `node --check`:

```bash
node --check platform/migrate/migrators/meetings-note.js && node --check platform/migrate/migrators/meetings-hub.js && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add platform/migrate/migrators/meetings-note.js platform/migrate/migrators/meetings-hub.js
git commit -m "feat(meetings): migrators drop Agenda/Action-Items output, land legacy hubs pre-archived"
```

---

## Task 9: Seed-vault regression fixtures + full preflight

**Files:**
- Modify: `platform/test/seed-vault/**` (add meeting fixtures exercising the heal)
- Modify: `platform/blueprints/meetings/manifest.json` (seed-vault subscription, if separate)

- [ ] **Step 1: Read the migration-regression-net guide**

```bash
sed -n '1,80p' Docs/agent-guides/migration-regression-net.md
```
Follow the portable-sentinel pattern.

- [ ] **Step 2: Add a seed-vault leaf fixture with legacy Agenda + Action Items**

Add a meeting note under the seed vault's `spice/meetings/notes/**` containing a legacy Agenda `SectionLabel` fence with a `- Discuss roadmap` seed AND an Action Items fence + `<!-- ACTION_ITEMS_MARKER -->`. Add a per-day hub fixture under `spice/meetings/hubs/**`. Follow the exact fixture-authoring loop in the guide.

- [ ] **Step 3: Run the seed-vault harness**

```bash
node platform/test/run-seed-vault.js   # or the exact runner named in the guide
```
Expected: PASS — post-install, the fixture leaf has no Agenda/Action-Items, `Discuss roadmap` under Notes, `<!-- meeting-chrome-modernized -->` present, the hub fixture moved under `_archive/`, and `spice/meetings/Meetings.md` exists.

- [ ] **Step 4: Run the full preflight**

Run: `npm run release:preflight`
Expected: PASS (all harnesses green, including the three new ones + CJS-load gate + schema lint).

- [ ] **Step 5: Commit**

```bash
git add platform/test/seed-vault platform/blueprints/meetings/manifest.json
git commit -m "test(meetings): seed-vault fixtures for chrome-modernize + hub-archive heals"
```

---

## Task 10: Dogfood self-install + verify

**Files:** (generated dogfood copies — do not hand-edit source)

- [ ] **Step 1: Read the build-test-verify dogfood section**

```bash
grep -n "dogfool\|dogfood\|self-install\|npm run" Docs/agent-guides/build-test-verify.md | head
```

- [ ] **Step 2: Run the workshop status check**

Run: `npm run status`
Expected: clean; note the current workshop version.

- [ ] **Step 3: Confirm no stray version/pin edits**

```bash
git diff --stat main..HEAD -- package.json ranch/ platform/manifest.json 2>/dev/null
```
Expected: NO changes to `package.json`, `ranch/*` pins, or umbrella manifest (only the meetings blueprint `manifest.json` version bump from Task 5 is allowed). If anything else changed, revert it — the pipeline owns those.

- [ ] **Step 4: Final full preflight**

Run: `npm run release:preflight`
Expected: PASS.

---

## Task 11: PR, CI, release, brew, deploy

- [ ] **Step 1: Push the branch and open a PR to `main`**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat(meetings): blueprint overhaul — drop Agenda/Action-Items, persistent hub, links, migration heal" --body "$(cat <<'EOF'
## Summary
Modernizes the meetings blueprint to align with sticky/reader/wiki conventions.

- Drop Agenda + dead Action Items from template, EntityCreate body, and migrators (task-entity owns action items; Tasks renders once)
- Optional date/time prompt on creation (blank = now)
- Pinned links + "Add link…" on meeting notes (SectionExplorer, sticky pattern)
- Single persistent, browsable **Meetings** hub (all meetings, newest-first, month-grouped, frontmatter-sourced) replacing the per-day hub; legacy per-day hubs archived to `_archive/`
- Backup-first idempotent install heals update every existing meeting note across all vaults (fold Agenda into Notes, strip Action Items, add `links` frontmatter, scaffold hub, archive old hubs)
- Person notes already list their meetings (verified live) — no change

Design: `Docs/plans/2026-07-13-meetings-blueprint-overhaul-design.md`
Plan: `Docs/plans/2026-07-13-meetings-blueprint-overhaul-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI green, then merge**

Poll CI; only merge once all checks pass. Merge (squash) to `main`. Do NOT merge the auto-release PR — the pipeline auto-merges it.

- [ ] **Step 3: Wait for the auto-release PR to open + auto-merge + tag**

The bumper opens the release PR (auto-merges on green), tags, and ships to brew. Wait for the tag to appear.

- [ ] **Step 4: Wait for the brew tap PR, merge it, update brew**

Wait for the tap PR to open; merge it; then:
```bash
brew update && brew upgrade sauce
sauce --version
```
Confirm the new umbrella version.

- [ ] **Step 5: Deploy to all three consumer vaults**

```bash
node platform/deploy.js   # or the exact deploy entrypoint; verify allOk for accuris, headspace, ero
```
For each of accuris/headspace/ero, ensure the meetings blueprint subscription pin is current (bump the pin in each `ranch/platform-subscription.json` if needed, then `sauce update` with that vault as CWD). Expected: `allOk` — each vault shows the modernized meeting notes, the persistent `Meetings.md` hub, and archived legacy hubs.

- [ ] **Step 6: Verify live**

Spot-check one real note per vault: a meeting leaf has no Agenda/Action-Items and shows the links strip + Tasks once; `spice/meetings/Meetings.md` lists all meetings; `spice/meetings/hubs/_archive/` holds the old per-day hubs.
