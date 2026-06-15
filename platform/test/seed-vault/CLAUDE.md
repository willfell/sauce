# Test consumer vault — Sauce seed fixture

Synthetic CLAUDE.md for the migration regression net seed vault. The
platform-claude mechanism rewrites the markered surfaces below on every install;
this prose outside the markers is asserted preserved by the SEED-CLAUDE
assertion family in `platform/test/run-seed-migrations.js`.

This vault has no real personal content. It exists exclusively to exercise
sauce install + migration paths in a deterministic fixture.

## When using slash commands

<!-- @claude-surface:resolvers BEGIN -->
| Topic | Path | Slash command |
| --- | --- | --- |
| Audit | .claude/commands/audit.md | /audit |
| Bootstrap | .claude/commands/bootstrap.md | /bootstrap |
| Cowork | spice/cowork | /cowork |
| Cowork About | spice/cowork/About Cowork.md | /cowork about |
| Cowork Atomic Notes (cron output) | spice/cowork/daily/ | (cron-only — NOT spice/daily/) |
| Cowork Daily Hub | spice/cowork/Daily Hub.md | /cowork |
| Cowork Discover People | spice/cowork/skills/orchestrators/discover-people/SKILL.md | /cowork discover-people |
| Cowork Find Missing People | spice/cowork/skills/orchestrators/find-missing-people/SKILL.md | /cowork find-missing-people |
| Cowork Memory | spice/cowork/memory/ | /cowork memory |
| Cowork Monthly Hub | spice/cowork/Monthly Hub.md | /monthly hub |
| Cowork Prompts | spice/cowork/prompts/ | /cowork prompts |
| Cowork Sync Scheduled Jobs | spice/cowork/skills/orchestrators/sync-scheduled-jobs/SKILL.md | /cowork sync-scheduled-jobs |
| Cowork Weekly Hub | spice/cowork/Weekly Hub.md | /weekly hub |
| Daily | spice/daily | /daily |
| Install | .claude/commands/install.md | /install |
| Meetings | spice/meetings | /meetings |
| Products | spice/products | /products |
| Projects | spice/projects | /project |
| Scratch | spice/scratch | /scratch |
| Teams | spice/teams | /teams |
| Upgrade | .claude/commands/upgrade.md | /upgrade |
<!-- @claude-surface:resolvers END -->

## Directory map

<!-- @claude-surface:directory-map BEGIN -->
| Path | Blueprint | Purpose |
| --- | --- | --- |
| spice/ | (platform) | Module-directory namespace for blueprints |
| spice/resources/ | (platform) | Vault default attachment + new-note targets |
| ranch/ | (platform) | Runtime plumbing (config, scripts, templates, views) |
| .claude/commands/ | (platform) | Slash commands managed via claude_surface[] |
| .claude/skills/ | (platform) | Native Claude Code skill bodies |
<!-- @claude-surface:directory-map END -->

## Skills index

<!-- @claude-surface:skills-index BEGIN -->
| Command | SKILL.md | Blueprint/Mechanism |
| --- | --- | --- |
<!-- @claude-surface:skills-index END -->

## What not to do

- Don't manually edit content between `claude-surface` marker pairs. The
  `platform-claude` mechanism rewrites those regions on every install.
- Don't add personal content here. This is a test fixture.
