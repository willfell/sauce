#!/usr/bin/env node
/**
 * render-handoff — deterministic Sauce Autoloop handoff markdown.
 * Pure: state in -> markdown string out. Mirrors /sauce-pipeline Phase E.
 * Exports: renderHandoff
 */
'use strict';

function listCol(board, name) {
  const arr = (board && board[name]) || [];
  return arr.length ? arr.map((c) => `- [[${c}]]`).join('\n') : '- (empty)';
}

/**
 * @param {object} o
 * @param {number} o.roundN
 * @param {string} o.date            ISO YYYY-MM-DD
 * @param {string} o.mode            'dry-run' | 'live'
 * @param {object} o.outcome         { action, card?, reason?, version? }
 * @param {object} o.board           parseBoard() result (post-turn)
 * @param {string} [o.recommendedNext]
 * @param {string} [o.notes]
 */
function renderHandoff(o) {
  const { roundN, date, mode, outcome, board, recommendedNext, notes } = o || {};
  const card = outcome && outcome.card ? outcome.card : '(none)';
  const ver = outcome && outcome.version ? outcome.version : '(no release this turn)';
  return [
    `# Sauce Autoloop Turn ${roundN} — handoff`,
    '',
    `**Date:** ${date}`,
    `**Mode:** ${mode}`,
    `**Outcome:** ${outcome ? outcome.action : 'unknown'}${outcome && outcome.reason ? ' — ' + outcome.reason : ''}`,
    `**Card:** ${card}`,
    `**Version shipped:** ${ver}`,
    '',
    '## Board snapshot (after this turn)',
    '',
    '### In Planning', listCol(board, 'In Planning'), '',
    '### In Progress', listCol(board, 'In Progress'), '',
    '### Blocked', listCol(board, 'Blocked'), '',
    '## Recommended next',
    `- **Card:** ${recommendedNext ? `[[${recommendedNext}]]` : 'NONE'}`,
    '',
    '## Notes',
    `- ${notes || 'none'}`,
    '',
  ].join('\n');
}

module.exports = { renderHandoff };

if (require.main === module) {
  console.log(renderHandoff({ roundN: 0, date: '1970-01-01', mode: 'dry-run', outcome: { action: 'no-work' }, board: {} }));
  process.exit(0);
}
