class TaskFolders {

    // Applies the task folder migration from its dry-run report, inside
    // Obsidian. The installer (install.js applyTaskFoldersHeal) only plans and
    // writes ranch/reports/task-folders-YYYY-MM-DD.md; that note's Apply block
    // calls render(dv) here, which reads the plan back from the note's own
    // ```json block. Moves go through app.fileManager.renameFile so Obsidian
    // rewrites the links and its index (and Sync) sees every move.
    // Spec: Docs/superpowers/specs/2026-11-10-task-folders-design.md.

    render(dv) { return TaskFolders.render(dv); }
    apply(app, plan, opts) { return TaskFolders.apply(app, plan, opts); }
    parsePlan(text) { return TaskFolders.parsePlan(text); }
    isApplied(text) { return TaskFolders.isApplied(text); }
    isPhone(app) { return TaskFolders.isPhone(app); }
    rewriteLinks(text, entries) { return TaskFolders.rewriteLinks(text, entries); }
    parentNameOf(path) { return TaskFolders.parentNameOf(path); }

    static _root() { return 'spice/tasks'; }

    static _settled(a) { return !!a && (a.settledBy === 'parent_task' || a.settledBy === 'same-folder'); }

    static _dirOf(p) {
        const s = String(p == null ? '' : p);
        const i = s.lastIndexOf('/');
        return i < 0 ? '' : s.slice(0, i);
    }

    static _baseOf(p) {
        const s = String(p == null ? '' : p);
        return s.slice(s.lastIndexOf('/') + 1);
    }

    static _isFile(f) { return !!f && !Array.isArray(f.children) && typeof f.path === 'string'; }

    static _isFolder(f) { return !!f && Array.isArray(f.children); }

    static _msg(e) { return String((e && e.message) || e || 'unknown error').split('\n')[0]; }

    static _runs() {
        if (!TaskFolders.__runs) TaskFolders.__runs = new Map();
        return TaskFolders.__runs;
    }

