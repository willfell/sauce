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
//
// Launches are counted where chrome-cdp.js makes them, by wrapping
// child_process.spawn, never by a line the stand-in writes when it starts. A
// stand-in that is killed before its shell gets as far as that line leaves no
// trace: on a busy macOS runner a freshly written script can take longer than
// the 400ms readiness budget below just to start, so a side-effect count read 1
// where chrome-cdp had launched twice and LAUNCH-3 failed with nothing wrong.
// The wrapper also hands each stand-in its attempt number, so a stand-in that
// must behave differently on its second launch does not depend on its first
// one having run at all.

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
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

// Wraps child_process.spawn so each launch of `executable` appends one line to
// `log` and hands the stand-in its attempt number as LAUNCH_ATTEMPT. Returns the
// unwrapped spawn. runCapture's child process runs this same function from its
// source, so both kinds of case count launches the same way.
function countLaunches(executable, log) {
  const cp = require('child_process');
  const fs = require('fs');
  const real = cp.spawn;
  cp.spawn = function spawn(command, args, options) {
    if (command !== executable) return real.apply(this, arguments);
    fs.appendFileSync(log, 'launch\n');
    const attempt = String(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length);
    const env = Object.assign({}, (options && options.env) || process.env, { LAUNCH_ATTEMPT: attempt });
    return real.call(this, command, args, Object.assign({}, options, { env }));
  };
  return real;
}

