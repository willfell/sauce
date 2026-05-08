---
date: 2026-05-08
purpose: Vault baseline rollup — multi-session work-list for cleaning up accuris-sauce / ero-sauce / headspace-sauce to a Sauce-conformant state. Companion to v0.29.0 cycle close. NOT a workshop release cycle — no version bumps, no tag, no harness changes; sessions edit vault files in place.
status: open (post-v0.29.0)
predecessors:
  - Docs/plans/2026-05-08-v0.29.0-vault-audit-design.md (Section 12 — protocol source)
  - Docs/plans/2026-05-08-v0.29.0-vault-audit-result.md (cycle close)
  - Docs/audit.md (user guide)
done_criterion: All 3 vaults pass `sauce audit --quiet` with exit 0 (or every untracked dir is intentional + accepted as user-owned residue, which would be allowlisted in a future `audit-allowlist.json` if v0.29.1 ships that mechanism).
---

# Vault baseline rollup

> [!info] Purpose
> Track multi-session vault cleanup work for the 3 migrated consumer vaults (accuris-sauce / ero-sauce / headspace-sauce). v0.29.0 ships `sauce audit` (detection-only). This doc captures session-by-session progress: each session adds an entry below with vault, before-violation-count, after-violation-count, what-was-fixed, what-remains. The rollup ends when all 3 vaults pass `sauce audit --quiet` exit 0 (or untracked dirs are explicitly accepted per-vault).

## Protocol per session

1. **Snapshot first** — copy target vault to `<vault>.pre-cleanup-<YYYYMMDD-HHmmss>/`. Mirrors v0.28.0 `.pre-migration-<ts>/` discipline. Cheap insurance against bad edits.
2. **Run `sauce audit <vault> --output-file <vault>/ranch/audits/<YYYY-MM-DD-HHmmss>-audit.md`** to capture starting state. The report goes inside the audited vault under `ranch/audits/` so it persists across Obsidian Sync without polluting `spice/` content.
3. **Walk the audit report top-down**, fix violations one by one. Claude makes file edits directly. Each fix is committed (if vault is git-managed) or simply persisted to disk + Obsidian Sync. Untracked top-level directories are evaluated case-by-case: migrate to `spice/<bp>/`, leave as user-owned residue, or surface to user for decision.
4. **Re-run `sauce audit <vault>`** at session end. Capture the closing report alongside the opening report under `ranch/audits/`.
5. **Append delta-summary to this doc** (under "Session log" below). New entry includes: date, vault, before-violation-count, after-violation-count, before-untracked-count, after-untracked-count, what-was-fixed (bullet list), what-remains (bullet list), notes.

## "Done" criterion

All 3 vaults pass `sauce audit --quiet` with exit 0. Equivalently: zero violations and zero untracked top-level directories per vault. The `--quiet` mode prints nothing and returns the exit code only — useful for CI / scripting once a vault stabilizes.

If untracked top-level directories represent user-owned content that legitimately doesn't fit under `spice/<bp>/`, they should either be:
- moved into `spice/<bp>/` if a blueprint covers them,
- moved into a sanctioned dir (`pantry/`, `ranch/`, `assets/`, `.obsidian/`, `.claude/`) if applicable,
- accepted as-is and (future) allowlisted in `ranch/audit-allowlist.json` if v0.29.1 ships that mechanism. Until then, accepted untracked dirs are tracked here in the per-vault status as "explicitly-accepted residue".

After the rollup reaches "done" criterion, v0.30.0 opens with new functionality (journal-migrator / full Sauce-shape project ecosystem / etc.) — exercised on barebones first, then propagated to the 3 conformant vaults.

---

## Per-vault status

### accuris-sauce

- **Initial baseline:** pending (first cleanup session)
- **Sessions:** (none yet)

### ero-sauce

- **Initial baseline:** pending (first cleanup session)
- **Sessions:** (none yet)

### headspace-sauce

- **Initial baseline:** pending (first cleanup session)
- **Sessions:** (none yet)

---

## Session log

(Append entries here per session. Template:

```
### YYYY-MM-DD — <vault-name> session <N>

- **Snapshot:** `<vault>.pre-cleanup-<YYYYMMDD-HHmmss>/`
- **Before:** <V> violations, <U> untracked dirs
- **After:** <V'> violations, <U'> untracked dirs
- **Fixed:**
  - <bullet>
- **Remains:**
  - <bullet>
- **Notes:** <free-form>
```
)
