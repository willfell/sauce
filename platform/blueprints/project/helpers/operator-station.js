/**
 * OperatorStation — read-only, phone-first rendering for the coordinator-owned
 * Loop Station projection.
 */
class OperatorStation {
  constructor(options = {}) {
    this._injectedDeliveryApi = options.deliveryApi || null;
    this._now = options.now || (() => new Date());
  }

  _app() {
    try { return typeof app !== "undefined" ? app : globalThis.app; } catch (_e) { return null; }
  }

  _frontmatter(file) {
    try { return this._app()?.metadataCache?.getFileCache(file)?.frontmatter || {}; }
    catch (_e) { return {}; }
  }

  async _contentPath(adapter) {
    try {
      const config = JSON.parse(await adapter?.read?.("ranch/platform-config.json"));
      const configured = String(config?.variables?.content_path || "")
        .replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
      if (configured && !configured.startsWith("/") && !/^[A-Za-z]:\//.test(configured)
        && !configured.split("/").includes("..")) return configured;
    } catch (_e) {}
    return "ranch/content";
  }

  async _deliveryApi() {
    const complete = (api) => typeof api?.normalizeStatus === "function";
    if (complete(this._injectedDeliveryApi)) return this._injectedDeliveryApi;
    if (complete(this._resolvedDeliveryApi)) return this._resolvedDeliveryApi;
    try {
      if (complete(globalThis.SauceDelivery)) return (this._resolvedDeliveryApi = globalThis.SauceDelivery);
      if (complete(globalThis.customJS?.DeliveryContract)) {
        return (this._resolvedDeliveryApi = globalThis.customJS.DeliveryContract);
      }
      const adapter = this._app()?.vault?.adapter;
      const contentPath = await this._contentPath(adapter);
      const deliveryRoot = `${contentPath}/delivery`;
      const req = typeof globalThis.require === "function" ? globalThis.require : null;
      const fullPath = adapter?.getFullPath?.(`${deliveryRoot}/index.js`);
      if (req && fullPath) {
        const api = req(fullPath);
        if (complete(api)) return (this._resolvedDeliveryApi = api);
      }
      if (adapter?.read) {
        const [indexSource, contractSource, registrySource] = await Promise.all([
          adapter.read(`${deliveryRoot}/index.js`),
          adapter.read(`${deliveryRoot}/scripts/delivery-contract.js`),
          adapter.read(`${deliveryRoot}/data/delivery-schema.json`),
        ]);
        const registry = JSON.parse(registrySource);
        const contractModule = { exports: {} };
        new Function("require", "module", "exports", contractSource)(
          (id) => {
            if (id === "../data/delivery-schema.json") return registry;
            if (id === "crypto") {
              return { createHash() { throw new Error("hashing unavailable in OperatorStation"); } };
            }
            throw new Error(`unsupported delivery dependency: ${id}`);
          },
          contractModule,
          contractModule.exports
        );
        const indexModule = { exports: {} };
        new Function("require", "module", "exports", indexSource)(
          (id) => {
            if (id === "./scripts/delivery-contract") return contractModule.exports;
            throw new Error(`unsupported delivery public dependency: ${id}`);
          },
          indexModule,
          indexModule.exports
        );
        if (complete(indexModule.exports)) return (this._resolvedDeliveryApi = indexModule.exports);
      }
    } catch (_e) {}
    return null;
  }

