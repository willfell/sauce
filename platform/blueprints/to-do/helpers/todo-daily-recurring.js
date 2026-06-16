/**
 * ToDoDailyRecurring (CustomJS) — materialization-on-render helper.
 *
 * Reads `spice/to-do/Recurring Tasks.md` registry; parses each `- [ ]` line under
 * `## Recurring Tasks` heading; evaluates each entry's recurrence against today;
 * for matching entries, generates a fresh `- [ ]` line (strips `[recurrence::]`,
 * adds `[recurring_from:: [[Recurring Tasks]]]`) and inserts under `## Recurring
 * Today` in the daily note. Writes an audit row into the registry's
 * `## Last 7 days of materialization` table (cap 50 rows).
 *
 * Sentinel-gated idempotency: `<!-- recurring-materialized-YYYY-MM-DD -->` in
 * today's frontmatter region.
 *
 * v0.4.0 shipping note: project-linked recurring entries (`[project:: [[X]]]`)
 * materialize into `## Recurring Today` like everyone else; the project tag is
 * preserved on the line. v0.117.0 carry-forward: route project-linked materialized
 * lines into the daily's per-project sub-section anchor.
 *
 * Pure static helpers (Node-testable):
 *   parseRegistryLine(line) → entry | null
 *   parseRegistry(content) → entry[]
 *   materializeLineFromEntry(entry) → string
 *   matchesToday(entry, todayDateStr, registryCreatedAt) → boolean
 *   insertRecurringIntoToday(todayContent, lines) → string
 *   hasSentinel(content) → boolean
 *   writeSentinel(content, dateStr) → string
 *   appendAuditRow(registryContent, row) → string
 */
class ToDoDailyRecurring {

