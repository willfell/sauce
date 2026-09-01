"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const CSS_PATH = path.join(ROOT, "platform/mechanisms/styling/assets/snippets/sauce-core.css");
const CHROME_BAR_PATH = path.join(ROOT, "platform/mechanisms/chrome-bar/chrome-bar.js");
const CHROME_BAR_MANIFEST_PATH = path.join(ROOT, "platform/mechanisms/chrome-bar/manifest.json");
const MANIFEST_PATH = path.join(ROOT, "platform/mechanisms/styling/manifest.json");
const THEME_PATH = path.join(ROOT, "platform/mechanisms/styling/assets/themes/Baseline/theme.css");
const DAILY_CSS_PATH = path.join(ROOT, "platform/blueprints/daily/helpers/sauce-daily-dashboard.css");
const INSTALLER_PATH = path.join(ROOT, "platform/install.js");
const RUN_INSTALL_PATH = path.join(ROOT, "platform/test/run-install.js");
const css = fs.readFileSync(CSS_PATH, "utf8");
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const theme = fs.readFileSync(THEME_PATH, "utf8");
const dailyCss = fs.readFileSync(DAILY_CSS_PATH, "utf8");
const chromeBarSource = fs.readFileSync(CHROME_BAR_PATH, "utf8");
const ChromeBar = new Function(`${chromeBarSource}\nreturn ChromeBar;`)();
const chromeBarManifest = JSON.parse(fs.readFileSync(CHROME_BAR_MANIFEST_PATH, "utf8"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log("PASS " + name); }
  catch (error) { failed += 1; console.log("FAIL " + name + " — " + error.message); }
}

function declaration(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*:\\s*([^;]+);"));
  assert.ok(match, "missing declaration " + name);
  return match[1].trim();
}

function rules(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    declarations: match[2],
  }));
}

function bodiesWith(selectorFragment) {
  return rules(css).filter((rule) => rule.selector.includes(selectorFragment)).map((rule) => rule.declarations);
}

function body(selectorFragment) {
  const bodies = bodiesWith(selectorFragment);
  assert.ok(bodies.length > 0, "missing rule containing " + selectorFragment);
  return bodies.join("\n");
}

function stripWhere(selector) {
  let output = selector;
  for (;;) {
    const start = output.indexOf(":where(");
    if (start < 0) return output;
    let depth = 1;
    let end = start + 7;
    for (; end < output.length && depth > 0; end += 1) {
      if (output[end] === "(") depth += 1;
      else if (output[end] === ")") depth -= 1;
    }
    assert.strictEqual(depth, 0, "unbalanced :where() in " + selector);
    output = (output.slice(0, start) + output.slice(end)).replace(/:not\(\)/g, "");
  }
}

function specificity(selector) {
  let remaining = stripWhere(selector);
  const ids = (remaining.match(/#[A-Za-z0-9_-]+/g) || []).length;
  const classes = (remaining.match(/\.[A-Za-z0-9_-]+/g) || []).length;
  const attrs = (remaining.match(/\[[^\]]+\]/g) || []).length;
  const pseudos = (remaining.match(/:(?!:)[A-Za-z0-9_-]+(?:\([^)]*\))?/g) || []).length;
  remaining = remaining
    .replace(/#[A-Za-z0-9_-]+/g, " ")
    .replace(/\.[A-Za-z0-9_-]+/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/::?[A-Za-z0-9_-]+(?:\([^)]*\))?/g, " ");
  const elements = (remaining.match(/(?:^|[\s>+~,(])([A-Za-z][A-Za-z0-9_-]*)/g) || []).length;
  return [ids, classes + attrs + pseudos, elements];
}

function compareSpecificity(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function assertChromeModifierOutranksBase(source) {
  const parsed = rules(source);
  const base = parsed.find((rule) => rule.selector === "body .sauce-btn.sauce-btn.sauce-btn");
  const chrome = parsed.find((rule) => (
    rule.selector.includes(".sauce-chrome-btn")
    && rule.declarations.includes("height: 32px")
    && rule.declarations.includes("padding: 0 16px")
  ));
  assert.ok(base, "missing triple-class sauce button base selector");
  assert.ok(chrome, "missing ChromeBar geometry modifier selector");
  assert.ok(
    compareSpecificity(specificity(chrome.selector), specificity(base.selector)) > 0,
    `ChromeBar modifier ${chrome.selector} must outrank base ${base.selector}`,
  );
}

function assertChromeInteractionPresentation(source) {
  const parsed = rules(source);
  const chrome = parsed.find((rule) => (
    rule.selector.includes(".sauce-chrome-btn")
    && rule.declarations.includes("height: 32px")
  ));
  const hover = parsed.find((rule) => (
    rule.selector.includes(".sauce-chrome-btn:hover")
    && rule.selector.includes(".sauce-chrome-btn.is-hovered")
  ));
  const pressed = parsed.find((rule) => (
    rule.selector.includes(".sauce-chrome-btn:active")
    && rule.selector.includes(".sauce-chrome-btn.is-pressed")
  ));
  assert.ok(chrome, "missing ChromeBar presentation rule");
  for (const transition of ["background 0.15s", "color 0.15s", "border-color 0.15s", "box-shadow 0.15s", "transform 0.15s"]) {
    assert.ok(chrome.declarations.includes(transition), "ChromeBar transition lost " + transition);
  }
  assert.ok(hover, "missing ChromeBar hover and is-hovered presentation rule");
  for (const declaration of [
    "border-color: var(--interactive-accent)",
    "background: var(--interactive-accent)",
    "color: var(--text-on-accent)",
    "box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14)",
  ]) {
    assert.ok(hover.declarations.includes(declaration), "ChromeBar hover lost " + declaration);
  }
  assert.ok(pressed && pressed.declarations.includes("transform: scale(0.94)"), "ChromeBar pressed presentation is missing");
}

function blockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, "missing block " + marker);
  const start = source.indexOf("{", markerIndex);
  let depth = 1;
  let end = start + 1;
  for (; end < source.length && depth > 0; end += 1) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}") depth -= 1;
  }
  assert.strictEqual(depth, 0, "unbalanced block " + marker);
  return source.slice(start + 1, end - 1);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function selectorBoundRuleBytes(source, predicate) {
  const masked = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return [...masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => {
      const leadingWhitespace = match[0].match(/^\s*/)[0].length;
      return {
        selector: match[1].trim(),
        raw: source.slice(match.index + leadingWhitespace, match.index + match[0].length),
      };
    })
    .filter(predicate)
    .map((rule) => rule.raw);
}

