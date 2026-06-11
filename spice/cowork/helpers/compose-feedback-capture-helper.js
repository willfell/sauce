// platform/blueprints/cowork/helpers/compose-feedback-capture-helper.js
//
// v0.98.2 — Feedback-capture callout (Rail L expanded shape; EOD-only).
//
// composeFeedbackCapture(opts)
//
// Builds the Rail L body for the EOD review cadence. Replaces the v0.96.0
// kind-checkbox composeRatingCallout for EOD only. The other 4 cadences
// continue to use composeRatingCallout (see compose-body-helper.js).

const crypto = require("crypto");

const SENTINEL = "<!-- cowork:feedback-capture v=2 -->";
const SENTINEL_VERSION = "v=2";
// v0.98.1-era sentinel — _parsePrior accepts it so the one night of v=1
// capture corpus (headspace 2026-06-11) stays readable forever.
const SENTINEL_V1 = "<!-- cowork:feedback-capture v=1 -->";

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
    knobs: {},
    free_text: "",
    sentinel_version: null,
    ambiguous_knobs: [],
    ambiguous_items: [],
  };
  if (!priorMd || typeof priorMd !== "string") return result;
  const isV2 = priorMd.includes(SENTINEL);
  const isV1 = !isV2 && priorMd.includes(SENTINEL_V1);
  if (!isV2 && !isV1) return result;
  result.sentinel_version = isV2 ? "v=2" : "v=1";

  // Section-aware tick scan. `Mattered:` / `Didn't like:` flip the section;
  // a new kind sub-callout header resets it. v=1 priors carry no section
  // headers, so their ticks land in `ticks` (mattered) by default — exactly
  // the v=1 semantic. Tick regex is prefix-anchored through the wikilink, so
  // trailing Tasks-plugin annotations (`✅ 2026-06-12`) are ignored.
  const headerRx = /^>\s*>\s*\[!summary\]-/;
  const sectionRx = /^>\s*>\s*(Mattered|Didn't like):\s*$/;
  const tickRx = /^>\s*>\s*-\s*\[([ xX])\]\s*\[\[#\^(item-[a-z]+-[0-9a-f]{7})\|/;
  let section = null;
  for (const line of priorMd.split("\n")) {
    if (headerRx.test(line)) { section = null; continue; }
    const s = line.match(sectionRx);
    if (s) { section = s[1]; continue; }
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
  const items = [];

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
    ambiguous_items: (priorState && priorState.ambiguous_items) || [],
    items,
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
  SENTINEL_V1,
  KIND_LABELS,
};
