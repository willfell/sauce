'use strict';

function renderDebt(parent) {
  const row = parent.createEl('div');
  row.style.cssText
    = `color: rgba(
12, 34, 56, 0.7
);`;
  return row;
}

module.exports = { renderDebt };
