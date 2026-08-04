'use strict';
// Shared "one source of truth" for the delivery board's canonical topology:
// project-path derivation, the workspace-path validator, and the board-vs-ledger
// slice authority rule. Both the coordinator (via select-card's delivery
// re-export) and card-intake consume this module so a single fact has a single
// implementation. Node built-ins only (mirrors delivery-contract.js).
const path = require('path');

// The vault-relative project prefix + physical root, derived from the ON-DISK
// cards root. The canonical throwing authority: canonicalEpicProjection
// validates against it and heal-epic-bindings writes from it, so what the
// contract demands and what the heal writes cannot drift.
function physicalProjectPrefix(cardsRoot, fsImpl) {
  const fs = fsImpl || require('fs');
  const projectRoot = path.dirname(fs.realpathSync(cardsRoot)).replace(/\\/g, '/');
  const marker = '/spice/projects/';
  const markerAt = projectRoot.lastIndexOf(marker);
  if (markerAt < 0) throw new Error('canonical cards root is outside spice/projects');
  const relative = projectRoot.slice(markerAt + 1);
  if (!/^spice\/projects\/[^/]+$/.test(relative)) {
    throw new Error('canonical cards root is not one project directly under spice/projects');
  }
  return { prefix: relative, root: projectRoot };
}

// True iff `value` is exactly `expected`, is workspace-relative (not absolute,
// no drive letter), and contains no empty / '.' / '..' segment.
function canonicalWorkspacePath(value, expected) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  const parts = raw.split('/');
  return Boolean(raw) && !raw.startsWith('/') && !/^[A-Za-z]:\//.test(raw)
    && !parts.some((part) => !part || part === '.' || part === '..')
    && raw === expected;
}

// The canonical vault-relative atlas + board refs for one epic under a prefix.
function epicBindingPaths(prefix, epic) {
  return {
    atlasRef: path.posix.join(prefix, 'tasks', epic, `${epic}.md`),
    boardRef: path.posix.join(prefix, 'tasks', epic, 'board', `${epic}-board.md`),
  };
}

// The canonical vault-relative reference to a parent board from its basename.
function parentBoardRef(prefix, parentBoardBasename) {
  return path.posix.join(prefix, parentBoardBasename);
}

module.exports = {
  physicalProjectPrefix,
  canonicalWorkspacePath,
  epicBindingPaths,
  parentBoardRef,
};
