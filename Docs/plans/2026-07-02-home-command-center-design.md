# Home Command Center — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm complete)
**Cycle:** Homepage × Sauce daily-note expansion — Phase 2 (dedicated Home surface)
**Builds on:** v0.184.3 Homepage foundation (convenience@0.5.1); decision doc
`headspace-sauce/spice/projects/sauce/docs/daily-notes/Homepage Migration.md`.

---

## 1. Why

The daily note is the single most important surface in the system, and the user is
often on a phone (reading-mode-first + mobile-friendly is mandatory). The v0.184.3
Homepage foundation forces Reading view on the launch/new-tab landing, but the landing
is still the *dated daily log* — an artifact that fuses two jobs: **orient** ("what's
today, jump into things, capture") and **log** ("write today, review what I did").

Homepage gives us the clean lever to split those jobs. This cycle builds a persistent
**Home command center** (`kind: File → spice/home/Home.md`) that owns the launch/orient
moment, while the dated daily stays the focused capture/log surface. Both are driven by
**one** dashboard engine so nothing drifts.

### Approved shape (Approach 1 — shared date-parameterized dashboard + Home as enhanced host)

- Extract a single injection seam in the existing `SpaceDailyDashboard` so the dashboard
  can be rendered for an explicit date. No options ⇒ today's/this-note's-date resolution
  exactly as today (daily unchanged, zero regression risk). Home passes `asOf = today`.
- A new thin composer, `SpaceHome`, wraps the reused dashboard with new chrome: greeting,
  quick-capture, and a Home-scoped animation layer. The Go-to launcher comes from the
  standard top nav strip.
- Home owns startup (the "Phase 1.5 flip"): daily `autorun: false` + homepage
  `openOnStartup: true`. One responsive Home for desktop + phone.

### Explicitly out of scope (per user)

- **No finance widget** on Home.
- No separate Mobile Homepage in v1 (one responsive surface; `separateMobile` stays
  `false`). Revisit only if the phone experience needs to diverge.
- No new launcher band inside `SpaceHome` — the nav strip already carries the launcher.

---

## 2. Architecture

### New `home` blueprint — `platform/blueprints/home/`

```
platform/blueprints/home/
  manifest.json              # depends_on: daily, nav-buttons, activity-feed,
                             #   task-entity, meetings, scratch, convenience
  content/home-template.md   # scaffolds spice/home/Home.md (singleton platform note)
  helpers/space-home.js      # SpaceHome CustomJS class — the composer
  helpers/sauce-home.css     # Home-scoped layout + animation layer
  seed/seed.js               # seed-vault fixture (Home.md scaffold + heal asserts)
  commands/home.md           # /home slash command (claude_surface)
  skills/open-home/SKILL.md  # native skill (claude_surface)
```

### The DRY seam (one dashboard, two hosts)

`SpaceDailyDashboard` (daily blueprint, `helpers/space-daily-dashboard.js`) already
derives its window from `_resolveCurrentFileName(dv)` → `asOf: <day-from-filename>`. We
add **one optional injection point** carried through the customjs-guard view params:

```js
// daily note (unchanged): resolves this note's date
await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });

// Home (new): explicit live-today window
await dv.view("ranch/views/customjs-guard", {
  class: "SpaceDailyDashboard", asOf: <today-YYYY-MM-DD>, live: true
});
```

- When `asOf` is absent → resolve from the current file exactly as now. **Regression-safe.**
- When `asOf` present → use it verbatim; `live: true` means "always today" (the composer
  recomputes today each render; the daily never sets this).
- The date resolver stays the single source of truth; we only let a host inject the date
  instead of deriving it. Everything downstream (agenda selection, meetings filter,
  activity `asOf` window, drill-in, empty-state) is inherited unchanged.

### `SpaceHome` is a composer, not a fork

Renders, top-to-bottom, inside a `.sauce-home` wrapper:

1. **Greeting + human date** — `_greeting(hour)` (pure; hour passed in — no `new Date` in
   the testable core) + the existing `_humanDate` idiom (Hinnant day-math). One–two lines.
2. **Quick-capture band** — full-width tappable `<button>`s (reading-mode, no plugin dep):
   - **＋ To-Do** → `task-entity` New Task flow
   - **＋ Meeting** → `meetings` new-meeting flow
   - **＋ Scratch** → `scratch` new-scratch flow
   - **＋ Open today's daily** → jumps into the dated log
   Each handler invokes an existing command id / opens an existing dialog. Exact ids
   pinned during planning; the band degrades gracefully (skips a button whose command id
   is absent) so a missing dependency never breaks the render.
3. **The reused dashboard** — `SpaceDailyDashboard` with `asOf = today, live: true`
   (agenda + overdue red pill · meetings · "everything I did today", activity collapsed).
4. **Launcher** — from the top nav strip (`SpaceNavButtons`), including its mobile
   bottom-sheet. No duplicate band.

### Unit boundaries

| Unit | Does | Depends on |
| --- | --- | --- |
| `SpaceHome` | Composes Home from existing widgets + new chrome | `SpaceDailyDashboard`, capture command ids, nav strip |
| `SpaceDailyDashboard` | Unchanged behavior; gains optional `asOf`/`live` inject | activity-feed, task-entity |
| `sauce-home.css` | Home-scoped visual + motion | — |
| `home` install scaffold/heal | Materializes + keeps `spice/home/Home.md` chrome current | convenience install plumbing |

---

## 3. Home surface layout

`Home.md` body = native Sauce chrome:

```
[ SpaceNavButtons strip ]   ← consistent top nav; gains a "Home" button + Go-to launcher
---
[ SpaceHome view block ]    ← greeting + capture + reused dashboard
%% platform chrome region maintained by _healHomeChromeBody %%
```

Vertical order (reading mode): greeting → quick-capture → dashboard(agenda → meetings →
activity[collapsed]). Capture sits above the agenda because the user emphasized capture
and it is compact; agenda-first is a one-line swap if preferred.

### Mobile + reading-mode guarantees

- One responsive Home (`separateMobile: false`).
- All widgets are CustomJS `<div>`/`<button>` — no wide tables, no edit-mode dependency
  (dodges the #1 mobile killer: wide Dataview tables clip off-screen with no h-scroll).
- Capture buttons: full-width rows on mobile (fat-finger-safe tap targets), icon+label
  grid on desktop.
- Home opens in Reading view (Homepage forces it — `kind:File` on a `.md` file, so
  view-forcing applies; not a canvas/base where forcing no-ops).

---

## 4. Animation language (`.sauce-home`-scoped)

Home-only; the daily dashboard stays calm and fast. CSS-only, GPU-friendly
(transform/opacity), no JS timers, total < 300ms so launch never drags.

- **Staggered fade-up reveal** of each band on load: `opacity 0→1` + `translateY(8px→0)`,
  ~200ms ease-out, ~50ms stagger via `nth-child` `animation-delay`.
- **One-shot pop** on count pills (the red overdue pill draws the eye): `scale(.85→1)`
  with a slight overshoot, once.
- **Tactile capture buttons**: `:active { transform: scale(.98) }` for tap feedback;
  subtle lift + shadow on desktop `:hover`.
- **Smooth expand/collapse**: keep the existing chevron rotation; add a gentle
  opacity/`max-height` ease on an inner content wrapper (robust — never animates raw
  `<details>` height).
- **Hard off-switch**: `@media (prefers-reduced-motion: reduce)` disables every entrance/
  pop/lift animation (accessibility + battery).

---

## 5. Config, startup & install

### Convenience mechanism (owns homepage config)

`homepages["Main Homepage"]` changes:

| key | before (v0.184.3) | after |
| --- | --- | --- |
| `kind` | `Daily Note` | `File` |
| `value` | `""` | `spice/home/Home.md` |
| `openOnStartup` | `false` | `true` |
| `view` | `Reading view` | `Reading view` (unchanged) |
| `autoCreate` | `true` | `true` (fallback only — scaffold wins) |
| `refreshDataview` | `true` | `true` (unchanged) |
| `commands` | `[]` | `[{ id: "dataview:…force-refresh", period: "Both" }]` |
| `openMode`/`manualOpenMode` | `Replace last note` | unchanged |

`commands[]` adds a Dataview force-refresh on open because `refreshDataview` is documented
to fire on manual reopen but **not cold startup** — this beats stale-on-launch. Exact
command id verified during planning; a missing id is silently skipped by Homepage.

`new-tab-default-page.whatToOpen` stays `homepage:open-homepage` (now opens Home).

### Daily blueprint

`core_plugin_settings.daily-notes.autorun`: `true → false`. Home owns the launch; no
double-open. The daily is still one keystroke away (`Cmd+[`, the Daily nav button, and the
new **＋ Open today's daily** capture button on Home).

### Nav "Home" button (careful — tuned launcher grid)

A new top-level nav-strip button (id `home-open`, order 40 — before Daily's 50), action
`invoke_command → homepage:open-homepage`. The nav-buttons launcher overlay is a tuned
fixed grid (5 pinned + Go-to). **Decision:** Home is a *top-level nav-strip button*, not a
6th pinned launcher-overlay entry, so the launcher partition math is untouched. Verified
against `_partitionEntries` during planning; if the strip ordering needs a tweak it stays
CSS/order-only.

### Install scaffold + heal

- Scaffold `spice/home/Home.md` from `content/home-template.md` if missing (idempotent).
- `_healHomeChromeBody` keeps the platform chrome region current on every install:
  backup-first, idempotent (per-note sentinel), **never throws** (mirrors
  `_healWikiChromeBody` / `applyTripsConformanceHeal`). Any user free-write region below
  the chrome marker is preserved.
- `autoCreate: true` on the homepage is a safety net only; the scaffold provides the real
  templated note before first open.

---

## 6. Testing & rollout

### Tests (evidence before assertions)

- **Pure Node unit tests**: `_greeting(hour)` (deterministic, hour injected),
  `_humanDate` reuse, capture-band spec (button → command id map), and the **`asOf`
  injection seam** on `SpaceDailyDashboard` (explicit `asOf` ⇒ that date's selection; no
  options ⇒ current-file date — proves zero daily regression).
- **New behavioral harness** `run-home` (scaffolded via `scaffold-behavioral-harness`):
  drives `SpaceHome.render` against a dv-stub + real `SpaceDailyDashboard`, asserts band
  order, capture buttons present, dashboard rendered, empty-state.
- **Seed vault**: add `spice/home/Home.md`; assert scaffold + `_healHomeChromeBody`
  idempotence + portable sentinel.
- **Conformance gates**: TPL/BTN/CJS as applicable to the new template + buttons.
- **`npm run release:preflight` + `npm run release:preflight-bumped`** both green.
- **Playwright**: Home at 360/390px, light + dark — capture band, agenda + overdue pill,
  meetings, and the entrance animations. Self-viewed screenshots.

### Rollout (standard cycle)

Isolated worktree (`.worktrees/home-command-center`) → subagent-driven build → preflight
(both) → PR → **green CI, then merge the feature PR** → pipeline auto-opens + auto-merges
the release PR (never hand-merged; `update-branch` if it stalls behind the autoloop) →
tag `vX.Y.Z` → homebrew tap → `git fetch --tags && brew update && brew upgrade sauce` →
`node scripts/autoloop/deploy.js run` (upgrades + verifies all three vaults) → verify
homepage now opens Home in Reading view on ero / accuris / headspace. Users must `Cmd+R`.

### Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Daily regression from the `asOf` seam | Absent-options path is byte-for-byte the current behavior; unit test locks it. |
| Home stale on cold startup (refreshDataview skips it) | `commands[{dataview refresh, Both}]` on open + customjs-guard cold-load handling. |
| Launcher grid disturbed by Home button | Home is a top-level strip button, not a launcher-overlay pin — partition math untouched. |
| Capture command id missing in a vault | Band skips absent ids; render never breaks. |
| autoCreate makes an empty Home before scaffold | Scaffold + heal run at install and own the note; autoCreate is fallback only. |
| Animations slow the most-opened surface | CSS-only transform/opacity, <300ms, `prefers-reduced-motion` off-switch. |

---

## 7. Follow-ups (not this cycle)

- Optional dedicated Mobile Homepage (`separateMobile: true`) if the phone surface should
  diverge from desktop.
- Optional expanded launcher grid as a `SpaceHome` band (vs. the nav-strip launcher).
- Additional glance widgets the user may want later (habit/streak, on-this-day, recent
  knowledge) — deliberately deferred to keep v1 focused and one-screen.
