# Headspace test plan (2026-05-31 morning)

**Audience:** Will Fellhoelter — sit down in the **headspace-sauce** vault tomorrow morning and walk this end-to-end. Per-step expected outcomes are concrete; troubleshooting is inline.

**Vault:** `/Users/willfellhoelter/notes/sauce/headspace-sauce`
**Workshop version at test time:** `0.80.0` (or `0.81.0` if Session 3 ships tonight)
**Cowork blueprint:** `0.19.0` (or `0.20.0` post-Session-3)

**Context entry-points** (read these if anything surfaces questions during the test):

- `Docs/plans/2026-05-30-cowork-cohort-summary-and-headspace-onboarding.md` — full cohort summary + onboarding plan + carry-forward queue.
- `Docs/plans/2026-05-30-night-plan-design.md` — what was shipped tonight; the 3-session roadmap.
- `Docs/plans/2026-05-29-v0.79.0-cowork-microscope-design.md` — the microscope contract design.
- `Docs/plans/2026-05-30-v0.80.0-cowork-sibling-files-design.md` — the sibling-file design.

---

## Step 0 — Visual verification (FLN-v79-1) — DO THIS FIRST

**Why first:** if the per-type callout colors are still monochrome, the rest of the test plan still works but you'll be reading a monochrome briefing — diminished feedback loop. Five minutes to confirm or fix.

**Action:**

1. Open the headspace vault in Obsidian.
2. Create a scratch note (anywhere — e.g., `Cowork/_callout-test.md`) and paste:
   ```markdown
   > [!info]
   > Test info — should be one color.
   
   > [!warning]
   > Test warning — should be a DIFFERENT color from info.
   
   > [!tip]
   > Test tip — should be a third color.
   
   > [!example]
   > Test example — should be a fourth color.
   ```
