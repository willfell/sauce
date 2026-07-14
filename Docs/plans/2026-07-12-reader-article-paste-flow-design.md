# Reader article paste-flow design

## Context

The `reader` blueprint's Web Clipper template (`platform/blueprints/reader/assets/reader-clip.json`,
`behavior: "create"`) already lets users clip an article directly into the vault from the browser
via a custom "Reader — Clip to Sauce" template. It's the authoritative reader-article field
contract: `type`, `title`, `url`, `author`, `site`, `published` (date), `captured_at` (date),
`word_count` (number), `status`, `summary` (AI-prompted 2-3 sentence text), `tags` (AI-prompted
1-4 lowercase multitext), plus a `noteContentFormat` body embedding `ReaderChromeBar` +
`ReaderArticleView` dataviewjs blocks and two marker regions, `READER_HIGHLIGHTS` /
`READER_CONTENT`, each immediately followed by a token (`{{highlights}}` / `{{content}}`).

Separately, the reader-hub's generic "+ New article" button
(`ReaderArticleActions.renderCreateRow`) opens the shared `entity-create` mechanism directly —
`EC.create({instance: 'reader-article', dv})` — driven by the `reader-article` entry in
`new_entity_buttons[]` in `platform/blueprints/reader/manifest.json`. That entry only prompts for
`title` (required) and `url` (optional); every other field defaults or goes empty.

This means there are two disconnected creation paths today: clip-with-full-metadata (browser
only) and manual-with-two-fields (in-vault). The goal of this cycle: let a user who has already
run the Web Clipper (or has any YAML-frontmatter + body paste shaped like its output) **paste**
that full payload into the manual "+ New article" flow and get a fully-populated note, while
manual title/url-only creation keeps working exactly as it does today.

## Decisions (confirmed with user — settled, not open)

1. **Where parsing logic lives**: a new reader-local wrapper class, `ReaderArticlePaste`, not a
   generic new `entity-create` prompt type. All paste-parsing / field-mapping logic lives in the
   reader blueprint; `entity-create.js` itself is untouched. The wrapper builds a `presetPrompts`
   object from the parsed paste and calls the existing `EC.create({instance: 'reader-article',
   dv, presetPrompts})`.
2. **Entry UX**: one dialog. The existing "+ New article" button opens a single dialog containing
   both a paste textarea (reader-local, rendered outside `entity-create`) and the manual
   title/url fields together — not two separate buttons or a two-step flow.
3. **Field behavior on paste**: parsing auto-fills title/URL but they stay editable; nothing is
   ever hidden or locked based on paste content.
4. **Malformed-paste fallback**: if the paste doesn't parse as YAML-frontmatter-plus-body, treat
   the entire paste as raw `READER_CONTENT` body text and fall back to requiring the manual Title
   field. Never block or error — the flow always ends in a created note.
5. **`reader-clip.json` fate**: left completely unchanged. A user clicks "Copy" in Web Clipper
   instead of "Save"; the template's rendered output (frontmatter + `{{highlights}}`/
   `{{content}}`) is exactly what the new paste-parser consumes, so no changes are needed on that
   side.
6. **Empty/no-paste submission**: must still gracefully create a bare/manual article (today's
   title+url-only path) — never error.

## Architecture

```
"+ New article" click
  → ReaderArticlePaste.open(dv)          (new, reader-local dialog)
      - renders: paste textarea + title input + url input + Create/Cancel
      - on paste (blur/input debounce): ReaderArticlePaste.parse(rawText)
          → { frontmatter: {...}, body: string, malformed: bool }
        auto-fills title/url inputs from frontmatter.title / frontmatter.url
        (editable afterward — no re-parse on manual edit)
      - on Create:
          presetPrompts = ReaderArticlePaste.buildPresetPrompts(parsed, {title, url})
          EC.create({ instance: 'reader-article', dv, presetPrompts })
```

