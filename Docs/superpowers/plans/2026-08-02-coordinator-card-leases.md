# Coordinator Card Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-card session leases in the autoloop coordinator so concurrent `$loop-run --live` chats never duplicate work on the same active card.

**Architecture:** A `lease {token, acquired_at, renewed_at, holder}` object on each active card record in `state.json`. `claim`/`resume` acquire it and return `lease_token`; `resume` on an active card becomes a side-effect-free "attach" (acquire/renew or refuse `lease_held`). Pipeline verbs require `--lease-token` when a live lease exists and renew it; park/terminal transitions and supervised verbs clear it. `status` projects lease info and the selector emits a new `all-work-leased` next value. TTL 2 h, time-based only, plus a manual `break-lease` verb.

**Tech Stack:** Node (no new deps). Files: `scripts/autoloop/codex-coordinator.js`, new harness `platform/test/run-autoloop-leases.js`, skill bodies under `plugins/loop/skills/`, `platform/schemas-index.json`, `package.json`, agent-guide docs.

**Spec:** `Docs/superpowers/specs/2026-08-02-coordinator-card-leases-design.md` (read it first).

## Global Constraints

- Flag is `--lease-token` (NOT `--lease` — `advance` already has `--lease-seconds`, a poll duration; `commandAdvance` has a local `const lease` at line ~5322 — never shadow it).
- `LEASE_TTL_MS = 2 * 60 * 60 * 1000`. Live iff `0 <= now − renewed_at < TTL` (negative age = clock skew = stale, mirroring `turn-lock.js`).
- Absent `lease` field = unleased; **no state migration**; `schema_version: 1` unchanged (both check sites, coordinator lines ~187 and ~221).
- All refusals via cli-kit `refuse(action, code, message, extra)` → `{action, ok:false, no_op:false, code, message, ...extra}`, exit 1. Every lease refusal message must state the exact remedy.
- Unleased card + pipeline verb proceeds tokenless (back-compat for supervised/manual operation).
- Conventional commits; scope attributes to the workshop umbrella (nothing under `platform/mechanisms|blueprints` changes except the schemas index). Do NOT touch versions/tags — the release pipeline owns them.
- Every new `platform/test/run-*.js` MUST be registered in `package.json` in the same commit or `scripts/check-orphan-harnesses.js` fails preflight.
- Don't `git add -A` — stage explicit files.
- Run all commands from the worktree root: `/Users/willfell/Documents/GitHub/sauce/.claude/worktrees/coordinator-card-leases`.

---

