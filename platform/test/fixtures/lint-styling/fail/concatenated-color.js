'use strict';

function renderDebt(row) {
  const panelBase = 'display:flex;'
    + ' box-shadow: 0 8px 30px rgba(0,0,0,0.30);'
    + ' overflow:auto;';
  row.style.cssText = panelBase;
  return row;
}

module.exports = { renderDebt };
