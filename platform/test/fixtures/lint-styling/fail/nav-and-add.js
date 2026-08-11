'use strict';

async function renderDebt(dv) {
  await dv.view('ranch/views/customjs-guard', {
    'class':
      'SpaceNavButtons',
  });
  return dv.container.createEl(
    'button',
    {
      'text': '+',
    },
  );
}

module.exports = { renderDebt };
