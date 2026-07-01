/**
 * BudgetDefaultsEditor — Two-pane editor for spice/finance/Budget Defaults.md.
 *
 * Owns the per-vault seed list consumed by entity-create's seed_from_defaults
 * resolver when the user clicks "+ New Budget". Edits both:
 *   • groups[]      — user-defined, ordered string array (Essential / Extra / ...).
 *   • categories[]  — {group, name, planned} per row, grouped under groups[].
 *
 * Dialogue-driven only — no raw YAML editing. Group modal validates non-empty
 * + unique. Group delete blocks when categories still reference it (reassign
 * picker offered). Category modal forces a Group dropdown from current
 * groups[]. Reorder via ↑/↓ buttons (drag-and-drop deferred).
 *
 * All writes via customJS.FinanceFrontmatter.update (atomic processFrontMatter).
 * Embed-deduped per v0.16.0 lesson.
 */
class BudgetDefaultsEditor {
    async render(dv, override) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bde-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        const groups = Array.isArray(page.groups) ? page.groups.slice() : [];
        // Render-from-authoritative: the category flows capture the freshly-written
        // categories[] and pass it as override so the re-render reflects the true
        // post-write state instead of Dataview's lagging dv.current() cache. Group
        // flows pass no override and fall back to dv.current() (groups are the data
        // they mutate; the category cascade is the data-loss risk this closes).
        const categories = Array.isArray(override)
            ? override
            : (Array.isArray(page.categories) ? page.categories.slice() : []);

        const root = dv.container.createEl("div", { cls: "bde-root" });
        root.style.cssText = "margin: 8px 0;";

