# Multi-vault onboarding + official test guide (2026-05-31)

**Audience:** Will Fellhoelter — start here tomorrow morning. Covers (1) the **headspace** vault on this dev machine + (2) the **accuris** vault on another machine. Explains every mechanism in depth so the test isn't blind button-pushing.

**Versions at the time of writing:** workshop `0.81.1`, cowork `0.20.1`, styling `0.2.0`, sauce CLI `0.81.1` (Homebrew). All 4 vaults on this machine confirmed at workshop `0.81.1` / cowork `0.20.1` post-`sauce update --bump-pins`.

**Pre-existing test plan:** `Docs/plans/2026-05-30-headspace-test-plan.md` is the action-only Steps 0-7 reference. This guide is the deeper explanation that wraps around it.

---

## Part 0 — The mental model (read this first)

You're testing a 3-cycle cohort. Each cycle solved a specific gap surfaced by the 2026-05-29 morning briefing on headspace. The cycles compose:

```
v0.79.0 (cowork-microscope) ─┐
                              ├─→ deep gather CONTRACTS + cross-layer hard-rules + per-type callout colors
v0.80.0 (cowork-sibling-files) ─┐
                                 ├─→ deep gather DATA (sibling files) + the orchestrator auto-discovery + the gather injection
v0.81.0 (cowork-audit-siblings) ─┐
                                  ├─→ READ-ONLY SANITY CHECK between contract + data
v0.81.1 (slash doc fix) ─────────┘
```

The user-facing mental model:

| When you... | The mechanism that fires | The file/state it produces |
|---|---|---|
| Run `/cowork preferences` | `cowork:context-builder` skill | `spice/cowork/context/user-preferences.md` (which MCPs are connected; basic notes per kind) |
| Edit `personality:` in user-preferences.md | `cowork:read-user-preferences` composes `effective_hard_rules[]` | Propagated to **3 layers**: voice contract + gather dispatch + write-run-note skeleton |
| Run `/cowork microscope <kind>` | `cowork:edit-microscope` skill | `spice/cowork/prompts/per-mcp/<kind>/microscope.md` (deep contract) + optionally `<sibling>.md` files in same dir |
| Cron fires morning-briefing | `cowork:morning-briefing` orchestrator | Atomic note at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD-Morning-Briefing.md` |
| Run `/cowork audit-siblings` | `cowork:audit-siblings` skill | Inline callouts: `[!warning]` per dangling ref, `[!info]` per orphan, `[!success]` when clean |

### What "microscope" means and why it exists

**Problem (2026-05-29 briefing):** every per-MCP block in `user-preferences.md` has a free-text `notes:` field. Finance's notes said "TOP-PRIORITY DOMAIN, monitor ALL spend." The briefing gave 4 generic bullets — no category awareness, no debt-tracking awareness, no daily-threshold logic. The `notes:` field is too shallow a contract to drive deep output.

**Solution (v0.79.0):** a per-kind USER-OWNED `microscope.md` file authored by an MCP-tool-aware iterative capture loop (`cowork:edit-microscope`). When the loop runs:

1. It enumerates the MCP's actual tools (e.g., `mcp__copilot-money__*`)
2. Optionally pulls a small sample so questions are grounded in real data
3. Asks one focused question at a time: what to surface, how to group, what to flag
4. **Classifies gaps** into three resolution paths:
   - `resolvable-in-gather`: tell the gather to call an extra tool (e.g., iMessage's `search_contacts` to resolve phone→name)
   - `mcp-ceiling`: the MCP can't go deeper; recommend a richer MCP swap
   - `user-supplied`: scaffold a USER-OWNED sibling file (NEW in v0.80.0)
5. Composes `microscope.md` with sections: `## What matters`, `## Tools & how to use them`, `## Gaps & handling`, `## Output shape`, `## References`

**Trade-off:** when a microscope exists for a kind, the 5 atomic-note orchestrators route THAT kind through `cowork:gather-from-served-by` (the generic served-by gather) instead of any canonical-vendor gather. You're trading polished vendor-specific tables (which canonical gathers ship with) for a deep custom contract you authored. Most kinds: deep contract wins.

### What "sibling files" mean and why they exist

**Problem (v0.80.0 driver):** `microscope.md` is the deep gather **CONTRACT** (the prose telling the agent what to surface). But there's deep gather **DATA** too — things like "Mom's iMessage phone is +1-555-…" or "rent vendor is `ABC Property Mgmt LLC`." The contract can't carry the data inline (it would balloon + change frequently).

**Solution (v0.80.0):** any markdown file in `spice/cowork/prompts/per-mcp/<kind>/` EXCEPT `microscope.md` and `_*.md` is a USER-owned **sibling file**. The orchestrators auto-discover them (step 2c — glob + filter); the gather injects each verbatim into the dispatch contract under `**User-supplied reference: <name>**` blocks (placed AFTER `what_matters`, BEFORE `**Hard rules ...**`).

Three conventions:
- Filename: `kebab-case-purpose.md` (`contacts-map.md`, `vip-list.md`, `account-aliases.md`)
- Content: opaque markdown — usually a small table (`| phone | name |`, `| email | reason |`) or a bulleted list
- Escape hatch: prefix `_<name>.md` to keep a file in the dir without injecting (drafts, archives)

