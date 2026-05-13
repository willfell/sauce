---
title: Sauce — Homebrew distribution design
date: 2026-05-12
status: design-approved
supersedes: install.sh curl|bash + in-vault `pantry/.git/` clone (current model)
implements: next platform cycle (target v0.34.0+ — separate plan doc to follow)
---

# Sauce — Homebrew distribution design

> [!abstract] Goal
> Make `sauce` a solid CLI across multiple Macs. Same install everywhere, no git failures, no sync-corrupted clones, easy upgrades. Move `pantry/` (the workshop clone with `.git/`) **out of any synced vault** and into Homebrew's prefix. Distribute via a personal tap.

---

## Problem (one paragraph)

`pantry/` today is a real git repo living inside `<vault>/pantry/`. Vaults sync via Dropbox / iCloud / Obsidian Sync; sync tools don't honor `.gitignore`, so `pantry/.git/` travels across machines, corrupts pack files, and leaves the working tree dirty before `sauce update` even runs. The result on a second machine: `sauce update` aborts (dirty tree), or the clone is unusable and `git reset --hard origin/main` can't dig out. **Two confirmed failure modes:** (a) dirty pantry working tree blocking update, (b) sync corruption of `pantry/.git/`. Both have the same root cause: a git repo lives inside synced storage.

---

## Decision

> [!success] Approved approach (2026-05-12)
> - Distribute `sauce` via a **personal Homebrew tap** (`willfell/homebrew-sauce`).
> - `pantry/` moves to **`$(brew --prefix)/Cellar/sauce/<v>/libexec/pantry`** — per-machine, outside any synced vault, no `.git/` in vault.
> - Distribute via **release tarballs**, not a git clone in Cellar (matches Homebrew norms).
> - **Two verbs** for updates: `brew upgrade sauce` (pantry) + `sauce reinstall --all` (vaults). No post-install hook side effects.
> - **`sauce link <path>`** mirrors `npm link` for dev iteration on the workshop checkout.

---

## §1 — Architecture (the move)

**Before:** `<vault>/pantry/.git/` lives inside synced storage. Sync corrupts it. Each vault has its own pantry clone.

**After:** pantry lives in Homebrew's prefix. Vaults contain **only materialized output** (`spice/`, `ranch/`, `.claude/`, allowlisted `.obsidian/` edits). No `.git/` touches synced storage.

### Three on-disk surfaces

| Path | Owned by | Synced across machines? |
|---|---|---|
| `$(brew --prefix)/Cellar/sauce/<v>/libexec/pantry/` | Homebrew (formula) | No — per-machine |
| `~/.sauce/vaults.json` (registry) + `~/.sauce/active-pantry` (dev symlink) | sauce CLI | No — per-machine |
| `<vault>/{spice,ranch,.claude,.obsidian/<allowlisted>}` | sauce installer | Yes — same as today |

### Tap repo (new, public)

- Repo: **`willfell/homebrew-sauce`** (the `homebrew-` prefix is mandatory; Homebrew strips it so users do `brew tap willfell/sauce`).
- Owner: `willfell` (github-personal account).
- Visibility: **Public** (Homebrew formulas reference public release tarballs).
- Local clone path on this machine: `/Users/willfell/Documents/obsidian/sync/homebrew-sauce`.
- Contents (initial): `README.md` only. `Formula/sauce.rb` is generated during implementation, not pre-created.
- Default branch: `main`.

### No new repos beyond the tap

- `willfell/sauce` (existing) keeps its current shape; gains a `release.yml` workflow.
- GitHub Releases require **no manual setup** — source tarballs at `https://github.com/willfell/sauce/archive/refs/tags/v<X.Y.Z>.tar.gz` are auto-generated for every annotated tag.

---

## §2 — Lifecycle (the three verbs)

### Install (first time, any Mac)

```
brew install willfell/sauce/sauce        # one-time tap+install
sauce install --vault ~/Documents/notes  # materialize + register vault
```

`sauce install` adds the vault path to `~/.sauce/vaults.json`. Run once per vault. Existing `sauce install` semantics preserved (subcommand of `sauce-cli.js`); the new behavior is the registry write.

### Update (subsequent times)

```
brew upgrade sauce          # refresh pantry under brew prefix
sauce reinstall --all       # re-materialize every registered vault
```

Two verbs, predictable. `sauce reinstall --vault <path>` for a single vault. Skipping the second verb is acceptable — vaults stay on their last materialized version until asked.

### Status / introspection

```
sauce status        # prints brew version, registry contents, per-vault installed versions, drift, link state
sauce doctor        # checks brew prefix resolves, node ≥ 18, every registry entry healthy, no dangling symlink
```

### Registry shape (`~/.sauce/vaults.json`)

