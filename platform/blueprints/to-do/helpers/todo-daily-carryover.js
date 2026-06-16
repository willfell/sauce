/**
 * ToDoDailyCarryover (CustomJS) — auto-fires on render when sentinel is
 * absent. Walks back 7 days to find the most recent prior daily note;
 * parses top-level unchecked tasks via TaskParser; filters out
 * [project::]-tagged and [recurring_from::]-tagged lines; atomically
 * strips those blocks from the prior file and inserts them under
 * `## Carryover (from YYYY-MM-DD)` in today's daily after the
 * ToDoDailyCarryover dataviewjs block. Provenance: `[from:: [[ToDo-YYYY-MM-DD]]]`
 * appended to each migrated top-line.
 *
 * Render output: nothing visible (the carryover content is persisted text).
 *
 * Pure-helper static methods (Node-testable; no Obsidian globals):
 *   ToDoDailyCarryover.hasSentinel(content) → boolean
 *   ToDoDailyCarryover.findPriorDateInList(todayDateStr, availableDateStrs) → string | null
 *   ToDoDailyCarryover.eligibleBlocks(content) → Block[]
 *   ToDoDailyCarryover.stripBlocks(content, blocks) → string
 *   ToDoDailyCarryover.decorateTopLine(topLine, sourceDate) → string
 *   ToDoDailyCarryover.insertCarryoverIntoToday(todayContent, decoratedBlocks, sourceDate) → string
 *   ToDoDailyCarryover.writeSentinel(content, sourceDate) → string
 */
class ToDoDailyCarryover {

