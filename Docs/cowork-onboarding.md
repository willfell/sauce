# Cowork onboarding

How to connect Claude Cowork (or any scheduler) to a sauce-installed vault so the orchestrators (`cowork:morning-briefing`, etc.) can fire on schedule and land their output in the right places.

## The 5-step checklist

| Step | Action | Where readiness panel reflects it |
|---|---|---|
| 1 | Install sauce + subscribe to cowork blueprint (`sauce install`) | implicit — panel renders only if blueprint is installed |
| 2 | Run `cowork:bootstrap-vault` to create `spice/cowork/context/vault-config.md` + your engagement | `Engagement: ✓ <id>` |
| 3 | Customize the prompt bodies at `spice/cowork/prompts/{morning-briefing,midday-tripwire,eod-review,weekly-review,monthly-review}.md` (or leave empty — orchestrators emit stub notes with `warning: empty_prompt` frontmatter) | `Prompts: 5/5 present (N empty stubs)` |
| 4 | Connect Claude Cowork app: mount the vault as an MCP server (obsidian-mcp), register the orchestrators as scheduled jobs (Mon–Fri at your preferred times) | `MCP routing: ✓ ready` |
| 5 | First scheduled run lands → readiness panel shows per-orchestrator last-run timestamps | `morning-briefing: 2026-05-19T07:05:14-06:00` |

## Atomic-note write contract

Each scheduled run writes one atomic note at a deterministic path. Path is a pure function of `(orchestrator, day | week | month)`. Re-runs are idempotent: same path, last write wins.

| Orchestrator | Path |
|---|---|
| `cowork:morning-briefing` | `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/morning-briefing.md` |
| `cowork:midday-tripwire` | `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md` |
| `cowork:eod-review` | `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/eod-review.md` |
| `cowork:weekly-review` | `spice/cowork/weekly/YYYY/YYYY-Www/weekly-review.md` |
| `cowork:monthly-review` | `spice/cowork/monthly/YYYY/YYYY-MM/monthly-review.md` |

Frontmatter every run-note carries (canonical-vocab + cowork rule_fragment validated):

```yaml
type: cowork-morning-briefing       # or any of the 6 canonical cowork-* types
created_at: "2026-05-19T07:05:14-06:00"
engagement_id: "accuris"
day: "2026-05-19"                    # daily orchestrators
generator: "cowork:morning-briefing@1.0.0"
prompt_source: "spice/cowork/prompts/morning-briefing.md"
```

## MCP setup

Recommended (used by accuris / headspace today):

- **MCP server:** `obsidian-mcp` (understands wikilinks, frontmatter, daily-notes folder). Filesystem MCP is **not** recommended — loses Obsidian semantics.
- **Mount point:** vault root. Keeps Claude's working directory matching the canonical `spice/cowork/...` paths the contract uses — no path translation layer.
- **Routing check:** `cowork:check-vault-routing` already probes `obsidian` as a backend; no extra MCP plumbing needed.

## Registering scheduled jobs

In Claude Cowork app (or your scheduler), register each orchestrator with the engagement id:

```text
Task: morning-briefing
Schedule: Mon–Fri 07:05
Vault: <your-vault-name>
Invocation: Use skill cowork:morning-briefing with { engagement_id: "accuris" }
```

Repeat for each orchestrator at your preferred cadence (e.g. eod at 17:09; midday at 12:30; weekly Fri 04:00; monthly first of month).

## Verifying

Open `spice/cowork/Cowork.md` and check the readiness panel. Re-running it after each onboarding step is the fastest feedback loop — the panel is the same on day 1 and day 90.
