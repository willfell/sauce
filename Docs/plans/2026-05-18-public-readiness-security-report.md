---
type: cycle-report
cycle: public-readiness
title: Public-readiness security + PII report
status: report-only
date: 2026-05-18
companion_design: Docs/plans/2026-05-18-public-readiness-design.md
---

# Public-readiness security + PII report

## Executive summary

No genuine credentials are committed to the repository — every high-signal regex hit on the tracked file set classifies as a false positive (minified third-party plugin code, CSS substring coincidence, or this report's own pattern list). Two real-code references to `process.env.GITHUB_TOKEN` exist in `platform/bootstrap-lib/` and follow the correct optional-auth pattern (header set only when the env var is defined; no value hardcoded). One defense-in-depth hardening opportunity exists in `platform/install.js` (`gitState`) where a user-controlled path is interpolated into a shell-command string — exploit surface is low for the trust model (attacker would need to write to the user's own `platform-config.json`), but the array-form `spawnSync` swap is mechanical.

PII findings are concentrated in `Docs/prompts/` and `Docs/plans/` as expected. The notable surprise versus the design doc's initial sweep is that the consumer-vault identity names `accuris` and `headspace` appear in `platform/` code (not only in narrative docs): mostly as comments and example values, but `platform/migrate/commit.js` does carry `accuris` as a literal fallback for `vault_identity_tag`. Whether to scrub the names is a user judgment call; this report does not act on it.

## Section 1 — Secrets scan

### Patterns checked

The scan ran against `git ls-files` (tracked files only):

- High-signal regex (`/tmp/sauce-pr/scan-hi.txt`): `api[_-]?key`, `bearer ` (space-terminated), `ghp_`, `sk-[A-Za-z0-9]{10,}`, `xox[bpsa]-`, `AKIA[0-9A-Z]{16}`.
- Low-signal regex (`/tmp/sauce-pr/scan-lo.txt`): `secret`, `password`, `token`.

### High-signal results — 5 file hits, all classified false positive

| File | Reason |
|---|---|
| `.obsidian/plugins/quickadd/main.js` | Vendored third-party plugin. Minified-JS substrings coincidentally match `sk-...` because random alphanumeric blobs of 10+ chars are common in compiled JS. Raising the key-length minimum to 20 chars drops the hit. |
| `.obsidian/snippets/sauce-tasks-icons.css` (line 127) | The literal CSS selector `li.task-list-item > span.task-description` contains the substring `sk-description` (from `ta**sk-**description`), which matches `sk-[A-Za-z0-9]{10,}` because `description` is 11 alphanumerics. False positive. |
| `platform/mechanisms/convenience/assets/snippets/sauce-tasks-icons.css` (line 127) | Same CSS, same `task-description` substring. False positive. |
| `platform/mechanisms/styling/assets/themes/Baseline/theme.css` (line 3146) | Minified CSS; coincidental substring match. False positive. |
| `Docs/plans/2026-05-18-public-readiness-design.md` (line 287) | This cycle's design doc lists the regex patterns themselves as plain text. Self-reference. The same will be true of this report. |

**Verdict:** zero genuine credentials.

### Low-signal results — 296 file hits, all classified

Per-directory heatmap (from `/tmp/sauce-pr/scan-lo-by-dir.txt`):

