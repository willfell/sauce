'use strict';

function renderDebt(parent, plusIcon) {
  return customJS.AccentButton.render(parent, {
    label: 'Add Entry',
    icon: plusIcon,
  });
}

module.exports = { renderDebt };
