---
description: Re-run sauce installer against current subscription
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.1.0 -->

# /install

Re-runs `sauce update` for the current vault against `ranch/platform-subscription.json`. Use this after:
- Pulling a workshop update (`cd ~/sauce && git pull`)
- Editing `ranch/platform-subscription.json` (subscription drift)
- Manually placing files under `.claude/commands.local/` or `.claude/skills.local/` (re-apply shadow shim)

The skill at `.claude/skills/platform/install/SKILL.md` shells out to `sauce update --vault $(pwd)` and renders the install ledger delta.

---

## Upgrading from v0.74.0 → v0.75.0

> **Note:** This section was backfilled at v0.75.1 — the v0.75.0 cycle only wrote to the dest, not this source template.

v0.75.0 ships a new `smart-connections-bridge` mechanism. Because `--bump-pins` does not auto-subscribe new mechanisms, you must opt in manually before the first update:

```bash
# 1. Patch workshop_path into every consumer vault's platform-installed.json
#    (v0.75.0 deploy found this was null everywhere; --bump-pins needs it)
BREW_PATH="/opt/homebrew/Cellar/sauce/0.75.0/libexec"
for vault in <list-of-vault-paths>; do
  f="$vault/ranch/platform-installed.json"
  jq --arg p "$BREW_PATH" '.workshop_path = $p' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# 2. Subscribe each vault to smart-connections-bridge@0.1.0
for vault in <list-of-vault-paths>; do
  f="$vault/ranch/platform-subscription.json"
  jq '.mechanisms += [{"name":"smart-connections-bridge","version":"0.1.0"}]' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# 3. Run bump-pins + reinstall per vault
cd <vault-path>
sauce update --bump-pins   # bumps pin floors from workshop manifest
sauce reinstall --vault .  # materializes updated subscription
```

After install, run `cowork:onboard-scheduled-jobs` (or the Layer 3 manual recipe) to update your scheduled-tasks-MCP entries with the v0.75.0 enriched prompts that instruct the cron-fired agent to READ sub-skill SKILL.md bodies.

**Known issue with `sauce update` in this release:** the standard `sauce update` flow (without `--bump-pins`) attempts a git fetch against the consumer vault, which fails with `fatal: not a git repository` (consumer vaults are not git repos). Workaround: use `sauce reinstall --vault <path>` after `--bump-pins`. Both issues are fixed in v0.75.1.

---

## Upgrading from v0.75.0 → v0.75.1

v0.75.1 fixes the two deploy pain-points documented above. The two manual jq-patches from the v0.75.0 recipe are **no longer needed**.

### What changed

- **`sauce update --bump-pins` auto-detects `workshop_path`** when the field is null in `ranch/platform-installed.json`. It walks the ancestry of `process.execPath` to find the brew-installed `libexec` directory. This means the step-5 `workshop_path` jq-patch is no longer needed.
- **`sauce update` is brew-aware** (Workstream B). The old git-fetch + reset path has been removed; `sauce update` now delegates directly to `bootstrap.phaseRunInstaller` — the same code-path `sauce reinstall` uses. No more `fatal: not a git repository` errors against consumer vaults.
- **`installed.workshop_version` is refreshed on every install.** The top-level `workshop_version` field in `ranch/platform-installed.json` now reflects the installed version (was always null in pre-v0.75.1 vaults). You can verify with: `jq -r .workshop_version ranch/platform-installed.json`.
- **sc-bridge `--quiet` actually suppresses non-fatal stderr.** The "skipping unparseable .ajson" warning is now suppressed when `--quiet` is passed (Workstream D).
- **93 emoji characters stripped from 15 engagement-template prompts** (Workstream G). Callout titles now rely on Obsidian's built-in SVG icons rather than emoji prefixes.
- **Morning-briefing semantic-warning misfire fixed** (Workstream H). A calendar-empty fire no longer surfaces a "Semantic index not available" warning; the warning is gated on step 12b having actually run.

### Upgrade procedure

```bash
# One-command update per vault (no jq-patches needed):
cd <vault-path>
sauce update --bump-pins
```

That's it. `--bump-pins` now resolves the workshop path automatically and the subsequent update is brew-aware.

**If auto-detection fails** (e.g., the workshop path is in an unusual location or you are running from the workshop repo itself), use the explicit override:

```bash
sauce update --bump-pins --workshop-path /opt/homebrew/Cellar/sauce/0.75.1/libexec
```

### Workshop self-install (workshop-as-vault)