| Directory | Hits | Classification |
|---|---:|---|
| `.obsidian/plugins/*` | 152 | Vendored third-party code; literal `token`/`secret`/`password` strings inside minified `main.js` blobs. Not maintained here. |
| `Docs/plans/*` | 89 | Narrative text in design / plan / result docs. Includes this cycle's design (which lists scan patterns verbatim). |
| `Docs/prompts/*` | 21 | Copy-paste-ready agent prompts. Pattern words appear in instruction text. |
| `platform/bootstrap-lib/*` | 7 | **Real code** — see callout below. |
| `platform/test/*` | 6 | Test-harness comments using "token" in the parser sense ("YAML scalar token", "substitution token"). |
| `Docs/cycle-history.md` | 6 | Historical narrative. |
| `package-lock.json` | 3 | NPM `integrity` hashes contain the substring `token` in some package names. |
| `platform/mechanisms/*` | 2 | One CSS coincidental-substring hit + one `entity-create/README.md` doc using "tokens" in the substitution sense. |
| `platform/audit/*` | 2 | `walker.js:493` + `entity-create-walker.js:180` — comments using "token" in the parser sense. |
| `Docs/landmines.md` | 2 | Narrative text. |
| `.github/workflows/*` | 2 | **`release.yml:57, 82`** — `${{ secrets.TAP_PR_TOKEN }}`, the correct GitHub Actions secret-reference syntax. The reference points at the org-side secret store; the value itself is not in the file. |
| `platform/cli/*` | 1 | `cmd-migrate-frontmatter.js:522` — comment using "token" in the YAML parser sense. |
| `platform/blueprints/*` | 1 | `scratch/manifest.json:7` — description text. |
| `Docs/use.md`, `Docs/how.md` | 2 | Narrative text. |

### Real-code low-signal hits

Two files touch real authentication tokens at runtime:

`platform/bootstrap-lib/community-plugins-index.js` (lines 46-48):

```js
const token = process.env.GITHUB_TOKEN;
if (token) {
    headers["Authorization"] = "Bearer " + token;
}
```

`platform/bootstrap-lib/fetch-plugin.js` (lines 94-96): identical pattern.

**Classification:** correct optional-auth pattern. The `GITHUB_TOKEN` env var, when present, lifts the bootstrap's GitHub API requests above the unauthenticated rate limit. No token is hardcoded, defaulted, or written to disk; the header is omitted entirely when the env var is absent. Safe to keep as-is.

**Verdict:** zero genuine secrets in the tracked file set.

## Section 2 — PII scan

### Counts (`git grep -lI ...`)

| Category | Tracked file count |
|---|---:|
| Personal email (`willfellhoelter@gmail.com`) | 25 |
| Absolute personal paths (`/Users/willfellhoelter`) | 166 |
| Identity name `ERO` (case-sensitive whole-word) | 39 |
| Identity name `accuris` (case-insensitive) | 187 |
| Identity name `headspace` (case-insensitive) | 153 |

Note: this report file itself contributes one hit each to the email and absolute-path categories (the table above and the executive summary reference both); the pre-commit baseline was 24 / 165. Re-running the same `git grep -lI ...` pipeline after landing this commit reproduces 25 / 166.

### Heatmaps

**Personal email — 25 files (post-commit):**

| Directory | Files |
|---|---:|
| `Docs/prompts/` | 17 |
| `Docs/plans/` | 5 |
| `SECURITY.md` | 1 |
| `platform/blueprints/` | 1 |
| `CLAUDE.md` | 1 |

`SECURITY.md` intentionally lists the email as the disclosure channel — keep. The other 23 are historical references that would need a separate scrub cycle.

**Absolute personal paths — 166 files (post-commit; top directories):**

| Directory | Files |
|---|---:|
| `Docs/plans/` | 94 |
| `Docs/prompts/` | 68 |
| `ranch/bootstrap-last-install.log` | 1 |
| `Docs/how.md` | 1 |
| `Docs/cycle-history.md` | 1 |
| `CLAUDE.md` | 1 |

