class TaskDoneArchive {

    groupByDate(parsedTasks) { return TaskDoneArchive.groupByDate(parsedTasks); }
    filterTasks(parsedTasks, opts) { return TaskDoneArchive.filterTasks(parsedTasks, opts); }
    rangeFor(preset, todayStr) { return TaskDoneArchive.rangeFor(preset, todayStr); }
    rangeLabel(preset, range) { return TaskDoneArchive.rangeLabel(preset, range); }
    summarize(parsedTasks, from, to) { return TaskDoneArchive.summarize(parsedTasks, from, to); }
    standupMarkdown(groups) { return TaskDoneArchive.standupMarkdown(groups); }
    searchableBody(raw) { return TaskDoneArchive.searchableBody(raw); }

    /**
     * Entry point invoked by customjs-guard: render(dv). The Done log: range
     * presets, per-day and per-project summaries, title + notes search,
     * Project / Source filters, a date-grouped list with Reopen, and Copy as
     * standup. Dependency chain: TaskEntity (parseNote) + TaskTodayList
     * (renderDoneRow). Returns quietly if any dependency is absent (cold-load
     * safe). Dual-fire-safe via __taskDoneArchiveGen.
     */
    async render(dv) {
        if (!dv || !dv.container) return;
        if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

        const container = dv.container;
        const myGen = (container.__taskDoneArchiveGen || 0) + 1;
        container.__taskDoneArchiveGen = myGen;
        const isStale = () => container.__taskDoneArchiveGen !== myGen;

        while (container.firstChild) container.removeChild(container.firstChild);

        const CJS = (typeof window !== 'undefined' && window.customJS) || null;
        const page = CJS && CJS.RenderSafe
            ? CJS.RenderSafe.page(dv)
            : (dv.current && dv.current());
        if (!page) return;

        const TE  = CJS && CJS.TaskEntity;
        const TTL = CJS && CJS.TaskTodayList;
        if (!TE || typeof TE.parseNote !== 'function' ||
            !TTL || typeof TTL.renderDoneRow !== 'function') return;

        const Self = TaskDoneArchive;
        const todayStr = Self._today();
        if (!todayStr) return;

        let allTasks = [];
        try {
            const raw = dv.pages('"spice/tasks/_done"').where(p =>
                p && p.type === 'task' && p.file && !p.file.path.includes('/_trash/'));
            const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
            allTasks = arr.map(p => TE.parseNote(p));
        } catch (_e) {}

        if (isStale()) return;

        const storage = Self._storage();
        const state = {
            preset: Self._readPreset(storage),
            range: null,
            text: '',
            project: '',
            source: '',
            loading: 0,
            bodies: {},
            failed: new Set(),
            visible: [],
        };
        state.range = Self.rangeFor(state.preset, todayStr);

        const notify = (msg) => {
            try { if (typeof Notice === 'function') new Notice(msg); } catch (_e) {}
        };
        const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
        const onClick = (el, handler) => {
            el.addEventListener('click', (ev) => {
                try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) {}
                return handler(ev);
            });
        };
        const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

        const root = container.createEl('div', { cls: 'sauce-done-log' });
        root.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
        const pillsHost = root.createEl('div', { cls: 'sauce-done-pills' });
        pillsHost.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px;';
        const customHost = root.createEl('div', { cls: 'sauce-done-custom' });
        const headerHost = root.createEl('div', { cls: 'sauce-done-header' });
        headerHost.style.cssText = 'font-weight: 600;';
        const panelsHost = root.createEl('div', { cls: 'sauce-done-panels' });
        panelsHost.style.cssText = 'display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;';
        const searchHost = root.createEl('div', { cls: 'sauce-done-controls' });
        searchHost.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';
        const statusHost = root.createEl('div', { cls: 'sauce-done-status' });
        const listHost = root.createEl('div', { cls: 'sauce-done-list' });

        const buttonCss = 'font-size: 0.85em; cursor: pointer; background: none; box-shadow: none; height: auto; text-transform: none; letter-spacing: 0;';

        const rangeTasks = () => allTasks.filter(t => {
            const day = Self._dayOf(t);
            return !!day && day >= state.range.from && day <= state.range.to;
        });

