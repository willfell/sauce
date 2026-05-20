# Getting started

Zero to a working sauce vault with Claude-driven automation, end-to-end. Assumes macOS, a working install of [Obsidian](https://obsidian.md), and that you've used [Claude Code](https://claude.com/claude-code) at least once. About 20 minutes start to finish.

If something in the walkthrough doesn't match what you see, the deeper references are:

- [`Docs/use.md`](use.md) — full operational guide (install, update, migrate, audit)
- [`Docs/cowork-onboarding.md`](cowork-onboarding.md) — the cowork scheduled-job onboarding checklist
- [`Docs/landmines.md`](landmines.md) — known footguns

## 1. Install sauce (once per machine)

You need [Homebrew](https://brew.sh) first. Then:

```bash
brew tap willfell/sauce
brew install willfell/sauce/sauce
sauce --version
```

`sauce` is the CLI you'll use to bootstrap and update vaults. Re-running `brew upgrade willfell/sauce/sauce` pulls newer platform releases as they ship.

## 2. Create or pick an Obsidian vault

You have two options:

- **New vault:** open Obsidian → *Create new vault* → pick a name and location. Close Obsidian for now.
- **Existing vault:** any vault works; sauce installs into a `spice/` namespace and won't collide with your existing content.

Throughout this guide we'll call the vault path `<vault>` — substitute your real path (e.g. `~/Documents/Obsidian/MyVault`).

## 3. Bootstrap the vault

In a terminal:

```bash
cd <vault>
sauce bootstrap
```

This runs an interactive wizard that:

1. Asks which **blueprints** you want (daily notes, meetings, scratch, projects, cowork, etc.). Accept the defaults for a first run — you can re-bootstrap later to add or drop blueprints.
2. Asks which **plugins** to install — sauce will fetch them from Obsidian's community plugin index.
3. Writes a `ranch/platform-subscription.json` in your vault recording your choices.
4. Runs the installer to materialize everything: templates, Dataview views, slash commands, CustomJS helpers, plugin configs.

When it finishes you'll see `Verdict: clean run — exit 0`. The vault now has a `spice/` directory with one folder per blueprint (`spice/daily`, `spice/cowork`, `spice/meetings`, …) and a `ranch/` directory with the runtime plumbing.

## 4. Open the vault in Obsidian

Open Obsidian and *Open folder as vault* → pick `<vault>`. Obsidian will load the plugins; the first time may take 10–20 seconds.

A few things to check:

- Open `spice/cowork/Cowork.md` — you'll see a **Cowork readiness** panel at the top showing engagement / prompts / MCP routing / last runs / expected jobs. Right now everything will say "not configured" — that's expected, you fix it in the next step.
- Open `spice/daily/Daily Hub.md` — a card-listed view of your daily notes (empty until you create one).
- In the file menu, hit `Cmd+R` once to make sure all CustomJS helpers are loaded fresh.

If the readiness panel doesn't render (instead you see the raw `dataviewjs` block), enable the Dataview + CustomJS + Templater plugins under *Settings → Community plugins* and Cmd+R.

## 5. Bootstrap your cowork engagement

This is a one-time interactive setup that records who you are and what kind of work-context you're in (`personal` / `w2-fte` / `consulting`). It writes a `vault-config.md` that the rest of cowork reads from.

In a terminal in your vault:

```bash
cd <vault>
claude
```

(Or use the IDE extension — anything that launches Claude Code in this directory.) Then in the Claude Code prompt:

```
/cowork
```

The skill drives a 25-step interview, one question at a time:

- engagement id (e.g. `personal`, `dayjob`, `clientco`)
- engagement type (`personal` / `w2-fte` / `consulting`)
- required fields for that type (role, employer, primary client, etc.)
- which cadences to enable (morning briefing, midday tripwire, eod review, weekly review, monthly review)
- MCP probes (it checks which backends are reachable — obsidian, gmail, calendar, brex, etc.)

When it finishes, refresh `Cowork.md` in Obsidian. The readiness panel's first row flips to `Engagement: ✓ <id>`.

## 6. Onboard scheduled jobs (the v0.65.0 entry point)

The previous step set up the **vault**. This step sets up the **schedule** — when Claude actually fires `cowork:morning-briefing` at 7:05 AM each weekday and writes the morning briefing into your vault.

This step happens in **Claude Cowork** (the Anthropic-hosted desktop app that runs scheduled Claude tasks), not Claude Code. Two prerequisites:

1. You have [Claude Cowork](https://claude.com/cowork) installed (Mac app).
2. Your vault is mounted in Claude Cowork as an MCP server via `obsidian-mcp` (point it at `<vault>`).
3. The `scheduled-tasks` MCP is enabled in Claude Cowork.

Inside Claude Cowork (with your vault mounted), say:

> set up cowork scheduled jobs

The `cowork:onboard-scheduled-jobs` skill takes over and asks 3 quick questions per orchestrator:

1. **Enable?** (default yes for cadences your engagement-type recommends)
2. **Cadence?** (default Mon–Fri 07:05 / 12:30 / 17:05 / Fri 04:00 / 1st-of-month 04:00 in your TZ)
3. **Prompt body?** Three choices:
   - `(a) sauce default` — use a platform-shipped prompt template tuned for your engagement type
   - `(b) empty stub` — leave the prompt blank; the orchestrator will emit a stub note marked `warning: empty_prompt` so you can see the wiring works before you customize it
   - `(c) tell me what this should emit` — interactive Q&A; you describe what you want, the skill drafts a prompt body, you approve before write

When all 5 orchestrators are walked, the skill registers the cron jobs in Claude Cowork's scheduled-tasks MCP and writes a `spice/cowork/scheduled-jobs.md` config note to your vault.

This is **re-runnable**. On day 90 when you want to change a cadence or rewrite a prompt, run the same skill — it diffs against the live job list and walks you through changes.

## 7. Verify

Back in Obsidian, reopen `Cowork.md`. The readiness panel should now show:

- `Engagement: ✓ <your-id>`
- `Prompts: 5/5 present (N empty stubs)` (N is however many you left empty)
- `MCP routing: ✓ ready` (or `no cache yet` until the first scheduled run writes the cache)
- `Last runs: morning-briefing (never), …` (populates after the first scheduled fire)
- `Expected jobs: N configured · 0 fired today`

When the first scheduled job actually fires (next morning at 7:05, or whenever you set), an atomic note appears at a deterministic path:

```
spice/cowork/daily/2026/05-May/2026-05-20/morning-briefing.md
```

ActivityFeed surfaces it in `Daily Hub`, `Weekly Hub`, `Monthly Hub`, and `Today.md`. The dashboard panel in your daily note picks it up under a "Today's Activity" group. The readiness panel's `Last runs` row flips to the timestamp.

## 8. Keep it updated

Whenever a new sauce release ships:

```bash
brew upgrade willfell/sauce/sauce
cd <vault>
sauce update
```

`sauce update` pulls the workshop's `origin/main`, re-runs the installer, and reports what changed in `ranch/bootstrap-last-install.log`. Your `spice/` content is never touched — only the platform-managed plumbing under `ranch/`, the plugin configs in `.obsidian/`, and the slash commands / skills in `.claude/`.

### Picking up a stale vault on a new device

If you've installed sauce fresh on a new machine and your vault hasn't been updated in a while, `sauce update` may report `skip <name> — subscription pins X but workshop has Y` for every blueprint that's had a version bump since you last installed. That's the vault's `ranch/platform-subscription.json` pinning old versions.

The fix is two commands:

```bash
cd <vault>
sauce status            # shows what's pinned vs the current workshop
sauce wizard            # interactive: refresh subscription pins against the current catalogue
sauce update            # materialize the new platform
```

`sauce wizard` is the canonical "I have a stale vault, refresh its subscription" entry point. It walks the workshop catalogue, asks which newly-added blueprints to subscribe to, drops removed ones, and rewrites the subscription file with current pins. After that, `sauce update` will materialize cleanly.

If `sauce wizard` isn't available or you'd rather hand-edit, open `ranch/platform-subscription.json`, bump `workshop_version` plus the version of each blueprint and mechanism to match the workshop's current values (visible from `sauce status` or from `platform/manifest.json` of the brew-installed workshop at `/opt/homebrew/opt/sauce/libexec/platform/manifest.json`), then `sauce update`.

## What's next

- **Customize prompts.** Edit `spice/cowork/prompts/*.md` to control what each orchestrator emits. Empty prompts produce stub notes; populated prompts drive the actual analysis.
- **Add your own scheduled jobs.** See [`Docs/cowork-consumer-extensions.md`](cowork-consumer-extensions.md) for a worked sprint-sync example (custom job pulling ADO activity into a daily atomic note).
- **Explore other blueprints.** `/project`, `/meetings`, `/scratch`, `/daily` slash commands navigate the per-blueprint hubs. Each blueprint installs its own `spice/<name>/` directory with the relevant note types, templates, and dashboards.
- **Audit drift.** `/audit` from within Claude Code reports any inconsistencies between the installed state and the canonical platform — surfaces things like prompts you've customized or files you've edited that would be reverted on next `sauce update`.

## When something doesn't work

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cowork.md` readiness panel shows raw `dataviewjs` block | Dataview / CustomJS / Templater plugin disabled | Settings → Community plugins → enable, then `Cmd+R` |
| `/cowork` slash command not found in Claude Code | Slash Commander didn't pick up the new commands | `Cmd+R` in Obsidian, restart Claude Code session |
| `sauce update` reports `skip <name> — subscription pins X but workshop has Y` | Your vault's `ranch/platform-subscription.json` pins old versions | Edit the subscription file: bump the named pin to match the workshop version, re-run `sauce update` |
| Scheduled job fires but no atomic note appears | The orchestrator's `check-vault-routing` step bailed | Check `spice/cowork/.routing-cache.json` for the failure reason; usually a missing MCP backend |
| Atomic note has `warning: empty_prompt` frontmatter | The prompt body at `spice/cowork/prompts/<orch>.md` is empty | Edit the prompt file; next run uses the new body |

For anything else, [`Docs/landmines.md`](landmines.md) catalogues 22 known footguns and how to recover from each.
