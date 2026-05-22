/**
 * kanban-status-sync@0.1.0 — reconciles kanban card-note frontmatter against
 * the card's current column in its obsidian-kanban board.
 *
 * Loaded via customjs-guard (avoids landmines #1 / #2 cold-load TDZ). Three
 * closure args are visible in scope per the loader contract: `app`, `customJS`,
 * `Notice`. `app.fileManager.processFrontMatter` is read at call-time inside
 * syncBoard, never at class-load.
 *
 * Public API (instance methods on customJS.KanbanStatusSync):
 *   async syncAllBoards(dv, today) → { synced: number, archived: number, boards: number }
 *   async syncBoard(boardPath, today)  → { synced: number, archived: number }
 *
 * Pure static helpers (Node-testable):
 *   KanbanStatusSync.parseBoardColumns(boardSrc) → { [cardLinkpath]: columnName }
 *   KanbanStatusSync.slugifyStatus(name)         → string (lowercase, hyphenated)
 *   KanbanStatusSync.computeDiff(curMap, prior)  → { moves, creates, archives }
 *
 * NEVER reads file.mtime (mobile sync time, unreliable — landmine #23).
 * Frontmatter writes use app.fileManager.processFrontMatter (atomic).
 */
class KanbanStatusSync {
  async syncAllBoards(_dv, _today) {
    return { synced: 0, archived: 0, boards: 0 };
  }
  async syncBoard(_boardPath, _today) {
    return { synced: 0, archived: 0 };
  }
  /**
   * Parse an obsidian-kanban board's markdown source into a {cardLinkpath: columnName} map.
   * - Skips YAML frontmatter at the top of the file.
   * - A column is a depth-2 heading: `## ColumnName`.
   * - Cards are `[[wikilink]]` occurrences inside list items (`- [[...]]` or
   *   `- [[path|alias]]`) under a column heading. Bare wikilinks (not in a
   *   list item) are NOT cards — obsidian-kanban writes cards only as list items,
   *   and bare links inside a column are typically prose / descriptions.
   * - For `[[path/to/card|Alias]]`, the linkpath (left of `|`, before any `#`) is stored.
   * - Wikilinks outside any column are ignored.
   */
  static parseBoardColumns(boardSrc) {
    if (typeof boardSrc !== "string" || boardSrc.length === 0) return {};
    const lines = boardSrc.split("\n");
    let i = 0;
    if (lines[0] && lines[0].trim() === "---") {
      i = 1;
      while (i < lines.length && lines[i].trim() !== "---") i++;
      if (i < lines.length) i++;
    }
    const map = {};
    let currentColumn = null;
    const headingRe = /^##\s+(.+?)\s*$/;
    const listItemRe = /^\s*-\s+/;
    const linkRe = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const h = headingRe.exec(line);
      if (h) {
        currentColumn = h[1].trim();
        continue;
      }
      if (!currentColumn) continue;
      if (!listItemRe.test(line)) continue;
      let m;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(line)) !== null) {
        const linkpath = m[1].trim();
        if (linkpath.length > 0) map[linkpath] = currentColumn;
      }
    }
    return map;
  }
  /**
   * Normalize a raw column label to a status slug.
   * "In Progress" → "in-progress"; trims, lowercases, collapses spaces to single hyphen,
   * strips non-alphanumeric/hyphen.
   */
  static slugifyStatus(name) {
    if (typeof name !== "string") return "";
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  static computeDiff(_curMap, _priorMap) {
    return { moves: [], creates: [], archives: [] };
  }
}