        const paintPills = () => {
            clear(pillsHost);
            const make = (key, label) => {
                const pressed = state.preset === key;
                const b = pillsHost.createEl('button', { cls: 'sauce-done-pill', text: label });
                b.setAttribute('type', 'button');
                b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
                b.style.cssText = buttonCss + 'padding: 2px 10px; border-radius: 999px; border: 1px solid '
                    + (pressed ? 'var(--interactive-accent)' : 'var(--background-modifier-border)')
                    + '; color: ' + (pressed ? 'var(--text-accent)' : 'var(--text-normal)') + ';';
                return b;
            };
            for (const preset of Self.PRESETS) {
                onClick(make(preset.key, preset.label), () => selectPreset(preset.key));
            }
            onClick(make('custom', 'Pick range…'), () => {
                if (state.preset === 'custom') return;
                state.preset = 'custom';
                refresh();
            });
        };

        const paintCustom = () => {
            clear(customHost);
            if (state.preset !== 'custom') return;
            customHost.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.85em;';
            const field = (cls, label, value) => {
                const wrap = customHost.createEl('label');
                wrap.style.cssText = 'display: inline-flex; gap: 4px; align-items: center; color: var(--text-muted);';
                wrap.createEl('span', { text: label });
                const input = wrap.createEl('input', { cls: cls, type: 'date' });
                input.value = value;
                input.setAttribute('aria-label', label + ' date');
                return input;
            };
            const from = field('sauce-done-range-from', 'From', state.range.from);
            const to = field('sauce-done-range-to', 'To', state.range.to);
            const apply = () => {
                const f = String(from.value || '');
                const t = String(to.value || '');
                if (Self._parts(f) && Self._parts(t) && f <= t) {
                    if (f === state.range.from && t === state.range.to) return;
                    state.range = { from: f, to: t };
                    refresh();
                    return;
                }
                from.value = state.range.from;
                to.value = state.range.to;
            };
            from.addEventListener('change', apply);
            to.addEventListener('change', apply);
        };

        const paintHeader = () => {
            const sum = Self.summarize(allTasks, state.range.from, state.range.to);
            clear(headerHost);
            const named = sum.projects.filter(p => p.name !== Self.NO_PROJECT).length;
            headerHost.textContent = sum.total + ' done ' + Self.rangeLabel(state.preset, state.range)
                + ', across ' + plural(named, 'project');
            return sum;
        };

        const paintPanels = (sum) => {
            clear(panelsHost);
            if (!sum.total) return;
            const max = sum.bars.reduce((m, b) => Math.max(m, b.n), 0);
            const barsWrap = panelsHost.createEl('div', { cls: 'sauce-done-bars' });
            barsWrap.style.cssText = 'display: flex; align-items: flex-end; gap: 3px; flex: 1 1 220px; min-width: 0;';
            const labelEvery = sum.bars.length > 14 ? 7 : 1;
            sum.bars.forEach((bar, i) => {
                const col = barsWrap.createEl('div', { cls: 'sauce-done-bar-col' });
                col.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: flex-end; flex: 1 1 0; min-width: 0; gap: 2px;';
                const px = bar.n > 0 && max > 0 ? Math.max(4, Math.round(bar.n / max * 48)) : 4;
                const el = col.createEl('div', { cls: 'sauce-done-bar' });
                el.style.cssText = 'width: 100%; max-width: 28px; border-radius: 2px; height: ' + px + 'px; background: '
                    + (bar.n > 0 ? 'var(--interactive-accent)' : 'var(--background-modifier-border)') + ';';
                el.setAttribute('role', 'img');
                el.setAttribute('aria-label', bar.n + ' done');
                el.setAttribute('title', bar.label + ': ' + bar.n + ' done');
                const lab = col.createEl('div', { cls: 'sauce-done-bar-label', text: i % labelEvery === 0 ? bar.label : '' });
                lab.style.cssText = 'font-size: 0.65em; color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;';
            });
            const projWrap = panelsHost.createEl('div', { cls: 'sauce-done-projects' });
            projWrap.style.cssText = 'display: flex; flex-direction: column; gap: 2px; flex: 1 1 180px; min-width: 0; font-size: 0.85em;';
            for (const proj of sum.projects) {
                const row = projWrap.createEl('div', { cls: 'sauce-done-project-row' });
                row.style.cssText = 'display: flex; justify-content: space-between; gap: 8px;';
                const name = row.createEl('span', { text: proj.name });
                name.style.cssText = 'overflow-wrap: anywhere;' + (proj.name === Self.NO_PROJECT ? ' color: var(--text-muted);' : '');
                const n = row.createEl('span', { text: String(proj.n) });
                n.style.cssText = 'color: var(--text-muted); font-variant-numeric: tabular-nums;';
            }
        };

