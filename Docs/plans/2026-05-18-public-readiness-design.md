---
type: cycle-design
cycle: public-readiness (no workshop_version bump)
title: Public-readiness cleanup — cruft removal, top-level docs, GitHub config, security/PII report
status: design-approved
date: 2026-05-18
predecessor_result: Docs/plans/2026-05-16-v0.49.2-result.md
brainstorm_session: this doc (composed live 2026-05-18 via /superpowers:brainstorming)
---

# Public-readiness design — cruft removal, top-level docs, GH config, security report

## Background

### Why this cycle exists

The sauce repo is publicly visible at `https://github.com/willfell/sauce` but has never been intentionally packaged for outside eyes. The user wants to send the repo to co-workers and is open to a fully public posture afterward. Two gaps block that: (1) the repo root carries noise from earlier brainstorm sessions that doesn't belong in a polished tree, and (2) there is no `LICENSE` / `README.md` / `SECURITY.md` / `CONTRIBUTING.md`, which means a first-time visitor has no entry point and no legal grant to use the code.

A second concern: the user wants confidence that the code is safe to expose. That has two facets — code-security (read the actual platform code for vulnerability patterns) and GitHub-side security (lock down `main` so only the user can introduce changes). Both belong in this cycle.

### Why "report don't fix" for security findings

Any edit to `platform/`, `ranch/`, or the 15 test harnesses risks regressing the live workflow (cycle history v0.1.0 → v0.59.3 has 60+ shipped versions). The user explicitly scoped this cycle as hygiene + docs + GH-config only; security findings are surfaced as a follow-up triage list, not patched here. A future cycle (likely `v0.60.x`) can pick up any high-severity findings.

### Why no `workshop_version` bump

Nothing in `platform/` or `ranch/` changes. No mechanism/blueprint manifest changes. `package.json` version stays at `0.59.3`. The release-preflight harness chain still runs as a safety net before pushing — purely defensive.

## Decisions (locked during brainstorm)

| # | Decision | Choice |
|---|---|---|
| Q1 | Visibility / audience verbiage | Skip persona-tuning; build for public-ready quality, let co-workers be the first audience |
| Q2 | License | MIT |
| Q3 | Scope depth | Hygiene + docs + GH config — no `platform/` code edits; no scrub of CLAUDE.md or `Docs/plans/*` |
| Q4 | Shape | 3 phases — file deltas (commit 1), GH config (no commit), security/PII report (commit 2) |

## Findings from initial exploration

| Concern | Status | Detail |
|---|---|---|
| Tracked secrets / API keys / tokens | Clean (false positives only) | Hits: `.obsidian/plugins/*/main.js` (vendored third-party code), `package-lock.json` (npm integrity hashes), `release.yml` (`${{ secrets.HOMEBREW_TAP_TOKEN }}` — correct GH Actions pattern), `platform/mechanisms/styling/assets/themes/Baseline/theme.css` (word "color"), `platform/audit/*` + `platform/cli/cmd-migrate-frontmatter.js` + `platform/bootstrap-lib/*` + `platform/blueprints/scratch/manifest.json` (literal occurrences of "token"/"secret" in code/docs, not credentials). To be re-verified case-by-case in Phase 3 report. |
| Tracked PII — personal email | Present | 22 files contain `willfellhoelter@gmail.com`; concentrated in `CLAUDE.md`, `Docs/plans/*`, `Docs/prompts/*`. Out of scope this cycle. |
| Tracked PII — absolute personal paths | Present | 164 files contain `/Users/willfell` paths (mostly historical predecessor-machine paths in plan docs). Out of scope this cycle. |
| Tracked PII — third-party / company names | Present | Files reference vault names `ERO`, `accuris`, `headspace`. Whether any of those map to real-world clients/employers that need scrubbing is a user judgment call. Report will surface; user decides before broader publicity. |
| CI / release workflows | OK | `.github/workflows/ci.yml` (preflight matrix on macOS + Ubuntu) and `release.yml` (preflight + brew tap bump on tag push) are well-formed; secrets passed via GH Actions secret store, not in YAML. |
| `gh` CLI auth | Available | Authenticated as `willfell` with `repo` scope; can configure branch protection from this session. |
| Cruft files | Bounded | Only 3 paths (`tmp.md`, `blueprints i want.md`, `features-im-brainstorming/`). |

