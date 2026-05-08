// platform/audit/sanctioned-dirs.js — single source-of-truth list of
// top-level directories that are NOT flagged as untracked by `sauce audit`.
//
// The audit walker scans the vault root for directories not in this list
// and reports them as "untracked" so the operator can decide whether to
// migrate them under spice/ or otherwise account for them.
//
// Rationale (per CLAUDE.md "Sanctioned new top-level vault dirs"):
//   spice/    — blueprint content (landmine #11)
//   pantry/   — workshop clone for inside-vault layout (post-v0.23.0)
//   ranch/    — runtime plumbing (post-v0.24.0)
//   assets/   — vendored themes / images / static assets
//   .obsidian — Obsidian app config
//   .claude   — Claude Code project config

module.exports = ["spice", "pantry", "ranch", "assets", ".obsidian", ".claude"];