        const reopen = async (task, btn) => {
            if (btn.disabled) return;
            btn.disabled = true;
            let res = null;
            const dialog = CJS.TaskDialog;
            try { res = dialog && typeof dialog.reopen === 'function' ? await dialog.reopen(task.path) : null; }
            catch (_e) { res = null; }
            if (isStale()) return;
            const outcome = typeof TTL.classifyOutcome === 'function' ? TTL.classifyOutcome(res) : (res && res.ok ? 'ok' : 'silent');
            if (outcome === 'ok') {
                allTasks = allTasks.filter(t => t !== task && !(t.path && t.path === task.path));
                refresh();
                return;
            }
            btn.disabled = false;
            if (outcome === 'silent') notify('Could not reopen task: ' + ((res && res.reason) || 'unknown'));
        };

        const paintStatus = () => {
            clear(statusHost);
            const q = state.text.trim();
            if (state.loading > 0 && q.length >= 3) {
                const l = statusHost.createEl('div', { cls: 'sauce-done-loading', text: 'Searching notes…' });
                l.style.cssText = 'font-size: 0.8em; color: var(--text-muted); font-style: italic;';
            }
            if (q || state.project || state.source) {
                const total = rangeTasks().length;
                const s = statusHost.createEl('div', { cls: 'sauce-done-showing', text: 'Showing ' + state.visible.length + ' of ' + total });
                s.style.cssText = 'font-size: 0.8em; color: var(--text-muted);';
            }
        };

        const paintList = () => {
            clear(listHost);
            state.visible = Self.filterTasks(rangeTasks(), {
                text: state.text, project: state.project, source: state.source, bodies: state.bodies,
            });
            paintStatus();
            if (!state.visible.length) {
                const filtered = !!(state.text.trim() || state.project || state.source);
                const p = listHost.createEl('p', {
                    cls: 'sauce-done-empty',
                    text: filtered ? 'No completed tasks match.' : 'No completed tasks in this range.',
                });
                p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 8px 0;';
                return;
            }
            const year = todayStr.slice(0, 4);
            for (const [dateStr, tasks] of Self.groupByDate(state.visible)) {
                const heading = listHost.createEl('div', {
                    cls: 'sauce-done-day',
                    text: Self._dayLabel(dateStr) + (dateStr.slice(0, 4) !== year ? ', ' + dateStr.slice(0, 4) : '') + ' · ' + tasks.length,
                });
                heading.setAttribute('role', 'heading');
                heading.setAttribute('aria-level', '3');
                heading.style.cssText = 'font-size: 0.8em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 6px 2px;';
                for (const task of tasks) {
                    try {
                        TTL.renderDoneRow(listHost, task, {
                            TD: CJS.TaskDialog, notice: notify, onUndo: reopen, undoLabel: 'Reopen', showProject: true,
                        });
                    } catch (_e) {}
                }
            }
        };

        const ensureBodies = async () => {
            const q = state.text.trim();
            if (q.length < 3) return;
            const appRef = (typeof window !== 'undefined' && window.app) || (typeof app !== 'undefined' && app) || null;
            const vault = appRef && appRef.vault;
            if (!vault || typeof vault.cachedRead !== 'function' || typeof vault.getAbstractFileByPath !== 'function') return;
            const pending = [];
            for (const task of rangeTasks()) {
                if (!task.path || Object.prototype.hasOwnProperty.call(state.bodies, task.path)) continue;
                let file = null;
                try { file = vault.getAbstractFileByPath(task.path); } catch (_e) { file = null; }
                if (!file) continue;
                const mtime = (file.stat && file.stat.mtime) || task.mtime || 0;
                const key = task.path + ':' + mtime;
                if (state.failed.has(key)) continue;
                pending.push({ path: task.path, file, key });
            }
            if (!pending.length) return;
            state.loading++;
            paintStatus();
            await Promise.all(pending.map(async (item) => {
                const text = await Self._loadBody(vault, item.file, item.key);
                if (text == null) state.failed.add(item.key);
                else state.bodies[item.path] = text;
            }));
            state.loading--;
            if (isStale()) return;
            paintList();
        };

