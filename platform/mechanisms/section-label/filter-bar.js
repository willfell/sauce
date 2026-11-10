/**
 * FilterBar (CustomJS) — the To-Do view's filter grammar as one set of
 * primitives, so every list page that searches, picks a range and filters
 * draws the same markup: the search field, the strip of day cells, the pill
 * row (tabs left, menus right), the day pill that leads the tabs while one
 * day is shown, the caption, the hairline rule and day-labelled sections.
 * Presentation lives in sauce-core.css (.sauce-pill-toggle, .sauce-todo-*);
 * the strip cells carry the same inline look the To-Do week strip draws.
 *
 * The date helpers are pure on YYYY-MM-DD strings (weeks start Monday), so a
 * caller reads the clock once and every decision below is testable in Node.
 *
 * BARE CLASS ONLY. CustomJS stores an INSTANCE, so every static has an
 * instance delegate; callers reach them as customJS.FilterBar.x(...).
 */
class FilterBar {
    layout(parent, opts) { return FilterBar.layout(parent, opts); }
    search(host, opts) { return FilterBar.search(host, opts); }
    pill(parent, opts) { return FilterBar.pill(parent, opts); }
    setPill(button, active, cls) { return FilterBar.setPill(button, active, cls); }
    dayPill(group, opts) { return FilterBar.dayPill(group, opts); }
    strip(host, opts) { return FilterBar.strip(host, opts); }
    menu(anchor, opts) { return FilterBar.menu(anchor, opts); }
    section(dv, host, text, opts) { return FilterBar.section(dv, host, text, opts); }
    empty(host, text, cls) { return FilterBar.empty(host, text, cls); }
    onClick(el, fn) { return FilterBar.onClick(el, fn); }
    clear(el) { return FilterBar.clear(el); }
    isTouch(appRef, doc) { return FilterBar.isTouch(appRef, doc); }
    parts(s) { return FilterBar.parts(s); }
    addDays(s, n) { return FilterBar.addDays(s, n); }
    dow(s) { return FilterBar.dow(s); }
    dayLabel(s) { return FilterBar.dayLabel(s); }
    monthLabel(key) { return FilterBar.monthLabel(key); }
    rangeFor(preset, todayStr) { return FilterBar.rangeFor(preset, todayStr); }
    rangeLabel(preset, range) { return FilterBar.rangeLabel(preset, range); }
    dayCells(counts, from, to, todayStr) { return FilterBar.dayCells(counts, from, to, todayStr); }