function assertLegacyPillRules(coreSource, dailySource) {
  const coreSelectors = new Set([
    ".sauce-pill:not(:where(.space-daily-dashboard .sauce-pill))",
    ".sauce-pill.sauce-pill-accent",
    ".sauce-pill.sauce-pill-danger",
  ]);
  const coreRules = selectorBoundRuleBytes(coreSource, (rule) => coreSelectors.has(rule.selector));
  assert.strictEqual(coreRules.length, 3, "legacy sauce-core pill rule family changed");
  assert.strictEqual(
    sha256(coreRules.join("\n")),
    "1a75c446986c4081d7d7e061ab683a99afb3be9e920a68eb0b6173689adb082b",
    "legacy sauce-core pill selector/declaration bytes changed",
  );

  const dailyFragments = [
    ".sauce-pill",
    ".sauce-pill-dot",
    ".sauce-section-open-pill",
    ".sauce-section-overdue-pill",
    ".sauce-section-done-pill",
    ".sauce-section-count-pill",
    ".sauce-section-pill-label",
    ".sauce-section-counts",
  ];
  const dailyRules = selectorBoundRuleBytes(
    dailySource,
    (rule) => dailyFragments.some((fragment) => rule.selector.includes(fragment)),
  );
  assert.strictEqual(dailyRules.length, 16, "legacy Daily count-pill rule family changed");
  assert.strictEqual(
    sha256(dailyRules.join("\n")),
    "3147a92dd70cbc7eeaf158cff328873db73ff8d8ba79f664b6c4592464deb887",
    "legacy Daily count-pill selector/declaration bytes changed",
  );
}

function assertTogglePillContract(source) {
  const parsed = rules(source);
  const group = parsed.find((rule) => rule.selector === ".sauce-pill-group");
  const toggle = parsed.find((rule) => (
    rule.selector === "body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle"
  ));
  const active = parsed.find((rule) => (
    rule.selector === "body .sauce-pill-toggle.is-active.sauce-pill-toggle.sauce-pill-toggle"
  ));
  const focusVisible = parsed.find((rule) => (
    rule.selector === "body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle:focus-visible"
  ));
  assert.ok(group, "missing exact .sauce-pill-group selector");
  assert.ok(toggle, "missing specificity-bound .sauce-pill-toggle selector");
  assert.ok(active, "missing specificity-bound .sauce-pill-toggle.is-active selector");
  assert.ok(focusVisible, "missing specificity-bound .sauce-pill-toggle:focus-visible selector");
  assert.match(group.declarations, /display:\s*inline-flex/);
  assert.match(group.declarations, /gap:\s*var\(--size-4-1,\s*4px\)/);

  const minHeight = Number(toggle.declarations.match(/min-height:\s*(\d+)px/)[1]);
  const padding = toggle.declarations.match(/padding:\s*(\d+)px\s+(\d+)px/);
  assert.strictEqual(minHeight, 19, "toggle min-height must remain the intended lean 19px");
  assert.deepStrictEqual(padding.slice(1).map(Number), [1, 12],
    "toggle padding must remain the intended lean 1px 12px");
  for (const contract of [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "border: 1px solid var(--sauce-hairline)",
    "border-radius: var(--sauce-radius-pill)",
    "background: var(--background-primary, #fff)",
  ]) {
    assert.ok(toggle.declarations.includes(contract), "toggle base lost " + contract);
  }
  for (const contract of [
    "border-color: var(--interactive-accent, #7c3aed)",
    "background: color-mix(in srgb, var(--interactive-accent, #7c3aed) 14%, transparent)",
    "color: var(--interactive-accent, #7c3aed)",
    "box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent, #7c3aed) 30%, transparent)",
  ]) {
    assert.ok(active.declarations.includes(contract), "toggle active state lost " + contract);
  }
  assert.ok(!active.declarations.includes("background: var(--interactive-accent"),
    "active toggle must be tinted, not a solid accent block");
  assert.ok(
    focusVisible.declarations.includes("outline: 2px solid var(--interactive-accent, #7c3aed)"),
    "toggle focus-visible state lost its accent outline",
  );
  assert.ok(focusVisible.declarations.includes("outline-offset: 2px"),
    "toggle focus-visible state lost its outline offset");
  assert.ok(compareSpecificity(specificity(active.selector), specificity(toggle.selector)) > 0,
    "active toggle selector must outrank the base toggle selector");
  const baselineButtons = rules(theme).filter((rule) => rule.selector.includes("button:where("));
  assert.ok(baselineButtons.length >= 5, "expected Baseline generic and input-mode button fixtures");
  for (const baseline of baselineButtons) {
    assert.ok(compareSpecificity(specificity(toggle.selector), specificity(baseline.selector)) > 0,
      `toggle ${toggle.selector} must outrank Baseline ${baseline.selector}`);
  }
}