```json
{
  "version": 1,
  "vaults": [
    { "path": "/Users/willfell/Documents/obsidian/sync/workshop/sauce", "registered_at": "2026-05-13T01:48:00Z" },
    { "path": "/Users/willfell/notes/personal",                          "registered_at": "2026-05-13T02:11:00Z" }
  ]
}
```

- Written atomically (write-temp + rename), JSON-only per platform standard.
- `sauce reinstall --all` auto-prunes entries whose path no longer exists, unless `--keep-missing` is passed.
- New verb `sauce vault list / add / remove` for explicit registry edits.

---

## §3 — Migration from current `<vault>/pantry/` layout

New CLI verb: **`sauce migrate-layout`**. One-shot, idempotent, safe-by-default.

### Per registered or `--vault`-supplied path:

1. **Detect** legacy layout: `<vault>/pantry/.git/` exists.
2. **Preflight brew** install: refuse unless `brew --prefix sauce` succeeds. Print `brew install willfell/sauce/sauce` and exit non-zero.
3. **Version-skew check** — compare `<vault>/pantry/platform/manifest.json` `workshop_version` vs brew-installed `workshop_version`. If brew is older, refuse (don't downgrade silently). Pass `--allow-downgrade` to override.
4. **Archive** `<vault>/pantry/` → `<vault>/pantry.legacy.<YYYYMMDD-HHMMSS>.bak/` (move, not delete). Sidesteps any `git reset` on a corrupted clone — pure filesystem move.
5. **Rewrite** any `<vault>/ranch/platform-installed.json` entries that pin a `pantry/`-relative path (defensive scan; shouldn't exist per current installer).
6. **Register** vault in `~/.sauce/vaults.json` (if not already).
7. **Re-run installer** from brew-prefixed pantry, materializing into the same vault. Same `install.js` code; just a different `SAUCE_DIR`.
8. **Verify** vault state via `sauce audit --strict` and print pass/fail. Non-zero exit if audit fails.

### Flags

- `--purge` — opt-in: `rm -rf <vault>/pantry.legacy.*.bak/` after a clean audit. **Default keeps the bak.**
- `--allow-downgrade` — opt-in: permit step 3 to proceed when brew is older than legacy.
- `--dry-run` — print plan, write nothing.

### Failure modes covered

| Failure | Mitigation |
|---|---|
| Sync corrupted `pantry/.git` | Step 4 moves the dir (no git operations on a broken clone) |
| User mid-edit in pantry/ | Archived intact under `.bak`, recoverable |
| Brew not installed | Step 2 stops cleanly with the install command |
| Mixed-version skew across machines | Step 3 catches downgrade attempts |

---

## §4 — Dev mode (`sauce link`)

Brew-prefixed pantry is a symlink target, not a hard path. Mirrors `npm link` ergonomics.

### Verbs

```
sauce link <path-to-workshop-checkout>   # symlinks ~/.sauce/active-pantry → checkout
sauce unlink                              # removes symlink, restores brew pantry
sauce status                              # surfaces active link state + drift vs brew version
```

### Implementation shape

- `sauce` bin shim resolves `SAUCE_DIR` as:
  ```bash
  ACTIVE="${HOME}/.sauce/active-pantry"
  if [ -L "$ACTIVE" ] && [ -d "$ACTIVE" ]; then
    SAUCE_DIR="$ACTIVE"
  else
    SAUCE_DIR="$(brew --prefix sauce)/libexec/pantry"
  fi
  ```
- `sauce link <path>` writes the symlink `~/.sauce/active-pantry → <abs-path>` after validating that the target is a sauce workshop checkout (`platform/manifest.json` + `platform/cli/sauce-cli.js` both present).
- `sauce unlink` removes the symlink. Brew prefix takes over automatically.
- `brew upgrade sauce` is unaffected by an active link — it still updates `$(brew --prefix)`. `unlink` reveals the newest brew version.

### Why this shape

- Zero env-var state (env vars are forgettable; symlinks are inspectable).
- One symlink to introspect → trivially visible in `sauce status`.
- Familiar mental model from `npm link`.

---

## §5 — Release engineering

How a platform tag actually ships to consumers' Macs.

### Push side (in `willfell/sauce`)

1. `git tag -a v0.34.0 -m "…" && git push origin v0.34.0`
2. `.github/workflows/release.yml` triggers on `v*` tags:
   - Compute tarball URL + sha256 from the auto-generated GitHub archive.
   - Open a PR in `willfell/homebrew-sauce` updating `Formula/sauce.rb` with new `url` + `sha256` + version.
   - Uses a fine-grained PAT scoped only to `willfell/homebrew-sauce` (stored as repo secret `TAP_PR_TOKEN`).
3. **Manual merge** of the tap PR (no auto-merge — keeps a human gate on what ships).

### Pull side (any Mac)

```
brew update                # picks up the tap PR merge
brew upgrade sauce         # downloads new tarball, replaces Cellar/sauce/<v>/libexec/pantry
sauce reinstall --all      # re-materializes every registered vault
```

### Formula skeleton (will be generated, not hand-edited)

```ruby
class Sauce < Formula
  desc "Obsidian vault platform — mechanisms + blueprints for personal knowledge management"
  homepage "https://github.com/willfell/sauce"
  url "https://github.com/willfell/sauce/archive/refs/tags/v0.34.0.tar.gz"
  sha256 "…"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    system "npm", "install", "--omit=dev", "--prefix", libexec
    (bin/"sauce").write <<~SHIM
      #!/bin/bash
      ACTIVE="${HOME}/.sauce/active-pantry"
      if [ -L "$ACTIVE" ] && [ -d "$ACTIVE" ]; then
        SAUCE_DIR="$ACTIVE"
      else
        SAUCE_DIR="#{libexec}"
      fi
      exec node "$SAUCE_DIR/platform/cli/sauce-cli.js" "$@"
    SHIM
    chmod 0755, bin/"sauce"
  end

  test do
    assert_match "sauce", shell_output("#{bin}/sauce --help")
  end
end
```

> [!info] Layout note
> Whether `pantry/` is `libexec/` or `libexec/pantry/` is a one-line decision driven by what `platform/cli/sauce-cli.js` expects for relative `require()` paths. Pinned during implementation, not design.

---

## §6 — Safety net

Three guardrails so "it doesn't just break on the second machine" is enforced, not hoped for.

### 1. `sauce doctor` (new CLI verb)

Checks, in order:

- `brew --prefix sauce` resolves.
- `node --version` ≥ 18.
- Each `~/.sauce/vaults.json` entry: path exists, `ranch/platform-installed.json` present, `workshop_version` matches brew-installed (or active-link).
- No legacy `<vault>/pantry/` directory at any registered vault path.
- No `~/.sauce/active-pantry` symlink dangling.

Returns a punch list with severity + suggested command. Non-zero exit if any check fails.

### 2. CI matrix in `willfell/sauce`

GitHub Actions job that, on every push to `main`:

- Spins up macOS runner.
- Installs the formula from a transient branch of the tap.
- Runs `sauce install --vault $TMPDIR/test-vault --non-interactive`.
- Runs `sauce audit --strict`.
- Catches the "second machine" class of bug **before** tagging.

### 3. Pre-tag self-test on dev machine

`npm run release:preflight` (new script). Runs:

- Full existing test suite: `run-helper-cases`, `run-renderer`, `run-bootstrap`, `run-cli`, `run-install-sh`, `run-migrate`, `run-audit`, `run-cowork-smoke`, `run-claude-surface`.
- `sauce doctor` against the workshop's own self-installed state.

Any failure refuses the tag.

---

## Out of scope (deliberately)

- **Auto-merge of tap formula PRs.** Manual merge stays. Personal infra, low frequency, human gate cheap.
- **Non-Mac platforms.** Linux/Windows are not supported. macOS-only via Homebrew formula.
- **Private taps / paid distribution.** Public tap, free.
- **Per-vault version pinning** beyond what `ranch/platform-installed.json` already records. If someone wants to pin a vault, they avoid running `sauce reinstall` against it.
- **Migration of the `install.sh` curl|bash flow.** It stays operational until brew formula ships; first formula release deprecates it. Old vaults that haven't migrated keep working under the legacy `<vault>/pantry/` model until they run `sauce migrate-layout`.

---

## Open questions (none blocking implementation)

- Tap PR token (`TAP_PR_TOKEN`) provisioning — happens at implementation time, requires a manual fine-grained PAT generation step.
- Whether to publish a Homebrew bottle (pre-compiled artifact). Probably not needed — `npm install` is fast enough that source install is fine.

---

## Sequencing (high-level — full breakdown in the implementation plan)

1. **Stage A:** Formula generator + tap PR workflow + first published release pinning current `v0.33.0`.
2. **Stage B:** `sauce-cli` gains `migrate-layout`, `reinstall --all`, registry verbs, `doctor`, `link`/`unlink`. Existing `install` / `update` / `audit` verbs retained.
3. **Stage C:** Workshop dogfood migrates from `<vault>/pantry/` to brew-installed pantry via `sauce link <workshop-checkout>` (dev mode).
4. **Stage D:** Migration prompt on existing `sauce update` — if it detects legacy layout, points user at `sauce migrate-layout`.
5. **Stage E:** `install.sh` becomes a thin redirect that prints "use `brew install willfell/sauce/sauce` instead" and exits.

Detailed plan: forthcoming `Docs/plans/2026-05-12-v0.34.0-sauce-homebrew-distribution-plan.md` via the `writing-plans` skill.