The vast majority are historical narrative (cycle plans + handoff prompts referencing the user's machine). `CLAUDE.md` and `Docs/how.md` carry the canonical workshop-dev-repo path as live instruction context for future Claude sessions — those are load-bearing.

**Identity names in `platform/` (code, not narrative):**

| File | Reference shape |
|---|---|
| `platform/install.js:2355` | Comment: "smoke at headspace." |
| `platform/migrate/commit.js:149, 157` | **Real code:** `legacyVars.vault_identity_tag \|\| "accuris"` — literal fallback default when migrating legacy vaults that lack the tag. Substantive reference. |
| `platform/migrate/dispatcher.js:22` | Comment: "Source vaults that are 1.5GB+ (e.g., real Accuris) shrink ~30x post-skip." |
| `platform/blueprints/cowork/commands/cowork.md:25,75` | User-facing example values + reference to a cross-machine handoff doc. |
| `platform/blueprints/cowork/skills/orchestrators/bootstrap-vault/SKILL.md:111` | User-facing prompt example: `(lowercase-hyphens, e.g., "accuris", "ero-acme", "personal")`. |
| `platform/blueprints/cowork/skills/skills/gather-imessage/SKILL.md:19` | TODO comment referencing "the legacy headspace prompt". |
| `platform/blueprints/cowork/skills/skills/patch-daily-callouts/SKILL.md:26-33` | Worked example using `accuris` as engagement name in the morning/EOD callout illustrations. |
| `platform/blueprints/daily/helpers/space-daily-dashboard.js:22, 50` | Comments: "accuris uses the latter" / "accuris-style". Pure narrative; no functional dependency. |
| `platform/blueprints/daily/manifest.json:7` | Long description-field history string referencing "accuris's Timestamps pattern" and "accuris convention". Documents historical motivation; no functional dependency. |
| `platform/blueprints/people/manifest.json:6` | Description string — `"Fixes BUG-2 from headspace Phase 3"`. Historical attribution. |
| `platform/blueprints/project/helpers/project-task-create-listener.js:30` | Comment: "race timing at headspace". |
| `platform/blueprints/project/manifest.json:7` | Long description-field history string referencing several "headspace Phase 3" bugs. Historical attribution. |
| `platform/blueprints/projects-hub-cards.js:5` | Comment: "Mirrors accuris's Planning-Board active-projects pattern." |

**Decision needed from the user (not acted on this cycle):**

1. Is `accuris` the real-world name of a current/former client or employer that needs to be scrubbed before broadening visibility, or is it usable as-is?
2. Same question for `headspace` and `ERO`.
3. If any of the three is sensitive, the cleanest scrub path is a single cycle that runs `git grep -lI <name>` for each, splits hits into (a) `platform/` code-and-manifest references — replace with a neutral alias (e.g., `vendor-a`, `acme`) where the literal value is structurally load-bearing (notably `platform/migrate/commit.js:149/157`) and re-word where it's narrative-only; (b) `Docs/plans/`, `Docs/prompts/`, `Docs/cycle-history.md` — replace in place (historical accuracy concedes to privacy). The user's own personal email + absolute paths can be scrubbed in the same pass if they ever go beyond "co-workers with context."

## Section 3 — Code-security read-through

Scope: the user-input → filesystem-write entry points called out in the design (Phase 3 → `install.js`, `bootstrap.js`, `platform/cli/*`, `platform/bootstrap-lib/*`, `.github/workflows/release.yml`). Approach: targeted grep for known-dangerous patterns (`child_process`, `exec`, `eval`, `new Function`, dynamic `require`, `JSON.parse`) routed through scratch files, plus direct reads of every flagged site.

### Findings

#### F-1 (medium) — `platform/install.js:32, 35, 39` — `gitState` interpolates user-controlled path into shell string

Three `execSync` calls build their command via template literal containing `${workshopPath}` wrapped in double quotes:

```js
result.commit = execSync(`git -C "${workshopPath}" rev-parse HEAD`, ...).trim();
const out    = execSync(`git -C "${workshopPath}" describe --tags --exact-match HEAD 2>/dev/null`, ...).trim();
const status = execSync(`git -C "${workshopPath}" status --porcelain`, ...);
```

**Why this matters:** `workshopPath` resolves from `config.workshop_path` (a free-form string in `ranch/platform-config.json`) or `resolveWorkshopPath()`. The surrounding double quotes only protect against whitespace and most metacharacters — a path containing a literal `"` would close the quote and let the rest run as shell input. Realistic exploit surface is low (the path lives in the user's own config on the user's own machine; an attacker would need to write into that file, at which point they have the user's filesystem already), but the fix is mechanical defense-in-depth.

**Proposed fix:** swap the three `execSync(template-literal, opts)` calls for `spawnSync("git", ["-C", workshopPath, ...], opts)`. Array-form arg passing skips shell parsing entirely — no quoting concerns regardless of what `workshopPath` contains. Matches the pattern already used elsewhere in this file (the `runInstall` spawn at line 7595) and across `platform/cli/*` (every other `spawnSync` site in the codebase uses array form).

**Severity:** medium (defense-in-depth on user-controlled config; not exploitable in the current trust model).

#### F-1b (medium) — `platform/bootstrap.js:175-186` — generated activation + `sauce` shim interpolate paths into shell-script bodies

`phaseWriteActivation` writes two files to disk that the user later sources or executes:

```js
const actBody = `# Sauce activation — sourced into your shell.
export SAUCE_VAULT="${vaultPath}"
case ":$PATH:" in
  *":${scriptsDir}:"*) ;;
  *) export PATH="${scriptsDir}:$PATH" ;;
