/**
 * RecurrenceParser (CustomJS) — pure-helper recurrence grammar evaluator.
 *
 * Two static API methods:
 *   RecurrenceParser.matches(grammar, dateMoment, opts) -> boolean
 *   RecurrenceParser.isSupported(grammar) -> boolean
 *
 * Supported v0.4.0 grammar (subset of obsidian-tasks-plugin's recurrence):
 *   "every day"
 *   "every Monday" / "every Mon"   (any single weekday; full name or 3-letter short)
 *   "every Mon Wed Fri"            (multiple weekdays, comma- or space-separated)
 *   "every weekday"                (Mon-Fri inclusive)
 *   "every weekend"                (Sat + Sun)
 *   "every 1st of month" / "every 15th of month"   (any 1..31 ordinal)
 *   "every 2 weeks on Monday"      (N >= 1; anchored to opts.registryCreatedAt)
 *
 * Anything else (cron, "every other day", holiday rules) → matches() returns
 * false, isSupported() returns false.
 *
 * The dialog's recurring tab uses isSupported() to validate before submit;
 * ToDoDailyRecurring uses matches() at materialization time.
 */
class RecurrenceParser {

    /**
     * Returns true iff the recurrence grammar fires on dateMoment.
     *
     * @param {string} grammar - the recurrence text (e.g. "every Wednesday").
     * @param {moment.Moment} dateMoment - the day under test.
     * @param {object} [opts] - optional reference data.
     * @param {moment.Moment} [opts.registryCreatedAt] - anchor for "every N weeks on X".
     *        When absent and the grammar requires it, matches() returns false.
     * @returns {boolean}
     */
    static matches(grammar, dateMoment, opts) {
        const parsed = RecurrenceParser._parse(grammar);
        if (!parsed) return false;
        if (!dateMoment || typeof dateMoment.day !== 'function') return false;

        const dow = dateMoment.day();   // 0=Sun .. 6=Sat
        const dom = dateMoment.date();  // 1..31

        switch (parsed.kind) {
            case 'daily':
                return true;
            case 'weekday-set':
                return parsed.days.has(dow);
            case 'weekday-block': // every weekday
                return dow >= 1 && dow <= 5;
            case 'weekend-block': // every weekend
                return dow === 0 || dow === 6;
            case 'day-of-month':
                return dom === parsed.day;
            case 'every-n-weeks-on-day': {
                const anchor = opts && opts.registryCreatedAt;
                if (!anchor || typeof anchor.diff !== 'function') return false;
                if (!parsed.days.has(dow)) return false;
                const diffDays = dateMoment.diff(anchor, 'days');
                if (diffDays < 0) return false;
                const N = parsed.weeks;
                return Math.floor(diffDays / 7) % N === 0;
            }
            default:
                return false;
        }
    }

    /**
     * Returns true iff the grammar is in the v0.4.0 supported subset (regardless
     * of whether it would fire on any given date).
     */
    static isSupported(grammar) {
        return RecurrenceParser._parse(grammar) !== null;
    }

    // ---------- Internal: pure parse to a structured form ----------

    static _parse(grammarRaw) {
        if (typeof grammarRaw !== 'string') return null;
        const g = grammarRaw.trim().toLowerCase();
        if (!g.startsWith('every ')) return null;
        const tail = g.slice('every '.length).trim();
        if (!tail) return null;

        // every day
        if (tail === 'day') return { kind: 'daily' };
        // every weekday
        if (tail === 'weekday' || tail === 'weekdays') return { kind: 'weekday-block' };
        // every weekend
        if (tail === 'weekend' || tail === 'weekends') return { kind: 'weekend-block' };

        // every <Nth> of month
        const dom = RecurrenceParser._matchDayOfMonth(tail);
        if (dom !== null) return { kind: 'day-of-month', day: dom };

        // every N weeks on <day>
        const weekly = RecurrenceParser._matchEveryNWeeksOn(tail);
        if (weekly !== null) return weekly;

        // every <day>[,<day>]+ (weekday set)
        const set = RecurrenceParser._matchWeekdaySet(tail);
        if (set !== null) return { kind: 'weekday-set', days: set };

        return null;
    }

    static _matchDayOfMonth(tail) {
        const m = tail.match(/^(\d{1,2})(?:st|nd|rd|th)? of (the )?month$/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        if (n < 1 || n > 31) return null;
        return n;
    }

    static _matchEveryNWeeksOn(tail) {
        // "2 weeks on monday" or "3 weeks on mon wed fri"
        const m = tail.match(/^(\d+)\s+weeks?\s+on\s+(.+)$/);
        if (!m) return null;
        const weeks = parseInt(m[1], 10);
        if (weeks < 1) return null;
        const dayPart = m[2].trim();
        const set = RecurrenceParser._matchWeekdaySet(dayPart);
        if (!set || set.size === 0) return null;
        return { kind: 'every-n-weeks-on-day', weeks, days: set };
    }

    static _matchWeekdaySet(tail) {
        // Accept space- or comma-separated weekday names.
        const tokens = tail.split(/[\s,]+/).filter(Boolean);
        if (tokens.length === 0) return null;
        const days = new Set();
        for (const tok of tokens) {
            const dow = RecurrenceParser._dayNameToDow(tok);
            if (dow === null) return null;
            days.add(dow);
        }
        return days;
    }

    static _dayNameToDow(token) {
        const t = token.toLowerCase();
        const map = {
            sunday: 0, sun: 0,
            monday: 1, mon: 1,
            tuesday: 2, tue: 2, tues: 2,
            wednesday: 3, wed: 3,
            thursday: 4, thu: 4, thur: 4, thurs: 4,
            friday: 5, fri: 5,
            saturday: 6, sat: 6,
        };
        return Object.prototype.hasOwnProperty.call(map, t) ? map[t] : null;
    }
}
