class TripNavButtons {
    _sanitizeFilename(name) {
        return String(name).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    }

    async _promptForTripDetails() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Trip";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const nameInput = this._addTextField(dialog, "Trip name");

            const slugDisplay = document.createElement("div");
            slugDisplay.style.cssText = "font-size: 0.78em; color: var(--text-muted); margin-bottom: 6px;";
            slugDisplay.textContent = "Slug:";
            dialog.appendChild(slugDisplay);

            const startDateInput = this._addDateField(dialog, "Start date");
            const endDateInput = this._addDateField(dialog, "End date");
            const locationInput = this._addTextField(dialog, "Location");

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const slugify = (n) => n.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

            const refresh = () => {
                const name = nameInput.value.trim();
                const slug = slugify(name);
                slugDisplay.textContent = slug ? `Slug: spice/trips/${slug}/` : "Slug:";
                if (!name) { status.textContent = ""; return; }
                const existing = app.vault.getAbstractFileByPath(`spice/trips/${slug}`);
                if (existing) {
                    status.textContent = `"${slug}" already exists. Try a different name.`;
                    status.style.color = "var(--text-error)";
                } else {
                    status.textContent = "";
                }
            };
            nameInput.addEventListener("input", refresh);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Create";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const name = nameInput.value.trim();
                if (!name) return;
                const slug = slugify(name);
                if (!slug) { status.textContent = "Name must contain alphanumerics."; status.style.color = "var(--text-error)"; return; }
                if (app.vault.getAbstractFileByPath(`spice/trips/${slug}`)) { refresh(); nameInput.focus(); return; }
                document.body.removeChild(overlay);
                resolve({
                    name,
                    slug,
                    start_date: startDateInput.value || "",
                    end_date: endDateInput.value || "",
                    location: locationInput.value.trim() || "",
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            nameInput.addEventListener("keydown", onKey);
            startDateInput.addEventListener("keydown", onKey);
            endDateInput.addEventListener("keydown", onKey);
            locationInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => nameInput.focus(), 0);
        });
    }

    _addTextField(dialog, placeholder) {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = placeholder;
        input.style.cssText = "width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; margin-bottom: 6px; box-sizing: border-box;";
        dialog.appendChild(input);
        return input;
    }

    _addDateField(dialog, label) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;";
        const lab = document.createElement("label");
        lab.textContent = label;
        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 90px;";
        wrap.appendChild(lab);
        const input = document.createElement("input");
        input.type = "date";
        input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
        wrap.appendChild(input);
        dialog.appendChild(wrap);
        return input;
    }

    async _promptForSectionTitle(tripDir) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Section";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const input = this._addTextField(dialog, "Section title (e.g. Honorees)");

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const checkCollision = () => {
                const title = input.value.trim();
                if (!title) { status.textContent = ""; return; }
                if (app.vault.getAbstractFileByPath(`${tripDir}/${title}.md`)) {
                    status.textContent = `"${title}" already exists in this trip.`;
                    status.style.color = "var(--text-error)";
                } else {
                    status.textContent = "";
                }
            };
            input.addEventListener("input", checkCollision);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Create";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const title = input.value.trim();
                if (!title) return;
                if (app.vault.getAbstractFileByPath(`${tripDir}/${title}.md`)) { checkCollision(); input.focus(); return; }
                document.body.removeChild(overlay);
                resolve(title);
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

    // Build the body for a new custom trip-section note. Pure — no DOM. The body
    // carries ONLY a single TripsChromeBar block (the canonical trips chrome);
    // no legacy Breadcrumb / SpaceNavButtons / TripNavButtons blocks.
    _sectionBody(title, tripName, tripSlug, isoTz) {
        return `---
type: trip-section
section_kind: custom
section: "${title}"
trip: "[[${this._sanitizeFilename(tripName)}]]"
trip_slug: ${tripSlug}
created_at: "${isoTz}"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripsChromeBar" });
\`\`\`
`;
    }

    async _createTripSection(tripDir, title, tripName, tripSlug) {
        const targetPath = `${tripDir}/${this._sanitizeFilename(tripName)} — ${this._sanitizeFilename(title)}.md`;
        if (app.vault.getAbstractFileByPath(targetPath)) return targetPath;

        const isoTz = this._isoWithTz(new Date());
        const body = this._sectionBody(title, tripName, tripSlug, isoTz);

        await app.vault.create(targetPath, body);
        return targetPath;
    }

    async _createTrip({ name, slug, start_date, end_date, location }) {
        const tripDir = `spice/trips/${slug}`;
        const boardDir = `${tripDir}/board`;
        for (const dir of [tripDir, boardDir]) {
            if (!app.vault.getAbstractFileByPath(dir)) {
                await app.vault.createFolder(dir);
            }
        }

        const tplBase = "ranch/templates";
        const isoTz = this._isoWithTz(new Date());
        const atlasBase = this._sanitizeFilename(name);

        // The atlas keeps the raw display `name` for {{NAME}} (its own frontmatter
        // title). Section templates use {{NAME}} only inside `trip: "[[{{NAME}}]]"`,
        // which must resolve to the atlas BASENAME (= sanitize(name)) so the link
        // targets the actual atlas note.
        // Function replacers — token values (name / location) are user free-form
        // text; a string replacement would interpret `$&`/`$$` etc. inside them and
        // corrupt trip names like "Cash $$ Run".
        const makeSubs = (nameVal) => (s) => s
            .replaceAll("{{NAME}}", () => nameVal)
            .replaceAll("{{SLUG}}", () => slug)
            .replaceAll("{{DATE}}", () => isoTz)
            .replaceAll("{{START_DATE}}", () => start_date)
            .replaceAll("{{END_DATE}}", () => end_date)
            .replaceAll("{{LOCATION}}", () => location);
        const subsAtlas = makeSubs(name);
        const subsSection = makeSubs(atlasBase);

        const writeTpl = async (tplName, destBasename, subs) => {
            const tplFile = app.vault.getAbstractFileByPath(`${tplBase}/${tplName}`);
            if (!tplFile) {
                new Notice(`Template missing: ${tplBase}/${tplName}`);
                return null;
            }
            const tpl = await app.vault.read(tplFile);
            const targetPath = `${tripDir}/${destBasename}`;
            if (app.vault.getAbstractFileByPath(targetPath)) return targetPath;
            await app.vault.create(targetPath, subs(tpl));
            return targetPath;
        };

        const atlasPath = await writeTpl("Template, Trip Atlas.md", `${atlasBase}.md`, subsAtlas);
        for (const s of customJS.TripSectionKinds.all()) {
            await writeTpl(`Template, Trip ${s.label}.md`, `${atlasBase} — ${s.label}.md`, subsSection);
        }
        await writeTpl("Template, Trip Board.md", `board/${slug}-board.md`, subsAtlas);

        return atlasPath;
    }

    // v0.58.0 FA-6: canonical created_at format — ISO-8601 with TZ offset.
    // Matches _canonical-vocab.json's required regex
    //   ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$
    _isoWithTz(d) {
        const pad = (n) => String(n).padStart(2, "0");
        const off = -d.getTimezoneOffset();
        const sign = off >= 0 ? "+" : "-";
        const oa = Math.abs(off);
        const oh = pad(Math.floor(oa / 60));
        const om = pad(oa % 60);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
    }
}
