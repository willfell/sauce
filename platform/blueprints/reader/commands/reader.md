# /reader — Reader

Open the reading queue, clip and create articles, or find articles by status or title.

## Open

Open the reader hub: the hub is at `spice/reader/Reader.md`. Use the nav button or open it directly.

## New article

Click `+ New article` on the reader hub. Enter a title; a new `reader-article` note lands flat in `spice/reader/` with `status: unread`.

## Find

Search by title or filter by status (`unread` / `reading` / `archived`) using the DocSearch strip on the hub. Status lives in each article's frontmatter, never a folder.

## Web Clipper setup

Import `spice/reader/reader-clip.json` into the Obsidian Web Clipper extension to clip web articles straight into the queue. Configure a local Ollama model for the AI TL;DR summary. Import once — the template then stays available for every future clip.