    async render(dv) {
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || !cur.file || cur.type !== 'to-do') return;
        const m = cur.file.name && cur.file.name.match(/^ToDo-(\d{4}-\d{2}-\d{2})$/);
        if (!m) return;
        const todayStr = m[1];
        await this.materialize(cur.file.path, todayStr);
    }

    async materialize(todayPath, todayStr) {
        try {
            const vault = window.app && window.app.vault;
            if (!vault) return;
            const todayFile = vault.getAbstractFileByPath(todayPath);
            if (!todayFile) return;
            const todayContent = await vault.read(todayFile);
            if (ToDoDailyRecurring.hasSentinel(todayContent)) return;

            const registryPath = 'spice/to-do/Recurring Tasks.md';
            const registryFile = vault.getAbstractFileByPath(registryPath);
            if (!registryFile) {
                const updated = ToDoDailyRecurring.writeSentinel(todayContent, todayStr);
                await vault.modify(todayFile, updated);
                return;
            }
            const registryContent = await vault.read(registryFile);
            const entries = ToDoDailyRecurring.parseRegistry(registryContent);
            const registryCreatedAt = ToDoDailyRecurring._extractRegistryCreatedAt(registryContent);

            const materialized = [];
            const auditRows = [];
            for (const entry of entries) {
                let fires = false;
                try {
                    fires = ToDoDailyRecurring.matchesToday(entry, todayStr, registryCreatedAt);
                } catch (e) {
                    fires = false;
                }
                if (!fires) {
                    if (entry.invalid) {
                        auditRows.push({ date: todayStr, title: entry.title || '(invalid)', route: '(skipped: invalid grammar)' });
                    }
                    continue;
                }
                materialized.push(ToDoDailyRecurring.materializeLineFromEntry(entry));
                const route = entry.project ? `ToDo-${todayStr}.md (${entry.project})` : `ToDo-${todayStr}.md`;
                auditRows.push({ date: todayStr, title: entry.title, route });
            }

            let newToday = ToDoDailyRecurring.insertRecurringIntoToday(todayContent, materialized);
            newToday = ToDoDailyRecurring.writeSentinel(newToday, todayStr);

            let newRegistry = registryContent;
            for (const row of auditRows) {
                newRegistry = ToDoDailyRecurring.appendAuditRow(newRegistry, row);
            }
            newRegistry = ToDoDailyRecurring.trimAuditTable(newRegistry, 50);

            await vault.modify(todayFile, newToday);
            if (newRegistry !== registryContent) {
                await vault.modify(registryFile, newRegistry);
            }
        } catch (e) {
            console.error('ToDoDailyRecurring.materialize:', e);
        }
    }

    // ---------- Pure-helper static methods ----------

    static parseRegistryLine(line) {
        // Line shape: "- [ ] Title [recurrence:: every X] [project:: [[Name]]] [priority:: high]"
        const m = /^- \[ \] (.+)$/.exec(line);
        if (!m) return null;
        const rest = m[1];
        const fields = ToDoDailyRecurring._extractInlineFields(rest);
        // Strip inline fields (plain + wikilink) for the title. Wikilink form
        // [field:: [[X]]] must be matched as a unit; otherwise the plain-field
        // regex consumes up to the first `]` and leaves `]]` in the title.
        const title = rest.replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, '').trim();
        if (!title) return null;
        const recurrence = fields.recurrence || null;
        const out = { title, recurrence };
        if (!recurrence) {
            return { ...out, invalid: true };
        }
        if (fields.project) out.project = fields.project;
        if (fields.priority) out.priority = fields.priority;
        // Validate recurrence is supported.
        if (window.customJS && window.customJS.RecurrenceParser) {
            if (!window.customJS.RecurrenceParser.isSupported(recurrence)) {
                out.invalid = true;
            }
        }
        return out;
    }

    static _extractInlineFields(text) {
        // Extract [key:: value] inline fields, handling wikilink values [[X]].
        const fields = {};
        const re = /\[(\w+)::\s*([^\]]+(?:\]\][^\]]*)*)\]/g;
        let mm;
        while ((mm = re.exec(text)) !== null) {
            let val = mm[2].trim();
            // Wikilink fields embed `[[X]]` — preserve.
            const wl = /^\[\[([^\]]+)\]\]$/.exec(val);
            if (wl) val = wl[1];
            fields[mm[1]] = val;
        }
        return fields;
    }

    static parseRegistry(content) {
        const lines = content.split('\n');
        let inRecurring = false;
        const entries = [];
        for (const line of lines) {
            if (/^## Recurring Tasks/.test(line)) { inRecurring = true; continue; }
            if (inRecurring && /^## /.test(line)) { inRecurring = false; continue; }
            if (!inRecurring) continue;
            const entry = ToDoDailyRecurring.parseRegistryLine(line);
            if (entry) entries.push(entry);
        }
        return entries;
    }

    static matchesToday(entry, todayDateStr, registryCreatedAt) {
        if (!entry || !entry.recurrence) return false;
        // Use a small moment-lite to evaluate.
        const dateMoment = ToDoDailyRecurring._makeMomentLite(todayDateStr);
        const anchor = registryCreatedAt ? ToDoDailyRecurring._makeMomentLite(registryCreatedAt) : null;
        if (window.customJS && window.customJS.RecurrenceParser) {
            return window.customJS.RecurrenceParser.matches(entry.recurrence, dateMoment, { registryCreatedAt: anchor });
        }
        // Fallback (Node testing) — pull recurrence-parser body inline.
        return ToDoDailyRecurring._fallbackRecurrenceMatch(entry.recurrence, dateMoment, anchor);
    }

    static _makeMomentLite(isoOrYmd) {
        // Accepts "YYYY-MM-DD" or full ISO; uses Date.UTC for stability.
        const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoOrYmd);
        if (!ymd) return null;
        const ms = Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3], 12, 0, 0);
        const dt = new Date(ms);
        return {
            _ms: ms,
            day: () => dt.getUTCDay(),
            date: () => dt.getUTCDate(),
            diff: (other, unit) => {
                if (unit !== 'days') return 0;
                return Math.floor((ms - other._ms) / 86400000);
            },
        };
    }

    static _fallbackRecurrenceMatch(grammar, dateMoment, anchor) {
        if (typeof grammar !== 'string') return false;
        const g = grammar.trim().toLowerCase();
        if (!g.startsWith('every ')) return false;
        const tail = g.slice(6).trim();
        const dow = dateMoment.day();
        const dom = dateMoment.date();
        if (tail === 'day') return true;
        if (tail === 'weekday' || tail === 'weekdays') return dow >= 1 && dow <= 5;
        if (tail === 'weekend' || tail === 'weekends') return dow === 0 || dow === 6;
        const m1 = tail.match(/^(\d{1,2})(?:st|nd|rd|th)? of (?:the )?month$/);
        if (m1) return dom === +m1[1];
        const m2 = tail.match(/^(\d+)\s+weeks?\s+on\s+(.+)$/);
        if (m2) {
            if (!anchor) return false;
            const dayPart = m2[2].trim();
            const days = ToDoDailyRecurring._toDayNumSet(dayPart);
            if (!days || !days.has(dow)) return false;
            const dd = dateMoment.diff(anchor, 'days');
            return dd >= 0 && Math.floor(dd / 7) % (+m2[1]) === 0;
        }
        const days = ToDoDailyRecurring._toDayNumSet(tail);
        return days ? days.has(dow) : false;
    }

    static _toDayNumSet(text) {
        const tokens = text.split(/[\s,]+/).filter(Boolean);
        if (!tokens.length) return null;
        const map = {
            sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
            wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
            friday: 5, fri: 5, saturday: 6, sat: 6,
        };
        const out = new Set();
        for (const t of tokens) {
            const lc = t.toLowerCase();
            if (!Object.prototype.hasOwnProperty.call(map, lc)) return null;
            out.add(map[lc]);
        }
        return out;
    }

    static materializeLineFromEntry(entry) {
        // Strip recurrence; preserve project + priority; add recurring_from provenance.
        const parts = [`- [ ] ${entry.title}`];
        parts.push(`[recurring_from:: [[Recurring Tasks]]]`);
        if (entry.project) parts.push(`[project:: [[${entry.project}]]]`);
        if (entry.priority) parts.push(`[priority:: ${entry.priority}]`);
        return parts.join(' ');
    }

    static insertRecurringIntoToday(todayContent, materializedLines) {
        if (!materializedLines || !materializedLines.length) return todayContent;
        // v0.5.0: emit a SectionLabel dataviewjs block instead of `## Recurring Today` H2.
        const labelLines = [
            '',
            '```dataviewjs',
            'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Recurring Today" }] });',
            '```',
            '',
        ];
        const block = labelLines.concat(materializedLines).concat(['']).join('\n');
        // Find the ToDoDailyRecurring dataviewjs block; insert immediately after it.
        const ANCHOR_RE = /(```dataviewjs[^`]*class:\s*"ToDoDailyRecurring"[^`]*```\n?)/;
        const m = ANCHOR_RE.exec(todayContent);
        if (m) {
            const pos = m.index + m[0].length;
            return todayContent.slice(0, pos) + block + todayContent.slice(pos);
        }
        return todayContent.replace(/\n+$/, '') + '\n' + block + '\n';
    }

    static hasSentinel(content) {
        return /<!-- recurring-materialized-[^>]+ -->/.test(content);
    }

    static writeSentinel(content, dateStr) {
        // Sentinel lives OUTSIDE the frontmatter (HTML comment immediately AFTER the closing `---`).
        // v0.117.1 fix: previously placed inside the frontmatter block which broke YAML parsing.
        const lines = content.split('\n');
        if (lines[0] !== '---') {
            return `<!-- recurring-materialized-${dateStr} -->\n` + content;
        }
        let closeIdx = -1;
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] === '---') { closeIdx = i; break; }
        }
        if (closeIdx === -1) {
            return `<!-- recurring-materialized-${dateStr} -->\n` + content;
        }
        const fmRegion = lines.slice(0, closeIdx + 1).filter(l => !/^<!-- recurring-materialized-/.test(l));
        const after = lines.slice(closeIdx + 1).filter(l => !/^<!-- recurring-materialized-/.test(l));
        return fmRegion.concat([`<!-- recurring-materialized-${dateStr} -->`], after).join('\n');
    }

    static appendAuditRow(registryContent, row) {
        // row = { date, title, route }
        // v0.5.0: the audit-log section header is a SectionLabel dataviewjs block
        // OR (legacy) a `## Last 7 days of materialization` H2. Find by substring.
        const headerRow = '| Date | Title | Routed to |';
        const sepRow = '| --- | --- | --- |';
        const newRow = `| ${row.date} | ${row.title} | ${row.route} |`;
        const idx = ToDoDailyRecurring._findAuditSectionStart(registryContent);
        if (idx === -1) {
            // No audit section yet — append at EOF with a SectionLabel block.
            const labelBlock = [
                '```dataviewjs',
                'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Last 7 days of materialization" }] });',
                '```',
                '',
            ].join('\n');
            return registryContent.replace(/\n+$/, '') + '\n\n' + labelBlock + '\n' + [headerRow, sepRow, newRow].join('\n') + '\n';
        }
        // Find end of the section (next ## heading or another SectionLabel block, or EOF).
        const sectionEnd = ToDoDailyRecurring._findAuditSectionEnd(registryContent, idx);
        const head = registryContent.slice(0, sectionEnd);
        const tail = registryContent.slice(sectionEnd);
        if (!head.includes(headerRow)) {
            return head + '\n' + headerRow + '\n' + sepRow + '\n' + newRow + '\n' + tail.replace(/^\n+/, '');
        }
        const trimmedHead = head.replace(/\n+$/, '');
        return trimmedHead + '\n' + newRow + '\n' + tail.replace(/^\n+/, '');
    }

    static trimAuditTable(registryContent, maxRows) {
        const idx = ToDoDailyRecurring._findAuditSectionStart(registryContent);
        if (idx === -1) return registryContent;
        const sectionEnd = ToDoDailyRecurring._findAuditSectionEnd(registryContent, idx);
        const sectionText = registryContent.slice(idx, sectionEnd);
        const lines = sectionText.split('\n');
        const dataLines = lines.filter(l => /^\|/.test(l) && !/^\| Date \|/.test(l) && !/^\| --- \|/.test(l));
        if (dataLines.length <= maxRows) return registryContent;
        const drop = dataLines.length - maxRows;
        const seen = new Set();
        const kept = [];
        let dropped = 0;
        for (const l of lines) {
            if (/^\|/.test(l) && !/^\| Date \|/.test(l) && !/^\| --- \|/.test(l)) {
                if (dropped < drop && !seen.has(l)) { dropped++; seen.add(l); continue; }
            }
            kept.push(l);
        }
        return registryContent.slice(0, idx) + kept.join('\n') + registryContent.slice(sectionEnd);
    }

    static _findAuditSectionStart(registryContent) {
        // Match `## Last 7 days of materialization` (legacy H2) OR
        // a SectionLabel dataviewjs block carrying that text.
        const h2 = registryContent.indexOf('## Last 7 days of materialization');
        if (h2 !== -1) return h2;
        const slRe = /```dataviewjs[^`]*SectionLabel[^`]*Last 7 days of materialization[^`]*```/;
        const m = slRe.exec(registryContent);
        return m ? m.index : -1;
    }

    static _findAuditSectionEnd(registryContent, sectionStart) {
        // Section ends at the next `## ` heading or the EOF — whichever comes first.
        const rest = registryContent.slice(sectionStart + 1);
        const next = rest.search(/\n## /);
        if (next === -1) return registryContent.length;
        return sectionStart + 1 + next;
    }

    static _extractRegistryCreatedAt(registryContent) {
        const m = /^created_at:\s*"?([^"\n]+)"?/m.exec(registryContent);
        return m ? m[1] : null;
    }
}
