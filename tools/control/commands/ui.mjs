import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectPage } from "../lib/browser.mjs";
import { openControlSession } from "../lib/control-client.mjs";
import { captureWindow } from "../lib/main-process.mjs";
import { CliError } from "../lib/output.mjs";
import { INSTALL_PAGE_HELPER } from "../lib/page-helper.mjs";
import { resolveArtifactPath } from "../lib/paths.mjs";
import { cropImage, decodePng, diffImages, encodePng } from "../lib/png.mjs";
import { countOption, secondsOption } from "../lib/runner.mjs";

const LOCATOR_OPTIONS = {
  ref: {
    type: "string",
    valueName: "引用",
    description:
      "ui snapshot 给出的元素引用，如 e12（页面变化后要重新 snapshot）"
  },
  text: {
    type: "string",
    valueName: "文字",
    description:
      "可见文字，先精确匹配再包含匹配，自动提升到可点击的祖先；有弹窗时优先取弹窗里的"
  },
  selector: { type: "string", valueName: "CSS", description: "CSS 选择器" },
  label: {
    type: "string",
    valueName: "名称",
    description: "aria-label、title 或 placeholder 完全相同"
  },
  role: {
    type: "string",
    valueName: "角色",
    description:
      "Playwright getByRole 的角色，如 button、tab、dialog，配合 --name"
  },
  name: {
    type: "string",
    valueName: "名称",
    description: "与 --role 一起用的可访问名称（精确匹配）"
  },
  nth: {
    type: "string",
    valueName: "序号",
    description: "匹配到多个时取第几个，从 0 开始"
  }
};
const FORCE = {
  type: "boolean",
  description:
    "跳过 Playwright 的可操作性检查（被遮挡也点下去，点到的是遮挡物）"
};
const LOCATOR_ERRORS = {
  "ui.not_found": "没找到目标，先 ui snapshot 看当前可见元素",
  "ui.ambiguous": "匹配到多个，按 details.matches 加 --nth 或改用 --ref",
  "ui.covered": "目标被弹层遮挡，先关掉弹层或确认后加 --force",
  "ui.action_timeout": "目标一直不可操作（不可见、禁用或在动），看 details.log",
  "app.cdp_unavailable": "实例没在运行，先 env start"
};
const SETTLE_MS = 300;
const ACTION_TIMEOUT_MS = 5_000;
const APPEARANCE_MODULE = "/src/composables/useAppearance.ts";

export function assertThemeApplied(requested, actual) {
  const modeMismatch =
    Boolean(requested.mode) &&
    (actual?.settings?.mode !== requested.mode ||
      ((requested.mode === "light" || requested.mode === "dark") &&
        actual?.applied !== requested.mode));
  const uiFontMismatch =
    requested.sizes.uiFontSize !== undefined &&
    actual?.settings?.light?.uiFontSize !== requested.sizes.uiFontSize;
  const editorFontMismatch =
    requested.sizes.editorFontSize !== undefined &&
    actual?.settings?.light?.editorFontSize !== requested.sizes.editorFontSize;
  if (modeMismatch || uiFontMismatch || editorFontMismatch) {
    throw new CliError(
      "ui.theme_failed",
      "外观切换未生效，页面可能已热更新。",
      {
        exitCode: 1,
        nextSteps: [
          "运行 pnpm -s ctl ui reload 刷新页面后重试",
          `若外观模块路径变化，更新 tools/control/commands/ui.mjs 的 APPEARANCE_MODULE（当前 ${APPEARANCE_MODULE}）`
        ],
        details: { requested, actual }
      }
    );
  }
}

function locatorFrom(options) {
  const kinds = [
    ["ref", options.ref],
    ["text", options.text],
    ["css", options.selector],
    ["label", options.label],
    ["role", options.role]
  ].filter(([, value]) => value !== undefined && value !== "");
  if (kinds.length !== 1) {
    throw new CliError(
      "cli.invalid_arguments",
      kinds.length === 0
        ? "需要一个目标：--ref、--text、--selector、--label 或 --role。"
        : "目标只能给一种：--ref、--text、--selector、--label、--role 选一个。",
      { nextSteps: ["先运行 pnpm -s ctl ui snapshot 找到元素引用"] }
    );
  }
  return {
    kind: kinds[0][0],
    value: String(kinds[0][1]),
    ...(kinds[0][0] === "role" && options.name !== undefined
      ? { name: String(options.name) }
      : {}),
    ...(options.nth !== undefined ? { nth: Number(options.nth) } : {})
  };
}

function hasTarget(options) {
  return Boolean(
    options.ref ||
    options.text ||
    options.selector ||
    options.label ||
    options.role
  );
}

