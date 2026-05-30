# The cowork cohort (v0.79.0 + v0.80.0) — summary, headspace onboarding, what's next

**Audience:** the next Claude Code chat (or any human reader) who needs to pick up exactly where this conversation left off, with zero context gaps. Self-contained on purpose.

**Date:** 2026-05-30.
**Workshop:** `0.80.0` (closed today). **Sauce CLI:** `0.80.0` (Homebrew tap PR #101 merged + `brew upgrade sauce` completed). **Consumer vaults:** all 4 at `0.80.0` / cowork `0.19.0` (`barebones`, `accuris-sauce`, `ero-sauce`, `headspace-sauce`).

---

## 1. The cohort thesis — why v0.79.0 + v0.80.0 belong together

v0.78.x shipped the cowork preferences model (`spice/cowork/context/user-preferences.md`) + 5 atomic-note orchestrators (`morning-briefing` / `midday-tripwire` / `eod-review` / `weekly-review` / `monthly-review`). The 2026-05-29 morning-briefing on the headspace vault then surfaced four gaps that all pointed at the same root cause: **the per-MCP `notes:` block is too shallow a contract** to drive a deep, grounded briefing.

The cohort closes that loop in two cycles:

| Cycle | Date | Adds | Sub-deliverable surface |
|---|---|---|---|
| **v0.79.0** cowork-microscope | 2026-05-29 | The deep gather **CONTRACT** — per-kind `microscope.md`; hard_rules + no_emojis propagation; sauce-callouts.css per-type colors | WS-A, WS-B, WS-C, WS-D doc-only |
| **v0.80.0** cowork-sibling-files | 2026-05-30 | The deep gather **DATA** — per-kind sibling files (`contacts-map.md`, `vip-list.md`, etc.) the gather injects under `**User-supplied reference: <name>**` | Sub A (convention) + B (discovery + injection) + C (authoring) |

The mental model the user (Will) actually uses:

- **`/cowork preferences`** — set up the kind (`served_by`, priorities, basic `notes:`).
- **`/cowork microscope <kind>`** — deepen the kind's gather contract via an MCP-tool-aware iterative capture loop. The skill classifies each surfaced gap as `resolvable-in-gather` (call an extra tool), `mcp-ceiling` (swap the MCP), or `user-supplied` (scaffold a sibling file inline — new in v0.80.0).
- **The 5 orchestrators** automatically discover everything on their next scheduled run: microscope (step 2b) + siblings (step 2c). No manual rewiring per kind.

The capture loop (`cowork:edit-microscope`) is the load-bearing UX. Everything else is plumbing that lets the loop's output drive the briefings.

---

## 2. What's there (v0.79.0 deep-dive)

### WS-A — Microscope (per-kind deep gather contracts)

- File: `spice/cowork/prompts/per-mcp/<kind>/microscope.md` — USER-owned, NOT in cowork's `files[]`, never overwritten.
- Authored via `cowork:edit-microscope` (`/cowork microscope <kind>`).
- Helper exports (pure): `resolveKind`, `classifyGap`, `composeMicroscope` at `platform/blueprints/cowork/helpers/edit-microscope-helper.js`.
- When present, the 5 orchestrators force-route that kind through `cowork:gather-from-served-by` with the microscope body as the deep `what_matters` and the prior `notes:` as `baseline_notes`.
- Trade-off: microscope-routed kinds give up the canonical-vendor skill's polished tables in exchange for a deep custom contract. Hybrid path (microscope + canonical) is design §8 carry-forward.

### WS-B — Hard rules + no_emojis

- New `personality.hard_rules: [<string>, ...]` + `personality.no_emojis: true` fields in `user-preferences.md`.
- Composed into one ordered `effective_hard_rules[]` (hard_rules + canonical no-emoji rule when `no_emojis` is true) by `cowork:read-user-preferences`.
- Propagates to **all three output layers**:
  1. Voice contract prefix (`composeVoiceContract`) — appends a `Hard rules (non-negotiable, …)` block.
  2. `cowork:gather-from-served-by` dispatch — new `hard_rules[]` input + `## Hard rules` SKILL section binding callout TITLE + BODY (this is the LOAD-BEARING fix for emoji leaks in served-by-routed kinds — the dominant emoji surface in 2026-05-29).
  3. `write-run-note-*` skeleton (all 5) — adaptive-skeleton paragraph binding hard rules to `[!example]+` / `[!info]` / `[!tip]` titles + bodies. Canonical `[!warning]` strings EXEMPT.
- Helper: `composeEffectiveHardRules` + `CANONICAL_NO_EMOJI_RULE` at `platform/blueprints/cowork/helpers/read-user-preferences-helper.js`.

### WS-C — Per-type callout colors (styling 0.1.2 → 0.2.0)

- New vendored snippet `platform/mechanisms/styling/assets/snippets/sauce-callouts.css`.
- Per-type `--callout-color` for `info` / `note` / `tip` / `success` / `warning` / `caution` / `example` / `quote` / `danger` across light (rose-pine-light hues) + dark (melange-dark hues).
- Wired via existing `applySnippets` helper (manifest `snippets[]` entry) + `appearance.enabledCssSnippets`.
- Materialized as `.obsidian/snippets/sauce-callouts.css` on install.
- **OPEN: FLN-v79-1 — VISUAL verification still owed by the user.** Snippet + appearance registration verified ON DISK; only the user's eye confirms the rendered callouts now show distinct colors. If still monochrome: open Style Settings → Baseline theme → toggle the relevant callout keys to non-monochrome values in `platform/mechanisms/styling/data/style-settings-default.json`.

### WS-D — MCP-depth audit (doc-only)

- **iMessage**: number→name gap is `resolvable-in-gather` via `search_contacts` (encoded as a `classifyGap` heuristic). No MCP swap needed.
- **WhatsApp**: privacy-capped MCP is `mcp-ceiling`. `edit-microscope` surfaces the gap live and names `lharries/whatsapp-mcp` (whatsmeow-backed local SQLite bridge, message-level depth) as the user-side swap candidate.

---

## 3. What's there (v0.80.0 deep-dive)

### Sub A — Sibling-file convention

- File: `spice/cowork/prompts/per-mcp/<kind>/<name>.md` — any markdown file in the per-kind dir EXCEPT `microscope.md` itself and any file matching `^_.*\.md$`.
- USER-owned, NOT in cowork's `files[]`, never overwritten by `sauce update`/`reinstall` (preservation by construction — same posture as `microscope.md`).
- **Underscore-prefix escape**: `_<name>.md` files are NEVER injected (reserved for drafts / archives / WIP).
- No filename schema: `contacts-map.md`, `vip-list.md`, `account-aliases.md`, `project-codes.md`, etc. Convention recommends `kebab-case-purpose.md` but the consumed surface is opaque markdown.

### Sub B — Discovery + injection

- **Orchestrator step 2c** added to all 5 atomic-note orchestrators immediately after step 2b (microscope read). For each `kind_name` in `prefs.priorities`: list `spice/cowork/prompts/per-mcp/<kind_name>/` via `mcp__obsidian__list_files_in_dir`, filter to files matching the `per-mcp/<kind_name>/*.md` glob, exclude `microscope.md` + `^_.*\.md$`, read each remaining file's body, strip leading frontmatter, append `{ name, body }` to `siblings[kind_name]`. Pure step: no MCP gather calls, no writes.
- **Gather-loop wiring**: each kind's `gather_from_served_by` input now includes `siblings: siblings[entry.kind_name] || []` directly after the v0.79.0 `hard_rules: prefs.effective_hard_rules` line.
- **`cowork:gather-from-served-by` contract**: new `siblings: list[{name, body}]` input frontmatter; new `## User-supplied reference` SKILL.md section instructing the agent to inject each sibling verbatim into the dispatch contract Step 3 under `**User-supplied reference: <name>**` blocks (AFTER `<what_matters verbatim>` + optional `**Captured answers**`, BEFORE `**Hard rules ...**`). Helper destructures `siblings` from input and echoes injected filenames back as `siblings_used: list[string]` (mirrors `hard_rules_applied`).

### Sub C — Authoring extension to `cowork:edit-microscope`

- **New helper export `composeSibling({ kind_name, gap, suggested_name })`** → `{ name, body, status }`. Pure, deterministic, harness-testable. Renders a starter sibling template with a heading + USER-OWNED preamble + an empty markdown table whose columns are inferred from the gap text via `COLUMN_HEURISTICS` (in order):
  - `/vip|priority/` → `(id, reason)`
  - `/phone|number/` → `(phone, name)`
  - `/email/` → `(email, name)`
  - `/account|\bid\b|alias/` → `(id, nickname)`
  - else → `(key, value)`
  Order matters: `vip|priority` first so "vip priority phone numbers" classifies as `(id, reason)`.
- **`composeMicroscope` extension**: accepts new optional `siblings_to_reference: [{name, role}]` arg; emits `## References` (seed-from-notes branch) / `## References (added)` (deepen-pass branch) each rendered as `- **<name>** — <role>`.
- **`edit-microscope/SKILL.md` step 4 user-supplied bullet** expanded into a 6-substep sub-flow: (1) compute suggested filename from gap text; (2) preview starter via `composeSibling`; (3) on YES pre-check existence via `mcp__obsidian__get_file_contents` (scaffold via `Write` if absent, skip-but-record if present); (4) on NO skip; (5) refuse `^_.*\.md$` and `microscope.md` filenames; (6) pass `siblings_to_reference` into `composeMicroscope` at step 6.

---

## 4. What's NOT there (carry-forward for v0.81+)

### From v0.79.0 design §11 (microscope vertical-slice extensions)

1. ~~`contacts-map.md` sibling-file convention~~ — **CLOSED in v0.80.0**.
2. **WhatsApp MCP-swap follow-through** — once user adopts `lharries/whatsapp-mcp`, capture a deep WhatsApp microscope. Likely paired with chat microscope authoring.
3. **`samples/` sibling dir** — cached example outputs per kind (`per-mcp/<kind>/samples/<timestamp>.md`) so `edit-microscope` can show "last time it looked like this" on re-runs.
4. **Per-kind microscope versioning / changelog** — diff view across re-runs.
5. **Hard-rule post-processor** — mechanical emoji-strip / word-budget pass when prompt-level `hard_rules` prove insufficient. Belt-and-suspenders for v0.79.0.
6. **Expanded known-kinds catalog** — drive / code-platform / project-tracker / monitoring (4 strong candidates).
7. **Cross-vault `inherits_from`** for microscope contracts — shared deep contracts across multiple vaults.
8. **Canonical-gather × microscope hybrid** — currently a microscope forces served-by routing; allow canonical skill's polished tables PLUS a microscope.

### From v0.80.0 design §11 (sibling-file extensions)

9. **Interactive editing of EXISTING sibling content** — v0.80.0 scaffolds new siblings only; existing ones the user hand-edits the markdown table.
10. **Dedicated `/cowork sibling <kind> <name>` skill** — separate slash command, decoupled from edit-microscope.
11. **Typed sibling parsers + deterministic pre-agent substitution** — vs. v0.80's opaque-injection model. Most-likely first carry-forward if compliance drift surfaces in practice.
12. **Sibling-application post-processor** — mechanical verification that every phone number in a chat callout maps to a `contacts-map.md` entry. Overlaps with §5.
13. **Sibling-file versioning / changelog** — `_*.md` escape is the closest thing today.
14. **Multiple-microscope-per-kind** — cadence-specific (`microscope-morning.md` / `microscope-eod.md`).
15. **Soft-limit warning for very large sibling files** — >50KB injected whole today.
16. **Sibling-file-aware reverse audit** — verify `## References` entries point to extant files; warn on dangling.

### Cycle-specific FLNs surfaced during execution

| FLN | Source | What | Action |
|---|---|---|---|
| **FLN-v79-1** ⚠️ urgent | v0.79.0 | VISUAL verification of sauce-callouts.css still owed by user. Snippet + appearance registration verified on disk; only the user's eye can confirm distinct rendered colors. | Open any note with `> [!info]` `> [!warning]` `> [!tip]` `> [!example]` callouts in Obsidian; confirm distinct hues. If monochrome, toggle Style Settings → Baseline → callout keys. |
| **FLN-v79-2** | v0.79.0 | `node platform/install.js --vault . --auto-approve` silently no-ops (no CLI handler); correct invocation is `node platform/test/run-install.js . --auto-approve`. | Either add CLI arg parsing to install.js or sweep the docs (CLAUDE.md, build-test-verify.md, plan templates). |
| **FLN-v79-3** | v0.79.0 | gather-from-served-by 80-char `agent_markdown` floor trips plausible test fixtures. | Document the floor in the plan-template HC skeleton or lower it. |
| **FLN-v79-4** | v0.79.0 | Orchestrator-vs-sub-skill dest convention not codified (orchestrators flatten to `{{skills_dir}}/<name>/SKILL.md`; sub-skills nest). | Add one-line note to `Docs/agent-guides/architecture.md` or the plan-writing skill. |
| **FLN-v79-5** | v0.79.0 | CS-MIG-1 hardcoded counts need lockstep bumps when cowork claude_surface[] grows. v0.80.0 added none → counts unchanged. | Auto-derive from manifest or codify in plan template. |
| **FLN-v79-6** | v0.79.0 | `classifyGap` RESOLVING_TOOL_SIGNALS + CONTENT_TOOL_SIGNALS regex lists are tight (cover iMessage `search_contacts` + WhatsApp privacy-cap). | Expand regex lists as new MCPs surface. |
| **FLN-v80-1** | v0.80.0 | HC-V0800-A1 glob-prose regex required literal `per-mcp/<kind_name>/*.md`; plan's verbatim prose split it. Fixed inline by amending prose. | Soften the regex or codify literal-glob phrasing in plan-template HC skeleton. |
| **FLN-v80-2** | v0.80.0 | Landmine #16 less load-bearing than v0.79.0 close documented — `.claude/skills/cowork/*` dests catch up per-install regardless of per-item version short-circuit (for surfaces processed by `materializeClaudeSurface`). | Future plans can stop predicting "deferred to S11" for SKILL.md dest drift. |
| **FLN-v80-3** | v0.80.0 | Result-doc structure stable across v0.79.0 + v0.80.0 (what shipped → HC cases → version moves → stages → observations → carry-forward → FLNs). | Codify in a result-doc template skill. |

---

## 5. The headspace vault — onboarding plan

**Vault path:** `/Users/willfellhoelter/notes/sauce/headspace-sauce`.

### Current state (verified 2026-05-30 post-`sauce update --bump-pins`)

```
workshop_version:   0.80.0
cowork blueprint:   0.19.0
per-mcp/ dir:       does not exist yet (no microscopes, no siblings)
hard_rules:         not set
no_emojis:          not set
```

Configured MCPs in `spice/cowork/context/user-preferences.md`:

| Kind | served_by | priority order | Notes summary |
|---|---|---|---|
| **chat** | `Read_and_Send_iMessages` + `whatsapp` (override-classified) | 1st | Comprehensive across ALL chats; 10 inner-circle names elevate but don't suppress others; iMessage + WhatsApp combined |
| **finance** | `copilot-money` (override-classified) | 2nd | TOP-PRIORITY DOMAIN; 2-year zero-debt goal `$455/wk` / `$1,200/mo`; all categories, all accounts, always shown; daily_threshold_usd: 100 |
| **calendar** | M365 UUID (`f3445a75-...`) | 3rd | Surface travel / conflicts / prep-needed; all-day window strategy |
| **email** | M365 UUID (`e3775437-...`) | 4th | VIP pattern `*fellhoelter*` + receipts + appointments; aggressive spam filter; ignore_lists: true |

### Recommendation: **CONTINUE from current state — DO NOT start fresh**

Rationale:

- Preferences are already well-authored — burning them is pure cost.
- v0.79.0 + v0.80.0 are strictly additive: no breaking changes, no schema rewrites.
- The 2026-05-29 morning-briefing gaps that motivated v0.79.0 (emoji leak, monochrome callouts, shallow finance, privacy-capped chat) are the EXACT gaps the new features close — same vault, same context, finally with the contracts to express them.

### Step-by-step onboarding (recommended order)

#### Step 0 — Confirm vault state

```bash
cd /Users/willfellhoelter/notes/sauce/headspace-sauce
jq '.workshop_version, (.blueprints[]|select(.name=="cowork")|.version)' ranch/platform-installed.json
# expect: "0.80.0" then "0.19.0"
```

#### Step 1 — Add hard rules + no_emojis to `user-preferences.md` (one-time edit, ~5 min)

Open `spice/cowork/context/user-preferences.md` in Obsidian. Under the existing `personality:` block, add:

```yaml
personality:
  vibe: encouraging
  # ... existing fields ...
  no_emojis: true
  hard_rules:
    - "never use the word leverage"
    # add more as desired, one per line
```

**Why first:** these propagate to ALL three output layers automatically (voice contract + gather-from-served-by + write-run-note). Closes the dominant emoji-leak surface from the 2026-05-29 briefing on the first authored kind.

#### Step 2 — Author the **finance** microscope (highest-value, top-priority domain)

In a Claude Code session inside the headspace vault directory, run:

```
/cowork microscope finance
```

The skill will:

1. Enumerate `mcp__copilot-money__*` tools the agent currently has access to.
2. Ask consent: *"Want me to pull a small sample so my questions are grounded in your real data?"* On YES, calls a few cheap read tools, inspects field shapes, surfaces gaps.
3. Ask one question at a time grounded in tools + sample: what to surface, how to group, what to flag/ignore. Will's well-articulated finance thesis (TOP-PRIORITY DOMAIN, 2-year zero-debt) maps directly here.
4. For each gap, classify the resolution path:
   - `resolvable-in-gather` → record gather-time instruction (e.g., "before summarizing, pull category breakdown via `<tool>`").
   - `mcp-ceiling` → unlikely for copilot-money but possible.
   - `user-supplied` → **NEW in v0.80.0:** scaffold a starter sibling with a gap-inferred markdown table.
5. Compose `microscope.md` → `spice/cowork/prompts/per-mcp/finance/microscope.md` + `## References` section enumerating any scaffolded siblings.

**Expected v0.80.0 sibling candidates for finance:**

- `account-aliases.md` (`| id | nickname |`) — if transactions show internal account IDs you'd rather see by nickname.
- `vendor-aliases.md` (`| key | value |`) — if merchant names render badly (e.g., `STARBUCKS #00873 SEATTLE` → `Starbucks`).
- `vip-vendors.md` (`| id | reason |`) — vendors to elevate (rent, mortgage, debt payment) so they always show even below the daily $100 threshold.

#### Step 3 — Author the **chat** microscope

```
/cowork microscope chat
```

Strong gaps to expect:

- **iMessage number→name** → `resolvable-in-gather` via `search_contacts` (v0.79.0 closed this — the skill encodes the instruction in the gather contract).
- **WhatsApp privacy cap** → `mcp-ceiling` — the skill names `lharries/whatsapp-mcp` (whatsmeow-backed, message-level depth) as the swap candidate. v0.79.0 carry-forward §2 — actual swap is a future cycle.
- **Inner-circle elevation rationale** → `user-supplied` → scaffold `vip-list.md` (`| id | reason |`). Will's 10 inner-circle names already exist in `user-preferences.md`; the sibling captures the per-person rationale ("Mom — always", "Diana — fiancée", "Lance — co-founder — anything urgent") so the briefing's "why elevated" context is grounded.

#### Step 4 — Author the **email** microscope

```
/cowork microscope email
```

Strong gaps to expect:

- **VIP sender resolution** → `user-supplied` → scaffold `senders-map.md` (`| email | name |`) for personal contacts whose email addresses are opaque, OR `vip-list.md` (`| id | reason |`) for explicit elevation rationale. The `*fellhoelter*` pattern is already strong; the sibling makes the per-sender rationale explicit.

#### Step 5 — Author the **calendar** microscope (optional, lowest priority)

```
/cowork microscope calendar
```

M365 calendar is well-typed; canonical `cowork:gather-calendar` may already feel deep enough. Microscope is only worth authoring if the canonical depth feels shallow after a few briefings.

#### Step 6 — Trigger a morning-briefing and compare

Either wait for the scheduled cron or invoke the orchestrator manually. The orchestrator will:

- Read all 4 microscopes (step 2b).
- Read any siblings (step 2c).
- Route each kind through `gather-from-served-by` with deep `what_matters` from the microscope body.
- Inject siblings verbatim into the dispatch contract under `**User-supplied reference: <name>**`.
- Compose with `hard_rules` binding callout TITLES + BODIES.
- Render with per-type callout colors.

**Expected delta vs. the 2026-05-29 briefing:**

| Gap | 2026-05-29 | Post-onboarding |
|---|---|---|
| Emojis in section titles + table cells | Present | Gone (hard_rules) |
| Callouts (info/warning/tip/example) | All same color (monochrome) | Distinct colors (FLN-v79-1 visual verification gate) |
| Finance depth | 4 bullets, no category awareness | Deep contract; debt-tracking-aware; daily $100 threshold; category outliers surfaced |
| Chat (iMessage) phone numbers | Raw phone numbers | Names resolved via `search_contacts` (or `contacts-map.md` fallback) |
| Chat (WhatsApp) depth | Privacy-capped | Same depth (mcp-ceiling) — but skill recommends swap |
| Email VIPs | `*fellhoelter*` pattern only | Explicit `senders-map.md` / `vip-list.md` rationale |

Capture the delta after Step 6 and feed back into the next cycle's design.

### Visual verification (FLN-v79-1)

**Before doing any of the above**, open the headspace vault in Obsidian and view any note containing four callout types:

```markdown
> [!info]
> Test info
>
> [!warning]
> Test warning
>
> [!tip]
> Test tip
>
> [!example]
> Test example
```

Confirm DISTINCT colors. If still monochrome, the Baseline theme's Monochrome Style-Setting may be overriding the snippet — open Style Settings → Baseline → toggle the relevant callout keys to non-monochrome values, OR edit `platform/mechanisms/styling/data/style-settings-default.json` to bake in non-monochrome defaults. This is the only blocker for the v0.79.0 visual gate.

---

## 6. The other 3 consumer vaults — current state

All three are at workshop `0.80.0` / cowork `0.19.0` post-update, but each has different cowork-preferences state:

- **`barebones`** — regression target. Light cowork config (if any). Not expected to be used day-to-day; primary purpose is preflight regression.
- **`accuris-sauce`** — day-to-day consumer. Status of cowork preferences not inspected this session; the v0.79.0 + v0.80.0 features are available but not yet exercised against accuris's MCP set.
- **`ero-sauce`** — day-to-day consumer. Same posture as accuris.

Headspace is the recommended first onboarding target because its 2026-05-29 briefing gaps directly drove the cohort design. Once headspace is dialed in, the same flow applies to accuris + ero.

---

## 7. How to carry this forward to another channel without context gaps

This doc is the single entry point. A future chat (or another channel) can be onboarded by:

1. Reading this file in full.
2. Loading the SESSION-START prompt: `Docs/prompts/SESSION-START.md`.
3. Reading the agent-guides router: `CLAUDE.md` at the workshop root + the linked guides under `Docs/agent-guides/`.

### Absolute paths (this machine, post-2026-05-07)

```
Workshop:           /Users/willfellhoelter/projects/repos/sauce
Headspace vault:    /Users/willfellhoelter/notes/sauce/headspace-sauce
Barebones (regression target): /Users/willfellhoelter/notes/sauce/barebones
Accuris vault:      /Users/willfellhoelter/notes/sauce/accuris-sauce
Ero vault:          /Users/willfellhoelter/notes/sauce/ero-sauce

Legacy (READ-ONLY — landmine #20):
/Users/willfellhoelter/notes/accuris
/Users/willfellhoelter/notes/ero-sync/ero
/Users/willfellhoelter/notes/headspace
```

### Canonical docs to load deep context

```
Cycle-status (live):              Docs/agent-guides/cycle-status.md
Architecture:                     Docs/agent-guides/architecture.md
Build/test/verify:                Docs/agent-guides/build-test-verify.md
Code conventions:                 Docs/agent-guides/code-conventions.md
Asking before acting:             Docs/agent-guides/asking-before-acting.md
Vault paths:                      Docs/agent-guides/vault-paths.md
Landmines:                        Docs/landmines.md
Cowork customization contract:    Docs/agent-guides/cowork-customization-contract.md
Cycle history (archived):         Docs/cycle-history.md
Session-start recipe:             Docs/prompts/SESSION-START.md

v0.79.0 docs (microscope cycle):
Docs/plans/2026-05-29-v0.79.0-cowork-microscope-design.md
Docs/plans/2026-05-29-v0.79.0-cowork-microscope-plan.md
Docs/plans/2026-05-29-v0.79.0-cowork-microscope-result.md
Docs/plans/2026-05-29-v0.79.0-handoff.md

v0.80.0 docs (sibling-files cycle):
Docs/plans/2026-05-30-v0.80.0-cowork-sibling-files-design.md
Docs/plans/2026-05-30-v0.80.0-cowork-sibling-files-plan.md
Docs/plans/2026-05-30-v0.80.0-cowork-sibling-files-result.md
Docs/plans/2026-05-30-v0.80.0-handoff.md

This cohort summary (the linear thread):
Docs/plans/2026-05-30-cowork-cohort-summary-and-headspace-onboarding.md   ← this file
```

### Key code locations

```
edit-microscope (skill):         platform/blueprints/cowork/skills/orchestrators/edit-microscope/SKILL.md
edit-microscope helper:          platform/blueprints/cowork/helpers/edit-microscope-helper.js
gather-from-served-by (skill):   platform/blueprints/cowork/skills/skills/gather-from-served-by/SKILL.md
gather-from-served-by helper:    platform/blueprints/cowork/helpers/gather-from-served-by-helper.js
read-user-preferences helper:    platform/blueprints/cowork/helpers/read-user-preferences-helper.js
5 orchestrators (each has step 2b + 2c):
  platform/blueprints/cowork/skills/orchestrators/{morning-briefing,midday-tripwire,eod-review,weekly-review,monthly-review}/SKILL.md
sauce-callouts.css source:       platform/mechanisms/styling/assets/snippets/sauce-callouts.css
```

### Verification cheatsheet (anyone can run)

```bash
# workshop preflight
cd /Users/willfellhoelter/projects/repos/sauce && npm run release:preflight
# expect: ALL GREEN; version-sync ok: 0.80.0

# cowork smoke individually
node platform/test/run-cowork-smoke.js
# expect: 651 passed / 0 failed

# install harness (unit-mode, includes F1 preservation guard)
node platform/test/run-install.js
# expect: every case PASS

# workshop dogfood install (NOT install.js — see FLN-v79-2)
node platform/test/run-install.js . --auto-approve

# consumer vault update (any of the 4)
cd /Users/willfellhoelter/notes/sauce/headspace-sauce && sauce update --bump-pins
# expect: clean run — exit 0; installed.json workshop_version: 0.80.0
```

---

## 8. Next-cycle pick recommendations (post-cohort)

Ordered by value:

1. **(high, USER-only) FLN-v79-1 visual verification.** Open Obsidian, eyeball the callout colors. 5-minute task; gates the WS-C completeness claim. If still monochrome, toggle Style Settings → Baseline.
2. **(high, empirical) Headspace onboarding execution + delta capture.** Walk Steps 1-6 above on the headspace vault, then capture the morning-briefing delta vs. 2026-05-29 as design input for v0.81+.
3. **(med) FLN-v79-2 sweep.** Either add CLI arg parsing to install.js (preferred) or sweep docs to use `run-install.js` consistently. Removes a load-bearing footgun.
4. **(med) v0.81+ candidate: WhatsApp MCP-swap follow-through** (carry-forward §2). Only meaningful once Will adopts `lharries/whatsapp-mcp`. The chat microscope's `mcp-ceiling` recommendation surfaces this live.
5. **(med) v0.81+ candidate: dedicated `/cowork sibling <kind> <name>` slash command** (carry-forward §10). Decouples sibling authoring from the microscope authoring loop; useful for "I just want to add a new contact to contacts-map.md" without re-entering the full capture loop.
6. **(low) v0.81+ candidate: sibling-application post-processor** (carry-forward §12). Mechanical verification that every phone number in a chat callout maps to a `contacts-map.md` entry. Belt-and-suspenders if first-pass agent compliance drifts.
7. **(low) v0.81+ candidate: expanded known-kinds catalog** (carry-forward §6). drive / code-platform / project-tracker / monitoring. Microscope made custom kinds first-class enough that this is no longer urgent.

---

## 9. The single-paragraph carry-forward (if you only get one paragraph)

The cowork cohort (v0.79.0 + v0.80.0) ships the deep capture loop and the deep gather data: `/cowork microscope <kind>` authors a USER-owned `microscope.md` per MCP, classifies any gap as `resolvable-in-gather` / `mcp-ceiling` / `user-supplied`, and on the user-supplied path scaffolds a sibling file (`contacts-map.md`, `vip-list.md`, …) the orchestrators auto-discover via step 2c and the gather injects under `**User-supplied reference: <name>**`. `personality.hard_rules[]` + `no_emojis` propagate to voice contract + gather dispatch + write-run-note. Per-type callout colors ship in `sauce-callouts.css` (visual verification still owed by Will). All 4 consumer vaults are at workshop 0.80.0 / cowork 0.19.0 as of 2026-05-30. Headspace is the recommended first onboarding target — continue from its current state (don't start fresh), add hard_rules + no_emojis to user-preferences.md, then `/cowork microscope finance` → `chat` → `email` → `calendar` in that order, then trigger a morning-briefing and compare against 2026-05-29.
