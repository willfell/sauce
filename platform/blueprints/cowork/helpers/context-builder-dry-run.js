// context-builder-dry-run.js
//
// Helper invoked by cowork:context-builder SKILL.md (step 18) to perform the
// final compose + merge + write of spice/cowork/context/user-preferences.md.
// Same helper backs the live skill AND the HC-V0760-F1..F2 harnesses (which
// pass a dry_run_answers object directly).
//
// S10 fills in the implementation.

"use strict";

const fs = require("fs");
const path = require("path");

function run(_opts) {
    throw new Error("context-builder-dry-run.js: not yet implemented (v0.76.0 S10)");
}

module.exports = { run };
