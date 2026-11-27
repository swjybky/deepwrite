import { connectPage } from "../lib/browser.mjs";
import { openControlSession } from "../lib/control-client.mjs";
import { CliError } from "../lib/output.mjs";
import { jsonOption, secondsOption } from "../lib/runner.mjs";
import { loadToolCatalog } from "../lib/tool-catalog.mjs";

const TIMEOUT = {
  type: "string",
  valueName: "秒",
  default: "30",
  description: "等待调用返回的最长时间"
};
const IPC_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u;

const LIST_IPC = `(() => {
  const paths = [];
  const walk = (value, prefix, depth) => {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? prefix + "." + key : key;
      if (typeof child === "function") paths.push(path);
      else if (child && typeof child === "object" && depth < 4) walk(child, path, depth + 1);
    }
  };
  walk(window.deepwrite ?? {}, "", 0);
  return paths.sort();
})()`;

const PAGE_STATE = `(() => {
  const text = (element) => (element?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 120);
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')]
    .filter(visible)
    .map((dialog) => ({
      label: dialog.getAttribute("aria-label") ?? text(dialog.querySelector("h1, h2, h3, [class*=title]")),
      role: dialog.getAttribute("role") ?? "dialog"
    }));
  const active = document.activeElement;
  const root = document.documentElement;
  return {
    url: location.href,
    title: document.title,
    hasFocus: document.hasFocus(),
    visibilityState: document.visibilityState,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    theme: {
      className: root.className,
      dataset: { ...root.dataset },
      colorScheme: getComputedStyle(root).colorScheme
    },
    activeElement: active && active !== document.body
      ? { tag: active.tagName.toLowerCase(), label: active.getAttribute("aria-label") ?? active.getAttribute("placeholder") ?? text(active) }
      : null,
    dialogs,
    headings: [...document.querySelectorAll("h1, h2")].filter(visible).map(text).filter(Boolean).slice(0, 10)
  };
})()`;

async function withSession(layout, action, timeoutMs) {
  const session = await openControlSession(layout, { timeoutMs });
  try {
    return await action(session);
  } finally {
    session.close();
  }
}

async function withPage(layout, action, timeoutMs) {
  const page = await connectPage(layout, { timeoutMs });
  try {
    return await action(page);
  } finally {
    await page.close();
  }
}