    async render(dv) {
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || !cur.file || cur.type !== 'to-do') return;
        // Filename of form ToDo-YYYY-MM-DD; basename has the ToDo- prefix.
        const m = cur.file.name && cur.file.name.match(/^ToDo-(\d{4}-\d{2}-\d{2})$/);
        if (!m) return;
        const todayStr = m[1];
        await this.materialize(cur.file.path, todayStr);
        // No visible render — empty section.
    }

    async materialize(todayPath, todayStr) {
        try {
            const vault = window.app && window.app.vault;
            if (!vault) return;
            const todayFile = vault.getAbstractFileByPath(todayPath);
            if (!todayFile) return;
            const todayContent = await vault.read(todayFile);
            if (ToDoDailyCarryover.hasSentinel(todayContent)) return;

            const prior = ToDoDailyCarryover._findPriorFromVault(todayStr, vault);
            if (!prior) {
                const updated = ToDoDailyCarryover.writeSentinel(todayContent, '(none)');
                await vault.modify(todayFile, updated);
                return;
            }

            const priorFile = vault.getAbstractFileByPath(prior.path);
            if (!priorFile) {
                const updated = ToDoDailyCarryover.writeSentinel(todayContent, '(none)');
                await vault.modify(todayFile, updated);
                return;
            }
            const priorContent = await vault.read(priorFile);
            const blocks = ToDoDailyCarryover.eligibleBlocks(priorContent);

            if (blocks.length === 0) {
                const updated = ToDoDailyCarryover.writeSentinel(todayContent, prior.dateStr);
                await vault.modify(todayFile, updated);
                return;
            }

            const newPrior = ToDoDailyCarryover.stripBlocks(priorContent, blocks);
            const decorated = blocks.map(b => ({
                topLine: ToDoDailyCarryover.decorateTopLine(b.topLine, prior.dateStr),
                childLines: b.childLines,
            }));
            const todayWithCarryover = ToDoDailyCarryover.insertCarryoverIntoToday(todayContent, decorated, prior.dateStr);
            const todayWithSentinel = ToDoDailyCarryover.writeSentinel(todayWithCarryover, prior.dateStr);

            await vault.modify(priorFile, newPrior);
            await vault.modify(todayFile, todayWithSentinel);
        } catch (e) {
            // Failure-loud via console; never throw to avoid breaking render.
            console.error('ToDoDailyCarryover.materialize:', e);
        }
    }

    static _findPriorFromVault(todayStr, vault) {
        // Walk back up to 7 calendar days; return first existing daily.
        const moment = window.moment;
        if (!moment) return null;
        const today = moment(todayStr, 'YYYY-MM-DD');
        for (let n = 1; n <= 7; n++) {
            const cand = today.clone().subtract(n, 'days');
            const dStr = cand.format('YYYY-MM-DD');
            const dPath = `spice/to-do/${cand.format('YYYY/MM-MMMM')}/ToDo-${dStr}.md`;
            const af = vault.getAbstractFileByPath ? vault.getAbstractFileByPath(dPath) : null;
            if (af) return { path: dPath, dateStr: dStr };
        }
        return null;
    }

    // ---------- Pure-helper static methods (Node-testable) ----------

    static hasSentinel(content) {
        return /<!-- carryover-from-[^>]+ -->/.test(content);
    }

    static findPriorDateInList(todayDateStr, availableDateStrs) {
        // Pure version of _findPriorFromVault for testing without a vault adapter.
        // Walks back 7 days from todayDateStr; returns the first dateStr present in availableDateStrs.
        const today = ToDoDailyCarryover._parseDate(todayDateStr);
        if (!today) return null;
        const set = new Set(availableDateStrs);
        for (let n = 1; n <= 7; n++) {
            const cand = ToDoDailyCarryover._addDays(today, -n);
            const candStr = ToDoDailyCarryover._formatDate(cand);
            if (set.has(candStr)) return candStr;
        }
        return null;
    }

    static _parseDate(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        return { y: +m[1], mo: +m[2], d: +m[3] };
    }

    static _addDays(date, days) {
        const dt = new Date(Date.UTC(date.y, date.mo - 1, date.d, 12, 0, 0));
        dt.setUTCDate(dt.getUTCDate() + days);
        return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
    }

    static _formatDate(date) {
        const p2 = (n) => String(n).padStart(2, '0');
        return `${date.y}-${p2(date.mo)}-${p2(date.d)}`;
    }

    static eligibleBlocks(content) {
        // Defer to TaskParser; filter out project-routed and recurring-routed.
        const all = (window.customJS && window.customJS.TaskParser)
            ? window.customJS.TaskParser.parseTasks(content)
            : ToDoDailyCarryover._fallbackParse(content);
        return all.filter(b =>
            !/\[project::\s*\[\[/.test(b.topLine) &&
            !/\[recurring_from::\s*\[\[/.test(b.topLine)
        );
    }

    static _fallbackParse(content) {
        // Used by Node test harness when customJS.TaskParser is not present.
        // Same algorithm as TaskParser.parseTasks; duplicated to keep the helper
        // testable in isolation. In production, customjs autoloads TaskParser.
        const lines = content.split('\n');
        let tasksStart = -1;
        let tasksEnd = lines.length;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '## Tasks') { tasksStart = i + 1; break; }
        }
        if (tasksStart === -1) {
            if (lines[0] !== undefined && lines[0].trim() === '---') {
                for (let i = 1; i < lines.length; i++) {
                    if (lines[i].trim() === '---') { tasksStart = i + 1; break; }
                }
            }
            if (tasksStart === -1) tasksStart = 0;
            tasksEnd = lines.length;
        } else {
            for (let i = tasksStart; i < lines.length; i++) {
                if (/^## /.test(lines[i])) { tasksEnd = i; break; }
            }
        }
        const blocks = [];
        let i = tasksStart;
        while (i < tasksEnd) {
            const line = lines[i];
            if (/^- \[ \] /.test(line)) {
                const start = i;
                const topLine = line;
                const childLines = [];
                let j = i + 1;
                while (j < tasksEnd) {
                    const nxt = lines[j];
                    if (/^- \[(?: |x)\] /i.test(nxt)) break;
                    if (nxt.length > 0 && !/^[ \t]/.test(nxt)) break;
                    childLines.push(nxt);
                    j++;
                }
                while (childLines.length && childLines[childLines.length - 1].trim() === '') childLines.pop();
                blocks.push({ topLine, childLines, startIdx: start, endIdx: start + childLines.length });
                i = start + 1 + childLines.length;
                continue;
            }
            if (/^- \[x\] /i.test(line)) {
                let j = i + 1;
                while (j < tasksEnd) {
                    const nxt = lines[j];
                    if (/^- \[(?: |x)\] /i.test(nxt)) break;
                    if (nxt.length > 0 && !/^[ \t]/.test(nxt)) break;
                    j++;
                }
                i = j;
                continue;
            }
            i++;
        }
        return blocks;
    }

    static stripBlocks(content, blocks) {
        if (!blocks.length) return content;
        const lines = content.split('\n');
        const toRemove = new Set();
        for (const b of blocks) {
            for (let k = b.startIdx; k <= b.endIdx; k++) toRemove.add(k);
        }
        return lines.filter((_, i) => !toRemove.has(i)).join('\n');
    }

    static decorateTopLine(topLine, sourceDate) {
        // Append `[from:: [[ToDo-<sourceDate>]]]` to the top line if absent.
        if (/\[from::\s*\[\[/.test(topLine)) return topLine;
        return `${topLine.replace(/\s+$/, '')} [from:: [[ToDo-${sourceDate}]]]`;
    }

    static insertCarryoverIntoToday(todayContent, decoratedBlocks, sourceDate) {
        // Find the ToDoDailyCarryover dataviewjs block; insert the heading + blocks
        // immediately AFTER that block.
        const ANCHOR_RE = /(```dataviewjs[^`]*class:\s*"ToDoDailyCarryover"[^`]*```\n?)/;
        const m = ANCHOR_RE.exec(todayContent);
        const headingAndLines = [
            '',
            `## Carryover (from ${sourceDate})`,
            '',
        ];
        for (const b of decoratedBlocks) {
            headingAndLines.push(b.topLine);
            if (b.childLines && b.childLines.length) {
                for (const cl of b.childLines) headingAndLines.push(cl);
            }
        }
        headingAndLines.push('');
        const block = headingAndLines.join('\n');
        if (m) {
            const insertPos = m.index + m[0].length;
            return todayContent.slice(0, insertPos) + block + todayContent.slice(insertPos);
        }
        // Fallback: append at EOF.
        return todayContent.replace(/\n+$/, '') + '\n' + block + '\n';
    }

    static writeSentinel(content, sourceDate) {
        // Sentinel goes into the frontmatter region (between the two `---` lines).
        // Format: `<!-- carryover-from-<sourceDate> -->\n` inserted on the line BEFORE the closing `---`.
        const lines = content.split('\n');
        if (lines[0] !== '---') {
            // No frontmatter — prepend at top.
            return `<!-- carryover-from-${sourceDate} -->\n` + content;
        }
        let closeIdx = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === '---') { closeIdx = i; break; }
        }
        if (closeIdx === -1) {
            // Malformed frontmatter; prepend sentinel.
            return `<!-- carryover-from-${sourceDate} -->\n` + content;
        }
        // Replace prior sentinel(s) in the frontmatter region if present.
        const before = lines.slice(0, closeIdx).filter(l => !/^<!-- carryover-from-/.test(l));
        const after = lines.slice(closeIdx);
        before.push(`<!-- carryover-from-${sourceDate} -->`);
        return before.concat(after).join('\n');
    }
}