## Scope (in / out)

**In scope:**

- Delete 3 cruft paths from repo root.
- Add `LICENSE`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `.github/workflows/codeql.yml`.
- Additive edit to `CLAUDE.md`: register the 4 new top-level docs in the "Vault identity check" + "Ask before acting" sanctioned-roots sections.
- Touch-up to `.gitignore` (add `.DS_Store` if missing).
- Configure GitHub: branch protection on `main`, Dependabot alerts + auto-fixes, repo description + topics, audit wiki/discussions/projects toggles.
- Write security + PII report to `Docs/plans/2026-05-18-public-readiness-security-report.md`.

**Out of scope (explicit):**

- Any edit to `platform/` or `ranch/` code, or any test harness.
- Any version bump (`workshop_version`, mechanism, blueprint, `package.json`).
- Scrubbing personal email / absolute paths / company names from `CLAUDE.md`, `Docs/plans/*`, `Docs/prompts/*`.
- Marketing-grade README polish (badges, screenshots, GIFs, demo videos).
- Issue templates, PR templates, code-of-conduct, GitHub Discussions enablement.
- Renaming the gitignored-but-on-disk `Scripts/` directory.
- Fixing any code-security findings — those become a follow-up cycle if the user chooses.

## Phase 1 — File deltas (one commit)

### Deletes (3)

- `tmp.md` — single-purpose installer log (`Installer fired at <timestamp>...` lines). Zero forward value.
- `blueprints i want.md` — brainstorm wishlist for Finance + multi-theme support; both items already shipped (finance@0.4.0 in v0.59.0, styling@0.1.2 in v0.19.0+). Contains personal absolute paths to other vaults.
- `features-im-brainstorming/` — directory with one stale brainstorm (`cowork-blueprint.md`); cowork blueprint shipped at v0.7.0.

### Adds (5)

| Path | Purpose | Approximate size |
|---|---|---|
| `LICENSE` | MIT, copyright 2026 Will Fellhoelter | ~22 lines (standard template) |
| `README.md` | First impression + install + 5-minute quickstart | ~150 lines |
| `SECURITY.md` | Private vulnerability reporting channel + disclosure expectations | ~25 lines |
| `CONTRIBUTING.md` | Solo-developed posture; "open an issue first"; pointer to `Docs/how.md` | ~30 lines |
| `.github/workflows/codeql.yml` | GitHub stock CodeQL scan: JavaScript, on push/PR to `main` + weekly cron | ~40 lines |

**`README.md` outline:**

```
# Sauce

> Tagline (one line)

One-paragraph "what Sauce is" — workshop platform that ships mechanisms +
blueprints to consumer Obsidian vaults; pitched at the kind of user who wants
versioned, idempotent vault configuration.

## Install

```bash
brew tap willfell/sauce
brew install willfell/sauce/sauce
sauce bootstrap --vault <path-to-your-vault>
```

## Quickstart

Step-by-step: bootstrap → first install → open Obsidian → run /audit to verify.

## Repo layout

Mini-table of top-level dirs (platform/, ranch/, spice/, .claude/, Docs/, commands/).

## Documentation

Pointers to:
- Docs/Index.md — start here
- Docs/why.md — purpose and end goal
- Docs/how.md — architecture
- Docs/use.md — operational guide
- Docs/landmines.md — traps to avoid

## License

MIT — see LICENSE
```

**`SECURITY.md` content (sketch):**

```
# Security policy

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories:
https://github.com/willfell/sauce/security/advisories/new

Or email: willfellhoelter@gmail.com

I aim to acknowledge reports within 7 days and disclose coordinated fixes
within 90 days.

## Scope

In scope:
- Code in `platform/`, `ranch/`, `commands/`, `scripts/`
- Distribution artifacts (Homebrew formula, install scripts)

Out of scope:
- Personal content placed by consumers under `spice/`
- Third-party Obsidian plugins vendored under `.obsidian/plugins/`
```

**`CONTRIBUTING.md` content (sketch):**

