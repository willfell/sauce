// platform/migrate/section-extract.js — v0.28.0 S2 (T2.6a).
//
// Markdown heading + callout-aware section extraction. Used by every
// per-blueprint migrator to lift user-authored sections out of source
// bodies for re-injection into Sauce templates. Per design Section 5
// + v0.27.0 lesson g (section-scoped extraction default).
//
// Public API:
//   extractSection(body, headingMatcher, opts) → { found, content, raw, startLine, endLine }
//
//   `headingMatcher`:
//     - string: exact line match (e.g., "## Notes" — matches a line whose
//       trimmed text equals the string). Heading level inferred from
//       leading `#` count; extraction stops at next heading of
//       equal-or-higher level.
//     - RegExp: matched against each line; first match starts extraction.
//       Heading level inferred from the matched line's leading `#` count
//       if any; for callouts (lines starting with `>`), extraction stops
//       at the first non-`>` line.
//
//   `opts`:
//     - includeHeading (default true): if true, `raw` includes the
//       matching heading line; `content` excludes it.
//
// Behavior:
//   - Returns { found:false, content:"", raw:"" } when matcher misses.
//   - Heading match: extracts from heading line through the line
//     immediately before the next equal/higher-level heading (or EOF).
//   - Callout match: extracts the contiguous block of lines starting
//     with `>` (the callout body) until the first non-`>` line.
//   - `content` is the body text BETWEEN the heading and the stop point
//     (exclusive of heading, exclusive of stop line).
//   - `raw` is the inclusive substring of all extracted lines.
//   - `startLine` / `endLine` are 0-indexed line numbers (endLine is
//     exclusive — i.e., points at the stop line or `lines.length`).

function extractSection(body, headingMatcher, opts) {
    opts = opts || {};
    if (typeof body !== "string") {
        return { found: false, content: "", raw: "", startLine: -1, endLine: -1 };
    }
    const lines = body.split("\n");

    // Phase 1 — find the start.
    let startIdx = -1;
    let level = 0;          // 0 = callout-mode (stop at non-`>` line)
    let isCallout = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let matched = false;
        if (typeof headingMatcher === "string") {
            if (line.trim() === headingMatcher.trim()) matched = true;
        } else if (headingMatcher instanceof RegExp) {
            if (headingMatcher.test(line)) matched = true;
        }
        if (!matched) continue;
        startIdx = i;
        const headingMatch = line.match(/^(#+)\s/);
        if (headingMatch) {
            level = headingMatch[1].length;
            isCallout = false;
        } else if (line.startsWith(">")) {
            level = 0;
            isCallout = true;
        } else {
            // Non-heading non-callout match: treat as heading-level 0
            // (any subsequent heading stops extraction).
            level = 0;
            isCallout = false;
        }
        break;
    }
    if (startIdx === -1) {
        return { found: false, content: "", raw: "", startLine: -1, endLine: -1 };
    }

    // Phase 2 — find the stop.
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (isCallout) {
            // Callout block ends at first non-`>` line.
            if (!line.startsWith(">")) { endIdx = i; break; }
        } else if (level > 0) {
            const m = line.match(/^(#+)\s/);
            if (m && m[1].length <= level) { endIdx = i; break; }
        } else {
            // No level constraint: stop at next heading of any level.
            if (/^#+\s/.test(line)) { endIdx = i; break; }
        }
    }

    const raw = lines.slice(startIdx, endIdx).join("\n");
    const content = lines.slice(startIdx + 1, endIdx).join("\n");
    return { found: true, content, raw, startLine: startIdx, endLine: endIdx };
}

module.exports = { extractSection };
