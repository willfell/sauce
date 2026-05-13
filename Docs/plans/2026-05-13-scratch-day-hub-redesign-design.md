---
type: design
cycle: v0.40.0
status: approved
date: 2026-05-13
blueprint: scratch
mechanism: nav-buttons
---

# Scratch day-hub redesign — design

> [!abstract] Goal
> Click **Scratch** → arrive at today's *day-hub* note (open if exists, create if not). The day-hub lives in today's folder, lists today's scratches, and offers a local **+ New Scratch** button that creates timestamped scratches in the same folder. Resolves wikilink collision with daily notes, empty global hub, and dead-end navigation reported against `scratch@0.1.0`.

---

## Problem statement

> [!warning] Three stacked bugs in `scratch@0.1.0` make the blueprint feel clunky
> 1. **Wikilink collision.** Day-index filename `<DayName>-YYYY-MM-DD.md` is byte-identical to daily-blueprint filename `dddd-YYYY-MM-DD.md`. `[[Tuesday-2026-05-12|Back to day]]` resolves to the daily note, not the scratch day-index.
> 2. **Empty global hub.** `ScratchHubCards` targets the dead day-index path; clicks dead-end or wrong-route. With the collision, the page never feels populated.
> 3. **No "today's scratches" list at a natural landing point.** Back-link from a scratch lands on the daily note, which has no awareness of scratches.

User report:
> Within the accuris vault, when I click the scratch button it takes me to `…/Scratch-2026-05-13-00-00.md`. The back-to-day link sends me to the daily note. The hub at `Scratch.md` shows nothing. I have no list of scratch notes — no way to navigate anything. It's just clunky and not worth it at the moment.

---

## End-state behavior

> [!success] User journey
> 1. Click **Scratch** in `SpaceNavButtons` (from daily, global hub, anywhere).
> 2. If today's day-hub exists → open it. If not → create it from template, then open.
> 3. Day-hub shows: nav-buttons row, **+ New Scratch** button, list of today's scratches with preview snippets, link back to global `Scratch` hub.
> 4. Click **+ New Scratch** → creates `Scratch-YYYY-MM-DD-HH-mm.md` in the same folder; opens it.
> 5. Scratch footer: `← [[Scratch-Day-YYYY-MM-DD|Back to day]] · [[Scratch|Hub]]`. Wikilinks resolve unambiguously.
> 6. Global hub `Scratch.md` cards link to each day-hub. Click a card → opens that day's hub.

---

## Folder layout

```
spice/scratch/
├── Scratch.md                                       # Global hub (location unchanged)
└── 2026/05-May/2026-05-13/
    ├── Scratch-Day-2026-05-13.md                    # Day-hub (NEW filename pattern)
    ├── Scratch-2026-05-13-09-15.md                  # Individual scratch
    └── Scratch-2026-05-13-11-42.md                  # Individual scratch
```

Day-hub filename **`Scratch-Day-YYYY-MM-DD.md`** — collision-free with daily note's `dddd-YYYY-MM-DD.md`. Sorts alongside `Scratch-*` siblings.

---

## Mechanism delta — NONE

> [!success] No `nav-buttons` bump needed
> Initial design assumed `nav-buttons@2.6.0 → 2.7.0` MINOR with a new `if_exists` field. Reading `platform/mechanisms/nav-buttons/space-nav-buttons.js:348-352` shows the renderer **already** does open-if-exists for `runTemplaterTemplate`:
>
> ```js
> const existingTarget = app.vault.getAbstractFileByPath(target);
> if (existingTarget) {
>   app.workspace.openLinkText(target, "");
>   return;
> }
> ```
>
> The behavior is dormant for `scratch@0.1.0` because the current nav-button's filename suffix is `HH-mm`, making every click a unique path. Drop the time suffix from the nav-button's filename composition (target `Scratch-Day-YYYY-MM-DD` instead of `Scratch-YYYY-MM-DD-HH-mm`), and open-if-exists kicks in for free.

**Result:** cycle scope collapses to a single blueprint MINOR. No mechanism risk surface.

---

## Blueprint delta — `scratch@0.1.0 → 0.2.0` MINOR

### Templates

> [!example]- `Scratch Day Hub.md` (NEW — replaces retired `Scratch Day.md`)
> ```md
> ---
> created: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
> type: scratch-day
> day: <% tp.date.now("YYYY-MM-DD") %>
> ---
>
> # <% tp.date.now("dddd, MMMM Do YYYY") %>
>
> ```dataviewjs
> await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
> ```
>
> ```dataviewjs
> await dv.view("{{views_path}}/customjs-guard", { class: "ScratchNewButton" });
> ```
>
> ---
>
> ```dataviewjs
> await dv.view("{{views_path}}/customjs-guard", { class: "ScratchDayList", args: { day: dv.current().day } });
> ```
>
> ---
>
> ← [[Scratch|Hub]]
> ```

