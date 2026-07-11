# Journal multi-entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `journal` blueprint sticky-notes-style multi-entry support: a global hub
(Days | All tabs + search), a per-day hub listing that day's entries, timestamped leaf entries
with an optional title, and an install-time migration that converts existing flat
`Journal-YYYY-MM-DD.md` notes (real data in `ero-sauce` + `headspace-sauce`) into the new shape.

**Architecture:** File-for-file mirror of the `sticky-notes` blueprint (v0.10.0), renaming
`Sticky`→`Journal` / `sticky-note`→`journal-entry` / `sticky-day`→`journal-day` /
`sticky-hub`→`journal-hub` throughout. The one genuinely new piece is the migration: unlike
sticky-notes' `StickyDayMigrate` (a runtime customjs class that only patches a `day:`
frontmatter field), journal's migration is a **structural, one-time install-time step**
(`applyJournalMultiEntryMigration` in `platform/install.js`) that moves+renames+rewrites files —
mirroring the *shape* of `applyScratchToStickyNotesMigration` (same file, ~line 2216) but much
simpler: no whole-blueprint rename (root folder name `spice/journal` is unchanged), so no
cross-vault link rewrite and no old-artifact pruning.

**Tech Stack:** CustomJS (Obsidian), DataviewJS, Templater, JSON blueprint manifests, Node.js
(`platform/install.js` CLI + Templater install path), existing mechanisms `chrome-bar`,
`cards`, `accent-button`, `entity-create`, `breadcrumb`, `render-safe`, `doc-search`,
`customjs-guard`, `nav-buttons`, `convenience`.

**Design doc:** `Docs/plans/2026-07-11-journal-multi-entry-design.md`

---

## Reference source (read, don't copy blind)

Every task below says "mirror `platform/blueprints/sticky-notes/...`". Before writing each
file, read the cited sticky-notes source file directly — the code blocks in this plan are
already the mirrored (Journal-named) version, but confirm nothing in sticky-notes' file has
changed since this plan was written (`git log -1 --oneline -- <path>`).

## Task 1: Update `journal` manifest

**Files:**
- Modify: `platform/blueprints/journal/manifest.json` (whole-file replace — small file)
- Reference: `platform/blueprints/sticky-notes/manifest.json` (structure source)

- [ ] **Step 1: Replace the manifest**

Replace the entire contents of `platform/blueprints/journal/manifest.json` with:

```json
{
  "name": "journal",
  "version": "0.4.0",
  "kind": "blueprint",
  "module_directory": "journal",
  "skills_dir": ".claude/skills/journal",
  "description": "Multi-entry journal: global hub (spice/journal/Journal.md, Days | All tabs + search), per-day day-hub (Journal-Day-YYYY-MM-DD.md) under YYYY/MM-MMMM/YYYY-MM-DD/ sub-folders, timestamped leaf entries (Journal-YYYY-MM-DD-HH-mm-ss.md, optional title prompt). Mirrors the sticky-notes (v0.10.0) day-hub/leaf/migrate pattern. v0.4.0 replaces the prior single-note-per-day shape (type: journal, one flat Journal-YYYY-MM-DD.md) — an install migration converts existing flat notes into the new folder/filenames/types.",
  "depends_on": [
    { "name": "nav-buttons", "range": ">=2.6.1" },
    { "name": "customjs-guard", "range": ">=1.0.0" },
    { "name": "convenience", "range": ">=0.1.0" },
    { "name": "chrome-bar", "range": ">=0.3.0" },
    { "name": "cards", "range": ">=0.2.4" },
    { "name": "accent-button", "range": ">=0.1.0" },
    { "name": "entity-create", "range": ">=0.4.0" },
    { "name": "platform-claude", "range": ">=0.1.1" },
    { "name": "breadcrumb", "range": ">=0.1.0" },
    { "name": "render-safe", "range": ">=0.1.0" },
    { "name": "doc-search", "range": ">=0.1.0" }
  ],
  "breadcrumb": {
    "types": {
      "journal-entry": {
        "ancestors": [
          { "label": "lit:Journal" },
          { "label": "path:3" },
          { "label": "path:4", "link": "spice/journal/{path:2}/{path:3}/{path:4}/Journal-Day-{path:4}.md" }
        ],
        "current": { "label": "fm:time|file:basename" }
      },
      "journal-day": {
        "ancestors": [
          { "label": "lit:Journal" },
          { "label": "path:3" }
        ],
        "current": { "label": "path:4" }
      }
    }
  },
  "customjs_classes": [
    "JournalHubCards",
    "JournalDayList",
    "JournalChromeBar"
  ],
  "files": [
    {
      "source": "templates/Journal Entry.md",
      "dest": "{{templates_path}}/Journal Entry.md"
    },
    {
      "source": "templates/Journal Day Hub.md",
      "dest": "{{templates_path}}/Journal Day Hub.md"
    },
    {
      "source": "templates/Journal Hub.md",
      "dest": "{{module_directory}}/Journal.md"
    },
    {
      "source": "helpers/journal-hub-cards.js",
      "dest": "{{scripts_path}}/journal/journal-hub-cards.js"
    },
    {
      "source": "helpers/journal-day-list.js",
      "dest": "{{scripts_path}}/journal/journal-day-list.js"
    },
    {
      "source": "helpers/journal-chrome-bar.js",
      "dest": "{{scripts_path}}/journal/journal-chrome-bar.js"
    }
  ],
  "claude_surface": [
    {
      "kind": "command",
      "source": "commands/journal.md",
      "dest": ".claude/commands/journal.md"
    },
    {
      "kind": "skill",
      "source": "skills/new-journal-entry/SKILL.md",
      "dest": "{{skills_dir}}/new-journal-entry/SKILL.md"
    },
    {
      "kind": "claude_md_row",
      "table": "resolvers",
      "row": { "topic": "Journal", "path": "{{module_directory}}", "command": "/journal" }
    }
  ],
  "nav_buttons": [
    {
      "id": "journal-today",
      "label": "Journal",
      "icon": "notebook",
      "order": 120,
      "action": {
        "type": "runTemplaterTemplate",
        "template_source": "Journal Day Hub.md",
        "folder_prefix": "{{module_directory}}",
        "folder_date_pattern": "YYYY/MM-MMMM/YYYY-MM-DD",
        "filename_prefix": "Journal-Day-",
        "filename_date_pattern": "YYYY-MM-DD",
        "filename_suffix": ""
      }
    }
  ],
  "new_entity_buttons": [
    {
      "id": "journal-entry",
      "label": "+ New Journal Entry",
      "icon": "pencil-plus",
      "prompts": [
        { "key": "title", "label": "Journal entry title (optional)", "type": "string", "required": false }
      ],
      "destination": {
        "folder_prefix": "spice/journal/{{current_file.frontmatter.day|today}}-routed",
        "filename_prefix": "Journal-{{current_file.frontmatter.day|today}}-",
        "filename_date_pattern": "HH-mm-ss",
        "filename_suffix": ""
      },
      "frontmatter_template": {
        "type": "journal-entry",
        "created_at": "{{now.YYYY-MM-DDTHH:mm:ssZ}}",
        "day": "{{current_file.frontmatter.day|today}}",
        "title": "{{prompts.title}}"
      },
      "inline_body": "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"JournalChromeBar\" });\n```\n"
    }
  ],
  "templater_folder_templates": [
    { "folder": "{{module_directory}}", "template": "{{templates_path}}/Journal Entry.md" }
  ],
  "post_install": [
    { "type": "notice", "message": "Journal upgraded: entries now live in a day-hub — click the Journal nav-button to open today's hub, then + New Journal Entry to capture." }
  ],
  "rule_fragments": [
    {
      "target": "journal-entry",
      "fragment": {
        "scope": { "path_glob": "spice/journal/**/Journal-2*.md" },
        "extends": "_canonical-vocab",
        "required_frontmatter": {
          "type": { "required": true, "equals": "journal-entry" },
          "day": { "required": true, "type": "string" }
        },
        "naming_pattern": "^Journal-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}(-\\d{2})?\\.md$"
      }
    },
    {
      "target": "journal-day-hub",
      "fragment": {
        "scope": { "path_glob": "spice/journal/**/Journal-Day-*.md" },
        "extends": "_canonical-vocab",
        "required_frontmatter": {
          "type": { "required": true, "equals": "journal-day" },
          "day": { "required": true, "type": "string" }
        },
        "naming_pattern": "^Journal-Day-\\d{4}-\\d{2}-\\d{2}\\.md$"
      }
    }
  ]
}
```

Notes on the diff from sticky-notes' manifest shape: `entity-create` button's `frontmatter_template.title` has no fallback (sticky-notes' doesn't either — an empty prompt yields `title: ""`, handled by the chrome-bar banner's "click to rename" placeholder, same as sticky-notes). `nav_buttons[].order: 120` is unchanged from journal's current manifest (keeps its existing position in the launcher). `skills_dir` is new (journal's old manifest had none — matches sticky-notes' pattern).

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('platform/blueprints/journal/manifest.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add platform/blueprints/journal/manifest.json
git commit -m "feat(journal): manifest for multi-entry day-hub shape"
```

---

## Task 2: New templates, retire the old one

**Files:**
- Create: `platform/blueprints/journal/templates/Journal Entry.md`
- Create: `platform/blueprints/journal/templates/Journal Day Hub.md`
- Create: `platform/blueprints/journal/templates/Journal Hub.md`
- Delete: `platform/blueprints/journal/templates/Today Journal.md`

- [ ] **Step 1: Write the leaf entry template**

