/**
 * PaycheckExpensesEditor — Add/Edit/Delete editor for the expenses[] frontmatter
 * array on Paycheck atlas pages. Hybrid UX: read-only rows + Add modal +
 * click-row-to-edit modal + per-row × delete. Fields: item + amount + category +
 * paid (boolean stored as JS true/false) + optional URL + deposit (1-based index
 * into deposits[], monthly shape only). All writes via
 * customJS.FinanceFrontmatter.update. Embed-deduped per v0.16.0 lesson.
 *
 * Two shapes:
 *   - MONTHLY (has a `deposits` array): renders a per-deposit header (date +
 *     editable amount + Assigned/Leftover) and tags each expense row with the
 *     ordinal of its deposit's day (e.g. "1st"/"15th"), clickable to move the
 *     bill between checks. On first render with `deposits: []`, deposits are
 *     materialized ONCE from Paycheck Defaults' deposit_schedule (guarded).
 *   - LEGACY per-check (no `deposits` key): flat expense list, no deposit
 *     columns, no materialize — exactly as before the monthly redesign.
 */
class PaycheckExpensesEditor {
    async render(dv, override) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pee-root");
        if (previous) previous.remove();

        const page = this._page(dv);
        if (!page || !page.file) return;
        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        // Monthly shape iff the note carries a `deposits` array. A legacy
        // per-check note (no `deposits` key at all) renders flat, as before.
        const isMonthly = Array.isArray(page.deposits);

        // First-render materialize: born with `deposits: []` → seed from the
        // Paycheck Defaults deposit_schedule ONCE, then re-render authoritative.
        // Guarded by an in-flight flag + the empty check so there is no loop.
        if (isMonthly && page.deposits.length === 0 && !this._materializing) {
            await this._materializeDeposits(file, dv, page);
            return;
        }

        // Render-from-authoritative: prefer the freshly-written array captured by
        // the mutate flow over Dataview's lagging dv.current() metadata cache.
        // Kills the stuck-row symptom AND the delete index-cascade.
        const expenses = Array.isArray(override)
            ? override
            : (Array.isArray(page.expenses) ? page.expenses : []);

        const root = dv.container.createEl("div", { cls: "pee-root" });
        root.style.cssText = "margin: 8px 0;";

        const actionRow = root.createEl("div");
        actionRow.style.cssText = "margin-bottom: 8px;";
        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        const addBtn = customJS.AccentButton.render(actionRow, {
            label: "Add Expense",
            icon: plusIcon,
            onClick: () => this._addFlow(file, dv)
        });

        // Deposits header (monthly shape only): one cell per deposit with its
        // date, an editable amount, and Assigned / Leftover subtotals.
        if (isMonthly && page.deposits.length > 0) {
            this._renderDepositsHeader(root, file, dv, page);
        }