> [!example]- `Scratch.md` (individual scratch — retire lazy-create, fix footer)
> ```md
> ---
> created: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
> type: scratch
> day: <% tp.date.now("YYYY-MM-DD") %>
> time: <% tp.date.now("HH:mm") %>
> day_link: "[[Scratch-Day-<% tp.date.now('YYYY-MM-DD') %>]]"
> ---
>
> ```dataviewjs
> await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
> ```
>
> ---
>
>
>
> ---
>
> ← [[Scratch-Day-<% tp.date.now("YYYY-MM-DD") %>|Back to day]] · [[Scratch|Hub]]
> ```
>
> Retired: the `<%* if (!dayIndexPath exists) create %>` block at top. Day-hub creation is the nav-button's job now.

### Helpers

> [!tip] Helper inventory after v0.40.0
> - `helpers/scratch-hub-cards.js` — `ScratchHubCards` (REWRITTEN — target path fix)
> - `helpers/scratch-day-list.js` — `ScratchDayList` (UNCHANGED — already filters by `day` arg)
> - `helpers/scratch-new-button.js` — `ScratchNewButton` (NEW — accent-styled button on day-hub)

`ScratchHubCards` rewrite:
```js
// before:
const dayIndexPath = `spice/scratch/${monthFolder}/${e.day}/${dayName}-${e.day}.md`;
// after:
const dayHubPath   = `spice/scratch/${monthFolder}/${e.day}/Scratch-Day-${e.day}.md`;
```
Drop `dayName` from the path composition; keep it in card title for readability.

`ScratchNewButton` shape:
```js
class ScratchNewButton {
    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;
        const day = dv.current().day;             // YYYY-MM-DD from day-hub frontmatter
        const m = window.moment(day, "YYYY-MM-DD", true);
        const monthFolder = m.format("YYYY/MM-MMMM");
        const folder = `spice/scratch/${monthFolder}/${day}`;
        const btn = dv.container.createEl("button", { text: "+ New Scratch", cls: "beacon-accent-button" });
        btn.onclick = async () => {
            const tp = customJS?.obsidian?.templater  // resolve Templater API
                ?? app.plugins.plugins["templater-obsidian"]?.templater;
            const tpl = tp?.current_functions_object?.file?.find_tfile?.("Scratch.md")
                ?? app.vault.getAbstractFileByPath("ranch/templates/Scratch.md");
            const folderTFile = app.vault.getAbstractFileByPath(folder);
            const time = window.moment().format("HH-mm");
            const filename = `Scratch-${day}-${time}`;
            await tp.create_new_note_from_template(tpl, folderTFile, filename, true);
        };
    }
}
```
(Final API resolution to be finalized in plan — Templater public-API surface is fluid; fallback to direct `app.vault.create` with template body interpolation if `tp.create_new_note_from_template` proves unstable.)

### Manifest changes

- `version: "0.1.0" → "0.2.0"`
- `depends_on.nav-buttons: ">=2.6.0"` (UNCHANGED — renderer already does open-if-exists)
- `customjs_classes: [...]` add `"ScratchNewButton"`
- `files[]` add `helpers/scratch-new-button.js` mapping
- `files[]` rename `Scratch Day.md` → `Scratch Day Hub.md` (template source rename)
- `files[]` keep `Scratch Hub.md → {{module_directory}}/Scratch.md` (global hub unchanged)
- `nav_buttons[0]` update `template_source: "Scratch Day Hub.md"`, `filename_prefix: "Scratch-Day-"`, `filename_date_pattern: "YYYY-MM-DD"`, add `if_exists: "open"`
- `rule_fragments[]` add: `Scratch-Day-*.md` filename pattern + `type: scratch-day` frontmatter requirement; orphan `<dddd>-YYYY-MM-DD.md` flagged as `stale_but_valid`.

---

## Migration

> [!info] Defer to hand-cleanup + `/audit` flag — no migrator built
> - Existing accuris vault has orphan `<DayName>-YYYY-MM-DD.md` files and existing `Scratch-*.md` whose footer wikilink will route to the daily note post-install (semantically fine, but loses day-context).
> - Surface area per affected vault is tiny (handful of files); building a migrator costs more than it saves.
> - `/audit` rule fragment flags orphans as `stale_but_valid`; user deletes on their schedule.
> - Existing `Scratch-*.md` footer wikilinks remain as-is — they'll become broken links naturally pointing at the new `Scratch-Day-*` filename only for *new* scratches created post-install. Old scratches keep their old footers; navigation works (daily note resolves).