esac
echo "sauce active. Try: sauce status"
`;
const binBody = `#!/usr/bin/env bash
exec node "${cliPath}" "$@"
`;
```

**Why this matters:** the JavaScript template literal interpolates the three path values verbatim into the shell-script body. When bash later sources `activate` (or runs `sauce`), it re-parses those double-quoted strings — and bash double-quoting still expands `$VAR`, backticks, `$(...)`, and `\`. A `vaultPath` containing any of those characters produces a broken or executes-extra-shell activation file. The same trust caveat as F-1 applies (user's own CLI args), but the failure mode is worse here because the generated file persists on disk and runs every time the user opens a shell.

**Proposed fix:** shell-escape each interpolated value before substitution. A minimal helper:

```js
function shellSingleQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
```

Then write `export SAUCE_VAULT=${shellSingleQuote(vaultPath)}` (no outer double quotes — single-quoted strings in bash are not subject to variable / backtick expansion, only `'` itself needs escaping, handled by the helper). Apply to `scriptsDir`, `cliPath`, and `vaultPath`. Same change in both the activation body and the bin shim.

**Severity:** medium (same defense-in-depth class as F-1; persistent file makes the failure mode slightly worse than a one-shot `execSync`).

#### F-2 (low) — `platform/test/run-audit.js:1909-1924 et seq.` — `eval` inside test-runner dispatch

The audit test runner dispatches to per-category case fixtures with `eval(\`caseAU${i}\`)`, where `i` is a counter from a literal range. The CLI argument `selector` chooses the range, not the eval-payload, so the eval string is fully determined by a number in a hardcoded loop. The same pattern recurs in additional selector branches past line 1924 — a CodeQL scan will surface every instance.

**Why this matters:** `eval` is a code-smell signal; static analysis flags it. It is not user-input-driven here, but the pattern triggers reviewers / GitHub's CodeQL scan and is less readable than a switch.

**Proposed fix:** replace each `eval(\`caseAU${i}\`)` with a lookup against a literal `const cases = { caseAU1, caseAU2, ... }` map, or with `(globalThis[\`caseAU${i}\`] || throws)`. Cosmetic — but cuts a CodeQL surface in the dev-tooling subtree.

**Severity:** low (dev tooling, not shipped to consumers via the Homebrew formula; eval payload is fully literal).

#### F-3 (info) — `platform/test/*.js` use of `new Function()` to load source bodies

`platform/test/run-entity-create.js`, `run-helper-cases.js`, `run-renderer.js` each load workshop source files into `new Function(...)` to run them in a controlled scope without `require()` side-effects.

**Why this matters:** documents intent (the test-runner needs an isolated VM-ish scope for class-body loading). Source bodies are workshop-controlled (read from `platform/...` paths under `__dirname`); no external input ever lands in the `new Function` body.

**Proposed fix:** none — the pattern is intentional and bounded. Listed here to head off "why is `new Function` in the tree" questions during a third-party review.

