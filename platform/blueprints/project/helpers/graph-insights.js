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
      summary: {
        stuckCount: 0,
        rootBlockers: [],
        gatedTotal: 0,
        readyCount: 0,
        needsYouCount: 0,
        blockedCount: 0,
      },
    };
  }

  _card(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  _closure(start, adjacency, order) {
    const visited = new Set([start]);
    const queue = (adjacency.get(start) || []).map((card) => ({ card, hops: 1 }));
    const depths = new Map();
    while (queue.length) {
      const { card, hops } = queue.shift();
      if (visited.has(card)) continue;
      visited.add(card);
      depths.set(card, hops);
      for (const next of adjacency.get(card) || []) queue.push({ card: next, hops: hops + 1 });
    }
    visited.delete(start);
    depths.delete(start);
    return [...depths]
      .sort(([left], [right]) => order.get(left) - order.get(right))
      .map(([card, hops]) => ({ card, hops }));
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
      const upstreamWithDepth = new Map();
      for (const record of records.values()) {
        const aboveWithDepth = this._closure(record.card, upstream, order);
        upstreamWithDepth.set(record.card, aboveWithDepth);
        const belowWithDepth = this._closure(record.card, downstream, order);
        const above = aboveWithDepth.map(({ card }) => card);
        const below = belowWithDepth.map(({ card }) => card);
        const isRootBlocker = stuck(record) && !above.some((card) => stuck(records.get(card)));
        if (isRootBlocker) rootBlockers.push(record.card);
        const isReady = eligible(record)
          && !stuck(record)
          && above.every((card) => {
            const ancestor = records.get(card);
            return ancestor && !ancestor.isStub && ancestor.status === "completed";
          });
        Object.defineProperty(perNode, record.card, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: {
            upstream: above,
            downstream: below,
            gates: below.filter((card) => eligible(records.get(card))).length,
            isRootBlocker,
            isReady,
            rootCauses: [],
          },
        });
      }

      for (const record of records.values()) {
        perNode[record.card].rootCauses = upstreamWithDepth.get(record.card)
          .filter(({ card }) => perNode[card].isRootBlocker)
          .map(({ card, hops }) => ({ card, hops }));
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
          readyCount: [...records.values()].filter((record) => perNode[record.card].isReady).length,
          needsYouCount: [...records.values()]
            .filter((record) => !record.isStub && record.status === "parked").length,
          blockedCount: [...records.values()]
            .filter((record) => !record.isStub && record.status === "blocked").length,
        },
      };
    } catch (_e) {
      return empty;
    }
  }
}
