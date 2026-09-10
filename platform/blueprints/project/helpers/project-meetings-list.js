/**
 * ProjectMeetingsList (CustomJS) — the per-project Meetings page's full list.
 *
 * Renders EVERY meeting linked to the current project (frontmatter `project:`
 * on notes under spice/meetings/notes), newest first, grouped by month —
 * the project-scoped sibling of the meetings blueprint's global
 * MeetingsBrowseList (which deliberately lists ALL meetings). Lives on
 * `spice/projects/<slug>/Meetings.md` (type: project-meetings), scaffolded by
 * entity-create for new projects and applyProjectMeetingsPageBackfill for
 * existing ones. The project identity comes from the CURRENT page's
 * frontmatter (`project` wikilink/Link + `project_name`), so the helper needs
 * no arguments.
 *
 * Month-group presentation (SectionLabel + BeaconCards rows + open-task
 * badges) is ported from MeetingsBrowseList; the project-match predicate is
 * ported from ProjectDashboard._projectMatches. Empty output renders NOTHING
 * (project blueprint rule — no callouts, no placeholders).
 *
 * COLD-LOAD SAFETY (landmines #1-2): resolve the current page via
 * customJS.RenderSafe.page(dv) (fallback dv.current()) and bail quietly if it
 * isn't ready. Every path is guarded; render NEVER throws.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( ... )` and evals it as ONE expression; any trailer (module.exports,
 * if, ...) → the class never registers. To Node-test the statics, load via
 * `new Function(src + "\nreturn ProjectMeetingsList;")()`.
 *
 * Static API (Node-testable, pure):
 *   ProjectMeetingsList._projectRef(page)            → { path, name } | null
 *   ProjectMeetingsList._matches(field, ref)         → boolean
 *   ProjectMeetingsList._monthKey(dateStr)           → "YYYY-MM" (stable fallback)
 *   ProjectMeetingsList._attendeeNames(page)         → string[]
 *   ProjectMeetingsList._openTaskCountsBySource(dv)  → { basename: openCount }
 *
 * Instance API (browser-side):
 *   ProjectMeetingsList.render(dv)   ← the customjs-guard entry point
 */
class ProjectMeetingsList {

  // ---------- Static pure helpers ----------

  /**
   * The current page's project identity → { path, name } or null.
   * `page.project` may be a Dataview Link ({path, display}), a wikilink string
   * ("[[Name]]" / "[[Name|alias]]" — the link TARGET wins, not the alias), or
   * a bare name string; `page.project_name` is the fallback. Pure, never throws.
   */
  static _projectRef(page) {
    if (!page || typeof page !== 'object') return null;
    let path = null;
    let name = '';
    const p = page.project;
    if (p && typeof p === 'object') {
      if (p.path) {
        path = String(p.path);
        name = p.display
          ? String(p.display).trim()
          : path.split('/').pop().replace(/\.md$/i, '').trim();
      } else if (p.display) {
        name = String(p.display).trim();
      }
    } else if (typeof p === 'string' && p.trim()) {
      let s = p.trim();
      const m = s.match(/^\[\[([^\]]*)\]\]$/);
      if (m) s = m[1];
      if (s.includes('|')) s = s.split('|')[0];
      name = s.split('/').pop().replace(/\.md$/i, '').trim();
    }
    if (!name && page.project_name) name = String(page.project_name).trim();
    if (!name && !path) return null;
    return { path, name };
  }

  /**
   * True when a meeting's `project:` field references the ref'd project.
   * Handles the three Dataview field shapes (Link object, string, empty) —
   * ported from ProjectDashboard._projectMatches. Pure, never throws.
   */
  static _matches(field, ref) {
    if (!field || !ref) return false;
    const name = ref.name || '';
    if (typeof field === 'string') {
      return (!!name && (field.includes(`[[${name}]]`)
          || field.includes(`[[${name}|`)
          || field === name));
    }
    if (field.path) {
      if (ref.path && field.path === ref.path) return true;
      if (name) {
        const base = String(field.path).split('/').pop().replace(/\.md$/i, '');
        return base === name;
      }
      return false;
    }
    if (field.display) return !!name && field.display === name;
    return false;
  }

  /**
   * `YYYY-MM` prefix of a date string. Empty/null/garbage → a stable fallback
   * bucket. Ported from MeetingsBrowseList._monthKey.
   */
  static _monthKey(dateStr) {
    const s = dateStr == null ? '' : String(dateStr).trim();
    const m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    return '0000-00';
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

  /**
   * Attendee display names from FRONTMATTER — `page.attendees`, else
   * `page.people`. Ported verbatim from MeetingsBrowseList._attendeeNames.
   */
  static _attendeeNames(page) {
    if (!page || typeof page !== 'object') return [];
    let list = ProjectMeetingsList._iterableValues(page.attendees);
    if (list.length === 0) list = ProjectMeetingsList._iterableValues(page.people);
    const out = [];
    for (const raw of list) {
      const name = ProjectMeetingsList._coerceName(raw);
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
   * One spice/tasks query → `{ meetingBasename: openCount }`. Ported verbatim
   * from MeetingsBrowseList._openTaskCountsBySource. Never throws; `{}` on error.
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
        const base = ProjectMeetingsList._sourceBasename(p && p.source_note);
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

    try {
      const cjs = (typeof globalThis !== 'undefined' && globalThis.customJS)
        || (typeof window !== 'undefined' && window.customJS) || null;
      let page = null;
      try {
        page = cjs?.RenderSafe && typeof cjs.RenderSafe.page === 'function'
          ? cjs.RenderSafe.page(dv)
          : (typeof dv.current === 'function' ? dv.current() : null);
      } catch (_e) { page = null; }
      if (!page || !page.file) return;

      const ref = ProjectMeetingsList._projectRef(page);
      if (!ref) return;

      let meetings = dv.pages('"spice/meetings/notes"')
        .where(p => p && p.type === 'meeting' && ProjectMeetingsList._matches(p.project, ref));
      meetings = (meetings && typeof meetings.array === 'function') ? meetings.array() : Array.from(meetings || []);
      if (!meetings.length) return;

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

      const taskCounts = ProjectMeetingsList._openTaskCountsBySource(dv);

      // Group by month, preserving desc order.
      const order = [];
      const groups = {};
      for (const p of meetings) {
        const key = ProjectMeetingsList._monthKey(p && p.date);
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(p);
      }

      const SL = cjs && cjs.SectionLabel;
      const BC = cjs && cjs.BeaconCards;

      for (let i = 0; i < order.length; i++) {
        const key = order[i];
        const label = ProjectMeetingsList._monthLabel(key);

        if (SL && typeof SL.render === 'function') {
          try { SL.render(dv, { text: label, top: i === 0 }); }
          catch (_e) { ProjectMeetingsList._plainHeading(dv, label); }
        } else {
          ProjectMeetingsList._plainHeading(dv, label);
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
                const names = ProjectMeetingsList._attendeeNames(p);
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
            ProjectMeetingsList._plainList(dv, rows, taskCounts);
          }
        } else {
          ProjectMeetingsList._plainList(dv, rows, taskCounts);
        }
      }
    } catch (_e) {
      // Never throw out of render.
    }
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
