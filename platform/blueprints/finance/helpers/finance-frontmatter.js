/**
 * FinanceFrontmatter — Shared frontmatter mutation helper for the finance blueprint.
 * One quoting/coercion home. Wraps Obsidian's app.fileManager.processFrontMatter
 * (Obsidian 1.4+) to bypass YAML edge cases hit in v0.16.0 (auto-parse-to-Date,
 * inline-flow NBSP, boolean->string). Used by every Budget/Paycheck/Invoice/TimeLog
 * editor widget.
 */
class FinanceFrontmatter {
    /**
     * Mutate frontmatter on a TFile or path. Wraps app.fileManager.processFrontMatter.
     * @param {TFile|string} fileOrPath - TFile or vault-relative path string
     * @param {(fm: object) => void | Promise<void>} mutator - mutates fm in place
     * @returns {Promise<void>}
     */
    async update(fileOrPath, mutator) {
        let file = fileOrPath;
        if (typeof fileOrPath === "string") {
            file = app.vault.getAbstractFileByPath(fileOrPath);
        }
        if (!file || !file.path || file.children !== undefined) {
            throw new Error(`FinanceFrontmatter.update: ${fileOrPath} not a file`);
        }
        await app.fileManager.processFrontMatter(file, mutator);
    }

    /**
     * Read-only frontmatter snapshot via metadataCache.
     * @param {TFile|string} fileOrPath
     * @returns {object | null} null if file missing or no frontmatter
     */
    read(fileOrPath) {
        let file = fileOrPath;
        if (typeof fileOrPath === "string") {
            file = app.vault.getAbstractFileByPath(fileOrPath);
        }
        if (!file || !file.path || file.children !== undefined) {
            return null;
        }
        return app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    }

    /**
     * Coerce a frontmatter value to boolean.
     * Accepts: true | "true" | "TRUE" → true; everything else → false.
     */
    isTruthy(v) {
        return v === true || (typeof v === "string" && v.toLowerCase() === "true");
    }
}
