---
title: Reviews blueprint — design
date: 2026-05-07
candidate_cycle: post-v0.26.x (queued after v0.26.1 P1 carries + v0.26.2 sticky-notes)
status: design-approved; writing-plans deferred until v0.26.1 closes
---

> [!abstract] Goal
> Vault-agnostic weekly + monthly **summary** notes. Each panel probes for its source data; renders only what exists. Self-contained — Reviews installs cleanly regardless of which other blueprints a consumer has subscribed.

> [!warning] Cycle slotting (v0.26.x parallel-loop discipline)
> This design lands AFTER `v0.26.1` (P1 carries) closes AND after `v0.26.2` (sticky-notes) closes. Candidate cycle number `v0.27.0` MINOR (new blueprint + nav-buttons PATCH). Do NOT bump `workshop_version` for this design. Do NOT touch `manifest.json`, mechanism dirs, or the harness. Implementation plan is deferred to `writing-plans` post-v0.26.1 (reason: plan authoring needs post-v0.26.1 baseline state, not in-flight state).

---

## Locked design decisions

### 1. Cadences

Two cadences in v1: **weekly + monthly**. Quarterly / yearly out-of-scope (deferred to v0.27.x or later if user demand surfaces).

### 2. Module layout (landmine #11)

```
spice/reviews/
├── Reviews.md                          Hub (BeaconCards row-layout list of weeklies + monthlies)
├── weekly/
│   └── YYYY/
│       └── Week-YYYY-Www.md            One per ISO week
└── monthly/
    └── YYYY/
        └── Month-YYYY-MM.md            One per month
```

`module_directory: "reviews"`. One module, two sub-areas (mirrors finance pattern: `finance/{budgets,paychecks,invoices}`).

### 3. Filename + folder split-field schema (v0.4.2)

| Cadence  | folder_prefix                      | folder_date_pattern | filename_prefix | filename_date_pattern | Resolved example                          |
| :------: | :-------------------------------- | :----------------: | :-------------- | :-------------------: | :--------------------------------------- |
| Weekly   | `{{module_directory}}/weekly`     | `YYYY`             | `Week-`         | `YYYY-[W]ww`          | `spice/reviews/weekly/2026/Week-2026-W19.md` |
| Monthly  | `{{module_directory}}/monthly`    | `YYYY`             | `Month-`        | `YYYY-MM`             | `spice/reviews/monthly/2026/Month-2026-05.md` |

> [!info] Bracket-escape `[W]`
> The `[W]` is moment.format's native literal-text mechanism. Note: pre-v0.4.2 schema bracket-escape gotcha (FIX-1 / FIX-2) is **not** in play here — those were about literal text in the user-typed `folder` / `filename` single-string fields, which were **replaced** by the split-field schema in v0.4.2. The split-field schema accepts moment-format-only strings in `*_date_pattern` and lets moment handle bracket literals natively.

### 4. Dashboard panels — probe-each-source contract

> [!abstract] Vault-agnostic posture
> Each panel is independently graceful. If its source data is absent, the panel emits **nothing** — no header, no empty state, no "0 items" message. Mirrors v0.3.0 daily blueprint's `SpaceDailyDashboard` graceful-empty handling (CLAUDE.md cycle log) and v0.17.0 dv-shim composition lesson.

Single CustomJS class `ReviewsDashboard.render(dv, period: "week"|"month")`. Panel contract:

```js
async _renderTasksPanel(dv, range) {
  const pages = dv.pages('"spice/to-do"');
  if (!pages || pages.length === 0) return;       // probe — short-circuit, nothing emitted
  // …render panel…
}
```

Panels (v1, render order):

