class StaticOnlyUtil {
    static fmtMoney(cents) { return '$' + (cents / 100).toFixed(2); }
    static parse(s) { return Number(s); }
}

// Callsite: customJS.StaticOnlyUtil.fmtMoney is static; class is static-only — PASS.
// customJS.StaticOnlyUtil.fmtMoney(100);
