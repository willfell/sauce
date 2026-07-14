# Code-Fence Button — Design Spec

**Date:** 2026-07-13
**Kind:** NEW mechanism
**Name:** `code-fence-button`

---

## Problem

There is no fast way to wrap a chunk of selected text in a fenced code block from inside Obsidian. The user wants a small, always-present button in Obsidian's **view-header action row** (far-right, next to the native icons) that:

- is **greyed-out/disabled by default** and **lights up the instant text is selected** in the active editor, greying again on deselect — synced live in every note;
- on click, wraps the current selection in a fenced code block using a fence long enough to survive any backticks inside the selection (the user is fine with 4 or 5 ticks "just in case");
- carries a **code icon** (`</>`);
- sits at the **far right** of the header (last child of `.view-actions`).

This vault ships **no real Obsidian plugin** — everything is customJS / dataviewjs distributed via Homebrew. So the button must be built the Sauce way: a customJS **mechanism** with a startup-script class, in the same family as `kanban-status-sync` (`KanbanStatusSyncInit`) and `ProjectCommandsInit`.

---

## Approach (chosen)

**customJS startup-script mechanism** — no real plugin, no CM6 internals, only public-ish Obsidian APIs (`MarkdownView.addAction`, `Editor.getSelection/somethingSelected/replaceSelection`, workspace events, the DOM `selectionchange` event). Slots straight into Sauce's install/subscription/brew machinery and self-heals nothing (no note bodies touched — it's pure app chrome).

Rejected alternatives (see brainstorm): a real bundled `.obsidian/plugins` plugin (new distribution surface, against the grain), and a command-only version (no visible button, fails the core ask — but we register the command anyway as a free bonus).

---

## Architecture

A single mechanism directory `platform/mechanisms/code-fence-button/` with **two customJS classes**:

### `CodeFenceButton` — pure logic + the wrap action

Note-type-agnostic, Node-testable **static** helpers (no `app`/DOM dependency):

