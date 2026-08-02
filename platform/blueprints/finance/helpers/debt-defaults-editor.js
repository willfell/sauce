/**
 * DebtDefaultsEditor v0.6.0 (v0.108.0 S3)
 *
 * Flat-list editor for spice/finance/Debt Defaults.md.
 * Mirrors PaycheckDefaultsEditor pattern: flat table display with
 * click-row-to-edit modal, per-row delete, and an "+ Add Debt" button.
 *
 * Columns: Kind / Name / Balance / APR / Min / Planned / URL / Opened / (delete)
 *
 * Modal field set:
 *   kind dropdown (credit-card | student-loan | other)
 *   name (text)
 *   current_balance (number)
 *   credit_limit (number, shown only when kind=credit-card)
 *   apr (number)
 *   min_payment (number)
 *   planned_monthly_payment (number)
 *   url (text)
 *   opened_date (date)
 *
 * Required: kind + name + current_balance + apr.
 * All writes via customJS.FinanceFrontmatter.update.
 * CSS root: dde-root. Embed-deduped.
 */
class DebtDefaultsEditor {
    async render(dv) {
        const override = this._renderOverrides?.get?.(dv);
        return await this._render(dv, override);
    }

    async _render(dv, override) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .dde-root");
        if (previous) previous.remove();

        const page = this._page(dv);
        if (!page || !page.file) return;
        if (page.type !== "debt-defaults") return;

        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        const debts = Array.isArray(override)
            ? override
            : (Array.isArray(page.debts) ? page.debts.slice() : []);

        const root = dv.container.createEl("div", { cls: "dde-root" });
        root.style.cssText = "margin: 8px 0;";

        // Header row
        const headerRow = root.createEl("div");
        headerRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;";

        const label = headerRow.createEl("div");
        label.textContent = "DEBTS (seed list for vault debt entities)";
        label.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;";

        const addBtn = headerRow.createEl("button", { text: "+ Add Debt" });
        addBtn.style.cssText = "cursor: pointer; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); font-size: 0.82em;";
        addBtn.addEventListener("click", () => this._openModal(file, dv, -1, { kind: "credit-card" }));

        if (debts.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "No debts yet. Click + Add Debt.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        // Column headers
        const colHeader = root.createEl("div");
        colHeader.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.75em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 4px;";
        const cols = [
            { text: "Kind",    flex: "1.2" },
            { text: "Name",    flex: "2" },
            { text: "Balance", flex: "1", align: "right" },
            { text: "APR",     flex: "0.7", align: "right" },
            { text: "Min",     flex: "0.8", align: "right" },
            { text: "Planned", flex: "0.8", align: "right" },
            { text: "URL",     flex: "0.4", align: "center" },
            { text: "Opened",  flex: "1" },
            { text: "",        flex: "0 0 32px" },
        ];
        for (const c of cols) {
            const el = colHeader.createEl("div");
            el.textContent = c.text;
            el.style.cssText = `flex: ${c.flex}; min-width: 0;${c.align ? " text-align: " + c.align + ";" : ""}`;
        }

        // Data rows
        const rowsWrap = root.createEl("div");
        debts.forEach((d, i) => {
            const row = rowsWrap.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const fmt = (v, prefix = "$") => (typeof v === "number" ? `${prefix}${v.toFixed(2)}` : "—");

            const mkCell = (text, flex, align) => {
                const el = row.createEl("span");
                el.textContent = text;
                el.style.cssText = `flex: ${flex}; font-size: 0.88em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;${align ? " text-align: " + align + ";" : ""}`;
                return el;
            };

            mkCell(d.kind || "", "1.2");
            mkCell(d.name || "", "2");
            mkCell(fmt(d.current_balance), "1", "right");
            mkCell(typeof d.apr === "number" ? `${d.apr.toFixed(2)}%` : "—", "0.7", "right");
            mkCell(fmt(d.min_payment), "0.8", "right");
            mkCell(fmt(d.planned_monthly_payment), "0.8", "right");
            mkCell(d.url ? "↗" : "", "0.4", "center").style.color = "var(--text-accent)";
            mkCell(d.opened_date || "", "1");

            const delBtn = row.createEl("button", { text: "×" });
            delBtn.style.cssText = "flex: 0 0 32px; cursor: pointer; padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text-muted); font-size: 1em;";
            delBtn.addEventListener("mouseenter", () => {
                delBtn.style.background = "var(--background-modifier-hover)";
                delBtn.style.color = "var(--text-error)";
            });
            delBtn.addEventListener("mouseleave", () => {
                delBtn.style.background = "transparent";
                delBtn.style.color = "var(--text-muted)";
            });
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!window.confirm(`Delete debt "${d.name || ""}"?`)) return;
                this._mutateDebts(file, dv, (fm) => {
                    fm.debts = (fm.debts || []).filter((_, idx) => idx !== i);
                });
            });

