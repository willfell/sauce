'use strict';
// Shared headless-Chrome capture over the DevTools protocol, for visual harnesses
// that need an isolated browser profile.
//
// Why this exists rather than Chrome's one-shot --screenshot / --dump-dom modes:
// those modes hang outright when given an explicit --user-data-dir (measured on
// Chrome 151: 3/3 hangs with a private profile, 3/3 successes without, and no
// combination of --no-first-run, --headless=old, --remote-debugging-port or a
// pre-initialised profile rescues them). Without --user-data-dir they fall back to
// the developer's REAL Chrome profile, whose process singleton is held by any
// desktop Chrome they have open — so the headless instance can take that singleton
// over, adopt the live browsing session, and never exit. That is a preflight step
// wedged for its full 15-minute timeout, and it is why a visual harness could fail
// in the suite and pass immediately when re-run alone.
//
// The DevTools protocol has no such conflict: it accepts a private profile and
// starts in well under a second even at twenty concurrent launches. The transport
// below is deliberately built on Node built-ins (net + crypto), not the global
// WebSocket API, so the harnesses keep running on Node versions before 21.

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

// How long Chrome gets to become usable. Generous on purpose: exceeding it should
// mean Chrome is genuinely broken, never that the machine was busy. A poll count
// would not be a time budget at all once each iteration carries a CDP round-trip.
const CHROME_READY_TIMEOUT_MS = 60000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createCdpTarget(port, url) {
  if (!/^\d+$/.test(String(port)) || Number(port) <= 0) {
    return Promise.reject(new Error(`createCdpTarget requires a positive integer port, got: ${JSON.stringify(port)}`));
  }
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port, method: 'PUT',
      path: `/json/new?${encodeURIComponent(url)}`,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Chrome creates a DevTools target (${response.statusCode}): ${body}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function clientFrame(text, opcode = 1) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

function connectCdpSocket(endpoint) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(endpoint);
    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto.createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const stream = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) });
    let buffer = Buffer.alloc(0);
    let handshaken = false;
    let fragmented = [];
    const messageListeners = new Set();
    const client = {
      send(text) { stream.write(clientFrame(text)); },
      onMessage(listener) { messageListeners.add(listener); },
      close() { if (!stream.destroyed) { stream.write(clientFrame('', 8)); stream.end(); } },
    };
    const consumeFrames = () => {
      while (buffer.length >= 2) {
        const first = buffer[0]; const second = buffer[1];
        const fin = !!(first & 0x80); const opcode = first & 0x0f; const masked = !!(second & 0x80);
        let length = second & 0x7f; let offset = 2;
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
        const maskOffset = masked ? 4 : 0;
        if (buffer.length < offset + maskOffset + length) return;
        const mask = masked ? buffer.subarray(offset, offset + 4) : null;
        const payload = Buffer.from(buffer.subarray(offset + maskOffset, offset + maskOffset + length));
        buffer = buffer.subarray(offset + maskOffset + length);
        if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
        if (opcode === 8) { stream.end(); continue; }
        if (opcode === 9) { stream.write(clientFrame(payload, 10)); continue; }
        if (opcode === 1 || opcode === 0) fragmented.push(payload);
        if (fin && (opcode === 1 || opcode === 0)) {
          const message = Buffer.concat(fragmented).toString('utf8'); fragmented = [];
          for (const listener of messageListeners) listener(message);
        }
      }
    };
    stream.on('connect', () => {
      stream.write([
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`, 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', '',
      ].join('\r\n'));
    });
    stream.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshaken) {
        const boundary = buffer.indexOf('\r\n\r\n');
        if (boundary < 0) return;
        const header = buffer.subarray(0, boundary).toString('utf8');
        buffer = buffer.subarray(boundary + 4);
        if (!/^HTTP\/1\.1 101\b/m.test(header)
          || !header.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
          reject(new Error(`Chrome DevTools WebSocket handshake failed: ${header}`));
          stream.destroy();
          return;
        }
        handshaken = true; resolve(client);
      }
      consumeFrames();
    });
    stream.on('error', reject);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await Promise.race([exited, wait(5000)]);
}

async function removeTreeWithRetry(target) {
  // Wall clock, not a poll count: this waits on Chrome releasing the profile
  // directory, and how long that takes is a function of how busy the machine is.
  let lastError;
  const deadline = Date.now() + CHROME_READY_TIMEOUT_MS;
  for (;;) {
    try { fs.rmSync(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error && error.code)) throw error;
      lastError = error;
      if (Date.now() >= deadline) break;
      await wait(100);
    }
  }
  throw lastError;
}

// Render `url` at an exact viewport in an isolated browser and return the fixture
// marker plus one screenshot. Determinism is asserted by calling this twice and
// comparing the two screenshots: two screenshots of a single loaded page would only
// prove the capture is idempotent, which it trivially is. The point of the check is
// that two INDEPENDENT renders agree, so each render needs its own browser.
//
// `marker` keys keep the hyphenated data-attribute names (document-fits, not
// documentFits), so callers read it exactly as they read a parsed <meta> tag.
async function captureViewport(executable, url, width, height, options = {}) {
  const markerSelector = options.markerSelector || '#fixture-results';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-cdp-'));
  const chrome = childProcess.spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--allow-file-access-from-files', '--force-prefers-reduced-motion',
    '--disable-background-networking', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Keep Chrome's stderr and its exit. Discarding them is why a browser that dies
  // on startup and one that is merely slow produced the same bare assertion.
  let chromeStderr = '';
  chrome.stderr.on('data', (chunk) => { chromeStderr += chunk; });
  let chromeExit = null;
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  const tail = () => chromeStderr.trim().split(/\r?\n/).filter(Boolean).slice(-5).join(' | ') || '(no stderr)';

  let socket;
  let sendCommand;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    // Chrome creates the file and writes it non-atomically, so poll for valid
    // content rather than mere existence: an empty read resolves to port 80 and
    // would talk to whatever else is listening there.
    let port = '';
    const portDeadline = Date.now() + CHROME_READY_TIMEOUT_MS;
    while (Date.now() < portDeadline) {
      if (fs.existsSync(portFile)) {
        const first = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
        if (/^\d+$/.test(first) && Number(first) > 0) { port = first; break; }
      }
      // A dead browser will never publish the port. Say so instead of blaming the clock.
      if (chromeExit) break;
      await wait(50);
    }
    assert(/^\d+$/.test(port) && Number(port) > 0, chromeExit
      ? `headless Chrome exited (code=${chromeExit.code}, signal=${chromeExit.signal}) `
        + `before publishing its DevTools endpoint: ${tail()}`
      : `Chrome publishes its DevTools endpoint within ${CHROME_READY_TIMEOUT_MS}ms: ${tail()}`);

    const target = await createCdpTarget(port, url);
    socket = await connectCdpSocket(target.webSocketDebuggerUrl);
    let nextId = 0;
    const pending = new Map();
    socket.onMessage((data) => {
      const message = JSON.parse(data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    sendCommand = send;

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.navigate', { url });

    let marker = null;
    const markerDeadline = Date.now() + CHROME_READY_TIMEOUT_MS;
    while (!marker && Date.now() < markerDeadline) {
      const evaluation = await send('Runtime.evaluate', {
        expression: `(()=>{const m=document.querySelector(${JSON.stringify(markerSelector)});`
          + 'if(!m)return null;const o={};'
          + 'for(const a of m.attributes){if(a.name.indexOf("data-")===0)o[a.name.slice(5)]=a.value;}'
          + 'return o;})()',
        returnByValue: true,
      });
      marker = (evaluation.result && evaluation.result.value) || null;
      if (!marker) await wait(50);
    }
    assert(marker, `fixture emits its computed result marker within ${CHROME_READY_TIMEOUT_MS}ms: ${tail()}`);

    const screenshot = Buffer.from((await send('Page.captureScreenshot', {
      format: 'png', fromSurface: true, captureBeyondViewport: false,
    })).data, 'base64');
    return { marker, screenshot };
  } finally {
    if (sendCommand) {
      const gracefulClose = sendCommand('Browser.close').catch(() => {});
      await Promise.race([gracefulClose, wait(1000)]);
    }
    if (socket) socket.close();
    await stopChild(chrome);
    await removeTreeWithRetry(profile);
  }
}

module.exports = { captureViewport, chromeExecutable, CHROME_READY_TIMEOUT_MS };
