# Research item — Tasks plugin emoji-free UX (carried over from v0.41.x cycle)

**Status:** OPEN — research + design needed before next implementation cycle.
**Origin:** v0.41.0–v0.41.5 cycle (2026-05-13). User opened with "ensure icons utilized for to-do tasks are icons and not emojis"; after five patches the user reported two persistent UX gaps and explicitly asked to defer further work for research.
**Affected user:** primary developer (accuris-sauce vault).

---

## What v0.41.x actually shipped

| Surface | State at v0.41.5 close | User-visible result |
| --- | --- | --- |
| **Rendered tasks** (Reading view + Live Preview off-cursor lines) | `sauce-tasks-icons.css` swaps emoji glyphs (📅 ⏫ 🔼 🔽 ⏳ 🛫 ✅ 🔁) → Lucide SVGs via `::before` + `font-size: 0` on the original emoji span | ✅ Works as designed when metadata is on the task line |
| **Tasks plugin suggester popup** (dropdown when typing inside `- [ ]`) | Emojis STILL VISIBLE — no platform fix possible via CSS alone | ❌ "i'm not okay with them showing up at all" |
| **Cmd+Shift+T modal** (Tasks: Create or edit task) | Native form with date pickers / priority radio buttons / status selector — zero emojis in UI | ✅ Available as an emoji-free alternative path; user has not yet exercised it |
| **Edit mode rendering** | Live Preview with `livePreview: true` + `defaultViewMode: "preview"` | ⚠️ User reports "edits still look bad" — UNDIAGNOSED. Two screenshots received: (a) `accuris-beacon-poc/spice/daily/2026/05-May/Wednesday-2026-05-13.md` showing GOOD state (rendered nav-buttons row + properties chips + cursor on empty line), (b) accuris-sauce to-do file with cursor on a `- [ ]` line showing brackets. Inconclusive — could be Live Preview inherent behavior or could be a regression I haven't found |

---

## Root cause of the suggester gap

Tasks plugin's suggester (Obsidian `EditorSuggest` API) renders items via the standard `.suggestion-container > .suggestion-item` DOM. Items are text strings like `"📅 due date"` set via `el.setText(...)`. **There is NO Tasks-plugin-specific CSS class on these items** — verified by reading `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/.obsidian/plugins/obsidian-tasks-plugin/styles.css` end-to-end: the only suggester-related classes are `.tasks-modal-*` (for the Cmd+Shift+T modal), not for the inline EditorSuggest popup.

Consequences for CSS-only approaches:
- `.suggestion-container .suggestion-item { ... }` rules hit EVERY suggester (wikilink, file, command palette, etc.)
- No `:has(text="📅")` or content-matching pseudo-class exists in CSS
- `::first-letter` works on the first text char but emoji code points are multi-codepoint (variation selectors); the result is unreliable and breaks any non-Tasks suggester item starting with a letter
- `unicode-range` font substitution requires shipping a custom font file (WOFF/WOFF2 with zero-width glyphs at specific code points); could collide with legitimate emojis in note titles / file names appearing in other suggesters
- `font-variant-emoji: text` is a real CSS prop but Electron support is inconsistent; only forces text-style, doesn't HIDE emoji

The user explicitly rejected "best-effort CSS desaturation" — they want a professional look, not gray emojis.

## Tracks worth researching

### Track A — Plugin-level intervention via CustomJS

Hook the Obsidian Tasks plugin's suggester at runtime. Approach:
1. CustomJS class that monkey-patches `app.plugins.plugins["obsidian-tasks-plugin"].editorSuggest.renderSuggestion`
2. Inside the override, after the plugin renders the suggestion, walk the DOM, find the leading emoji char, replace it with a Lucide SVG `<span>` matching the same codepoint mapping as `sauce-tasks-icons.css`
3. Register the patch in a startup script so it survives Obsidian reloads
4. Risk: brittle — the next Tasks plugin version may rename the suggester class or change the render pipeline

Effort: ~1 day of plumbing + careful testing. Output: a new helper class shipping via a new mechanism (or absorbed into `convenience`).

### Track B — Custom webfont

