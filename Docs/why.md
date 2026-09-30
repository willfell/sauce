# Why this platform exists

## The problem

Will runs four Obsidian vaults on Obsidian Sync, each scoped to a domain:

| Vault | Domain | Identity tag |
|---|---|---|
| **accuris** | Work (Accuris/IHS Markit) | `accuris` |
| **headspace** | Personal life (finance, family, side-quests, daily) | `life` |
| **ero** | ERO Resources consulting (projects, invoices, committees) | (none — vault-implicit) |
| **workshop** (this vault) | Platform host — no personal content | (none) |

The three consumer vaults share a lot conceptually:
- Three-tag system (identity + type + date).
- Standard nav-block protocol (`SpaceNavButtons` everywhere; `ProjectNavButtons` for project notes; `InvoiceNavButtons` for invoice notes).
- Templater + Dataview + CustomJS + QuickAdd as the runtime stack.
- Per-vault CLAUDE.md as the resolver / non-negotiables list.
- A `/audit` slash command that reports drift.

But: every time a new pattern emerged (most recently `customjs-guard`, the polling loader for CustomJS callsites), rolling it out across the three vaults required:
1. Building it in one vault.
2. Writing audit + rollout cards for the other two vaults.
3. Re-running the same dance in each: discovery → audit → plan → execute.

That's a 3×3 = 9-card phased rollout for **one** pattern. It works, but the cost compounds: three vaults × N patterns means N×3 rollout cards. The drift between vaults grows linearly with patterns.

## The end goal

**Author once. Subscribe per vault. Update on demand. Audit drift always.**

A platform layer where:
- New mechanisms are built in **one place** (this workshop vault).
- Each consumer vault declares a **subscription** listing which mechanisms + versions it adopts.
- An **installer** materializes mechanisms from workshop into each consumer with vault-specific path substitution.
- `/audit` reports both content drift (notes that don't match the current rules) and platform drift (consumers behind the workshop's manifest).

Adding a new pattern goes from "9-card rollout dance" to:
1. Build it in the workshop and merge it to `main`. The release pipeline versions it and publishes it to the Homebrew tap.
2. Run `brew upgrade sauce` on each machine.
3. Run `sauce update --bump-pins` inside each vault. It moves the vault's pins to the new catalogue and re-runs the installer.
4. For a brand-new mechanism or blueprint, add it to the vault's subscription first (`sauce wizard`). A vault only receives what it subscribes to.

## Why this isn't a real Obsidian community plugin

- It would require maintaining a real software project (TypeScript, build pipeline, plugin manifest, releases).
- It couldn't ship blueprints or rule registries naturally — those are vault data, not plugin code.
- Distribution through a Homebrew tap (`brew install willfell/sauce/sauce`, then `sauce bootstrap --vault <path>` per vault) is simpler than publishing a plugin.

If the platform outgrows Templater scripts later, the pieces map cleanly to plugin code: the validator becomes a plugin event handler, the audit walker becomes a command-palette command, the installer becomes a settings-tab action. For now, Templater + JSON files do the job with zero build step.

## What "purpose-built" means

Will's words from the brainstorm:
> "I want my vaults to be purpose built with tools that are embedded naturally, with the idea that when I make a template for a vault, it's a blueprint to success and fluid use."

Three concrete commitments:
1. **Templates as blueprints.** Creating a note from a template always produces a note that conforms to the vault's rules. The validator hook auto-fixes simple violations and surfaces complex ones.
2. **Modular by construction.** Each "thing" (project, daily, invoice, side-quest) is a blueprint that can be added, modified, or removed without touching the rest.
3. **CLAUDE.md per vault is the source of truth.** The rule registry mirrors CLAUDE.md's non-negotiables in machine-readable form. Humans read CLAUDE.md; the platform reads the registry.

One further commitment, added as the platform grew:

4. **One vault, two kinds of user.** Every blueprint is usable by hand in Obsidian, through hubs, buttons, templates, and boards. The same notes are addressable by agents through shipped commands, skills, and a generated `CLAUDE.md` router. Most blueprints ship an agent command today. The rest are still plain Markdown that an agent can read and write.
