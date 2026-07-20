/**
 * SauceModal — shared class-based dialog primitive.
 *
 * CustomJS stores class instances, so every public/cross-helper method is an
 * instance method. Presentation belongs to sauce-core.css; this mechanism only
 * emits semantic class names and owns interaction lifecycle.
 *
 * `autofocus` is deliberately opt-in: true selects the first eligible field, a
 * selector resolves inside the dialog, and an element focuses directly. Create
 * callers opt in; edit callers omit it and keep the user's current focus.
 */
class SauceModal {
  _now(opts) {
    try {
      if (opts && typeof opts.now === "function") return Number(opts.now()) || 0;
      return (typeof Date !== "undefined" && Date.now) ? Date.now() : 0;
    } catch (_e) { return 0; }
  }

  _withinOpeningGesture(openedAt, now) {
    const start = Number(openedAt);
    const current = Number(now);
    return Number.isFinite(start) && Number.isFinite(current)
      && current >= start && current - start < 400;
  }

  _normalizeButtons(buttons, hasSubmit, submitLabel) {
    if (Array.isArray(buttons)) return buttons.filter((item) => item && typeof item === "object");
    if (hasSubmit) {
      return [
        { label: "Cancel", action: "cancel" },
        { label: submitLabel || "Save", action: "submit", tone: "accent" },
      ];
    }
    return [{ label: "Close", action: "cancel" }];
  }

  _isSubmitKey(event) {
    if (!event || event.key !== "Enter" || event.defaultPrevented || event.isComposing
      || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
    const target = event.target || null;
    const tag = String(target && target.tagName || "").toLowerCase();
    if (["textarea", "button", "a", "select"].includes(tag) || (target && target.isContentEditable)) return false;
    return true;
  }

  _autofocusTarget(modal, autofocus) {
    if (!autofocus || !modal) return null;
    if (autofocus && typeof autofocus.focus === "function") return autofocus;
    if (!modal.querySelector) return null;
    try {
      if (typeof autofocus === "string") return modal.querySelector(autofocus);
      if (autofocus === true) {
        return modal.querySelector("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex=\"-1\"])");
      }
    } catch (_e) { return null; }
    return null;
  }

  _button(doc, spec, handle) {
    const button = doc.createElement("button");
    const tone = spec.tone === "danger" ? "danger" : (spec.tone === "accent" ? "accent" : "default");
    button.className = "sauce-btn"
      + (tone === "accent" ? " sauce-btn-accent" : "")
      + (tone === "danger" ? " sauce-btn-danger" : "");
    button.textContent = String(spec.label == null ? "" : spec.label);
    button.type = "button";
    if (spec.disabled === true) button.disabled = true;
    button.onclick = async (event) => {
      if (button.disabled) return false;
      if (spec.action === "submit" || spec.submit === true) return handle.submit(event);
      let result;
      try {
        const callback = spec.onClick || spec.onclick;
        if (typeof callback === "function") result = await callback(handle, event);
      } catch (_e) { return false; }
      if (spec.close !== false) handle.close(spec.action === "cancel" ? "cancel" : "button");
      return result;
    };
    return button;
  }

  open(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const doc = opts.doc
      || (typeof activeDocument !== "undefined" && activeDocument)
      || (typeof document !== "undefined" ? document : null);
    if (!doc || !doc.body || typeof doc.createElement !== "function") return null;

    if (this._active && this._active.isOpen) this._active.close("replaced");

    const backdrop = doc.createElement("div");
    backdrop.className = "sauce-modal-backdrop";
    const modal = doc.createElement("div");
    modal.className = "sauce-modal sauce-anim-pop";
    modal.setAttribute && modal.setAttribute("role", "dialog");
    modal.setAttribute && modal.setAttribute("aria-modal", "true");

    let titleEl = null;
    if (opts.title != null && String(opts.title) !== "") {
      titleEl = doc.createElement("h3");
      titleEl.className = "sauce-modal-title";
      titleEl.textContent = String(opts.title);
      modal.appendChild(titleEl);
    }

    const body = doc.createElement("div");
    body.className = "sauce-modal-body";
    modal.appendChild(body);
    const footer = doc.createElement("div");
    footer.className = "sauce-modal-footer sauce-action-row";
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    const openedAt = this._now(opts);
    let isOpen = true;
    let submitting = false;
    let keyListener = null;
    const handle = {
      backdrop,
      modal,
      title: titleEl,
      body,
      footer,
      openedAt,
      close: () => false,
      submit: async () => false,
    };
    Object.defineProperty(handle, "isOpen", { enumerable: true, get: () => isOpen });

    const close = (reason = "close") => {
      if (!isOpen) return false;
      isOpen = false;
      if (doc.removeEventListener && keyListener) doc.removeEventListener("keydown", keyListener, true);
      if (backdrop.remove) backdrop.remove();
      else if (backdrop.parentNode && backdrop.parentNode.removeChild) backdrop.parentNode.removeChild(backdrop);
      if (this._active === handle) this._active = null;
      try { if (typeof opts.onClose === "function") opts.onClose(reason, handle); } catch (_e) {}
      return true;
    };

    const submit = async (event) => {
      if (!isOpen || submitting || typeof opts.onSubmit !== "function") return false;
      submitting = true;
      try {
        const result = await opts.onSubmit(handle, event);
        if (result !== false && opts.closeOnSubmit !== false) close("submit");
        return result !== false;
      } catch (_e) { return false; }
      finally { submitting = false; }
    };
    handle.close = close;
    handle.submit = submit;

    try { if (typeof opts.body === "function") opts.body(body, handle); } catch (_e) {}

    if (typeof opts.footer === "function") {
      try { opts.footer(footer, handle); } catch (_e) {}
    } else {
      const buttons = this._normalizeButtons(opts.buttons, typeof opts.onSubmit === "function", opts.submitLabel);
      for (const spec of buttons) footer.appendChild(this._button(doc, spec, handle));
    }

    keyListener = (event) => {
      if (!event) return;
      if (event.key === "Escape") {
        if (event.preventDefault) event.preventDefault();
        close("escape");
      } else if (typeof opts.onSubmit === "function"
        && event.target && typeof modal.contains === "function" && modal.contains(event.target)
        && this._isSubmitKey(event)) {
        if (event.preventDefault) event.preventDefault();
        submit(event);
      }
    };
    backdrop.onclick = (event) => {
      if (!event || event.target !== backdrop) return;
      if (this._withinOpeningGesture(openedAt, this._now(opts))) return;
      close("backdrop");
    };

    if (doc.addEventListener) doc.addEventListener("keydown", keyListener, true);
    doc.body.appendChild(backdrop);
    this._active = handle;

    const focus = () => {
      if (!isOpen) return;
      const target = this._autofocusTarget(modal, opts.autofocus);
      try { if (target && typeof target.focus === "function") target.focus(); } catch (_e) {}
    };
    if (opts.autofocus) {
      try {
        const defer = typeof opts.defer === "function" ? opts.defer
          : (typeof setTimeout === "function" ? (fn) => setTimeout(fn, 0) : (fn) => fn());
        defer(focus);
      } catch (_e) { focus(); }
    }

    return handle;
  }
}
