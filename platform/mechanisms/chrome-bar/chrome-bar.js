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

  // ── vaultEntries — the Go launcher's Vault section ──────────────────────────
  // Reads ranch/nav-buttons-registry.json (raw — no cache, matching the prior
  // inline read), delegates ordering to SpaceNavButtons.firstEntryPerSource (the
  // single ordering rule), maps each source's representative entry to
  // { label, icon, onSelect } (openLink → open(target); else →
  // SpaceNavButtons._dispatchAction so Templater/command actions behave exactly
  // like the vault nav bar), and returns [{ section:"Vault", layout:"grid" },
  // ...dests] — or [] when the registry is absent/empty. Never throws.
  async vaultEntries(dv, open) {
    let registry = null;
    try {
      const raw = await app.vault.adapter.read("ranch/nav-buttons-registry.json");
      registry = JSON.parse(raw);
    } catch (_e) { registry = null; }

    const iconFor = (name) => {
      try { return (customJS.Icons && customJS.Icons.resolve && customJS.Icons.resolve(name)) || ""; }
      catch (_e) { return ""; }
    };
    let reps = [];
    try {
      if (customJS && customJS.SpaceNavButtons && typeof customJS.SpaceNavButtons.firstEntryPerSource === "function") {
        reps = customJS.SpaceNavButtons.firstEntryPerSource(registry) || [];
      }
    } catch (_e) { reps = []; }

    const vaultDests = [];
    for (const entry of reps) {
      const action = (entry && entry.action) || {};
      const label = (entry && entry.label) || (entry && entry._source) || "";
      const icon = iconFor(entry && entry.icon);
      if (action.type === "openLink" && action.target) {
        const target = action.target;
        vaultDests.push({ label, icon, onSelect: () => { try { open(target); } catch (_e) {} } });
      } else {
        const dispatchEntry = entry;
        vaultDests.push({ label, icon, onSelect: () => {
          try {
            if (customJS && customJS.SpaceNavButtons && typeof customJS.SpaceNavButtons._dispatchAction === "function") {
              customJS.SpaceNavButtons._dispatchAction(dispatchEntry, dv);
            }
          } catch (_e) { /* never throw */ }
        } });
      }
    }

    const out = [];
    if (vaultDests.length > 0) {
      out.push({ section: "Vault", layout: "grid" });
      for (const d of vaultDests) out.push(d);
    }
    return out;
  }

  // ── render — the shared chrome bar ─────────────────────────────────────────
  // adapter: { resolve(dv, page) -> { ctx, spec } | null, navEntries(dv, ctx),
  //   dispatch(dv, ctx, id), openNavTarget(path, dv), rootClass, btnClass(variant) }.
  // The generic bar (guards, breadcrumb, MenuPopover wiring, dedupe root, control
  // assembly) lives here; the adapter supplies the blueprint-specific parts. Every
  // branch is never-throw + cold-load-safe.
  async render(dv, adapter) {
    if (!adapter || typeof adapter.resolve !== "function") return;
    const ICON = this.CHROME_ICONS;
    // Cold-load guard (mirror doc-leaf-actions.js): bail on missing page/file or
    // an embedded render context.
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;
    const container0 = (dv && dv.container) ? dv.container : dv;
    if (!container0 || typeof container0.createEl !== "function") return;
    if (container0.closest && container0.closest(".markdown-embed")) return;

    const resolved = adapter.resolve(dv, page);
    if (!resolved) return;
    const ctx = resolved.ctx;
    const spec = resolved.spec;

    // Dedupe: Dataview can re-fire a block without clearing the container. Wrap
    // all output in a single removable root so a re-render replaces prior output.
    try {
      const prev = container0.querySelector && container0.querySelector(":scope > ." + adapter.rootClass);
      if (prev && prev.remove) prev.remove();
    } catch (_e) { /* best-effort */ }
    const root = container0.createEl("div", { cls: adapter.rootClass });
    // At least 10px between the bar and whatever the template renders next.
    root.style.cssText = "margin-bottom: 12px;";

    // Single flex bar: breadcrumb left, controls right.
    const bar = root.createEl("div");
    bar.style.cssText = "display: flex; align-items: center; gap: 10px; flex-wrap: wrap;";

    // ── LEFT — breadcrumb crumbs ──────────────────────────────────────────────
    let segments = [];
    try {
      if (customJS && customJS.Breadcrumb && typeof customJS.Breadcrumb.buildSegments === "function") {
        segments = await customJS.Breadcrumb.buildSegments(dv);
      }
    } catch (_e) { segments = []; }
    if (Array.isArray(segments) && segments.length > 0) {
      const left = bar.createEl("div", { cls: "project-breadcrumb" });
      left.style.cssText = "font-size: 0.85em; color: var(--text-muted); display: flex; align-items: center; flex-wrap: wrap; gap: 2px; min-width: 0;";
      segments.forEach((seg, i) => {
        if (i > 0) {
          const sep = left.createEl("span");
          sep.textContent = " / ";
          sep.style.cssText = "opacity: 0.5; margin: 0 2px;";
        }
        if (seg && seg.link) {
          const a = left.createEl("a");
          a.textContent = seg.label;
          a.style.cssText = "color: var(--text-muted); cursor: pointer; text-decoration: none;";
          const target = seg.link;
          a.onclick = (e) => {
            if (e && e.preventDefault) e.preventDefault();
            adapter.openNavTarget(target, dv);
          };
        } else {
          const cur = left.createEl("span");
          cur.textContent = (seg && seg.label) || "";
          cur.style.cssText = "color: var(--text-muted);";
        }
      });
    }

    // ── RIGHT — controls (Go ▾ · primary · ⋯), pushed right via margin-left:auto ─
    const right = bar.createEl("div");
    right.style.cssText = "margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;";

    // 1. Go ▾ launcher — icon-only (compass + a small caret), no "Go" text.
    const goIcon = `<span style="display:inline-flex;align-items:center;gap:2px;">${ICON.compass}${ICON.chevronDown}</span>`;
    const goBtn = this.renderChromeButton(right, {
      cls: adapter.btnClass("go"),
      icon: goIcon,
      onClick: async () => {
        try {
          const navEntries = await adapter.navEntries(dv, ctx);
          if (customJS && customJS.MenuPopover && typeof customJS.MenuPopover.open === "function") {
            customJS.MenuPopover.open(navEntries, { anchor: goBtn, title: "Go to" });
          }
        } catch (_e) { /* never throw */ }
      },
    });

    // 2. Primary button — non-leaf surfaces only.
    if (!spec.leaf && spec.primary) {
      const p = spec.primary;
      this.renderChromeButton(right, {
        cls: adapter.btnClass("primary"),
        label: p.label,
        icon: p.icon,
        onClick: () => adapter.dispatch(dv, ctx, p.id),
      });
    }

    // 3. ⋯ overflow menu — when the surface declares overflow actions.
    if (Array.isArray(spec.overflow) && spec.overflow.length > 0) {
      const dotsBtn = this.renderChromeButton(right, {
        cls: adapter.btnClass("dots"),
        icon: ICON.moreHorizontal,
        onClick: () => {
          try {
            const menu = spec.overflow.map((o) => ({
              label: o.label,
              icon: o.icon,
              danger: o.danger,
              onSelect: () => adapter.dispatch(dv, ctx, o.id),
            }));
            if (customJS && customJS.MenuPopover && typeof customJS.MenuPopover.open === "function") {
              customJS.MenuPopover.open(menu, { anchor: dotsBtn });
            }
          } catch (_e) { /* never throw */ }
        },
      });
    }
  }
}
