---
name: init
description: Bind the current repo to a vault/board for the meta-loop. Use when onboarding a repo onto the loop system, when another loop skill refuses with config_missing, or when asked to "bind this repo", "set up the loop here", "point this repo at a board", or to regenerate the Codex skill surface after a binding change.
---

# loop:init

Create or update the repo's `.loop/config.json` — the single committed contract that tells every loop skill (Claude and Codex alike) WHICH vault, project, and board this repo drives. Also generates the Codex `.agents/skills/loop-*` router surface and can wire the plugin recommendation into `.claude/settings.json`.

Writes ONLY: `.loop/config.json`, `.agents/skills/loop-*/`, and (optionally, with consent) `.claude/settings.json` in the current repo. Never writes the vault, a board, or coordinator state.

## Interview

Ask one question at a time; offer detected defaults. Gather:

1. **Vault root** — absolute path (`~` allowed) to the Obsidian vault holding the board.
2. **Project slug** — e.g. `sauce`; suggest the repo directory name.
3. **Board paths** (vault-relative) — suggest the convention: `project_root = spice/projects/<slug>`, `board_path = <project_root>/<slug>-board.md`, `cards_root = <project_root>/tasks`. The coupling invariant `project_root == dirname(board_path)` is enforced by the resolver.
4. **Default id prefix** — the work-item prefix `/loop:plan` offers when minting (e.g. `GA`, `ES`, `CI`).
5. **Policy** — `batch_policy` default (`continue` / `stop_after` / `supervised_only`), `execution_mode` default (`release` / `docs_only`), `deploy_subscriptions` vault ids (empty list = merge-only completion, no deploy stage), and optional `deploy_vaults` (`[{id, path}]`) when the coordinator should deploy to those vaults.
6. **Coordinator** — `resolve: "brew"` (default; the installed Homebrew coordinator via `brew --prefix sauce`) or `resolve: "path"` + explicit path for a non-brew setup.
7. **FID path** (optional) — the governing Final Initial Design doc; feeds the self-ratified-amendments digest feed.
8. **Codex surface** — generate `.agents/skills/loop-*` routers? (default yes). `codex.plugin_root` is where Codex reads the canonical skill bodies — default `$(brew --prefix sauce)/libexec/plugins/loop`; a local sauce clone path is the dev-mode alternative.

## Write and verify

1. Write `.loop/config.json` (schema_version `1.0.0`, shape exactly as the resolver expects — see `${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js` header).
2. Validate: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" check --json` from the repo root. `check` verifies the vault exists, the board file exists with an `## In Planning` lane, and cards_root is a directory. Fix or surface every refusal; never leave a binding that resolves but points at nothing.
3. If Codex routers were requested: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gen-codex-routers.js" --repo . --json`, then show the generated `.agents/skills/loop-*` list.
4. Offer (ask first) to add the marketplace recommendation to the repo's `.claude/settings.json` so new sessions are prompted to install the plugin:

   ```json
   {
     "extraKnownMarketplaces": {
       "sauce": { "source": { "source": "github", "repo": "willfell/sauce" } }
     },
     "enabledPlugins": { "loop@sauce": true }
   }
   ```

   Merge into existing settings — never clobber other keys.
5. Report: the binding summary (slug, vault, board, prefix, policy), the check receipt, and the suggested first command (`/loop:status`).

## Read-only bind (observe mode)

Binding a repo whose board is driven by ANOTHER loop implementation (e.g. a project not yet migrated to the shared coordinator) is legitimate: write the config, run `check`, use `/loop:status` — but warn that write-path skills (`plan`, `execute`, `run`, `intake`) must not be used until the project's owner migrates it onto the shared rails. Record `"observe_only": true` under `policy` in that case; write-path skills refuse when they see it.
