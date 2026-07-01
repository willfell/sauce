/**
 * TodayCaptureEditableList (CustomJS) — the SOLE Today-capture UI on a daily
 * to-do note. Renders the free-form Today `- [ ]` lines as a click-to-edit
 * list: each row carries a functional checkbox (clicking toggles `[ ]`/`[x]`
 * in the file via TaskInteractions.replaceTaskAt), metadata chips, and a pencil
 * that opens the ToDoCreateTask modal in editExisting mode.
 *
 * v0.132.x: previously the widget only ENHANCED the raw lines — Obsidian also
 * rendered the source `- [ ]` lines as native checkboxes, so the user saw the
 * task TWICE (raw + editable). Now `_hideRawCaptureLines` suppresses the native
 * rendering (reading mode) so this list is the only thing shown, and the
 * checkbox is functional (was read-only, which relied on the now-hidden native
 * checkbox for toggling). Live-preview still shows source while editing.
 *
 * Sister surface to ToDoLeafActions; consumed exclusively by
 * `type: to-do` daily notes between SectionLabel("Today", top:true) and
 * ToDoDailyCarryover.
 *
 * Anchor scope: TaskInteractions.findTaskLines(content, 'todayCapture')
 * (mechanism task-interactions@0.1.0) — bounded by the
 * <!-- TODAY_CAPTURE_MARKER --> sentinel that ships in the template and
 * is back-injected into existing notes by install.js step 6.
 */
class TodayCaptureEditableList {

