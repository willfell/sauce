---
type: cowork-bootstrap-report
generated: 2026-05-12
generated_by: cowork:bootstrap-vault
cowork_version: 0.2.1
prior_state: fresh
engagement_count: 1
engagements_summary:
  - "accuris (w2-fte)"
audit_receipt: warn
---

# Cowork bootstrap report — 2026-05-12

> [!abstract] Goal
> Materialize an engagement-aware cowork setup for the `accuris-sauce` vault. One W2 FTE engagement, all five cadences enabled, cron paste-blocks copied to `.scratch/cron-bodies/`.

> [!danger]+ Obsidian MCP routing drift — ACTION REQUIRED
> During bootstrap, every `mcp__obsidian__*` write landed at `~/Documents/obsidian/headspace/` instead of `~/Documents/obsidian/sync/sauce/accuris-sauce/`. The bleed was caught + corrected: each file written via MCP was copied back into the correct vault and the polluted entries in `headspace/spice/cowork/` were removed.
>
> **Before running any cron-scheduled cowork orchestrator**, re-bind the Obsidian MCP server in this Claude Code instance to `accuris-sauce`. Otherwise daily-note callouts + state updates from the orchestrators will write into the wrong vault. The `cowork:check-vault-routing` sub-skill is supposed to short-circuit on this, but the v0.31.0 implementation only checks for an obsidian connection, not vault-identity match — worth tracking as a v0.31.x gap.

---

## §1 — What I discovered

> [!info] MCP map
>
> | Backend         | Status                        | Notes                                                                                              |
> |:----------------|:------------------------------|:---------------------------------------------------------------------------------------------------|
> | obsidian        | connected (WRONG VAULT)       | Bound to `headspace/`, not `accuris-sauce/`. Recovered via file copy + scrub; permanent fix is re-bind the MCP. |
> | gmail           | missing                       |                                                                                                    |
> | google-calendar | missing                       |                                                                                                    |
> | brex            | missing                       |                                                                                                    |
> | imessage        | unavailable                   |                                                                                                    |
> | whatsapp        | missing                       |                                                                                                    |

> [!example]- Vault surface
> - `spice/cowork/` already existed from an earlier (non-engagement-aware) setup; legacy files at `spice/cowork/context/` (about-me.md, brand-voice.md, project-management.md, team-structure.md, working-style.md, etc.) were preserved untouched. They are not in the v0.31.0 template set — review whether to merge their content into the new per-engagement files at `spice/cowork/context/accuris/`.
> - `ranch/templates/Daily Note.md` has the required `<!-- COWORK_CALLOUTS -->` anchor.
> - Blueprints installed: boards, daily, meetings, people, to-do, project, cowork@0.2.1.
> - Mechanisms: customjs-guard, validator, audit, nav-buttons@2.6.0, cards, accent-button, people-rendering, styling, convenience.

---

## §2 — Engagements

### `accuris` (w2-fte) — Accuris (W2 full-time)

| Field             | Value                                                 |
|:------------------|:------------------------------------------------------|
| Role              | Principal Software Engineer                            |
| Employer          | Accuris                                                |
| Manager           | Stefan de Pagter                                       |
| Stakeholders      | Stefan de Pagter, Jon Levin, Hayden Remington          |
| Work email        | will.fellhoelter@accuristech.com                       |
| Gmail label       | _(not set — Gmail MCP not connected this session)_     |
| Calendar id       | will.fellhoelter@accuristech.com                       |
| Context dir       | `spice/cowork/context/accuris/`                        |
| Cadences enabled  | morning, midday, eod, weekly, monthly                  |

---

## §3 — Cron jobs

