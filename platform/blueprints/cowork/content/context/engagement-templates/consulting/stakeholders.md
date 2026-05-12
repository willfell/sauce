---
type: scheduled-context
---

# Stakeholders — {{primary_client}}

> [!info] Key people at the client
> Used by morning + weekly + invoice-prep orchestrators. Names listed here are weighted in meeting + email summaries.

## Primary contacts

| Name                   | Role                   | Notes                        |
|:-----------------------|:-----------------------|:-----------------------------|
| {{contact_1_name}}     | {{contact_1_role}}     | {{contact_1_notes}}          |
| {{contact_2_name}}     | {{contact_2_role}}     | {{contact_2_notes}}          |
| {{contact_3_name}}     | {{contact_3_role}}     | {{contact_3_notes}}          |

## Accounts payable

- **AP contact:** {{ap_email}}
- **Invoice cadence:** {{invoice_cadence}}
- **Standard payment terms:** {{payment_terms}}

## Recurring meetings

| Meeting                  | Cadence                  | Day/Time                  | Notes                    |
|:-------------------------|:-------------------------|:--------------------------|:-------------------------|
| {{meeting_1_name}}       | {{meeting_1_cadence}}    | {{meeting_1_daytime}}     | {{meeting_1_notes}}      |
| {{meeting_2_name}}       | {{meeting_2_cadence}}    | {{meeting_2_daytime}}     | {{meeting_2_notes}}      |

To determine whether a given day is a meeting day, the orchestrator checks `spice/meetings/notes/` for the last occurrence.
