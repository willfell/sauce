#!/usr/bin/env node
/**
 * run-recurrence-parser — Node preflight harness for the RecurrenceParser
 * pure helper (platform/blueprints/to-do/helpers/recurrence-parser.js).
 *
 * Covers RP-1..RP-32 across the 4 supported grammar families (daily / weekday
 * set / day-of-month / every-N-weeks-on-day) plus invalid-grammar rejections
 * + isSupported() semantics.
 *
 * Uses a tiny hand-rolled moment-like stub so the harness stays zero-dep.
 * The stub exposes .day() / .date() / .diff(other, 'days'), which is the only
 * surface RecurrenceParser uses.
 */

const fs = require('fs');
const path = require('path');

const HELPER = path.resolve(__dirname, '..', 'blueprints', 'to-do', 'helpers', 'recurrence-parser.js');

function loadClass() {
    const src = fs.readFileSync(HELPER, 'utf8');
    const stubs = `
        const window = { moment: undefined };
        const document = {};
        const app = {};
        const Notice = function () {};
    `;
    // eslint-disable-next-line no-new-func
    const make = new Function(`${stubs}\n${src}\nreturn RecurrenceParser;`);
    return make();
}

const RecurrenceParser = loadClass();

// ---- moment-lite stub ----
// new MomentLite('2026-06-15') → moment-ish object with .day(), .date(), .diff().
function MomentLite(isoDate) {
    // Parse ISO YYYY-MM-DD as UTC noon to avoid TZ slop.
    const [y, m, d] = isoDate.split('-').map(Number);
    this._utcMs = Date.UTC(y, m - 1, d, 12, 0, 0);
    const dt = new Date(this._utcMs);
    this._dow = dt.getUTCDay(); // 0=Sun .. 6=Sat
    this._dom = dt.getUTCDate();
}
MomentLite.prototype.day = function () { return this._dow; };
MomentLite.prototype.date = function () { return this._dom; };
MomentLite.prototype.diff = function (other, unit) {
    if (unit !== 'days') throw new Error('MomentLite.diff only supports days');
    return Math.floor((this._utcMs - other._utcMs) / (24 * 60 * 60 * 1000));
};

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
    if (cond) {
        console.log(`  ok  ${label}`);
        pass++;
    } else {
        console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
        failures.push(label);
        fail++;
    }
}

console.log('run-recurrence-parser:');

// Reference dates (each day-of-week Mon-Sun for June 2026):
// 2026-06-15 = Monday (day=1)
// 2026-06-16 = Tuesday (day=2)
// 2026-06-17 = Wednesday (day=3)
// 2026-06-18 = Thursday (day=4)
// 2026-06-19 = Friday (day=5)
// 2026-06-20 = Saturday (day=6)
// 2026-06-21 = Sunday (day=0)
const mon = new MomentLite('2026-06-15');
const tue = new MomentLite('2026-06-16');
const wed = new MomentLite('2026-06-17');
const thu = new MomentLite('2026-06-18');
const fri = new MomentLite('2026-06-19');
const sat = new MomentLite('2026-06-20');
const sun = new MomentLite('2026-06-21');

// ===== "every day" family — RP-1..RP-6 =====
ok('RP-1 every day matches Mon', RecurrenceParser.matches('every day', mon));
ok('RP-2 every day matches Wed', RecurrenceParser.matches('every day', wed));
ok('RP-3 every day matches Sat', RecurrenceParser.matches('every day', sat));
ok('RP-4 every day matches Sun', RecurrenceParser.matches('every day', sun));
ok('RP-5 Every Day case-insensitive', RecurrenceParser.matches('Every Day', tue));
ok('RP-6 every day isSupported', RecurrenceParser.isSupported('every day'));

// ===== single-weekday grammar — RP-7..RP-14 =====
ok('RP-7 every Wednesday matches Wed', RecurrenceParser.matches('every Wednesday', wed));
ok('RP-8 every Wednesday NOT match Thu', !RecurrenceParser.matches('every Wednesday', thu));
ok('RP-9 every Wed (short) matches Wed', RecurrenceParser.matches('every Wed', wed));
ok('RP-10 every Mon matches Mon', RecurrenceParser.matches('every Mon', mon));
ok('RP-11 every Sunday matches Sun', RecurrenceParser.matches('every Sunday', sun));
ok('RP-12 every Sunday NOT match Mon', !RecurrenceParser.matches('every Sunday', mon));
ok('RP-13 every Tuesday matches Tue', RecurrenceParser.matches('every Tuesday', tue));
ok('RP-14 every Tues (short3) matches Tue', RecurrenceParser.matches('every Tues', tue));