The workshop's own `ranch/platform-installed.json` lacks a `workshop_path` field (it would be circular). Auto-detection looks for a `libexec` ancestor of `process.execPath` — but when running via `node platform/test/run-install.js .` directly (not via a brew-installed binary), there is no such ancestor. Workshop dogfood path remains:

```bash
node platform/test/run-install.js .
```

---

## Upgrading from v0.75.1 → v0.76.0

v0.76.0 closes residual deploy bugs from v0.75.1 AND ships the first half of cowork's interactive-context personalization.

### What changed

- **`sauce update --bump-pins` now works without `--workshop-path`** (was the workaround in v0.75.1). The `_resolveWorkshopPath` ancestry walk previously used `process.execPath` (the Node binary) which has no `libexec/platform` ancestor on real brew installs — the v0.75.1 test mock hid the bug. v0.76.0 anchors the walk on `__filename` (cmd-update.js's own source path), which resolves to the workshop libexec on every brew install.
- **Stale `installed.workshop_path` values are auto-invalidated.** When `brew cleanup` removes an old keg between sauce-tap releases, the persisted `workshop_path` in `ranch/platform-installed.json` becomes a dead path. v0.76.0 probes for `platform/manifest.json` at the candidate; if absent, falls through to ancestry walk.
- **eod-review + weekly-review semantic-warning parity with morning-briefing.** Both orchestrators now gate the "Smart Connections index absent" callout on the corresponding semantic gather step having actually run, and emit the canonical text verbatim from `gather-semantic-related`'s contract. Matches morning-briefing's v0.75.1 H fix.
- **eod/weekly/monthly engagement-template prompt fallback.** When `spice/cowork/prompts/<orch>.md` is empty, the Write step now reads `spice/cowork/context/engagement-templates/<engagement.type>/prompts/<orch>.md` as a fallback before stub-firing. `prompt_source` frontmatter records which source drove the run.
- **NEW user-owned file at `spice/cowork/context/user-preferences.md`** — protected by `materialize_once: true` (re-uses the v0.59.9 manifest flag). Seeded at install time; preserved across all subsequent `sauce update` / `sauce reinstall`.
- **NEW `cowork:context-builder` orchestrator-tier skill** — 14 hand-curated questions across 4 MCP-kinds (calendar, gmail, imessage, finance) + cross-cutting priorities + personality. Writes `user-preferences.md`. Invokable directly via Claude Code skill invocation, OR auto-delegated by `cowork:onboard-scheduled-jobs` when user-preferences is absent or seed-stamped.
- **NEW boundary contract at `Docs/agent-guides/cowork-customization-contract.md`** — enumerates STOCK files (overwritten on every install) vs USER files (preserved across install) vs USER-DRAFTABLE-WITH-BACKUP files (in `files[]` without `materialize_once`; `.bak`'d-then-overwritten via v0.2.0 Option B). The 5 cowork prompts currently fall in the third category.

### Upgrade procedure

```bash
# One-command update per vault — no overrides needed:
cd <vault-path>
sauce update --bump-pins
```

That's it. The two v0.75.1 deploy bugs are fixed; auto-detection now works reliably.

After the install, the next `cowork:onboard-scheduled-jobs` invocation will auto-delegate to `cowork:context-builder` for the 14-question interview (or prompt for an update if user-preferences was previously captured). The composed file lives at `spice/cowork/context/user-preferences.md` and is preserved across all future `sauce update`s.

**If you want to run the interview standalone** (without going through onboard-scheduled-jobs):

```
# In Claude Code, invoke:
Use Skill cowork:context-builder
```

### Carry-forward

The 5 atomic-note-emitting cowork orchestrators (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) do NOT yet consume `user-preferences.md` in v0.76.0 — that consumption layer is v0.77.0. v0.76.0 stabilizes the file schema; v0.77.0 wires the orchestrators to apply priorities + personality from the file.

---

## Upgrading from v0.76.0 to v0.77.0

`cowork:context-builder` now detects MCPs by tool-pattern signatures
instead of namespace regex. An MCP exposing `list_events` + `create_event`
is recognized as `calendar` regardless of its namespace — including UUID-
namespaced enterprise gateways like Outlook M365.

The v1.0.0 schema's `mcps.gmail` and `mcps.imessage` keys are renamed to
`mcps.email` and `mcps.chat` lockstep. Existing user-preferences.md files
migrate automatically on the next `cowork:context-builder` invocation
(the helper applies rename hints from the v2 schema).

For MCPs that don't match any known capability pattern (ADO, Backstage,
NewRelic, etc.), the skill now surfaces them with their tool list and
asks for classification — either route to a known kind's question set,
or define a custom kind inline with a free-text "what matters" note.

Per-vault upgrade: `sauce update --bump-pins`. No flags needed — A+B
fixes from v0.76.0 still cover the brew-installed workshop detection.

---

## Upgrading from v0.77.0 → v0.78.0

Atomic-note orchestrators (morning-briefing / midday-tripwire / eod-review / weekly-review / monthly-review) now consume `spice/cowork/context/user-preferences.md` captured by v0.76.0+v0.77.0's context-builder. If you haven't run `/cowork preferences` yet, all 5 orchestrators fall back to v0.77.0 behavior — no change. If you HAVE captured preferences:

- Priority-ordered `[!example]+` callouts per `priorities[]` (first = highest priority, last = lowest).
- Voice-contract prefix composed from `personality:` (vibe / formality / pep_talk / length / notes) shapes narrative sections (synopsis, tip) — tabular callouts are unaffected.
- `override_classified: true` kinds (e.g., calendar served by M365 UUID) and `custom_kind: true` kinds (e.g., ado / github) gather via the new `cowork:gather-from-served-by` sub-skill, which dispatches the agent inline against whatever tools the served_by namespace exposes.
- In-position `[!warning]` callouts replace example blocks for kinds that are unclassified, disconnected at capture time, or unreachable at fire time.

No new manual steps. Run `sauce update`; the orchestrators read prefs automatically on the next scheduled fire.

---

## Upgrading from v0.78.0 → v0.78.1

SKILL.md prose-only patch. No new files, no schema changes. Two fixes:

1. **Agent-side algorithm primary in `read-user-preferences` + 5 orchestrator step 3c blocks.** v0.78.0 told the agent to "delegate to a helper at `.local/blueprints/cowork/helpers/...`", which never exists in consumer vaults; agents treated helper-missing as a hard failure and fell back to legacy mode. v0.78.1 inverts the contract: the agent-side algorithm is now the primary documented behavior; the helper-mention moves to a `## Harness testing` section that explicitly notes the helper is NOT materialized in consumer vaults.

2. **Source URL contract in `gather-from-served-by`.** New `## Source URL requirements` section. MUST: github / ado / email. SHOULD: calendar / chat / finance / custom kinds. Includes per-kind URL-shape examples + a fallback note for genuinely-no-URL runs.

No manual steps. Run `sauce update --bump-pins`; the orchestrators read the updated SKILL.md on the next scheduled fire.

---

## Upgrading from v0.78.1 → v0.79.0

Three additive workstreams; no breaking changes. After `sauce update --bump-pins`:

1. **`/cowork microscope <kind>` — per-kind deep gather contracts (WS-A).** New interactive orchestrator `cowork:edit-microscope`. Run `/cowork microscope <kind>` (e.g., `/cowork microscope finance`) to author or deepen a USER-OWNED contract at `spice/cowork/prompts/per-mcp/<kind>/microscope.md`. The skill enumerates the kind's `served_by` MCP tools, consent-gated samples your real data, surfaces gaps with resolution paths (resolvable-in-gather / mcp-ceiling / user-supplied), and composes the contract. When a microscope exists for a prioritized kind, the 5 atomic-note orchestrators (morning-briefing / midday-tripwire / eod-review / weekly-review / monthly-review) route that kind through `gather-from-served-by` with the microscope body as the deep `what_matters` (the kind's prior `notes` carry as `baseline_notes`). The microscope file is NOT in cowork's `files[]` — `update`/`reinstall` never overwrite it (preservation by construction). Re-run anytime to go deeper; the helper preserves prior content and appends a refinement block.

