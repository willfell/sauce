// platform/blueprints/cowork/helpers/compose-feedback-capture-helper.js
//
// v0.98.1 — Feedback-capture callout (Rail L expanded shape; EOD-only).
//
// composeFeedbackCapture(opts)
//
// Builds the Rail L body for the EOD review cadence. Replaces the v0.96.0
// kind-checkbox composeRatingCallout for EOD only. The other 4 cadences
// continue to use composeRatingCallout (see compose-body-helper.js).

const crypto = require("crypto");

const SENTINEL = "<!-- cowork:feedback-capture v=1 -->";
const SENTINEL_VERSION = "v=1";

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

function _parsePrior(priorMd) {
  const result = {
    ticks: {},
    knobs: {},
    free_text: "",
    sentinel_version: null,
    ambiguous_knobs: [],
  };
  if (!priorMd || typeof priorMd !== "string") return result;
  if (!priorMd.includes(SENTINEL)) return result;
  result.sentinel_version = SENTINEL_VERSION;

  const tickRx = /^>\s*>\s*-\s*\[([ xX])\]\s*\[\[#\^(item-[a-z]+-[0-9a-f]{7})\|/gm;
  let m;
  while ((m = tickRx.exec(priorMd)) !== null) {
    result.ticks[m[2]] = m[1].toLowerCase() === "x";
  }

  const knobLineRx = /^>\s*>\s*\*\*Fire (\w+):\*\*\s*`\[([ xX])\]\s*less`\s*`\[([ xX])\]\s*same`\s*`\[([ xX])\]\s*more`/gm;
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
  for (const item of items) {
    const itemId = _itemId(kind, item.id);
    const wasTicked = priorState && priorState.ticks && priorState.ticks[itemId] === true;
    const box = wasTicked ? "[x]" : "[ ]";
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
    lines.push("(Type prose here — anything you want cowork to know.)");
  }
  lines.push("```");
  return lines.join("\n");
}

function composeFeedbackCapture(opts) {
  const o = opts || {};
  const surfaced = o.surfaced_items_by_kind || {};
  const priorState = _parsePrior(o.prior_md);

  const head = [
    "> [!todo]+ Was today useful?",
    "> Tick items that mattered. Set per-kind frequency. Type prose for nuance. Tomorrow's brief adjusts overnight.",
    `> ${SENTINEL}`,
    ">",
  ];

  const kinds = Object.keys(surfaced).filter(
    (k) => Array.isArray(surfaced[k]) && surfaced[k].length > 0
  );

  const kindBlocks = [];
  const itemIdRegistry = {};
  const kindsWithKnobs = [];

  for (const kind of kinds) {
    kindBlocks.push(_renderKindBlock(kind, surfaced[kind], priorState));
    kindBlocks.push(">");
    kindsWithKnobs.push(kind);
    for (const item of surfaced[kind]) {
      const itemId = _itemId(kind, item.id);
      itemIdRegistry[itemId] = { kind, identifier: item.id, label: item.label };
    }
  }

  const freeText = _renderFreeTextBlock(priorState);

  const rail_md = [
    ...head,
    ...kindBlocks,
    freeText,
  ].join("\n");

  const itemCount = Object.keys(itemIdRegistry).length;
  const sidecar_observability = {
    sentinel_version: SENTINEL_VERSION,
    item_count: itemCount,
    kinds_with_knobs: kindsWithKnobs,
    ambiguous_knobs: (priorState && priorState.ambiguous_knobs) || [],
  };

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
  SENTINEL,
  SENTINEL_VERSION,
  KIND_LABELS,
};
