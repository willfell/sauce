# Reader everywhere — nav consolidation, search cleanup, home capture, daily activity

## Context

v0.225.0 shipped the reader article paste-flow (`ReaderArticlePaste`): the reader-hub's
"+ New article" button opens a single paste+title+url dialog that parses a Web Clipper "Copy"
payload and creates a fully-populated `reader-article` note. Real-world use surfaced follow-ups:

1. The reader hub shows **two** "New article" entry points — the chrome-bar nav primary
   (`new-article`, wired straight to `EntityCreate.create`) **and** the legacy
   `ReaderArticleActions.renderCreateRow` button below the nav (wired to the paste dialog last
   cycle). Redundant; only the nav one should remain, and it should open the paste dialog.
2. The reader hub's search strip renders `#tag` chips (from `DocSearch`). They add noise; remove
   them.
3. The Home page's `+` quick-capture menu (`SpaceHome`) offers Meeting / Sticky Note (+ inline
   task) but not articles — add an "Article" item that opens the same paste dialog.
4. The daily/Home **Activity** panel (`SpaceDailyDashboard` → `ActivityFeed`) surfaces
   project / wiki / journal / sticky-note edits but not reader activity. Surface reader articles
   there: an article **added** today, **marked reading**, or **marked read** that day — and keep
   an in-progress **Reading** article visible even on days it wasn't touched.
5. A `/` in a clipped title (e.g. "…HTTP/1…") made the dialog error on validation, forcing a manual
   edit. The filename is already sanitized downstream; the validation was too strict.

## Decisions (settled)

1. **Single "New article" entry = the nav button.** The chrome-bar `new-article` primary opens the
   paste dialog; the legacy `renderCreateRow` button is removed permanently.
2. **Search hashtags off** via the existing `DocSearch` `hideTags: true` option.
3. **Home capture gains "Article"**, dispatching to the same `ReaderArticlePaste.open(dv)` dialog.
4. **Reader Activity integrates into the existing `ActivityFeed`** (reuses its `<details>` /
   colored-stripe / card / link styling — matches the other groups for free) rather than a bespoke
   section. Status-change timestamps are added to make "read/reading today" detectable; an
   always-show union covers in-progress reading.
5. **Relax title validation** to non-empty (and non-empty-after-sanitize), not a hard reject of
   filesystem chars — the filename already sanitizes and the frontmatter keeps the original title.

## Surfaces & changes

### A. Reader chrome — nav button opens paste dialog; drop legacy button

`platform/blueprints/reader/helpers/reader-chrome-bar.js` — `dispatch()` arm for
`id === "new-article"` changes from:

```js
customJS.EntityCreate.create({ instance: "reader-article", dv });
```

to prefer the paste dialog, falling back to `EntityCreate` if the paste helper is cold:

```js
if (customJS && customJS.ReaderArticlePaste && typeof customJS.ReaderArticlePaste.open === "function") {
  customJS.ReaderArticlePaste.open(dv); return;
}
if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
  customJS.EntityCreate.create({ instance: "reader-article", dv });
} else if (typeof Notice === "function") { new Notice("ReaderChromeBar: create unavailable — reinstall reader blueprint.", 6000); }
```

`platform/blueprints/reader/helpers/reader-queue.js` — remove the `renderCreateRow` call block
(the `try { … RAA.renderCreateRow(dv) … }` at ~lines 138-143). The search strip / queue below are
unaffected.

`platform/blueprints/reader/helpers/reader-article-actions.js` — remove the static
`renderCreateRow` method and its instance delegator. Its private helpers (`_mobilize`, etc.) stay
if still used by `render`; the header comment's mention of `renderCreateRow` is updated. (The
chrome-bar is now the sole "New article" surface.)

### B. Reader search — hide tag chips

`reader-queue.js` — the `DocSearch.render(dv, { … })` call gains `hideTags: true`:

```js
const ctx = DocSearch.render(dv, {
  scopePath: 'spice/reader',
  recursive: false,
  entityType: 'reader-article',
  persist: false,
  hideTags: true,
  onChange: (c) => { c.resultsContainer.empty(); this._renderResults(dv, c.resultsContainer, c); },
});
```

`DocSearch` already honors `hideTags` (`doc-search.js:45` — suppresses `_countTags` + the chips
row). No mechanism change.

### C. Home `+` capture — add "Article"

