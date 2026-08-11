'use strict';

function renderDebt(row) {
  const cssText = 'display:flex';
  Object.assign(row.style, {
    cssText,
  });
  Object.assign(row.style, {
    "cssText": 'display:grid',
  });
  Object.assign(row['style'], {
    ['cssText']: 'display:block',
  });
  return row;
}

module.exports = { renderDebt };
