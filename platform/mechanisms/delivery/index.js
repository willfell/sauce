'use strict';

// Stable public consumer API. A3 may change consumers, never this import path.
module.exports = require('./scripts/delivery-contract');
// The fs-touching topology surface resolves lazily: restricted loaders that can
// only satisfy the pure contract (OperatorStation's installed-artifact sandbox
// evaluates this index with a require stub limited to delivery-contract) must
// still be able to evaluate the index; Node consumers resolve on first access.
Object.defineProperty(module.exports, 'topology', {
  enumerable: true,
  configurable: true,
  get: () => require('./scripts/delivery-topology'),
});
