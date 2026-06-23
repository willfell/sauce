// task-interactions.js — task-interactions mechanism v0.1.0 (introduced at
// sauce v0.127.0 cycle "task interactions + four post-v0.126.1 fixes"; see
// Docs/plans/2026-06-23-v0.127.0-task-interactions-and-fixes-design.md §B).
//
// Cross-blueprint contract layer for the inline-dataview-field task grammar
// emitted by ToDoCreateTask.serializePayloadToLine. Provides one parser, one
// serializer (delegates to ToDoCreateTask for byte-identical output), pure
// sentinel-marker injectors, a fence-aware scanner, plus type-dispatched
// appendTask / replaceTaskAt writers that NEVER throw — consumers (meeting
// dual-write in §C, to-do click-to-edit in §F) decide UX from { ok, reason }.
//
// Loaded via customjs-guard. All customJS dispatch uses
// `window.customJS?.X?.method` to avoid the cold-load TDZ trap (landmines #1,
// #2). Instance-delegator pattern per FLN-todo-13: customJS stores INSTANCES
// under window.customJS.TaskInteractions; the guard dispatches instance
// methods, so every public method exists as BOTH a static (Node-testable) and
// an instance (live Obsidian) form.
class TaskInteractions {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------

    parseTaskLine(line) { return TaskInteractions.parseTaskLine(line); }
    serializeTaskLine(payload) { return TaskInteractions.serializeTaskLine(payload); }
    actionItemsAnchor() { return TaskInteractions.actionItemsAnchor(); }
    todayCaptureAnchor() { return TaskInteractions.todayCaptureAnchor(); }
    injectActionItemsMarker(body) { return TaskInteractions.injectActionItemsMarker(body); }
    injectTodayCaptureMarker(body) { return TaskInteractions.injectTodayCaptureMarker(body); }
    findTaskLines(content, sectionAnchor) { return TaskInteractions.findTaskLines(content, sectionAnchor); }
    async appendTask(filePath, payload, opts) { return TaskInteractions.appendTask(filePath, payload, opts); }
    async replaceTaskAt(filePath, lineIdx, newLine) { return TaskInteractions.replaceTaskAt(filePath, lineIdx, newLine); }

    // ---------- Sentinel anchors (single source of truth) ----------

    static actionItemsAnchor() { return "<!-- ACTION_ITEMS_MARKER -->"; }
    static todayCaptureAnchor() { return "<!-- TODAY_CAPTURE_MARKER -->"; }

    // ---------- parseTaskLine ----------

    /**
     * Parse a single `- [ ] ` / `- [x] ` task line into a structured payload.
     * Inverse of ToDoCreateTask.serializePayloadToLine for one-shot + recurring
     * one-line payloads.
     *
     * @param {string} line
     * @returns {{raw, title, project, priority, due, scheduled, recurrence} | null}
     */
    static parseTaskLine(line) {
        if (typeof line !== "string") return null;
        const m = line.match(/^- \[[ xX]\] (.*)$/);
        if (!m) return null;
        const body = m[1];

        // Discover inline fields: [key:: value]
        const fieldRe = /\[(\w+)::\s*([^\]]+)\]/g;
        const fields = {};
        let firstFieldIdx = -1;
        let mm;
        while ((mm = fieldRe.exec(body)) !== null) {
            if (firstFieldIdx === -1) firstFieldIdx = mm.index;
            const key = mm[1];
            const val = mm[2].trim();
            // First occurrence wins (canonical serializer never duplicates).
            if (!(key in fields)) fields[key] = val;
        }

        const title = (firstFieldIdx === -1 ? body : body.slice(0, firstFieldIdx)).trim();

        // Strip wikilink brackets from project value: "[[Name]]" → "Name".
        let project = fields.project || null;
        if (project) {
            const wm = project.match(/^\[\[(.+?)\]\]$/);
            if (wm) project = wm[1];
        }