`entity-create.js`'s `create({instance, dv, presetPrompts})` already special-cases any key present
in `presetPrompts`: it's assigned straight into `ctx.prompts[key]` and skips `derive`, UI
prompting, and validation for that key (confirmed by reading the `create()` body, ~entity-create.js
line 434 onward). `ReaderArticlePaste` uses this to inject every clip-contract field the two
current manual prompts (`title`, `url`) don't cover.

**Verified assumption**: `_readBody(spec.body_template, ctx)` (entity-create.js:959) reads the
template file and runs `this._substitute(raw, ctx)` on its contents — the exact same
substitution `inline_body` gets. This means `body_template: "Reader Article.md"` can use
`{{prompts.highlights}}` / `{{prompts.content}}` tokens exactly like `reader-clip.json`'s
`noteContentFormat` uses `{{highlights}}` / `{{content}}`, and they'll be substituted from
`presetPrompts` at note-creation time with no post-processing step needed.

## Parsing (`ReaderArticlePaste.parse`)

Input: the raw paste string. The expected shape (what a Web Clipper "Copy" produces) is
frontmatter fenced by `---` lines, followed by a body containing the two marker comments in
order, each followed by content:

```
---
type: reader-article
title: "..."
url: "..."
author: "..."
site: "..."
published: YYYY-MM-DD
captured_at: YYYY-MM-DDTHH:mm:ssZ
word_count: 1234
status: unread
summary: "..."
tags: [a, b]
---

```dataviewjs ...ReaderChromeBar... ```

```dataviewjs ...ReaderArticleView... ```

[//]: # (READER_HIGHLIGHTS)

<highlights text, possibly empty>

[//]: # (READER_CONTENT)

<article body text>
```

Parse steps:

1. Split off a leading `---\n...\n---` block if present (simple line-based split, not a full YAML
   library dependency — reader's other helpers don't pull one in, and the field set is flat
   scalars + one array (`tags`), which a minimal line parser handles: `key: value` pairs, `tags:
   [a, b]` or a bulleted list, quoted or bare scalars).
2. If no frontmatter block is found, or a required shape check fails (no `---` pair, or the parsed
   block doesn't contain at minimum a `title` key), set `malformed: true` and treat the **whole
   raw paste** as `content` (the `READER_CONTENT` fallback from Decision 4). `frontmatter` is `{}`
   in this case.
3. If frontmatter parses, split the remaining text on the `READER_HIGHLIGHTS` / `READER_CONTENT`
   marker comment lines: text between the two markers → `highlights`; text after the second
   marker → `content`. If the markers aren't found in an otherwise-valid-frontmatter paste, the
   whole remainder (post-frontmatter) becomes `content` and `highlights` is empty — still not
   `malformed`, since the frontmatter (the harder part) parsed fine.
4. Return `{ frontmatter, highlights, content, malformed }`. Never throws — any parse exception is
   caught and treated as step 2's malformed path.

This is a pure function (string in, plain object out) with no DOM/Obsidian dependency, so it's
directly Node-testable without dv/app stubs.

## Field mapping → `presetPrompts`

`ReaderArticlePaste.buildPresetPrompts(parsed, manual)` where `manual = {title, url}` are the
dialog's (possibly user-edited) input values.

**All fields, including `title` and `url`, are passed via `presetPrompts`** — `entity-create`'s
`presetPrompts` short-circuit skips its own `_prompt()` UI *and* validation for any key present.
Since `ReaderArticlePaste` renders `title`/`url` inputs itself (Decision 2: one dialog, not two),
it must be the one enforcing `title`'s `required` + `safe-filename` validation, in its own
Create-button handler, before calling `EC.create()` — otherwise `entity-create` would silently
skip validating a required field it never prompts for. (If `title` and `url` were left as normal,
non-preset prompts instead, `entity-create` would prompt for them again in its own UI after the
user already entered them in `ReaderArticlePaste`'s dialog — directly contradicting the
single-dialog decision. This was caught in review and is why both are preset, not just the 9
clip-only fields.) The manifest's `title`/`url` prompt specs stay in place (unchanged
`required`/`validate`) purely as the schema `entity-create` reads to know these keys exist for
`{{prompts.title}}` / `{{prompts.url}}` substitution — they just never fire interactively once
`presetPrompts` is always supplied for both.