export const appCommands = {
  summary:
    "接口：调用测试实例的控制接口工具与 window.deepwrite IPC，读取界面状态",
  commands: {
    tools: {
      summary: "列出控制接口的全部工具与参数结构",
      description:
        "从 packages/contracts 的工具契约读取，不需要实例在运行，与当前代码一致。传工具名只看这一个工具的完整参数 JSON Schema。",
      positionals: [{ name: "tool", description: "只看这一个工具" }],
      options: {},
      examples: [
        "pnpm -s ctl app tools",
        "pnpm -s ctl app tools write_document"
      ],
      output: {
        tools:
          "name、title、description、readOnly；只列一个工具时含 inputSchema"
      },
      errors: {
        "app.tool_catalog_failed": "契约文件加载失败",
        "app.unknown_tool": "没有这个工具"
      },
      run: async ({ args }) => {
        const catalog = await loadToolCatalog();
        if (!args.tool) {
          return {
            data: {
              count: catalog.length,
              tools: catalog.map(({ inputSchema: _schema, ...tool }) => tool),
              next: "pnpm -s ctl app tools <tool> 查看参数结构"
            }
          };
        }
        const tool = catalog.find(({ name }) => name === args.tool);
        if (!tool) {
          throw new CliError("app.unknown_tool", `没有工具「${args.tool}」。`, {
            nextSteps: ["运行 pnpm -s ctl app tools 查看全部工具名"],
            details: { tools: catalog.map(({ name }) => name) }
          });
        }
        return { data: tool };
      }
    },
    call: {
      summary: "调用一个控制接口工具（与 MCP 智能体走同一路径）",
      description:
        "经测试实例的控制端点调用，参数按工具契约校验，写入同样要带 baseRevision，删除进回收站可恢复。只连测试环境自己的端点，不会碰开发者的开发版或安装版。工具拒绝时退出码为 1，error.details.code 是应用返回的错误码。",
      positionals: [
        { name: "tool", required: true, description: "见 app tools" }
      ],
      options: {
        args: {
          type: "string",
          valueName: "JSON",
          description: "工具参数对象，默认 {}"
        },
        timeout: TIMEOUT
      },
      examples: [
        "pnpm -s ctl app call get_app_status",
        "pnpm -s ctl app call list_works",
        `pnpm -s ctl app call get_work --args '{"workId":"<id>"}'`
      ],
      output: { tool: "工具名", result: "工具返回值" },
      errors: {
        "app.control_unavailable": "实例没在运行或控制接口没就绪",
        "app.tool_rejected": "工具拒绝了调用，看 message 与 details.code",
        "app.control_timeout": "没有在 --timeout 内返回"
      },
      run: async ({ layout, args, values }) => {
        const input = jsonOption(values.args, "args", {});
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new CliError(
            "cli.invalid_arguments",
            "--args 必须是 JSON 对象。",
            {
              nextSteps: [
                `运行 pnpm -s ctl app tools ${args.tool} 查看参数结构`
              ]
            }
          );
        }
        const timeoutMs = secondsOption(values.timeout, "timeout", 30);
        const result = await withSession(
          layout,
          (session) => session.call(args.tool, input, { timeoutMs }),
          timeoutMs
        );
        return { data: { tool: args.tool, result } };
      }
    },
    ipc: {
      summary: "在测试窗口里调用 window.deepwrite 的一个 IPC 方法",
      description:
        "经调试端口在渲染进程里执行 window.deepwrite.<路径>(...参数)，与界面走同一条 Preload → Main 路径，结果按 JSON 返回。不传路径时列出全部可调用路径。会弹出系统对话框的方法（如 workspaceDirectory.choose）会一直等到超时；on* 订阅方法需要回调，不能在这里调用。",
      positionals: [
        {
          name: "path",
          description: "例如 generalSettings.list；省略则列出全部"
        }
      ],
      options: {
        args: {
          type: "string",
          valueName: "JSON 数组",
          description: "按顺序传给方法的参数，默认 []"
        },
        timeout: TIMEOUT
      },
      examples: [
        "pnpm -s ctl app ipc",
        "pnpm -s ctl app ipc generalSettings.list",
        `pnpm -s ctl app ipc catalog.list --args '[]'`
      ],
      output: {
        paths: "不传路径时：全部可调用路径",
        result: "方法的返回值"
      },
      errors: {
        "app.cdp_unavailable": "实例没在运行或调试端口不可用",
        "app.ipc_not_found": "路径不存在或不是方法",
        "app.ipc_failed":
          "方法抛错或返回被拒绝的 Promise，看 details.exception",
        "app.cdp_timeout": "没有在 --timeout 内返回"
      },
      run: async ({ layout, args, values }) => {
        const timeoutMs = secondsOption(values.timeout, "timeout", 30);
        const path = args.path;
        if (!path) {
          const { value, exception } = await withPage(
            layout,
            (page) => page.evaluate(LIST_IPC),
            timeoutMs
          );
          if (exception) {
            throw new CliError("app.ipc_failed", "读取 IPC 列表失败。", {
              nextSteps: ["运行 pnpm -s ctl env doctor 检查窗口是否正常加载"],
              details: { exception }
            });
          }
          return { data: { count: value.length, paths: value } };
        }
        if (!IPC_PATH.test(path)) {
          throw new CliError(
            "cli.invalid_arguments",
            `IPC 路径「${path}」格式不对。`,
            {
              nextSteps: ["运行 pnpm -s ctl app ipc 查看可调用路径"]
            }
          );
        }
        const input = jsonOption(values.args, "args", []);
        if (!Array.isArray(input)) {
          throw new CliError(
            "cli.invalid_arguments",
            "--args 必须是 JSON 数组。",
            {
              nextSteps: [`例如 --args '[{"id":"..."}]'`]
            }
          );
        }
        const expression = `(async () => {
          const target = ${JSON.stringify(path)}.split(".").reduce((value, key) => value?.[key], window.deepwrite);
          if (typeof target !== "function") return { missing: true };
          try {
            return { result: await target(...${JSON.stringify(input)}) };
          } catch (error) {
            return {
              failure: {
                name: error?.name,
                code: error?.code,
                message: error?.message ?? String(error)
              }
            };
          }
        })()`;
        const { value, exception } = await withPage(
          layout,
          (page) => page.evaluate(expression),
          timeoutMs
        );
        if (exception) {
          throw new CliError(
            "app.ipc_failed",
            `window.deepwrite.${path} 调用失败。`,
            {
              exitCode: 1,
              nextSteps: [
                "按 details.exception 修正参数；参数结构见 apps/desktop/src/preload/"
              ],
              details: { exception }
            }
          );
        }
        if (value.failure) {
          throw new CliError(
            "app.ipc_failed",
            `window.deepwrite.${path} 返回错误：${value.failure.message}`,
            {
              exitCode: 1,
              nextSteps: [
                "按 details 修正参数；参数结构见 apps/desktop/src/preload/ 与 packages/contracts"
              ],
              details: value.failure
            }
          );
        }
        if (value.missing) {
          throw new CliError(
            "app.ipc_not_found",
            `window.deepwrite.${path} 不是可调用的方法。`,
            {
              nextSteps: ["运行 pnpm -s ctl app ipc 查看可调用路径"]
            }
          );
        }
        return { data: { path, result: value.result ?? null } };
      }
    },
    state: {
      summary: "读取测试窗口当前的界面状态",
      description:
        "只读。汇总地址、焦点、视口、主题、当前聚焦元素、打开的对话框和可见标题，配合控制接口 get_app_status。用来确认操作前后界面停在哪里。",
      options: {},
      examples: ["pnpm -s ctl app state"],
      output: {
        page: "url、hasFocus、viewport、theme、activeElement、dialogs、headings",
        app: "get_app_status 的结果"
      },
      errors: { "app.cdp_unavailable": "实例没在运行或调试端口不可用" },
      run: async ({ layout }) => {
        const { value, exception } = await withPage(layout, (page) =>
          page.evaluate(PAGE_STATE)
        );
        if (exception) {
          throw new CliError("app.state_failed", "读取界面状态失败。", {
            nextSteps: ["运行 pnpm -s ctl env doctor 检查窗口是否正常加载"],
            details: { exception }
          });
        }
        const app = await withSession(layout, (session) =>
          session.call("get_app_status")
        ).catch((error) => ({ error: error.code ?? error.message }));
        return { data: { page: value, app } };
      }
    }
  }
};
