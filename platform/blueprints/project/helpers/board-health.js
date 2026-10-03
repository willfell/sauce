/**
 * BoardHealth — read-only, phone-first rendering of the Board Health note's
 * coordinator-written frontmatter payload.
 */
class BoardHealth {
  _validPayload(payload) {
    const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    const has = (value, key) => record(value) && Object.prototype.hasOwnProperty.call(value, key);
    const text = (value) => typeof value === "string" && value.trim().length > 0;
    const nullableText = (value) => value === null || text(value);
    const count = (value) => Number.isInteger(value) && value >= 0;
    const field = (value, key, test) => has(value, key) && test(value[key]);
    const entries = {
      untracked_members: (item) => field(item, "card", text)
        && field(item, "epic", nullableText)
        && field(item, "note_status", text)
        && field(item, "provenance", (value) => value === "coordinator" || value === "foreign")
        && field(item, "remedy", text),
      unprojectable_epics: (item) => field(item, "epic", text)
        && field(item, "error", text)
        && field(item, "remedy", text),
      lane_divergence: (item) => field(item, "epic", text)
        && field(item, "derived", text)
        && field(item, "painted", nullableText)
        && field(item, "agrees", (value) => typeof value === "boolean"),
      projection_errors: (item) => field(item, "card", text)
        && field(item, "phase", text)
        && field(item, "error", text),
      foreign_writes: (item) => field(item, "card", text)
        && field(item, "phase", text),
    };
    const lists = Object.keys(entries);
    if (!record(payload)) return false;
    if (payload.type !== "board-health" || payload.schema_version !== "1.0.0"
      || !text(payload.project)
      || !["present", "empty", "absent"].includes(payload.ledger)
      || typeof payload.no_op !== "boolean") return false;
    if (!["epics", "slices", "records"].every((key) => field(payload.checked, key, count))) return false;
    for (const list of lists) {
      const items = payload[list];
      if (!Array.isArray(items) || items.length > 20
        || !count(payload[`${list}_overflow_count`])
        || !items.every(entries[list])) return false;
    }
    const provenance = payload.untracked_members_by_provenance;
    if (!field(provenance, "coordinator", count) || !field(provenance, "foreign", count)) return false;
    const listed = (kind) => payload.untracked_members.filter((item) => item.provenance === kind).length;
    if (provenance.coordinator + provenance.foreign
      !== payload.untracked_members.length + payload.untracked_members_overflow_count
      || listed("coordinator") > provenance.coordinator
      || listed("foreign") > provenance.foreign) return false;
    const drift = payload.binding_drift;
    if (!field(drift, "remedy", text)) return false;
    if (has(drift, "error")) {
      if (!text(drift.error)) return false;
    } else if (!["atlases", "slices", "orphan_lines"].every((key) => field(drift, key, count))
      || (has(drift, "reports") && !count(drift.reports))
      || (has(drift, "report_codes")
        && (!record(drift.report_codes) || !Object.values(drift.report_codes).every(count)))) {
      return false;
    }
    if (payload.no_op && (has(drift, "error") || drift.atlases || drift.slices || drift.orphan_lines
      || lists.some((list) => payload[list].length || payload[`${list}_overflow_count`]))) return false;
    return true;
  }

  _plural(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  _driftCount(drift) {
    if (Object.prototype.hasOwnProperty.call(drift, "error")) return 1;
    return drift.atlases + drift.slices + drift.orphan_lines;
  }

  _actionCount(payload) {
    return payload.lane_divergence.filter((item) => item.agrees === false).length
      + payload.projection_errors.length + payload.projection_errors_overflow_count
      + payload.unprojectable_epics.length + payload.unprojectable_epics_overflow_count
      + payload.foreign_writes.length + payload.foreign_writes_overflow_count
      + payload.untracked_members_by_provenance.foreign
      + this._driftCount(payload.binding_drift);
  }

  _headline(payload) {
    if (payload.no_op) return "Board healthy";
    const actions = this._actionCount(payload);
    // Unlisted lane rows may or may not disagree, so with a lane overflow the
    // count is a lower bound and the headline says so.
    const unlistedLanes = payload.lane_divergence_overflow_count > 0;
    if (actions > 0) {
      const count = `${this._plural(actions, "finding")} need${actions === 1 ? "s" : ""} action in this clone`;
      return unlistedLanes ? `At least ${count}` : count;
    }
    if (unlistedLanes) return "No listed finding needs action in this clone";
    return "Nothing needs action in this clone";
  }

  _shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
  }

