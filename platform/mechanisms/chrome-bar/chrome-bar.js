/**
 * ChromeBar (CustomJS) — the shared per-surface chrome bar.
 *
 * The blueprint-agnostic extraction of ProjectChromeBar's chrome system: the
 * breadcrumb-left + Go/primary/overflow-right control, its button look, the
 * chrome glyphs, and the Go launcher's Vault section. Any blueprint renders the
 * identical bar by handing render(dv, adapter) an adapter that supplies the
 * blueprint-specific parts (which surface, what controls, where nav points, what
 * actions do, and its own marker classes). ProjectChromeBar is the first consumer.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan; the plugin
 * stores it as an INSTANCE, so every method is an INSTANCE method (internal calls
 * use this.*). Every method is never-throw + cold-load-safe.
 */
class ChromeBar {
  // ── CHROME_ICONS — the bar's own control glyphs (compass = Go, chevronDown =
  // the Go caret, moreHorizontal = the ⋯ overflow). Blueprint-destination glyphs
  // stay with each blueprint's helper.
  get CHROME_ICONS() {
    return {
      compass: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/></svg>`,
      chevronDown: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
      moreHorizontal: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
    };
  }

  // ── renderChromeButton — the bar's own button look ──────────────────────────
  // 32px, icon-first, hover-lift + press-scale micro-motion. The CALLER supplies
  // opts.cls (its marker class, e.g. "pcb-btn pcb-btn-go") so each blueprint's
  // rendered DOM stays byte-identical. Icon-only when opts.label is omitted.
  // opts: { cls, label?, icon?, onClick }.
  renderChromeButton(parent, opts) {
    const o = opts || {};
    const btn = parent.createEl("button", { cls: o.cls || "sc-chrome-btn" });
    const hasLabel = !!o.label;
    const iconHtml = o.icon || "";
    const labelHtml = hasLabel
      ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;">${o.label}</span>`
      : "";
    btn.innerHTML = iconHtml + labelHtml;
    const EASE = "cubic-bezier(0.2, 0.9, 0.25, 1)";
    btn.style.cssText = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center;"
      + " gap: 6px; height: 32px; box-sizing: border-box;"
      + ` padding: 0 ${hasLabel ? "16" : "12"}px;`
      + (hasLabel ? "" : " min-width: 38px;")
      + " border-radius: 8px; border: 1px solid var(--interactive-accent);"
      + " background: var(--background-primary); color: var(--interactive-accent);"
      + " font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em;"
      + " overflow: hidden; transform: scale(1); box-shadow: none;"
      + ` transition: background 0.15s ${EASE}, color 0.15s ${EASE}, border-color 0.15s ${EASE},`
      + ` box-shadow 0.15s ${EASE}, transform 0.15s ${EASE};`;
    btn.onmouseenter = () => {
      if (btn.disabled) return;
      btn.style.background = "var(--interactive-accent)";
      btn.style.color = "var(--text-on-accent)";
      btn.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.14)";
    };
    btn.onmouseleave = () => {
      if (btn.disabled) return;
      btn.style.background = "var(--background-primary)";
      btn.style.color = "var(--interactive-accent)";
      btn.style.boxShadow = "none";
      btn.style.transform = "scale(1)";
    };
    btn.onmousedown = () => { if (!btn.disabled) btn.style.transform = "scale(0.94)"; };
    btn.onmouseup = () => { if (!btn.disabled) btn.style.transform = "scale(1)"; };
    btn.onclick = o.onClick;
    return btn;
  }
}
