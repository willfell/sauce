---
created: 2026-05-02
tags:
  - accuris
  - plan
  - 2026/05/02
status: complete
---

# CustomJS Guard Rollout — Implementation Context

> [!abstract] Goal
> Eliminate the "ReferenceError: customJS is not defined" flash that
> appears on every `dataviewjs` block during cold vault load by routing
> all CustomJS usage through a centralized guarded dispatcher.

> [!success] Canonical pattern
> Replace every bare `await customJS.X.Y(dv)` with:
> ```dataviewjs
> await dv.view("Extras/Scripts/customjs-guard", { class: "X", method: "Y" });
> ```
> `method` defaults to `"render"`, so the common case is just `{ class: "X" }`.

---

## What we built

### Files

| Path | Role |
|---|---|
| `Extras/Scripts/customjs-guard/view.js` | The polling guard. **Dataview view script**, not a CustomJS class. |
| `.obsidian/snippets/customjs-loader.css` | Loader spinner + "loading…" text. |
| `.obsidian/appearance.json` | `customjs-loader` added to `enabledCssSnippets`. |

### How the guard works

1. Renders a `.customjs-loader` placeholder into `dv.container`.
2. Polls `window.customJS?.[className]` up to **20 × 50ms ≈ 1s**.
3. Removes the placeholder.
4. If the class is available, calls `klass[method](dv, ...args)`.
5. Otherwise renders `_<Class> unavailable_` as a debug-friendly fallback.

### Loader UX

- Hidden for the first 100ms (CSS `animation-delay`), so fast loads are invisible.
- Subtle: muted italic "loading…" + 12px spinning ring at `var(--text-muted)`.

---

## Why each decision was made (failure → fix)

> [!example]+ The five failures we hit, in order
>
> **1. The bare `customJS.X.Y(dv)` pattern itself.**
> Dataview/Templater render blocks before the CustomJS plugin populates
> `window.customJS`. Result: `ReferenceError: customJS is not defined`.
>
> **2. `typeof customJS === 'undefined'` guard — DOES NOT WORK.**
> CustomJS declares its global with `let customJS = …`, so the name is in
> the **temporal dead zone** until initialization. TDZ is the one case
> where `typeof` itself throws a ReferenceError.
> **Always use `window.customJS?.X`** — property access on `window` cannot
> hit TDZ.
>
> **3. Helper placed in `Docs/Meta/Scripts/` — DOES NOT WORK.**
> The CustomJS plugin scans that folder and tries to load every `.js` as
> a CustomJS class. A Dataview view file has different syntax → CustomJS
> hits a parse error and **aborts class registration entirely**, so none
> of the existing classes load.
> **Dataview view scripts MUST live outside `Docs/Meta/Scripts/`.**
>
> **4. `module.exports = async (dv, input) => {…}` — DOES NOT WORK.**
> `dv.view` evaluates the script body inline with `dv` and `input`
> already in scope. A `module.exports = …` assignment runs without
> calling the function. Result: silent no-op, zero output, no error.
> **View scripts must be plain top-level statements.**
>
> **5. Single-file `Extras/Scripts/customjs-guard.js` — UNRELIABLE.**
> In Dataview 0.5.68, the **folder pattern** is most reliable:
> `Extras/Scripts/customjs-guard/view.js`, called as
> `dv.view("Extras/Scripts/customjs-guard")`.

---

## What to avoid

> [!warning]+ Hard-won landmines — do not repeat
> - **DO NOT** put any Dataview view file under `Docs/Meta/Scripts/`. That folder is for CustomJS classes only.
> - **DO NOT** use `typeof customJS`. TDZ throws. Use `window.customJS?.X`.
> - **DO NOT** wrap a Dataview view script in `module.exports = …`. Plain top-level body.
> - **DO NOT** use a single-file `.js` for `dv.view` — use the `folder/view.js` pattern.
> - **DO NOT** reference `customJS` directly in vault notes. Always go through the guard.

---

## Canonical locations

| Concept | Location | Notes |
|---|---|---|
| CustomJS class files | `Docs/Meta/Scripts/*.js` | Scanned by CustomJS plugin. One class per file. |
| Dataview view scripts | `Extras/Scripts/<name>/view.js` | NOT scanned by CustomJS. Inline script body. |
| Loader CSS | `.obsidian/snippets/customjs-loader.css` | Already enabled in `appearance.json`. |

