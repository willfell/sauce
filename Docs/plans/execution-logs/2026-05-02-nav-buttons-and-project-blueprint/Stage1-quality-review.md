# Stage 1 code-quality review

Scope: `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault/platform/install.js` (full file, with emphasis on Stage 1 changes from Tasks 1.2 / 1.3 / 1.4).

Spec compliance was already PASS in `Stage1-spec-review.md`; this review only evaluates code quality.

---

## Correctness

### C1. Topological sort handles all node states correctly. PASS

`topoSort` (lines 307–329) treats four states cleanly:

- `visited`: short-circuit return true (already in `order`).
- `temp` (in-progress): cycle, return false.
- `unfit`: return true without recursing or pushing to `order` — correct, unfit nodes never appear in install order.
- missing from map (`!nodes.get(name)`): return true (treated as satisfied — defensive, but in practice can't happen because callers only iterate over names from `nodes.keys()`).

### C2. `satisfiesRange` is correct for the supported syntax but silently rejects everything else. MINOR

`satisfiesRange` (lines 292–305):

- Same version equality: covered by the literal-string compare on line 293 (catches `range === "1.0.0"` with `version === "1.0.0"`).
- `>=N.N.N`: handled with explicit major/minor/patch comparison. Correct.
- **Anything else** — `^1.0.0`, `~1.0.0`, `1.x`, `*`, `>=1.0.0 <2.0.0`, leading-`v`, prerelease tags, missing patch — silently returns `false`, which surfaces as a "subscription pins X@Y" skip. The user gets a misleading message ("subscription pins …") when the actual cause is unrecognized range syntax.

This is a documented limitation in the design doc, but the failure mode is silent + confusing. Not a blocker — the workshop currently only authors `>=N.N.N` ranges — but the moment somebody types `^1.0.0` in a manifest they will lose an hour. Suggest making unrecognized range syntax produce a distinct skip reason (`"unrecognized version range syntax: <range>"`).

### C3. Strict `substitute()` correctly handles empty-string values. PASS

Line 168: `if (variables[key] === undefined || variables[key] === null)`. Empty string `""` and `0` and `false` all pass through. The substitution writes the empty string, no missing-var error. Correct per spec.

### C4. `applyRuleFragment` silently overwrites malformed pre-existing rule files. MINOR (data-loss risk)

Lines 341–348:

```javascript
let existing = {};
if (await adapter.exists(rulePath)) {
  try {
    existing = JSON.parse(await adapter.read(rulePath));
  } catch (e) {
    existing = {};
  }
}
existing.contributions = existing.contributions || {};
existing.contributions[sourceName] = frag.fragment;
await adapter.write(rulePath, JSON.stringify(existing, null, 2));
```

On JSON parse failure, the file is silently rewritten as a fresh `{ contributions: { [sourceName]: ... } }`, **clobbering** whatever was in the broken file (which may have been a hand-edit the user wanted recovered). The same pattern in `enableSnippet` (lines 358–362) is more dangerous because `appearance.json` is an Obsidian system file — if it was malformed for any reason, the installer silently rewrites it to the empty object plus `enabledCssSnippets`.

Suggest: on parse failure, surface a Notice naming the file and skip the rule-fragment / snippet step for this run instead of silently rewriting. The user gets a chance to inspect / back up before re-running.

Severity: MINOR. Won't bite during a clean dogfood (files are absent or installer-written on first install). Will bite the day a user hand-edits a rule file and introduces a syntax error.

### C5. Unfit node short-circuits `topoSort` correctly so the install loop never sees one. PASS

`checkDeps` sets `node.unfit = true` (line 275 / 283). `topoSort.visit` (line 315) returns true early on unfit without pushing to `order`. The install loop iterates `order` only, so unfit nodes are unreachable. The `installedEntry.version === sub.version` re-check on line 92 is therefore not load-bearing for unfit handling — it only handles the "already at this version, skip re-install" case. Both invariants hold.

---

## Error handling

### E1. No try/catch around any `adapter.read / write / mkdir / exists`. MINOR

Throughout `installItem`, `applyRuleFragment`, and `enableSnippet`, every adapter call is bare-awaited. If any of them throws (disk full, permissions, race with another writer), the exception propagates out of `module.exports`'s top-level await chain, which means:

- The `await writeJson(app, "Docs/Meta/platform-installed.json", installedNow)` on line 104 never runs — so the install items that DID succeed before the throw are not recorded.
- No final "platformInstall: complete" Notice fires; the user sees a generic error in the dev console.

Suggest: wrap the install loop body (lines 87–102) in try/catch per item, log the failure to history with `event: "error"`, continue to the next item, and make sure `writeJson(installedNow)` always runs (use `try/finally` at the outer `module.exports` level).

Severity: MINOR for a clean-disk dogfood, but Stage 4's "barebones from zero" goal is exactly the scenario where partial-disk-failure could happen on first install.

### E2. Notice timeout durations are reasonable. PASS

- 4s for "complete" / generic skip (line 105, 137).
- 6s for skip-with-reason (lines 82, 335).
- 8s for substitution / cycle / errors (lines 75, 130, 153). Long enough to read; not blocking.

### E3. `subscriptionLookup` lookup returns undefined when a dep is not in subscription. PASS, handled.

`checkDeps` line 272: `const sub = subscriptionLookup.get(dep.name)`. Map.get returns undefined for missing keys. Line 273: `if (!sub)` catches it and emits the right skip message. No edge case here — the depended-on item is either in nodes (and therefore in the lookup) or not subscribed at all (handled).

What's NOT covered: a dep that IS in the subscription but failed `resolveDependencies` (e.g. version mismatch with the manifest). Such a node is in `missingItems` (the first skipped[] from `resolveDependencies`) but is missing from `subscriptionLookup`. The dependent item gets the misleading "is not subscribed" message even though it WAS subscribed. The truthful message would be "depends on X but X was skipped (workshop has version Y)". MINOR cosmetic issue.

---

## Structural cleanliness

### S1. Dead code from rename (Task 1.4): clean. PASS

I scanned for `installMechanism`, `manPath`, leftover comments. Found:

- `const mech = itemMan;` (line 110) is a renaming artifact — could be inlined, but keeping it preserves readability of the rest of the function. NIT, ignore.
- No `installMechanism` references in code or comments.
- No orphaned `manPath` variable.

### S2. Order of `post_install` then `rule_fragments` is acceptable for current step types. PASS, but worth a comment

In `installItem`, the order is (lines 149–160): `post_install` first, then `rule_fragments`. The reviewer's brief raises whether this should be reversed because post_install could reference rules.

Inspection of current step types:
- `enable_snippet` — touches `.obsidian/appearance.json`, no rule access.
- `notice` — pure UI.

Neither references rules. But future post_install steps (e.g. `validate_now`, `register_dataview_view`) could plausibly want to read newly materialized rules. Reversing the loop order is a one-line change and future-proofs against that. Suggest reversing in a follow-up; not a blocker for Stage 1.

### S3. Main flow's bucket routing is correct. PASS

Lines 87–102: `bucketKey = node.target.kind === "blueprint" ? "blueprints" : "mechanisms"`. The `kind` is annotated onto `target` in `resolveDependencies` line 259 (`const targetWithKind = { ...target, kind: sub.kind }`). Mechanisms route to `mechanisms[]`, blueprints to `blueprints[]`. Verified.

---

## Latent bugs / footguns

### L1. `installedNow.blueprints` is shared by reference with `installed.blueprints`. BLOCKER (data-mutation hazard)

Lines 50–54:

```javascript
const installedNow = {
  ...installed,
  mechanisms: [...(installed.mechanisms || [])],
  history: [...(installed.history || [])],
};
```

`mechanisms` and `history` are deep-copied (new arrays). `blueprints` is NOT — `...installed` spreads the reference, so `installedNow.blueprints === installed.blueprints` if it existed in `installed`. Then on lines 90 / 97–99, the install loop pushes / mutates `installedNow.blueprints`, which mutates the same array now both objects point to.

Concrete failure mode: this doesn't bite the in-memory data because it's all written out via `writeJson` immediately (line 104) and the script exits. But it's a fragile invariant — any future reader code that compares `installed` (the on-disk state) against `installedNow` (the in-progress state) will see them already identical. Also: if `installed.blueprints` is undefined (empty fallback at line 24), then `installedNow.blueprints` is also undefined, and the `installedNow[bucketKey] = installedNow[bucketKey] || []` defensive line on 90 saves the day — but only because of that defensive line. Lose the defensive line and you crash.

**Fix:**

```javascript
const installedNow = {
  ...installed,
  mechanisms: [...(installed.mechanisms || [])],
  blueprints: [...(installed.blueprints || [])],
  history: [...(installed.history || [])],
};
```

This is a one-line addition that hardens the invariant. Marking BLOCKER because it is trivial to fix and the current code only works by accident of the defensive guard on line 90.

### L2. Mechanism + blueprint with the same name silently collide in the `nodes` Map. MINOR

Lines 245–261 (`resolveDependencies`): the for-loop builds `subItems` by concatenating mechanisms and blueprints. If a name appears in both, both iterations call `nodes.set(sub.name, ...)` on the same key — second wins. Since blueprints are pushed second (line 236), the blueprint silently overwrites the mechanism node.

Also on line 238–240: `manifestItem(name)` returns the mechanism first (`||` short-circuits). So even if subscription declares both, `resolveDependencies` reads the mechanism's manifest entry into a node tagged `kind: "blueprint"` — corrupting the `kind` field.

Likelihood: low (the workshop manifest doesn't currently have any name overlap, and design discourages it). But the failure mode is silent and disastrous. Suggest detecting and emitting a hard-skip with reason `"name '<X>' appears as both mechanism and blueprint"`.

### L3. No race protection if `topoSort` is called on an empty node map. PASS (degenerate but safe)

`topoSort({})` with no entries returns `{ order: [], cycle: null }`. The install loop is a no-op. Safe.

---

## Adherence to existing landmines

### LM1. Cross-vault filesystem reads use `require("fs").promises`. PASS

`readAbsolute` (line 191) uses `require("fs").promises`. Mobile-incompatible by design (per landmine #8). Preserved.

### LM2. All metadata is JSON, not YAML. PASS

`readJson` / `writeJson` / `parseJsonText` use `JSON.parse` / `JSON.stringify`. No `parseYaml` reference anywhere. Preserved per landmine #6.

### LM3. No dependence on the `obsidian` virtual module. PASS

Grep-equivalent inspection: no `require("obsidian")` in install.js. The only `require()` calls are for `path` (line 185) and `fs` (line 191). Preserved per landmine #6.

---

## Verdict

**APPROVE WITH MINOR**, with one finding I'm flagging as a quick-fix BLOCKER candidate (L1). The bug is latent, currently masked by a defensive `|| []`, but trivial to harden — fix it before Stage 4 dogfood, where the code path with empty installed state runs for the first time.

If you'd rather treat L1 as MINOR (it doesn't actually crash today), the verdict relaxes to plain APPROVE WITH MINOR and Stage 1 ships as-is.

### Blockers (1)

1. **L1 — `installedNow.blueprints` reference-shared with `installed.blueprints`.** `platform/install.js:50–54`. Add `blueprints: [...(installed.blueprints || [])]` to the `installedNow` literal, mirroring the `mechanisms` and `history` handling. One-line fix.

### Minors worth a follow-up (5)

- **C2** — `satisfiesRange` silently rejects unrecognized syntax; surface a distinct skip reason. `platform/install.js:292–305`.
- **C4** — `applyRuleFragment` and `enableSnippet` silently rewrite malformed JSON files instead of warning + skipping. `platform/install.js:341–348` and `354–371`.
- **E1** — Wrap install loop body in try/catch so partial failures still record state and continue. `platform/install.js:87–102` plus outer `try/finally` for `writeJson(installedNow)`.
- **E3** — Rephrase the "is not subscribed" skip reason to distinguish "subscribed but skipped" from "not subscribed at all". `platform/install.js:274`.
- **L2** — Detect and reject collisions where a name appears as both mechanism and blueprint in subscription. `platform/install.js:245–261`.

### Nits (1, ignored)

- `const mech = itemMan;` (line 110) is an inlinable rename leftover. Not worth touching.

### Confidence

**HIGH** that the code dogfoods cleanly on first install (clean disk, well-formed metadata, no hand edits). **MEDIUM** that it survives the first failure mode encountered in the wild (malformed user-edited rule file, disk error mid-install, an unrecognized range syntax) — it'll work but the failure messages will be misleading and the on-disk state may be partially clobbered.
