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
 * Options source (prompts[].options_source):
 *   "all_projects"  — resolved at prompt-render-time to ["(none)", ...all
 *                     type:project notes by name]; selecting a project
 *                     post-processes to "[[name]]", selecting "(none)"
 *                     post-processes to "". (entity-create@0.5.0)
 *
 * render() / create() options:
 *   presetPrompts: { <key>: <value> }  — short-circuit the prompt loop for
 *                     matching keys (bypasses derive + UI + validation).
 *                     Presets are trusted — calling helper code is
 *                     responsible for pre-formatting (e.g. wikilink wrap
 *                     for project picks). (entity-create@0.5.0)
 *
 * Helpers are deterministic + side-effect-free except:
 *   _ensureFolder (vault.createFolder)
 *   create()      (vault.create, workspace.openLinkText)
 */
class EntityCreate {
    async render(dv, opts) {
        if (dv.container.closest(".markdown-embed")) return;
        const { instance, presetPrompts = {} } = opts || {};
        const spec = await this._loadSpec(instance);
        if (!spec) { dv.paragraph(`EntityCreate: no spec for "${instance}"`); return; }

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        const resolved = spec.icon ? customJS.Icons.resolve(spec.icon) : null;
        customJS.AccentButton.render(dv.container, {
            label: spec.label,
            icon: resolved || plusIcon,
            onClick: () => this.create({ instance, dv, presetPrompts })
        });
    }

    async create({ instance, dv, presetPrompts = {} }) {
        const spec = await this._loadSpec(instance);
        if (!spec) return;
        const ctx = {
            now: window.moment(),
            current_file: dv ? dv.current() : null,
            prompts: {},
            spec
        };
        for (const p of spec.prompts || []) {
            // v0.5.0: presetPrompts short-circuit. Trusted values from the
            // calling helper (e.g. + New Knowledge button passing section="knowledge")
            // bypass derive + UI + validation entirely. _loadSpec() re-reads the
            // registry JSON on every invocation, so per-call options_source
            // mutation below is safe.
            if (Object.prototype.hasOwnProperty.call(presetPrompts, p.key)) {
                ctx.prompts[p.key] = presetPrompts[p.key];
                continue;
            }
            if (p.derive) {
                ctx.prompts[p.key] = this._evalDerive(p.derive, ctx);
                continue;
            }
            // v0.5.0: options_source resolution (currently "all_projects").
            // Mutates p.options in place; safe because _loadSpec re-reads JSON
            // per invocation.
            if (p.options_source) {
                p.options = this._resolveOptionsSource(p.options_source, dv);
                // v0.6.0 (Issue 4): skip-prompt-when-empty. When the resolved
                // options list is empty AND the prompt is optional, skip the
                // UI entirely and set the value to "". Without this, the user
                // would see an empty <select> dropdown — bad UX. Required
                // prompts still show (with empty list) so the user is forced
                // to either cancel or see why no options exist.
                if (Array.isArray(p.options) && p.options.length === 0 && p.required === false) {
                    ctx.prompts[p.key] = "";
                    continue;
                }
            }
            const v = await this._prompt(p, ctx);
            if (v === null) return; // user cancelled
            // v0.5.0: post-process options_source picks. "(none)"/empty → "";
            // anything else → wikilink form "[[name]]". Preset values bypass
            // this branch entirely (handled by short-circuit above).
            // all_projects-specific post-process: (none) → ""; otherwise wrap as
            // "[[name]]" wikilink. Future options_source values must either extend
            // this branch or refactor into a sibling _postProcessOptionsSource(source, v).
            if (p.options_source === "all_projects") {
                ctx.prompts[p.key] = (v === "(none)" || v === "") ? "" : `[[${v}]]`;
                continue;
            }
            // v0.6.0 (Issue 4): current_project_sections + current_section_sub_sections
            // return plain string labels, not wikilink form. The destination
            // folder template + frontmatter_template consume {{prompts.section}}
            // / {{prompts.sub_section}} as bare strings (filepath segments +
            // YAML scalars), so no wrap is desired.
            if (p.options_source === "current_project_sections"
                || p.options_source === "current_section_sub_sections") {
                ctx.prompts[p.key] = v;
                continue;
            }
            ctx.prompts[p.key] = v;
        }
        const targetPath = this._substitute(this._joinDestination(spec.destination), ctx);
        const folder = this._substitute(this._destFolder(spec.destination), ctx);
        await this._ensureFolder(folder);
        // v0.6.0 (Issue 1): open the just-created TFile directly via
        // workspace.getLeaf().openFile() rather than openLinkText(path, "").
        // openLinkText routes through the link resolver, which can race against
        // metadata-cache lag immediately after vault.create() and end up
        // creating a NEW empty `<name> 1.md` (auto-numbered) instead of
        // opening the file we just wrote. Using the TFile object bypasses the
        // resolver entirely.
        const existing = app.vault.getAbstractFileByPath(targetPath);
        if (existing) {
            new Notice(`${targetPath} already exists; opening.`);
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(existing);
            customJS.OpenHelpers?.forceLeafPreview?.(leaf);
            return;
        }
        // v0.107.0: seed_from_defaults — read a per-vault defaults file at
        // scaffold time and copy arrays into the new entity's frontmatter
        // template. Template wins on conflict (only injects when template's
        // value is empty/missing). Used by finance Budget + Paycheck to
        // auto-populate categories/expenses from per-vault Budget Defaults.md
        // and Paycheck Defaults.md.
        await this._resolveSeedFromDefaults(spec, ctx);
        const fm = this._renderFrontmatter(spec.frontmatter_template, ctx);
        const body = spec.body_template
            ? await this._readBody(spec.body_template, ctx)
            : (spec.inline_body ? this._substitute(spec.inline_body, ctx) : "");
        const newFile = await app.vault.create(targetPath, `---\n${fm}---\n\n${body}`);
        for (const xf of (spec.extra_files || [])) await this._createExtra(xf, ctx, folder);
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(newFile);
        customJS.OpenHelpers?.forceLeafPreview?.(leaf);
    }