/** `text=保存`, `ref=e3`, `css=.x`, `label=搜索`, optional `#2` for nth. */
function parseLocatorString(value, name) {
  const match = /^(ref|text|css|label)=(.+?)(?:#(\d+))?$/u.exec(value ?? "");
  if (!match) {
    throw new CliError(
      "cli.invalid_arguments",
      `--${name} 的格式是 类型=值，如 text=保存 或 css=.btn#1。`,
      {
        nextSteps: ["类型可选 ref、text、css、label；#序号 可选"]
      }
    );
  }
  return {
    kind: match[1],
    value: match[2],
    ...(match[3] ? { nth: Number(match[3]) } : {})
  };
}

async function installHelper(app) {
  const { exception } = await app.evaluate(INSTALL_PAGE_HELPER);
  if (exception) {
    throw new CliError("ui.helper_failed", "无法在窗口里安装定位脚本。", {
      nextSteps: ["运行 pnpm -s ctl env doctor 检查窗口是否正常加载"],
      details: { exception }
    });
  }
}

async function helper(app, call) {
  await installHelper(app);
  const { value, exception } = await app.evaluate(
    `window.__dwctl.run(() => ${call})`
  );
  if (exception) {
    throw new CliError("ui.page_error", "页面脚本出错。", {
      exitCode: 1,
      nextSteps: ["运行 pnpm -s ctl logs errors 查看页面报错"],
      details: { exception }
    });
  }
  if (!value.ok) throw helperError(value.error);
  return value.value;
}

function helperError(error) {
  if (error.code === "not_found") {
    return new CliError("ui.not_found", "窗口里没有找到目标元素。", {
      exitCode: 1,
      nextSteps: [
        "运行 pnpm -s ctl ui snapshot 查看当前可见元素",
        "目标还没出现时先 pnpm -s ctl ui wait --text <文字>"
      ],
      details: error
    });
  }
  if (error.code === "ambiguous") {
    return new CliError("ui.ambiguous", "匹配到多个元素。", {
      exitCode: 1,
      nextSteps: [
        "按 details.matches 选一个，加 --nth <序号>，或改用 ui snapshot 的 --ref"
      ],
      details: error
    });
  }
  if (error.code === "no_option") {
    return new CliError("ui.no_option", "下拉框里没有这个选项。", {
      exitCode: 1,
      nextSteps: ["按 details.options 选一个存在的选项"],
      details: error
    });
  }
  return new CliError(
    "ui.page_error",
    `页面脚本出错：${error.message ?? error.code}`,
    {
      exitCode: 1,
      nextSteps: ["检查参数；--selector 要是合法的 CSS"],
      details: error
    }
  );
}

/** Turns Playwright's actionability failures into steps an agent can take. */
function actionError(error, target) {
  if (error instanceof CliError) return error;
  const lines = String(error.message)
    .split("\n")
    .map((line) => line.trim());
  const log = lines.filter(Boolean).slice(0, 8);
  const blocker = lines.find((line) =>
    line.includes("intercepts pointer events")
  );
  if (blocker) {
    return new CliError(
      "ui.covered",
      "目标被其他元素遮挡，点击会落到遮挡物上。",
      {
        exitCode: 1,
        nextSteps: [
          "先关闭遮挡的弹层或菜单，例如 pnpm -s ctl ui press Escape",
          "确认就是要点遮挡位置时加 --force"
        ],
        details: { target, coveredBy: blocker.slice(0, 300) }
      }
    );
  }
  if (/not an <input>|contenteditable|Cannot type/iu.test(error.message)) {
    return new CliError("ui.not_fillable", "目标不是输入框或可编辑区域。", {
      exitCode: 1,
      nextSteps: ["改指向输入框本身（ui snapshot 里 role 为 textbox 的元素）"],
      details: { target, log }
    });
  }
  return new CliError(
    error.name === "TimeoutError" ? "ui.action_timeout" : "ui.action_failed",
    error.name === "TimeoutError"
      ? "目标在限定时间内一直不可操作。"
      : `操作失败：${lines[0]}`,
    {
      exitCode: 1,
      nextSteps: [
        "看 details.log：不可见、禁用、仍在动画中或被遮挡",
        "运行 pnpm -s ctl ui screenshot 看当前画面"
      ],
      details: { target, log }
    }
  );
}

/**
 * Resolves the target to something Playwright can act on. Text, label, ref
 * and CSS go through the page helper (dialog-first, lifted to the control);
 * --role uses Playwright's own getByRole.
 */
async function aim(app, locator) {
  if (locator.kind === "role") {
    const matches = app.page.getByRole(locator.value, {
      ...(locator.name !== undefined ? { name: locator.name, exact: true } : {})
    });
    const count = await matches.count();
    if (count === 0) throw helperError({ code: "not_found" });
    if (count > 1 && locator.nth === undefined) {
      throw helperError({
        code: "ambiguous",
        matches: await matches.evaluateAll((elements) =>
          elements.slice(0, 10).map((element) => ({
            tag: element.tagName.toLowerCase(),
            name: (
              element.getAttribute("aria-label") ||
              element.innerText ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80)
          }))
        )
      });
    }
    const handle = matches.nth(locator.nth ?? 0);
    return { handle, target: { role: locator.value, name: locator.name } };
  }
  const target = await helper(
    app,
    `window.__dwctl.target(${JSON.stringify(locator)})`
  );
  const handle = await app.page.evaluateHandle(
    (value) => globalThis.__dwctl.element(value),
    locator
  );
  return { handle: handle.asElement(), target };
}

async function brief(app) {
  const { value } = await app.evaluate(`(() => {
    const visible = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const active = document.activeElement;
    return {
      url: location.href,
      dialogs: [...document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open]')].filter(visible).length,
      focused: active && active !== document.body
        ? (active.getAttribute('aria-label') || active.getAttribute('placeholder') || active.tagName.toLowerCase())
        : null
    };
  })()`);
  return value;
}

async function withPage(layout, action, timeoutMs = 30_000) {
  const app = await connectPage(layout, { timeoutMs });
  try {
    return await action(app);
  } finally {
    await app.close();
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

/**
 * Captured by Main (webContents.capturePage with stayHidden), then cropped
 * here for elements. CDP captures hang once macOS stops painting a covered
 * window, and in Electron a clipped CDP capture also leaves its size emulated
 * on the real window.
 */
async function screenshotTo(app, file, locator, layout) {
  await mkdir(dirname(file), { recursive: true });
  let box;
  if (locator) {
    const { handle } = await aim(app, locator);
    box = await handle.boundingBox();
    if (!box) throw helperError({ code: "not_found" });
  }
  const scale = await app.page.evaluate("devicePixelRatio");
  let png = await captureWindow(layout);
  if (box) {
    const cropped = cropImage(decodePng(png), box, scale);
    if (!cropped) {
      throw new CliError("ui.offscreen", "目标不在可视区域内。", {
        exitCode: 1,
        nextSteps: ["用 pnpm -s ctl ui viewport 调大窗口后再截"],
        details: { box }
      });
    }
    png = encodePng(cropped);
  }
  await writeFile(file, png);
  return file;
}

async function act(app, options, perform) {
  const { handle, target } = await aim(app, locatorFrom(options));
  try {
    await perform(handle, target);
  } catch (error) {
    throw actionError(error, target);
  }
  return target;
}

const actionOptions = (options) => ({
  timeout: ACTION_TIMEOUT_MS,
  ...(options.force ? { force: true } : {})
});

const OPTION_ROLES = [
  "option",
  "menuitemradio",
  "menuitem",
  "menuitemcheckbox"
];

/** An opened popup's choice: by role first, so text behind the popup never wins. */
async function pickOption(app, label) {
  for (const role of OPTION_ROLES) {
    const matches = app.page.getByRole(role, { name: label, exact: true });
    if ((await matches.count()) > 0) {
      return { handle: matches.first(), target: { role, name: label } };
    }
  }
  const visible = [];
  for (const role of OPTION_ROLES) {
    visible.push(
      ...(await app.page
        .getByRole(role)
        .evaluateAll((elements) =>
          elements
            .filter((element) => element.getBoundingClientRect().height > 0)
            .map((element) =>
              (element.innerText || "").replace(/\s+/g, " ").trim()
            )
        ))
    );
  }
  if (visible.length > 0) {
    throw helperError({ code: "no_option", options: visible.slice(0, 40) });
  }
  return aim(app, { kind: "text", value: label, nth: 0 });
}

/** One implementation per action, shared by the commands and by `ui flow`. */
const actions = {
  async click(app, options) {
    const target = await act(app, options, (handle) =>
      handle.click({
        ...actionOptions(options),
        button: options.right ? "right" : "left",
        clickCount: options.double ? 2 : 1
      })
    );
    await delay(SETTLE_MS);
    return { target, after: await brief(app) };
  },
  async hover(app, options) {
    const target = await act(app, options, (handle) =>
      handle.hover(actionOptions(options))
    );
    await delay(SETTLE_MS);
    return { target };
  },
  async fill(app, options) {
    if (options.value === undefined) {
      throw new CliError("cli.invalid_arguments", "需要 --value。", {
        nextSteps: ["例如 pnpm -s ctl ui fill --label 搜索 --value 雾港"]
      });
    }
    let value;
    const target = await act(app, options, async (handle) => {
      if (options.append) {
        await handle.click(actionOptions(options));
        await handle.evaluate((element) => {
          if (typeof element.setSelectionRange === "function") {
            element.setSelectionRange(
              element.value.length,
              element.value.length
            );
            return;
          }
          const range = element.ownerDocument.createRange();
          range.selectNodeContents(element);
          range.collapse(false);
          const selection = element.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        });
        await app.page.keyboard.insertText(options.value);
      } else {
        await handle.fill(options.value, actionOptions(options));
      }
      await delay(SETTLE_MS);
      value = await handle.evaluate((element) =>
        typeof element.value === "string" ? element.value : element.innerText
      );
    });
    return {
      target,
      value,
      matches: options.append
        ? value.trimEnd().endsWith(options.value.trimEnd())
        : value.trim() === options.value.trim()
    };
  },
  async press(app, options) {
    if (!options.keys) {
      throw new CliError("cli.invalid_arguments", "需要要按的键。", {
        nextSteps: ["例如 pnpm -s ctl ui press Escape 或 ui press Meta+k"]
      });
    }
    const keys = String(options.keys).split(/\s+/u).filter(Boolean);
    try {
      if (hasTarget(options)) {
        await act(app, options, async (handle) => {
          for (const key of keys)
            await handle.press(key, actionOptions(options));
        });
      } else {
        for (const key of keys) await app.page.keyboard.press(key);
      }
    } catch (error) {
      if (/Unknown key/iu.test(error.message)) {
        throw new CliError(
          "cli.invalid_arguments",
          `不认识的按键：${error.message.split("\n")[0]}`,
          {
            nextSteps: [
              "按键名同 Playwright：Escape、Enter、Tab、Backspace、ArrowDown、Meta+a、ControlOrMeta+n、Shift+Tab"
            ]
          }
        );
      }
      throw actionError(error);
    }
    await delay(SETTLE_MS);
    return { keys, after: await brief(app) };
  },
  async select(app, options) {
    if (!options.option) {
      throw new CliError("cli.invalid_arguments", "需要 --option。", {
        nextSteps: [
          "例如 pnpm -s ctl ui select --label 模型 --option Deepseek-v4.1-flash"
        ]
      });
    }
    const { handle, target } = await aim(app, locatorFrom(options));
    const native = await handle.evaluate(
      (element) => element.tagName === "SELECT"
    );
    try {
      if (native) {
        const values = await handle
          .selectOption(
            [{ label: options.option }, { value: options.option }].filter(
              Boolean
            ),
            actionOptions(options)
          )
          .catch(() =>
            handle.selectOption(options.option, actionOptions(options))
          );
        await delay(SETTLE_MS);
        return { native: true, target, value: values[0] };
      }
      const expanded = await handle.evaluate(
        (element) => element.getAttribute("aria-expanded") === "true"
      );
      if (!expanded) {
        await handle.click(actionOptions(options));
        await delay(SETTLE_MS);
      }
      let option;
      try {
        option = await pickOption(app, options.option);
      } catch (error) {
        // Leave the popup closed, as it was before the command.
        await handle.click(actionOptions(options)).catch(() => undefined);
        throw error;
      }
      try {
        await option.handle.click(actionOptions(options));
      } catch (error) {
        throw actionError(error, option.target);
      }
      await delay(SETTLE_MS);
      return {
        native: false,
        target,
        option: option.target,
        after: await brief(app)
      };
    } catch (error) {
      throw actionError(error, target);
    }
  },
  async drag(app, options) {
    const from = await aim(app, locatorFrom(options));
    const start = await from.handle.boundingBox();
    if (!start) throw helperError({ code: "not_found" });
    const origin = {
      x: start.x + start.width / 2,
      y: start.y + start.height / 2
    };
    let to;
    if (options.to) {
      const end = await (
        await aim(app, parseLocatorString(options.to, "to"))
      ).handle.boundingBox();
      to = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
    } else if (options.by) {
      const [dx, dy] = String(options.by).split(",").map(Number);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        throw new CliError(
          "cli.invalid_arguments",
          "--by 的格式是 dx,dy，如 120,0。",
          {
            nextSteps: ["例如 --by=-80,0 把分栏向左拖 80 像素（负数要用等号）"]
          }
        );
      }
      to = { x: origin.x + dx, y: origin.y + dy };
    } else {
      throw new CliError("cli.invalid_arguments", "需要 --to 或 --by。", {
        nextSteps: ["例如 --to text=第三节 或 --by 120,0"]
      });
    }
    const mouse = app.page.mouse;
    await mouse.move(origin.x, origin.y);
    await mouse.down();
    await mouse.move(to.x, to.y, { steps: 12 });
    await mouse.up();
    await delay(SETTLE_MS);
    return {
      from: from.target,
      to: { x: Math.round(to.x), y: Math.round(to.y) }
    };
  },
  async wait(app, options) {
    const timeoutMs = secondsOption(options.timeout, "timeout", 10);
    if (options.ms !== undefined) {
      await delay(Number(options.ms));
      return { waitedMs: Number(options.ms) };
    }
    const locator = locatorFrom(options);
    const wanted = !options.gone;
    const started = Date.now();
    const timedOut = () =>
      new CliError(
        "ui.wait_timeout",
        wanted ? "等待的元素一直没有出现。" : "等待消失的元素一直还在。",
        {
          exitCode: 1,
          nextSteps: [
            "运行 pnpm -s ctl ui screenshot 看当前画面",
            "运行 pnpm -s ctl logs errors 看是否有报错",
            "操作本身较慢时加大 --timeout"
          ],
          details: { locator, timeoutMs }
        }
      );
    if (locator.kind === "role") {
      const matches = app.page.getByRole(locator.value, {
        ...(locator.name !== undefined
          ? { name: locator.name, exact: true }
          : {})
      });
      await matches
        .nth(locator.nth ?? 0)
        .waitFor({ state: wanted ? "visible" : "hidden", timeout: timeoutMs })
        .catch(() => {
          throw timedOut();
        });
      return { waitedMs: Date.now() - started, present: wanted };
    }
    // The helper is reinstalled each round: a navigation or reload drops it.
    for (;;) {
      await installHelper(app);
      const { value } = await app.evaluate(
        `window.__dwctl.exists(${JSON.stringify(locator)})`
      );
      if (value === wanted)
        return { waitedMs: Date.now() - started, present: value };
      if (Date.now() - started > timeoutMs) throw timedOut();
      await delay(200);
    }
  },
  async screenshot(app, options, context) {
    const name = options.name ?? "window";
    const file = resolveArtifactPath(
      context.layout,
      options.out ??
        join(
          context.layout.artifacts,
          "screenshots",
          `${timestamp()}-${name}.png`
        )
    );
    await screenshotTo(
      app,
      file,
      hasTarget(options) ? locatorFrom(options) : undefined,
      context.layout
    );
    return { file };
  },
  async eval(app, options) {
    if (!options.expression) {
      throw new CliError("cli.invalid_arguments", "需要要执行的表达式。", {
        nextSteps: [`例如 pnpm -s ctl ui eval "document.title"`]
      });
    }
    const { value, exception } = await app.evaluate(options.expression);
    if (exception) {
      throw new CliError("ui.eval_failed", "表达式抛出了异常。", {
        exitCode: 1,
        nextSteps: ["按 details.exception 修正表达式"],
        details: { exception }
      });
    }
    return { value: value ?? null };
  }
};

const ACTION_NAMES = Object.keys(actions);

async function runFlow(layout, steps, outDirectory) {
  const results = [];
  const artifacts = [];
  return withPage(
    layout,
    async (page) => {
      for (const [index, step] of steps.entries()) {
        const number = String(index + 1).padStart(2, "0");
        const { do: name, screenshot, ...options } = step;
        if (!actions[name]) {
          throw new CliError(
            "ui.flow_invalid",
            `第 ${index + 1} 步的 do「${name}」不认识。`,
            {
              nextSteps: [`do 可选：${ACTION_NAMES.join("、")}`]
            }
          );
        }
        try {
          const result = await actions[name](
            page,
            name === "screenshot"
              ? {
                  ...options,
                  out: join(
                    outDirectory,
                    `${number}-${options.name ?? "window"}.png`
                  )
                }
              : options,
            { layout }
          );
          if (result.file) artifacts.push(result.file);
          if (screenshot) {
            const file = join(outDirectory, `${number}-${screenshot}.png`);
            artifacts.push(await screenshotTo(page, file, undefined, layout));
          }
          results.push({ step: index + 1, do: name, ok: true, result });
        } catch (error) {
          const file = join(outDirectory, `${number}-failed.png`);
          await screenshotTo(page, file, undefined, layout).catch(
            () => undefined
          );
          artifacts.push(file);
          results.push({
            step: index + 1,
            do: name,
            ok: false,
            error: {
              code: error.code ?? "ui.step_failed",
              message: error.message,
              details: error.details
            }
          });
          return { ok: false, results, artifacts, failedStep: index + 1 };
        }
      }
      return { ok: true, results, artifacts };
    },
    120_000
  );
}

async function imagePairs(a, b) {
  const [aStat, bStat] = await Promise.all([stat(a), stat(b)]);
  if (aStat.isDirectory() !== bStat.isDirectory()) {
    throw new CliError(
      "cli.invalid_arguments",
      "两边要么都是图片，要么都是目录。",
      {
        nextSteps: ["例如 ui compare before/ after/ 或 ui compare a.png b.png"]
      }
    );
  }
  if (!aStat.isDirectory()) return { pairs: [[a, b]], onlyA: [], onlyB: [] };
  const list = async (directory) =>
    (await readdir(directory))
      .filter((name) => extname(name) === ".png")
      .sort();
  const [left, right] = await Promise.all([list(a), list(b)]);
  return {
    pairs: left
      .filter((name) => right.includes(name))
      .map((name) => [join(a, name), join(b, name)]),
    onlyA: left.filter((name) => !right.includes(name)),
    onlyB: right.filter((name) => !left.includes(name))
  };
}

function command(definition, name) {
  return {
    ...definition,
    run: async ({ layout, values, args }) => {
      const options = { ...values, ...args };
      return {
        data: await withPage(layout, (page) =>
          actions[name](page, options, { layout })
        )
      };
    }
  };
}

export const uiCommands = {
  summary:
    "界面：经调试端口操作真实的测试窗口——查看元素、点击输入、等待、截图、流程脚本、截图对比与样式统一性审计",
  commands: {
    snapshot: {
      summary: "列出窗口里当前可见、可交互的元素，并给每个元素一个引用",
      description:
        "只读。返回元素的角色、名称、类名、状态与位置，以及可见的对话框和标题。引用（e1、e2…）在下次 snapshot 或页面刷新前有效，用于 --ref。被遮挡或在可视区外的元素默认不列，加 --all 列出并标注。",
      options: {
        within: {
          type: "string",
          valueName: "定位",
          description: "只看这个区域内，格式同 --to：css=.dialog、text=设置"
        },
        all: { type: "boolean", description: "包括被遮挡和可视区外的元素" }
      },
      examples: [
        "pnpm -s ctl ui snapshot",
        "pnpm -s ctl ui snapshot --within css=[role=dialog]"
      ],
      output: {
        elements: "ref、role、name、class、状态、box[x,y,宽,高]",
        dialogs: "可见对话框",
        headings: "可见标题"
      },
      errors: { "app.cdp_unavailable": "实例没在运行，先 env start" },
      run: async ({ layout, values }) => ({
        data: await withPage(layout, (page) =>
          helper(
            page,
            `window.__dwctl.snapshot(${JSON.stringify({
              ...(values.within
                ? { within: parseLocatorString(values.within, "within") }
                : {}),
              all: Boolean(values.all)
            })})`
          )
        )
      })
    },
    open: {
      summary: "在测试窗口里打开一部作品或一个资料库",
      description:
        "经控制接口 open_in_app 切到目标，等界面稳定后返回窗口状态。",
      options: {
        work: {
          type: "string",
          valueName: "id",
          description: "作品 id，见 data list"
        },
        library: { type: "string", valueName: "id", description: "资料库 id" }
      },
      examples: ["pnpm -s ctl ui open --work book-1234abcd"],
      output: { opened: "open_in_app 的结果", after: "窗口状态" },
      errors: { "app.tool_rejected": "id 不存在或窗口停在设置页" },
      run: async ({ layout, values }) => {
        if (Boolean(values.work) === Boolean(values.library)) {
          throw new CliError(
            "cli.invalid_arguments",
            "--work 与 --library 给一个。",
            {
              nextSteps: ["运行 pnpm -s ctl data list 查看 id"]
            }
          );
        }
        const session = await openControlSession(layout);
        let opened;
        try {
          opened = await session.call(
            "open_in_app",
            values.work
              ? { workId: values.work }
              : { libraryId: values.library }
          );
        } finally {
          session.close();
        }
        await delay(800);
        return { data: { opened, after: await withPage(layout, brief) } };
      }
    },
    click: command(
      {
        summary: "用真实鼠标事件点击一个元素",
        description:
          "滚动到目标、核对没有被遮挡后，在中心点发送鼠标移动、按下、抬起。默认等 300 毫秒再返回窗口状态。",
        options: {
          ...LOCATOR_OPTIONS,
          double: { type: "boolean", description: "双击" },
          right: { type: "boolean", description: "右键" },
          force: FORCE
        },
        examples: [
          "pnpm -s ctl ui click --text 新建书籍",
          "pnpm -s ctl ui click --ref e12",
          "pnpm -s ctl ui click --label 关闭 --nth 1"
        ],
        output: { target: "点到的元素", after: "url、打开的对话框数、焦点" },
        errors: LOCATOR_ERRORS
      },
      "click"
    ),
    fill: command(
      {
        summary: "清空并输入文字（输入框、文本域或编辑器）",
        description:
          "先点击聚焦，再全选替换并用输入法同样的方式插入文字，最后回读核对。--append 时不清空，接在末尾。",
        options: {
          ...LOCATOR_OPTIONS,
          value: {
            type: "string",
            valueName: "文字",
            description: "要输入的内容"
          },
          append: { type: "boolean", description: "不清空，追加" },
          force: FORCE
        },
        examples: ["pnpm -s ctl ui fill --label 书名 --value 雾港来信"],
        output: { value: "回读的内容", matches: "回读是否与输入一致" },
        errors: { ...LOCATOR_ERRORS, "ui.not_fillable": "目标不可输入" }
      },
      "fill"
    ),
    press: command(
      {
        summary: "按键或组合键，可先点击聚焦某个元素",
        description:
          "空格分隔多个按键依次按下。支持 Enter、Escape、Tab、Backspace、方向键等，以及 Meta+k、Control+n、Shift+Tab；Meta+a/c/v/x/z 会执行对应的编辑命令。",
        positionals: [
          {
            name: "keys",
            required: true,
            description: '如 Escape 或 "Meta+a Backspace"'
          }
        ],
        options: { ...LOCATOR_OPTIONS, force: FORCE },
        examples: [
          "pnpm -s ctl ui press Escape",
          "pnpm -s ctl ui press Meta+n",
          "pnpm -s ctl ui press Enter --label 搜索"
        ],
        output: { keys: "按下的键", after: "窗口状态" },
        errors: { "cli.invalid_arguments": "按键名不认识" }
      },
      "press"
    ),
    hover: command(
      {
        summary: "把鼠标移到元素上（看悬停样式或提示）",
        description: "发送鼠标移动事件，等 300 毫秒，可接着 ui screenshot。",
        options: { ...LOCATOR_OPTIONS, force: FORCE },
        examples: ["pnpm -s ctl ui hover --text 智能体团队"],
        output: { target: "悬停的元素" },
        errors: LOCATOR_ERRORS
      },
      "hover"
    ),
    select: command(
      {
        summary: "在下拉框里选一个选项",
        description:
          "原生 <select> 直接设值并派发 change；自定义下拉先点击打开，再点击文字等于 --option 的选项。",
        options: {
          ...LOCATOR_OPTIONS,
          option: {
            type: "string",
            valueName: "选项",
            description: "选项文字或值"
          },
          force: FORCE
        },
        examples: [
          "pnpm -s ctl ui select --text Deepseek-v4.1-flash --option 深度"
        ],
        output: { native: "是否原生下拉", value: "选中的值" },
        errors: { ...LOCATOR_ERRORS, "ui.no_option": "没有这个选项" }
      },
      "select"
    ),
    drag: command(
      {
        summary: "拖动元素到另一个元素或按偏移拖动",
        description: "按下、分 12 步移动、抬起，适用于分栏、排序等拖拽。",
        options: {
          ...LOCATOR_OPTIONS,
          to: {
            type: "string",
            valueName: "定位",
            description: "目标元素：text=…、css=…、ref=…、label=…，可加 #序号"
          },
          by: {
            type: "string",
            valueName: "dx,dy",
            description: "按像素偏移拖动；负数写成 --by=-80,0"
          },
          force: FORCE
        },
        examples: ["pnpm -s ctl ui drag --selector .pane-resizer --by=-120,0"],
        output: { from: "起点元素", to: "终点坐标" },
        errors: LOCATOR_ERRORS
      },
      "drag"
    ),
    wait: command(
      {
        summary: "等某个元素出现或消失，或固定等待",
        description: "每 200 毫秒检查一次，超时退出码为 1。--ms 只做固定等待。",
        options: {
          ...LOCATOR_OPTIONS,
          gone: { type: "boolean", description: "等它消失" },
          ms: { type: "string", valueName: "毫秒", description: "固定等待" },
          timeout: {
            type: "string",
            valueName: "秒",
            default: "10",
            description: "最长等待"
          }
        },
        examples: [
          "pnpm -s ctl ui wait --text 保存成功",
          "pnpm -s ctl ui wait --selector [role=dialog] --gone"
        ],
        output: { waitedMs: "实际等待时间" },
        errors: { "ui.wait_timeout": "超时" }
      },
      "wait"
    ),
    screenshot: command(
      {
        summary: "截取窗口或某个元素",
        description:
          "窗口在其他窗口后面也能截。默认存到测试环境 artifacts/screenshots/；--out 可指向仓库 test/<日期-主题>/ 存档。",
        options: {
          ...LOCATOR_OPTIONS,
          name: {
            type: "string",
            valueName: "名字",
            description: "默认文件名的一部分"
          },
          out: {
            type: "string",
            valueName: "文件",
            description: "输出 PNG 路径（测试环境内或仓库 test/ 下）"
          }
        },
        examples: [
          "pnpm -s ctl ui screenshot --name home",
          "pnpm -s ctl ui screenshot --selector [role=dialog] --out test/2026-11-23-x/dialog.png"
        ],
        output: { file: "截图路径" },
        errors: {
          ...LOCATOR_ERRORS,
          "guard.outside_artifact_roots": "输出路径不允许"
        }
      },
      "screenshot"
    ),
    eval: command(
      {
        summary: "在窗口里执行一段 JavaScript 表达式并返回结果",
        description:
          "表达式可以是 Promise。结果需能转成 JSON。只用于读状态或补充断言，操作界面请用 click、fill 等真实输入。",
        positionals: [
          {
            name: "expression",
            required: true,
            description: "JavaScript 表达式"
          }
        ],
        options: {},
        examples: [
          `pnpm -s ctl ui eval "document.querySelectorAll('[role=treeitem]').length"`
        ],
        output: { value: "表达式结果" },
        errors: { "ui.eval_failed": "表达式抛错" }
      },
      "eval"
    ),
    reload: {
      summary: "重新加载测试窗口（热更新把页面弄坏时用）",
      description:
        "等同在窗口里刷新：页面状态丢失，作品与配置不受影响。适用于热更新后页面空白或状态错乱；改了 Main / Utility 代码要用 env restart。等到控制接口报告窗口就绪再返回。",
      options: {},
      examples: ["pnpm -s ctl ui reload"],
      output: { rendererReady: "窗口是否已就绪", waitedMs: "等待时间" },
      errors: { "ui.reload_timeout": "30 秒内窗口没有就绪" },
      run: async ({ layout }) => {
        const started = Date.now();
        await withPage(layout, (app) =>
          app.page.reload({ waitUntil: "load", timeout: 30_000 })
        );
        for (;;) {
          const status = await openControlSession(layout)
            .then(async (session) => {
              try {
                return await session.call("get_app_status");
              } finally {
                session.close();
              }
            })
            .catch(() => undefined);
          if (status?.rendererReady) {
            return {
              data: { rendererReady: true, waitedMs: Date.now() - started }
            };
          }
          if (Date.now() - started > 30_000) {
            throw new CliError(
              "ui.reload_timeout",
              "重新加载后窗口一直没有就绪。",
              {
                exitCode: 1,
                nextSteps: [
                  "运行 pnpm -s ctl logs errors 查看报错",
                  "运行 pnpm -s ctl env restart"
                ]
              }
            );
          }
          await delay(500);
        }
      }
    },
    focus: {
      summary: "让测试窗口的页面获得焦点（不抢系统前台）",
      description:
        "测试窗口平时没有焦点，document.hasFocus() 为 false。要验证依赖焦点的行为（快捷键、输入框聚焦样式、focus 事件）时先运行它：页面获得焦点并保持到窗口被其他操作夺走为止，系统前台应用不变，不会打断开发者。",
      options: {},
      examples: ["pnpm -s ctl ui focus"],
      output: { hasFocus: "窗口是否拿到焦点" },
      errors: {},
      run: async ({ layout }) => ({
        data: await withPage(layout, async (page) => {
          await page.page.bringToFront();
          await delay(SETTLE_MS);
          const { value } = await page.evaluate("document.hasFocus()");
          return {
            hasFocus: value,
            ...(value
              ? {}
              : { note: "系统没有把焦点交给窗口；依赖焦点的结果记为未验" })
          };
        })
      })
    },
    theme: {
      summary: "切换测试实例的外观：明暗模式与字号",
      description:
        "调用渲染进程自己的外观状态（与设置页同一路径），保存到测试配置，不影响开发者自己的配置。用来在浅色、深色和不同字号下截图核对。applied 是窗口实际生效的明暗。",
      options: {
        mode: {
          type: "string",
          valueName: "light|dark|system",
          description: "外观模式"
        },
        "ui-font-size": {
          type: "string",
          valueName: "像素",
          description: "界面字号（明暗两套同时改）"
        },
        "editor-font-size": {
          type: "string",
          valueName: "像素",
          description: "正文字号"
        }
      },
      examples: [
        "pnpm -s ctl ui theme --mode dark",
        "pnpm -s ctl ui theme --mode light --ui-font-size 16"
      ],
      output: {
        applied: "窗口实际生效的 light 或 dark",
        settings: "保存后的外观设置"
      },
      errors: { "cli.invalid_arguments": "参数值不对" },
      run: async ({ layout, values }) => {
        if (values.mode && !["light", "dark", "system"].includes(values.mode)) {
          throw new CliError(
            "cli.invalid_arguments",
            "--mode 只能是 light、dark 或 system。",
            {
              nextSteps: ["例如 --mode dark"]
            }
          );
        }
        const sizes = {};
        for (const [option, field] of [
          ["ui-font-size", "uiFontSize"],
          ["editor-font-size", "editorFontSize"]
        ]) {
          if (values[option] !== undefined)
            sizes[field] = countOption(values[option], option, 14, 40);
        }
        // The renderer keeps appearance in a module store and writes it back,
        // so a save that bypasses the store is overwritten on the next change.
        // After Vite HMR, resolve the latest loaded module URL (with ?t=...)
        // instead of importing an un-versioned URL that creates a second store.
        const expression = `(async () => {
          const targetPath = ${JSON.stringify(APPEARANCE_MODULE)};
          const loaded = performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => {
              try {
                return new URL(name).pathname === targetPath;
              } catch {
                return false;
              }
            });
          const moduleUrl = loaded.at(-1) ?? targetPath;
          const store = await import(moduleUrl);
          const appearance =
            typeof store.useAppearance === "function"
              ? store.useAppearance()
              : null;
          if (appearance?.whenReady) await appearance.whenReady();
          const mode = ${JSON.stringify(values.mode ?? null)};
          const sizes = ${JSON.stringify(sizes)};
          if (mode) {
            if (appearance?.setMode) appearance.setMode(mode);
            else store.setAppearanceMode(mode);
          }
          if (Object.keys(sizes).length > 0) {
            const updateTheme = appearance?.updateTheme ?? store.updateTheme;
            updateTheme("light", sizes);
            updateTheme("dark", sizes);
          }
          if (appearance?.flush) await appearance.flush();
          else await new Promise((resolve) => setTimeout(resolve, 400));
          return {
            moduleUrl,
            applied: document.documentElement.dataset.theme,
            settings: (await window.deepwrite.appearance.list()).settings
          };
        })()`;
        return {
          data: await withPage(layout, async (page) => {
            const { value, exception } = await page.evaluate(expression);
            if (exception) {
              throw new CliError("ui.theme_failed", "外观设置失败。", {
                exitCode: 1,
                nextSteps: [
                  "按 details.exception 检查参数范围",
                  `外观模块路径变了时更新 tools/control/commands/ui.mjs 的 APPEARANCE_MODULE（当前 ${APPEARANCE_MODULE}）`
                ],
                details: { exception }
              });
            }
            await delay(100);
            assertThemeApplied({ mode: values.mode ?? null, sizes }, value);
            return value;
          })
        };
      }
    },
    viewport: {
      summary: "调整测试窗口大小（看窄屏、小窗口布局）",
      description:
        "按网页可视区域的宽高调整真实窗口，返回调整后的实际可视尺寸。",
      options: {
        width: {
          type: "string",
          valueName: "像素",
          description: "可视区域宽度"
        },
        height: {
          type: "string",
          valueName: "像素",
          description: "可视区域高度"
        }
      },
      examples: ["pnpm -s ctl ui viewport --width 900 --height 640"],
      output: { viewport: "实际可视宽高" },
      errors: {},
      run: async ({ layout, values }) => {
        const width = countOption(values.width, "width", 1200, 5000);
        const height = countOption(values.height, "height", 800, 5000);
        return {
          // Electron has no CDP Browser.setWindowBounds; resizeTo moves the
          // real window and respects its minimum size.
          data: await withPage(layout, async (page) => {
            const { value } = await page.evaluate(`(async () => {
              resizeTo(outerWidth + ${width} - innerWidth, outerHeight + ${height} - innerHeight);
              await new Promise((resolve) => setTimeout(resolve, 500));
              return { width: innerWidth, height: innerHeight };
            })()`);
            const clamped = value.width !== width || value.height !== height;
            return {
              viewport: value,
              ...(clamped
                ? { note: "窗口有最小或最大尺寸限制，实际尺寸与请求不同" }
                : {})
            };
          })
        };
      }
    },
    flow: {
      summary: "按 JSON 步骤脚本连续操作，并在指定步骤截图",
      description:
        '步骤文件是数组（或 {steps: [...]}），每步 {"do": 动作, ...与命令同名的参数, "screenshot": "名字"}，动作可选 click、fill、press、hover、select、drag、wait、screenshot、eval。press 的按键写在 keys 字段。遇到失败即停，并截下失败时的画面。截图按 01-名字.png 编号，便于前后两次 flow 用 ui compare 对比。',
      positionals: [
        { name: "file", required: true, description: "步骤 JSON 文件" }
      ],
      options: {
        "out-dir": {
          type: "string",
          valueName: "目录",
          description:
            "截图目录（测试环境内或仓库 test/ 下），默认 artifacts/flows/<时间>-<文件名>/"
        }
      },
      examples: [
        "pnpm -s ctl ui flow test/2026-11-23-x/new-book.json --out-dir test/2026-11-23-x/after"
      ],
      output: {
        results: "每步结果",
        artifacts: "截图路径",
        failedStep: "失败的步骤"
      },
      errors: { "ui.flow_invalid": "步骤文件格式不对", ...LOCATOR_ERRORS },
      run: async ({ layout, args, values }) => {
        let steps;
        try {
          const parsed = JSON.parse(await readFile(args.file, "utf8"));
          steps = Array.isArray(parsed) ? parsed : parsed.steps;
        } catch (error) {
          throw new CliError(
            "ui.flow_invalid",
            `读不了步骤文件：${error.message}`,
            {
              nextSteps: [
                '文件内容应是 [{"do":"click","text":"新建书籍","screenshot":"opened"}]'
              ]
            }
          );
        }
        if (!Array.isArray(steps) || steps.length === 0) {
          throw new CliError("ui.flow_invalid", "步骤文件里没有步骤。", {
            nextSteps: ['写成 [{"do":"click","text":"新建书籍"}]']
          });
        }
        const outDirectory = resolveArtifactPath(
          layout,
          values["out-dir"] ??
            join(
              layout.artifacts,
              "flows",
              `${timestamp()}-${basename(args.file, ".json")}`
            )
        );
        const result = await runFlow(layout, steps, outDirectory);
        return {
          ok: result.ok,
          data: { outDirectory, ...result },
          ...(result.ok
            ? {}
            : {
                nextSteps: [
                  `看失败截图 ${result.artifacts.at(-1)} 与 results 里的错误`,
                  "运行 pnpm -s ctl ui snapshot 查看当时可见元素"
                ]
              })
        };
      }
    },
    compare: {
      summary: "对比两张截图或两个截图目录，输出差异像素与差异图",
      description:
        "同名 PNG 逐对比较，忽略抗锯齿级别的微小差异，差异处在淡化底图上标红。用法：改动前跑一次 ui flow 存 before/，改动后再跑存 after/，然后 ui compare before after。只报告差异，不判对错。",
      positionals: [
        { name: "a", required: true, description: "改动前的图片或目录" },
        { name: "b", required: true, description: "改动后的图片或目录" }
      ],
      options: {
        "out-dir": {
          type: "string",
          valueName: "目录",
          description: "差异图目录，默认 b 旁边的 <b>-diff/"
        },
        tolerance: {
          type: "string",
          valueName: "0-255",
          default: "16",
          description: "单通道差值超过多少算变化"
        }
      },
      examples: [
        "pnpm -s ctl ui compare test/2026-11-23-x/before test/2026-11-23-x/after"
      ],
      output: {
        images: "每对图片的 changedPixels、ratio、changedBox、diff",
        onlyA: "只在 a 里的图",
        onlyB: "只在 b 里的图"
      },
      errors: { "cli.invalid_arguments": "路径不对" },
      run: async ({ layout, args, values }) => {
        const { pairs, onlyA, onlyB } = await imagePairs(args.a, args.b).catch(
          (error) => {
            if (error instanceof CliError) throw error;
            throw new CliError(
              "cli.invalid_arguments",
              `读不了对比路径：${error.message}`,
              {
                nextSteps: ["确认两个路径都存在"]
              }
            );
          }
        );
        const tolerance = Number(values.tolerance ?? 16);
        const outDirectory = resolveArtifactPath(
          layout,
          values["out-dir"] ??
            `${args.b.replace(/\/$/u, "").replace(/\.png$/u, "")}-diff`
        );
        const images = [];
        for (const [left, right] of pairs) {
          const result = diffImages(
            decodePng(await readFile(left)),
            decodePng(await readFile(right)),
            tolerance
          );
          const entry = { name: basename(right), a: left, b: right };
          if (!result.sameSize) {
            images.push({ ...entry, sameSize: false, sizes: result.sizes });
            continue;
          }
          let diff;
          if (result.changedPixels > 0) {
            diff = join(outDirectory, basename(right));
            await mkdir(outDirectory, { recursive: true });
            await writeFile(diff, encodePng(result.diff));
          }
          images.push({
            ...entry,
            changed: result.changedPixels > 0,
            changedPixels: result.changedPixels,
            ratio: Number(result.ratio.toFixed(6)),
            ...(result.changedBox ? { changedBox: result.changedBox } : {}),
            ...(diff ? { diff } : {})
          });
        }
        return {
          data: {
            changed: images.filter(
              (image) => image.changed || image.sameSize === false
            ).length,
            images,
            onlyA,
            onlyB
          }
        };
      }
    },
    audit: {
      summary: "样式统一性审计：同类控件有几种样式，哪些只差一两项",
      description:
        "按按钮、输入框、菜单项、标签页、开关、对话框、标题分类，读取可见元素的计算样式并按样式分组。nearMisses 是只差一两项属性的两组样式（如圆角 6px 与 8px、字号 13px 与 14px），最可能是不小心写出来的不统一，需要逐条判断。只看当前画面，换页面、打开弹窗后再审一次。",
      options: {
        within: {
          type: "string",
          valueName: "定位",
          description: "只审这个区域：css=[role=dialog]、text=设置"
        },
        kinds: {
          type: "string",
          valueName: "类别",
          description:
            "逗号分隔：button,input,menuitem,tab,switch,dialog,heading；默认全部"
        }
      },
      examples: [
        "pnpm -s ctl ui audit",
        "pnpm -s ctl ui audit --within css=[role=dialog] --kinds button,input"
      ],
      output: {
        "<类别>.variantCount": "样式种数",
        "<类别>.variants": "每种样式的属性、数量与示例元素",
        "<类别>.nearMisses": "只差一两项的样式对，带差异值和示例"
      },
      errors: { "app.cdp_unavailable": "实例没在运行" },
      run: async ({ layout, values }) => {
        const report = await withPage(layout, (page) =>
          helper(
            page,
            `window.__dwctl.audit(${JSON.stringify({
              ...(values.within
                ? { within: parseLocatorString(values.within, "within") }
                : {}),
              ...(values.kinds
                ? { kinds: values.kinds.split(",").map((kind) => kind.trim()) }
                : {})
            })})`
          )
        );
        const nearMisses = Object.values(report).reduce(
          (sum, kind) => sum + kind.nearMisses.length,
          0
        );
        return {
          data: { nearMisses, kinds: report },
          ...(nearMisses > 0
            ? {
                nextSteps: [
                  "逐条看 nearMisses：同一用途的控件应当一致，差异是有意的（如危险按钮）就说明理由",
                  "用 pnpm -s ctl ui same --a text=… --b text=… 精确比较两个元素"
                ]
              }
            : {})
        };
      }
    },
    same: {
      summary: "比较两个元素的计算样式，列出不同的属性",
      description:
        "比较字体、颜色、背景、边框、圆角、内边距、高度、阴影等。用来确认新做的控件和已有的同类控件是否一致。",
      options: {
        a: {
          type: "string",
          valueName: "定位",
          description: "第一个元素：text=…、css=…、ref=…、label=…，可加 #序号"
        },
        b: { type: "string", valueName: "定位", description: "第二个元素" }
      },
      examples: ["pnpm -s ctl ui same --a text=新建书籍 --b text=智能体团队"],
      output: {
        same: "是否完全一致",
        differences: "不同的属性及两边的值",
        shared: "相同的属性"
      },
      errors: LOCATOR_ERRORS,
      run: async ({ layout, values }) => {
        const a = parseLocatorString(values.a, "a");
        const b = parseLocatorString(values.b, "b");
        const result = await withPage(layout, (page) =>
          helper(
            page,
            `window.__dwctl.same(${JSON.stringify(a)}, ${JSON.stringify(b)})`
          )
        );
        return { data: result };
      }
    }
  }
};