> [!info] Drop mode
> You chose **report + .scratch/**, so each block was also written to `.scratch/cron-bodies/accuris-<cadence>.md` for easy paste into your scheduler.

| Cadence | Schedule (recommended) | Cron        | Job name                 | Paste-block file                              |
|:--------|:-----------------------|:------------|:-------------------------|:----------------------------------------------|
| morning | weekdays 06:30 local   | `30 6 * * 1-5` | `cowork-accuris-morning` | `.scratch/cron-bodies/accuris-morning.md` |
| midday  | weekdays 12:00 local   | `0 12 * * 1-5` | `cowork-accuris-midday`  | `.scratch/cron-bodies/accuris-midday.md`  |
| eod     | weekdays 21:00 local   | `0 21 * * 1-5` | `cowork-accuris-eod`     | `.scratch/cron-bodies/accuris-eod.md`     |
| weekly  | Sun 19:00 local        | `0 19 * * 0`   | `cowork-accuris-weekly`  | `.scratch/cron-bodies/accuris-weekly.md`  |
| monthly | 1st 19:00 local        | `0 19 1 * *`   | `cowork-accuris-monthly` | `.scratch/cron-bodies/accuris-monthly.md` |

Each block contains the SKILL invocation + a shell-style cron entry. Adjust the executable to whatever your cron infra uses to fire Claude Code.

---

## §4 — Skipped

| (engagement, cadence)    | Why skipped (when fired)                                                                   |
|:-------------------------|:-------------------------------------------------------------------------------------------|
| accuris × midday         | `render_aspects.finance_block = skip` for w2-fte — output will likely be sparse (no CC alerts). Kept enabled because you selected "all five cadences on". |
| accuris × monthly        | w2-fte default is monthly OFF; you enabled it. Output uses `cowork:write-summary-fte-status`, not invoice prep (`render_aspects.invoice_prep = skip`). |
| accuris × * (gmail pulls)| `gather-gmail` will short-circuit until Gmail MCP is connected + `gmail_label` is set in `vault-config.md`. |
| accuris × * (calendar)   | `gather-calendar` will short-circuit until Google Calendar MCP is connected.               |
| accuris × * (imessage)   | `inner_circle_imessage = skip` for w2-fte (and no MCP shipped yet).                        |
| accuris × * (finance)    | `finance_block = skip` for w2-fte — `gather-finance-*` skills no-op.                       |

---

## §5 — Unresolved fields

> [!todo] Hand-fill these placeholders
> The bootstrap interview only captured the W2-FTE required fields + a few optional ones. The per-engagement template files retain `{{...}}` markers for the rest. Fill them in `spice/cowork/context/accuris/`.

### `spice/cowork/context/accuris/about.md`
- `{{standard_hours}}` — e.g. "09:00–17:00 CT"
- `{{current_focus_paragraph}}` — what you're focused on this quarter
- `{{working_agreements_paragraph}}` — how you operate inside Accuris culture

### `spice/cowork/context/accuris/stakeholders.md`
- `{{manager_notes}}` — context on Stefan
- `{{stakeholder_3_name}}` / `_role` / `_notes` — third stakeholder row (or delete the row)
- `{{meeting_1_*}}` / `{{meeting_2_*}}` — recurring meetings

### `spice/cowork/context/accuris/working-style.md`
- `{{core_hours}}`, `{{async_tolerance}}`, `{{oncall_posture}}`
- `{{primary_channels}}`, `{{dm_expectations}}`, `{{email_triage_cadence}}`
- `{{meeting_policy_1..3}}`

### `spice/cowork/context/accuris/mcp-integrations.md`
- `{{owner_timezone}}` — e.g. `America/Chicago`
- `{{mcp_extra_1_*}}` — only relevant if you add a third MCP backend (Brex, Slack, etc.)
- Gmail section becomes live once you connect the Gmail MCP and set `engagements[0].gmail_label` in `vault-config.md`

### Optional config keys
- `ranch/platform-config.json` `variables` — nothing required from bootstrap; the W2-FTE engagement-type schema does not consume any platform-config variables today.

---

## §6 — Audit receipt

> [!warning] Audit status: WARN (post-write)
> `node pantry/platform/cli/sauce-cli.js audit --vault . --only cowork --format json` ran cleanly. Total violations: **1177** across all blueprints; **17** are in the `cowork` blueprint scope. The bulk (816) are `daily`-blueprint naming violations driven by the legacy `<dddd-YYYY-MM-DD>.md` daily-note convention — out of scope for cowork bootstrap.

### Cowork-blueprint violations (17)

| File                                                                 | Rule                       | Severity | Note                                                                 |
|:---------------------------------------------------------------------|:---------------------------|:---------|:---------------------------------------------------------------------|
| `spice/cowork/context/active-threads.md`                             | `required_frontmatter.type` | error    | Pre-existing file lacks `type: cowork-threads` frontmatter (×4 dup)  |
| `spice/cowork/context/active-threads.md`                             | `required_frontmatter.updated` | error | Pre-existing — needs `updated: YYYY-MM-DD` (×4 dup)                  |
| `spice/cowork/context/active-threads.md`                             | `required_frontmatter.updated_by` | error | Pre-existing — needs `updated_by` (×4 dup)                          |
| `spice/cowork/context/engagement-shared-templates/vault-config.md`   | `frontmatter_parse`        | error    | Stale legacy template inside `spice/` — should not be there (template lives in `pantry/`). Safe to delete. |
| `spice/cowork/Cowork.md`                                             | `required_tags.missing`    | error    | False positive — frontmatter has `tags: [cowork-hub]`. Likely audit-rule parser quirk (×4 dup); manually verified. |

### Recommended corrective actions

1. Patch frontmatter of pre-existing `spice/cowork/context/active-threads.md` (it was created by an older non-bootstrap flow). Preserved per skill spec (never clobbered).
2. Delete the stray `spice/cowork/context/engagement-shared-templates/` directory — that template tree should only live at `pantry/platform/blueprints/cowork/content/context/engagement-shared-templates/`.
3. Investigate the Cowork.md `required_tags.missing` false positive — possibly a `validator@0.1.2` quirk with inline-flow YAML lists.

### Untracked top-level directories (15)
`.scratch/`, `.smart-env/`, `Automation/`, `Cowork/`, `Docs/`, `Extras/`, `Files/`, `MOCs/`, `Planning-Old/`, `Resources/`, `Timestamps/`, `_drift-evidence-2026-05-12/`, `attachments/`, `lib/`, `{{module_directory}}/` — all consumer-managed; review whether each should be moved under a sanctioned top-level (`spice/` / `ranch/` / `pantry/` / `.claude/skills/` / `.obsidian/`) or accepted as user-owned.

---

## §7 — Manual Obsidian + natural-language parity

### Manual entry points
- `[[spice/cowork/Cowork|Cowork hub]]` — engagement × cadence nav-button table.
- `[[spice/cowork/context/vault-config|vault-config]]` — canonical engagement record.
- `[[spice/cowork/context/accuris/about|Accuris — About]]` (+ `stakeholders`, `working-style`, `mcp-integrations`).
- `.claude/cowork-routing.md` — NL phrasing cheat-sheet.

### Natural-language phrasings (single engagement → bind to `accuris` by default)
- "Give me my morning briefing" → `cowork:morning-briefing { engagement_id: "accuris" }`
- "EOD review" / "Wrap up my day" → `cowork:eod-review { engagement_id: "accuris" }`
- "Weekly review" → `cowork:weekly-review { engagement_id: "accuris" }`
- "Monthly review" → `cowork:monthly-review { engagement_id: "accuris" }`
- "Midday check" → `cowork:midday-tripwire { engagement_id: "accuris" }`
- "Bootstrap cowork" / "Add an engagement" / "Modify Accuris config" → `cowork:bootstrap-vault` (re-bootstrap mode)

### Scheduled (cron) entry points
See §3. Paste-blocks are at `.scratch/cron-bodies/accuris-*.md`.

---

## Notice

`Bootstrap complete (1 engagement). Open spice/cowork/bootstrap-report.md for next steps.`
