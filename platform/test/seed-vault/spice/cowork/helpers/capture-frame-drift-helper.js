/**
 * capture-frame-drift-helper.js — v0.95.1
 *
 * Knob 2 (background tripwire) implementation. Three exports:
 *
 *   * extractThemes(syntheses, { mockResponse } = {}) → async
 *       Wraps ONE LLM call (claude-haiku-4-5-20251001 at runtime) that converts
 *       N day-syntheses → ThemeBundle[] (one per day) with shape
 *       { day, themes: string[], top_subject: string }. The optional
 *       `mockResponse` arg short-circuits the LLM call by feeding a pre-baked
 *       JSON string (used by tests + sub-skill orchestration where the agent
 *       has already gathered the JSON via its own LLM turn). This keeps the
 *       helper itself I/O-free: NO direct Anthropic SDK dependency.
 *
 *   * evaluateDrift({ themes, atomicNotes, tripwire_aspects }) → DriftReport
 *       Pure, deterministic. Evaluates three flags:
 *         - frame_repeat:        same theme STRING (case-insensitive, trimmed)
 *                                appears in ≥4 of 5 days' themes[] lists.
 *         - subject_dominance:   same top_subject (case-insensitive, trimmed)
 *                                appears in ≥3 of 5 days.
 *         - explicit_null:       canonical Knob-1 phrase appears in the LAST
 *                                3 consecutive days of MB/midday/EOD atomic
 *                                notes (file-grep, no LLM).
 *       Gates:
 *         - tripwire_aspects array provided + does NOT include "frame_drift"
 *           → returns ALL-false report (sub-skill short-circuits before LLM call).
 *         - themes[] length <5 → returns ALL-false report (insufficient history,
 *           design § 4.7).
 *       The helper itself NEVER throws.
 *
 *   * composeDriftCallout(report, voice_contract) → markdown string
 *       Renders the `> [!warning]- Frame may be stuck` callout. voice_contract
 *       is appended as an LLM-fill hint so the sub-skill author can pin the
 *       phrasing into the engagement's vibe/formality at runtime.
 *
 * Pure: no I/O, no MCP calls, no clock, no randomness, no Anthropic SDK
 * import. extractThemes is async only because the LLM call lives at the
 * sub-skill orchestration layer (the agent loop) — the helper accepts the
 * already-gathered JSON via `mockResponse` for runtime + tests symmetrically.
 *
 * Design: Docs/plans/2026-06-08-v0.95.1-anti-echo-design.md § 4.
 */
"use strict";

const CANONICAL_EXPLICIT_NULL_PHRASE = "today's gather largely continued yesterday's threads";

const FRAME_REPEAT_THRESHOLD = 4;        // ≥ 4 of 5 days same theme
const SUBJECT_DOMINANCE_THRESHOLD = 3;   // ≥ 3 of 5 days same top_subject
const EXPLICIT_NULL_CONSECUTIVE = 3;     // last 3 consecutive days
const MIN_SYNTHESES_FOR_EVAL = 5;        // <5 days → skip entirely

