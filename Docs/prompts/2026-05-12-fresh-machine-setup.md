---
date: 2026-05-12
purpose: One-page fresh-machine setup for a new computer that needs to drive sauce vault operations (the v0.31.0+ era). Replaces hand-rolled instructions in the headspace handoff. Two paths — Path A (one-liner) and Path B (step-by-step) — pick whichever you prefer.
canonical: yes
related:
  - install.sh
  - platform/cli/shell-helpers/sauce.sh
  - Docs/prompts/2026-05-12-headspace-cowork-bootstrap-handoff.md
---

# Fresh-machine setup for sauce vaults

## What you get after this

- `sauce`, `sauce-refresh`, `sauce-pin`, `sauce-here`, `sauce-bootstrap` shell helpers available in any new shell.
- A bootstrapped vault with `pantry/` (a git clone of the workshop) + current platform pins.
- The `/cowork` slash command (shipped by `cowork@0.2.0+` install) ready for invocation in Claude Code.

## Prerequisites

- macOS or Linux. (Windows path TBD.)
- `node` (>= 18) + `git` installed: `node --version && git --version`.
- The vault directory already exists on disk (the actual Obsidian vault). If not, `git clone` it or move it into place first.
- An `~/.aliases` (or `.bashrc`/`.zshrc`) that auto-sources `~/.alias-config/*.sh`. Many dotfiles setups already have this; verify with `cat ~/.aliases 2>/dev/null | grep alias-config`. If absent: see Path B step 1 for the snippet to add.

---

## Path A — fast path (one-liner per step)

```bash
# 1. Install shell helpers globally
mkdir -p ~/.alias-config && \
  curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/platform/cli/shell-helpers/sauce.sh \
    -o ~/.alias-config/sauce.sh

# 2. Make sure ~/.aliases auto-sources it (one-time, only if missing)
grep -q 'alias-config/\*\.sh' ~/.aliases 2>/dev/null || \
  printf '\n# Auto-source per-topic helpers\nfor f in ~/.alias-config/*.sh; do [ -r "$f" ] && source "$f"; done\n' >> ~/.aliases
grep -q 'source ~/\.aliases' ~/.zshrc 2>/dev/null || \
  printf '\nsource ~/.aliases\n' >> ~/.zshrc

# 3. Reload current shell so helpers are available NOW
source ~/.zshrc

# 4. Bootstrap the vault (creates pantry/, runs first-run wizard)
cd /path/to/your/vault
sauce-bootstrap

# 5. Pull latest workshop + auto-bump pins + install everything
sauce-refresh

# 6. Verify state
sauce-here
find .claude/skills/cowork -name SKILL.md 2>/dev/null | wc -l   # expect ~32 if cowork is subscribed
```

After step 6: a fresh Claude Code window inside the vault can invoke `/cowork` to start the bootstrap interview.

---

## Path B — step-by-step (explains each piece)

### Step 1 — install shell helpers

Sauce ships its shell helpers in the workshop git tree at `platform/cli/shell-helpers/sauce.sh`. Drop that file into `~/.alias-config/sauce.sh` on the fresh machine.

**Option B.1 — curl from GitHub directly (recommended; works without a workshop clone yet):**

```bash
mkdir -p ~/.alias-config
curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/platform/cli/shell-helpers/sauce.sh \
  -o ~/.alias-config/sauce.sh
```

**Option B.2 — copy from a pantry/ you already have:**

```bash
mkdir -p ~/.alias-config
cp /path/to/any/vault/pantry/platform/cli/shell-helpers/sauce.sh ~/.alias-config/sauce.sh
```

Verify:

```bash
ls -la ~/.alias-config/sauce.sh
```

### Step 2 — wire it into your shell

If `~/.aliases` doesn't already loop over `~/.alias-config/*.sh`, add the loop:

```bash
cat >> ~/.aliases <<'EOF'

# Auto-source per-topic helpers (sauce.sh, atlas.sh, aws.sh, etc.)
for f in ~/.alias-config/*.sh; do
  [ -r "$f" ] && source "$f"
done
EOF
```

If `~/.zshrc` doesn't already source `~/.aliases`, add:

```bash
echo 'source ~/.aliases' >> ~/.zshrc
```

Reload to pick up changes in the current shell:

