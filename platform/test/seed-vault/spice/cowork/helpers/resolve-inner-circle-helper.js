/* eslint-disable no-console */
/**
 * resolve-inner-circle-helper.js — v0.27.1 (sauce v0.89.1)
 *
 * Pure shape composer. Takes an array of cowork:resolve-person outputs
 * (one per inner_circle_people name; orchestrator threads the original
 * input as the `_input` field on each entry) and returns:
 *   - resolved: deterministic allowlist for gather-from-served-by dispatch
 *   - unresolved: original input strings the resolver missed
 *   - phone_filter_list: deduped union of E.164-shaped phone aliases,
 *     used by morning-briefing's gather-imessage call
 *
 * No MCP calls. No I/O. Idempotent on null/empty input.
 */
"use strict";

function composeInnerCircleAllowlist(resolverOutputs) {
  const resolved = [];
  const unresolved = [];
  const phoneSeen = new Set();
  const phoneFilterList = [];

  if (!Array.isArray(resolverOutputs)) {
    return { resolved, unresolved, phone_filter_list: phoneFilterList };
  }

  for (const r of resolverOutputs) {
    if (!r || typeof r !== "object") continue;
    const origInput = typeof r._input === "string" ? r._input : null;
    if (!origInput) continue;
    if (r.resolved === true && typeof r.person_link === "string" && r.person_link) {
      const aliases = (r.aliases_by_type && typeof r.aliases_by_type === "object")
        ? r.aliases_by_type
        : { phone: [], email: [], name: [], handle: [] };
      resolved.push({
        name: origInput,
        person_link: r.person_link,
        person_basename: typeof r.person_basename === "string" ? r.person_basename : "",
        aliases_by_type: {
          phone:  Array.isArray(aliases.phone)  ? aliases.phone.slice()  : [],
          email:  Array.isArray(aliases.email)  ? aliases.email.slice()  : [],
          name:   Array.isArray(aliases.name)   ? aliases.name.slice()   : [],
          handle: Array.isArray(aliases.handle) ? aliases.handle.slice() : [],
        },
        matched_via: typeof r.matched_via === "string" ? r.matched_via : null,
        collision_warning: typeof r.collision_warning === "string" ? r.collision_warning : null,
      });
      if (Array.isArray(aliases.phone)) {
        for (const p of aliases.phone) {
          if (typeof p === "string" && p && !phoneSeen.has(p)) {
            phoneSeen.add(p);
            phoneFilterList.push(p);
          }
        }
      }
    } else {
      unresolved.push(origInput);
    }
  }

  return { resolved, unresolved, phone_filter_list: phoneFilterList };
}

module.exports = { composeInnerCircleAllowlist };
