'use strict';

function renderDebt(parent, row, customJS) {
  /* justified preface */ row.style.cssText = 'display:flex';
  /* justified preface */ row.style.color = '#bada55';
  /* justified preface */ Object.assign(row.style, { cssText: 'gap:4px' });
  /* justified preface */ customJS.SpaceNavButtons.render(parent);
  /* justified preface */ return parent.createEl('button', { text: '+' });
}

module.exports = { renderDebt };