// Runs captureViewport in its own node process and reports how that process
// ended. `exited: false` means it was still alive at the limit and was killed.
function runCapture(executable, log, readyTimeoutMs, limitMs) {
  const code = `(${countLaunches.toString()})(${JSON.stringify(executable)}, ${JSON.stringify(log)});`
    + `const { captureViewport } = require(${JSON.stringify(CDP)});`
    + `captureViewport(${JSON.stringify(executable)}, 'about:blank', 800, 600, { readyTimeoutMs: ${readyTimeoutMs} })`
    + `.then(() => console.log('captured'), (e) => { console.error(String(e && e.message)); process.exitCode = 1; });`;
  return new Promise((resolve) => {
    const child = childProcess.spawn(process.execPath, ['-e', code], {
      env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
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

// Runs captureViewport in this process with launches of `executable` counted in
// `log`, and console.error captured.
async function captureCounted(executable, log, url, options) {
  const realSpawn = countLaunches(executable, log);
  const errors = [];
  const originalError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  try {
    return { captured: await captureViewport(executable, url, 800, 600, options), errors };
  } catch (failure) {
    return { failure, errors };
  } finally {
    console.error = originalError;
    childProcess.spawn = realSpawn;
  }
}

(async () => {
  // A browser that stays alive and silent, with a child that inherits stderr.
  const silentLog = path.join(temp, 'silent.log');
  const silent = script('silent-chrome.sh', 'sleep 30 &\nexec sleep 30');
  const stalled = await runCapture(silent, silentLog, 400, 20000);
  ok('LAUNCH-1: a browser that never publishes its port ends the process, pipe still held by a helper', stalled.exited);
  ok('LAUNCH-2: that failure exits non-zero and names the missing DevTools endpoint',
    stalled.status === 1 && /Chrome publishes its DevTools endpoint within 400ms/.test(stalled.output));
  ok('LAUNCH-3: the launch was attempted the allowed number of times and no more',
    launches(silentLog) === CHROME_LAUNCH_ATTEMPTS && CHROME_LAUNCH_ATTEMPTS === 2);
  ok('LAUNCH-4: the first failed launch is reported before the relaunch',
    /chrome-cdp: launch attempt 1 of 2 failed, relaunching/.test(stalled.output));

  // A browser that dies at once. Its readiness budget is long because the case is
  // about chrome-cdp noticing the exit, which ends the wait the moment it happens;
  // with the 400ms budget above, a stand-in slow to start was killed as silent
  // before it could exit, and the failure named the clock instead of exit code 7.
  const deadLog = path.join(temp, 'dead.log');
  const dead = script('dead-chrome.sh', 'echo "no display" >&2\nexit 7');
  const died = await runCapture(dead, deadLog, 5000, 20000);
  ok('LAUNCH-5: a browser that exits on startup fails with its exit code and stderr',
    died.exited && died.status === 1 && /exited \(code=7/.test(died.output) && /no display/.test(died.output));
  ok('LAUNCH-6: a dead browser is relaunched once, not retried without limit', launches(deadLog) === 2);

  // First launch silent, second launch is the real browser.
  const real = chromeExecutable();
  assert(real, 'a supported Chrome/Chromium binary is required for the relaunch contract');
  process.env.REAL_CHROME = real;
  const page = path.join(temp, 'page.html');
  fs.writeFileSync(page, '<!doctype html><meta id="fixture-results" data-ready="true"><p>ok</p>');
  const flakyLog = path.join(temp, 'flaky.log');
  const flaky = script('flaky-chrome.sh',
    'if [ "$LAUNCH_ATTEMPT" -le 1 ]; then sleep 30 & exec sleep 30; fi\n'
    + 'exec "$REAL_CHROME" "$@"');
  const rescued = await captureCounted(flaky, flakyLog, pathToFileURL(page).href, { readyTimeoutMs: 1500 });
  ok(`LAUNCH-7: a silent first launch followed by a working one still captures the page${rescued.failure ? ` (${rescued.failure.message})` : ''}`,
    !!rescued.captured && rescued.captured.marker && rescued.captured.marker.ready === 'true'
    && rescued.captured.screenshot.length > 1000);
  ok('LAUNCH-8: the relaunch that rescued the capture is written to stderr',
    launches(flakyLog) === 2 && rescued.errors.some((l) => /launch attempt 1 of 2 failed, relaunching/.test(l)));

  // First launch publishes a DevTools port whose endpoint refuses every request,
  // second launch is the real browser. The stand-in endpoint records what it was
  // asked for, which is how LAUNCH-11 sees the target chrome-cdp tried to create.
  const refused = [];
  const endpoint = http.createServer((request, response) => {
    refused.push(`${request.method} ${request.url}`);
    response.writeHead(500);
    response.end('stand-in DevTools endpoint refuses');
  });
  await new Promise((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  process.env.STAND_IN_DEVTOOLS_PORT = String(endpoint.address().port);
  const refusingLog = path.join(temp, 'refusing.log');
  const refusing = script('refusing-chrome.sh',
    'if [ "$LAUNCH_ATTEMPT" -le 1 ]; then\n'
    + '  for arg in "$@"; do case "$arg" in --user-data-dir=*) profile="${arg#--user-data-dir=}" ;; esac; done\n'
    + '  printf \'%s\\n/devtools/browser/stand-in\\n\' "$STAND_IN_DEVTOOLS_PORT" > "$profile/DevToolsActivePort"\n'
    + '  exec sleep 30\n'
    + 'fi\n'
    + 'exec "$REAL_CHROME" "$@"');
  const reopened = await captureCounted(refusing, refusingLog, pathToFileURL(page).href, {});
  endpoint.close();
  ok(`LAUNCH-9: a browser whose DevTools endpoint refuses the session is relaunched and the page is still captured${reopened.failure ? ` (${reopened.failure.message})` : ''}`,
    !!reopened.captured && reopened.captured.marker && reopened.captured.marker.ready === 'true'
    && launches(refusingLog) === 2);
  ok('LAUNCH-10: the refused session is reported as a failed launch before the relaunch',
    reopened.errors.some((l) => /launch attempt 1 of 2 failed, relaunching: Chrome opens a DevTools session on about:blank/.test(l)));
  ok(`LAUNCH-11: the DevTools target is created at about:blank, not at the page under test (${JSON.stringify(refused)})`,
    refused.length === 1 && refused[0] === `PUT /json/new?${encodeURIComponent('about:blank')}`);

  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
  process.exit(results.every(([, c]) => c) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
