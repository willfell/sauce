/**
 * PersonNavButtons — per-person identity row + back-link to People hub.
 *
 * Renders at top of every person note: Lucide user icon + bold person name +
 * optional tag-mode chip (first non-`person` tag), followed by an AccentButton
 * back-link to spice/people/People.md. Embed-deduped per v0.16.0 lesson.
 * Mirrors BudgetNavButtons / PaycheckNavButtons shape from v0.17.0.
 */
class PersonNavButtons {
    async render(dv, opts) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pnb-root");
        if (previous) previous.remove();

        const current = dv.current();
        const name = current?.file?.name || "Person";

        // Resolve tag-mode chip: first non-`person` tag, if any.
        let tagMode = null;
        const rawTags = current?.tags || current?.file?.tags || [];
        const tagList = Array.isArray(rawTags) ? rawTags : [];
        for (const t of tagList) {
            const stripped = String(t).replace(/^#/, "").trim();
            if (!stripped || stripped.toLowerCase() === "person") continue;
            tagMode = stripped;
            break;
        }

        const userIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

        const root = dv.container.createEl("div", { cls: "pnb-root" });

        // Identity row.
        const idRow = root.createEl("div");
        idRow.style.cssText = "display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; margin: 8px 0 6px 0; min-width: 0;";

        const iconWrap = idRow.createEl("span");
        iconWrap.innerHTML = userIcon;
        iconWrap.style.cssText = "display: inline-flex; align-items: center; color: var(--text-muted); flex-shrink: 0;";

        const nameEl = idRow.createEl("span");
        nameEl.textContent = name;
        nameEl.style.cssText = "font-weight: 600; font-size: 1.05em; color: var(--text-normal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;";

        if (tagMode) {
            const chip = idRow.createEl("span");
            chip.textContent = tagMode;
            chip.style.cssText = "display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--background-modifier-border); color: var(--text-muted); font-size: 0.72em; font-weight: 500; letter-spacing: 0.04em; text-transform: lowercase; flex-shrink: 0;";
        }

        // Back-link button row.
        const btnRow = root.createEl("div");
        btnRow.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px;";

        customJS.AccentButton.render(btnRow, {
            label: "← Back to People",
            icon: null,
            onClick: () => dv.app.workspace.openLinkText("People", "spice/people/", false)
        });
    }
}
