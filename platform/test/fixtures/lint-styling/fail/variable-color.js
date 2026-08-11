'use strict';

function renderDebt(parent) {
  const accent = '#fff';
  // accent = 'documentation only';
  // row.style.color = accent;
  const row = parent.createEl('div');
  row.style.color = accent;
  return row;
}

module.exports = { renderDebt };