    static SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'obsidian:', 'file:'];

    /**
     * Return `line` with its checkbox marker set to `[x]` (checked) or `[ ]`
     * (unchecked). Pure; preserves the bullet marker (-,*,+) and everything
     * after the checkbox. Returns the line unchanged if it is not a task line.
     */
    static _setChecked(line, checked) {
        if (typeof line !== 'string') return line;
        return line.replace(/^([-*+] \[)[ xX](\])/, (_m, p1, p2) => p1 + (checked ? 'x' : ' ') + p2);
    }

    /**
     * Best-effort: hide the native-rendered raw `- [ ]` capture lines so this
     * widget is the only Today list shown. Reading-mode only — feature-detected
     * and wrapped so it no-ops in live-preview, embeds, and test stubs, and
     * never throws out of render. The capture region is the only NATIVE task
     * list on a daily note (carryover/recurring/etc. are dataviewjs-rendered),
     * and it sits ABOVE this block, so we hide native `ul.contains-task-list`
     * elements that precede our container and are not inside a dataviewjs block.
     */
    _hideRawCaptureLines(container) {
        try {
            if (!container || typeof container.closest !== 'function') return;
            const preview = container.closest('.markdown-preview-view');
            if (!preview || typeof preview.querySelectorAll !== 'function') return;
            const ourBlock = container.closest('.block-language-dataviewjs');
            const lists = preview.querySelectorAll('ul.contains-task-list');
            for (const ul of lists) {
                if (ul.closest && ul.closest('.block-language-dataviewjs')) continue;
                // DOCUMENT_POSITION_PRECEDING (2): only hide lists BEFORE our block.
                if (ourBlock && typeof ourBlock.compareDocumentPosition === 'function'
                    && !(ourBlock.compareDocumentPosition(ul) & 2)) continue;
                ul.style.display = 'none';
            }
        } catch (_e) { /* best-effort; never break render */ }
    }

    // ---------- inline markdown rendering ----------
    // Third consumer of the v0.7.0 tokenizer (sibling copies in
    // ToDoDailyProjectGroups + ToDoDailyUnassignedMeetings). Renders
    // `[label](url)` external links + `[[target]]`/`[[target|alias]]` wikilinks
    // as real <a> elements so task titles aren't shown as raw markdown.
    // FOLLOW-UP: per the sibling note, this trio should be extracted to a shared
    // util (e.g. a TaskInteractions static) — deferred to keep this patch low-risk.

    _tokenizeInline(text) {
        const tokens = [];
        const s = String(text || '');
        let i = 0;
        while (i < s.length) {
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
            const trimmed = String(url == null ? '' : url).trim();
            if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
            const lower = trimmed.toLowerCase();
            return TodayCaptureEditableList.SAFE_URL_SCHEMES.some(s => lower.startsWith(s));
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

    async render(dv, opts) {
        if (!dv || !dv.container) return;
        // Skip rendering inside embeds — the host note already renders its own list.
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        // Which task-interactions section anchor to scope to. Defaults to the
        // daily-note Today capture; project-todo notes pass { anchor: "ownedTasks" }
        // to render their "Owned Tasks" section with the same editable UI.
        const anchor = (opts && opts.anchor) || 'todayCapture';

        // Clear container defensively.
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const ti = window.customJS && window.customJS.TaskInteractions;
        if (!ti || typeof ti.findTaskLines !== 'function') {
            const note = dv.container.createEl('div', { text: 'task-interactions mechanism not loaded' });
            note.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 4px 0;';
            return;
        }

        // Resolve current file path. dv.current() returns the dataview page for
        // the active note; .file.path is the canonical vault-relative path.
        const cur = dv.current && dv.current();
        if (!cur || !cur.file || !cur.file.path) return;
        const filePath = cur.file.path;

        const vault = window.app && window.app.vault;
        if (!vault) return;
        const file = vault.getAbstractFileByPath(filePath);
        if (!file) return;

        let content;
        try {
            content = await vault.read(file);
        } catch (_e) {
            return;
        }

        const entries = ti.findTaskLines(content, anchor);
        if (!entries || entries.length === 0) {
            const empty = dv.container.createEl('div', { text: 'No tasks yet. Add a checkbox above.' });
            empty.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 6px 0;';
            return;
        }

        const list = dv.container.createEl('div');
        list.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0;';

        for (const entry of entries) {
            const row = list.createEl('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent;';
            row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-secondary)'; });
            row.addEventListener('mouseleave', () => { row.style.background = ''; });

            // Functional checkbox: this list is now the SOLE Today UI (the raw
            // native lines are hidden), so clicking toggles [ ]/[x] in the file
            // via TaskInteractions.replaceTaskAt. On failure, revert + notice.
            const cb = row.createEl('input');
            cb.type = 'checkbox';
            cb.checked = /^[-*+] \[[xX]\] /.test(entry.line);
            cb.style.cssText = 'margin: 0; cursor: pointer;';
            cb.addEventListener('change', async () => {
                const want = cb.checked;
                const newLine = TodayCaptureEditableList._setChecked(entry.line, want);
                const res = await ti.replaceTaskAt(filePath, entry.idx, newLine);
                if (!res || !res.ok) {
                    cb.checked = !want;
                    new Notice('Could not update task: ' + ((res && res.reason) || 'unknown'), 6000);
                }
                // On success, vault.modify re-renders this block with fresh state.
            });

            // Title — render inline markdown so `[label](url)` external links and
            // `[[wikilink]]` internal links become real <a> elements (not raw
            // text). min-width:0 + overflow-wrap let long content wrap instead of
            // forcing a horizontal scroll on the flex row.
            const title = row.createEl('span');
            const parsed = entry.parsed || {};
            const titleText = parsed.title || entry.line.replace(/^[-*+] \[[ xX]\] /, '');
            this._renderInlineMarkdown(title, titleText);
            title.style.cssText = 'flex: 1; min-width: 0; overflow-wrap: anywhere; ' + (cb.checked
                ? 'text-decoration: line-through; color: var(--text-muted);'
                : 'color: var(--text-normal);');

            // Metadata chips (only render when set).
            const chips = row.createEl('div');
            chips.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap; align-items: center;';
            const addChip = (label) => {
                const chip = chips.createEl('span', { text: label });
                chip.style.cssText = 'font-size: 0.78em; padding: 1px 6px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);';
            };
            if (parsed.project) addChip(parsed.project);
            if (parsed.priority) addChip(parsed.priority);
            if (parsed.due) addChip('due: ' + parsed.due);
            if (parsed.scheduled) addChip('scheduled: ' + parsed.scheduled);

            // Pencil edit button — opens the modal in editExisting mode.
            const editBtn = row.createEl('span');
            editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
            editBtn.style.cssText = 'cursor: pointer; color: var(--text-muted); padding: 2px;';
            editBtn.addEventListener('mouseenter', () => { editBtn.style.color = 'var(--text-normal)'; });
            editBtn.addEventListener('mouseleave', () => { editBtn.style.color = 'var(--text-muted)'; });
            editBtn.addEventListener('click', () => {
                const tcd = window.customJS && window.customJS.ToDoCreateTask;
                if (!tcd || typeof tcd.open !== 'function') {
                    new Notice('ToDoCreateTask not loaded; cannot open editor', 6000);
                    return;
                }
                tcd.open({
                    editExisting: {
                        filePath,
                        lineIdx: entry.idx,
                        parsed: entry.parsed,
                    },
                });
            });
        }

        // Suppress the native-rendered raw capture checkboxes so this list is
        // the only Today UI. Retries catch raw lines that render after us.
        this._hideRawCaptureLines(dv.container);
        if (typeof setTimeout === 'function') {
            setTimeout(() => this._hideRawCaptureLines(dv.container), 60);
            setTimeout(() => this._hideRawCaptureLines(dv.container), 250);
        }
    }
}
