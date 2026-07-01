/**
 * BudgetAllocationsEditor — editable live/override Debt + Savings sections on
 * Budget atlas pages (finance "month reality", WS2).
 *
 * Renders a compact full-picture line (Income → Fixed → Debt → Savings →
 * Discretionary) atop an editable Debt section and Savings section. Each row is
 * live-derived from FinanceMath.budgetAllocations (plan allocation + savings
 * contribution) with per-row overrides pinned into the budget's
 * debt_allocations[] / savings_allocations[] frontmatter arrays. The debt/savings
 * planned numbers are a VIEW — they never enter the discretionary envelope.
 *
 * Editor mechanics mirror the fixed paycheck-expenses-editor.js:
 *   • render-from-authoritative — an edit/reset flow captures the freshly
 *     recomputed budgetAllocations view and re-renders from it, never re-reading
 *     Dataview's lagging dv.current() metadata cache.
 *   • merge-on-edit — writing an override entry merges into the existing entry
 *     (by slug / name) instead of clobbering any other fields it may carry.
 *
 * All writes via customJS.FinanceFrontmatter.update (atomic processFrontMatter).
 * Never writes on plain render — only on a user edit / reset. Embed-deduped.
 */
class BudgetAllocationsEditor {
    async render(dv, override) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bae-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.type !== "budget") return;

        const monthKey = this._resolveMonthKey(page);
        if (!monthKey) return;

        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        // Render-from-authoritative: an edit/reset flow recomputes the allocation
        // view and passes it here; prefer it over a re-read of the lagging
        // dv.current() metadata cache (kills the stuck-row / stale-value symptom).
        const view = (override && Array.isArray(override.debt))
            ? override
            : customJS.FinanceMath.budgetAllocations(dv, monthKey);

        const root = dv.container.createEl("div", { cls: "bae-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px 18px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);";

        this._renderFullPicture(root, view);
        this._renderSection(root, dv, file, view, "debt");
        this._renderSection(root, dv, file, view, "savings");
    }

    // ----------------------------------------------------------------- helpers

    _resolveMonthKey(page) {
        if (typeof page.month === "string" && /^\d{4}-\d{2}$/.test(page.month)) return page.month;
        const name = page.file && page.file.name;
        if (typeof name === "string") {
            const m = name.match(/(\d{4}-\d{2})/);
            if (m) return m[1];
        }
        return null;
    }

    _monthKeyFor(dv) {
        const page = dv.current();
        return page ? this._resolveMonthKey(page) : null;
    }

    _fmt(n) {
        return customJS.FinanceMath.fmtMoney(typeof n === "number" ? n : (Number(n) || 0));
    }

    // ----- Full-picture line -----

    _renderFullPicture(root, view) {
        const t = (view && view.totals) || {};
        const line = root.createEl("div", { cls: "bae-fullpicture" });
        line.textContent = `Income ${this._fmt(t.income)} → Fixed ${this._fmt(t.fixed)} · Debt ${this._fmt(t.debt)} · Savings ${this._fmt(t.savings)} · Discretionary ${this._fmt(t.discretionary)}`;
        line.style.cssText = "font-size: 0.9em; font-variant-numeric: tabular-nums; color: var(--text-normal); padding-bottom: 12px; margin-bottom: 4px; border-bottom: 1px solid var(--background-modifier-border);";
    }

    // ----- Debt / Savings section (grouped rows + per-group total) -----

    _renderSection(root, dv, file, view, kind) {
        const rows = (kind === "debt")
            ? (Array.isArray(view.debt) ? view.debt : [])
            : (Array.isArray(view.savings) ? view.savings : []);
        const label = (kind === "debt") ? "Debt" : "Savings";
        const total = (view && view.totals && typeof view.totals[kind] === "number")
            ? view.totals[kind]
            : rows.reduce((s, r) => s + (Number(r && r.planned) || 0), 0);

        const section = root.createEl("div", { cls: `bae-section bae-section-${kind}` });
        section.style.cssText = "padding-top: 12px;";

        const head = section.createEl("div");
        head.textContent = label;
        head.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 600; text-transform: uppercase; margin-bottom: 6px;";

        const rowsWrap = section.createEl("div");
        if (rows.length === 0) {
            const empty = rowsWrap.createEl("div");
            empty.textContent = (kind === "debt") ? "No debts with a balance." : "No savings target.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 6px 0;";
        } else {
            rows.forEach((r) => this._renderRow(rowsWrap, dv, file, kind, r));
        }

        const totalEl = section.createEl("div");
        totalEl.textContent = `${label} total ${this._fmt(total)}`;
        totalEl.style.cssText = "font-size: 0.82em; font-variant-numeric: tabular-nums; color: var(--text-normal); margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--background-modifier-border);";
    }

    _renderRow(parent, dv, file, kind, r) {
        const isOverride = r && r.source === "override";

        const row = parent.createEl("div");
        row.style.cssText = "display: flex; gap: 8px; align-items: center; padding: 6px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border);";

        const nameEl = row.createEl("span");
        nameEl.textContent = (r && (r.name || r.slug)) || "(unnamed)";
        nameEl.style.cssText = "flex: 2; min-width: 0; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

        const amtEl = row.createEl("span");
        amtEl.textContent = this._fmt(r && r.planned);
        amtEl.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums;";

        const tagEl = row.createEl("span");
        if (isOverride) {
            tagEl.textContent = "(adjusted)";
            tagEl.style.cssText = "flex: 0 0 auto; font-size: 0.72em; font-weight: 600; color: var(--text-accent);";
        } else {
            tagEl.textContent = "(plan)";
            tagEl.style.cssText = "flex: 0 0 auto; font-size: 0.72em; color: var(--text-muted);";
        }

        const reset = row.createEl("button");
        reset.textContent = "Reset to plan";
        reset.style.cssText = "flex: 0 0 auto; font-size: 0.72em; cursor: pointer; padding: 2px 6px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text-muted);";
        reset.disabled = !isOverride;
        reset.style.opacity = isOverride ? "1" : "0.4";
        reset.onclick = (e) => {
            if (e && typeof e.stopPropagation === "function") e.stopPropagation();
            if (isOverride) this._resetFlow(file, dv, kind, r);
        };

        row.onclick = () => this._editFlow(file, dv, kind, r);
    }

    // ----- Edit / reset flows (write override, then render-from-authoritative) -----

    async _editFlow(file, dv, kind, row) {
        const amount = await this._promptForAmount((row && (row.name || row.slug)) || "", row && row.planned);
        if (amount == null) return;
        await this._mutate(file, (fm) => this._upsertOverride(fm, kind, row, amount));
        const fresh = customJS.FinanceMath.budgetAllocations(dv, this._monthKeyFor(dv));
        await this.render(dv, fresh);
    }

    async _resetFlow(file, dv, kind, row) {
        await this._mutate(file, (fm) => this._removeOverride(fm, kind, row));
        const fresh = customJS.FinanceMath.budgetAllocations(dv, this._monthKeyFor(dv));
        await this.render(dv, fresh);
    }

    // Merge-on-edit: keep any other fields on an existing override entry; only
    // (re)set { <idKey>, planned }. Debt keyed by slug, savings keyed by name.
    _upsertOverride(fm, kind, row, amount) {
        const arrKey = (kind === "debt") ? "debt_allocations" : "savings_allocations";
        const idKey = (kind === "debt") ? "slug" : "name";
        const idVal = (kind === "debt") ? (row.slug || row.name) : (row.name || row.slug);
        const list = Array.isArray(fm[arrKey]) ? fm[arrKey].slice() : [];
        const idx = list.findIndex((o) => o && String(o[idKey] != null ? o[idKey] : (o.slug || o.name)) === String(idVal));
        if (idx >= 0) {
            list[idx] = Object.assign({}, list[idx], { [idKey]: idVal, planned: amount });
        } else {
            list.push({ [idKey]: idVal, planned: amount });
        }
        fm[arrKey] = list;
    }

    _removeOverride(fm, kind, row) {
        const arrKey = (kind === "debt") ? "debt_allocations" : "savings_allocations";
        const idKey = (kind === "debt") ? "slug" : "name";
        const idVal = (kind === "debt") ? (row.slug || row.name) : (row.name || row.slug);
        const list = Array.isArray(fm[arrKey]) ? fm[arrKey].slice() : [];
        fm[arrKey] = list.filter((o) => String(o && (o[idKey] != null ? o[idKey] : (o.slug || o.name))) !== String(idVal));
    }

    async _mutate(file, mutator) {
        return await customJS.FinanceFrontmatter.update(file, mutator);
    }

    // Minimal single-number modal. Returns the new planned amount (>= 0) or null
    // on cancel. Overridden in the harness.
    _promptForAmount(labelText, current) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 300px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = `Planned for ${labelText || "row"}`;
            heading.style.cssText = "font-size: 1.05em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 12px;";
            const lab = document.createElement("label");
            lab.textContent = "Amount";
            lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
            wrap.appendChild(lab);
            const input = document.createElement("input");
            input.type = "number";
            input.step = "0.01";
            input.min = "0";
            input.value = String(typeof current === "number" ? current : (Number(current) || 0));
            input.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
            wrap.appendChild(input);
            dialog.appendChild(wrap);

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

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
                const v = Number(input.value);
                if (Number.isNaN(v) || v < 0) { status.textContent = "Amount must be >= 0."; return; }
                document.body.removeChild(overlay);
                resolve(v);
            };

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => input.focus(), 0);
        });
    }
}
