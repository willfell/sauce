'use strict';

function retiredLabel() {
  const label = '+ Add item';
  return label;
}

function renderSave(parent, label) {
  return parent.createEl('button', { text: label });
}

module.exports = { renderSave, retiredLabel };