The `composeSibling` helper picks the column heuristic from the gap text:
| Gap signal | Inferred columns |
|---|---|
| `/vip\|priority/` | `(id, reason)` |
| `/phone\|number/` | `(phone, name)` |
| `/email/` | `(email, name)` |
| `/account\|\bid\b\|alias/` | `(id, nickname)` |
| else | `(key, value)` |

### What `hard_rules` + `no_emojis` mean and why they propagate

**Problem (2026-05-29):** the briefing rendered with emoji glyphs everywhere (section titles, table cells, narrative ❤️) despite Will's preference for none. Emoji authoring happens in 3 separate code paths (voice contract, gather sub-skills, write-run-note skeleton) — fixing one wasn't enough.

**Solution (v0.79.0 WS-B):** add `personality.hard_rules: [<string>, ...]` + `personality.no_emojis: true` to `user-preferences.md`. The `cowork:read-user-preferences` helper composes one ordered `effective_hard_rules[]` (your custom rules + the canonical no-emoji rule when `no_emojis: true`). This list propagates to:

1. **Voice contract** (`composeVoiceContract`) — appends a `Hard rules (non-negotiable, …)` block
2. **Gather dispatch** (`cowork:gather-from-served-by`) — new `hard_rules[]` input + `## Hard rules` SKILL section that binds callout TITLE + BODY (e.g., title is `> [!example]+ Finance`, never `> [!example]+ 💰 Finance`)
3. **Write-run-note skeleton** (all 5) — adaptive-skeleton paragraph that binds rules to `[!example]+`/`[!info]`/`[!tip]` titles + bodies

Canonical `[!warning]` strings are **exempt** (the cowork warning vocabulary is intentional).

### What `audit-siblings` solves

**Problem (v0.80.0 carry-forward):** as you author microscope.md + sibling files, you can introduce silent inconsistency:
- **Dangling reference:** `microscope.md` lists `- **vip-list.md** — elevate inner-circle` in `## References` but you renamed/deleted the file. Agent reads the reference, tries to use `vip-list.md`, file isn't there, falls back silently.
- **Orphan file:** `vip-list.md` exists in the dir but isn't named in `## References`. The orchestrator's step 2c glob still injects it (siblings are glob-discovered, not microscope-driven), but `microscope.md`'s prose loses the per-sibling "why this exists" context.

**Solution (v0.81.0):** `cowork:audit-siblings` is a pure read-only check. For each kind: parses `microscope.md`'s `## References` block, lists per-mcp dir, computes `dangling` (referenced but absent) + `orphans` (present but unreferenced). Emits `[!warning]` per dangling + `[!info]` per orphan + `[!success]` when clean.

**Em-dash requirement (gotcha):** the parser regex matches `- **<name>.md** — <role>` with literal em-dash (`—`, U+2014) between `**<name>**` and the role. Hyphen (`-`) or en-dash (`–`) gets skipped → file appears as orphan even though it's referenced. Use em-dash. SKILL.md's "Render findings" prose includes this gotcha.

---

## Part 1 — Headspace on this machine (the dev machine)

### Pre-flight: confirm state

```bash
cd /Users/willfellhoelter/notes/sauce/headspace-sauce
jq -r '.workshop_version, (.blueprints[]|select(.name=="cowork")|.version)' ranch/platform-installed.json
# expect: 0.81.1 then 0.20.1

ls .claude/skills/cowork/audit-siblings/SKILL.md
# expect: file present

grep -c "/cowork audit-siblings" .claude/commands/cowork.md
# expect: 3 (section header + invocation example + skill name)

ls .obsidian/snippets/sauce-callouts.css
# expect: file present

grep -c "sauce-callouts" .obsidian/appearance.json
# expect: 1 (registered in enabledCssSnippets)
```

If any check fails, run `sauce update --bump-pins` from inside the vault and re-check. If still failing, the workshop side may have drift — check `cd /Users/willfellhoelter/projects/repos/sauce && git status` for unexpected dirty files.

### Step 0 — Visual gate (FLN-v79-1, 5 min, your eyes only)

Open headspace in Obsidian. Create a scratch note (anywhere):

```markdown
> [!info]
> Test info — should be ONE distinct color.

> [!warning]
> Test warning — should be a SECOND distinct color.

> [!tip]
> Test tip — third distinct color.

> [!example]
> Test example — fourth distinct color.
```

