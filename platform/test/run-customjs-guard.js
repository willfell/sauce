#!/usr/bin/env node
'use strict';

// Behavioral regression harness for the inline customjs-guard Dataview view.
// The view has top-level await and receives dv/input/window from Dataview, so
// each case evaluates the unmodified source inside an async function with
// those bindings and a deterministic, zero-wall-clock timer.

const fs = require('fs');
const path = require('path');

const VIEW_PATH = path.join(__dirname, '..', 'mechanisms', 'customjs-guard', 'view.js');
const VIEW_SOURCE = fs.readFileSync(VIEW_PATH, 'utf8');

const results = [];
function ok(name, condition, detail) {
  const passed = !!condition;
  results.push([name, passed]);
  console.log(`  ${passed ? 'PASS' : 'FAIL'} — ${name}${passed || !detail ? '' : ` (${detail})`}`);
}

function makeDv() {
  const paragraphs = [];
  const elements = [];
  return {
    paragraphs,
    elements,
    paragraph(text) { paragraphs.push(String(text)); },
    container: {
      createEl(tag, options) {
        const element = {
          tag,
          options: { ...(options || {}) },
          removed: false,
          remove() { this.removed = true; },
        };
        elements.push(element);
        return element;
      },
    },
  };
}

async function runGuard(source, options) {
  const opts = options || {};
  const dv = makeDv();
  const windowMock = opts.window || {};
  let delayCount = 0;
  const fakeSetTimeout = (resolve, ms) => {
    delayCount++;
    if (opts.onDelay) opts.onDelay({ delayCount, ms, window: windowMock, dv });
    resolve();
  };
  const execute = new Function(
    'dv',
    'input',
    'window',
    'setTimeout',
    `return (async () => {\n${source}\n})();`,
  );
  await execute(dv, opts.input, windowMock, fakeSetTimeout);
  return { dv, window: windowMock, delayCount };
}

function isActionableMissingClass(text, className) {
  const value = String(text || '');
  return value.includes(className)
    && !value.includes(`_${className} unavailable_`)
    && /(reopen Obsidian|reload CustomJS|verify .*script.*synced)/i.test(value);
}

