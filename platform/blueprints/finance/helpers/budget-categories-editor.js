/**
 * BudgetCategoriesEditor — Add/Edit/Delete editor for the categories[] frontmatter
 * array on Budget atlas pages. Hybrid UX: read-only rows grouped under
 * <details> sections + Add modal + click-row-to-edit modal + per-row × delete.
 *
 * v0.107.0: grouped sections.
 *   • Iterates page.groups[] (the budget's snapshot of group order at create time)
 *     and renders one collapsible <details> per group containing categories
 *     where c.group === <group>. Each group section ends with a SUBTOTAL row
 *     (planned / actual / variance, color-coded by overrun threshold).
 *   • Auto-injects an "Unassigned" group at the END for any category whose
 *     group is not in page.groups[]. Auto-injected only — never written to fm.
 *   • The Add/Edit modal forces a Group dropdown sourced from page.groups[].
 *     Group renames in Budget Defaults do NOT propagate here (snapshot
 *     semantics — financial history is immutable).
 *
 * All writes via customJS.FinanceFrontmatter.update (atomic processFrontMatter).
 * Embed-deduped per v0.16.0 lesson.
 */
class BudgetCategoriesEditor {
    async render(dv, override) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bce-root");
        if (previous) previous.remove();

        const page = this._page(dv);
        if (!page || !page.file) return;
        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        const groups = Array.isArray(page.groups) ? page.groups.slice() : [];
        // Render-from-authoritative: prefer the freshly-written array captured by
        // the mutate flow over Dataview's lagging dv.current() metadata cache.
        const categories = Array.isArray(override)
            ? override
            : (Array.isArray(page.categories) ? page.categories.slice() : []);

        const root = dv.container.createEl("div", { cls: "bce-root" });
        root.style.cssText = "margin: 8px 0;";

        const actionRow = root.createEl("div");
        actionRow.style.cssText = "margin-bottom: 8px;";
        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        customJS.AccentButton.render(actionRow, {
            label: "Add Category",
            icon: plusIcon,
            onClick: () => this._addFlow(file, dv, groups)
        });

        if (categories.length === 0 && groups.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "No categories yet. Click + Add Category.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        // Pair each category with its original index so edits/deletes hit the
        // correct row even after we slice-by-group below.
        const indexed = categories.map((c, i) => ({ c, i }));

        // Render one <details> per group in order, then auto-injected "Unassigned"
        // for any orphan categories (group not in groups[]).
        const known = new Set(groups);
        for (const g of groups) {
            const inGroup = indexed.filter(({ c }) => c && c.group === g);
            this._renderGroupDetails(root, file, dv, groups, g, inGroup);
        }
        const orphans = indexed.filter(({ c }) => c && !known.has(c.group));
        if (orphans.length > 0) {
            this._renderGroupDetails(root, file, dv, groups, "Unassigned", orphans);
        }
    }

    _renderGroupDetails(root, file, dv, allGroups, groupName, items) {
        const details = root.createEl("details");
        details.open = true;
        details.style.cssText = "margin: 12px 0; border-top: 1px solid var(--background-modifier-border); padding-top: 6px;";

        // Sub-total computation.
        let plannedSum = 0;
        let actualSum = 0;
        for (const { c } of items) {
            plannedSum += (typeof c?.planned === "number") ? c.planned : 0;
            actualSum += (typeof c?.actual === "number") ? c.actual : 0;
        }
        const variance = actualSum - plannedSum;

        // Hardcoded palette so colors show regardless of Obsidian theme (matches BudgetSummary).
        const PALETTE = {
            green: "#16a34a", greenBg: "rgba(22, 163, 74, 0.10)",
            amber: "#b45309", amberBg: "rgba(180, 83, 9, 0.10)",
            red:   "#dc2626", redBg:   "rgba(220, 38, 38, 0.10)",
            muted: "var(--text-muted)", mutedBg: "transparent"
        };
        let tone = "muted";
        if (plannedSum > 0) {
            if (actualSum <= plannedSum) tone = "green";
            else if (actualSum <= 1.10 * plannedSum) tone = "amber";
            else tone = "red";
        }
        const fg = PALETTE[tone];
        const bg = PALETTE[`${tone}Bg`];

        const summary = details.createEl("summary");
        summary.style.cssText = "cursor: pointer; padding: 6px 0; display: flex; gap: 12px; align-items: center;";

        const nameSpan = summary.createEl("span");
        nameSpan.textContent = groupName;
        nameSpan.style.cssText = "font-size: 0.95em; font-weight: 600;";

        const fmtMoney = (n) => {
            const sign = n < 0 ? "-" : "";
            const abs = Math.abs(typeof n === "number" ? n : 0).toFixed(2);
            const parts = abs.split(".");
            return sign + "$" + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1];
        };