**Severity:** info (no fix recommended).

#### F-4 (info — confirms design assumption) — `platform/seeder/seeder.js:18-20` already does input validation

The seeder validates blueprint name against `/^[a-zA-Z0-9_-]+$/` BEFORE using it in a `require(path.join(...))` lookup. Same pattern would protect any future feature that builds a `require()` path from user input. Good baseline; no change needed.

**Severity:** info — documenting an existing safeguard.

#### F-5 (info) — `sauce-cli.js` dispatch is a literal-map lookup

`require(VERBS[verb])` looks safe at first glance because `verb` is CLI input, but `VERBS` is a literal object map declared at the top of the file. Unknown verbs fall through to `if (!VERBS[verb]) throw new Error("unknown verb: ...")` (line 178). User input cannot reach a dynamic-path require.

**Severity:** info — no risk.

#### F-6 (info) — `platform/bootstrap-lib/*` GITHUB_TOKEN handling

Reviewed earlier in Section 1. Pattern is correct (omit header when env var absent; never log the value; never write to disk).

**Severity:** info — no risk.

#### F-7 (info) — `.github/workflows/release.yml` secret handling

`${{ secrets.TAP_PR_TOKEN }}` is a GitHub Actions reference placeholder. The actual token value lives in the repo's Actions secret store; the YAML only carries the reference name. Standard pattern. The same workflow's `runs-on` matrix produces the `preflight (macos-latest)` + `preflight (ubuntu-latest)` context names that Phase 2's branch protection requires — verified at apply-time.

**Severity:** info — no risk.

### Patterns not flagged

For audit-trail completeness, these patterns were searched and produced no findings beyond the items listed above:

- Hardcoded long-form alphanumeric blobs matching `sk-[A-Za-z0-9]{20,}` (the threshold that filters out coincidental `task-description` substrings) — zero hits across the tracked tree.
- AWS access-key pattern `AKIA[0-9A-Z]{16}` — zero hits.
- GitHub personal access token prefix `ghp_` followed by 36 alphanumerics — zero hits.
- Slack token prefixes `xox[bpsa]-` — zero hits.

## Section 4 — Follow-up triage list

Recommended order if the user chooses to act. The table is ordered by suggested action priority (medium-severity code findings first, then policy decisions, then info-class cleanup), not by F-number; full details for each item — including the "why this matters" and the proposed fix — are in the per-finding entries in Section 3.

| # | Title | File:line | Severity | Suggested cycle |
|---|---|---|---|---|
| 1 | `gitState` shell-string interpolation | `platform/install.js:32, 35, 39` | medium | `v0.60.x` — single small patch; 3-line swap to array-form `spawnSync`; no behavior change |
| 2 | Activation + shim path interpolation | `platform/bootstrap.js:175-186` | medium | Bundle with item 1; add `shellSingleQuote` helper + apply to both bodies |
| 3 | PII scrub decision (accuris / headspace / ERO names) | many | n/a (policy decision) | User decides whether to act; if yes, a dedicated cleanup cycle similar to v0.59.8 |
| 4 | `eval`-dispatch in `run-audit.js` | `platform/test/run-audit.js:1909-1924` | low | Optional — bundle into any later test-harness cleanup cycle |
| 5 | Personal email / absolute paths in narrative docs | `Docs/prompts/*`, `Docs/plans/*` | low (privacy, not security) | Bundle with item 3 if the user wants a single comprehensive scrub |

No items are blocking for "send to a co-worker" or for the current public-readiness posture; items 1 and 2 are reasonable candidates if the user later wants to broaden visibility beyond people who already have context on the work history.

## Verification

Scans + reads completed against the working tree at commit `15570f6` (HEAD at the time of this report). Scratch outputs at `/tmp/sauce-pr/scan-*.txt` and `/tmp/sauce-pr/code/*.txt`; these are not committed but can be regenerated by re-running the grep pipeline documented at the top of each section.
