# Home quick-capture enhancements — design

**Date:** 2026-07-14
**Status:** Approved
**Scope:** `home` blueprint only (`space-home.js` + `sauce-home.css`); no new mechanism.

## Problem

The Home command-center's "+" quick-capture popover has three issues:

1. **Missing capture options.** Only Meeting and Sticky Note buttons exist. The user's live vault also shows an Article button that isn't present in this workshop copy (parity gap), and the user wants a Journal option added — but only in vaults where the journal blueprint is actually subscribed.
2. **Misaligned layout.** The "Jot a task…" input row sits at a different left inset than the button rows below it, so the popover doesn't read as one clean column.
3. **Unwanted due-date default.** Tasks created via the inline "Jot a task…" flow are silently given `due: <today>`. The user wants quick-captured tasks to have no due date by default.

## 1. Due-date fix

`TaskDialog.createQuick` derives `due` solely from `opts.today` (`due: (opts && opts.today) || ''`). `space-home.js`'s inline capture is the only caller that passes `today`; `task-note-view.js`'s sub-task caller omits it and already gets `due: ''`.

**Fix:** in `space-home.js`'s `submitCapture()`, stop passing `today` into `createQuick`:

```js
// before
await td.createQuick({ title: text, today, source: "daily" });
// after
await td.createQuick({ title: text, source: "daily" });
```

`TaskDialog.createQuick` itself is untouched — its contract (`due` mirrors `opts.today` when given) stays intact for any future caller that wants it. No change to `task-note-view.js`.

**Test:** `run-home.js`'s `HOME-CAP-19` currently asserts `calls.createQuick[0].today === "2026-07-02"`; update it to assert `today` is absent (`undefined`) from the call args.

## 2. Alignment fix

`.sauce-home-add-input-row` has `padding: 2px 2px 6px 2px`; `.sauce-home-add-item` (button rows) has `padding: 8px 11px`. The 2px vs 11px left inset mismatch is why the input row looks shifted left relative to the buttons.

**Fix:** change `.sauce-home-add-input-row` padding to `8px 11px 6px 11px` — same left/right inset as button rows, keeping its own top/bottom spacing. This gives the input, Add button, and every menu item one consistent left edge.

## 3. New capture options + conditional visibility

Add two entries to `SpaceHome._captureSpec()`, appended after the existing two (final order: Meeting, Sticky Note, Article, Journal):

- `{ key: "article", label: "＋ Article", icon: <book-open glyph, reused from reader nav> }`
- `{ key: "journal", label: "＋ Journal", icon: <notebook glyph, reused from journal nav> }`

**Conditional visibility:** before rendering the menu, `render()` checks `EntityCreate._loadSpec(instance)` for `"reader-article"` and `"journal-entry"` — each button only appears if that blueprint's entity-create registry entry exists in the current vault (i.e., the blueprint is actually subscribed). This directly reflects real per-vault subscription state rather than a static assumption, and avoids showing a button that would silently no-op if clicked in a vault that never subscribed to reader or journal.

Concretely: `_captureSpec()` stays a pure/sync method returning the full candidate list (4 entries); `render()` filters it down using the registry lookups before building the DOM, so the pure/testable spec shape is preserved and the gating lives at the render boundary (consistent with how dispatch is already kept out of `_captureSpec()`).

## 4. Dispatch wiring

`_dispatch(key, dv, today)` gains two branches, mirroring the existing `meeting`/`sticky-note` pattern exactly (same try/catch, same `cjs.EntityCreate.create` call shape):

```js
if (key === "journal") {
  if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
    cjs.EntityCreate.create({ instance: "journal-entry", dv: dv });
  }
  return;
}
if (key === "article") {
  if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
    cjs.EntityCreate.create({ instance: "reader-article", dv: dv });
  }
  return;
}
```

This is the exact call shape `journal-chrome-bar.js` already uses for its "+ New Journal Entry" button and matches the existing `reader-article` entity-create registry entry (destination `spice/reader`, label "+ New article").

## 5. Testing

- `run-task-entity.js`: no changes needed (createQuick's own contract is untouched).
- `run-home.js`:
  - Fix `HOME-CAP-19` per §1.
  - Add cases asserting `journal`/`article` buttons render when their registry entries exist, and are absent when they don't (stub `EntityCreate._loadSpec` to return an entry vs. `null` per instance).
  - Add dispatch cases: clicking the journal/article items calls `EntityCreate.create` with `instance: "journal-entry"` / `"reader-article"` respectively, receiving the live `dv`.
  - Confirm the existing meeting/sticky-note-only path (both registry lookups return `null`) still renders exactly 2 items, preserving current behavior for vaults without journal/reader subscribed.

## Files touched

- `platform/blueprints/home/helpers/space-home.js` (canonical) + `ranch/scripts/home/space-home.js` (dogfood mirror)
- `.obsidian/snippets/sauce-home.css`
- `platform/test/run-home.js`

No manifest, registry, or dependency changes — `home`'s `depends_on` already includes `entity-create`, and both `journal-entry` and `reader-article` are existing registry entries owned by their respective blueprints.