```
# Contributing

Sauce is solo-developed by Will Fellhoelter using a cycle-versioned workflow
(every change ships as a `vX.Y.Z` cycle with design → plan → result docs).

If you found a bug or want to discuss an idea: please open an issue before
sending a PR. PRs without a prior issue may be closed.

For background on how the codebase is organized:
- Docs/how.md — architecture
- Docs/landmines.md — known footguns
- Docs/plans/ — chronological cycle history
```

### Edits (2)

**`CLAUDE.md`:**

1. In the "Vault identity check" section (one sentence around line 27 today), add the four new files to the expected top-level listing: change `Expected top-level: CLAUDE.md, platform/, commands/, Docs/, .obsidian/, ranch/, package.json, install.sh.` → `Expected top-level: CLAUDE.md, README.md, LICENSE, SECURITY.md, CONTRIBUTING.md, platform/, commands/, Docs/, .obsidian/, ranch/, package.json, install.sh.`
2. In the "Ask before acting" section, the "Sanctioned new top-level vault dirs" bullet — add the four new top-level files to the explicit-allowlist sentence.

Both edits are outside any `<!-- @claude-surface:* -->` marker pair (verified during exploration). Pure prose additions.

**`.gitignore`:**

- Add `.DS_Store` at top if not already present (macOS noise).

### Phase 1 verification

- `npm run release:preflight` must stay green (no code changes expected to affect harness output, but the CLAUDE.md edit means safety-net needed).
- Manual smoke: `ls` of repo root shows exactly the canonical set listed in CLAUDE.md (no orphans).

### Phase 1 commit message

```
chore(repo): public-readiness cleanup — cruft removal + top-level docs

- Delete tmp.md + blueprints i want.md + features-im-brainstorming/
- Add LICENSE (MIT), README.md, SECURITY.md, CONTRIBUTING.md
- Add .github/workflows/codeql.yml for ongoing static security analysis
- Register new top-level docs in CLAUDE.md sanctioned-roots
- Add .DS_Store to .gitignore

No version bump; no platform/ranch code changes.
Companion: Docs/plans/2026-05-18-public-readiness-design.md
```

## Phase 2 — GitHub configuration (no commit)

All changes via `gh` CLI; no files committed to the repo (config lives in GitHub itself).

### Repo metadata

```bash
gh repo edit willfell/sauce \
  --description "Versioned Obsidian vault platform — mechanisms + blueprints distributed via Homebrew" \
  --add-topic obsidian \
  --add-topic obsidian-vault \
  --add-topic productivity \
  --add-topic note-taking \
  --add-topic homebrew
```

### Branch protection on `main`

```bash
gh api repos/willfell/sauce/branches/main/protection \
  -X PUT \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["preflight (macos-latest)", "preflight (ubuntu-latest)"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
```

Rationale:

- `allow_force_pushes: false` + `allow_deletions: false` — no one (including the user) can rewrite or remove `main` history accidentally.
- `enforce_admins: false` — admin (the user) can still direct-push, matching the CLAUDE.md "single-branch workflow, direct push to main" convention.
- `required_pull_request_reviews: null` — no PR review required (solo dev).
- `required_status_checks` — CI's `preflight` matrix jobs (macOS + Ubuntu) must be green for any push to `main` to succeed. The exact context names will be confirmed against the latest CI run before applying (GH derives them from the `runs-on` matrix expansion).
- `restrictions: null` — this field is only meaningful for org-owned repos (used to whitelist teams/users that can push); for personal repos it must be `null`.

The net effect: the user remains the only person with write access (personal repo, no collaborators), AND additionally cannot force-push or delete `main` even on a bad day. This satisfies "only I can make changes" via two layers — access control and branch protection.

### Dependabot

```bash
gh api repos/willfell/sauce/vulnerability-alerts -X PUT
gh api repos/willfell/sauce/automated-security-fixes -X PUT
```

### Optional toggles (read first, ask before flipping)

```bash
gh api repos/willfell/sauce | jq '{has_wiki, has_projects, has_discussions, has_issues}'
```

Likely action: disable `has_wiki` and `has_projects` if unused (less clutter); keep `has_issues` enabled; `has_discussions` user's call.

### Phase 2 verification

```bash
gh api repos/willfell/sauce/branches/main/protection | jq '{allow_force_pushes, allow_deletions, required_status_checks: .required_status_checks.contexts, enforce_admins: .enforce_admins.enabled}'
```

