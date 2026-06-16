class GoodInstanceWidget {
    render(dv) { /* instance method */ }
    helper(x) { return x; }
}

// Callsite: customJS.GoodInstanceWidget.render is an instance method — PASS.
// customJS.GoodInstanceWidget.render(window.dv);
