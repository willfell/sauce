/**
 * MeetingsBrowseList (CustomJS) — the meetings view, drawn in the To-Do view's
 * grammar through customJS.FilterBar: search, a strip of day cells (click one
 * to see that day; a day pill leads the tabs while it does), range tabs with
 * counts (Today / This week / Last week / This month / All), Person ▾ /
 * Project ▾ menus and an Open tasks toggle, a caption, the hairline rule and
 * day-labelled sections of meeting rows (time | title + summary | project,
 * people, open-task chips | ⋯).
 *
 * Surfaces (opts.surface): `browse` (spice/meetings/Meetings.md, default),
 * `project` (a project's Meetings page — ProjectMeetingsList passes
 * opts.scope = { id, match(page) }), `day` (a legacy one-day hub —
 * MeetingsHubCards passes opts.day). The tab persists per surface in
 * localStorage; the shown day, search and filters live in memory per surface
 * and scope, so a Dataview re-render keeps them.
 *
 * All data comes from FRONTMATTER (date, attendees/people, project, summary)
 * and one live task query — never from regex over the note body.
 *
 * COLD-LOAD SAFETY (landmines #1-2): resolve the current page via
 * customJS.RenderSafe.page(dv) (fallback dv.current()) and bail quietly if it
 * isn't ready. Without FilterBar the old month list (_renderFlat) draws.
 * Every path is guarded; render NEVER throws.
 *
 * BARE CLASS ONLY — no trailing statements. To Node-test the statics, load via
 * `new Function(src + "\nreturn MeetingsBrowseList;")()`.
 */
class MeetingsBrowseList {

  // ---------- Static pure helpers ----------

  /**
   * `YYYY-MM` prefix of a date string. Accepts ISO ("2026-07-13T09:00:00Z"),
   * plain ("2026-07-13"), or "YYYY-MM-DD HH:mm". Empty/null/garbage → a stable
   * fallback bucket so grouping never throws or splits into many empties.
   */
  static _monthKey(dateStr) {
    const s = dateStr == null ? '' : String(dateStr).trim();
    const m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    return '0000-00';
  }

  /**
   * Attendee display names from FRONTMATTER — `page.attendees`, else
   * `page.people`. Each entry may be "[[Name]]", "[[Name|Alias]]", a Dataview
   * link object ({display} / {path}), or a plain string. Wikilink wrapper and
   * `|alias` are stripped; the alias (display) wins when present. Pure,
   * never-throws; native Arrays and iterable Dataview DataArrays are accepted;
   * strings / null / plain objects → [].
   */
  static _attendeeNames(page) {
    if (!page || typeof page !== 'object') return [];
    let list = MeetingsBrowseList._iterableValues(page.attendees);
    if (list.length === 0) list = MeetingsBrowseList._iterableValues(page.people);
    const out = [];
    for (const raw of list) {
      const name = MeetingsBrowseList._coerceName(raw);
      if (name) out.push(name);
    }
    return out;
  }

  static _iterableValues(value) {
    if (value == null || typeof value === 'string') return [];
    try {
      if (typeof value[Symbol.iterator] !== 'function') return [];
      return Array.from(value);
    } catch (_e) { return []; }
  }