---

## Daily-note integration

> [!info] Out of scope this cycle
> - Daily and scratch remain sibling ecosystems.
> - `SpaceNavButtons` (which the daily note already embeds) renders the `Scratch` button — daily IS the natural launchpad.
> - Future cycle could add a `ScratchDayList` widget to daily via cowork mechanism's anchor pattern (`<!-- COWORK_CALLOUTS -->`-style) — not pursued here.

---

## Test deltas

> [!todo] Test surface additions
> - [ ] `run-helper-cases.js` — `+SHC-S40-*` cases: `Scratch Day Hub.md` template aggregation; `helpers/scratch-new-button.js` aggregation; retired-lazy-create assertion on `Scratch.md`; nav-button manifest target verified as `Scratch-Day-` + `YYYY-MM-DD` (no HH-mm).
> - [ ] `run-renderer.js` — `+R-SCRATCH-DAYHUB` case: scratch's nav-button composes path `spice/scratch/YYYY/MM-MMMM/YYYY-MM-DD/Scratch-Day-YYYY-MM-DD.md` (no time suffix). Asserts the *path string*, not behavior — existing open-if-exists branch is renderer-side and already covered by run-renderer scratch case from v0.37.0.
> - [ ] `run-audit.js` — `+SA-S40-*` cases: orphan `<dddd>-YYYY-MM-DD.md` rule fires; `Scratch-Day-*.md` filename pattern accepted; `type: scratch-day` frontmatter validated.
> - [ ] `run-claude-surface.js` — UNCHANGED (no `claude_surface[]` schema change).

---

## Stage shape (writing-plans expands)

> [!todo] Cycle v0.40.0 stages (mechanism bump dropped after renderer review)
> - [ ] **S1** — `scratch@0.2.0` template rework: new `Scratch Day Hub.md`, retired lazy-create in `Scratch.md`, fixed back-link wikilinks.
> - [ ] **S2** — `scratch@0.2.0` helper rework: NEW `ScratchNewButton`, `ScratchHubCards` target path fix.
> - [ ] **S3** — Manifest bump (version + customjs_classes + files + nav_buttons[0] filename composition + rule_fragments).
> - [ ] **S4** — Test harness deltas (renderer + helper-cases + audit).
> - [ ] **S5** — Workshop self-install + housekeeping commits (materialize templates + helpers, ledger update).
> - [ ] **S6** — Tag + release workflow → brew formula auto-bump.

---

## Risks & landmines touched

> [!warning] Watch items
> - **Landmine #11** (module-directory invariant) — UNTOUCHED. All scratch files stay under `spice/scratch/...`. No cross-blueprint write.
> - **Landmine #16** (in-cycle re-process bump) — `nav-buttons@2.6.0 → 2.7.0` is a hard prerequisite for `scratch@0.2.0` install; install order must be respected. Already true via `depends_on` resolution.
> - **Templater API stability** — `ScratchNewButton`'s create-from-template invocation depends on Templater's user-facing function object. Fallback to direct `vault.create` + template-string interpolation if API path proves brittle.
> - **`day_link` frontmatter field** in retired `Scratch.md` template referenced `<% tp.date.now("dddd") %>-<% tp.date.now("YYYY-MM-DD") %>` — updating to `Scratch-Day-<% tp.date.now("YYYY-MM-DD") %>` is part of the template rewrite; no dataviewjs view currently consumes `day_link`, so no breakage downstream.

---

## Unresolved questions

> [!question] Resolve during plan writing or S2 implementation
> - **Q1.** Final API for `ScratchNewButton` create-from-template — Templater `tp.create_new_note_from_template` vs. direct `app.vault.create` with template-body string interpolation. Both are viable; pick the one that doesn't require Templater to be present in `customJS` scope at render time.
> - **Q2.** Cycle slot — v0.40.0 assumes v0.39.0 closes first; if `v0.36.2` (untracked plan in working tree) or another patch jumps the queue, slot may shift to v0.41.0. Final number assigned at plan freeze.
> - **Q3.** Should the orphan-flag audit rule additionally surface a one-click delete affordance, or stay informational? Stay informational for v0.40.0; revisit if accuris/headspace/ero accumulate orphans across all consumers (multi-vault cleanup pain).
