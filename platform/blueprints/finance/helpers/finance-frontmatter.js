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
        this._releaseWrittenSnapshot(file.path, this._writtenFrontmatter.get(file.path));
        const written = {
            path: file.path,
            file,
            frontmatter: snapshot,
            mtime: Number(file.stat?.mtime) || null,
            eventRef: null,
            listener: null,
            metadata: null,
            deleteEventRef: null,
            deleteListener: null,
            renameEventRef: null,
            renameListener: null,
            vault: null,
        };
        this._writtenFrontmatter.set(file.path, written);
        this._watchWrittenSnapshot(file, written);
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
        return await this._serializeRendered(file, selector, async () => {
            const prepared = typeof opts.prepare === "function" ? await opts.prepare() : null;
            const lifecycle = prepared && typeof prepared === "object"
                ? Object.assign({}, opts, prepared)
                : opts;
            return await this._mutateRenderedNow(file, lifecycle, renderSafe, container, selector);
        });
    }

    async _serializeRendered(file, selector, task) {
        if (!this._renderQueues) this._renderQueues = new Map();
        if (!this._renderQueueFiles) this._renderQueueFiles = new WeakMap();
        if (!this._renderQueuePaths) this._renderQueuePaths = new Map();
        const path = String(file?.path || "");
        let owner = path ? this._renderQueuePaths.get(path) || null : null;
        if (!owner) owner = { path };
        if (file && typeof file === "object") this._renderQueueFiles.set(file, owner);
        if (path) this._renderQueuePaths.set(path, owner);
        let queue = this._renderQueues.get(owner);
        if (!queue) {
            queue = new Map();
            this._renderQueues.set(owner, queue);
        }
        const prior = queue.get(selector) || Promise.resolve();
        const current = prior.catch(() => {}).then(task);
        queue.set(selector, current);
        try { return await current; }
        finally {
            if (queue.get(selector) === current) queue.delete(selector);
            if (queue.size === 0 && this._renderQueues.get(owner) === queue) {
                this._renderQueues.delete(owner);
                for (const [alias, target] of this._renderQueuePaths) {
                    if (target === owner) this._renderQueuePaths.delete(alias);
                }
            }
        }
    }

    async _mutateRenderedNow(file, opts, renderSafe, container, selector) {
        let token = null;
        const outcome = await renderSafe.mutateStructure({
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
                token = {
                    container, selector, parent, oldRoot, nextSibling, focus,
                    optimisticRoot: null,
                    previous: this._renderOwner(container, selector),
                    status: "pending",
                    rolledBack: false,
                };
                this._setRenderOwner(container, selector, token);
                if (typeof opts.render !== "function") throw new Error("Finance optimistic render is required");
                try {
                    await opts.render();
                } catch (error) {
                    token.optimisticRoot = container && selector && typeof container.querySelector === "function"
                        ? container.querySelector(selector) : null;
                    this._rollbackRendered(token);
                    throw error;
                }
                token.optimisticRoot = container && selector && typeof container.querySelector === "function"
                    ? container.querySelector(selector) : null;
                if (this._renderOwner(container, selector) === token) {
                    this._restoreFocus(focus, token.optimisticRoot || container, false);
                }
                return token;
            },
            rollback: async (receipt) => {
                this._rollbackRendered(receipt || token);
            },
            write: async () => {
                if (typeof opts.write === "function") return await opts.write();
                if (typeof opts.mutator !== "function") throw new Error("Finance persistence mutator is required");
                return await this.update(file, opts.mutator);
            },
        });
        if (outcome?.ok && token) {
            token.status = "succeeded";
            if (this._renderOwner(container, selector) === token) {
                this._setRenderOwner(container, selector, null);
            }
        }
        return outcome;
    }

    _renderOwner(container, selector) {
        if (!container || !selector) return null;
        return this._renderOwners?.get?.(container)?.get?.(selector) || null;
    }

    _setRenderOwner(container, selector, token) {
        if (!container || !selector) return;
        if (!this._renderOwners) this._renderOwners = new WeakMap();
        let owners = this._renderOwners.get(container);
        if (!owners) {
            owners = new Map();
            this._renderOwners.set(container, owners);
        }
        if (token) owners.set(selector, token);
        else owners.delete(selector);
    }

    _rollbackRendered(token) {
        if (!token || token.rolledBack) return;
        token.status = "failed";
        token.rolledBack = true;
        if (this._renderOwner(token.container, token.selector) !== token) return;

        let restore = token;
        let owner = token.previous;
        while (owner && owner.status === "failed") {
            restore = owner;
            owner = owner.previous;
        }
        this._setRenderOwner(token.container, token.selector, owner || null);
        try { token.optimisticRoot?.remove?.(); } catch (_e) {}
        try { restore.parent?.insertBefore?.(restore.oldRoot, restore.nextSibling || null); } catch (_e) {}
        this._restoreFocus(restore.focus, restore.oldRoot || token.container, true);
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
        const path = typeof fileOrPath === "string" ? fileOrPath : fileOrPath?.path;
        if (!path) {
            return null;
        }
        try {
            file = app.vault.getAbstractFileByPath(path);
        } catch (_e) {
            // A transient lookup failure is not proof that the file was
            // deleted. Fail the read closed while retaining the one
            // identity-guarded authoritative snapshot for recovery.
            return null;
        }
        if (!file || !file.path || file.children !== undefined) {
            this._releaseWrittenSnapshot(path, this._writtenFrontmatter?.get?.(path));
            return null;
        }
        let cached = null;
        try { cached = app.metadataCache.getFileCache(file)?.frontmatter ?? null; }
        catch (_e) {
            // Cache availability is transient just like vault lookup
            // availability. Do not expose stale data or discard authority.
            return null;
        }
        const written = this._writtenFrontmatter?.get?.(file.path) || null;
        if (!written) return cached;

        // The metadata cache can lag a completed processFrontMatter write. Keep
        // the authoritative post-write snapshot available for the next gesture
        // until the cache catches up. A later file mtime means an external edit
        // won the race, so stop shadowing it immediately.
        if (this._writtenSnapshotSettled(file, written, cached)) return cached;
        return this._clone(written.frontmatter);
    }

    _watchWrittenSnapshot(file, written) {
        const metadata = (typeof app !== "undefined") ? app.metadataCache : null;
        if (!metadata || typeof metadata.on !== "function") return;
        const vault = (typeof app !== "undefined") ? app.vault : null;
        const settleCurrent = () => {
            const path = written.path;
            if (this._writtenFrontmatter?.get?.(path) !== written) return;
            let currentFile = null;
            try {
                currentFile = vault?.getAbstractFileByPath?.(path) || null;
            } catch (_e) {
                // Unknown is not deletion. Retain the single identity-guarded
                // owner until a later event or read can observe canonical state.
                return;
            }
            if (!currentFile || currentFile.path !== path || currentFile.children !== undefined) {
                this._releaseWrittenSnapshot(path, written);
                return;
            }
            let cached = null;
            try { cached = metadata.getFileCache?.(currentFile)?.frontmatter ?? null; }
            catch (_e) { return; }
            this._writtenSnapshotSettled(currentFile, written, cached);
        };
        const listener = (changedFile) => {
            if (!changedFile || changedFile.path !== written.path) return;
            settleCurrent();
        };
        const deleteListener = (deletedFile) => {
            if (!deletedFile || deletedFile.path !== written.path) return;
            // Same-path replacement can emit delete for the old TFile. Resolve
            // canonical identity so only actual absence releases authority.
            settleCurrent();
        };
        const renameListener = (renamedFile, oldPath) => {
            const priorPath = String(oldPath || "");
            if (!renamedFile || priorPath !== written.path) return;
            if (this._writtenFrontmatter?.get?.(priorPath) !== written) return;
            const nextPath = String(renamedFile.path || "");
            if (!nextPath || renamedFile.children !== undefined) {
                this._releaseWrittenSnapshot(priorPath, written);
                return;
            }
            const targetWritten = this._writtenFrontmatter.get(nextPath);
            if (targetWritten && targetWritten !== written) {
                // The vault rename event proves renamedFile now owns nextPath.
                // Any different owner retained there belongs to the displaced
                // target identity (for example after a transient delete lookup),
                // so retire it before moving the source authority into place.
                this._releaseWrittenSnapshot(nextPath, targetWritten);
            }
            this._writtenFrontmatter.delete(priorPath);
            written.path = nextPath;
            this._writtenFrontmatter.set(nextPath, written);
            settleCurrent();
        };
        try {
            written.metadata = metadata;
            written.listener = listener;
            written.eventRef = metadata.on("changed", listener) || null;
        } catch (_e) {
            written.metadata = null;
            written.listener = null;
            written.eventRef = null;
        }
        if (vault && typeof vault.on === "function") {
            written.vault = vault;
            try {
                written.deleteListener = deleteListener;
                written.deleteEventRef = vault.on("delete", deleteListener) || null;
            } catch (_e) {
                written.deleteListener = null;
                written.deleteEventRef = null;
            }
            try {
                written.renameListener = renameListener;
                written.renameEventRef = vault.on("rename", renameListener) || null;
            } catch (_e) {
                written.renameListener = null;
                written.renameEventRef = null;
            }
        }
        // A rename may mutate the captured TFile before its listener is
        // installed. Rebind that identity first; otherwise resolving only the
        // old path would misclassify the rename as deletion and drop authority.
        if (file?.path && file.path !== written.path) renameListener(file, written.path);
        else settleCurrent();
    }

    _writtenSnapshotSettled(file, written, cached) {
        const currentMtime = Number(file.stat?.mtime) || null;
        // Obsidian keeps one canonical TFile identity across rename, but a
        // delete/recreate or sync replacement can install a distinct TFile at
        // the same path without a monotonic mtime. Canonical identity therefore
        // outranks timestamps when deciding whether the completed write still
        // owns this path.
        const replaced = Boolean(written.file && file !== written.file);
        const superseded = replaced || Boolean(currentMtime && written.mtime && currentMtime > written.mtime);
        const converged = this._same(this._frontmatterData(cached, written.frontmatter), written.frontmatter);
        if (!superseded && !converged) return false;
        this._releaseWrittenSnapshot(file.path, written);
        return true;
    }

    _releaseWrittenSnapshot(path, written) {
        if (!written || this._writtenFrontmatter?.get?.(path) !== written) return;
        this._writtenFrontmatter.delete(path);
        const metadata = written.metadata || ((typeof app !== "undefined") ? app.metadataCache : null);
        try {
            if (written.eventRef && typeof metadata?.offref === "function") metadata.offref(written.eventRef);
            else if (written.listener && typeof metadata?.off === "function") metadata.off("changed", written.listener);
        } catch (_e) {}
        const vault = written.vault || ((typeof app !== "undefined") ? app.vault : null);
        try {
            if (written.deleteEventRef && typeof vault?.offref === "function") vault.offref(written.deleteEventRef);
            else if (written.deleteListener && typeof vault?.off === "function") vault.off("delete", written.deleteListener);
        } catch (_e) {}
        try {
            if (written.renameEventRef && typeof vault?.offref === "function") vault.offref(written.renameEventRef);
            else if (written.renameListener && typeof vault?.off === "function") vault.off("rename", written.renameListener);
        } catch (_e) {}
        written.eventRef = null;
        written.listener = null;
        written.metadata = null;
        written.deleteEventRef = null;
        written.deleteListener = null;
        written.renameEventRef = null;
        written.renameListener = null;
        written.vault = null;
        written.file = null;
    }

    _frontmatterData(frontmatter, written) {
        if (!frontmatter || typeof frontmatter !== "object") return frontmatter;
        const data = Array.isArray(frontmatter)
            ? []
            : Object.create(Object.getPrototypeOf(frontmatter));
        for (const key of Object.keys(frontmatter)) {
            // Obsidian attaches source-location metadata to cache snapshots;
            // processFrontMatter does not expose it to the write callback.
            if (key !== "position" || Object.prototype.hasOwnProperty.call(written || {}, key)) {
                Object.defineProperty(data, key, {
                    value: frontmatter[key], enumerable: true, writable: true, configurable: true,
                });
            }
        }
        return data;
    }

    _clone(value, seen = new Map()) {
        if (value === null || typeof value !== "object") return value;
        if (value instanceof Date) return new Date(value.getTime());
        if (seen.has(value)) return seen.get(value);
        const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
        seen.set(value, copy);
        for (const key of Object.keys(value)) {
            Object.defineProperty(copy, key, {
                value: this._clone(value[key], seen), enumerable: true, writable: true, configurable: true,
            });
        }
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
