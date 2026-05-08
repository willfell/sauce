// platform/migrate/wikilink-rewrite.js — v0.28.0 S1 SKELETON.
//
// Phase 4.5 cross-blueprint pass: walks every migrated .md file and
// applies WIKILINK_REWRITE_RULES per design Section 5. Idempotent.
//
// Public API:
//   rewriteString(body) → rewrittenBody
//   rewriteAll(targetVaultRoot, planEntries) → { filesScanned, rewrites }
//
// Implementation lands in S2 T2.6.

exports.rewriteString = function(_body) {
    throw new Error("NotImplemented: rewriteString (S1 skeleton)");
};

exports.rewriteAll = function(_targetVaultRoot, _planEntries) {
    throw new Error("NotImplemented: rewriteAll (S1 skeleton)");
};