  /** Coerce one attendee entry to a display name. Never throws. */
  static _coerceName(raw) {
    if (raw == null) return '';
    if (typeof raw === 'object') {
      if (raw.display) return String(raw.display).trim();
      if (raw.path) return String(raw.path).split('/').pop().replace(/\.md$/i, '').trim();
      return '';
    }
    let s = String(raw).trim();
    const m = s.match(/^\[\[([^\]]*)\]\]$/);
    if (m) s = m[1];
    if (s.includes('|')) s = s.split('|').pop();
    return s.trim();
  }

  /**
   * One spice/tasks query → `{ meetingBasename: openCount }`. Key is the task's
   * `source_note` coerced to a basename (strip `[[ ]]` + `.md`). Mirrors
   * TaskMeetingList's live open-task query (open, exclude _trash/ + _done/).
   * Never throws; `{}` on any error.
   */
  static _openTaskCountsBySource(dv) {
    const out = {};
    try {
      const raw = dv.pages('"spice/tasks"').where(p =>
        p && p.type === 'task' && p.status === 'open'
        && String(p.source == null ? '' : p.source).trim().toLowerCase() === 'meeting'
        && p.file && p.file.path
        && !p.file.path.includes('/_trash/')
        && !p.file.path.includes('/_done/'));
      const arr = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
      for (const p of arr) {
        const base = MeetingsBrowseList._sourceBasename(p && p.source_note);
        if (!base) continue;
        out[base] = (out[base] || 0) + 1;
      }
    } catch (_e) {
      return {};
    }
    return out;
  }

  /** Coerce a source_note field to a bare basename. Never throws. */
  static _sourceBasename(field) {
    if (field == null) return '';
    let s;
    if (typeof field === 'object') {
      s = field.path ? String(field.path).split('/').pop() : (field.display || '');
    } else {
      s = String(field);
    }
    s = s.trim();
    const m = s.match(/^\[\[([^\]]*)\]\]$/);
    if (m) s = m[1];
    if (s.includes('|')) s = s.split('|')[0];
    s = s.split('/').pop();
    return s.replace(/\.md$/i, '').trim();
  }

  // ---------- The meetings view (To-Do grammar) ----------

  /**
   * The pages this view draws. `browse` is spice/meetings/Meetings.md; `project`
   * is a project's Meetings page (ProjectMeetingsList passes `scope`); `day`
   * is a legacy one-day hub (MeetingsHubCards passes `day`). Each surface has
   * its own tabs, menus, copy and prefs key.
   */
  static get SURFACES() {
    const tabs = ['today', 'week', 'last-week', 'month', 'all'];
    return {
      browse: {
        key: 'browse', prefsKey: 'sauce-meetings:prefs:browse', tabs, defaults: { tab: 'week' },
        search: true, strip: true, controls: true, caption: true, menus: ['person', 'project', 'open'],
        searchPlaceholder: 'Search meetings…', emptyAll: 'No meetings yet. Use + New Meeting above.',
      },
      project: {
        key: 'project', prefsKey: 'sauce-meetings:prefs:project', tabs, defaults: { tab: 'all' },
        search: true, strip: true, controls: true, caption: true, menus: ['person', 'open'],
        searchPlaceholder: 'Search this project\'s meetings…', emptyAll: 'No meetings yet.',
      },
      day: {
        key: 'day', prefsKey: '', tabs: [], defaults: { tab: 'day' },
        search: false, strip: false, controls: false, caption: false, menus: [],
        emptyAll: '',
      },
    };
  }

  static surface(key) {
    const all = MeetingsBrowseList.SURFACES;
    return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : all.browse;
  }

  static get TAB_LABELS() {
    return { today: 'Today', week: 'This week', 'last-week': 'Last week', month: 'This month', all: 'All' };
  }

  static get NO_PROJECT() { return 'No project'; }

  static _FB() {
    const cjs = (typeof window !== 'undefined' && window.customJS)
      || (typeof globalThis !== 'undefined' && globalThis.customJS) || null;
    const fb = cjs && cjs.FilterBar;
    return fb && typeof fb.layout === 'function' ? fb : null;
  }

  static _today() {
    try {
      const m = (typeof window !== 'undefined' && window.moment) || null;
      if (typeof m === 'function') {
        const s = String(m().format('YYYY-MM-DD'));
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      }
    } catch (_e) { /* fall through to the Date clock */ }
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** YYYY-MM-DD of a meeting: its `date` (string or Dataview DateTime), else the filename's date. */
  static meetingDay(page) {
    const v = page && page.date;
    if (v != null && v !== '') {
      if (typeof v === 'string' || typeof v === 'number') {
        const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(String(v));
        if (m) return m[1];
      } else {
        try {
          if (typeof v.toISODate === 'function') { const s = v.toISODate(); if (s) return s; }
          if (typeof v.toFormat === 'function') { const s = v.toFormat('yyyy-MM-dd'); if (s) return s; }
        } catch (_e) { /* fall through to the filename */ }
      }
    }
    const name = String((page && page.file && page.file.name) || '');
    const f = /(\d{4}-\d{2}-\d{2})/.exec(name);
    return f ? f[1] : null;
  }

  /** "HH:mm" (24h, for sorting) when the meeting's date carries a time, else ''. */
  static meetingClock(page) {
    const v = page && page.date;
    if (v == null || v === '') return '';
    if (typeof v === 'string') {
      const m = /^\s*\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})/.exec(v);
      return m ? (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2] : '';
    }
    try {
      const h = Number(v.hour), mi = Number(v.minute);
      if (Number.isFinite(h) && Number.isFinite(mi) && (h || mi)) {
        return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
      }
    } catch (_e) { /* no time */ }
    return '';
  }

  /** "HH:mm" → "9:30 AM". */
  static timeLabel(clock) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(clock || ''));
    if (!m) return '';
    const h = Number(m[1]);
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  /** The filename without its date: "Standup-2026-11-09" → "Standup". */
  static meetingTitle(page) {
    const name = String((page && page.file && page.file.name) || '').replace(/\.md$/i, '');
    const t = name.replace(/[-\s]\d{4}-\d{2}-\d{2}$/, '').replace(/^\d{4}-\d{2}-\d{2}[-\s]+/, '').trim();
    return t || name || 'Untitled';
  }

  static projectName(page) {
    const v = page && page.project;
    if (v == null || v === '') return '';
    let name = '';
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
    name = name.replace(/\.md$/i, '').trim();
    return name === '(none)' ? '' : name;
  }

  static _summary(page) {
    const s = page && page.summary;
    if (typeof s !== 'string') return '';
    const t = s.trim();
    return t === '""' ? '' : t;
  }

  /** One meeting as the row and the filters see it. */
  static toModel(page, openCounts) {
    const name = (page && page.file && page.file.name) || '';
    const day = MeetingsBrowseList.meetingDay(page);
    const clock = MeetingsBrowseList.meetingClock(page);
    return {
      page,
      path: (page && page.file && page.file.path) || '',
      name,
      title: MeetingsBrowseList.meetingTitle(page),
      day,
      clock,
      time: MeetingsBrowseList.timeLabel(clock),
      attendees: MeetingsBrowseList._attendeeNames(page),
      project: MeetingsBrowseList.projectName(page),
      summary: MeetingsBrowseList._summary(page),
      open: (openCounts && openCounts[name]) || 0,
    };
  }

  /** The meetings a tab shows. `all` keeps undated meetings; ranges do not. */
  static selectTab(models, tab, todayStr) {
    const list = Array.isArray(models) ? models : [];
    if (tab === 'all') return list.slice();
    const FB = MeetingsBrowseList._FB();
    const range = FB ? FB.rangeFor(tab, todayStr) : null;
    if (!range) return [];
    return list.filter((m) => m && m.day && m.day >= range.from && m.day <= range.to);
  }

  /** Every word of `text` in the title, attendees, project or summary. */
  static searchMeetings(models, text) {
    const list = Array.isArray(models) ? models : [];
    const words = String(text == null ? '' : text).toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list.slice();
    return list.filter((m) => {
      if (!m) return false;
      const hay = [m.title, m.attendees.join(' '), m.project, m.summary].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }

  static filterMeetings(models, f) {
    const list = Array.isArray(models) ? models : [];
    const o = f || {};
    return list.filter((m) => {
      if (!m) return false;
      if (o.person && !m.attendees.includes(o.person)) return false;
      if (o.project && (m.project || MeetingsBrowseList.NO_PROJECT) !== o.project) return false;
      if (o.openOnly && !(m.open > 0)) return false;
      return true;
    });
  }

  static _byClock(a, b) {
    if (a.clock && b.clock && a.clock !== b.clock) return a.clock < b.clock ? -1 : 1;
    if (a.clock !== b.clock) return a.clock ? -1 : 1;
    return a.title.localeCompare(b.title);
  }

  /** Days newest first; inside a day, earliest first. Undated last. */
  static groupByDay(models) {
    const map = new Map();
    const sorted = (Array.isArray(models) ? models : []).filter(Boolean).slice().sort((a, b) => {
      if (a.day !== b.day) {
        if (!a.day) return 1;
        if (!b.day) return -1;
        return a.day < b.day ? 1 : -1;
      }
      return MeetingsBrowseList._byClock(a, b);
    });
    for (const m of sorted) {
      const k = m.day || '';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return map;
  }

  /** Months newest first ("YYYY-MM", '' for undated), days within newest first. */
  static groupByMonth(models) {
    const map = new Map();
    for (const [day, list] of MeetingsBrowseList.groupByDay(models)) {
      const k = day ? day.slice(0, 7) : '';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(...list);
    }
    return map;
  }

  /** Menu entries with "N meetings" sublabels, most meetings first. */
  static personEntries(models) {
    const counts = new Map();
    for (const m of models || []) for (const n of new Set(m.attendees)) counts.set(n, (counts.get(n) || 0) + 1);
    return MeetingsBrowseList._entries(counts, null);
  }

  static projectEntries(models) {
    const counts = new Map();
    for (const m of models || []) {
      const n = m.project || MeetingsBrowseList.NO_PROJECT;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    return MeetingsBrowseList._entries(counts, MeetingsBrowseList.NO_PROJECT);
  }

  static _entries(counts, lastName) {
    const names = Array.from(counts.keys()).filter((n) => n !== lastName)
      .sort((a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b));
    if (lastName && counts.has(lastName)) names.push(lastName);
    return names.map((n) => ({ label: n, value: n, sublabel: MeetingsBrowseList._plural(counts.get(n), 'meeting') }));
  }

  static _plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** "4 meetings this week, across 2 projects". */
  static caption(models, tab, todayStr, withProjects) {
    const list = Array.isArray(models) ? models : [];
    const FB = MeetingsBrowseList._FB();
    const range = FB && tab !== 'all' ? FB.rangeFor(tab, todayStr) : null;
    const when = range ? ' ' + FB.rangeLabel(tab, range) : '';
    let text = MeetingsBrowseList._plural(list.length, 'meeting') + when;
    if (withProjects) {
      const n = new Set(list.map((m) => m.project).filter(Boolean)).size;
      if (n > 0) text += ', across ' + MeetingsBrowseList._plural(n, 'project');
    }
    return text;
  }

  static emptyText(S, tab, state) {
    const s = state || {};
    const FB = MeetingsBrowseList._FB();
    if (String(s.text || '').trim() || s.person || s.project || s.openOnly) return 'No meetings match.';
    if (s.day) return 'Nothing on ' + (FB ? FB.dayLabel(s.day) : s.day) + '.';
    if (tab === 'today') return 'No meetings today.';
    if (tab === 'week') return 'No meetings this week.';
    if (tab === 'last-week') return 'No meetings last week.';
    if (tab === 'month') return 'No meetings this month.';
    return S.emptyAll || 'No meetings yet.';
  }

  static _normalizePrefs(value, S) {
    const out = { ...S.defaults };
    if (value && typeof value === 'object' && !Array.isArray(value) && S.tabs.includes(value.tab)) out.tab = value.tab;
    return out;
  }

  static storage() {
    try { return typeof window !== 'undefined' ? (window.localStorage || null) : null; }
    catch (_e) { return null; }
  }

  static _readRaw(storage, S) {
    try {
      if (!S.prefsKey || !storage || typeof storage.getItem !== 'function') return {};
      const raw = storage.getItem(S.prefsKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_e) { return {}; }
  }

  static readPrefs(storage, S) {
    return MeetingsBrowseList._normalizePrefs(MeetingsBrowseList._readRaw(storage, S), S);
  }

  /** Read-merge-write: keys this view does not own survive. Never throws. */
  static writePrefs(storage, patch, S) {
    const raw = MeetingsBrowseList._readRaw(storage, S);
    const merged = MeetingsBrowseList._normalizePrefs({ ...raw, ...(patch || {}) }, S);
    try {
      if (S.prefsKey && storage && typeof storage.setItem === 'function') {
        storage.setItem(S.prefsKey, JSON.stringify({ ...raw, ...merged }));
      }
    } catch (_e) { /* best-effort */ }
    return merged;
  }

  /**
   * In-memory gesture state (shown day, search, filters) per surface and
   * scope, so the Dataview re-render a write causes keeps what was picked.
   */
  static _viewState(surfaceKey, scopeId) {
    if (!MeetingsBrowseList.__states) MeetingsBrowseList.__states = new Map();
    const key = surfaceKey + '::' + (scopeId || '');
    let s = MeetingsBrowseList.__states.get(key);
    if (!s) {
      s = { day: null, text: '', person: '', project: '', openOnly: false };
      MeetingsBrowseList.__states.set(key, s);
    }
    return s;
  }

  /**
   * Row rules inline styles cannot express. Desktop: ⋯ overlays the right
   * edge on hover / focus, over the open-task slot. Touch or a narrow pane
   * (the task row's 560px): ⋯ sits inline. Phone (the task row's 480px): the
   * summary hides and the chips drop to a second line under the title, so a
   * row is never more than two lines.
   */
  static get ROW_CSS() {
    const R = '.sauce-meeting-row';
    const base = [
      [R, 'position: relative; display: flex; align-items: center; gap: 4px 12px; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer;'],
      [R + ':last-child', 'border-bottom: none;'],
      [R + ':hover, ' + R + ':focus-within', 'background: var(--background-secondary);'],
      [R + ':focus-visible', 'outline: 2px solid var(--interactive-accent); outline-offset: -2px;'],
      ['.sauce-meeting-time', 'flex: 0 0 4.8em; font-size: 0.82em; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap;'],
      ['.sauce-meeting-main', 'flex: 1 1 0%; min-width: 0; display: flex; flex-direction: column; gap: 1px;'],
      [R + ' .sauce-meeting-title', 'color: var(--text-normal); font-weight: 500; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
      ['.sauce-meeting-summary', 'font-size: 0.8em; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
      ['.sauce-meeting-chips', 'display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex: 0 0 auto; min-width: 0;'],
      ['.sauce-meeting-slot', 'display: inline-flex; justify-content: flex-end; align-items: center; font-size: 0.8em; min-width: 0;'],
      ['.sauce-meeting-slot.is-project', 'width: 11em;'],
      ['.sauce-meeting-slot.is-people', 'width: 10em;'],
      ['.sauce-meeting-slot.is-tasks', 'width: 4.8em;'],
      ['.sauce-meeting-chip', 'display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; box-sizing: border-box; padding: 2px 8px; border-radius: 5px; background: var(--background-modifier-border); color: var(--text-muted); line-height: 1.4;'],
      ['.sauce-meeting-chip.is-open', 'color: var(--text-accent);'],
      ['.sauce-meeting-actions', 'position: absolute; top: 50%; right: 6px; transform: translateY(-50%); display: flex; align-items: center; padding-left: 8px; background: var(--background-secondary); border-radius: var(--radius-s, 4px); opacity: 0; transition: opacity 120ms ease;'],
      [R + ':hover .sauce-meeting-actions, ' + R + ':focus-within .sauce-meeting-actions', 'opacity: 1;'],
      [R + ':hover .sauce-meeting-slot.is-tasks, ' + R + ':focus-within .sauce-meeting-slot.is-tasks', 'visibility: hidden;'],
      ['button.sauce-meeting-more', 'display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--radius-s, 4px); background: transparent; color: var(--text-faint); cursor: pointer; box-shadow: none;'],
      ['button.sauce-meeting-more:hover, button.sauce-meeting-more:focus-visible', 'background: var(--background-modifier-hover); color: var(--text-normal);'],
    ];
    const touch = [
      [R + ' .sauce-meeting-actions', 'position: static; transform: none; opacity: 1; padding-left: 0; background: none;'],
      [R + ':hover .sauce-meeting-slot.is-tasks, ' + R + ':focus-within .sauce-meeting-slot.is-tasks', 'visibility: visible;'],
    ];
    const phone = [
      [R, 'flex-wrap: wrap; row-gap: 2px;'],
      [R + ' .sauce-meeting-time', 'flex-basis: 4.4em;'],
      [R + ' .sauce-meeting-summary', 'display: none;'],
      [R + ' .sauce-meeting-chips', 'order: 3; flex: 1 1 100%; justify-content: flex-start; padding-left: calc(3.6em + 12px); overflow: hidden;'],
      [R + ' .sauce-meeting-slot', 'width: auto !important; min-width: 0;'],
      [R + ' .sauce-meeting-slot:empty', 'display: none;'],
    ];
    const css = (rules, prefix) => rules.map(([sel, body]) => sel.split(', ').map((x) => (prefix || '') + x).join(', ') + ' { ' + body + ' }').join(' ');
    return css(base)
      + ' ' + css(touch, 'body.is-mobile ')
      + ' @media (hover: none) { ' + css(touch) + ' }'
      + ' @media (max-width: 560px) { ' + css(touch) + ' }'
      + ' ' + css(phone, 'body.is-phone ')
      + ' @media (max-width: 480px) { ' + css(phone) + ' }';
  }


  static _openNote(path, how) {
    try {
      const appRef = (typeof window !== 'undefined' && window.app) || (typeof app !== 'undefined' ? app : null);
      const ws = appRef && appRef.workspace;
      if (ws && typeof ws.openLinkText === 'function') ws.openLinkText(path, '', how || false);
    } catch (_e) { /* never throw */ }
  }

  /** "Ada" / "Ada +2": the first name always reads whole; the full list is the chip's title. */
  static _attendeeText(names) {
    if (!names.length) return '';
    return names.length === 1 ? names[0] : names[0] + ' +' + (names.length - 1);
  }

  /**
   * One meeting row: time | title (+ one-line summary) | project, people and
   * open-task chips in fixed slots | ⋯ (on hover on desktop, inline on touch).
   * The whole row opens the note; Cmd/Ctrl-click opens it in a new tab.
   */
  static renderRow(host, m, ctx) {
    const c = ctx || {};
    const row = host.createEl('div', { cls: 'sauce-meeting-row' });
    row.setAttribute('tabindex', '0');
    row.dataset.path = m.path;
    const FB = MeetingsBrowseList._FB();
    const when = c.showDate ? (m.day && FB ? FB.dayLabel(m.day).replace(/ \w+ /, ' ') : '') : (m.time || '');
    const time = row.createEl('span', { cls: 'sauce-meeting-time', text: when });
    if (!when) time.setAttribute('aria-hidden', 'true');
    if (c.showDate && m.time) time.setAttribute('title', m.time);
    const main = row.createEl('div', { cls: 'sauce-meeting-main' });
    const title = main.createEl('a', { cls: 'sauce-meeting-title internal-link', text: m.title });
    title.setAttribute('href', m.path);
    title.setAttribute('data-href', m.path);
    title.setAttribute('title', m.title);
    if (m.summary) main.createEl('div', { cls: 'sauce-meeting-summary', text: m.summary }).setAttribute('title', m.summary);
    const chips = row.createEl('div', { cls: 'sauce-meeting-chips' });
    const slot = (kind, text, extra, tip) => {
      const s = chips.createEl('span', { cls: 'sauce-meeting-slot is-' + kind });
      if (!text) return s;
      const chip = s.createEl('span', { cls: 'sauce-meeting-chip is-' + kind + (extra ? ' ' + extra : ''), text });
      chip.setAttribute('title', tip || text);
      return s;
    };
    if (c.showProject !== false) slot('project', m.project, 'sauce-meeting-project');
    slot('people', MeetingsBrowseList._attendeeText(m.attendees), 'sauce-meeting-people', m.attendees.join(', '));
    slot('tasks', m.open > 0 ? m.open + ' open' : '', 'is-open', m.open > 0 ? MeetingsBrowseList._plural(m.open, 'open task') : '');
    const actions = row.createEl('div', { cls: 'sauce-meeting-actions' });
    const more = actions.createEl('button', { cls: 'sauce-meeting-more', text: '⋯' });
    more.setAttribute('type', 'button');
    more.setAttribute('aria-label', 'More for ' + m.title);
    more.setAttribute('title', 'More');
    const open = (ev) => {
      const how = ev && (ev.metaKey || ev.ctrlKey) ? 'tab' : false;
      MeetingsBrowseList._openNote(m.path, how);
    };
    const stop = (ev) => { try { ev.preventDefault(); ev.stopPropagation(); } catch (_e) { /* ignore */ } };
    row.addEventListener('click', (ev) => { stop(ev); open(ev); });
    row.addEventListener('keydown', (ev) => {
      if (ev && ev.key === 'Enter' && ev.target === row) { stop(ev); open(ev); }
    });
    more.addEventListener('click', (ev) => {
      stop(ev);
      try { if (typeof c.onMore === 'function') c.onMore(m, more); } catch (_e) { /* never throw */ }
    });
    return row;
  }

  /** ⋯ entries: open three ways, then the meeting-note edits. */
  static rowMenu(m, ctx) {
    const c = ctx || {};
    const L = c.leaf;
    const entries = [
      { label: 'Open', onSelect: () => MeetingsBrowseList._openNote(m.path, false) },
      { label: 'Open in new tab', onSelect: () => MeetingsBrowseList._openNote(m.path, 'tab') },
      { label: 'Open to the right', onSelect: () => MeetingsBrowseList._openNote(m.path, 'split') },
    ];
    if (L && typeof L._onAddToProject === 'function' && typeof L._onEditAttendees === 'function') {
      entries.push({ section: 'This meeting' });
      entries.push({ label: m.project ? 'Change project…' : 'Add to project…', onSelect: () => L._onAddToProject(c.dv, m.page) });
      entries.push({ label: 'Edit attendees…', onSelect: () => L._onEditAttendees(c.dv, m.page) });
    }
    return entries;
  }

  async render(dv, opts) {
    if (!dv || !dv.container) return;
    if (dv.container.closest && dv.container.closest('.markdown-embed')) return;
    try {
      const Self = MeetingsBrowseList;
      const cjs = (typeof window !== 'undefined' && window.customJS)
        || (typeof globalThis !== 'undefined' && globalThis.customJS) || null;
      const FB = Self._FB();
      if (!FB) return this._renderFlat(dv);
      let page = null;
      try {
        page = cjs && cjs.RenderSafe && typeof cjs.RenderSafe.page === 'function'
          ? cjs.RenderSafe.page(dv)
          : (typeof dv.current === 'function' ? dv.current() : null);
      } catch (_e) { page = null; }
      if (!page || !page.file) return;

      const o = opts || {};
      const S = Self.surface(o.surface);
      const scope = o.scope && typeof o.scope.match === 'function' ? o.scope : null;
      const todayStr = Self._today();

      let pages = [];
      try {
        const raw = dv.pages('"spice/meetings/notes"');
        pages = (raw && typeof raw.array === 'function') ? raw.array() : Array.from(raw || []);
      } catch (_e) { pages = []; }
      pages = pages.filter((p) => {
        if (!p || !p.file || !p.file.path || p.file.path.includes('/_trash/')) return false;
        if (!scope) return true;
        try { return !!scope.match(p); } catch (_e) { return false; }
      });
      const counts = Self._openTaskCountsBySource(dv);
      const models = pages.map((p) => Self.toModel(p, counts));

      const container = dv.container;
      const gen = (container.__meetingsViewGen || 0) + 1;
      container.__meetingsViewGen = gen;
      FB.clear(container);

      const ctx = {
        dv,
        leaf: cjs && cjs.MeetingLeafActions,
        showProject: S.menus.includes('project') || S.key === 'day',
        onMore: (m, anchor) => {
          const MP = cjs && cjs.MenuPopover;
          if (MP && typeof MP.open === 'function') {
            try { MP.open(Self.rowMenu(m, ctx), { anchor }); } catch (_e) { /* never throw */ }
          } else {
            Self._openNote(m.path, 'tab');
          }
        },
      };

      if (S.key === 'day') {
        const day = (typeof o.day === 'string' && FB.parts(o.day)) ? o.day : (Self.meetingDay(page) || todayStr);
        const hosts = FB.layout(container, { rootCls: 'sauce-meetings-view is-day', controls: false, css: Self.ROW_CSS });
        const list = models.filter((m) => m.day === day).sort(Self._byClock);
        if (!list.length) { FB.empty(hosts.list, 'No meetings on ' + FB.dayLabel(day) + '.', 'sauce-meetings-empty'); return; }
        for (const m of list) Self.renderRow(hosts.list, m, ctx);
        return;
      }

      const storage = Self.storage();
      let prefs = Self.readPrefs(storage, S);
      const state = Self._viewState(S.key, scope ? scope.id : '');
      const hosts = FB.layout(container, {
        rootCls: 'sauce-meetings-view is-' + S.key,
        search: S.search, strip: S.strip, caption: S.caption,
        pillsLabel: 'Meetings', css: Self.ROW_CSS,
      });

      const narrowed = (list) => Self.filterMeetings(Self.searchMeetings(list, state.text), state);
      const inTab = (tab) => Self.selectTab(models, tab, todayStr);
      const range = () => (prefs.tab === 'all' ? null : FB.rangeFor(prefs.tab, todayStr));

      if (S.search) {
        FB.search(hosts.search, {
          placeholder: S.searchPlaceholder, label: 'Search meetings', value: state.text, inputCls: 'sauce-meetings-search',
          onInput: (text) => { state.text = text; paint(); },
        });
      }

      const leaveDay = () => { state.day = null; paint(); };
      const pickTab = (tab) => {
        state.day = null;
        if (prefs.tab !== tab) prefs = Self.writePrefs(storage, { tab }, S);
        paint();
      };

      const paintPills = () => {
        FB.clear(hosts.pills);
        if (state.day) FB.dayPill(hosts.pills, { label: FB.dayLabel(state.day), title: 'Show the whole range', onExit: leaveDay, cls: 'sauce-meetings-day-pill' });
        const labels = Self.TAB_LABELS;
        for (const tab of S.tabs) {
          const n = narrowed(inTab(tab)).length;
          FB.pill(hosts.pills, {
            text: n > 0 ? labels[tab] + ' · ' + n : labels[tab],
            active: !state.day && prefs.tab === tab,
            role: 'tab', cls: 'sauce-meetings-tab',
            onClick: () => pickTab(tab),
          });
        }
      };

      const paintRight = () => {
        FB.clear(hosts.right);
        const base = Self.searchMeetings(inTab(prefs.tab), state.text);
        if (state.person && !Self.personEntries(base).some((e) => e.value === state.person)) state.person = '';
        if (state.project && !Self.projectEntries(base).some((e) => e.value === state.project)) state.project = '';
        if (S.menus.includes('person')) {
          FB.pill(hosts.right, {
            text: state.person ? 'Person: ' + state.person + ' ▾' : 'Person ▾',
            active: !!state.person, menu: true, cls: 'sauce-meetings-person-filter',
            onClick: (btn) => FB.menu(btn, {
              entries: Self.personEntries(Self.filterMeetings(base, { ...state, person: '' })),
              current: state.person, allLabel: 'Everyone',
              onPick: (v) => { state.person = v; paint(); },
            }),
          });
        }
        if (S.menus.includes('project')) {
          FB.pill(hosts.right, {
            text: state.project ? 'Project: ' + state.project + ' ▾' : 'Project ▾',
            active: !!state.project, menu: true, cls: 'sauce-meetings-project-filter',
            onClick: (btn) => FB.menu(btn, {
              entries: Self.projectEntries(Self.filterMeetings(base, { ...state, project: '' })),
              current: state.project, allLabel: 'All projects',
              onPick: (v) => { state.project = v; paint(); },
            }),
          });
        }
        if (S.menus.includes('open')) {
          FB.pill(hosts.right, {
            text: 'Open tasks', active: !!state.openOnly, pressed: !!state.openOnly, cls: 'sauce-meetings-open-filter',
            title: 'Only meetings with open tasks',
            onClick: () => { state.openOnly = !state.openOnly; paint(); },
          });
        }
      };

      const paintStrip = () => {
        if (!hosts.strip) return;
        FB.clear(hosts.strip);
        const r = range();
        if (!r) return;
        const perDay = new Map();
        for (const m of narrowed(inTab(prefs.tab))) perDay.set(m.day, (perDay.get(m.day) || 0) + 1);
        FB.strip(hosts.strip, {
          strip: FB.dayCells(perDay, r.from, r.to, todayStr),
          selected: state.day, noun: 'meetings', ariaLabel: 'Meetings per day', cls: 'sauce-meetings-strip',
          onPick: (day) => { state.day = day; paint(); },
        });
      };

      const paintCaption = (shown, total) => {
        if (!hosts.caption) return;
        FB.clear(hosts.caption);
        let text = Self.caption(inTab(prefs.tab), prefs.tab, todayStr, S.menus.includes('project'));
        if (shown !== total) text += ' · showing ' + shown;
        hosts.caption.textContent = text;
      };

      const paintList = () => {
        FB.clear(hosts.list);
        const all = narrowed(inTab(prefs.tab));
        const visible = state.day ? all.filter((m) => m.day === state.day) : all;
        paintCaption(visible.length, inTab(prefs.tab).length);
        if (!visible.length) {
          FB.empty(hosts.list, models.length ? Self.emptyText(S, prefs.tab, state) : S.emptyAll, 'sauce-meetings-empty');
          return;
        }
        const year = todayStr.slice(0, 4);
        if (prefs.tab === 'all' && !state.day) {
          const dated = { ...ctx, showDate: true };
          for (const [month, list] of Self.groupByMonth(visible)) {
            FB.section(dv, hosts.list, (month ? FB.monthLabel(month) : 'Undated') + ' · ' + list.length, { cls: 'sauce-meetings-section' });
            for (const m of list) Self.renderRow(hosts.list, m, dated);
          }
          return;
        }
        for (const [day, list] of Self.groupByDay(visible)) {
          const label = day ? FB.dayLabel(day) + (day.slice(0, 4) !== year ? ', ' + day.slice(0, 4) : '') : 'Undated';
          FB.section(dv, hosts.list, label + ' · ' + list.length, { cls: 'sauce-meetings-section' });
          for (const m of list) Self.renderRow(hosts.list, m, ctx);
        }
      };

      const paint = () => {
        if (container.__meetingsViewGen !== gen) return;
        const r = range();
        if (state.day && (!r || state.day < r.from || state.day > r.to)) state.day = null;
        paintPills();
        paintRight();
        paintStrip();
        paintList();
      };
      paint();
    } catch (_e) {
      // Never throw out of render.
    }
  }

  // ---------- Flat fallback (FilterBar not loaded) ----------

  async _renderFlat(dv) {
    if (!dv || !dv.container) return;
    if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

    try {
      // Cold-load guard. A throwing RenderSafe.page/dv.current is another cold
      // input, never a reason for the render promise to reject.
      const cjs = (typeof globalThis !== 'undefined' && globalThis.customJS)
        || (typeof window !== 'undefined' && window.customJS) || null;
      let page = null;
      try {
        page = cjs?.RenderSafe && typeof cjs.RenderSafe.page === 'function'
          ? cjs.RenderSafe.page(dv)
          : (typeof dv.current === 'function' ? dv.current() : null);
      } catch (_e) { page = null; }
      if (!page || !page.file) return;
      let meetings = dv.pages('"spice/meetings/notes"');
      meetings = (meetings && typeof meetings.array === 'function') ? meetings.array() : Array.from(meetings || []);

      // Sort by date desc; fallback filename desc.
      meetings.sort((a, b) => {
        const ad = a && a.date != null ? String(a.date) : '';
        const bd = b && b.date != null ? String(b.date) : '';
        if (ad && bd) return ad < bd ? 1 : (ad > bd ? -1 : 0);
        if (ad !== bd) return ad ? -1 : 1;
        const an = (a && a.file && a.file.name) || '';
        const bn = (b && b.file && b.file.name) || '';
        return an < bn ? 1 : (an > bn ? -1 : 0);
      });

      if (!meetings.length) {
        const empty = dv.container.createEl('div', { text: 'No meetings yet.' });
        empty.style.cssText = 'color: var(--text-muted); font-style: italic; padding: 8px 0;';
        return;
      }

      const taskCounts = MeetingsBrowseList._openTaskCountsBySource(dv);

      // Group by month, preserving desc order.
      const order = [];
      const groups = {};
      for (const p of meetings) {
        const key = MeetingsBrowseList._monthKey(p && p.date);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(p);
      }

      const SL = cjs && cjs.SectionLabel;
      const BC = cjs && cjs.BeaconCards;

      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const label = MeetingsBrowseList._monthLabel(key);

        if (SL && typeof SL.render === 'function') {
          try { SL.render(dv, { text: label, top: i === 0 }); }
          catch (_e) { MeetingsBrowseList._plainHeading(dv, label); }
        } else {
          MeetingsBrowseList._plainHeading(dv, label);
        }

        const rows = groups[key];

        if (BC && typeof BC.render === 'function') {
          const icons = {
            pending: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
          };
          try {
            await BC.render(dv, {
              pages: rows,
              layout: 'row',
              columns: 1,
              title: p => (p && p.file && p.file.name) || 'Untitled',
              subtitle: p => {
                const names = MeetingsBrowseList._attendeeNames(p);
                if (!names.length) return null;
                return names.length <= 3
                  ? names.join(', ')
                  : names.slice(0, 2).join(', ') + ` +${names.length - 2}`;
              },
              badges: p => {
                const base = (p && p.file && p.file.name) || '';
                const n = taskCounts[base] || 0;
                return n > 0 ? [{ label: `${n} open`, tone: 'error', icon: icons.pending }] : [];
              },
              target: p => (p && p.file && p.file.path) || '',
              sort: () => 0
            });
          } catch (_e) {
            MeetingsBrowseList._plainList(dv, rows, taskCounts);
          }
        } else {
          MeetingsBrowseList._plainList(dv, rows, taskCounts);
        }
      }
    } catch (_e) {
      // Never throw out of render.
    }
  }

  static _monthLabel(key) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!m || key === '0000-00') return 'Undated';
    const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const mi = parseInt(m[2], 10);
    const name = (mi >= 1 && mi <= 12) ? months[mi] : m[2];
    return `${name} ${m[1]}`;
  }

  static _plainHeading(dv, text) {
    try {
      const h = dv.container.createEl('div', { text: String(text) });
      h.style.cssText = 'font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; margin: 10px 0 6px 0;';
    } catch (_e) { /* noop */ }
  }

  static _plainList(dv, rows, taskCounts) {
    try {
      const ul = dv.container.createEl('div');
      ul.style.cssText = 'display: flex; flex-direction: column; gap: 4px; margin: 4px 0;';
      for (const p of rows) {
        const path = (p && p.file && p.file.path) || '';
        const name = (p && p.file && p.file.name) || 'Untitled';
        const line = ul.createEl('div');
        const link = line.createEl('a', { text: name });
        link.setAttribute('href', path);
        link.classList.add('internal-link');
        const n = taskCounts[name] || 0;
        if (n > 0) {
          const b = line.createEl('span', { text: ` (${n} open)` });
          b.style.cssText = 'color: var(--text-muted); font-size: 0.85em;';
        }
      }
    } catch (_e) { /* noop */ }
  }
}
