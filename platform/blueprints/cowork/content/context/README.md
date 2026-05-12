# Cowork context

> [!info] What lives here
> This directory holds per-vault config consumed by cowork orchestrators + sub-skills. Layout is **engagement-aware**: vault-wide files live at this directory's root; per-engagement files live under `<engagement.id>/` subdirectories materialized by `cowork:bootstrap-vault`.

Link back: [[../Cowork|Cowork hub]] | [[obsidian-vault-guide]]

---

## Vault-wide files (this directory's root)

| File                       | Owner          | Read by                                                            |
|:---------------------------|:---------------|:-------------------------------------------------------------------|
| `obsidian-vault-guide.md`  | platform       | Every orchestrator (first read after `check-vault-routing`).       |
| `README.md` (this file)    | platform       | Humans navigating the directory.                                   |
| `vault-config.md`          | bootstrap-vault — rule_fragment-validated | Every orchestrator: source of truth for `engagements[]` + MCP map. |
| `active-threads.md`        | bootstrap-vault seed; written by orchestrators (engagement-id-tagged) | All orchestrators. |
| `weekly-snapshot.md`       | bootstrap-vault seed; written by weekly orchestrators (per-engagement sections) | Morning briefings + weekly orchestrators. |

## Per-engagement subdirs

Each entry in `vault-config.md` `engagements[]` gets a subdirectory at `<engagement.id>/`. Files inside come from the engagement-type's template set (`engagement-templates/<type>/` in the workshop). Typical files:

| File                           | Engagement types | Read by                                                            |
|:-------------------------------|:-----------------|:-------------------------------------------------------------------|
| `about.md`                     | all              | All orchestrators (owner identity within this engagement).         |
| `working-style.md`             | all              | All write-callout + write-summary sub-skills.                      |
| `mcp-integrations.md`          | all              | All `gather-*` sub-skills + `check-vault-routing`.                 |
| `stakeholders.md`              | w2-fte, consulting | Morning + weekly orchestrators.                                  |
| `client-context.md`            | consulting       | Consulting orchestrators.                                          |
| `finance-guide.md`             | personal, consulting | `gather-finance-*` + `write-callout-finance` + `write-summary-invoice-prep`. |
| `people.md`                    | personal         | `gather-gmail` + `gather-imessage` + `write-callout-*`.            |
| `brand-voice.md`               | personal         | All write-callout + write-summary sub-skills.                      |
| `project-management.md`        | personal         | `gather-projects` + project-aware summaries.                       |
| `whatsapp-integration.md`      | personal         | `gather-imessage` (when WhatsApp MCP is connected).                |

The exact file set per engagement is determined by the engagement-type's template directory under `<workshop>/platform/blueprints/cowork/content/context/engagement-templates/<type>/`.

---

## Update behavior

- **`vault-config.md`** is owned by `cowork:bootstrap-vault`. Direct hand-edits to `engagements[]` are not recommended (the audit rule validates against the registered engagement-type schemas). Re-run bootstrap to add / drop / modify engagements.
- **Per-engagement files** (`<engagement.id>/*.md`) are materialized on first bootstrap from the engagement-type's template. They survive `sauce update` and re-bootstrap (re-bootstrap writes `<filename>.template.md` alongside if a fresh write would clobber, so you can diff + merge by hand).
- **Platform-managed files** (`README.md`, `obsidian-vault-guide.md`) are overwritten by `sauce update`; the previous version is preserved with a `.sauce-backup` suffix.
- **State files** (`active-threads.md`, `weekly-snapshot.md`) are seeded from `engagement-shared-templates/` by `cowork:bootstrap-vault` and subsequently owned by cron-fired orchestrators. Hand-edits are tolerated; the next orchestrator run reconciles.

---

## Engagement-type templates

When `cowork:bootstrap-vault` runs, it materializes per-engagement context from the workshop's engagement-type template directories:

- `engagement-templates/personal/` — life-scope templates (about, finance-guide, brand-voice, working-style, people, mcp-integrations, project-management, whatsapp-integration).
- `engagement-templates/w2-fte/` — W2 FTE templates (about, stakeholders, working-style, mcp-integrations).
- `engagement-templates/consulting/` — consulting / contract templates (about, client-context, stakeholders, finance-guide, working-style, mcp-integrations).
- `engagement-shared-templates/` — vault-wide seeds materialized at this directory's root: `active-threads.md`, `weekly-snapshot.md`, `vault-config.md`.

The bootstrap interview picks the engagement type per engagement; the resulting directory shape is fixed by the engagement-type's manifest under `engagement-types/<type>.json`.
