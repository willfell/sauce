'use strict';

function renderDebt(parent) {
  const nav = parent.createDiv('finance-nav');
  nav.createEl('button', { text: 'Home' });
  return nav;
}

module.exports = { renderDebt };
