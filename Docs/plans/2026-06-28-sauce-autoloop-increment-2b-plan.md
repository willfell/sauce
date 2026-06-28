# Sauce Autoloop — Increment 2b Implementation Plan (the Scout, deterministic spine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the board is drained, the loop self-discovers **safe** work (coverage gaps, doc drift, landmine-guard gaps), queues it in `autoloop-queue.md`, and picks from the queue — so it never goes idle.

**Architecture:** A deterministic `scout-signals.js` (pure detectors + CLI that appends deduped items to `autoloop-queue.md`), plus `parseQueue`/`selectFromQueue` in `select-card.js` and a Phase B integration in the command. All discovery is deterministic + harness-tested; the loop's Phase C still does the model implementation. Safe categories only (`doc`/`test`). Design: `2026-06-28-sauce-autoloop-increment-2b-design.md`.

**Tech Stack:** Node ≥18 zero-dep CommonJS; the existing `run-autoloop-select.js` harness (in `release:preflight`).

## Scope
**In:** queue format + `parseQueue` + `selectFromQueue` (dedup + scope filter) · `scout-signals.js` 3 pure detectors + CLI · command Phase B integration · harness + preflight + arch doc.
**Deferred to 2c:** the bounded **model bug-hunt** pass (the one non-deterministic source). 2b ships the deterministic spine — cheap, fully testable, no model agent in the loop. **Out (later):** Gate B (3), canary (4), substrate (5).

Branch `feat/sauce-autoloop-increment-2b` (created). Land via CI-gated auto-merge PR.

## File structure
| File | Status | Responsibility |
| --- | --- | --- |
| `autoloop-queue.md` | Create | Git-tracked queue ledger (the dedup source of truth). |
| `scripts/autoloop/scout-signals.js` | Create | 3 pure detectors (`coverageGapItems`, `docDriftItems`, `landmineGuardGapItems`) + CLI (gather → dedup → cap → append). |
| `scripts/autoloop/select-card.js` | Modify | Add `parseQueue` + `selectFromQueue`. |
| `platform/test/run-autoloop-select.js` | Modify | Add `Q-*`, `SQ-*`, `SS-*` assertions. |
| `.claude/commands/sauce-autoloop.md` | Modify | Phase B: board-drained → consult queue → run scout → re-read. |

---

## Task 1: queue format + `parseQueue` + `selectFromQueue`

**Files:** Create `autoloop-queue.md`; Modify `scripts/autoloop/select-card.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Seed the queue ledger**

Create `autoloop-queue.md`:
```markdown
# Autoloop queue

Scout-discovered, **safe-category** work items (the loop drains this when the board has no eligible work). Each item:

- id: <kebab-slug, maps to branch autoloop/<id>>
  title: <one line>
  category: doc | test
  source: <detector>
  rationale: <why>
  status: proposed | done

<!-- items below -->
```

- [ ] **Step 2: Add failing Q-*/SQ-* assertions**

In `run-autoloop-select.js`, update the select-card require to add the two new exports:
```js
const { isBroadScope, parseBoard, recommendedFrom, selectCard, parsePlanningChecked, parseQueue, selectFromQueue } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'select-card.js'));
```
Before the final summary block, insert:
```js
// ---- parseQueue + selectFromQueue (Q-*, SQ-*) ----
const QUEUE = [
  '# Autoloop queue', '',
  '- id: cov-blueprint-cowork-customjs_behavioral',
  '  title: Add coverage for cowork customjs_behavioral (0/9)',
  '  category: test', '  source: coverage-matrix', '  rationale: 9 uncovered', '  status: proposed', '',
  '- id: doc-drift-readme-foo',
  '  title: Fix broken link "foo.md" in README.md',
  '  category: doc', '  source: doc-drift', '  rationale: link does not resolve', '  status: done', '',
].join('\n');
const q = parseQueue(QUEUE);
ok('Q-1 parses two items', q.length === 2, JSON.stringify(q.map(i => i.id)));
ok('Q-2 captures fields', q[0].id === 'cov-blueprint-cowork-customjs_behavioral' && q[0].category === 'test' && q[0].status === 'proposed');
ok('Q-3 captures status done', q[1].status === 'done');
ok('Q-4 empty/garbage → []', parseQueue('# Autoloop queue\n\nnothing here').length === 0);

