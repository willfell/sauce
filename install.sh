#!/usr/bin/env bash
# install.sh — Sauce consumer bootstrap (curl-pulled).
# Usage: curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh | bash
#        bash install.sh [--vault PATH] [--non-interactive] [--overwrite]
set -euo pipefail

REPO_URL="${SAUCE_REPO_URL:-https://github.com/willfell/sauce.git}"
VAULT="${PWD}"
NON_INTERACTIVE=0
OVERWRITE=0
MECHS_ARG=""; HAS_MECHS=0
BLUEPRINTS_ARG=""; HAS_BLUEPRINTS=0
while [ $# -gt 0 ]; do
    case "$1" in
        --vault) VAULT="$2"; shift 2 ;;
        --vault=*) VAULT="${1#--vault=}"; shift ;;
        --non-interactive) NON_INTERACTIVE=1; shift ;;
        --overwrite) OVERWRITE=1; shift ;;
        --mechanisms=*) MECHS_ARG="${1#--mechanisms=}"; HAS_MECHS=1; shift ;;
        --blueprints=*) BLUEPRINTS_ARG="${1#--blueprints=}"; HAS_BLUEPRINTS=1; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# Canonicalize VAULT: expand tilde, resolve relative path, collapse symlinks.
case "$VAULT" in
    "~"|"~/"*) VAULT="${HOME}${VAULT#~}" ;;
esac
if ! VAULT="$(cd "$VAULT" 2>/dev/null && pwd -P)"; then
    printf '  Vault path does not exist or is not a directory: %s\n' "$VAULT" >&2
    exit 1
fi

# Trap: if any later step fails after we clone pantry/, clean it up so we
# don't leave a half-installed dir behind. WE_CREATED_PANTRY=1 is set right
# after clone success, so we only clean up dirs WE created (never a pre-
# existing user dir). INSTALL_OK=1 right before exec turns the trap into a
# no-op on the success path.
INSTALL_OK=0
WE_CREATED_PANTRY=0
cleanup_partial() {
    if [ "$INSTALL_OK" != "1" ] && [ "$WE_CREATED_PANTRY" = "1" ] \
        && [ -n "${SAUCE_DIR:-}" ] && [ -d "$SAUCE_DIR" ]; then
        printf '\n  Cleaning up partial install at %s\n' "$SAUCE_DIR" >&2
        rm -rf "$SAUCE_DIR"
    fi
}
trap cleanup_partial EXIT

# Banner
printf '\n  ╔══════════════════════════════════════╗\n'
printf '  ║   Sauce   ·  installer               ║\n'
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
mkdir -p "$VAULT/Docs/Meta"
SAUCE_DIR="$VAULT/pantry"
if [ -d "$SAUCE_DIR" ]; then
    if [ "$OVERWRITE" = "1" ]; then
        BAK="$VAULT/pantry.bak"
        # Preserve any prior pantry.bak by timestamping it (never destroy backups).
        if [ -d "$BAK" ]; then
            mv "$BAK" "$VAULT/pantry.bak.$(date +%Y%m%d-%H%M%S)"
        fi
        mv "$SAUCE_DIR" "$BAK"
        printf '  Existing pantry/ moved to pantry.bak\n'
    elif [ "$NON_INTERACTIVE" = "1" ]; then
        printf '  pantry/ already exists at %s. Pass --overwrite to back up + replace.\n' "$SAUCE_DIR" >&2
        exit 1
    else
        if [ ! -t 0 ]; then
            printf '  pantry/ already exists at %s\n' "$SAUCE_DIR" >&2
            printf '  stdin is not a TTY (running via curl|bash?). Cannot prompt interactively.\n' >&2
            printf '  Re-run with one of:\n' >&2
            printf '    bash <(curl -fsSL <url>) --overwrite\n' >&2
            printf '    bash <(curl -fsSL <url>) --non-interactive --overwrite\n' >&2
            printf '  Or download install.sh and run it directly:\n' >&2
            printf '    curl -fsSL <url> -o install.sh && bash install.sh --overwrite\n' >&2
            exit 1
        fi
        printf '  pantry/ already exists at %s\n' "$SAUCE_DIR"
        printf '  Overwrite (back up to pantry.bak)? [y/N] '
        read -r ans
        if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
            BAK="$VAULT/pantry.bak"
            # Preserve any prior pantry.bak by timestamping it (never destroy backups).
            if [ -d "$BAK" ]; then
                mv "$BAK" "$VAULT/pantry.bak.$(date +%Y%m%d-%H%M%S)"
            fi
            mv "$SAUCE_DIR" "$BAK"
            printf '  Existing pantry/ moved to pantry.bak\n'
        else
            printf '  Aborted.\n' >&2
            exit 1
        fi
    fi
fi

# [2/4] Clone
printf '  [2/4] Cloning workshop into pantry/...        '
if ! git clone --depth=1 "$REPO_URL" "$SAUCE_DIR" >/tmp/sauce-clone.log 2>&1; then
    printf 'FAIL\n' >&2
    cat /tmp/sauce-clone.log >&2
    exit 1
fi
WE_CREATED_PANTRY=1
printf 'OK\n'

# [3/4] npm install
printf '  [3/4] Installing dependencies...              '
if ! (cd "$SAUCE_DIR" && npm install --omit=dev) >/tmp/sauce-npm.log 2>&1; then
    printf 'FAIL\n' >&2
    cat /tmp/sauce-npm.log >&2
    exit 1
fi
printf 'OK\n'

# [4/4] Hand off to node CLI
printf '  [4/4] Running first-run wizard...\n\n'
INSTALL_OK=1
NODE_ARGS=("$SAUCE_DIR/platform/cli/sauce-cli.js" "bootstrap" "--vault" "$VAULT")
if [ "$NON_INTERACTIVE" = "1" ]; then NODE_ARGS+=("--non-interactive"); fi
if [ "$HAS_MECHS" = "1" ]; then NODE_ARGS+=("--mechanisms=$MECHS_ARG"); fi
if [ "$HAS_BLUEPRINTS" = "1" ]; then NODE_ARGS+=("--blueprints=$BLUEPRINTS_ARG"); fi
exec node "${NODE_ARGS[@]}"
