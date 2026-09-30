#!/usr/bin/env node
'use strict';

// Independent BL-5c sentinel. This file deliberately does not import or share
// assertions with run-graph-view.js: it binds the production authority seams,
// the adversarial fixtures, and its own preflight registration from source.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const widget = fs.readFileSync(path.join(ROOT, 'platform/blueprints/project/helpers/graph-view.js'), 'utf8');
const behavior = fs.readFileSync(path.join(ROOT, 'platform/test/run-graph-view.js'), 'utf8');
const compactBehavior = behavior.replace(/\s+/g, ' ');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const failures = [];

function check(condition, label) {
  if (!condition) failures.push(label);
}

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = from < 0 ? -1 : source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
}

const keepSet = section(widget, '  _stuckKeepSet(nodes, analysis) {', '\n  // Selection and filters');
const controller = section(widget, '  _selectionController({', '\n  // GV-R2 epic-scope geometry');

check(keepSet.includes('this._nodeInsight(analysis, root)?.downstream'),
  'BL5B-SENTINEL-CLOSURES-DOWNSTREAM: Stuck consumes GraphInsights downstream membership');
check(keepSet.includes('this._nodeInsight(analysis, blocked)?.upstream'),
  'BL5B-SENTINEL-CLOSURES-UPSTREAM: Stuck consumes GraphInsights upstream membership');
check(!/\bedges\b|_hasPath|adjacen|\bqueue\b|\bvisited\b/i.test(keepSet),
  'BL5B-SENTINEL-NO-TRAVERSAL: Stuck keep-set contains no local graph traversal surface');
check(controller.includes('const filters = { stuck: false, dimDone: false };')
  && (widget.match(/const filters = \{ stuck: false, dimDone: false \};/g) || []).length === 1,
  'BL5B-SENTINEL-RENDER-LOCAL: filter state is allocated exactly once inside the render controller');
check(controller.includes('BL5B-FAIL-SOFT-GUARD')
  && controller.includes('if (key === "stuck" && !analysis) return;'),
  'BL5B-SENTINEL-FAIL-SOFT-GUARD: Stuck is inert without authoritative analysis');
