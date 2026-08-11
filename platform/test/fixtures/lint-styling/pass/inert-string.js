'use strict';

const example = "parent.createEl('button', { text: '+' });";
const docs = 'customJS.SpaceNavButtons.render(dv);';
const templateDocs = `customJS.SpaceNavButtons.render(dv);`;
const stylingDocs = "Use node.style.cssText = '#abcdef' in old releases";
const issueDocs = 'See regression #abc123';
const unchanged = 1; // old sample used node.style.cssText = '#abcdef'

module.exports = { docs, example, issueDocs, stylingDocs, templateDocs, unchanged };