    static get WEEKDAYS() { return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; }
    static get MONTHS() {
        return ['January', 'February', 'March', 'April', 'May', 'June', 'July',
            'August', 'September', 'October', 'November', 'December'];
    }
    static get SEARCH_ICON() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    }

    /**
     * Phone rule the inline styles cannot express: a strip cell stacks the
     * weekday over the date, like the To-Do week strip. The pill height and
     * the one-line, sideways-scrolling pill row come from sauce-core.css's
     * body.is-phone rules on .sauce-pill-toggle / .sauce-todo-filter-controls,
     * which this markup carries.
     */
    static get PHONE_CSS() {
        return 'body.is-phone .sauce-filter-bar .sauce-filter-day-cell-label > span { display: block; }'
            + ' body.is-phone .sauce-filter-bar .sauce-filter-day-gap { display: none !important; }';
    }

    static clear(el) {
        try { while (el && el.firstChild) el.removeChild(el.firstChild); } catch (_e) { /* never throw */ }
    }

    static onClick(el, fn) {
        if (!el || typeof el.addEventListener !== 'function') return el;
        el.addEventListener('click', (ev) => {
            try { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); } catch (_e) { /* ignore */ }
            try { return fn(ev); } catch (_e) { return undefined; }
        });
        return el;
    }

    static isTouch(appRef, doc) {
        try {
            if (appRef && appRef.isMobile) return true;
            const body = doc && doc.body;
            return !!(body && body.classList && typeof body.classList.contains === 'function' && body.classList.contains('is-mobile'));
        } catch (_e) { return false; }
    }

    /**
     * The page skeleton, top to bottom: search, strip, controls (pills left,
     * menus right), caption, rule, list. Hosts the caller does not ask for
     * are left out. Returns every host by name.
     */
    static layout(parent, opts) {
        const o = opts || {};
        const root = parent.createEl('div', { cls: 'sauce-filter-bar' + (o.rootCls ? ' ' + o.rootCls : '') });
        root.style.cssText = 'display: flex; flex-direction: column; gap: 10px; width: 100%;';
        root.createEl('style').textContent = FilterBar.PHONE_CSS + (o.css ? ' ' + o.css : '');
        const hosts = { root };
        if (o.search) hosts.search = root.createEl('label', { cls: 'sauce-todo-search sauce-filter-search' });
        if (o.strip) hosts.strip = root.createEl('div', { cls: 'sauce-filter-strip-host' });
        if (o.controls !== false) {
            hosts.controls = root.createEl('div', { cls: 'sauce-todo-filter-controls sauce-filter-controls' });
            hosts.pills = hosts.controls.createEl('div', { cls: 'sauce-pill-group sauce-filter-pills' });
            hosts.pills.setAttribute('role', 'tablist');
            if (o.pillsLabel) hosts.pills.setAttribute('aria-label', o.pillsLabel);
            hosts.right = hosts.controls.createEl('div', { cls: 'sauce-todo-filter-right sauce-filter-right' });
        }
        if (o.caption) {
            hosts.caption = root.createEl('div', { cls: 'sauce-todo-caption sauce-filter-caption' });
        }
        if (o.controls !== false || o.caption) {
            root.createEl('div', { cls: 'sauce-todo-filter-rule' }).setAttribute('aria-hidden', 'true');
        }
        hosts.list = root.createEl('div', { cls: 'sauce-filter-list' });
        hosts.list.style.cssText = 'display: flex; flex-direction: column; gap: 2px; width: 100%;';
        return hosts;
    }

    static search(host, opts) {
        const o = opts || {};
        const icon = host.createEl('span', { cls: 'sauce-todo-search-icon' });
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = FilterBar.SEARCH_ICON;
        const input = host.createEl('input', { cls: 'sauce-todo-search-input' + (o.inputCls ? ' ' + o.inputCls : ''), type: 'search' });
        input.setAttribute('placeholder', o.placeholder || 'Search…');
        input.setAttribute('aria-label', o.label || String(o.placeholder || 'Search').replace(/…$/, ''));
        if (o.value) input.value = String(o.value);
        input.addEventListener('input', () => {
            try { if (typeof o.onInput === 'function') o.onInput(String(input.value || '')); } catch (_e) { /* never throw */ }
        });
        return input;
    }

    static setPill(button, active, cls) {
        button.className = (cls ? cls + ' ' : '') + 'sauce-pill-toggle' + (active ? ' is-active' : '');
        return button;
    }

    static pill(parent, opts) {
        const o = opts || {};
        const b = parent.createEl('button', { text: o.text == null ? '' : String(o.text) });
        FilterBar.setPill(b, !!o.active, o.cls);
        b.setAttribute('type', 'button');
        if (o.role === 'tab') {
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', o.active ? 'true' : 'false');
        } else if (o.pressed != null) {
            b.setAttribute('aria-pressed', o.pressed ? 'true' : 'false');
        }
        if (o.menu) b.setAttribute('aria-haspopup', 'menu');
        if (o.title) b.setAttribute('title', o.title);
        if (typeof o.onClick === 'function') FilterBar.onClick(b, () => o.onClick(b));
        return b;
    }

    /** The active "Tue Nov 10 ×" pill, first in the group; click leaves the day. */
    static dayPill(group, opts) {
        const o = opts || {};
        const b = group.createEl('button', { cls: 'sauce-pill-toggle is-active sauce-filter-day-pill' + (o.cls ? ' ' + o.cls : '') });
        b.setAttribute('type', 'button');
        b.setAttribute('title', o.title || 'Show the whole range');
        b.setAttribute('aria-label', 'Showing ' + o.label + '. ' + (o.title || 'Show the whole range'));
        b.createEl('span', { cls: 'sauce-filter-day-pill-label', text: String(o.label || '') });
        const x = b.createEl('span', { cls: 'sauce-filter-day-pill-x', text: '×' });
        x.setAttribute('aria-hidden', 'true');
        x.style.cssText = 'margin-left: 6px; font-size: 1.15em; line-height: 1; opacity: 0.8;';
        if (typeof o.onExit === 'function') FilterBar.onClick(b, () => o.onExit());
        try { if (group.firstChild !== b && typeof group.insertBefore === 'function') group.insertBefore(b, group.firstChild); } catch (_e) { /* order is cosmetic */ }
        return b;
    }

    /**
     * Seven equal columns, Monday first, one button per day with its count.
     * `strip` is the dayCells() result; `selected` is the shown day or null.
     */
    static strip(host, opts) {
        const o = opts || {};
        const strip = o.strip;
        if (!strip || !Array.isArray(strip.cells) || !strip.cells.length) return null;
        const grid = host.createEl('div', { cls: 'sauce-filter-strip' + (o.cls ? ' ' + o.cls : '') });
        grid.setAttribute('role', 'group');
        if (o.ariaLabel) grid.setAttribute('aria-label', o.ariaLabel);
        grid.style.cssText = 'display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; width: 100%; box-sizing: border-box;';
        for (let i = 0; i < (strip.lead || 0); i++) {
            grid.createEl('div', { cls: 'sauce-filter-strip-spacer' }).setAttribute('aria-hidden', 'true');
        }
        const noun = o.noun || '';
        for (const cell of strip.cells) {
            const picked = o.selected === cell.date;
            const button = grid.createEl('button', {
                cls: 'sauce-filter-day-cell' + (cell.isToday ? ' is-today' : '') + (picked ? ' is-selected' : ''),
            });
            button.setAttribute('type', 'button');
            button.setAttribute('aria-label', cell.label + ': ' + cell.count + (noun ? ' ' + noun : ''));
            button.setAttribute('aria-pressed', picked ? 'true' : 'false');
            if (cell.isToday) button.setAttribute('aria-current', 'date');
            button.dataset.date = cell.date;
            const rest = picked ? 'color-mix(in srgb, var(--interactive-accent) 14%, transparent)' : 'transparent';
            const border = picked || cell.isToday ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
            const ink = picked || cell.isToday ? 'var(--text-accent)' : 'var(--text-normal)';
            const glow = picked ? ' box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent) 30%, transparent);' : '';
            button.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; width: 100%; min-width: 0; min-height: 28px; height: auto; padding: 6px 4px; box-sizing: border-box; border-radius: var(--radius-m, 6px); border: 1px solid ' + border + '; color: ' + ink + '; background: ' + rest + ';' + glow + ' cursor: pointer;';
            const name = button.createEl('span', { cls: 'sauce-filter-day-cell-label' });
            name.style.cssText = 'font-size: 0.8em; font-weight: 600; max-width: 100%; white-space: normal; text-align: center; line-height: 1.2;';
            const sp = String(cell.label).indexOf(' ');
            name.createEl('span', { cls: 'sauce-filter-day-name', text: sp > 0 ? cell.label.slice(0, sp) : cell.label });
            if (sp > 0) {
                name.createEl('span', { cls: 'sauce-filter-day-gap', text: ' ' });
                name.createEl('span', { cls: 'sauce-filter-day-num', text: cell.label.slice(sp + 1) });
            }
            const count = button.createEl('span', { cls: 'sauce-filter-day-cell-count', text: String(cell.count) });
            count.style.cssText = 'font-size: 0.75em; color: ' + (picked ? 'var(--text-accent)' : cell.count ? 'var(--text-muted)' : 'var(--text-faint)') + '; font-variant-numeric: tabular-nums;';
            if (typeof o.onPick === 'function') FilterBar.onClick(button, () => o.onPick(picked ? null : cell.date));
        }
        return grid;
    }

    /**
     * A pill menu through MenuPopover: "All …" first, then the entries (each
     * may carry a sublabel), a ✓ on the current one. Without MenuPopover a
     * click cycles to the next value so the filter still works.
     */
    static menu(anchor, opts) {
        const o = opts || {};
        const entries = Array.isArray(o.entries) ? o.entries : [];
        const current = o.current || '';
        const apply = (v) => { try { if (typeof o.onPick === 'function') o.onPick(v); } catch (_e) { /* never throw */ } };
        const CJS = (typeof window !== 'undefined' && window.customJS) || null;
        const MP = o.MenuPopover || (CJS && CJS.MenuPopover);
        if (MP && typeof MP.open === 'function') {
            try {
                const list = [{ label: o.allLabel || 'All', value: '' }].concat(entries);
                MP.open(list.map((entry, i) => ({
                    label: entry.label,
                    ...(entry.sublabel ? { sublabel: entry.sublabel } : {}),
                    ...((i === 0 ? !current : entry.value === current) ? { icon: '✓' } : {}),
                    onSelect: () => apply(entry.value),
                })), { anchor });
                return true;
            } catch (_e) { return false; }
        }
        const all = [''].concat(entries.map((e) => e.value));
        apply(all[(all.indexOf(current) + 1) % all.length]);
        return false;
    }

    /** A SectionLabel heading; the first one under the rule skips its hairline. */
    static section(dv, host, text, opts) {
        const o = opts || {};
        const top = !host.firstChild;
        const holder = host.createEl('div', { cls: 'sauce-filter-section' + (o.cls ? ' ' + o.cls : '') });
        holder.setAttribute('role', 'heading');
        holder.setAttribute('aria-level', '3');
        const CJS = (typeof window !== 'undefined' && window.customJS) || null;
        const SL = o.SectionLabel || (CJS && CJS.SectionLabel);
        if (SL && typeof SL.render === 'function') {
            try { SL.render({ ...(dv || {}), container: holder }, top ? { text, top: true } : { text }); return holder; }
            catch (_e) { /* fall through to plain text */ }
        }
        holder.textContent = text;
        holder.style.cssText = 'font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; padding: 8px 2px 2px;';
        return holder;
    }

    static empty(host, text, cls) {
        const p = host.createEl('p', { cls: 'sauce-filter-empty' + (cls ? ' ' + cls : ''), text: String(text || '') });
        p.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic; padding: 6px 0; margin: 0;';
        return p;
    }

    static parts(s) {
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

    static addDays(s, n) {
        const p = FilterBar.parts(s);
        return p ? FilterBar._fmt(p.t + n * 86400000) : null;
    }

    /** Monday = 0 … Sunday = 6. */
    static dow(s) {
        const p = FilterBar.parts(s);
        return p ? (new Date(p.t).getUTCDay() + 6) % 7 : 0;
    }

    static _mon(s) {
        const p = FilterBar.parts(s);
        return p ? FilterBar.MONTHS[p.mo - 1].slice(0, 3) : '';
    }

    /** "Tue Nov 10". */
    static dayLabel(s) {
        const p = FilterBar.parts(s);
        if (!p) return String(s == null ? '' : s);
        return FilterBar.WEEKDAYS[FilterBar.dow(s)] + ' ' + FilterBar._mon(s) + ' ' + p.d;
    }

    /** "YYYY-MM" → "November 2026"; anything else → "Undated". */
    static monthLabel(key) {
        const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
        const mi = m ? Number(m[2]) : 0;
        if (!m || mi < 1 || mi > 12) return 'Undated';
        return FilterBar.MONTHS[mi - 1] + ' ' + m[1];
    }

    /** Inclusive {from, to} for a preset; null for an unknown preset or date. */
    static rangeFor(preset, todayStr) {
        const p = FilterBar.parts(todayStr);
        if (!p) return null;
        const add = FilterBar.addDays;
        const monday = add(todayStr, -FilterBar.dow(todayStr));
        const pad = (n) => (n < 10 ? '0' : '') + n;
        switch (preset) {
            case 'today': return { from: todayStr, to: todayStr };
            case 'yesterday': { const d = add(todayStr, -1); return { from: d, to: d }; }
            case 'week': case 'this-week': return { from: monday, to: add(monday, 6) };
            case 'last-week': return { from: add(monday, -7), to: add(monday, -1) };
            case 'month': case 'this-month': {
                const last = new Date(Date.UTC(p.y, p.mo, 0)).getUTCDate();
                return { from: p.y + '-' + pad(p.mo) + '-01', to: p.y + '-' + pad(p.mo) + '-' + pad(last) };
            }
            default: return null;
        }
    }

    /** "today", "this week", "last week", "in November", "Nov 2 – 8". */
    static rangeLabel(preset, range) {
        if (preset === 'today') return 'today';
        if (preset === 'yesterday') return 'yesterday';
        if (preset === 'week' || preset === 'this-week') return 'this week';
        if (preset === 'last-week') return 'last week';
        const pf = FilterBar.parts(range && range.from);
        const pt = FilterBar.parts(range && range.to);
        if (!pf || !pt) return '';
        if (preset === 'month' || preset === 'this-month') return 'in ' + FilterBar.MONTHS[pf.mo - 1];
        const head = FilterBar._mon(range.from) + ' ' + pf.d;
        if (range.from === range.to) return head;
        if (pf.y === pt.y && pf.mo === pt.mo) return head + ' – ' + pt.d;
        return head + ' – ' + FilterBar._mon(range.to) + ' ' + pt.d;
    }

    /**
     * Cells for the strip: one per day of [from, to] with `counts[date]`,
     * plus `lead` blank cells so columns run Monday to Sunday. Null for a
     * single day or a span over 42 days.
     */
    static dayCells(counts, from, to, todayStr) {
        const pf = FilterBar.parts(from);
        const pt = FilterBar.parts(to);
        if (!pf || !pt || from >= to) return null;
        if (Math.round((pt.t - pf.t) / 86400000) + 1 > 42) return null;
        const get = (d) => {
            if (!counts) return 0;
            if (counts instanceof Map) return counts.get(d) || 0;
            return counts[d] || 0;
        };
        const cells = [];
        for (let day = from; day && day <= to; day = FilterBar.addDays(day, 1)) {
            cells.push({
                date: day,
                label: FilterBar.WEEKDAYS[FilterBar.dow(day)] + ' ' + FilterBar.parts(day).d,
                count: get(day),
                isToday: day === todayStr,
            });
        }
        return { lead: FilterBar.dow(from), cells };
    }
}