for (const [surface, pattern] of [
  ['LOCAL-STORAGE', /\blocalStorage\b|\.setItem\s*\(|\.removeItem\s*\(/],
  ['VAULT-MUTATOR', /\.vault\s*\.\s*(?:create|modify|delete|rename|trash)\s*\(/],
  ['ADAPTER-MUTATOR', /\.adapter\s*\.\s*(?:write|append|remove|rename|process)\s*\(/],
  ['FRONTMATTER-MUTATOR', /processFrontMatter\s*\(/],
  ['COORDINATOR-MUTATOR', /\b(?:Coordinator|DeliveryCoordinator)\b/],
]) check(!pattern.test(widget),
  `BL5C-SENTINEL-NO-${surface}: GraphView contains no persistence surface`);

for (const marker of [
  'BL5B-CROSS-INSTANCE-ACTIVE',
  'BL5B-CLOSURE-DIVERGENCE',
  'BL5B-FAIL-SOFT-MISSING',
  'BL5B-FAIL-SOFT-THROWING',
]) check(behavior.includes(marker), `BL5B-SENTINEL-BEHAVIOR-MARKER: missing ${marker}`);

check(behavior.includes("bl5DivergentPerNode['BL5-A Root'].downstream = ['BL5-G Closure bridge', 'BL5-C Downstream stuck'];")
  && behavior.includes("bl5DivergentPerNode['BL5-C Downstream stuck'].upstream = ['BL5-A Root', 'BL5-G Closure bridge'];")
  && behavior.includes("for (const id of ['BL5-A', 'BL5-C', 'BL5-D', 'BL5-G'])")
  && behavior.includes("for (const id of ['BL5-B', 'BL5-E', 'BL5-F'])"),
  'BL5B-SENTINEL-DIVERGENT-FIXTURE: authoritative closure footprint remains edge-divergent');
check(behavior.includes('const bl5AtRest = JSON.parse(JSON.stringify(domShape(bl5Root)));'),
  'BL5B-SENTINEL-IMMUTABLE-BASELINE: at-rest DOM is snapshotted by value');

const activeMarker = behavior.indexOf('BL5B-CROSS-INSTANCE-ACTIVE');
const bothActive = behavior.lastIndexOf("bl5Done.listeners.click({ stopPropagation() {} });", activeMarker);
const firstClear = behavior.indexOf("bubblingClick(bl5ChipFor('BL5-A'))", activeMarker);
check(bothActive >= 0 && activeMarker > bothActive && firstClear > activeMarker,
  'BL5B-SENTINEL-ACTIVE-ORDER: second render occurs while the first widget remains filtered');

// BL5C-PREDICATE-BINDINGS: fixture markers and values are not enough. Bind
// the executable predicates themselves so replacing any carried assertion
// with unconditional truth turns this independent harness red.
for (const [label, predicate] of [
  ['ACTIVE', "assert.deepStrictEqual(domShape(bl5ActiveFreshRoot), bl5AtRest, 'BL5B-CROSS-INSTANCE-ACTIVE: a second render starts off while the first remains active');"],
  ['DIVERGENT-BRIGHT', "assert(!bl5DivergentChipFor(id).className.includes('graph-view-dimmed'), `BL5B-CLOSURE-DIVERGENCE: authoritative keep member ${id} remains bright`);"],
  ['DIVERGENT-DIM', "assert(bl5DivergentChipFor(id).className.includes('graph-view-dimmed'), `BL5B-CLOSURE-DIVERGENCE: non-member ${id} dims despite the drawn edge path`);"],
  ['FAIL-SOFT-DOM', "assert.deepStrictEqual(domShape(failSoftRoot), before, `BL5-FAIL-SOFT-${label.toUpperCase()}: Stuck is an exact no-op without authoritative GraphInsights`);"],
  ['FAIL-SOFT-CHIPS', "assert(byClass(failSoftRoot, 'graph-view-chip').every((chip) => !chip.className.includes('graph-view-dimmed')), `BL5-MUTANT-${label.toUpperCase()}-INSIGHTS-BRIDGE: unavailable analysis never dims a connecting-chain chip`);"],
  ['ZERO-VAULT-WRITES', "assert.deepStrictEqual(mutations, [], 'every render across every case stayed write-free');"],
  ['ZERO-PERSISTENCE-WRITES', "assert.deepStrictEqual(persistenceMutations, [], 'BL4-BL5-ZERO-PERSISTENCE-SURFACES: selection and filters invoke no localStorage or coordinator mutation surface');"],
]) check(compactBehavior.includes(predicate),
  `BL5C-SENTINEL-${label}-PREDICATE: executable behavioral predicate is exact`);
check(!/\bassert(?:\.ok)?\s*\(\s*true\b/.test(behavior),
  'BL5C-SENTINEL-NO-UNCONDITIONAL-ASSERT: behavior harness contains no assert(true) substitution');

// PH-1 phone-first and PH-9c live-resize sentinels (independent of the
// behavioral harness's own scans): the width resolver's order and its
// scroller measurement, the DOM-measurement containment, the pane-width
// watch's source shape and scoped timers, the compact map's reuse of the edge
// and selection seams, the inline detail card, and the behavior harness's
// markers.
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const resolver = section(widget, '  _resolveWidth(dv, overrides) {', '\n  // Disconnects the pane-width watch');
const noteScroller = section(widget, '  _noteScroller(container) {', '\n  // Resolved ONCE per render');
const disconnectWatch = section(widget, '  _disconnectWidthWatch(container) {', '\n  // Live pane resize (PH-9c).');
const paneWatch = section(widget, '  _watchPaneWidth(dv, overrides, root, resolved) {', '\n  async render(dv, overrides) {');
const renderEntry = section(widget, '  async render(dv, overrides) {', '\n  // The body of render().');
const renderBody = section(widget, '  async _renderAtWidth(dv, overrides, decided) {', '\n}\n');
const compactMap = section(widget, '  async _renderCompactMap(root, result, api, source, warnings, geometry) {', '\n  // One id pill per slice');
const inlineCard = section(widget, '  _renderDetailInline(host, node, context) {', '\n  // Stuck filtering consumes GraphInsights closures only.');
check(resolver.length > 0 && noteScroller.length > 0 && disconnectWatch.length > 0 && paneWatch.length > 0 && renderEntry.length > 0
  && renderBody.length > 0 && compactMap.length > 0 && inlineCard.length > 0,
'PH1-SENTINEL-SEAMS: _resolveWidth, _noteScroller, _disconnectWidthWatch, the pane-width watch installer, render, _renderAtWidth, _renderCompactMap, and _renderDetailInline are present');
const returnOrder = ['source: "override"', 'source: "measured"', 'source: "mobile-class"'].map((token) => resolver.indexOf(token));
check(returnOrder.every((index) => index >= 0)
  && returnOrder[0] < returnOrder[1] && returnOrder[1] < returnOrder[2]
  && resolver.indexOf('overrides.containerWidth') < resolver.indexOf('this._noteScroller(container)')
  && resolver.lastIndexOf('offsetWidth') < resolver.indexOf('_isMobileBody()')
  && resolver.lastIndexOf('clientWidth') < resolver.indexOf('_isMobileBody()')
  && resolver.indexOf('_isMobileBody()') < resolver.lastIndexOf('return wide;'),
'PH1-SENTINEL-WIDTH-ORDER: width resolves override, then the note scroller\'s content width (the container\'s clientWidth without a scroller or a computed style), then the is-mobile body class, then default');
check(resolver.includes('narrow: false, source: "default"') && (resolver.match(/return wide;/g) || []).length === 2,
  'PH1-SENTINEL-WIDTH-DEFAULT: the default resolution is wide, on the fall-through and on any throw');
check(resolver.includes('const explicit = typeof raw === "number" ? raw : NaN;')
  && resolver.includes('      try {\n        const container = dv?.container;\n        const scroller = this._noteScroller(container);\n        const style = scroller && typeof globalThis.getComputedStyle === "function"\n          ? globalThis.getComputedStyle(scroller)\n          : null;\n        if (!style) {\n          measured = Number(container?.clientWidth);\n        } else {\n          const px = (name) => Number.parseFloat(style[name]);\n          const padding = px("paddingLeft") + px("paddingRight");\n          measured = String(style.scrollbarGutter || "").includes("stable")\n            ? Number(scroller.clientWidth) - padding\n            : Number(scroller.offsetWidth) - px("borderLeftWidth") - px("borderRightWidth") - padding;\n        }\n      } catch (_e) { measured = NaN; }')
  && resolver.includes('return { width: measured, narrow: this._isNarrow(measured), source: "measured" };')
  && resolver.indexOf('catch (_e) { measured = NaN; }') < resolver.indexOf('if (this._isMobileBody())')
  && noteScroller.includes('const found = typeof container?.closest === "function"\n      ? container.closest(".markdown-preview-view, .cm-scroller")\n      : null;'),
'PH9B-RESOLVER-SENTINEL (PH9-RESOLVER-SENTINEL-OFFSETWIDTH): only a number is an override; the measurement is the content width of dv.container.closest(".markdown-preview-view, .cm-scroller") from its computed style (clientWidth less padding under a stable scrollbar gutter, otherwise offsetWidth less borders and padding) with dv.container.clientWidth as the fallback, and a read that throws is unmeasured and still reaches the is-mobile check');
check(!widget.replace(resolver, '').includes('clientWidth') && !widget.replace(resolver, '').includes('offsetWidth')
  && !widget.replace(resolver, '').includes('getComputedStyle')
  && !widget.replace(noteScroller, '').includes('.closest(')
  && !widget.replace(paneWatch, '').includes('ResizeObserver') && !widget.replace(paneWatch, '').includes('MutationObserver')
  && !/matchMedia|\bdv\.current\b|isConnected/.test(widget),
'PH1-SENTINEL-MEASUREMENT-CONTAINED: clientWidth, offsetWidth, and getComputedStyle appear only inside _resolveWidth, .closest( calls appear only inside _noteScroller, ResizeObserver and MutationObserver only inside the watch installer, and matchMedia, dv.current, and isConnected nowhere');
check(disconnectWatch.includes('if (container && typeof container === "object") this._widthWatches?.get(container)?.disconnect();')
  && paneWatch.includes('this._disconnectWidthWatch(container);\n      if (!this._widthWatches) this._widthWatches = new WeakMap();')
  && paneWatch.includes('owners.set(container, watch);')
  && paneWatch.includes('if (owners.get(container) === watch) owners.delete(container);')
  && renderBody.indexOf('this._disconnectWidthWatch(dv && typeof dv === "object" ? dv.container : null);') >= 0
  && renderBody.indexOf('this._disconnectWidthWatch(') < renderBody.indexOf('const RS = globalThis.customJS?.RenderSafe;')
  && (widget.match(/this\._widthWatches\s*=[^=]/g) || []).length === 1
  && (paneWatch.match(/this\._[A-Za-z]+\s*=[^=]/g) || []).join() === 'this._widthWatches = ,this._paneWatches = ',
'PH9C-SENTINEL-PER-CONTAINER-WATCH: the pane-width watch is owned per mount container in one WeakMap keyed by dv.container, every render disconnects its container\'s watch before it reads RenderSafe, and every install disconnects it too');
check(paneWatch.includes('const removed = () => root.parentNode !== container;')
  && paneWatch.includes('if (removed()) return null;')
  && paneWatch.indexOf('if (removed()) return null;') < paneWatch.indexOf('this._disconnectWidthWatch(container);')
  && paneWatch.includes('gone: () => removed() || (target !== container && this._noteScroller(container) !== target),')
  && paneWatch.includes('if (watch.gone()) { watch.disconnect(); return; }')
  && paneWatch.includes('if (removed()) watch.disconnect();')
  && paneWatch.includes('for (const peer of [...peers]) if (peer.gone()) peer.disconnect();')
  && paneWatch.includes('childList.observe(container, { childList: true });')
  && (paneWatch.match(/new Mutation\(/g) || []).length === 1
  && (paneWatch.match(/resize\.observe\(target\);/g) || []).length === 1
  && paneWatch.includes('const target = this._noteScroller(container) || container;'),
'PH9C-SENTINEL-WATCH-LIFECYCLE: one resize observer on the note scroll container (or the mount container), removal is root.parentNode !== container seen by a childList watch on the container and re-checked at every step, a container that left its scroll container is gone, a new watch disconnects gone watches on its scroll container, and an already-removed root watches nothing');
check(paneWatch.includes('|| resolved.source === "override" || typeof Resize !== "function") return null;')
  && paneWatch.includes('const drawnNarrow = resolved.narrow === true;\n      const drawnWidth = resolved.source === "measured" ? resolved.width : NaN;')
  && paneWatch.includes('resize = new Resize(() => step("notify"));')
  && paneWatch.includes('          const fresh = this._resolveWidth(dv, overrides);\n          if (fresh.source !== "measured") {\n            if (kind !== "recheck") arm(250, "recheck");\n            return;\n          }\n          if (fresh.narrow === drawnNarrow && (!fresh.narrow || fresh.width === drawnWidth)) { stopTimer(); return; }\n          if (kind === "notify") { arm(120, "debounce"); return; }\n          watch.disconnect();\n          this._renderAtWidth(dv, overrides, fresh);')
  && renderEntry.includes('return this._renderAtWidth(dv, overrides, null);')
  && renderBody.includes('const resolved = decided && decided.source === "measured" ? decided : this._resolveWidth(dv, overrides);')
  && (paneWatch.match(/this\._renderAtWidth\(/g) || []).length === 1
  && (widget.match(/this\._renderAtWidth\(dv, overrides, fresh\)/g) || []).length === 1
  && !/contentRect|entries|this\.render\(/.test(paneWatch),
'PH9C-SENTINEL-RESOLVED-HANDOFF: a notification only triggers a step, which, unless the watch is gone, re-resolves the same measurement (never the notification box); unmeasured keeps the drawn presentation and, except at the re-check, arms the re-check; a different presentation (wide against compact, or a compact width other than the width the render measured, which an unmeasured render lacks) arms the debounce at a notification and, at the debounce or the re-check, disconnects before the only _renderAtWidth call in the installer, which is handed that resolution so the re-render reads no width');
check((paneWatch.match(/\.disconnect\(\)/g) || []).length === 7
  && !widget.replace(paneWatch, '').replace(disconnectWatch, '').includes('.disconnect(')
  && paneWatch.includes('try { stopTimer(); } catch (_e) { /* already cleared */ }')
  && paneWatch.includes('try { resize?.disconnect(); } catch (_e) { /* already disconnected */ }')
  && paneWatch.includes('try { childList?.disconnect(); } catch (_e) { /* already disconnected */ }')
  && paneWatch.includes('watch?.disconnect();\n      return null;'),
'PH9C-SENTINEL-ONE-DISCONNECT: one disconnect routine clears the pending timer and disconnects both observers, and the installer\'s catch calls it');
// PH9B-SCOPED-TIMER-BAN (PH9-TIMER-BAN-SCOPED): PH-1c's blanket timer and
// band/settle/streak/debounce bans become one scoped ban: the 120ms debounce
// and the 250ms re-check are the only timers, armed inside the watch.
check((paneWatch.match(/globalThis\.setTimeout\(/g) || []).length === 1
  && (paneWatch.match(/globalThis\.clearTimeout\(/g) || []).length === 1
  && !/setTimeout|clearTimeout/.test(widget.replace(paneWatch, ''))
  && JSON.stringify((paneWatch.match(/\barm\((\d+),/g) || []).sort()) === JSON.stringify(['arm(120,', 'arm(250,']),
'PH9B-SCOPED-TIMER-BAN: setTimeout and clearTimeout appear once each, inside the watch installer, and the only delays are the 120ms debounce and the 250ms re-check');
for (const identifier of [
  '_flipStreak', '_flipStreaks', '_widthFlipAllowed', 'settleCheck', 'boundedCheck', 'bistable', 'withinBand',
  'sawCompactWide', 'sawWideNarrow', '_handoffWidthRender', '_beginWidthRender', '_resetWidthState', '_widthState',
  '_widthHandoffs', '_installWidthObserver', '_installColdLoadObserver', '_disarmColdLoad', '_coldLoads',
  'setInterval', 'requestAnimationFrame',
]) check(!widget.includes(identifier), `PH9B-SCOPED-TIMER-BAN: graph-view.js contains no ${identifier}`);
check(!/band|settle|streak|hold|bistable/i.test(widget),
  'PH9B-SCOPED-TIMER-BAN: graph-view.js names no band, settle, streak, hold, or bistable state');
check(renderBody.indexOf('const resolved = ') >= 0
  && renderBody.indexOf('const resolved = ') < renderBody.indexOf('previous?.remove?.();')
  && (renderBody.match(/this\._resolveWidth\(/g) || []).length === 1
  && renderBody.includes('this._watchPaneWidth(dv, overrides, root, resolved);')
  && (widget.match(/this\._watchPaneWidth\(/g) || []).length === 1,
'PH1-SENTINEL-ONE-LAYOUT-STATE: a render resolves the width at most once, before removing the previous root, and is the only caller of the watch installer');
check(compactMap.includes('this._edgeSvg(') && compactMap.includes('this._selectionController({')
  && compactMap.includes('this._loadOutcomes(') && !/new\s+ResizeObserver|querySelector|getBoundingClientRect|offsetWidth/.test(compactMap),
'PH1-SENTINEL-COMPACT-REUSE: the compact map calls _edgeSvg, _selectionController, and _loadOutcomes, and contains no new ResizeObserver, querySelector, getBoundingClientRect, or offsetWidth');
check(inlineCard.includes('this._renderDetailPanel(host,') && !/position:\s*fixed|document\.body|appendChild/.test(inlineCard),
  'PH1-SENTINEL-INLINE-CARD: the detail card is the shared labeled-rows builder on its host, never a body-fixed overlay');
check(!/position:\s*fixed/.test(widget), 'PH1-SENTINEL-NO-FIXED: GraphView positions nothing fixed');
for (const marker of [
  'PH1C-WIDTH-RESOLUTION', 'PH1C-NO-SIDEWAYS-SCROLL', 'PH1C-SHORT-ID-RULE', 'PH1C-FALLBACK-DOCUMENTED',
  'PH1C-WIDE-BYTE-IDENTICAL', 'PH1C-DETAIL-INLINE-OUTCOME', 'PH1C-NO-CONTINUOUS-OBSERVER', 'PH1C-ONE-SHOT-COLD-LOAD',
  'PH1C-UNMEASURED-RECOVERS', 'PH1C-ONE-SHOT-NO-LEAK', 'PH1C-ONE-SHOT-USES-ITS-MEASUREMENT', 'PH1C-ONE-SHOT-LATE-ATTACH',
]) check(behavior.includes(marker), `PH1-SENTINEL-BEHAVIOR-MARKER: missing ${marker}`);
// PH-9c and PH-9d markers each lead a string literal.
for (const marker of [
  'PH9-PRESENTATION-INDEPENDENT-MEASUREMENT', 'PH9-OBSERVER-CONVERGES', 'PH9-DRAG-ENDS-CORRECT', 'PH9-SCROLLBAR-CANNOT-FLIP',
  'PH9-UNREADABLE-KEEPS-AND-RECHECKS', 'PH9-LIFECYCLE', 'PH9B-OBSERVER-AFTER-MEASURED', 'PH9B-SCOPED-TIMER-BAN',
  'PH9B-RESOLVER-SENTINEL', 'PH9C-SETTLED-INVARIANT', 'PH9C-ONE-SHOT-EQUIVALENTS', 'PH9D-CONTENT-WIDTH',
  'PH9D-BOUNDED-WIDTH-CLAIMS',
]) check(new RegExp(`['\`]${escapeRegExp(marker)}[ :(]`).test(behavior), `PH9C-SENTINEL-BEHAVIOR-MARKER: ${marker} leads a string literal`);
// PH9C-ONE-SHOT-EQUIVALENTS: each PH-1c one-shot token listed below is
// carried in parentheses after PH9C-ONE-SHOT-EQUIVALENTS in a string literal.
for (const token of [
  'PH1C-SIBLING-CHANGE-KEEPS-ARMED', 'PH1C-RESIZE-CALLBACK-REMOVAL', 'PH1C-RENDER-START-DISARM', 'PH1C-ARM-ONLY-WHILE-ATTACHED',
  'PH1C-ONE-SHOT-NO-LEAK', 'PH1C-ONE-SHOT-USES-ITS-MEASUREMENT', 'PH1C-ONE-SHOT-LATE-ATTACH', 'PH1C-ONE-SHOT-COLD-LOAD',
  'PH1C-UNMEASURED-RECOVERS',
]) {
  check(new RegExp(`['\`]PH9C-ONE-SHOT-EQUIVALENTS \\(${escapeRegExp(token)}\\): `).test(behavior),
    `PH9C-SENTINEL-ONE-SHOT-EQUIVALENT: ${token} appears in parentheses after PH9C-ONE-SHOT-EQUIVALENTS in a string literal`);
}
for (const token of [
  'PH1-OBSERVER-DISAGREEMENT-LOOP', 'PH1-FLIP-CAP-LOST-CROSSING', 'PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT',
  'PH1B-PERMANENT-HOLD', 'PH1B-FALSE-BISTABLE-PROOF', 'PH1B-THROWING-GETTER-DROPS-CROSSING',
  'PH1-BROWSER-LIKE-OBSERVER-STUB', 'PH1-EIGHT-RANKS-OVERFLOW', 'PH1-OVERRIDE-NUMBER-ONLY', 'PH1-WIDE-DIGEST-PINS',
  'PH1-GLYPH-SITE-COUNT-FIVE',
]) {
  check(new RegExp(`['\`][^'\`\\n]*${escapeRegExp(token)}|// MUTATION GUARD: [^\\n]*${escapeRegExp(token)}`).test(behavior),
    `PH1-SENTINEL-CARRIED-FINDING: ${token} appears in a string literal or a MUTATION GUARD comment`);
}
for (const mutant of [
  'PH1-MUTANT-DROP-CLAMP', 'PH1-MUTANT-THRESHOLD-INCLUSIVE', 'PH1-MUTANT-SKIP-MOBILE-CLASS', 'PH1C-MUTANT-COERCED-OVERRIDE',
  'PH1C-MUTANT-OBSERVER-AFTER-MEASURED', 'PH1C-MUTANT-ONE-SHOT-TWICE', 'PH1-MUTANT-FIXED-OVERLAY',
  'PH1-MUTANT-RERENDER-EVERY-TICK', 'PH1C-MUTANT-OBSERVER-OWN-MEASUREMENT', 'PH1C-MUTANT-KEEP-PARTIAL-HOST',
  'PH1C-MUTANT-DISARM-ON-NOTIFICATION-ONLY', 'PH1C-MUTANT-PER-INSTANCE-KEY', 'PH1C-MUTANT-ISCONNECTED-REMOVAL',
  'PH1C-MUTANT-RERENDER-REREADS',
]) {
  check(behavior.includes(`// MUTATION GUARD: ${mutant} turns RED`)
    && new RegExp(`['\`]${escapeRegExp(mutant)}[ :(]`).test(behavior),
  `PH1-SENTINEL-MUTANT: ${mutant} is named in a MUTATION GUARD comment and leads a string literal`);
}
// The card's documented PH-9c mutants and the watch's own mutants are each
// named in a MUTATION GUARD comment.
for (const mutant of [
  'PH9C-MUTANT-CONTAINER-CLIENTWIDTH', 'PH9C-MUTANT-SCROLLER-CLIENTWIDTH', 'PH9C-MUTANT-READING-VIEW-ONLY',
  'PH9C-MUTANT-EDITOR-ONLY', 'PH9C-MUTANT-ZERO-SCROLLER-FALLS-BACK', 'PH9C-MUTANT-THROW-FALLS-BACK',
  'PH9C-MUTANT-CLOSEST-REQUIRED', 'PH9C-MUTANT-WATCH-MOUNT-CONTAINER', 'PH9C-MUTANT-WATCH-ON-OVERRIDE',
  'PH9C-MUTANT-DEBOUNCE-SKIPS-RERESOLVE', 'PH9C-MUTANT-UNREADABLE-DEFAULTS-WIDE', 'PH9C-MUTANT-UNREADABLE-NO-RECHECK',
  'PH9C-MUTANT-UNREADABLE-KEEPS-PENDING-DEBOUNCE', 'PH9C-MUTANT-RECHECK-REPEATS', 'PH9C-MUTANT-DISCONNECT-KEEPS-TIMER',
  'PH9C-MUTANT-RERUN-KEEPS-OBSERVER', 'PH9C-MUTANT-NO-PANE-PRUNE', 'PH9C-MUTANT-PRUNE-EVERY-PEER',
  'PH9C-MUTANT-KEEPS-LEFT-PANE', 'PH9C-MUTANT-DRAWN-FROM-DOM', 'PH9C-MUTANT-DEBOUNCE-119', 'PH9C-MUTANT-DEBOUNCE-121',
  'PH9C-MUTANT-RECHECK-249', 'PH9C-MUTANT-RECHECK-251',
  'PH9D-MUTANT-IGNORE-PADDING', 'PH9D-MUTANT-ONE-SIDE-PADDING', 'PH9D-MUTANT-STABLE-IGNORED', 'PH9D-MUTANT-GUTTER-EXACT-MATCH',
  'PH9D-MUTANT-BORDER-BOX-THRESHOLD', 'PH9D-MUTANT-CLIENTWIDTH-SCROLLBAR', 'PH9D-MUTANT-IGNORE-BORDERS',
  'PH9D-MUTANT-NO-CSSOM-USES-SCROLLER', 'PH9D-MUTANT-NARROW-ONLY-PRESENTATION', 'PH9D-MUTANT-UNMEASURED-NEVER-RERENDERS',
  'PH9D-MUTANT-WIDTH-WITHOUT-DEBOUNCE', 'PH9D-MUTANT-STABLE-SUBTRACTS-BORDERS', 'PH9D-MUTANT-PADDING-PARSEINT',
  'PH9D-MUTANT-LEFT-PADDING-TWICE', 'PH9D-MUTANT-RIGHT-PADDING-TWICE', 'PH9D-MUTANT-LEFT-BORDER-TWICE',
  'PH9D-MUTANT-RIGHT-BORDER-TWICE', 'PH9D-MUTANT-GONE-ONLY-WITHOUT-SCROLLER',
  'PH9D-MUTANT-INTERACTION-CANCELS-DEBOUNCE', 'PH9D-MUTANT-INTERACTION-DEFERS-TO-RECHECK', 'PH9D-MUTANT-INTERACTION-CANCELS-RECHECK',
  'PH9D-MUTANT-WIDENING-DEBOUNCE-119', 'PH9D-MUTANT-PEERS-CLEARED', 'PH9D-MUTANT-PRUNE-FIRST-GONE-ONLY',
  'PH9D-MUTANT-PRUNE-LAST-PEER-ONLY', 'PH9D-MUTANT-DRAWN-STATE-ON-INSTANCE', 'PH9D-MUTANT-COMPACT-WIDTH-TOLERANCE',
  'PH9D-MUTANT-STABLE-READS-CONTAINER', 'PH9D-MUTANT-STABLE-THROW-USES-OFFSET', 'PH9D-MUTANT-PANE-SET-COPIED',
]) {
  check(behavior.includes(`// MUTATION GUARD: ${mutant} turns RED`),
    `PH9C-SENTINEL-MUTANT: ${mutant} is named in a MUTATION GUARD comment`);
}
// PH-1d sentinels: the listed PH1D-* markers, the listed PH1C-* finding tokens,
// the listed PH-1d mutants' MUTATION GUARD comments, and the behavior
// harness's assertion floor and exit guard.
for (const marker of [
  'PH1D-GEOMETRY-BOUNDARIES', 'PH1D-PILL-PRESENTATION', 'PH9C-ONE-SHOT-EQUIVALENTS', 'PH1D-FAIL-SOFT-ROLLBACK',
  'PH1D-HARNESS-FLOOR',
]) check(new RegExp(`['\`]${escapeRegExp(marker)} \\(PH1C-`).test(behavior), `PH1D-SENTINEL-BEHAVIOR-MARKER: ${marker} (PH1C-...) leads a string literal`);
for (const token of [
  'PH1C-SHORT-ID-BOUNDARY', 'PH1C-SCROLL-BOUNDARY', 'PH1C-FAIL-SOFT-WARNING-ROLLBACK', 'PH1C-PILL-TINTS',
  'PH1C-SVG-SIZED-TO-CANVAS', 'PH1C-HARNESS-NOT-VACUOUS', 'PH1C-NEEDS-YOU-NOT-ON-STUB',
]) {
  check(new RegExp(`['\`]PH1D-[A-Z-]+ \\(${escapeRegExp(token)}\\): `).test(behavior),
    `PH1D-SENTINEL-CARRIED-FINDING: ${token} appears in parentheses after a PH1D-* marker that leads a string literal`);
}
for (const mutant of [
  'PH1D-MUTANT-SHORT-ID-BELOW-71', 'PH1D-MUTANT-SHORT-ID-BELOW-73', 'PH1D-MUTANT-SHORT-ID-INCLUSIVE',
  'PH1D-MUTANT-SCROLL-INCLUSIVE', 'PH1D-MUTANT-ALLOWANCE-ALWAYS', 'PH1D-MUTANT-ALLOWANCE-NEVER',
  'PH1D-MUTANT-SCROLLER-PADDING-FIXED', 'PH1D-MUTANT-UNTINTED-BORDER', 'PH1D-MUTANT-UNTINTED-BACKGROUND',
  'PH1D-MUTANT-SVG-SIZED-TO-W', 'PH1D-MUTANT-NEEDS-YOU-ON-STUB', 'PH1D-MUTANT-DISARM-ON-ANY-CHILDLIST',
  'PH1D-MUTANT-RESIZE-IGNORES-REMOVAL', 'PH1D-MUTANT-NO-RENDER-START-DISARM', 'PH1D-MUTANT-ARM-AFTER-REMOVAL',
  'PH1D-MUTANT-NO-WARNING-ROLLBACK', 'PH1D-MUTANT-NARROW-NEVER-SETTLES', 'PH1D-MUTANT-COLD-LOAD-NEVER-SETTLES',
]) {
  check(behavior.includes(`// MUTATION GUARD: ${mutant} turns RED`),
    `PH1D-SENTINEL-MUTANT: ${mutant} is named in a MUTATION GUARD comment`);
}
// PH-1d repair markers and their mutants. An entry with IDs carries them in
// parentheses after the marker; a null entry carries none.
for (const [marker, ids] of [
  ['PH1D-RESOLVED-WIDTH-BOUND', 'F10, F12'], ['PH1D-COLUMN-FORMULA', 'G21, G50'], ['PH1D-NARROW-WARNINGS', 'F11'],
  ['PH1D-HAIRLINE-CASCADE', 'P23'], ['PH1D-COMPACT-HOST-GRID', 'C12'], ['PH1D-RESIZE-REMOVAL-UNMEASURED', 'O25'],
  ['PH1D-OBSERVE-FAILURE', 'O28'], ['PH1D-SHORT-ID-UNPARSEABLE', 'L04'], ['PH1D-GLYPH-COLOUR', 'P12'],
  ['PH1D-MOBILE-CLASS-READ', null], ['PH1D-COMPACT-DECLARATIONS', null], ['PH1D-STUB-VIOLATIONS', null],
  ['PH1D-FAILSOFT-CHROME', null], ['PH1D-STUB-CLOSE', null], ['PH1D-ROLLBACK-TO-BEFORE', null],
  ['PH1D-MEASURED-WIDE-PIN', null], ['PH1D-EMPTY-NARROW', null],
  ['PH1D-MEASURED-FINITE', null], ['PH1D-RESOLVER-FAULT', null], ['PH1D-POSITIVE-WIDTHS', null],
  ['PH1D-ARGS-OBJECT-ONLY', null], ['PH1D-GEOMETRY-RANKS', null], ['PH1D-HANDOFF-BOUNDARY', null],
  ['PH1D-ONE-SHOT-HANDOFF-BOUNDARY', null], ['PH1D-ONE-SHOT-AFTER-RENDER-ERROR', null],
  ['PH1D-ONE-SHOT-SINGLE-OWNER', null], ['PH1D-ONE-SHOT-ROOT-MOVED', null], ['PH1D-EARLY-RETURN-DISARM', null],
  ['PH1D-ONE-SHOT-MEASURED-ONLY', null], ['PH1D-ONE-SHOT-KEEPS-ARGS', null],
  ['PH1D-FRACTIONAL-WIDTH', null], ['PH1D-MANY-RANKS', null], ['PH1D-MULTI-ROW', null], ['PH1D-STUB-ROWS', null],
  ['PH1D-EDGE-BEND', null], ['PH1D-VERY-WIDE', null], ['PH1D-TINY-WIDTH', null], ['PH1D-CARD-UNDER-CANVAS', null],
  ['PH1D-DETAIL-BUTTONS', null], ['PH1D-ONE-SHOT-SAME-PRESENTATION', null], ['PH1D-MUTATION-API-NOT-A-FUNCTION', null],
  ['PH1D-CONTAINER-REPLACED', null],
  ['PH1D-COMPACT-WIDE-PARITY', null], ['PH1D-CARD-UNDER-MAP', null], ['PH1D-SHORT-ID-STUB', null],
  ['PH1D-NONCANONICAL-STATUS', null], ['PH1D-ONE-DISARM', null], ['PH1D-ROOT-MOVED-DURING-RENDER', null],
  ['PH1D-DECIDED-RENDER-DISARMS', null], ['PH1D-PARTIAL-RENDER-ARMS-NOTHING', null],
  ['PH1D-SHORT-ID-MIXED', null], ['PH1D-STUB-WITHOUT-LABEL', null], ['PH1D-ONE-INSTANCE-TWO-EPICS', null],
  ['PH1D-NO-RESIZE-LISTENERS', null], ['PH1D-PROJECT-SCOPE-WIDTH', null],
  ['PH1D-INTERACT-WHILE-ARMED', null], ['PH1D-UNRECOGNIZED-STATUSES', null],
]) {
  const lead = ids ? `${marker} \\(${ids}\\): ` : `${marker}: `;
  check(new RegExp(`['\`]${lead}`).test(behavior),
    `PH1D-SENTINEL-REPAIR-MARKER: ${marker}${ids ? ` (${ids})` : ''} leads a string literal`);
}
for (const mutant of [
  'PH1D-MUTANT-COMPACT-WIDTH-390', 'PH1D-MUTANT-COMPACT-WIDTH-CAPPED', 'PH1D-MUTANT-NUMERATOR-SINGLE-PAD',
  'PH1D-MUTANT-NUMERATOR-PLUS-ONE', 'PH1D-MUTANT-COLUMN-BY-INDEX', 'PH1D-MUTANT-ZERO-WIDTH-ACCEPTED',
  'PH1D-MUTANT-NARROW-WARNINGS-DROPPED', 'PH1D-MUTANT-HAIRLINE-BEFORE-SHORTHAND', 'PH1D-MUTANT-HOST-NO-MIN-WIDTH',
  'PH1D-MUTANT-REMOVAL-AFTER-MEASURED-RETURN', 'PH1D-MUTANT-OBSERVE-FAILURE-KEEPS-ARMED', 'PH1D-MUTANT-SKIP-UNPARSEABLE-ID',
  'PH1D-MUTANT-IDLESS-LABEL-EMPTY', 'PH1D-MUTANT-GLYPH-UNCOLOURED', 'PH1D-MUTANT-NO-CLASSNAME-FALLBACK',
  'PH1D-MUTANT-CLASSNAME-SUBSTRING', 'PH1D-MUTANT-CLASSLIST-OR-CLASSNAME', 'PH1D-MUTANT-MOBILE-READ-FAULT-IS-MOBILE',
  'PH1D-MUTANT-PILL-DECLARATION', 'PH1D-MUTANT-PILL-OUTSIDE-CANVAS', 'PH1D-MUTANT-ID-SPAN-DECLARATION',
  'PH1D-MUTANT-MAP-DECLARATION', 'PH1D-MUTANT-MISSING-STATUS-DETAIL', 'PH1D-MUTANT-INERT-PILL-WITHOUT-INSIGHTS',
  'PH1D-MUTANT-OWNERSHIP-PER-INSTALL', 'PH1D-MUTANT-OWNERSHIP-NOT-RECORDED', 'PH1D-MUTANT-FAILSOFT-REMOVES-EVERY-CHILD',
  'PH1D-MUTANT-STUB-WITHOUT-CLOSE', 'PH1D-MUTANT-ROLLBACK-TO-ZERO', 'PH1D-MUTANT-MEASURED-WIDE-ATTRIBUTE',
  'PH1D-MUTANT-EMPTY-NARROW-THROWS', 'PH1D-MUTANT-MEASURED-NOT-FINITE', 'PH1D-MUTANT-RESOLVER-RETHROWS',
  'PH1D-MUTANT-OVERRIDE-AT-LEAST-ONE', 'PH1D-MUTANT-MEASURED-AT-LEAST-ONE', 'PH1D-MUTANT-MEASURED-PARSEINT',
  'PH1D-MUTANT-ARGS-ANY-TRUTHY', 'PH1D-MUTANT-RANKS-ARGUMENT-IGNORED', 'PH1D-MUTANT-DERIVED-RANKS-DESCENDING',
  'PH1D-MUTANT-ZERO-RANKS', 'PH1D-MUTANT-EMPTY-SET-SHARES-PREFIX', 'PH1D-MUTANT-COMPACT-RANKS-UNSORTED',
  'PH1D-MUTANT-HANDOFF-MINUS-ONE', 'PH1D-MUTANT-HANDOFF-PLUS-ONE', 'PH1D-MUTANT-HANDOFF-EVEN', 'PH1D-MUTANT-HANDOFF-FLOOR',
  'PH1D-MUTANT-ONE-SHOT-HANDOFF-MINUS-ONE', 'PH1D-MUTANT-ONE-SHOT-HANDOFF-PLUS-ONE', 'PH1D-MUTANT-ONE-SHOT-HANDOFF-EVEN',
  'PH1D-MUTANT-NO-ARM-AFTER-RENDER-ERROR', 'PH1D-MUTANT-ARM-ONLY-WHEN-PRESENTED-OR-WIDE', 'PH1D-MUTANT-ARM-ONLY-AFTER-DRAWN-GRAPH',
  'PH1D-MUTANT-NO-INSTALL-DISARM', 'PH1D-MUTANT-INSTALL-AFTER-CHROME', 'PH1D-MUTANT-INSTALL-BEFORE-AWAITS',
  'PH1D-MUTANT-REMOVED-MEANS-NO-PARENT', 'PH1D-MUTANT-DISARM-AFTER-PAGE-CHECK', 'PH1D-MUTANT-DISARM-AFTER-SCOPE-CHECK',
  'PH1D-MUTANT-INSTALL-IN-PROJECT-SCOPE', 'PH1D-MUTANT-FIRE-ON-OVERRIDE', 'PH1D-MUTANT-RERENDER-DROPS-ARGS',
  'PH1D-MUTANT-GEOMETRY-WIDTH-ROUNDED', 'PH1D-MUTANT-GEOMETRY-WIDTH-CEIL', 'PH1D-MUTANT-COLUMN-NUMERATOR-ROUNDED',
  'PH1D-MUTANT-COLUMN-NUMERATOR-CEIL', 'PH1D-MUTANT-SCROLL-TEST-ROUNDED', 'PH1D-MUTANT-SCROLL-TEST-CEIL',
  'PH1D-MUTANT-HANDOFF-ROUNDED', 'PH1D-MUTANT-HANDOFF-CEIL', 'PH1D-MUTANT-RANK-CAP-12', 'PH1D-MUTANT-ROW-GAP-ONCE',
  'PH1D-MUTANT-HEIGHT-ROW-GAP-ONCE', 'PH1D-MUTANT-ROW-COUNT-DISTINCT', 'PH1D-MUTANT-ROW-COUNT-WITHOUT-STUBS',
  'PH1D-MUTANT-STUBS-IN-ROW-0', 'PH1D-MUTANT-BEND-THIRD-OF-SPAN', 'PH1D-MUTANT-VERY-WIDE-OVERRIDE-IGNORED',
  'PH1D-MUTANT-VERY-WIDE-MEASUREMENT-IGNORED', 'PH1D-MUTANT-TINY-OVERRIDE-IGNORED', 'PH1D-MUTANT-TINY-MEASUREMENT-IGNORED',
  'PH1D-MUTANT-TINY-GEOMETRY-REFUSED', 'PH1D-MUTANT-TINY-GEOMETRY-RAISED', 'PH1D-MUTANT-CARD-WITHOUT-SCROLLER-ANCHOR',
  'PH1D-MUTANT-CLOSE-BUTTON-DECLARATION', 'PH1D-MUTANT-OPEN-BUTTON-DECLARATION', 'PH1D-MUTANT-ONE-SHOT-HANDS-ROUNDED',
  'PH1D-MUTANT-ONE-SHOT-HANDS-CEIL', 'PH1D-MUTANT-HANDED-WIDTH-ROUNDED', 'PH1D-MUTANT-HANDED-WIDTH-CEIL',
  'PH1D-MUTANT-ONE-SHOT-HANDS-FLOOR', 'PH1D-MUTANT-SKIP-WIDE-TO-WIDE', 'PH1D-MUTANT-SKIP-UNCHANGED-WIDTH',
  'PH1D-MUTANT-MUTATION-API-TRUTHY', 'PH1D-MUTANT-FIRE-WITHOUT-DISARM', 'PH1D-MUTANT-FIRE-DISCONNECTS-RESIZE-ONLY',
  'PH1D-MUTANT-REMOVAL-AGAINST-CURRENT-CONTAINER',
  'PH1D-MUTANT-COMPACT-STUB-UNREGISTERED', 'PH1D-MUTANT-COMPACT-REGISTER-SLICES-AFTER-LEGEND',
  'PH1D-MUTANT-COMPACT-ANALYSIS-WITHOUT-STUBS', 'PH1D-MUTANT-COMPACT-CONTROLLER-WITHOUT-CROSS-EDGES',
  'PH1D-MUTANT-COMPACT-CONTROLLER-WITHOUT-STUBS', 'PH1D-MUTANT-COMPACT-STUB-REGISTERED-COMPLETED',
  'PH1D-MUTANT-DIM-DONE-DIMS-STUBS', 'PH1D-MUTANT-COMPACT-LEGEND-REVERSED', 'PH1D-MUTANT-FILTERS-OVERRIDE-SELECTION',
  'PH1D-MUTANT-COMPACT-STUB-REGISTERED-BLOCKED', 'PH1D-MUTANT-COMPACT-SUMMARY-WITHOUT-STUBS',
  'PH1D-MUTANT-STUB-IN-LAST-COLUMN', 'PH1D-MUTANT-DEPENDENTS-RAW-COMPLETED', 'PH1D-MUTANT-STUB-PILL-OPENS-CARD-NAME',
  'PH1D-MUTANT-LEGEND-ABOVE-MAP-WITH-STUBS', 'PH1D-MUTANT-STUB-FULL-ID-WHEN-SHORT', 'PH1D-MUTANT-NEEDS-YOU-RAW-STATUS',
  'PH1D-MUTANT-HAIRLINE-RAW-STATUS', 'PH1D-MUTANT-HAIRLINE-LOWERCASED-STATUS', 'PH1D-MUTANT-OWNER-NEVER-DELETED',
  'PH1D-MUTANT-DISARM-AFTER-RERENDER', 'PH1D-MUTANT-REMOVAL-DISCONNECTS-RESIZE-ONLY',
  'PH1D-MUTANT-ARM-WHEN-ROOT-HAS-A-PARENT', 'PH1D-MUTANT-DECIDED-RENDER-SKIPS-DISARM',
  'PH1D-MUTANT-INSTALL-BEFORE-WARNINGS', 'PH1D-MUTANT-COMPACT-UNRECOGNIZED-AS-PLANNING',
  'PH1D-MUTANT-COMPACT-PILL-WITHOUT-STATUS-CLASS', 'PH1D-MUTANT-BOTH-FILTERS-IGNORE-STUCK',
  'PH1D-MUTANT-BOTH-FILTERS-IGNORE-DIM-DONE',
  'PH1D-MUTANT-SHORT-ID-PREFIX-FROM-SLICES', 'PH1D-MUTANT-IDLESS-STUB-ALLOWS-SHORT-IDS', 'PH1D-MUTANT-FOREIGN-STUB-STRIPPED',
  'PH1D-MUTANT-SHORT-ID-SLICE-PREFIX-ONLY', 'PH1D-MUTANT-SHORT-IDS-FIVE-RANKS', 'PH1D-MUTANT-STUB-TOOLTIP-LABEL-ONLY',
  'PH1D-MUTANT-COMPACT-SELECT-ON-INSTANCE', 'PH1D-MUTANT-COMPACT-OUTCOMES-ON-INSTANCE', 'PH1D-MUTANT-COMPACT-OUTCOMES-BY-COUNT',
  'PH1D-MUTANT-WIDE-OUTCOMES-ON-INSTANCE', 'PH1D-MUTANT-MEASURED-PILLS-OPEN', 'PH1D-MUTANT-MEASURED-NO-OUTCOMES',
  'PH1D-MUTANT-MOBILE-CLASS-UNREGISTERED', 'PH1D-MUTANT-MOBILE-CLASS-NO-OUTCOMES', 'PH1D-MUTANT-MOBILE-CLASS-PILLS-OPEN',
  'PH1D-MUTANT-HANDOFF-PILLS-OPEN', 'PH1D-MUTANT-HANDOFF-UNREGISTERED', 'PH1D-MUTANT-HANDOFF-NO-OUTCOMES',
  'PH1D-MUTANT-HANDOFF-SOURCE-LOST', 'PH1D-MUTANT-WINDOW-RESIZE-LISTENER', 'PH1D-MUTANT-WORKSPACE-RESIZE-LISTENER',
  'PH1D-MUTANT-VIEWPORT-RESIZE-LISTENER', 'PH1D-MUTANT-PROJECT-BLANK-WHEN-NARROW', 'PH1D-MUTANT-PROJECT-EXTRA-HOST-WHEN-NARROW',
  'PH1D-MUTANT-NARROW-DROPS-LAYOUT-WARNINGS-WITH-STUBS', 'PH1D-MUTANT-WARN-ONCE-PER-STATUS', 'PH1D-MUTANT-WARNING-DETAIL-TRIMMED',
  'PH1D-MUTANT-LEGEND-SKIPS-STATUSLESS', 'PH1D-MUTANT-SELECT-DISARMS', 'PH1D-MUTANT-ONE-SHOT-SKIPS-OPEN-CARD',
  'PH1D-MUTANT-ONE-SHOT-SKIPS-DIMMED', 'PH1D-MUTANT-RERENDER-KEEPS-ROOT-WITH-CARD', 'PH1D-MUTANT-OPEN-CARD-DISARMS-WITHOUT-RERENDER',
  'PH1D-MUTANT-DIMMED-DISARMS-WITHOUT-RERENDER', 'PH1D-MUTANT-CLEAR-DISARMS', 'PH1D-MUTANT-OPEN-SLICE-DISARMS',
  'PH1D-MUTANT-FILTER-TOGGLE-DISARMS', 'PH1D-MUTANT-PILL-TAP-DISARMS',
]) {
  check(new RegExp(`// MUTATION GUARD: ${mutant}(?: \\([A-Z0-9, ]+\\))? turns RED`).test(behavior),
    `PH1D-SENTINEL-REPAIR-MUTANT: ${mutant} is named in a MUTATION GUARD comment`);
}
check(behavior.includes('const ph1StubViolations = [];')
  && behavior.includes("ph1StubViolations.push('PH1-BROWSER-LIKE-OBSERVER-STUB: the widget watches its container childList only');")
  && !/\bassert\([^;]*'PH1-BROWSER-LIKE-OBSERVER-STUB: the widget watches its container childList only'\);/.test(behavior)
  && behavior.includes('assert.deepStrictEqual(ph1StubViolations, [], `PH1D-STUB-VIOLATIONS: ${label}:'),
'PH1D-SENTINEL-STUB-VIOLATIONS: the childList-only stub check records into ph1StubViolations rather than asserting, and the settled() assertion checks that record is empty');
const floorMatch = behavior.match(/\nconst ASSERTION_FLOOR = (\d+);\n/);
check(Boolean(floorMatch) && Number(floorMatch[1]) > 0
  && behavior.includes("const nodeAssert = require('assert');")
  && !/\bconst assert = require\(/.test(behavior)
  && /\nconst assert = Object\.assign\(counted\(nodeAssert\), nodeAssert, /.test(behavior)
  && behavior.includes("process.on('exit', (code) => {")
  && behavior.includes('if (harnessPassed || code !== 0) return;')
  && behavior.includes('if (assertionCount < ASSERTION_FLOOR) {')
  && (behavior.match(/\bfinishHarness\(\);/g) || []).length === 1
  && /\n {2}finishHarness\(\);\n\}\n\nmain\(\)\.catch\(/.test(behavior)
  && (behavior.match(/graph-view: all checks passed/g) || []).length === 1,
'PH1D-SENTINEL-HARNESS-FLOOR: the behavior harness wraps assert in a counter, pins a positive ASSERTION_FLOOR, calls finishHarness() once as the last statement of main(), prints the pass line once, and installs the exit guard');

check(JSON.stringify([...new Set(behavior.match(/PH1B-[A-Z-]+/g) || [])].sort()) === JSON.stringify([
  'PH1B-FALSE-BISTABLE-PROOF', 'PH1B-PERMANENT-HOLD', 'PH1B-SCROLLBAR-DEPENDENT-MEASUREMENT', 'PH1B-THROWING-GETTER-DROPS-CROSSING',
]), 'PH1-SENTINEL-PH1C-LABELS: the PH1B-* tokens in the behavior harness are exactly the four listed');
check((behavior.match(/class BrowserLikeResizeObserver \{/g) || []).length === 1
  && behavior.includes('global.ResizeObserver = BrowserLikeResizeObserver;')
  && (behavior.match(/class BrowserLikeMutationObserver \{/g) || []).length === 1
  && behavior.includes('global.MutationObserver = BrowserLikeMutationObserver;')
  && !/class ResizeObserverStub|PH1-RESIZE-THRESHOLD-ONLY|PH1-OBSERVER-OSCILLATION-BREAKER|PH1-MUTANT-NO-FLIP-CAP|PH1B-OBSERVER-CONVERGES|PH1B-CONVERGES/.test(behavior),
'PH1-SENTINEL-BROWSER-LIKE-STUB: the behavior harness defines BrowserLikeResizeObserver and BrowserLikeMutationObserver once each, installs them as the globals, and matches none of the listed patterns');
check(/const PH1_WIDE_DIGESTS = \{[\s\S]*?\n\};/.test(behavior)
  && (behavior.match(/[0-9a-f]{64}/g) || []).length >= 10,
'PH1-SENTINEL-WIDE-PINS: PH1_WIDE_DIGESTS is an object literal and the harness carries at least ten 64-hex literals');

check(pkg.scripts?.['test:graph-view-contract'] === 'node platform/test/run-graph-view-contract.js',
  'BL5B-SENTINEL-REGISTRY: focused contract script is registered');
// The release:preflight registration surface moved from a package.json chain
// string to platform/test/preflight-manifest.json (2026-08-10 parallel preflight
// cutover); count manifest steps whose command invokes this harness instead.
const preflightManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/test/preflight-manifest.json'), 'utf8'));
check(preflightManifest.steps.filter((s) => s.cmd.join(' ').includes('run-graph-view-contract.js')).length === 1,
  'BL5B-SENTINEL-PREFLIGHT: release preflight invokes this sentinel exactly once');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL — ${failure}`);
  process.exit(1);
}
console.log('PASS — GraphView BL-5c contract sentinel');
