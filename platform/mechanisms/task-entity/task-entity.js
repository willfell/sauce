/**
 * TaskEntity (CustomJS) — pure core of the note-per-task model.
 *
 * Every to-do task becomes its own tiny note under `spice/tasks/` with
 * `type: task` frontmatter; surfaces (daily, project, meeting) live-query
 * those notes. This class owns the DETERMINISTIC, side-effect-free core:
 *
 *   - taskFilename(payload, moment) → collision-resistant filename
 *   - composeNote(payload)          → { path, frontmatter, body }
 *   - parseNote(page)               → normalized task view
 *   - queryToday(tasks, todayStr)   → { today, overdue }
 *   - validatePayload(payload)      → { valid, reason }
 *
 * SAFETY GUARANTEES (see README): one note per task means a bad write can only
 * ever touch one task's file, never a whole day's list; every helper here is
 * pure so the same input always yields the same output.
 *
 * DETERMINISM: no Date.now / Math.random / new Date — the filename hash is a
 * tiny non-crypto string hash over `title + '|' + HHmmss`, so two tasks
 * created in the same second with different titles land in different files,
 * and re-deriving the same payload+moment yields the same filename.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (`module.exports`,
 * `if`, ...) → "Unexpected token" → the class never registers. To Node-test,
 * load via `new Function(src + "; return TaskEntity;")()` (see run-task-entity.js).
 *
 * Static API (Node-testable, pure):
 *   TaskEntity.taskFilename(payload, moment) → string
 *   TaskEntity.composeNote(payload)          → { path, frontmatter, body }
 *   TaskEntity.parseNote(page)               → normalized object
 *   TaskEntity.queryToday(tasks, todayStr)   → { today, overdue }
 *   TaskEntity.validatePayload(payload)      → { valid, reason }
 */
class TaskEntity {

    // ---------- Instance delegators (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.TaskEntity, and
    // cross-class consumers (TaskDialog / TaskTodayList in later tasks, plus the
    // Node harness which news the class) reach these via that instance. A
    // static-only declaration is not on the prototype → the call throws at
    // runtime. Each instance method must precede its static in source order.

    taskFilename(payload, moment) { return TaskEntity.taskFilename(payload, moment); }
    composeNote(payload) { return TaskEntity.composeNote(payload); }
    parseNote(page) { return TaskEntity.parseNote(page); }
    queryToday(tasks, todayStr) { return TaskEntity.queryToday(tasks, todayStr); }
    validatePayload(payload) { return TaskEntity.validatePayload(payload); }

    // ---------- Static pure helpers ----------