- **`computeFence(selection: string): string`**
  Scan `selection` for the longest run of consecutive backticks `N` (regex `/`+/g`, track max length). Return a string of `max(4, N + 1)` backtick characters. So:
  - no backticks → `` ```` `` (4)
  - contains `` ``` `` (3) → `` ```` `` (4)
  - contains `` ```` `` (4) → `` ````` `` (5)
  - contains `` ````` `` (5) → 6
  Always ≥ 4 (honors "4 or 5 to be safe") and always a valid CommonMark fence (a fence of `M` backticks can contain any run of `< M`).

- **`wrapSelection(selection: string, opts: { atLineStart: boolean, atLineEnd: boolean }): { text: string, cursor: number }`**
  Build the replacement string:
  ```
  {leadingNL}{fence}\n{selection}\n{fence}{trailingNL}
  ```
  - `leadingNL = atLineStart ? "" : "\n"` — guarantees the opening fence begins its own line even when the selection starts mid-line.
  - `trailingNL = atLineEnd ? "" : "\n"` — guarantees the closing fence ends its own line.
  - Bare fence, **no language tag**.
  - `cursor` = offset (within `text`) just after the closing fence, so the caret lands after the block.
  Empty/whitespace-only selection → return `null` (caller no-ops).

- **`wrapActiveEditor(view)`** (thin, app-facing) — reads `view.editor`, computes `atLineStart`/`atLineEnd` from the selection's anchor/head, calls `wrapSelection`, and `editor.replaceSelection(...)` + sets the cursor. Guarded + never-throw. This is the single wrap entry point shared by both the button click and the command.

### `CodeFenceButtonInit` — the startup script (all Obsidian wiring)

Registered in the mechanism manifest's `customjs_startup_scripts[]`; customJS calls `invoke()` at plugin load. Responsibilities:

1. **Inject the button** — a `_syncButtons()` pass that walks `app.workspace.getLeavesOfType("markdown")`, and for each `MarkdownView` ensures our action exists:
   - Skip if the view already carries our tagged element (`view.containerEl.querySelector(".view-header .sauce-code-fence-action")`) — **idempotent**, no duplicates.
   - Otherwise `const el = view.addAction("code-2", "Wrap selection in code fence", () => this._onClick(view))`, add class `sauce-code-fence-action`, and **move `el` to be the last child of its `.view-actions`** so it sits far-right.
   - Run `_syncButtons()` on startup and on `app.workspace.on("active-leaf-change")` + `on("layout-change")` (new panes/splits get the button).

2. **Live greying** — one debounced (~50 ms) global `document` `selectionchange` listener → `_refreshEnabled()`:
   - Resolve the active `MarkdownView` (`app.workspace.getActiveViewOfType(MarkdownView)`).
   - `enabled = !!(view && view.editor && view.editor.somethingSelected())`.
   - Toggle `.is-disabled` (opacity ~0.35, `cursor: default`) + `aria-disabled` on that view's button element.
   - Reading-mode notes have no editor selection → button stays greyed there naturally. Also re-run `_refreshEnabled()` on `active-leaf-change`.

3. **Click** — `_onClick(view)`: bail if disabled / no selection; else `CodeFenceButton.wrapActiveEditor(view)`.

4. **Bonus command** — `app.commands.addCommand({ id: "code-fence-button:wrap-selection", name: "Sauce: Wrap selection in code fence", ... })`, reusing `wrapActiveEditor` on the active view. Cmd+P + hotkey-bindable. Idempotent (guard flag).

5. **Idempotent teardown across customJS reloads** — stash the workspace `EventRef`s + the bound `selectionchange` handler on a well-known global (`window._sauceCodeFenceButton`). At the top of `invoke()`, if a prior registration exists, `app.workspace.offref(...)` each ref + `document.removeEventListener("selectionchange", prev.onSel)` before re-registering. Prevents listener leaks / double-fires when customJS reloads its classes. Injected button elements are reconciled by the idempotent `_syncButtons()` guard.

Every method is **never-throw** and **cold-load-safe**: missing `app`, `app.commands`, `MarkdownView`, or a view without an editor degrades to a no-op (or a single `Notice` on a mis-fired command), never a thrown error — matching `ProjectCommandsInit` / `KanbanStatusSyncInit`.

---

## Icon & position

- Icon: Obsidian's built-in lucide **`code-2`** (`</>`). `addAction` resolves lucide names via `setIcon`.
- Position: **last child** of the view header's `.view-actions` (explicit `appendChild` after add) → far-right "no matter what", right of the native `⋯`.

---

## Files

```
platform/mechanisms/code-fence-button/
  manifest.json
  code-fence-button.js        → {{scripts_path}}/code-fence-button/code-fence-button.js
  code-fence-button-init.js   → {{scripts_path}}/code-fence-button/code-fence-button-init.js
```

**manifest.json** (mirrors `kanban-status-sync`):
```json
{
  "name": "code-fence-button",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Always-present view-header button (far-right, code icon) that greys out until text is selected, then wraps the selection in a fence long enough to survive inner backticks. Ships an equivalent 'Sauce: Wrap selection in code fence' command.",
  "depends_on": [{ "name": "customjs-guard", "range": ">=1.0.0" }],
  "customjs_classes": ["CodeFenceButton", "CodeFenceButtonInit"],
  "customjs_startup_scripts": ["CodeFenceButtonInit"],
  "files": [
    { "source": "code-fence-button.js", "dest": "{{scripts_path}}/code-fence-button/code-fence-button.js" },
    { "source": "code-fence-button-init.js", "dest": "{{scripts_path}}/code-fence-button/code-fence-button-init.js" }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

Depends only on `customjs-guard` (baseline). No blueprint, no templates, no note-body markers, **no install heal** — it touches zero note content, so there is nothing to migrate.

---

## Distribution

New mechanism ⇒ each vault must **subscribe** and pin it:

- **Workshop self-subscription** — add `{ "name": "code-fence-button", "version": "0.1.0" }` to `ranch/platform-subscription.json`.
- **Seed-vault harness** — add the same entry to `platform/test/seed-vault/ranch/platform-subscription.json` so the migration-regression net installs it.
- **Consumer vaults (accuris / headspace / ero)** — add the entry to each vault's `ranch/platform-subscription.json`, then `sauce update --bump-pins` (or `--force` at the pinned version) with the vault as CWD. This is the final rollout step, done **after** the workshop release + brew update land.

Version / pin bumps for the workshop itself and the release PR are the **automatic pipeline's** job — we only author the subscription entries and conventional commits.

---

## Testing

### Unit (Node harness) — `platform/test/run-code-fence-button.js`

Pure `CodeFenceButton` statics, no DOM:

| Case | Assertion |
|------|-----------|
| CFB-1 no backticks | `computeFence("hello")` → 4 backticks |
| CFB-2 contains ``` | `computeFence("a ``` b")` → 4 backticks |
| CFB-3 contains 4 | `computeFence("````")` → 5 backticks |
| CFB-4 contains 5 | `computeFence("`````")` → 6 backticks |
| CFB-5 full-line selection | `wrapSelection("x", {atLineStart:true,atLineEnd:true})` → no leading/trailing extra `\n`; fence on own line |
| CFB-6 mid-line selection | `atLineStart:false` → leading `\n`; `atLineEnd:false` → trailing `\n` |
| CFB-7 multiline selection | inner text preserved verbatim between fences |
| CFB-8 empty selection | `wrapSelection("", …)` → `null` |
| CFB-9 cursor offset | `cursor` lands immediately after the closing fence |

Wired into the repo's existing `node platform/test/run-*.js` harness convention (same as other mechanisms).

### Integration — manual, on-device

DOM injection + the selection listener are not unit-tested (they need a live Obsidian). Verified by dogfood-install into the workshop vault's own `.obsidian`, reload, and check:

1. code icon appears far-right in the header of every markdown note (incl. new splits/tabs);
2. greyed with no selection, lights on selection, greys again on deselect;
3. click wraps the selection with the correct fence length; caret lands after the block;
4. mid-line and multiline selections wrap validly;
5. the `Sauce: Wrap selection in code fence` command works from Cmd+P;
6. a customJS reload leaves exactly one button per view (no dupes) and no duplicate wraps (no listener leak).

---

## Scope

**In:** the mechanism (2 classes + manifest), the Node harness, workshop + seed-vault subscription, dogfood verify, then the full release → brew → 3-vault deploy.

**Out:** language-tag detection on the fence; inline-code (single-backtick) mode for single words; a settings surface; unwrap/toggle behavior. All are easy follow-ups if wanted.