    // ---------- v0.107.0: seed_from_defaults resolution ----------
    //
    // When a new_entity_buttons[] entry declares a seed_from_defaults block,
    // read the named defaults file and copy its arrays into the new entity's
    // frontmatter_template BEFORE _renderFrontmatter runs. Mutates spec in
    // place (spec is per-invocation — re-loaded fresh from the registry on
    // every create() call by _loadSpec).
    //
    // Schema (all string fields are token-substituted via this._substitute):
    //   {
    //     source_path:   "{{module_directory}}/Budget Defaults.md",
    //     source_array:  "categories",
    //     dest_array:    "categories",           // optional; defaults to source_array
    //     carry_arrays:  ["groups"],             // optional; verbatim copy of other top-level arrays
    //     per_item_set:  { actual: 0 }           // optional; merged into every copied item
    //   }
    //
    // Template wins on conflict: defaults are only injected when the
    // frontmatter_template's value for that key is empty/missing. This
    // protects authored frontmatter_template overrides.
    //
    // Defensive error handling — all failure modes surface as a non-blocking
    // Notice + return spec unchanged. Never throws; never blocks entity
    // creation. (A failed seed = empty array in the new entity, which the
    // user can still populate via the editor.)

    async _resolveSeedFromDefaults(spec, ctx) {
        const sfd = spec && spec.seed_from_defaults;
        if (!sfd || typeof sfd !== "object") return spec;
        if (!sfd.source_path || !sfd.source_array) return spec;

        const resolvedPath = this._substitute(sfd.source_path, ctx);
        const destKey = sfd.dest_array || sfd.source_array;
        const carry_arrays = Array.isArray(sfd.carry_arrays) ? sfd.carry_arrays : [];
        const per_item_set = (sfd.per_item_set && typeof sfd.per_item_set === "object") ? sfd.per_item_set : {};

        const file = app.vault.getAbstractFileByPath(resolvedPath);
        if (!file || (file.children !== undefined)) {
            new Notice(`${resolvedPath} not found; creating with empty ${destKey}.`, 6000);
            return spec;
        }

        const fmCache = app.metadataCache.getFileCache(file);
        const sourceFm = fmCache && fmCache.frontmatter;
        if (!sourceFm) {
            new Notice(`${resolvedPath} has no frontmatter; creating with empty ${destKey}.`, 6000);
            return spec;
        }

        const srcArr = sourceFm[sfd.source_array];
        if (!Array.isArray(srcArr)) {
            new Notice(`${resolvedPath}: '${sfd.source_array}' is not an array; creating with empty ${destKey}.`, 6000);
            return spec;
        }

        // Deep-shallow copy of items + merge per_item_set onto each.
        // Object items get a {...item, ...per_item_set} merge (per_item_set wins
        // by design — used to force actual:0 on copied budget categories etc.).
        // Scalar items pass through unchanged.
        const copied = srcArr.map((item) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                return { ...item, ...per_item_set };
            }
            return item;
        });

        // Template-wins guard: only inject when the frontmatter_template's
        // value for the dest key is empty/missing.
        const isEmpty = (v) => v === undefined || v === null
            || (Array.isArray(v) && v.length === 0);

        if (!spec.frontmatter_template || typeof spec.frontmatter_template !== "object") {
            spec.frontmatter_template = {};
        }

        if (isEmpty(spec.frontmatter_template[destKey])) {
            spec.frontmatter_template[destKey] = copied;
        }

        // Carry arrays — same template-wins guard. Top-level arrays only;
        // shallow-copied to decouple from the defaults file.
        for (const key of carry_arrays) {
            const carrySrc = sourceFm[key];
            if (!Array.isArray(carrySrc)) continue;
            if (isEmpty(spec.frontmatter_template[key])) {
                spec.frontmatter_template[key] = carrySrc.slice();
            }
        }

        // v0.7.1 (v0.108.0): resolve_wikilinks — AFTER per_item_set merge,
        // BEFORE return. When seed_from_defaults.resolve_wikilinks is set, walk
        // copied items, resolve the named wikilink field to a target vault file,
        // read target frontmatter from metadataCache, and merge keys per merge
        // map. Fully opt-in (missing field = no-op). Per-item failure-soft:
        // unresolvable wikilinks or missing frontmatter keys leave item unchanged.
        if (sfd.resolve_wikilinks && typeof sfd.resolve_wikilinks === "object") {
            const { field, merge } = sfd.resolve_wikilinks;
            if (typeof field === "string" && merge && typeof merge === "object") {
                for (const item of copied) {
                    const linkValue = item[field];
                    if (typeof linkValue !== "string") continue;
                    const m = linkValue.match(/^\[\[(.+?)\]\]$/);
                    if (!m) continue;
                    const targetName = m[1];
                    const targetFile = this._resolveWikilinkToFile(app, targetName);
                    if (!targetFile) continue;
                    try {
                        const fm = this._readFrontmatterFromCache(app, targetFile);
                        if (!fm) continue;
                        for (const [fromKey, toKey] of Object.entries(merge)) {
                            if (fm[fromKey] !== undefined) {
                                item[toKey] = fm[fromKey];
                            }
                        }
                    } catch (_e) { /* per-item failure-soft; skip this item */ }
                }
            }
        }

        return spec;
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
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            console.error("entity-create: malformed registry JSON — " + msg);
            new Notice("entity-create: registry JSON parse error — check console", 8000);
            return null;
        }
    }

    // ---------- options_source resolution (v0.5.0) ----------
    // Resolves a prompt-level options_source string to a concrete options[]
    // array at prompt-render time. Currently supports "all_projects":
    // returns ["(none)", ...all type:project notes by file.name]. Unknown
    // sources log a warning and yield [].

    _resolveOptionsSource(source, dv) {
        if (source === "all_projects") {
            if (!dv || typeof dv.pages !== "function") return ["(none)"];
            try {
                const projects = dv.pages()
                    .where(p => p && p.type === "project")
                    .map(p => p.file.name);
                // dv.pages().map() returns a Dataview DataArray; spread into a
                // plain JS array for the <select> options loop.
                return ["(none)", ...Array.from(projects)];
            } catch (_e) {
                return ["(none)"];
            }
        }
        // v0.6.0 (Issue 4): current_project_sections — read sections[] from the
        // PROJECT note that owns the current file. Two entry shapes are
        // possible:
        //   • current_file.type === "docs-hub" / "section-hub" / "doc-note":
        //       resolve project via dv.current().project_slug and read
        //       sections[] from that project note.
        //   • current_file.type === "project":
        //       read sections[] directly from the current file.
        // Returns plain string labels (wikilink wrap stripped). Empty / missing
        // → []. The skip-empty branch in create() handles the empty case.
        if (source === "current_project_sections") {
            if (!dv || typeof dv.current !== "function" || typeof dv.pages !== "function") return [];
            try {
                const cur = dv.current();
                if (!cur) return [];
                // v0.105.0.3 — discover via FILESYSTEM (section-hub notes at depth 1
                // inside docs/), unioned with declared project.sections[]. Pre-patch
                // resolver only read sections[] frontmatter, so newly-created
                // sections didn't appear in the + New Doc picker until the project
                // note was manually updated. Filesystem is source of truth.
                const projectSlug = cur.project_slug || (cur.type === "project" ? (cur.file && cur.file.name) : null);
                if (!projectSlug) return [];
                const docsRoot = `spice/projects/${projectSlug}/docs`;
                const discovered = new Set();
                try {
                    const hubs = dv.pages(`"${docsRoot}"`)
                        .where(p => p && p.type === "section-hub" && Number(p.depth) === 1);
                    for (const h of hubs) {
                        const label = this._stripWikilink(h.section || (h.file && h.file.name) || "");
                        if (label) discovered.add(label);
                    }
                } catch (_e) {}
                // Union with declared sections[] (so user-renamed hubs still surface
                // if their folder was renamed but the frontmatter wasn't yet).
                let project = null;
                if (cur.type === "project") project = cur;
                else if (cur.project_slug) {
                    const pages = dv.pages(`"spice/projects/${cur.project_slug}"`)
                        .where(p => p && p.type === "project");
                    project = pages.length ? pages[0] : null;
                }
                if (project && Array.isArray(project.sections)) {
                    for (const v of project.sections) {
                        const label = this._stripWikilink(v);
                        if (label) discovered.add(label);
                    }
                }
                return Array.from(discovered).sort();
            } catch (_e) {
                return [];
            }
        }
        // v0.6.0 (Issue 4): current_section_sub_sections — only meaningful when
        // the current file is a depth-1 section-hub. Returns the section labels
        // of the depth-2 sub-section-hub notes living in this section's folder.
        // Depth 2 or non-section-hub current files yield []. Returns plain
        // labels (wikilink wrap stripped).
        if (source === "current_section_sub_sections") {
            if (!dv || typeof dv.current !== "function" || typeof dv.pages !== "function") return [];
            try {
                const cur = dv.current();
                if (!cur || cur.type !== "section-hub") return [];
                const depth = Number(cur.depth) || 1;
                if (depth !== 1) return [];
                const scopePath = cur.file && cur.file.folder ? cur.file.folder : null;
                if (!scopePath) return [];
                const subs = dv.pages(`"${scopePath}"`)
                    .where(p => p && p.type === "section-hub" && Number(p.depth) === 2);
                return Array.from(subs)
                    .map(p => this._stripWikilink(p.section || (p.file && p.file.name) || ""))
                    .filter(Boolean);
            } catch (_e) {
                return [];
            }
        }
        console.warn(`EntityCreate: unknown options_source "${source}"`);
        return [];
    }

    // v0.6.0 helper for options_source resolvers — strip wikilink markup or
    // Dataview Link object into a plain label string. Mirrors the _stripLink
    // helper in project blueprint helpers (project-docs-index.js / section-hub.js).
    _stripWikilink(v) {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") {
            const s = v.trim();
            const m = s.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
            return m ? m[1].trim() : s;
        }
        if (v.display) return String(v.display);
        if (v.path) return String(v.path).split("/").pop().replace(/\.md$/, "");
        return "";
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
                if (!required && (!raw || (typeof raw === "string" && raw.trim() === ""))) {
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
            // pre-resolved). Read via adapter directly — getAbstractFileByPath
            // gates on Obsidian's vault index, which lags newly-materialized
            // files (e.g. templates added in the same install run before user
            // click). adapter.read hits the filesystem regardless of index
            // state and throws on truly-missing files (caught below).
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
        // filename_pattern may itself embed a subfolder (e.g. "wiki/Wiki.md").
        // app.vault.create requires the parent dir to exist; pre-create it.
        const lastSlash = xPath.lastIndexOf("/");
        const xParent = lastSlash > 0 ? xPath.substring(0, lastSlash) : "";
        if (xParent && xParent !== xFolder) await this._ensureFolder(xParent);
        const fm = xf.frontmatter_template ? this._renderFrontmatter(xf.frontmatter_template, ctx) : "";
        const body = xf.body_template
            ? await this._readBody(xf.body_template, ctx)
            : (xf.inline_body ? this._substitute(xf.inline_body, ctx) : "");
        const content = fm
            ? `---\n${fm}---\n\n${body}`
            : body;
        await app.vault.create(xPath, content);
    }

    // ---------- v0.7.1 helpers for resolve_wikilinks ----------
    // v0.110.4: moved INSIDE the class. CustomJS plugin only accepts ONE
    // top-level construct per file; module-level `function` declarations
    // outside the class triggered ParseError on every load, which left
    // window.customJS.EntityCreate undefined across every consumer vault.

    // Resolve a wikilink name to its TFile using the metadata cache's link
    // resolver. Returns null when the name cannot be resolved.
    _resolveWikilinkToFile(app, name) {
        try {
            return app.metadataCache.getFirstLinkpathDest(name, "") || null;
        } catch (_e) {
            return null;
        }
    }

    // Read the frontmatter of a TFile from the metadata cache. Prefers the
    // cached frontmatter (fast, correct at Obsidian runtime; equivalent to
    // reading the YAML block). Returns null when no frontmatter is available.
    _readFrontmatterFromCache(app, file) {
        try {
            const cache = app.metadataCache.getFileCache(file);
            return (cache && cache.frontmatter) ? cache.frontmatter : null;
        } catch (_e) {
            return null;
        }
    }
}
