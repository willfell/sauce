'use strict';

// run-chrome-cdp-launch.js — a headless Chrome that will not start must cost a
// harness seconds, not the preflight runner's 15-minute step kill, and one bad
// launch must not fail the harness when the next launch works.
//
// The release PR for v0.307.2 sat failed for half an hour on exactly this: on
// the macOS runner Chrome stayed silent for the whole readiness budget, the
// harness printed its assertion, and then the process did not exit for another
// 14 minutes. Chrome's helper processes inherit its stderr pipe, so killing the
// browser left the pipe open and the event loop alive.
//
// Stand-in browsers are shell scripts, so the launch path is exercised without
// depending on a real browser misbehaving. Zero-dep. Exit 0 iff all pass.

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { captureViewport, chromeExecutable, CHROME_LAUNCH_ATTEMPTS } = require('./chrome-cdp.js');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sauce-cdp-launch-'));
const CDP = path.join(__dirname, 'chrome-cdp.js');

function script(name, body) {
  const file = path.join(temp, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

// Runs captureViewport in its own node process and reports how that process
// ended. `exited: false` means it was still alive at the limit and was killed.
function runCapture(executable, env, limitMs) {
  const code = `const { captureViewport } = require(${JSON.stringify(CDP)});`
    + `captureViewport(${JSON.stringify(executable)}, 'about:blank', 800, 600, { readyTimeoutMs: 400 })`
    + `.then(() => console.log('captured'), (e) => { console.error(String(e && e.message)); process.exitCode = 1; });`;
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, ['-e', code], {
      env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });
    let exited = true;
    const timer = setTimeout(() => { exited = false; child.kill('SIGKILL'); }, limitMs);
    child.on('exit', (status) => { clearTimeout(timer); resolve({ exited, status, output }); });
  });
}

const launches = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0);

(async () => {
  // A browser that stays alive and silent, with a child that inherits stderr.
  const silentLog = path.join(temp, 'silent.log');
  const silent = script('silent-chrome.sh', 'echo launch >> "$LAUNCH_LOG"\nsleep 30 &\nexec sleep 30');
  const stalled = await runCapture(silent, { LAUNCH_LOG: silentLog }, 20000);
  ok('LAUNCH-1: a browser that never publishes its port ends the process, pipe still held by a helper', stalled.exited);
  ok('LAUNCH-2: that failure exits non-zero and names the missing DevTools endpoint',
    stalled.status === 1 && /Chrome publishes its DevTools endpoint within 400ms/.test(stalled.output));
  ok('LAUNCH-3: the launch was attempted the allowed number of times and no more',
    launches(silentLog) === CHROME_LAUNCH_ATTEMPTS && CHROME_LAUNCH_ATTEMPTS === 2);
  ok('LAUNCH-4: the first failed launch is reported before the relaunch',
    /chrome-cdp: launch attempt 1 of 2 failed, relaunching/.test(stalled.output));

  // A browser that dies at once.
  const deadLog = path.join(temp, 'dead.log');
  const dead = script('dead-chrome.sh', 'echo launch >> "$LAUNCH_LOG"\necho "no display" >&2\nexit 7');
  const died = await runCapture(dead, { LAUNCH_LOG: deadLog }, 20000);
  ok('LAUNCH-5: a browser that exits on startup fails with its exit code and stderr',
    died.exited && died.status === 1 && /exited \(code=7/.test(died.output) && /no display/.test(died.output));
  ok('LAUNCH-6: a dead browser is relaunched once, not retried without limit', launches(deadLog) === 2);

  // First launch silent, second launch is the real browser.
  const real = chromeExecutable();
  assert(real, 'a supported Chrome/Chromium binary is required for the relaunch contract');
  const flakyLog = path.join(temp, 'flaky.log');
  const flaky = script('flaky-chrome.sh',
    'echo launch >> "$LAUNCH_LOG"\n'
    + 'if [ "$(wc -l < "$LAUNCH_LOG")" -le 1 ]; then sleep 30 & exec sleep 30; fi\n'
    + 'exec "$REAL_CHROME" "$@"');
  const page = path.join(temp, 'page.html');
  fs.writeFileSync(page, '<!doctype html><meta id="fixture-results" data-ready="true"><p>ok</p>');
  process.env.LAUNCH_LOG = flakyLog;
  process.env.REAL_CHROME = real;
  const errors = [];
  const originalError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  let captured = null;
  let failure = null;
  try {
    captured = await captureViewport(flaky, pathToFileURL(page).href, 800, 600, { readyTimeoutMs: 1500 });
  } catch (e) { failure = e; } finally { console.error = originalError; }
  ok(`LAUNCH-7: a silent first launch followed by a working one still captures the page${failure ? ` (${failure.message})` : ''}`,
    !!captured && captured.marker && captured.marker.ready === 'true' && captured.screenshot.length > 1000);
  ok('LAUNCH-8: the relaunch that rescued the capture is written to stderr',
    launches(flakyLog) === 2 && errors.some((l) => /launch attempt 1 of 2 failed, relaunching/.test(l)));

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
  process.exit(results.every(([, c]) => c) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
