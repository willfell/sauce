/**
 * SpaceHome (CustomJS) — the Home command center composer.
 *
 * Renders the persistent `spice/home/Home.md` page in Reading view:
 *   1. a GREETING header  — "Good morning" / "afternoon" / "evening" (by hour)
 *                            + a human date ("Thursday, Jul 2, 2026 · Today"),
 *   2. a GLANCE line      — a rolled-up count line ("N today · M overdue ·
 *                            K meetings · J done"; zeros hidden; all-zero →
 *                            "Clear day — nothing scheduled"),
 *   3. a QUICK-CAPTURE band — an inline "Jot a task…" input + Add (one-gesture
 *                            task create, no modal), then one-tap buttons:
 *                            Meeting, Sticky Note, Article, Journal,
 *   4. the DAILY DASHBOARD — the exact SpaceDailyDashboard renderer, injected with
 *                            `asOf: today` so it always shows THIS calendar day's
 *                            agenda (the DRY seam; no params ⇒ dashboard's own note
 *                            date, unchanged).
 *
 * Reading-mode-first + mobile-friendly: everything is a plain <div>/<button> the
 * class builds in JS, with onclick handlers (NO markdown tables — those don't take
 * clicks in reading mode). Capture dispatch is fully guarded so a not-yet-registered
 * mechanism no-ops instead of throwing out of render.
 *
 * TIME DISCIPLINE (landmine): the ONLY live-clock reads are `moment().format(...)`
 * and `moment().hour()` at the top of render(). `_greeting(hour)` and
 * `_humanDate(iso, todayIso)` are PURE — hour + dates are injected — so they are
 * deterministic + Node-testable and never touch `new Date`.
 *
 * BARE CLASS ONLY — no trailing statements. The CustomJS loader wraps the whole
 * file in `( … )` and evals it as ONE expression; any trailer (module.exports, if,
 * …) → "Unexpected token" → the class never registers. `node --check` won't catch
 * it; the CJS-LOAD gate does. To Node-test the statics, load via
 * `new Function(src + "; return SpaceHome;")()`.
 *
 * Invoked via customjs-guard on Home.md's body:
 *   await dv.view("ranch/views/customjs-guard", { class: "SpaceHome" });
 * so its entry method is the instance `render(dv, params)`.
 *
 * Static API (Node-testable, pure):
 *   SpaceHome._greeting(hour)          → "Good morning" | "Good afternoon" | "Good evening"
 *   SpaceHome._humanDate(iso, todayIso)→ "Thursday, Jul 2, 2026 · Today" (pure day-math)
 *   SpaceHome._captureSpec()           → [{ key, label, icon }, …] (the capture buttons)
 *   SpaceHome._glanceChips(counts)     → { empty, text } | { empty:false, chips:[{n,label,cls}] }
 */
class SpaceHome {

  // ---------- Static pure helpers ----------

  /**
   * Time-of-day greeting from an INJECTED hour (0–23). Bands:
   *   5–11  → morning, 12–16 → afternoon, else → evening.
   * Pure — never reads the wall clock.
   */
  static _greeting(hour) {
    const h = Number(hour);
    if (Number.isFinite(h) && h >= 5 && h <= 11) return "Good morning";
    if (Number.isFinite(h) && h >= 12 && h <= 16) return "Good afternoon";
    return "Good evening";
  }