Build a tiny WOFF2 font where the Tasks plugin emoji code points (📅 U+1F4C5, ⏫ U+23EB, 🔼 U+1F53C, 🔽 U+1F53D, ⏬ U+23EC, 🔺 U+1F53A, 🔻 U+1F53B, ✈️ U+2708/U+1F6EB, ⏳ U+23F3, ✅ U+2705, 🔁 U+1F501, ➕ U+2795, ➖ U+2796, ❌ U+274C, 🆔 U+1F194) are mapped to Lucide-style monochrome glyphs.

Then in CSS:
```css
@font-face {
  font-family: 'SauceTaskGlyphs';
  src: url('data:font/woff2;base64,...') format('woff2');
  unicode-range: U+1F4C5, U+23EB, ... ;
}
.suggestion-container .suggestion-item,
.task-list-item {
  font-family: 'SauceTaskGlyphs', var(--font-text);
}
```

Pros:
- Pure CSS — no plugin lifecycle / monkey-patch fragility
- Naturally handles suggester + rendered tasks + ANY surface using the same codepoints

Cons:
- Need to build the font (FontForge / Glyphs / Inkscape + a script). One-time effort.
- File size budget — small (~3-5 KB if glyphs are simple SVG paths)
- Risk of mis-matching glyphs in unrelated contexts: any note titled `📅 Meeting Notes.md` appearing in a wikilink suggester will show a Lucide calendar icon instead of the emoji. Probably acceptable / arguably an improvement.
- Doesn't auto-update when Tasks plugin adds a new emoji symbol (would need a bump every time)

Effort: ~2-3 hours of glyph building once we have the Lucide SVG library + a simple build script. Could automate with `lucide` npm package + `fontmin` or similar.

### Track C — Tasks plugin upstream PR or fork

The cleanest fix: contribute to obsidian-tasks-plugin to add a setting like `suggesterIconStyle: "emoji" | "text" | "lucide"`. Upstream maintainers may or may not accept; could take months.

Alternative: maintain a sauce fork. Heavy ongoing cost.

### Track D — Replace Tasks plugin entirely

Some alternative plugins do task metadata without emojis natively. Investigation needed. Risk: workflow disruption + losing the Tasks query language (which the user may rely on).

---

## "Edit mode looks bad" — DIAGNOSTIC GAP

Three rounds of back-and-forth in v0.41.x produced:
- v0.41.0: shipped `livePreview: false` + `defaultViewMode: "preview"` — degraded edit experience
- v0.41.3: reverted `livePreview` → `true` — Live Preview restored
- User after v0.41.4–0.41.5: still reports "edits look bad" / "barebones"

**The actual regression is unclear.** Comparison evidence captured:
- GOOD reference (user-shared): `accuris-beacon-poc/spice/daily/2026/05-May/Wednesday-2026-05-13.md` in Live Preview with cursor on an empty line — shows rendered nav-buttons + properties chips + "Edit this block" affordance on the dataviewjs block. This is what Live Preview SHOULD look like.
- BAD example (user-shared earlier): accuris-sauce to-do file with cursor sitting on a `- [ ]` line — brackets visible because Live Preview reveals markdown structure on the cursor line.

These two screenshots show different STATES of the same editor, not necessarily different editors. To pin down whether there's an actual regression vs. the user comparing different cursor states, a future cycle needs:

1. Side-by-side same-file screenshots at same cursor position from old beacon-poc vault vs current accuris-sauce vault
2. App.json + appearance.json diff between the two vaults
3. Snippet enable-state diff
4. Theme (Baseline) version diff if both have it
5. Tasks-plugin styles.css version diff

If a real regression exists, candidates to investigate:
- `cssclasses: wide` rendering may differ between vaults
- Style Settings JSON may have drifted (per-key first-wins on install — user values usually preserved)
- A new Obsidian version may have changed Live Preview default behavior
- Some other v0.41.x side-effect we missed

If NO regression — just Live Preview inherent behavior — document for user: "decorations on the cursor line are how Live Preview is designed; move the cursor off the line to see the styled rendering. Sauce hasn't changed this."

---

## What the next cycle should look like

**Suggested cycle name:** v0.42.0 OR v0.41.6 (depending on scope)

