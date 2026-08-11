'use strict';

function renderDebt(parent) {
  return parent.createEl('button').setText('+ Add item');
}

module.exports = { renderDebt };
