# people-identity

Identity resolver for `spice/people/` notes. Given a name, handle, email, or alias, returns the canonical wikilink for the matching person note. Lives as a customJS class loaded via `customjs-guard`; consumed by Obsidian-side renderers / validators / hub views. The cowork agent-side equivalent is the `cowork:resolve-person` sub-skill (mirrors the same semantic over MCP).

## Public API

```js
resolvePerson(input)              // → "[[Basename]]" | null
findByAlias(type, value)          // → "[[Basename]]" | null
getAliases(personLink)            // → [{type, value}, ...]
listAliasesOfType(type)           // → [{personLink, value}, ...]
```

Loaded via `customJS.PeopleIdentity`. Three closure args visible in scope per the customjs-guard loader contract: `app`, `customJS`, `Notice`.

## Alias schema

Each person note's frontmatter `aliases:` field accepts entries in two shapes:

**Typed object** (canonical, post-people@0.6.0):

```yaml
aliases:
  - {type: phone, value: "+13035551212"}
  - {type: email, value: "stefan@example.com"}
  - {type: name,  value: "Stefan de P."}
```

**Bare string** (back-compat, pre-people@0.6.0):

```yaml
aliases:
  - "Stefan de P."
```

Bare strings are normalized at read time to `{type: "name", value: <string>}`.

Recommended types: `phone`, `email`, `name`, `handle`. Other types are accepted but won't surface in `listAliasesOfType` for non-listed types unless explicitly queried.

## Resolution priority

`resolvePerson(input)` matches in this order:

1. Basename exact (`spice/people/<input>.md`)
2. Typed-alias exact match across all person notes (any type)
3. Basename case-insensitive
4. Alias case-insensitive

First match in folder-sort order wins. Collisions emit `console.warn("people-identity: alias collision for '<input>' → [<p1>, <p2>]")` and return the first match deterministically.

## Failure modes

- Input empty / not a string → returns `null`.
- `spice/people/` doesn't exist → returns `null`.
- File read failure → returns `null`.

NEVER throws.

## Module-directory invariant

Per landmine #19 + #11: `spice/people/` is hardcoded. Never parameterize this prefix; consumer vaults are expected to honor the platform's module-directory convention.

## Used by

This cycle (v0.89.0): no in-Obsidian callers. Forward-looking only.

Future cycles (slice E and beyond):
- Brain-map rollups on person notes call `getAliases` + `listAliasesOfType("phone")`.
- Hub views call `findByAlias("email", x)` for "who is this sender?" lookups.
- Validator audit calls `listAliasesOfType` to detect cross-person alias collisions.

The cowork agent-side `cowork:resolve-person` sub-skill is the load-bearing consumer of the alias schema this cycle.