    // The plan from the report text: the first ```json fence. Null when there
    // is none or it does not parse to a plan.
    static parsePlan(text) {
        try {
            const m = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```/m.exec(String(text || ''));
            if (!m) return null;
            const p = JSON.parse(m[1]);
            if (!p || typeof p !== 'object' || !Array.isArray(p.moves)) return null;
            return p;
        } catch (_e) { return null; }
    }

    // The hidden anchor apply() writes above its visible Applied heading. A
    // report is applied iff it holds this line; the heading is display only.
    static _appliedMark() { return '<!-- task-folders:applied -->'; }

    static isApplied(text) {
        return String(text || '').split(/\r?\n/).some((line) => line.trim() === TaskFolders._appliedMark());
    }

    // Mirror of TaskEntity's task-folder rule: a folder under spice/tasks other
    // than _done, _done/YYYY(/MM), _trash and _sets (task sets) and its folders.
    static _isTaskFolder(dir) {
        const root = TaskFolders._root();
        if (dir.indexOf(root + '/') !== 0) return false;
        if (dir === root + '/_done' || dir === root + '/_trash') return false;
        if (dir === root + '/_sets' || dir.indexOf(root + '/_sets/') === 0) return false;
        if (/^spice\/tasks\/_done\/\d{4}(\/\d{2})?$/.test(dir)) return false;
        return true;
    }

    // The parent's name for a folder note at `path`: the folder note one level
    // up. Empty when the note is top-level (or not a folder note).
    static parentNameOf(path) {
        const own = TaskFolders._dirOf(path);
        const base = TaskFolders._baseOf(path).replace(/\.md$/i, '');
        if (!own || TaskFolders._baseOf(own) !== base) return '';
        const up = TaskFolders._dirOf(own);
        if (!TaskFolders._isTaskFolder(up)) return '';
        return TaskFolders._baseOf(up);
    }

    // Blank fenced code blocks and inline code spans, keeping offsets, so a
    // wikilink inside them is never rewritten (Obsidian does not treat it as a
    // link). Same rule as install.js _tfBlankCode.
    static _blankCode(text) {
        const blank = (s) => s.replace(/[^\n]/g, ' ');
        return text
            .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[ \t]*$|(?![\s\S]))/gm, blank)
            .replace(/`[^`\n]*`/g, blank);
    }

    // `[[Old#Sub|alias]]` → `[[<resolvesTo without .md>#Sub|alias]]`; without an
    // alias the original target text becomes the alias. An embed keeps its `!`;
    // a link in a table row keeps an escaped `\|`.
    static fullPathLink(orig, resolvesTo, inTable) {
        const embed = orig.charAt(0) === '!';
        const inner = orig.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
        const sep = /\\?\|/.exec(inner);
        const targetPart = sep ? inner.slice(0, sep.index) : inner;
        const alias = sep ? inner.slice(sep.index + sep[0].length) : null;
        const hash = targetPart.indexOf('#');
        const sub = hash < 0 ? '' : targetPart.slice(hash).trim();
        const dest = String(resolvesTo).replace(/\.md$/i, '') + sub;
        const shown = alias != null ? alias : targetPart.trim();
        const bar = (sep && sep[0] === '\\|') || inTable ? '\\|' : '|';
        return (embed ? '!' : '') + '[[' + dest + bar + shown + ']]';
    }

    // Rewrites, in one note's text, every occurrence of a settled ambiguous
    // link (settledBy parent_task or same-folder) to its full path. An
    // occurrence on the frontmatter parent_task line takes the note's
    // parent_task entry; any other occurrence takes the entry that is not one.
    // Best-guess (same-place-oldest) occurrences are left as they are.
    static rewriteLinks(text, entries) {
        const src = String(text == null ? '' : text);
        const list = (Array.isArray(entries) ? entries : []).filter((a) => a && typeof a.link === 'string' && typeof a.resolvesTo === 'string');
        if (!list.some(TaskFolders._settled)) return { text: src, count: 0 };
        const scan = TaskFolders._blankCode(src);
        const fm = /^---\r?\n[\s\S]*?\r?\n---/.exec(scan);
        const fmLen = fm ? fm[0].length : 0;
        const re = /!?\[\[([^\]\n]+?)\]\]/g;
        const edits = [];
        let m;
        while ((m = re.exec(scan)) !== null) {
            const orig = src.slice(m.index, m.index + m[0].length);
            const same = list.filter((a) => a.link === orig);
            if (!same.length) continue;
            const lineStart = scan.lastIndexOf('\n', m.index) + 1;
            const nl = scan.indexOf('\n', m.index);
            const line = scan.slice(lineStart, nl < 0 ? scan.length : nl);
            const onParentLine = m.index < fmLen && /^parent_task\s*:/.test(line);
            const entry = onParentLine
                ? (same.find((a) => a.settledBy === 'parent_task') || same.find((a) => a.settledBy !== 'parent_task'))
                : same.find((a) => a.settledBy !== 'parent_task');
            if (!entry || !TaskFolders._settled(entry)) continue;
            const inTable = m.index >= fmLen && line.trim().charAt(0) === '|';
            edits.push({ at: m.index, len: m[0].length, to: TaskFolders.fullPathLink(orig, entry.resolvesTo, inTable) });
        }
        let out = src;
        for (let i = edits.length - 1; i >= 0; i--) {
            const e = edits[i];
            out = out.slice(0, e.at) + e.to + out.slice(e.at + e.len);
        }
        return { text: out, count: edits.length };
    }

    static _fmValue(text, key) {
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
        if (!fm) return null;
        const re = new RegExp('^' + key + ':[ \\t]*(.*)$', 'm');
        const m = re.exec(fm[1]);
        if (!m) return null;
        let v = m[1].trim();
        if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
        return v;
    }

    static _yield() { return new Promise((r) => setTimeout(r, 0)); }