ok('SQ-1 picks the open proposed item',
  (r => r.action === 'work' && r.card === 'cov-blueprint-cowork-customjs_behavioral' && r.fromQueue === true)
  (selectFromQueue({ queueMd: QUEUE })));
ok('SQ-2 skips done items',
  selectFromQueue({ queueMd: QUEUE, shippedIds: [] }).card !== 'doc-drift-readme-foo');
ok('SQ-3 dedup via shippedIds → no-work',
  selectFromQueue({ queueMd: QUEUE, shippedIds: ['cov-blueprint-cowork-customjs_behavioral'] }).action === 'no-work');
ok('SQ-4 empty queue → no-work',
  selectFromQueue({ queueMd: '# Autoloop queue\n' }).action === 'no-work');
ok('SQ-5 broad-scope queue item skipped → no-eligible-work',
  selectFromQueue({ queueMd: '- id: x\n  title: Audit everything redesign\n  status: proposed\n' }).action === 'no-eligible-work');
```

- [ ] **Step 3: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `parseQueue is not a function`.

- [ ] **Step 4: Implement `parseQueue` + `selectFromQueue` in `select-card.js`**

Add both functions (after `parsePlanningChecked`):
```js
// Parse autoloop-queue.md into items. Each item starts at a `- id:` line; its
// indented `key: value` lines become fields. Items without an id are dropped.
function parseQueue(md) {
  const items = [];
  let cur = null;
  for (const raw of String(md || '').split('\n')) {
    const idm = raw.match(/^\s*-\s+id:\s*(\S.*?)\s*$/);
    if (idm) { if (cur && cur.id) items.push(cur); cur = { id: idm[1].trim() }; continue; }
    if (!cur) continue;
    const kv = raw.match(/^\s+([a-zA-Z_]+):\s*(.*?)\s*$/);
    if (kv) { cur[kv[1]] = kv[2].trim(); continue; }
    if (raw.trim() === '') { if (cur && cur.id) items.push(cur); cur = null; }
  }
  if (cur && cur.id) items.push(cur);
  return items;
}

// Pick the top open, in-scope, not-yet-shipped queue item.
function selectFromQueue(o) {
  const { queueMd, shippedIds = [] } = o || {};
  const shipped = new Set(shippedIds);
  const open = parseQueue(queueMd).filter((it) => (it.status || 'proposed') === 'proposed' && !shipped.has(it.id));
  const skipped = [];
  for (const it of open) {
    const scope = isBroadScope(`${it.title || ''}\n${it.rationale || ''}`);
    if (scope.broad) { skipped.push({ id: it.id, reason: scope.reason }); continue; }
    return { action: 'work', card: it.id, title: it.title, category: it.category, fromQueue: true, skipped, reason: 'top eligible queue item' };
  }
  return open.length
    ? { action: 'no-eligible-work', reason: 'all open queue items are broad-scope', skipped }
    : { action: 'no-work', reason: 'queue has no eligible items' };
}
```
Update exports:
```js
module.exports = { selectCard, isBroadScope, parseBoard, recommendedFrom, parsePlanningChecked, parseQueue, selectFromQueue };
```

- [ ] **Step 5: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — Q-1..4 + SQ-1..5 green.

- [ ] **Step 6: Commit**

```bash
git add autoloop-queue.md scripts/autoloop/select-card.js platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): autoloop-queue.md + parseQueue/selectFromQueue (dedup + scope filter)"
```

---

## Task 2: `scout-signals.js` — three pure detectors

**Files:** Create `scripts/autoloop/scout-signals.js`; Test `platform/test/run-autoloop-select.js`.

- [ ] **Step 1: Add failing SS-* assertions**

In `run-autoloop-select.js`, after the select-card require, add:
```js
const { coverageGapItems, docDriftItems, landmineGuardGapItems } =
  require(path.resolve(__dirname, '..', '..', 'scripts', 'autoloop', 'scout-signals.js'));
