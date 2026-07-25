---
name: delivery-status
description: Read-only glance at the Sauce Delivery board. Use when asking "how's the board", "what's the status", "how many things need me", "is the loop working", "what happened while I was away", or for a phone-sized digest of exceptions/progress. Shows the exception count, the no-action summary (frozen/waiting/done), the active claim, recent releases, and the retroactive "since you last looked" section (self-ratified FID amendments, discards, cutover flips). Never writes anything except its own last-seen marker.
---

# delivery:status

The read-only glance. Answers "is it working, does it need me, and what happened since I last looked?" in one screen. Pairs with `delivery:review` (which walks the retroactive digest this surfaces). **Writes nothing except the digest's own last-seen marker** (`.delivery-digest-last-seen` beside the coordinator state file — never a coordinator state file, never the vault). Full design: `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/Delivery Family Buildout — Complete-the-Loop Subset.md`.

## Steps

1. Resolve paths: `node -e "console.log(JSON.stringify(require('./scripts/autoloop/delivery-paths.js').deliveryPaths()))"` (from the repo root). Env vars DELIVERY_REPO_ROOT / DELIVERY_COORDINATOR / DELIVERY_FID / DELIVERY_STATE override the defaults.
2. Variant check: `require('./scripts/autoloop/delivery-paths.js').coordinatorPresent(paths)`.
   - **Coordinator present (Sauce)** → continue.
   - **Coordinator absent (lightweight repo)** → say "lightweight board status not yet implemented (v1 is full-variant only)" and stop. Do NOT fabricate a digest.
3. Capture the coordinator status: run `<coordinator> status --json` (the resolved coordinator path) into a temp file.
4. Gather recent releases: `git tag --sort=-creatordate | grep '^v' | head -5` (comma-join).
5. Build the digest: `node scripts/autoloop/delivery-status-digest.js --status <tmp> --fid "<fid>" --releases <v1,v2,...>`.
   - Reading UPDATES the last-seen marker (derived from the status output's `state_path`; `--marker <path>` overrides). Add `--peek` to render WITHOUT updating it — use `--peek` when the Director is only glancing mid-conversation and will want the full since-section again later. On the first-ever read, no marker exists and everything shows.
   - The `--fid` path feeds the self-ratified-amendments feed; without it that feed is empty.
6. Render phone-sized, read-only, in this order:
   - **Headline** (the digest's `headline`): "N need you · X frozen / Y waiting / Z done · active: <card> [· M new since last look]".
   - **Since you last looked** (`since`) — if any of its three feeds is non-empty: self-ratified FID amendments (heading + date), discards (name + one-line reason + superseded_by), cutover flips (enabled/disabled + at + reason). If all empty: "Nothing new since last look." (Known gap: ceilings hit and decompositions are named in the design but coordinator `status --json` does not expose them yet, so this section cannot show them.)
   - **Needs you** — if exceptionCount > 0, list the actionable cards (bucket + card); else "Nothing needs you — walk away." Buckets are `coordinator-deadend` and `escalation` (genuine concurrency/deploy waits count as `waiting`, not exceptions).
   - **Active** — the active claim line (card + phase), or "idle".
   - **Recent releases** — the releases list.
   - One-liner pointer: "Run /delivery-review to walk the digest."
7. Never write, never ratify, never touch a card/board/FID/coordinator state. The last-seen marker is this skill's only write.
