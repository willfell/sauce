/**
 * MeetingsBrowseList (CustomJS) — the persistent Meetings hub's browsable list.
 *
 * Replaces the per-day MeetingsHubCards (which date-filtered to today and
 * regex-scraped attendees/tasks out of the note body). This widget lists ALL
 * meetings under spice/meetings/notes, newest first, grouped by month. All data
 * comes from FRONTMATTER (page.date, page.attendees/page.people) and from a
 * single live task query — never from regex over the note body.
 *
 * COLD-LOAD SAFETY (landmines #1-2): resolve the current page via
 * customJS.RenderSafe.page(dv) (fallback dv.current()) and bail quietly if it
 * isn't ready. Every path is guarded; render NEVER throws.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → the class never registers. To Node-test the statics, load via
 * `new Function(src + "\nreturn MeetingsBrowseList;")()`.
 *
 * Static API (Node-testable, pure):
 *   MeetingsBrowseList._monthKey(dateStr)            → "YYYY-MM" (stable fallback)
 *   MeetingsBrowseList._attendeeNames(page)          → string[]
 *   MeetingsBrowseList._openTaskCountsBySource(dv)   → { basename: openCount }
 *
 * Instance API (browser-side):
 *   MeetingsBrowseList.render(dv)   ← the customjs-guard entry point
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
   * never-throws; non-array / null / {} → [].
   */
  static _attendeeNames(page) {
    if (!page || typeof page !== 'object') return [];
    let list = page.attendees;
    if (!Array.isArray(list) || list.length === 0) list = page.people;
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const raw of list) {
      const name = MeetingsBrowseList._coerceName(raw);
      if (name) out.push(name);
    }
    return out;
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

  // ---------- Instance / browser render ----------

  async render(dv) {
    if (!dv || !dv.container) return;
    if (dv.container.closest && dv.container.closest('.markdown-embed')) return;

    // Cold-load guard.
    const page = (window.customJS && window.customJS.RenderSafe)
      ? window.customJS.RenderSafe.page(dv)
      : (dv.current && dv.current());
    if (!page) return;

    try {
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

      const SL = window.customJS && window.customJS.SectionLabel;
      const BC = window.customJS && window.customJS.BeaconCards;

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
