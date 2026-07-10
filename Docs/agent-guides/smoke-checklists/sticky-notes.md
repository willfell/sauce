---
purpose: Manual in-Obsidian smoke checklist for the sticky-notes blueprint.
load_when: Cycle close that touches sticky-notes's template / dialog / widget / hub-toggle / banner surface.
status: reference
---

# sticky-notes smoke checklist

> Run after `Cmd+R` in a vault with the sticky-notes blueprint installed. Chrome / dialog / hub-toggle
> rendering isn't covered by the headless harnesses, so this is the load-bearing manual check.

## Hub (Sticky.md)
- [ ] Open `spice/sticky-notes/Sticky.md` — the hub renders (StickyChromeBar + StickyHubCards, no raw `dataviewjs`).
- [ ] **Days | All** toggle is visible above the card area; **Days** is active by default and shows one card per day.
- [ ] Click **All** — the content area swaps to a flat list of every sticky note across all days, newest-edited-first, fronted by the doc-search strip.
- [ ] Type a query that matches a note's **title** → results filter to it.
- [ ] Type a query that matches a note **only in its body text** (title-miss / body-hit) → that note still appears in the results.
- [ ] Click a result → it opens the **leaf note directly** (not its day-hub).
- [ ] Clear the query → All view shows every sticky note again (browse-everything is a valid state).
- [ ] Toggle back to **Days**, re-open the hub — toggle state survives Dataview re-render (no flip-back-to-default flicker).

## Today / day-hub
- [ ] Click **Today** (or the Sticky Notes nav-button) → opens/creates today's day-hub (`Sticky-Day-<date>.md`), no "missing day frontmatter" error.

## New Sticky Note (multi-create within a minute)
- [ ] Click **+ New Sticky Note** twice within the **same minute** → **two distinct files** are created (`HH-mm-ss` timestamps), no collision, no re-opening the first note.
- [ ] Both new leaves have `type: sticky-note` and a `day_link: "[[Sticky-Day-<date>]]"`.

## Leaf title banner (click-to-rename)
- [ ] Open a leaf sticky note → the title banner shows the note's `title` (or "Untitled sticky note — click to name" placeholder when empty).
- [ ] Click the banner → a rename dialog opens pre-filled with the current title.
- [ ] Type a new title → Save → the banner text updates in place.
- [ ] Return to the day-hub → the StickyDayList card title for that note reflects the new title.

## Migrated legacy note
- [ ] Open a note that was migrated from a legacy `scratch` vault → it opens clean: `type: sticky-note`, StickyChromeBar renders, `day_link` points at `[[Sticky-Day-…]]`, and any body links work.

## Console
- [ ] DevTools console empty of red errors after rendering each surface above.

## Result-doc note
Paste "Manual smoke: COMPLETED on <vault>" or "N/A — no UI change" into the cycle's result doc.