```
Before the summary block, insert:
```js
// ---- scout-signals detectors (SS-*) ----
const COV = { entries: [
  { kind: 'blueprint', name: 'cowork', axes: { customjs_behavioral: { covered: 0, total: 9 }, install: { covered: 3, total: 3 } } },
  { kind: 'mechanism', name: 'nav-buttons', axes: { customjs_behavioral: { covered: 2, total: 4 } } },
] };
const covItems = coverageGapItems(COV);
ok('SS-1 coverage gap detected for uncovered axis', covItems.some(i => i.id === 'cov-blueprint-cowork-customjs-behavioral' && i.category === 'test'));
ok('SS-2 fully-covered axis is NOT proposed', !covItems.some(i => i.id.includes('install')));

const DOCS = [{ path: 'Docs/a.md', content: 'see [good](b.md) and [bad](missing.md)' }];
const exists = (target) => target === 'b.md';
const ddItems = docDriftItems(DOCS, exists);
ok('SS-3 broken md link proposed', ddItems.some(i => i.category === 'doc' && i.title.includes('missing.md')));
ok('SS-4 resolving link NOT proposed', !ddItems.some(i => i.title.includes('b.md')));

const LM = '### 1. First trap\nbody\n### 7. Guarded trap\nbody\n';
const hasGuard = (n) => n === '7';
const lmItems = landmineGuardGapItems(LM, hasGuard);
ok('SS-5 unguarded landmine proposed', lmItems.some(i => i.id === 'landmine-1-guard'));
ok('SS-6 guarded landmine NOT proposed', !lmItems.some(i => i.id === 'landmine-7-guard'));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node platform/test/run-autoloop-select.js`
Expected: FAIL — `Cannot find module '.../scout-signals.js'`.

- [ ] **Step 3: Create `scripts/autoloop/scout-signals.js` (detectors + CLI)**

```js
#!/usr/bin/env node
/**
 * scout-signals — deterministic Scout. Pure detectors that turn grounded
 * signals into SAFE-category (doc/test) queue items; CLI gathers real inputs,
 * dedups against the existing queue, caps the batch, and appends to
 * autoloop-queue.md. No model. Same DI pattern as select-card/reconcile.
 *
 * Exports: coverageGapItems, docDriftItems, landmineGuardGapItems, toQueueBlocks
 */
'use strict';

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

// Coverage gaps from a parsed coverage-matrix.json object → test items.
function coverageGapItems(matrix) {
  const items = [];
  for (const e of (matrix && matrix.entries) || []) {
    for (const [axis, a] of Object.entries(e.axes || {})) {
      if (typeof a.covered === 'number' && typeof a.total === 'number' && a.total > 0 && a.covered < a.total) {
        items.push({
          id: slug(`cov-${e.kind}-${e.name}-${axis}`),
          title: `Add coverage for ${e.name} ${axis} (${a.covered}/${a.total})`,
          category: 'test', source: 'coverage-matrix',
          rationale: `${e.kind} ${e.name} axis ${axis}: ${a.total - a.covered} uncovered`,
          status: 'proposed', _gap: a.total - a.covered,
        });
      }
    }
  }
  return items.sort((x, y) => y._gap - x._gap).map(({ _gap, ...it }) => it);
}

// Broken RELATIVE markdown links (`](x.md)`) in the given doc files → doc items.
// `exists(target, fromPath)` resolves a link target to a boolean.
function docDriftItems(docFiles, exists) {
  const items = [];
  for (const f of docFiles || []) {
    for (const m of String(f.content).matchAll(/\]\(([^)]+?\.md)(?:#[^)]*)?\)/g)) {
      const target = m[1].trim();
      if (!target || /^https?:\/\//.test(target)) continue;
      if (!exists(target, f.path)) {
        items.push({
          id: slug(`doc-drift-${f.path}-${target}`),
          title: `Fix broken link "${target}" in ${f.path}`,
          category: 'doc', source: 'doc-drift',
          rationale: `${f.path} links to ${target} which does not resolve`,
          status: 'proposed',
        });
      }
    }
  }
  return items;
}

// Landmines (`### N. title`) with no detectable guard → test items.
// `hasGuard(n, title)` returns whether a guard harness exists.
function landmineGuardGapItems(landminesMd, hasGuard) {
  const items = [];
  const re = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(String(landminesMd || ''))) !== null) {
    const n = m[1], title = m[2];
    if (!hasGuard(n, title)) {
      items.push({
        id: `landmine-${n}-guard`,
        title: `Add a guard harness for landmine #${n}: ${title}`.slice(0, 100),
        category: 'test', source: 'landmine-guard',
        rationale: `Landmine #${n} has no detectable guard harness`,
        status: 'proposed',
      });
    }
  }
  return items;
}

