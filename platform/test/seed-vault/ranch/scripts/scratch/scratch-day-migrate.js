/**
 * ScratchDayMigrate (CustomJS)
 *
 * Pure-helper migration class for scratch frontmatter `day:` field. Rewrites:
 *   (a) YAML-unquoted dates that parsed as JS Date → quoted YYYY-MM-DD string
 *       recovered from the file path or filename (NOT the Date's getDate(),
 *       which carries the bug the migration is closing — see landmine note
 *       in scratch-day-list.js v0.5.2).
 *   (b) Missing day: when the file path or filename encodes YYYY-MM-DD,
 *       synthesizes the string.
 *
 * Idempotent: post-migration files have `day:` as a quoted YYYY-MM-DD string,
 * which exits the migration immediately via the first guard.
 *
 * Driven once-per-session by ScratchDayMigrateInit (the customjs startup-script).
 * Manual re-run available via Cmd+P → "Sauce: Re-migrate scratch day frontmatter".
 *
 * v0.5.2 (sauce v0.84.1): initial release. Closes timezone-attribution drift
 * for late-night scratches whose YAML day: was unquoted.
 */
class ScratchDayMigrate {
  constructor() {
    this._lastRunDay = null;
  }

  /**
   * Mutate `fm` in place, returning true if any change was made.
   * Exposed for direct testing via the test harness.
   *
   * @param {object} fm — frontmatter object (will be mutated)
   * @param {{path: string}} file — Obsidian TFile (only .path is used)
   * @returns {boolean} — true if fm was changed, false otherwise
   */
  _migrateFrontmatter(fm, file) {
    if (!fm || typeof fm !== "object") return false;

    // Case 1: already a quoted YYYY-MM-DD string → no-op.
    if (typeof fm.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fm.day)) {
      return false;
    }

    // Recover the intended date from the file path (preferred) or filename.
    const pathDate = this._extractDateFromPath(file && file.path);
    if (!pathDate) {
      // No recovery source. If day is a Date or other broken value, we still
      // can't recover — leave it. Caller will continue without write.
      return false;
    }

    // Case 2 & 3: day is missing OR day is a Date / other non-string.
    if (typeof fm.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fm.day)) {
      fm.day = pathDate;
      return true;
    }

    return false;
  }

  /**
   * Pull a YYYY-MM-DD from either a `/YYYY-MM-DD/` path segment OR a
   * `Scratch-*-YYYY-MM-DD` filename pattern. Returns null if neither matches.
   */
  _extractDateFromPath(p) {
    if (typeof p !== "string" || p.length === 0) return null;
    const segMatch = p.match(/\/(\d{4}-\d{2}-\d{2})\//);
    if (segMatch) return segMatch[1];
    const filenameMatch = p.match(/(\d{4}-\d{2}-\d{2})(?:[-T_].*)?\.md$/);
    if (filenameMatch) return filenameMatch[1];
    return null;
  }

  /**
   * Migrate a single file via app.fileManager.processFrontMatter (mobile-safe).
   * @returns {Promise<boolean>} true if a write occurred
   */
  async migrate(file) {
    if (typeof app === "undefined" || !app.fileManager
        || typeof app.fileManager.processFrontMatter !== "function") {
      return false;
    }
    let changed = false;
    await app.fileManager.processFrontMatter(file, (fm) => {
      changed = this._migrateFrontmatter(fm, file);
    });
    return changed;
  }

  /**
   * Vault scan: walk spice/scratch/**​/*.md, migrate each. Caches per-day
   * (instance-level last-run YYYY-MM-DD), short-circuits same-day re-invokes.
   *
   * @param {boolean} force — bypass once-per-day cache (used by manual command)
   * @returns {Promise<{scanned: number, migrated: number, skipped: boolean}>}
   */
  async migrateAll(force) {
    if (typeof app === "undefined" || !app.vault || typeof app.vault.getMarkdownFiles !== "function") {
      return { scanned: 0, migrated: 0, skipped: true };
    }
    const today = (typeof window !== "undefined" && window.moment)
      ? window.moment().format("YYYY-MM-DD")
      : new Date().toISOString().slice(0, 10);
    if (!force && this._lastRunDay === today) {
      return { scanned: 0, migrated: 0, skipped: true };
    }
    const files = app.vault.getMarkdownFiles().filter(f =>
      f && typeof f.path === "string" && f.path.startsWith("spice/scratch/"));
    let migrated = 0;
    for (const f of files) {
      try {
        if (await this.migrate(f)) migrated++;
      } catch (e) {
        if (typeof console !== "undefined") console.warn("[ScratchDayMigrate]", f.path, e && e.message);
      }
    }
    this._lastRunDay = today;
    return { scanned: files.length, migrated, skipped: false };
  }
}
