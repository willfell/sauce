'use strict';

function renderWithoutCssText(row, log) {
  Object.assign(row.style, { display: 'block' });
  // cssText: legacy prose only
  log('cssText: legacy prose only');
  Object.assign(row.style, {
    theme: {
      cssText: 'nested data, not a style property',
    },
  });
  return row;
}

module.exports = { renderWithoutCssText };
