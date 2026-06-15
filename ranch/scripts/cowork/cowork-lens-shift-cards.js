/**
 * CoworkLensShiftCards (CustomJS) — v0.95.1 Knob-3
 *
 * Renders warm/cold morning-briefing pairs for the current week as
 * comparison cards on Daily Hub's "## Lens-shift companions" section.
 *
 * Knob 3 (`lens_shift` cadence) fires a memory-skip MB on Saturday morning,
 * writing a `cowork-morning-briefing-cold` atomic note next to that day's
 * regular `cowork-morning-briefing` note. This view pairs them visually so
 * the user can empirically see what the memory frame was hiding.
 *
 * Pairing strategy: slug-match within the same day-folder + engagement_id
 * (NO `companion_to:` frontmatter — race-free + simpler per design § 5.5).
 * Graceful degradation: when only ONE of the pair exists for a day (warm-only
 * or cold-only), render a single-column card instead of forcing a pair.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkLensShiftCards" });
 *
 * Spec: Docs/plans/2026-06-08-v0.95.1-anti-echo-design.md § 5.5 (visual pairing).
 * Tests: HC-V0951-K3-J / K3-K / K3-L (platform/test/run-helper-cases.js).
 *
 * v0.110.4: removed top-level `"use strict";` directive. CustomJS plugin
 * only accepts ONE top-level construct (the class declaration); the
 * directive prologue triggered ParseError on every load. Class bodies
 * are implicitly strict mode in JavaScript, so the directive was
 * redundant anyway.
 */

class CoworkLensShiftCards {
    /**
     * Resolve a page's "day" key for grouping. Prefers explicit `day:`
     * frontmatter when present; falls back to scanning the file folder for
     * a YYYY-MM-DD segment (matches the spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/
     * convention). Returns null when no day can be derived.
     */
    _dayKey(p) {
        if (p && typeof p.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.day)) {
            return p.day;
        }
        const folder = (p && p.file && typeof p.file.folder === "string") ? p.file.folder : "";
        const m = folder.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : null;
    }

    /**
     * Build the (day, engagement_id) → {warm, cold} pair map from a flat
     * list of page records. Pages whose type is neither warm nor cold MB
     * are dropped. Pages with no resolvable day OR no engagement_id are
     * dropped (can't meaningfully pair them).
     */
    _groupPairs(pages) {
        const pairs = new Map(); // key → {day, engagement_id, warm, cold}
        for (const p of pages) {
            if (!p) continue;
            const t = p.type;
            if (t !== "cowork-morning-briefing" && t !== "cowork-morning-briefing-cold") continue;
            const day = this._dayKey(p);
            const eng = (typeof p.engagement_id === "string") ? p.engagement_id : null;
            if (!day || !eng) continue;
            const key = `${day}::${eng}`;
            if (!pairs.has(key)) {
                pairs.set(key, { day, engagement_id: eng, warm: null, cold: null });
            }
            const slot = pairs.get(key);
            if (t === "cowork-morning-briefing-cold") {
                slot.cold = p;
            } else {
                slot.warm = p;
            }
        }
        return pairs;
    }

    /**
     * Compose a single-card label from a page (used both for warm and cold
     * variants). Returns a string suitable for dv.paragraph rendering.
     */
    _composeCardLabel(p, variant) {
        const name = (p.file && typeof p.file.name === "string") ? p.file.name : "";
        const summary = (typeof p.summary === "string") ? p.summary : "";
        const path = (p.file && typeof p.file.path === "string") ? p.file.path : "";
        const variantLabel = (variant === "warm")
            ? "Warm (read memory)"
            : "Cold (no memory)";
        // Embed the slug + path so K3-J/K/L's flat-DOM-text assertions match:
        //   warm slug "morning-briefing-personal" must appear when warm exists
        //   cold slug "morning-briefing-cold-personal" must appear when cold exists
        const slug = name || (path.split("/").pop() || "").replace(/\.md$/, "");
        const summarySnippet = summary
            ? ` — ${summary}`
            : "";
        return `${variantLabel}: [[${path}|${slug}]]${summarySnippet}`;
    }

    /**
     * Render entrypoint. Compatible with Dataview's dv-context shape AND
     * with the synthetic dv used by HC-V0951-K3-J/K/L test cases (which
     * provides only container/pages/el/header/paragraph/span/fileLink — no
     * dv.table). We therefore render as a header-per-pair + paragraph-per-
     * variant layout instead of forcing a table.
     */
    async render(dv, _opts) {
        // Embed-suppression guard (mirrors CoworkDailyHubCards convention):
        // Avoid double-rendering when the view is embedded in another note.
        if (dv && dv.container && typeof dv.container.closest === "function") {
            if (dv.container.closest(".markdown-embed")) return;
        }
        // Clear prior render (idempotency on re-evaluation).
        if (dv && dv.container && dv.container.firstChild) {
            while (dv.container.firstChild) {
                dv.container.removeChild(dv.container.firstChild);
            }
        }

        // Query MB atomic notes (warm + cold). The query string targets the
        // cowork daily atomic-note folder; the .where() filter narrows to the
        // two MB types so unrelated notes (eod-review, etc.) are dropped.
        const pages = dv.pages('"spice/cowork/daily"').where(p =>
            p && (p.type === "cowork-morning-briefing" || p.type === "cowork-morning-briefing-cold")
        );

        const pairs = this._groupPairs(pages);
        if (pairs.size === 0) {
            dv.paragraph("_No lens-shift companions found._");
            return;
        }

        // Sort by day descending (most recent first), then by engagement_id
        // ascending for stable ordering within a day.
        const keys = [...pairs.keys()].sort((a, b) => {
            const ka = pairs.get(a);
            const kb = pairs.get(b);
            if (ka.day !== kb.day) return kb.day.localeCompare(ka.day);
            return ka.engagement_id.localeCompare(kb.engagement_id);
        });

        for (const k of keys) {
            const { day, engagement_id, warm, cold } = pairs.get(k);
            dv.header(3, `${day} — ${engagement_id}`);
            if (warm) {
                dv.paragraph(this._composeCardLabel(warm, "warm"));
            }
            if (cold) {
                dv.paragraph(this._composeCardLabel(cold, "cold"));
            }
            if (!warm && cold) {
                // Cold-only branch: surface the missing-warm context so the
                // Daily Hub reader understands they're seeing a singleton.
                dv.paragraph("_No warm companion this day — lens-shift cadence fired alone._");
            } else if (warm && !cold) {
                dv.paragraph("_No cold companion this day — lens_shift cadence not scheduled._");
            }
        }
    }
}

// Node interop: CustomJS in Obsidian picks up bare class declarations
// via global scope, but test harnesses (run-helper-cases.js K3-J/K/L)
// require() this file and look up the class on `module.exports`.
// Match the same dual-export pattern other Cowork helpers use.
if (typeof module !== "undefined" && module.exports) {
    module.exports = CoworkLensShiftCards;
    module.exports.CoworkLensShiftCards = CoworkLensShiftCards;
    module.exports.default = CoworkLensShiftCards;
}