async function main() {
  ok('CJS-GUARD-1 remains a bare inline view script',
    !/\bmodule\.exports\s*=/.test(VIEW_SOURCE));

  const immediateCalls = [];
  const immediateClass = {
    async render(dv, ...args) {
      immediateCalls.push({
        thisValue: this,
        dv,
        args,
        loaderRemovedAtCall: dv.elements[0] && dv.elements[0].removed,
      });
    },
  };
  const immediate = await runGuard(VIEW_SOURCE, {
    input: { class: 'ReadyClass', args: ['alpha', 2] },
    window: { customJS: { ReadyClass: immediateClass } },
  });
  ok('CJS-GUARD-2 immediate class dispatches with dv, args, and instance receiver',
    immediateCalls.length === 1
      && immediateCalls[0].thisValue === immediateClass
      && immediateCalls[0].dv === immediate.dv
      && JSON.stringify(immediateCalls[0].args) === '["alpha",2]');
  ok('CJS-GUARD-3 fast path adds no polling delay', immediate.delayCount === 0,
    `observed ${immediate.delayCount} delays`);
  ok('CJS-GUARD-4 loader is created and removed before completed dispatch',
    immediate.dv.elements.length === 1
      && immediate.dv.elements[0].options.cls === 'customjs-loader'
      && immediate.dv.elements[0].removed
      && immediateCalls[0].loaderRemovedAtCall);

  let lateCalls = 0;
  let loaderVisibleDuringWait = false;
  const lateClass = { render() { lateCalls++; } };
  const late = await runGuard(VIEW_SOURCE, {
    input: { class: 'LateClass' },
    window: {},
    onDelay({ delayCount, window, dv }) {
      if (delayCount === 1) {
        loaderVisibleDuringWait = dv.elements.length === 1 && !dv.elements[0].removed;
      }
      if (delayCount === 5) window.customJS = {};
      if (delayCount === 46) window.customJS.LateClass = lateClass;
    },
  });
  ok('CJS-GUARD-5 namespace then class registering after the old ~2s window still dispatches',
    late.delayCount === 46
      && lateCalls === 1
      && late.dv.paragraphs.length === 0
      && loaderVisibleDuringWait
      && late.dv.elements[0].removed,
    `delays=${late.delayCount}, calls=${lateCalls}, messages=${JSON.stringify(late.dv.paragraphs)}`);

  const missing = await runGuard(VIEW_SOURCE, {
    input: { class: 'MissingClass' },
    window: { customJS: {} },
  });
  ok('CJS-GUARD-6 missing class gets an actionable, non-bare diagnostic',
    missing.dv.paragraphs.length === 1
      && isActionableMissingClass(missing.dv.paragraphs[0], 'MissingClass'),
    JSON.stringify(missing.dv.paragraphs));
  ok('CJS-GUARD-7 missing class uses a materially longer wait than 40 polls',
    missing.delayCount > 40, `observed ${missing.delayCount} delays`);

  const absent = await runGuard(VIEW_SOURCE, {
    input: { class: 'AnyClass' },
    window: {},
  });
  ok('CJS-GUARD-8 absent window.customJS never throws and gets a distinct retry diagnostic',
    absent.dv.paragraphs.length === 1
      && /CustomJS.*still loading/i.test(absent.dv.paragraphs[0])
      && /reopen this note/i.test(absent.dv.paragraphs[0])
      && !absent.dv.paragraphs[0].includes('AnyClass is not loaded'),
    JSON.stringify(absent.dv.paragraphs));

  const missingArg = await runGuard(VIEW_SOURCE, { input: {}, window: {} });
  ok('CJS-GUARD-9 missing class arg preserves its diagnostic and skips the loader',
    JSON.stringify(missingArg.dv.paragraphs) === '["_customjs-guard: missing `class`_"]'
      && missingArg.dv.elements.length === 0
      && missingArg.delayCount === 0);

  const badArgs = await runGuard(VIEW_SOURCE, {
    input: { class: 'ReadyClass', args: 'not-an-array' },
    window: { customJS: { ReadyClass: immediateClass } },
  });
  ok('CJS-GUARD-10 non-array args preserves its diagnostic and skips dispatch',
    JSON.stringify(badArgs.dv.paragraphs) === '["_customjs-guard: `args` must be an array_"]'
      && immediateCalls.length === 1
      && badArgs.delayCount === 0);

  const shortPollMutant = VIEW_SOURCE.replace(
    'const MAX_POLL_ATTEMPTS = 200;',
    'const MAX_POLL_ATTEMPTS = 40;',
  );
  ok('CJS-GUARD-MUT-1 short-poll mutation was applied', shortPollMutant !== VIEW_SOURCE);
  let mutantLateCalls = 0;
  const mutantLate = await runGuard(shortPollMutant, {
    input: { class: 'LateClass' },
    window: {},
    onDelay({ delayCount, window }) {
      if (delayCount === 5) window.customJS = {};
      if (delayCount === 46) window.customJS.LateClass = { render() { mutantLateCalls++; } };
    },
  });
  ok('CJS-GUARD-MUT-2 late-registration case kills the 40-poll mutant',
    mutantLateCalls === 0 && mutantLate.dv.paragraphs.length === 1);

  const bareDiagnosticMutant = VIEW_SOURCE.replace(
    'dv.paragraph(`_${className} is not loaded. Mobile: fully reopen Obsidian, then verify its script synced._`);',
    'dv.paragraph(`_${className} unavailable_`);',
  );
  ok('CJS-GUARD-MUT-3 bare-diagnostic mutation was applied', bareDiagnosticMutant !== VIEW_SOURCE);
  const mutantMissing = await runGuard(bareDiagnosticMutant, {
    input: { class: 'MissingClass' },
    window: { customJS: {} },
  });
  ok('CJS-GUARD-MUT-4 actionable-diagnostic case kills the bare placeholder mutant',
    mutantMissing.dv.paragraphs[0] === '_MissingClass unavailable_'
      && !isActionableMissingClass(mutantMissing.dv.paragraphs[0], 'MissingClass'));

  const failed = results.filter(([, passed]) => !passed);
  console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — customjs-guard (${results.length - failed.length}/${results.length})`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
