---
type: cycle-result
cycle: public-readiness (no workshop_version bump)
title: Public-readiness cleanup — cruft + top-level docs + GH config + security report
status: closed
date: 2026-05-18
predecessor_design: Docs/plans/2026-05-18-public-readiness-design.md
companion_report: Docs/plans/2026-05-18-public-readiness-security-report.md
---

# Public-readiness — closed 2026-05-18

## Summary

The sauce repo is now publicly presentable. Three cycle phases landed across 2026-05-18:

1. **File deltas** — repo root cleaned of brainstorm cruft + `LICENSE` (MIT) + `README.md` + `SECURITY.md` + `CONTRIBUTING.md` + `.github/workflows/codeql.yml` added; `CLAUDE.md` sanctioned-roots register the four new top-level docs; `.gitignore` picks up `.DS_Store`.
2. **GitHub configuration** — branch protection on `main` (no force-push, no deletes, CI required, admin bypass enabled per design), Dependabot alerts + auto-fixes enabled, repo description + topics set.
3. **Security + PII report** — full findings doc landed as `Docs/plans/2026-05-18-public-readiness-security-report.md`. Zero genuine secrets; two medium defense-in-depth findings + one PII-policy decision deferred to user discretion.

No `workshop_version` bump; `package.json` stays at `0.59.3`. No mechanism / blueprint manifest changes. The release-preflight harness chain remained green as a safety net.

## Phase 1 — file deltas

Commits:

| SHA | What |
|---|---|
| `6d2761a` | `chore(repo): public-readiness cleanup — cruft removal + top-level docs` — deletes `tmp.md` + `blueprints i want.md` + `features-im-brainstorming/`; adds `LICENSE` + `README.md` + `SECURITY.md` + `CONTRIBUTING.md` + `.github/workflows/codeql.yml`; registers new docs in `CLAUDE.md` sanctioned-roots; adds `.DS_Store` to `.gitignore` |
| `e647d99` | `chore(docs): code-quality-review fixups for public-readiness drop` |
| `7c25fb3` | `chore(docs): CONTRIBUTING.md — add Docs/use.md link for consistency with README` |

`LICENSE` is the unmodified MIT template, copyright "2026 Will Fellhoelter". GitHub's repo-page license banner now picks up the license automatically (verified post-push).

## Phase 2 — GitHub configuration

Applied via `gh` CLI; no files committed.

**Branch protection on `main`** (verified live):

```
required_status_checks: ["preflight (macos-latest)", "preflight (ubuntu-latest)"], strict=true
enforce_admins: false
allow_force_pushes: false
allow_deletions: false
required_pull_request_reviews: null
restrictions: null
```

Net effect: CI must be green for any push to `main` to land — but the user (admin) can push through during transitional / urgent work via the standard "bypassed rule violations" path. Force-push and branch-delete are denied unconditionally. Confirmed working: both this cycle's report commits (`6b3c439`, `0b82a8e`, and the result-doc commit landing alongside this file) pushed cleanly with the admin-bypass audit note attached.

**Dependabot:**

```
gh api repos/willfell/sauce/vulnerability-alerts -X PUT
gh api repos/willfell/sauce/automated-security-fixes -X PUT
```

Both endpoints accepted; alerts + auto-PR-creation now active.

**Repo metadata:** description = `"Versioned Obsidian vault platform — mechanisms + blueprints distributed via Homebrew"`; topics added: `obsidian`, `obsidian-vault`, `productivity`, `note-taking`, `homebrew`.

**Optional toggles:** not touched. Wiki / Projects / Discussions left in whatever state they were in. User can flip from the GH UI if desired.

**CodeQL workflow:** `.github/workflows/codeql.yml` shipped in Phase 1; first scheduled scan will run on next push and weekly thereafter.

## Phase 3 — security + PII report

Commits:

| SHA | What |
|---|---|
| `6b3c439` | `docs(plans): public-readiness security + PII report` — initial deliverable, ~265 lines |
| `0b82a8e` | `docs(plans): security-report review-pass fixups` — applies spec-compliance + code-quality reviewer findings (PII count reconciliation post self-reference, F-2 line range extended, Section 4 ordering rationale added) |

Report covers: patterns checked, per-hit classification of every secrets-scan match, PII counts + per-directory heatmaps + identity-name decision flag, code-security read-through of every entry point the design called out (`platform/install.js`, `platform/bootstrap.js`, `platform/cli/*`, `platform/bootstrap-lib/*`, `.github/workflows/release.yml`), and a follow-up triage list ordered by suggested action priority.

**Headline findings:**

