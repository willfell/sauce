# Next-cycle handoff — after wiki blueprint (v0.162.0)

## What just shipped
The **`wiki` blueprint** (`spice/wiki/`) — standalone, arbitrary-depth, folder-is-truth knowledge base with a global nav button, hub, nested sections, pages, DocSearch, and Move. `DocSearch` graduated to a shared `doc-search` mechanism (project + wiki consume it); `breadcrumb` gained an additive `path_walk` mode for arbitrary-depth trails. See `Docs/plans/2026-07-01-wiki-blueprint-{design,plan,result}.md`.

## State
- Merged origin/main (v0.161.1) into the branch; full preflight + preflight-bumped green. Pipeline will compute v0.162.0.
- 25 mechanisms / 14 blueprints. New tests: `run-wiki.js`, `run-doc-search.js`, `run-breadcrumb.js` BC-WIKI-*, seed `SEED-MIGRATE-WIKI-*` (288 total).

## Post-merge / deploy checklist
1. Let the release pipeline ship v0.162.0 (never admin-merge the release PR; unstick a BEHIND-wedge only via `gh pr update-branch`).
2. Deploy to consumers ero → headspace → accuris: **add `wiki` + `doc-search` to each `ranch/platform-subscription.json`** (a new blueprint isn't added by `--bump-pins`), then `sauce update --bump-pins && sauce install`, then `sauce status` (drift: none) + `Cmd+R`.
3. Post-merge, on `main`: `npm run regen-cycle-status`, and (reviewed) seed rebaseline if ratcheting forward.

## Top iteration candidates (from the user's brainstorm; deferred by design)
1. **Ingestion:** Obsidian Web Clipper capture flow → dump content into `spice/wiki/` → an LLM/search pass over it. The user explicitly wants this as the "put a ton of info in and have an LLM go through it" north star.
2. **Project correlation:** relate / move a `wiki-page` into a project (bidirectional links), and move a project doc out to the wiki. The reuse substrate (`doc-search` mechanism, folder-is-truth) is now in place.
3. **MOC auto-index:** formalize the "index note that queries a tag/type" idiom (the legacy `old/MOCs/` pattern).
4. **Live-look polish** from the user's first Cmd+R review of the wiki (breadcrumb titles, hub card density, empty-state, search ergonomics).

## Landmine refresh
- Graduating a file that harnesses read requires repointing those harnesses in the SAME cycle (grep `platform/test/` for the old path). Caught here by full preflight.
- Catalogue-count asserts (`mechanism count = N`) are legitimate hand-updates when adding a component.