    // apply(app, plan, opts) → { moved, skipped, failed: [{ from, why }], skips, warnings,
    // linksRewritten, parentsSet, foldersRemoved, alreadyApplied?, refused? }.
    // Refused ('mobile') on a phone: hundreds of renames on iOS, then synced
    // to the other devices, is the risk the desktop-only rule avoids.
    //   opts.reportPath  the report note: refused when it already holds the
    //                    applied anchor. The result is appended to it: with
    //                    the anchor and an Applied section when at least one
    //                    move landed, otherwise as an "Apply attempt" section
    //                    without the anchor, so Apply stays available.
    //   opts.onProgress  (done, total) after each move.
    //   opts.now         ISO stamp for the Applied heading (default: now).
    //   opts.cacheTimeoutMs  longest wait for the link index after the link
    //                    rewrites (default 5000).
    // Never throws.
    static async apply(app, plan, opts) {
        const o = opts || {};
        const res = { moved: 0, skipped: 0, failed: [], skips: [], warnings: [], linksRewritten: 0, parentsSet: 0, foldersRemoved: 0 };
        let waiter = null;
        try {
            if (!app || !app.vault || !app.fileManager || typeof app.fileManager.renameFile !== 'function') {
                res.failed.push({ from: '', why: 'Obsidian app is not available' });
                return res;
            }
            if (TaskFolders.isPhone(app)) {
                res.refused = 'mobile';
                res.failed.push({ from: '', why: TaskFolders._desktopOnlyText() });
                return res;
            }
            const vault = app.vault;
            const get = (p) => { try { return vault.getAbstractFileByPath(p); } catch (_e) { return null; } };
            const p = plan || {};
            const moves = (Array.isArray(p.moves) ? p.moves : [])
                .filter((m) => m && typeof m.from === 'string' && typeof m.to === 'string' && m.from && m.to);
            const total = moves.length;
            const progress = (n) => { if (typeof o.onProgress === 'function') { try { o.onProgress(n, total); } catch (_e) { /* UI only */ } } };

            const report = o.reportPath ? get(o.reportPath) : null;
            if (TaskFolders._isFile(report)) {
                const text = await vault.read(report);
                if (TaskFolders.isApplied(text)) { res.alreadyApplied = true; return res; }
            }
            if (typeof vault.getConfig === 'function' && vault.getConfig('alwaysUpdateLinks') === false) {
                res.failed.push({ from: '', why: 'Settings → Files and links → "Automatically update internal links" is off, so moving the notes would leave links pointing at their old paths. Turn it on, then press Apply again.' });
                return res;
            }

            // 1. Settled ambiguous links → full path, before anything moves.
            // renameFile rewrites backlinks from metadataCache, so the index
            // must hold the rewritten links before the first move: listen for
            // each rewritten note's "changed" event (registered before the
            // first write so none is missed), bounded by a timeout.
            waiter = TaskFolders._cacheWaiter(app);
            const byNote = new Map();
            for (const a of (Array.isArray(p.ambiguousLinks) ? p.ambiguousLinks : [])) {
                if (!a || typeof a.in !== 'string') continue;
                if (!byNote.has(a.in)) byNote.set(a.in, []);
                byNote.get(a.in).push(a);
            }
            for (const [notePath, entries] of byNote) {
                if (!entries.some(TaskFolders._settled)) continue;
                const f = get(notePath);
                if (!TaskFolders._isFile(f)) continue;
                try {
                    let count = 0;
                    const probe = TaskFolders.rewriteLinks(await vault.read(f), entries);
                    if (!probe.count) continue;
                    waiter.expect(f.path);
                    await vault.process(f, (text) => {
                        const r = TaskFolders.rewriteLinks(text, entries);
                        count = r.count;
                        return r.text;
                    });
                    res.linksRewritten += count;
                } catch (e) {
                    res.failed.push({ from: notePath, why: 'its ambiguous links could not be rewritten: ' + TaskFolders._msg(e) });
                }
            }
            const timeoutMs = typeof o.cacheTimeoutMs === 'number' && o.cacheTimeoutMs >= 0 ? o.cacheTimeoutMs : 5000;
            const lagging = await waiter.wait(timeoutMs);
            if (lagging.length) {
                res.warnings.push(`Obsidian's link index had not picked up ${lagging.length} rewritten note(s) after ${timeoutMs / 1000}s ` +
                    `(${lagging.join(', ')}); the moves went ahead. Check those notes' links.`);
            }

            // 2. Classify every move before anything moves. A move whose
            // source is gone and target exists was already done, and its
            // subtree goes ahead. A move whose source is gone (target missing
            // too) or whose target is taken by another note is skipped, and
            // so is everything planned under its folder: those notes would
            // otherwise land in a folder with no folder note, or under the
            // wrong one.
            const root = TaskFolders._root();
            const blocked = [];
            const blockedUnder = (m) => blocked.find((b) => m.to.indexOf(b.dir + '/') === 0) || null;
            const state = new Map();
            for (const m of moves) {
                const src = TaskFolders._isFile(get(m.from));
                const dst = !!get(m.to);
                let st;
                if (blockedUnder(m)) st = 'blocked';
                else if (!src && dst) st = 'done';
                else if (!src) st = 'vanished';
                else if (dst) st = 'occupied';
                else st = 'viable';
                state.set(m, st);
                if (st === 'vanished' || st === 'occupied') {
                    blocked.push({ dir: TaskFolders._dirOf(m.to), from: m.from, why: st === 'vanished' ? 'no longer exists' : 'its target is taken' });
                }
            }

            // Target folders, outermost first, only for moves that can run.
            const created = [];
            const want = new Set();
            for (const m of moves) {
                if (state.get(m) !== 'viable') continue;
                for (let d = TaskFolders._dirOf(m.to); d && d.indexOf(root + '/') === 0; d = TaskFolders._dirOf(d)) want.add(d);
            }
            const depth = (d) => d.split('/').length;
            for (const d of Array.from(want).sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0))) {
                if (get(d)) continue;
                try { await vault.createFolder(d); created.push(d); }
                catch (e) { if (!get(d)) res.failed.push({ from: d, why: 'folder could not be created: ' + TaskFolders._msg(e) }); }
            }