2. **`personality.hard_rules[]` + `personality.no_emojis` (WS-B).** Two new fields in `spice/cowork/context/user-preferences.md`'s `personality` block:
   - `no_emojis: true` — convenience boolean that appends a canonical no-emoji rule to the effective rule list.
   - `hard_rules: [<string>, ...]` — arbitrary verbatim do-not-interpret rules (e.g., `- 'never use the word leverage'`).

   `read-user-preferences` composes these into one ordered `effective_hard_rules[]` that the orchestrators propagate to ALL three output layers: the voice-contract prefix gets a `Hard rules (non-negotiable, …)` block; `gather-from-served-by` receives `hard_rules[]` as a dispatch input that binds callout TITLE + BODY; the `write-run-note` skeleton enforces them in `[!example]+` / `[!info]` / `[!tip]` titles and bodies. Canonical `[!warning]` strings are exempt. No manual edit step — add the fields when ready.

3. **Per-type callout colors (WS-C, styling 0.1.2 → 0.2.0).** Ships a new vendored CSS snippet `sauce-callouts.css` at `.obsidian/snippets/` defining per-type `--callout-color` for info / note / tip / success / warning / caution / example / quote / danger across light (rose-pine-light) and dark (melange-dark) schemes. Registered automatically in `.obsidian/appearance.json`'s `enabledCssSnippets[]` by the installer. After upgrade, open any note with multiple callout types (`> [!info]` / `> [!warning]` / `> [!tip]` / `> [!example]`) and confirm four distinct hues. If callouts still look monochrome, the Baseline theme's Monochrome Style-Setting may be overriding the snippet — open Style Settings → Baseline → toggle the relevant callout keys to non-monochrome values.

