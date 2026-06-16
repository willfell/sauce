class BadHybridWidget {
    render(dv) { /* instance method */ }
    // PROBLEM: BadHybridWidget is instance class but matches is static. customJS
    // stores instance — customJS.BadHybridWidget.matches(...) throws TypeError.
    static matches(rec) { return rec === 'every day'; }
}

// Callsite: customJS.BadHybridWidget.matches called against an instance class
// where matches is static — should FAIL.
// customJS.BadHybridWidget.matches('every day');