            // 3. Moves, in plan order (parents before children), one at a
            // time: each renameFile is awaited before the next starts.
            const done = [];
            const skip = (m, why) => { res.skipped++; res.skips.push({ from: m.from, why }); };
            for (let i = 0; i < moves.length; i++) {
                const m = moves[i];
                const under = blockedUnder(m);
                const f = get(m.from);
                if (under && under.from !== m.from) {
                    skip(m, `not moved: the task above it, ${under.from}, did not move (${under.why})`);
                } else if (!TaskFolders._isFile(f)) {
                    skip(m, get(m.to) ? 'already at its target' : 'no longer exists');
                } else if (get(m.to)) {
                    skip(m, `${m.to} already exists`);
                } else {
                    try {
                        await app.fileManager.renameFile(f, m.to);
                        res.moved++;
                        done.push(m);
                    } catch (e) {
                        const why = TaskFolders._msg(e);
                        res.failed.push({ from: m.from, why });
                        blocked.push({ dir: TaskFolders._dirOf(m.to), from: m.from, why: 'its move failed' });
                    }
                }
                progress(i + 1);
                if ((i + 1) % 25 === 0) await TaskFolders._yield();
            }

            // 4. parent_task follows the folder: "[[<parent folder note>]]".
            for (const m of done) {
                const parentName = TaskFolders.parentNameOf(m.to);
                if (!parentName) continue;
                const f = get(m.to);
                if (!TaskFolders._isFile(f)) continue;
                const link = '[[' + parentName + ']]';
                try {
                    if (TaskFolders._fmValue(await vault.read(f), 'parent_task') === link) continue;
                    await app.fileManager.processFrontMatter(f, (fm) => { fm.parent_task = link; });
                    res.parentsSet++;
                } catch (e) {
                    res.failed.push({ from: m.from, why: 'moved, but parent_task could not be set: ' + TaskFolders._msg(e) });
                }
            }

