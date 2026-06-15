# MCP integration guide — {{employer}}

> [!info] Per-engagement MCP routing notes
> Read before every gather-* sub-skill runs against this engagement. List the MCP servers used + per-server quirks specific to this employer's data.

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
| {{mcp_extra_1_name}}    | {{mcp_extra_1_connected}}   | {{mcp_extra_1_purpose}}                          |

---

## Gmail MCP

- Connected account: {{work_email}}.
- Daily-digest filter: `label:{{gmail_label}} -category:promotions -category:social newer_than:1d`.
- Prioritize senders listed in `stakeholders.md`.
- Never send emails without explicit permission.

## Google Calendar MCP

- Calendar id: `{{calendar_id}}`.
- Timezone: {{owner_timezone}}.
- For daily briefing: today + next 2 days.
- Flag conflicts or double-bookings.
- Never create/modify events without explicit permission.

## Obsidian MCP

- Always vault-root-relative paths.
- Confirm vault routing via `cowork:skills/check-vault-routing` before any write.
