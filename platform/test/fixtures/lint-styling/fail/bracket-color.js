'use strict';

function renderDebt(row) {
  row['style']['color'] = '#bada55';
  return row;
}

module.exports = { renderDebt };
