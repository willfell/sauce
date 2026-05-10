# Obsidian vault guide (sauce-shape)

> [!info] Stub — full sauce-shape rewrite lands in S3.

Canonical path map for cowork skills operating inside a sauce-shape vault:

- `spice/<module>/` — blueprint-managed content (daily, projects, trips, cowork, etc.).
- `ranch/` — runtime plumbing (templates, scripts, views).
- `pantry/` — workshop clone (inside-vault layout for the workshop dogfood).
- `.claude/skills/` — installer-materialized native Claude Code skills.
- `.obsidian/` — vault config (allowlist-managed).

Skills MUST NOT reference legacy paths (`Timestamps/`, `Boards/`, `Resources/`, etc.).