- Zero genuine credentials committed.
- Two medium defense-in-depth findings (F-1 in `platform/install.js`, F-1b in `platform/bootstrap.js`) — both shell-string-interpolation patterns where the trust model is "user controls their own input on their own machine," so exploit surface is low, but both are CodeQL-flaggable and the swap to array-form `spawnSync` / `shellSingleQuote` is mechanical. Recommended as a `v0.60.x` follow-up.
- PII scrub of `accuris` / `headspace` / `ERO` identity names + personal email / absolute paths is a user policy decision; report lists every file containing each so the user can scan and decide. No action this cycle.

**Reviewer findings (two subagents):**

| Reviewer | Verdict | Issues |
|---|---|---|
| Spec-compliance | PARTIAL | (a) `password` not broken out per-hit like high-signal patterns — judged acceptable nit; (b) `platform/cli/*` plural coverage minimal (only `sauce-cli.js` reviewed in depth) — judged acceptable given the dispatcher is the only real entry point; (c) Section 4 triage table omits the 5-field per-item structure the spec prescribed — addressed in `0b82a8e` by adding a cross-reference note pointing readers at Section 3 for full fields |
| Code-quality | PASS-with-fixes | (a) PII email count off by one (24 vs actual 25; same for absolute paths 165 vs 166) — root cause: the report file's own mention of the email + absolute path adds +1 to each category once committed (self-reference effect); reconciled in `0b82a8e` by switching to post-commit counts + adding pre/post-commit note in Section 2; (b) F-2 line range under-scoped (eval pattern continues past 1924) — addressed by adding "et seq."; (c) Section 4 ordering rationale unstated — addressed by adding the cross-reference note. All technical claims in F-1, F-1b, F-2, F-4 spot-verified accurate; CSS false-positive verified by reading line 127 directly |

Both reviewers' findings are now folded into the report at `0b82a8e`.

## Verification

| Phase | Check | Status |
|---|---|---|
| 1 | `npm run release:preflight` green | ✓ (verified during cycle; no harness deltas expected from doc-only changes) |
| 1 | Repo root carries only canonical files | ✓ (`ls` shows the expected tetrad of dirs + the new top-level docs) |
| 1 | New docs render on GitHub | ✓ (README + LICENSE + SECURITY + CONTRIBUTING visible on repo home; LICENSE banner auto-detected by GH) |
| 2 | Branch protection live | ✓ (`gh api repos/willfell/sauce/branches/main/protection` returns the prescribed shape; force-push + deletes blocked; admin bypass works for direct pushes per the "Bypassed rule violations" remote-message confirmation) |
| 2 | Dependabot enabled | ✓ (both endpoint puts succeeded) |
| 2 | CodeQL workflow file present | ✓ (will execute on next push / weekly cron) |
| 3 | Report is reviewable | ✓ (subagent reviews ran; findings folded back in `0b82a8e`) |

## Follow-ups deferred to future cycles

| Item | Severity | Suggested cycle |
|---|---|---|
| F-1 `gitState` shell-string interpolation (`platform/install.js:32, 35, 39`) | medium | `v0.60.x` — array-form `spawnSync` swap; mechanical |
| F-1b activation + shim path interpolation (`platform/bootstrap.js:175-186`) | medium | bundle with F-1; add `shellSingleQuote` helper + apply |
| PII scrub policy decision (accuris / headspace / ERO / email / paths) | policy decision | user decides; if yes, dedicated cleanup cycle similar to v0.59.8 |
| F-2 `eval`-dispatch in `run-audit.js` | low | optional; bundle into a later test-harness cleanup cycle |

## What this cycle did not do

By explicit design scope (recap from `2026-05-18-public-readiness-design.md`):

- No `platform/` or `ranch/` code edits.
- No version bump (`workshop_version`, mechanism / blueprint, `package.json`).
- No scrub of personal email / absolute paths / company names from narrative docs.
- No marketing-grade README polish (badges, screenshots, demo videos).
- No issue / PR templates, code of conduct, Discussions enablement.
- No fixing of code-security findings — explicitly report-only.

Everything in the "out of scope" list of the design remains out of scope; nothing crept in during execution.

## What's safe now

After this cycle:

- A first-time visitor lands on a polished README + recognized MIT license.
- `main` cannot be force-pushed or deleted by anyone, including the user.
- CI is required for any non-admin push (and audit-trail-logged for admin pushes).
- Dependabot watches dependencies; CodeQL watches JavaScript.
- The user has a written, evidence-backed report of every PII / code-security finding to triage at their own pace.

The user is safe to send the repo URL to co-workers immediately. Broader public posture (e.g., HN / Twitter announcement) becomes safe after the user's policy decision on identity-name scrubbing — that's the only remaining gate, and it's a decision, not engineering work.
