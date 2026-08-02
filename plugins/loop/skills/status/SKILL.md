---
name: status
description: Read-only glance at the bound delivery board. Use when asking "how's the board", "what's the status", "how many things need me", "is the loop working", "what happened while I was away", or for a phone-sized digest of exceptions/progress. Shows the exception count, no-action summary, active claim, recent releases, and the retroactive "since you last looked" section. Never writes anything except the digest's own last-seen marker.
---

# loop:status

The read-only glance at whatever board this repo is bound to. Answers "is it working, does it need me, and what happened since I last looked?" in one screen. Pairs with `/loop:review` (which walks the digest this surfaces). **Writes nothing except the digest's own last-seen marker** (`.delivery-digest-last-seen` beside the coordinator state file — never the vault, never a board).

## Bind

1. Resolve the binding: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json` from the repo root. A refusal means the repo is unbound — stop and point at `/loop:init`.
2. From the receipt: `<coordinator>` = `config.coordinator`; the digest helper is its sibling `dirname(<coordinator>)/delivery-status-digest.js`; export every key in `config.env` into the environment of each command below (that is what binds the coordinator to THIS repo's board instead of its defaults).
3. If `<coordinator>` does not exist on disk, say so ("coordinator not installed — brew install sauce, or set coordinator.resolve to path") and stop. Do NOT fabricate a digest.

## Steps

1. Capture status: run `node <coordinator> status --json` (env applied, cwd = repo root) into a temp file. On a freshly bound repo with no ledger yet this legitimately reports zero tracked cards — that is a real answer, not an error.
2. Recent releases: `git tag --sort=-creatordate | grep '^v' | head -5` (comma-join; skip silently if the repo has no version tags).
3. Build the digest: `node <digest> --status <tmp> --fid "<config.fid_abs>" --releases <v1,v2,...>` (omit `--fid` when the binding has none — the self-ratified feed is then empty). Reading UPDATES the last-seen marker; add `--peek` when the user is only glancing mid-conversation and will want the full since-section later.
4. Render phone-sized, read-only, in this order:
   - **Headline** — "N need you · X frozen / Y waiting / Z done · active: <card> [· M new since last look]".
   - **Since you last looked** — self-ratified FID amendments (heading + date), discards (name + reason + superseded_by), cutover flips; or "Nothing new since last look."
   - **Needs you** — actionable cards (bucket + card), or "Nothing needs you — walk away."
   - **Active** — the active claim (card + phase), or "idle".
   - **Recent releases** — the tag list.
   - **Map** — the bound project's Loop Station carries a GraphView project-scope map (epics as clusters, cross-epic dependency edges, status-colored chips); open it to see how active claims and blocks connect at a glance.
   - Pointer: "Run /loop:review to walk the digest."
5. Never write, never ratify, never touch a card/board/FID/coordinator state. The last-seen marker is this skill's only write.
