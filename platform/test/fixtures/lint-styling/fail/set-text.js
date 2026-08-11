'use strict';

function renderDebt(parent) {
  const button = parent.createEl('button');
  button.setText('+ Add item');
  return button;
}

module.exports = { renderDebt };
