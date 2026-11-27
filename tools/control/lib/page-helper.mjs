import { createHash } from "node:crypto";

/**
 * Runs inside the app window. Serialized with Function.prototype.toString and
 * installed once per page load as `window.__dwctl`; it must not reference
 * anything outside its own body.
 */
function installPageHelper(version) {
  if (window.__dwctl?.version === version) return version;
  const INTERACTIVE = [
    "button",
    "a[href]",
    "input:not([type=hidden])",
    "textarea",
    "select",
    "summary",
    "[contenteditable='']",
    "[contenteditable='true']",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=menuitemradio]",
    "[role=menuitemcheckbox]",
    "[role=option]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=treeitem]",
    "[role=combobox]",
    "[role=slider]",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const refs = new Map();
  let nextRef = 1;

  const clean = (text, limit = 80) =>
    (text ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

  function visible(element) {
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const style = getComputedStyle(element);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      Number(style.opacity) > 0.01
    );
  }

  function name(element) {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelled = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "";
    return clean(
      element.getAttribute("aria-label") ||
        labelled ||
        element.labels?.[0]?.textContent ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder") ||
        element.getAttribute("alt") ||
        element.innerText ||
        element.value
    );
  }

  function role(element) {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input")
      return element.type === "checkbox" ? "checkbox" : "textbox";
    if (tag === "textarea" || element.isContentEditable) return "textbox";
    if (tag === "select") return "combobox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "button" || tag === "summary") return "button";
    return getComputedStyle(element).cursor === "pointer" ? "clickable" : tag;
  }

  function describe(element) {
    const box = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    const description = {
      role: role(element),
      name: name(element),
      tag
    };
    const classes = clean(
      typeof element.className === "string" ? element.className : "",
      120
    );
    if (classes) description.class = classes;
    if (element.disabled || element.getAttribute("aria-disabled") === "true")
      description.disabled = true;
    const checkable =
      element.type === "checkbox" || element.type === "radio"
        ? String(element.checked)
        : element.getAttribute("aria-checked");
    if (checkable) description.checked = checkable === "true";
    const selected = element.getAttribute("aria-selected");
    if (selected) description.selected = selected === "true";
    const expanded = element.getAttribute("aria-expanded");
    if (expanded) description.expanded = expanded === "true";
    if (
      "value" in element &&
      tag !== "button" &&
      typeof element.value === "string"
    )
      description.value = clean(element.value, 200);
    description.box = [box.x, box.y, box.width, box.height].map(Math.round);
    return description;
  }

  /** Outermost pointer-cursor elements catch Vue click handlers on divs. */
  function clickables(root) {
    const found = new Set(root.querySelectorAll(INTERACTIVE));
    for (const element of root.querySelectorAll("div, span, li, label, svg")) {
      if (found.has(element)) continue;
      if (getComputedStyle(element).cursor !== "pointer") continue;
      const parent = element.parentElement;
      if (parent && getComputedStyle(parent).cursor === "pointer") continue;
      found.add(element);
    }
    return [...found];
  }

  function covered(element) {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "offscreen";
    const top = document.elementFromPoint(x, y);
    if (
      !top ||
      top === element ||
      element.contains(top) ||
      top.contains(element)
    )
      return undefined;
    return top;
  }

  function scope(within) {
    if (!within) return document;
    const element = resolve(within).element;
    return element;
  }

  function snapshot({ within, all } = {}) {
    refs.clear();
    nextRef = 1;
    const root = scope(within);
    const items = [];
    for (const element of clickables(root)) {
      if (!visible(element)) continue;
      const hidden = covered(element);
      if (hidden && !all) continue;
      const ref = `e${nextRef++}`;
      refs.set(ref, new WeakRef(element));
      items.push({
        ref,
        ...describe(element),
        ...(hidden === "offscreen"
          ? { offscreen: true }
          : hidden
            ? { covered: true }
            : {})
      });
      if (items.length >= 400) break;
    }
    const dialogs = [
      ...root.querySelectorAll(
        "[role=dialog], [role=alertdialog], dialog[open]"
      )
    ]
      .filter(visible)
      .map((dialog) => ({
        name: name(dialog.querySelector("h1, h2, h3, [class*=title]") ?? dialog)
      }));
    const headings = [...root.querySelectorAll("h1, h2, h3")]
      .filter(visible)
      .map((heading) => clean(heading.innerText))
      .filter(Boolean)
      .slice(0, 20);
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      dialogs,
      headings,
      count: items.length,
      elements: items
    };
  }

  function ownText(element) {
    return clean(element.innerText ?? element.textContent, 400);
  }

  function attributeName(element) {
    return clean(
      element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.getAttribute("placeholder")
    );
  }

  /** Cheap textContent check first; innerText forces layout. */
  function textOf(element, wanted) {
    if ((element.textContent ?? "").replace(/\s+/g, " ").includes(wanted))
      return ownText(element);
    return attributeName(element);
  }

  /** Smallest visible elements whose text matches, lifted to their control. */
  function byText(text, exact) {
    const wanted = clean(text, 400);
    const hit = (element) => {
      const value = textOf(element, wanted);
      return exact ? value === wanted : value.includes(wanted);
    };
    const matches = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT
    );
    for (let node = walker.currentNode; node; node = walker.nextNode()) {
      if (!hit(node) || !visible(node)) continue;
      const narrower = [...node.children].some(
        (child) => hit(child) && visible(child)
      );
      if (!narrower) matches.push(node);
    }
    const lifted = matches.map(
      (element) =>
        element.closest(INTERACTIVE) ?? clickableAncestor(element) ?? element
    );
    return [...new Set(lifted)];
  }

  function clickableAncestor(element) {
    for (
      let node = element;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (getComputedStyle(node).cursor === "pointer") {
        let top = node;
        while (
          top.parentElement &&
          top.parentElement !== document.body &&
          getComputedStyle(top.parentElement).cursor === "pointer"
        )
          top = top.parentElement;
        return top;
      }
    }
    return undefined;
  }

  function byLabel(label) {
    const wanted = clean(label, 400);
    return [
      ...document.querySelectorAll(
        INTERACTIVE + ",[aria-label],[placeholder],[title]"
      )
    ].filter((element) => visible(element) && name(element) === wanted);
  }

  function candidates(locator) {
    switch (locator.kind) {
      case "ref": {
        const element = refs.get(locator.value)?.deref();
        return element?.isConnected ? [element] : [];
      }
      case "css":
        return [...document.querySelectorAll(locator.value)].filter(visible);
      case "label":
        return byLabel(locator.value);
      case "text": {
        const exact = byText(locator.value, true);
        return exact.length > 0 ? exact : byText(locator.value, false);
      }
      default:
        throw new Error(`unknown locator ${locator.kind}`);
    }
  }

  /** Something under an open dialog is never what the agent means. */
  function preferReachable(matches) {
    let found = matches;
    if (found.length < 2) return found;
    const dialogs = [
      ...document.querySelectorAll(
        "[role=dialog], [role=alertdialog], dialog[open]"
      )
    ].filter(visible);
    const top = dialogs.at(-1);
    if (top) {
      const inside = found.filter((element) => top.contains(element));
      if (inside.length > 0) found = inside;
    }
    const reachable = found.filter((element) => !isBlocked(element));
    return reachable.length > 0 ? reachable : found;
  }

  function isBlocked(element) {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2
    );
    if (!top) return false;
    return !(top === element || element.contains(top) || top.contains(element));
  }

  function resolve(locator) {
    const found = preferReachable(candidates(locator));
    if (found.length === 0) {
      const error = new Error("not_found");
      error.dwctl = { code: "not_found" };
      throw error;
    }
    if (found.length > 1 && locator.nth === undefined) {
      const error = new Error("ambiguous");
      error.dwctl = {
        code: "ambiguous",
        matches: found.slice(0, 10).map(describe)
      };
      throw error;
    }
    const element = found[locator.nth ?? 0];
    if (!element) {
      const error = new Error("not_found");
      error.dwctl = { code: "not_found", count: found.length };
      throw error;
    }
    return { element, count: found.length };
  }

  function run(action) {
    try {
      return { ok: true, value: action() };
    } catch (error) {
      return {
        ok: false,
        error: error.dwctl ?? { code: "exception", message: String(error) }
      };
    }
  }

  function target(locator) {
    const { element } = resolve(locator);
    element.scrollIntoView({ block: "center", inline: "center" });
    return describe(element);
  }

  const STYLE_PROPERTIES = [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "border-top-width",
    "border-top-style",
    "border-top-color",
    "border-radius",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "height",
    "min-height",
    "gap",
    "box-shadow",
    "opacity",
    "text-align",
    "cursor"
  ];

  function styleOf(element, properties = STYLE_PROPERTIES) {
    const style = getComputedStyle(element);
    const result = {};
    for (const property of properties) {
      result[property] =
        property === "height"
          ? `${Math.round(element.getBoundingClientRect().height)}px`
          : style.getPropertyValue(property);
    }
    return result;
  }

  function same(a, b) {
    const left = resolve(a).element;
    const right = resolve(b).element;
    const leftStyle = styleOf(left);
    const rightStyle = styleOf(right);
    const differences = STYLE_PROPERTIES.filter(
      (property) => leftStyle[property] !== rightStyle[property]
    ).map((property) => ({
      property,
      a: leftStyle[property],
      b: rightStyle[property]
    }));
    return {
      a: describe(left),
      b: describe(right),
      same: differences.length === 0,
      differences,
      shared: Object.fromEntries(
        STYLE_PROPERTIES.filter(
          (property) => leftStyle[property] === rightStyle[property]
        ).map((property) => [property, leftStyle[property]])
      )
    };
  }

  const AUDIT_KINDS = {
    button: "button, [role=button]",
    input:
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [role=combobox]",
    menuitem:
      "[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=option]",
    tab: "[role=tab]",
    switch: "[role=switch], input[type=checkbox]",
    dialog: "[role=dialog], [role=alertdialog], dialog[open]",
    heading: "h1, h2, h3, h4"
  };
  const AUDIT_PROPERTIES = {
    button: [
      "font-size",
      "font-weight",
      "height",
      "padding-left",
      "padding-right",
      "border-radius",
      "border-top-width",
      "color",
      "background-color",
      "border-top-color"
    ],
    input: [
      "font-size",
      "height",
      "padding-left",
      "border-radius",
      "border-top-width",
      "border-top-color",
      "background-color",
      "color"
    ],
    menuitem: ["font-size", "height", "padding-left", "border-radius", "color"],
    tab: [
      "font-size",
      "font-weight",
      "height",
      "padding-left",
      "border-radius",
      "color"
    ],
    switch: ["height", "border-radius"],
    dialog: [
      "border-radius",
      "padding-top",
      "padding-left",
      "box-shadow",
      "background-color"
    ],
    heading: ["font-size", "font-weight", "line-height", "color"]
  };

  /** Focused, selected and disabled controls are meant to look different. */
  function stateOf(element) {
    const flags = [];
    if (element === document.activeElement || element.matches(":focus-within"))
      flags.push("focused");
    if (element.disabled || element.getAttribute("aria-disabled") === "true")
      flags.push("disabled");
    if (
      ["aria-selected", "aria-pressed", "aria-checked", "aria-current"].some(
        (name) => {
          const value = element.getAttribute(name);
          return value && value !== "false";
        }
      ) ||
      element.checked ||
      /(?:^|[\s_-])(?:active|selected|current|checked|primary|danger)(?:$|[\s_-])/i.test(
        typeof element.className === "string" ? element.className : ""
      )
    )
      flags.push("marked");
    return flags.join(",");
  }

  /** Sizes within 25% (or 2px) and weights within 100 count as near. */
  function close(a, b) {
    const left = parseFloat(a);
    const right = parseFloat(b);
    if (Number.isNaN(left) || Number.isNaN(right) || /rgb|#/.test(a))
      return true;
    const limit = Math.max(2, Math.max(Math.abs(left), Math.abs(right)) * 0.25);
    return (
      Math.abs(left - right) <= (left >= 100 && right >= 100 ? 100 : limit)
    );
  }

  /**
   * Groups same-kind elements by computed style. Variants that differ in only
   * one or two properties are the likely accidents: a 6px radius beside 8px,
   * 13px text beside 14px.
   */
  function audit({ within, kinds } = {}) {
    const root = scope(within);
    const result = {};
    for (const [kind, selector] of Object.entries(AUDIT_KINDS)) {
      if (kinds && !kinds.includes(kind)) continue;
      const properties = AUDIT_PROPERTIES[kind];
      const groups = new Map();
      for (const element of root.querySelectorAll(selector)) {
        if (!visible(element)) continue;
        const style = styleOf(element, properties);
        const state = stateOf(element);
        const key = JSON.stringify([state, style]);
        const group = groups.get(key) ?? {
          state,
          style,
          count: 0,
          examples: []
        };
        group.count += 1;
        if (group.examples.length < 3) {
          const {
            role: _role,
            tag: _tag,
            box: _box,
            ...example
          } = describe(element);
          group.examples.push(example);
        }
        groups.set(key, group);
      }
      const variants = [...groups.values()].sort((a, b) => b.count - a.count);
      if (variants.length === 0) continue;
      const nearMisses = [];
      for (let i = 0; i < variants.length; i += 1) {
        for (let j = i + 1; j < variants.length; j += 1) {
          if (variants[i].state !== variants[j].state) continue;
          const differences = properties.filter(
            (property) =>
              variants[i].style[property] !== variants[j].style[property]
          );
          const near = differences.every((property) =>
            close(variants[i].style[property], variants[j].style[property])
          );
          if (differences.length > 0 && differences.length <= 2 && near) {
            nearMisses.push({
              variants: [i, j],
              differences: differences.map((property) => ({
                property,
                values: [
                  variants[i].style[property],
                  variants[j].style[property]
                ]
              })),
              examples: [variants[i].examples[0], variants[j].examples[0]]
            });
          }
        }
      }
      result[kind] = {
        elements: variants.reduce((sum, variant) => sum + variant.count, 0),
        variantCount: variants.length,
        variants: variants.slice(0, 12).map((variant, index) => ({
          index,
          ...variant,
          state: variant.state || "normal"
        })),
        nearMisses: nearMisses.slice(0, 20)
      };
    }
    return result;
  }

  window.__dwctl = {
    version,
    snapshot,
    run,
    target,
    element: (locator) => resolve(locator).element,
    same,
    audit,
    exists: (locator) => candidates(locator).length > 0
  };
  return version;
}

// A changed helper replaces the copy an open page already has.
const HELPER_VERSION = createHash("sha256")
  .update(installPageHelper.toString())
  .digest("hex")
  .slice(0, 12);

export const INSTALL_PAGE_HELPER = `(${installPageHelper.toString()})(${JSON.stringify(HELPER_VERSION)})`;
