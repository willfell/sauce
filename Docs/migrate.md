---
purpose: User-facing reference for `sauce migrate` — the v0.28.0 CLI verb that takes a real source vault (Accuris/Ero/Headspace) and migrates content into a fresh sauce vault with zero data loss + canonical Sauce blueprint schema.
audience: Users running migrations on their own vaults
since: v0.28.0
---

# `sauce migrate` — User Guide

> [!abstract] What this does
> Reads a real source Obsidian vault (legacy layout: Extras/People, Timestamps/Meetings, Timestamps/MeetingHubs, Timestamps/ToDo, Timestamps/<YYYY>/<MM-MMMM>/, etc.) and produces a fully-populated sauce-managed target vault: blueprint content materialized under `spice/<module>/` per current Sauce schema; everything else carried verbatim at original paths.
>
> **Source vault is NEVER modified.** Target vault is wiped in-place + rebuilt; full backup created at sibling `<vault>.pre-migration-<ts>/` first.

---

## Quick start

```bash
# 1. Ensure the target vault is sauce-managed (has ranch/platform-config.json)
cd /path/to/<target>-sauce-vault
source pantry/Scripts/activate.sh   # OR equivalent activation

# 2. Dry-run (default) — no writes; reviews migration plan
sauce migrate --from /path/to/source-vault

# 3. Inspect migration-plan.json (written at vault root)
cat migration-plan.json | python3 -m json.tool | less

# 4. Execute (after explicit user approval; in-place wipe + 5-phase atomic write)
sauce migrate --from /path/to/source-vault --commit
```

---

## Flags

| Flag | Default | Purpose |
|---|---|---|
| `--from <path>` | (required) | Absolute path to source vault. Must be a directory. Source NEVER written to. |
| `--commit` | off (dry-run) | Execute the 5-phase write. Without it, only `migration-plan.json` is generated. |
| `--no-keep-backups` | (default: keep) | Reserved for future use. Backups currently retained always. |

---

## What happens during `--commit` (5 phases)

```
Phase 0 — precheck         Validate --from + target + backup-sibling-free
Phase 1 — backup           cp -R vault contents → <vault>.pre-migration-<ts>/
                           rm vault contents (preserving vault dir entry)
Phase 2 — bootstrap        Write canonical platform-config.json + subscription
                           + thin stub; restore .obsidian/ from backup; scrub
                           allowlist-managed plugin data files; run installer
Phase 3 — carry-verbatim   cp source → target for every non-blueprint file
Phase 4 — rewrite-blueprint For each migrator, transform source → target shape
Phase 4.5 — wikilink-rewrite Cross-blueprint pass for prefix→suffix daily/hub/
                             to-do filename references + Extras/People→spice/people
Phase 5 — finalize         Write migration.log + migration-plan.json
```

Atomic per-phase. Failure-loud abort + restore-from-backup on phase 2-4 errors. Crash-safety markers (`.in-progress` + sentinel JSON) detect interrupted backup runs.

---

## Migrator coverage (v0.28.0)

| Source pattern | Target | Notes |
|---|---|---|
| `Extras/People/<Name>.md` | `spice/people/<Name>.md` | Frontmatter identity copy (drop empty aliases + missing phone); regenerate `# [[Name]]` heading + `## Meetings` block; preserve `## Notes`. |
| `Timestamps/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>-<Day>.md` | `spice/daily/<YYYY>/<MM-MMMM>/<Day>-<YYYY-MM-DD>.md` | Filename prefix→suffix; regenerate platform blocks; preserve Morning Briefing callout + free-form notes. |
| `Timestamps/Meetings/<YYYY-MM-DD> <title>.md` | `spice/meetings/notes/<YYYY>/<MM-MMMM>/<title>-<YYYY-MM-DD>.md` | Filename prefix→suffix; prepend `## Attendees` chip block; drop legacy MOC line + Date line; preserve agenda/notes/action items + person/X frontmatter tags. |
| `Timestamps/MeetingHubs/<YYYY-MM-DD>-Meetings.md` | `spice/meetings/hubs/<YYYY>/<MM-MMMM>/Meetings-<YYYY-MM-DD>.md` | Body 100% regenerated from current Sauce hub template. |
| `Timestamps/ToDo/<YYYY-MM-DD>-ToDo.md` | `spice/to-do/<YYYY>/<MM-MMMM>/ToDo-<YYYY-MM-DD>.md` | Filename prefix→suffix; preserve `## Today's Tasks`; regenerate back-button. |
| (everything else) | same relative path | Verbatim cp + mtime preservation. |

