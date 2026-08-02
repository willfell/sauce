/**
 * FinanceFrontmatter — Shared frontmatter mutation helper for the finance blueprint.
 * One quoting/coercion home. Wraps Obsidian's app.fileManager.processFrontMatter
 * (Obsidian 1.4+) to bypass YAML edge cases hit in v0.16.0 (auto-parse-to-Date,
 * inline-flow NBSP, boolean->string). Used by every Budget/Paycheck/Invoice/TimeLog
 * editor widget.
 */
class FinanceFrontmatter {
    /** Never-throw current-page access for every Finance Dataview surface. */
    page(dv) {
        try {
            const renderSafe = (typeof customJS !== "undefined") ? customJS.RenderSafe : null;
            if (renderSafe && typeof renderSafe.page === "function") return renderSafe.page(dv);
            return dv && typeof dv.current === "function" ? (dv.current() || null) : null;
        } catch (_e) { return null; }
    }

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
     * Optimistically replace one Finance editor root before persistence. The
     * receipt retains the exact previous root, sibling position, and focused
     * control/selection so rejected writes restore identity rather than drawing
     * a stale lookalike from Dataview's cache.
     */
    async mutateRendered(fileOrPath, opts = {}) {
        const renderSafe = (typeof customJS !== "undefined") ? customJS.RenderSafe : null;
        const file = typeof fileOrPath === "string"
            ? app.vault.getAbstractFileByPath(fileOrPath)
            : fileOrPath;
        if (!file || !file.path || !renderSafe || typeof renderSafe.mutateStructure !== "function") {
            try { new Notice(opts.failureMessage || "Finance editor lifecycle is unavailable.", 6000); } catch (_e) {}
            return { ok: false, error: new Error("Finance RenderSafe lifecycle unavailable") };
        }
        const container = opts.container || (opts.dv && opts.dv.container) || null;
        const selector = String(opts.selector || "");
        return await renderSafe.mutateStructure({
            app,
            dv: opts.dv,
            path: file.path,
            failureMessage: opts.failureMessage || "Could not save Finance change",
            apply: async () => {
                const oldRoot = container && selector && typeof container.querySelector === "function"
                    ? container.querySelector(selector) : null;
                const parent = oldRoot && oldRoot.parentNode;
                const nextSibling = oldRoot && oldRoot.nextSibling;
                const focus = this._captureFocus(oldRoot || container);
                if (typeof opts.render !== "function") throw new Error("Finance optimistic render is required");
                try {
                    await opts.render();
                } catch (error) {
                    const failedRoot = container && selector && typeof container.querySelector === "function"
                        ? container.querySelector(selector) : null;
                    try { if (failedRoot && failedRoot !== oldRoot) failedRoot.remove?.(); } catch (_e) {}
                    try { parent?.insertBefore?.(oldRoot, nextSibling || null); } catch (_e) {}
                    this._restoreFocus(focus, oldRoot || container, true);
                    throw error;
                }
                const optimisticRoot = container && selector && typeof container.querySelector === "function"
                    ? container.querySelector(selector) : null;
                this._restoreFocus(focus, optimisticRoot || container, false);
                return { parent, oldRoot, nextSibling, optimisticRoot, focus };
            },
            rollback: async (receipt) => {
                if (!receipt) return;
                try { receipt.optimisticRoot?.remove?.(); } catch (_e) {}
                try { receipt.parent?.insertBefore?.(receipt.oldRoot, receipt.nextSibling || null); } catch (_e) {}
                this._restoreFocus(receipt.focus, receipt.oldRoot || container, true);
            },
            write: async () => {
                if (typeof opts.write === "function") return await opts.write();
                if (typeof opts.mutator !== "function") throw new Error("Finance persistence mutator is required");
                return await this.update(file, opts.mutator);
            },
        });
    }

    _captureFocus(scope) {
        try {
            const target = typeof document !== "undefined" ? document.activeElement : null;
            if (!target) return null;
            if (scope && typeof scope.contains === "function" && !scope.contains(target)) return null;
            const key = target.dataset && target.dataset.financeFocusKey
                ? String(target.dataset.financeFocusKey) : null;
            const start = Number.isInteger(target.selectionStart) ? target.selectionStart : null;
            const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : null;
            const direction = typeof target.selectionDirection === "string" ? target.selectionDirection : undefined;
            const path = this._focusPath(scope, target);
            return { target, key, path, start, end, direction, scope };
        } catch (_e) { return null; }
    }

    _restoreFocus(receipt, scope, exact) {
        if (!receipt) return;
        try {
            let target = exact ? receipt.target : null;
            if (!target && receipt.key && scope && typeof scope.querySelector === "function") {
                target = scope.querySelector(`[data-finance-focus-key="${receipt.key}"]`);
            }
            if (!target && receipt.path) target = this._focusAtPath(scope, receipt.path);
            if (!target && exact) target = receipt.target;
            target?.focus?.();
            if (receipt.start !== null && receipt.end !== null && typeof target?.setSelectionRange === "function") {
                target.setSelectionRange(receipt.start, receipt.end, receipt.direction);
            }
        } catch (_e) {}
    }

    _focusPath(scope, target) {
        if (!scope || !target || scope === target) return [];
        const path = [];
        let node = target;
        while (node && node !== scope) {
            const parent = node.parentElement || node.parentNode;
            if (!parent) return null;
            const siblings = Array.from(parent.children || []);
            const index = siblings.indexOf(node);
            if (index < 0) return null;
            path.push(index);
            node = parent;
        }
        return node === scope ? path.reverse() : null;
    }

    _focusAtPath(scope, path) {
        try {
            let node = scope;
            for (const index of path) {
                const children = Array.from(node?.children || []);
                node = children[index];
                if (!node) return null;
            }
            return node || null;
        } catch (_e) { return null; }
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
