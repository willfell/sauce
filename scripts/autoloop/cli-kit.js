'use strict';

const EXIT_CODES = Object.freeze({
  success: 0,
  refusal: 1,
  usage: 2,
});

class CliRefusal extends Error {
  constructor(action, code, message, extra = {}) {
    super(message);
    this.name = 'CliRefusal';
    this.action = action || 'error';
    this.code = code || 'command_refused';
    this.exitCode = EXIT_CODES.refusal;
    this.extra = extra;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1];
    const parsed = value && !value.startsWith('--') ? value : true;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = Array.isArray(out[key]) ? [...out[key], parsed] : [out[key], parsed];
    } else out[key] = parsed;
    if (parsed !== true) i++;
  }
  return out;
}

function successReceipt(action, fields = {}) {
  return {
    action,
    ok: true,
    no_op: false,
    ...fields,
  };
}

function refusalReceipt(action, code, message, extra = {}) {
  return {
    action: action || 'error',
    ok: false,
    no_op: false,
    code: code || 'command_refused',
    message,
    ...extra,
  };
}

function refuse(action, code, message, extra = {}) {
  throw new CliRefusal(action, code, message, extra);
}

function usage(action, code, message, extra = {}) {
  const error = new CliRefusal(action, code, message, extra);
  error.exitCode = EXIT_CODES.usage;
  throw error;
}

function requireJson(args, verb) {
  if (!args || args.json !== true) {
    refuse(`${verb}-refused`, 'json_required', `${verb} requires --json for a machine-readable receipt`);
  }
}

function receiptForError(error) {
  if (error instanceof CliRefusal) {
    return refusalReceipt(error.action, error.code, error.message, error.extra);
  }
  return refusalReceipt(
    error && error.action ? error.action : 'error',
    error && error.code ? error.code : 'command_failed',
    error && error.message ? error.message : String(error),
  );
}

function validateReceiptEnvelope(receipt) {
  const errors = [];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { ok: false, errors: ['receipt must be an object'] };
  }
  if (typeof receipt.action !== 'string' || !receipt.action.trim()) {
    errors.push('action must be a non-empty string');
  }
  if (typeof receipt.ok !== 'boolean') errors.push('ok must be boolean');
  if (typeof receipt.no_op !== 'boolean') errors.push('no_op must be boolean');
  if (receipt.ok === false) {
    if (typeof receipt.code !== 'string' || !receipt.code.trim()) {
      errors.push('refusal code must be a non-empty string');
    }
    if (typeof receipt.message !== 'string' || !receipt.message.trim()) {
      errors.push('refusal message must be a non-empty string');
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  EXIT_CODES,
  CliRefusal,
  parseArgs,
  successReceipt,
  refusalReceipt,
  refuse,
  usage,
  requireJson,
  receiptForError,
  validateReceiptEnvelope,
};
