class TypoWidget {
    render(dv) { return 1; }
    // Method spelled "match" but called as "matches" below.
    match(rec) { return rec === 'X'; }
}

// Callsite: customJS.TypoWidget.matches doesn't exist (only `match`) — FAIL.
// customJS.TypoWidget.matches('Y');