---

## Inventory snapshot (2026-05-02)

> [!info]+ CustomJS classes in use (11)
>
> | Class | Methods Called |
> |---|---|
> | SpaceNavButtons | render |
> | SpaceDailyDashboard | render |
> | SpaceDailyActions | render |
> | MeetingsHubCards | render |
> | NewMeetingButton | render |
> | PlanningBoardProjects | render |
> | PlanningNavButtons | render |
> | ProjectNavButtons | render |
> | ProjectWorkstreamManager | render |
> | ProjectWorkstreams | render |
> | TodoDataviewBlocks | renderCarryover, renderCompletedToday, renderDueToday |
>
> Re-grep before the rollout in case new classes have been added.

> [!info] Files already converted
> - `Timestamps/2026/05-May/2026-05-02-Saturday.md` (test note, both blocks)

> [!info] Files NOT yet converted (rough)
> - ~685 files contain bare `customJS.SpaceNavButtons.render(dv)` (minus the 1 already done).
> - All 22 templates in `Extras/Templates/`.
> - All other classes' callsites (haven't enumerated yet).

---

## API reference

### Canonical form — always object

```dataviewjs
await dv.view("Extras/Scripts/customjs-guard", { class: "SpaceNavButtons" });
await dv.view("Extras/Scripts/customjs-guard", { class: "TodoDataviewBlocks", method: "renderCarryover" });
await dv.view("Extras/Scripts/customjs-guard", { class: "Foo", method: "bar", args: [42, "hello"] });
```

### Input fields

| Field | Required | Default | Notes |
|---|:-:|---|---|
| `class` | yes | — | Name on `window.customJS` |
| `method` | no | `"render"` | Method to invoke on the class |
| `args` | no | `[]` | Extra args appended after `dv` |

The helper also accepts a string shorthand (`"X"` ≡ `{ class: "X" }`) for
ad-hoc use, but the always-object form is canonical so a single grep finds
every callsite.

---

## Status

- [x] Helper at `Extras/Scripts/customjs-guard/view.js`
- [x] CSS snippet enabled
- [x] Test note converted (`2026-05-02-Saturday.md`)
- [x] Audit (Pass 1: implementation review, Pass 2: vault inventory)
- [x] Vault-wide rollout (1186 .md callsites + 1 second-pass)
- [x] Templates updated (19 templates)
- [x] Generators updated (QuickAdd `quickadd-create-project-v2.js`, `/project` skill template)
- [x] JSDoc usage examples updated (10 files in `Docs/Meta/Scripts/`)
- [x] Docs updated (Plugins.md "CustomJS in dataviewjs" section, Style-Guide.md pointer, CLAUDE.md resolver row)
- [x] Prose mentions rewritten (Daily-Notes.md, Projects-System.md, Cowork/context/obsidian-vault-guide.md)
- [x] Audit rule added to `/audit` as Check H

---

## Post-rollout summary (closed 2026-05-02)

### Helper changes (Phase A)

`Extras/Scripts/customjs-guard/view.js`:
- Added `args` array validation. Non-array `cfg.args` now renders `_customjs-guard: \`args\` must be an array_` instead of throwing `TypeError`.
- Bumped poll budget from 20×50ms (~1s) to 40×50ms (~2s) so cold iOS launches don't fall through to the unavailable fallback before CustomJS finishes registering.
- Updated docstring to reflect the new 2s poll budget.

The "consider" items from the audit (`prefers-reduced-motion` CSS, `dv.container` null guard, polled-duration in unavailable message, `<span>` semantics, `cfg.method ?? "render"` → `||`, try/catch around target call) were left untouched — none conflict with locked decisions, all are cosmetic/defensive, and shipping them adds noise without payoff.

### Markdown conversions (Phase B)

- 1186 executable callsites converted across ~687 files (1185 in the first script pass, +1 caught in a second pass after a meeting note was added/touched mid-rollout).
- Final guarded-callsite count across `.md`: **1217** (includes templates, the test note, etc.).
- Per-class distribution matches the audit's §2 inventory; no class went unconverted.
- Callout-prefixed blocks (`> [!todo]+` etc. in `Template, ToDo.md`, the matching `Timestamps/ToDo/2026-05-02-ToDo.md`, and `2026-05-02-Task-Workspace-Expansion-design.md`) preserved their `> ` prefixes — the substring-replace approach worked exactly as the audit predicted.

