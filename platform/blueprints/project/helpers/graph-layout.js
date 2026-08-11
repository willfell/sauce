/**
 * GraphLayout — pure dependency-graph layout core for the project blueprint.
 *
 * layoutGraph(slices, { laneOrder }) -> { nodes, edges, warnings }
 *
 * - slices: frontmatter records in the EpicDashboard slice-gather shape
 *   ({ card, status, depends_on, resume_condition, file: { path } }); every
 *   field tolerates being absent or malformed.
 * - Ranks are longest-path layers: rank 0 = no resolvable prerequisites,
 *   rank N = 1 + max(rank of resolved prerequisites). Cycle members and their
 *   unrankable downstream dependents take a deterministic fallback rank.
 * - Rows follow laneOrder within a rank; cards absent from laneOrder sort
 *   after, alphabetically.
 * - Edges: { from, to, kind: "depends" | "order" }. Ghost "order" edges join
 *   only rank-sharing, laneOrder-known, adjacent-in-lane siblings with no
 *   dependency path between them in either direction.
 * - Warnings: { code, card, detail } with codes dangling_dependency, cycle,
 *   self_dependency. Never throws; the result is always drawable.
 *
 * Pure by contract: a function of its arguments only — no host runtime, no
 * vault or plugin surface, no I/O. The harness enforces this by source scan.
 */
class GraphLayout {
  _identity(value) {
    const raw = String(value == null ? "" : value).trim();
    const match = raw.match(/^\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/);
    return (match ? match[1] : raw).replace(/\.md$/i, "").trim();
  }

  _dependencyRefs(value) {
    let entries = [];
    if (Array.isArray(value)) entries = value;
    else if (typeof value === "string" || typeof value === "number") entries = [value];
    const refs = [];
    for (const entry of entries) {
      const name = this._identity(entry);
      if (name && !refs.includes(name)) refs.push(name);
    }
    return refs;
  }

  _entryName(entry) {
    const fromCard = this._identity(entry.card);
    if (fromCard) return fromCard;
    const rawPath = entry.file && typeof entry.file.path === "string" ? entry.file.path : "";
    return this._identity(rawPath.split("/").pop() || "");
  }