            // 5. Source folders (and unused new ones) left empty, deepest first,
            // only under spice/tasks and never the task roots themselves.
            const keep = new Set([root, root + '/_done', root + '/_trash', root + '/_sets']);
            const sweep = new Set();
            const addUp = (d) => {
                for (let x = d; x && x.indexOf(root + '/') === 0 && !keep.has(x); x = TaskFolders._dirOf(x)) sweep.add(x);
            };
            for (const m of done) addUp(TaskFolders._dirOf(m.from));
            for (const d of created) addUp(d);
            for (const d of Array.from(sweep).sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0))) {
                const f = get(d);
                if (!TaskFolders._isFolder(f) || f.children.length) continue;
                try { await vault.delete(f); res.foldersRemoved++; } catch (_e) { /* left in place */ }
            }

            // 6. The result, appended to the report: the applied anchor only
            // when something moved.
            if (TaskFolders._isFile(report)) {
                const section = TaskFolders._appliedSection(res, o.now || new Date().toISOString(), res.moved > 0);
                try {
                    await vault.process(report, (text) => String(text || '').replace(/\s*$/, '\n') + '\n' + section);
                } catch (e) {
                    res.failed.push({ from: o.reportPath, why: 'the result could not be written to the report: ' + TaskFolders._msg(e) });
                }
            }
        } catch (e) {
            res.failed.push({ from: '', why: TaskFolders._msg(e) });
        } finally {
            if (waiter) waiter.stop();
        }
        return res;
    }

    // Collects metadataCache "changed" events from the moment it is made.
    // expect(path) names a note that was rewritten; wait(ms) resolves once
    // every expected note has changed in the index, or after ms, with the
    // paths still missing. Without a metadataCache there is nothing to wait for.
    static _cacheWaiter(app) {
        const mc = app && app.metadataCache;
        const seen = new Set();
        const expected = new Set();
        let ref = null;
        let handler = null;
        let wake = null;
        if (mc && typeof mc.on === 'function') {
            handler = (file) => {
                if (file && typeof file.path === 'string') seen.add(file.path);
                if (wake) wake();
            };
            try { ref = mc.on('changed', handler); } catch (_e) { handler = null; }
        }
        const stop = () => {
            try {
                if (ref && typeof mc.offref === 'function') mc.offref(ref);
                else if (handler && typeof mc.off === 'function') mc.off('changed', handler);
            } catch (_e) { /* already gone */ }
            ref = null;
            handler = null;
            wake = null;
        };
        const missing = () => Array.from(expected).filter((p) => !seen.has(p));
        return {
            expect(path) { expected.add(path); },
            stop,
            async wait(ms) {
                if (!handler || !missing().length) { stop(); return []; }
                await new Promise((resolve) => {
                    const timer = setTimeout(() => { wake = null; resolve(); }, ms);
                    wake = () => { if (!missing().length) { clearTimeout(timer); wake = null; resolve(); } };
                });
                const left = missing();
                stop();
                return left;
            },
        };
    }

    static _appliedSection(res, iso, applied) {
        const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';
        const head = applied
            ? [TaskFolders._appliedMark(), `## Applied ${iso}`] // lint-display-markers:allow writes the visible heading; isApplied keys on the anchor line above it
            : [`## Apply attempt ${iso}`]; // lint-display-markers:allow writes the visible heading; no anchor, so Apply stays available
        const out = head.concat(['', '| | Count |', '| --- | ---: |']).concat([
            `| Moved | ${res.moved} |`,
            `| Skipped | ${res.skipped} |`,
            `| Failed | ${res.failed.length} |`,
            `| Links rewritten | ${res.linksRewritten} |`,
            `| Parent links set | ${res.parentsSet} |`,
            `| Folders removed | ${res.foldersRemoved} |`, '']);
        if (res.skips.length) {
            out.push('### Skipped', '');
            for (const s of res.skips) out.push(`- ${code(s.from)}: ${s.why}`);
            out.push('');
        }
        if (res.warnings && res.warnings.length) {
            out.push('### Notes', '');
            for (const w of res.warnings) out.push(`- ${w}`);
            out.push('');
        }
        if (res.failed.length) {
            out.push('### Failed', '');
            for (const f of res.failed) out.push(`- ${f.from ? code(f.from) : '(run)'}: ${f.why}`);
            out.push('');
        }
        return out.join('\n');
    }

    // Obsidian's App sets isMobile on phones and tablets.
    static isPhone(app) { return !!(app && app.isMobile); }

    static _desktopOnlyText() {
        return 'Run this on your desktop: Apply moves every task note, and a phone is not the place for that many renames.';
    }

    static _plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

    static _summaryText(plan) {
        const len = (k) => (Array.isArray(plan[k]) ? plan[k].length : 0);
        return [
            TaskFolders._plural(len('moves'), 'move', 'moves'),
            TaskFolders._plural(len('renames'), 'rename', 'renames'),
            TaskFolders._plural(len('parentPicks'), 'parent pick', 'parent picks'),
            `${len('promoted')} promoted`,
            `${len('unresolved')} unresolved`,
        ].join(' · ');
    }

    static _resultText(res) {
        return `${res.moved} moved · ${res.skipped} skipped · ${res.failed.length} failed`;
    }

    static _drawResult(el, res) {
        try {
            if (typeof el.empty === 'function') el.empty();
            if (res.alreadyApplied) { el.createEl('p', { text: 'Already applied.' }); return; }
            el.createEl('p', { text: TaskFolders._resultText(res) });
            for (const w of (res.warnings || [])) el.createEl('p', { text: w });
            if (res.failed.length) {
                const ul = el.createEl('ul');
                for (const f of res.failed) ul.createEl('li', { text: `${f.from || '(run)'}: ${f.why}` });
            }
            const heading = res.moved > 0 ? 'Applied' : 'Apply attempt';
            el.createEl('p', { text: `The details are under "${heading}" at the end of this note.`, cls: 'sauce-muted' });
        } catch (_e) { /* UI only */ }
    }

    static async _start(app, plan, reportPath, btn, out) {
        const runs = TaskFolders._runs();
        const prior = runs.get(reportPath);
        if (prior && (prior.running || prior.result)) return;
        const run = { running: true, done: 0, total: (plan.moves || []).length, buttons: [btn], outs: [out], result: null };
        runs.set(reportPath, run);
        const paint = () => {
            for (const b of run.buttons) { try { b.disabled = true; b.textContent = `Applying… ${run.done}/${run.total}`; } catch (_e) { /* gone */ } }
        };
        paint();
        let res;
        try {
            res = await TaskFolders.apply(app, plan, {
                reportPath,
                onProgress: (n, total) => { run.done = n; run.total = total; paint(); },
            });
        } catch (e) {
            res = { moved: 0, skipped: 0, failed: [{ from: '', why: TaskFolders._msg(e) }], skips: [] };
        }
        run.running = false;
        if (res.moved === 0 && !res.alreadyApplied) {
            runs.delete(reportPath);
            for (const b of run.buttons) { try { b.disabled = false; b.textContent = 'Apply'; } catch (_e) { /* gone */ } }
        } else {
            run.result = res;
            for (const b of run.buttons) { try { b.disabled = true; b.textContent = 'Applied'; } catch (_e) { /* gone */ } }
        }
        for (const o of run.outs) TaskFolders._drawResult(o, res);
    }

    // render(dv) — the Apply block on the report note. Never throws.
    static async render(dv) {
        try {
            if (!dv || !dv.container || typeof dv.container.createEl !== 'function') return;
            const box = dv.container.createEl('div', { cls: 'sauce-task-folders' });
            const app = dv.app || (typeof window !== 'undefined' && window.app) || (typeof globalThis !== 'undefined' && globalThis.app) || null;
            let filePath = dv.currentFilePath;
            if (!filePath && typeof dv.current === 'function') {
                try { const c = dv.current(); filePath = c && c.file && c.file.path; } catch (_e) { filePath = ''; }
            }
            const file = app && app.vault && filePath ? app.vault.getAbstractFileByPath(filePath) : null;
            if (!TaskFolders._isFile(file)) { box.createEl('p', { text: 'Task folders: this report note could not be read.' }); return; }
            const text = await app.vault.read(file);
            const plan = TaskFolders.parsePlan(text);
            if (!plan) { box.createEl('p', { text: 'Task folders: no plan data in this note (the json block under "Plan data").' }); return; }

            box.createEl('p', { text: TaskFolders._summaryText(plan) });
            const run = TaskFolders._runs().get(filePath);
            if (run && run.result) {
                box.createEl('p', { text: 'Already applied.' });
                TaskFolders._drawResult(box.createEl('div'), run.result);
                return;
            }
            if (!run && TaskFolders.isApplied(text)) { box.createEl('p', { text: 'Already applied.' }); return; }
            if (!plan.moves.length) { box.createEl('p', { text: 'Nothing to move.' }); return; }
            if (TaskFolders.isPhone(app)) { box.createEl('p', { text: TaskFolders._desktopOnlyText() }); return; }

            const btn = box.createEl('button', { text: 'Apply', cls: 'sauce-btn' });
            const out = box.createEl('div');
            if (run && run.running) {
                run.buttons.push(btn);
                run.outs.push(out);
                btn.disabled = true;
                btn.textContent = `Applying… ${run.done}/${run.total}`;
            }
            btn.addEventListener('click', () => TaskFolders._start(app, plan, filePath, btn, out).catch(() => {}));
        } catch (e) {
            try { dv.container.createEl('p', { text: 'Task folders: ' + TaskFolders._msg(e) }); } catch (_e) { /* nothing to draw on */ }
        }
    }
}
