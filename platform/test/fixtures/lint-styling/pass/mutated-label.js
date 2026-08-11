'use strict';

function renderSave(parent) {
  let label = '+ Add item';
  label = 'Save';
  return parent.createEl('button', { text: label });
}

module.exports = { renderSave };
