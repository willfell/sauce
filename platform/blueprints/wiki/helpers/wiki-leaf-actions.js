class WikiLeafActions {
    render(dv) {
        const cur = dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== "wiki-page" && cur.type !== "wiki-section") return;
        const pages = dv.pages('"spice/wiki"').array ? dv.pages('"spice/wiki"').array() : Array.from(dv.pages('"spice/wiki"'));
        const options = this._buildMoveOptions(pages, cur.file.path);
        customJS.AccentButton.render(dv.container, {
            label: "Move",
            onClick: async () => {
                if (!options || options.length === 0) return;
                const labels = options.map(o => o.label);
                const chosen = await new Promise((resolve) => {
                    const overlay = document.createElement("div");
                    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;";
                    const dialog = document.createElement("div");
                    dialog.style.cssText = "background:var(--background-primary);border-radius:12px;padding:24px;min-width:320px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.3);";
                    const heading = document.createElement("div");
                    heading.textContent = "Move to section";
                    heading.style.cssText = "font-size:1.1em;font-weight:600;margin-bottom:12px;";
                    dialog.appendChild(heading);
                    const sel = document.createElement("select");
                    sel.style.cssText = "width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:1em;margin-bottom:12px;";
                    for (const opt of options) {
                        const o = document.createElement("option");
                        o.value = opt.folder; o.textContent = opt.label;
                        sel.appendChild(o);
                    }
                    dialog.appendChild(sel);
                    const btnRow = document.createElement("div");
                    btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
                    const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
                    const cancelBtn = document.createElement("button");
                    cancelBtn.textContent = "Cancel";
                    cancelBtn.onclick = () => { close(); resolve(null); };
                    const okBtn = document.createElement("button");
                    okBtn.textContent = "Move";
                    okBtn.style.cssText = "padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);";
                    okBtn.onclick = () => { close(); resolve(sel.value); };
                    btnRow.appendChild(cancelBtn);
                    btnRow.appendChild(okBtn);
                    dialog.appendChild(btnRow);
                    overlay.appendChild(dialog);
                    document.body.appendChild(overlay);
                });
                if (chosen) await customJS.WikiMove.move(dv, chosen);
            }
        });
    }

    _buildMoveOptions(pages, currentPath) {
        const currentFolder = currentPath.slice(0, currentPath.lastIndexOf("/"));
        return customJS.WikiMove.sectionTargets(pages).filter(o => o.folder !== currentFolder);
    }
}
