# loop — the Sauce meta-loop plugin

Board-governed delivery for any repo, in one plugin. Bind a repo to a vault/board with a committed `.loop/config.json`, then plan, mint, execute, and review epics/slices through the sanctioned coordinator + card-intake rails. One source of truth for Claude (`/loop:*`) and Codex (generated `.agents/skills/loop-*` routers) — when the system changes, a plugin reload puts every session of every project on the same page.

## Install

```text
/plugin marketplace add willfell/sauce
/plugin install loop@sauce
```

Reload after changes: `/plugin marketplace update sauce` (plugin versions ride git commits — never hand-versioned).

## Bind a repo

`/loop:init` interviews you and writes `.loop/config.json`:

```json
{
  "schema_version": "1.0.0",
  "project": { "slug": "demo", "name": "Demo" },
  "vault": { "root": "~/vaults/demo-vault" },
  "board": {
    "project_root": "spice/projects/demo",
    "board_path": "spice/projects/demo/demo-board.md",
    "cards_root": "spice/projects/demo/tasks"
  },
  "ids": { "default_prefix": "DM" },
  "policy": { "batch_policy": "continue", "execution_mode": "release", "deploy_subscriptions": [] },
  "coordinator": { "resolve": "brew" },
  "codex": { "routers": true, "plugin_root": "<where Codex reads the skill bodies>" }
}
```

Every skill starts by resolving this file (`scripts/loop-config.js resolve --json`) and refuses loudly without it. The resolved env map (`DELIVERY_*`, `SAUCE_LOOP_*`) retargets the unchanged deterministic tooling at the bound board.

## Skills

`init` · `status` · `review` · `brainstorm` · `plan` (prompts for id prefix + board priority before minting) · `execute` (in-session, sub-agent per slice, full quorum) · `run` (one bounded autonomous turn) · `intake`.

Non-negotiables baked into every body: the coordinator is the sole board writer, card-intake the sole planning writer; Gate B + the three sequential review lenses never weaken; receipts decide truth.

Full runbook: `Docs/agent-guides/loop-plugin.md` in the sauce repo.
