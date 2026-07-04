# Reader blueprint fixes — result

- **Date:** 2026-07-04
- **Version:** pipeline-assigned (`icons 0.1.1 → 0.2.0`, `reader 0.2.0 → 0.3.0`, both minor)
- **Branch:** `cycle/reader-fixes`
- **Scope:** three small, user-requested polish fixes to the reader blueprint (shipped v0.192.0). No design/plan doc — specs were given inline.

## What shipped

1. **Launcher icon (fix).** The Reader entry in the Go-to launcher rendered no icon: the manifest declared `icon: "book-open"`, but that name was in neither the icons mechanism's Tier-1 vendored map nor reliably resolvable via the Tier-2 `setIcon()` fallback in the overlay path (which has no letter-fallback). Added a distinct, spined **`book-open`** Lucide glyph (15×15, matching the vendored aesthetic) to `platform/mechanisms/icons/icons.js` Tier-1 → deterministic resolution. `journal` (the other book glyph) is unaffected.

2. **URL in the "+ New article" dialog (feat).** `new_entity_buttons[reader-article].prompts` gained a second prompt `{ key: url, label: "Article URL (optional)", type: string, required: false }`, and `frontmatter_template.url` changed from `""` to `"{{prompts.url}}"`. Manually-created articles now capture the source URL (title + URL), matching what the Web Clipper already sets. entity-create renders each prompt as an input (precedent: project `sub-section-hub` two-string-prompt).

3. **Clean access button (fix).** `ReaderArticleActions` already rendered a clean accent-styled real `<a target="_blank">` — but only when `url` was non-empty, so dialog-created articles (previously `url: ""`) never showed it. With #2 capturing the URL, the button now reliably appears; relabeled **"Open source ↗" → "Open article ↗"** to match "access the article."

## Verification

- `run-reader.js` **25/25** (new `HC-READER-12a/b/c`: icon resolves via Tier-1, dialog prompts title + optional url → frontmatter url, article renders the "Open article ↗" `<a target=_blank>`).
- Full `npm run release:preflight` **exit 0** (nav-launcher, renderer, helper-cases all green — the shared icons change broke nothing).
- `release:preflight-bumped` **PASS** (`icons→0.2.0`, `reader→0.3.0`; no wedge).
- Workshop dogfood self-install **exit 0** (install log confirms the new prompts + `url: {{prompts.url}}`).

## Deploy notes

Both `reader` (blueprint) and `icons` (mechanism) bump. Consumers are brew-only (`workshop_relative_path=/opt/homebrew/opt/sauce/libexec`); both are already subscribed on all three vaults, so deploy = `brew upgrade sauce` + `sauce update --force` (or `--bump-pins`) per vault — no subscription edits needed. User must Cmd+R.

## Carry-forward

Unchanged from v0.192.0: promote-to-wiki bridge, url-dedup reconcile, optional `.base` power view, the connection plane.