View in Reading mode (Cmd+E if you're in edit mode). **Four distinct colors expected** — info/warning/tip/example each in a unique rose-pine-light hue (light mode) or melange-dark hue (dark mode).

**If all four look the same (monochrome):** Obsidian's Baseline theme has a Monochrome Style-Setting overriding the snippet. Fix:
1. Open Style Settings (community plugin → right-side panel; install if missing)
2. Find Baseline theme → callout color overrides
3. Toggle `callout-info-color`, `callout-warning-color`, `callout-tip-color`, `callout-example-color` off (let them fall back to the snippet)
4. Re-view the note

**If snippet is unregistered:** check `.obsidian/snippets/sauce-callouts.css` exists + `.obsidian/appearance.json` `enabledCssSnippets` contains `"sauce-callouts"`. Both should be present from `sauce update --bump-pins`. If missing, re-run that command.

**Once Step 0 passes:** take a screenshot of the four-color callout note for the post-test delta capture.

### Step 1 — Paste `hard_rules` + `no_emojis` (1-time edit, 2 min)

Open `spice/cowork/context/user-preferences.md` in Obsidian (or any editor). Locate the `personality:` block (around line 10). The block currently has: `vibe`, `vibe_notes`, `formality`, `pep_talk`, `pep_talk_style`, `length`. Add two more keys at the bottom of the block (before `mcps:`):

```yaml
  no_emojis: true
  hard_rules:
    - "never use the word leverage"
    - "no emojis anywhere in section titles, table cells, or bullets"
```

The second rule is technically redundant with `no_emojis: true` (which composes the canonical no-emoji rule). Adding it explicitly is fine — it becomes two rules in the composed list. Both are documentation for future-you.

Save. **Expected outcome:** no YAML parser error, no Obsidian indexing complaint in dev console. The rules take effect on the next orchestrator run (Steps 2-6 will pick them up).

**Why this step matters:** without this paste, `effective_hard_rules[]` is `[]`, the voice contract's Hard-rules block is omitted, the gather's `## Hard rules` SKILL injection is empty, and emoji handling reverts to "compose normally" everywhere. This is the load-bearing one-edit fix for the 2026-05-29 emoji-leak gap.

### Step 2 — `/cowork microscope finance` (~15 min, highest value)

In a Claude Code session inside headspace, type:

```
/cowork microscope finance
```

Walk through the 7 steps the `edit-microscope` skill drives:

1. **Resolve kind** — verifies `finance` is in your priorities. Should pass silently.
2. **Read existing contract** — finds none (per-mcp dir doesn't exist yet). Skill proceeds in seed-from-notes mode.
3. **Enumerate tools** — lists the `mcp__copilot-money__*` tools available in your current session. Expect 4-8 tools.
4. **Consent-gated live sample + gap-finding** — asks: *"Want me to pull a small sample so my questions are grounded in your real data?"*
   - **Say YES.** Finance's value comes from grounding the contract in your real spend patterns. The skill will pull a few cheap reads, inspect field shapes, surface 1-3 gaps.
   - **For each gap, the skill calls `classifyGap` + presents the resolution path:**
     - `resolvable-in-gather` → records a gather-time instruction. Accept these.
     - `mcp-ceiling` → unlikely for copilot-money; if it surfaces, note the recommended swap.
     - `user-supplied` → **the v0.80.0 sibling-scaffold sub-flow runs:**
       - The skill computes a suggested filename from the gap text (e.g., gap "transactions show account IDs" → `account-aliases.md` via the `(id, nickname)` heuristic)
       - Shows you a preview of the starter template (just a markdown table with column headers from the heuristic + one empty row to type into)
       - Asks: *"Create `per-mcp/finance/account-aliases.md` with this starter table? (Y/n, or supply a different filename)"*
       - On YES: pre-checks existence; if absent, writes the starter; records the sibling+role for `microscope.md`'s `## References` section.
       - On NO: skips. You can hand-author later.
5. **Brainstorm preferences, one question at a time** — grounded in tools + sample + gaps. Will's well-articulated finance thesis (TOP-PRIORITY, 2-year zero-debt, daily $100 threshold) maps directly here. Answer one question at a time; the skill doesn't expect bullet-point dumps.
6. **Compose/refine** — calls `composeMicroscope` with all the captured state + writes `spice/cowork/prompts/per-mcp/finance/microscope.md` (creates the directory).
7. **Confirm** — shows you the written path + one-line summary. Mentions you can re-run anytime to deepen.

**Expected outcome:**
- New file: `spice/cowork/prompts/per-mcp/finance/microscope.md` containing `## What matters` (your deep contract) + `## Tools & how to use them` (enumerated copilot-money tools with per-tool gather instructions) + `## Gaps & handling` (gap classifications) + `## Output shape` + `## References` (if any siblings were scaffolded).
- Optionally one or more sibling files in `spice/cowork/prompts/per-mcp/finance/`.

**Expected sibling candidates for finance:**
- `account-aliases.md` (`| id | nickname |`) — if transactions show internal account IDs you'd rather see by nickname
- `vendor-aliases.md` (`| key | value |`) — if merchant names render badly (`STARBUCKS #00873 SEATTLE` → `Starbucks`)
- `vip-vendors.md` (`| id | reason |`) — vendors to always elevate (rent, mortgage, debt payment) so they show even below the $100 daily threshold

After this step finishes, your `per-mcp/` dir tree might look like:

```
spice/cowork/prompts/per-mcp/
└── finance/
    ├── microscope.md            (the deep contract — USER-owned)
    ├── account-aliases.md       (optional sibling — USER-owned)
    └── vip-vendors.md           (optional sibling — USER-owned)
```

### Step 3 — `/cowork microscope chat` (~15 min)

Same flow as Step 2, but for chat (iMessage + WhatsApp). Strong gaps to expect:

- **iMessage number→name resolution** → classified `resolvable-in-gather` via `search_contacts`. The v0.79.0 `classifyGap` heuristic recognizes `search_contacts` as a resolver tool name. Skill records: "When summarizing iMessage threads, call `search_contacts` first to resolve sender phone numbers to display names before composing the callout." This is the load-bearing fix for the 2026-05-29 raw-phone-number bullets.
- **WhatsApp privacy cap** → `mcp-ceiling`. The current WhatsApp MCP exposes only chat-listing-level data (privacy-constrained). Skill names `lharries/whatsapp-mcp` (a whatsmeow-backed local SQLite bridge with message-level depth) as the swap candidate. **Don't swap tonight.** Note it as a follow-up; tomorrow's briefing will still be privacy-capped for WhatsApp.
- **Inner-circle elevation rationale** → `user-supplied` → scaffold `vip-list.md` (`| id | reason |`). Your 10 inner-circle names already exist in `user-preferences.md`. The sibling captures the per-person rationale ("Mom — always", "Diana — fiancée", "Lance — co-founder — anything urgent") so the briefing's "why elevated" context is grounded.

### Step 4 — `/cowork microscope email` (~10 min)

VIP sender resolution → `user-supplied`. Scaffold options:
- `senders-map.md` (`| email | name |`) for personal contacts with opaque email addresses
- `vip-list.md` (`| id | reason |`) for explicit elevation rationale

The `*fellhoelter*` pattern already exists in `user-preferences.md`. The sibling makes the per-sender rationale explicit.

### Step 5 — `/cowork microscope calendar` (~10 min OR skip)

M365 calendar MCP is well-typed; canonical gather may already feel deep enough. Only author a microscope if Step 6's calendar block feels shallow.

### Step 6 — Trigger a morning-briefing + compare to 2026-05-29 (~15 min)

Either wait for cron OR manually invoke `/cowork morning-briefing` in Claude Code (inside the vault).

The orchestrator runs through (annotated to show what's NEW):
1. Read user-preferences (composes `effective_hard_rules[]` ← v0.79)
2. Read mcp-skill-map.json
2b. **Read per-kind microscope contracts** ← v0.79 (reads microscope.md for each prioritized kind)
2c. **Read per-kind sibling files** ← v0.80 (lists per-mcp/<kind>/ + filters microscope.md + `_*.md` + reads each remaining sibling)
3. Build dispatch_plan[] — for each kind, route either via canonical-vendor gather OR via gather-from-served-by (microscope-routed). Pass `hard_rules: prefs.effective_hard_rules` + `siblings: siblings[entry.kind_name] || []` into each gather. ← v0.79+v0.80
4. Execute each gather; agent composes a `> [!example]+ <kind_title>` callout. Binds to hard_rules (no emojis in title or body). For microscope-routed kinds: gather dispatch contract has `**What matters**: <microscope body verbatim>` + (if siblings present) one `**User-supplied reference: <name>**` block per sibling + `**Hard rules ...**` block. ← v0.79+v0.80
5. write-run-note-morning-briefing assembles the atomic note. Hard-rules binding paragraph guards the final write. ← v0.79

Read the resulting atomic note at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD-Morning-Briefing.md`.

**Compare to 2026-05-29 using this delta table:**

| Gap | 2026-05-29 (baseline) | Today's briefing | Verdict |
|---|---|---|---|
| Emojis in section titles + table cells + narratives | Present | Gone (hard_rules) | PASS / FAIL? |
| Callouts (info/warning/tip/example) all same color | Yes (monochrome) | Distinct per type | PASS / FAIL? |
| Finance section depth | 4 generic bullets | Deep, debt-aware, category-aware | PASS / FAIL? |
| Chat (iMessage) phone numbers | Raw phone numbers | Names via `search_contacts` (or `contacts-map.md` fallback) | PASS / FAIL? |
| Chat (WhatsApp) depth | Privacy-capped 4 bullets | Same depth (mcp-ceiling unchanged) — note swap candidate visible | PASS / FAIL? |
| Email VIP signal | `*fellhoelter*` glob only | Explicit `senders-map.md` / `vip-list.md` elevation rationale | PASS / FAIL? |
| Inner-circle elevation in chat | Names elevated but no rationale | Names elevated with per-person rationale | PASS / FAIL? |

Fill in the PASS / FAIL column. **Most likely FAIL rows:** WhatsApp depth (unresolved mcp-ceiling — known, planned for v0.82+) + finance category outliers (depth depends on how aggressive the live-sample step was; if sparse, re-author with `/cowork microscope finance` to deepen).

### Step 7 — `/cowork audit-siblings` (~2 min)

In Claude Code, type:

```
/cowork audit-siblings
```

(Or scope to a single kind: `/cowork audit-siblings chat`.)

The skill runs through 6 steps:
1. Read prefs → `prefs.priorities`
2. Resolve scope (single kind if specified; else all priorities)
3. Gather per-kind state — list `per-mcp/<kind>/` + filter (`*.md`, exclude `microscope.md` + `_*.md`), read each `microscope.md`'s body
4. Call `auditSiblings()` helper — two-axis check
5. Render findings — one callout per dangling + one per orphan
6. Summary callout — `[!success]` if clean, `[!info]` summary otherwise

**Expected outcome:**
- If everything is consistent post-Steps 2-5, single `[!success]`: "Audited N kind(s) — no dangling references, no orphan files."
- If a microscope's `## References` names a sibling that doesn't exist: `[!warning] Dangling sibling reference`. Fix by either re-running `/cowork microscope <kind>` (scaffolds the file) OR hand-editing `microscope.md` to remove the dangling line.
- If a sibling exists but isn't referenced: `[!info] Orphan sibling file`. Fix by re-running `/cowork microscope <kind>` (records a reference) OR hand-adding a `- **<name>** — <your role description>` line to `microscope.md`'s `## References` section.

**Important troubleshooting (em-dash gotcha):** if the audit flags a file as orphan but you KNOW you referenced it in `microscope.md`, check the bullet shape. The parser requires em-dash (`—`, U+2014) between `**<name>**` and the role description. If you hand-typed a hyphen (`-`) or en-dash (`–`), the parser silently skips the entry → file appears as orphan even though it's "referenced." Use em-dash. The audit-siblings SKILL.md has a Note callout repeating this.

**When to re-run audit-siblings:**
- After every `/cowork microscope <kind>` round
- After hand-editing any sibling file (renamed, deleted, added)
- Periodically before a high-stakes morning briefing (sanity check)

### End-of-test checkpoint for headspace

- [ ] Step 0 passed (four distinct callout colors)
- [ ] `personality.no_emojis: true` + `personality.hard_rules: [...]` saved in user-preferences.md
- [ ] 2-4 `spice/cowork/prompts/per-mcp/<kind>/microscope.md` files exist
- [ ] 0-4 sibling files exist
- [ ] Fresh morning-briefing rendered with: distinct callout colors, no emojis, deeper finance, name-resolved chat, VIP-elevated email
- [ ] `/cowork audit-siblings` returns `[!success]` clean state (or all flagged issues hand-resolved)
- [ ] Delta table captured to `Docs/plans/2026-05-31-headspace-test-results.md` (in the workshop)

---

## Part 2 — Accuris on another machine

The accuris-sauce vault lives at `/Users/willfellhoelter/notes/sauce/accuris-sauce` on this dev machine. If your "other machine" syncs that path (via iCloud / Dropbox / Obsidian Sync / git), the steps are: **install/upgrade brew CLI → run `sauce update --bump-pins` → walk the same Steps 0-7**.

If the other machine has its OWN accuris-sauce that's not synced to this one, you'll need to bootstrap from scratch. Both paths covered below.

### Path A — Other machine has accuris-sauce already (synced)

#### A.1 — Install/upgrade sauce CLI on the other machine

```bash
# First-time install:
brew tap willfell/sauce
brew install sauce

# OR upgrade existing install:
brew update
brew upgrade sauce

# Verify:
brew list sauce --versions
# expect: sauce 0.81.1
```

If `brew tap willfell/sauce` fails (private tap), make sure the GitHub remote is reachable from that machine — the tap repo is `https://github.com/willfell/homebrew-sauce`.

#### A.2 — Sync the accuris-sauce vault to the other machine

Depends on your sync mechanism:
- **iCloud / Dropbox / OneDrive:** wait for the sync indicator to settle (the `ranch/platform-installed.json` file should show workshop `0.81.1` once synced; check with `jq -r .workshop_version ranch/platform-installed.json` from inside the vault on the other machine)
- **Obsidian Sync:** open the vault in Obsidian on the other machine; the sync agent pulls the latest state
- **Git:** if the vault is git-tracked (rare for sauce consumer vaults — they typically aren't), run `git pull` from inside the vault directory

#### A.3 — Run `sauce update --bump-pins` from inside the vault

```bash
cd /path/to/accuris-sauce  # on the other machine
sauce update --bump-pins
```

Expected output ends with `Verdict: clean run — exit 0`.

#### A.4 — Confirm state mirrors what we verified on this machine

```bash
cd /path/to/accuris-sauce
jq -r '.workshop_version, (.blueprints[]|select(.name=="cowork")|.version)' ranch/platform-installed.json
# expect: 0.81.1 then 0.20.1

grep -c "/cowork audit-siblings" .claude/commands/cowork.md
# expect: 3

ls .claude/skills/cowork/audit-siblings/SKILL.md
# expect: file present

ls .obsidian/snippets/sauce-callouts.css
# expect: file present
```

#### A.5 — Walk the same Steps 0-7 from Part 1 above

The mechanism + UX is identical. The only differences vs headspace:
- **Different MCP set** — accuris probably has different priorities (project tracker / code platform / corporate chat) than headspace's personal (chat / finance / calendar / email). Adjust which kinds you author microscopes for based on accuris's existing `user-preferences.md priorities:`.
- **Different briefing baseline** — capture accuris's morning-briefing BEFORE you do the authoring, then compare AFTER. The delta table from Part 1 Step 6 still applies (rows about emojis, callouts, depth, name resolution).
- **The hard_rules paste (Step 1)** is the same content — paste the same `no_emojis: true` + `hard_rules: [...]` block. Personality propagation works the same.

### Path B — Other machine needs accuris vault bootstrapped from scratch

If accuris-sauce doesn't exist on the other machine yet:

#### B.1 — Install sauce CLI (same as A.1)

#### B.2 — Pick a vault location + initialize

```bash
mkdir -p ~/notes/sauce/accuris-sauce
cd ~/notes/sauce/accuris-sauce
sauce bootstrap
# Walks through the engagement-aware interview — see the /cowork bootstrap section
# of .claude/commands/cowork.md once it materializes
```

#### B.3 — Run `/cowork` to drive the bootstrap-vault skill

In Obsidian + Claude Code, open the new vault and run `/cowork`. This is the 25-step engagement-aware interview that:
- Asks engagement id (e.g., `accuris`), engagement type (`w2-fte` or `consulting`)
- Probes connected MCPs
- Writes `spice/cowork/context/vault-config.md`
- Materializes per-engagement context dirs
- Renders the Cowork.md nav-button table
- Emits a 7-section bootstrap report

#### B.4 — Run `/cowork preferences` to configure MCPs

This drives `cowork:context-builder` — 14 hand-curated questions across calendar/gmail/imessage/finance + cross-cutting priorities + personality. Writes `spice/cowork/context/user-preferences.md`.

#### B.5 — Now you're at the same state as Path A.5

Walk Steps 0-7 from Part 1.

---

## Part 3 — Full official test (single source of truth)

This is the formal test capture. Do this AFTER Steps 0-7 are done on a vault.

### Test artifacts to produce

Create `Docs/plans/2026-05-31-<vaultname>-test-results.md` in the workshop (`/Users/willfellhoelter/projects/repos/sauce/Docs/plans/`). One file per vault tested.

Template:

```markdown
# 2026-05-31 — <vaultname> cowork cohort test results

**Vault:** /path/to/vault
**Machine:** <hostname>
**Workshop version at test time:** 0.81.1
**Cowork version at test time:** 0.20.1

## Step 0 — Visual gate (FLN-v79-1)

- Callout colors render distinct: YES / NO
- If NO: applied Style Settings fix? YES / NO — result after fix:
- Screenshot path:

## Step 1 — hard_rules paste

- YAML saved without error: YES / NO
- hard_rules entries: [<list>]
- no_emojis: true / false

## Steps 2-5 — Microscope authoring

For each kind authored, record:

### finance
- Microscope written: spice/cowork/prompts/per-mcp/finance/microscope.md (lines: N)
- Siblings scaffolded: [<list of filenames>]
- Live-sample step said YES: YES / NO
- Gaps surfaced: <count>; classifications: <count resolvable-in-gather, count mcp-ceiling, count user-supplied>
- Friction points encountered:
- Notable insights:

### chat
- (same template)

### email
- (same template)

### calendar
- Authored / skipped:
- (same template if authored)

## Step 6 — Morning-briefing comparison

Paste the full filled delta table from Part 1 Step 6. PASS / FAIL per row + brief explanation when FAIL.

| Gap | 2026-05-29 baseline | Today | Verdict | Notes |
|---|---|---|---|---|
| Emojis | | | | |
| Callouts | | | | |
| Finance depth | | | | |
| iMessage names | | | | |
| WhatsApp depth | | | | |
| Email VIP | | | | |
| Inner-circle rationale | | | | |

## Step 7 — Audit-siblings

- Clean state on first run: YES / NO
- If NO: dangling count: N, orphan count: N
- Fixes applied: <list>
- Final state: [!success] / still showing issues

## Captured feedback

1. **The delta table** (above)
2. **Any new gaps** that surfaced during authoring NOT classified into the 3 existing paths
3. **Friction points** in the capture-loop UX — what felt clunky vs magical
4. **Sibling-file surprises** — did composeSibling pick the right columns? Was any gap not covered?
5. **Visual issues** beyond Step 0

## Next-cycle candidates surfaced

[List any FLN candidates this test surfaced that aren't already in the in-flight queue at Docs/agent-guides/cycle-status.md]
```

Once filled in, commit to the workshop repo and push:

```bash
cd /Users/willfellhoelter/projects/repos/sauce
git add Docs/plans/2026-05-31-<vaultname>-test-results.md
git commit -m "docs(plans): 2026-05-31 <vaultname> cowork cohort test results"
git push origin main
```

These test results are the input for next-cycle design. They convert "I tested it" into "the next cycle's design has concrete evidence to draw on."

---

## Part 4 — Mechanism deep-dive (reference)

### `cowork:read-user-preferences` (v0.59.9 + v0.79.0)

**File:** `platform/blueprints/cowork/skills/skills/read-user-preferences/SKILL.md` (sub-skill, nested) + `platform/blueprints/cowork/helpers/read-user-preferences-helper.js`.

**What it does:** parses `spice/cowork/context/user-preferences.md` into a structured `prefs` object. The v0.79.0 additions:
- Parses `personality.hard_rules: [<string>, ...]` + `personality.no_emojis: true`
- Composes one ordered `prefs.effective_hard_rules[]` array (your custom rules + the canonical no-emoji rule when `no_emojis: true`)
- Exposes `effective_hard_rules` for the orchestrators to pass downstream

**The 3-layer propagation:**

```
                        prefs (read by orchestrator)
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   voice contract       gather dispatch        write-run-note
   (composeVoiceContract  (gather-from-served-by  skeleton
   appends Hard rules     ## Hard rules SKILL    (binding paragraph
   block)                 section, binds title  on all 5 sub-skills)
                          + body)
```

Canonical `[!warning]` strings are exempt across all 3 layers.

### `cowork:edit-microscope` (v0.79.0 + v0.80.0)

**File:** `platform/blueprints/cowork/skills/orchestrators/edit-microscope/SKILL.md` (orchestrator, flattened) + `platform/blueprints/cowork/helpers/edit-microscope-helper.js`.

**Helper exports (pure):**
- `resolveKind({ requested, kinds }) → { kind, status, choices? }` — validates kind name; returns `"ok"`/`"unclassified"`/`"ask"`
- `classifyGap({ gap, tools }) → { gap, resolution, note }` — classifies a discovered data gap into one of 3 resolution paths via heuristic regex against tool names + gap text
- `composeMicroscope({ kind_name, existing, notes, answers, tools, gaps, siblings_to_reference? }) → string` — pure renderer; seed-from-notes mode (when `existing` null) writes 5 sections; deepen-pass mode (when `existing` non-empty) appends new content
- `composeSibling({ kind_name, gap, suggested_name }) → { name, body, status }` (v0.80.0 addition) — renders starter sibling template with heading + USER-OWNED preamble + markdown table whose columns are inferred from gap text

**Skill flow:**
1. Resolve kind (validate against `prefs.priorities`)
2. Read existing `microscope.md` if present (iteration anchor)
3. Enumerate tools (filter to `mcp__<served_by>__*`)
4. Consent-gated live sample + gap-finding — for each gap, classify + handle:
   - `resolvable-in-gather` → record gather-time instruction
   - `mcp-ceiling` → name a richer alternative MCP
   - `user-supplied` → run the v0.80.0 sibling-file sub-flow (6 sub-steps; pre-checks existence; scaffolds via `composeSibling` + `Write`; records `{name, role}` in `siblings_to_reference`)
5. Brainstorm preferences (one question at a time)
6. Compose/refine via `composeMicroscope`; write to `spice/cowork/prompts/per-mcp/<kind>/microscope.md`
7. Confirm

### `cowork:gather-from-served-by` (v0.78.0 + v0.79.0 + v0.80.0)

**File:** `platform/blueprints/cowork/skills/skills/gather-from-served-by/SKILL.md` (sub-skill, nested) + `platform/blueprints/cowork/helpers/gather-from-served-by-helper.js`.

**Vendor-agnostic gather** for MCPs whose tool surface doesn't match a canonical vendor (Outlook M365 UUID, Azure DevOps gateways, etc.). Enumerates whatever tools the `served_by` namespace exposes and dispatches the gather inline.

**v0.79.0 added:** `hard_rules[]` input + `## Hard rules` SKILL.md section binding callout TITLE + BODY. Helper echoes `hard_rules_applied[]` on success.

**v0.80.0 added:** `siblings: list[{name, body}]` input + `## User-supplied reference` SKILL.md section. The agent injects each sibling verbatim under `**User-supplied reference: <name>**` in the dispatch contract (Step 3), AFTER `<what_matters verbatim>` + optional `**Captured answers**`, BEFORE `**Hard rules ...**`. Helper echoes `siblings_used: list[string]` on success.

### Orchestrator step 2c (v0.80.0)

**Files:** all 5 atomic-note orchestrator SKILL.md files (`morning-briefing/`, `midday-tripwire/`, `eod-review/`, `weekly-review/`, `monthly-review/`).

For each `kind_name` in `prefs.priorities`:
- List `spice/cowork/prompts/per-mcp/<kind_name>/` via `mcp__obsidian__list_files_in_dir` (treat dir-not-found as empty)
- Filter to files matching the `per-mcp/<kind_name>/*.md` glob
- Exclude `microscope.md` + any filename matching `^_.*\.md$`
- Read each remaining file's body, strip frontmatter, append `{name, body}` to `siblings[kind_name]`

Pure step: no MCP gather calls, no writes. Builds in-memory state alongside `microscopes[]` (from step 2b) for the gather phase. The gather-loop then passes `siblings: siblings[entry.kind_name] || []` into each `gather-from-served-by` call.

### `cowork:audit-siblings` (v0.81.0 + v0.81.1 doc fix)

**File:** `platform/blueprints/cowork/skills/orchestrators/audit-siblings/SKILL.md` (orchestrator, flattened) + `platform/blueprints/cowork/helpers/audit-siblings-helper.js`.

**Helper exports (pure):**
- `parseReferences(microscope_body) → string[]` — extracts sibling filenames from `## References` and `## References (added)` blocks. Header regex: `/^##\s+References(\s+\(added\))?\s*$/`. Entry regex: `/^-\s+\*\*([^*]+\.md)\*\*\s+—/` (em-dash required). Dedupes by name (first occurrence wins).
- `auditSiblings({ kinds_dir_listing, microscope_bodies }) → { dangling, orphans }` — two-axis check. Output sorted deterministically by `(kind, name)`.

**Slash command:** `/cowork audit-siblings [<kind>]` — invoke from Claude Code inside the vault. Documented in `.claude/commands/cowork.md` as of v0.81.1.

---

## Part 5 — Troubleshooting decision tree

```
Step 0 callouts monochrome
  ├─ snippet missing on disk?  → sauce update --bump-pins
  ├─ snippet present but not enabled?  → check .obsidian/appearance.json enabledCssSnippets
  └─ snippet present + enabled but still monochrome?  → Style Settings → Baseline → toggle off callout color overrides

Step 1 YAML parse error
  ├─ check 2-space indent under personality:
  └─ quote rule strings if they contain colons

Step 2-5 /cowork microscope <kind> not found
  ├─ check .claude/skills/cowork/edit-microscope/SKILL.md exists
  └─ if missing: sauce update --bump-pins inside vault

Step 2-5 composeSibling not a function
  ├─ workshop at wrong version (need v0.80.0+)
  └─ check workshop with: cd /path/to/workshop && jq -r .version package.json
  └─ if old: cd /path/to/workshop && git pull && cd /path/to/vault && sauce update --bump-pins

Step 2-5 sibling scaffolded but doesn't appear in ## References
  └─ check edit-microscope-helper.js composeMicroscope signature includes siblings_to_reference (v0.80.0 extension)

Step 6 emojis still leak
  ├─ check personality.no_emojis: true saved correctly
  ├─ check personality.hard_rules: present + non-empty
  └─ verify composeEffectiveHardRules is composing canonical no-emoji rule:
     cd /path/to/workshop && node platform/test/run-cowork-smoke.js 2>&1 | grep V0790-A

Step 6 chat names not resolved
  └─ check chat microscope's ## Tools & how to use them section says "call search_contacts before summarizing"
  └─ if missing: re-author with /cowork microscope chat (skill should auto-detect this)

Step 6 finance still shallow
  └─ re-author with /cowork microscope finance + answer live-sample questions more aggressively
  └─ deepen-pass branch of composeMicroscope appends rather than replaces

Step 7 audit flags a file as orphan even though microscope.md references it
  └─ check bullet shape: must use em-dash (—, U+2014), not hyphen or en-dash
  └─ fix the bullet in microscope.md + re-run

Step 7 audit says "Kind X is not in your prefs.priorities"
  └─ check kind name matches user-preferences.md priorities: list exactly (chat vs chats; finance vs Finance)

/cowork audit-siblings just acts confused
  └─ confirm vault at workshop 0.81.1+ via jq -r .workshop_version ranch/platform-installed.json
  └─ if at 0.81.0: sauce update --bump-pins (need 0.81.1 doc fix)
```

---

## Part 6 — What this guide does NOT cover (deferred to v0.82+)

These are deliberately not in tonight's cohort; they're carry-forward candidates for the next cycle:

- **`--fix` mode for audit-siblings** (auto-remove dangling refs; auto-append orphan refs)
- **Role-string validation** (flag refs where `role` is empty / "TBD" / "(role unspecified)")
- **Pre-commit hook** integration (auto-run audit on microscope.md / per-mcp/<kind>/ changes)
- **Multi-vault audit** (audit all consumer vaults from the workshop in one pass)
- **Sibling-body validation** (verify each sibling file is non-empty + has heading + has table/list)
- **WhatsApp MCP swap** to `lharries/whatsapp-mcp` (mcp-ceiling closure)
- **`samples/` sibling dir** (cached example outputs per kind for context on re-runs)
- **Per-kind microscope versioning/changelog**
- **Hard-rule post-processor** (mechanical compliance scanner if prompt-level trust insufficient)
- **Cross-vault `inherits_from`** for microscope contracts
- **Multiple-microscope-per-kind** (cadence-specific: `microscope-morning.md` vs `microscope-eod.md`)

If the test surfaces gaps not covered above, add them to `Docs/agent-guides/cycle-status.md` in-flight queue and reference from the test-results doc.

---

## Part 7 — Quick command cheatsheet

```bash
# Verify vault state
cd <vault>
jq -r '.workshop_version, (.blueprints[]|select(.name=="cowork")|.version)' ranch/platform-installed.json

# Upgrade vault to latest
cd <vault>
sauce update --bump-pins

# Force re-install (rarely needed):
cd <vault>
sauce reinstall --vault .

# Workshop dogfood (only on dev machine):
cd /Users/willfellhoelter/projects/repos/sauce
node platform/install.js --vault . --auto-approve
# OR equivalent harness-driven:
node platform/test/run-install.js . --auto-approve

# Workshop full preflight (only on dev machine):
cd /Users/willfellhoelter/projects/repos/sauce
npm run release:preflight

# Run cowork smoke individually (only on dev machine):
cd /Users/willfellhoelter/projects/repos/sauce
node platform/test/run-cowork-smoke.js

# brew lifecycle:
brew update
brew upgrade sauce
brew list sauce --versions   # expect: sauce 0.81.1
```

---

## End

This guide + `Docs/plans/2026-05-30-headspace-test-plan.md` (the action-only Steps 0-7) + `Docs/plans/2026-05-30-cowork-cohort-summary-and-headspace-onboarding.md` (the cohort summary) are the three docs to load into any chat that picks up this thread. Every cross-reference between them is intentional + verified.

Sleep, then test, then capture, then we iterate on v0.82+ design.
