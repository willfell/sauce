# ~/.alias-config/sauce.sh
# Sauce platform — shell helpers. Auto-sourced by ~/.aliases via the
# `for f in ~/.alias-config/*.sh` glob.
#
# Resolves the per-vault `pantry/` CLI by walking up from $PWD. No global
# alias to a workshop dev dir — each vault uses its own pantry, so this
# works identically on any machine that has bootstrapped sauce vaults.
#
# Roadmap: these helpers are slated to ship inside install.sh in a future
# cycle (workshop tracks this under
# Docs/plans/2026-05-12-installer-shell-helpers-design.md), at which point
# the manual ~/.alias-config drop goes away.

# Internal: find the nearest pantry/-rooted vault from cwd, echo its path.
# Uses [ -f ] (file exists, not executable bit) because sauce-cli.js is
# invoked via `node` and doesn't carry +x. The `-n "$d"` guard prevents
# the walk from looping forever once $d collapses past /Users to "".
_sauce_resolve_vault() {
  local d="$PWD"
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    if [ -f "$d/pantry/platform/cli/sauce-cli.js" ]; then
      printf '%s' "$d"
      return 0
    fi
    d="${d%/*}"
  done
  return 1
}

# `sauce <verb>` — invoke the local-pantry CLI for whichever vault you're in.
# Examples: sauce status / sauce update --force / sauce audit / sauce wizard.
sauce() {
  local vault
  if ! vault="$(_sauce_resolve_vault)"; then
    echo "sauce: no pantry/ found in cwd ancestors. cd into a sauce vault first." >&2
    return 1
  fi
  node "$vault/pantry/platform/cli/sauce-cli.js" "$@"
}

# `sauce-refresh` — one-shot: fetch origin/main in pantry/, hard-reset,
# npm install, AUTO-BUMP all subscription pins to catalog versions, then
# `sauce update --force`. Pass extra args through to update.
#
# Auto-bump rationale: when you sauce-refresh, you've already chosen to pull
# the latest workshop into THIS vault's pantry — at that point you want to
# adopt the new versions wholesale. The "silent upgrade" worry is mitigated
# because the catalog is the LOCAL pantry's manifest (controlled by the
# git pull above), not an arbitrary upstream.
#
# To opt out of auto-bump for a specific call, set NO_BUMP_PINS=1 env var:
#   NO_BUMP_PINS=1 sauce-refresh
sauce-refresh() {
  local vault
  if ! vault="$(_sauce_resolve_vault)"; then
    echo "sauce-refresh: no pantry/ found in cwd ancestors." >&2
    return 1
  fi
  printf '  Refreshing %s/pantry ...\n' "$vault"
  ( cd "$vault/pantry" \
    && git fetch origin \
    && git reset --hard origin/main \
    && npm install --omit=dev ) || return 1
  if [ "${NO_BUMP_PINS:-}" != "1" ]; then
    printf '  Bumping subscription pins to catalog versions ...\n'
    sauce-pin --catalog
  fi
  printf '  Running sauce update --force ...\n'
  node "$vault/pantry/platform/cli/sauce-cli.js" update --force "$@"
}