Expected output confirms `allow_force_pushes.enabled=false`, `allow_deletions.enabled=false`, both required-check contexts present, `enforce_admins.enabled=false`. Do NOT attempt an actual force push to test — it's destructive even if rejected (the rejection itself is the test signal but the attempt risks confusion).

## Phase 3 — Security + PII report (second commit)

Path: `Docs/plans/2026-05-18-public-readiness-security-report.md`.

### Report structure

1. **Executive summary** (3 sentences max).
2. **Secrets scan**
   - Patterns grepped: `api[_-]?key`, `secret`, `token`, `password`, `bearer`, AWS access key regex, OpenAI `sk-` prefix, GitHub PAT `ghp_` prefix, Slack `xox[bpsa]-` prefix.
   - Each hit listed with file + reason (false-positive classification or genuine secret — none expected based on initial sweep).
   - Verdict.
3. **PII scan**
   - Counts: 22 files w/ personal email, 164 w/ absolute personal paths, N files referencing each of {ERO, accuris, headspace}.
   - Heatmap: which directories carry the most.
   - **Decision needed from user:** are any of those names sensitive enough to scrub before broadening visibility? Lists exact files containing each name so the user can scan and decide. No action taken in this cycle.
4. **Code-security read-through** — focused pass on these entry points:
   - `platform/install.js` — installer is the main user-input → filesystem-write path. Look for: path-traversal in vault-path resolution, unsafe `require()` of dynamically-constructed paths, `child_process` spawn patterns, JSON parse without try, template-substitution variable handling that could let a `platform-config.json` value escape its expected role.
   - `platform/bootstrap.js` — interactive wizard. Look for: shell-exec patterns, prompt-input handling, file-write boundaries.
   - `platform/cli/*` — CLI entry points reachable from `brew sauce`. Same patterns.
   - `.github/workflows/release.yml` — already-confirmed-correct secret handling, but re-confirm in report.
5. **Follow-up items** — each finding gets:
   - Title
   - File:line reference
   - Severity (info / low / medium / high)
   - One-paragraph "why this matters"
   - One-paragraph "proposed fix"
   - User triages from here; any high-severity finding may justify a `v0.60.x` follow-up cycle.

### Phase 3 commit message

```
docs(plans): public-readiness security + PII report

Companion to 2026-05-18-public-readiness-design.md.
Findings are report-only — no code fixes applied this cycle.
```

## Verification + rollback

### Verification

| Phase | Check | How |
|---|---|---|
| 1 | Preflight stays green | `npm run release:preflight` |
| 1 | Root is clean | `ls` shows only canonical files |
| 1 | New docs render correctly on GitHub | Visit repo page after push, check README renders, LICENSE detected by GH's license banner |
| 2 | Branch protection live | `gh api repos/willfell/sauce/branches/main/protection \| jq '...'` |
| 2 | CodeQL workflow runs | First push triggers it; check Actions tab |
| 3 | Report is reviewable | User reads it and triages findings |

### Rollback

| Phase | Rollback path |
|---|---|
| 1 | `git revert <sha>` — restores deleted cruft + removes new docs |
| 2 | `gh api -X DELETE repos/willfell/sauce/branches/main/protection` — removes branch protection if it becomes obstructive; Dependabot/CodeQL toggleable from GH UI |
| 3 | `git revert <sha>` — removes report |

## Open questions for the user (post-design)

1. Confirm MIT license author line: "Copyright (c) 2026 Will Fellhoelter" — exact name + year OK?
2. Repo description: "Versioned Obsidian vault platform — mechanisms + blueprints distributed via Homebrew" — OK or prefer different framing?
3. SECURITY.md disclosure window — 90 days is standard, OK?
4. Wiki / Projects / Discussions toggles — ask at Phase 2 time after I read current state.

## Success criteria

- Repo root contains only canonical files; no scratch/brainstorm files visible.
- A first-time visitor to `github.com/willfell/sauce` lands on a polished README that gets them to a working vault in <5 minutes.
- `main` cannot be force-pushed or deleted by anyone (including the user).
- CI must pass for any push to `main` to land.
- Dependabot + CodeQL are watching for vulnerabilities going forward.
- User has a written report on PII / code-security findings to triage at their own pace.
