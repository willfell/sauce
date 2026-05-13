#!/usr/bin/env node
// scripts/check-version-sync.js — fails if package.json version ≠ workshop_version.
// Catches the drift class observed during v0.38.0 design (pkg=0.36.1 vs ws=0.37.0).

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "platform", "manifest.json"), "utf8"));

if (pkg.version !== manifest.workshop_version) {
    console.error(`version drift: package.json="${pkg.version}" platform/manifest.json workshop_version="${manifest.workshop_version}"`);
    console.error(`reconcile both to the intended release version`);
    process.exit(1);
}

console.log(`version-sync ok: ${pkg.version}`);
process.exit(0);
