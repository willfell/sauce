'use strict';

function renderDebt(parent) {
  return parent.createEl('button', {
    attr: {
      'aria-label': 'Create item',
      'data-owner': 'fixture',
      'data-surface': 'lint-styling',
      'data-purpose': 'exercise an options object longer than a line window',
    },
    cls: [
      'fixture-button',
      'fixture-button-long-form',
    ],
    text: `+ Add`,
  });
}

module.exports = { renderDebt };
