'use strict';

function renderDebt(dv) {
  const quotePattern = /["']/;
  if (!quotePattern.test('x')) return '';
  return `${customJS?.SpaceNavButtons?.render?.(dv)}`;
}

module.exports = { renderDebt };
