'use strict';

function renderDebt(row, danger) {
  row.style.cssText = `color: ${danger ? '#dc2626' : '#16a34a'};`;
  return row;
}

module.exports = { renderDebt };