    /**
     * Tiny non-crypto string hash → 4 lowercase hex chars. Deterministic:
     * same input → same output, ALWAYS. (FNV-1a-ish; masked to 16 bits.) No
     * Math.random / Date.now — those are banned and would break determinism +
     * the CJS-load gate's no-wall-clock-in-constructor invariant.
     */
    static _hash4(str) {
        let h = 0x811c9dc5; // FNV offset basis (32-bit)
        const s = String(str == null ? '' : str);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            // FNV prime multiply, kept in 32-bit range via Math.imul.
            h = Math.imul(h, 0x01000193);
        }
        // Fold to 16 bits and render as exactly 4 hex chars.
        const v = (h ^ (h >>> 16)) & 0xffff;
        return ('0000' + (v >>> 0).toString(16)).slice(-4);
    }

    /**
     * Deterministic per-task filename:
     *   task-<YYYYMMDD>-<HHmmss>-<hex4>.md
     * `moment` is a moment-like object exposing `.format(fmt)`. The hex4 is a
     * hash of `title + '|' + HHmmss`, so two tasks in the SAME second with
     * DIFFERENT titles get DIFFERENT filenames.
     */
    static taskFilename(payload, moment) {
        const p = payload || {};
        const ymd = moment && moment.format ? moment.format('YYYYMMDD') : '00000000';
        const hms = moment && moment.format ? moment.format('HHmmss') : '000000';
        const hex = TaskEntity._hash4((p.title || '') + '|' + hms);
        return `task-${ymd}-${hms}-${hex}.md`;
    }

    /**
     * Compose a task note from a create payload. Returns:
     *   { path: "spice/tasks/<filename>", frontmatter: {...}, body: "" }
     *
     * Frontmatter keys are emitted in the canonical schema order. Absent
     * scheduled / due / completed_at are emitted as EMPTY STRINGS (not omitted)
     * so downstream edits (setting a date) are a simple in-place field write.
     *
     * payload = {
     *   title, status?, scheduled?, due?, priority?,
     *   project?: { name, slug }, source?, source_note?,
     *   now?, moment?,   // now: ISO string; moment: moment-like for filename+created_at
     * }
     */
    static composeNote(payload) {
        const p = payload || {};
        const moment = p.moment || null;
        const filename = TaskEntity.taskFilename(p, moment);
        const createdAt = p.now
            || (moment && moment.format ? moment.format('YYYY-MM-DDTHH:mm:ssZ') : '');
        const project = (p.project && p.project.name) ? `[[${p.project.name}]]` : '';
        const projectSlug = (p.project && p.project.slug) ? p.project.slug : '';
        // Canonical key order — keep in lockstep with the schema in the README.
        const frontmatter = {
            type: 'task',
            title: p.title || '',
            status: p.status || 'open',
            scheduled: p.scheduled || '',
            due: p.due || '',
            priority: p.priority || '',
            project: project,
            project_slug: projectSlug,
            source: p.source || '',
            source_note: p.source_note || '',
            created_at: createdAt,
            completed_at: p.completed_at || '',
        };
        return { path: 'spice/tasks/' + filename, frontmatter: frontmatter, body: '' };
    }

    /**
     * Normalize a Dataview page (or plain frontmatter object) into a stable
     * task view. Missing status → "open"; blank/empty dates → null. The path is
     * read from `page.file.path` (Dataview) falling back to `page.path`.
     */
    static parseNote(page) {
        const p = page || {};
        const blankToNull = (v) => {
            if (v == null) return null;
            const s = String(v).trim();
            return s === '' ? null : s;
        };
        const path = (p.file && p.file.path) || p.path || null;
        return {
            title: p.title != null ? String(p.title) : '',
            status: p.status || 'open',
            scheduled: blankToNull(p.scheduled),
            due: blankToNull(p.due),
            priority: p.priority || '',
            project: p.project != null ? p.project : null,
            project_slug: p.project_slug != null ? p.project_slug : null,
            source: p.source != null ? p.source : null,
            source_note: p.source_note != null ? p.source_note : null,
            created_at: p.created_at != null ? p.created_at : null,
            completed_at: blankToNull(p.completed_at),
            path: path,
        };
    }

    /**
     * Partition a list of task-like objects (raw frontmatter or parseNote output)
     * relative to `todayStr` (YYYY-MM-DD). Only status==="open" tasks are
     * considered. Returns { today, overdue }:
     *   today   — scheduled === todayStr
     *   overdue — scheduled truthy AND scheduled < todayStr (string compare of
     *             zero-padded ISO dates is chronologically correct)
     * Future-scheduled and unscheduled open tasks appear in NEITHER bucket.
     */
    static queryToday(tasks, todayStr) {
        const today = [];
        const overdue = [];
        const list = Array.isArray(tasks) ? tasks : [];
        for (const t of list) {
            if (!t || t.status !== 'open') continue;
            const sched = t.scheduled;
            if (!sched) continue;
            if (sched === todayStr) today.push(t);
            else if (sched < todayStr) overdue.push(t);
            // sched > todayStr (future) → excluded from both buckets.
        }
        return { today: today, overdue: overdue };
    }

    /**
     * Validate a create/edit payload. `title` (non-empty after trim) is
     * required. `scheduled` / `due`, when present, must be strict YYYY-MM-DD.
     */
    static validatePayload(payload) {
        if (!payload) return { valid: false, reason: 'empty payload' };
        if (!payload.title || !String(payload.title).trim()) {
            return { valid: false, reason: 'title required' };
        }
        const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
        if (payload.scheduled && !DATE_RE.test(payload.scheduled)) {
            return { valid: false, reason: 'invalid scheduled date' };
        }
        if (payload.due && !DATE_RE.test(payload.due)) {
            return { valid: false, reason: 'invalid due date' };
        }
        return { valid: true };
    }
}