        const pill = summary.createEl("span");
        pill.style.cssText = `margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-size: 0.78em; font-variant-numeric: tabular-nums; color: ${fg}; padding: 3px 10px; border-radius: 999px; background: ${bg}; border: 1px solid ${fg}33;`;
        const pillTotals = pill.createEl("span");
        pillTotals.textContent = `${fmtMoney(plannedSum)} → ${fmtMoney(actualSum)}`;
        pillTotals.style.cssText = "color: var(--text-normal);";
        const pillDir = pill.createEl("span");
        if (plannedSum <= 0) {
            pillDir.textContent = "—";
        } else if (variance === 0) {
            pillDir.textContent = "on plan";
        } else {
            const overUnder = variance > 0 ? "over" : "under";
            pillDir.textContent = `${fmtMoney(Math.abs(variance))} ${overUnder}`;
        }
        pillDir.style.cssText = `color: ${fg}; font-weight: 500;`;

        if (items.length === 0) {
            const empty = details.createEl("div");
            empty.textContent = "(no categories in this group)";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 8px 0;";
            return;
        }

        // Column header row inside the group.
        const header = details.createEl("div");
        header.style.cssText = "display: flex; gap: 8px; padding: 4px 0; font-size: 0.75em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border);";
        const hName = header.createEl("div");
        hName.textContent = "Name";
        hName.style.cssText = "flex: 2; min-width: 0;";
        const hPlanned = header.createEl("div");
        hPlanned.textContent = "Planned";
        hPlanned.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hActual = header.createEl("div");
        hActual.textContent = "Actual";
        hActual.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hDel = header.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        for (const { c, i } of items) {
            const row = details.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 6px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const nameCell = row.createEl("span");
            nameCell.textContent = c?.name || "";
            nameCell.style.cssText = "flex: 2; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const plannedCell = row.createEl("span");
            plannedCell.textContent = (typeof c?.planned === "number") ? c.planned.toFixed(2) : "";
            plannedCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";

            const actualCell = row.createEl("span");
            actualCell.textContent = (typeof c?.actual === "number") ? c.actual.toFixed(2) : "";
            actualCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";
            if (typeof c?.planned === "number" && typeof c?.actual === "number" && c.actual > c.planned) {
                actualCell.style.color = c.actual <= 1.10 * c.planned ? "var(--text-warning, #b45309)" : "var(--text-error, #dc2626)";
            }

            const delBtn = row.createEl("button");
            delBtn.textContent = "×";
            delBtn.style.cssText = "flex: 0 0 32px; cursor: pointer; padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text-muted); font-size: 1em;";
            delBtn.addEventListener("mouseenter", () => {
                delBtn.style.background = "var(--background-modifier-hover)";
                delBtn.style.color = "var(--text-error)";
            });
            delBtn.addEventListener("mouseleave", () => {
                delBtn.style.background = "transparent";
                delBtn.style.color = "var(--text-muted)";
            });
            delBtn.onclick = (e) => {
                e.stopPropagation();
                this._deleteFlow(file, dv, i, c);
            };

            row.onclick = () => this._editFlow(file, dv, i, c, allGroups);
        }
    }

    _promptForCategory(initial, groups) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Category" : "Add Category";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const mkField = (labelText, control) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                control.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                wrap.appendChild(control);
                dialog.appendChild(wrap);
            };

            // Group dropdown — required; sourced from the budget's own
            // snapshot. "Unassigned" is added if the initial category is
            // currently orphaned, so editing doesn't silently reassign it.
            const groupSelect = document.createElement("select");
            const selectableGroups = (groups && groups.length > 0) ? groups.slice() : [];
            if (initial && initial.group && !selectableGroups.includes(initial.group)) {
                selectableGroups.push(initial.group);
            }
            if (selectableGroups.length === 0) selectableGroups.push("Unassigned");
            for (const g of selectableGroups) {
                const opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                groupSelect.appendChild(opt);
            }
            mkField("Group", groupSelect);

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            mkField("Name", nameInput);

            const plannedInput = document.createElement("input");
            plannedInput.type = "number";
            plannedInput.step = "0.01";
            plannedInput.min = "0";
            mkField("Planned", plannedInput);

            const actualInput = document.createElement("input");
            actualInput.type = "number";
            actualInput.step = "0.01";
            actualInput.min = "0";
            mkField("Actual", actualInput);

            if (initial) {
                nameInput.value = initial.name || "";
                plannedInput.value = String(initial.planned ?? 0);
                actualInput.value = String(initial.actual ?? 0);
                if (initial.group && selectableGroups.includes(initial.group)) {
                    groupSelect.value = initial.group;
                }
            } else {
                plannedInput.value = "0";
                actualInput.value = "0";
                if (selectableGroups.length > 0) groupSelect.value = selectableGroups[0];
            }

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!nameInput.value.trim()) return "Name required.";
                if (!groupSelect.value) return "Group required.";
                if (Number.isNaN(Number(plannedInput.value)) || Number(plannedInput.value) < 0) return "Planned must be >= 0.";
                if (Number.isNaN(Number(actualInput.value)) || Number(actualInput.value) < 0) return "Actual must be >= 0.";
                return null;
            };

            const refreshStatus = () => {
                const err = validate();
                status.textContent = err || "";
            };
            nameInput.addEventListener("input", refreshStatus);
            plannedInput.addEventListener("input", refreshStatus);
            actualInput.addEventListener("input", refreshStatus);
            groupSelect.addEventListener("change", refreshStatus);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Save";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const err = validate();
                if (err) { status.textContent = err; return; }
                document.body.removeChild(overlay);
                resolve({
                    group: groupSelect.value,
                    name: nameInput.value.trim(),
                    planned: Number(plannedInput.value),
                    actual: Number(actualInput.value)
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            nameInput.addEventListener("keydown", onKey);
            plannedInput.addEventListener("keydown", onKey);
            actualInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => nameInput.focus(), 0);
        });
    }

    async _addFlow(file, dv, groups) {
        const result = await this._promptForCategory(null, groups);
        if (!result) return;
        await this._mutateRender(file, dv, (fm) => {
            fm.categories = (fm.categories || []).concat([result]);
        });
    }

    async _editFlow(file, dv, index, current, groups) {
        const result = await this._promptForCategory(current, groups);
        if (!result) return;
        await this._mutateRender(file, dv, (fm) => {
            const list = (fm.categories || []).slice();
            // Merge-on-edit: keep non-dialog fields the modal doesn't surface.
            list[index] = Object.assign({}, current, result);
            fm.categories = list;
        });
    }

    async _deleteFlow(file, dv, index, current) {
        if (!window.confirm(`Delete category '${current?.name || ""}'?`)) return;
        await this._mutateRender(file, dv, (fm) => {
            const list = (fm.categories || []).slice();
            list.splice(index, 1);
            fm.categories = list;
        });
    }

    async _rerender(dv, authoritative) {
        try { customJS.RenderSafe?.captureScroll?.(); } catch (_e) {}
        return await this.render(dv, authoritative);
    }

    async _mutateRender(file, dv, mutator) {
        const current = customJS.FinanceFrontmatter.read?.(file) || this._page(dv) || {};
        const preview = Object.assign({}, current, {
            categories: Array.isArray(current.categories) ? current.categories.slice() : [],
        });
        mutator(preview);
        const next = preview.categories.slice();
        return await customJS.FinanceFrontmatter.mutateRendered(file, {
            dv,
            selector: ":scope > .bce-root",
            failureMessage: "Could not update budget category",
            render: () => this._rerender(dv, next),
            write: () => this._mutate(file, mutator),
        });
    }

    async _mutate(file, mutator) {
        return await customJS.FinanceFrontmatter.update(file, mutator);
    }

    _page(dv) {
        try { return customJS.FinanceFrontmatter?.page?.(dv) || customJS.RenderSafe?.page?.(dv) || dv?.current?.() || null; }
        catch (_e) { return null; }
    }
}