        const options = (names, allLabel) => [allLabel].concat(names);
        const openMenu = (anchor, labels, current, allLabel, apply) => {
            const MP = CJS.MenuPopover;
            const values = labels;
            if (MP && typeof MP.open === 'function') {
                try {
                    MP.open(options(values, allLabel).map((label, i) => ({
                        label,
                        ...((i === 0 ? !current : label === current) ? { icon: '✓' } : {}),
                        onSelect: () => apply(i === 0 ? '' : label),
                    })), { anchor });
                } catch (_e) { notify('Could not open menu'); }
                return;
            }
            const all = [''].concat(values);
            apply(all[(all.indexOf(current) + 1) % all.length]);
        };

        const projectNames = () => {
            const seen = new Set();
            for (const t of rangeTasks()) seen.add(Self._projectOf(t));
            const named = Array.from(seen).filter(n => n !== Self.NO_PROJECT).sort((a, b) => a.localeCompare(b));
            return seen.has(Self.NO_PROJECT) ? named.concat([Self.NO_PROJECT]) : named;
        };

        const search = searchHost.createEl('input', { cls: 'sauce-done-search', type: 'search' });
        search.setAttribute('placeholder', 'Search title and notes…');
        search.setAttribute('aria-label', 'Search completed tasks');
        search.style.cssText = 'flex: 1 1 180px; min-width: 0;';
        search.addEventListener('input', () => {
            state.text = String(search.value || '');
            paintList();
            ensureBodies();
        });
        const projectBtn = searchHost.createEl('button', { cls: 'sauce-done-project-filter' });
        const sourceBtn = searchHost.createEl('button', { cls: 'sauce-done-source-filter' });
        const copyBtn = searchHost.createEl('button', { cls: 'sauce-done-copy', text: 'Copy as standup' });
        for (const b of [projectBtn, sourceBtn, copyBtn]) {
            b.setAttribute('type', 'button');
            b.style.cssText = buttonCss + 'padding: 2px 8px; border-radius: var(--radius-s, 4px); border: 1px solid var(--background-modifier-border); color: var(--text-normal);';
        }
        projectBtn.setAttribute('aria-haspopup', 'menu');
        sourceBtn.setAttribute('aria-haspopup', 'menu');
        const paintFilterButtons = () => {
            projectBtn.textContent = state.project ? 'Project: ' + state.project + ' ▾' : 'Project ▾';
            sourceBtn.textContent = state.source ? 'Source: ' + state.source + ' ▾' : 'Source ▾';
        };
        onClick(projectBtn, () => openMenu(projectBtn, projectNames(), state.project, 'All projects', (value) => {
            state.project = value;
            paintFilterButtons();
            paintList();
        }));
        onClick(sourceBtn, () => openMenu(sourceBtn, Self.SOURCES.slice(), state.source, 'All sources', (value) => {
            state.source = value;
            paintFilterButtons();
            paintList();
        }));
        onClick(copyBtn, async () => {
            const visible = state.visible;
            if (!visible.length) { notify('Nothing to copy'); return; }
            try {
                const nav = (typeof navigator !== 'undefined' && navigator) || (typeof window !== 'undefined' && window.navigator) || null;
                if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
                await nav.clipboard.writeText(Self.standupMarkdown(Self.groupByDate(visible)));
                notify('Copied ' + plural(visible.length, 'task'));
            } catch (_e) {
                notify('Could not copy');
            }
        });

        const refresh = () => {
            if (state.project && projectNames().indexOf(state.project) < 0) state.project = '';
            paintPills();
            paintCustom();
            const sum = paintHeader();
            paintPanels(sum);
            paintFilterButtons();
            paintList();
            ensureBodies();
        };
        const selectPreset = (key) => {
            const range = Self.rangeFor(key, todayStr);
            if (!range) return;
            state.preset = key;
            state.range = range;
            Self._writePreset(storage, key);
            refresh();
        };

