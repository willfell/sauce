# new-wiki-page skill

Create a new wiki page in the correct section folder.

## Pre-write vault-identity self-check

Before creating any file, verify you are in the workshop vault:
`ls /Users/willfellhoelter/projects/repos/sauce` — expected root entries include `platform/`, `ranch/`, `CLAUDE.md`. If you see `Boards/`, `Finance/`, or `Resources/` at root, STOP — you are in a consumer vault.

## Usage

To create a new wiki page, use the `+ New Page` button on any wiki hub or section note in Obsidian. For CLI creation, identify the target section folder first (e.g. `spice/wiki/infra/`) and place the new `.md` file there with `type: wiki-page` frontmatter.