| `presetPrompts` key | Source | Notes |
|---|---|---|
| `title` | `manual.title`, validated (`required`, `safe-filename`) by `ReaderArticlePaste` itself before calling `EC.create` | auto-filled from `parsed.frontmatter.title` on paste, stays editable (Decision 3) |
| `url` | `manual.url` | auto-filled from `parsed.frontmatter.url` on paste, stays editable; no validation (optional, as today) |
| `author` | `parsed.frontmatter.author` \|\| `""` | new preset key |
| `site` | `parsed.frontmatter.site` \|\| `""` | new preset key |
| `published` | `parsed.frontmatter.published` \|\| `""` | new preset key |
| `captured_at` | `parsed.frontmatter.captured_at` \|\| JS-generated ISO now (`new Date().toISOString()`) | always provided (never omitted — an omitted preset key whose template token is `{{prompts.captured_at}}` resolves to empty, not to `{{now}}`); the manifest's `frontmatter_template` changes `captured_at` from `{{now.YYYY-MM-DDTHH:mm:ssZ}}` to `{{prompts.captured_at}}` so the paste's own capture time survives when present |
| `word_count` | `parsed.frontmatter.word_count` \|\| `0` | new preset key |
| `status` | `parsed.frontmatter.status` \|\| `"unread"` | new preset key (manifest already defaults `status: unread` in `frontmatter_template`; only overridden if the paste sets a different one) |
| `summary` | `parsed.frontmatter.summary` \|\| `""` | new preset key |
| `tags` | `parsed.frontmatter.tags` \|\| `["reader-article"]` | **implementation constraint (discovered during build):** `entity-create`'s frontmatter renderer decides list-vs-scalar from the *template value's* JS type, and there is no token/pipe that expands a dynamic prompt array into a YAML list. A string token `{{prompts.tags}}` would coerce the array to a single bad tag (`"ai,rl"`). So `frontmatter_template.tags` stays the literal `["reader-article"]` list (always a valid YAML list) and `tags` is **not** a preset key — clipped tags are not carried into frontmatter. `buildPresetPrompts` still returns a `tags` array (Node-tested), but with no matching prompt spec the short-circuit never assigns it, so the static default holds. Carrying clip tags would require a post-`create` `processFrontMatter` pass; deferred as out-of-scope for this cycle. |
| `highlights` | `parsed.highlights` \|\| `""` | new preset key, consumed by the new `{{prompts.highlights}}` token in `Reader Article.md` |
| `content` | `parsed.content` \|\| `""` | new preset key, consumed by the new `{{prompts.content}}` token; on the malformed path this is the entire raw paste |

## New/changed files