**Skip-list** (excluded from migration entirely):
- `.obsidian/`, `.git/`, `.DS_Store`, `node_modules/`
- `venv/`, `.venv/`, `__pycache__/` (Python virtualenv + bytecode)
- `.smart-env/`, `.smart-connections/` (Smart Connections plugin caches; rebuild on demand)
- `.trash/`
- `Invalid date/` (Templater bad-output sentinel)
- `*.tmp` (Templater intermediate files)
- `*.pyc` (Python bytecode)

**Coverage gaps** (v0.28.x carries):
- `project` migrator (Accuris uses `Planning/<slug>/`)
- `boards` migrator (Accuris boards = different Kanban shape)
- `journal` migrator (no Accuris source)
- `finance` + `trips` migrators (no Accuris source)
- `ero` + `headspace` source-detection (different layouts: `Resources/People/` for Headspace)

---

## Backup posture

- **Backup sibling** at `<vault>.pre-migration-<YYYYMMDD-HHMMSS>/` is OUTSIDE the vault dir (Obsidian doesn't index it).
- **Idempotent re-run:** `--commit` re-runs create a NEW timestamped backup, wipe, redo. Prior backups retained.
- **Restore from backup:** copy any individual file back manually. Or run a script to restore the entire vault content (`restoreFromBackup` exposed in `platform/migrate/commit.js`).

---

## Phone-Sync expectations

If your target vault is enabled with Obsidian Sync:

> [!warning] Large delta on first push
> Migration produces ~XXX file changes (1670 entries for real Accuris). First sync push will be substantial; expect minutes-to-hours depending on file size + bandwidth. **Backup sibling is OUTSIDE the vault dir and won't sync.**
>
> If sync rejects the changeset:
> 1. Pause sync via Obsidian's sync settings before running --commit.
> 2. Wait for migration to complete.
> 3. Force-push the post-migration state on resume.

---

## Troubleshooting

### "commit precheck: backup-sibling already exists"

You ran `--commit` within the same second. Wait 1 second + retry, or rename the prior backup.

### "commit precheck: target vault path does not exist"

The cwd is not a sauce-managed vault. `cd` into the target vault root + retry.

### "commit precheck: workshopPath not resolved"

The target vault's `ranch/platform-config.json` references a workshop path that doesn't exist. Run `sauce status` to verify; fix `workshop_relative_path` if needed.

### "no migrator claimed X"

Should never appear (verbatim is the priority-9999 fallback). If it does, file a bug — your source has a path the dispatcher's walk doesn't categorize.

### Wikilinks broken in migrated meetings/journal

The phase 4.5 wikilink rewrite handles `[[YYYY-MM-DD-DayName]]` → `[[DayName-YYYY-MM-DD]]` (daily prefix→suffix), `[[YYYY-MM-DD-Meetings]]` → `[[Meetings-YYYY-MM-DD]]` (hub), `[[YYYY-MM-DD-ToDo]]` → `[[ToDo-YYYY-MM-DD]]` (to-do), and `[[Extras/People/X]]` → `[[spice/people/X]]` (path).

If a non-rewriteable wikilink shape exists in your source, it stays unchanged. Check `migration.log` for `wikilinkRewrites: { rewrites, filesScanned }`.

### Templater folder-templates missing post-migration

Re-run `--commit` (idempotent). Or check `.obsidian/plugins/templater-obsidian/data.json` directly — the installer's `applyTemplaterFolderTemplates` helper writes folder-templates pointing at `ranch/templates/<Name>.md`.

---

## Restoring from backup

```bash
# Full vault restore (overwrites current state)
cd <workshop>/<vault-name>.pre-migration-<ts>/
cp -R . <workshop>/<vault-name>/
```

Per-file restore: copy individual files from the backup sibling to the vault path you want. Backup is read-only by convention; do NOT modify in place.

---

## Deferred-blueprint roadmap

| Blueprint | Status | Cycle target |
|---|---|---|
| people | ✅ shipped v0.28.0 | — |
| daily | ✅ shipped v0.28.0 | — |
| meetings-note | ✅ shipped v0.28.0 | — |
| meetings-hub | ✅ shipped v0.28.0 | — |
| to-do | ✅ shipped v0.28.0 | — |
| project | DEFERRED | v0.28.x |
| boards | DEFERRED | v0.28.x |
| journal | DEFERRED | v0.29.x |
| finance | DEFERRED | v0.29.x |
| trips | DEFERRED | v0.29.x |
| ero source-detection | DEFERRED | v0.28.x |
| headspace source-detection | DEFERRED | v0.29.x |

---

## See also

- `Docs/plans/2026-05-07-v0.28.0-migration-design.md` — design rationale
- `Docs/plans/2026-05-07-v0.28.0-migration-result.md` — cycle-close summary + lessons
- `Docs/landmines.md` #20 — source vault is read-only
- `Docs/install.md` — sauce platform install instructions
