/**
 * EntityCreate (CustomJS) — declarative entity-creation runtime.
 *
 * Reads ranch/entity-create-registry.json (materialized by the installer
 * from each blueprint's new_entity_buttons[]); each entry's `id` keys a
 * declarative spec: prompts → frontmatter_template → destination →
 * extra_files[].
 *
 * Usage in DataviewJS:
 *   await customJS.EntityCreate.render(dv, { instance: "meeting" });
 *
 * The single mechanism replaces 7 hand-authored New<X>Button classes
 * (meetings/people/project/scratch/finance × 3). See:
 *   - Docs/plans/2026-05-14-v0.46.0-entity-create-plan.md Appendix A
 *   - Docs/plans/2026-05-14-blueprint-modularization-design.md (principles)
 *
 * Substitution catalogue:
 *   {{prompts.<key>}}                       — raw prompt value
 *   {{prompts.<key>|sanitize-filename}}     — strip /\\:*?"<>|
 *   {{prompts.<key>|number}}                — emit unquoted numeric YAML scalar
 *                                             (handled by _renderFrontmatter)
 *   {{prompts.<key>|lowercase}}             — String.toLowerCase
 *   {{now.<moment-format>}}                 — ctx.now.format(<moment-format>)
 *   {{current_file.frontmatter.<key>}}      — read frontmatter of the note
 *                                             whose dv container hosts the button
 *   {{current_file.frontmatter.<key>}}-routed — expand YYYY-MM-DD date string into
 *                                             3-level routed form YYYY/MM-MMMM/YYYY-MM-DD
 *
 * Derive DSL (prompts[].derive):
 *   slugify(prompts.<key>)            — lowercase + dasherize
 *   lowercase(prompts.<key>)          — String.toLowerCase
 *   sanitize-filename(prompts.<key>)  — strip /\\:*?"<>|
 *
 * Helpers are deterministic + side-effect-free except:
 *   _ensureFolder (vault.createFolder)
 *   create()      (vault.create, workspace.openLinkText)
 */
class EntityCreate {
    async render(dv, opts) {
        if (dv.container.closest(".markdown-embed")) return;
        const { instance } = opts || {};
        const spec = await this._loadSpec(instance);
        if (!spec) { dv.paragraph(`EntityCreate: no spec for "${instance}"`); return; }

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        customJS.AccentButton.render(dv.container, {
            label: spec.label,
            icon: spec.icon || plusIcon,
            onClick: () => this.create({ instance, dv })
        });
    }

    async create({ instance, dv }) {
        const spec = await this._loadSpec(instance);
        if (!spec) return;
        const ctx = {
            now: window.moment(),
            current_file: dv ? dv.current() : null,
            prompts: {},
            spec
        };
        for (const p of spec.prompts || []) {
            if (p.derive) {
                ctx.prompts[p.key] = this._evalDerive(p.derive, ctx);
                continue;
            }
            const v = await this._prompt(p, ctx);
            if (v === null) return; // user cancelled
            ctx.prompts[p.key] = v;
        }
        const targetPath = this._substitute(this._joinDestination(spec.destination), ctx);
        const folder = this._substitute(this._destFolder(spec.destination), ctx);
        await this._ensureFolder(folder);
        if (app.vault.getAbstractFileByPath(targetPath)) {
            new Notice(`${targetPath} already exists; opening.`);
            app.workspace.openLinkText(targetPath, "");
            return;
        }
        const fm = this._renderFrontmatter(spec.frontmatter_template, ctx);
        const body = spec.body_template
            ? await this._readBody(spec.body_template, ctx)
            : (spec.inline_body ? this._substitute(spec.inline_body, ctx) : "");
        await app.vault.create(targetPath, `---\n${fm}---\n\n${body}`);
        for (const xf of (spec.extra_files || [])) await this._createExtra(xf, ctx, folder);
        app.workspace.openLinkText(targetPath, "");
    }

    // ---------- spec lookup ----------

