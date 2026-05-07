---
date_brainstormed: 2026-05-07
status: pre-cycle ideation; NOT yet a design or plan; awaiting cycle slot
proposed_slot: post-v0.26.1 (likely v0.27.0 if mechanism+blueprint MINOR; could be later if v0.26.x carries fill the queue first)
---

# Cowork blueprint + bundled `/sauce-cowork-setup` skill — pre-cycle brainstorm

> [!warning] Naming + state grounding
> This note was authored 2026-05-07 against current project state: sauce (renamed from beacon v0.25.0); module namespace `spice/<module>/` (per landmine #19 + v0.25.0 sweep); backup suffix `.sauce-backup`; CLI binary `sauce`; allowlist at 12 paths; helper count 11; landmines list 19; stub md5 `ea23aa812503bfca66359d3b2b239ba8`. An earlier brainstorm against stale `beacon/Beacon/.beacon-backup/` naming was reverted (commits af91bda, 513f78b, e7e20e9) and superseded by this note.

---

## Why

User runs an "AI coworker" workflow today in their accuris vault: a scheduled job in **Claude Cowork** (the desktop app's project + scheduling feature) fires a tiny loader prompt:

> "Use `accuris-obsidian` MCP for ALL vault reads and writes. Do NOT use `headspace-obsidian` or `ero-obsidian` — they target different vaults. Execute `Cowork/prompts/prompt-morning-daily-summary.md`. Read it (begins with MCP Routing + Context Dependencies sections), then follow its instructions end to end."

The actual prompt — with the `## MCP Routing` + `## Context Dependencies` + `## Instructions` sections — lives in the vault. The schedule never edits; prompts iterate freely; vault is source of truth.

Sauce currently doesn't model this. Every consumer (accuris / ero / headspace) hand-rolls their own `Cowork/` directory. There's no canonical structure, no installable defaults, no skill that scaffolds a new consumer's cowork setup.

This blueprint templates the pattern + ships a claude-code skill that scaffolds it interview-style.

---

## Shape

**Module:** `spice/cowork/` (lowercase per landmine #11 + #19; module_directory = "cowork").

```
spice/cowork/
├─ Cowork.md                                ← hub (the "AI button" landing)
├─ prompts/
│   ├─ Prompts.md                           ← prompts index hub
│   ├─ _New-Prompt.md                       ← canonical prompt-shape skeleton
│   ├─ prompt-morning-daily-summary.md      ← canonical, derived from accuris seed
│   ├─ prompt-end-of-day-summary.md
│   ├─ prompt-weekly-review.md
│   └─ prompt-monthly-retro.md
├─ dailies/YYYY/MM-MMMM/
│   └─ Cowork-Daily-2026-05-07.md           ← Claude writes summaries here
├─ weeklies/YYYY/
│   └─ Cowork-Weekly-2026-W19.md
└─ monthlies/YYYY/
    └─ Cowork-Monthly-2026-05.md
```

**Templates (8):** Cowork hub, prompts index, `_New-Prompt` skeleton, 4 canonical pre-shipped prompts, 3 output-container templates (`_New-{Daily,Weekly,Monthly}-Summary.md`).

**CustomJS classes (3):** `CoworkHubCards`, `CoworkPromptsCards`, `NewSummaryButton`. Reuse BeaconCards (or whatever the renamed cards mechanism is — verify naming at design-time).

**Nav buttons:** new global icon entry `cowork` (Lucide bot SVG) + per-hub multi-row + per-summary + per-prompt rows.

**Date routing:** dailies `YYYY/MM-MMMM/` (mirrors daily/journal/to-do pattern); weeklies `YYYY/`; monthlies `YYYY/`. Filename pattern `Cowork-<Period>-<DateToken>.md` (suffix-date per gotcha 8 — date as suffix, hyphen-only, no spaces).

---

## Canonical 6-section prompt shape (load-bearing — quote literally in design)

```markdown
---
type: cowork-prompt
prompt_id: <kebab-case-id>
prompt_kind: daily | weekly | monthly | ad-hoc
output_target: dailies | weeklies | monthlies | (path pattern)
created: YYYY-MM-DD
---

## MCP Routing
Use the `{{cowork_mcp_id}}` MCP for ALL vault reads and writes. Do NOT use other
vault MCPs. If a referenced file is missing in this vault, treat that as a hard
error and report it; do not substitute a similarly-named file from another vault.

## Context Dependencies
- [[ ... ]]   ← wikilinks the AI loads before executing
- [[ ... ]]
- (consumer-tailored)

## Instructions
[The actual prompt body — what to summarize, format expectations, output sections.]

## Output target
Create a new note at `spice/cowork/<dir>/.../Cowork-<Period>-<DateToken>.md`
(today's date / this week's ISO week / this month). Use the matching
`_New-<Period>-Summary.md` template body as starting frontmatter + skeleton.

## Self-Heal Protocol
[Verbatim block — see below. Constant across all prompts.]

## Iteration Log
<!-- Self-heal appends entries here. Newest first. Reviewable in git. -->
```

`{{cowork_mcp_id}}` is a NEW canonical platform variable — added to `CANONICAL_VARIABLES` in `wizard.js`; defensively augmented on every run for older configs (per v0.21.0 lesson f).

---

## Self-Heal Protocol (verbatim block in every prompt)

```markdown
## Self-Heal Protocol

If executing this prompt fails or produces output that doesn't match the spec:

1. **Diagnose** — identify the root cause (missing file, ambiguous instruction,
   MCP error, malformed expected output, schema drift, etc.).
2. **Classify** —
   - *Prompt-clarity issue* (wording, stale path, missing fallback, loose
     output spec) → proceed to step 3.
   - *User-intent issue* (the prompt asks for X but X conflicts with what the
     user actually wants) → STOP. Append a `[!warning]` callout to the
     `## Iteration Log` describing the conflict. Do NOT write the summary
     output. Exit.
3. **Edit in place** — fix THIS prompt file (clarify phrasing, update stale
   path, tighten output spec, add a fallback branch for the failure mode).
4. **Log** — prepend to `## Iteration Log`:
   `- YYYY-MM-DD HH:MM: <what changed> — <why> — error: "<msg>"`
5. **Retry** — re-execute with the fix applied. Hard cap: **3 retries per
   run**. If still failing after 3, append a `[!failure]` entry to Iteration
   Log with the final error state and exit.
6. **Never** silently rewrite the user's `## Instructions` section to mean
   something semantically different. Edit phrasing / paths / output-spec
   freely; preserve user intent.
```

**Why it works:** prompts in `spice/cowork/prompts/` are git-tracked in any consumer that's a git repo. Every self-heal edit is reviewable in `git log`. 3-retry hard cap kills runaway loops. User-intent escape hatch prevents AI from silently changing what the user actually asked for; flips to halt + alert. Iteration Log gives transparent visibility — user can scrub what changed and revert in git.

---

## Bundled `/sauce-cowork-setup` claude-code slash command

A skill (markdown file) that ships at `platform/blueprints/cowork/commands/sauce-cowork-setup.md`, materializes via the new `files[].target_root: "claude_commands"` discriminator into `<vault>/.claude/commands/sauce-cowork-setup.md`, and runs INSIDE claude-code at the vault directory.

**The skill's job:** interview the user, scaffold tailored prompt notes in `spice/cowork/prompts/` (with the canonical 6-section shape + verbatim Self-Heal Protocol + empty Iteration Log), and emit copy-paste-ready loader prompts for the user to drop into Claude Cowork scheduled jobs.

**Bridge between two surfaces:** setup happens in *claude-code* (CLI; rich file ops + MCP detection + interactive elicitation). Execution happens in *Claude Cowork* (desktop app's scheduled-jobs + project-folder feature).

### Interview shape (dynamic)

1. Auto-detect installed blueprints from `<vault>/<ranch-or-equivalent>/platform-installed.json`.
2. Auto-detect MCP id from claude-code's MCP server config; offer detected vault-MCP as default.
3. Ask role / job context (free-text).
4. Ask cadences — multiselect: morning daily / EOD daily / weekly / monthly.
5. Per cadence: what to summarize (free-text → maps to canonical sections).
6. Per cadence: which vault paths to load as context. Pre-checked from detected blueprints.
7. Confirm `cowork_mcp_id` value.
8. Preview each prompt-to-be-written; user approves.

### Skill writes (idempotent posture)

- For each selected cadence, write `spice/cowork/prompts/prompt-<cadence>-<purpose>.md` with the canonical 6-section shape, populated Context Dependencies + Instructions, the verbatim Self-Heal Protocol, and an empty Iteration Log.
- If a prompt file already exists, offer: replace (with `.bak` backup) / edit one section / cancel. Never silent overwrite.

### Skill outputs (one block per cadence)

```text
─── LOADER PROMPT for Claude Cowork — paste into your scheduled job ───
Use the `<mcp-id>` MCP for ALL vault reads and writes. Do NOT use other vault
MCPs. If a referenced file is missing in this vault, treat that as a hard error
and report it; do not substitute a similarly-named file from another vault.
Execute `spice/cowork/prompts/prompt-<cadence>-<purpose>.md`. Read that prompt
first (MCP Routing + Context Dependencies sections), then follow its instructions
end to end.
──────────────────────────────────────────────────────────────────────
```

### Constants vs Dynamics (the "constants/standards with dynamic" axis the user asked for)

| Constant (sauce ships) | Dynamic (skill discovers / asks) |
|---|---|
| Directory layout `spice/cowork/{prompts,dailies,weeklies,monthlies}/` | User's role / job context |
| Date routing `YYYY/MM-MMMM/` for dailies, `YYYY/` for week/month | Which cadences to enable |
| Filename pattern `Cowork-<Period>-<DateToken>.md` | What sections each summary captures |
| 6-section prompt shape | MCP id (accuris-obsidian / headspace-obsidian / custom) |
| Loader-prompt template | Vault paths to load as context |
| Frontmatter shape (`type`, `prompt_id`, `prompt_kind`, `output_target`, `created`) | Tone / voice / output formatting preferences |
| Self-Heal Protocol verbatim text | Custom user-added context paths |

### Re-runnable

Running `/sauce-cowork-setup` again detects existing prompt files and offers replace/edit/cancel. Never silent overwrite.

### Discoverability

Cowork hub ships a `[!tip]` callout: "Set up Claude Cowork: run `/sauce-cowork-setup` in claude-code at this vault."

---

## Platform deltas the cycle pulls in

| Delta | Type | Notes |
|---|---|---|
| `.claude/commands/` allowlist path | landmine #12 expansion (12 → 13 paths) | **Requires explicit user approval at design close** — first claude-code-side allowlist surface; sets precedent for future `.claude/skills/`, `.claude/settings.json`, etc. |
| `files[].target_root: "vault" \| "claude_commands"` | manifest schema additive | Reuses existing file-write helper; helper count stays at 11. Discriminator chosen over separate `claude_commands[]` field for minimum schema delta. |
| `cowork_mcp_id` canonical platform variable | wizard schema additive | Added to `CANONICAL_VARIABLES`; defensive augment-on-every-run for older configs per v0.21.0 lesson f. |
| `nav-buttons` mechanism MINOR | additive `cowork` ICONS entry (Lucide bot) | Mirrors v0.13.0 journal MINOR pattern. |

**Helper count:** stays at 11 (target_root discriminator reuses existing file-write helper).
**Workshop_version:** `0.26.x` → `0.27.0` (or wherever the next available MINOR slot lands).

---

## Run modes (3 total; v1 ships A + B; v2+ defers C)

| Mode | How it works | Sauce's role |
|---|---|---|
| **A. Manual copy-paste** | User clicks `[Copy Prompt]` on a prompt note → clipboard gets rendered prompt body. Paste into a fresh Claude Cowork chat. | Ship the button + render the canonical prompt body. |
| **B. Loader-driven scheduled** (user's existing accuris pattern) | Claude Cowork project has a scheduled job: tiny loader prompt that says "Use X MCP, execute Y prompt path." Sauce's `/sauce-cowork-setup` emits the loader-prompt verbatim. User pastes into Claude Cowork's scheduled-job UI. | Sauce owns the prompt content + output template + landing path. Schedule lives outside. |
| **C. Slash-command from Obsidian** | `claude://` URL or `obsidian-shellcommands` plugin spawn. | DEFERRED to v2 — depends on plugin we haven't vendored. |

---

## Deferred from v1 (each becomes its own future cycle if cowork ergonomics validate)

- `event-log` mechanism (append-only structured records — useful later for "jobs blueprint")
- `stable-id` mechanism (ULID frontmatter survives renames)
- `schema-contract` mechanism (formal JSON Schema per blueprint)
- Inbox / approval-queue blueprint (AI proposes, user approves)
- Wiki blueprint (knowledge-base shape; gives existing wiki-* skills a contract)
- `claude://` URL integration / obsidian-shellcommands wiring
- Migration helper for existing `accuris/Cowork/` content (one-shot CLI verb on the `sauce` binary)
- ERO-style invoicing-context cowork preset

---

## Cycle shape estimate (for when this becomes a real cycle)

- **Stages:** 4 (S1 schema/wizard/harness TDD + nav-buttons MINOR; S2 blueprint content; S3 skill body + dogfood; S4 smokes + docs + close).
- **Bump:** MINOR (new blueprint + new platform variable + nav-buttons mechanism MINOR; matches v0.13.0 journal precedent).
- **Reserved headroom:** first-of-its-kind blueprint cycle; expect 2-4 in-cycle CFs in S3 + S4 per v0.6.0 / v0.16.0 / v0.17.0 precedent.
- **Subagent posture:** master-driven on schema/wizard/manifest mechanics; subagent-dispatchable per template + per CustomJS class in S2.
- **Two-stage subagent review** (v0.20.0 + v0.22.1 + v0.26.0 reaffirmation) at S1 + S2 + S3 close.
- **Manual smoke is the close gate** — fresh consumer install + skill interview + dated summary creation are the success criteria.

---

## Open questions for design-time

1. Lucide icon — `bot` / `sparkles` / `message-square-text` / `wand-2`? Pick at impl.
2. Should the skill also write a sample dated summary as a one-shot demo, or strictly just prompts? Default: prompts-only.
3. ERO-style invoicing-context preset (different cadence + structure) — bundle in v1 or defer to v2 once feedback comes in? Default: defer.
4. Migration helper for existing `accuris/Cowork/` (one-shot `sauce migrate-cowork` CLI verb) — bundle or defer? Default: defer until user adopts and surfaces friction.
5. Should the canonical prompts be authored as ONE morning-summary (mirroring user's accuris seed exactly) or ALL FOUR pre-shipped? Default: all four — gives consumers a starter library, optional cadences.
6. Verify the cards mechanism's current name + API contract before authoring CustomJS classes (was `BeaconCards`; may have been renamed in the sauce sweep). QUOTE the API literally per v0.6.0 lesson.

---

## What killed the first attempt (so the next cycle doesn't repeat it)

The 2026-05-06 attempt landed 3 commits (`af91bda` design, `513f78b` plan, `e7e20e9` queue integration) authored against a stale CLAUDE.md snapshot. Project had renamed beacon → sauce (v0.25.0); module namespace beacon/ → spice/ (v0.25.0); workshop_version had reached 0.26.0; the v0.24.0 slot was already taken. All 3 commits referenced wrong names throughout. Reverted in `c1b4a1b`.

**Lesson for the next session that picks this up:** before authoring any design or plan, run `git log -20 && cat platform/manifest.json && cat blueprints\ i\ want.md && ls Docs/prompts/2026-05-*.md | tail -5` to ground in current state. CLAUDE.md auto-memory and status snapshot can lag actual project state significantly when a fast-moving loop is iterating concurrently. Verifying current state should be unconditional pre-flight, not optional.

---

## Picking this up

When this becomes a real cycle:

1. Verify current project state (workshop_version, mechanism + blueprint catalogue, allowlist count, helper count, landmines list, stub md5, module namespaces). Update naming in this brainstorm if any of those have drifted further.
2. Open with `/de:brainstorming` referencing this note as the design seed.
3. Lock the platform deltas via `AskUserQuestion` (especially the allowlist 12 → 13 expansion — first claude-code-side path).
4. Hand off to `/de:writing-plans` for the implementation plan.
5. Execute via `/de:executing-plans` or `/de:subagent-driven-development`.

End of pre-cycle brainstorm.
