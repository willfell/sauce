/**
 * CodeFenceButtonInit — customjs startup-script bootstrap for code-fence-button.
 * Registered in customjs_startup_scripts[]. customJS calls invoke() at plugin
 * init. Never-throw + cold-load-safe throughout.
 */
class CodeFenceButtonInit {
  invoke() {
    try {
      // wired in Tasks 4–6
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButtonInit]", e);
    }
  }
}
