---
name: cowork:resolve-person
description: Resolve a name / handle / email / alias to a canonical [[Person]] wikilink by scanning spice/people/ frontmatter. Returns null on miss; NEVER throws.
inputs:
  input: string
  prefer_type: string
  engagement_id: string
outputs:
  resolved: boolean
  person_link: string | null
  person_basename: string | null
  matched_via: string | null
  collision_warning: string | null
  aliases_by_type: object
tags: [cowork, identity, helper]
---

# cowork:resolve-person

Resolves an identity hint to a canonical person note. Used by cowork gather skills before emitting wikilinks in atomic-note callouts, and by morning-briefing to translate `inner_circle_people` names into phone-alias filter lists for `gather-imessage`.

Operates over MCP — scans `spice/people/*.md` frontmatter and matches input against basename OR typed/bare-string aliases. NEVER throws.

## Inputs

- `input` (string, required): the name / handle / email / alias to resolve. Empty input returns the null-shape result.
- `prefer_type` (string, optional): one of `"phone" | "email" | "name" | "handle"`. When set, the resolver tries typed-alias match for the given type FIRST; on miss, falls back to general resolve. When absent, runs the full priority chain (basename exact → alias exact any type → basename CI → alias CI).
- `engagement_id` (string, optional): reserved for future per-engagement scoping (slice E may filter resolution to people mentioned in this engagement's atomic notes). NOT used in resolution this cycle; caller may pass it ahead of time so call sites need no re-edit at slice E.

## Outputs

- `resolved` (boolean): true iff a person matched.
- `person_link` (string | null): wikilink-format on hit (`"[[Stefan de Pagter]]"`), null on miss.
- `person_basename` (string | null): basename without wikilink syntax (`"Stefan de Pagter"`).
- `matched_via` (string | null): one of `"basename_exact" | "alias_exact:<type>" | "basename_ci" | "alias_ci:<type>" | null`.
- `collision_warning` (string | null): present when multiple matches; pipe-separated candidate basenames (`"Steve A | Steve B"`).
- `aliases_by_type` (object): `{ phone: string[], email: string[], name: string[], handle: string[] }` for the resolved person. Empty arrays on miss. Used by morning-briefing to extract phone aliases for inner-circle filtering.

## Steps

1. **Empty input guard.** If `input` is empty or whitespace-only, return the null shape: `{resolved: false, person_link: null, person_basename: null, matched_via: null, collision_warning: null, aliases_by_type: {phone: [], email: [], name: [], handle: []}}`.

2. **Enumerate person notes.** Call `mcp__obsidian__obsidian_list_files_in_dir` for `spice/people/` (path-prefix hardcoded per landmine #19). Filter to `.md` files; exclude `People.md`. If the call fails or the directory doesn't exist, emit stderr `cowork:resolve-person: people directory missing` and return the null shape.

3. **Read frontmatter per candidate.** For each candidate file, call `mcp__obsidian__obsidian_get_file_contents` (frontmatter-only mode where the MCP variant supports it; else full read) and parse the YAML frontmatter `aliases:` array. Normalize entries: a bare string `"Steve"` is treated as `{type: "name", value: "Steve"}`. Drop malformed entries silently.

4. **Match priority.** Walk candidates in folder-sort order (alphabetical by basename):
   - If `prefer_type` is set, first scan for `{type: prefer_type, value: input}` exact matches. If exactly one matches, that's the hit; matched_via = `alias_exact:<prefer_type>`. If multiple, first wins; populate `collision_warning`.
   - Otherwise / on prefer_type miss, apply the full priority chain:
     1. basename exact (`<input>` === `<basename>`)
     2. alias exact any type (`{type: <any>, value: <input>}`)
     3. basename case-insensitive
     4. alias case-insensitive any type
   - First match in folder-sort order wins per step. Populate `matched_via` accordingly.

5. **Populate aliases_by_type.** On hit, read the resolved person's normalized aliases and group by type: collect all `phone` values into `aliases_by_type.phone`, all `email` into `aliases_by_type.email`, all `name` into `aliases_by_type.name`, all `handle` into `aliases_by_type.handle`. Unknown types are dropped from the grouping (still readable via direct frontmatter inspection if needed).

6. **Compose output.** Build the output object per the Outputs section. On miss, return the null shape from Step 1.

7. **Return.** Never throws; on any unexpected MCP failure mid-walk, emit stderr `cowork:resolve-person: read failure on <path>` and return the null shape.

## Examples

**Basename hit:**

Input: `{input: "Stefan de Pagter"}`
Output:
```json
{
  "resolved": true,
  "person_link": "[[Stefan de Pagter]]",
  "person_basename": "Stefan de Pagter",
  "matched_via": "basename_exact",
  "collision_warning": null,
  "aliases_by_type": {
    "phone": ["+13035551212"],
    "email": ["stefan@example.com"],
    "name": ["Stefan de P."],
    "handle": []
  }
}
```

**Alias hit with phone prefer_type:**

Input: `{input: "+13035551212", prefer_type: "phone"}`
Output: same as above except `matched_via: "alias_exact:phone"`.

**Collision:**

Input: `{input: "Steve"}` (two people both have `aliases: [{type: "name", value: "Steve"}]`)
Output:
```json
{
  "resolved": true,
  "person_link": "[[Steve A]]",
  "person_basename": "Steve A",
  "matched_via": "alias_exact:name",
  "collision_warning": "Steve A | Steve B",
  "aliases_by_type": {"phone": [], "email": [], "name": ["Steve"], "handle": []}
}
```

**Miss:**

Input: `{input: "UnknownPersonNeverExists"}`
Output:
```json
{
  "resolved": false,
  "person_link": null,
  "person_basename": null,
  "matched_via": null,
  "collision_warning": null,
  "aliases_by_type": {"phone": [], "email": [], "name": [], "handle": []}
}
```

## Errors

- **`spice/people/` doesn't exist:** stderr `cowork:resolve-person: people directory missing`; returns the null shape.
- **MCP file read failure:** stderr `cowork:resolve-person: read failure on <path>`; returns the null shape.
- **Empty input:** returns the null shape (no stderr).
- NEVER throws.

## MCP routing

This skill uses Obsidian MCP for file enumeration + frontmatter reads:

1. `mcp__obsidian__obsidian_list_files_in_dir` — enumerate `spice/people/`.
2. `mcp__obsidian__obsidian_get_file_contents` — read each candidate's frontmatter.

If the Obsidian MCP is unavailable at runtime, the skill cannot resolve and returns the null shape. Callers should treat null-shape output as "no resolution available" and fall back to plaintext emission per the gather-skill's emission rule.
