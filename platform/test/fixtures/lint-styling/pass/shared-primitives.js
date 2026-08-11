'use strict';

async function renderShared(dv) {
  await customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter({}));
  return customJS.EntityCreate.create({ instance: 'project', dv });
}

module.exports = { renderShared };
