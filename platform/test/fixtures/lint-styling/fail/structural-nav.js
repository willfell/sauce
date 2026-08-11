'use strict';

function renderDebt(parent) {
  const nav = parent.createDiv({ cls: 'finance-nav' });
  for (const label of ['Home', 'Plan']) {
    nav.createEl('button', { text: label });
  }
  return nav;
}

module.exports = { renderDebt };