        const header = root.createEl("div");
        header.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.78em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 8px;";
        const hItem = header.createEl("div");
        hItem.textContent = "Item";
        hItem.style.cssText = "flex: 2; min-width: 0;";
        const hAmount = header.createEl("div");
        hAmount.textContent = "Amount";
        hAmount.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hCategory = header.createEl("div");
        hCategory.textContent = "Category";
        hCategory.style.cssText = "flex: 1; min-width: 0;";
        if (isMonthly) {
            const hDep = header.createEl("div");
            hDep.textContent = "Check";
            hDep.style.cssText = "flex: 0 0 56px; text-align: center;";
        }
        const hPaid = header.createEl("div");
        hPaid.textContent = "Paid";
        hPaid.style.cssText = "flex: 0 0 48px; text-align: center;";
        const hUrl = header.createEl("div");
        hUrl.textContent = "URL";
        hUrl.style.cssText = "flex: 0 0 48px; text-align: center;";
        const hDel = header.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = root.createEl("div");
        if (expenses.length === 0) {
            const empty = rows.createEl("div");
            empty.textContent = "No expenses yet. Click + Add.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || ""));
        const isPaid = (e) => {
            if (!e) return false;
            const v = e.paid;
            if (v === true) return true;
            if (typeof v === "string" && v.toLowerCase() === "true") return true;
            return false;
        };

        // Precompute deposit ordinal labels (e.g. day 1 → "1st") for row tags.
        const depositCount = isMonthly ? page.deposits.length : 0;

        // Display order grouped by check (finance tweak #1): all deposit-1 rows
        // first, then deposit-2, etc. Array.sort is stable in Node so original
        // authoring order is preserved within a deposit. Edit/delete/move flows keep
        // operating on the ORIGINAL expenses[] index (origIndex), never the display
        // position. For a legacy note (no deposits) every row maps to deposit 1 →
        // the sort is a stable no-op and the flat order is preserved.
        const _depIdxOf = (exp) => (customJS && customJS.FinanceMath && typeof customJS.FinanceMath._depositIndex === "function")
            ? customJS.FinanceMath._depositIndex(exp, depositCount)
            : this._depositIndex(exp, depositCount);
        const ordered = expenses
            .map((exp, origIndex) => ({ exp, origIndex }))
            .sort((a, b) => _depIdxOf(a.exp) - _depIdxOf(b.exp));

        let _lastDepGroup = null;
        ordered.forEach(({ exp, origIndex }) => {
            const index = origIndex;

            // Light per-deposit group label between groups (monthly shape only): the
            // deposit's clean date. Rendered once when the deposit index changes.
            if (isMonthly) {
                const depIdx = _depIdxOf(exp);
                if (depIdx !== _lastDepGroup) {
                    _lastDepGroup = depIdx;
                    const dep = page.deposits[depIdx - 1];
                    const groupLabel = rows.createEl("div", { cls: "pee-deposit-group" });
                    groupLabel.textContent = this._depositDateString(dep) || `Check ${depIdx}`;
                    groupLabel.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 600; text-transform: uppercase; padding: 10px 0 2px;";
                }
            }

            const row = rows.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const itemCell = row.createEl("span");
            itemCell.textContent = exp?.item || "";
            itemCell.style.cssText = "flex: 2; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const amountCell = row.createEl("span");
            amountCell.textContent = fmt(exp?.amount);
            amountCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";

            const categoryCell = row.createEl("span");
            categoryCell.textContent = exp?.category || "";
            categoryCell.style.cssText = "flex: 1; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            if (exp?.debt) {
                this._resolveDebt(exp.debt).then((debt) => {
                    if (!debt) return;
                    const progressPct = (debt.kind === "credit-card" && Number(debt.credit_limit) > 0)
                        ? Math.round((1 - Number(debt.current_balance) / Number(debt.credit_limit)) * 100)
                        : null;
                    const pctText = progressPct !== null ? `${progressPct}% paid` : "debt";
                    const color = progressPct === null ? "#6b7280"
                        : progressPct < 33 ? "#dc2626"
                        : progressPct < 66 ? "#b45309"
                        : "#16a34a";
                    const chip = categoryCell.createEl("span", {
                        cls: "pee-debt-chip",
                        attr: { "data-debt": debt.name },
                        text: `${debt.name} · ${pctText}`
                    });
                    chip.style.background = color;
                    chip.style.color = "#fff";
                    chip.style.padding = "2px 6px";
                    chip.style.borderRadius = "4px";
                    chip.style.marginLeft = "8px";
                    chip.style.fontSize = "0.75em";
                    chip.style.cursor = "pointer";
                    chip.addEventListener("click", (e) => {
                        e.stopPropagation();
                        app.workspace.openLinkText(`Debt-${debt.name.replace(/\s+/g, "-")}`, "", false);
                    });
                });
            }

            // Per-row deposit tag (monthly shape): a small clickable ordinal of
            // the deposit's day (e.g. "1st"/"15th"), opening the move flow.
            if (isMonthly) {
                const depCell = row.createEl("span");
                depCell.style.cssText = "flex: 0 0 56px; text-align: center;";
                const idx = this._depositIndex(exp, depositCount);
                const dep = page.deposits[idx - 1];
                const tag = depCell.createEl("span", { cls: "pee-deposit-tag" });
                tag.textContent = this._depositTagLabel(dep, idx);
                tag.style.cssText = "display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--background-modifier-hover); color: var(--text-normal); font-size: 0.75em; cursor: pointer; font-variant-numeric: tabular-nums;";
                tag.title = "Move to another check";
                tag.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._moveFlow(file, dv, index, exp);
                });
            }

            const paidCell = row.createEl("span");
            const paid = isPaid(exp);
            paidCell.textContent = paid ? "✓" : "○";
            paidCell.style.cssText = "flex: 0 0 48px; text-align: center; font-size: 1.1em;";
            paidCell.style.color = paid ? "var(--text-success, #16a34a)" : "var(--text-muted)";

