# new-reader-article skill

Create a new reader article in the flat reading queue.

## Pre-write vault-identity self-check

Before creating any file, verify you are in the workshop vault:
`ls /Users/willfell/Documents/GitHub/sauce` — expected root entries include `platform/`, `ranch/`, `CLAUDE.md`. If you see `Boards/`, `Finance/`, or `Resources/` at root, STOP — you are in a consumer vault.

## Usage

To create a new reader article, use the `+ New article` button on the reader hub in Obsidian, or clip a web page with the Obsidian Web Clipper. For CLI creation, place the new `.md` file flat in `spice/reader/` with `type: reader-article` and `status: unread` frontmatter.
