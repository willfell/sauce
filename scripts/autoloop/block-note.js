#!/usr/bin/env node
/**
 * block-note — the autoloop's collaborative block/unblock helpers. Pure.
 * On block, the loop appends a "needs your input" section to the card note;
 * next turn it reads the user's reply under the marker to decide whether to
 * unblock. (No emoji in the header — icons-only house style.)
 *
 * Exports: renderBlockedSection, parseBlockedResponse
 */
'use strict';

const HEADER = '## Autoloop — blocked, needs your input';
const RESPONSE_MARKER = '**Your response:**';

function renderBlockedSection(o) {
  const { date = '(unknown)', reason = '(unspecified)', needs = [] } = o || {};
  const needsList = (needs && needs.length) ? needs.map((n) => `- ${n}`).join('\n') : '- (none specified)';
  return [
    '',
    '---',
    HEADER,
    '',
    `**Blocked:** ${date}`,
    `**Why:** ${reason}`,
    '**What I need from you:**',
    needsList,
    '',
    RESPONSE_MARKER,
    '<!-- write your answer below this line; the loop reads it on its next pass and unblocks if it is enough -->',
    '',
    '',
  ].join('\n');
}

function parseBlockedResponse(cardBody) {
  const body = String(cardBody || '');
  // hasSection: any block section exists (FIRST header). Reply: read after the
  // LAST response marker — robust to the header string appearing inside the
  // user's reply, and to a card re-blocked more than once (last reply wins).
  if (body.indexOf(HEADER) === -1) return { hasSection: false, hasResponse: false, response: '' };
  const mi = body.lastIndexOf(RESPONSE_MARKER);
  if (mi === -1) return { hasSection: true, hasResponse: false, response: '' };
  let after = body.slice(mi + RESPONSE_MARKER.length);
  after = after.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*---\s*$/gm, '');
  const response = after.trim();
  return { hasSection: true, hasResponse: response.length > 0, response };
}

module.exports = { renderBlockedSection, parseBlockedResponse };

if (require.main === module) {
  console.log(renderBlockedSection({ date: '1970-01-01', reason: 'demo', needs: ['q1', 'q2'] }));
  process.exit(0);
}