`platform/blueprints/home/helpers/space-home.js`:

- `_captureSpec()` gains a third entry (after sticky-note):
  `{ key: "article", label: "＋ Article", icon: svg(<book-open path>) }`.
- `_dispatch(key, dv, today)` gains an `article` arm:
  ```js
  if (key === "article") {
    if (cjs && cjs.ReaderArticlePaste && typeof cjs.ReaderArticlePaste.open === "function") {
      cjs.ReaderArticlePaste.open(dv);
    } else if (typeof Notice === "function") { new Notice("Reader paste dialog unavailable — reinstall reader blueprint.", 6000); }
    return;
  }
  ```

`home`'s `manifest.json` gains a soft dependency note on `reader` for the capture target — but
since the dispatch is fully guarded (no-ops if `ReaderArticlePaste` absent), **no hard
`depends_on` is added** (mirrors how home already soft-degrades meeting/sticky capture). Home stays
installable in a vault without reader.

### D. Reader in the daily Activity panel

**D1. Stamp `status_changed_at` on reader status changes.**
`reader-article-actions.js` `_setStatus(path, next)` currently sets only `fm.status = next` via
`processFrontMatter`. It also sets `fm.status_changed_at = <ISO now>`:

```js
await appRef.fileManager.processFrontMatter(file, (fm) => {
  fm.status = next;
  try { fm.status_changed_at = new Date().toISOString(); } catch (_e) {}
});
```

This is the timestamp the Activity feed keys off for "read/reading today". Additive; the reader
view/query don't depend on its absence. (Schema note: `status_changed_at` is added to the
reader-article field set — see Schema below.)

**D2. Add `reader-article` to the dashboard's ActivityFeed opts.**
`platform/blueprints/daily/helpers/space-daily-dashboard.js`, in `_buildActivityOpts` /
`_DEFAULT_DASHBOARD_BLUEPRINTS` / `_BLUEPRINT_COLORS`:

- `_DEFAULT_DASHBOARD_BLUEPRINTS` gains `"reader-article"`.
- `_BLUEPRINT_COLORS` gains `"reader-article": "var(--color-green)"` (distinct from the existing
  project/wiki/kanban/trip/sticky/cowork colors — final color picked at implementation to avoid
  collision; green reads as "reading/book").
