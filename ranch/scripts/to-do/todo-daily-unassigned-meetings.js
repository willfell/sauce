/**
 * ToDoDailyUnassignedMeetings (CustomJS) — live-render aggregator for the
 * "Meeting Tasks (unassigned)" section in today's daily note. Surfaces open
 * `- [ ]` lines from meeting notes that have NO `project:` frontmatter (or
 * an empty one).
 *
 * v0.5.0 (workshop v0.117.0) — uses SectionLabel primitive + polished task rows.
 *
 * Empty section → renders nothing.
 */
class ToDoDailyUnassignedMeetings {

    async render(dv) {
        if (dv && dv.container && dv.container.closest && dv.container.closest('.markdown-embed')) return;
        if (!dv || !dv.current) return;
        const cur = dv.current();
        if (!cur || cur.type !== 'to-do') return;

        let meetings;
        try {
            meetings = dv.pages('"spice/meetings/notes"').where(m => {
                if (!m) return false;
                if (m.project == null) return true;
                const v = String(m.project).trim();
                return v.length === 0;
            }).array();
        } catch (e) { return; }

        const tasks = [];
        for (const meet of meetings) {
            if (meet.file && meet.file.tasks) {
                for (const t of meet.file.tasks) {
                    if (!t.completed) tasks.push({ text: t.text, source: meet.file.path });
                }
            }
        }
        if (!tasks.length) return;

        if (window.customJS && window.customJS.SectionLabel) {
            window.customJS.SectionLabel.render(dv, { text: 'Meeting Tasks (unassigned)' });
        } else {
            const h = dv.container.createEl('div');
            h.textContent = 'MEETING TASKS (UNASSIGNED)';
            h.style.cssText = 'font-size:0.78em; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin:10px 0 6px; font-weight:600;';
        }

        for (const t of tasks) this._renderTaskRow(dv.container, t);
    }

    _renderTaskRow(container, t) {
        const row = container.createEl('div');
        row.style.cssText = 'display:flex; align-items:baseline; gap:8px; padding:4px 0; cursor:pointer; line-height:1.45;';
        row.onclick = () => {
            if (window.app && window.app.workspace) window.app.workspace.openLinkText(t.source, '', false);
        };

        const box = row.createEl('span');
        box.textContent = '☐';
        box.style.cssText = 'flex-shrink:0; opacity:0.6; font-size:0.95em;';

        const txt = row.createEl('span');
        this._renderInlineMarkdown(txt, this._cleanTaskText(t.text));
        txt.style.cssText = 'flex:1; color:var(--text-normal); overflow-wrap:anywhere;';

        const src = row.createEl('span');
        const fname = t.source.split('/').pop().replace(/\.md$/, '');
        src.textContent = `‹${fname}›`;
        src.style.cssText = 'font-size:0.85em; opacity:0.6; font-style:italic; flex-shrink:0; max-width:50%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
    }

    _cleanTaskText(text) {
        return String(text || '').replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, '').trim();
    }

    // ---------- v0.7.0: inline markdown rendering ----------
    // Tokenize `[label](url)` external links + `[[target]]` / `[[target|alias]]`
    // wikilinks out of task text. Emit raw <a> HTML matching the established
    // pattern from platform/blueprints/daily/helpers/space-daily-dashboard.js.
    // Intentionally duplicated in ToDoDailyProjectGroups (two callsites; per
    // code-conventions.md "three similar lines is better than a premature
    // abstraction"). If a third widget needs this, extract to a shared util.

    static SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'obsidian:', 'file:'];

    _tokenizeInline(text) {
        const tokens = [];
        const s = String(text || '');
        let i = 0;
        while (i < s.length) {
            // [[target]] or [[target|alias]] — non-greedy wikilink
            const wl = /^\[\[([^\]\n]+?)\]\]/.exec(s.slice(i));
            if (wl) {
                const inner = wl[1];
                const pipe = inner.indexOf('|');
                if (pipe === -1) {
                    tokens.push({ kind: 'wikilink', target: inner, alias: inner });
                } else {
                    tokens.push({ kind: 'wikilink', target: inner.slice(0, pipe), alias: inner.slice(pipe + 1) });
                }
                i += wl[0].length;
                continue;
            }
            // [label](url) — scan to the BALANCED closing paren so URLs that
            // contain literal parens (e.g. Teams deep-links "...(Lounge)...")
            // aren't truncated at the first ')'. Mirrors space-daily-dashboard
            // _renderTaskHTML's balanced scan. Angle-bracketed <url> still ok.
            if (s.charAt(i) === '[') {
                const closeBracket = s.indexOf(']', i + 1);
                if (closeBracket > i && s.charAt(closeBracket + 1) === '(') {
                    let depth = 0, closeParen = -1;
                    for (let k = closeBracket + 2; k < s.length; k++) {
                        const c = s.charAt(k);
                        if (c === '\n') break;
                        if (c === '(') depth++;
                        else if (c === ')') { if (depth === 0) { closeParen = k; break; } depth--; }
                    }
                    if (closeParen >= 0) {
                        const label = s.slice(i + 1, closeBracket);
                        let url = s.slice(closeBracket + 2, closeParen);
                        if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
                        tokens.push({ kind: 'link', label, url });
                        i = closeParen + 1;
                        continue;
                    }
                }
            }
            // Plain text — accumulate up to the next `[` (which might start a link/wikilink).
            const nextBracket = s.indexOf('[', i + 1);
            if (nextBracket === -1) {
                tokens.push({ kind: 'text', value: s.slice(i) });
                break;
            }
            tokens.push({ kind: 'text', value: s.slice(i, nextBracket) });
            i = nextBracket;
        }
        return tokens;
    }

    _escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    _isSafeUrl(url) {
        try {
            // v0.119.0 PATCH (C1 from code review): trim before scheme detection.
            // Browsers strip leading whitespace from href attrs at resolution time,
            // so " javascript:alert(1)" executes as javascript: — but the scheme
            // regex `^[a-z]...:` doesn't match leading whitespace, falling through
            // the "relative URL" allow-path. Trim first.
            const trimmed = String(url == null ? '' : url).trim();
            // Allow relative URLs (no scheme) too — they're treated as same-origin.
            if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
            const lower = trimmed.toLowerCase();
            return ToDoDailyUnassignedMeetings.SAFE_URL_SCHEMES.some(s => lower.startsWith(s));
        } catch (_e) { return false; }
    }

    _renderInlineMarkdown(spanEl, text) {
        const tokens = this._tokenizeInline(text);
        const parts = [];
        for (const t of tokens) {
            if (t.kind === 'text') {
                parts.push(this._escapeHtml(t.value));
            } else if (t.kind === 'link') {
                if (this._isSafeUrl(t.url)) {
                    parts.push(`<a href="${this._escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">${this._escapeHtml(t.label)}</a>`);
                } else {
                    parts.push(this._escapeHtml(`[${t.label}](${t.url})`));
                }
            } else if (t.kind === 'wikilink') {
                const target = this._escapeHtml(t.target);
                parts.push(`<a class="internal-link" data-href="${target}" href="${target}">${this._escapeHtml(t.alias || t.target)}</a>`);
            }
        }
        spanEl.innerHTML = parts.join('');
    }
}
