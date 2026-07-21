---
name: delivery-status
description: Read-only glance at the Sauce Delivery board. Use when asking "how's the board", "what's the status", "how many things need me", "is the loop working", or for a phone-sized digest of exceptions/progress. Shows the exception count, the no-action summary (frozen/superseded/done), the active claim, and recent releases. Never writes anything.
---

# delivery:status

The read-only glance. Answers "is it working, and does it need me?" in one screen. Pairs with `delivery:review` (which decides the exceptions this surfaces). **Writes nothing.** Full design: `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/Delivery Family Buildout — Complete-the-Loop Subset.md`.

## Steps

1. Resolve paths: `node -e "console.log(JSON.stringify(require('./scripts/autoloop/delivery-paths.js').deliveryPaths()))"` (from the repo root). Env vars DELIVERY_REPO_ROOT / DELIVERY_COORDINATOR / DELIVERY_FID / DELIVERY_STATE override the defaults.
2. Variant check: `require('./scripts/autoloop/delivery-paths.js').coordinatorPresent(paths)`.
   - **Coordinator present (Sauce)** → continue.
   - **Coordinator absent (lightweight repo)** → say "lightweight board status not yet implemented (v1 is full-variant only)" and stop. Do NOT fabricate a digest.
3. Capture the coordinator status: run `<coordinator> status --json` (the resolved coordinator path) into a temp file.
4. Gather recent releases: `git tag --sort=-creatordate | grep '^v' | head -5` (comma-join).
5. Build the digest: `node scripts/autoloop/delivery-status-digest.js --status <tmp> --fid "<fid>" --releases <v1,v2,...>`.
6. Render phone-sized, read-only, in this order:
   - **Headline** (the digest's `headline`): "N need you · X frozen / Y superseded / Z done · active: <card>".
   - **Needs you** — if exceptionCount > 0, list the actionable cards (bucket + card); else "Nothing needs you — walk away."
   - **Active** — the active claim line (card + phase), or "idle".
   - **Recent releases** — the releases list.
   - One-liner pointer: "Run /delivery-review to work the blockers."
7. Never write, never ratify, never touch a card/board/FID. This skill only reads.