test("parent-card public tokens exist on body with exact names and fallbacks", () => {
  assert.match(css, /body\s*\{/);
  const nativeFallbackTokens = [
    "--sauce-radius-modal", "--sauce-radius-btn", "--sauce-backdrop",
    "--sauce-z-modal", "--sauce-shadow-modal", "--sauce-hairline",
    "--sauce-section-gap", "--sauce-ease", "--sauce-spring",
    "--sauce-dur-fast", "--sauce-dur-reveal",
  ];
  for (const token of nativeFallbackTokens) {
    assert.match(declaration(token), /^var\(--[a-z0-9-]+\s*,/i, token + " must use a theme variable plus fallback");
  }
  assert.strictEqual(declaration("--sauce-radius-pill"), "999px");
  assert.match(declaration("--sauce-radius-modal"), /12px/);
  assert.match(declaration("--sauce-radius-btn"), /6px/);
  assert.match(declaration("--sauce-dur-reveal"), /340ms/);
});

test("hairline uses border-hover directly and never the weaker border token", () => {
  const hairline = declaration("--sauce-hairline");
  assert.match(hairline, /^var\(--background-modifier-border-hover\s*,/);
  assert.doesNotMatch(hairline, /--background-modifier-border(?:\s|,|\))/);
});

test("C1C-BASELINE-SPECIFICITY-MODES computes the winning cascade in every input mode", () => {
  const coreSelector = "body .sauce-btn.sauce-btn.sauce-btn";
  const coreRule = rules(css).find((rule) => rule.selector === coreSelector);
  assert.ok(coreRule, "missing exact high-specificity core button rule");
  for (const property of ["display: inline-flex", "min-height: 36px", "padding: 7px 14px", "transition:"]) {
    assert.ok(coreRule.declarations.includes(property), "core winning rule lacks " + property);
  }

  const themeSelectors = rules(theme).map((rule) => rule.selector);
  const fixtures = {
    generic: themeSelectors.find((selector) => selector.startsWith("button:where(")),
    input_cupertino: themeSelectors.find((selector) => selector.startsWith("body.input-cupertino button:where(")),
    input_adwaita: themeSelectors.find((selector) => selector.startsWith("body.input-adwaita button:where(")),
  };
  for (const [mode, selector] of Object.entries(fixtures)) {
    assert.ok(selector, "Baseline fixture missing for " + mode);
    const coreSpecificity = specificity(coreSelector);
    const themeSpecificity = specificity(selector);
    assert.ok(
      compareSpecificity(coreSpecificity, themeSpecificity) > 0,
      `${mode}: core ${coreSpecificity} must outrank Baseline ${themeSpecificity}`,
    );
  }
  const everyBaselineButtonMode = themeSelectors.filter((selector) => selector.includes("button:where("));
  assert.ok(everyBaselineButtonMode.length >= 5, "expected generic, desktop modes, phone, and tablet Baseline fixtures");
  for (const selector of everyBaselineButtonMode) {
    assert.ok(compareSpecificity(specificity(coreSelector), specificity(selector)) > 0, `core must outrank ${selector}`);
  }
});

test("button variants preserve hover geometry and active scale", () => {
  const hover = body(".sauce-btn.sauce-btn.sauce-btn:hover");
  assert.doesNotMatch(hover, /(?:^|;)\s*(?:padding|margin|border-width|min-height|height|width)\s*:/);
  assert.match(body(".sauce-btn.sauce-btn.sauce-btn:active"), /transform:\s*scale\(0\.97\)/);
  assert.match(body(".sauce-btn.sauce-btn.sauce-btn.sauce-btn-accent"), /--interactive-accent/);
  assert.match(body(".sauce-btn.sauce-btn.sauce-btn.sauce-btn-danger"), /--color-red/);
});

test("CSS1 chrome button modifiers preserve the legacy 32px visual contract", () => {
  const chrome = body(".sauce-chrome-btn");
  for (const contract of [
    "height: 32px", "min-height: 32px", "padding: 0 16px", "gap: 6px",
    "border-radius: 8px", "border: 1px solid var(--interactive-accent)",
    "background: var(--background-primary)", "color: var(--interactive-accent)",
    "font-size: 0.82em", "font-weight: 500", "letter-spacing: 0.01em",
    "overflow: hidden", "transform: scale(1)", "box-shadow: none",
  ]) {
    assert.ok(chrome.includes(contract), "chrome button lost legacy contract " + contract);
  }
  const icon = body(".sauce-btn-icon");
  assert.match(icon, /padding:\s*0 12px/);
  assert.match(icon, /min-width:\s*38px/);
  assert.match(body(".sauce-chrome-btn:active"), /transform:\s*scale\(0\.94\)/);
  assertChromeInteractionPresentation(css);
});

test("CSS1-CHROME-MODIFIER-SPECIFICITY binds ChromeBar geometry above the triple-class base", () => {
  assertChromeModifierOutranksBase(css);

  const weakened = css.replace(
    "body .sauce-btn.sauce-btn.sauce-btn.sauce-chrome-btn {",
    "body .sauce-chrome-btn {",
  );
  assert.notStrictEqual(weakened, css, "specificity mutation did not reach the production selector");
  assert.throws(
    () => assertChromeModifierOutranksBase(weakened),
    /ChromeBar modifier .* must outrank base/,
    "weak-selector mutation must turn this fixture red",
  );
});

test("CSS1 ChromeBar buttons use sauce-core classes with byte-stable adopter snapshots", () => {
  const makeParent = () => ({
    children: [],
    createEl(tag, opts) {
      const classes = new Set(String((opts && opts.cls) || "").split(/\s+/).filter(Boolean));
      const button = {
        tag,
        className: [...classes].join(" "),
        innerHTML: "",
        disabled: false,
        style: { cssText: "", setProperty() {} },
        classList: {
          add(...names) { for (const name of names) classes.add(name); button.className = [...classes].join(" "); },
          remove(...names) { for (const name of names) classes.delete(name); button.className = [...classes].join(" "); },
        },
      };
      this.children.push(button);
      return button;
    },
  });
  const bar = new ChromeBar();
  const surfaces = {
    project: (variant) => `pcb-btn pcb-btn-${variant}`,
    wiki: (variant) => `wiki-chrome-btn wiki-chrome-btn-${variant}`,
    finance: (variant) => `finance-chrome-btn finance-chrome-btn-${variant}`,
  };
  const expected = {
    project: [
      ["pcb-btn pcb-btn-home", "<svg data-icon=\"home\"/>"],
      ["pcb-btn pcb-btn-go", "<svg data-icon=\"go\"/>"],
      ["pcb-btn pcb-btn-primary", "<svg data-icon=\"plus\"/><span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;\">New</span>"],
      ["pcb-btn pcb-btn-dots", "<svg data-icon=\"dots\"/>"],
    ],
    wiki: [
      ["wiki-chrome-btn wiki-chrome-btn-home", "<svg data-icon=\"home\"/>"],
      ["wiki-chrome-btn wiki-chrome-btn-go", "<svg data-icon=\"go\"/>"],
      ["wiki-chrome-btn wiki-chrome-btn-primary", "<svg data-icon=\"plus\"/><span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;\">New</span>"],
      ["wiki-chrome-btn wiki-chrome-btn-dots", "<svg data-icon=\"dots\"/>"],
    ],
    finance: [
      ["finance-chrome-btn finance-chrome-btn-home", "<svg data-icon=\"home\"/>"],
      ["finance-chrome-btn finance-chrome-btn-go", "<svg data-icon=\"go\"/>"],
      ["finance-chrome-btn finance-chrome-btn-primary", "<svg data-icon=\"plus\"/><span style=\"overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;\">New</span>"],
      ["finance-chrome-btn finance-chrome-btn-dots", "<svg data-icon=\"dots\"/>"],
    ],
  };
  for (const [surface, btnClass] of Object.entries(surfaces)) {
    const parent = makeParent();
    for (const [variant, label, icon] of [
      ["home", null, '<svg data-icon="home"/>'],
      ["go", null, '<svg data-icon="go"/>'],
      ["primary", "New", '<svg data-icon="plus"/>'],
      ["dots", null, '<svg data-icon="dots"/>'],
    ]) {
      bar.renderChromeButton(parent, { cls: btnClass(variant), label, icon, onClick() {} });
    }
    const snapshot = parent.children.map((button) => [
      button.className.split(/\s+/).filter((name) => !name.startsWith("sauce-")).join(" "),
      button.innerHTML,
    ]);
    assert.strictEqual(JSON.stringify(snapshot), JSON.stringify(expected[surface]), surface + " chrome marker/content snapshot changed");
    assert.ok(parent.children.every((button) => button.className.includes("sauce-btn sauce-chrome-btn")), surface + " buttons lack sauce-core classes");
    assert.ok(parent.children.filter((button) => !button.innerHTML.includes("New")).every((button) => button.className.includes("sauce-btn-icon")), surface + " icon buttons lack the icon/+ modifier");
    assert.ok(parent.children.every((button) => button.style.cssText === ""), surface + " ChromeBar still owns inline presentation");
  }
});

test("CSS1-STYLING-DEPENDENCY-CLOSURE declares the styling mechanism that owns sauce-core", () => {
  assert.ok(
    chromeBarManifest.depends_on.some((dependency) => dependency.name === "styling" && dependency.range === ">=0.3.0"),
    "chrome-bar must require the styling mechanism before emitting sauce-core classes",
  );
});

test("C1C-PILL-VARIANT-CASCADE preserves the parent API and Daily pre-adoption", () => {
  const baseSelector = ".sauce-pill:not(:where(.space-daily-dashboard .sauce-pill))";
  const accentSelector = ".sauce-pill.sauce-pill-accent";
  const dangerSelector = ".sauce-pill.sauce-pill-danger";
  assert.ok(rules(css).some((rule) => rule.selector === baseSelector), "Daily-preserving low-specificity selector missing");
  assert.match(body(baseSelector), /border-radius:\s*var\(--sauce-radius-pill\)/);
  assert.match(body(accentSelector), /--interactive-accent/);
  assert.match(body(dangerSelector), /--color-red/);
  assert.ok(compareSpecificity(specificity(accentSelector), specificity(baseSelector)) > 0, "accent pill must win over base declarations");
  assert.ok(compareSpecificity(specificity(dangerSelector), specificity(baseSelector)) > 0, "danger pill must win over base declarations");
});

test("TV1-TOGGLE-PILL-CONTRACT exposes lean token-driven toggle and group primitives", () => {
  assertTogglePillContract(css);

  const weakened = css.replace(
    "body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle {",
    ".sauce-pill-toggle {",
  );
  assert.notStrictEqual(weakened, css, "weak-selector mutation did not reach the base toggle rule");
  assert.throws(
    () => assertTogglePillContract(weakened),
    /missing specificity-bound \.sauce-pill-toggle selector/,
    "weak base selector must turn the focused fixture red",
  );

  const weakenedFocus = css.replace(
    "body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle:focus-visible {",
    "body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle:focus {",
  );
  assert.notStrictEqual(weakenedFocus, css, "focus-visible mutation did not reach its fixture");
  assert.throws(
    () => assertTogglePillContract(weakenedFocus),
    /missing specificity-bound \.sauce-pill-toggle:focus-visible selector/,
    "a weakened focus-visible selector must turn the focused fixture red",
  );

  for (const [needle, replacement, message] of [
    ["display: inline-flex", "display: block", "block display"],
    ["align-items: center", "align-items: start", "off-center alignment"],
    ["justify-content: center", "justify-content: start", "off-center justification"],
    ["min-height: 19px", "min-height: 0px", "degenerate height"],
    ["padding: 1px 12px", "padding: 0px 0px", "degenerate padding"],
  ]) {
    const toggleMarker = "body .sauce-pill-toggle.sauce-pill-toggle.sauce-pill-toggle {";
    const toggleBlock = blockAfter(css, toggleMarker);
    const mutatedBlock = toggleBlock.replace(needle, replacement);
    assert.notStrictEqual(mutatedBlock, toggleBlock, message + " mutation did not reach its fixture");
    const geometryMutation = css.replace(toggleBlock, mutatedBlock);
    assert.throws(
      () => assertTogglePillContract(geometryMutation),
      undefined,
      message + " must turn the focused fixture red",
    );
  }
});

test("TV1-LEGACY-PILL-BYTES preserves core and Daily count-pill presentation", () => {
  assertLegacyPillRules(css, dailyCss);

  const coreSelectorMutation = css.replace(
    ".sauce-pill.sauce-pill-accent {",
    "body .sauce-pill.sauce-pill-accent {",
  );
  assert.notStrictEqual(coreSelectorMutation, css, "core selector mutation did not reach its fixture");
  assert.throws(
    () => assertLegacyPillRules(coreSelectorMutation, dailyCss),
    /legacy sauce-core pill (?:rule family|selector\/declaration bytes) changed/,
    "a core pill selector-specificity mutation must turn the focused fixture red",
  );

  const dailyPseudoMutation = dailyCss.replace(
    ".space-daily-dashboard .sauce-section-open-pill::before {",
    ".foo .space-daily-dashboard .sauce-section-open-pill::before {",
  );
  assert.notStrictEqual(dailyPseudoMutation, dailyCss, "Daily pseudo-selector mutation did not reach its fixture");
  assert.throws(
    () => assertLegacyPillRules(css, dailyPseudoMutation),
    /legacy Daily count-pill selector\/declaration bytes changed/,
    "a Daily count-pill pseudo-selector mutation must turn the focused fixture red",
  );

  const neutralCountMutation = dailyCss.replace(
    ".space-daily-dashboard .sauce-section-count-pill {",
    "body .space-daily-dashboard .sauce-section-count-pill {",
  );
  assert.notStrictEqual(neutralCountMutation, dailyCss, "neutral count-pill mutation did not reach its fixture");
  assert.throws(
    () => assertLegacyPillRules(css, neutralCountMutation),
    /legacy Daily count-pill selector\/declaration bytes changed/,
    "a neutral count-pill selector mutation must turn the focused fixture red",
  );

  const mobileLabelMutation = dailyCss.replace(
    ".space-daily-dashboard .sauce-section-pill-label { display: none; }",
    "body .space-daily-dashboard .sauce-section-pill-label { display: none; }",
  );
  assert.notStrictEqual(mobileLabelMutation, dailyCss, "mobile count-pill label mutation did not reach its fixture");
  assert.throws(
    () => assertLegacyPillRules(css, mobileLabelMutation),
    /legacy Daily count-pill selector\/declaration bytes changed/,
    "a mobile count-pill label selector mutation must turn the focused fixture red",
  );

  const mobileGapMutation = dailyCss.replace(
    "  .space-daily-dashboard .sauce-section-counts { gap: 4px; }",
    "  body .space-daily-dashboard .sauce-section-counts { gap: 4px; }",
  );
  assert.notStrictEqual(mobileGapMutation, dailyCss, "mobile count-pill gap mutation did not reach its fixture");
  assert.throws(
    () => assertLegacyPillRules(css, mobileGapMutation),
    /legacy Daily count-pill selector\/declaration bytes changed/,
    "a mobile count-pill gap selector mutation must turn the focused fixture red",
  );
});

test("C1C-390PX-TWO-UP computes two and only two minimum actions at 390px", () => {
  const mediaHeader = "@media (max-width: 480px)";
  const media = blockAfter(css, mediaHeader);
  const breakpoint = Number(mediaHeader.match(/max-width:\s*(\d+)px/)[1]);
  const viewport = 390;
  assert.ok(viewport <= breakpoint, "390px viewport must activate the mobile grammar");
  assert.match(media, /\.sauce-action-row\s*>\s*\*/);

  const row = body(".sauce-action-row");
  const child = rules(media).find((rule) => rule.selector === ".sauce-action-row > *");
  assert.ok(child, "mobile action child rule missing");
  const gap = Number(row.match(/gap:\s*var\([^,]+,\s*(\d+)px\)/)[1]);
  const minimum = Number(child.declarations.match(/min-width:\s*(\d+)px/)[1]);
  const basis = Number(child.declarations.match(/flex:\s*1\s+1\s+(\d+)px/)[1]);
  assert.strictEqual(minimum, 128);
  assert.strictEqual(basis, minimum);
  const computedItemsPerRow = Math.floor((viewport + gap) / (minimum + gap));
  assert.strictEqual(computedItemsPerRow, 2, `390px / (${minimum}px + ${gap}px gap) must compute to exactly two`);
  assert.ok((2 * minimum) + gap <= viewport, "two minimum actions do not fit");
  assert.ok((3 * minimum) + (2 * gap) > viewport, "fixture must discriminate against three-up layout");
});

test("modal public classes use the canonical modal tokens", () => {
  assert.match(body(".sauce-modal-backdrop"), /background:\s*var\(--sauce-backdrop\)/);
  const modal = body(".sauce-modal");
  assert.match(modal, /border-radius:\s*var\(--sauce-radius-modal\)/);
  assert.match(modal, /box-shadow:\s*var\(--sauce-shadow-modal\)/);
  assert.match(body(".sauce-modal-title"), /font-weight:\s*700/);
  assert.match(body(".sauce-modal-footer"), /justify-content:\s*flex-end/);
});

test("reveal, pop, and stagger consume the public motion contract", () => {
  assert.match(css, /@keyframes\s+sauce-reveal\s*\{/);
  assert.match(css, /@keyframes\s+sauce-pop\s*\{/);
  assert.match(body(".sauce-anim-reveal"), /var\(--sauce-dur-reveal\)/);
  assert.match(body(".sauce-anim-pop"), /var\(--sauce-spring\)/);
  for (const nth of ["nth-child(1)", "nth-child(2)", "nth-child(3)", "nth-child(4)", "nth-child(n + 5)"]) {
    assert.match(body(nth), /animation-delay:/);
  }
});

test("C1C-CORE-REDUCED-MOTION-SCOPE covers exactly the ratified roots and surfaces", () => {
  const reduced = blockAfter(css, "@media (prefers-reduced-motion: reduce)");
  assert.doesNotMatch(reduced, /\[class(?:\^|\*)=/, "generic Sauce-prefix selector is forbidden");

  const roots = [
    ".sauce-btn",
    ".sauce-pill:not(:where(.space-daily-dashboard .sauce-pill))",
    ".sauce-pill-toggle",
    ".sauce-action-row",
    ".sauce-modal-backdrop",
    ".sauce-modal",
    ".sauce-modal-title",
    ".sauce-modal-footer",
    ".sauce-anim-reveal",
    ".sauce-anim-pop",
    ".sauce-stagger",
  ];
  const suffixes = ["", "::before", "::after", " *", " *::before", " *::after"];
  const expected = roots.flatMap((root) => suffixes.map((suffix) => root + suffix)).sort();
  const reducedRules = rules(reduced);
  assert.strictEqual(reducedRules.length, 1, "reduced-motion media must contain one exact selector family");
  const actual = reducedRules[0].selector.split(",").map((selector) => selector.trim()).sort();
  assert.deepStrictEqual(actual, expected, "reduced-motion selector family must equal the ratified root/surface product");

  for (const contract of ["animation: none !important", "transition: none !important", "transform: none !important", "scroll-behavior: auto !important"]) {
    assert.ok(reducedRules[0].declarations.includes(contract), "missing reduced-motion contract " + contract);
  }
});

test("C1C-DAILY-STATE-TRANSFORMS-PRESERVED reads real Daily state surfaces outside the core boundary", () => {
  const dailyRules = rules(dailyCss);
  const chevrons = [
    {
      className: ".sauce-section-chevron",
      stateSelector: ".space-daily-dashboard .sauce-section > details[open] > .sauce-section-summary .sauce-section-chevron",
    },
    {
      className: ".sauce-group-chevron",
      stateSelector: ".space-daily-dashboard .sauce-group > details[open] > .sauce-group-header .sauce-group-chevron",
    },
    {
      className: ".sauce-bread-chevron",
      stateSelector: ".space-daily-dashboard .sauce-bread[data-expanded=\"true\"] .sauce-bread-chevron",
    },
  ];
  for (const fixture of chevrons) {
    const base = dailyRules.find((rule) => rule.selector === ".space-daily-dashboard " + fixture.className);
    const expanded = dailyRules.find((rule) => rule.selector === fixture.stateSelector);
    assert.ok(base && /transition:\s*transform/.test(base.declarations), fixture.className + " transition fixture missing");
    assert.ok(expanded && /transform:\s*rotate\(90deg\)/.test(expanded.declarations), fixture.className + " state transform missing");
  }

  assert.ok(dailyRules.some((rule) => rule.selector === ".space-daily-dashboard .sauce-pill"), "real Daily pill fixture missing");
  assert.ok(dailyRules.some((rule) => rule.selector === ".space-daily-dashboard .sauce-pill-dot"), "real Daily pill-dot fixture missing");

  const reduced = blockAfter(css, "@media (prefers-reduced-motion: reduce)");
  const reducedSelectors = rules(reduced)[0].selector.split(",").map((selector) => selector.trim());
  for (const fixture of chevrons) {
    assert.ok(reducedSelectors.every((selector) => !selector.includes(fixture.className)), fixture.className + " leaked into core motion boundary");
  }
  assert.ok(reducedSelectors.every((selector) => !selector.includes(".sauce-pill-dot")), "Daily pill-dot leaked into core motion boundary");
  const pillSelectors = reducedSelectors.filter((selector) => (
    selector.startsWith(".sauce-pill:not(:where(.space-daily-dashboard .sauce-pill))")
  ));
  assert.ok(pillSelectors.length > 0, "core pill motion coverage missing");
  assert.ok(
    pillSelectors.every((selector) => selector.startsWith(".sauce-pill:not(:where(.space-daily-dashboard .sauce-pill))")),
    "every core pill motion selector must structurally exclude the Daily pill subtree",
  );
});

test("manifest routes sauce-core only through snippets and appearance", () => {
  const core = (manifest.snippets || []).find((entry) => entry && entry.name === "sauce-core");
  assert.deepStrictEqual(core, { source: "assets/snippets/sauce-core.css", name: "sauce-core" });
  assert.ok(manifest.appearance && manifest.appearance.enabledCssSnippets.includes("sauce-core"));
  assert.ok(!(manifest.files || []).some((entry) => entry && /sauce-core\.css$/.test(String(entry.source || entry.src || entry.dest || ""))));
});

test("C1C-REAL-MANIFEST-INSTALL repeats the actual styling install idempotently", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-core-install-"));
  try {
    fs.mkdirSync(path.join(vault, "ranch/templater"), { recursive: true });
    fs.mkdirSync(path.join(vault, ".obsidian/plugins/obsidian-style-settings"), { recursive: true });
    fs.copyFileSync(INSTALLER_PATH, path.join(vault, "ranch/templater/platformInstall.js"));
    fs.symlinkSync(path.join(ROOT, "platform/mechanisms"), path.join(vault, "ranch/templater/mechanisms"), "dir");
    fs.writeFileSync(path.join(vault, "ranch/platform-config.json"), JSON.stringify({ workshop_path: ROOT, variables: {} }, null, 2));
    fs.writeFileSync(path.join(vault, "ranch/platform-subscription.json"), JSON.stringify({ mechanisms: [{ name: "styling", version: manifest.version }], blueprints: [] }, null, 2));
    fs.writeFileSync(path.join(vault, "ranch/platform-installed.json"), JSON.stringify({ workshop_version: null, mechanisms: [], blueprints: [], history: [] }, null, 2));
    fs.writeFileSync(path.join(vault, ".obsidian/community-plugins.json"), JSON.stringify(["obsidian-style-settings"]));
    fs.writeFileSync(path.join(vault, ".obsidian/plugins/obsidian-style-settings/manifest.json"), JSON.stringify({ id: "obsidian-style-settings", name: "Style Settings", version: "test" }));
    fs.writeFileSync(path.join(vault, ".obsidian/plugins/obsidian-style-settings/data.json"), "{}\n");

    const run = () => {
      try {
        return execFileSync(process.execPath, [RUN_INSTALL_PATH, vault, "--auto-approve"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        const stdout = error.stdout ? error.stdout.toString() : "";
        const stderr = error.stderr ? error.stderr.toString() : "";
        throw new Error(`real installer failed\n${stdout}\n${stderr}`);
      }
    };
    run();
    const installedAfterFirst = JSON.parse(fs.readFileSync(path.join(vault, "ranch/platform-installed.json"), "utf8"));
    const snippetPath = path.join(vault, ".obsidian/snippets/sauce-core.css");
    const appearancePath = path.join(vault, ".obsidian/appearance.json");
    assert.strictEqual(fs.readFileSync(snippetPath, "utf8"), css, "installed snippet differs from the real source");
    const appearance = JSON.parse(fs.readFileSync(appearancePath, "utf8"));
    assert.ok(appearance.enabledCssSnippets.includes("sauce-core"), "real install did not enable sauce-core");
    const firstMaterializedHash = sha256(fs.readFileSync(snippetPath, "utf8") + "\n" + fs.readFileSync(appearancePath, "utf8"));

    const styling = installedAfterFirst.mechanisms.find((entry) => entry.name === "styling");
    assert.ok(styling, "real installer omitted styling ledger entry");
    styling.version = "0.0.0";
    fs.writeFileSync(path.join(vault, "ranch/platform-installed.json"), JSON.stringify(installedAfterFirst, null, 2));
    const historyBoundary = installedAfterFirst.history.length;
    run();

    const secondMaterializedHash = sha256(fs.readFileSync(snippetPath, "utf8") + "\n" + fs.readFileSync(appearancePath, "utf8"));
    assert.strictEqual(secondMaterializedHash, firstMaterializedHash, "repeat install changed materialized output bytes");
    const installedAfterSecond = JSON.parse(fs.readFileSync(path.join(vault, "ranch/platform-installed.json"), "utf8"));
    const repeatReceipt = installedAfterSecond.history.slice(historyBoundary);
    assert.ok(repeatReceipt.some((entry) => entry.step === "snippets" && entry.name === "styling" && entry.snippet === "sauce-core" && entry.action === "skipped_identical"), "repeat lacks sauce-core skipped_identical receipt");
    assert.ok(repeatReceipt.some((entry) => entry.step === "appearance" && entry.name === "styling" && entry.action === "skipped_existing"), "repeat lacks appearance skipped_existing receipt");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("SB-CSS priority dot, control layout, and dividers are bound", () => {
  const all = rules(css);
  const dot = all.find((rule) => rule.selector === ".sauce-task-priority-dot");
  assert.ok(dot, "missing .sauce-task-priority-dot base rule");
  // box-sizing keeps the bordered level the same 7px as the filled ones; without it
  // the border is added to the width and that row's title shifts right of the others.
  for (const contract of ["width: 7px", "height: 7px", "border-radius: 50%", "flex-shrink: 0",
    "align-self: flex-start", "box-sizing: border-box"]) {
    assert.ok(dot.declarations.includes(contract), "priority dot lost " + contract);
  }
  for (const level of ["highest", "high", "medium", "low", "none"]) {
    assert.ok(all.some((rule) => rule.selector === `.sauce-task-priority-dot.is-${level}`),
      `missing priority dot level: ${level}`);
  }
  for (const selector of [
    ".sauce-todo-filter-controls",
    ".sauce-todo-filter-right",
    ".sauce-todo-filter-sep",
    ".sauce-todo-filter-rule",
  ]) {
    assert.ok(all.some((rule) => rule.selector === selector), `missing layout rule: ${selector}`);
  }

  // The control bar must keep interior room. The active pill paints an 8px glow
  // past its border box and space-between presses the last group against the
  // right edge; with a flush box both get shaved by any clipping ancestor.
  // border-box is what keeps `width: 100%` honest once that padding exists.
  // An unset priority must draw nothing at all: most tasks carry no priority, so
  // a visible ring on every row is noise rather than signal. It keeps its 7px box
  // and 1.5px border so titles stay aligned with rows that DO have a priority.
  const none = all.find((rule) => rule.selector === ".sauce-task-priority-dot.is-none");
  assert.ok(none.declarations.includes("background: transparent"),
    "unset priority dot must not paint a fill");
  assert.ok(none.declarations.includes("border: 1.5px solid transparent"),
    "unset priority dot must keep a 1.5px border for alignment but draw it transparent");
  assert.ok(!/border:[^;]*color-mix/.test(none.declarations),
    "unset priority dot regressed to a visible ring");

  const controls = all.find((rule) => rule.selector === ".sauce-todo-filter-controls");
  assert.ok(controls.declarations.includes("box-sizing: border-box"),
    "control bar lost box-sizing: border-box — padding would overflow its 100% width");
  const bar = controls.declarations.match(/padding:\s*(\d+)px\s+(\d+)px\s+(\d+)px/);
  assert.ok(bar, "control bar lost its three-value padding");
  const [top, side] = bar.slice(1, 3).map(Number);
  assert.ok(top >= 8, `control bar top padding must clear the 8px active-pill glow, got ${top}px`);
  assert.ok(side >= 2, `control bar needs side padding so the last pill is not flush, got ${side}px`);
});

console.log(`\nrun-sauce-core-css: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