  /**
   * Parse a `YYYY-MM-DD` (or leading-date-within-ISO / Luxon-ish) value into
   * { y, mo, d } integers, or null. PURE — never touches new Date. Ported from
   * task-entity's TaskNoteView._ymd.
   */
  static _ymd(value) {
    if (value == null) return null;
    let s = "";
    if (typeof value === "string") s = value.trim();
    else if (typeof value.toISODate === "function") { s = value.toISODate() || ""; }
    else if (typeof value.toFormat === "function") { s = value.toFormat("yyyy-MM-dd"); }
    else if (typeof value.format === "function") { s = value.format("YYYY-MM-DD"); }
    else s = String(value);
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return null;
    return { y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10) };
  }

  /**
   * Convert { y, mo, d } (1-based month) to an absolute day number (days since
   * 1970-01-01, where 0 == Thursday) via Howard Hinnant's days_from_civil.
   * Deterministic, leap-year correct, NEVER uses new Date. Ported from
   * task-entity's TaskNoteView._dayNumber.
   */
  static _dayNumber(ymd) {
    if (!ymd) return null;
    let y = ymd.y;
    const m = ymd.mo;
    const d = ymd.d;
    y -= m <= 2 ? 1 : 0;
    const era = Math.floor((y >= 0 ? y : y - 399) / 400);
    const yoe = y - era * 400;                                             // [0, 399]
    const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
    return era * 146097 + doe - 719468; // days since 1970-01-01 (0 == Thursday)
  }

  /**
   * Compute yesterday's daily-note VAULT PATH from `today` (YYYY-MM-DD) and
   * the parsed `.obsidian/daily-notes.json` config ({ folder, format }).
   * PURE — never touches the wall clock or the vault; the caller resolves
   * `today` and reads daily-notes.json. `format` is a moment.js-style token
   * string (folder/file segments); this only needs the tokens the daily
   * blueprint's own config actually uses: YYYY, MM, MMMM, dddd, YYYY-MM-DD.
   * Returns null when `today` or `config.folder`/`config.format` are missing
   * or unparseable — the caller shows a Notice rather than guessing a path.
   */
  static _previousDailyPath(today, config) {
    if (!config || typeof config.folder !== "string" || !config.folder
      || typeof config.format !== "string" || !config.format) return null;
    const ymd = SpaceHome._ymd(today);
    if (!ymd) return null;
    const dn = SpaceHome._dayNumber(ymd);
    if (dn == null) return null;

    // Convert the PREVIOUS absolute day number back to { y, mo, d } via the
    // inverse of _dayNumber's Howard Hinnant civil_from_days algorithm.
    const civilFromDays = (z) => {
      z += 719468;
      const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
      const doe = z - era * 146097;                                  // [0, 146096]
      const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
      const y = yoe + era * 400;
      const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
      const mp = Math.floor((5 * doy + 2) / 153);                     // [0, 11]
      const d = doy - Math.floor((153 * mp + 2) / 5) + 1;             // [1, 31]
      const m = mp + (mp < 10 ? 3 : -9);                              // [1, 12]
      return { y: y + (m <= 2 ? 1 : 0), mo: m, d };
    };
    const prev = civilFromDays(dn - 1);

    const WD = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];
    const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const pad2 = (n) => String(n).padStart(2, "0");
    const wd = WD[(((dn - 1) % 7) + 7) % 7];
    const tokens = {
      YYYY: String(prev.y),
      MM: pad2(prev.mo),
      MMMM: MO[prev.mo - 1],
      dddd: wd,
      DD: pad2(prev.d),
    };
    // Build the literal "YYYY-MM-DD" composite token first (longest match),
    // then the remaining single tokens — longest-token-first avoids MM being
    // consumed inside a not-yet-replaced YYYY-MM-DD literal.
    const isoDate = tokens.YYYY + "-" + tokens.MM + "-" + pad2(prev.d);
    let out = config.format.split("YYYY-MM-DD").join(isoDate);
    out = out.split("YYYY").join(tokens.YYYY);
    out = out.split("MMMM").join(tokens.MMMM);
    out = out.split("MM").join(tokens.MM);
    out = out.split("dddd").join(tokens.dddd);
    return config.folder.replace(/\/+$/, "") + "/" + out + ".md";
  }

  /**
   * Format a date-ish value into a HUMAN string, PURELY (no wall clock).
   *   "Thursday, Jul 2, 2026"                (base)
   *   "Thursday, Jul 2, 2026 · Today"        (iso === todayIso)
   *   "… · Tomorrow" / "· Yesterday" / "· in N days" / "· N days ago"
   * FULL weekday name + abbreviated month + numeric day + year. Uses the same
   * Hinnant day-math as task-entity (weekday + signed relative delta), just a
   * different string shape. Unparseable value → "".
   */
  static _humanDate(iso, todayIso) {
    const WD = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"]; // dayNumber 0 == Thursday
    const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    try {
      const ymd = SpaceHome._ymd(iso);
      if (!ymd) return "";
      const dn = SpaceHome._dayNumber(ymd);
      let text = "";
      if (dn != null) {
        const wd = WD[((dn % 7) + 7) % 7];
        const mon = (ymd.mo >= 1 && ymd.mo <= 12) ? MO[ymd.mo - 1] : String(ymd.mo);
        text = wd + ", " + mon + " " + ymd.d + ", " + ymd.y;
      }
      let relative = "";
      const todayYmd = SpaceHome._ymd(todayIso);
      if (todayYmd && dn != null) {
        const todayDn = SpaceHome._dayNumber(todayYmd);
        if (todayDn != null) {
          const delta = dn - todayDn;
          if (delta === 0) relative = "Today";
          else if (delta === 1) relative = "Tomorrow";
          else if (delta === -1) relative = "Yesterday";
          else if (delta > 1) relative = "in " + delta + " days";
          else relative = (-delta) + " days ago";
        }
      }
      return relative ? (text + " · " + relative) : text;
    } catch (_e) {
      return "";
    }
  }

  /**
   * The quick-capture BUTTONS, in fixed DOM order. Each entry:
   *   { key, label, icon }  — icon is an inline lucide-style SVG string.
   * The dispatch per key is wired in render() (kept out of the spec so the spec
   * stays pure + Node-testable).
   *
   * NOTE: the `todo` entry was REMOVED — task capture is now an inline
   * "Jot a task…" input + Add button (built in render, wired to
   * TaskDialog.createQuick) that sits ABOVE these buttons. So this spec is the
   * remaining buttons: Meeting, Sticky Note, Article, Journal, Trip.
   */
  static _captureSpec() {
    const svg = (inner) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    return [
      { key: "meeting", label: "Meeting", icon: svg(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`) },
      { key: "sticky-note", label: "Sticky Note", icon: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`) },
      { key: "article", label: "Article", icon: svg(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`) },
      { key: "journal", label: "Journal", icon: svg(`<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M16 2v20"/>`) },
      { key: "trip", label: "Trip", icon: svg(`<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>`) },
    ];
  }

  /**
   * Pure chip descriptor for the glance line. Input: the { today, overdue, done,
   * meetings } roll-up (each coerced to a non-negative int, default 0). Output:
   *   - every count 0 → { empty: true, text: "Clear day — nothing scheduled" }
   *   - else → { empty: false, chips: [{ n, label, cls }, …] } holding ONLY the
   *     counts > 0, in fixed order today / overdue / meetings / done:
   *       today    → label "today"                     (no cls)
   *       overdue  → label "overdue", cls "sauce-section-overdue-pill" (red)
   *       meetings → label "meeting" (n===1) | "meetings"
   *       done     → label "done"
   * PURE + Node-testable — render() builds the DOM from this descriptor. `cls` is
   * "" when there's no special class so the caller can append unconditionally.
   */
  static _glanceChips(counts) {
    const c = counts || {};
    const toInt = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
    const today = toInt(c.today);
    const overdue = toInt(c.overdue);
    const meetings = toInt(c.meetings);
    const done = toInt(c.done);
    if (!today && !overdue && !meetings && !done) {
      return { empty: true };
    }
    const chips = [];
    if (today > 0)    chips.push({ n: today,    label: "today",                              cls: "" });
    if (overdue > 0)  chips.push({ n: overdue,  label: "overdue",                            cls: "sauce-section-overdue-pill" });
    if (meetings > 0) chips.push({ n: meetings, label: meetings === 1 ? "meeting" : "meetings", cls: "" });
    if (done > 0)     chips.push({ n: done,     label: "done",                               cls: "" });
    return { empty: false, chips };
  }

  /**
   * Toggle a class on/off, stub-safe. Uses the real `classList` when present
   * (browser / Obsidian), else rewrites the element's class string (the Node DOM
   * stub keeps its class in `.cls`) so the "+" open/close state is testable both
   * ways. PURE w.r.t. globals — no `document`/`window` access.
   */
  static _setClass(el, cls, on) {
    if (!el) return;
    if (el.classList && typeof el.classList.toggle === "function") {
      el.classList.toggle(cls, !!on);
      return;
    }
    const cur = String(el.className || el.cls || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((c) => c !== cls);
    if (on) cur.push(cls);
    const next = cur.join(" ");
    el.cls = next;
    el.className = next;
  }

  /**
   * Pure predicate: should the Home re-render on this active-leaf-change? True
   * iff the newly-active leaf IS the Home note AND the day has rolled over since
   * the Home last rendered. Node-testable; never reads the wall clock.
   */
  static _shouldDayRefresh(activePath, renderDay, today) {
    return !!activePath && activePath === "spice/home/Home.md"
      && !!renderDay && !!today && renderDay !== today;
  }

  // ---------- Instance / browser render ----------

  /**
   * customjs-guard entry point. `params` is unused today (reserved for future
   * host injection); the composer resolves its own live `today`/`hour`.
   */
  async render(dv, params) {
    // Capture `this` for the async re-render after an inline task capture (the
    // input/Add handlers await createQuick then call self.render to refresh).
    const self = this;

    // Cold-start reflow guard: on the FIRST render of any app session, wait for
    // Obsidian's workspace layout (panes/sidebars) to finish restoring before
    // painting. Firing during layout restore is what produces the visible
    // "flash then widen" on a cold app open — deferring the first paint avoids
    // racing that restore. Deduped via a window flag so this never delays a
    // SECOND render in the same session (e.g. day-rollover force-refresh).
    try {
      const w = (typeof window !== "undefined" && window) || null;
      const A = (typeof app !== "undefined" && app) || (w && w.app) || null;
      if (w && !w.__sauceHomeLayoutReady) {
        if (A && A.workspace && typeof A.workspace.onLayoutReady === "function") {
          await new Promise((resolve) => {
            A.workspace.onLayoutReady(() => { w.__sauceHomeLayoutReady = true; resolve(); });
          });
        } else {
          w.__sauceHomeLayoutReady = true;
        }
      }
    } catch (_e) { /* never throw — fall through to an immediate render */ }

    // The ONLY live-clock reads. moment is a runtime global (window.moment).
    const M = (typeof moment !== "undefined" && moment)
      || (typeof window !== "undefined" && window.moment)
      || null;
    const today = M ? M().format("YYYY-MM-DD") : "";

    // Day-refresh watcher: Dataview only re-renders a block on an index-revision
    // bump while shown, so a quiet vault leaves this clock-only block frozen at
    // its last-render day (the "stuck on Friday" bug). Record today's render day
    // and install — ONCE for the app lifetime (deduped via a window flag) — an
    // active-leaf-change listener that force-refreshes Dataview when the Home
    // becomes active on a NEW day. Never throws; degrades to today's behavior.
    try {
      const w = (typeof window !== "undefined" && window) || null;
      if (w) {
        w.__sauceHomeRenderDay = today;
        const A = (typeof app !== "undefined" && app) || w.app || null;
        if (A && A.workspace && typeof A.workspace.on === "function" && !w.__sauceHomeDayWatcher) {
          w.__sauceHomeDayWatcher = A.workspace.on("active-leaf-change", () => {
            try {
              const M2 = (typeof moment !== "undefined" && moment) || w.moment || null;
              const now = M2 ? M2().format("YYYY-MM-DD") : "";
              const af = (A.workspace.getActiveFile && A.workspace.getActiveFile()) || null;
              const p = af && af.path;
              if (SpaceHome._shouldDayRefresh(p, w.__sauceHomeRenderDay, now)
                && A.commands && typeof A.commands.executeCommandById === "function") {
                A.commands.executeCommandById("dataview:dataview-force-refresh-views");
              }
            } catch (_e) { /* never throw */ }
          });
        }
      }
    } catch (_e) { /* never throw */ }

    // Glance counts — computed EARLY (before any DOM work) so the no-op-if-
    // unchanged check below can short-circuit the whole rebuild. Counts route
    // through SpaceDailyDashboard.computeCounts (the DRY seam), guarded so a
    // not-yet-registered dashboard/task-entity (cold load) yields zeros
    // instead of throwing.
    const cjs = (typeof customJS !== "undefined" && customJS)
      || (typeof window !== "undefined" && window.customJS)
      || null;
    const SDD = cjs && cjs.SpaceDailyDashboard;
    const TE = cjs && cjs.TaskEntity;
    let counts = { today: 0, overdue: 0, done: 0, meetings: 0 };
    try {
      if (SDD && typeof SDD.computeCounts === "function") {
        counts = SDD.computeCounts(dv, today, TE) || counts;
      }
    } catch (_e) { /* cold load / bad dv → zeros; never abort render */ }

    // No-op-if-unchanged: a full teardown + rebuild is visually disruptive
    // (the reported "reloading every time" feel) and is wasted work whenever
    // NOTHING actually changed since the last render in THIS render() call —
    // e.g. our own post-capture self.render() re-invocation firing while the
    // glance counts happen to be identical. Skipping also PRESERVES any
    // in-progress state a rebuild would otherwise wipe (an open "+" menu, a
    // partially-typed "Jot a task…" draft). This does NOT (and cannot) cover
    // Dataview's OWN periodic re-execution of the whole block, which clears
    // dv.container itself before calling render() again — this guard only
    // short-circuits redundant work WE would otherwise do within one still-
    // live container.
    const sig = today + "|" + JSON.stringify(counts);
    try {
      const w = (typeof window !== "undefined" && window) || null;
      if (w && w.__sauceHomeLastSig === sig && dv.container.querySelector(".sauce-home")) {
        return;
      }
      if (w) w.__sauceHomeLastSig = sig;
    } catch (_e) { /* never throw — fall through to a normal rebuild */ }

    // Idempotent re-render: drop any prior .sauce-home so a Dataview re-exec
    // doesn't stack duplicate homes.
    const prior = dv.container.querySelector(".sauce-home");
    if (prior) prior.remove();

    const home = dv.el("div", "", { cls: "sauce-home" });

    // 1) Header row — the date (left) + a subtle "+" quick-add (right) ────────
    // Just the date now (no greeting): a clean, sharp header line with the accent
    // tick. Capture lives behind the quiet "+" that springs open a dropdown.
    const head = home.createEl("div", { cls: "sauce-home-head" });
    const greeting = head.createEl("div", { cls: "sauce-home-greeting" });
    const sub = greeting.createEl("div", { cls: "sauce-home-greeting-date" });
    sub.textContent = SpaceHome._humanDate(today, today);

    // 1a) "‹ Yesterday" — opens the actual previous day's daily note (Home
    // itself always stays pinned to today; this navigates AWAY, it does not
    // re-render Home for another day). Never creates a file: if yesterday's
    // note doesn't exist yet, show a Notice instead.
    const prevBtn = greeting.createEl("button", { cls: "sauce-home-prev-day" });
    prevBtn.setAttribute("type", "button");
    prevBtn.setAttribute("aria-label", "Previous day");
    prevBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    prevBtn.onclick = async () => {
      try {
        const appRef = (typeof app !== "undefined" && app) || (typeof window !== "undefined" && window.app) || null;
        if (!appRef || !appRef.vault || !appRef.vault.adapter) return;
        let cfg = null;
        try {
          const raw = await appRef.vault.adapter.read(".obsidian/daily-notes.json");
          cfg = JSON.parse(raw);
        } catch (_e) { cfg = null; }
        const p = SpaceHome._previousDailyPath(today, cfg);
        if (!p) {
          try { new Notice("Could not determine yesterday's daily note path."); } catch (_e) {}
          return;
        }
        const file = appRef.vault.getAbstractFileByPath ? appRef.vault.getAbstractFileByPath(p) : null;
        if (!file) {
          try { new Notice("No daily note for yesterday yet."); } catch (_e) {}
          return;
        }
        if (appRef.workspace && typeof appRef.workspace.openLinkText === "function") {
          appRef.workspace.openLinkText(p, "", false);
        }
      } catch (_e) { /* never throw out of a click handler */ }
    };

    // 1b) Quick-add "+" → a compact dropdown of capture actions. The menu is
    // built now (hidden via CSS) and toggled by the "+" (which rotates to "×").
    // It holds a one-gesture "Jot a task…" input + New Meeting / New Sticky Note /
    // Open today's daily. Outside-click + Escape close it (guarded — no-op on a
    // cold/stub document so this never throws out of render).
    const addWrap = head.createEl("div", { cls: "sauce-home-add-wrap" });
    const addBtn = addWrap.createEl("button", { cls: "sauce-home-add" });
    addBtn.setAttribute("type", "button");
    addBtn.setAttribute("aria-label", "Quick add");
    addBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;
    const menu = addWrap.createEl("div", { cls: "sauce-home-add-menu" });

    let menuOpen = false;
    const docRef = (typeof document !== "undefined" && document) || null;
    const setMenu = (open) => {
      menuOpen = !!open;
      SpaceHome._setClass(menu, "is-open", menuOpen);
      SpaceHome._setClass(addBtn, "is-open", menuOpen);
      if (docRef && typeof docRef.addEventListener === "function") {
        if (menuOpen) {
          docRef.addEventListener("mousedown", onDocDown);
          docRef.addEventListener("keydown", onDocKey);
        } else if (typeof docRef.removeEventListener === "function") {
          docRef.removeEventListener("mousedown", onDocDown);
          docRef.removeEventListener("keydown", onDocKey);
        }
      }
    };
    const onDocDown = (ev) => {
      if (!menuOpen) return;
      const t = ev && ev.target;
      const inMenu = t && menu && typeof menu.contains === "function" && menu.contains(t);
      const inBtn = t && (t === addBtn || (typeof addBtn.contains === "function" && addBtn.contains(t)));
      if (!inMenu && !inBtn) setMenu(false);
    };
    const onDocKey = (ev) => { if (menuOpen && ev && ev.key === "Escape") setMenu(false); };
    addBtn.onclick = () => {
      const opening = !menuOpen;
      setMenu(opening);
      // Focus the "Jot a task…" input the moment the menu springs open, so the
      // user can start typing immediately — this is an explicit click gesture,
      // not an autofocus-on-page-load (which would pop the mobile keyboard on
      // every Home open; see the render()-time comment on `input` below).
      if (opening && input && typeof input.focus === "function") {
        try { input.focus(); } catch (_e) { /* never throw out of a click handler */ }
      }
    };

    // Menu — one-gesture task capture (Enter or Add → TaskDialog.createQuick,
    // guarded; then close the menu + re-render so the Tasks panel + glance chip
    // reflect the new task). NO autofocus — home opens on every launch and an
    // autofocus would pop the mobile keyboard each time.
    const captureRow = menu.createEl("div", { cls: "sauce-home-add-input-row" });
    const input = captureRow.createEl("input", { cls: "sauce-home-capture-input" });
    input.setAttribute("type", "text");
    input.setAttribute("placeholder", "Jot a task…");
    const addTaskBtn = captureRow.createEl("button", { cls: "sauce-home-capture-add" });
    addTaskBtn.setAttribute("type", "button");
    addTaskBtn.textContent = "Add";
    const submitCapture = async () => {
      const text = input.value;
      if (!(typeof text === "string" && text.trim())) return;
      const cjsNow = (typeof customJS !== "undefined" && customJS)
        || (typeof window !== "undefined" && window.customJS)
        || null;
      const td = cjsNow && cjsNow.TaskDialog;
      try {
        if (td && typeof td.createQuick === "function") {
          await td.createQuick({ title: text, source: "daily" });
        }
      } catch (_e) { /* capture is best-effort; never throw out of the handler */ }
      setMenu(false);
      await self.render(dv, params);
    };
    addTaskBtn.onclick = () => { submitCapture(); };
    input.addEventListener("keydown", (ev) => {
      if (ev && ev.key === "Enter" && !ev.isComposing) {
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
        submitCapture();
      }
    });

    // Menu — the secondary capture actions: Meeting, Sticky Note, Article,
    // Journal, Trip. Article and Journal are gated on their entity-create
    // registry entry actually existing (reader-article / journal-entry) so the
    // button never appears for a vault that hasn't installed that blueprint.
    // Trip is gated the same way, but via ranch/nav-buttons-registry.json's
    // contributions.trips — NOT via `customJS.TripNavButtons` class existence.
    // CustomJS loads every .js file physically present under ranch/scripts/
    // regardless of subscription state, so an orphaned trip-nav-buttons.js left
    // over from an old install would keep the class "available" even after the
    // vault unsubscribes from the trips blueprint. The registry file is
    // installer-owned and only lists contributions for currently-subscribed
    // components, so reading it is the source of truth for "is trips actually
    // installed here" — the same pattern EntityCreate._loadSpec uses below.
    const registryIdFor = { article: "reader-article", journal: "journal-entry" };
    const cjsForGate = (typeof customJS !== "undefined" && customJS)
      || (typeof window !== "undefined" && window.customJS)
      || null;
    const appForGate = (typeof app !== "undefined" && app)
      || (typeof window !== "undefined" && window.app)
      || null;
    for (const item of SpaceHome._captureSpec()) {
      if (item.key === "trip") {
        let available = false;
        try {
          if (appForGate && appForGate.vault && appForGate.vault.adapter) {
            const raw = await appForGate.vault.adapter.read("ranch/nav-buttons-registry.json");
            const reg = JSON.parse(raw);
            const trips = reg && reg.contributions && reg.contributions.trips;
            available = Array.isArray(trips) && trips.length > 0;
          }
        } catch (_e) { /* best-effort gate check; treat as unregistered on failure */ }
        if (!available) continue;
      } else {
        const registryId = registryIdFor[item.key];
        if (registryId) {
          let spec = null;
          try {
            if (cjsForGate && cjsForGate.EntityCreate && typeof cjsForGate.EntityCreate._loadSpec === "function") {
              spec = await cjsForGate.EntityCreate._loadSpec(registryId);
            }
          } catch (_e) { /* best-effort gate check; treat as unregistered on failure */ }
          if (!spec) continue;
        }
      }
      const mi = menu.createEl("button", { cls: "sauce-home-add-item" });
      mi.setAttribute("type", "button");
      mi.dataset.captureKey = item.key;
      const iconSpan = mi.createEl("span", { cls: "sauce-home-capture-icon" });
      iconSpan.innerHTML = item.icon;
      const labelSpan = mi.createEl("span", { cls: "sauce-home-capture-label" });
      labelSpan.textContent = item.label;
      mi.onclick = () => { SpaceHome._dispatch(item.key, dv, today); setMenu(false); };
    }

    // 2) Glance counts ───────────────────────────────────────────────────────
    // A rolled-up count line ("N today · M overdue · K meetings · J done").
    // `counts` was already computed above (before the no-op-if-unchanged
    // check); _glanceChips is the PURE descriptor, this block just paints it.
    // Glance count line — rendered ONLY when there's something to show. An empty
    // day shows NOTHING (no "Clear day" message, no empty element).
    const g = SpaceHome._glanceChips(counts);
    if (!g.empty) {
      const glance = home.createEl("div", { cls: "sauce-home-glance" });
      g.chips.forEach((chip, i) => {
        if (i > 0) {
          const sep = glance.createEl("span", { cls: "sauce-home-glance-sep" });
          sep.textContent = "·";
        }
        const chipEl = glance.createEl("span", { cls: "sauce-home-glance-chip" + (chip.cls ? " " + chip.cls : "") });
        const nEl = chipEl.createEl("span", { cls: "sauce-home-glance-n" });
        nEl.textContent = String(chip.n);
        const lEl = chipEl.createEl("span", { cls: "sauce-home-glance-label" });
        lEl.textContent = " " + chip.label;
      });
    }

    // 3) Daily dashboard (asOf = today) ───────────────────────────────────────
    // Injected via the DRY seam so Home always shows THIS calendar day's agenda,
    // independent of any note's filename date. Mounts AFTER greeting + capture so
    // it appends below them, into dv.container (the guard renders there).
    await dv.view("ranch/views/customjs-guard", {
      class: "SpaceDailyDashboard",
      args: [{ asOf: today, live: true }],
    });
  }

  /**
   * Dispatch a capture key to the verified programmatic API. Each arm is guarded
   * so a not-yet-registered mechanism (cold load) no-ops instead of throwing out
   * of the click handler. Grep-verified entrypoints:
   *   meeting   → customJS.EntityCreate.create({ instance:'meeting', dv })
   *   sticky-note → customJS.EntityCreate.create({ instance:'sticky-note', dv })
   *   article   → customJS.ReaderArticlePaste.open(dv)
   *   journal   → customJS.EntityCreate.create({ instance:'journal-entry', dv })
   *   trip      → customJS.TripNavButtons._promptForTripDetails() then ._createTrip()
   *               — the exact same flow as the "New Trip" button on
   *               spice/trips/Trips.md (TripsChromeBar's "new-trip" dispatch)
   *   openDaily → app.commands.executeCommandById("daily-notes")
   * (The former `todo` button is gone — task capture is now the inline
   * "Jot a task…" input wired directly to TaskDialog.createQuick in render.)
   */
  static _dispatch(key, dv, today) {
    const cjs = (typeof customJS !== "undefined" && customJS)
      || (typeof window !== "undefined" && window.customJS)
      || null;
    const appRef = (typeof app !== "undefined" && app)
      || (typeof window !== "undefined" && window.app)
      || null;
    try {
      if (key === "meeting") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "meeting", dv: dv });
        }
        return;
      }
      if (key === "sticky-note") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "sticky-note", dv: dv });
        }
        return;
      }
      if (key === "journal") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "journal-entry", dv: dv });
        }
        return;
      }
      if (key === "trip") {
        const TNB = cjs && cjs.TripNavButtons;
        if (!TNB || typeof TNB._promptForTripDetails !== "function" || typeof TNB._createTrip !== "function") {
          if (typeof Notice === "function") new Notice("TripNavButtons unavailable — reinstall trips blueprint.", 6000);
          return;
        }
        return TNB._promptForTripDetails().then((details) => {
          if (!details) return;
          return TNB._createTrip(details).then((atlasPath) => {
            if (atlasPath) {
              if (typeof Notice === "function") new Notice(`Created trip: ${details.name}`);
              try { appRef.workspace.openLinkText(atlasPath, ""); } catch (_e) { /* never throw */ }
            }
          });
        });
      }
      if (key === "openDaily") {
        if (appRef && appRef.commands && typeof appRef.commands.executeCommandById === "function") {
          appRef.commands.executeCommandById("daily-notes");
        }
        return;
      }
      if (key === "article") {
        if (cjs && cjs.ReaderArticlePaste && typeof cjs.ReaderArticlePaste.open === "function") {
          cjs.ReaderArticlePaste.open(dv);
        } else if (typeof Notice === "function") {
          new Notice("Reader paste dialog unavailable — reinstall reader blueprint.", 6000);
        }
        return;
      }
    } catch (e) {
      try {
        if (typeof console !== "undefined" && console.debug) {
          console.debug("SpaceHome capture dispatch failed for " + key + ": " + (e && (e.message || e)));
        }
      } catch (_e) { /* ignore */ }
    }
  }
}
