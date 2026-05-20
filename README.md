# Sauce

> Obsidian but with the Sauce.

Sauce is a versioned platform that ships **mechanisms** (cross-cutting code) and **blueprints** (note-type bundles) to consumer [Obsidian](https://obsidian.md) vaults via [Homebrew](https://brew.sh). It exists to turn ad-hoc vault customization — Templater scripts, Dataview views, plugin configs, folder conventions — into a single declarative install step that you can rerun, upgrade, and audit.

If you've ever copy-pasted scripts between vaults, lost them in a sync conflict, or wished your vault setup were a real piece of software, Sauce is for you.

## Install

Requires macOS or Linux with [Homebrew](https://brew.sh).

```bash
brew tap willfell/sauce
brew install willfell/sauce/sauce
sauce bootstrap --vault /path/to/your/vault
```

The `bootstrap` command launches an interactive wizard that walks you through picking which blueprints to install and writes a `platform-subscription.json` to your vault. After bootstrap, run `sauce install --vault <path>` any time you want to pull the latest platform changes into your vault.

## 5-minute quickstart

1. Pick an Obsidian vault you want to convert (or create a new one).
2. Run `sauce bootstrap --vault <path>` and accept the defaults for a first run.
3. Open the vault in Obsidian and let the plugins finish loading.
4. In any note, type `/audit` (via Slash Commander) to run the built-in audit and verify the install.
5. Open your chosen blueprint's hub (for example `spice/cowork/Daily Hub.md`) — that's your starting point.

To upgrade later:

```bash
brew upgrade willfell/sauce/sauce
sauce install --vault <path>
```

## Repo layout

| Path | Purpose |
| --- | --- |
| `platform/` | Canonical platform source — mechanisms, blueprints, installer |
| `ranch/` | Runtime plumbing materialized into consumer vaults |
| `spice/` | Module-directory namespace for blueprint content (consumer-side) |
| `commands/` | Master copy of cross-cutting slash commands |
| `Docs/` | All documentation — start at `Docs/Index.md` |
| `.claude/` | Native Claude Code skills + commands |

## Documentation

- [`Docs/getting-started.md`](Docs/getting-started.md) — **new here? start here.** Zero to a working vault with Claude-driven automation, end-to-end (~20 min).
- [`Docs/Index.md`](Docs/Index.md) — full doc index
- [`Docs/why.md`](Docs/why.md) — purpose and end goal
- [`Docs/how.md`](Docs/how.md) — architecture and concepts
- [`Docs/use.md`](Docs/use.md) — operational guide
- [`Docs/cowork-onboarding.md`](Docs/cowork-onboarding.md) — connect Claude Cowork to your vault
- [`Docs/landmines.md`](Docs/landmines.md) — known footguns to avoid

## Status

Pre-1.0; solo-developed. APIs and blueprint shapes may change between minor versions. Cycle history lives in [`Docs/cycle-history.md`](Docs/cycle-history.md) and per-cycle design/plan/result docs in [`Docs/plans/`](Docs/plans/).

## Security

See [`SECURITY.md`](SECURITY.md) for the vulnerability-reporting process.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) — please open an issue before sending a PR.

## License

MIT — see [`LICENSE`](LICENSE).
