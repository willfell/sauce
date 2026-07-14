---
purpose: Design to eliminate the Home page cold-load double-render ("displays, freezes, reloads once, settles").
load_when: Implementing or reviewing the Home reload fix (post-v0.231.0).
status: approved
date: 2026-07-14
---

# Home cold-load double-render — design

## Problem

Opening `spice/home/Home.md` renders, freezes, then re-renders once and settles. Confirmed
by the user: **reloads once then settles, no console logs**.

**Root cause — Dataview cold-load double-execution.** Dataview executes Home's `dataviewjs`
blocks (`HomeChromeBar`, `SpaceHome`) when the note opens, then executes them **again** when the
vault's metadata/Dataview index finishes warming. `SpaceHome.render` computes glance counts and
the nested `SpaceDailyDashboard` from `dv.pages("spice/tasks")` / meetings — which are
**index-dependent**. So:

- **exec 1** (cold index): counts are partial/zero → renders a partial Home.
- **exec 2** (warm index): counts are real → full teardown + heavy rebuild (the nested dashboard
  = the "freeze") → settles.

The two executions render *different* data, so the existing no-op guard cannot help — and it
already can't, because it checks `dv.container.querySelector(".sauce-home")`, and Dataview
**clears the container** before each re-execution (that query is always null on exec 2).

Ruled out during diagnosis: the editor-width-slider (only sets a `<style>` element, never
writes), and the day-refresh watcher (`_shouldDayRefresh` requires `renderDay !== today`, so it
no-ops same-day).

## Approach

**Fail-safe index-readiness gate + render token**, both in `SpaceHome.render`. Gate the first
paint of a session until the metadata index is warm (so the first paint already has real data and
Dataview has no reason to re-execute), and use a monotonic render token so a superseded execution
that awaited the gate never paints stale content. Both are bounded and fail-safe: they can never
leave Home blank or make it worse than today.

Rejected: pure sig-memoization / reattach-of-cached-node (the built DOM also depends on
async-loaded capture registrations, not just day+counts, so a simple signature can't safely gate
a reattach — implementing it introduced stale-node bleed between the harness's back-to-back
renders; the index gate fixes the reported symptom without that risk); disabling Dataview
auto-refresh (global, user-owned, wrong layer); restructuring the two blocks into one (larger
blast radius, no better outcome).

**Implementation note (revised during build):** the readiness signal is Obsidian's
`metadataCache` **"resolved" event** (the real "index finished" signal Dataview builds from),
not a counts-stability poll — "two equal cold reads" can false-positive on a slow-but-static
partial index. `_awaitIndexResolved(appRef, maxMs)` resolves on that event, on an
already-resolved fast path (`resolvedLinks` populated), or on a `maxMs` timeout, whichever comes
first. The reattach-memoization from the first draft (§3 below) was dropped for the reason above.

## Design

All changes are in `platform/blueprints/home/helpers/space-home.js` (`SpaceHome.render` + two new
static helpers). `HomeChromeBar` is light (one `ChromeBar.render` call, no index data) and is left
unchanged.

### 1. Render token (kills the superseded execution)

At the top of `render()`, bump a window-scoped monotonic token and capture it:

```js
const w = (typeof window !== "undefined" && window) || null;
const myToken = w ? (w.__sauceHomeRenderToken = (w.__sauceHomeRenderToken || 0) + 1) : 0;
```

After any `await`, if `w.__sauceHomeRenderToken !== myToken`, a newer render started — **bail
without painting**. This prevents exec 1 (which awaited the settle) from painting stale content
after exec 2 has begun.

### 2. Fail-safe index-settle gate (first session render only)

New static helper `SpaceHome._settleIndex(dv, opts)`:

- Reads the counts signal (`SpaceDailyDashboard.computeCounts(dv, today, TE)`) repeatedly every
  `pollMs` (default 120ms), resolving as soon as **two consecutive reads are identical** (index
  stable) OR `maxMs` (default 1200ms) elapses — whichever comes first.
- Always resolves within `maxMs` (fail-safe: never hangs, never blocks Home from painting).
- `pollMs`/`maxMs` are injectable for tests.

`render()` awaits `_settleIndex` **only on the first render of the app session**, gated by a
window flag `w.__sauceHomeSettledOnce` (set after the first settle). Subsequent opens skip it —
the index is already warm, so there is no latency cost after the first open. This mirrors the
existing `__sauceHomeLayoutReady` one-shot pattern.

### 3. Reattach memoization (kills residual same-sig rebuilds)

After building the `.sauce-home` node, cache it: `w.__sauceHomeCache = { sig, node: home }`.

At the point where counts + `sig` are known (after the settle), before building: if
`w.__sauceHomeCache && w.__sauceHomeCache.sig === sig && w.__sauceHomeCache.node` — clear the
container's prior `.sauce-home` and **reattach the cached node** (`dv.container.appendChild(node)`)
instead of rebuilding, then return. The cached node retains its own event handlers (capture menu,
inline task input) and its already-rendered nested dashboard; handlers use global `app.*`, not the
stale `dv`, so reattach is safe.

Cache invalidates naturally: a different `sig` (new day, changed counts, post-capture) falls
through to a full rebuild + re-cache.

### 4. Ordering in render()

1. bump render token
2. first-session: `await onLayoutReady` (existing)
3. first-session: `await _settleIndex(dv)`; then set `__sauceHomeSettledOnce`
4. token check → bail if superseded
5. compute `today`, counts, `sig`
6. memoize: same-sig + cached node → reattach + return
7. build DOM (header, capture, glance chips), `await dv.view(SpaceDailyDashboard, …)`
8. token check → bail if superseded (don't cache a stale build)
9. cache `{ sig, node }`

## Error handling / fail-safes

- `_settleIndex` wraps `computeCounts` in try/catch; a throw counts as "unstable" and it keeps
  polling until `maxMs`, then resolves. Never throws out of `render()`.
- The token bail only *skips painting*; it never errors.
- Reattach is guarded: if the cached node is missing/detached-invalid, fall through to rebuild.
- All window access is `typeof window` guarded (Node harness + mobile safety), matching existing
  code.

## Testing (`platform/test/run-home.js`)

- `_settleIndex` resolves once two consecutive count reads match (stub dv returns partial then
  stable); resolves by `maxMs` even if never stable (fail-safe); honors injected `pollMs`/`maxMs`.
- Render token: a second `render()` bumping the token makes the first bail without appending a
  second `.sauce-home`.
- Memoization: two renders with the same `sig` produce one build; the second reattaches the same
  node (assert node identity / build-count).
- Regression: existing 87 run-home assertions stay green; a changed `sig` (new day/counts) still
  rebuilds.

## Non-goals

- Changing Dataview settings (`refreshEnabled`/`refreshInterval`) — user-owned, global.
- Touching `HomeChromeBar` or the dashboard's internals.
- Eliminating Dataview re-execution in general (out of our control) — we make it cheap/invisible.
