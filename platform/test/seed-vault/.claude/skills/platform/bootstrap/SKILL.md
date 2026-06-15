---
name: bootstrap
description: Re-bootstrap an existing vault (change subscriptions, re-scaffold plugins). NOT first-touch — first-touch is raw `sauce bootstrap` CLI.
---

# platform:bootstrap

Re-bootstraps an EXISTING sauce vault. Use this to change which blueprints are subscribed, re-scaffold plugins after a workshop update, or re-run the first-run wizard against a different vault layout. **This is not the first-touch incantation.**

## First-touch asymmetry — read this first

True first-touch on a brand-new vault is always the raw CLI from a terminal in the new vault directory:

```bash
cd <new-vault-path>
sauce bootstrap
```

Slash commands don't exist until bootstrap has run at least once (the canonical `.claude/commands/` surface is materialized by the installer). If you find yourself wanting `/bootstrap` on a vault that has never had a sauce install, you are looking for the CLI.

## Pre-flight

1. **Confirm vault shape.** Read `ranch/platform-config.json`. If missing, emit:

   ```
   > [!warning] /bootstrap is for re-bootstrapping an existing sauce vault
   > This vault has no ranch/platform-config.json — it has never been bootstrapped.
   > Run `sauce bootstrap` from a terminal in this directory for first-touch, then come back.
   ```

   And stop. Do NOT shell out — `sauce bootstrap` against a non-sauce vault must come from `install.sh` (which knows the workshop clone path), not from this skill.

2. **Surface the asymmetry.** Emit a `[!warning]` callout to the user:

   ```
   > [!warning] /bootstrap re-runs the wizard against an existing vault
   > This will re-scaffold plugins, may prompt for subscription changes, and rewrites ranch/platform-installed.json.
   > Existing user content under spice/ is preserved; .obsidian/ allowlisted files may be merged.
   ```

## Run

3. **Shell out.** Run `sauce bootstrap --vault "$(pwd)"` via the Bash tool. Capture stdout, stderr, and exit code. The CLI auto-detects the existing `ranch/platform-config.json` + `ranch/platform-subscription.json` and surfaces its re-run wizard menu (edit subscription, edit config, force-redownload, quit) instead of running first-touch. No extra flag is required.
4. **Stream output.** As bootstrap may prompt interactively, surface the captured output to the user as it lands. If the CLI requires a TTY for interactive prompts, abort with `[!info] /bootstrap requires a terminal — re-run \`sauce bootstrap\` directly from a shell in this vault.` and stop.

## Report

5. **Read post-bootstrap state.** Read `ranch/platform-subscription.json` and `ranch/platform-installed.json` (after the run). Compose a confirmation summary:

   ```
   > [!success] /bootstrap — re-bootstrap complete
   > **Subscribed mechanisms:** <comma-list of name@version>
   > **Subscribed blueprints:** <comma-list of name@version>
   > **Foundational plugins scaffolded:** <count> from platform/manifest.json#foundational_plugins
   ```

## Done

6. Stop. If the user wants to install changes from the new subscription, point them at `/install`.
