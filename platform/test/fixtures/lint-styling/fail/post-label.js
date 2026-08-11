'use strict';

function renderDebt(parent) {
  const addButton =
    parent.createEl(
      `button`,
    );
  addButton.textContent = '+ Add item';
  return addButton;
}

module.exports = { renderDebt };
