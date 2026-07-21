#!/usr/bin/env node
/**
 * delivery-review-ratify — deterministic mutators for the Final Initial Design
 * authority doc. Pure string transforms; the CLI is the only writer.
 *
 * Exports: appendAmendment, flipRatification
 * CLI: node scripts/autoloop/delivery-review-ratify.js flip --fid <p> --heading "<title>" --date <YYYY-MM-DD>
 */
'use strict';
const fs = require('fs');

function appendAmendment(fidText, block) {
  return `${String(fidText).replace(/\s*$/, '')}\n\n${block}`;
}

// Flip exactly the one PROPOSED section whose heading title matches. The heading
// line is `## <title> — PROPOSED <date>`; the callout directly under it is
// `> [!warning] PROPOSED — awaiting Will's ratification`.
function flipRatification(fidText, headingTitle, date) {
  const lines = String(fidText).split('\n');
  const esc = headingTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^##\\s+${esc}\\s+—\\s+PROPOSED\\b.*$`);
  let i = lines.findIndex((l) => headingRe.test(l));
  if (i < 0) return fidText; // not found → no-op, never guess
  lines[i] = `## ${headingTitle} — accepted ${date}`;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    if (/^>\s*\[!warning\]\s*PROPOSED/i.test(lines[j])) {
      lines[j] = `> [!success] Ratified by Will — ${date}`;
      break;
    }
  }
  return lines.join('\n');
}

module.exports = { appendAmendment, flipRatification };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'flip') {
    const fidPath = args[args.indexOf('--fid') + 1];
    const heading = args[args.indexOf('--heading') + 1];
    const date = args[args.indexOf('--date') + 1];
    const out = flipRatification(fs.readFileSync(fidPath, 'utf8'), heading, date);
    fs.writeFileSync(fidPath, out);
    console.log(JSON.stringify({ flipped: heading, date }));
  }
}