- `groupLabels` gains `"reader-article": "Reader"`.
- `groupOrder` includes `"reader-article"` (placed after `"wiki"`).
- Global `tsKeys` gains `"captured_at"` → becomes
  `["day", "created_at", "status_changed_at", "captured_at"]`. `captured_at` is inert for
  non-reader types (they don't have it), so this only affects reader: an article counts as
  "today" when captured today (added) OR status-changed today (marked reading/read).

**D3. Always-show in-progress reading.**
After `ActivityFeed.query(...)` returns `activityPages`, the dashboard unions in every
`reader-article` with `status === "reading"` that isn't already present (dedup by `file.path`),
via a new pure static `SpaceDailyDashboard.selectReadingArticles(dv)` (mirrors the
`selectMeetings`/`selectUpcomingTrips` DataArray-or-array shape, Node-testable). The unioned set
feeds both `activityCount` (gate + count pill) and the existing
`precomputed: { pages: activityPages }` handed to `ActivityFeed.render` (dashboard already does
this at ~line 721) — so reading articles render even on untouched days, with no ActivityFeed change.

**D4. Reader card status pill.**
`_renderActivityMeta(p, el, …)` appends a small status pill for `p.type === "reader-article"`:
`Reading` (accent), `Read` (green/check) when `status === "archived"`, or `Added` (orange) for a
freshly-captured unread article. Mirrors the reader-hub glance-pill colors; keeps the card link to
the note intact (single click → opens the article). Non-reader cards are unchanged.

### E. Relax title validation (the `/` fix)

`platform/blueprints/reader/helpers/reader-article-paste.js` `validateTitle(title)`:

```js
static validateTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') return 'Article title is required.';
  // The filename is sanitized downstream (manifest filename_prefix uses |sanitize-filename)
  // and the frontmatter keeps the original title, so filesystem-hostile chars are allowed here.
  // Only reject a title that sanitizes to nothing (all-invalid), which would yield an empty filename.
  const sanitized = title.replace(/[\\/:*?"<>|]/g, '').trim();
  if (sanitized === '') return 'Article title needs at least one letter or number.';
  return null;
}
```

Now "…Race Condition in hyper's HTTP/1 Implementation" validates: the note filename becomes
"…HTTP1 Implementation" (slash stripped by `|sanitize-filename`) while `title:` frontmatter keeps
the original "…HTTP/1…". No manual edit.

## Schema

`reader-article` gains an optional `status_changed_at` (ISO datetime string, written by
`_setStatus` on the first status change; absent on freshly-created notes). The reader entry in
`platform/schemas-index.json` is `reader-rule-fragments` — a `type`-frontmatter validator (checks
`type: reader-article`); it does **not** enumerate an allowed-field list, so adding a new optional
frontmatter field requires **no schema-index change**. Run `npm run lint-schemas` after the change
to confirm nothing regresses. All reader-article fields remain individually optional at render time
(`ReaderArticleView` already tolerates missing fields), so existing notes without
`status_changed_at` are unaffected.

## Backward compatibility

- Existing reader notes: untouched. `status_changed_at` is written lazily on the next status
  change; its absence means the article simply won't appear in Activity via the status-change path
  (it can still appear via `captured_at` if captured today, or via the reading-union if `reading`).
- Removing `renderCreateRow`: the nav button fully replaces it; no note migration (it was a
  render-time button, not stored content).
- Home without reader installed: the "Article" capture item no-ops gracefully (guarded dispatch);
  no hard dependency added.
- `ActivityFeed`, `DocSearch`, `EntityCreate` mechanisms: **unchanged** — all changes are in
  blueprint helpers consuming existing options (`hideTags`, `precomputed`, `tsKeys`,
  `blueprints`, `colorByType`, `groupLabels`).

## Testing / verification plan

Per `Docs/agent-guides/build-test-verify.md`:

1. **`run-reader-article-paste.js`** — extend: `validateTitle` now accepts `/`-bearing titles
   (returns null) and still rejects empty / all-invalid (`"///"` → error). Existing 17 assertions
   updated where they asserted `/` was rejected.
2. **`run-reader.js`** — `renderCreateRow` removed: drop/replace any assertion referencing it;
   confirm the hub still renders search + queue. Add an assertion that `ReaderArticleActions` no
   longer exposes `renderCreateRow`.
3. **`run-reader-chrome-bar.js`** — the `new-article` dispatch now targets `ReaderArticlePaste`;
   assert dispatch calls `ReaderArticlePaste.open` when present, falls back to `EntityCreate.create`
   when not.
4. **`run-home.js`** — `_captureSpec()` includes the `article` key; `_dispatch("article", …)`
   routes to `ReaderArticlePaste.open` (spy) and no-ops (no throw) when absent.
5. **`run-daily-dashboard.js`** — new `selectReadingArticles(dv)` pure static (DataArray + plain
   array stubs): returns only `status:reading` reader-articles; empty/malformed → `[]`, never
   throws. Assert the union dedups by `file.path`. Assert `_buildActivityOpts` includes
   `reader-article` in blueprints + `captured_at` in tsKeys + the "Reader" group label.
   `_renderActivityMeta` emits a status pill for a `reader-article` page (Reading/Read/Added) and
   nothing extra for a non-reader page.
6. **`npm run lint-schemas`** passes with the new `status_changed_at` field.
7. **Full `npm run release:preflight`** green (incl. `run-validator` / `run-customjs-loadable`
   bare-class checks on any edited helper, `run-content-token-leaks`).
8. **Manual dogfood** after install: reader hub shows one "New article" (nav) opening the paste
   dialog, no legacy button, no `#tag` chips; Home `+` menu shows Article → paste dialog; mark an
   article reading → it appears in Home Activity under "Reader" with a Reading pill and stays after
   the day rolls; a `/`-titled clip creates without a manual edit.

## Versioning

No manual bumps. Conventional commits; the pipeline bumps `reader`, `home`, and `daily` blueprints
(all `feat`, backward compatible → minor). Commit scopes: `feat(reader|home|daily): …`.

## Out of scope

- No `ActivityFeed`, `DocSearch`, or `EntityCreate` mechanism changes.
- No separate reader Activity "section" — it's a sub-group inside the existing Activity panel.
- No carrying of clipped `tags` into frontmatter (still the v0.225.0 constraint; unrelated here).
- No changes to the Web Clipper template (`reader-clip.json`).