  _validPayload(payload) {
    const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
    const nullableString = (value) => value === null || nonEmptyString(value);
    const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
    const requiredString = (value, key) => has(value, key) && nonEmptyString(value[key]);
    const requiredNullableString = (value, key) => has(value, key) && nullableString(value[key]);
    const required = [
      "type", "schema_version", "updated_at", "updated_on", "headline", "exact_action",
      "active", "needs_attention", "needs_attention_overflow_count", "waiting",
      "waiting_overflow_count", "since", "releases_recent", "releases_recent_overflow_count",
      "tombstone_residue", "tombstone_residue_overflow_count", "counts",
    ];
    if (!payload || required.some((key) => !Object.prototype.hasOwnProperty.call(payload, key))) return false;
    if (payload.type !== "loop-station" || payload.schema_version !== "1.0.0"
      || !Number.isFinite(Date.parse(payload.updated_at))
      || typeof payload.updated_on !== "string" || !payload.updated_on.trim()
      || typeof payload.headline !== "string"
      || (payload.exact_action !== null && typeof payload.exact_action !== "string")
      || (payload.active !== null && (!record(payload.active)
        || !requiredString(payload.active, "card")
        || !requiredString(payload.active, "phase")
        || !requiredNullableString(payload.active, "epic")))) {
      return false;
    }
    const needsEntry = (item) => record(item)
      && requiredString(item, "card")
      && requiredNullableString(item, "epic")
      && requiredString(item, "bucket")
      && requiredString(item, "why")
      && requiredNullableString(item, "ratification");
    const waitingEntry = (item) => record(item)
      && requiredString(item, "card")
      && requiredNullableString(item, "epic")
      && requiredString(item, "bucket")
      && requiredString(item, "why");
    const residueEntry = (item) => record(item)
      && requiredString(item, "card")
      && requiredString(item, "path")
      && requiredString(item, "heal");
    const discardEntry = (item) => record(item)
      && requiredString(item, "name")
      && requiredNullableString(item, "reason")
      && requiredNullableString(item, "superseded_by")
      && has(item, "discarded_at")
      && (item.discarded_at === null || timestamp(item.discarded_at));
    const selfRatifiedEntry = (item) => record(item)
      && requiredString(item, "heading")
      && requiredString(item, "date")
      && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
    const cutoverEntry = (item) => record(item)
      && has(item, "enabled") && typeof item.enabled === "boolean"
      && has(item, "at") && timestamp(item.at);
    const ratifiedEntry = (item) => record(item)
      && requiredString(item, "card")
      && requiredString(item, "authority")
      && has(item, "at") && timestamp(item.at)
      && requiredNullableString(item, "artifact_path");
    const bounded = (items, overflow, validEntry) => Array.isArray(items) && items.length <= 20
      && Number.isInteger(overflow) && overflow >= 0 && items.every(validEntry);
    if (!bounded(payload.needs_attention, payload.needs_attention_overflow_count, needsEntry)
      || !bounded(payload.waiting, payload.waiting_overflow_count, waitingEntry)
      || !bounded(payload.releases_recent, payload.releases_recent_overflow_count, nonEmptyString)
      || !bounded(payload.tombstone_residue, payload.tombstone_residue_overflow_count, residueEntry)) {
      return false;
    }
    const since = payload.since;
    if (!record(since) || !has(since, "marker_at")
      || (since.marker_at !== null && !timestamp(since.marker_at))
      || !bounded(since.discards, since.discards_overflow_count, discardEntry)
      || !bounded(since.self_ratified, since.self_ratified_overflow_count, selfRatifiedEntry)
      || !bounded(since.cutover_flips, since.cutover_flips_overflow_count, cutoverEntry)
      || !bounded(since.ratified, since.ratified_overflow_count, ratifiedEntry)) return false;
    if (!payload.counts || typeof payload.counts !== "object" || Array.isArray(payload.counts)) return false;
    return ["needs_attention", "waiting", "frozen", "done", "tombstone_residue"]
      .every((key) => Number.isInteger(payload.counts[key]) && payload.counts[key] >= 0);
  }

  _pendingRatifications() {
    const folder = "spice/projects/sauce/ratifications";
    const prefix = `${folder}/`;
    try {
      return (this._app()?.vault?.getMarkdownFiles?.() || [])
        .filter((file) => file.path.startsWith(prefix)
          && !file.path.slice(prefix.length).includes("/"))
        .map((file) => ({ file, frontmatter: this._frontmatter(file) }))
        .filter(({ frontmatter }) => frontmatter.type === "ratification"
          && frontmatter.schema_version === "1.0.0"
          && frontmatter.state === "pending")
        .sort((left, right) => String(left.frontmatter.created_at || "")
          .localeCompare(String(right.frontmatter.created_at || "")));
    } catch (_e) { return []; }
  }

  _open(target, source) {
    try {
      this._app()?.workspace?.openLinkText?.(
        String(target || "").replace(/\.md$/i, ""),
        source || "",
        false
      );
    } catch (_e) {}
  }

