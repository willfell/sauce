'use strict';

function renderDebt(parent) {
  const row = parent.createEl('div');
  row.style['cssText'] ||= 'display:block';
  return row;
}

module.exports = { renderDebt };
