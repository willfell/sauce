/**
 * EpicCreateAction — canonical full-width New Epic action for project boards.
 *
 * The customjs guard owns cold-loading this helper. The helper then waits for
 * EntityCreate so a fresh vault cannot lose its primary action during startup.
 */
class EpicCreateAction {
  _proxyDv(dv, container) {
    const proxy = Object.create((dv && typeof dv === "object") ? dv : null);
    Object.defineProperty(proxy, "container", { value: container, enumerable: true });
    return proxy;
  }

  async render(dv) {
    const container = dv?.container || dv;
    if (!container?.createEl) return;
    const row = container.createEl("div", { cls: "sauce-action-row" });

    for (let i = 0; i < 40 && !globalThis.customJS?.EntityCreate; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const creator = globalThis.customJS?.EntityCreate;
    if (!creator?.render) return;

    const before = new Set(Array.from(row.children || []));
    await creator.render(this._proxyDv(dv, row), { instance: "epic" });
    for (const child of Array.from(row.children || [])) {
      if (before.has(child) || !child.style) continue;
      child.style.cssText += "flex:1 1 100%;min-width:0;width:100%;";
    }
  }
}
