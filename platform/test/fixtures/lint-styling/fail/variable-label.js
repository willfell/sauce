'use strict';

function renderDebt(parent) {
  let label = '+ Add item'
  // label = 'documentation only';
  if (label === '+ Add item') label.trim();
  return parent.createEl('button', { text: label });
}

module.exports = { renderDebt };