No new manual steps. Run `sauce update --bump-pins`; the orchestrators read the updated SKILL.md and any present microscopes on the next scheduled fire.

---

## Upgrading from v0.79.0 → v0.80.0

Per-kind sibling-file convention closes the v0.79.0 `user-supplied` resolution path. Pure-additive cowork cycle; no breaking changes. After `sauce update --bump-pins`:

1. **Sibling files.** Any markdown file you place in `spice/cowork/prompts/per-mcp/<kind>/` (e.g. `contacts-map.md`, `vip-list.md`, `account-aliases.md`) — except `microscope.md` itself and any file starting with `_` — is auto-discovered by the 5 atomic-note orchestrators on their next scheduled run and injected verbatim into `cowork:gather-from-served-by`'s dispatch contract under `**User-supplied reference: <filename>**`. The gather agent reads each as additional context and applies it per `microscope.md`'s narrative guidance (so reference your siblings explicitly there: "Use `contacts-map.md` to resolve sender phone numbers to display names before composing the callout"). Same preservation posture as `microscope.md` — NOT in cowork's `files[]`, never touched by `update`/`reinstall`.

2. **`/cowork microscope <kind>` user-supplied gap path.** When `cowork:edit-microscope`'s gap-finding step classifies a gap as `user-supplied`, the skill now offers to scaffold a starter sibling file inline. Heuristic column selection from the gap text: phone/number → `contacts-map.md` (`| phone | name |`); email → `senders-map.md` (`| email | name |`); account/id → `account-aliases.md` (`| id | nickname |`); vip/priority → `vip-list.md` (`| id | reason |`); else `<gap-slug>.md` (`| key | value |`). You confirm or override the filename, the skill writes the starter template, and a one-line reference paragraph is added to `microscope.md`'s `## References` section. You fill in the entries by hand afterward.

3. **Underscore-prefix escape.** Need to keep a sibling file around but NOT inject it (drafts, archives, work-in-progress)? Rename to `_<name>.md`. The orchestrator's step 2c glob excludes `^_.*\.md$`.

No new manual steps. Run `sauce update --bump-pins`; orchestrators discover siblings automatically on the next scheduled fire.

---

## Upgrading from v0.80.1 → v0.81.0

New read-only audit skill `cowork:audit-siblings`. Pure-additive cowork cycle; no breaking changes. After `sauce update --bump-pins`:

1. **Run `/cowork audit-siblings`** (or `/cowork audit-siblings <kind>` for a single kind) to verify consistency between `microscope.md`'s `## References` section and the actual sibling files in `spice/cowork/prompts/per-mcp/<kind>/`. The skill is purely read-only — no writes, no MCP gather calls. Findings emit as `[!warning]` (dangling references) or `[!info]` (orphan files); clean state emits `[!success]`.

2. **When to use it:** after any `/cowork microscope <kind>` round, especially after the user-supplied gap path scaffolds new siblings. The audit catches dangling references (sibling deleted/renamed; reference left behind) and orphan files (sibling added by hand; not yet recorded in `## References`).

3. **Em-dash requirement:** the audit parser requires em-dash (`—`, U+2014) between `**<name>**` and the role description in `## References` bullets, matching what `composeMicroscope` emits. If you hand-edit a bullet with a hyphen or en-dash, the audit silently flags the sibling as an orphan. Use em-dash to keep audit-siblings honest.

4. **No manual setup steps.** The skill materializes into `.claude/skills/cowork/audit-siblings/SKILL.md` automatically on install.
