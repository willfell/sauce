# WhatsApp Integration

> [!info] Optional
> Only relevant if the owner has the WhatsApp MCP connected. Otherwise the morning + EOD orchestrators skip this section automatically.

## Primary Chats

| Chat                       | Type   | Purpose                                |
|:---------------------------|:-------|:---------------------------------------|
| {{wa_chat_1_name}}         | {{wa_chat_1_type}} | {{wa_chat_1_purpose}}      |
| {{wa_chat_2_name}}         | {{wa_chat_2_type}} | {{wa_chat_2_purpose}}      |

## iMessage + WhatsApp routing

If a contact is reachable on both platforms, the orchestrator prefers iMessage. WhatsApp is the fallback for contacts who don't use iMessage (international family, group chats with non-Apple members).

| Person                     | iMessage | WhatsApp | Preferred |
|:---------------------------|:--------:|:--------:|:----------|
| {{wa_person_1_name}}       | {{wa_person_1_imessage}} | {{wa_person_1_whatsapp}} | {{wa_person_1_preferred}} |
| {{wa_person_2_name}}       | {{wa_person_2_imessage}} | {{wa_person_2_whatsapp}} | {{wa_person_2_preferred}} |

## MCP tools

- `check_whatsapp_status` -- verify WhatsApp is running.
- `list_recent_contacts` -- list recently contacted people (limited by privacy).
- `send_whatsapp_message(recipient_name, message)` -- requires explicit contact name.

## Privacy + limitations

- WhatsApp protects contact listings + message content for privacy.
- Exact contact/chat names must be specified when interacting with the MCP.
- The MCP can only surface activity from chats the owner is already part of.
- Never send WhatsApp messages without explicit permission.