```bash
source ~/.zshrc
type sauce      # expect: "sauce is a shell function"
```

### Step 3 — bootstrap the vault

A sauce vault needs a `pantry/` directory: a `git clone` of the workshop repo with `npm install --omit=dev` already run. The installer mechanism, mechanism manifests, blueprint manifests, and ALL platform code lives there. Each vault has its own `pantry/` — they're not shared across vaults.

If your vault doesn't have a `pantry/` yet:

```bash
cd /path/to/your/vault
sauce-bootstrap
```

This wraps the canonical install.sh which: (a) git-clones sauce into `pantry/`, (b) runs `npm install --omit=dev`, (c) runs the first-run wizard so you can pick which blueprints to subscribe to. **Include `cowork` in your subscription** to get the bootstrap interview later.

If the vault DOES have a `pantry/` already (e.g., you `git clone`'d the vault from another machine where it was bootstrapped), skip to step 4.

### Step 4 — pull latest + install everything

```bash
cd /path/to/your/vault
sauce-refresh
```

`sauce-refresh` does (in order):
1. `git fetch origin && git reset --hard origin/main` inside `pantry/`
2. `npm install --omit=dev`
3. `sauce-pin --catalog` — auto-bump all subscription pins to current workshop catalog (NEW in v0.31.0; opt out via `NO_BUMP_PINS=1 sauce-refresh`)
4. `sauce update --force` — run the installer

Expect `Verdict: clean run — exit 0`. If you see `[Notice] platformInstall: skipping <X>` for many items, the pin auto-bump didn't take — run `sauce-pin --catalog && sauce-refresh` manually.

### Step 5 — sanity check

```bash
sauce-here            # vault + pantry sha + sub pin
sauce status          # vault git head + workshop drift + sub counts
sauce audit           # blueprint conformance check (read-only)
```

### Step 6 — start the cowork bootstrap interview

In Claude Code, open a fresh window pointing at the vault directory. Type:

```
/cowork
```

The `/cowork` slash command was shipped by the cowork@0.2.0+ install. It dispatches to the `cowork:bootstrap-vault` skill (the 25-step engagement-aware interview).

If `/cowork` is missing in your vault's `.claude/commands/`, hand-copy it from the workshop tree:

```bash
mkdir -p .claude/commands
cp pantry/platform/blueprints/cowork/commands/cowork.md .claude/commands/cowork.md
```

(Future installer cycle will auto-materialize this; tracked in `pantry/Docs/plans/2026-05-12-installer-shell-helpers-design.md`.)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `sauce: command not found` in a new shell | `~/.aliases` doesn't loop `~/.alias-config/*.sh`, or `~/.zshrc` doesn't source `~/.aliases` | Re-run step 2 |
| `sauce: not inside a sauce vault with a pantry/ directory` | cwd is outside a vault, OR vault lacks `pantry/` | cd into a vault dir; if pantry missing → `sauce-bootstrap` |
| `[Notice] platformInstall: skipping <X> — subscription pins X@old but workshop has new` | Pin auto-bump in sauce-refresh didn't run (unlikely post-v0.31.0) | `sauce-pin --catalog && sauce-refresh` |
| `/cowork` not recognized as a slash command in Claude Code | The slash command file isn't in `<vault>/.claude/commands/` | `cp pantry/platform/blueprints/cowork/commands/cowork.md .claude/commands/cowork.md` |
| `cowork:bootstrap-vault aborted — detected v0.30.0 vault_scope schema` | The vault has a pre-v0.31.0 vault-config.md frontmatter with `vault_scope:` | Manually delete the `vault_scope:` line from `<vault>/spice/cowork/context/vault-config.md` and re-run `/cowork` |

---

## Per-machine vault inventory (for reference)

| Machine | Vaults that should be set up here |
|---|---|
| Primary (will@2026-05-12 session machine) | `accuris-sauce` |
| Other machine | `headspace-sauce`, optionally `ero-sauce` |
| Either / portable | `barebones-beacon-poc` (workshop regression target) |

Cross-machine state sync: the workshop git repo is the single source of truth. Each machine's `~/.alias-config/sauce.sh` should be identical (or synced via your dotfiles channel). Each vault's `pantry/` is independent on each machine — git-tracked vault content syncs through whatever channel you use (Dropbox, syncthing, git, Obsidian Sync, etc.).
