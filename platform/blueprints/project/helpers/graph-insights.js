/**
 * GraphInsights — pure blocking analysis for GraphLayout output.
 *
 * analyzeGraph(nodes, edges) -> { perNode, summary }
 *
 * Dependency edges point from prerequisite to dependent. The result exposes
 * each node's transitive upstream prerequisites and downstream dependents,
 * plus the number of live, non-stub dependents it gates. A root blocker is a
 * blocked or parked node with no blocked or parked transitive ancestor.
 *
 * Stub and null-status nodes remain in closures so cross-epic reachability is
 * preserved, but they never contribute to counts or root-blocker candidacy.
 * Ghost order edges are presentation hints and never contribute reachability.
 *
 * Pure by contract: a function of its arguments only — no external runtime
 * surface and no I/O. Malformed input returns the empty shape.
 */
class GraphInsights {
  _empty() {
    return {
      perNode: {},
      summary: { stuckCount: 0, rootBlockers: [], gatedTotal: 0 },
    };
  }

  _card(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  _closure(start, adjacency, order) {
    const visited = new Set([start]);
    const queue = [...(adjacency.get(start) || [])];
    while (queue.length) {
      const card = queue.shift();
      if (visited.has(card)) continue;
      visited.add(card);
      for (const next of adjacency.get(card) || []) queue.push(next);
    }
    visited.delete(start);
    return [...visited].sort((left, right) => order.get(left) - order.get(right));
  }

  analyzeGraph(nodes, edges) {
    const empty = this._empty();
    try {
      if (!Array.isArray(nodes) || !Array.isArray(edges)) return empty;

      const records = new Map();
      const order = new Map();
      for (const node of nodes) {
        if (!node || typeof node !== "object" || Array.isArray(node)) return empty;
        if (!Object.prototype.hasOwnProperty.call(node, "status")) return empty;
        const card = this._card(node.card);
        if (!card || records.has(card)) return empty;
        if (node.status !== null && typeof node.status !== "string") return empty;
        if (node.isStub !== undefined && typeof node.isStub !== "boolean") return empty;
        const status = node.status === null ? null : node.status.trim().toLowerCase();
        if (status === "") return empty;
        const record = { card, status, isStub: node.isStub === true || status === null };
        order.set(card, order.size);
        records.set(card, record);
      }

      const downstream = new Map();
      const upstream = new Map();
      for (const card of records.keys()) {
        downstream.set(card, []);
        upstream.set(card, []);
      }
      const seenEdges = new Set();
      for (const edge of edges) {
        if (!edge || typeof edge !== "object" || Array.isArray(edge)) return empty;
        const from = this._card(edge.from);
        const to = this._card(edge.to);
        if (!from || !to || from === to || !records.has(from) || !records.has(to)) return empty;
        if (edge.kind !== "depends" && edge.kind !== "order") return empty;
        if (edge.kind === "order") continue;
        const key = `${from}\u0000${to}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        downstream.get(from).push(to);
        upstream.get(to).push(from);
      }

      const eligible = (record) => record && !record.isStub && record.status !== "completed";
      const stuck = (record) => eligible(record)
        && (record.status === "blocked" || record.status === "parked");
      const perNode = {};
      const rootBlockers = [];
      for (const record of records.values()) {
        const above = this._closure(record.card, upstream, order);
        const below = this._closure(record.card, downstream, order);
        const isRootBlocker = stuck(record) && !above.some((card) => stuck(records.get(card)));
        if (isRootBlocker) rootBlockers.push(record.card);
        Object.defineProperty(perNode, record.card, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: {
            upstream: above,
            downstream: below,
            gates: below.filter((card) => eligible(records.get(card))).length,
            isRootBlocker,
          },
        });
      }

      const gated = new Set();
      for (const card of rootBlockers) {
        for (const dependent of perNode[card].downstream) {
          if (eligible(records.get(dependent))) gated.add(dependent);
        }
      }
      return {
        perNode,
        summary: {
          stuckCount: [...records.values()].filter(stuck).length,
          rootBlockers,
          gatedTotal: gated.size,
        },
      };
    } catch (_e) {
      return empty;
    }
  }
}
