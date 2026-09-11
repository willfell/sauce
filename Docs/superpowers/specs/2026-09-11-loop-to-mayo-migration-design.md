# Loop → Mayo: returning the delivery plugin to sauce

**Status:** design, awaiting approval
**Date:** 2026-09-11
**Reverses:** `f2816c2d` — *chore: retire the sauce plugin marketplace - loop moved to willfell/wac.plugins (#809)*

## Summary

The `loop` plugin moves from `willfell/wac.plugins` back into `willfell/sauce`, and is
renamed `mayo`. The `brainstorm` skill is renamed `propose` to resolve a live collision
with Superpowers' `brainstorming`. The `.loop/` config directory name does **not** change.

## Why now

Three things make this more than a preference.

**1. The Codex surface is dead in every bound repo.** All four bound repos set
`codex.plugin_root` to `/opt/homebrew/opt/sauce/libexec/plugins/loop`. That path does not
exist — the formula is `libexec.install Dir["*"]` (`homebrew-sauce/Formula/sauce.rb:13`)
and sauce has had no `plugins/` since `f2816c2d`. The 42 generated routers across 5 repos
instruct Codex to read `<codex.plugin_root>/skills/<name>/SKILL.md`, which resolves to
nothing. Restoring `plugins/` to sauce makes the default real again with **zero formula
changes**.

**2. Two duplicate resolvers with no parity check.** `scripts/autoloop/loop-config.js` and
`wac.plugins:plugins/loop/scripts/loop-config.js` are byte-identical today (verified by
diff at both `main` and both PR branch heads) and nothing enforces that. `f2816c2d`'s own
commit message describes them as "kept in sync by hand".

**3. `f2816c2d` left dangling references.** `package.json` declares `test:loop-plugin-surface`,
`test:loop-codex-routers`, and `test:slice-plan`; all three harness files were deleted by
that commit. `Docs/agent-guides/loop-plugin.md:112` still advertises two of them as part of
`release:preflight`. Restoring the plugin restores the harnesses those scripts point at.

## Naming

| Surface | Before | After |
| --- | --- | --- |
| Marketplace | `wac-plugins` | `sauce` |
| Plugin | `loop` | `mayo` |
| `enabledPlugins` key | `loop@wac-plugins` | `mayo@sauce` |
| Slash prefix | `/loop:*` | `/mayo:*` |
| Codex routers | `.agents/skills/loop-*` | `.agents/skills/mayo-*` |
| Plugin dir | `plugins/loop/` | `plugins/mayo/` |
| Colliding skill | `brainstorm` | `propose` |
| **Config directory** | `.loop/config.json` | **unchanged** |
| **Env vars** | `SAUCE_LOOP_*`, `DELIVERY_*` | **unchanged** |

`.loop/` stays because the plugin name and the config directory are independent knobs —
nothing derives one from the other. Keeping it removes the only breaking surface, so no
migration and no fallback-read logic is needed for the four bound repos.

`sauce` was rejected as a plugin name: the marketplace is also `sauce` (yielding
`sauce@sauce`), and `/sauce:run` would sit beside the existing `sauce` brew CLI.

### Rename churn (measured)

| Location | `/loop:` refs |
| --- | --- |
| sauce | 92 in 26 files |
| egnyte-mcp | 61 |
| finance | 16 |
| ero-copilot-iac | 14 |
| travel | 12 |
| wac.plugins | 39 (deleted by PR 5) |
| vaults (`ero-sauce`, `headspace-sauce`) | 38 files |

`codex.plugin_root` in the four bound repos carries **zero marginal cost** — those values
are wrong today and must be edited regardless of the plugin's name.

## Invariants

These are the two places this migration silently breaks. Each gets a test, not a comment.

### INV-1 — the generator must keep emitting `.loop/config.json`

`gen-codex-routers.js` hardcodes `loop` in both the router prefix and the emitted body
prose, and the change-me and keep-me occurrences **share lines**:

| Line | Occurrence | Action |
| --- | --- | --- |
| 24 | `ROUTER_PREFIX = 'loop-'` | change → `'mayo-'` |
| 69 | `"the sauce loop plugin"`, `"/loop:init"` | change |
| 71 | `"canonical loop skill bodies"` | change |
| 71 | `` `.loop/config.json` `` | **keep** |
| 73 | `` `.loop/config.json` `` | **keep** |
| 116 | `path.join(repoRoot, '.loop', 'config.json')` | **keep** |
| 117 | `"run /loop:init first"` | change |
| 117 | `no .loop/config.json at ...` | **keep** |

A blind `s/loop/mayo/` repoints the binding contract at `.mayo/config.json` — reproducing
the exact dead-path failure this migration exists to fix, in the file that generates it
into five repos.

**Test:** assert a generated router body contains the literal `.loop/config.json` and does
not contain `.mayo/config.json`.

### INV-2 — the resolver has one home

`scripts/autoloop/loop-config.js` remains the single real file. `plugins/mayo/scripts/loop-config.js`
becomes a one-line re-export. Four call sites pin the `scripts/autoloop/` path
(`board-health-launchd.js:37`, `platform/test/run-loop-config.js:16`, `package.json`,
`platform/test/preflight-manifest.json`) and only the plugin pins the other; moving the file
into the plugin would ship the coordinator's runtime dependency inside a plugin directory.

**Test:** assert both paths `require()` to the same module object.

## Defect fixed in passing: `check` never validates `plugin_root`

`checkBinding` validates `vault_root`, `board_path_abs` + the `## In Planning` heading, and
`cards_root_abs`. `plugin_root` never appears. A binding can point Codex at a nonexistent
directory and `check` returns `ok` — which is why the dead path survived `f2816c2d`.

```js
if (c.plugin_root && !fs.existsSync(c.plugin_root)) {
  refusals.push(refusal('plugin_root_missing', `codex.plugin_root does not exist: ${c.plugin_root}`));
}
```

In `check`, not `resolve` — a missing Codex surface should not hard-refuse a Claude-only
user mid-run. Guarded on the key being set so deliberately Codex-less bindings stay clean.

This is the third instance of one failure family in this resolver: a structurally valid,
silently wrong config value reported as healthy. The other two are unmatchable gate globs
and a missing `test_command` (both fixed by sauce#845). The resolver validates the vault
side thoroughly and the execution side not at all.

## Sequencing

Five PRs, each independently green, in dependency order.

**PR 1 — sauce: merge #845 as-is.** Gate-glob guard + 3 tests + doc. Already CI-green.
Establishes the merge base.

**PR 2 — sauce: restore `plugins/mayo/`.** Reverse `f2816c2d`'s deletions, taking skill
bodies from wac.plugins branch `fix/gate-glob-guardrails` (**not** its `main`) so
`skills/init/SKILL.md` arrives carrying the gate section as item 6 with 7/8/9 already
renumbered. Restore `.claude-plugin/marketplace.json` as marketplace `sauce`. Rename
`brainstorm` → `propose`. Apply INV-1 to the generator by hand, per occurrence.

**PR 3 — sauce: collapse the twins and restore the harnesses.** Apply INV-2. Restore
`run-loop-plugin-surface.js`, `run-loop-codex-routers.js`, `run-slice-plan.js` and the
`validateSkillSurface()` case in `run-card-intake.js`, plus their `preflight-manifest.json`
entries and `schemas-index.json` entries (`loop-plugin-binding-config`, the
`autoloop-card-lease` consumers). Add the `plugin_root_missing` check and its test. Fix the
stale harness list in `Docs/agent-guides/loop-plugin.md`.

**PR 4 — bound repos.** For each of travel, finance, egnyte-mcp, ero-copilot-iac: repoint
`codex.plugin_root` to `…/libexec/plugins/mayo`, regenerate routers, delete the stale
`.agents/skills/loop-*` directories (the generator does not reap them), update `/loop:` refs.

**PR 5 — wac.plugins.** Delete `plugins/loop/`, drop it from `marketplace.json`, update
`CLAUDE.md`'s three-plugin description, and remove the `claude plugin validate plugins/loop`
CI step.

wac.plugins#17 stays merged there per the owner's ruling; PR 5 removes it, and its content
is preserved by PR 2.

## Verification

- `node scripts/run-preflight.js` green at each of PRs 1–3. Baseline is 175/175 per `f2816c2d`.
- At PR 4, `loop-config.js check --json` in each bound repo returns `ok` with a
  `plugin_root` that exists — the `plugin_root_missing` refusal from PR 3 is what proves the
  Codex surface actually came back rather than merely being repointed.
- `/plugin marketplace` lists `mayo@sauce`; `/mayo:status` resolves against a bound board.

## Out of scope

- Renaming `.loop/`, any key inside `config.json`, or any `SAUCE_LOOP_*` / `DELIVERY_*` env var.
- `gate.js` matching semantics. It is the matcher under test and is deliberately unchanged.
- Vault card prose (38 files). User-visible text, done last and separately.