  _open(target, source) {
    try { globalThis.app.workspace.openLinkText(target, source, false); } catch (_e) {}
  }

  _link(parent, target, source) {
    const link = parent.createEl("a", { text: target });
    link.className = "board-health-link";
    link.href = "#";
    link.style.cssText =
      "color:var(--link-color);cursor:pointer;text-decoration:none;font-weight:600;" +
      "min-height:44px;display:flex;align-items:center;min-width:0;max-width:100%;overflow-wrap:anywhere;";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      this._open(target, source);
    });
    return link;
  }

  _detail(parent, text, className = "board-health-detail") {
    const detail = parent.createEl("div", { text });
    detail.className = className;
    detail.style.cssText =
      "color:var(--text-muted);font-size:var(--font-ui-smaller);min-width:0;overflow-wrap:anywhere;";
    return detail;
  }

  _command(parent, command) {
    const code = parent.createEl("code", { text: command });
    code.className = "board-health-command";
    code.style.cssText =
      "font-family:var(--font-monospace);color:var(--text-normal);user-select:all;" +
      "white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;min-width:0;";
    return code;
  }

  _remedy(parent, command) {
    const remedy = parent.createEl("div");
    remedy.className = "board-health-remedy";
    remedy.style.cssText =
      "display:block;padding:6px 8px;border-radius:6px;min-width:0;max-width:100%;" +
      "background:var(--background-secondary);";
    this._command(remedy, command);
    return remedy;
  }

  _be(count) {
    return count === 1 ? "is" : "are";
  }

  _notListed(parent, lead) {
    const line = parent.createEl("div");
    line.className = "board-health-not-listed";
    line.style.cssText =
      "padding:10px 11px;color:var(--text-muted);font-size:var(--font-ui-smaller);" +
      "min-width:0;overflow-wrap:anywhere;";
    line.createEl("span", { text: `${lead} not listed here — run ` });
    this._command(line, "board-health --json");
    line.createEl("span", { text: " to list them" });
    return line;
  }

  _label(dv, root, label) {
    try {
      globalThis.customJS.SectionLabel.render({ ...dv, container: root }, { text: label });
    } catch (_e) {
      root.createEl("div", { text: label });
    }
  }

  _section(dv, root, label) {
    this._label(dv, root, label);
    const body = root.createEl("div");
    body.className = "board-health-section";
    body.style.cssText =
      "border:1px solid var(--background-modifier-border);border-radius:10px;" +
      "overflow:hidden;min-width:0;";
    return body;
  }

  _row(parent) {
    const row = parent.createEl("div");
    row.className = "board-health-row";
    row.style.cssText =
      "padding:4px 11px 10px;display:grid;gap:4px;min-width:0;" +
      "border-bottom:1px solid var(--background-modifier-border);";
    return row;
  }

  _renderRecovery(root) {
    root.replaceChildren();
    const recovery = root.createEl("div", {
      text: "Board health unavailable — run board-health --json, then reinstall project if needed.",
    });
    recovery.className = "board-health-recovery";
  }

  _renderHeadline(root, payload) {
    const headline = root.createEl("div", { text: this._headline(payload) });
    headline.className = "board-health-headline";
    headline.style.cssText =
      "font-size:1.2em;font-weight:650;line-height:1.35;min-width:0;overflow-wrap:anywhere;";
    const checked = payload.checked;
    this._detail(root, [
      payload.project,
      this._plural(checked.epics, "epic"),
      this._plural(checked.slices, "slice"),
      this._plural(checked.records, "ledger record"),
    ].join(" · "), "board-health-scope");
    if (payload.ledger === "present") return;
    const banner = root.createEl("div", {
      text: `Ledger ${payload.ledger} in this clone — lane, projection-error, and foreign-write checks were skipped`,
    });
    banner.className = "board-health-ledger-skipped";
    banner.style.cssText =
      "border:1px solid color-mix(in srgb, var(--color-orange) 35%, transparent);" +
      "background:color-mix(in srgb, var(--color-orange) 12%, transparent);" +
      "border-radius:9px;padding:9px;min-width:0;overflow-wrap:anywhere;";
  }

  _renderLanes(dv, root, payload, source) {
    const disagreeing = payload.lane_divergence.filter((item) => item.agrees === false);
    const hidden = payload.lane_divergence_overflow_count;
    if (!disagreeing.length && !hidden) return;
    const body = this._section(dv, root, "Lane disagreements");
    for (const item of disagreeing) {
      const row = this._row(body);
      this._link(row, item.epic, source);
      this._detail(row, `board lane ${item.painted === null ? "none" : item.painted} · derived ${item.derived}`);
    }
    if (hidden > 0) this._notListed(body, `${this._plural(hidden, "more lane row")} ${this._be(hidden)}`);
  }

  _renderProjectionErrors(dv, root, payload, source) {
    const hidden = payload.projection_errors_overflow_count;
    if (!payload.projection_errors.length && !hidden) return;
    const body = this._section(dv, root, "Projection errors");
    for (const item of payload.projection_errors) {
      const row = this._row(body);
      this._link(row, item.card, source);
      this._detail(row, `phase ${item.phase} · ${item.error}`);
      this._remedy(row, `reconcile --card ${this._shellQuote(item.card)}`);
    }
    if (hidden > 0) this._notListed(body, `${this._plural(hidden, "more projection error")} ${this._be(hidden)}`);
  }

  _renderUnprojectable(dv, root, payload, source) {
    const hidden = payload.unprojectable_epics_overflow_count;
    if (!payload.unprojectable_epics.length && !hidden) return;
    const body = this._section(dv, root, "Unprojectable epics");
    for (const item of payload.unprojectable_epics) {
      const row = this._row(body);
      this._link(row, item.epic, source);
      this._detail(row, item.error);
      this._remedy(row, item.remedy);
    }
    if (hidden > 0) this._notListed(body, `${this._plural(hidden, "more unprojectable epic")} ${this._be(hidden)}`);
  }

  _renderDrift(dv, root, payload) {
    const drift = payload.binding_drift;
    if (!this._driftCount(drift)) return;
    const body = this._section(dv, root, "Binding drift");
    const row = this._row(body);
    row.style.cssText += "padding-top:10px;";
    this._detail(row, Object.prototype.hasOwnProperty.call(drift, "error") ? drift.error : [
      this._plural(drift.atlases, "atlas", "atlases"),
      this._plural(drift.slices, "slice"),
      this._plural(drift.orphan_lines, "orphan board line"),
    ].join(" · "));
    this._remedy(row, drift.remedy);
  }

  _renderForeignWrites(dv, root, payload, source) {
    const hidden = payload.foreign_writes_overflow_count;
    if (!payload.foreign_writes.length && !hidden) return;
    const body = this._section(dv, root, "Foreign writes");
    for (const item of payload.foreign_writes) {
      const row = this._row(body);
      this._link(row, item.card, source);
      this._detail(row, `phase ${item.phase} · note bytes differ from the coordinator's last write`);
    }
    if (hidden > 0) this._notListed(body, `${this._plural(hidden, "more foreign write")} ${this._be(hidden)}`);
  }

  _renderForeignMembers(dv, root, payload, source) {
    const listed = payload.untracked_members.filter((item) => item.provenance === "foreign");
    const hidden = payload.untracked_members_by_provenance.foreign - listed.length;
    if (!listed.length && !hidden) return;
    const body = this._section(dv, root, "Foreign-written members");
    for (const item of listed) {
      const row = this._row(body);
      this._link(row, item.card, source);
      const epic = item.epic === null ? "" : `${item.epic} · `;
      this._detail(row, `${epic}note says ${item.note_status} · remedy: ${item.remedy}`);
    }
    if (hidden > 0) {
      const noun = listed.length ? "more foreign-written member" : "foreign-written member";
      const need = hidden === 1 ? "needs" : "need";
      this._notListed(body, `${this._plural(hidden, noun)} ${need} adopt review and ${this._be(hidden)}`);
    }
  }

  _renderNoAction(dv, root, payload, source) {
    const members = payload.untracked_members.filter((item) => item.provenance === "coordinator");
    const total = payload.untracked_members_by_provenance.coordinator;
    const agreeing = payload.lane_divergence.filter((item) => item.agrees === true);
    const drift = payload.binding_drift;
    const reports = drift.reports;
    const parts = [];
    if (total) parts.push(this._plural(total, "cross-clone member"));
    // Unlisted lane rows may agree, so with a lane overflow the listed agreeing
    // count is a lower bound. With no listed agreeing row the summary names no
    // agreeing lanes.
    if (agreeing.length) {
      const lanes = this._plural(agreeing.length, "agreeing lane");
      parts.push(payload.lane_divergence_overflow_count > 0 ? `at least ${lanes}` : lanes);
    }
    if (reports) parts.push(this._plural(reports, "binding report"));
    if (!parts.length) return;
    this._label(dv, root, "No action in this clone");
    const details = root.createEl("details");
    details.className = "board-health-no-action";
    details.style.cssText =
      "border:1px solid var(--background-modifier-border);border-radius:10px;" +
      "min-width:0;color:var(--text-muted);";
    const summary = details.createEl("summary", { text: `${parts.join(" · ")} — no action in this clone` });
    summary.style.cssText =
      "cursor:pointer;padding:12px 11px;min-height:44px;line-height:20px;overflow-wrap:anywhere;";
    for (const item of members) {
      const row = this._row(details);
      this._link(row, item.card, source);
      const epic = item.epic === null ? "" : `${item.epic} · `;
      this._detail(row, `${epic}note says ${item.note_status} · ${item.remedy}`);
    }
    const hidden = total - members.length;
    if (hidden > 0) this._notListed(details, `${this._plural(hidden, "more cross-clone member")} ${this._be(hidden)}`);
    for (const item of agreeing) {
      const row = this._row(details);
      this._link(row, item.epic, source);
      this._detail(row, `board lane ${item.painted} matches derived ${item.derived}`);
    }
    if (reports) {
      const row = this._row(details);
      row.style.cssText += "padding-top:10px;";
      const codes = Object.entries(drift.report_codes || {})
        .map(([code, count]) => `${code} ×${count}`).join(", ");
      this._detail(row, `${this._plural(reports, "binding report")} the heal will not change${codes ? `: ${codes}` : ""}`);
    }
  }

  _statTime(file) {
    try { return globalThis.app.vault.getAbstractFileByPath(file.path).stat.mtime; } catch (_e) { return null; }
  }

  _fileTime(current) {
    const raw = current.file.mtime ?? this._statTime(current.file);
    const millis = typeof raw === "number" ? raw
      : typeof raw?.toMillis === "function" ? raw.toMillis() : NaN;
    const date = new Date(millis);
    if (!Number.isFinite(date.getTime())) return null;
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
      + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  _renderFooter(root, current) {
    const time = this._fileTime(current);
    if (!time) return;
    const footer = root.createEl("div", { text: `Note file last changed ${time}` });
    footer.className = "board-health-footer";
    footer.style.cssText = "color:var(--text-faint);font-size:var(--font-ui-smaller);min-width:0;";
  }

  render(dv) {
    let root = null;
    try {
      const current = globalThis.customJS.RenderSafe.page(dv);
      if (!current) return;
      dv.container.querySelector(":scope > .board-health-root")?.remove();
      root = dv.container.createEl("div");
      root.className = "board-health-root";
      root.style.cssText = "display:grid;gap:10px;max-width:760px;min-width:0;";
      if (!this._validPayload(current)) {
        this._renderRecovery(root);
        return;
      }
      const source = current.file.path;
      this._renderHeadline(root, current);
      this._renderLanes(dv, root, current, source);
      this._renderProjectionErrors(dv, root, current, source);
      this._renderUnprojectable(dv, root, current, source);
      this._renderDrift(dv, root, current);
      this._renderForeignWrites(dv, root, current, source);
      this._renderForeignMembers(dv, root, current, source);
      this._renderNoAction(dv, root, current, source);
      this._renderFooter(root, current);
    } catch (_e) {
      if (root) this._renderRecovery(root);
    }
  }
}