# `sauce-here` — print resolved vault, pantry commit, workshop_version pin.
sauce-here() {
  local vault
  if ! vault="$(_sauce_resolve_vault)"; then
    echo "sauce-here: no pantry/ found in cwd ancestors." >&2
    return 1
  fi
  local sha
  sha="$(cd "$vault/pantry" && git rev-parse --short HEAD 2>/dev/null)"
  local sub_ver
  sub_ver="$(grep '"workshop_version"' "$vault/ranch/platform-subscription.json" 2>/dev/null | head -1 | sed -E 's/.*"([^"]+)".*/\1/' | tail -1)"
  printf '  vault:              %s\n' "$vault"
  printf '  pantry HEAD:        %s\n' "${sha:-?}"
  printf '  subscription pins:  workshop_version %s\n' "${sub_ver:-?}"
}

# `sauce-bootstrap` — first-run bootstrap for a vault that has no pantry/ yet.
# Wraps the curl one-liner so a fresh machine just types `sauce-bootstrap`
# from the vault dir.
sauce-bootstrap() {
  if [ -d "$PWD/pantry" ]; then
    echo "sauce-bootstrap: pantry/ already exists at $PWD/pantry. Use sauce-refresh instead, or pass --overwrite." >&2
    [ "${1:-}" = "--overwrite" ] || return 1
  fi
  curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh \
    | bash -s -- --vault . "$@"
}

# `sauce-pin <name> <version>` — update one mechanism/blueprint pin in the
# resolved vault's ranch/platform-subscription.json. Edits the JSON via node
# (preserves formatting + safer than sed). Does NOT run the installer — chain
# with `sauce-refresh` or `sauce update --force` to apply.
#
# `sauce-pin --catalog` (no name/version) — bump ALL pins to whatever the
# vault's pantry/platform/manifest.json declares right now. Useful after a
# `sauce-refresh` that pulled new workshop versions you want to adopt.
#
# `sauce-pin --diff` (no name/version) — show pins that differ between the
# vault's subscription and the workshop catalog. Read-only.
sauce-pin() {
  local vault
  if ! vault="$(_sauce_resolve_vault)"; then
    echo "sauce-pin: no pantry/ found in cwd ancestors." >&2
    return 1
  fi
  if [ "${1:-}" = "--diff" ]; then
    V="$vault" node -e '
      const fs = require("fs");
      const sub = JSON.parse(fs.readFileSync(process.env.V + "/ranch/platform-subscription.json", "utf8"));
      const cat = JSON.parse(fs.readFileSync(process.env.V + "/pantry/platform/manifest.json", "utf8"));
      const fmt = (n, sv, cv) => printf(n, sv, cv);
      function printf(n, sv, cv) {
        const arrow = (sv === cv) ? "==" : "→";
        console.log("  " + n.padEnd(28) + " " + (sv || "(unpinned)").padEnd(10) + " " + arrow + " " + (cv || "(none)"));
      }
      const subM = new Map((sub.mechanisms || []).map(m => [m.name, m.version]));
      const subB = new Map((sub.blueprints || []).map(b => [b.name, b.version]));
      const catM = new Map((cat.mechanisms  || []).map(m => [m.name, m.version]));
      const catB = new Map((cat.blueprints  || []).map(b => [b.name, b.version]));
      console.log("--- mechanisms (pin → catalog) ---");
      for (const [n, cv] of catM) fmt(n, subM.get(n), cv);
      console.log("--- blueprints (pin → catalog) ---");
      for (const [n, cv] of catB) fmt(n, subB.get(n), cv);
    '
    return $?
  fi
  if [ "${1:-}" = "--catalog" ]; then
    V="$vault" node -e '
      (function() {
        const fs = require("fs");
        const subP = process.env.V + "/ranch/platform-subscription.json";
        const sub = JSON.parse(fs.readFileSync(subP, "utf8"));
        const cat = JSON.parse(fs.readFileSync(process.env.V + "/pantry/platform/manifest.json", "utf8"));
        const catM = new Map((cat.mechanisms || []).map(m => [m.name, m.version]));
        const catB = new Map((cat.blueprints || []).map(b => [b.name, b.version]));
        let bumped = 0;
        for (const m of (sub.mechanisms || [])) {
          const v = catM.get(m.name);
          if (v && v !== m.version) { console.log("  mech  " + m.name + ": " + m.version + " → " + v); m.version = v; bumped++; }
        }
        for (const b of (sub.blueprints || [])) {
          const v = catB.get(b.name);
          if (v && v !== b.version) { console.log("  blue  " + b.name + ": " + b.version + " → " + v); b.version = v; bumped++; }
        }
        if (bumped === 0) { console.log("  nothing to bump — pins already match catalog"); return; }
        fs.writeFileSync(subP, JSON.stringify(sub, null, 2) + "\n");
        console.log("  bumped " + bumped + " pins. Run sauce-refresh to apply.");
      })();
    '
    return $?
  fi
  if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
    echo "Usage:" >&2
    echo "  sauce-pin <name> <version>   Bump one pin (mech or blueprint)." >&2
    echo "  sauce-pin --catalog          Bump all pins to pantry/manifest catalog versions." >&2
    echo "  sauce-pin --diff             Show pins that differ from the catalog (read-only)." >&2
    return 2
  fi
  V="$vault" N="$1" X="$2" node -e '
    (function() {
      const fs = require("fs");
      const subP = process.env.V + "/ranch/platform-subscription.json";
      const sub = JSON.parse(fs.readFileSync(subP, "utf8"));
      const name = process.env.N, version = process.env.X;
      let target = (sub.blueprints || []).find(b => b.name === name)
                || (sub.mechanisms || []).find(m => m.name === name);
      if (!target) { console.error("sauce-pin: no mechanism or blueprint named \"" + name + "\""); process.exit(1); }
      if (target.version === version) { console.log("  " + name + " already pinned at " + version); return; }
      console.log("  " + name + ": " + target.version + " → " + version);
      target.version = version;
      fs.writeFileSync(subP, JSON.stringify(sub, null, 2) + "\n");
      console.log("  pin updated. Run sauce-refresh to apply.");
    })();
  '
}
