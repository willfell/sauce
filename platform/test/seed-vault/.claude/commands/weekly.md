---
description: Open this-week's weekly note (creating it if missing), or `/weekly hub` to open the Weekly Hub.
allowed-tools: [Bash, Read, Write]
---

# /weekly

Navigate the cowork weekly timeframe.

**Default invocation:** `/weekly` opens this-week's weekly note at `spice/cowork/weekly/<YYYY>/<YYYY>-W<ww>.md`. If the file doesn't exist, create it from `ranch/templates/Weekly Note.md` (resolving Templater placeholders for date/title/tags), then open.

**Hub invocation:** `/weekly hub` opens `spice/cowork/Weekly Hub.md` — the card-listed index of all weekly notes in the vault.

**Implementation:**

1. Resolve the current ISO-week label: `YYYY-W<ww>` where `<ww>` is zero-padded ISO-week number.
2. If args contain `hub` (case-insensitive), open `spice/cowork/Weekly Hub.md` and stop.
3. Compute target path: `spice/cowork/weekly/<YYYY>/<YYYY>-W<ww>.md`.
4. Check existence. If missing, materialize from template (resolve placeholders inline — `tp.file.title` = `<YYYY>-W<ww>`, `tp.file.creation_date` = now, `week_start` = `.startOf("isoWeek")`, `week_end` = `.endOf("isoWeek")`, `{{vault_identity_tag}}` = vault-config tag, `{{views_path}}` = `ranch/views`).
5. Open the target note.

**Notes:**
- This command is a thin convenience wrapper around the `cowork-weekly-this` global nav-button. Both materialize the same path from the same template.
- The cowork blueprint owns the route; the daily blueprint owns `/daily` (which targets `spice/daily/...` not `spice/cowork/weekly/...`).
