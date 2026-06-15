// platform/blueprints/cowork/helpers/read-memory-helper.js
// Pure parser used by cowork:read-memory sub-skill.
// Parses memory.md (Tier 1) + synthesis.md (Tier 2) into structured records.
// Never throws — invalid inputs return shape with parse_error reason.

"use strict";

function parseMemoryFile(rawMarkdown) {
    const result = {
        engagement_id: null,
        day: null,
        summary: null,
        synthesis_paragraph: null,
        carry_forward_bullets: [],
        tick_count: 0,
        synthesized: false,
        synthesis_at: null,
        last_tick_at: null,
        ticks: [],
        parse_error: null
    };
    if (typeof rawMarkdown !== "string" || rawMarkdown.length === 0) {
        result.parse_error = "empty_or_non_string";
        return result;
    }
    const normalized = rawMarkdown.replace(/\r\n/g, "\n");
    const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) { result.parse_error = "no_frontmatter"; return result; }
    const fm = fmMatch[1];
    const grabFm = (key) => {
        const re = new RegExp("^" + key + ":[ \\t]*(.*)$", "m");
        const m = fm.match(re);
        if (!m) return null;
        const v = m[1].replace(/^["']|["']$/g, "");
        return v.length > 0 ? v : null;
    };
    result.engagement_id = grabFm("engagement_id");
    result.day = grabFm("day");
    result.summary = grabFm("summary");
    result.tick_count = Number(grabFm("tick_count")) || 0;
    result.synthesized = grabFm("synthesized") === "true";
    result.synthesis_at = grabFm("synthesis_at");
    result.last_tick_at = grabFm("last_tick_at");

    const synMatch = normalized.match(/>\s*\[!info\][+-]?\s*Today's pattern[^\n]*\n((?:>\s*[^\n]*\n?)+)/);
    if (synMatch) {
        result.synthesis_paragraph = synMatch[1]
            .split("\n")
            .map(l => l.replace(/^>\s?/, "").trimEnd())
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim() || null;
    }

    const cfMatch = normalized.match(/>\s*\[!tip\][+-]?\s*Carry-forward[^\n]*\n((?:>\s*[^\n]*\n?)+)/);
    if (cfMatch) {
        result.carry_forward_bullets = cfMatch[1]
            .split("\n")
            .filter(l => /^>\s?-\s/.test(l))
            .map(l => l.replace(/^>\s?-\s?/, "").trim())
            .filter(l => l.length > 0 && !/^_\(.*\)_$/.test(l));
    }

    const tickRe = /^>\s*\[!example\][+-]?\s*(\d{1,2}:\d{2})\s+Tick\s*\n((?:>\s*(?!\[![a-z]+\])[^\n]*\n?)+)/gm;
    let tm;
    while ((tm = tickRe.exec(normalized)) !== null) {
        const time = tm[1];
        const body = tm[2];
        const lines = body
            .split("\n")
            .map(l => l.replace(/^>\s?/, "").trimEnd())
            .filter(l => l.length > 0);
        const summary_line = lines[0] || "";
        const kindlist = lines
            .map(l => {
                const km = l.match(/^\*\*(\w[\w-]*):\*\*/);
                return km ? km[1].toLowerCase() : null;
            })
            .filter(Boolean);
        result.ticks.push({
            time,
            kindlist,
            summary_line,
            raw_callout_md: tm[0]
        });
    }
    return result;
}

function parseSynthesisFile(rawMarkdown) {
    const result = {
        engagement_id: null,
        iso_week: null,
        summary: null,
        weekly_pattern: null,
        carry_forward_bullets: [],
        days_covered: 0,
        synthesis_at: null,
        parse_error: null
    };
    if (typeof rawMarkdown !== "string" || rawMarkdown.length === 0) {
        result.parse_error = "empty_or_non_string"; return result;
    }
    const normalized = rawMarkdown.replace(/\r\n/g, "\n");
    const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) { result.parse_error = "no_frontmatter"; return result; }
    const fm = fmMatch[1];
    const grab = (k) => {
        const re = new RegExp("^" + k + ":[ \\t]*(.*)$", "m");
        const m = fm.match(re);
        if (!m) return null;
        const v = m[1].replace(/^["']|["']$/g, "");
        return v.length > 0 ? v : null;
    };
    result.engagement_id = grab("engagement_id");
    result.iso_week = grab("iso_week");
    result.summary = grab("summary");
    result.days_covered = Number(grab("days_covered")) || 0;
    result.synthesis_at = grab("synthesis_at");

    const wpMatch = normalized.match(/>\s*\[!info\][+-]?\s*Weekly pattern[^\n]*\n((?:>\s*[^\n]*\n?)+)/);
    if (wpMatch) {
        result.weekly_pattern = wpMatch[1]
            .split("\n")
            .map(l => l.replace(/^>\s?/, "").trimEnd())
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim() || null;
    }
    const cfMatch = normalized.match(/>\s*\[!tip\][+-]?\s*Carry-forward[^\n]*\n((?:>\s*[^\n]*\n?)+)/);
    if (cfMatch) {
        result.carry_forward_bullets = cfMatch[1].split("\n")
            .filter(l => /^>\s?-\s/.test(l))
            .map(l => l.replace(/^>\s?-\s?/, "").trim())
            .filter(l => l.length > 0 && !/^_\(.*\)_$/.test(l));
    }
    return result;
}

module.exports = { parseMemoryFile, parseSynthesisFile };
