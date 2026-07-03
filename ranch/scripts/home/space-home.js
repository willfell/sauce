/**
 * SpaceHome (CustomJS) — the Home command center composer.
 *
 * Renders the persistent `spice/home/Home.md` page in Reading view:
 *   1. a GREETING header  — "Good morning" / "afternoon" / "evening" (by hour)
 *                            + a human date ("Thursday, Jul 2, 2026 · Today"),
 *   2. a QUICK-CAPTURE band — 4 one-tap buttons: ＋ To-Do, ＋ Meeting, ＋ Scratch,
 *                            Open today's daily,
 *   3. the DAILY DASHBOARD — the exact SpaceDailyDashboard renderer, injected with
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
 *   SpaceHome._captureSpec()           → [{ key, label, icon }, …] (the 4 capture buttons)
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
   * The 4 quick-capture buttons, in fixed DOM order. Each entry:
   *   { key, label, icon }  — icon is an inline lucide-style SVG string.
   * The dispatch per key is wired in render() (kept out of the spec so the spec
   * stays pure + Node-testable).
   */
  static _captureSpec() {
    const svg = (inner) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    return [
      { key: "todo",      label: "＋ To-Do",           icon: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>`) },
      { key: "meeting",   label: "＋ Meeting",          icon: svg(`<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`) },
      { key: "scratch",   label: "＋ Scratch",          icon: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`) },
      { key: "openDaily", label: "Open today’s daily", icon: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`) },
    ];
  }

  // ---------- Instance / browser render ----------

  /**
   * customjs-guard entry point. `params` is unused today (reserved for future
   * host injection); the composer resolves its own live `today`/`hour`.
   */
  async render(dv, params) {
    // The ONLY live-clock reads. moment is a runtime global (window.moment).
    const M = (typeof moment !== "undefined" && moment)
      || (typeof window !== "undefined" && window.moment)
      || null;
    const today = M ? M().format("YYYY-MM-DD") : "";
    const hour = M ? M().hour() : 0;

    // Idempotent re-render: drop any prior .sauce-home so a Dataview re-exec
    // doesn't stack duplicate homes.
    const prior = dv.container.querySelector(".sauce-home");
    if (prior) prior.remove();

    const home = dv.el("div", "", { cls: "sauce-home" });

    // 1) Greeting header ─────────────────────────────────────────────────────
    const greeting = home.createEl("div", { cls: "sauce-home-greeting" });
    const line = greeting.createEl("div", { cls: "sauce-home-greeting-line" });
    line.textContent = SpaceHome._greeting(hour);
    const sub = greeting.createEl("div", { cls: "sauce-home-greeting-date" });
    sub.textContent = SpaceHome._humanDate(today, today);

    // 2) Quick-capture band ──────────────────────────────────────────────────
    const band = home.createEl("div", { cls: "sauce-home-capture" });
    for (const item of SpaceHome._captureSpec()) {
      const btn = band.createEl("button", { cls: "sauce-home-capture-btn" });
      btn.setAttribute("type", "button");
      btn.dataset.captureKey = item.key;
      const iconSpan = btn.createEl("span", { cls: "sauce-home-capture-icon" });
      iconSpan.innerHTML = item.icon;
      const labelSpan = btn.createEl("span", { cls: "sauce-home-capture-label" });
      labelSpan.textContent = item.label;
      btn.onclick = () => { SpaceHome._dispatch(item.key, dv, today); };
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
   *   todo      → customJS.TaskDialog.open({ surface:'daily', today })
   *               (platform/blueprints/to-do/helpers/todo-leaf-actions.js:125)
   *   meeting   → customJS.EntityCreate.create({ instance:'meeting', dv })
   *   scratch   → customJS.EntityCreate.create({ instance:'scratch', dv })
   *   openDaily → app.commands.executeCommandById("daily-notes")
   */
  static _dispatch(key, dv, today) {
    const cjs = (typeof customJS !== "undefined" && customJS)
      || (typeof window !== "undefined" && window.customJS)
      || null;
    const appRef = (typeof app !== "undefined" && app)
      || (typeof window !== "undefined" && window.app)
      || null;
    try {
      if (key === "todo") {
        if (cjs && cjs.TaskDialog && typeof cjs.TaskDialog.open === "function") {
          cjs.TaskDialog.open({ surface: "daily", today: today });
        }
        return;
      }
      if (key === "meeting") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "meeting", dv: dv });
        }
        return;
      }
      if (key === "scratch") {
        if (cjs && cjs.EntityCreate && typeof cjs.EntityCreate.create === "function") {
          cjs.EntityCreate.create({ instance: "scratch", dv: dv });
        }
        return;
      }
      if (key === "openDaily") {
        if (appRef && appRef.commands && typeof appRef.commands.executeCommandById === "function") {
          appRef.commands.executeCommandById("daily-notes");
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
