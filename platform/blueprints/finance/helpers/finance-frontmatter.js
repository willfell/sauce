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
     * @returns {Promise<object>} the authoritative post-write frontmatter snapshot
     */
    async update(fileOrPath, mutator) {
        let file = fileOrPath;
        if (typeof fileOrPath === "string") {
            file = app.vault.getAbstractFileByPath(fileOrPath);
        }
        if (!file || !file.path || file.children !== undefined) {
            throw new Error(`FinanceFrontmatter.update: ${fileOrPath} not a file`);
        }
        let snapshot = null;
        let pending = null;
        await app.fileManager.processFrontMatter(file, (fm) => {
            const result = mutator(fm);
            if (result && typeof result.then === "function") {
                pending = Promise.resolve(result).then(() => { snapshot = this._clone(fm); });
            } else {
                snapshot = this._clone(fm);
            }
            return result;
        });
        if (pending) await pending;
        if (!this._writtenFrontmatter) this._writtenFrontmatter = new Map();
        this._writtenFrontmatter.set(file.path, {
            frontmatter: snapshot,
            mtime: Number(file.stat?.mtime) || null,
        });
        return this._clone(snapshot);
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
        const cached = app.metadataCache.getFileCache(file)?.frontmatter ?? null;
        const written = this._writtenFrontmatter?.get?.(file.path) || null;
        if (!written) return cached;

        // The metadata cache can lag a completed processFrontMatter write. Keep
        // the authoritative post-write snapshot available for the next gesture
        // until the cache catches up. A later file mtime means an external edit
        // won the race, so stop shadowing it immediately.
        const currentMtime = Number(file.stat?.mtime) || null;
        if (currentMtime && written.mtime && currentMtime > written.mtime) {
            this._writtenFrontmatter.delete(file.path);
            return cached;
        }
        if (this._same(cached, written.frontmatter)) {
            this._writtenFrontmatter.delete(file.path);
            return cached;
        }
        return this._clone(written.frontmatter);
    }

    _clone(value, seen = new Map()) {
        if (value === null || typeof value !== "object") return value;
        if (value instanceof Date) return new Date(value.getTime());
        if (seen.has(value)) return seen.get(value);
        const copy = Array.isArray(value) ? [] : {};
        seen.set(value, copy);
        for (const key of Object.keys(value)) copy[key] = this._clone(value[key], seen);
        return copy;
    }

    _same(left, right, seen = new Map()) {
        if (Object.is(left, right)) return true;
        if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
        if (left instanceof Date || right instanceof Date) {
            return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
        }
        if (seen.get(left) === right) return true;
        seen.set(left, right);
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        if (leftKeys.length !== rightKeys.length) return false;
        for (let i = 0; i < leftKeys.length; i++) {
            if (leftKeys[i] !== rightKeys[i] || !this._same(left[leftKeys[i]], right[rightKeys[i]], seen)) return false;
        }
        return true;
    }

    /**
     * Coerce a frontmatter value to boolean.
     * Accepts: true | "true" | "TRUE" → true; everything else → false.
     */
    isTruthy(v) {
        return v === true || (typeof v === "string" && v.toLowerCase() === "true");
    }
}