  _vaultRelativePath(target) {
    const raw = String(target || "").trim().replace(/\\/g, "/");
    if (!raw) return null;
    const isAbsolute = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
    if (!isAbsolute) {
      const relative = raw.replace(/^\.\//, "");
      return relative && !relative.split("/").includes("..") ? relative : null;
    }
    try {
      const adapter = this._app()?.vault?.adapter;
      const base = String(adapter?.getBasePath?.() || adapter?.basePath || "")
        .trim().replace(/\\/g, "/").replace(/\/+$/, "");
      const comparableRaw = /^[A-Za-z]:\//.test(raw) ? raw.toLowerCase() : raw;
      const comparableBase = /^[A-Za-z]:\//.test(base) ? base.toLowerCase() : base;
      if (comparableBase) {
        if (comparableRaw.startsWith(`${comparableBase}/`)) {
          const relative = raw.slice(base.length + 1);
          if (relative && !relative.split("/").includes("..")) return relative;
        }
        return null;
      }
      const matches = (this._app()?.vault?.getMarkdownFiles?.() || [])
        .map((file) => String(file?.path || "").replace(/\\/g, "/"))
        .filter((path) => path && raw.endsWith(`/${path}`));
      if (matches.length === 1) return matches[0];
    } catch (_e) {}
    return null;
  }

  _link(parent, target, label, source) {
    const link = parent.createEl("a", { text: label });
    link.className = "operator-station-link";
    link.href = "#";
    link.style.cssText =
      "color:var(--link-color);cursor:pointer;text-decoration:none;min-width:0;" +
      "max-width:100%;overflow-wrap:anywhere;";
    link.addEventListener?.("click", (event) => {
      event?.preventDefault?.();
      this._open(target, source);
    });
    return link;
  }

  _chip(parent, text, color) {
    const chip = parent.createEl("span", { text });
    chip.className = "operator-station-chip";
    chip.style.cssText =
      `display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;` +
      `font-size:0.75em;font-weight:600;color:${color};` +
      `background:color-mix(in srgb, ${color} 12%, transparent);` +
      `border:1px solid color-mix(in srgb, ${color} 35%, transparent);`;
    return chip;
  }

  _linkedChip(parent, target, text, color, source) {
    const chip = this._link(parent, target, text, source);
    chip.className += " operator-station-chip";
    chip.style.cssText =
      `display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;` +
      `font-size:0.75em;font-weight:600;color:${color};` +
      `background:color-mix(in srgb, ${color} 12%, transparent);` +
      `border:1px solid color-mix(in srgb, ${color} 35%, transparent);`;
    return chip;
  }

  _linkedText(parent, text, source) {
    const raw = String(text || "");
    const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let cursor = 0;
    let match;
    while ((match = pattern.exec(raw))) {
      if (match.index > cursor) parent.createEl("span", { text: raw.slice(cursor, match.index) });
      const target = String(match[1] || "").trim();
      const label = String(match[2] || match[1] || "").trim();
      if (target) this._link(parent, target, label, source);
      else parent.createEl("span", { text: match[0] });
      cursor = pattern.lastIndex;
    }
    if (cursor < raw.length) parent.createEl("span", { text: raw.slice(cursor) });
  }

  _linkedExactAction(parent, payload, source) {
    const raw = String(payload.exact_action || "");
    const target = String(payload.needs_attention?.[0]?.card || "").trim();
    const index = target ? raw.indexOf(target) : -1;
    if (index < 0) {
      this._linkedText(parent, raw, source);
      return;
    }
    if (index > 0) this._linkedText(parent, raw.slice(0, index), source);
    this._link(parent, target, target, source);
    if (index + target.length < raw.length) {
      this._linkedText(parent, raw.slice(index + target.length), source);
    }
  }

  _more(parent, count, noun = "items") {
    if (!Number.isInteger(count) || count <= 0) return;
    const more = parent.createEl("span", { text: `+${count} more ${noun}` });
    more.style.cssText = "color:var(--text-muted);font-size:var(--font-ui-smaller);";
  }

  _section(dv, root, label) {
    try {
      const sectionLabel = globalThis.customJS?.SectionLabel;
      if (sectionLabel?.render) {
        sectionLabel.render({ ...dv, container: root }, { text: label });
        return;
      }
    } catch (_e) {}
    root.createEl("div", { text: label });
  }

  _card(parent, className = "") {
    const card = parent.createEl("div");
    card.className = className;
    card.style.cssText =
      "border:1px solid var(--background-modifier-border);border-radius:10px;" +
      "padding:11px;display:grid;gap:7px;min-width:0;";
    return card;
  }

  _row(parent, className = "") {
    const row = parent.createEl("div");
    row.className = className;
    row.style.cssText =
      "padding:10px 11px;display:grid;gap:6px;min-width:0;" +
      "border-bottom:1px solid var(--background-modifier-border);";
    return row;
  }

  _rows(parent) {
    const rows = parent.createEl("div");
    rows.style.cssText =
      "border:1px solid var(--background-modifier-border);border-radius:10px;" +
      "overflow:hidden;min-width:0;";
    return rows;
  }

  _renderRecovery(root, message) {
    if (!root?.createEl) return;
    if (typeof root.replaceChildren === "function") root.replaceChildren();
    else {
      try {
        while (root.firstChild) root.removeChild(root.firstChild);
      } catch (_e) {}
    }
    const recovery = root.createEl("div", { text: message });
    recovery.className = "operator-station-recovery";
  }

  _registeredCommand(id) {
    try {
      const commands = this._app()?.commands;
      if (!commands?.commands?.[id] || typeof commands.executeCommandById !== "function") return null;
      return commands;
    } catch (_e) { return null; }
  }

  _deliveryStatusCommand(parent) {
    const id = "delivery:status";
    const commands = this._registeredCommand(id);
    if (!commands) {
      const instruction = parent.createEl("code", { text: "/delivery-status" });
      instruction.className = "operator-station-command";
      instruction.style.cssText =
        "font-family:var(--font-monospace);color:var(--text-normal);user-select:all;";
      return instruction;
    }
    const action = parent.createEl("button", { text: "/delivery-status" });
    action.className = "operator-station-command";
    action.type = "button";
    action.style.cssText =
      "appearance:none;border:0;background:transparent;padding:0;margin:0;" +
      "font-family:var(--font-monospace);color:var(--link-color);cursor:pointer;" +
      "text-decoration:underline;text-underline-offset:2px;";
    action.addEventListener?.("click", (event) => {
      event?.preventDefault?.();
      try { this._registeredCommand(id)?.executeCommandById(id); } catch (_e) {}
    });
    return action;
  }

  _renderHeadline(root, payload, source) {
    const headline = root.createEl("div", { text: payload.headline || "Loop is ready." });
    headline.className = "operator-station-headline";
    headline.style.cssText =
      "font-size:1.2em;font-weight:650;line-height:1.35;min-width:0;overflow-wrap:anywhere;";
    if (payload.exact_action) {
      const action = root.createEl("div");
      action.className = "operator-station-exact-action";
      action.style.cssText =
        "color:var(--text-muted);font-size:var(--font-ui-small);min-width:0;overflow-wrap:anywhere;";
      this._linkedExactAction(action, payload, source);
    }
    if (payload.counts.tombstone_residue > 0) {
      const residue = root.createEl("div");
      residue.className = "operator-station-residue";
      residue.style.cssText =
        "border:1px solid color-mix(in srgb, var(--color-orange) 35%, transparent);" +
        "background:color-mix(in srgb, var(--color-orange) 12%, transparent);" +
        "border-radius:9px;padding:9px;display:grid;gap:5px;min-width:0;";
      residue.createEl("strong", {
        text: `${payload.counts.tombstone_residue} tombstone residue detected`,
      });
      for (const item of payload.tombstone_residue) {
        const row = residue.createEl("div");
        row.style.cssText =
          "display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0;";
        const label = String(item.card || item.path || "Residual note");
        const target = item.path ? this._vaultRelativePath(item.path) : String(item.card || "");
        if (target) this._link(row, target, label, source);
        else row.createEl("span", { text: label });
        const heal = row.createEl("span", { text: `heal: ${String(item.heal || "reap")}` });
        heal.style.cssText = "color:var(--text-muted);font-size:var(--font-ui-smaller);";
      }
      this._more(residue, payload.tombstone_residue_overflow_count, "residual notes");
    }
    const updated = new Date(payload.updated_at);
    const now = this._now();
    const ageMs = now instanceof Date && Number.isFinite(now.getTime()) && Number.isFinite(updated.getTime())
      ? now.getTime() - updated.getTime() : 0;
    if (ageMs <= 24 * 60 * 60 * 1000) return;
    const hours = Math.max(25, Math.floor(ageMs / (60 * 60 * 1000)));
    const banner = root.createEl("div");
    banner.className = "operator-station-stale";
    banner.style.cssText =
      "border:1px solid color-mix(in srgb, var(--color-orange) 35%, transparent);" +
      "background:color-mix(in srgb, var(--color-orange) 12%, transparent);" +
      "border-radius:9px;padding:9px;min-width:0;overflow-wrap:anywhere;";
    banner.createEl("span", { text: `last projected ${hours}h ago — run ` });
    this._deliveryStatusCommand(banner);
    banner.createEl("span", { text: " for live state" });
  }

  _renderNeeds(dv, root, payload, source, pendingArtifacts) {
    this._section(dv, root, "Needs you");
    if (!payload.needs_attention.length) {
      const calm = this._card(root, "operator-station-empty");
      calm.createEl("span", { text: "Nothing needs you." });
      return;
    }
    const rows = this._rows(root);
    for (const item of payload.needs_attention) {
      const row = this._row(rows, "operator-station-needs-row");
      const title = row.createEl("div");
      title.style.cssText = "display:flex;align-items:flex-start;gap:7px;flex-wrap:wrap;min-width:0;";
      this._link(title, item.card, String(item.card || "Unnamed item"), source)
        .style.cssText += "font-weight:600;flex:1;";
      if (item.epic) {
        this._linkedChip(title, item.epic, String(item.epic), "var(--color-purple)", source);
      }
      if (item.why) {
        const why = row.createEl("div", { text: String(item.why) });
        why.style.cssText =
          "color:var(--text-muted);font-size:var(--font-ui-smaller);overflow-wrap:anywhere;";
      }
      const ratification = String(item.ratification || "").replace(/\.md$/i, "");
      if (ratification && pendingArtifacts.some(({ file }) => file.path.replace(/\.md$/i, "") === ratification)) {
        this._link(row, ratification, "Ratify →", source);
      }
    }
    this._more(rows, payload.needs_attention_overflow_count);
  }

  _renderRatifications(dv, root, source, artifacts) {
    if (!artifacts.length) return;
    this._section(dv, root, "Ratification inbox");
    const rows = this._rows(root);
    for (const { file, frontmatter } of artifacts) {
      const row = this._row(rows, "operator-station-ratification-row");
      this._link(row, file.path, file.basename, source).style.cssText += "font-weight:600;";
      const target = String(frontmatter.target_card || "Unknown target");
      this._link(row, target, target, source).style.cssText += "font-weight:600;";
      const ask = row.createEl("span", { text: `Decision needed for ${target}` });
      ask.style.cssText =
        "color:var(--text-muted);font-size:var(--font-ui-smaller);overflow-wrap:anywhere;";
    }
  }

  _renderWaiting(dv, root, payload, source) {
    if (!payload.waiting.length) return;
    this._section(dv, root, "Waiting — no action");
    const details = root.createEl("details");
    details.className = "operator-station-waiting";
    details.style.cssText =
      "border:1px solid var(--background-modifier-border);border-radius:10px;" +
      "min-width:0;color:var(--text-muted);";
    const summary = details.createEl("summary", {
      text: `${payload.counts.waiting} waiting — no action`,
    });
    summary.style.cssText = "cursor:pointer;padding:10px 11px;";
    for (const item of payload.waiting) {
      const row = this._row(details);
      this._link(row, item.card, String(item.card || "Unnamed wait"), source);
      if (item.why) {
        const why = row.createEl("span", { text: String(item.why) });
        why.style.cssText =
          "color:var(--text-muted);font-size:var(--font-ui-smaller);overflow-wrap:anywhere;";
      }
    }
    this._more(details, payload.waiting_overflow_count, "waits");
  }

  _renderSince(dv, root, payload, source) {
    const since = payload.since;
    const hasEntries = since.discards.length || since.self_ratified.length
      || since.cutover_flips.length || since.ratified.length;
    if (!hasEntries) return;
    this._section(dv, root, "Since you last looked");
    const rows = this._rows(root);
    const marker = since.marker_at ? String(since.marker_at).slice(0, 10) : "the beginning";
    const markerRow = this._row(rows);
    const markerText = markerRow.createEl("span", {
      text: `since your last delivery:status read (${marker})`,
    });
    markerText.style.cssText = "color:var(--text-muted);font-size:var(--font-ui-smaller);";
    for (const item of since.discards) {
      const row = this._row(rows);
      const name = row.createEl("s", { text: String(item.name || "Discarded item") });
      name.style.cssText = "color:var(--text-muted);overflow-wrap:anywhere;";
      if (item.reason) row.createEl("span", { text: String(item.reason) });
      if (item.superseded_by) this._link(row, item.superseded_by, String(item.superseded_by), source);
    }
    this._more(rows, since.discards_overflow_count, "discards");
    for (const item of since.self_ratified) {
      const row = this._row(rows);
      row.createEl("span", { text: `Self-ratified: ${String(item.heading || "amendment")}` });
      if (item.date) row.createEl("small", { text: String(item.date) });
    }
    this._more(rows, since.self_ratified_overflow_count, "self-ratified amendments");
    for (const item of since.cutover_flips) {
      const row = this._row(rows);
      row.createEl("span", { text: `Cutover ${item.enabled ? "enabled" : "disabled"}` });
      if (item.at) row.createEl("small", { text: String(item.at).slice(0, 10) });
    }
    this._more(rows, since.cutover_flips_overflow_count, "cutover flips");
    for (const item of since.ratified) {
      const row = this._row(rows);
      row.createEl("span", { text: "Ratified:" });
      this._link(row, item.card, String(item.card || "item"), source);
      row.createEl("span", { text: String(item.authority || "authority unknown") });
      if (item.artifact_path) this._link(row, item.artifact_path, "Receipt →", source);
    }
    this._more(rows, since.ratified_overflow_count, "ratifications");
  }

  _renderActiveAndReleases(dv, root, payload, source) {
    if (!payload.active && !payload.releases_recent.length) return;
    this._section(dv, root, "Active now + recent releases");
    const card = this._card(root);
    if (payload.active) {
      const active = card.createEl("div");
      active.style.cssText = "display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0;";
      this._link(active, payload.active.card, String(payload.active.card || "Active item"), source)
        .style.cssText += "font-weight:600;flex:1;";
      if (payload.active.phase) {
        this._chip(active, String(payload.active.phase).replace(/_/g, " "), "var(--color-green)");
      }
      if (payload.active.epic) this._link(card, payload.active.epic, String(payload.active.epic), source);
    }
    if (payload.releases_recent.length) {
      const releases = card.createEl("div");
      releases.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;";
      for (const release of payload.releases_recent) {
        this._chip(releases, String(release), "var(--color-green)");
      }
      this._more(releases, payload.releases_recent_overflow_count, "releases");
    }
  }

  async render(dv) {
    let root = null;
    try {
      const renderSafe = globalThis.customJS?.RenderSafe;
      const current = renderSafe?.page ? renderSafe.page(dv) : null;
      if (!current || !dv?.container?.createEl) return;
      const previous = dv.container.querySelector?.(":scope > .operator-station-root");
      previous?.remove?.();
      root = dv.container.createEl("div");
      root.className = "operator-station-root";
      root.style.cssText = "display:grid;gap:10px;max-width:760px;min-width:0;";
      if (!this._validPayload(current)) {
        this._renderRecovery(
          root,
          "Operator state unavailable — run delivery:status, then reinstall project if needed."
        );
        return;
      }
      if (!await this._deliveryApi()) {
        root.createEl("div", { text: "Delivery unavailable — reinstall delivery and project." });
        return;
      }
      const source = current.file?.path || "spice/projects/sauce/Loop Station.md";
      const pendingArtifacts = this._pendingRatifications();
      this._renderHeadline(root, current, source);
      this._renderNeeds(dv, root, current, source, pendingArtifacts);
      this._renderRatifications(dv, root, source, pendingArtifacts);
      this._renderWaiting(dv, root, current, source);
      this._renderSince(dv, root, current, source);
      this._renderActiveAndReleases(dv, root, current, source);
    } catch (_e) {
      try {
        if (dv?.container?.createEl) {
          if (!root) {
            root = dv.container.createEl("div");
            root.className = "operator-station-root";
          }
          this._renderRecovery(root, "Operator state unavailable — run delivery:status.");
        }
      } catch (_ignored) {}
    }
  }
}
