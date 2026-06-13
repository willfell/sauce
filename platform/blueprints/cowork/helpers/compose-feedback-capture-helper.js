// v0.101.0 — Feedback-capture callout (Rail L; ALL FIVE cadences).
//
// composeFeedbackCapture(opts)
//
// One v=4 shape: tap + free-text fence on top everywhere; below them,
// EOD renders per-item Mattered/Didn't-like lists + knobs (exact v=3
// mechanics), the other 4 cadences render ONE collapsed kind checklist.
// Replaces composeRatingCallout emission on the non-EOD cadences as of
// v0.101.0 (that function is legacy — see compose-body-helper.js).

"use strict";

const crypto = require("crypto");

const SENTINEL = "<!-- cowork:feedback-capture v=4 -->";
const SENTINEL_VERSION = "v=4";
// Prior-era sentinels — _parsePrior accepts all so every historical night
// stays readable forever (v=1: 2026-06-11; v=2: 2026-06-12; v=3: v0.99.0 era).
const SENTINEL_V3 = "<!-- cowork:feedback-capture v=3 -->";
const SENTINEL_V2 = "<!-- cowork:feedback-capture v=2 -->";
const SENTINEL_V1 = "<!-- cowork:feedback-capture v=1 -->";

// Placeholder texts ever rendered into the free-text fence. Order: oldest first.
// classifyEngagementDay (ingest-feedback-helper) treats fence content equal to
// any of these as NOT prose — keep in sync when rewording the placeholder.
const FREE_TEXT_PLACEHOLDERS = Object.freeze([
  "(Type prose here — anything you want cowork to know.)",
  "(Type prose here — name a section to scope it, e.g. `finance: too long`.)",
]);

const KIND_LABELS = {
  chat: "Chat",
  github: "GitHub",
  ado: "ADO",
  calendar: "Calendar",
  email: "Email",
  finance: "Finance",
  reminders: "Reminders",
};

function _kindLabel(kind) {
  return KIND_LABELS[kind] || (kind.charAt(0).toUpperCase() + kind.slice(1));
}

function _kindKnobLabel(kind) {
  if (kind === "github") return "GitHub";
  return kind;
}

// Item-ID hash: ^item-<kind>-<7-char-sha1-prefix> of <kind>:<canonical_identifier>.
// If identifier already starts with "<kind>:", strip it to avoid doubling.
function _itemId(kind, identifier) {
  const id = String(identifier || "");
  const cleanedId = id.startsWith(`${kind}:`) ? id.slice(kind.length + 1) : id;
  const input = `${kind}:${cleanedId}`;
  const hash = crypto.createHash("sha1").update(input).digest("hex").slice(0, 7);
  return `item-${kind}-${hash}`;
}

