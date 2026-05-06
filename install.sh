#!/usr/bin/env bash
# install.sh — Beacon consumer bootstrap (curl-pulled).
# Usage: curl -fsSL https://raw.githubusercontent.com/willfell/beacon/main/install.sh | bash
#        bash install.sh [--vault PATH] [--non-interactive] [--overwrite]
set -euo pipefail

REPO_URL="${BEACON_REPO_URL:-https://github.com/willfell/beacon.git}"
VAULT="${PWD}"
NON_INTERACTIVE=0
OVERWRITE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --vault) VAULT="$2"; shift 2 ;;
        --non-interactive) NON_INTERACTIVE=1; shift ;;
        --overwrite) OVERWRITE=1; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# Banner
printf '\n  ╔══════════════════════════════════════╗\n'
printf '  ║   Beacon  ·  installer               ║\n'
printf '  ║   Obsidian vault platform            ║\n'
printf '  ╚══════════════════════════════════════╝\n\n'

# [1/4] Preflight
printf '  [1/4] Detecting environment...                '
if ! command -v node >/dev/null 2>&1; then
    printf 'FAIL\n  node not found. Install via Homebrew (brew install node) or https://nodejs.org\n' >&2
    exit 1
fi
if ! command -v git >/dev/null 2>&1; then
    printf 'FAIL\n  git not found. Install via Homebrew (brew install git) or https://git-scm.com\n' >&2
    exit 1
fi
NODE_VER="$(node --version)"
GIT_VER="$(git --version | awk '{print $3}')"
printf 'OK\n        node %s · git %s · vault %s\n\n' "$NODE_VER" "$GIT_VER" "$VAULT"

# [2/4] Vault target
if [ ! -d "$VAULT" ]; then
    printf '  Vault path does not exist: %s\n' "$VAULT" >&2
    exit 1
fi
mkdir -p "$VAULT/Docs/Meta"
BEACON_DIR="$VAULT/Beacon"
if [ -d "$BEACON_DIR" ]; then
    if [ "$OVERWRITE" = "1" ]; then
        BAK="$VAULT/Beacon.bak"
        rm -rf "$BAK"
        mv "$BEACON_DIR" "$BAK"
        printf '  Existing Beacon/ moved to Beacon.bak\n'
    elif [ "$NON_INTERACTIVE" = "1" ]; then
        printf '  Beacon/ already exists at %s. Pass --overwrite to back up + replace.\n' "$BEACON_DIR" >&2
        exit 1
    else
        printf '  Beacon/ already exists at %s\n' "$BEACON_DIR"
        printf '  Overwrite (back up to Beacon.bak)? [y/N] '
        read -r ans
        if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
            BAK="$VAULT/Beacon.bak"
            rm -rf "$BAK"
            mv "$BEACON_DIR" "$BAK"
        else
            printf '  Aborted.\n' >&2
            exit 1
        fi
    fi
fi

# [2/4] Clone
printf '  [2/4] Cloning workshop into Beacon/...        '
if ! git clone --depth=1 "$REPO_URL" "$BEACON_DIR" >/tmp/beacon-clone.log 2>&1; then
    printf 'FAIL\n' >&2
    cat /tmp/beacon-clone.log >&2
    exit 1
fi
printf 'OK\n'

# [3/4] npm install
printf '  [3/4] Installing dependencies...              '
if ! (cd "$BEACON_DIR" && npm install --omit=dev) >/tmp/beacon-npm.log 2>&1; then
    printf 'FAIL\n' >&2
    cat /tmp/beacon-npm.log >&2
    exit 1
fi
printf 'OK\n'

# [4/4] Hand off to node CLI
printf '  [4/4] Running first-run wizard...\n\n'
exec node "$BEACON_DIR/platform/cli/beacon-cli.js" bootstrap --vault "$VAULT"
