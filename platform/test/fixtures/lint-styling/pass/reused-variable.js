'use strict';

function renderButton(parent) {
  const item = parent.createEl('button');
  return item;
}

function renderCounter(parent) {
  const item = parent.createEl('div');
  item.textContent = '+ 3 more';
  return item;
}

module.exports = { renderButton, renderCounter };
