/**
 * mergeCommunityPlugins({ vaultPath, addIds }) → Promise<{ before, after, added }>
 *   - Reads <vault>/.obsidian/community-plugins.json (default to [] if absent)
 *   - Computes union with addIds (dedupe + sort alphabetically)
 *   - If different from before: writes `.sauce-backup` of prior + writes new array
 *   - Returns { before, after, added } for ledger logging
 *   - Failure-loud on malformed JSON (matches landmine #12 malformed-JSON guard)
 */

const fs = require("fs");
const path = require("path");

async function mergeCommunityPlugins({ vaultPath, addIds }) {
    const filePath = path.join(vaultPath, ".obsidian", "community-plugins.json");
    const ids = Array.isArray(addIds) ? addIds : [];

    let before = [];
    let fileExisted = false;

    if (fs.existsSync(filePath)) {
        fileExisted = true;
        const raw = fs.readFileSync(filePath, "utf8");
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            throw new Error(
                `malformed community-plugins.json at ${filePath}: ${e.message} ` +
                `(landmine #12 malformed-JSON guard — refusing to overwrite without manual repair)`
            );
        }
        if (!Array.isArray(parsed)) {
            throw new Error(
                `malformed community-plugins.json at ${filePath}: expected JSON array, got ${typeof parsed}`
            );
        }
        for (const entry of parsed) {
            if (typeof entry !== "string") {
                throw new Error(
                    `malformed community-plugins.json at ${filePath}: array contains non-string entry (${typeof entry})`
                );
            }
        }
        before = parsed;
    }

    const after = [...new Set([...before, ...ids])].sort();
    const added = ids.filter((id) => !before.includes(id));

    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);

    if (beforeJson === afterJson) {
        // Idempotent — no write, no backup.
        return { before, after, added };
    }

    // Backup prior file content (if it existed) BEFORE atomic write.
    if (fileExisted) {
        const backupPath = filePath + ".sauce-backup";
        fs.copyFileSync(filePath, backupPath);
    }

    // Atomic write: tmp + rename.
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(after, null, 2));
    fs.renameSync(tmpPath, filePath);

    return { before, after, added };
}

module.exports = { mergeCommunityPlugins };