| # | Panel | Probe | Renders |
|:-:|:--|:--|:--|
| 1 | Tasks | `dv.pages('"spice/to-do"').length > 0` | Completed-checkbox count + listing for daily to-do notes whose filename date falls in the period; open-checkbox count |
| 2 | Meetings | `dv.pages('"spice/meetings/notes"').length > 0` | Meeting count + grouped-by-day list with attendees + stray `- [ ]` action items |
| 3 | Journal | `dv.pages('"spice/journal"').length > 0` | Presence strip (7-day weekly / 28-30-day monthly) + tag rollup if frontmatter declares them |
| 4 | Daily | `dv.pages('"spice/daily"').length > 0` | Lightweight presence indicator + frontmatter-summary surface if present |
| 5 | Projects | `dv.pages('"spice/projects"').where(p => p.file.mtime in range).length > 0` | Touched projects with task-progress delta |
| 6 | Trips | trip frontmatter `start_date` / `end_date` overlap with period range | Active trips (skips if none) |
| 7 | Finance | **monthly only.** `dv.pages('"spice/finance"').length > 0` | Monthly budget actual-vs-planned, paychecks received, invoices submitted/paid. Silent on weekly notes. |

> [!example]- Why "monthly-only" for Finance is OK
> Finance entities (Budgets, Paychecks, Invoices) are inherently monthly. A weekly slice would be awkward and misleading. The probe-pattern naturally accommodates per-cadence panel rules — pass `period` into `_renderFinancePanel(dv, range, period)`, short-circuit if `period === "week"`.

### 5. Hub note `Reviews.md`

Two BeaconCards row-layout listings:

- **Recent Weekly Reviews** — last 12 weeks, mtime-sorted desc; subtitle = week date range Mon-Sun; meta = count of populated panels.
- **Recent Monthly Reviews** — last 12 months; subtitle = month date range; meta same.

Action button row at top (AccentButton outline-accent):
- "Open This Week" — `runTemplaterTemplate` weekly
- "Open This Month" — `runTemplaterTemplate` monthly

### 6. Nav-buttons + hotkeys + date-aware routing

**Two new entries** on the consumer's nav-button row when reviews is subscribed:

- `Week` action `runTemplaterTemplate` → weekly template
- `Month` action `runTemplaterTemplate` → monthly template

Both inherit **v0.14.0 date-aware** behavior — clicking from a past daily/journal note routes to THAT week's/month's review, not today's. Free via existing `_resolveActionDate(dv)` helper. No new mechanism API.

**Hotkeys** (avoid macOS conflicts: Cmd+W = close tab, Cmd+M = minimize window):

- `Mod+Shift+W` → "Open this week's review"
- `Mod+Shift+M` → "Open this month's review"

> [!todo] Open question 1
> Hotkey bindings — `Mod+Shift+W` / `Mod+Shift+M` OK, or pick different bindings? Both are Obsidian-default-free.

**ICONS additions** to nav-buttons (additive PATCH `2.5.2 → 2.5.3`):
- `week` (Lucide `calendar-range`)
- `month` (Lucide `calendar`)

### 7. CustomJS classes (mobile-aware, customjs-guard cold-load posture)

| File | Class | Purpose | Pattern source |
|---|---|---|---|
| `ranch/scripts/reviews/reviews-dashboard.js` | `ReviewsDashboard` | `render(dv, period)` orchestrates all probes + panels | New (mirrors `SpaceDailyDashboard` composition + dv-shim handling per v0.17.0) |
| `ranch/scripts/reviews/reviews-hub-cards.js` | `ReviewsHubCards` | Hub renderer; `BeaconCards` adapter | Mirrors `FinanceHubCards` / `TripsHubCards` |