function _normalize(s) {
    return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function _emptyReport() {
    return {
        frame_repeat: false,
        subject_dominance: false,
        explicit_null: false,
        details: {},
    };
}

/**
 * extractThemes(syntheses, { mockResponse } = {})
 *
 * Async helper. When `mockResponse` is a string, parses it as JSON and
 * validates the ThemeBundle[] shape. When absent, throws a structured
 * error instructing the caller to feed the LLM-gathered JSON in via the
 * mockResponse channel (the helper itself is sandbox-pure; the LLM call
 * happens upstream in the sub-skill's agent loop per design § 4.3).
 *
 * @param {Array<Object>} syntheses  - 5 most-recent { day, synthesis_paragraph, carry_forward_bullets }
 * @param {Object}        [opts]
 * @param {string}        [opts.mockResponse] - pre-gathered JSON string from the LLM
 * @returns {Promise<Array<{day:string, themes:string[], top_subject:string}>>}
 * @throws {Error} when mockResponse missing OR JSON parse fails OR shape invalid.
 */
async function extractThemes(syntheses, opts) {
    const safeSyntheses = Array.isArray(syntheses) ? syntheses : [];
    const mockResponse = opts && typeof opts.mockResponse === "string" ? opts.mockResponse : null;
    if (mockResponse === null) {
        throw new Error(
            "extractThemes: no mockResponse supplied. "
            + "This helper is sandbox-pure; the sub-skill orchestrator MUST gather "
            + "the LLM JSON (claude-haiku-4-5-20251001 per design § 4.3) and feed "
            + "it in via { mockResponse: <JSON string> }."
        );
    }
    let parsed;
    try {
        parsed = JSON.parse(mockResponse);
    } catch (e) {
        throw new Error(`extractThemes: mockResponse JSON parse failed: ${e.message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error("extractThemes: parsed payload is not an array");
    }
    // Validate shape per design § 4.3 — each entry must have day:string,
    // themes:string[], top_subject:string. Normalize defensively: coerce
    // any obvious typing slips to safe defaults rather than throwing
    // mid-stream (drift evaluation should still get a clean array).
    const bundles = parsed.map((entry, idx) => {
        if (!entry || typeof entry !== "object") {
            throw new Error(`extractThemes: entry ${idx} is not an object`);
        }
        const day = typeof entry.day === "string" ? entry.day : null;
        const top_subject = typeof entry.top_subject === "string" ? entry.top_subject : "";
        const themes = Array.isArray(entry.themes)
            ? entry.themes.filter((t) => typeof t === "string")
            : [];
        if (day === null) {
            throw new Error(`extractThemes: entry ${idx} missing day string`);
        }
        return { day, themes, top_subject };
    });
    // Cross-check that the bundle count matches the input syntheses count
    // when the upstream prompt followed the design contract. We do NOT throw
    // on mismatch — the LLM may have skipped a day with insufficient content;
    // evaluateDrift handles short arrays via the <5 gate.
    if (safeSyntheses.length > 0 && bundles.length !== safeSyntheses.length) {
        // Best-effort: keep the parsed bundles as-is. The caller (sub-skill)
        // may decide to log a warning frontmatter entry per § 4.7.
    }
    return bundles;
}

/**
 * evaluateDrift({ themes, atomicNotes, tripwire_aspects })
 *
 * Deterministic 3-flag evaluator. See design § 4.4.
 *
 * @param {Object}   input
 * @param {Array<{day:string, themes:string[], top_subject:string}>} input.themes
 * @param {Array<{day:string, cadence:string, body_md:string}>}      input.atomicNotes
 * @param {string[]} [input.tripwire_aspects] - when present and excludes
 *     "frame_drift", returns no-flag report (sub-skill gate short-circuit).
 * @returns {{frame_repeat:boolean, subject_dominance:boolean, explicit_null:boolean, details:Object}}
 */
function evaluateDrift(input) {
    const report = _emptyReport();
    const safeInput = input && typeof input === "object" ? input : {};
    const themes = Array.isArray(safeInput.themes) ? safeInput.themes : [];
    const atomicNotes = Array.isArray(safeInput.atomicNotes) ? safeInput.atomicNotes : [];
    const tripwire_aspects = Array.isArray(safeInput.tripwire_aspects) ? safeInput.tripwire_aspects : null;

    // Gate 1: tripwire_aspects explicitly excludes frame_drift → all-false.
    // When tripwire_aspects is null/undefined (caller didn't pass it), we
    // proceed — the helper IS the gating surface, but the sub-skill is the
    // primary gate; we just provide the explicit short-circuit.
    if (tripwire_aspects !== null && !tripwire_aspects.includes("frame_drift")) {
        return report;
    }

    // Frame_repeat + subject_dominance require ≥5 ThemeBundle entries.
    // explicit_null is independent — operates on atomicNotes — but still
    // needs >=3 atomic notes total to fire (3 consecutive days). We DO NOT
    // run frame_repeat / subject_dominance when themes count is short.
    const themesReady = themes.length >= MIN_SYNTHESES_FOR_EVAL;

    // ----- frame_repeat -----
    if (themesReady) {
        const counts = new Map();
        for (const bundle of themes) {
            if (!bundle || typeof bundle !== "object") continue;
            const list = Array.isArray(bundle.themes) ? bundle.themes : [];
            // Per-day uniqueness: count a theme ONCE per day even if it
            // appears multiple times in the same day's list. Design § 4.4
            // talks about a theme appearing in N of M DAYS — not N total.
            const seenThisDay = new Set();
            for (const raw of list) {
                const norm = _normalize(raw);
                if (!norm || seenThisDay.has(norm)) continue;
                seenThisDay.add(norm);
                counts.set(norm, (counts.get(norm) || 0) + 1);
            }
        }
        let topTheme = null;
        let topCount = 0;
        for (const [theme, count] of counts.entries()) {
            if (count > topCount) {
                topTheme = theme;
                topCount = count;
            }
        }
        if (topCount >= FRAME_REPEAT_THRESHOLD) {
            report.frame_repeat = true;
            report.details.repeating_theme = topTheme;
            report.details.repeat_count = topCount;
        }
    }

    // ----- subject_dominance -----
    if (themesReady) {
        const subjCounts = new Map();
        for (const bundle of themes) {
            if (!bundle || typeof bundle !== "object") continue;
            const norm = _normalize(bundle.top_subject);
            if (!norm) continue;
            subjCounts.set(norm, (subjCounts.get(norm) || 0) + 1);
        }
        let topSubject = null;
        let topSubjCount = 0;
        for (const [subj, count] of subjCounts.entries()) {
            if (count > topSubjCount) {
                topSubject = subj;
                topSubjCount = count;
            }
        }
        if (topSubjCount >= SUBJECT_DOMINANCE_THRESHOLD) {
            report.subject_dominance = true;
            report.details.dominant_subject = topSubject;
            report.details.dominance_count = topSubjCount;
        }
    }

    // ----- explicit_null -----
    // Inspect atomicNotes (chronological — caller is expected to provide them
    // in day-ascending order; the last N must each contain the canonical
    // phrase). Per § 4.4: "3 consecutive days" — we look at the tail of the
    // sorted list. We do NOT require notes to be from any specific cadence
    // (MB/midday/EOD all qualify) — caller filters before passing in.
    if (atomicNotes.length >= EXPLICIT_NULL_CONSECUTIVE) {
        const sorted = atomicNotes
            .slice()
            .sort((a, b) => {
                const da = a && typeof a.day === "string" ? a.day : "";
                const db = b && typeof b.day === "string" ? b.day : "";
                return da < db ? -1 : da > db ? 1 : 0;
            });
        const tail = sorted.slice(-EXPLICIT_NULL_CONSECUTIVE);
        const allHavePhrase = tail.every((n) => {
            if (!n || typeof n.body_md !== "string") return false;
            return n.body_md.toLowerCase().includes(CANONICAL_EXPLICIT_NULL_PHRASE);
        });
        if (allHavePhrase) {
            report.explicit_null = true;
            report.details.explicit_null_consecutive_days = EXPLICIT_NULL_CONSECUTIVE;
        }
    }

    return report;
}

/**
 * composeDriftCallout(report, voice_contract)
 *
 * Renders the `> [!warning]- Frame may be stuck` callout per design § 4.5.
 * The callout body is voice-contract-aware: phrasing is canonical but a
 * trailing LLM-fill hint reminds the sub-skill author to apply the
 * engagement's vibe/formality during write composition.
 *
 * @param {{frame_repeat:boolean, subject_dominance:boolean, explicit_null:boolean, details:Object}} report
 * @param {string} voice_contract - engagement voice contract prelude (may be empty)
 * @returns {string} markdown callout block (no trailing newline)
 */
function composeDriftCallout(report, voice_contract) {
    const safeReport = report && typeof report === "object" ? report : _emptyReport();
    const fired = [];
    if (safeReport.frame_repeat) fired.push("frame_repeat");
    if (safeReport.subject_dominance) fired.push("subject_dominance");
    if (safeReport.explicit_null) fired.push("explicit_null");
    const details = safeReport.details && typeof safeReport.details === "object" ? safeReport.details : {};
    const evidenceParts = [];
    if (safeReport.frame_repeat && details.repeating_theme) {
        evidenceParts.push(`theme \`${details.repeating_theme}\` in ${details.repeat_count || "?"} of last 5 days`);
    }
    if (safeReport.subject_dominance && details.dominant_subject) {
        evidenceParts.push(`subject \`${details.dominant_subject}\` in ${details.dominance_count || "?"} of last 5 days`);
    }
    if (safeReport.explicit_null) {
        const n = details.explicit_null_consecutive_days || EXPLICIT_NULL_CONSECUTIVE;
        evidenceParts.push(`explicit-null phrase in ${n} consecutive days`);
    }
    const evidence = evidenceParts.length > 0 ? evidenceParts.join("; ") : "no specific evidence captured";
    const flagsLine = fired.length > 0 ? fired.join(", ") : "(none)";
    const vc = typeof voice_contract === "string" && voice_contract.trim() ? " Apply voice contract." : "";
    const lines = [
        "> [!warning]- Frame may be stuck",
        `> Drift flags fired: ${flagsLine}.`,
        `> Evidence: ${evidence}.`,
        "> Is this still the live frame, or has the system locked onto a stale spine?",
        `> Consider: enable \`lens_shift\` cadence for a cold-MB perspective tomorrow, or revise vault-config.md engagement.overrides.${vc}`,
    ];
    return lines.join("\n");
}

module.exports = {
    extractThemes,
    evaluateDrift,
    composeDriftCallout,
    // Constants exported for downstream + test introspection:
    CANONICAL_EXPLICIT_NULL_PHRASE,
    FRAME_REPEAT_THRESHOLD,
    SUBJECT_DOMINANCE_THRESHOLD,
    EXPLICIT_NULL_CONSECUTIVE,
    MIN_SYNTHESES_FOR_EVAL,
};
