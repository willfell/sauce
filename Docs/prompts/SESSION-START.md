---
purpose: Canonical session-start recipe for any fresh Claude session in the Sauce workshop. Replaces ad-hoc per-cycle handoff bootstrap. Future-session prompt collapses to "Read Docs/prompts/SESSION-START.md and proceed."
canonical: yes
---

# Sauce — session-start recipe

> [!abstract] Use this when starting any fresh session
> This file codifies the durable session-start protocol so future sessions don't need a custom multi-paragraph onboarding prompt. Combined with `CLAUDE.md` (live state) + the most recent `Docs/prompts/<date>-post-v<X.Y.Z>-next-cycle-handoff.md` (cycle-specific carry), this is enough context to safely pick up any cycle.

---

## Step 1 — Pre-flight (do this FIRST, before any work)

```bash
cd /Users/willfellhoelter/projects/repos/sauce   # workshop dev repo on the current machine; substitute the equivalent path elsewhere
git fetch origin && git status     # expect: clean tree (only pre-existing dogfood drift)
git log --oneline -10              # confirm latest commits + tag
```

**Expect:** working tree on `main` with only pre-existing dogfood drift (`.obsidian/*` + `blueprints i want.md` + occasional `*.bak`/untracked `features-im-brainstorming/*`). Latest commit should match what's pushed to `origin/main`.

If working tree shows other modifications, STOP and surface to user before proceeding.

## Step 2 — Read the cycle context

> [!todo] In this order
> 1. **`CLAUDE.md`** — non-negotiables + live state (workshop version, mechanisms, blueprints, harness counts, landmines summary, next-TBD pointer).
> 2. **`Docs/prompts/<date>-post-v<X.Y.Z>-next-cycle-handoff.md`** — the most recent dated handoff doc (sort by name desc; pick latest).
>    - Locate via: `ls -t Docs/prompts/*-next-cycle-handoff.md | head -1`
>    - This doc contains the CYCLE-SPECIFIC carry: which cycle is next, recommended candidates, design considerations, slash command for the next session.
> 3. **`Docs/cycle-history.md`** — archived per-cycle status snapshots (v0.1.0 through most recent close). Reference for past lessons + cycle-shape patterns.
> 4. **`Docs/landmines.md`** — 19+ entries codifying traps from prior cycles. Always non-negotiable.

## Step 3 — Check for open dated plans without result-doc siblings

```bash
ls Docs/plans/2026-*.md | sed 's/-design.md\|-plan.md\|-result.md//' | sort -u | while read base; do
  for kind in design plan result; do
    [ -f "${base}-${kind}.md" ] || echo "MISSING: ${base}-${kind}.md"
  done
done
```

**Expected:** zero MISSING lines. If a dated cycle has a `-design.md` or `-plan.md` but NO `-result.md`, it indicates an in-flight cycle. STOP + ask user how to proceed.

**Brainstorm-shelf items** (e.g., `Docs/plans/<date>-<topic>-design.md` with no plan/result siblings) are explicitly future-cycle candidates and DO NOT count as in-flight cycles. The most recent handoff doc should reference any such shelf items.

## Step 4 — Verify all 5 harnesses GREEN

```bash
node platform/test/run-bootstrap.js   2>&1 | tail -2
node platform/test/run-cli.js         2>&1 | tail -2
node platform/test/run-install-sh.js  2>&1 | tail -2
node platform/test/run-helper-cases.js 2>&1 | tail -2
node platform/test/run-renderer.js    && echo "renderer exit 0"
```

Expected counts move per-cycle. Reference the live `CLAUDE.md` Harness summary line for current numbers. Any harness FAIL on a fresh checkout means something regressed since last close — STOP + investigate.

## Step 5 — Follow the handoff doc

The handoff doc from Step 2 contains the slash command for the next cycle and the recommended candidates. Invoke `/de:brainstorming` with the slash command body (or whatever sub-skill the handoff specifies).

---

## Cycle close convention (durable)

**Every cycle ends by writing the next handoff doc.** This is non-negotiable so future sessions can pick up cleanly.

End-of-cycle artifact list:

1. **`Docs/plans/<YYYY-MM-DD>-v<X.Y.Z>-<topic>-result.md`** — what shipped, what surfaces hit, NEW lessons, carry-forward items, commits.
2. **`Docs/plans/<YYYY-MM-DD>-v<X.Y.Z>-<topic>-plan.md`** — implementation plan (created during cycle).
3. **`Docs/plans/<YYYY-MM-DD>-v<X.Y.Z>-<topic>-design.md`** — design doc (created during cycle).
4. **`CLAUDE.md`** — status pointers updated (cycle order, workshop version, mechanisms, blueprints, harness counts, landmines summary, next-TBD pointer).
5. **`Docs/install.md`** — Upgrading-from-vX.Y.Z section.
6. **`Docs/landmines.md`** — history block updates (#12 + others as relevant).
7. **`Docs/prompts/<YYYY-MM-DD>-post-v<X.Y.Z>-next-cycle-handoff.md`** — NEXT cycle's onboarding doc (this is what Step 2 reads). Always written; never optional.
8. **Annotated git tag** `v<X.Y.Z>` at HEAD (REQUIRES user approval per CLAUDE.md ask-before-acting).

**Single cycle-close commit** bundling artifacts 1, 4, 5, 6, 7. Then push to origin/main, then tag (after user approval). Optionally bundle `chore(docs):` updates into the same commit.

---

## When the most-recent handoff is missing or stale

If `Docs/prompts/*-next-cycle-handoff.md` is absent OR clearly stale (predates the latest commit by multiple cycles), the project's session-start state is degraded. STOP and surface to user — do NOT improvise a cycle from CLAUDE.md alone.

The cycle-close convention (above) requires every cycle to author the next handoff doc, so this state should be rare. If it happens, treat as a recovery situation and ask the user to point at the most recent design/plan/result triple to reconstruct context.

---

## Anti-patterns to avoid

- **Don't pre-emptively bump versions** before completing the cycle. Workshop_version is held until S3 close (USER APPROVAL gate per CLAUDE.md).
- **Don't `git add -A`** — always stage explicit files (per v0.23.0 lesson g; reaffirmed at v0.26.0 commit `dea7c41`).
- **Don't dispatch parallel implementer subagents on coupled tasks** — only when files are 800+ LOC apart and posture is shared (v0.21.1 lesson a; reaffirmed v0.27.0 lesson b).
- **Don't skip two-stage subagent review at S2 close** — spec + quality reviewers serve different functions; both required (v0.20.0 lesson d; 8 data points reaffirmation).
- **Don't paraphrase API contracts in subagent prompts** — quote literally (v0.6.0 lesson; reaffirmed v0.21.1 + v0.27.0).
- **Don't author NEW manifests without diffing against canonical precedent** — schema alignment caught at first install attempt (v0.27.0 NEW lesson c).
- **Don't trust "mirror v0.X.0 precedent" without reading the cited file** (v0.27.0 NEW lesson d — `space-nav-buttons.js` had no context routing despite plan claim).

---

## Session boilerplate at session END

Always end the session with:

1. Push the cycle-close commit + handoff doc commit to origin/main (separate commits OK; bundled OK).
2. Show the user the slash command from the next-cycle handoff doc as a copy-paste-ready block.
3. One-paragraph status summary of what shipped.

This protocol means the next session can begin with literally `Read Docs/prompts/SESSION-START.md and proceed.` and have everything it needs.
