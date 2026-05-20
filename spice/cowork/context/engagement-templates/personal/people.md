# Important People

> [!info] Inner circle for prioritization
> The owner's most-important people. When reviewing messages, emails, or calendar events, prioritize anything involving these people. If the owner hasn't reached out in a while, flag it.

> [!warning] Personal data
> This file contains personal contact info. It is user-managed and survives `sauce update`. Do not check it into a public repo.

---

## Inner Circle

{{inner_circle_people}}

A list of H3 entries, one per inner-circle person, with this shape:

```markdown
### {{person_name}} ({{person_relationship}})
- **Contact name in iMessage:** {{person_imessage_contact_name}}
- **Phone:** {{person_phone}}
- **Birthday:** {{person_birthday}}
- **Priority:** {{person_priority}}
- **Last contact:** {{person_last_contact_summary}}
- **Outstanding:** {{person_outstanding_action}}
- **Context:** {{person_context_paragraph}}
```

---

## Close Friends

(Same shape as Inner Circle. Lower priority for daily flagging but still surfaced.)

---

## Notable Group Chats

| Chat name                  | Context                       | Activity |
|:---------------------------|:------------------------------|:---------|
| {{group_chat_1_name}}      | {{group_chat_1_context}}      | {{group_chat_1_activity}} |
| {{group_chat_2_name}}      | {{group_chat_2_context}}      | {{group_chat_2_activity}} |

---

## Service Contacts

| Name                       | Context                                      |
|:---------------------------|:---------------------------------------------|
| {{service_contact_1_name}} | {{service_contact_1_context}}                |
| {{service_contact_2_name}} | {{service_contact_2_context}}                |

---

## How this list is used

- **iMessage digest:** show inner circle first, then close friends, then active group chats. Skip unknown numbers + verification codes.
- **Gmail:** flag emails from these people as high priority.
- **Calendar:** highlight events that include these people.
- **Nudges:** if the owner hasn't messaged someone in the inner circle in > 7 days, mention it in the morning briefing. Tighter window for higher-priority contacts is fine.
- **Contact disambiguation:** the iMessage MCP often returns multiple fuzzy matches. Use the phone numbers above for precise lookups.
