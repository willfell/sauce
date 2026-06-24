/**
 * TaskParser (CustomJS) — pure-helper extraction of the v0.3.3
 * ToDoMigrateModal.parseTasks logic. Lives in its own file because
 * v0.4.0 retires ToDoMigrateModal but the parser is still useful
 * to ToDoDailyCarryover (carryover) and ToDoDailyRecurring (audit logging
 * of registry entries).
 *
 * Static API:
 *   TaskParser.parseTasks(content) → Block[]
 *
 * Each Block = {
 *   topLine: string,        // verbatim "- [ ] ..." line
 *   childLines: string[],   // indented continuation lines
 *   startIdx: number,       // inclusive line index into content.split('\n')
 *   endIdx: number          // inclusive last-line index (topLine if no children)
 * }
 *
 * Rules (unchanged from v0.3.3):
 * - Scope:
 *   - If a `## Tasks` heading exists, scan only between it and the next `## ` heading or EOF.
 *   - Otherwise (v0.4.0 minimal-template path), start after frontmatter (after the second `---`)
 *     and scan to EOF. This makes free-form tasks under dataviewjs blocks findable.
 * - Top-level task = `^- \[ \] ` (unchecked only).
 * - `- [x] ` (completed) lines are skipped, including any children.
 * - Children = lines whose first non-whitespace character is reached after at
 *   least one space or tab of indentation. A blank line followed by another
 *   indented line is still part of the child run; a blank line followed by a
 *   top-level line terminates children. Trailing blank child lines are trimmed.
 */
class TaskParser {

    // ---------- Instance delegator (customJS stores INSTANCES) ----------
    //
    // customJS stores an INSTANCE under window.customJS.TaskParser, and the
    // guard dispatches customJS.TaskParser.parseTasks(content) on it. The method
    // MUST exist as an instance method or live Obsidian throws "… is not a
    // function". Delegates to the static so the Node harness keeps the static API.

    parseTasks(content) { return TaskParser.parseTasks(content); }

    static parseTasks(content) {
        const lines = content.split('\n');
        // Find ## Tasks section bounds. If no `## Tasks` heading exists (v0.3.3+
        // minimal template + v0.4.0 5-block template), fall back to scanning the
        // whole body after frontmatter so free-form tasks added directly under the
        // dataviewjs blocks are findable.
        let tasksStart = -1;
        let tasksEnd = lines.length; // exclusive
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '## Tasks') {
                tasksStart = i + 1;
                break;
            }
        }
        if (tasksStart === -1) {
            // No heading — start after frontmatter (or at 0 if no frontmatter).
            if (lines[0] !== undefined && lines[0].trim() === '---') {
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '---') {
                        tasksStart = i + 1;
                        break;
                    }
                }
            }
            if (tasksStart === -1) tasksStart = 0;
            tasksEnd = lines.length;
        } else {
            for (let i = tasksStart; i < lines.length; i++) {
                if (/^## /.test(lines[i])) {
                    tasksEnd = i;
                    break;
                }
            }
        }

        const blocks = [];
        let i = tasksStart;
        while (i < tasksEnd) {
            const line = lines[i];
            const isUnchecked = /^[-*+] \[ \] /.test(line);
            const isChecked = /^[-*+] \[x\] /i.test(line);
            if (isUnchecked) {
                const start = i;
                const topLine = line;
                const childLines = [];
                let j = i + 1;
                while (j < tasksEnd) {
                    const next = lines[j];
                    // Stop on next top-level task line (checked OR unchecked).
                    if (/^[-*+] \[(?: |x)\] /i.test(next)) break;
                    // Top-level non-task line at column 0 (no leading whitespace) AND non-blank
                    // terminates children.
                    if (next.length > 0 && !/^[ \t]/.test(next)) break;
                    childLines.push(next);
                    j++;
                }
                // Trim trailing blank child lines for cleanliness when appending later.
                while (childLines.length && childLines[childLines.length - 1].trim() === '') {
                    childLines.pop();
                }
                blocks.push({ topLine, childLines, startIdx: start, endIdx: start + childLines.length });
                i = start + 1 + childLines.length;
                continue;
            }
            if (isChecked) {
                // Skip the checked top line + its children.
                let j = i + 1;
                while (j < tasksEnd) {
                    const next = lines[j];
                    if (/^[-*+] \[(?: |x)\] /i.test(next)) break;
                    if (next.length > 0 && !/^[ \t]/.test(next)) break;
                    j++;
                }
                i = j;
                continue;
            }
            i++;
        }
        return blocks;
    }
}