3. Open the note in Reading view (Cmd+E if you're in edit mode).

**Expected outcome:**

- Four DISTINCT colors. `info` ≠ `warning` ≠ `tip` ≠ `example`.
- Colors should land in the rose-pine-light family in light mode, melange-dark family in dark mode.

**What to do if it's wrong:**

- **All four look the same color (monochrome):** the Baseline theme's Style Settings → Monochrome callout keys are overriding the snippet. Open Style Settings (gear icon → Style Settings, or use the Style Settings community plugin's right-side panel) → Baseline section → toggle off the monochrome callout keys (`callout-info-color`, `callout-warning-color`, `callout-tip-color`, `callout-example-color`) so they fall back to the snippet defaults.
- **Snippet appears unregistered:** check `.obsidian/snippets/sauce-callouts.css` exists in the vault. Check `.obsidian/appearance.json` `enabledCssSnippets` includes `"sauce-callouts"`. Both should already be present from `sauce update --bump-pins` last night. If missing, re-run `sauce update --bump-pins` from inside the vault.
- **Colors look bad / wrong hue:** edit `platform/mechanisms/styling/data/style-settings-default.json` in the workshop, re-run preflight + dogfood + ship a styling PATCH. (Defer to tomorrow; doesn't block the rest of this test.)

**Once Step 0 passes:** proceed to Step 1. Capture a screenshot of the four-color callout note for the post-test delta capture.

---

## Step 1 — Add `hard_rules` + `no_emojis` to user-preferences.md

**Why:** these propagate to ALL three output layers (voice contract + gather-from-served-by dispatch + write-run-note skeleton). Closes the dominant emoji-leak surface from the 2026-05-29 briefing on the first authored kind.

**Action:**

1. Open `spice/cowork/context/user-preferences.md` in Obsidian (or any editor).
2. Locate the `personality:` block (around line 9 in the existing file).
3. Add these two fields under `personality:` (anywhere; YAML key order is irrelevant — put them at the bottom of the block for clarity):

```yaml
  no_emojis: true
  hard_rules:
    - "never use the word leverage"
    - "no emojis anywhere in section titles, table cells, or bullets"
```

The second rule is redundant with `no_emojis: true` (which composes to a canonical no-emoji rule via `composeEffectiveHardRules`), but adding it explicitly is fine — it just becomes two rules in the composed list. Feel free to add more rules over time as you notice patterns ("never use em-dashes", "always include a source URL when the MCP exposes one", etc.).

4. Save the file.

**Expected outcome:**

- File saves without YAML parser errors.
- Obsidian's frontmatter indexer doesn't complain in the developer console.
- No visible UI changes yet (the rules only take effect on the next orchestrator run).

**What to do if it's wrong:**

- **YAML parse error:** quote the rule strings (they already are in the snippet above). YAML doesn't like unquoted strings with `:` or other YAML-special chars.
- **Obsidian throws on save:** check indentation — should be exactly 2 spaces under `personality:` (matching the other fields in that block).

---

## Step 2 — Author the **finance** microscope (highest-value, top-priority domain)

**Why first:** finance is your TOP-PRIORITY DOMAIN per the existing user-preferences notes (2-year zero-debt $455/wk goal). Deep contract here delivers the most morning-briefing value per unit of authoring time.

**Action:**

1. In a Claude Code session inside `/Users/willfellhoelter/notes/sauce/headspace-sauce`, run:
   ```
   /cowork microscope finance
   ```
2. The skill will run through 6 steps from `edit-microscope/SKILL.md`. Walk through each interactively:
   - **Step 1 (Resolve kind):** confirms `finance` is in your `prefs.priorities`. Should pass silently.
   - **Step 2 (Enumerate tools):** lists the `mcp__copilot-money__*` tools currently in your tool surface. Expect 4-8 tools depending on what copilot-money MCP exposes.
   - **Step 3 (Read existing microscope):** finds none (per-mcp dir doesn't exist yet). Skill proceeds with seed-from-notes mode.
   - **Step 4 (Consent-gated live sample + gap-finding):** asks *"Want me to pull a small sample so my questions are grounded in your real data?"*
     - **Say YES** for finance — the sample is what turns a generic gather into a real one. The skill will pull a few cheap reads, inspect field shapes, surface 1-3 gaps.
     - For each gap, the skill calls `classifyGap` and presents the resolution path:
       - `resolvable-in-gather` → records gather-time instruction.
       - `mcp-ceiling` → unlikely for copilot-money; if surfaced, name a replacement MCP.
       - `user-supplied` → **NEW in v0.80.0**: scaffold a starter sibling file.
   - **Step 5 (Brainstorm preferences, one question at a time):** grounded in tools + sample + gaps. Expected questions: what to surface (you've already said: ALL categories, ALL accounts, daily $100 threshold), how to group (by category? by account? by date?), what to flag/ignore.
   - **Step 6 (Compose/refine):** calls `composeMicroscope` and writes `microscope.md` to `spice/cowork/prompts/per-mcp/finance/microscope.md` + `## References` section enumerating any scaffolded siblings.
   - **Step 7 (Confirm):** shows you the written path and a one-line summary.

**Expected outcome:**

- New file: `spice/cowork/prompts/per-mcp/finance/microscope.md` containing:
  - `## What matters` — your deep contract (debt-tracking-aware, daily threshold, category outliers).
  - `## Tools & how to use them` — enumerated copilot-money tools with any per-tool gather instructions.
  - `## Gaps & handling` — gap classifications.
  - `## Output shape` — bulleted, grounded, category-aware.
  - `## References` (if any siblings scaffolded) — `- **<name>** — <role>` entries.
- Optionally one or more sibling files at `spice/cowork/prompts/per-mcp/finance/<name>.md`. **Expected sibling candidates:**
  - `account-aliases.md` (`| id | nickname |`) — if transactions show internal account IDs you'd rather see by nickname.
  - `vendor-aliases.md` (`| key | value |`) — if merchant names render badly (e.g., `STARBUCKS #00873 SEATTLE` → `Starbucks`).
  - `vip-vendors.md` (`| id | reason |`) — vendors to elevate (rent, mortgage, debt payment) so they always show even below the daily $100 threshold.

**What to do if it's wrong:**

- **Skill not found:** verify `.claude/skills/cowork/edit-microscope/SKILL.md` exists in the vault. If not, re-run `sauce update --bump-pins` and re-list `.claude/skills/cowork/`.
- **`composeSibling` is not a function:** the materialized SKILL.md points at the workshop helper. Make sure the workshop is at `0.80.0+` (`cat /Users/willfellhoelter/projects/repos/sauce/package.json | grep version`).
- **Microscope writes to the wrong path:** the SKILL.md step 6 says `spice/cowork/prompts/per-mcp/<kind>/microscope.md` — kind should be `finance`. If it lands somewhere else, file an issue.
- **Sibling scaffold writes but doesn't appear in `## References`:** check `siblings_to_reference` was passed into `composeMicroscope` at step 6 — see `edit-microscope-helper.js:38` (the `composeMicroscope` signature must include `siblings_to_reference`).

---

## Step 3 — Author the **chat** microscope

**Why second:** highest interaction volume in your daily life. The inner-circle thesis is well-articulated already; microscope makes the per-person elevation rationale explicit.

**Action:**

1. ```
   /cowork microscope chat
   ```
2. Walk through the 6 steps.

**Expected gaps to surface:**

- **iMessage number→name:** classified as `resolvable-in-gather` via `search_contacts` (v0.79.0 closed this — the skill encodes the instruction in the gather contract automatically). If it instead classifies as `user-supplied`, that's a regression worth flagging.
- **WhatsApp privacy cap:** classified as `mcp-ceiling`. Skill names `lharries/whatsapp-mcp` (whatsmeow-backed, message-level depth) as the swap candidate. Don't swap tonight — note it as a follow-up.
- **Inner-circle elevation rationale:** classified as `user-supplied` → scaffold `vip-list.md` (`| id | reason |`). Your 10 inner-circle names already exist in `user-preferences.md`; the sibling captures the per-person rationale ("Mom — always", "Diana — fiancée", "Lance — co-founder — anything urgent").

**Expected outcome:**

- `spice/cowork/prompts/per-mcp/chat/microscope.md`
- Optionally: `spice/cowork/prompts/per-mcp/chat/vip-list.md` (if you scaffolded one — recommended).
- The microscope's `## Tools & how to use them` should include the iMessage `search_contacts` instruction.
- The microscope's `## Gaps & handling` should explicitly mention WhatsApp's MCP ceiling.

**What to do if it's wrong:** same troubleshooting as Step 2.

---

## Step 4 — Author the **email** microscope

**Why third:** lower volume but VIP detection benefits from the deep contract. The `*fellhoelter*` pattern in user-preferences is already strong; microscope makes it explicit.

**Action:**

1. ```
   /cowork microscope email
   ```
2. Walk through the 6 steps.

**Expected gaps to surface:**

- **VIP sender resolution:** classified as `user-supplied` → scaffold either `senders-map.md` (`| email | name |`) for personal contacts whose email addresses are opaque, OR `vip-list.md` (`| id | reason |`) for explicit elevation rationale.
- **Spam volume:** the existing `ignore_lists: true` and aggressive spam-filter notes should encode as gather instructions (no sibling needed).

**Expected outcome:**

- `spice/cowork/prompts/per-mcp/email/microscope.md`
- Optionally: a sibling file capturing your VIP senders with per-sender rationale.

---

## Step 5 — Author the **calendar** microscope (optional, lowest priority)

**Why last (or skip):** M365 calendar MCP is well-typed; canonical `cowork:gather-calendar` may already feel deep enough. Only author a microscope if the existing calendar section in briefings feels shallow after Step 6.

**Action:**

1. ```
   /cowork microscope calendar
   ```
2. Walk through — most gaps should classify as `resolvable-in-gather` (M365 exposes most fields well). `user-supplied` gaps are rare for calendar.

**Expected outcome:**

- `spice/cowork/prompts/per-mcp/calendar/microscope.md` (optional).
- Likely NO siblings (calendar data is typically self-describing).

---

## Step 6 — Trigger a morning-briefing and compare to 2026-05-29

**Action:**

1. Either:
   - **Wait for the cron** (it should fire at your usual morning-briefing time tomorrow). Cron is registered via `cowork:onboard-scheduled-jobs`.
   - **Or trigger manually:** in a Claude Code session inside the headspace vault, run `/cowork morning-briefing` (or invoke the orchestrator skill directly).

2. Read the resulting atomic note (rendered at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD-Morning-Briefing.md` per the v0.78.0 atomic-note path convention).

3. Compare to the 2026-05-29 briefing using this delta table:

| Gap | 2026-05-29 (baseline) | Post-onboarding (today) | Verdict |
|---|---|---|---|
| Emojis in section titles + table cells + narratives | Present | Gone (hard_rules propagated) | PASS / FAIL? |
| Callouts (info/warning/tip/example) all same color | Yes (monochrome) | Distinct colors per type | PASS / FAIL? |
| Finance section depth | 4 generic bullets, no category awareness | Deep contract; debt-tracking-aware; daily $100 threshold; category outliers surfaced | PASS / FAIL? |
| Chat (iMessage) phone numbers | Raw phone numbers in bullets | Names resolved via `search_contacts` | PASS / FAIL? |
| Chat (WhatsApp) depth | Privacy-capped 4 bullets | Same depth (mcp-ceiling unchanged) — note swap candidate visible | PASS / FAIL? |
| Email VIP signal | `*fellhoelter*` glob only | Explicit `senders-map.md` / `vip-list.md` elevation rationale | PASS / FAIL? |
| Inner-circle elevation in chat | Names elevated but no rationale | Names elevated with per-person rationale from `vip-list.md` | PASS / FAIL? |

4. Fill in the PASS / FAIL column. If any row is FAIL, capture the briefing text + the relevant microscope/sibling content; that's input for the next cycle's design.

**Expected outcome:**

- Most rows PASS. The two most likely FAIL rows:
  - **WhatsApp depth** — known mcp-ceiling, unresolved until MCP swap.
  - **Finance category outliers** — depends on how aggressive the live-sample step was. If sparse, the microscope contract may need a re-author pass with deeper questions.

**What to do if it's wrong:**

- **Emojis still leak:** check that `personality.no_emojis: true` saved correctly. Check that `read-user-preferences-helper.js`'s `composeEffectiveHardRules` is composing the canonical no-emoji rule (run the smoke harness to confirm).
- **Callouts still monochrome:** Step 0's troubleshooting applies. If Step 0 was clean and now they're monochrome again, something changed the Style Settings — investigate.
- **Finance still shallow:** re-author with `/cowork microscope finance` and answer the live-sample questions more aggressively. The deepen-pass branch of `composeMicroscope` appends rather than replaces.
- **Chat names not resolved:** check the chat microscope's `## Tools & how to use them` actually says "call `search_contacts` before summarizing." If missing, re-author.

---

## Captured feedback to feed back into the next cycle

After Step 6, capture:

1. **The delta table** (verbatim, with PASS/FAIL filled in).
2. **Any new gaps** that surfaced during authoring (gaps NOT classified into the existing 3 paths).
3. **Friction points** in the capture-loop UX — what felt clunky, what felt magical, what felt missing.
4. **Sibling-file surprises** — did `composeSibling`'s column heuristic pick the right columns? Was a gap not covered by any heuristic?
5. **Visual issues** (callout colors, callout-color-vs-text-color contrast, etc.).

Drop the capture into a new note under `Docs/plans/2026-05-31-headspace-test-results.md` and reference it from the cohort summary's §8.

---

## Pre-authored copy-paste block (Step 1 convenience)

```yaml
  no_emojis: true
  hard_rules:
    - "never use the word leverage"
    - "no emojis anywhere in section titles, table cells, or bullets"
```

Drop directly under the `personality:` block in `spice/cowork/context/user-preferences.md`.

---

## Quick troubleshooting reference

| Symptom | Likely cause | Fix |
|---|---|---|
| `/cowork microscope <kind>` says skill not found | Materialization stale | `sauce update --bump-pins` inside the vault |
| Helper throws "is not a function" | Workshop at wrong version | `cd /Users/willfellhoelter/projects/repos/sauce && git log --oneline -3` — should include v0.80.0 commits |
| YAML parse error on user-preferences.md | Indentation drift | Should be 2-space indent under `personality:` |
| Microscope.md writes to wrong path | SKILL.md step 6 path bug | Check `edit-microscope/SKILL.md` step 6 says `spice/cowork/prompts/per-mcp/<kind>/microscope.md` |
| Sibling not injected into briefing | Step 2c filter excluded it | Check filename doesn't start with `_` and isn't `microscope.md` itself |
| Briefing emits old format | Cron fired before sauce update | Manually re-trigger with `/cowork morning-briefing` |
| `[!warning]` accidentally hits hard_rules | Bug — warnings are exempt | File an issue; canonical `[!warning]` strings are supposed to be exempt per v0.79.0 |

---

## End-of-test checkpoint

When you finish Step 6, the headspace vault should have:

- ✅ FLN-v79-1 visual gate cleared (distinct callout colors).
- ✅ `personality.no_emojis: true` + `personality.hard_rules: [...]` in user-preferences.md.
- ✅ `spice/cowork/prompts/per-mcp/` directory created with 2-4 `<kind>/microscope.md` files + 0-4 sibling files.
- ✅ A fresh morning-briefing rendered with deeper finance + name-resolved chat + VIP-elevated email + distinct callout colors.
- ✅ The delta table filled in, captured to `Docs/plans/2026-05-31-headspace-test-results.md` (in the workshop, not the vault).

That's the success criteria for tomorrow.
