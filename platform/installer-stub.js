// platformInstall.js — thin-stub dispatcher (v0.1.2+).
// DO NOT EDIT per-consumer. Content-static across all consumers (landmine #13).
// Reads only this consumer's platform-config.json to resolve workshop path;
// dispatches to <workshop>/platform/install.js via require().
// The require.cache delete is load-bearing — without it, edits to canonical
// install.js don't take effect until Cmd+R Obsidian reload.
module.exports = async (tp) => {
  const path = require("path");
  let cfg;
  try {
    cfg = JSON.parse(await tp.app.vault.adapter.read("Docs/Meta/platform-config.json"));
  } catch (e) {
    new Notice(`platformInstall: failed to read platform-config.json (${e.message})`, 10000);
    return;
  }
  const workshop = path.resolve(tp.app.vault.adapter.basePath, cfg.workshop_relative_path);
  const installer = path.join(workshop, "platform", "install.js");
  try { delete require.cache[require.resolve(installer)]; } catch {}
  return require(installer)(tp);
};
