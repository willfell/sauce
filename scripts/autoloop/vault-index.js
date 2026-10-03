'use strict';
/**
 * vault-index: after the rail renames a vault note into place, sends the same
 * bytes to Obsidian's Local REST API as a PUT, then checks Obsidian's folder
 * listings read-only.
 *
 * When the vault has a REST config, a scope takes the vault's write turn, a
 * directory lease under PENDING_DIR, only when it first needs it: when the
 * rail calls beforeNoteWrite (before it writes a note), beforeNoteRewrite
 * (before it reads a note it is about to rewrite) or awaitWriteTurn. A scope
 * that does none of these never takes the turn; a scope that takes it may
 * still write nothing. The rail deletes notes only in discard, reap and
 * restructure, inside the outermost lock before which the verb called
 * awaitWriteTurn, so a delete is made while the verb holds the turn unless
 * the lease could not be written. A scope waits for
 * the turn only while it holds no coordinator lock; inside one, a turn held
 * by another process is refused with LOCKED. The scope keeps the turn until
 * it releases its last outermost coordinator lock or ends, and a turn taken
 * for a note written outside any lock is also given up before the next
 * outermost lock. Giving up the turn sends the scope's notes, waits for each
 * PUT until a complete HTTP response arrives, and only then releases the
 * turn. Losing a response after sending may have begun leaves the process
 * alive and the turn held indefinitely, outside coordinator locks.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tls = require('tls');
const http = require('http');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const REST_CONFIG_RELATIVE = path.join('.obsidian', 'plugins', 'obsidian-local-rest-api', 'data.json');
const REST_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 2000;
const PENDING_DIR = '.sauce-obsidian-writes';
const POLL_MS = 25;
const FOREIGN_TURN_MS = 30 * 60 * 1000;
const EMPTY_TURN_MS = 5000;
const SKIP_NOT_INDEXED = 'not-indexed-by-obsidian';

const REMEDY_OUTSIDE_VAULT = 'outside-vault: the note is not under the vault root, so Obsidian cannot index it';
const REMEDY_NOT_LISTED_AFTER_WRITE_THROUGH = 'not-listed-after-write-through: Obsidian answered the write but its '
  + 'folder listing omits the note; open the vault in desktop Obsidian and re-check';

const scopeStore = new AsyncLocalStorage();
const depthStore = new AsyncLocalStorage();

function remedyUnverified(reason) {
  return `index-unverified (${reason}): the vault's Local REST API was not usable, so whether desktop Obsidian `
    + 'indexed this note is unknown; open desktop Obsidian with the plugin enabled and re-check';
}

function remedyNotListed(reason) {
  return `not-listed (not written through: ${reason}): Obsidian's folder listing omits the note; open it in desktop `
    + 'Obsidian, or re-run the verb with Obsidian reachable';
}

function remedyListingFailed(failure) {
  return `listing-failed (${failure}): Obsidian did not list the note's folder; open the note in desktop Obsidian `
    + 'and re-check';
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// ---------------------------------------------------------------------------
// The vault's REST config.
// ---------------------------------------------------------------------------

function readRestConfig(vaultRoot) {
  if (typeof vaultRoot !== 'string' || !vaultRoot) return { ok: false, reason: 'no-vault-root' };
  let raw;
  try { raw = fs.readFileSync(path.join(vaultRoot, REST_CONFIG_RELATIVE), 'utf8'); }
  catch (_) { return { ok: false, reason: 'no-rest-config' }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return { ok: false, reason: 'malformed-rest-config' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'malformed-rest-config' };
  const apiKey = typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : null;
  if (!apiKey) return { ok: false, reason: 'malformed-rest-config' };
  // A key that cannot be sent as a header value is a malformed config.
  try { http.validateHeaderValue('Authorization', `Bearer ${apiKey}`); }
  catch (_) { return { ok: false, reason: 'malformed-rest-config' }; }
  const port = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  };
  if (parsed.enableInsecureServer === true && port(parsed.insecurePort)) {
    return { ok: true, protocol: 'http:', port: port(parsed.insecurePort), apiKey };
  }
  if (parsed.enableSecureServer !== false && port(parsed.port)) {
    return { ok: true, protocol: 'https:', port: port(parsed.port), apiKey };
  }
  if (parsed.enableInsecureServer !== true && parsed.enableSecureServer === false) {
    return { ok: false, reason: 'rest-server-disabled' };
  }
  return { ok: false, reason: 'malformed-rest-config' };
}

function physicalPath(file) {
  try { return fs.realpathSync(file); } catch (_) { return path.resolve(file); }
}

function vaultOf(vaultRoot) {
  if (typeof vaultRoot !== 'string' || !vaultRoot) return null;
  return { root: vaultRoot, physical: physicalPath(vaultRoot) };
}

function toBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(body == null ? '' : String(body), 'utf8');
}

function parseJson(body) {
  try { return JSON.parse(toBuffer(body).toString('utf8')); } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// The transport. Every request goes to REST_HOST.
// ---------------------------------------------------------------------------

// Opens a connection, giving up after the channel timeout. Nothing is sent
// before it resolves with a socket.
function connect(channel) {
  return new Promise((resolve) => {
    const secure = channel.protocol === 'https:';
    let socket;
    try {
      socket = secure
        ? tls.connect({ host: REST_HOST, port: channel.port, rejectUnauthorized: false })
        : net.connect({ host: REST_HOST, port: channel.port });
    } catch (_) {
      resolve({ failure: 'unreachable' });
      return;
    }
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => { socket.destroy(); settle({ failure: 'timeout' }); }, channel.timeoutMs);
    socket.on('error', () => { socket.destroy(); settle({ failure: 'unreachable' }); });
    socket.once(secure ? 'secureConnect' : 'connect', () => settle({ socket }));
  });
}

// A connected request. GET failures settle normally. Once a note PUT may
// have sent content, losing the response cannot prove that Obsidian will not
// apply those bytes later. Keep both the process and its turn alive until a
// complete HTTP response arrives; a pending Promise alone cannot do that.
function exchange(channel, socket, method, urlPath, headers, body, notePut = false) {
  return new Promise((resolve) => {
    let settled = false;
    let mayHaveSent = false;
    let keepalive = null;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (keepalive) clearInterval(keepalive);
      resolve(value);
    };
    const lostResponse = () => {
      if (mayHaveSent) return;
      settle({ failure: 'unreachable' });
    };
    let req;
    try {
      req = http.request({
        hostname: REST_HOST,
        port: channel.port,
        method,
        path: urlPath,
        headers: { Authorization: channel.authorization, ...headers, ...(body ? { 'Content-Length': String(body.length) } : {}) },
        createConnection: () => socket,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (!res.complete) { lostResponse(); return; }
          settle({ status: res.statusCode, body: Buffer.concat(chunks) });
        });
        res.on('error', lostResponse);
        res.on('aborted', lostResponse);
        res.on('close', () => { if (!res.complete) lostResponse(); });
      });
    } catch (_) {
      socket.destroy();
      settle({ failure: 'request-failed' });
      return;
    }
    req.on('error', lostResponse);
    req.on('close', lostResponse);
    socket.on('error', lostResponse);
    socket.on('close', lostResponse);
    if (notePut) {
      mayHaveSent = true;
      // Intentionally ref'ed. No timeout can safely release this write turn.
      keepalive = setInterval(() => {}, 60000);
    }
    try { req.end(body || undefined); } catch (_) { lostResponse(); }
  });
}

// A GET, abandoned after the channel timeout.
async function get(channel, urlPath) {
  const connected = await connect(channel);
  if (connected.failure) return connected;
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { connected.socket.destroy(); resolve({ failure: 'timeout' }); }, channel.timeoutMs);
  });
  const reply = await Promise.race([exchange(channel, connected.socket, 'GET', urlPath, {}, null), timeout]);
  clearTimeout(timer);
  return reply;
}

// A note PUT. A connection failure before sending is bounded. After sending
// may have begun, only a complete HTTP response lets the scope release its turn.
async function putNote(channel, rel, bytes) {
  const connected = await connect(channel);
  if (connected.failure) return { failure: `connect-${connected.failure}` };
  return exchange(channel, connected.socket, 'PUT', vaultUrlPath(rel), { 'Content-Type': 'text/markdown' }, bytes, true);
}

function vaultUrlPath(rel) {
  return `/vault/${rel.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function vaultFolderUrlPath(folder) {
  return folder ? `${vaultUrlPath(folder)}/` : '/vault/';
}

// ---------------------------------------------------------------------------
// The vault's REST channel, opened once per scope.
// ---------------------------------------------------------------------------

async function channelOf(scope) {
  if (scope.channel) return scope.channel;
  const config = scope.config;
  const channel = {
    usable: false,
    reason: config.ok ? null : config.reason,
    protocol: config.ok ? config.protocol : null,
    port: config.ok ? config.port : null,
    authorization: config.ok ? `Bearer ${config.apiKey}` : null,
    timeoutMs: Number.isFinite(scope.options.timeoutMs) && scope.options.timeoutMs > 0 ? scope.options.timeoutMs : DEFAULT_TIMEOUT_MS,
  };
  scope.channel = channel;
  if (!config.ok) return channel;
  const reply = await get(channel, '/');
  if (reply.failure) {
    channel.reason = { timeout: 'probe-timeout', 'request-failed': 'request-failed' }[reply.failure] || 'unreachable';
    return channel;
  }
  const root = reply.status === 200 ? parseJson(reply.body) : null;
  if (root && root.authenticated === true) {
    channel.usable = true;
    return channel;
  }
  channel.reason = root && root.authenticated === false ? 'rest-unauthorized' : 'unrecognized-rest-server';
  return channel;
}

function disable(channel, reason) {
  channel.usable = false;
  channel.reason = reason;
}

// ---------------------------------------------------------------------------
// Paths.
// ---------------------------------------------------------------------------

function isHiddenFromObsidian(rel) {
  return rel.split('/').some((segment) => segment.startsWith('.'));
}

function startsWithBom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

// Where a folder sits relative to the vault.
function folderOf(vault, dir, folders) {
  let where = folders ? folders.get(dir) : undefined;
  if (where) return where;
  let physical = null;
  const parent = path.dirname(dir);
  const up = folders && parent !== dir ? folderOf(vault, parent, folders).physical : null;
  if (up !== null) {
    const candidate = path.join(up, path.basename(dir));
    try { if (!fs.lstatSync(candidate).isSymbolicLink()) physical = candidate; } catch (_) {}
  }
  if (physical === null) {
    try { physical = fs.realpathSync(dir); } catch (_) { physical = null; }
  }
  const rel = vault ? path.relative(vault.physical, physical === null ? dir : physical) : '..';
  const outside = !vault || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  const folder = outside ? null : rel.split(path.sep).join('/');
  where = { physical, outside, folder, hidden: !outside && isHiddenFromObsidian(folder) };
  if (folders) folders.set(dir, where);
  return where;
}

// Where a path sits relative to the vault.
function locate(vault, file, folders) {
  const abs = path.resolve(file);
  const name = path.basename(abs);
  const where = folderOf(vault, path.dirname(abs), folders);
  const outside = where.outside || !name;
  const vaultRel = outside ? abs : (where.folder ? `${where.folder}/${name}` : name);
  return {
    abs,
    rel: vaultRel,
    outside,
    hidden: !outside && (where.hidden || name.startsWith('.')),
    folder: outside ? null : where.folder,
    name: outside ? null : name,
  };
}

function readBytes(file) {
  try { return fs.readFileSync(file); } catch (_) { return null; }
}

// Whether the note is a regular file with one link.
function plainNote(abs) {
  try {
    const st = fs.lstatSync(abs);
    return st.isFile() && st.nlink === 1;
  } catch (_) {
    return false;
  }
}

function vaultRootForBoard(boardPath) {
  if (typeof boardPath !== 'string' || !boardPath) return null;
  return path.resolve(path.dirname(boardPath), '../../..');
}

// ---------------------------------------------------------------------------
// The vault's write turn: a directory lease at PENDING_DIR/turn.
// ---------------------------------------------------------------------------

function turnPaths(scope) {
  const dir = path.join(scope.vault.physical, PENDING_DIR);
  const lease = path.join(dir, 'turn');
  return { dir, lease, owner: path.join(lease, 'owner.json') };
}

function pidGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; } catch (error) { return Boolean(error) && error.code === 'ESRCH'; }
}

function leaseKey(paths) {
  const owner = parseJson(readBytes(paths.owner) || '');
  if (owner && typeof owner.token === 'string') return { owner, key: owner.token };
  let st;
  try { st = fs.statSync(paths.lease); } catch (_) { return null; }
  return { owner: null, key: `${st.ino}-${Math.round(st.mtimeMs)}`, ageMs: Date.now() - st.mtimeMs };
}

// Removes the lease when its holder is presumed gone: a holder on this
// host whose process is gone, a holder on another host older than
// FOREIGN_TURN_MS, or a lease with no owner record older than EMPTY_TURN_MS.
// A reclaim-<key> file taken with O_EXCL lets one process remove one lease,
// and only if the lease still has the key it read; a reclaim file older than
// EMPTY_TURN_MS is removed.
function reclaimIfAbandoned(paths) {
  const seen = leaseKey(paths);
  if (!seen) return;
  const { owner } = seen;
  let abandoned;
  if (!owner) abandoned = seen.ageMs > EMPTY_TURN_MS;
  else if (owner.host === os.hostname()) abandoned = pidGone(owner.pid);
  else abandoned = !(Date.now() - Date.parse(owner.started_at) <= FOREIGN_TURN_MS);
  if (!abandoned) return;
  const gate = path.join(paths.dir, `reclaim-${seen.key}`);
  try { fs.writeFileSync(gate, '', { flag: 'wx' }); } catch (_) {
    try { if (Date.now() - fs.statSync(gate).mtimeMs > EMPTY_TURN_MS) fs.unlinkSync(gate); } catch (__) {}
    return;
  }
  try {
    const again = leaseKey(paths);
    if (again && again.key === seen.key) fs.rmSync(paths.lease, { recursive: true, force: true });
  } finally {
    try { fs.unlinkSync(gate); } catch (_) {}
  }
}

// Takes the turn if it is free. True when the scope holds it, or when the
// lease directory or its owner.json cannot be written (scope.turnFailed).
function tryTakeTurn(scope) {
  if (scope.turn || scope.turnFailed) return true;
  const paths = turnPaths(scope);
  try {
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.mkdirSync(paths.lease);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      reclaimIfAbandoned(paths);
      return false;
    }
    scope.turnFailed = true;
    return true;
  }
  const token = crypto.randomBytes(12).toString('hex');
  try {
    fs.writeFileSync(paths.owner, `${JSON.stringify({ pid: process.pid, host: os.hostname(), token, started_at: new Date().toISOString() })}\n`, { flag: 'wx' });
  } catch (_) {
    try { fs.rmSync(paths.lease, { recursive: true, force: true }); } catch (__) {}
    scope.turnFailed = true;
    return true;
  }
  scope.turn = { token, paths };
  return true;
}

// Whether the scope holds a coordinator lock, on this path or another.
function insideCoordinatorLock(scope) {
  return (depthStore.getStore() || 0) > 0 || scope.outermost > 0;
}

// The refusal a scope inside a coordinator lock gets when another holder has
// the turn, shaped like the coordinator's own held-lock error.
function turnHeldError(scope) {
  const owner = parseJson(readBytes(turnPaths(scope).owner) || '');
  const pid = owner && owner.pid ? owner.pid : '?';
  const host = owner && owner.host ? owner.host : '?';
  const err = new Error(`lock vault-write-turn held by pid ${pid} on ${host} (a scope inside a coordinator lock does not wait for the vault write turn)`);
  err.code = 'LOCKED';
  err.owner = owner ? { pid: owner.pid, host: owner.host, started_at: owner.started_at } : null;
  return err;
}

// Inside a coordinator lock: takes the turn if it is free, else throws LOCKED.
function takeTurnInsideLock(scope) {
  if (!tryTakeTurn(scope) && !tryTakeTurn(scope)) throw turnHeldError(scope);
}

async function acquireTurn(scope) {
  if (insideCoordinatorLock(scope)) { takeTurnInsideLock(scope); return; }
  while (!tryTakeTurn(scope)) await sleep(POLL_MS);
}

// Whether another scope of this process holds the turn.
function heldByThisProcess(scope) {
  const owner = parseJson(readBytes(turnPaths(scope).owner) || '');
  return Boolean(owner) && owner.pid === process.pid && owner.host === os.hostname();
}

// A synchronous wait blocks this process, so it would never end while
// another scope of this process holds the turn; that case throws instead.
const syncSleep = new Int32Array(new SharedArrayBuffer(4));
function acquireTurnSync(scope) {
  if (insideCoordinatorLock(scope)) { takeTurnInsideLock(scope); return; }
  while (!tryTakeTurn(scope)) {
    if (heldByThisProcess(scope)) throw new Error('the vault write turn is held by another scope of this process');
    Atomics.wait(syncSleep, 0, 0, POLL_MS);
  }
}

function releaseTurn(scope) {
  if (!scope.turn) return;
  const { token, paths } = scope.turn;
  scope.turn = null;
  const owner = parseJson(readBytes(paths.owner) || '');
  if (owner && owner.token === token) {
    try { fs.rmSync(paths.lease, { recursive: true, force: true }); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Scopes, the journal and the flush.
// ---------------------------------------------------------------------------

function openScope(vaultRoot, deps) {
  const options = deps && typeof deps === 'object' ? deps : {};
  const vault = vaultOf(vaultRoot);
  const config = vault ? readRestConfig(vault.root) : { ok: false, reason: 'no-vault-root' };
  const scope = {
    vault, config, options, channel: null, turn: null, turnFailed: false, outermost: 0, reserved: false,
    written: new Map(), pending: new Map(),
  };
  scope.journal = {
    scope,
    flush: () => settle(scope),
    drain() {
      const out = [...scope.written].map(([file, entry]) => ({ path: file, ...entry }));
      scope.written.clear();
      return out;
    },
    get size() { return scope.written.size; },
  };
  return scope;
}

// Called before the rail writes a vault note, and before it reads a note it
// is about to rewrite: takes the write turn, waiting for it only when the
// scope holds no coordinator lock.
function beforeNoteWrite() {
  const scope = scopeStore.getStore();
  if (!scope || !scope.config.ok) return;
  acquireTurnSync(scope);
}

// Records a note the rail has just renamed into place. It is sent to Obsidian
// only when the scope holds the write turn.
function noteWritten(file, value) {
  const scope = scopeStore.getStore();
  if (!scope) return;
  const abs = path.resolve(String(file));
  const bytes = Buffer.from(toBuffer(value));
  if (!scope.config.ok) {
    scope.written.set(abs, { bytes, written_through: false, reason: null });
    return;
  }
  if (!scope.turn) {
    scope.written.set(abs, { bytes, written_through: false, reason: scope.turnFailed ? 'write-turn-unavailable' : 'no-write-turn' });
    return;
  }
  scope.written.set(abs, { bytes, written_through: false, reason: 'not-sent' });
  scope.pending.set(abs, bytes);
}

async function writeThrough(scope, channel, abs, bytes) {
  const item = locate(scope.vault, abs);
  if (item.outside) return 'outside-vault';
  if (item.hidden) return 'dot-prefixed';
  if (startsWithBom(bytes)) return 'bom';
  if (!plainNote(abs)) return 'not-a-plain-note';
  const disk = readBytes(abs);
  if (!disk || !disk.equals(bytes)) return 'disk-changed';
  const reply = await putNote(channel, item.rel, bytes);
  if (reply.failure) {
    disable(channel, reply.failure === 'connect-timeout' ? 'timeout' : 'unreachable');
    return `put-${reply.failure}`;
  }
  if (reply.status === 401 || reply.status === 403) disable(channel, 'rest-unauthorized');
  if (reply.status < 200 || reply.status >= 300) return `put-http-${reply.status}`;
  const after = readBytes(abs);
  if (!after || !after.equals(bytes)) return 'put-bytes-differ';
  return null;
}

// Writes the pending notes through Obsidian where writeThrough allows, one at a
// time, waiting for each answer.
async function flush(scope) {
  if (!scope.pending.size) return;
  const batch = [...scope.pending];
  scope.pending.clear();
  const channel = await channelOf(scope);
  for (const [abs, bytes] of batch) {
    if (!channel.usable) { settleEntry(scope, abs, bytes, channel.reason); continue; }
    let reason;
    try { reason = await writeThrough(scope, channel, abs, bytes); } catch (_) { reason = 'internal-error'; }
    settleEntry(scope, abs, bytes, reason);
  }
}

// Flushes, then releases the write turn unless an outermost lock of the scope
// is still held. It never rejects: an error thrown while flushing marks the
// scope's channel, once opened, unusable and every note still waiting to be
// sent with internal-error, which obsidian_index then reports.
async function settle(scope) {
  try { await flush(scope); } catch (_) {
    if (scope.channel) disable(scope.channel, 'internal-error');
    for (const entry of scope.written.values()) {
      if (entry.reason === 'not-sent') entry.reason = 'internal-error';
    }
  } finally {
    if (scope.outermost === 0) releaseTurn(scope);
  }
}

function settleEntry(scope, abs, bytes, reason) {
  const entry = scope.written.get(abs);
  if (!entry || !entry.bytes.equals(bytes)) return;
  entry.written_through = reason === null;
  entry.reason = reason;
}

// ---------------------------------------------------------------------------
// The lock gate the coordinator's withLock consults.
// ---------------------------------------------------------------------------

// Why the write turn cannot deadlock. A scope waits for the turn only while
// it holds no coordinator lock; inside one, a turn held by another process is
// refused with LOCKED, as a held coordinator lock is. Apart from
// card-intake's wait for the coordinator status it runs before it takes the
// turn, the only waits on another rail process are for the turn, by a scope
// holding no lock, and for writeState's state-write lock, which gives up
// after a bounded time; a sent PUT waits on Obsidian. The holder waits on no
// coordinator lock (withLock never waits), never on the turn, and on
// state-write only while another scope is inside writeState, which writes no
// note. No cycle of waits can form. A synchronous wait would also block a holder in the same process,
// so acquireTurnSync throws in that case.
//
// A coordinator verb calls awaitWriteTurn before the outermost lock of each
// lock scope in which it may write a note, so it waits there holding
// nothing, and each such lock scope loads the ledger and reads its notes only
// once the verb holds the turn; the turn is then kept into that lock instead
// of being settled. The completion projection written by
// advance, deploy and recover-deployed is such a scope: it is taken after the
// card-gate lock of the verb's card step is released.
//
// Null outside a scope or without REST config. After the scope's last
// outermost lock is released, afterRelease flushes and releases the turn. A
// scope that took the turn for a note written outside any lock settles before
// it takes an outermost lock.
function lockGate() {
  const scope = scopeStore.getStore();
  if (!scope || !scope.config.ok) return null;
  const depth = depthStore.getStore() || 0;
  return {
    async beforeAcquire() {
      if (depth === 0) {
        if (scope.outermost === 0 && scope.turn && !scope.reserved) await settle(scope);
        scope.reserved = false;
        scope.outermost += 1;
      }
    },
    run(fn) { return depthStore.run(depth + 1, fn); },
    async afterRelease() {
      if (depth !== 0) return;
      scope.outermost -= 1;
      if (scope.outermost === 0) await settle(scope);
    },
  };
}

// Takes the write turn without blocking the process: outside any coordinator
// lock it waits, and the turn is kept into the next outermost lock; inside
// one it is refused with LOCKED when another holder has it. The scope holds
// it until it next settles.
async function awaitWriteTurn() {
  const scope = scopeStore.getStore();
  if (!scope || !scope.config.ok) return;
  await acquireTurn(scope);
  if (!insideCoordinatorLock(scope)) scope.reserved = true;
}

// ---------------------------------------------------------------------------
// The read-only index check.
// ---------------------------------------------------------------------------

function diskHoldsRailBytes(item) {
  const current = readBytes(item.abs);
  return Boolean(current) && current.equals(item.bytes);
}

async function listFolder(channel, folder) {
  if (!channel.usable) return { failure: channel.reason || 'unavailable' };
  const reply = await get(channel, vaultFolderUrlPath(folder));
  if (reply.failure) return { failure: reply.failure };
  if (reply.status === 404) return { names: new Set() };
  if (reply.status !== 200) return { failure: `http-${reply.status}` };
  const parsed = parseJson(reply.body);
  const files = Array.isArray(parsed && parsed.files) ? parsed.files.filter((name) => typeof name === 'string') : [];
  return { names: new Set(files) };
}

async function verifyWrites(scope, writes) {
  const report = { available: false, seen: [], unseen: [], conflicts: [], skipped: [], written_through: [], not_written_through: [] };
  const folders = new Map();
  const items = writes.map((write) => ({ ...locate(scope.vault, write.path, folders), ...write }));
  for (const item of items) {
    if (item.written_through) report.written_through.push(item.rel);
    else if (item.reason) report.not_written_through.push({ path: item.rel, reason: item.reason });
  }
  const pending = [];
  for (const item of items) {
    if (!diskHoldsRailBytes(item)) report.conflicts.push(item.rel);
    else if (item.hidden) report.skipped.push({ path: item.rel, reason: SKIP_NOT_INDEXED });
    else if (item.outside) report.unseen.push({ path: item.rel, remedy: REMEDY_OUTSIDE_VAULT });
    else pending.push(item);
  }
  const channel = scope.vault ? await channelOf(scope) : null;
  if (!channel || !channel.usable) {
    report.reason = channel ? channel.reason || 'unavailable' : 'no-vault-root';
    for (const item of pending) report.unseen.push({ path: item.rel, remedy: remedyUnverified(report.reason) });
    return report;
  }
  report.available = true;
  const listings = new Map();
  for (const item of pending) {
    if (!listings.has(item.folder)) listings.set(item.folder, await listFolder(channel, item.folder));
  }
  for (const item of pending) {
    const listing = listings.get(item.folder);
    if (!diskHoldsRailBytes(item)) report.conflicts.push(item.rel);
    else if (listing.failure) report.unseen.push({ path: item.rel, remedy: remedyListingFailed(listing.failure) });
    else if (listing.names.has(item.name)) report.seen.push(item.rel);
    else {
      report.unseen.push({
        path: item.rel,
        remedy: item.written_through ? REMEDY_NOT_LISTED_AFTER_WRITE_THROUGH : remedyNotListed(item.reason || 'not-sent'),
      });
    }
  }
  return report;
}

function internalErrorReport(writes) {
  const report = {
    available: false, seen: [], unseen: [], conflicts: [], skipped: [], written_through: [], not_written_through: [],
    reason: 'internal-error',
  };
  for (const write of writes) report.unseen.push({ path: write.path, remedy: remedyUnverified('internal-error') });
  return report;
}

// Settles the journal's scope, then reports on every note it recorded since
// the last report. Null when it recorded none.
async function verifyJournal(journal) {
  if (!journal || typeof journal.flush !== 'function') return null;
  await journal.flush();
  const scope = journal.scope;
  const writes = journal.drain();
  if (!writes.length) return null;
  try { return await verifyWrites(scope, writes); } catch (_) { return internalErrorReport(writes); }
}

function attachObsidianIndex(receipt, index) {
  if (!index || !receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return receipt;
  return { ...receipt, obsidian_index: index };
}

// Runs fn(journal) in a scope bound to the vault, then flushes and checks the
// notes it wrote and attaches obsidian_index to its receipt or error.
async function withVaultIndex(vaultRoot, fn, deps) {
  const scope = openScope(vaultRoot, deps);
  let value;
  let failure = null;
  let failed = false;
  try { value = await scopeStore.run(scope, () => fn(scope.journal)); }
  catch (error) { failed = true; failure = error; }
  scope.outermost = 0;
  const index = await verifyJournal(scope.journal);
  if (failed) {
    if (index && failure && typeof failure === 'object') {
      try { failure.obsidian_index = index; } catch (_) {}
    }
    throw failure;
  }
  return attachObsidianIndex(value, index);
}

module.exports = {
  REST_CONFIG_RELATIVE, REST_HOST, DEFAULT_TIMEOUT_MS, PENDING_DIR, FOREIGN_TURN_MS, EMPTY_TURN_MS, SKIP_NOT_INDEXED,
  beforeNoteWrite, beforeNoteRewrite: beforeNoteWrite, noteWritten, lockGate, awaitWriteTurn, withVaultIndex, verifyJournal,
  attachObsidianIndex, vaultRootForBoard,
  readRestConfig,
};