### Generator + skill updates (Phase C)

- `Extras/Templates/` — 19 template files, all converted (audit listed 18; one new `Template, Task Note.md` was added since the audit).
- `Docs/Meta/QuickAdd/quickadd-create-project-v2.js` — 6 embedded callsites in template literals (atlas note + structure note paths). Without these, every `Cmd+P → Create Project` would have rewritten the deprecated pattern back into the vault.
- `.claude/commands/project.md` — 8 embedded callsites in the `/project` skill's note templates. Same drift vector as the QuickAdd generator.

### Documentation (Phase D)

- New canonical reference: `Docs/Meta/Plugins.md` → "CustomJS in dataviewjs" — required pattern, canonical object form, input-field table, "What to avoid" landmines, reload reminder.
- `Docs/Meta/Style-Guide.md` — short pointer to the Plugins.md section.
- `CLAUDE.md` — new resolver row mapping "CustomJS in dataviewjs / customjs-guard / ReferenceError" → `Docs/Meta/Plugins.md`.
- Prose rewrites in `Docs/Meta/Daily-Notes.md`, `Docs/Meta/Projects-System.md`, `Cowork/context/obsidian-vault-guide.md` — every backtick-quoted bare-pattern example now shows the guarded form, with a one-line note that the bare form was deprecated 2026-05-02.
- 10 JSDoc usage-example headers in `Docs/Meta/Scripts/*.js` updated to the canonical guarded form.

Prose mentions of "customJS" as the underlying technology (in `2026-05-02-Task-Workspace-Expansion-design.md` and elsewhere) were intentionally left as-is — they describe the system, not a callsite.

### Audit rule (Phase E)

`.claude/commands/audit.md` — new **Check H: CustomJS guard compliance**. Greps for `await customJS.` in `.md` files outside the 4-file doc-only allowlist, in the QuickAdd generator (non-comment lines), in the `/project` skill template, and for `typeof customJS` anywhere. JSDoc-example regressions in `Docs/Meta/Scripts/*.js` flagged as 🟡 drift. Report template + status block updated to include section H.

### Doc-only allowlist (preserved bare patterns)

- `Docs/plans/2026-05-02-customjs-guard-rollout.md` (this file)
- `Docs/plans/2026-05-02-customjs-guard-audit.md`
- `boards/to-do/card-notes/2026/05-May/New CustomJS rollout implementation.md`
- `boards/to-do/card-notes/2026/05-May/Audit New CustomJS Loading Mechanism, how it works, and inventory all uses that don't follow it.md`

`.claude/commands/audit.md` also now contains `await customJS.` references in the Check H grep documentation — this is intentional (the audit rule itself names the pattern it grep-fails on).

### Deviations from audit plan

- Conversions ran across all `.md` files via a single Python `str.replace` pass instead of per-class batches. The audit's "verify after each class" instruction was preserved by the post-conversion grep showing only allowlist hits remain.
- Final guarded-callsite count is **1217**, not the audit's predicted ~1178. The delta is from (a) ~8 new vault notes added since the audit, (b) Phase D/E adding examples in Plugins.md and audit.md, and (c) the audit report itself contains the literal `dv.view("Extras/Scripts/customjs-guard"` string in its example code blocks. None of those are regressions.
- The audit recommended bumping poll budget from 1s → 2s; applied as 40×50ms iterations to keep the same per-iteration granularity rather than e.g. 20×100ms.

### Open follow-ups

- **Manual smoke test (mobile + desktop).** The agent rollout cannot fire iOS or desktop Obsidian itself. Open a freshly-converted daily note from cold-start on each platform and confirm: no red `ReferenceError` flash, only the muted "loading…" placeholder for ≤2s before nav buttons render.
- **`prefers-reduced-motion` CSS.** Two-line accessibility nicety; deferred. Add to `.obsidian/snippets/customjs-loader.css` next time the file is touched: `@media (prefers-reduced-motion: reduce) { .customjs-loader::before { animation: none; } }`.
- **Other "consider" items from audit §1.** Polled-duration in unavailable message, `<span>` semantics for the loader, `dv.container` null guard, etc. — all low-priority, none blocking.
