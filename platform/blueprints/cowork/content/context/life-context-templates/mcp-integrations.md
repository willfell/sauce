# MCP Integration Guide

> [!info] Per-vault MCP routing notes
> Cowork orchestrators read this before any gather-* sub-skill runs. List the MCP servers the owner has connected + per-server quirks. Cron-fired Claude treats this as authoritative for MCP availability.

> [!warning] Connection drift
> MCP connections can drift between vaults on restart. Before writing to any Obsidian vault, the orchestrator's first call is `cowork:skills/check-vault-routing` (verifies the active MCP target matches `{{vault_id}}`).

---

## Connected MCP servers

Mark each row as connected or not. Skills check connectivity at runtime; a `not connected` row tells the orchestrator to skip the corresponding gather step gracefully.

| MCP                          | Connected? | Purpose                                                    |
|:-----------------------------|:----------:|:-----------------------------------------------------------|
| `{{vault_id}}-obsidian`      | yes        | Vault reads + writes (mandatory).                          |
| Gmail                        | {{mcp_gmail_connected}} | {{mcp_gmail_purpose}}                          |
| Google Calendar              | {{mcp_gcal_connected}}  | {{mcp_gcal_purpose}}                           |
| iMessage (variant A or B)    | {{mcp_imessage_connected}} | {{mcp_imessage_purpose}}                    |
| WhatsApp                     | {{mcp_whatsapp_connected}} | {{mcp_whatsapp_purpose}}                    |
| Copilot Money                | {{mcp_copilot_connected}} | {{mcp_copilot_purpose}}                      |
| Weather                      | {{mcp_weather_connected}} | {{mcp_weather_purpose}}                      |
| {{mcp_extra_1_name}}         | {{mcp_extra_1_connected}} | {{mcp_extra_1_purpose}}                      |

---

## iMessage MCP

Two variants exist; check which one is connected at job start.

**Variant A** -- `mcp__Read_and_Send_iMessages__*`:
- `read_imessages(phone_number, limit)`
- `get_unread_imessages(limit)`
- `search_contacts(query)`
- `send_imessage(recipient, message)`

**Variant B** -- `mcp__messages__*`:
- `tool_get_recent_messages(hours, contact)`
- `tool_get_chats()`
- `tool_fuzzy_search_messages(query)`
- `tool_find_contact(name)`
- `tool_send_message(recipient, message)`

If neither variant is available, the orchestrator notes "iMessage MCP not connected" in output and skips the Messages section.

---

## Copilot Money MCP

Primary source for all personal finance data. Reads from a local SQLite cache that auto-refreshes every 5 minutes. If data seems stale, call `refresh_database` first.

- `exclude_transfers=true` (default) avoids double-counting CC payments + inter-account transfers.
- Custom categories: see `finance-goals.md` for the owner's category map.
- Large query results (>50K chars) get saved to a temp file. Use jq/python to parse.
- Brex (work) accounts are excluded from personal finance totals.

---

## Gmail MCP

- Connected account: {{life_gmail_account}}.
- Daily-digest filter: `-category:promotions -category:social -category:updates -category:forums newer_than:1d`.
- Prioritize senders listed in `people.md`.
- Never send emails without explicit permission.

---

## Google Calendar MCP

- Timezone: {{owner_timezone}}.
- For daily briefing: today + next 2 days.
- Flag conflicts or double-bookings.
- Never create/modify events without explicit permission.

---

## Obsidian MCP

- Always vault-root-relative paths (never prefix with `Life/`, `ERO/`, etc.).
- Confirm vault routing via `cowork:skills/check-vault-routing` before any write.
