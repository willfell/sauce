---
description: Open this-month's monthly note (creating it if missing), or `/monthly hub` to open the Monthly Hub.
allowed-tools: [Bash, Read, Write]
---

# /monthly

Navigate the cowork monthly timeframe.

**Default invocation:** `/monthly` opens this-month's monthly note at `spice/cowork/monthly/<YYYY>/<YYYY>-<MM>.md`. If the file doesn't exist, create it from `ranch/templates/Monthly Note.md` (resolving Templater placeholders), then open.

**Hub invocation:** `/monthly hub` opens `spice/cowork/Monthly Hub.md`.

**Implementation:**

1. Resolve the current month label: `<YYYY>-<MM>`.
2. If args contain `hub`, open `spice/cowork/Monthly Hub.md` and stop.
3. Compute target path: `spice/cowork/monthly/<YYYY>/<YYYY>-<MM>.md`.
4. Check existence. If missing, materialize from template (resolve `tp.file.title` = `<YYYY>-<MM>`, `month_start` = `.startOf("month")`, `month_end` = `.endOf("month")`).
5. Open the target note.

**Notes:**
- Sibling command to `/weekly` and `/daily`. All three target different timeframes; cowork blueprint owns `/weekly` and `/monthly`, daily blueprint owns `/daily`.