| File | Change |
|---|---|
| `platform/blueprints/reader/helpers/reader-article-paste.js` (new) | `ReaderArticlePaste` class: `parse(raw)` (pure, Node-testable), `buildPresetPrompts(parsed, manual)` (pure), `open(dv)` (DOM dialog — textarea + title/url inputs + Create/Cancel, wired to `EC.create`) |
| `platform/blueprints/reader/manifest.json` | `customjs_classes[]` gains `"ReaderArticlePaste"`; `files[]` gains a matching entry (source `helpers/reader-article-paste.js` → `{{scripts_path}}/reader/reader-article-paste.js`); `new_entity_buttons[0].prompts[]` gains 9 new preset-only entries (`author`, `site`, `published`, `captured_at`, `word_count`, `status`, `summary`, `tags`, `highlights`, `content` — see table above), each `required: false` with no `validate` (they're only ever reached via `presetPrompts`, never via UI, but must exist in `prompts[]` for `{{prompts.<key>}}` to resolve); `frontmatter_template` updated to reference `{{prompts.author}}` etc. in place of the current hardcoded/absent values; `body_template` unchanged (still `"Reader Article.md"`) |
| `platform/blueprints/reader/templates/Reader Article.md` | Add `{{prompts.highlights}}` after the `READER_HIGHLIGHTS` marker and `{{prompts.content}}` after the `READER_CONTENT` marker (currently both markers have no token following them) |
| `platform/blueprints/reader/helpers/reader-article-actions.js` | `renderCreateRow`'s button `onClick` changes from calling `EC.create(...)` directly to calling `ReaderArticlePaste.open(dv)` |
| `platform/test/run-reader-article-paste.js` (new) | Node-runnable test harness for `parse` + `buildPresetPrompts` (see Testing below) |

No changes to: `reader-clip.json`, `entity-create.js`, `reader-article-view.js`,
`reader-chrome-bar.js`, `reader-queue.js`.

## Backward compatibility

- Manual creation with an empty paste box: `parse("")` → `malformed: true`, `frontmatter: {}`,
  `content: ""`. `buildPresetPrompts` then produces the same effective values the manifest's
  current defaults already provide (`status: "unread"`, `tags: ["reader-article"]`, empty
  `summary`/`author`/`site`/`published`/`highlights`/`content`, `word_count: 0`) — byte-for-byte
  equivalent to today's title+url-only creation path, just routed through explicit preset keys
  instead of manifest-only defaults.
- Existing reader-article notes on disk are untouched — this is a creation-flow-only change, no
  migration/heal needed.
- `entity-create.js` is not modified, so every other blueprint depending on it (finance, journal,
  meetings, people, project, sticky-notes, wiki) is structurally unaffected.

## Testing / verification plan

Per `Docs/agent-guides/build-test-verify.md`:

1. New `platform/test/run-reader-article-paste.js`, Node-runnable (no Obsidian/dv stubs needed for
   the pure functions), covering:
   - `parse`: well-formed clip-shaped paste → correct `frontmatter`/`highlights`/`content` split;
     paste with frontmatter but no marker comments → `content` = full remainder, `highlights` =
     `""`, not malformed; no frontmatter at all → `malformed: true`, whole input as `content`;
     empty string → `malformed: true`, empty `content`; malformed YAML inside a `---` block
     (parse throws internally) → caught, falls back to malformed path, never throws out.
   - `buildPresetPrompts`: full parsed object → all 12 preset keys populated (`title`, `url`, plus
     the 10 clip-contract fields); empty/malformed parsed object → same defaults as today's
     manifest (`status: unread`, `tags: ["reader-article"]`, rest empty/zero) while `title`/`url`
     still come through from `manual`; a required-title validation helper (used by the dialog's
     Create handler before calling `EC.create`) rejects empty/unsafe titles the same way the
     manifest's `safe-filename` prompt validator would have.
2. `open(dv)` (the DOM dialog wiring) gets a lighter DOM-stub test in the same file if reader's
   existing test style already stubs `dv.container`/`app.vault.create` elsewhere (check
   `run-reader.js` precedent) — otherwise this path is covered by manual verification only, since
   the dialog shell itself is boilerplate (mirrors `entity-create.js`'s own `_promptText` input
   pattern) and the risk is concentrated in `parse`/`buildPresetPrompts`.
3. Manual verification in the dogfood vault after install: paste a real Web-Clipper "Copy" output
   into the dialog → confirm the created note's frontmatter + `READER_HIGHLIGHTS`/
   `READER_CONTENT` sections match the source; submit with an empty paste box → confirm a bare
   manual article is created exactly as before this change.
4. Existing reader harness (`platform/test/run-reader.js` or equivalent — confirm exact filename
   at plan time) must still pass unmodified, confirming no regression to the other reader
   surfaces.

## Versioning

No manual version bumps — the release pipeline computes `reader` blueprint's semver bump from the
conventional-commit history on this branch and ships it automatically. This is a `feat` (new
capability, backward compatible), so expect a minor bump on `reader`; commit messages should use
`feat(reader): ...`.

## Out of scope

- No changes to the Web Clipper template (`reader-clip.json`) — Decision 5.
- No changes to `entity-create.js`'s prompt-type set (no new generic "textarea" prompt type) —
  Decision 1.
- No two-button entry split — Decision 2.
- No YAML-library dependency addition; the frontmatter parse is a minimal hand-rolled line parser
  scoped to the known flat clip-contract shape, not a general-purpose YAML parser.