`platform/blueprints/journal/templates/Journal Entry.md`:

```markdown
---
type: journal-entry
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
time: "<% tp.date.now("HH:mm") %>"
day_link: "[[Journal-Day-<% tp.date.now('YYYY-MM-DD') %>]]"
---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```
```

- [ ] **Step 2: Write the day-hub template**

`platform/blueprints/journal/templates/Journal Day Hub.md`:

```markdown
---
type: journal-day
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
day: "<% tp.date.now("YYYY-MM-DD") %>"
---

# <% tp.date.now("dddd, MMMM Do YYYY") %>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalDayList", args: [{ day: dv.current()?.day }] });
```
```

- [ ] **Step 3: Write the global hub template**

`platform/blueprints/journal/templates/Journal Hub.md`:

```markdown
---
type: journal-hub
---

# Journal

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalChromeBar" });
```

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "JournalHubCards" });
```
```

- [ ] **Step 4: Delete the old template**

```bash
git rm "platform/blueprints/journal/templates/Today Journal.md"
```

- [ ] **Step 5: Commit**

```bash
git add "platform/blueprints/journal/templates/Journal Entry.md" "platform/blueprints/journal/templates/Journal Day Hub.md" "platform/blueprints/journal/templates/Journal Hub.md"
git commit -m "feat(journal): new day-hub/leaf/global-hub templates, retire single-note template"
```

---

## Task 3: `JournalDayList` helper

**Files:**
- Create: `platform/blueprints/journal/helpers/journal-day-list.js`
- Reference: `platform/blueprints/sticky-notes/helpers/sticky-day-list.js`

- [ ] **Step 1: Write the helper**

`platform/blueprints/journal/helpers/journal-day-list.js` — exact mirror of
`StickyDayList`, `Sticky`→`Journal`, `sticky-note`→`journal-entry`,
`spice/sticky-notes`→`spice/journal`:

```javascript
/**
 * JournalDayList (CustomJS)
 * Renders all journal entries for a given day as BeaconCards in row layout.
 * Title = p.title frontmatter if present, else first non-fenced body line,
 *         else filename.
 * Meta = "edited X ago" relative time from file mtime.
 * Sort = mtime descending (most-recently-edited first).
 *
 * Tolerates day arg + p.day frontmatter as string | Date | Luxon.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", {
 *     class: "JournalDayList",
 *     args: [{ day: dv.current().day }]
 *   });
 */
class JournalDayList {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        // No Date branch — see StickyDayList's identical guard for rationale:
        // a bare JS Date carries no timezone affinity, so returning null here
        // (rather than reading local getFullYear/Month/Date off a UTC-anchored
        // instant) avoids silently misattributing a YAML-parsed unquoted
        // "day: 2026-06-01" to the wrong calendar day for users west of UTC.
        // The install-time migration always writes `day` as a quoted string,
        // so this branch is unreachable in practice post-migration.
        return null;
    }

    _extractPreviewFromBody(raw) {
        const afterFrontmatter = raw.split(/^---\s*$/m).slice(2).join("---");
        const lines = afterFrontmatter.split("\n");
        let inFence = false;
        for (const rawLine of lines) {
            const l = rawLine.trim();
            if (l.startsWith("```")) { inFence = !inFence; continue; }
            if (inFence) continue;
            if (!l) continue;
            if (l.startsWith("---")) continue;
            if (l.startsWith("← ") || l.startsWith("[[")) continue;
            return l.slice(0, 80);
        }
        return "";
    }

    async _pollForDayArg(args, dv) {
        let day = this._coerceDay(args && args.day);
        for (let i = 0; i < 40 && (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)); i++) {
            await new Promise(r => setTimeout(r, 50));
            day = this._coerceDay(customJS.RenderSafe.page(dv)?.day);
        }
        return day;
    }

    async render(dv, args) {
        if (dv.container.closest(".markdown-embed")) return;

        const myGen = (dv.container.__journalRenderGen || 0) + 1;
        dv.container.__journalRenderGen = myGen;
        const isStale = () => dv.container.__journalRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = await this._pollForDayArg(args, dv);
        if (isStale()) return;
        if (!day) {
            dv.paragraph("JournalDayList: missing `day` arg.");
            return;
        }

        const entries = dv.pages('"spice/journal"')
            .where(p => p.type === "journal-entry" && this._coerceDay(p.day) === day);

        const items = [];
        for (const s of entries) {
            let title = (s.title && String(s.title).trim()) || "";
            if (!title) {
                try {
                    const raw = await app.vault.read(app.vault.getAbstractFileByPath(s.file.path));
                    title = this._extractPreviewFromBody(raw);
                } catch (e) {
                    title = "";
                }
            }
            if (!title) title = s.file.name;
            items.push({
                file: s.file,
                _title: title,
                _mtime: (s.file.mtime && s.file.mtime.ts) || 0
            });
        }

        if (isStale()) return;

        await customJS.BeaconCards.render(dv, {
            pages: items,
            layout: "row",
            title: (p) => p._title,
            meta: (p) => {
                const when = p._mtime ? window.moment(p._mtime).fromNow() : "(unknown)";
                return `<span title="Last edited">edited ${when}</span>`;
            },
            target: (p) => p.file.path,
            sort: (a, b) => (b._mtime || 0) - (a._mtime || 0),
            empty: "No journal entries for this day yet. Hit + New Journal Entry above to capture one."
        });
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add platform/blueprints/journal/helpers/journal-day-list.js
git commit -m "feat(journal): JournalDayList helper (day-hub entry cards)"
```

---

## Task 4: `JournalHubCards` helper

**Files:**
- Create: `platform/blueprints/journal/helpers/journal-hub-cards.js`
- Reference: `platform/blueprints/sticky-notes/helpers/sticky-hub-cards.js`

- [ ] **Step 1: Write the helper**

`platform/blueprints/journal/helpers/journal-hub-cards.js` — exact mirror of
`StickyHubCards`, `Sticky`→`Journal`, `sticky-note`→`journal-entry`,
`spice/sticky-notes`→`spice/journal`, `Sticky-Day-`→`Journal-Day-`,
`__stickyHubMode`→`__journalHubMode`, `__stickyRenderGen`→`__journalRenderGen`,
`__stickyAllGen`→`__journalAllGen`:

```javascript
/**
 * JournalHubCards (CustomJS)
 * The global journal hub. A "Days | All" segmented toggle sits above the
 * card area:
 *   - Days (default): one card per day with ≥1 journal entry, latest first;
 *     click → that day's day-hub page.
 *   - All: a flat, recursive, newest-first list of EVERY journal entry across
 *     all days, fronted by the doc-search strip. Typing filters by title AND
 *     entry body content (a title-miss but body-hit still matches) — search
 *     replaces the card list with results, mirroring the wiki blueprint's UX.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "JournalHubCards" });
 */
class JournalHubCards {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        if (raw instanceof Date && !isNaN(raw)) {
            const y = raw.getFullYear();
            const m = String(raw.getMonth() + 1).padStart(2, "0");
            const d = String(raw.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }
        return null;
    }

    // Local copy of JournalDayList._extractPreviewFromBody — kept in-class to
    // avoid cross-class load-order coupling (sticky-notes precedent explicitly
    // sanctions this duplication).
    _extractPreviewFromBody(raw) {
        const afterFrontmatter = String(raw || "").split(/^---\s*$/m).slice(2).join("---");
        const lines = afterFrontmatter.split("\n");
        let inFence = false;
        for (const rawLine of lines) {
            const l = rawLine.trim();
            if (l.startsWith("```")) { inFence = !inFence; continue; }
            if (inFence) continue;
            if (!l) continue;
            if (l.startsWith("---")) continue;
            if (l.startsWith("← ") || l.startsWith("[[")) continue;
            return l.slice(0, 80);
        }
        return "";
    }

    _mode(container) {
        return container && container.__journalHubMode === "all" ? "all" : "days";
    }

    _matchesFilter(page, needle, body) {
        if (!needle) return true;
        const title = (page && page.title ? String(page.title) : "").toLowerCase();
        const name = (page && page.file && page.file.name ? page.file.name : "").toLowerCase();
        return title.includes(needle) || name.includes(needle) || (body || "").toLowerCase().includes(needle);
    }

    _renderToggle(dv, mode) {
        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 8px; justify-content: center; margin: 0 0 10px 0;";
        const mk = (key, label) => {
            const b = row.createEl("button", { text: label });
            const active = mode === key;
            b.style.cssText = "padding: 4px 14px; border-radius: 12px; border: 1px solid var(--background-modifier-border); cursor: pointer; font-size: 0.85em;"
                + (active
                    ? "background: var(--interactive-accent); color: var(--text-on-accent);"
                    : "background: var(--background-secondary); color: var(--text-muted);");
            b.addEventListener("click", () => {
                if (this._mode(dv.container) === key) return;
                dv.container.__journalHubMode = key;
                this.render(dv); // full re-render; generation stamp handles staleness
            });
        };
        mk("days", "Days");
        mk("all", "All");
    }

    async render(dv) {
        try {
            if (dv.container.closest(".markdown-embed")) return;

            const myGen = (dv.container.__journalRenderGen || 0) + 1;
            dv.container.__journalRenderGen = myGen;
            const isStale = () => dv.container.__journalRenderGen !== myGen;

            while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

            const mode = this._mode(dv.container);
            this._renderToggle(dv, mode);

            if (mode === "all") {
                await this._renderAll(dv, isStale);
            } else {
                await this._renderDays(dv, isStale);
            }
            if (isStale()) return;
        } catch (e) {
            try { dv.paragraph(`JournalHubCards error: ${e && e.message ? e.message : e}`); } catch (_e) {}
        }
    }

    async _renderDays(dv, isStale) {
        const body = dv.container.createEl("div");

        const entries = dv.pages('"spice/journal"').where(p => p.type === "journal-entry");
        const byDay = new Map();
        for (const s of entries) {
            const k = this._coerceDay(s.day);
            if (!k) continue;
            if (!byDay.has(k)) byDay.set(k, { day: k, count: 0, latestMtime: 0, sample: null });
            const e = byDay.get(k);
            e.count++;
            const mtime = (s.file.mtime && s.file.mtime.ts) || 0;
            if (mtime > e.latestMtime) { e.latestMtime = mtime; e.sample = s; }
        }

        const items = [...byDay.values()].map(e => {
            const m = window.moment(e.day, "YYYY-MM-DD", true);
            const dayName = m.isValid() ? m.format("dddd") : "Unknown";
            const monthFolder = m.isValid() ? m.format("YYYY/MM-MMMM") : "";
            const dayHubPath = `spice/journal/${monthFolder}/${e.day}/Journal-Day-${e.day}.md`;
            return {
                file: { name: `${dayName} ${e.day}`, path: dayHubPath, mtime: { ts: e.latestMtime } },
                _count: e.count,
                _day: e.day,
                _dayName: dayName
            };
        });

        if (isStale()) return;

        const pencil = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

        const proxyDv = {
            container: body,
            current: dv.current.bind(dv),
            pages: dv.pages.bind(dv)
        };

        await customJS.BeaconCards.render(proxyDv, {
            pages: items,
            layout: "row",
            title: (p) => `${p._dayName}, ${p._day}`,
            icon: () => pencil,
            meta: (p) => {
                const when = window.moment(p.file.mtime.ts).fromNow();
                return `<span>${p._count} entr${p._count === 1 ? "y" : "ies"}</span><span title="Latest">${when}</span>`;
            },
            target: (p) => p.file.path,
            sort: (a, b) => b._day.localeCompare(a._day),
            empty: "No journal entries yet. Hit the Journal nav-button to capture your first."
        });
    }

    async _renderAll(dv, isStale) {
        const bodyCache = new Map(); // path → body (per render pass)
        const readBody = async (p) => {
            if (bodyCache.has(p)) return bodyCache.get(p);
            let body = "";
            try {
                const file = app.vault.getAbstractFileByPath(p);
                if (file) body = await app.vault.cachedRead(file);
            } catch (_e) {}
            bodyCache.set(p, body);
            return body;
        };

        const renderResults = async (ctx) => {
            const gen = (dv.container.__journalAllGen || 0) + 1;
            dv.container.__journalAllGen = gen;
            const stale = () => dv.container.__journalAllGen !== gen || isStale();

            const pages = dv.pages('"spice/journal"').where((p) => p.type === "journal-entry");
            const needle = (ctx && ctx.text ? ctx.text : "").toLowerCase();

            const items = [];
            for (const s of pages) {
                const body = needle ? await readBody(s.file.path) : "";
                if (!this._matchesFilter(s, needle, body)) continue;
                let title = (s.title && String(s.title).trim())
                    || this._extractPreviewFromBody(needle ? body : await readBody(s.file.path))
                    || s.file.name;
                items.push({
                    file: s.file,
                    _title: title,
                    _day: this._coerceDay(s.day) || "",
                    _mtime: (s.file.mtime && s.file.mtime.ts) || 0
                });
            }
            if (stale()) return;

            if (ctx.resultsContainer.empty) ctx.resultsContainer.empty();
            else ctx.resultsContainer.innerHTML = "";

            const proxyDv = {
                container: ctx.resultsContainer,
                current: dv.current.bind(dv),
                pages: dv.pages.bind(dv)
            };

            await customJS.BeaconCards.render(proxyDv, {
                pages: items,
                layout: "row",
                title: (p) => p._title,
                meta: (p) => {
                    const when = p._mtime ? window.moment(p._mtime).fromNow() : "(unknown)";
                    return `<span>${p._day || ""}</span><span title="Last edited">edited ${when}</span>`;
                },
                target: (p) => p.file.path,
                sort: (a, b) => (b._mtime || 0) - (a._mtime || 0),
                empty: "No journal entries match."
            });
        };

        if (customJS && customJS.DocSearch && typeof customJS.DocSearch.render === "function") {
            const ctx = customJS.DocSearch.render(dv, {
                scopePath: "spice/journal",
                recursive: true,
                entityType: "journal-entry",
                persist: false,
                hideTags: true,
                placeholder: "Search journal entries (title + content)…",
                onChange: (c) => { renderResults(c); }
            });
            await renderResults(ctx);
        } else {
            // Degrade gracefully: no search strip, just the flat list.
            const resultsContainer = dv.container.createEl("div");
            await renderResults({ text: "", resultsContainer });
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add platform/blueprints/journal/helpers/journal-hub-cards.js
git commit -m "feat(journal): JournalHubCards helper (global hub Days|All tabs + search)"
```

---

## Task 5: Rebuild `JournalChromeBar`

**Files:**
- Modify: `platform/blueprints/journal/helpers/journal-chrome-bar.js` (full replace)
- Reference: `platform/blueprints/sticky-notes/helpers/sticky-chrome-bar.js`

- [ ] **Step 1: Replace the helper**

Full replacement of `platform/blueprints/journal/helpers/journal-chrome-bar.js` — mirror of
`StickyChromeBar` (including the title-banner behavior), `Sticky`→`Journal`,
`sticky-hub`/`sticky-day`/`sticky-note`→`journal-hub`/`journal-day`/`journal-entry`,
`spice/sticky-notes`→`spice/journal`, `sticky-title-banner`→`journal-title-banner`,
label "Sticky Notes"→"New Journal Entry" / "Journal Notes"→"Journal Hub" per the config below:

```javascript
/**
 * JournalChromeBar (CustomJS) — the journal blueprint's ChromeBar adapter
 * config. v0.4.0: rebuilt for the multi-entry day-hub shape (three surfaces:
 * journal-hub, journal-day, journal-entry), mirroring StickyChromeBar
 * including the leaf title-banner (click-to-rename).
 */
class JournalChromeBar {
  get ICON() {
    return {
      notebook: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12h5"/></svg>`,
      pencilPlus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`,
      today: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`,
      home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
      back: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      const out = customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
      this._maybeRenderBanner(dv);
      return out;
    } catch (_e) { /* never throw */ }
  }

  // On a leaf journal entry, render a clickable title banner below the chrome bar.
  _maybeRenderBanner(dv) {
    try {
      if (!dv || !dv.container) return;
      const page = customJS && customJS.RenderSafe ? customJS.RenderSafe.page(dv) : (dv.current ? dv.current() : null);
      if (!page || page.type !== "journal-entry") return;
      const filePath = page.file && page.file.path;
      if (!filePath) return;
      const file = (typeof app !== "undefined" && app.vault && typeof app.vault.getAbstractFileByPath === "function")
        ? app.vault.getAbstractFileByPath(filePath) : null;
      this._renderTitleBanner(dv.container, page, file);
    } catch (_e) { /* never throw */ }
  }

  _bannerText(page) {
    const t = page && page.title != null ? String(page.title).trim() : "";
    return t.length > 0 ? t : null;
  }

  _headingStyle(hasTitle) {
    return hasTitle
      ? "font-size: 1.35em; font-weight: 700; color: var(--text-normal); line-height: 1.3;"
      : "font-size: 1.1em; font-weight: 500; color: var(--text-muted); font-style: italic;";
  }

  _renderTitleBanner(container, page, file) {
    if (!container || typeof container.createEl !== "function") return;
    // Dedup across Dataview dual-fire re-renders.
    try {
      if (typeof container.querySelectorAll === "function") {
        (container.querySelectorAll(".journal-title-banner") || []).forEach((e) => { try { e.remove(); } catch (_e) {} });
      }
    } catch (_e) {}
    const banner = container.createEl("div", { cls: "journal-title-banner" });
    banner.style.cssText = "cursor: pointer; max-width: 640px; margin: 6px auto 10px; padding: 4px 2px;";
    const text = this._bannerText(page);
    const placeholder = "Untitled journal entry — click to name";
    const h = banner.createEl("div", { text: text || placeholder });
    h.style.cssText = this._headingStyle(!!text);
    banner.title = "Click to rename";
    banner.addEventListener("click", () => this._openRenameDialog(file, text || "", (newTitle) => {
      const nt = newTitle && String(newTitle).trim();
      h.textContent = nt || placeholder;
      h.style.cssText = this._headingStyle(!!nt);
    }));
  }

  _openRenameDialog(file, current, onDone) {
    try {
      if (!file || typeof app === "undefined" || !app.fileManager
        || typeof app.fileManager.processFrontMatter !== "function") return;
      if (typeof document === "undefined" || !document.body || typeof document.body.createEl !== "function") return;
      const overlay = document.body.createEl("div");
      overlay.style.cssText = "position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center;";
      const box = overlay.createEl("div");
      box.style.cssText = "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; width: min(420px, 90vw); display: flex; flex-direction: column; gap: 10px;";
      box.createEl("div", { text: "Journal entry title" }).style.cssText = "font-weight: 600;";
      const input = box.createEl("input", { type: "text", value: current || "" });
      input.style.cssText = "padding: 6px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
      const row = box.createEl("div");
      row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
      const close = () => { try { overlay.remove(); } catch (_e) {} };
      const save = async () => {
        const v = (input.value || "").trim();
        try { await app.fileManager.processFrontMatter(file, (fm) => { fm.title = v; }); } catch (_e) {}
        close();
        try { if (typeof onDone === "function") onDone(v); } catch (_e) {}
      };
      const cancelBtn = row.createEl("button", { text: "Cancel" });
      cancelBtn.addEventListener("click", close);
      const saveBtn = row.createEl("button", { text: "Save" });
      saveBtn.style.cssText = "background: var(--interactive-accent); color: var(--text-on-accent); border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer;";
      saveBtn.addEventListener("click", () => { save(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); save(); }
        else if (e.key === "Escape") { e.preventDefault(); close(); }
      });
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      setTimeout(() => { try { input.focus(); } catch (_e) {} }, 0);
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "journal-hub") return { context: "journal-hub", path: (page.file && page.file.path) || "" };
        if (t === "journal-day") return { context: "journal-day", path: (page.file && page.file.path) || "", day: page.day };
        if (t === "journal-entry") return { context: "journal-entry", path: (page.file && page.file.path) || "", day: page.day };
        return null;
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "journal-hub") {
          return { primary: { id: "today", label: "Today", icon: ICON.today }, overflow: [], leaf: false };
        }
        if (ctx.context === "journal-day") {
          return {
            primary: { id: "new-journal-entry", label: "+ New Journal Entry", icon: ICON.pencilPlus },
            overflow: [{ id: "hub", label: "Hub", icon: ICON.home }],
            leaf: false,
          };
        }
        if (ctx.context === "journal-entry") {
          return {
            primary: null,
            overflow: [
              { id: "back-day", label: "Back to Day", icon: ICON.back },
              { id: "hub", label: "Hub", icon: ICON.home },
            ],
            leaf: true,
          };
        }
        return { primary: null, overflow: [], leaf: false };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "today") {
          this._openToday(dv);
          return;
        }
        if (id === "new-journal-entry") {
          if (customJS && customJS.EntityCreate && typeof customJS.EntityCreate.create === "function") {
            customJS.EntityCreate.create({ instance: "journal-entry", dv });
          } else if (typeof Notice === "function") { new Notice("JournalChromeBar: EntityCreate unavailable.", 8000); }
          return;
        }
        if (id === "hub") {
          try { app.workspace.openLinkText("spice/journal/Journal.md", ""); } catch (_e) {}
          return;
        }
        if (id === "back-day") {
          const day = this._resolveDay(dv, ctx);
          if (!day) return;
          const mo = window.moment(day, "YYYY-MM-DD", true);
          if (!mo.isValid()) return;
          const folder = mo.format("YYYY/MM-MMMM");
          const dayHubPath = `spice/journal/${folder}/${day}/Journal-Day-${day}.md`;
          try { app.workspace.openLinkText(dayHubPath, ""); } catch (_e) {}
          return;
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This journal entry" }];
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const hubPath = "spice/journal/Journal.md";
        if (curPath !== hubPath) {
          out.push({ label: "Journal Hub", icon: ICON.home, _navTarget: hubPath, onSelect: () => open(hubPath) });
        }
        if (ctx.context !== "journal-hub") {
          const day = this._resolveDay(dv, ctx);
          if (day) {
            const mo = window.moment(day, "YYYY-MM-DD", true);
            if (mo.isValid()) {
              const folder = mo.format("YYYY/MM-MMMM");
              const dayHubPath = `spice/journal/${folder}/${day}/Journal-Day-${day}.md`;
              if (curPath !== dayHubPath) {
                out.push({ label: "Day Hub", icon: ICON.today, _navTarget: dayHubPath, onSelect: () => open(dayHubPath) });
              }
            }
          }
        }
        return out;
      },
      rootClass: "journal-chrome-root",
      btnClass: (v) => `journal-chrome-btn journal-chrome-btn-${v}`,
    };
  }

  _resolveDay(dv, ctx) {
    if (ctx && ctx.day) {
      const d = this._coerceDay(ctx.day);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    }
    try {
      const page = customJS.RenderSafe.page(dv);
      const d = this._coerceDay(page && page.day);
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    } catch (_e) {}
    return null;
  }

  _coerceDay(raw) {
    if (typeof raw === "string") return raw.slice(0, 10);
    if (raw && typeof raw.toISODate === "function") return raw.toISODate();
    if (raw instanceof Date && !isNaN(raw)) {
      const y = raw.getFullYear();
      const m = String(raw.getMonth() + 1).padStart(2, "0");
      const d = String(raw.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  async _openToday(dv) {
    const day = window.moment().format("YYYY-MM-DD");
    const mo = window.moment(day, "YYYY-MM-DD", true);
    const monthFolder = mo.format("YYYY/MM-MMMM");
    const folder = `spice/journal/${monthFolder}/${day}`;
    const dayHubPath = `${folder}/Journal-Day-${day}.md`;
    const existing = app.vault.getAbstractFileByPath(dayHubPath);
    if (existing) { app.workspace.openLinkText(dayHubPath, ""); return; }
    const tpPlugin = app.plugins.plugins["templater-obsidian"];
    if (!tpPlugin || !tpPlugin.templater) {
      if (typeof Notice === "function") new Notice("JournalChromeBar: Templater plugin not enabled.", 8000);
      return;
    }
    const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Journal Day Hub.md");
    if (!templateFile) {
      if (typeof Notice === "function") new Notice("JournalChromeBar: template not found.", 8000);
      return;
    }
    if (!app.vault.getAbstractFileByPath(folder)) {
      try { await app.vault.createFolder(folder); }
      catch (e) { if (!/already exists|exists/i.test((e && e.message) || "")) { if (typeof Notice === "function") new Notice("JournalChromeBar: cannot create folder — " + (e.message || e), 8000); return; } }
    }
    try { await tpPlugin.templater.create_new_note_from_template(templateFile, folder, `Journal-Day-${day}`, true); }
    catch (e) {
      if (/already exists|exists/i.test((e && e.message) || "")) { app.workspace.openLinkText(dayHubPath, ""); return; }
      if (typeof Notice === "function") new Notice("JournalChromeBar: Templater create failed — " + (e.message || e), 8000);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add platform/blueprints/journal/helpers/journal-chrome-bar.js
git commit -m "feat(journal): rebuild JournalChromeBar for 3-surface day-hub shape + leaf title banner"
```

---

## Task 6: Install-time migration (`applyJournalMultiEntryMigration`)

**Files:**
- Modify: `platform/install.js`
- Reference: `platform/install.js:2216` (`applyScratchToStickyNotesMigration`, the structural-move precedent — read it first) and `platform/install.js:10343` (`applyProjectLinksHubBackfill`, the simpler per-file existence-gated precedent)

- [ ] **Step 1: Add the migration function**

Insert this new function immediately BEFORE `applyScratchToStickyNotesMigration` (i.e. right
after the comment block starting `// applyScratchToStickyNotesMigration` at line 2156 — insert
above that comment, so the new function reads first):

```javascript
// applyJournalMultiEntryMigration — v0.212.0 journal multi-entry. Converts
// pre-multi-entry journal vaults (flat spice/journal/**/Journal-YYYY-MM-DD.md,
// type: journal) into the day-folder + day-hub + leaf-entry shape mirroring
// sticky-notes. Per-file gated — NOT a whole-tree rename like
// applyScratchToStickyNotesMigration, because the module_directory root name
// (spice/journal) is unchanged, so no cross-vault link rewrite or old-artifact
// pruning is needed. The old flat note already lives inside its correct
// YYYY/MM-MMMM/ folder (per journal's pre-v0.4.0 folder_date_pattern), so the
// new day-folder is just that same parent dir + "/<day>" — no date-library
// month-name computation required. Runs per-item, gated on
// manifest.name === "journal". Idempotent: once a flat note is converted, its
// path no longer matches the flat-filename regex, so re-running finds
// nothing to do. Backup-before-write, never-throw.
async function applyJournalMultiEntryMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "journal") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/journal";
  if (!(await adapter.exists(root))) return;

  const viewsPath = (variables && variables.views_path) || "ranch/views";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBase = `.sauce-backup/journal-multi-entry/${ts}`;
  const pushEvent = (event, reason) => {
    if (!history) return;
    history.push({
      event, step: "journal_multi_entry_migration", name: "journal", reason,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  };

  const mkdirp = async (dir) => {
    const segs = dir.split("/");
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!(await adapter.exists(acc))) { try { await adapter.mkdir(acc); } catch (_e) { /* implied */ } }
    }
  };
  const backupFile = async (p, body) => {
    try {
      const dest = `${backupBase}/${p}`;
      await mkdirp(dest.substring(0, dest.lastIndexOf("/")));
      await adapter.write(dest, body);
    } catch (_e) { /* best-effort backup */ }
  };

  let migratedCount = 0;
  let errors = 0;
  let allMd;
  try { allMd = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) { pushEvent("warning", `listing failed: ${e && e.message ? e.message : String(e)}`); return; }

  for (const fpath of allMd) {
    const base = fpath.split("/").pop();
    const m = base.match(/^Journal-(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue; // Journal-Day-*, already-migrated leaves, and Journal.md itself don't match
    const day = m[1];
    let body;
    try { body = await adapter.read(fpath); } catch (_e) { errors++; continue; }
    if (!/^type:\s*["']?journal["']?\s*$/m.test(body)) continue; // safety: only migrate journal-typed flat notes

    const parentDir = fpath.substring(0, fpath.lastIndexOf("/")); // e.g. spice/journal/2026/07-July
    const dayDir = `${parentDir}/${day}`;
    const dayHubPath = `${dayDir}/Journal-Day-${day}.md`;
    const leafPath = `${dayDir}/Journal-${day}-00-00-00.md`;
    if (await adapter.exists(leafPath)) continue; // already migrated

    try {
      await backupFile(fpath, body);
      await mkdirp(dayDir);

      const createdAtMatch = body.match(/^created_at:\s*["']?([^"'\n]+)["']?\s*$/m);
      const createdAt = createdAtMatch ? createdAtMatch[1] : `${day}T00:00:00Z`;
      const bodyAfterFrontmatter = body.split(/^---\s*$/m).slice(2).join("---");

      const dayHubBody = `---\ntype: journal-day\ncreated_at: "${new Date().toISOString()}"\nday: "${day}"\n---\n\n\`\`\`dataviewjs\nawait dv.view("${viewsPath}/customjs-guard", { class: "JournalChromeBar" });\n\`\`\`\n\n\`\`\`dataviewjs\nawait dv.view("${viewsPath}/customjs-guard", { class: "JournalDayList", args: [{ day: dv.current()?.day }] });\n\`\`\`\n`;
      const leafBody = `---\ntype: journal-entry\ncreated_at: "${createdAt}"\nday: "${day}"\ntime: "00:00"\nday_link: "[[Journal-Day-${day}]]"\n---\n\n\`\`\`dataviewjs\nawait dv.view("${viewsPath}/customjs-guard", { class: "JournalChromeBar" });\n\`\`\`\n${bodyAfterFrontmatter}`;

      if (!(await adapter.exists(dayHubPath))) await adapter.write(dayHubPath, dayHubBody);
      await adapter.write(leafPath, leafBody);
      await adapter.remove(fpath);
      migratedCount++;
    } catch (e) {
      errors++;
      pushEvent("warning", `migrate ${fpath} failed: ${e && e.message ? e.message : String(e)}`);
    }
  }

  if (migratedCount > 0 || errors > 0) {
    pushEvent("info", `journal_multi_entry_migration: migrated=${migratedCount} errors=${errors}`);
  }
}
```

- [ ] **Step 2: Wire the call site**

In the per-item pipeline (the block containing the line
`await applyScratchToStickyNotesMigration(tp, mech, variables, history, git);` — currently at
`platform/install.js:1244`), add a new line immediately above it:

```javascript
  await applyJournalMultiEntryMigration(tp, mech, variables, history, git); // NEW v0.212.0 journal multi-entry — per-item phase (gated manifest.name==="journal"), converts flat Journal-YYYY-MM-DD.md into day-folder+day-hub+leaf shape
  await applyScratchToStickyNotesMigration(tp, mech, variables, history, git); // NEW v0.9.0 sticky-notes rename — per-item phase (gated manifest.name==="sticky-notes"), before per-vault applyNoteChromeHeal
```

- [ ] **Step 3: Export for tests**

Near the existing `module.exports.applyScratchToStickyNotesMigration = applyScratchToStickyNotesMigration;`
line (search for it — around line 20872), add:

```javascript
module.exports.applyJournalMultiEntryMigration = applyJournalMultiEntryMigration;
```

- [ ] **Step 4: Syntax-check**

Run: `node -e "require('./platform/install.js'); console.log('loads ok')"`
Expected: `loads ok`

- [ ] **Step 5: Commit**

```bash
git add platform/install.js
git commit -m "feat(journal): install-time migration converts flat Journal-YYYY-MM-DD.md to day-folder shape"
```

---

## Task 7: `/journal` command + `new-journal-entry` skill

**Files:**
- Create: `platform/blueprints/journal/commands/journal.md`
- Create: `platform/blueprints/journal/skills/new-journal-entry/SKILL.md`
- Reference: `platform/blueprints/sticky-notes/commands/sticky-notes.md`, `platform/blueprints/sticky-notes/skills/new-sticky-note/SKILL.md`

- [ ] **Step 1: Write the command doc**

`platform/blueprints/journal/commands/journal.md`:

```markdown
---
description: Navigate the journal blueprint — open today's day-hub, create a new journal entry, or browse historical days
allowed-tools: Read, Glob, Bash, Edit, Write
---

<!-- @claude-surface:version 0.4.0 -->

# /journal — journal blueprint navigator

Drives the v0.4.x journal blueprint installed at `spice/journal/`. Use this when you want to:

- Open or create today's **day-hub** (per-day surface that lists today's journal entries + offers a "+ New Journal Entry" button)
- Create a new journal entry (overlay dialog prompts for an optional title, file lands in today's folder)
- Open the global hub (one-click "Today" + day cards across history, Days | All search)
- Find a past journal entry by day or by capture time

## Vault layout

```
spice/journal/
├── Journal.md                                       Global hub
└── YYYY/MM-MMMM/YYYY-MM-DD/
    ├── Journal-Day-YYYY-MM-DD.md                    Day-hub
    └── Journal-YYYY-MM-DD-HH-mm-ss.md               Leaf journal entries (time-suffixed to the second)
```

The nav-button's `runTemplaterTemplate` action computes:
- `folder_prefix: {{module_directory}}` (`spice/journal` post-substitution)
- `folder_date_pattern: YYYY/MM-MMMM/YYYY-MM-DD`
- `filename_prefix: Journal-Day-`
- `filename_date_pattern: YYYY-MM-DD`

The renderer in `space-nav-buttons.js` opens the existing file or creates it from the
`Journal Day Hub.md` template via `Templater.create_new_note_from_template`.

## Common operations

| Goal | Path |
|---|---|
| Open / create today's day-hub | Click **Journal** nav-button (top strip of every note) |
| New leaf journal entry | Click **+ New Journal Entry** on the day-hub → overlay prompts for optional title |
| Browse historical days | Open `spice/journal/Journal.md` → click a day card |
| Programmatic entry creation | Invoke `new-journal-entry` skill |
| Find a past entry | `ls spice/journal/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Journal-*.md` |

## Page surfaces

Every surface renders a single `JournalChromeBar` dataviewjs block — the shared ChromeBar
mechanism owns the breadcrumb, Go-to launcher, primary action, and the ⋯ overflow menu.

### Day-hub (`Journal-Day-YYYY-MM-DD.md`)

```
[JournalChromeBar]         ← breadcrumb + Go ▾ + [+ New Journal Entry] primary + ⋯ (Hub)
[Journal entry list]       ← JournalDayList, title + "edited X ago", sorted mtime DESC
```

- **+ New Journal Entry** dispatches `EntityCreate.create({ instance: "journal-entry" })` — the overlay dialog prompts for an optional title, then creates the leaf with the title baked into frontmatter.
- **Hub** (in ⋯) navigates to the global hub.

### Leaf journal entry (`Journal-YYYY-MM-DD-HH-mm-ss.md`)

```
[JournalChromeBar]         ← breadcrumb + Go ▾ + ⋯ (Back to Day, Hub)
<click-to-rename title banner>
<your journal entry content>
```

Frontmatter:
```yaml
type: journal-entry
created_at: "<ISO>"
day: "<YYYY-MM-DD>"
time: "<HH:mm>"
title: "<from overlay>"
day_link: "[[Journal-Day-<YYYY-MM-DD>]]"
```

Note: `day` and `time` are quoted strings — Obsidian's YAML parser auto-coerces unquoted
`YYYY-MM-DD` to Date objects which breaks string-equality filters.

### Global hub (`spice/journal/Journal.md`)

```
[JournalChromeBar]         ← breadcrumb + Go ▾ + [Today] primary
[Days | All toggle]
[Day cards or search results]
```

## CustomJS classes

| Class | File | Surface | Role |
|---|---|---|---|
| `JournalChromeBar` | `helpers/journal-chrome-bar.js` | all three | ChromeBar adapter: detect context from `page.type`, primary + overflow actions, Go-to destinations, leaf title banner |
| `JournalDayList` | `helpers/journal-day-list.js` | day-hub | Lists day's journal entries; title (or preview fallback) + edited-ago; sort by mtime DESC |
| `JournalHubCards` | `helpers/journal-hub-cards.js` | global hub | Days \| All toggle; Days = one card per day; All = flat searchable list via doc-search |

Helpers implement a `_coerceDay(raw)` shim to normalize `string | Date | Luxon` → `YYYY-MM-DD`,
empty `dv.container` at the start of `render()`, and stamp `__journalRenderGen` to bail out of
stale renders.

## Migration

Pre-v0.4.0 vaults have flat `spice/journal/YYYY/MM-MMMM/Journal-YYYY-MM-DD.md` notes
(`type: journal`). On next install, `applyJournalMultiEntryMigration` (in `platform/install.js`,
gated on `manifest.name === "journal"`) converts each into the day-folder shape: creates
`Journal-Day-YYYY-MM-DD.md` in a new `YYYY-MM-DD/` subfolder and moves the old note's body into
`Journal-YYYY-MM-DD-00-00-00.md` as that day's first entry. Backed up under
`.sauce-backup/journal-multi-entry/<timestamp>/` before any write.

## Rule fragments

Two fragments (disjoint by `path_glob`):

- **journal-entry** (`spice/journal/**/Journal-2*.md`): `type: journal-entry`, filename
  `^Journal-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.md$`.
- **journal-day-hub** (`spice/journal/**/Journal-Day-*.md`): `type: journal-day`, filename
  `^Journal-Day-\d{4}-\d{2}-\d{2}\.md$`.

## Refresh or audit

```bash
sauce audit                   # validates rule_fragments
sauce update                  # re-runs installer with current subscription pins
```

## See also

- `.claude/skills/journal/new-journal-entry/SKILL.md` — programmatic new-journal-entry skill
- Landmine #11 (module-directory invariant) — journal owns ONLY `spice/journal/`
```

- [ ] **Step 2: Write the skill doc**

`platform/blueprints/journal/skills/new-journal-entry/SKILL.md`:

```markdown
---
name: new-journal-entry
description: Create a new journal entry leaf at spice/journal/YYYY/MM-MMMM/YYYY-MM-DD/Journal-YYYY-MM-DD-HH-mm-ss.md (with optional title in frontmatter); programmatic alternative to clicking + New Journal Entry in the day-hub.
---

<!-- @claude-surface:version 0.4.0 -->

# new-journal-entry

Programmatic journal-entry leaf creation. The user-facing path is the **+ New Journal Entry**
button rendered by `JournalChromeBar` on each day-hub (which opens an overlay dialog for the
title via entity-create). This skill is for orchestrators that need to create journal entries
without invoking the Obsidian UI.

## Inputs

- `title` (optional, string) — short description of the entry; lands in `title:` frontmatter and is what `JournalDayList` displays as the card title (falls back to the entry body's first line, then the filename, if omitted)
- `body` (optional, string) — initial content (no frontmatter; just the entry text); appended below the chrome block
- `date` (optional, string) — `YYYY-MM-DD`; defaults to today in vault local timezone
- `time` (optional, string) — `HH:mm:ss` (24h); defaults to now

## Steps

1. Compute `monthFolder` from `date` (e.g., `2026-05-13` → `2026/05-May`).
2. Compose target folder: `spice/journal/<monthFolder>/<date>/`. Create if missing.
3. Compose target path: `spice/journal/<monthFolder>/<date>/Journal-<date>-<HH-mm-ss>.md` (where `HH-mm-ss` substitutes `:` → `-`).
4. **Do NOT need to pre-create the day-hub** — the user's nav-button click handles that. If the day-hub at `spice/journal/<monthFolder>/<date>/Journal-Day-<date>.md` is absent, leave it absent; clicking the Journal nav-button later will create it.
5. Build the leaf body directly (do NOT call Templater — the leaf creation path bypasses Templater so the title can be baked into frontmatter atomically):

```md
---
type: journal-entry
created_at: "<ISO timestamp at <date>T<time>>"
day: "<date>"
time: "<HH:mm of time>"
title: "<title, with embedded " escaped as \\">"
day_link: "[[Journal-Day-<date>]]"
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "JournalChromeBar" });
```

<body if supplied; otherwise leave blank>
```

   `day` and `time` MUST be quoted strings — Obsidian's YAML parser auto-coerces unquoted
   `YYYY-MM-DD` to Date objects which breaks `dv.current().day === "<string>"` filters in helpers.

6. Write the file via direct vault write. Abort with audit-receipt if the path already exists (do NOT overwrite).
7. Return the absolute path + `created: true`.

## Outputs

- `path` (absolute string) — the leaf journal-entry location
- `created` (boolean) — `true` if the skill wrote the file this run

## Audit-receipt

Emit a one-line summary on success:

```
new-journal-entry: created spice/journal/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Journal-<YYYY-MM-DD>-<HH-mm-ss>.md (title="<title>")
```

## Failure modes

- **Collision** — abort with `new-journal-entry: <path> already exists; aborting`. Do NOT overwrite.
- **Parent dir creation denied** — abort with the underlying error; do not retry silently.

## See also

- Workshop sources under `platform/blueprints/journal/manifest.json` — `nav_buttons[]` + `templater_folder_templates[]` + `rule_fragments[]` are source of truth
- `.claude/commands/journal.md` — user-facing slash command
- Landmine #11 (module-directory invariant) — journal owns ONLY `spice/journal/`
```

- [ ] **Step 3: Commit**

```bash
git add platform/blueprints/journal/commands/journal.md platform/blueprints/journal/skills/new-journal-entry/SKILL.md
git commit -m "feat(journal): /journal command + new-journal-entry skill"
```

---

## Task 8: Update the existing chrome-bar test, add the multi-entry test suite

**Files:**
- Modify: `platform/test/run-journal-chrome-bar.js` (full replace)
- Create: `platform/test/run-journal-multi-entry.js`
- Modify: `package.json` (`release:preflight` script — add the new test)
- Reference: `platform/test/run-sticky-notes-chrome-bar.js`, `platform/test/run-sticky-notes.js`, `platform/test/run-sticky-notes-migrate.js`

- [ ] **Step 1: Read the reference tests**

Read `platform/test/run-sticky-notes-chrome-bar.js` and `platform/test/run-sticky-notes.js` in
full before writing — they're the structural templates for steps 2 and 3.

- [ ] **Step 2: Rewrite the chrome-bar test for 3-surface dispatch**

Replace `platform/test/run-journal-chrome-bar.js` entirely:

```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const JournalChromeBar = loadClass('platform/blueprints/journal/helpers/journal-chrome-bar.js', 'JournalChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new JournalChromeBar();
const cfg = inst._config();

// JCB-DETECT — three surfaces + non-journal off-switch.
{
  const hub = cfg.detect({}, { file: { path: 'spice/journal/Journal.md' }, type: 'journal-hub' });
  const day = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/2026-01-14/Journal-Day-2026-01-14.md' }, type: 'journal-day', day: '2026-01-14' });
  const entry = cfg.detect({}, { file: { path: 'spice/journal/2026/01-January/2026-01-14/Journal-2026-01-14-09-30-00.md' }, type: 'journal-entry', day: '2026-01-14' });
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('JCB-DETECT-1 journal-hub classifies', hub && hub.context === 'journal-hub');
  ok('JCB-DETECT-2 journal-day classifies + carries day', day && day.context === 'journal-day' && day.day === '2026-01-14');
  ok('JCB-DETECT-3 journal-entry classifies + carries day', entry && entry.context === 'journal-entry' && entry.day === '2026-01-14');
  ok('JCB-DETECT-4 non-journal type → null', off === null);
}
// JCB-SPEC — per-surface primary/overflow/leaf shape.
{
  const hub = cfg.surfaceSpec({ context: 'journal-hub' });
  ok('JCB-SPEC-1 journal-hub: primary=Today, leaf=false', hub.primary && hub.primary.id === 'today' && hub.leaf === false);
  const day = cfg.surfaceSpec({ context: 'journal-day' });
  ok('JCB-SPEC-2 journal-day: primary=new-journal-entry, overflow has hub, leaf=false',
    day.primary && day.primary.id === 'new-journal-entry' && day.overflow.some(o => o.id === 'hub') && day.leaf === false);
  const entry = cfg.surfaceSpec({ context: 'journal-entry' });
  ok('JCB-SPEC-3 journal-entry: primary=null, overflow has back-day+hub, leaf=true',
    entry.primary === null && entry.overflow.some(o => o.id === 'back-day') && entry.overflow.some(o => o.id === 'hub') && entry.leaf === true);
}
// JCB-DISPATCH — never throws for any known id or an unknown one.
{
  let threw = false;
  try {
    cfg.dispatch({}, { context: 'journal-day' }, 'unknown-id');
  } catch (_e) { threw = true; }
  ok('JCB-DISPATCH-1 unknown id never throws', threw === false);
}
// JCB-DEST — leads with "This journal entry" marker; includes hub when not already there.
{
  const dest = cfg.destinations({}, { context: 'journal-entry', path: 'spice/journal/2026/01-January/2026-01-14/Journal-2026-01-14-09-30-00.md', day: '2026-01-14' });
  ok('JCB-DEST-1 destinations lead with This journal entry marker', dest[0] && dest[0].section === 'This journal entry');
  ok('JCB-DEST-2 destinations include Journal Hub', dest.some(d => d.label === 'Journal Hub'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
```

- [ ] **Step 3: Run it standalone to confirm it passes against the new helper**

Run: `node platform/test/run-journal-chrome-bar.js`
Expected: `8/8 passed`, exit 0. (This step must run AFTER Task 5 has landed
`journal-chrome-bar.js` — if run before, every `JCB-DETECT`/`JCB-SPEC` assertion fails because
the old stub always returns `{primary: null, leaf: true}`.)

- [ ] **Step 4: Write the multi-entry test suite**

Create `platform/test/run-journal-multi-entry.js`:

```javascript
#!/usr/bin/env node
'use strict';
// run-journal-multi-entry.js — behavioral coverage for the journal
// multi-entry cycle: JournalDayList (day-hub card list), JournalHubCards
// (global hub Days-mode day aggregation), and applyJournalMultiEntryMigration
// (install-time flat→day-folder migration, via install.js's exported fn +
// an in-memory VaultAdapter stub mirroring run-sticky-notes-rename-migration.js).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { passed++; console.log(`  PASS — ${label}`); }
  else { failed++; console.log(`  FAIL — ${label}`); }
}

// ---------------------------------------------------------------------
// JHC — JournalHubCards._coerceDay / _matchesFilter (pure methods, no DOM)
// ---------------------------------------------------------------------
{
  const JournalHubCards = loadClass('platform/blueprints/journal/helpers/journal-hub-cards.js', 'JournalHubCards');
  const inst = new JournalHubCards();
  ok('JHC-COERCE-1 string day sliced to 10 chars', inst._coerceDay('2026-07-11T00:00:00Z') === '2026-07-11');
  ok('JHC-COERCE-2 Luxon-like (.toISODate) day', inst._coerceDay({ toISODate: () => '2026-07-11' }) === '2026-07-11');
  ok('JHC-COERCE-3 unrecognized shape → null', inst._coerceDay(42) === null);
  ok('JHC-MATCH-1 empty needle matches everything', inst._matchesFilter({ title: 'x' }, '', '') === true);
  ok('JHC-MATCH-2 needle matches title', inst._matchesFilter({ title: 'Morning pages' }, 'morning', '') === true);
  ok('JHC-MATCH-3 needle matches body only (title miss)', inst._matchesFilter({ title: 'Untitled' }, 'gratitude', 'feeling gratitude today') === true);
  ok('JHC-MATCH-4 needle matches nothing', inst._matchesFilter({ title: 'Untitled' }, 'zzz', 'no match here') === false);
  ok('JHC-PREVIEW-1 skips frontmatter + fenced code + wikilinks, takes first prose line',
    inst._extractPreviewFromBody('---\ntype: journal-entry\n---\n\n```js\ncode\n```\n[[Journal-Day-2026-07-11]]\nActual first line of prose.\n') === 'Actual first line of prose.');
}

// ---------------------------------------------------------------------
// JDL — JournalDayList._coerceDay / _extractPreviewFromBody (pure methods)
// ---------------------------------------------------------------------
{
  const JournalDayList = loadClass('platform/blueprints/journal/helpers/journal-day-list.js', 'JournalDayList');
  const inst = new JournalDayList();
  ok('JDL-COERCE-1 string day sliced to 10 chars', inst._coerceDay('2026-07-11T00:00:00Z') === '2026-07-11');
  ok('JDL-COERCE-2 bare Date → null (timezone-safety guard)', inst._coerceDay(new Date('2026-07-11')) === null);
  ok('JDL-PREVIEW-1 first prose line after frontmatter', inst._extractPreviewFromBody('---\ntype: journal-entry\n---\n\nHello world.\n') === 'Hello world.');
}

// ---------------------------------------------------------------------
// AJME — applyJournalMultiEntryMigration, in-memory VaultAdapter stub
// ---------------------------------------------------------------------
{
  const installModule = require(path.join(ROOT, 'platform/install.js'));
  const applyJournalMultiEntryMigration = installModule.applyJournalMultiEntryMigration;
  ok('AJME-EXPORT-1 exported from install.js', typeof applyJournalMultiEntryMigration === 'function');

  function makeAdapter(initialFs) {
    const store = new Map(Object.entries(initialFs || {}));
    return {
      _store: store,
      async exists(p) { return store.has(p) || [...store.keys()].some(k => k.startsWith(p + '/')); },
      async list(p) {
        const files = []; const folders = new Set();
        const prefix = p === '' ? '' : p + '/';
        for (const k of store.keys()) {
          if (prefix !== '' && !k.startsWith(prefix)) continue;
          const rest = k.substring(prefix.length);
          const slashIdx = rest.indexOf('/');
          if (slashIdx === -1) files.push(k);
          else folders.add(`${prefix}${rest.substring(0, slashIdx)}`);
        }
        return { folders: [...folders], files };
      },
      async read(p) { if (!store.has(p)) throw new Error(`no such file ${p}`); return store.get(p); },
      async write(p, body) { store.set(p, body); },
      async remove(p) { store.delete(p); },
      async mkdir(_p) { /* no-op: directories are implicit in this flat store */ },
    };
  }

  async function run() {
    // AJME-1: a single flat journal note migrates to day-folder shape.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/Journal-2026-07-11.md':
          '---\ntype: journal\ncreated_at: "2026-07-11T08:00:00Z"\nday_link: "[[Wednesday-2026-07-11]]"\n---\n\nSome entry content.\n',
      });
      const tp = { app: { vault: { adapter } } };
      const history = [];
      const git = { commit: 'abc', tag: null, dirty: false };
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, { views_path: 'ranch/views' }, history, git);

      const dayHub = adapter._store.get('spice/journal/2026/07-July/2026-07-11/Journal-Day-2026-07-11.md');
      const leaf = adapter._store.get('spice/journal/2026/07-July/2026-07-11/Journal-2026-07-11-00-00-00.md');
      const oldGone = !adapter._store.has('spice/journal/2026/07-July/Journal-2026-07-11.md');

      ok('AJME-1a day-hub created', !!dayHub && /type: journal-day/.test(dayHub));
      ok('AJME-1b leaf created with original body preserved', !!leaf && leaf.includes('Some entry content.'));
      ok('AJME-1c leaf preserves original created_at', !!leaf && leaf.includes('created_at: "2026-07-11T08:00:00Z"'));
      ok('AJME-1d leaf carries day + journal-entry type', !!leaf && /type: journal-entry/.test(leaf) && /day: "2026-07-11"/.test(leaf));
      ok('AJME-1e old flat note removed after successful migration', oldGone);
    }

    // AJME-2: idempotent — running twice on an already-migrated vault is a no-op.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/Journal-2026-07-11.md':
          '---\ntype: journal\ncreated_at: "2026-07-11T08:00:00Z"\n---\n\nBody.\n',
      });
      const tp = { app: { vault: { adapter } } };
      const history = [];
      const git = { commit: 'abc', tag: null, dirty: false };
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, { views_path: 'ranch/views' }, history, git);
      const afterFirst = adapter._store.size;
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, { views_path: 'ranch/views' }, history, git);
      const afterSecond = adapter._store.size;
      ok('AJME-2 second run is a no-op (store size unchanged)', afterFirst === afterSecond);
    }

    // AJME-3: gated on manifest.name — a non-journal manifest is a no-op.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/Journal-2026-07-11.md': '---\ntype: journal\n---\n\nBody.\n',
      });
      const tp = { app: { vault: { adapter } } };
      await applyJournalMultiEntryMigration(tp, { name: 'sticky-notes' }, {}, [], { commit: 'x' });
      ok('AJME-3 non-journal manifest.name → untouched store', adapter._store.has('spice/journal/2026/07-July/Journal-2026-07-11.md'));
    }

    // AJME-4: already-day-folder-shaped entries (type: journal-entry) are left alone.
    {
      const adapter = makeAdapter({
        'spice/journal/2026/07-July/2026-07-10/Journal-Day-2026-07-10.md': '---\ntype: journal-day\nday: "2026-07-10"\n---\n',
        'spice/journal/2026/07-July/2026-07-10/Journal-2026-07-10-14-00-00.md': '---\ntype: journal-entry\nday: "2026-07-10"\n---\n\nAlready migrated.\n',
      });
      const tp = { app: { vault: { adapter } } };
      await applyJournalMultiEntryMigration(tp, { name: 'journal' }, {}, [], { commit: 'x' });
      ok('AJME-4 already-migrated entries untouched', adapter._store.get('spice/journal/2026/07-July/2026-07-10/Journal-2026-07-10-14-00-00.md').includes('Already migrated.'));
    }

    console.log(`\n${passed}/${passed + failed} passed`);
    process.exit(failed === 0 ? 0 : 1);
  }

  run();
}
```

- [ ] **Step 5: Run the new suite standalone**

Run: `node platform/test/run-journal-multi-entry.js`
Expected: all assertions PASS, final line `N/N passed`, exit 0.

If `AJME-*` fails, debug against `applyJournalMultiEntryMigration` from Task 6 — common
mistakes: forgetting the `type: journal` guard (would also migrate already-converted
`journal-day`/`journal-entry` notes if the flat-filename regex is too loose), or writing the
day-hub even when it already exists (should be `if (!(await adapter.exists(dayHubPath)))`
guarded, per the code in Task 6 Step 1).

- [ ] **Step 6: Wire into `release:preflight`**

Edit `package.json`. In the `release:preflight` script string, find the segment
`&& node platform/test/run-journal-chrome-bar.js &&` and change it to:

```
&& node platform/test/run-journal-chrome-bar.js && node platform/test/run-journal-multi-entry.js &&
```

(Insert the new test immediately after the existing journal chrome-bar test in the chain — do
not reorder any other entry.)

- [ ] **Step 7: Commit**

```bash
git add platform/test/run-journal-chrome-bar.js platform/test/run-journal-multi-entry.js package.json
git commit -m "test(journal): 3-surface chrome-bar coverage + day-list/hub-cards/migration behavioral suite"
```

---

## Task 9: Full preflight + workshop self-install

**Files:** none (verification only)

- [ ] **Step 1: Run full preflight**

Run: `npm run release:preflight`
Expected: every harness PASS, script exits 0. If anything outside the journal harnesses fails,
STOP — do not proceed; the failure is a regression this cycle introduced elsewhere (most likely
candidate: `run-claude-surface.js` or `run-audit.js` reacting to the new manifest fields —
diff against sticky-notes' manifest shape to find the mismatch).

- [ ] **Step 2: Workshop self-install (dogfood)**

Run: `node platform/install.js --vault . --auto-approve`
Expected: exits 0, no errors in the printed history. The workshop itself is NOT subscribed to
`journal` (confirmed in the design doc's context section), so this run should show `journal`
absent from the installed set — that's correct; this step only verifies the manifest/JSON is
well-formed enough that the installer's full pass doesn't choke on it globally (schema
validation, `check-version-sync.js`, etc. all run across every blueprint regardless of
subscription).

- [ ] **Step 3: If self-install fails**

Read the printed error + `platform-installed.json` history entry it references. Common causes
for a NEW blueprint's manifest: JSON syntax error (re-run Task 1 Step 2's validator), a
`rule_fragments[].fragment.naming_pattern` that doesn't compile as a JS RegExp (test each
pattern with `new RegExp(...)` in a throwaway `node -e`), or a `claude_surface[]` entry
referencing a `source` path that doesn't exist (double-check Task 7's file paths against
Task 1's manifest `claude_surface[]` block).

---

## Task 10: PR, CI, merge

**Files:** none (git/GitHub operations)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

(Branch name: whatever this work is being done on — confirm with `git branch --show-current`
before pushing; do not invent a new branch name if one is already checked out.)

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(journal): multi-entry day-hub blueprint (sticky-notes pattern)" --body "$(cat <<'EOF'
## Summary
- Journal moves from one flat note/day to sticky-notes' proven shape: global hub (Days | All + search), per-day day-hub, timestamped leaf entries with an optional title.
- Install-time migration converts existing flat `Journal-YYYY-MM-DD.md` notes (real data in ero-sauce + headspace-sauce) into the new day-folder shape.

## Design
Docs/plans/2026-07-11-journal-multi-entry-design.md
Docs/plans/2026-07-11-journal-multi-entry-plan.md

## Test plan
- [x] `npm run release:preflight` green
- [x] Workshop self-install (`node platform/install.js --vault . --auto-approve`) green
- [x] New `run-journal-multi-entry.js` suite covers day-list, hub-cards, and migration idempotency
EOF
)"
```

- [ ] **Step 3: Wait for CI, verify green**

Poll: `gh pr checks <pr-number>` until both `preflight (macos-latest)` and
`preflight (ubuntu-latest)` report success. If either is red, `gh run view <run-id> --log-failed`
to see the failure, fix, commit, push, and re-poll. Do NOT merge on red CI.

- [ ] **Step 4: Merge**

```bash
gh pr merge <pr-number> --squash
```

Only run this once step 3 confirms both required checks are green.

---

## Task 11: Release pipeline (automatic — verify, do not act)

**Files:** none (observation only)

The release pipeline is fully automated (`Docs/agent-guides/build-test-verify.md` § Release
workflow) — do NOT hand-bump versions, do NOT hand-merge the release PR, do NOT hand-tag, do NOT
hand-edit the homebrew tap.

- [ ] **Step 1: Watch for the release PR**

Poll `gh pr list --search "chore(release):" --state open` (or `gh pr list --author "app/github-actions"`
depending on which token opened it — check `RELEASE_PAT`'s attributed author) until the
`prepare-release` workflow opens the standing release PR (`chore(release): vX.Y.Z`).

- [ ] **Step 2: Watch it auto-merge**

Poll `gh pr view <release-pr-number> --json state,mergedAt` until `state == "MERGED"`. This
happens automatically once its required checks pass (GitHub auto-merge, no human step). If it
sits open for more than ~15 minutes with checks green, something is wrong with the auto-merge
setting — do NOT `--admin` merge it yourself; investigate (`gh pr checks`) and surface the
blocker instead of forcing the merge.

- [ ] **Step 3: Watch the tag + tap PR**

Poll `git ls-remote --tags origin | grep v` (or `gh api repos/willfell/sauce/tags`) for the new
`v<X.Y.Z>` tag created by `tag-and-ship`. Once it appears, poll
`gh pr list --repo willfell/homebrew-sauce --state all --search "sauce"` for the tap PR that
`tag-and-ship` opens against `willfell/homebrew-sauce`, and confirm it auto-merges
(`TAP_PR_TOKEN`) — same "do not hand-merge" rule applies here too.

---

## Task 12: Deploy to consumer vaults

**Files:** none (per-vault CLI operations against `/Users/willfellhoelter/notes/sauce/{accuris-sauce,ero-sauce,headspace-sauce}`)

`journal` is currently subscribed in `ero-sauce` and `headspace-sauce` only (confirmed during
brainstorming — `accuris-sauce`'s `ranch/platform-subscription.json` has no `journal` entry).
This task deploys the new version to all three vaults via the standard update path; per the
existing subscription, only `ero-sauce` and `headspace-sauce` will actually pick up the new
`journal` version. Adding `journal` to `accuris-sauce`'s subscription was NOT part of the
brainstormed scope — do not add it without asking first.

- [ ] **Step 1: Brew upgrade**

```bash
brew upgrade sauce
```

Expected: installs the newly-tagged version (confirm with `sauce --version` or equivalent
matching the just-shipped `vX.Y.Z`).

- [ ] **Step 2: Update each consumer vault**

For `accuris-sauce`, `ero-sauce`, `headspace-sauce` in turn:

```bash
cd /Users/willfellhoelter/notes/sauce/<vault>
sauce update --bump-pins
```

(`SAUCE_VAULT` is ignored — cwd-ancestor detection wins, so `cd` into each vault first, per
`Docs/agent-guides/build-test-verify.md` § Deploying a NEW mechanism/blueprint to consumers.)

- [ ] **Step 3: Verify per vault**

For `ero-sauce` and `headspace-sauce`:

```bash
cd /Users/willfellhoelter/notes/sauce/<vault>
cat ranch/platform-subscription.json | python3 -c "import json,sys; d=json.load(sys.stdin); print([b for b in d['blueprints'] if b['name']=='journal'])"
ls spice/journal/Journal.md   # global hub exists
find spice/journal -name "Journal-*.md" -newer spice/journal/Journal.md -mtime -1 2>/dev/null | head -5  # sanity: files exist post-update
```

Confirm the version in the subscription output matches the just-released version. Confirm the
migration ran by checking that no flat `Journal-YYYY-MM-DD.md` files remain directly under
`spice/journal/YYYY/MM-MMMM/` (they should now be nested one level deeper under
`YYYY-MM-DD/Journal-Day-YYYY-MM-DD.md` + `YYYY-MM-DD/Journal-YYYY-MM-DD-00-00-00.md`):

```bash
find spice/journal -maxdepth 3 -iname "Journal-????-??-??.md"   # expect: empty (no flat notes left)
find spice/journal -mindepth 4 -iname "Journal-Day-*.md"        # expect: one per pre-existing day
```

For `accuris-sauce`: confirm `journal` is (correctly) still absent from its subscription and no
`spice/journal/` directory was created.

- [ ] **Step 4: If a vault's `sauce update` reports an error**

Read the printed error + that vault's `platform-installed.json` history tail. Common cause per
`Docs/agent-guides/build-test-verify.md`: a stale pin below the newly-bumped floor on a
dependency `journal` newly declares (`cards`, `accent-button`, `entity-create`,
`platform-claude`, `breadcrumb`, `render-safe`, `doc-search`) — `--bump-pins` should handle this
automatically, but if it doesn't, diff that vault's pin against the workshop's brewed
`libexec/platform/manifest.json` and bump the stale one(s) by hand before retrying.

---

## Task 13: Cycle-close artifacts

**Files:**
- Create: `Docs/plans/<today>-journal-multi-entry-result.md`
- Modify: `Docs/cycle-history.md`
- Modify: `Docs/agent-guides/cycle-status.md`
- Modify: `Docs/install.md`
- Modify: `Docs/landmines.md` (only if a new landmine-worthy trap was hit during execution — otherwise skip, don't force an entry)
- Create: `Docs/prompts/<today>-post-v<X.Y.Z>-next-cycle-handoff.md`

Per `Docs/agent-guides/build-test-verify.md` § Cycle-close artifacts — this project's
established convention for every cycle close. `<X.Y.Z>` = whatever version the release
pipeline actually assigned (read it from the merged release PR / new git tag from Task 11, do
NOT guess).

- [ ] **Step 1: Write the result doc**

`Docs/plans/<today>-journal-multi-entry-result.md` — summarize: what shipped (list every file
touched), which vaults were smoke-tested + what was verified, any deviations from the plan
(e.g. a bug found + fixed during execution), the final version number, and the PR number(s).

- [ ] **Step 2: Append to `Docs/cycle-history.md`**

Add a `## v<X.Y.Z> journal-multi-entry CLOSED <today>` section, following the format of the
immediately-preceding entry in that file (read the last entry first to match structure).

- [ ] **Step 3: Update `Docs/agent-guides/cycle-status.md`**

Bump the workshop_version pointer and add `journal` to the blueprint catalogue table (or update
its existing row if one exists) with its new version + one-line multi-entry description.

- [ ] **Step 4: Update `Docs/install.md`**

Add an "Upgrading from v<prev>" note under the appropriate section describing the journal
migration behavior (auto-runs on next install; backs up to
`.sauce-backup/journal-multi-entry/<timestamp>/`).

- [ ] **Step 5: Write the next-cycle handoff prompt**

`Docs/prompts/<today>-post-v<X.Y.Z>-next-cycle-handoff.md` — brief onboarding doc for whoever
(human or agent) picks up the NEXT cycle: current state, nothing outstanding from this cycle
(all tasks closed), suggested next areas per the design doc's "Out of scope" section (no shared
day-log mechanism extraction planned unless a 3rd consumer emerges).

- [ ] **Step 6: Commit and push directly to main**

```bash
git add Docs/plans/<today>-journal-multi-entry-result.md Docs/cycle-history.md Docs/agent-guides/cycle-status.md Docs/install.md Docs/prompts/<today>-post-v<X.Y.Z>-next-cycle-handoff.md
git commit -m "docs: journal multi-entry cycle-close artifacts"
git push origin main
```

(Docs-only commit, no code changes, no version bump triggered — conventional-commit `docs:`
type is excluded from the semver bumper's `feat`/`fix` classification per
`compute-release.js`, but confirm this doesn't accidentally open a fresh no-op release PR; if it
does, that's expected — an empty/no-op release PR simply won't have any version delta to bump
and the pipeline handles that gracefully per existing precedent.)

---

## Final report (only after every task above is checked off)

Summarize for the user: final version number, PR link(s), which 3 vaults were confirmed
deployed with verification evidence (subscription version + flat-notes-migrated check from
Task 12 Step 3), and a link to the result doc.