### Task 1: Lease core — helpers, acquisition on claim/resume, attach semantics

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` (constants ~L41-54; `commandResume` ~L3834; `commandClaim` ~L5018; exports ~L7027)
- Create: `platform/test/run-autoloop-leases.js`
- Modify: `package.json` (preflight chain L~89 + `test:autoloop-leases` alias)

**Interfaces:**
- Produces (later tasks rely on these exact names, all exported from the coordinator module):
  - `LEASE_TTL_MS` (number)
  - `leaseIsLive(lease, nowMs, ttlMs = LEASE_TTL_MS)` → boolean. `lease` may be undefined/malformed → false.
  - `leaseSummary(lease, nowMs, ttlMs = LEASE_TTL_MS)` → `null` or `{held, stale, age_ms, expires_in_ms, holder, acquired_at}`.
  - `acquireLease(record, {now, token, label})` → mutates `record.lease = {token, acquired_at: now(), renewed_at: now(), holder: {host, label}}`, returns the lease.
  - `clearLease(record, reason, now)` → if `record.lease` exists, appends `{at: now(), reason, previous_token, previous_holder}` to `record.lease_breaks` and deletes `record.lease`; no-op otherwise. Returns true if a lease was cleared.
  - Receipt fields on claim/resume success: `lease_token` (string), `lease: {acquired_at, expires_in_ms, holder}`.
  - Resume-attach receipt: `successReceipt('attach', {card, phase, lease_token, lease, branch, worktree, no_op: <bool>})` — attach NEVER mutates phase/reviews/resume metadata.

- [ ] **Step 1: Write the failing harness (first tranche)**

Create `platform/test/run-autoloop-leases.js` mirroring `platform/test/run-codex-autoloop.js` conventions: async IIFE, `let count = 0`, `ok(value, label)` / `eq(actual, expected, label)` wrappers over `assert`, final `console.log(\`AUTOLOOP-LEASES PASS (${count} assertions)\`)`, `.catch(err => { console.error(err); process.exit(1); })`. Import via `require('../../scripts/autoloop/codex-coordinator')` and destructure `{ leaseIsLive, leaseSummary, acquireLease, clearLease, LEASE_TTL_MS, commandResume, commandClaim }`. Use the pure-deps fixture style (no disk): `const immediateLock = async (_ctx, _name, fn) => fn();` and state literals `{ schema_version: 1, cards: {...} }`.

```js
// --- pure helpers ---
const T0 = Date.parse('2026-08-02T10:00:00.000Z');
const mkLease = (over = {}) => ({ token: 'tok-1', acquired_at: new Date(T0).toISOString(),
  renewed_at: new Date(T0).toISOString(), holder: { host: 'mac-a', label: 'chat-1' }, ...over });

eq(leaseIsLive(undefined, T0), false, 'no lease is not live');
eq(leaseIsLive(mkLease(), T0 + 1000), true, 'fresh lease live');
eq(leaseIsLive(mkLease(), T0 + LEASE_TTL_MS), false, 'TTL boundary stale');
eq(leaseIsLive(mkLease(), T0 - 1000), false, 'future-skewed lease stale');
eq(leaseIsLive({ token: 'x', renewed_at: 'garbage' }, T0), false, 'garbage renewed_at stale');
const summ = leaseSummary(mkLease(), T0 + 60000);
eq(summ.held, true, 'summary held'); eq(summ.age_ms, 60000, 'summary age');
eq(summ.expires_in_ms, LEASE_TTL_MS - 60000, 'summary expiry');
eq(leaseSummary(undefined, T0), null, 'no lease → null summary');

// --- acquire / clear ---
const rec = { card: 'X', phase: 'implementing' };
const nowIso = () => new Date(T0).toISOString();
const lease = acquireLease(rec, { now: nowIso, token: 'tok-A', label: 'chat-1' });
eq(rec.lease.token, 'tok-A', 'acquire stamps token');
ok(rec.lease.holder.host && typeof rec.lease.holder.host === 'string', 'acquire stamps host');
eq(clearLease(rec, 'test-clear', nowIso), true, 'clear returns true');
eq(rec.lease, undefined, 'lease removed');
eq(rec.lease_breaks.length, 1, 'audit appended');
eq(rec.lease_breaks[0].previous_token, 'tok-A', 'audit records token');
eq(clearLease(rec, 'again', nowIso), false, 'clear is idempotent');
```

Then resume-attach cases, driving `commandResume(ctx, args, deps)` with injected deps (mirror the `resumeDeps(state)` factory pattern from `run-codex-autoloop.js` ~L10507: `{readState, writeState, withLock, findCard, sh, boardPath, projectCard, now}`; add `leaseNowMs: () => <ms>` and `leaseToken: () => 'tok-N'` to deps):

```js
// attach: resume on an ACTIVE (implementing) unleased card acquires, no phase side effects
{
  const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', branch: 'b', worktree: '/w' } } };
  let writes = 0;
  const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
    readState: () => state, writeState: () => { writes++; }, withLock: immediateLock,
    now: () => new Date(T0).toISOString(), leaseNowMs: () => T0, leaseToken: () => 'tok-A1',
  });
  eq(receipt.action, 'attach', 'active unleased resume attaches');
  eq(receipt.lease_token, 'tok-A1', 'attach returns token');
  eq(state.cards.A.phase, 'implementing', 'attach does not touch phase');
  ok(!state.cards.A.resumed_at, 'attach does not stamp resumed_at');
  ok(writes >= 1, 'attach persists the lease');
}
// attach refusal: live lease held by someone else
{
  const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', lease: mkLease() } } };
  await assert.rejects(
    () => commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
      readState: () => state, writeState: () => {}, withLock: immediateLock,
      now: () => new Date(T0 + 60000).toISOString(), leaseNowMs: () => T0 + 60000, leaseToken: () => 'tok-A2',
    }),
    (err) => err && err.code === 'lease_held', 'live foreign lease refuses attach'); count++;
}
// attach renew: same token is idempotent + renews
{
  const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', lease: mkLease() } } };
  const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A', 'lease-token': 'tok-1' }, {
    readState: () => state, writeState: () => {}, withLock: immediateLock,
    now: () => new Date(T0 + 60000).toISOString(), leaseNowMs: () => T0 + 60000, leaseToken: () => 'unused',
  });
  eq(receipt.action, 'attach', 'same-token attach ok');
  eq(receipt.no_op, true, 'same-token attach is no_op');
  eq(state.cards.A.lease.renewed_at, new Date(T0 + 60000).toISOString(), 'renewed');
  eq(state.cards.A.lease.token, 'tok-1', 'token unchanged');
}
// stale takeover
{
  const state = { schema_version: 1, cards: { A: { card: 'A', phase: 'implementing', lease: mkLease() } } };
  const later = T0 + LEASE_TTL_MS + 1;
  const receipt = await commandResume({ root: '/ws' }, { json: true, card: 'A' }, {
    readState: () => state, writeState: () => {}, withLock: immediateLock,
    now: () => new Date(later).toISOString(), leaseNowMs: () => later, leaseToken: () => 'tok-B',
  });
  eq(receipt.lease_token, 'tok-B', 'stale lease taken over');
  eq(state.cards.A.lease_breaks[0].reason, 'lease_superseded_stale', 'takeover audited');
}
```

Note on refusal assertion shape: `refuse()` throws `CliRefusal`; assert on `err.code === 'lease_held'` (and where useful `err.extra`/message). Check `cli-kit.js` `CliRefusal` fields and match what it actually exposes — if the code lives elsewhere on the error (e.g. `err.receipt.code`), assert on that instead; run one case interactively first.

Also cover parked-card resume still acquiring a lease: reuse the on-disk parked-resume fixture pattern from `run-codex-autoloop.js` ~L10486-10541 OR pure-deps with a fully valid parked record (phase `parked`, `resume_condition`, deps satisfied, worktree exists via injected `worktreeExists: () => true`); assert the success receipt now contains `lease_token` and the record carries `lease`.

- [ ] **Step 2: Register the harness and run it to verify it fails**

In `package.json`: append `&& node platform/test/run-autoloop-leases.js` to `release:preflight` immediately after `node platform/test/run-codex-autoloop.js`, and add `"test:autoloop-leases": "node platform/test/run-autoloop-leases.js"` next to `"test:autoloop-batch"`.

Run: `npm run test:autoloop-leases`
Expected: FAIL (`leaseIsLive` is not a function / not exported).

- [ ] **Step 3: Implement lease core in the coordinator**

In `scripts/autoloop/codex-coordinator.js`:

(a) Constants block (near `const MAX_ACTIVE = 3;` ~L41):
```js
const LEASE_TTL_MS = 2 * 60 * 60 * 1000; // per-card session lease: generous, time-based only —
// coordinator invocations are short-lived node processes, so pid-liveness can't arbitrate here.
```

(b) Helpers (place near `lockIsStale` ~L247 so the staleness logic reads together):
```js
function leaseIsLive(lease, nowMs, ttlMs = LEASE_TTL_MS) {
  if (!lease || typeof lease !== 'object') return false;
  const renewed = Date.parse(lease.renewed_at);
  if (!Number.isFinite(renewed)) return false;
  const age = nowMs - renewed;
  return age >= 0 && age < ttlMs; // negative age = clock skew = stale (turn-lock.js precedent)
}

function leaseSummary(lease, nowMs, ttlMs = LEASE_TTL_MS) {
  if (!lease || typeof lease !== 'object') return null;
  const renewed = Date.parse(lease.renewed_at);
  const age = Number.isFinite(renewed) ? nowMs - renewed : null;
  const held = leaseIsLive(lease, nowMs, ttlMs);
  return {
    held, stale: !held, age_ms: age,
    expires_in_ms: held ? ttlMs - age : 0,
    holder: lease.holder || null, acquired_at: lease.acquired_at || null,
  };
}

function acquireLease(record, { now, token, label = '' } = {}) {
  const at = (now || (() => new Date().toISOString()))();
  record.lease = {
    token: token || crypto.randomUUID(),
    acquired_at: at, renewed_at: at,
    holder: { host: os.hostname(), ...(label ? { label } : {}) },
  };
  return record.lease;
}

function clearLease(record, reason, now) {
  if (!record || !record.lease) return false;
  const at = (now || (() => new Date().toISOString()))();
  record.lease_breaks = [...(record.lease_breaks || []), {
    at, reason, previous_token: record.lease.token, previous_holder: record.lease.holder || null,
  }];
  delete record.lease;
  return true;
}
```

(c) `commandResume` (~L3834). Add deps: `const leaseNowMs = deps.leaseNowMs || (() => Date.now()); const mintLeaseToken = deps.leaseToken || (() => crypto.randomUUID());`. Then, inside the card-gate lock right after the `card_not_claimed` refusal and BEFORE the existing idempotent-implementing check (~L3851) and the `record.phase !== 'parked'` refusal (~L3868), insert the attach branch:

```js
const nowMs = leaseNowMs();
const suppliedToken = String(args['lease-token'] || '').trim();
if (record.phase !== 'parked') {
  if (!TERMINAL.has(record.phase)) {
    // active card → attach: lease arbitration only, zero phase/review side effects
    const live = leaseIsLive(record.lease, nowMs);
    if (live && suppliedToken && suppliedToken === record.lease.token) {
      record.lease.renewed_at = now();
      persist(ctx, state, record);
      return successReceipt('attach', {
        card, phase: record.phase, no_op: true,
        lease_token: record.lease.token, lease: leaseSummary(record.lease, nowMs),
        branch: record.branch, worktree: record.worktree,
      });
    }
    if (live) {
      refuse('resume-refused', 'lease_held',
        `card ${card} is actively leased by ${record.lease.holder && record.lease.holder.host ? record.lease.holder.host : 'another session'} (expires in ${Math.round((LEASE_TTL_MS - (nowMs - Date.parse(record.lease.renewed_at))) / 60000)}m) — resume a different active card, claim new work, or break-lease --card "${card}" --reason "..." if the holder is known dead`,
        { card, phase: record.phase, lease: leaseSummary(record.lease, nowMs) });
    }
    if (record.lease) clearLease(record, 'lease_superseded_stale', now); // stale takeover, audited
    acquireLease(record, { now, token: mintLeaseToken() });
    persist(ctx, state, record);
    return successReceipt('attach', {
      card, phase: record.phase, no_op: false,
      lease_token: record.lease.token, lease: leaseSummary(record.lease, nowMs),
      branch: record.branch, worktree: record.worktree,
    });
  }
  // terminal phases fall through to the existing 'not parked' refusal below
}
```
IMPORTANT integration notes: (1) the existing idempotent re-resume path (~L3851, matching `last_resume_request` on an implementing card) is now unreachable for implementing cards — the attach branch answers first and preserves the no-op contract; leave the old block in place for safety but expect harness `run-codex-autoloop.js` assertions on implementing-phase resume to need updating (see Step 5). (2) The existing parked-card success path (~L3940-3948, phase flip to `implementing`) must additionally call `acquireLease(record, { now, token: mintLeaseToken() })` before its `persist`, and its success receipt (~L3957) gains `lease_token: record.lease.token, lease: leaseSummary(record.lease, leaseNowMs())`. (3) Add `'lease-token'` to `STRICT_CLI_OPTIONS.resume` (~L48) or `requireOnlyOptions` refuses it.

(d) `commandClaim` (~L5018): change signature to `async function commandClaim(ctx, args, deps = {})` (call sites pass two args — safe), add the same `now`/`mintLeaseToken` dep lines, add `lease` to the record literal (~L5039-5051) via `acquireLease` immediately after the record object is constructed, and add `lease_token: record.lease.token` to the success receipt (~L5064-5067; the receipt spreads the record so `lease` itself already rides along).

(e) Export from `module.exports` (~L7027): `LEASE_TTL_MS, leaseIsLive, leaseSummary, acquireLease, clearLease`.

- [ ] **Step 4: Run the new harness to verify it passes**

Run: `npm run test:autoloop-leases`
Expected: PASS with assertion count printed.

- [ ] **Step 5: Run the existing coordinator harness; reconcile deliberate behavior changes**

Run: `node platform/test/run-codex-autoloop.js`
Expected: PASS, or failures ONLY in assertions that pinned the old resume-on-implementing behavior (idempotent no-op shape or `resume_ineligible` refusals for active cards). For each such failure, update the assertion to the new attach contract (`action: 'attach'`, `lease_token` present) — these are the documented behavior change, not collateral. Any other failure = a real regression; fix the implementation, not the test. Also run `node platform/test/run-autoloop-select.js && node platform/test/run-autoloop-batch.js` (must stay green untouched).

- [ ] **Step 6: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-autoloop-leases.js package.json platform/test/run-codex-autoloop.js
git commit -m "feat(autoloop): per-card lease core — claim/resume acquisition and active-card attach"
```

---

### Task 2: Pipeline-verb enforcement — require, renew, release

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` (shared guard + 8 verb sites + `STRICT_CLI_OPTIONS` ~L45-54)
- Modify: `platform/test/run-autoloop-leases.js` (second tranche)

**Interfaces:**
- Consumes: `leaseIsLive`, `clearLease`, `leaseSummary` from Task 1.
- Produces: `requireLeaseToken(record, args, verb, nowMs)` (exported) — refusal codes `lease_required`, `lease_mismatch`, `lease_stale`; on match mutates `record.lease.renewed_at`. Verbs enforced: `record-review`, `verify-gates`, `record-pr`, `advance`, `park`, `amend-contract`, `consume-ratification`, `deploy`. `park` clears the lease on success; `advance` clears it when the record reaches a `TERMINAL` phase.

- [ ] **Step 1: Write the failing tests (second tranche in `run-autoloop-leases.js`)**

Add a table-driven block. For each pure-deps-drivable verb, build a minimal state fixture with a live-leased record in an eligible phase and assert the three refusal codes + the renew-on-match path. `commandRecordReview` is the fully-worked example (mirror the existing pure-deps call at `run-codex-autoloop.js` ~L1513-1522, which shows the exact deps it needs: `readState, sh, writeState, projectLoopStation, withLock`):

```js
const HEAD = 'a'.repeat(40);
function reviewFixture(lease) {
  return { schema_version: 1, cards: { R: {
    card: 'R', phase: 'implementing', worktree: '/w', branch: 'b',
    reviews: [], ...(lease ? { lease } : {}),
  } } };
}
const reviewArgs = { json: true, card: 'R', lens: 'correctness', verdict: 'pass', summary: 'fine', 'expected-head': HEAD };
const reviewDeps = (state, extra = {}) => ({
  readState: () => state, sh: () => HEAD, writeState: () => {}, projectLoopStation: () => {},
  withLock: immediateLock, worktreeExists: () => true,
  leaseNowMs: () => T0 + 1000, now: () => new Date(T0 + 1000).toISOString(), ...extra,
});

// live lease + no token → lease_required
await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs }, reviewDeps(reviewFixture(mkLease()))),
  (e) => e.code === 'lease_required', 'record-review requires token under live lease'); count++;
// live lease + wrong token → lease_mismatch
await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'wrong' }, reviewDeps(reviewFixture(mkLease()))),
  (e) => e.code === 'lease_mismatch', 'wrong token refused'); count++;
// stale lease + old token → lease_stale (must re-resume to take over)
{
  const state = reviewFixture(mkLease());
  await assert.rejects(() => commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'tok-1' },
    reviewDeps(state, { leaseNowMs: () => T0 + LEASE_TTL_MS + 1, now: () => new Date(T0 + LEASE_TTL_MS + 1).toISOString() })),
    (e) => e.code === 'lease_stale', 'stale token refused'); count++;
}
// matching token → proceeds + renews
{
  const state = reviewFixture(mkLease());
  const r = await commandRecordReview({ root: '/ws' }, { ...reviewArgs, 'lease-token': 'tok-1' }, reviewDeps(state));
  ok(r.ok, 'matching token proceeds');
  eq(state.cards.R.lease.renewed_at, new Date(T0 + 1000).toISOString(), 'verb renews lease');
}
// unleased card → tokenless verb still proceeds (back-compat)
{
  const state = reviewFixture(null);
  const r = await commandRecordReview({ root: '/ws' }, { ...reviewArgs }, reviewDeps(state));
  ok(r.ok, 'unleased card works tokenless');
}
```

Then: `requireLeaseToken` unit cases directly (export it) for the remaining verbs' shared behavior, plus two release cases:
- `commandPark` success with matching token on a live-leased implementing card → receipt ok AND `record.lease === undefined` AND `record.lease_breaks` last entry reason `'lease_released_park'`. Park needs a fuller fixture (phase `implementing`, `--depends-on`/`--resume-condition` args) — mirror the park invocation pattern found in `run-codex-autoloop.js` (grep `commandPark(` there for the minimal deps set).
- Terminal clear via `stepCard` injection: call `commandAdvance` with `deps.stepCard` that flips `record.phase = 'deployed'` and returns, matching token supplied → after the call `record.lease === undefined`, `lease_breaks` last reason `'lease_released_terminal'`. Mirror the advance invocation pattern in `run-codex-autoloop.js` (grep `commandAdvance(`; it accepts `deps.stepCard` per coordinator ~L5326).

Run: `npm run test:autoloop-leases` — Expected: FAIL (`requireLeaseToken` not exported; refusals not raised).

- [ ] **Step 2: Implement the shared guard**

Next to the lease helpers:
```js
function requireLeaseToken(record, args, verb, nowMs) {
  if (!record || !record.lease) return; // unleased → back-compat tokenless operation
  const supplied = String(args['lease-token'] || '').trim();
  const live = leaseIsLive(record.lease, nowMs);
  const remedy = `resume --card "${record.card}" --json to attach (or break-lease --card "${record.card}" --reason "..." if the holder is known dead)`;
  if (!live) {
    refuse(`${verb}-refused`, 'lease_stale',
      `card ${record.card} carries a stale lease — ${remedy}`,
      { card: record.card, lease: leaseSummary(record.lease, nowMs) });
  }
  if (!supplied) {
    refuse(`${verb}-refused`, 'lease_required',
      `card ${record.card} is leased; ${verb} requires --lease-token <token from your claim/resume receipt> — ${remedy}`,
      { card: record.card, lease: leaseSummary(record.lease, nowMs) });
  }
  if (supplied !== record.lease.token) {
    refuse(`${verb}-refused`, 'lease_mismatch',
      `--lease-token does not match the live lease on ${record.card} held by ${record.lease.holder && record.lease.holder.host ? record.lease.holder.host : 'another session'} — ${remedy}`,
      { card: record.card, lease: leaseSummary(record.lease, nowMs) });
  }
  record.lease.renewed_at = new Date(nowMs).toISOString(); // renewal rides the verb's own persist
}
```
Design note: stale-with-any-token refuses `lease_stale` BEFORE `lease_required` — a holder returning after TTL must re-attach via resume so the takeover is audited; order matters for the tests above.

- [ ] **Step 3: Insert the guard at all 8 verb sites**

Each insertion goes immediately AFTER the verb's `if (!record) ...` guard (all inside their card-gate locks), as `requireLeaseToken(record, args, '<verb>', (deps.leaseNowMs || (() => Date.now()))());` — add the `leaseNowMs` dep line to each function that lacks it. Exact sites (line anchors + verbatim first-guard from exploration; re-grep if drifted):

| Verb | Function (anchor) | Insert after |
|---|---|---|
| record-review | `commandRecordReview` ~L5109 | `if (!record) refuse('record-review-refused', 'card_not_claimed', ...)` ~L5121 |
| verify-gates | `commandVerifyGates` ~L5161 | `if (!record) throw new Error(...)` ~L5171 |
| record-pr | `commandRecordPr` ~L5264 | `if (!record) refuse('record-pr-refused', ...)` ~L5278 |
| advance | `commandAdvance` ~L5320 | `if (!record) throw new Error(...)` ~L5339 (inside the while-loop's lock callback — guard on the FIRST iteration only: hoist a `let leaseChecked = false;` outside the loop) |
| park | `commandPark` ~L3665 | `if (!record) refuse('park-refused', ...)` ~L3686, after the parked-replay no-op check ~L3687 so literal replay of an already-parked card stays a tokenless no_op |
| amend-contract | `commandAmendContract` ~L3467 | `if (!record) throw new Error(...)` ~L3509 |
| consume-ratification | `commandConsumeRatification` ~L784 | `if (!record) throw new Error(...)` ~L799 |
| deploy | `main()` dispatch ~L7017-7020 | `if (!record) throw new Error('deploy requires a known --card')` ~L7019 (use `Date.now()` directly — dispatch has no deps) |

Releases:
- `commandPark` success path (~L3713-3717): `clearLease(record, 'lease_released_park', now);` right before its `persist`.
- `commandAdvance` (~L5337-5347): after `step(...)` returns inside the lock, `if (TERMINAL.has(record.phase)) clearLease(record, 'lease_released_terminal', () => new Date((deps.leaseNowMs || Date.now)()).toISOString());` — simpler: reuse the function-level `now` dep if `commandAdvance` has one; check and follow local convention.

`STRICT_CLI_OPTIONS` (~L45-54): add `'lease-token'` to the arrays for `park`, `record-review`, `record-pr` (resume already done in Task 1; `amend-park` does NOT get it). Verbs absent from the map (verify-gates, advance, consume-ratification, deploy, amend-contract) parse free-form — no change needed.

Export `requireLeaseToken`.

- [ ] **Step 4: Run tests**

Run: `npm run test:autoloop-leases && node platform/test/run-codex-autoloop.js && node platform/test/run-autoloop-select.js`
Expected: leases harness PASS; the other two PASS untouched (their fixtures are unleased → back-compat path). Any `unknown_option` failure means a STRICT_CLI_OPTIONS array was missed.

- [ ] **Step 5: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-autoloop-leases.js
git commit -m "feat(autoloop): lease enforcement on pipeline verbs with renew-on-verb and park/terminal release"
```

---

### Task 3: break-lease verb + supervised-verb clearing

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` (new `commandBreakLease`; `discardCardCore` ~L4096; `commandRecoverDeployed` ~L6120; dispatch ~L6998-7022; `STRICT_CLI_OPTIONS`; exports)
- Modify: `platform/test/run-autoloop-leases.js` (third tranche)

**Interfaces:**
- Consumes: `clearLease`, `leaseSummary` (Task 1).
- Produces: `commandBreakLease(ctx, args, deps = {})` → `successReceipt('break-lease', {card, no_op, broken: <leaseSummary|null>, reason})`; audit reason `'lease_broken_manual'`. Supervised clears use reason `'lease_cleared_supervised'`.

- [ ] **Step 1: Write the failing tests**

```js
// break-lease clears + audits
{
  const state = { schema_version: 1, cards: { B: { card: 'B', phase: 'implementing', lease: mkLease() } } };
  const r = await commandBreakLease({ root: '/ws' }, { json: true, card: 'B', reason: 'chat window closed' }, {
    readState: () => state, writeState: () => {}, withLock: immediateLock,
    now: () => new Date(T0).toISOString(), leaseNowMs: () => T0,
  });
  eq(r.action, 'break-lease', 'action'); eq(r.no_op, false, 'not a no-op');
  eq(state.cards.B.lease, undefined, 'lease gone');
  eq(state.cards.B.lease_breaks[0].reason, 'lease_broken_manual', 'audited as manual break');
}
// break-lease on unleased card → no_op success
{
  const state = { schema_version: 1, cards: { B: { card: 'B', phase: 'implementing' } } };
  const r = await commandBreakLease({ root: '/ws' }, { json: true, card: 'B', reason: 'x' }, {
    readState: () => state, writeState: () => {}, withLock: immediateLock,
    now: () => new Date(T0).toISOString(), leaseNowMs: () => T0,
  });
  eq(r.no_op, true, 'unleased break is no_op');
}
// break-lease refusals: unknown card → card_not_claimed; missing reason → reason_required
await assert.rejects(() => commandBreakLease({ root: '/ws' }, { json: true, card: 'ghost', reason: 'x' },
  { readState: () => ({ schema_version: 1, cards: {} }), writeState: () => {}, withLock: immediateLock }),
  (e) => e.code === 'card_not_claimed', 'unknown card refused'); count++;
await assert.rejects(() => commandBreakLease({ root: '/ws' }, { json: true, card: 'B', reason: '' },
  { readState: () => ({ schema_version: 1, cards: { B: { card: 'B' } } }), writeState: () => {}, withLock: immediateLock }),
  (e) => e.code === 'reason_required', 'empty reason refused'); count++;
```

For supervised clearing, drive `commandDiscard` with a leased record using its existing pure-deps pattern (grep `commandDiscard(` in `run-codex-autoloop.js` for the minimal deps/args shape — it requires `--reason` and dry-run/confirm mechanics; follow exactly what those tests pass) and assert: tombstoned record has no `lease` and `lease_breaks` last reason is `'lease_cleared_supervised'`.

Run: `npm run test:autoloop-leases` — Expected: FAIL (`commandBreakLease` not a function).

- [ ] **Step 2: Implement**

(a) `commandBreakLease` — place next to `commandAmendPark` (~L3745), mirroring its structure:
```js
async function commandBreakLease(ctx, args, deps = {}) {
  requireJson(args, 'break-lease');
  requireOnlyOptions(args, 'break-lease', STRICT_CLI_OPTIONS['break-lease']);
  const loadState = deps.readState || readState;
  const persist = deps.writeState || writeState;
  const lock = deps.withLock || withLock;
  const now = deps.now || (() => new Date().toISOString());
  const nowMs = (deps.leaseNowMs || (() => Date.now()))();
  const card = String(args.card || '').trim();
  const reason = Array.isArray(args.reason) ? '' : String(args.reason || '').trim();
  if (!card) usage('break-lease-refused', 'card_required', 'break-lease requires --card "<exact name>"');
  if (!reason) refuse('break-lease-refused', 'reason_required', 'break-lease requires --reason "<why the holder is gone>"');
  return withCardGateLock(ctx, card, async () => {
    const state = loadState(ctx);
    const record = state.cards[card];
    if (!record) refuse('break-lease-refused', 'card_not_claimed', `card ${card} is not claimed`);
    const broken = leaseSummary(record.lease, nowMs);
    if (!clearLease(record, 'lease_broken_manual', now)) {
      return successReceipt('break-lease', { card, no_op: true, broken: null, reason });
    }
    record.lease_breaks[record.lease_breaks.length - 1].manual_reason = reason;
    persist(ctx, state, record);
    return successReceipt('break-lease', { card, no_op: false, broken, reason });
  }, { card }, lock);
}
```
(Check `withCardGateLock`'s exact signature at ~L1782 — `(ctx, card, fn, opts = {}, lock = withLock, heldLegacyName = '')` — and match it; look at how `commandAmendPark` wraps itself and copy that wrapping style instead if it differs.)

(b) Supervised clears: in `discardCardCore` (~L4155, right before `state.cards[card] = target; persist(...)`): `clearLease(target, 'lease_cleared_supervised', deps.now || undefined);` — match how `now` is available in that scope (grep the function head; if it has no `now` dep, call `clearLease(target, 'lease_cleared_supervised')` and let the helper default). Same one-liner in `commandRecoverDeployed` where it mutates the record phase (~L6134+). Reap goes through `discardCardCore`, so it's covered. `reconcile*`/`cutover`/`restructure`/`recover` need NO clearing (they don't take cards out of the active set); they bypass by simply not calling the guard.

(c) Dispatch: `STRICT_CLI_OPTIONS['break-lease'] = ['json', 'card', 'reason'];` (~L45-54). In `main()` add `else if (command === 'break-lease') result = await commandBreakLease(ctx, args);` before the usage-throw (~L7022) and append `break-lease` to the usage string. Export `commandBreakLease`.

- [ ] **Step 3: Run tests**

Run: `npm run test:autoloop-leases && node platform/test/run-codex-autoloop.js`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-autoloop-leases.js
git commit -m "feat(autoloop): break-lease verb and supervised lease clearing"
```

---

### Task 4: Status projection + all-work-leased selection

**Files:**
- Modify: `scripts/autoloop/codex-coordinator.js` (`selectClaimCandidate` ~L1646; `selectEpicCandidate`; `summarizeClaimSelection` ~L1727; `commandStatus` active projection ~L5411-5414)
- Modify: `platform/test/run-autoloop-leases.js` (fourth tranche)

**Interfaces:**
- Consumes: `leaseIsLive`, `leaseSummary`.
- Produces: `status.active[i].lease` = `leaseSummary(...)|null`; `status.next.action` gains `'all-work-leased'` with `{leased: [{card, expires_in_ms}], soonest_expiry_ms}`; `at-capacity` next gains `resumable: [<unleased-or-stale active card names>]`.

- [ ] **Step 1: Write the failing tests**

Drive `commandStatus` in-process. Find how `run-codex-autoloop.js` invokes `commandStatus(ctx, opts)` (grep `commandStatus(`; it takes `{state, boardMd, loadCard, cardsRoot, supervised}` per `batch-runner.js` L367) and build:

```js
function statusFixture(leases) { // leases: array of lease|null for three active cards
  const cards = {};
  ['A1', 'A2', 'A3'].forEach((name, i) => {
    cards[name] = { card: name, phase: 'implementing', branch: `b${i}`, worktree: `/w${i}`,
      ...(leases[i] ? { lease: leases[i] } : {}) };
  });
  return { schema_version: 1, cards };
}
const BOARD = '## In Planning\n\n## Implementation\n\n## Completed\n'; // minimal board — no claimable work
// all three active + all live-leased → all-work-leased
{
  const receipt = await commandStatus({ root: '/ws' }, {
    state: statusFixture([mkLease(), mkLease({ token: 't2' }), mkLease({ token: 't3' })]),
    boardMd: BOARD, loadCard: () => null, cardsRoot: '/cards', supervised: false,
    leaseNowMs: () => T0 + 1000,
  });
  eq(receipt.next.action, 'all-work-leased', 'all leased at capacity → all-work-leased');
  eq(receipt.next.leased.length, 3, 'names all leased cards');
  ok(receipt.active[0].lease && receipt.active[0].lease.held === true, 'status projects lease per card');
}
// one lease stale → at-capacity with that card resumable
{
  const receipt = await commandStatus({ root: '/ws' }, {
    state: statusFixture([mkLease(), mkLease({ token: 't2' }), mkLease({ token: 't3', renewed_at: new Date(T0 - LEASE_TTL_MS - 1000).toISOString() })]),
    boardMd: BOARD, loadCard: () => null, cardsRoot: '/cards', supervised: false,
    leaseNowMs: () => T0 + 1000,
  });
  eq(receipt.next.action, 'at-capacity', 'stale lease keeps at-capacity');
  eq(receipt.next.resumable, ['A3'], 'stale-leased card listed resumable');
}
// under capacity with unleased active card → unchanged 'claim'/'no-work' semantics (regression guard)
```
Adjust fixture plumbing to whatever `commandStatus` actually requires (it may need `boardPath`/fs stubs — copy a working status invocation from `run-codex-autoloop.js` or `run-autoloop-batch.js` verbatim and modify). If `commandStatus` reads time internally, thread `opts.leaseNowMs` through (add it — default `() => Date.now()`).

Run: `npm run test:autoloop-leases` — Expected: FAIL.

- [ ] **Step 2: Implement**

(a) `selectClaimCandidate` (~L1646-1653): at the `active.length >= MAX_ACTIVE` return, include the records: `return { action: 'at-capacity', active: active.map(r => r.card), activeRecords: active };`. Locate `selectEpicCandidate` (grep `function selectEpicCandidate`) and apply the identical change at its capacity gate.

(b) `summarizeClaimSelection` (~L1727-1748): in the `'at-capacity'` branch, compute lease-awareness (thread `nowMs` in from the caller — `commandStatus` passes it; default `Date.now()`):
```js
const records = selected.activeRecords || [];
const resumable = records.filter((r) => !leaseIsLive(r.lease, nowMs)).map((r) => r.card);
const leased = records.filter((r) => leaseIsLive(r.lease, nowMs))
  .map((r) => ({ card: r.card, expires_in_ms: leaseSummary(r.lease, nowMs).expires_in_ms }));
if (records.length && resumable.length === 0) {
  return { action: 'all-work-leased', leased,
    soonest_expiry_ms: Math.min(...leased.map((l) => l.expires_in_ms)) };
}
return { action: 'at-capacity', active: selected.active, resumable, leased };
```
Keep the existing at-capacity `active` field byte-compatible (card-name array) — `batch-runner.js` and existing harnesses read it. Make sure `activeRecords` (full records) never leaks into the receipt (strip it in summarize).

(c) `commandStatus` active projection (~L5411-5414): add `lease: leaseSummary(r.lease, nowMs)` to the per-card object (null when unleased). Add `nowMs` = `(opts.leaseNowMs || (() => Date.now()))()` at the top of `commandStatus` and pass it to the `summarizeClaimSelection` call (~L5380-5386). Also add the same `lease` field to the parked projection (~L5415-5427) — parked cards are never leased after Task 2, but a pre-lease-clear state file could carry one; projecting it keeps status honest.

- [ ] **Step 3: Run tests**

Run: `npm run test:autoloop-leases && node platform/test/run-codex-autoloop.js && node platform/test/run-autoloop-batch.js && node platform/test/run-autoloop-select.js`
Expected: all PASS (`batch-runner` validates only ledger fields, never `status.next` — confirmed; if `run-autoloop-batch.js` pins a status receipt shape, update only additive-field expectations).

- [ ] **Step 4: Commit**

```bash
git add scripts/autoloop/codex-coordinator.js platform/test/run-autoloop-leases.js
git commit -m "feat(autoloop): lease-aware status projection and all-work-leased selection"
```

---

### Task 5: Skill bodies, docs, schema registry

**Files:**
- Modify: `plugins/loop/skills/run/SKILL.md` (L28, L44, L48)
- Modify: `plugins/loop/skills/execute/SKILL.md` (L14 claim, L18, L31-33, L37, L38, L39)
- Modify: `plugins/loop/skills/status/SKILL.md` (narration note)
- Modify: `platform/schemas-index.json`
- Modify: `Docs/agent-guides/loop-plugin.md` (L53, L108), `Docs/agent-guides/delivery-board.md` (L45, L47, L65), `Docs/agent-guides/cycle-status.md` (harness count L77)

**Interfaces:**
- Consumes: the CLI surface exactly as shipped in Tasks 1-4 (`--lease-token`, `lease_token`, `attach`, `all-work-leased`, `break-lease`).

- [ ] **Step 1: Edit `plugins/loop/skills/run/SKILL.md`**

Three edits (quote-anchored; adjust wording to fit surrounding prose style, keep content exact):

1. L28 `run --live` bullet: after "resume eligible active work first, otherwise claim", add: "— resume/claim receipts return `lease_token`; pass `--lease-token <token>` on every subsequent coordinator verb for that card. Resuming an active card is a side-effect-free attach; `lease_held` means another session owns it — take a different card, never work around the refusal."
2. L44 (status.next reading): extend to: "`at-capacity` → resume one of the cards listed in `next.resumable` (they are unleased or stale), never claim another; `all-work-leased` → every active card is owned by a live session — report the leased cards + soonest expiry and STOP; never touch a leased card's worktree."
3. L48 (slice pipeline line): thread the token: "…each recorded via `record-review --lease-token <token>` with exact heads… → `verify-gates --lease-token <token>` → push + PR + `record-pr --lease-token <token>` → `advance --lease-token <token> --lease-seconds 600 --jsonl`…" (note: `--lease-seconds` is the pre-existing poll duration, unrelated to the lease token — keep both).

- [ ] **Step 2: Edit `plugins/loop/skills/execute/SKILL.md`**

Same threading: claim line gains "(receipt returns `lease_token` — keep it for every verb on this card)"; L18 at-capacity line gains the attach/`lease_held`/`all-work-leased` rules (same language as run L44 edit); the fenced `record-review` block (L31-33) and the `verify-gates`/`record-pr` (L37), `advance`/`reconcile` (L38), `park` (L39) lines each gain `--lease-token <token>` (reconcile is supervised — NO token there; only record-review, verify-gates, record-pr, advance, park).

- [ ] **Step 3: Edit `plugins/loop/skills/status/SKILL.md`**

In the digest-content section (~L19-26), add one line: active cards now carry `lease` (holder/expiry) and `status.next` may be `all-work-leased` — surface "all active work is owned by live sessions (soonest lease expires in Nm)" in the phone-sized digest.

- [ ] **Step 4: Schema registry entry**

In `platform/schemas-index.json`, add to the `schemas` array (mirror the `owner`/field shape of the existing `autoloop-durable-batch-ledger` entry at ~L515 — copy its `owner` object verbatim):

```json
{
  "id": "autoloop-card-lease",
  "kind": "learned-state-schema",
  "owner": { "type": "workshop", "name": "sauce" },
  "source": "scripts/autoloop/codex-coordinator.js",
  "validator": "platform/test/run-autoloop-leases.js",
  "consumers": [
    "plugins/loop/skills/run/SKILL.md",
    "plugins/loop/skills/execute/SKILL.md",
    "scripts/autoloop/batch-runner.js"
  ],
  "notes": "Per-card session lease on coordinator state records: lease {token, acquired_at, renewed_at, holder{host,label}}, TTL 2h from renewed_at, time-based only (coordinator processes are short-lived; pid liveness can't arbitrate). Acquired by claim/resume, required (--lease-token) + renewed by pipeline verbs, cleared on park/terminal/supervised paths, broken manually via break-lease. Audit trail in lease_breaks[]. Absent field = unleased (no migration)."
}
```
If the `autoloop-durable-batch-ledger` entry's `owner` differs from `{"type":"workshop","name":"sauce"}`, use ITS owner shape — the lint validates owner.name against catalogs. Run `npm run lint-schemas` — must exit 0.

- [ ] **Step 5: Agent-guide touch-ups**

- `Docs/agent-guides/loop-plugin.md` L53 (`run_scope` knob): add `all-work-leased` as a stop reason alongside frontier-drained/ceiling. L108 harness list: add `test:autoloop-leases`.
- `Docs/agent-guides/delivery-board.md` L45/L47: extend the strict-verb sentences with `--lease-token` and `break-lease`. L65 (`consume-ratification` gates): add "and the card's lease (live lease requires the matching `--lease-token`)".
- `Docs/agent-guides/cycle-status.md` L77: bump the harness count by one (read the current number, +1).
- Add a short "Concurrent sessions & leases" paragraph to `Docs/agent-guides/loop-plugin.md` (after the run_scope knob): what a lease is, the two-chat scenario it prevents, `break-lease` as the escape hatch, 2 h TTL.

- [ ] **Step 6: Run doc-adjacent gates + commit**

Run: `npm run lint-schemas && node platform/test/run-loop-plugin-surface.js && node platform/test/run-loop-codex-routers.js`
Expected: PASS (skill-set unchanged — routers stay byte-identical; if the surface harness pins SKILL.md content hashes/line counts, update per its failure output).

```bash
git add plugins/loop/skills/run/SKILL.md plugins/loop/skills/execute/SKILL.md plugins/loop/skills/status/SKILL.md platform/schemas-index.json Docs/agent-guides/loop-plugin.md Docs/agent-guides/delivery-board.md Docs/agent-guides/cycle-status.md
git commit -m "docs(loop): lease threading in run/execute/status skills, schema registry entry, guide updates"
```

---

### Task 6: Full verification — preflight, bumped preflight, dogfood

**Files:** none new (fixes only if red).

- [ ] **Step 1: Full preflight**

Run: `npm run release:preflight`
Expected: GREEN end-to-end including the new `run-autoloop-leases.js` and both orphan-harness checks. Fix any failure at its root (the failing harness names it); re-run until green.

- [ ] **Step 2: Workshop dogfood**

Run: `node platform/install.js --vault . --auto-approve`
Expected: succeeds (~4 s). This change touches no installer surface, so failure = investigate, don't suppress.

- [ ] **Step 3: Bumped-state preflight (wedge guard)**

Requires a CLEAN tree — commit everything first. Run: `npm run release:preflight-bumped`
Expected: GREEN. This proves `prepare-release` won't wedge post-merge (no version literals were added — the leases harness asserts no component versions).

- [ ] **Step 4: Commit any stragglers**

```bash
git status --short   # stage explicit files only if fixes were needed
git commit -m "fix(autoloop): preflight fixes for card leases" # only if needed
```

---

## Self-review notes (already applied)

- Spec §2 "deploy" verb enforcement → Task 2 table includes the `main()` deploy dispatch site.
- Spec's `resume`-refusal semantics required extending `resume` to active cards (attach) — spec assumed this implicitly; Task 1 makes it explicit and flags the deliberate `run-codex-autoloop.js` assertion updates.
- Type consistency: `--lease-token` (CLI), `record.lease` (state), `lease_token` (receipts), `lease` (receipt summary object), `lease_breaks` (audit) — used uniformly across Tasks 1-5.
- `all-work-leased` reaches only `status.next` consumers; batch-runner confirmed indifferent (validates ledger fields only).
