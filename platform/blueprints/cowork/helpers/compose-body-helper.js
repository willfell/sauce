/* eslint-disable no-console */
/**
 * compose-body-helper.js — v0.78.0
 *
 * Pure body composer for atomic-note orchestrators in prefs-mode dispatch.
 * Takes ordered_blocks (priority-ordered) + aspect_blocks + voice-contracted
 * prompt body + synopsis/tip pre-composed strings and returns the final
 * Markdown body that gets passed to write-run-note-<orch>.
 *
 * Pure: no I/O, no MCP calls. Exists primarily for HC-V0780-E1 harness use.
 * In production, the orchestrator's agent composes the body inline using the
 * same shape — this helper documents the exact expected order.
 */
"use strict";

const NAVBUTTONS = [
    "```dataviewjs",
    'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
    "```",
].join("\n");

const dispatchHelper = require("./dispatch-plan-helper.js");
const composeVoiceContract = dispatchHelper.composeVoiceContract;

function composeBody({
    dispatch_mode,
    prefs,
    ordered_blocks,
    engagement,
    prompt_body,
    today,
    synopsis,
    tip,
    aspect_blocks,
}) {
    const sections = [];
    sections.push(NAVBUTTONS);
    sections.push("");
    sections.push(`> [!info]- Today at a glance`);
    sections.push(`> ${synopsis || "(synopsis pending — composing agent inserts at body-compose time)"}`);
    sections.push("");

    if (dispatch_mode === "prefs" && Array.isArray(ordered_blocks)) {
        for (const block of ordered_blocks) {
            sections.push(block.markdown);
            sections.push("");
        }
    }
    if (Array.isArray(aspect_blocks)) {
        for (const block of aspect_blocks) {
            sections.push(block.markdown || String(block));
            sections.push("");
        }
    }

    sections.push(`> [!tip] Today's focus`);
    sections.push(`> ${tip || "(tip pending — composing agent inserts at body-compose time)"}`);

    const body = sections.join("\n").replace(/\n{3,}/g, "\n\n");

    const voicePrefix = (dispatch_mode === "prefs") ? composeVoiceContract(prefs && prefs.personality) : "";
    const prompt_body_with_voice = (voicePrefix ? voicePrefix : "") + (prompt_body || "");

    return {
        body,
        prompt_body_with_voice,
    };
}

module.exports = {
    composeBody,
};
