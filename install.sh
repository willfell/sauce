#!/usr/bin/env bash
# install.sh — DEPRECATED as of sauce v0.36.0.
#
# Sauce now distributes via Homebrew. Install with:
#
#     brew tap willfell/sauce
#     brew install willfell/sauce/sauce
#     sauce bootstrap --vault <path-to-vault>
#
# See: https://github.com/willfell/sauce#install
set -euo pipefail
cat >&2 <<'MSG'

  install.sh is deprecated as of sauce v0.36.0.

  Install via Homebrew instead:

      brew tap willfell/sauce
      brew install willfell/sauce/sauce
      sauce bootstrap --vault <path-to-vault>

  See: https://github.com/willfell/sauce#install
  Migration from legacy <vault>/pantry/ layout:
      sauce migrate-layout --vault <path>

MSG
exit 2