// Render items as autoloop-queue.md blocks.
function toQueueBlocks(items) {
  return items.map((it) => [
    `- id: ${it.id}`,
    `  title: ${it.title}`,
    `  category: ${it.category}`,
    `  source: ${it.source}`,
    `  rationale: ${it.rationale}`,
    `  status: ${it.status || 'proposed'}`,
    '',
  ].join('\n')).join('\n');
}

module.exports = { coverageGapItems, docDriftItems, landmineGuardGapItems, toQueueBlocks, slug };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const MAX_NEW = 5;
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };

  // 1. Coverage
  let cov = [];
  try { cov = coverageGapItems(JSON.parse(read(path.join(ROOT, 'platform/test/coverage-matrix.json')) || '{}')); } catch (_) {}

  // 2. Doc drift (relative .md links under Docs/)
  const docFiles = [];
  (function walk(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) docFiles.push({ path: path.relative(ROOT, p), content: read(p) });
    }
  })(path.join(ROOT, 'Docs'));
  const exists = (target, fromPath) => {
    try { return fs.existsSync(path.resolve(ROOT, path.dirname(fromPath), target)); } catch (_) { return true; }
  };
  const dd = docDriftItems(docFiles, exists);

  // 3. Landmine guards (guard = any run-*.js filename/content referencing #N)
  const testDir = path.join(ROOT, 'platform/test');
  let testBlob = '';
  try { for (const f of fs.readdirSync(testDir)) if (/^run-.*\.js$/.test(f)) testBlob += '\n' + f + '\n' + read(path.join(testDir, f)); } catch (_) {}
  const hasGuard = (n) => new RegExp(`landmine[^0-9]{0,4}${n}\\b|#${n}\\b`, 'i').test(testBlob);
  const lm = landmineGuardGapItems(read(path.join(ROOT, 'Docs/landmines.md')), hasGuard);

  // Dedup against existing queue ids; cap the batch.
  const { parseQueue } = require('./select-card.js');
  const queuePath = path.join(ROOT, 'autoloop-queue.md');
  const queueMd = read(queuePath);
  const have = new Set(parseQueue(queueMd).map((i) => i.id));
  const fresh = [...cov, ...dd, ...lm].filter((it) => !have.has(it.id)).slice(0, MAX_NEW);

  if (!fresh.length) { console.log(JSON.stringify({ added: 0, reason: 'no new signals' })); process.exit(0); }
  fs.writeFileSync(queuePath, queueMd.replace(/\s*$/, '') + '\n\n' + toQueueBlocks(fresh), 'utf8');
  console.log(JSON.stringify({ added: fresh.length, ids: fresh.map((i) => i.id) }, null, 2));
  process.exit(0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-autoloop-select.js`
Expected: PASS — SS-1..6 green.

- [ ] **Step 5: Sanity-run the CLI against the real repo**

Run: `node scripts/autoloop/scout-signals.js`
Expected: JSON `{added: N, ids: [...]}` (it appends real coverage/doc/landmine items to `autoloop-queue.md`). Inspect `autoloop-queue.md` — items should be sane safe-category proposals.

- [ ] **Step 6: Reset the queue seed (don't commit a machine-generated batch yet)**

Run: `git checkout autoloop-queue.md` (restore the seeded header — we ship the mechanism, not a generated batch; the live loop generates on demand).

- [ ] **Step 7: Commit**

```bash
git add -f scripts/autoloop/scout-signals.js
git add platform/test/run-autoloop-select.js
git commit -m "feat(autoloop): scout-signals deterministic detectors (coverage/doc-drift/landmine-guard) + CLI"
```

---

## Task 3: command Phase B — consult queue, run Scout on drain

**Files:** Modify `.claude/commands/sauce-autoloop.md`.

- [ ] **Step 1: Replace Phase B step 2's branch**

Find the Phase B `2. Branch on \`action\`...` block and replace its `no-work / no-eligible-work` bullet with:
```markdown
   - `no-work` / `no-eligible-work` → **consult the Scout queue before idling:**
     1. `node scripts/autoloop/select-card.js` is board-only; now read the queue: `node -e "const{selectFromQueue}=require('./scripts/autoloop/select-card.js');const fs=require('fs');console.log(JSON.stringify(selectFromQueue({queueMd:fs.readFileSync('autoloop-queue.md','utf8')})))"`.
     2. If it returns `work` → that queue item (`card` = its id, `fromQueue: true`) is the turn's work; proceed to Phase C (its `category` is `doc` or `test` — safe).
     3. If `no-work` (queue empty) → run the deterministic Scout: `node scripts/autoloop/scout-signals.js` (appends safe items), then re-read the queue (step 1). If now `work` → proceed.
     4. If still `no-work` after the Scout (no new signals) → write a handoff and **exit cheaply**. **(Deferred — Increment 2c:** a bounded model bug-hunt pass runs here before giving up.)
   - `work` → proceed with `result.card`.
```

- [ ] **Step 2: Note the queue-item work shape in Phase C**

After the Phase C `**Live:**` heading's step 1, add a sentence:
```markdown
  - If the work came from the queue (`fromQueue: true`), the branch is `autoloop/<id>` and the implementation must satisfy the item's `title` (a `doc` fix or a new `test`/harness — never a behavioral change). Mark the item `status: done` in `autoloop-queue.md` as part of the change.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/sauce-autoloop.md
git commit -m "feat(autoloop): Phase B consults the Scout queue + runs scout-signals on drain"
```

---

## Task 4: full preflight + architecture-doc sync

- [ ] **Step 1: Run the full gate**

Run: `npm run release:preflight`
Expected: exit 0; `run-autoloop-select.js` reports its new higher count (prior 38 + Q-4 + SQ-5 + SS-6 = **53/53** — recount precisely from the added assertions). Stop + report if an UNRELATED harness fails.

- [ ] **Step 2: Architecture doc**

Edit `~/notes/sauce/headspace-sauce/spice/projects/sauce/docs/workflow-loops/initial-brainstorm/Implementation Setup - Architecture.md`: in §10, mark item 3 (Scout) **partially RESOLVED in 2b** (deterministic spine; model bug-hunt → 2c); add a §4c describing `scout-signals.js` + the queue. (Vault doc — no commit.)

- [ ] **Step 3: Confirm clean tree** (`git status --short` → only the pre-existing breadcrumb untracked).

---

## Task 5: final review + CI-gated PR

- [ ] **Step 1:** whole-branch review (detector correctness, dedup, the queue-append idempotency, no scope creep, safe-category-only).
- [ ] **Step 2:** push + auto-merge PR (after user confirm), then monitor the 7-stage ship.

---

## Self-review
- **Spec coverage:** queue + parse + selectFromQueue (Task 1) · 3 deterministic detectors + CLI dedup/cap/append (Task 2) · command integration with the drain→queue→scout→re-read flow (Task 3) · preflight + doc (Task 4) · review + ship (Task 5). The model bug-hunt is explicitly deferred to 2c (noted in scope + command step 1.4).
- **No placeholders:** full code in every code step; `<id>`/`<doc>` etc. are runtime values.
- **Type consistency:** queue item shape `{id, title, category, source, rationale, status}` identical across `toQueueBlocks`, `parseQueue`, the detectors, and the harness; `selectFromQueue` returns `{action, card, title, category, fromQueue, skipped, reason}` — `card`=id, consistent with the command's Phase C handling; `slug()` used uniformly for id generation; detector names (`coverageGapItems`/`docDriftItems`/`landmineGuardGapItems`) match definition↔export↔require↔harness.