            row.addEventListener("click", (e) => {
                if (e.target.tagName !== "BUTTON") this._openModal(file, dv, i, d);
            });
        });
    }

    _openModal(file, dv, idx, initial) {
        const isNew = idx === -1;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";

        const dialog = document.createElement("div");
        dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 380px; max-width: 92vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

        const heading = document.createElement("div");
        heading.textContent = isNew ? "Add Debt" : "Edit Debt";
        heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 16px;";
        dialog.appendChild(heading);

        const mkField = (labelText, control, hint) => {
            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 10px;";
            const lab = document.createElement("label");
            lab.textContent = labelText + (hint ? ` (${hint})` : "");
            lab.style.cssText = "font-size: 0.82em; color: var(--text-muted); flex: 0 0 110px;";
            wrap.appendChild(lab);
            control.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
            wrap.appendChild(control);
            dialog.appendChild(wrap);
            return wrap;
        };

        // Kind dropdown
        const kindSel = document.createElement("select");
        for (const k of ["credit-card", "student-loan", "other"]) {
            const opt = document.createElement("option");
            opt.value = k;
            opt.textContent = k;
            kindSel.appendChild(opt);
        }
        kindSel.value = initial.kind || "credit-card";
        mkField("Kind", kindSel);

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = initial.name || "";
        mkField("Name", nameInput, "required");

        const balInput = document.createElement("input");
        balInput.type = "number";
        balInput.step = "0.01";
        balInput.min = "0";
        balInput.value = String(initial.current_balance ?? 0);
        mkField("Balance", balInput, "required");

        const limitWrap = document.createElement("div");
        const limitInput = document.createElement("input");
        limitInput.type = "number";
        limitInput.step = "0.01";
        limitInput.min = "0";
        limitInput.value = String(initial.credit_limit ?? 0);
        const limitFieldWrap = mkField("Credit Limit", limitInput, "cc only");
        limitFieldWrap.style.display = kindSel.value === "credit-card" ? "" : "none";

        kindSel.addEventListener("change", () => {
            limitFieldWrap.style.display = kindSel.value === "credit-card" ? "" : "none";
        });

        const aprInput = document.createElement("input");
        aprInput.type = "number";
        aprInput.step = "0.01";
        aprInput.min = "0";
        aprInput.value = String(initial.apr ?? 0);
        mkField("APR (%)", aprInput, "required");

        const minInput = document.createElement("input");
        minInput.type = "number";
        minInput.step = "0.01";
        minInput.min = "0";
        minInput.value = String(initial.min_payment ?? 0);
        mkField("Min Payment", minInput);

        const plannedInput = document.createElement("input");
        plannedInput.type = "number";
        plannedInput.step = "0.01";
        plannedInput.min = "0";
        plannedInput.value = String(initial.planned_monthly_payment ?? 0);
        mkField("Planned/mo", plannedInput);

        const urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.value = initial.url || "";
        urlInput.placeholder = "(optional)";
        mkField("URL", urlInput);

        const openedInput = document.createElement("input");
        openedInput.type = "text";
        openedInput.placeholder = "YYYY-MM-DD (optional)";
        openedInput.value = initial.opened_date || "";
        mkField("Opened Date", openedInput);

        const status = document.createElement("div");
        status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 10px;";
        dialog.appendChild(status);

        const validate = () => {
            if (!nameInput.value.trim()) return "Name is required.";
            const b = Number(balInput.value);
            if (Number.isNaN(b) || b < 0) return "Balance must be >= 0.";
            const a = Number(aprInput.value);
            if (Number.isNaN(a) || a < 0) return "APR must be >= 0.";
            return null;
        };

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
        cancelBtn.onclick = () => document.body.removeChild(overlay);

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Save";
        saveBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
        saveBtn.onclick = async () => {
            const err = validate();
            if (err) { status.textContent = err; return; }

            const entry = {
                kind: kindSel.value,
                name: nameInput.value.trim(),
                current_balance: Number(balInput.value),
                apr: Number(aprInput.value),
                min_payment: Number(minInput.value),
                planned_monthly_payment: Number(plannedInput.value),
                url: urlInput.value.trim() || undefined,
                opened_date: openedInput.value.trim() || undefined,
            };
            if (kindSel.value === "credit-card") {
                entry.credit_limit = Number(limitInput.value);
            }
            // Remove undefined fields
            Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

            const outcome = await this._mutateDebts(file, dv, (fm) => {
                const list = (fm.debts || []).slice();
                if (isNew) {
                    list.push(entry);
                } else {
                    list[idx] = entry;
                }
                fm.debts = list;
            });
            if (!outcome.ok) { try { saveBtn.focus(); } catch (_e) {} return; }
            document.body.removeChild(overlay);
        };

        const onKey = (e) => {
            if (e.key === "Escape") cancelBtn.click();
        };
        [nameInput, balInput, aprInput, minInput, plannedInput, urlInput, openedInput].forEach(el => {
            el.addEventListener("keydown", onKey);
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
        document.body.appendChild(overlay);
        setTimeout(() => nameInput.focus(), 0);
    }

    async _rerender(dv, authoritative) {
        try { customJS.RenderSafe?.captureScroll?.(); } catch (_e) {}
        if (!this._renderOverrides) this._renderOverrides = new WeakMap();
        this._renderOverrides.set(dv, authoritative);
        try { return await this.render(dv); }
        finally { this._renderOverrides.delete(dv); }
    }

    async _mutateDebts(file, dv, mutator) {
        const current = customJS.FinanceFrontmatter.read?.(file) || this._page(dv) || {};
        const preview = Object.assign({}, current, {
            debts: Array.isArray(current.debts) ? current.debts.slice() : [],
        });
        mutator(preview);
        const next = preview.debts.slice();
        return await customJS.FinanceFrontmatter.mutateRendered(file, {
            dv,
            selector: ":scope > .dde-root",
            failureMessage: "Could not update debt defaults",
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
