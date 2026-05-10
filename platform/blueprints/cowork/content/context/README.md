# Cowork context

> [!info] What lives here
> This directory holds per-vault config consumed by cowork orchestrators + sub-skills. Each file answers a single question about the consumer: who is the owner, what MCP servers are connected, what does the writing voice sound like, what threads are open, what's the current week look like.

Link back: [[../Cowork|Cowork hub]] | [[obsidian-vault-guide]]

---

## Files

| File                       | Owner          | Read by                                                            |
|:---------------------------|:---------------|:-------------------------------------------------------------------|
| `obsidian-vault-guide.md`  | platform       | Every orchestrator (first read after `check-vault-routing`).       |
| `README.md` (this file)    | platform       | Humans navigating the directory.                                   |
| `about-me.md` (life scope) | user-managed   | Life orchestrators (morning-briefing, eod-review, weekly-review).  |
| `about-will.md` (ero scope)| user-managed   | Ero orchestrators (ero-morning, ero-eod, ero-weekly, ero-monthly). |
| `brand-voice.md`           | user-managed   | All write-callout + write-summary sub-skills.                      |
| `finance-goals.md` (life)  | user-managed   | `gather-finance-*` + `write-callout-finance`.                      |
| `finance-guide.md` (ero)   | user-managed   | `ero-monthly` + `invoice-prep`.                                    |
| `mcp-integrations.md`      | user-managed   | All `gather-*` sub-skills + `check-vault-routing`.                 |
| `whatsapp-integration.md`  | user-managed   | `gather-imessage` (when WhatsApp MCP is connected).                |
| `people.md`                | user-managed   | `gather-gmail` + `gather-imessage` + `write-callout-*`.            |
| `working-style.md`         | user-managed   | All write-summary sub-skills.                                      |
| `project-management.md`    | user-managed   | `gather-projects` + `ero-morning` + project-aware summaries.       |
| `ero-client.md` (ero)      | user-managed   | Ero orchestrators (client context).                                |
| `active-threads.md`        | rule_fragment-validated; written by orchestrators | All orchestrators. |
| `active-projects.md`       | rule_fragment-validated; written by `cowork:update-active-projects` | Ero orchestrators. |
| `weekly-snapshot.md`       | rule_fragment-validated; written by weekly orchestrators | Morning briefings + weekly orchestrators. |

---

## Update behavior

- **User-managed files** survive `sauce update`. The installer skips them if they already exist.
- **Platform-managed files** (`README.md`, `obsidian-vault-guide.md`) are overwritten by `sauce update`; the previous version is preserved with a `.sauce-backup` suffix.
- **State files** (`active-threads.md`, `active-projects.md`, `weekly-snapshot.md`) are seeded from the relevant `<scope>-context-templates/` directory by `cowork:bootstrap-vault` and are subsequently owned by the cron-fired orchestrators. Hand-edits are tolerated; the next orchestrator run reconciles.

---

## Scope templates

When `cowork:bootstrap-vault` runs, it materializes a starting set of files from one of the scope-template directories:

- `life-context-templates/` -- personal life scope (about-me, finance-goals, mcp-integrations, brand-voice, working-style, people, whatsapp-integration, project-management, weekly-snapshot).
- `ero-context-templates/` -- work scope for a single client (about-will, ero-client, finance-guide, active-projects, active-threads, weekly-snapshot).
- `shared-context-templates/` -- defaults shared across scopes (active-threads, weekly-snapshot).

Bootstrap picks the scope based on the value of `{{cowork_scope}}` in the consumer's `platform-config.json` (`life` | `ero` | `shared`).