**Phase 1 — diagnostic (no code changes):**
- Reproduce both vaults on a single machine
- Capture side-by-side screenshots at matched cursor positions
- Diff all `.obsidian/` files relevant to rendering (appearance.json, app.json, style-settings/data.json, snippets directory, themes/Baseline)
- File a clear regression report OR a "this is Live Preview by design" closure

**Phase 2 — suggester emoji fix (pick a track):**
- Track A (CustomJS monkey-patch) — fastest to ship, fragile long-term
- Track B (custom webfont) — moderate effort, clean ongoing maintenance
- Decide based on Phase 1 findings + appetite for ongoing maintenance

**Phase 3 — package + ship:**
- Add the chosen fix to convenience@0.3.0 (MINOR — non-trivial new behavior)
- Test on accuris-sauce + workshop self-install
- Ship as a clean cycle, not a patch chain

---

## Hot context for a future cycle starter

- **Snippet location:** `platform/mechanisms/convenience/assets/snippets/sauce-tasks-icons.css` (shipped via `applySnippets` helper).
- **Snippet entry in convenience manifest:** `snippets[]` + `appearance.enabledCssSnippets[]`.
- **Tasks plugin command IDs verified:** `obsidian-tasks-plugin:edit-task` (modal), `obsidian-tasks-plugin:toggle-done` (toggle done), various status sub-commands (`due`, `scheduled`, `start`, `created`, `cancelled`, `done`).
- **Tasks plugin styles.css path:** `.obsidian/plugins/obsidian-tasks-plugin/styles.css` — contains `.tasks-modal-*` classes for the modal, `.task-list-item .task-due`/`.task-priority`/etc for rendered tasks, NO classes for the inline EditorSuggest suggester.
- **convenience@0.2.4 hotkeys[]:** Cmd+- / Cmd+= / Cmd+T / Cmd+E / Cmd+Shift+T.
- **app_settings (platform manifest):** `alwaysOpenInNewTab: true` + `defaultViewMode: "preview"` + `livePreview: true`.
- **Tasks plugin data.json `taskFormat`:** `tasksPluginEmoji` (v0.41.4 reverted from dataview).

---

## Decision log (chronological)

- **v0.41.0:** Initial design assumed CSS-only solution for "icons not emojis". Shipped `sauce-tasks-icons.css` targeting `.task-due` / `.task-priority`. Cycle approved before realizing suggester had no Tasks-specific class. Whole-suite green; user installed; reported emojis still visible in suggester.
- **v0.41.1:** Patch — drop project blueprint's `products`/`teams` depends_on (unrelated to emoji issue; v0.39.0 install-block surfaced during accuris-sauce upgrade).
- **v0.41.2:** Switched Tasks plugin `taskFormat: "dataview"` thinking it'd suppress suggester emojis. Did suppress them. But broke rendered-task styling — Tasks plugin only emits `.task-due` / `.task-priority` DOM in emoji format. User saw raw `[due:: ...]` text. Reverted in v0.41.4.
- **v0.41.3:** Patch — restore `livePreview: true` + explicit Cmd+E binding (user reported Cmd+E stopped toggling).
- **v0.41.4:** Revert taskFormat to `tasksPluginEmoji` (undoes v0.41.2's mistake).
- **v0.41.5:** Added Cmd+Shift+T → `obsidian-tasks-plugin:edit-task` hotkey (modal-based emoji-free entry path). Suggester popup still shows emojis — user wants more.
- **2026-05-13 (this doc):** User asks to defer further work. Research item filed.

---

## Acceptance criteria for "closing" this research item

The future cycle is done when:
- [ ] User can create + edit tasks WITHOUT any emoji glyph visible in any UI surface
- [ ] Rendered tasks still show Lucide icons (don't regress v0.41.0's `sauce-tasks-icons.css` win)
- [ ] Edit-mode "barebones" complaint is either fixed OR explained with evidence that it's Live Preview by design
- [ ] No regressions in Cmd+E, Cmd+T, Cmd+Shift+T hotkeys
- [ ] Whole-suite preflight green
- [ ] Workshop self-install clean
- [ ] User confirms acceptance on accuris-sauce
