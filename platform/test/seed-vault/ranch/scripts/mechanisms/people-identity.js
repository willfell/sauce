/**
 * people-identity@0.1.0 — identity resolver for spice/people/ notes.
 *
 * Loaded via customjs-guard (avoids landmines #1 / #2 cold-load TDZ). Three
 * closure args are visible in scope per the loader contract: `app`, `customJS`,
 * `Notice`. No customJS sibling reads at class-load.
 *
 * Public API (LITERAL signatures):
 *   resolvePerson(input)              → personLink | null
 *   findByAlias(type, value)          → personLink | null
 *   getAliases(personLink)            → Array<{type, value}>
 *   listAliasesOfType(type)           → Array<{personLink, value}>
 *
 * Per landmine #19: spice/people/ path-prefix hardcoded; never parameterized.
 * Per landmine #11: module-directory invariant.
 *
 * Resolution priority for resolvePerson(input):
 *   1. basename exact (spice/people/<input>.md)
 *   2. typed-alias exact match across all person notes (any type)
 *   3. case-insensitive basename
 *   4. case-insensitive alias
 *
 * Collision policy: returns FIRST match in folder-sort order; emits
 * console.warn. Validator audit promotion deferred.
 */
class PeopleIdentity {
  /**
   * @param {string} input — name, handle, email, or alias to resolve.
   * @returns {string|null} — wikilink "[[Basename]]" or null on miss.
   */
  resolvePerson(input) {
    if (typeof input !== "string" || input.trim().length === 0) return null;
    const needle = input.trim();
    const needleLower = needle.toLowerCase();
    const people = this._collectPeople();
    if (people.length === 0) return null;

    // 1. basename exact
    const basenameHit = people.find(p => p.basename === needle);
    if (basenameHit) return this._wrap(basenameHit.basename);

    // 2. typed-alias exact (any type)
    const aliasHits = people.filter(p =>
      this._normalizeAliases(p.aliases).some(a => a.value === needle)
    );
    if (aliasHits.length === 1) return this._wrap(aliasHits[0].basename);
    if (aliasHits.length > 1) {
      this._warnCollision(needle, aliasHits.map(p => p.basename));
      return this._wrap(aliasHits[0].basename);
    }

    // 3. basename CI
    const basenameCi = people.find(p => p.basename.toLowerCase() === needleLower);
    if (basenameCi) return this._wrap(basenameCi.basename);

    // 4. alias CI
    const aliasCi = people.filter(p =>
      this._normalizeAliases(p.aliases).some(a => a.value.toLowerCase() === needleLower)
    );
    if (aliasCi.length === 1) return this._wrap(aliasCi[0].basename);
    if (aliasCi.length > 1) {
      this._warnCollision(needle, aliasCi.map(p => p.basename));
      return this._wrap(aliasCi[0].basename);
    }
    return null;
  }

  /**
   * @param {string} type — "phone" | "email" | "name" | "handle" | <other>
   * @param {string} value
   * @returns {string|null}
   */
  findByAlias(type, value) {
    if (typeof type !== "string" || typeof value !== "string") return null;
    if (type.length === 0 || value.length === 0) return null;
    const people = this._collectPeople();
    const hits = people.filter(p =>
      this._normalizeAliases(p.aliases).some(a => a.type === type && a.value === value)
    );
    if (hits.length === 0) return null;
    if (hits.length > 1) this._warnCollision(`${type}:${value}`, hits.map(p => p.basename));
    return this._wrap(hits[0].basename);
  }

  /**
   * @param {string} personLink — "[[Basename]]" or "Basename" or "spice/people/Basename.md"
   * @returns {Array<{type: string, value: string}>}
   */
  getAliases(personLink) {
    const basename = this._stripWikilink(personLink);
    if (!basename) return [];
    const path = `spice/people/${basename}.md`;
    const file = (app && app.metadataCache && typeof app.metadataCache.getFirstLinkpathDest === "function")
      ? app.metadataCache.getFirstLinkpathDest(basename, "")
      : null;
    const target = file || (app && app.vault && typeof app.vault.getAbstractFileByPath === "function"
      ? app.vault.getAbstractFileByPath(path) : null);
    if (!target) return [];
    const cache = (app.metadataCache && typeof app.metadataCache.getFileCache === "function")
      ? app.metadataCache.getFileCache(target) : null;
    const fm = (cache && cache.frontmatter) || {};
    return this._normalizeAliases(fm.aliases);
  }

  /**
   * @param {string} type
   * @returns {Array<{personLink: string, value: string}>}
   */
  listAliasesOfType(type) {
    if (typeof type !== "string" || type.length === 0) return [];
    const people = this._collectPeople();
    const out = [];
    for (const p of people) {
      for (const a of this._normalizeAliases(p.aliases)) {
        if (a.type === type) out.push({ personLink: this._wrap(p.basename), value: a.value });
      }
    }
    return out;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  _collectPeople() {
    if (!app || !app.vault || typeof app.vault.getMarkdownFiles !== "function") return [];
    const files = app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith("spice/people/") && f.basename !== "People")
      .sort((a, b) => a.basename.localeCompare(b.basename));
    const out = [];
    for (const f of files) {
      const cache = (app.metadataCache && typeof app.metadataCache.getFileCache === "function")
        ? app.metadataCache.getFileCache(f) : null;
      const fm = (cache && cache.frontmatter) || {};
      out.push({ basename: f.basename, aliases: fm.aliases });
    }
    return out;
  }

  _normalizeAliases(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      if (typeof entry === "string") {
        out.push({ type: "name", value: entry });
      } else if (entry && typeof entry === "object"
        && typeof entry.type === "string" && typeof entry.value === "string") {
        out.push({ type: entry.type, value: entry.value });
      }
      // Silently drop malformed entries.
    }
    return out;
  }

  _wrap(basename) {
    return `[[${basename}]]`;
  }

  _stripWikilink(raw) {
    if (typeof raw !== "string") return "";
    let s = raw.trim();
    if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
    const pipe = s.indexOf("|");
    if (pipe >= 0) s = s.slice(0, pipe);
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    if (s.endsWith(".md")) s = s.slice(0, -3);
    const slash = s.lastIndexOf("/");
    if (slash >= 0) s = s.slice(slash + 1);
    return s.trim();
  }

  _warnCollision(needle, basenames) {
    try {
      console.warn(`people-identity: alias collision for '${needle}' → [${basenames.join(", ")}]`);
    } catch (_e) { /* swallow */ }
  }
}