// ===== multi-weekday set — RP-15..RP-18 =====
ok('RP-15 every Mon Wed Fri matches Mon', RecurrenceParser.matches('every Mon Wed Fri', mon));
ok('RP-16 every Mon Wed Fri matches Fri', RecurrenceParser.matches('every Mon Wed Fri', fri));
ok('RP-17 every Mon Wed Fri NOT match Tue', !RecurrenceParser.matches('every Mon Wed Fri', tue));
ok('RP-18 every Mon, Wed, Fri (commas) matches Wed',
    RecurrenceParser.matches('every Mon, Wed, Fri', wed));

// ===== every weekday — RP-19..RP-21 =====
ok('RP-19 every weekday matches Mon', RecurrenceParser.matches('every weekday', mon));
ok('RP-20 every weekday matches Fri', RecurrenceParser.matches('every weekday', fri));
ok('RP-21 every weekday NOT match Sat', !RecurrenceParser.matches('every weekday', sat));

// ===== every weekend — RP-22..RP-23 =====
ok('RP-22 every weekend matches Sat', RecurrenceParser.matches('every weekend', sat));
ok('RP-23 every weekend NOT match Fri', !RecurrenceParser.matches('every weekend', fri));

// ===== day-of-month — RP-24..RP-26 =====
const jun1 = new MomentLite('2026-06-01');
const jun15 = new MomentLite('2026-06-15');
const jun30 = new MomentLite('2026-06-30');
ok('RP-24 every 1st of month matches Jun-1', RecurrenceParser.matches('every 1st of month', jun1));
ok('RP-25 every 15th of month matches Jun-15', RecurrenceParser.matches('every 15th of month', jun15));
ok('RP-26 every 1st of month NOT match Jun-30', !RecurrenceParser.matches('every 1st of month', jun30));

// ===== every N weeks on day — RP-27..RP-28 =====
// Anchor at 2026-06-01 (Monday). every 2 weeks on Monday → fires Jun-1, Jun-15, Jun-29.
const anchor = new MomentLite('2026-06-01');
ok('RP-27 every 2 weeks on Monday matches Jun-15 (anchor=Jun-1)',
    RecurrenceParser.matches('every 2 weeks on Monday', jun15, { registryCreatedAt: anchor }));
ok('RP-28 every 2 weeks on Monday NOT match Jun-22 (week 3, not 2 or 4)',
    !RecurrenceParser.matches('every 2 weeks on Monday', new MomentLite('2026-06-22'), { registryCreatedAt: anchor }));

// ===== invalid grammars — RP-29..RP-32 =====
ok('RP-29 every other day → false (unsupported)',
    !RecurrenceParser.matches('every other day', mon));
ok('RP-30 cron grammar → false',
    !RecurrenceParser.matches('0 0 * * *', mon));
ok('RP-31 empty string → false',
    !RecurrenceParser.matches('', mon));
ok('RP-32 gibberish → false + isSupported false',
    !RecurrenceParser.matches('asldkjf', mon) && !RecurrenceParser.isSupported('asldkjf'));

// ===== INSTANCE path — RP-33..RP-36 =====
// customJS stores INSTANCES under window.customJS.RecurrenceParser, then the
// guard dispatches customJS.RecurrenceParser.isSupported(...) / .matches(...) on
// that stored instance. The consumed methods MUST exist as instance methods
// (delegating to the statics) or live Obsidian throws "is not a function".
(() => {
    const rp = new RecurrenceParser();
    ok('RP-33 instance isSupported("every day") === true',
        rp.isSupported('every day') === true);
    ok('RP-34 instance isSupported("garbage") === false',
        rp.isSupported('garbage') === false);
    ok('RP-35 instance matches() agrees with static (every day, Wed)',
        rp.matches('every day', wed) === RecurrenceParser.matches('every day', wed));
    ok('RP-36 instance matches() agrees with static (every Wednesday, Thu → false)',
        rp.matches('every Wednesday', thu) === RecurrenceParser.matches('every Wednesday', thu)
        && rp.matches('every Wednesday', thu) === false);
})();

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) {
    console.log('Failures:');
    for (const f of failures) console.log(`  ${f}`);
    process.exit(1);
}
process.exit(0);
