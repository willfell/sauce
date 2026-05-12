# MCP integration guide — {{primary_client}}

> [!info] Per-engagement MCP routing notes
> Read before every gather-* sub-skill runs against this engagement.

> [!warning] Connection drift
> Before any vault write the orchestrator's first call is `cowork:skills/check-vault-routing` (verifies the active Obsidian MCP target matches `{{vault_id}}`).

---

## Scoping fields

- **Gmail label:** `{{gmail_label}}` — restricts gather-gmail reads to mail tagged for this engagement.
- **Calendar id:** `{{calendar_id}}` — restricts gather-calendar reads to this engagement's calendar.

---

## Connected MCP servers

| MCP                     | Connected?                  | Purpose                                          |
|:------------------------|:---------------------------:|:-------------------------------------------------|
| `{{vault_id}}-obsidian` | yes                         | Vault reads + writes (mandatory).                |
| Gmail                   | {{mcp_gmail_connected}}     | {{mcp_gmail_purpose}}                            |
| Google Calendar         | {{mcp_gcal_connected}}      | {{mcp_gcal_purpose}}                             |
| Copilot Money / Brex    | {{mcp_finance_connected}}   | {{mcp_finance_purpose}}                          |
| {{mcp_extra_1_name}}    | {{mcp_extra_1_connected}}   | {{mcp_extra_1_purpose}}                          |

---

## Gmail MCP

- Daily-digest filter: `label:{{gmail_label}} -category:promotions -category:social newer_than:1d`.
- Prioritize senders listed in `stakeholders.md`.
- Never send emails without explicit permission.

## Google Calendar MCP

- Calendar id: `{{calendar_id}}`.
- Timezone: {{owner_timezone}}.
- For daily briefing: today + next 2 days.
- Flag conflicts or double-bookings.
- Never create/modify events without explicit permission.

## Finance MCP (invoice-prep)

- Primary source for billable-hours aggregation + expense tracking.
- Brex (when enabled per engagement) scoped to {{primary_client}} card.
- See `finance-guide.md` for the invoice submission flow.

## Obsidian MCP

- Always vault-root-relative paths.
- Confirm vault routing via `cowork:skills/check-vault-routing` before any write.