            const urlCell = row.createEl("span");
            urlCell.style.cssText = "flex: 0 0 48px; text-align: center; font-size: 0.85em;";
            if (exp?.url && typeof exp.url === "string" && exp.url.trim()) {
                const link = urlCell.createEl("a");
                link.textContent = "↗";
                link.href = exp.url;
                link.target = "_blank";
                link.style.cssText = "color: var(--text-accent); text-decoration: none;";
                link.onclick = (e) => { e.stopPropagation(); };
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
                return this._deleteFlow(file, dv, index, exp);
            };

            row.onclick = () => this._editFlow(file, dv, index, exp);
        });
    }

    // 1-based deposit index for an expense; missing/invalid → 1 (first check).
    // Mirrors FinanceMath._depositIndex so the widget is self-contained even if
    // the shared helper is unavailable.
    _depositIndex(exp, depositCount) {
        const n = Math.trunc(Number(exp && exp.deposit));
        if (!isFinite(n) || n < 1) return 1;
        if (depositCount && n > depositCount) return depositCount;
        return n;
    }

    // Ordinal label for a deposit's day-of-month: "2026-07-15" → "15th".
    // Falls back to "#<index>" when the date is unparseable. Coerces first so a
    // Dataview-parsed Luxon DateTime still yields the day (finance tweak #2).
    _depositTagLabel(deposit, index) {
        const date = this._depositDateString(deposit);
        const m = date && date.match(/^\d{4}-\d{2}-(\d{2})$/);
        if (!m) return `#${index}`;
        const day = Number(m[1]);
        if (!isFinite(day) || day < 1) return `#${index}`;
        return `${day}${this._ordinalSuffix(day)}`;
    }

    // Coerce a deposit's `date` (string, or a Dataview-parsed Luxon DateTime) to a
    // clean "YYYY-MM-DD" string. Prefers FinanceMath._coerceDateString; falls back to
    // a local coercion so the widget is self-contained if the helper is unavailable.
    _depositDateString(deposit) {
        const raw = deposit && deposit.date;
        if (raw == null) return null;
        if (customJS && customJS.FinanceMath && typeof customJS.FinanceMath._coerceDateString === "function") {
            return customJS.FinanceMath._coerceDateString(raw);
        }
        if (typeof raw === "string") return raw;
        if (typeof raw.toISODate === "function") { const s = raw.toISODate(); return typeof s === "string" ? s : null; }
        if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
        return null;
    }

    _ordinalSuffix(n) {
        const tens = n % 100;
        if (tens >= 11 && tens <= 13) return "th";
        switch (n % 10) {
            case 1: return "st";
            case 2: return "nd";
            case 3: return "rd";
            default: return "th";
        }
    }

    // Read the Paycheck Defaults deposit_schedule and materialize the month's
    // deposits ONCE. Guarded by this._materializing so the re-render (which sees
    // deposits present) never re-enters this path.
    async _materializeDeposits(file, dv, page) {
        this._materializing = true;
        let deposits = [];
        try {
            page = this._authoritativePage(file, dv, page);
            if (Array.isArray(page && page.deposits) && page.deposits.length > 0) {
                await this._rerender(dv, undefined, page);
                return;
            }
            const pd = customJS.FinanceFrontmatter.read?.("spice/finance/Paycheck Defaults.md");
            const sched = (pd && Array.isArray(pd.deposit_schedule) && pd.deposit_schedule.length)
                ? pd.deposit_schedule
                : [{ day: 1, amount: 0 }, { day: 15, amount: 0 }];
            const monthKey = this._monthKey(page);
            deposits = sched.map((s) => ({
                date: `${monthKey}-${String(Number(s && s.day) || 1).padStart(2, "0")}`,
                amount: Number(s && s.amount) || 0
            }));
            const nextPage = Object.assign({}, page, { deposits });
            await customJS.FinanceFrontmatter.mutateRendered(file, {
                dv,
                selector: ":scope > .pee-root",
                failureMessage: "Could not initialize paycheck deposits",
                render: () => this._rerender(dv, undefined, nextPage),
                write: () => this._mutate(file, (fm) => { fm.deposits = deposits; }),
            });
        } finally {
            this._materializing = false;
        }
    }

    // Resolve the "YYYY-MM" month key from the page's `month` field, falling
    // back to the filename (Paycheck-YYYY-MM).
    _monthKey(page) {
        if (page && typeof page.month === "string" && /^\d{4}-\d{2}$/.test(page.month)) {
            return page.month;
        }
        const name = page && page.file && page.file.name;
        const m = typeof name === "string" ? name.match(/Paycheck-(\d{4}-\d{2})/) : null;
        return m ? m[1] : "";
    }

    _authoritativePage(file, dv, fallback) {
        const page = fallback || this._page(dv);
        const written = customJS.FinanceFrontmatter.read?.(file);
        if (!written || typeof written !== "object") return page;
        return Object.assign({}, page || {}, written, {
            file: page && page.file ? page.file : { path: file.path, name: file.basename || file.name || "" }
        });
    }

    _renderDepositsHeader(root, file, dv, page) {
        const totals = (customJS.FinanceMath && typeof customJS.FinanceMath.depositTotals === "function")
            ? customJS.FinanceMath.depositTotals(page)
            : page.deposits.map((d) => ({ date: this._depositDateString(d), amount: Number(d && d.amount) || 0, assigned: 0, leftover: Number(d && d.amount) || 0 }));

        const wrap = root.createEl("div", { cls: "pee-deposits" });
        wrap.style.cssText = "display: flex; gap: 12px; margin-bottom: 8px; flex-wrap: wrap;";
        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || "0"));

        totals.forEach((t, i) => {
            const card = wrap.createEl("div", { cls: "pee-deposit-card" });
            card.style.cssText = "flex: 1; min-width: 140px; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px;";

            const dateLine = card.createEl("div");
            // depositTotals already coerces t.date; the raw-deposit fallback is
            // coerced too so a Luxon DateTime never renders its ISO timestamp.
            dateLine.textContent = (t && t.date) || this._depositDateString(page.deposits[i]) || "";
            dateLine.style.cssText = "font-size: 0.85em; color: var(--text-muted); margin-bottom: 4px;";

            const amountLine = card.createEl("div");
            amountLine.textContent = fmt(t && t.amount);
            amountLine.style.cssText = "font-size: 1.05em; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer;";
            amountLine.title = "Edit deposit amount";
            amountLine.addEventListener("click", () => this._editDepositAmount(file, dv, i));

            const assignedLine = card.createEl("div");
            assignedLine.textContent = `Assigned ${fmt(t && t.assigned)}`;
            assignedLine.style.cssText = "font-size: 0.78em; color: var(--text-muted); margin-top: 4px; font-variant-numeric: tabular-nums;";

            const leftoverLine = card.createEl("div");
            const leftover = t && typeof t.leftover === "number" ? t.leftover : 0;
            leftoverLine.textContent = `Leftover ${fmt(leftover)}`;
            leftoverLine.style.cssText = `font-size: 0.78em; margin-top: 2px; font-variant-numeric: tabular-nums; color: ${leftover < 0 ? "var(--text-error)" : "var(--text-muted)"};`;
        });
    }

    async _editDepositAmount(file, dv, i) {
        const raw = window.prompt("Deposit amount:");
        if (raw === null) return;
        const amount = Number(raw);
        if (!isFinite(amount) || amount < 0) return;
        const page = this._authoritativePage(file, dv) || {};
        const base = Array.isArray(page.deposits) ? page.deposits : [];
        const newDeposits = base.map((d) => Object.assign({}, d));
        if (i >= 0 && i < newDeposits.length) newDeposits[i] = Object.assign({}, newDeposits[i], { amount });
        const nextPage = Object.assign({}, page, { deposits: newDeposits });
        await customJS.FinanceFrontmatter.mutateRendered(file, {
            dv,
            selector: ":scope > .pee-root",
            failureMessage: "Could not update paycheck deposit",
            render: () => this._rerender(dv, undefined, nextPage),
            write: () => this._mutate(file, (fm) => {
                const list = Array.isArray(fm.deposits) ? fm.deposits.slice() : [];
                if (i >= 0 && i < list.length) {
                    list[i] = Object.assign({}, list[i], { amount });
                    fm.deposits = list;
                }
            }),
        });
    }

    async _resolveDebt(linkStr) {
        const m = typeof linkStr === "string" ? linkStr.match(/^\[\[(.+?)\]\]$/) : null;
        if (!m) return null;
        const name = m[1];
        const dest = app.metadataCache.getFirstLinkpathDest(name, "");
        if (!dest) return null;
        const cache = app.metadataCache.getFileCache(dest);
        return cache?.frontmatter || null;
    }

    _promptForExpense(initial) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Expense" : "Add Expense";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const mkField = (labelText, type) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                const input = document.createElement("input");
                input.type = type;
                if (type === "number") {
                    input.step = "0.01";
                    input.min = "0";
                }
                input.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                wrap.appendChild(input);
                dialog.appendChild(wrap);
                return input;
            };

            const mkCheckboxField = (labelText) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                const input = document.createElement("input");
                input.type = "checkbox";
                input.style.cssText = "flex: 0 0 auto; width: 18px; height: 18px;";
                wrap.appendChild(input);
                dialog.appendChild(wrap);
                return { wrap, input };
            };

            const itemInput = mkField("Item", "text");
            const amountInput = mkField("Amount", "number");
            // v0.107.0: Category field grows a <datalist> autocomplete from
            // spice/finance/Budget Defaults.md's categories[].name list. Free
            // text still accepted (suggestions only). Falls back gracefully if
            // Budget Defaults is missing or has no categories.
            const categoryInput = mkField("Category", "text");
            const _budgetDefaults = app.vault.getAbstractFileByPath("spice/finance/Budget Defaults.md");
            if (_budgetDefaults) {
                const _bdFm = app.metadataCache.getFileCache(_budgetDefaults)?.frontmatter;
                if (_bdFm && Array.isArray(_bdFm.categories) && _bdFm.categories.length > 0) {
                    const _dlId = `pee-categories-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
                    categoryInput.setAttribute("list", _dlId);
                    const _datalist = document.createElement("datalist");
                    _datalist.id = _dlId;
                    const _seen = new Set();
                    for (const _c of _bdFm.categories) {
                        if (_c && typeof _c === "object" && _c.name && !_seen.has(_c.name)) {
                            _seen.add(_c.name);
                            const _opt = document.createElement("option");
                            _opt.value = String(_c.name);
                            _datalist.appendChild(_opt);
                        }
                    }
                    dialog.appendChild(_datalist);
                }
            }
            const paidField = mkCheckboxField("Paid");
            const paidInput = paidField.input;
            const urlInput = mkField("URL", "text");

            if (initial) {
                itemInput.value = initial.item || "";
                amountInput.value = String(initial.amount ?? 0);
                categoryInput.value = initial.category || "";
                paidInput.checked = (initial.paid === true || (typeof initial.paid === "string" && initial.paid.toLowerCase() === "true"));
                urlInput.value = initial.url || "";
                if (initial.debt) {
                    amountInput.setAttribute("readonly", "readonly");
                    amountInput.title = "From debt entity — edit there via DebtConfigEditor";
                    amountInput.style.opacity = "0.6";
                    urlInput.setAttribute("readonly", "readonly");
                    urlInput.title = "From debt entity — edit there via DebtConfigEditor";
                    urlInput.style.opacity = "0.6";
                }
            } else {
                amountInput.value = "0";
                paidInput.checked = false;
            }

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!itemInput.value.trim()) return "Item required.";
                const a = amountInput.value;
                if (Number.isNaN(Number(a)) || Number(a) < 0) return "Amount must be >= 0.";
                if (urlInput.value && !/^https?:\/\//.test(urlInput.value)) return "URL must start with http:// or https:// (or leave empty).";
                return null;
            };

            const refreshStatus = () => {
                const err = validate();
                status.textContent = err || "";
            };
            itemInput.addEventListener("input", refreshStatus);
            amountInput.addEventListener("input", refreshStatus);
            categoryInput.addEventListener("input", refreshStatus);
            urlInput.addEventListener("input", refreshStatus);

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
                    item: itemInput.value.trim(),
                    amount: Number(amountInput.value),
                    category: categoryInput.value.trim(),
                    paid: paidInput.checked,
                    url: urlInput.value.trim(),
                    // Preserve an existing deposit tag; default new rows to check 1.
                    deposit: (initial && Number.isFinite(Number(initial.deposit)) && Number(initial.deposit) >= 1)
                        ? Math.trunc(Number(initial.deposit))
                        : 1
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            itemInput.addEventListener("keydown", onKey);
            amountInput.addEventListener("keydown", onKey);
            categoryInput.addEventListener("keydown", onKey);
            urlInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => itemInput.focus(), 0);
        });
    }

    // Minimal deposit picker: list the month's deposits (ordinal + date +
    // amount) and resolve the chosen 1-based index (null on cancel).
    _promptForDeposit(deposits, currentIndex) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 280px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "Move to check";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || "0"));
            (deposits || []).forEach((d, i) => {
                const oneBased = i + 1;
                const btn = document.createElement("button");
                const label = this._depositTagLabel(d, oneBased);
                btn.textContent = `${label} — ${this._depositDateString(d) || ""} — ${fmt(Number(d && d.amount) || 0)}`;
                btn.style.cssText = `display: block; width: 100%; text-align: left; margin-bottom: 6px; padding: 8px 10px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: ${oneBased === currentIndex ? "var(--background-modifier-hover)" : "var(--background-secondary)"}; color: var(--text-normal);`;
                btn.onclick = () => { document.body.removeChild(overlay); resolve(oneBased); };
                dialog.appendChild(btn);
            });

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "margin-top: 6px; padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };
            dialog.appendChild(cancelBtn);

            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
        });
    }

    async _addFlow(file, dv) {
        const result = await this._promptForExpense(null);
        if (!result) return;
        await this._mutateExpenses(file, dv, (fm) => {
            fm.expenses = (fm.expenses || []).concat([result]);
        });
    }

    async _editFlow(file, dv, index, current) {
        const result = await this._promptForExpense(current);
        if (!result) return;
        await this._mutateExpenses(file, dv, (fm) => {
            const list = (fm.expenses || []).slice();
            // Merge-on-edit: keep non-dialog fields (e.g. debt links) that the
            // modal doesn't surface, instead of replacing the whole row object.
            // The dialog's resolve preserves `deposit`, so the merge keeps it too.
            list[index] = Object.assign({}, current, result);
            fm.expenses = list;
        });
    }

    // Move an expense between deposits (checks). Picker returns the chosen
    // 1-based deposit index; merge-write the `deposit` field, then render from
    // the authoritative array (dv.current() lags).
    async _moveFlow(file, dv, index, exp) {
        const page = this._authoritativePage(file, dv);
        const deposits = (page && Array.isArray(page.deposits)) ? page.deposits : [];
        const currentIndex = this._depositIndex(exp, deposits.length);
        const chosen = await this._promptForDeposit(deposits, currentIndex);
        if (chosen === null || chosen === undefined) return;
        await this._mutateExpenses(file, dv, (fm) => {
            const list = (fm.expenses || []).slice();
            const cur = list[index] || exp;
            list[index] = Object.assign({}, cur, { deposit: chosen });
            fm.expenses = list;
        });
    }

    async _deleteFlow(file, dv, index, current) {
        if (!window.confirm(`Delete expense '${current?.item || ""}'?`)) return;
        await this._mutateExpenses(file, dv, (fm) => {
            const list = (fm.expenses || []).slice();
            list.splice(index, 1);
            fm.expenses = list;
        });
    }

    async _mutateExpenses(file, dv, mutator) {
        const current = customJS.FinanceFrontmatter.read?.(file) || this._page(dv) || {};
        const preview = Object.assign({}, current, {
            expenses: Array.isArray(current.expenses) ? current.expenses.slice() : [],
        });
        mutator(preview);
        const next = preview.expenses.slice();
        return await customJS.FinanceFrontmatter.mutateRendered(file, {
            dv,
            selector: ":scope > .pee-root",
            failureMessage: "Could not update paycheck expense",
            render: () => this._rerender(dv, next),
            write: () => this._mutate(file, mutator),
        });
    }

    async _mutate(file, mutator) {
        return await customJS.FinanceFrontmatter.update(file, mutator);
    }

    async _rerender(dv, authoritative, pageOverride) {
        try { customJS.RenderSafe?.captureScroll?.(); } catch (_e) {}
        if (!pageOverride) return await this.render(dv, authoritative);
        const previousCurrent = dv.current;
        dv.current = () => pageOverride;
        try { return await this.render(dv, authoritative); }
        finally { dv.current = previousCurrent; }
    }

    _page(dv) {
        try { return customJS.FinanceFrontmatter?.page?.(dv) || customJS.RenderSafe?.page?.(dv) || dv?.current?.() || null; }
        catch (_e) { return null; }
    }
}
