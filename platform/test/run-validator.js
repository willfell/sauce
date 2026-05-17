// platform/test/run-validator.js — v0.53.0 FA-1
// Tests the validator mechanism's extends: loader. Targets the CLI rule-runner
// path (platform/audit/rule-runner.js); the in-vault validate.js loader is a
// straightforward mirror covered by inspection (no Obsidian app available in
// node-only harness).

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ruleRunner = require("../audit/rule-runner.js");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok ${label}`); pass++; }
    else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

function withTempVault(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-val-"));
    try { return fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeVaultBase(vault, baseName, content) {
    const dir = path.join(vault, "ranch", "rules");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${baseName}.json`), JSON.stringify(content));
}

function writeWorkshopBase(workshop, baseName, content) {
    const dir = path.join(workshop, "platform", "rules");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${baseName}.json`), JSON.stringify(content));
}

// =============================================================================
// VAL-EX-1: extends resolution merges base required_frontmatter into fragment
// =============================================================================
withTempVault((vault) => {
    ruleRunner._clearExtendsCache();
    writeVaultBase(vault, "_canonical-vocab", {
        id: "_canonical-vocab",
        required_frontmatter: {
            type: { required: true, type: "string" },
            created_at: { required: true, type: "string" },
        },
    });
    const fragment = {
        extends: "_canonical-vocab",
        scope: { path_glob: "spice/**/*.md" },
    };
    const merged = ruleRunner._resolveExtends(fragment, vault, null);
    ok("VAL-EX-1a base required_frontmatter merged",
        merged.required_frontmatter && merged.required_frontmatter.type && merged.required_frontmatter.created_at);
    ok("VAL-EX-1b fragment retains scope", merged.scope && merged.scope.path_glob === "spice/**/*.md");
});

// =============================================================================
// VAL-EX-2: fragment-wins on key conflict
// =============================================================================
withTempVault((vault) => {
    ruleRunner._clearExtendsCache();
    writeVaultBase(vault, "_canonical-vocab", {
        required_frontmatter: { type: { required: true, type: "string", matches: "^base$" } },
    });
    const fragment = {
        extends: "_canonical-vocab",
        required_frontmatter: { type: { required: true, type: "string", matches: "^fragment$" } },
    };
    const merged = ruleRunner._resolveExtends(fragment, vault, null);
    ok("VAL-EX-2 fragment-wins on conflicting key",
        merged.required_frontmatter.type.matches === "^fragment$",
        `got: ${JSON.stringify(merged.required_frontmatter.type)}`);
});

// =============================================================================
// VAL-EX-3: extends to non-existent base → fragment unchanged
// =============================================================================
withTempVault((vault) => {
    ruleRunner._clearExtendsCache();
    const fragment = {
        extends: "does-not-exist",
        required_frontmatter: { x: { required: true } },
    };
    const merged = ruleRunner._resolveExtends(fragment, vault, null);
    ok("VAL-EX-3 missing base → fragment unchanged",
        merged === fragment && merged.required_frontmatter.x.required === true);
});

// =============================================================================
// VAL-EX-4: extends to malformed-JSON base → fragment unchanged
// =============================================================================
withTempVault((vault) => {
    ruleRunner._clearExtendsCache();
    const dir = path.join(vault, "ranch", "rules");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not valid json");
    const fragment = { extends: "broken", required_frontmatter: { y: { required: true } } };
    const merged = ruleRunner._resolveExtends(fragment, vault, null);
    ok("VAL-EX-4 malformed base → fragment unchanged",
        merged === fragment && merged.required_frontmatter.y.required === true);
});

// =============================================================================
// VAL-EX-5: extends absent → fragment unchanged (passthrough)
// =============================================================================
{
    ruleRunner._clearExtendsCache();
    const fragment = { required_frontmatter: { z: { required: true } } };
    const merged = ruleRunner._resolveExtends(fragment, null, null);
    ok("VAL-EX-5 no extends → fragment unchanged", merged === fragment);
}

// =============================================================================
// VAL-EX-6: vault path resolved before workshop fallback
// =============================================================================
withTempVault((vault) => {
    withTempVault((workshop) => {
        ruleRunner._clearExtendsCache();
        writeVaultBase(vault, "_canonical-vocab", {
            required_frontmatter: { source: { required: true, equals: "vault" } },
        });
        writeWorkshopBase(workshop, "_canonical-vocab", {
            required_frontmatter: { source: { required: true, equals: "workshop" } },
        });
        const fragment = { extends: "_canonical-vocab" };
        const merged = ruleRunner._resolveExtends(fragment, vault, workshop);
        ok("VAL-EX-6 vault path wins over workshop fallback",
            merged.required_frontmatter.source.equals === "vault",
            `got: ${JSON.stringify(merged.required_frontmatter.source)}`);
    });
});

// =============================================================================
// VAL-EX-7: workshop fallback used when vault path absent
// =============================================================================
withTempVault((workshop) => {
    ruleRunner._clearExtendsCache();
    writeWorkshopBase(workshop, "_canonical-vocab", {
        required_frontmatter: { source: { required: true, equals: "workshop" } },
    });
    const fragment = { extends: "_canonical-vocab" };
    const merged = ruleRunner._resolveExtends(fragment, null, workshop);
    ok("VAL-EX-7 workshop fallback when vault absent",
        merged.required_frontmatter.source.equals === "workshop");
});

// =============================================================================
// VAL-EX-8: end-to-end applyRules respects merged required_frontmatter
// =============================================================================
withTempVault((vault) => {
    ruleRunner._clearExtendsCache();
    writeVaultBase(vault, "_canonical-vocab", {
        required_frontmatter: { type: { required: true, type: "string" } },
    });
    const fragment = {
        extends: "_canonical-vocab",
        scope: { path_glob: "spice/**/*.md" },
    };
    // File with no type frontmatter — should trigger required_frontmatter.type violation
    const fileRecord = {
        file: "/fake/spice/x.md",
        relPath: "spice/x/x.md",
        frontmatter: { something: "else" },
        body: "",
        blueprint: "x",
    };
    const violations = ruleRunner.applyRules([fragment], fileRecord, { vaultPath: vault });
    const typeViolation = violations.find(v => v.rule === "required_frontmatter.type" || /type/i.test(v.rule));
    ok("VAL-EX-8 applyRules+extends surfaces merged required_frontmatter violation",
        !!typeViolation, `got violations: ${JSON.stringify(violations)}`);
});

console.log(`\nrun-validator.js: ${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