Both use `customjs-guard` cold-load posture (landmines #1 + #2). Both mobile-aware (gotcha 7).

### 8. Manifest sketch (`platform/blueprints/reviews/manifest.json`)

```jsonc
{
  "name": "reviews",
  "version": "0.1.0",
  "module_directory": "reviews",
  "depends_on": [
    "nav-buttons >=2.5.3",
    "cards >=0.2.3",
    "accent-button >=0.1.0",
    "customjs-guard >=1.0.0"
  ],
  "files": [
    /* hub Reviews.md */
    /* Weekly Review.md template */
    /* Monthly Review.md template */
    /* reviews-dashboard.js (CustomJS) */
    /* reviews-hub-cards.js (CustomJS) */
  ],
  "templater_folder_templates": [
    { "folder": "{{module_directory}}/weekly",  "template": "{{templates_path}}/Weekly Review.md" },
    { "folder": "{{module_directory}}/monthly", "template": "{{templates_path}}/Monthly Review.md" }
  ],
  "templater_hotkeys": [
    { "template_path": "{{templates_path}}/Weekly Review.md",  "hotkey": "Mod+Shift+W" },
    { "template_path": "{{templates_path}}/Monthly Review.md", "hotkey": "Mod+Shift+M" }
  ],
  "nav_buttons": [
    /* Week — runTemplaterTemplate weekly, date-aware */
    /* Month — runTemplaterTemplate monthly, date-aware */
  ]
}
```

No new manifest schema fields. No installer changes. No allowlist changes (landmine #12 stays at 12 paths). Helper count unchanged at 11.

---

## Cycle shape forecast

> [!info] Sequencing
> Lands **AFTER** v0.26.1 P1 carries (in-flight) AND v0.26.2 sticky-notes (queued).

| Field | Forecast |
|---|---|
| Workshop bump | `0.26.x → 0.27.0` MINOR (or higher if v0.26.x produces additional MINORs first) |
| Mechanism bumps | `nav-buttons@2.5.2 → 2.5.3` PATCH (2 new ICONS only) |
| New mechanism | none |
| New blueprint | `reviews@0.1.0` |
| Stages | S1 manifest + templates + nav-button + hotkey + folder-template wiring · S2 ReviewsDashboard class + 7 probe panels (TDD-first) · S3 ReviewsHubCards + hub note · S4 manual smokes + close |
| Risk register | 7 panels = 7 probe surfaces. ISO week numbering edge cases (week 53, year boundaries). Date-aware routing across week/month boundaries on edge dates. Probe queries against absent directories must not throw (Dataview `pages('"missing"')` returns empty page-collection but verify on smoke). |
| Inline-CF forecast | First-of-its-kind precedent (v0.5.0 / v0.6.0 / v0.16.0 / v0.17.0) → expect 2-4 in-cycle CFs at probe-edge / smoke-time |
| Harness delta | +4-6 sub-asserts to `run-helper-cases.js` for probe-with-empty-source TDD coverage; **zero installer schema changes** |

---

## Open questions (carry into writing-plans)

> [!todo] Open questions
> 1. **Hotkey bindings** — `Mod+Shift+W` / `Mod+Shift+M` OK, or pick different bindings?
> 2. **Tasks panel scope** — count only checkboxes inside `spice/to-do/<period>/` notes, or scan ALL files in the period range for `- [ ]` lines? Latter catches meeting action items + project task notes; former is cleaner. Recommend: cleaner first; expand if user feedback wants it.
> 3. **Projects panel** — surface ALL touched files, or only top-level project atlas notes? Top-level is quieter. Recommend: top-level only.
> 4. **Hub card count** — last 12 weeks/months, or full history with pagination? Recommend: last 12 + a "Show all" toggle deferred to v0.27.x.

---

## Workflow non-interference checklist

> [!success] Parallel-loop guards (lock these before writing-plans)
> - [x] Design doc filed under `Docs/plans/` with date + topic, no version yet (uncertain due to v0.26.x in-flight)
> - [x] No `manifest.json` edits
> - [x] No mechanism / blueprint dir creation
> - [x] No harness changes
> - [x] No `workshop_version` bump
> - [x] No new files outside `Docs/plans/`
> - [x] Explicit "post-v0.26.1 + post-v0.26.2" sequencing called out at top
> - [ ] Implementation plan deferred until v0.26.1 closes (reason: plan needs post-v0.26.1 baseline)

---

## Next steps

1. v0.26.1 P1 carries closes (parallel session).
2. v0.26.2 sticky-notes opens, gets designed + planned + shipped.
3. After v0.26.2 closes, re-read this design + invoke `writing-plans` to author the implementation plan against the post-v0.26.x baseline.
4. Implementation plan goes to `Docs/plans/<close-date>-v0.27.0-reviews-blueprint-plan.md`.
