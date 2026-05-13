---
date: 2026-05-13
status: brainstorm-shelf
slot: migrate-layout-stub-resolution-design
cycle: future (v0.38.x housekeeping candidate — bundled with v0.38.0 FIX-LATERs per post-v0.38.1 next-cycle handoff §E)
related:
  - platform/cli/cmd-migrate-layout.js (8-step state machine; steps 5-7 are the defect surface)
  - platform/installer-stub.js (canonical stub; content-static per landmine #13)
  - platform/test/run-migrate-layout.js (18 sub-asserts; mocks `_runInstaller` — the coverage gap)
  - platform/test/run-install.js (loads `ranch/templater/platformInstall.js`; crash site)
  - Docs/plans/2026-05-13-v0.38.0-result.md (Surprises §S12.2 — first observed)
  - Docs/prompts/2026-05-13-post-v0.38.1-next-cycle-handoff.md (§E item (a))
  - Docs/prompts/2026-05-12-onboard-accuris-on-other-mac.md (the recipe that triggers the path)
---

# `sauce migrate-layout` — stub + resolution defect (brainstorm-shelf)

> [!abstract] Problem
> `sauce migrate-layout` (v0.36.0+ through v0.38.1) reliably bricks any legacy vault it's run against. The 8-step state machine archives `<vault>/pantry/`, registers the vault in `~/.sauce/vaults.json`, then invokes the installer — which loads the **unchanged** in-vault `ranch/templater/platformInstall.js` stub. That stub reads `cfg.workshop_relative_path = "pantry"` and resolves to `<vault>/pantry/platform/install.js` — the directory the state machine just archived. ENOENT. The vault is left half-migrated (registered, no pantry, broken stub). v0.38.0's S12.2 surprise framed this as "test-vault is on a stale layout"; v0.38.1's next-cycle handoff §E(a) framed it as "migrate test-vault" housekeeping. Both miss the broader defect: **`cmd-migrate-layout.js` itself has no path to a working post-migration state, regardless of which legacy vault is the target.**

## Today's behavior (v0.38.1)

8-step state machine in `platform/cli/cmd-migrate-layout.js`:

| Step | Action | What's wrong |
|---|---|---|
| 1 | Detect `<vault>/pantry/.git/` exists | OK |
| 2 | Preflight brew (`_brewPrefix("sauce")`) | OK |
| 3 | Version-skew check; refuse downgrade w/o `--allow-downgrade` | OK |
| 4 | `fs.renameSync` `pantry/` → `pantry.legacy.<ts>.bak/` | OK (atomic, recoverable via `mv` back) |
| 5 | Defensive regex rewrite of `"pantry/..."` strings in `ranch/platform-installed.json` | OK but irrelevant — `platform-config.json` is the actual resolver source |
| 6 | `registry.add(vaultPath)` → `~/.sauce/vaults.json` | OK |
| 7 | `bootstrap.phaseRunInstaller({vaultPath})` → `runInstall` → spawns `run-install.js` → `require("<vault>/ranch/templater/platformInstall.js")(tp)` → stub reads `cfg.workshop_relative_path` → resolves to `<vault>/pantry/...` → **ENOENT, crash** | DEFECT |
| 8 | `_auditStrict` (production stub returns `{ok:true,_stub:true}`); `--purge` if clean | unreachable; step 7 throws |

The canonical stub at `platform/installer-stub.js` (md5 invariant per landmine #13) is byte-identical between v0.36.0 and v0.38.1:

```js
const workshop = path.resolve(tp.app.vault.adapter.basePath, cfg.workshop_relative_path);
const installer = path.join(workshop, "platform", "install.js");
return require(installer)(tp);
```

The stub has **zero awareness** of `~/.sauce/active-pantry` or the brew libexec. It resolves *only* from vault basePath + `cfg.workshop_relative_path`. After migrate-layout step 4, that path doesn't exist.

## Why the test harness misses it

`platform/test/run-migrate-layout.js` line 54:

```js
_runInstaller: async () => {},
```

Step 7 is mocked as a no-op in every test case. The 18 sub-asserts exercise steps 1-6 + step 8's audit semantics, but never the real installer invocation. `_runInstaller` is on the ctx hook surface explicitly for testability — but production has no equivalent integration test that runs migrate-layout against a real vault.

`platform/test/run-integration-smoke.js` (v0.38.0 bar-ii harness, 17 sub-asserts at v0.38.1) bootstraps a fresh test vault → seeds → audits clean. It does **not** exercise migrate-layout — fresh vaults are already on the v0.36+ layout.

## Repro (session 2026-05-13)

Workshop host = source Mac that shipped v0.37.0. Legacy vault at `/Users/willfellhoelter/notes/sauce/ero-sauce` (has `pantry/.git/`, `ranch/platform-config.json` with `workshop_relative_path: "pantry"`).

```bash
$ sauce migrate-layout --vault /Users/willfellhoelter/notes/sauce/ero-sauce
  Archived: pantry/ → pantry.legacy.20260512-234038.bak
  Registered: /Users/willfellhoelter/notes/sauce/ero-sauce
run-install: vault = /Users/willfellhoelter/notes/sauce/ero-sauce
run-install: installer = /Users/willfellhoelter/notes/sauce/ero-sauce/ranch/templater/platformInstall.js
…
HARNESS CRASH: Cannot find module '/Users/willfellhoelter/notes/sauce/ero-sauce/pantry/platform/install.js'
Require stack:
- /Users/willfellhoelter/notes/sauce/ero-sauce/ranch/templater/platformInstall.js
- /opt/homebrew/Cellar/sauce/0.37.0/libexec/platform/test/run-install.js
Error: runInstall failed with exit 1 — full log: …/ranch/bootstrap-last-install.log
```

Rolled back via `mv pantry.legacy.*.bak pantry` + `sauce vault remove <path>`. State recoverable; no data loss.

## Root cause (three missing pieces)

1. **The in-vault stub is not SAUCE_DIR-aware.** It resolves *only* via `cfg.workshop_relative_path` relative to vault basePath. The v0.36+ design intent ("pantry out of vault, brew-installed, active-pantry override per machine") never made it into the stub.
2. **migrate-layout step 7 has no precondition that the resolution chain works after step 4.** It runs the installer immediately after archiving pantry, with no rewrite of `platform-config.json` or replacement of the stub.
3. **No real-installer integration test covers the migrate-layout path.** `_runInstaller` is mocked everywhere; `run-integration-smoke.js` exercises bootstrap-of-fresh-vault, not migrate-of-legacy-vault.

## Design sketch

### Decision 1 — make the stub resolution chain SAUCE_DIR-aware

Replace the stub body so it picks (in priority order):

1. `~/.sauce/active-pantry` symlink (per-machine dev override; same semantics as the brew bin shim)
2. `brew --prefix sauce` + `/libexec` (queried via `os.homedir()` + `/.sauce/brew-prefix` cached file, populated by `cmd-doctor` or migrate-layout — `brew` is not safe to spawn from inside Templater/Obsidian)
3. **Fallback only:** legacy `cfg.workshop_relative_path` resolution against vault basePath (keeps barebones-style in-vault layouts working for the transition window)

Cached brew-prefix file shape: `~/.sauce/brew-prefix` containing the absolute path string (no JSON; one-line). Written by migrate-layout step 4.5 and by `sauce doctor`. Refreshed on `sauce reinstall`. Per-machine, not synced.

The stub becomes:

```js
module.exports = async (tp) => {
  const path = require("path"), fs = require("fs"), os = require("os");
  const home = os.homedir();
  let sauceDir = null;
  const active = path.join(home, ".sauce/active-pantry");
  try { if (fs.lstatSync(active).isSymbolicLink() || fs.statSync(active).isDirectory()) sauceDir = active; } catch (_e) {}
  if (!sauceDir) {
    const prefixFile = path.join(home, ".sauce/brew-prefix");
    try { sauceDir = path.join(fs.readFileSync(prefixFile, "utf8").trim(), "libexec"); } catch (_e) {}
  }
  if (!sauceDir) {
    // legacy fallback — pre-v0.36 in-vault pantry
    let cfg;
    try { cfg = JSON.parse(await tp.app.vault.adapter.read("ranch/platform-config.json")); }
    catch (e) { new Notice(`platformInstall: failed to read platform-config.json (${e.message})`, 10000); return; }
    sauceDir = path.resolve(tp.app.vault.adapter.basePath, cfg.workshop_relative_path);
  }
  const installer = path.join(sauceDir, "platform", "install.js");
  try { delete require.cache[require.resolve(installer)]; } catch {}
  return require(installer)(tp);
};
```

Stub stays content-static (landmine #13 holds) — every consumer gets identical bytes. The per-machine signal lives in `~/.sauce/`, not in the synced vault.

### Decision 2 — extend migrate-layout state machine

New step ordering:

| # | Step | New? |
|---|---|---|
| 1 | Detect legacy `pantry/.git/` | — |
| 2 | Preflight brew | — |
| 3 | Version-skew check | — |
| 4 | Archive `pantry/` → `pantry.legacy.<ts>.bak/` | — |
| **4a** | **Write `~/.sauce/brew-prefix` with `_brewPrefix("sauce")` result** | NEW |
| **4b** | **Overwrite `<vault>/ranch/templater/platformInstall.js` with current canonical SAUCE_DIR-aware stub from libexec** | NEW |
| **4c** | **Set `cfg.workshop_relative_path = null` (or remove the key) in `ranch/platform-config.json`; new stub ignores it** | NEW |
| 5 | Defensive rewrite of `"pantry/..."` strings in `ranch/platform-installed.json` | — (still defensible) |
| 6 | `registry.add(vaultPath)` | — |
| 7 | `bootstrap.phaseRunInstaller({vaultPath})` | — |
| 8 | `_auditStrict` + optional `--purge` | — |

Step 4b is the load-bearing fix; 4a + 4c are supporting infrastructure for the new stub.

`cmd-bootstrap` and `cmd-reinstall` need the same 4a/4b/4c logic factored to a shared helper (call it `phaseEnsureSauceDirSignals` or similar) so freshly-bootstrapped v0.38.x+ vaults also get the SAUCE_DIR-aware stub + brew-prefix file from day one.

### Decision 3 — close the test coverage gap

Add a new harness `platform/test/run-migrate-layout-integration.js` that:

1. Bootstraps a temp legacy-layout vault (mkdtemp + git-init `pantry/` with a minimal `platform/install.js` stub that records its invocation)
2. Runs the **real** `migrate-layout` (no `_runInstaller` mock)
3. Asserts: pantry archived, `~/.sauce/brew-prefix` written, `ranch/templater/platformInstall.js` matches canonical, installer invoked once
4. Asserts: no leftover `<vault>/pantry/` reference; `cfg.workshop_relative_path` is null or absent

Add to `release:preflight` chain. Bumps integration-smoke whole-suite contribution.

Existing `run-migrate-layout.js` (18 mocked asserts) stays — it's still useful for unit-level state-machine edge cases.

## Trade-offs + open questions

- **Cached brew-prefix vs runtime detection.** Spawning `brew --prefix sauce` from inside Templater is high-friction (Obsidian's plugin runtime has no shell). Caching to a per-machine file is cheap. Trade-off: `brew uninstall && brew install` to a different prefix would leave a stale cache; mitigated by `sauce doctor` refreshing it and `sauce reinstall` invalidating it. Acceptable.
- **What about `~/.sauce/active-pantry` symlinks on machines without brew?** The stub fallback to legacy `cfg.workshop_relative_path` resolution covers this — barebones-style vaults with an inside-vault pantry continue to work. Migration is opt-in via the explicit `sauce migrate-layout` invocation.
- **Cross-machine sync of a freshly-migrated vault.** Vault gets synced (iCloud / Obsidian Sync / git) to a Mac where sauce isn't brew-installed. The new stub falls through both active-pantry and brew-prefix-cache → fallback resolution → `cfg.workshop_relative_path = null` → fails loud with a clear Notice ("sauce platform not found on this machine; run `brew install willfell/sauce/sauce`"). Better than today's silent breakage.
- **What about the v0.38.0 result's S12.2 test-vault stub form `<vault>/../beacon/platform/install.js`?** That's a *different* legacy form from the v0.36-era `pantry/` form. The fallback branch handles either, since both go through `cfg.workshop_relative_path`. The SAUCE_DIR-aware path replaces them both.
- **Do we need a `sauce migrate-stub` verb for already-migrated v0.36-layout vaults that are stuck on the old stub?** Probably not as its own verb. `sauce reinstall --vault <path>` should be idempotent over the stub overwrite (Decision 2 step 4b applies the same logic). Verify in the integration harness.

## Cycle sizing

| Stage | Work | Effort |
|---|---|---|
| S1 | Stub rewrite (`platform/installer-stub.js`) + landmine #13 md5 invariant update | 1h |
| S2 | `cmd-migrate-layout.js` steps 4a/4b/4c | 1h |
| S3 | `cmd-bootstrap` + `cmd-reinstall` factor shared helper | 1.5h |
| S4 | `run-migrate-layout-integration.js` new harness | 2h |
| S5 | Wire into `release:preflight`; update `run-doctor-self.js` to assert `~/.sauce/brew-prefix` shape | 0.5h |
| S6 | Manual end-to-end pass: `ero-sauce` + `headspace-sauce` + `accuris-sauce` full migration on workshop Mac | 0.5h |
| S7 | Cycle close (manifest bump, CLAUDE.md status snapshot, cycle-history archive) | 0.5h |

**Total: ~7h.** Larger than v0.38.0's "small housekeeping" framing implied; the test gap closure is the cost driver. Realistic target: **v0.39.0** or its own **v0.38.2** PATCH cycle (skip v0.38.x bundled housekeeping framing — this defect deserves its own cycle for the test harness alone).

## Recommendation

1. Promote this from §E(a) housekeeping bullet to its own cycle (v0.38.2 or v0.39.x).
2. Update `Docs/prompts/2026-05-13-post-v0.38.1-next-cycle-handoff.md` §E(a) to point at this design doc + reframe from "migrate test-vault" to "fix migrate-layout".
3. Until shipped, document the workaround in `Docs/landmines.md`: **do not run `sauce migrate-layout` against any legacy vault on v0.36.0 through v0.38.1.** Legacy vaults stay legacy until v0.38.2/v0.39.x. Mark as landmine #23 candidate (pending cycle that closes the defect — at which point the landmine retires).

## Status updates this doc should trigger when it's promoted

- `Docs/landmines.md`: add #23 (migrate-layout-don't-run-yet) at design-doc commit
- `Docs/prompts/2026-05-13-post-v0.38.1-next-cycle-handoff.md`: §E(a) reframed
- `Docs/prompts/2026-05-12-onboard-accuris-on-other-mac.md`: Phase 3 Case A blocked-pending-cycle banner
- `CLAUDE.md` Status (live): blocker note next to "next cycle"