        return {
            raw: line,
            title,
            project,
            priority: fields.priority || null,
            due: fields.due || null,
            scheduled: fields.scheduled || null,
            recurrence: fields.recurrence || null,
        };
    }

    // ---------- serializeTaskLine ----------

    /**
     * Re-export of ToDoCreateTask.serializePayloadToLine. Delegates when the
     * to-do blueprint's class is loaded; otherwise falls back to an inline
     * re-implementation that produces byte-identical output for one-shot and
     * recurring single-line payloads.
     *
     * @param {object} payload — same shape ToDoCreateTask consumes.
     * @returns {string | null}
     */
    static serializeTaskLine(payload) {
        if (typeof window !== "undefined"
            && window.customJS
            && window.customJS.ToDoCreateTask
            && typeof window.customJS.ToDoCreateTask.serializePayloadToLine === "function") {
            return window.customJS.ToDoCreateTask.serializePayloadToLine(payload);
        }
        // Inline fallback — kept in lock-step with todo-create-task.js L36-53.
        if (!payload || !payload.title) return null;
        const parts = [`- [ ] ${payload.title.trim()}`];
        if (payload.mode === "recurring") {
            if (payload.recurrenceGrammar) parts.push(`[recurrence:: ${payload.recurrenceGrammar}]`);
            if (payload.project && payload.project.name) parts.push(`[project:: [[${payload.project.name}]]]`);
            if (payload.priority) parts.push(`[priority:: ${payload.priority}]`);
            return parts.join(" ");
        }
        if (payload.destination && payload.destination.type === "project" && payload.destination.name) {
            parts.push(`[project:: [[${payload.destination.name}]]]`);
        }
        if (payload.priority) parts.push(`[priority:: ${payload.priority}]`);
        if (payload.due) parts.push(`[due:: ${payload.due}]`);
        if (payload.scheduled) parts.push(`[scheduled:: ${payload.scheduled}]`);
        return parts.join(" ");
    }

    // ---------- Marker injectors (pure body transforms) ----------

    /**
     * Insert the ACTION_ITEMS_MARKER on its own line immediately BEFORE the
     * opening ``` fence of the Action Items SectionLabel block. Idempotent.
     * Returns body unchanged if either the marker already exists OR the
     * SectionLabel anchor is absent (the caller relies on _healNoteChromeBody
     * to insert the SectionLabel itself in a prior step).
     */
    static injectActionItemsMarker(body) {
        const marker = TaskInteractions.actionItemsAnchor();
        if (typeof body !== "string") return body;
        if (body.includes(marker)) return body;
        const needle = `class: "SectionLabel", args: [{ text: "Action Items" }]`;
        const idx = body.indexOf(needle);
        if (idx === -1) return body;

        const lines = body.split("\n");
        // Locate the line index that contains the SectionLabel call, then walk
        // backwards to the preceding opening ``` fence (start of the
        // dataviewjs block that wraps the SectionLabel call).
        let labelLineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(needle)) { labelLineIdx = i; break; }
        }
        if (labelLineIdx === -1) return body;

        let fenceLineIdx = -1;
        for (let i = labelLineIdx - 1; i >= 0; i--) {
            if (lines[i].trimStart().startsWith("```")) { fenceLineIdx = i; break; }
        }
        if (fenceLineIdx === -1) return body;

        // Insert: [blank, marker, blank] before the fence line.
        lines.splice(fenceLineIdx, 0, "", marker, "");
        return lines.join("\n");
    }

    /**
     * Insert the TODAY_CAPTURE_MARKER on its own line immediately AFTER the
     * closing ``` fence of the SectionLabel("Today", top: true) block.
     * Idempotent; returns body unchanged if the anchor SectionLabel is absent.
     */
    static injectTodayCaptureMarker(body) {
        const marker = TaskInteractions.todayCaptureAnchor();
        if (typeof body !== "string") return body;
        if (body.includes(marker)) return body;
        const needle = `class: "SectionLabel", args: [{ text: "Today", top: true }]`;
        const idx = body.indexOf(needle);
        if (idx === -1) return body;

        const lines = body.split("\n");
        let labelLineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(needle)) { labelLineIdx = i; break; }
        }
        if (labelLineIdx === -1) return body;

        // Walk forward to the closing ``` fence of this dataviewjs block.
        let closingFenceIdx = -1;
        for (let i = labelLineIdx + 1; i < lines.length; i++) {
            if (lines[i].trimStart().startsWith("```")) { closingFenceIdx = i; break; }
        }
        if (closingFenceIdx === -1) return body;

        // Insert: [blank, marker] AFTER the closing fence.
        lines.splice(closingFenceIdx + 1, 0, "", marker);
        return lines.join("\n");
    }

    // ---------- findTaskLines (fence-aware) ----------

    /**
     * Walk `content` line-by-line, returning every `- [ ]` / `- [x]` top-level
     * task at fence-depth 0 within the optional anchor scope.
     *
     * @param {string} content
     * @param {string} [sectionAnchor] — "todayCapture" | "actionItems" | undefined.
     *   When set, scanning starts AFTER the matching marker line and stops at
     *   the next SectionLabel block, the next `## ` markdown heading, or EOF.
     * @returns {Array<{idx, line, parsed}>}
     */
    static findTaskLines(content, sectionAnchor) {
        if (typeof content !== "string") return [];
        const lines = content.split("\n");

        let startIdx = 0;
        let endIdx = lines.length;
        if (sectionAnchor === "todayCapture" || sectionAnchor === "actionItems") {
            const marker = sectionAnchor === "todayCapture"
                ? TaskInteractions.todayCaptureAnchor()
                : TaskInteractions.actionItemsAnchor();
            let markerIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes(marker)) { markerIdx = i; break; }
            }
            if (markerIdx === -1) return [];
            startIdx = markerIdx + 1;
            // Stop at next SectionLabel block opener or next `## ` heading.
            for (let i = startIdx; i < lines.length; i++) {
                if (lines[i].includes('class: "SectionLabel"')) { endIdx = i; break; }
                if (/^## /.test(lines[i])) { endIdx = i; break; }
            }
        }

        const out = [];
        let fenceDepth = 0;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trimStart();
            if (trimmed.startsWith("```")) {
                fenceDepth = fenceDepth === 0 ? 1 : 0;
                continue;
            }
            if (i < startIdx || i >= endIdx) continue;
            if (fenceDepth !== 0) continue;
            if (/^- \[[ xX]\] /.test(lines[i])) {
                out.push({ idx: i, line: lines[i], parsed: TaskInteractions.parseTaskLine(lines[i]) });
            }
        }
        return out;
    }

    // ---------- Internal: frontmatter type ----------

    static _frontmatterType(body) {
        if (typeof body !== "string") return null;
        const lines = body.split("\n");
        if (lines[0] !== "---") return null;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === "---") break;
            const m = lines[i].match(/^type:\s*(.+?)\s*$/);
            if (m) {
                // Strip surrounding quotes if present.
                let v = m[1];
                if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                    v = v.slice(1, -1);
                }
                return v;
            }
        }
        return null;
    }

    // ---------- Internal: atomic write helper ----------

    static async _writeBack(file, newContent) {
        if (typeof app !== "undefined" && app && app.vault) {
            if (typeof app.vault.process === "function") {
                await app.vault.process(file, () => newContent);
            } else if (typeof app.vault.modify === "function") {
                await app.vault.modify(file, newContent);
            } else {
                throw new Error("vault has no process/modify");
            }
        } else {
            throw new Error("app.vault unavailable");
        }
    }

    // ---------- appendTask (universal writer) ----------

    /**
     * Append a serialized task line to the destination file, type-dispatched.
     * NEVER throws — returns `{ ok: true }` or `{ ok: false, reason }`.
     *
     * @param {string} filePath
     * @param {object} payload — same shape as ToDoCreateTask.serializePayloadToLine.
     * @param {object} [opts]
     * @param {string} [opts.serializedLine] — pre-serialized line; bypasses serializeTaskLine.
     */
    static async appendTask(filePath, payload, opts) {
        opts = opts || {};
        try {
            if (typeof app === "undefined" || !app || !app.vault) {
                return { ok: false, reason: "app.vault unavailable" };
            }
            const file = app.vault.getAbstractFileByPath(filePath);
            if (!file) return { ok: false, reason: "file-not-found" };
            const body = await app.vault.read(file);

            const type = TaskInteractions._frontmatterType(body);
            if (!type) return { ok: false, reason: "no-frontmatter-type" };

            const line = (typeof opts.serializedLine === "string" && opts.serializedLine.length > 0)
                ? opts.serializedLine
                : TaskInteractions.serializeTaskLine(payload);
            if (!line) return { ok: false, reason: "serialize-failed" };

            let newContent = null;

            if (type === "meeting") {
                const marker = TaskInteractions.actionItemsAnchor();
                let working = body;
                if (!working.includes(marker)) {
                    working = TaskInteractions.injectActionItemsMarker(working);
                    if (!working.includes(marker)) {
                        return { ok: false, reason: "no-action-items-anchor" };
                    }
                }
                const lines = working.split("\n");
                let markerLineIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(marker)) { markerLineIdx = i; break; }
                }
                if (markerLineIdx === -1) return { ok: false, reason: "no-action-items-anchor" };
                // Insert the new task line on the line immediately BEFORE the
                // marker, preceded by exactly one blank line.
                lines.splice(markerLineIdx, 0, line, "");
                newContent = lines.join("\n");
            } else if (type === "project-todo") {
                const needle = `class: "SectionLabel", args: [{ text: "Owned Tasks" }]`;
                const lines = body.split("\n");
                let labelLineIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(needle)) { labelLineIdx = i; break; }
                }
                if (labelLineIdx === -1) {
                    // Fallback: append to end of file with a leading blank line.
                    if (lines[lines.length - 1] !== "") lines.push("");
                    lines.push(line);
                    newContent = lines.join("\n");
                } else {
                    // Walk forward to closing ``` fence of the Owned Tasks block.
                    let closingFenceIdx = -1;
                    for (let i = labelLineIdx + 1; i < lines.length; i++) {
                        if (lines[i].trimStart().startsWith("```")) { closingFenceIdx = i; break; }
                    }
                    if (closingFenceIdx === -1) {
                        if (lines[lines.length - 1] !== "") lines.push("");
                        lines.push(line);
                    } else {
                        lines.splice(closingFenceIdx + 1, 0, "", line);
                    }
                    newContent = lines.join("\n");
                }
            } else if (type === "to-do") {
                const marker = TaskInteractions.todayCaptureAnchor();
                let working = body;
                if (!working.includes(marker)) {
                    working = TaskInteractions.injectTodayCaptureMarker(working);
                    if (!working.includes(marker)) {
                        return { ok: false, reason: "no-today-anchor" };
                    }
                }
                const lines = working.split("\n");
                let markerLineIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(marker)) { markerLineIdx = i; break; }
                }
                if (markerLineIdx === -1) return { ok: false, reason: "no-today-anchor" };
                // Insert the new task line AFTER the marker, with one blank
                // line between marker and the inserted line.
                lines.splice(markerLineIdx + 1, 0, "", line);
                newContent = lines.join("\n");
            } else if (type === "to-do-recurring") {
                return { ok: false, reason: "recurring writes go via ToDoCreateTask" };
            } else {
                return { ok: false, reason: "unknown-type:" + type };
            }

            await TaskInteractions._writeBack(file, newContent);
            return { ok: true };
        } catch (err) {
            const reason = err && err.message ? err.message : String(err);
            return { ok: false, reason };
        }
    }

    // ---------- replaceTaskAt ----------

    /**
     * Swap the line at `lineIdx` for `newLine`. Guarded: the existing line
     * MUST currently match `^- \[[ x]\] ` (so a stale lineIdx after a file
     * change is a recoverable error, not a corruption). NEVER throws.
     */
    static async replaceTaskAt(filePath, lineIdx, newLine) {
        try {
            if (typeof app === "undefined" || !app || !app.vault) {
                return { ok: false, reason: "app.vault unavailable" };
            }
            const file = app.vault.getAbstractFileByPath(filePath);
            if (!file) return { ok: false, reason: "file-not-found" };
            const body = await app.vault.read(file);
            const lines = body.split("\n");
            if (typeof lineIdx !== "number" || lineIdx < 0 || lineIdx >= lines.length) {
                return { ok: false, reason: "line-out-of-bounds" };
            }
            if (!/^- \[[ xX]\] /.test(lines[lineIdx])) {
                return { ok: false, reason: "line mismatch" };
            }
            lines[lineIdx] = newLine;
            const newContent = lines.join("\n");
            await TaskInteractions._writeBack(file, newContent);
            return { ok: true };
        } catch (err) {
            const reason = err && err.message ? err.message : String(err);
            return { ok: false, reason };
        }
    }
}