    async _loadSpec(instance) {
        try {
            const registryPath = "ranch/entity-create-registry.json";
            const file = app.vault.getAbstractFileByPath(registryPath);
            if (!file) return null;
            const raw = await app.vault.adapter.read(registryPath);
            const reg = JSON.parse(raw);
            const list = Array.isArray(reg) ? reg : (reg && Array.isArray(reg.entries) ? reg.entries : []);
            return list.find(e => e && e.id === instance) || null;
        } catch (_e) {
            return null;
        }
    }

    // ---------- prompt dispatch ----------

    _prompt(p, ctx) {
        switch (p.type) {
            case "string": return this._promptText(p, ctx, "text");
            case "date":   return this._promptText(p, ctx, "date");
            case "month":  return this._promptText(p, ctx, "month");
            case "number": return this._promptText(p, ctx, "number");
            case "select": return this._promptSelect(p, ctx);
            default:       return Promise.resolve(null);
        }
    }

    _promptText(p, ctx, inputType) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = (ctx.spec && ctx.spec.label) ? ctx.spec.label : (p.label || "New");
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
            const lab = document.createElement("label");
            lab.textContent = p.label || p.key;
            lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 90px;";
            wrap.appendChild(lab);

            const input = document.createElement("input");
            input.type = inputType;
            if (inputType === "number") {
                if (typeof p.min === "number") input.min = String(p.min);
                if (typeof p.max === "number") input.max = String(p.max);
                input.step = "any";
            }
            // Apply default (substituted, so {{now.YYYY-MM}} works).
            if (typeof p.default === "string" && p.default.length > 0) {
                input.value = this._substitute(p.default, ctx);
            }
            input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
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
            const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
            cancelBtn.onclick = () => { close(); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Create";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const raw = input.value;
                const required = p.required !== false;
                if (required && (!raw || (typeof raw === "string" && raw.trim() === ""))) {
                    status.textContent = `${p.label || p.key} is required.`;
                    return;
                }
                if (!required && (!raw || raw.trim() === "")) {
                    close(); resolve(""); return;
                }
                const err = this._runValidate(p, raw, ctx);
                if (err) { status.textContent = err; return; }
                close();
                resolve(raw);
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

    _promptSelect(p, ctx) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = (ctx.spec && ctx.spec.label) ? ctx.spec.label : (p.label || "Select");
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
            const lab = document.createElement("label");
            lab.textContent = p.label || p.key;
            lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 90px;";
            wrap.appendChild(lab);

            const sel = document.createElement("select");
            sel.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
            for (const opt of (p.options || [])) {
                const o = document.createElement("option");
                o.value = opt; o.textContent = opt;
                sel.appendChild(o);
            }
            if (typeof p.default === "string") {
                const def = this._substitute(p.default, ctx);
                if ((p.options || []).includes(def)) sel.value = def;
            }
            wrap.appendChild(sel);
            dialog.appendChild(wrap);

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
            cancelBtn.onclick = () => { close(); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Create";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const v = sel.value;
                const err = this._runValidate(p, v, ctx);
                if (err) { status.textContent = err; return; }
                close();
                resolve(v);
            };

            sel.addEventListener("keydown", (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => sel.focus(), 0);
        });
    }

    // ---------- validate predicates ----------
    // Supported: "safe-filename", "min:<n>", "max:<n>", "gte:<other-key>"

    _runValidate(p, raw, ctx) {
        if (!p.validate) return null;
        const exprs = String(p.validate).split(/\s*[,;]\s*/).filter(Boolean);
        for (const expr of exprs) {
            const err = this._runOneValidate(p, expr, raw, ctx);
            if (err) return err;
        }
        return null;
    }

    _runOneValidate(p, expr, raw, ctx) {
        if (expr === "safe-filename") {
            if (/[\/\\:*?"<>|]/.test(String(raw))) {
                return `${p.label || p.key} must not contain / \\ : * ? " < > |`;
            }
            return null;
        }
        const m = expr.match(/^(min|max|gte):(.+)$/);
        if (!m) return null;
        const op = m[1], rhsRaw = m[2].trim();
        const lhs = Number(raw);
        if (op === "min") {
            const n = Number(rhsRaw);
            if (Number.isNaN(lhs) || lhs < n) return `${p.label || p.key} must be ≥ ${n}.`;
            return null;
        }
        if (op === "max") {
            const n = Number(rhsRaw);
            if (Number.isNaN(lhs) || lhs > n) return `${p.label || p.key} must be ≤ ${n}.`;
            return null;
        }
        if (op === "gte") {
            // gte:<other-key> — string-comparison-safe for ISO dates; numeric for numbers.
            const other = ctx.prompts ? ctx.prompts[rhsRaw] : undefined;
            if (other === undefined || other === null || other === "") return null;
            // Numeric comparison if both parse as numbers; else lexicographic
            // (works for ISO YYYY-MM-DD + YYYY-MM).
            const lN = Number(raw), rN = Number(other);
            if (!Number.isNaN(lN) && !Number.isNaN(rN)) {
                if (lN < rN) return `${p.label || p.key} must be ≥ ${rhsRaw}.`;
                return null;
            }
            if (String(raw) < String(other)) return `${p.label || p.key} must be on or after ${rhsRaw}.`;
            return null;
        }
        return null;
    }

    // ---------- substitution ----------

    _substitute(str, ctx) {
        if (typeof str !== "string") return str;
        let out = str;

        // 1. {{now.<format>}}
        out = out.replace(/\{\{now\.([^}]+)\}\}/g, (_, fmt) => {
            try { return ctx.now ? ctx.now.format(fmt) : ""; } catch (_e) { return ""; }
        });

        // 2. {{current_file.frontmatter.<key>}}-routed (must run before plain form)
        out = out.replace(/\{\{current_file\.frontmatter\.([a-zA-Z0-9_-]+)\}\}-routed/g, (_, key) => {
            const v = this._readCurrentFrontmatter(ctx, key);
            return this._routedFromDate(v);
        });

        // 3. {{current_file.frontmatter.<key>}}
        out = out.replace(/\{\{current_file\.frontmatter\.([a-zA-Z0-9_-]+)\}\}/g, (_, key) => {
            const v = this._readCurrentFrontmatter(ctx, key);
            return v == null ? "" : String(v);
        });

        // 4. {{prompts.<key>|<pipe>}}
        out = out.replace(/\{\{prompts\.([a-zA-Z0-9_]+)\|([a-zA-Z0-9_-]+)\}\}/g, (_, key, pipe) => {
            const v = ctx.prompts ? ctx.prompts[key] : undefined;
            return this._applyPipe(v, pipe);
        });

        // 5. {{prompts.<key>}}
        out = out.replace(/\{\{prompts\.([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
            const v = ctx.prompts ? ctx.prompts[key] : undefined;
            return v == null ? "" : String(v);
        });

        return out;
    }

    _readCurrentFrontmatter(ctx, key) {
        const cf = ctx && ctx.current_file;
        if (!cf) return null;
        // Dataview's dv.current() returns the page proxy; frontmatter is exposed
        // both at top-level (e.g. cf.day) and under cf.file.frontmatter in some
        // versions. Prefer cf[key] when present; fall back to cf.file.frontmatter.
        if (Object.prototype.hasOwnProperty.call(cf, key) && typeof cf[key] !== "function") {
            return this._coerceFrontmatterValue(cf[key]);
        }
        if (cf.file && cf.file.frontmatter && Object.prototype.hasOwnProperty.call(cf.file.frontmatter, key)) {
            return this._coerceFrontmatterValue(cf.file.frontmatter[key]);
        }
        return null;
    }

    _coerceFrontmatterValue(v) {
        if (v == null) return null;
        // Dataview wraps dates into Luxon DateTime or JS Date. Normalize to YYYY-MM-DD
        // string if it looks date-shaped.
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return v;
        if (v && typeof v.toISODate === "function") {
            try { return v.toISODate(); } catch (_e) { /* fallthrough */ }
        }
        if (v instanceof Date && !isNaN(v.getTime())) {
            const m = window.moment(v);
            return m.isValid() ? m.format("YYYY-MM-DD") : String(v);
        }
        return String(v);
    }

    _routedFromDate(v) {
        if (v == null || v === "") return "";
        const s = String(v);
        const mo = window.moment(s, "YYYY-MM-DD", true);
        if (!mo.isValid()) return s;
        return `${mo.format("YYYY")}/${mo.format("MM-MMMM")}/${mo.format("YYYY-MM-DD")}`;
    }

    _applyPipe(v, pipe) {
        if (v == null) return "";
        const s = String(v);
        switch (pipe) {
            case "sanitize-filename":
                return s.replace(/[\/\\:*?"<>|]/g, "");
            case "lowercase":
                return s.toLowerCase();
            case "number":
                // Substitution returns the raw numeric string; the unquoted-scalar
                // emission happens in _renderFrontmatter when it detects the
                // |number pipe in the source template literal. For non-frontmatter
                // contexts (filename, folder), the string form is correct.
                return s;
            default:
                return s;
        }
    }

    // ---------- derive DSL ----------
    // Supported primitives: slugify | lowercase | sanitize-filename
    // Form: <fn>(prompts.<key>)

    _evalDerive(expr, ctx) {
        if (typeof expr !== "string") return "";
        const m = expr.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\(\s*prompts\.([a-zA-Z0-9_]+)\s*\)\s*$/);
        if (!m) return "";
        const fn = m[1], key = m[2];
        const src = ctx.prompts ? ctx.prompts[key] : undefined;
        if (src == null) return "";
        const s = String(src);
        switch (fn) {
            case "slugify":
                return this._slugify(s);
            case "lowercase":
                return s.toLowerCase();
            case "sanitize-filename":
                return s.replace(/[\/\\:*?"<>|]/g, "");
            default:
                return "";
        }
    }

    _slugify(s) {
        return String(s)
            .toLowerCase()
            .replace(/[\/\\:*?"<>|]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    // ---------- frontmatter emission ----------

    _renderFrontmatter(tmpl, ctx) {
        if (!tmpl || typeof tmpl !== "object" || Array.isArray(tmpl)) return "";
        const lines = [];
        for (const [key, val] of Object.entries(tmpl)) {
            this._emitKv(lines, key, val, ctx);
        }
        return lines.join("\n") + (lines.length ? "\n" : "");
    }

    _emitKv(lines, key, val, ctx) {
        if (val === null || val === undefined) {
            lines.push(`${key}: null`);
            return;
        }
        if (Array.isArray(val)) {
            if (val.length === 0) {
                lines.push(`${key}: []`);
                return;
            }
            lines.push(`${key}:`);
            for (const item of val) {
                lines.push(`  - ${this._emitScalar(item, ctx)}`);
            }
            return;
        }
        if (typeof val === "string") {
            // Detect |number pipe in the source string before substitution —
            // if present, emit as unquoted numeric scalar.
            if (this._hasNumberPipe(val)) {
                const subbed = this._substitute(val, ctx);
                const n = Number(subbed);
                if (!Number.isNaN(n) && subbed !== "" && subbed != null) {
                    lines.push(`${key}: ${n}`);
                    return;
                }
                // fallback to quoted string if not numeric
                lines.push(`${key}: ${this._yamlString(subbed)}`);
                return;
            }
            const subbed = this._substitute(val, ctx);
            lines.push(`${key}: ${this._yamlString(subbed)}`);
            return;
        }
        if (typeof val === "number" || typeof val === "boolean") {
            lines.push(`${key}: ${val}`);
            return;
        }
        if (typeof val === "object") {
            // Nested object — emit as JSON-flavored YAML (Obsidian's parser tolerates).
            // Substitute string leaves.
            lines.push(`${key}: ${this._emitInlineObject(val, ctx)}`);
            return;
        }
        lines.push(`${key}: ${this._yamlString(String(val))}`);
    }

    _hasNumberPipe(str) {
        return /\{\{prompts\.[a-zA-Z0-9_]+\|number\}\}/.test(str);
    }

    _emitScalar(item, ctx) {
        if (item === null || item === undefined) return "null";
        if (typeof item === "number" || typeof item === "boolean") return String(item);
        if (typeof item === "string") {
            if (this._hasNumberPipe(item)) {
                const subbed = this._substitute(item, ctx);
                const n = Number(subbed);
                if (!Number.isNaN(n) && subbed !== "") return String(n);
                return this._yamlString(subbed);
            }
            return this._yamlString(this._substitute(item, ctx));
        }
        if (typeof item === "object") return this._emitInlineObject(item, ctx);
        return this._yamlString(String(item));
    }

    _emitInlineObject(obj, ctx) {
        // JSON-flavored flow-style YAML; safe for Obsidian's parser.
        // Substitute string values before emission.
        const walked = JSON.parse(JSON.stringify(obj), (_k, v) => {
            if (typeof v === "string") return this._substitute(v, ctx);
            return v;
        });
        return JSON.stringify(walked);
    }

    _yamlString(s) {
        // Emit as double-quoted YAML scalar, escaping " and \ minimally.
        const escaped = String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `"${escaped}"`;
    }

    // ---------- destination composition ----------

    _joinDestination(d) {
        return `${this._destFolder(d)}/${d.filename_prefix || ""}${d.filename_date_pattern ? "{{now." + d.filename_date_pattern + "}}" : ""}${d.filename_suffix || ""}.md`;
    }

    _destFolder(d) {
        return `${d.folder_prefix || ""}${d.folder_date_pattern ? "/{{now." + d.folder_date_pattern + "}}" : ""}`;
    }

    async _ensureFolder(folder) {
        if (!folder) return;
        // Walk the path segment-by-segment so each ancestor exists.
        const parts = folder.split("/").filter(Boolean);
        let acc = "";
        for (const part of parts) {
            acc = acc ? `${acc}/${part}` : part;
            if (!app.vault.getAbstractFileByPath(acc)) {
                try { await app.vault.createFolder(acc); } catch (_e) { /* race-tolerant */ }
            }
        }
    }

    // ---------- body template loader ----------

    async _readBody(relPath, ctx) {
        try {
            const subbed = this._substitute(relPath, ctx);
            // relPath is expected to be a vault-relative path (the installer
            // substitutes ranch/templates at install time so this arrives
            // pre-resolved). Read and substitute the body content.
            const file = app.vault.getAbstractFileByPath(subbed);
            if (!file) return "";
            const raw = await app.vault.adapter.read(subbed);
            return this._substitute(raw, ctx);
        } catch (_e) {
            return "";
        }
    }

    // ---------- extra_files materialization ----------

    async _createExtra(xf, ctx, folder) {
        const sub = xf.subfolder ? this._substitute(xf.subfolder, ctx) : "";
        const xFolder = sub ? `${folder}/${sub}` : folder;
        await this._ensureFolder(xFolder);
        const filename = this._substitute(xf.filename_pattern, ctx);
        const xPath = `${xFolder}/${filename}`;
        if (app.vault.getAbstractFileByPath(xPath)) return; // skip existing
        const fm = xf.frontmatter_template ? this._renderFrontmatter(xf.frontmatter_template, ctx) : "";
        const body = xf.body_template
            ? await this._readBody(xf.body_template, ctx)
            : (xf.inline_body ? this._substitute(xf.inline_body, ctx) : "");
        const content = fm
            ? `---\n${fm}---\n\n${body}`
            : body;
        await app.vault.create(xPath, content);
    }
}
