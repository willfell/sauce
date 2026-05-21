/**
 * kanban-status-sync@0.1.0 — syncs obsidian-kanban board column positions
 * to `status:` frontmatter on moved cards (FA-10 / kanban-status-sync).
 *
 * Loaded via customJS class-file contract: the entire file body must be a
 * single class expression (no top-level helper declarations before the
 * class). Closure args visible per the loader contract: `app`, `customJS`,
 * `Notice`, `window`.
 *
 * Public API (static):
 *   KanbanStatusSync.parseBoardColumns(rawMd)   → string[]
 *   KanbanStatusSync.slugifyStatus(name)        → string
 *   KanbanStatusSync.computeDiff(columns, pages)→ {path, newStatus}[]
 *
 * Public API (instance):
 *   new KanbanStatusSync(app).syncBoard(boardPath) → Promise<void>
 */
class KanbanStatusSync {
  constructor(appRef) {
    this._app = appRef;
  }

  // ── Static pure helpers ───────────────────────────────────────────────────

  /**
   * Parse an obsidian-kanban board's raw markdown and return an ordered
   * array of column-label → card-path mappings.
   *
   * Returns: Array of { column: string, path: string } objects in document
   * order. Duplicate paths (a card appearing in two columns) are allowed —
   * computeDiff resolves last-occurrence wins.
   *
   * Recognises the canonical kanban board markdown shapes:
   *   ## Column Label\n- [ ] [[Note Title]]\n- [x] [[Done Note]]
   * Paths are resolved relative to the board file's parent — callers that
   * need absolute paths should pass the boardDir via opts (Task 4).
   *
   * @param {string} rawMd — full text of the .md board file
   * @returns {{ column: string, path: string }[]}
   */
  static parseBoardColumns(rawMd) {
    if (typeof rawMd !== "string") return [];
    const result = [];
    let currentColumn = null;
    const lines = rawMd.split("\n");
    for (const line of lines) {
      // Column heading: ## Some Label (but not ### or deeper)
      const colMatch = line.match(/^##\s+(.+)$/);
      if (colMatch) {
        currentColumn = colMatch[1].trim();
        continue;
      }
      // Card line: - [ ] [[Link]] or - [x] [[Link]] — extract wikilink target
      if (currentColumn !== null) {
        const cardMatch = line.match(/^- \[.\] \[\[(.+?)\]\]/);
        if (cardMatch) {
          result.push({ column: currentColumn, path: cardMatch[1].trim() });
        }
      }
    }
    return result;
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

  /**
   * Compute which cards need a status frontmatter update.
   * Stub — implemented in Task 4.
   *
   * @param {{ column: string, path: string }[]} columns — from parseBoardColumns
   * @param {object[]} pages — Dataview page objects with file.path + status
   * @returns {{ path: string, newStatus: string }[]}
   */
  static computeDiff(columns, pages) {
    // Task 4 stub
    return [];
  }

  /**
   * Top-level entry point: read the board file, parse columns, compute diff,
   * apply frontmatter patches, emit Notice.
   * Stub — implemented in Task 5.
   *
   * @param {string} boardPath — vault-relative path to the kanban board .md
   * @returns {Promise<void>}
   */
  async syncBoard(boardPath) {
    // Task 5 stub
    if (typeof Notice === "function") {
      new Notice("kanban-status-sync: syncBoard not yet implemented");
    }
  }
}