  _hasPath(fromName, toName, depsByName) {
    const queue = [...(depsByName.get(fromName) || [])];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (current === toName) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of depsByName.get(current) || []) queue.push(next);
    }
    return false;
  }

  _waitReason(record, byName) {
    if (record.status !== "parked" && record.status !== "blocked") return null;
    if (record.resume.trim()) return record.resume;
    const unmet = record.refs.filter((ref) => {
      const target = byName.get(ref);
      return !target || target.status !== "completed";
    });
    return unmet.length ? `waiting on: ${unmet.join(", ")}` : null;
  }

  layoutGraph(slices, options) {
    const empty = { nodes: [], edges: [], warnings: [] };
    try {
      if (!Array.isArray(slices)) return empty;
      const warnings = [];
      const records = [];
      const byName = new Map();
      for (const entry of slices) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const name = this._entryName(entry);
        if (!name || byName.has(name)) continue;
        const record = {
          name,
          status: entry.status == null ? null : (String(entry.status).trim() || null),
          path: entry.file && typeof entry.file.path === "string" ? entry.file.path : null,
          resume: entry.resume_condition == null ? "" : String(entry.resume_condition),
          refs: this._dependencyRefs(entry.depends_on),
        };
        records.push(record);
        byName.set(name, record);
      }

      // Classify refs: self-dependency (dropped), dangling (warned, excluded
      // from rank math and edges), resolved (the layout graph).
      const resolvedDeps = new Map();
      for (const record of records) {
        if (record.refs.includes(record.name)) {
          warnings.push({ code: "self_dependency", card: record.name, detail: record.name });
          record.refs = record.refs.filter((ref) => ref !== record.name);
        }
        record.resolved = [];
        for (const ref of record.refs) {
          if (byName.has(ref)) record.resolved.push(ref);
          else warnings.push({ code: "dangling_dependency", card: record.name, detail: ref });
        }
        resolvedDeps.set(record.name, record.resolved);
      }

      // Longest-path layering (Kahn): rank a node once every resolved
      // prerequisite is ranked; rank = 1 + max(prerequisite ranks).
      const rankOf = new Map();
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const record of records) {
          if (rankOf.has(record.name)) continue;
          if (!record.resolved.every((ref) => rankOf.has(ref))) continue;
          const above = record.resolved.map((ref) => rankOf.get(ref));
          rankOf.set(record.name, above.length ? Math.max(...above) + 1 : 0);
          progressed = true;
        }
      }

      // Cycle members and their unrankable downstream dependents: shared
      // deterministic fallback rank; cycle warnings for true cycle members.
      const ranked = [...rankOf.values()];
      const fallbackRank = ranked.length ? Math.max(...ranked) + 1 : 0;
      const unranked = records.filter((record) => !rankOf.has(record.name));
      for (const record of unranked) rankOf.set(record.name, fallbackRank);
      for (const record of unranked) {
        if (!this._hasPath(record.name, record.name, resolvedDeps)) continue;
        const members = unranked
          .map((other) => other.name)
          .filter((other) => other === record.name
            || (this._hasPath(record.name, other, resolvedDeps)
              && this._hasPath(other, record.name, resolvedDeps)))
          .sort();
        warnings.push({ code: "cycle", card: record.name, detail: `dependency cycle: ${members.join(", ")}` });
      }

      // Rows: laneOrder position within the rank; lane-absent cards sort
      // after, alphabetically.
      const laneIndex = new Map();
      const lane = options && Array.isArray(options.laneOrder) ? options.laneOrder : [];
      for (const entry of lane) {
        const name = this._identity(entry);
        if (name && !laneIndex.has(name)) laneIndex.set(name, laneIndex.size);
      }
      const compareInLane = (left, right) => {
        const leftAt = laneIndex.has(left.name) ? laneIndex.get(left.name) : -1;
        const rightAt = laneIndex.has(right.name) ? laneIndex.get(right.name) : -1;
        if (leftAt >= 0 && rightAt >= 0) return leftAt - rightAt;
        if (leftAt >= 0) return -1;
        if (rightAt >= 0) return 1;
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
      };
      const byRank = new Map();
      for (const record of records) {
        const rank = rankOf.get(record.name);
        if (!byRank.has(rank)) byRank.set(rank, []);
        byRank.get(rank).push(record);
      }
      const ranks = [...byRank.keys()].sort((left, right) => left - right);
      const nodes = [];
      for (const rank of ranks) {
        const group = byRank.get(rank).slice().sort(compareInLane);
        group.forEach((record, row) => {
          record.row = row;
          nodes.push({
            card: record.name,
            path: record.path,
            status: record.status,
            rank,
            row,
            waitReason: this._waitReason(record, byName),
          });
        });
        byRank.set(rank, group);
      }

      // Edges: real depends edges first, then ghost order edges between
      // adjacent-in-lane rank siblings with no dependency path in EITHER
      // direction — both legs of the check are load-bearing.
      const edges = [];
      const seen = new Set();
      const push = (from, to, kind) => {
        const key = JSON.stringify([kind, from, to]);
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ from, to, kind });
      };
      for (const drawn of nodes) {
        for (const ref of byName.get(drawn.card).resolved) push(ref, drawn.card, "depends");
      }
      for (const rank of ranks) {
        const laneKnown = byRank.get(rank).filter((record) => laneIndex.has(record.name));
        for (let at = 0; at + 1 < laneKnown.length; at += 1) {
          const left = laneKnown[at];
          const right = laneKnown[at + 1];
          if (this._hasPath(left.name, right.name, resolvedDeps)
            || this._hasPath(right.name, left.name, resolvedDeps)) continue;
          push(left.name, right.name, "order");
        }
      }

      return { nodes, edges, warnings };
    } catch (_e) {
      return empty;
    }
  }
}