        this._renderGroupsPane(root, file, dv, groups, categories);
        this._renderCategoriesPane(root, file, dv, groups, categories);
    }

    // ------------------------------ Groups pane ------------------------------

    _renderGroupsPane(root, file, dv, groups, categories) {
        const section = root.createEl("div", { cls: "bde-groups-section" });
        section.style.cssText = "margin-bottom: 24px;";

        const headerRow = section.createEl("div");
        headerRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;";

        const label = headerRow.createEl("div");
        label.textContent = "GROUPS";
        label.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;";

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        customJS.AccentButton.render(headerRow, {
            label: "Add Group",
            icon: plusIcon,
            onClick: () => this._addGroupFlow(file, dv)
        });

        const list = section.createEl("div");
        list.style.cssText = "border-top: 1px solid var(--background-modifier-border); margin-top: 8px;";

        if (groups.length === 0) {
            const empty = list.createEl("div");
            empty.textContent = "No groups yet. Click + Add Group.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        groups.forEach((group, index) => {
            const row = list.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; align-items: center; border-bottom: 1px solid var(--background-modifier-border);";

            const nameCell = row.createEl("span");
            nameCell.textContent = group;
            nameCell.style.cssText = "flex: 1; font-size: 0.95em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const editBtn = this._iconBtn(row, "✎", () => this._editGroupFlow(file, dv, index, group));
            const upBtn = this._iconBtn(row, "↑", () => this._moveGroup(file, dv, index, -1));
            const downBtn = this._iconBtn(row, "↓", () => this._moveGroup(file, dv, index, +1));
            const delBtn = this._iconBtn(row, "×", () => this._deleteGroupFlow(file, dv, index, group, categories));
            delBtn.style.color = "var(--text-muted)";
            delBtn.addEventListener("mouseenter", () => { delBtn.style.color = "var(--text-error)"; });
            delBtn.addEventListener("mouseleave", () => { delBtn.style.color = "var(--text-muted)"; });

            if (index === 0) upBtn.style.opacity = "0.3";
            if (index === groups.length - 1) downBtn.style.opacity = "0.3";
        });
    }

    _iconBtn(parent, glyph, onClick) {
        const btn = parent.createEl("button");
        btn.textContent = glyph;
        btn.style.cssText = "flex: 0 0 28px; cursor: pointer; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text-muted); font-size: 0.95em;";
        btn.addEventListener("mouseenter", () => { btn.style.background = "var(--background-modifier-hover)"; });
        btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
        btn.onclick = (e) => { e.stopPropagation(); onClick(); };
        return btn;
    }

    _promptForGroup(initial, existingGroups) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Group" : "Add Group";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 16px;";
            dialog.appendChild(heading);

            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
            const lab = document.createElement("label");
            lab.textContent = "Name";
            lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
            wrap.appendChild(lab);
            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = initial || "";
            nameInput.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em;";
            wrap.appendChild(nameInput);
            dialog.appendChild(wrap);

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                const v = nameInput.value.trim();
                if (!v) return "Name required.";
                const others = (existingGroups || []).filter((g, i) => g !== initial);
                if (others.includes(v)) return "Name must be unique.";
                return null;
            };
            nameInput.addEventListener("input", () => { status.textContent = validate() || ""; });

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
                resolve(nameInput.value.trim());
            };

            nameInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => nameInput.focus(), 0);
        });
    }

    async _addGroupFlow(file, dv) {
        const current = this._mutateRead(file);
        const groups = Array.isArray(current?.groups) ? current.groups : [];
        const name = await this._promptForGroup(null, groups);
        if (!name) return;
        await this._mutate(file, (fm) => {
            const next = Array.isArray(fm.groups) ? fm.groups.slice() : [];
            next.push(name);
            fm.groups = next;
        });
        await this.render(dv);
    }

    async _editGroupFlow(file, dv, index, current) {
        const cur = this._mutateRead(file);
        const groups = Array.isArray(cur?.groups) ? cur.groups : [];
        const newName = await this._promptForGroup(current, groups);
        if (!newName || newName === current) return;
        await this._mutate(file, (fm) => {
            const next = Array.isArray(fm.groups) ? fm.groups.slice() : [];
            const oldName = next[index];
            next[index] = newName;
            fm.groups = next;
            // Cascade rename to every category that references the old group.
            if (Array.isArray(fm.categories)) {
                for (const cat of fm.categories) {
                    if (cat && typeof cat === "object" && cat.group === oldName) {
                        cat.group = newName;
                    }
                }
            }
        });
        await this.render(dv);
    }

    async _deleteGroupFlow(file, dv, index, groupName, categories) {
        const referenced = (categories || []).filter((c) => c && c.group === groupName);
        if (referenced.length > 0) {
            const reassignTo = await this._promptForReassign(groupName, referenced.length, categories);
            if (reassignTo === null) return; // user cancelled
            await this._mutate(file, (fm) => {
                if (Array.isArray(fm.categories)) {
                    for (const cat of fm.categories) {
                        if (cat && typeof cat === "object" && cat.group === groupName) {
                            cat.group = reassignTo;
                        }
                    }
                }
                const next = Array.isArray(fm.groups) ? fm.groups.slice() : [];
                next.splice(index, 1);
                fm.groups = next;
            });
        } else {
            if (!window.confirm(`Delete group "${groupName}"?`)) return;
            await this._mutate(file, (fm) => {
                const next = Array.isArray(fm.groups) ? fm.groups.slice() : [];
                next.splice(index, 1);
                fm.groups = next;
            });
        }
        await this.render(dv);
    }

    _promptForReassign(groupName, count, categories) {
        return new Promise((resolve) => {
            const otherGroups = Array.from(new Set((categories || [])
                .map((c) => c && c.group)
                .filter((g) => g && g !== groupName)));
            // Always offer "Unassigned" as a target.
            if (!otherGroups.includes("Unassigned")) otherGroups.push("Unassigned");

            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 90vw;";

            const heading = document.createElement("div");
            heading.textContent = `Delete "${groupName}"`;
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 8px;";
            dialog.appendChild(heading);

            const explainer = document.createElement("div");
            explainer.textContent = `${count} categor${count === 1 ? "y" : "ies"} still use this group. Reassign to:`;
            explainer.style.cssText = "font-size: 0.9em; color: var(--text-muted); margin-bottom: 12px;";
            dialog.appendChild(explainer);

            const select = document.createElement("select");
            select.style.cssText = "width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; margin-bottom: 16px;";
            for (const g of otherGroups) {
                const opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                select.appendChild(opt);
            }
            dialog.appendChild(select);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Reassign + Delete";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--text-error); background: var(--text-error); color: var(--text-on-accent);";
            okBtn.onclick = () => { document.body.removeChild(overlay); resolve(select.value); };

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
        });
    }

    async _moveGroup(file, dv, index, direction) {
        const cur = this._mutateRead(file);
        const groups = Array.isArray(cur?.groups) ? cur.groups : [];
        const target = index + direction;
        if (target < 0 || target >= groups.length) return;
        await this._mutate(file, (fm) => {
            const next = Array.isArray(fm.groups) ? fm.groups.slice() : [];
            const t = target;
            const tmp = next[index];
            next[index] = next[t];
            next[t] = tmp;
            fm.groups = next;
        });
        await this.render(dv);
    }

    // -------------------------- Categories pane (grouped) --------------------

    _renderCategoriesPane(root, file, dv, groups, categories) {
        const section = root.createEl("div", { cls: "bde-categories-section" });

        const headerRow = section.createEl("div");
        headerRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;";

        const label = headerRow.createEl("div");
        label.textContent = "CATEGORIES (seed list for new budgets)";
        label.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;";

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        customJS.AccentButton.render(headerRow, {
            label: "Add Category",
            icon: plusIcon,
            onClick: () => this._addCategoryFlow(file, dv)
        });

        if (groups.length === 0 && categories.length === 0) {
            const empty = section.createEl("div");
            empty.textContent = "Add a group first; categories slot under groups.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        // Render each group as a collapsible <details>.
        const knownGroups = new Set(groups);
        for (const group of groups) {
            const inGroup = categories
                .map((c, i) => ({ c, i }))
                .filter(({ c }) => c && c.group === group);
            this._renderGroupDetails(section, file, dv, group, inGroup);
        }

        // Auto-injected "Unassigned" bucket for any orphan categories.
        const orphans = categories
            .map((c, i) => ({ c, i }))
            .filter(({ c }) => c && !knownGroups.has(c.group));
        if (orphans.length > 0) {
            this._renderGroupDetails(section, file, dv, "Unassigned", orphans);
        }
    }

    _renderGroupDetails(section, file, dv, groupName, items) {
        const details = section.createEl("details");
        details.open = true;
        details.style.cssText = "margin: 8px 0; border-top: 1px solid var(--background-modifier-border); padding-top: 6px;";

        const summary = details.createEl("summary");
        summary.style.cssText = "cursor: pointer; padding: 4px 0; display: flex; gap: 8px; align-items: center;";
        const summaryName = summary.createEl("span");
        summaryName.textContent = groupName;
        summaryName.style.cssText = "font-size: 0.95em; font-weight: 600;";
        const summaryCount = summary.createEl("span");
        summaryCount.textContent = `(${items.length})`;
        summaryCount.style.cssText = "font-size: 0.8em; color: var(--text-muted);";

        if (items.length === 0) {
            const empty = details.createEl("div");
            empty.textContent = "(no categories)";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 8px 0;";
            return;
        }

        for (const { c, i } of items) {
            const row = details.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 6px 0; align-items: center; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border);";

            const nameCell = row.createEl("span");
            nameCell.textContent = c.name || "";
            nameCell.style.cssText = "flex: 2; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis;";

            const plannedCell = row.createEl("span");
            plannedCell.textContent = (typeof c.planned === "number") ? c.planned.toFixed(2) : "";
            plannedCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums;";

            const delBtn = this._iconBtn(row, "×", () => this._deleteCategoryFlow(file, dv, i, c));
            delBtn.addEventListener("mouseenter", () => { delBtn.style.color = "var(--text-error)"; });
            delBtn.addEventListener("mouseleave", () => { delBtn.style.color = "var(--text-muted)"; });

            row.onclick = (e) => {
                if (e.target.tagName === "BUTTON") return;
                this._editCategoryFlow(file, dv, i, c);
            };
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

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            mkField("Name", nameInput);

            const groupSelect = document.createElement("select");
            for (const g of (groups || [])) {
                const opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                groupSelect.appendChild(opt);
            }
            mkField("Group", groupSelect);

            const plannedInput = document.createElement("input");
            plannedInput.type = "number";
            plannedInput.step = "0.01";
            plannedInput.min = "0";
            mkField("Planned", plannedInput);

            if (initial) {
                nameInput.value = initial.name || "";
                groupSelect.value = initial.group || "";
                plannedInput.value = String(initial.planned ?? 0);
            } else {
                plannedInput.value = "0";
                if ((groups || []).length > 0) groupSelect.value = groups[0];
            }

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!nameInput.value.trim()) return "Name required.";
                if (!(groups || []).length) return "Add a group first.";
                if (!groupSelect.value) return "Group required.";
                const p = Number(plannedInput.value);
                if (Number.isNaN(p) || p < 0) return "Planned must be >= 0.";
                return null;
            };
            const refresh = () => { status.textContent = validate() || ""; };
            nameInput.addEventListener("input", refresh);
            plannedInput.addEventListener("input", refresh);
            groupSelect.addEventListener("change", refresh);

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
                    name: nameInput.value.trim(),
                    group: groupSelect.value,
                    planned: Number(plannedInput.value)
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            nameInput.addEventListener("keydown", onKey);
            plannedInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => nameInput.focus(), 0);
        });
    }

    async _addCategoryFlow(file, dv) {
        const cur = this._mutateRead(file);
        const groups = Array.isArray(cur?.groups) ? cur.groups : [];
        if (groups.length === 0) {
            new Notice("Add a group first.");
            return;
        }
        const result = await this._promptForCategory(null, groups);
        if (!result) return;
        let captured = null;
        await this._mutate(file, (fm) => {
            const next = Array.isArray(fm.categories) ? fm.categories.slice() : [];
            next.push(result);
            fm.categories = next;
            captured = next.slice();
        });
        await this.render(dv, captured);
    }

    async _editCategoryFlow(file, dv, index, current) {
        const cur = this._mutateRead(file);
        const groups = Array.isArray(cur?.groups) ? cur.groups : [];
        const result = await this._promptForCategory(current, groups);
        if (!result) return;
        let captured = null;
        await this._mutate(file, (fm) => {
            const next = Array.isArray(fm.categories) ? fm.categories.slice() : [];
            // Merge-on-edit: keep non-dialog fields the modal doesn't surface.
            next[index] = Object.assign({}, current, result);
            fm.categories = next;
            captured = next.slice();
        });
        await this.render(dv, captured);
    }

    async _deleteCategoryFlow(file, dv, index, current) {
        if (!window.confirm(`Delete category "${current?.name || ""}"?`)) return;
        let captured = null;
        await this._mutate(file, (fm) => {
            const next = Array.isArray(fm.categories) ? fm.categories.slice() : [];
            next.splice(index, 1);
            fm.categories = next;
            captured = next.slice();
        });
        await this.render(dv, captured);
    }

    // ------------------------------ Mutate helpers --------------------------

    _mutateRead(file) {
        return app.metadataCache.getFileCache(file)?.frontmatter || null;
    }

    async _mutate(file, mutator) {
        return await customJS.FinanceFrontmatter.update(file, mutator);
    }
}
