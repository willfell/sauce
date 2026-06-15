#!/usr/bin/env node
// scripts/seed-prev-snapshot.js — archive seed-vault/ to seed-vault-prev/ at
// cycle close. Run this BEFORE rebaseline-seed.js. Provides the one-cycle-back
// safety net referenced in build-test-verify.md.
//
// Usage:
//   node scripts/seed-prev-snapshot.js
//
// Idempotent: overwrites any existing seed-vault-prev/.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SEED_DIR = path.join(REPO_ROOT, "platform/test/seed-vault");
const PREV_DIR = path.join(REPO_ROOT, "platform/test/seed-vault-prev");

function countFiles(root) {
    let n = 0;
    function walk(dir) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            if (ent.isDirectory()) walk(path.join(dir, ent.name));
            else n++;
        }
    }
    walk(root);
    return n;
}

function main() {
    if (!fs.existsSync(SEED_DIR)) {
        console.error(`seed dir missing: ${SEED_DIR}`);
        process.exit(1);
    }
    if (fs.existsSync(PREV_DIR)) {
        console.log(`seed-prev-snapshot: overwriting existing seed-vault-prev/`);
        fs.rmSync(PREV_DIR, { recursive: true, force: true });
    }
    fs.cpSync(SEED_DIR, PREV_DIR, { recursive: true, force: true });
    const n = countFiles(PREV_DIR);
    console.log(`seed-prev-snapshot: archived seed-vault -> seed-vault-prev (${n} files).`);
}

main();
