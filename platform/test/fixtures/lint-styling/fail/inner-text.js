'use strict';

function renderDebt(parent) {
  const button = parent.createEl('button');
  button.innerText = '+ Add item';
  return button;
}

module.exports = { renderDebt };