// Mirrored in learn-from-checks-helper.js::parseFeedbackCapture — keep the section state machines in sync.
function _parsePrior(priorMd) {
  const result = {
    ticks: {},
    downvotes: {},
    kind_ticks: {},
    knobs: {},
    free_text: "",
    sentinel_version: null,
    ambiguous_knobs: [],
    ambiguous_items: [],
    satisfaction: null,
    tap: { yes: false, no: false },
  };
  if (!priorMd || typeof priorMd !== "string") return result;
  const isV4 = priorMd.includes(SENTINEL);
  const isV3 = !isV4 && priorMd.includes(SENTINEL_V3);
  const isV2 = !isV4 && !isV3 && priorMd.includes(SENTINEL_V2);
  const isV1 = !isV4 && !isV3 && !isV2 && priorMd.includes(SENTINEL_V1);
  if (!isV4 && !isV3 && !isV2 && !isV1) return result;
  result.sentinel_version = isV4 ? "v=4" : (isV3 ? "v=3" : (isV2 ? "v=2" : "v=1"));

  // Mirrored in learn-from-checks-helper.js::parseFeedbackCapture — keep the
  // section state machines (incl. kind_ticks checklist section) in sync.
  const headerRx = /^>\s*>\s*\[!summary\]-/;
  const kindsHeaderRx = /^>\s*>\s*\[!summary\]-\s*Kinds — quick ticks/;
  const sectionRx = /^>\s*>\s*(Mattered|Didn't like):\s*$/;
  const tickRx = /^>\s*>\s*-\s*\[([ xX])\]\s*\[\[#\^(item-[a-z]+-[0-9a-f]{7})\|/;
  const kindTickRx = /^>\s*>\s*-\s*\[([ xX])\]\s+(\S+)/;
  let section = null;   // "Mattered" | "Didn't like" | "kinds" | null
  for (const line of priorMd.split("\n")) {
    if (kindsHeaderRx.test(line)) { section = "kinds"; continue; }
    if (headerRx.test(line)) { section = null; continue; }
    const s = line.match(sectionRx);
    if (s) { section = s[1]; continue; }
    if (section === "kinds") {
      const km = line.match(kindTickRx);
      if (km) result.kind_ticks[km[2].toLowerCase()] = km[1].toLowerCase() === "x";
      continue;
    }
    const m = line.match(tickRx);
    if (m) {
      const ticked = m[1].toLowerCase() === "x";
      if (section === "Didn't like") result.downvotes[m[2]] = ticked;
      else result.ticks[m[2]] = ticked;
    }
  }
  for (const id of Object.keys(result.ticks)) {
    if (result.ticks[id] === true && result.downvotes[id] === true) {
      result.ambiguous_items.push(id);
    }
  }

  const knobLineRx = /^>\s*>\s*\*\*Fire (\w+):\*\*\s*`\[([ xX])\]\s*less`\s*`\[([ xX])\]\s*same`\s*`\[([ xX])\]\s*more`/gm;
  let m;
  while ((m = knobLineRx.exec(priorMd)) !== null) {
    const kind = m[1].toLowerCase();
    const less = m[2].toLowerCase() === "x";
    const same = m[3].toLowerCase() === "x";
    const more = m[4].toLowerCase() === "x";
    const xCount = (less ? 1 : 0) + (same ? 1 : 0) + (more ? 1 : 0);
    if (xCount > 1) {
      result.knobs[kind] = { less, same, more, ambiguous: true };
      result.ambiguous_knobs.push(kind);
    } else if (xCount === 1) {
      const pos = less ? "less" : (same ? "same" : "more");
      result.knobs[kind] = { less, same, more, position: pos, ambiguous: false };
    } else {
      result.knobs[kind] = { less: false, same: false, more: false, ambiguous: false };
    }
  }

  // One-tap satisfaction line (v=3). Prefix-anchored through the `no` box so
  // trailing Tasks-plugin annotations (`✅ 2026-06-13`) are ignored.
  const tapRx = /^>\s*Useful:\s*`\[([ xX])\]\s*yes`\s*`\[([ xX])\]\s*no`/m;
  const tap = priorMd.match(tapRx);
  if (tap) {
    const yes = tap[1].toLowerCase() === "x";
    const no = tap[2].toLowerCase() === "x";
    result.tap = { yes, no };
    result.satisfaction = yes && no ? "ambiguous" : (yes ? true : (no ? false : null));
  }

  // Fences may be bare (no > prefix) or prefixed — accept both.
  const fenceRx = /(?:^>?\s*)```feedback\s*$([\s\S]*?)^>?\s*```\s*$/m;
  const fenceMatch = priorMd.match(fenceRx);
  if (fenceMatch) {
    const raw = fenceMatch[1];
    const stripped = raw
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join("\n")
      .replace(/^\s*\n+/, "")
      .replace(/\n+\s*$/, "");
    result.free_text = stripped;
  }
  return result;
}

function _renderKindBlock(kind, items, priorState) {
  const lines = [`> > [!summary]- ${_kindLabel(kind)} — items`];
  lines.push("> > Mattered:");
  for (const item of items) {
    const itemId = _itemId(kind, item.id);
    const box = priorState && priorState.ticks && priorState.ticks[itemId] === true ? "[x]" : "[ ]";
    lines.push(`> > - ${box} [[#^${itemId}|${item.label}]]`);
  }
  lines.push("> >");
  lines.push("> > Didn't like:");
  for (const item of items) {
    const itemId = _itemId(kind, item.id);
    const box = priorState && priorState.downvotes && priorState.downvotes[itemId] === true ? "[x]" : "[ ]";
    lines.push(`> > - ${box} [[#^${itemId}|${item.label}]]`);
  }
  lines.push("> >");

  const knobState = (priorState && priorState.knobs && priorState.knobs[kind]) || null;
  const less = knobState && knobState.less ? "[x]" : "[ ]";
  const same = knobState && knobState.same ? "[x]" : "[ ]";
  const more = knobState && knobState.more ? "[x]" : "[ ]";
  lines.push(`> > **Fire ${_kindKnobLabel(kind)}:** \`${less} less\` \`${same} same\` \`${more} more\``);
  return lines.join("\n");
}

function _renderKindChecklist(kinds, priorState) {
  const lines = ["> > [!summary]- Kinds — quick ticks"];
  for (const kind of kinds) {
    const k = String(kind).toLowerCase();
    const box = priorState && priorState.kind_ticks && priorState.kind_ticks[k] === true ? "[x]" : "[ ]";
    lines.push(`> > - ${box} ${_kindLabel(k)}`);
  }
  return lines.join("\n");
}

function _renderTapLine(priorState) {
  const tap = (priorState && priorState.tap) || { yes: false, no: false };
  return `> Useful: \`${tap.yes ? "[x]" : "[ ]"} yes\` \`${tap.no ? "[x]" : "[ ]"} no\``;
}

function _renderFreeTextBlock(priorState) {
  // Fences are bare (no "> " prefix) so the test replace-and-refire pattern
  // can locate them without callout-prefix awareness.
  const lines = ["> ### Free-text feedback", ">", "```feedback"];
  const priorText = (priorState && priorState.free_text) || "";
  if (priorText) {
    for (const line of priorText.split("\n")) {
      lines.push(line);
    }
  } else {
    lines.push(FREE_TEXT_PLACEHOLDERS[1]);
  }
  lines.push("```");
  return lines.join("\n");
}

function composeFeedbackCapture(opts) {
  const o = opts || {};
  const itemMode = o.cadence === "eod-review";
  const priorState = _parsePrior(o.prior_md);

  // UPGRADE-DAY transition: a same-day prior carrying only the legacy
  // rating-block marker (pre-v0.101.0 non-EOD note) still surrenders its
  // kind ticks into the new checklist. Inline require — no top-level cycle.
  if (!priorState.sentinel_version && o.prior_md) {
    const { parseRatingCallout } = require("./learn-from-checks-helper.js");
    const legacy = parseRatingCallout(o.prior_md);
    if (legacy && Array.isArray(legacy.observations)) {
      for (const obs of legacy.observations) {
        if (obs && obs.ticked) priorState.kind_ticks[String(obs.kind).toLowerCase()] = true;
      }
    }
  }

  const head = [
    "> [!todo]+ Was this useful?",
    "> One tap, a line of prose, or ticks — anything counts. Tomorrow's brief adjusts overnight.",
    `> ${SENTINEL}`,
    _renderTapLine(priorState),
    ">",
  ];

  const kindBlocks = [];
  const itemIdRegistry = {};
  const kindsWithKnobs = [];
  const items = [];
  let sidecar_observability;

  if (itemMode) {
    const surfaced = o.surfaced_items_by_kind || {};
    const kinds = Object.keys(surfaced).filter(
      (k) => Array.isArray(surfaced[k]) && surfaced[k].length > 0
    );
    for (const kind of kinds) {
      kindBlocks.push(_renderKindBlock(kind, surfaced[kind], priorState));
      kindBlocks.push(">");
      kindsWithKnobs.push(kind);
      for (const item of surfaced[kind]) {
        const itemId = _itemId(kind, item.id);
        itemIdRegistry[itemId] = { kind, identifier: item.id, label: item.label };
        items.push({ item_id: itemId, kind, identifier: item.id, label: item.label });
      }
    }
    sidecar_observability = {
      sentinel_version: SENTINEL_VERSION,
      item_count: Object.keys(itemIdRegistry).length,
      kinds_with_knobs: kindsWithKnobs,
      ambiguous_knobs: (priorState && priorState.ambiguous_knobs) || [],
      ambiguous_items: (priorState && priorState.ambiguous_items) || [],
      items,
    };
  } else {
    const kindList = (Array.isArray(o.surfaced_kinds) ? o.surfaced_kinds : [])
      .map((k) => String(k).toLowerCase());
    if (kindList.length > 0) {
      kindBlocks.push(_renderKindChecklist(kindList, priorState));
    }
    sidecar_observability = {
      sentinel_version: SENTINEL_VERSION,
      kinds_listed: kindList,
    };
  }

  const freeText = _renderFreeTextBlock(priorState);
  const rail_md = [
    ...head,
    freeText,
    ...(kindBlocks.length ? [">"] : []),
    ...kindBlocks,
  ].join("\n");

  return {
    rail_md,
    sentinel: SENTINEL,
    item_id_registry: itemIdRegistry,
    sidecar_observability,
  };
}

module.exports = {
  composeFeedbackCapture,
  _itemId,
  _parsePrior,
  _renderTapLine,
  SENTINEL,
  SENTINEL_VERSION,
  SENTINEL_V1,
  SENTINEL_V2,
  SENTINEL_V3,
  FREE_TEXT_PLACEHOLDERS,
  KIND_LABELS,
};