        refresh();
    }

    static get PRESETS() {
        return [
            { key: 'today', label: 'Today' },
            { key: 'yesterday', label: 'Yesterday' },
            { key: 'this-week', label: 'This week' },
            { key: 'last-week', label: 'Last week' },
            { key: 'this-month', label: 'This month' },
        ];
    }
    static get DEFAULT_PRESET() { return 'last-week'; }
    static get RANGE_KEY() { return 'sauce-done-log:range'; }
    static get SOURCES() { return ['daily', 'meeting', 'project', 'trip', 'manual']; }
    static get NO_PROJECT() { return 'No project'; }
    static get WEEKDAYS() { return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; }
    static get MONTHS() {
        return ['January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December'];
    }

    static _today() {
        try {
            const m = (typeof window !== 'undefined' && window.moment) || null;
            if (m) return String(m().format('YYYY-MM-DD'));
        } catch (_e) { /* fall through to the Date clock */ }
        const d = new Date();
        const pad = (n) => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    static _storage() {
        try { return typeof window !== 'undefined' ? (window.localStorage || null) : null; }
        catch (_e) { return null; }
    }

    static _readPreset(storage) {
        try {
            const v = storage && typeof storage.getItem === 'function' ? storage.getItem(TaskDoneArchive.RANGE_KEY) : null;
            if (TaskDoneArchive.PRESETS.some(p => p.key === v)) return v;
        } catch (_e) { /* storage may be blocked */ }
        return TaskDoneArchive.DEFAULT_PRESET;
    }

    static _writePreset(storage, key) {
        try { if (storage && typeof storage.setItem === 'function') storage.setItem(TaskDoneArchive.RANGE_KEY, key); }
        catch (_e) { /* local preference persistence is best-effort */ }
    }

    static get _bodyCache() {
        if (!TaskDoneArchive.__bodies) TaskDoneArchive.__bodies = new Map();
        return TaskDoneArchive.__bodies;
    }
    static get _bodyInflight() {
        if (!TaskDoneArchive.__inflight) TaskDoneArchive.__inflight = new Map();
        return TaskDoneArchive.__inflight;
    }

    /**
     * Searchable text of one done note, cached per `path:mtime` for the
     * session. Resolves null when the read fails (the file then matches by
     * title only). Concurrent callers share one read.
     */
    static _loadBody(vault, file, key) {
        const cache = TaskDoneArchive._bodyCache;
        if (cache.has(key)) return Promise.resolve(cache.get(key));
        const inflight = TaskDoneArchive._bodyInflight;
        if (inflight.has(key)) return inflight.get(key);
        const job = (async () => {
            try {
                const text = TaskDoneArchive.searchableBody(await vault.cachedRead(file));
                if (cache.size > 2000) cache.clear();
                cache.set(key, text);
                return text;
            } catch (_e) {
                return null;
            } finally {
                inflight.delete(key);
            }
        })();
        inflight.set(key, job);
        return job;
    }

    static _parts(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
        if (!m) return null;
        const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
        const t = Date.UTC(y, mo - 1, d);
        const dt = new Date(t);
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
        return { y, mo, d, t };
    }

    static _fmt(t) {
        const dt = new Date(t);
        const pad = (n) => (n < 10 ? '0' : '') + n;
        return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
    }

    static _addDays(s, n) {
        const p = TaskDoneArchive._parts(s);
        return p ? TaskDoneArchive._fmt(p.t + n * 86400000) : null;
    }

    static _dow(s) {
        const p = TaskDoneArchive._parts(s);
        return p ? (new Date(p.t).getUTCDay() + 6) % 7 : 0;
    }

    static _mon(s) { return TaskDoneArchive.MONTHS[TaskDoneArchive._parts(s).mo - 1].slice(0, 3); }

    static _dayLabel(s) {
        const p = TaskDoneArchive._parts(s);
        if (!p) return String(s == null ? '' : s);
        return TaskDoneArchive.WEEKDAYS[TaskDoneArchive._dow(s)] + ' ' + TaskDoneArchive._mon(s) + ' ' + p.d;
    }

    static _dayOf(task) {
        try {
            const TE = (typeof window !== 'undefined' && window.customJS && window.customJS.TaskEntity) || null;
            if (TE && typeof TE.completedDay === 'function') return TE.completedDay(task);
        } catch (_e) { /* fall through to the local reader */ }
        const v = task && task.completed_at;
        if (v == null || v === '') return null;
        if (typeof v === 'string') {
            const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(v);
            return m ? m[1] : null;
        }
        try {
            if (typeof v.toISODate === 'function') return v.toISODate() || null;
            if (typeof v.toFormat === 'function') return v.toFormat('yyyy-MM-dd') || null;
        } catch (_e) { return null; }
        return null;
    }

    static _stamp(task) {
        const v = task && task.completed_at;
        try {
            if (typeof v === 'string') { const n = Date.parse(v); return isNaN(n) ? 0 : n; }
            if (v && typeof v.toMillis === 'function') { const n = v.toMillis(); return isFinite(n) ? n : 0; }
        } catch (_e) { return 0; }
        return 0;
    }

    static _projectOf(task) {
        const v = task && task.project;
        if (v == null || v === '') return TaskDoneArchive.NO_PROJECT;
        let name = '';
        try {
            const TTL = (typeof window !== 'undefined' && window.customJS && window.customJS.TaskTodayList) || null;
            if (TTL && typeof TTL._projectChipText === 'function') name = String(TTL._projectChipText(v) || '').trim();
        } catch (_e) { name = ''; }
        if (!name) {
            if (typeof v === 'object') {
                name = String((v.path != null && String(v.path).trim() !== '' ? v.path : v.display) || '').trim();
            } else {
                name = String(v).trim();
            }
            const wiki = /^\[\[([^\]]*)\]\]$/.exec(name);
            if (wiki) name = wiki[1].trim();
            const pipe = name.indexOf('|');
            if (pipe >= 0) name = name.slice(0, pipe).trim();
            const slash = name.lastIndexOf('/');
            if (slash >= 0) name = name.slice(slash + 1);
            name = name.replace(/\.md$/i, '');
        }
        return name || TaskDoneArchive.NO_PROJECT;
    }

    static _sourceOf(task) {
        const s = String((task && task.source) == null ? '' : task.source).trim().toLowerCase();
        return s || 'manual';
    }

    static groupByDate(parsedTasks) {
        if (!Array.isArray(parsedTasks)) return new Map();
        const items = [];
        parsedTasks.forEach((t, i) => {
            const day = t ? TaskDoneArchive._dayOf(t) : null;
            if (day) items.push({ t, day, stamp: TaskDoneArchive._stamp(t), i });
        });
        items.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)
            || (b.stamp - a.stamp) || (a.i - b.i));
        const map = new Map();
        for (const item of items) {
            if (!map.has(item.day)) map.set(item.day, []);
            map.get(item.day).push(item.t);
        }
        return map;
    }

    /**
     * Search + Project + Source filter. Text always matches the title; a task's
     * notes body (`bodies[path]`) is consulted only once the trimmed query has
     * three or more characters. A blank query is no text filter.
     */
    static filterTasks(parsedTasks, opts) {
        if (!Array.isArray(parsedTasks)) return [];
        const o = opts || {};
        const text = String(o.text == null ? '' : o.text).trim().toLowerCase();
        const useBody = text.length >= 3;
        const bodies = o.bodies || {};
        const project = o.project ? String(o.project) : '';
        const source = o.source ? String(o.source).toLowerCase() : '';
        return parsedTasks.filter(t => {
            if (!t) return false;
            if (project && TaskDoneArchive._projectOf(t) !== project) return false;
            if (source && TaskDoneArchive._sourceOf(t) !== source) return false;
            if (!text) return true;
            if (String(t.title || '').toLowerCase().includes(text)) return true;
            if (!useBody) return false;
            const body = t.path != null ? bodies[t.path] : null;
            return typeof body === 'string' && body.toLowerCase().includes(text);
        });
    }

    /** Frontmatter and fenced code blocks removed: only prose is searchable. */
    static searchableBody(raw) {
        if (raw == null) return '';
        let s = String(raw);
        s = s.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
        s = s.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '');
        return s.trim();
    }

    /**
     * Inclusive `{from, to}` (YYYY-MM-DD) for a preset relative to `todayStr`;
     * weeks run Monday to Sunday. Unknown preset or bad date -> null.
     */
    static rangeFor(preset, todayStr) {
        const p = TaskDoneArchive._parts(todayStr);
        if (!p) return null;
        const add = TaskDoneArchive._addDays;
        const monday = add(todayStr, -TaskDoneArchive._dow(todayStr));
        switch (preset) {
            case 'today': return { from: todayStr, to: todayStr };
            case 'yesterday': { const d = add(todayStr, -1); return { from: d, to: d }; }
            case 'this-week': return { from: monday, to: add(monday, 6) };
            case 'last-week': return { from: add(monday, -7), to: add(monday, -1) };
            case 'this-month': {
                const pad = (n) => (n < 10 ? '0' : '') + n;
                const last = new Date(Date.UTC(p.y, p.mo, 0)).getUTCDate();
                return { from: p.y + '-' + pad(p.mo) + '-01', to: p.y + '-' + pad(p.mo) + '-' + pad(last) };
            }
            default: return null;
        }
    }

    /** Header wording for a range: `today`, `this week`, `Nov 2 – 8`, `in November`. */
    static rangeLabel(preset, range) {
        if (preset === 'today') return 'today';
        if (preset === 'yesterday') return 'yesterday';
        if (preset === 'this-week') return 'this week';
        const from = range && range.from;
        const to = range && range.to;
        const pf = TaskDoneArchive._parts(from);
        const pt = TaskDoneArchive._parts(to);
        if (!pf || !pt) return '';
        if (preset === 'this-month') return 'in ' + TaskDoneArchive.MONTHS[pf.mo - 1];
        const head = TaskDoneArchive._mon(from) + ' ' + pf.d;
        if (from === to) return head;
        if (pf.y === pt.y && pf.mo === pt.mo) return head + ' – ' + pt.d;
        return head + ' – ' + TaskDoneArchive._mon(to) + ' ' + pt.d;
    }

    /**
     * Totals for the tasks completed inside [from, to]: `total`, `projects`
     * (count desc, then name; `No project` last) and `bars` (`{label, n}`):
     * one per day up to 31 days ("Mon 2"), one per Monday-week beyond that
     * ("Nov 2").
     */
    static summarize(parsedTasks, from, to) {
        const empty = { total: 0, projects: [], bars: [] };
        const pf = TaskDoneArchive._parts(from);
        const pt = TaskDoneArchive._parts(to);
        if (!Array.isArray(parsedTasks) || !pf || !pt || from > to) return empty;
        const perDay = new Map();
        const perProject = new Map();
        let total = 0;
        for (const t of parsedTasks) {
            const day = t ? TaskDoneArchive._dayOf(t) : null;
            if (!day || day < from || day > to) continue;
            total++;
            perDay.set(day, (perDay.get(day) || 0) + 1);
            const name = TaskDoneArchive._projectOf(t);
            perProject.set(name, (perProject.get(name) || 0) + 1);
        }
        const NP = TaskDoneArchive.NO_PROJECT;
        const projects = Array.from(perProject, ([name, n]) => ({ name, n })).sort((a, b) =>
            (a.name === NP ? 1 : 0) - (b.name === NP ? 1 : 0)
            || (b.n - a.n)
            || a.name.localeCompare(b.name));
        const spanDays = Math.round((pt.t - pf.t) / 86400000) + 1;
        const bars = [];
        if (spanDays <= 31) {
            for (let day = from; day <= to; day = TaskDoneArchive._addDays(day, 1)) {
                bars.push({
                    label: TaskDoneArchive.WEEKDAYS[TaskDoneArchive._dow(day)] + ' ' + TaskDoneArchive._parts(day).d,
                    n: perDay.get(day) || 0,
                });
            }
        } else {
            for (let mon = TaskDoneArchive._addDays(from, -TaskDoneArchive._dow(from)); mon <= to; mon = TaskDoneArchive._addDays(mon, 7)) {
                let n = 0;
                for (let k = 0; k < 7; k++) n += perDay.get(TaskDoneArchive._addDays(mon, k)) || 0;
                bars.push({ label: TaskDoneArchive._mon(mon) + ' ' + TaskDoneArchive._parts(mon).d, n });
            }
        }
        return { total, projects, bars };
    }

    /**
     * Markdown for a standup: `**Fri Nov 6**` then `- Title (Project)` lines,
     * a blank line between days, in the groups' own order. No project, no
     * parentheses.
     */
    static standupMarkdown(groups) {
        const entries = groups instanceof Map ? Array.from(groups) : (Array.isArray(groups) ? groups : []);
        const blocks = [];
        for (const entry of entries) {
            const dateStr = entry && entry[0];
            const tasks = entry && entry[1];
            if (!Array.isArray(tasks) || !tasks.length) continue;
            const lines = ['**' + TaskDoneArchive._dayLabel(dateStr) + '**'];
            for (const t of tasks) {
                const project = TaskDoneArchive._projectOf(t);
                lines.push('- ' + ((t && t.title) || '(untitled)') + (project === TaskDoneArchive.NO_PROJECT ? '' : ' (' + project + ')'));
            }
            blocks.push(lines.join('\n'));
        }
        return blocks.join('\n\n');
    }
}
