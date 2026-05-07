/**
 * BeaconButton (CustomJS)
 * Shared outline-accent action button renderer. Single-method API; promotes
 * the duplicated outline-accent button pattern from project-nav-buttons.js
 * (and the finance helpers) into one canonical surface so visual cohesion
 * stays free for future callers.
 *
 * Visual surface at v0.18.0 is IDENTICAL to the project-nav-buttons.js:357
 * canonical source — pure dedupe, no design drift.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "BeaconButton", args: {...} });
 * OR (recommended — call .render directly from a wrapper class):
 *   customJS.BeaconButton.render(parent, { label, icon, onClick, ... });
 *
 * Options:
 *   label    — string (required; button text rendered inside <span>)
 *   icon     — string (required; inline SVG HTML rendered before the label)
 *   onClick  — function (required; wired as btn.onclick)
 *   flex     — boolean (optional; default false; appends "flex: 1; min-width: 0"
 *              for buttons that should stretch within a flex row)
 *   disabled — boolean (optional; default false; sets btn.disabled initial state;
 *              hover handlers no-op while disabled)
 *   tone     — "accent" (optional; default "accent"; ONLY valid value at v0.18.0;
 *              reserved slot for future additive tones — silently falls back to
 *              accent on unknown values; never throws)
 *
 * Returns: HTMLButtonElement (the rendered button) so callers can attach
 *   additional state or stash a reference for later toggling.
 */
class BeaconButton {
    /**
     * Render an outline-accent action button into `parent`.
     *
     * @param {HTMLElement} parent - container with createEl() (Obsidian DOM)
     * @param {object} opts
     * @returns {HTMLButtonElement}
     */
    render(parent, opts) {
        const btn = parent.createEl("button");
        btn.innerHTML = opts.icon + `<span>${opts.label}</span>`;
        const baseCss = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease;";
        const flexSuffix = opts.flex === true ? " flex: 1; min-width: 0;" : "";
        const restingCss = baseCss + flexSuffix;
        const hoverCss = restingCss
            .replace("background: var(--background-primary)", "background: var(--interactive-accent)")
            .replace("color: var(--interactive-accent);", "color: var(--text-on-accent);");
        btn.style.cssText = restingCss;
        btn.onmouseenter = () => {
            if (btn.disabled) return;
            btn.style.cssText = hoverCss;
            btn.style.background = "var(--interactive-accent)";
            btn.style.color = "var(--text-on-accent)";
        };
        btn.onmouseleave = () => {
            if (btn.disabled) return;
            btn.style.cssText = restingCss;
            btn.style.background = "var(--background-primary)";
            btn.style.color = "var(--interactive-accent)";
        };
        btn.onclick = opts.onClick;
        if (opts.disabled === true) btn.disabled = true;
        return btn;
    }
}
