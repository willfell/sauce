---
name: cowork:gather-weather
description: Fetch current weather + 2-day forecast for a city, return a paste-ready Weather callout block.
inputs:
  engagement_id: string
  city: string
  days_ahead: number
  units: string
outputs:
  markdown: string
tags: [cowork, gather, engagement-aware]
---

# cowork:gather-weather

Fetches current conditions plus a 2-day forecast from `wttr.in` (no API key required, public JSON endpoint) and emits a self-contained `[!info]+ Weather` callout. Orchestrators paste the returned markdown verbatim into the daily note's Morning Briefing section.

## Inputs

- `engagement_id` (string, required): id of the engagement this gather runs for. **Type-gated**: early-exit silently with `{ markdown: "" }` if `engagement.type != "personal"` (weather is only included in personal-engagement morning briefings; w2-fte / consulting types skip).
- `city` (string, optional): explicit city override. When absent, uses `engagement.home_city` from the resolved engagement record. Example: `"Evergreen, CO"` or `"80439"`. May contain spaces and a comma; the skill URL-encodes it before pasting into the wttr.in URL.
- `days_ahead` (number, optional, default `2`): how many days of forecast to render in the output table. Range `0..3`.
- `units` (string, optional, default `"F"`): `F` for Fahrenheit, `C` for Celsius.

## Outputs

- `markdown` (string): a single 5-7 line `> [!info]+ Weather` callout. No leading or trailing blank lines.

## Steps

1. Resolve `units` to JSON keys: `F` -> `temp_F` / `FeelsLikeF` / `maxtempF` / `mintempF`; `C` -> `temp_C` / `FeelsLikeC` / `maxtempC` / `mintempC`.
2. URL-encode `city` (replace spaces with `+` or `%20`, encode the comma as `%2C`). Call `WebFetch` with `url: "https://wttr.in/<encoded city>?format=j1"` and `prompt: "Return the JSON response body verbatim."`.
3. Parse the response JSON. Extract:
   - `current_condition[0].weatherDesc[0].value` -> conditions string
   - `current_condition[0].temp_<unit>` -> current temp
   - `current_condition[0].FeelsLike<unit>` -> feels-like temp
   - `weather[0].maxtempF` / `mintempF` (or C variant) -> today's high/low
   - For each `i` in `1..days_ahead` (capped at 3): `weather[i].date` + `weather[i].hourly[4].weatherDesc[0].value` + `weather[i].maxtempF` / `mintempF` -> forecast row.
4. Format dates as `YYYY-MM-DD`. Compose the callout per the Returns section.
5. Return the assembled markdown string.

## Returns

Literal output shape (substitute bracketed placeholders):

```markdown
> [!info]+ Weather - [city]
> Now: **[current]°[unit]** (feels [feels]°), [conditions]
> Today: High **[max]°** / Low **[min]°**
>
> | Day | Conditions | High | Low |
> |:--|:--|--:|--:|
> | [tomorrow YYYY-MM-DD] | [conditions] | [max]° | [min]° |
> | [day-after YYYY-MM-DD] | [conditions] | [max]° | [min]° |
```

## Errors

- **WebFetch failure / non-200 / malformed JSON:** return the following callout verbatim and exit successfully (orchestrator pastes as-is):
  ```markdown
  > [!warning]+ Weather unavailable
  > wttr.in fetch failed for [city]. Re-run later or check network.
  ```
- **Missing `city` input:** return:
  ```markdown
  > [!warning]+ Weather unavailable
  > No city configured. Set `city` in the cowork blueprint config.
  ```
- Never throw. Sub-skill must always return a string the orchestrator can paste.
