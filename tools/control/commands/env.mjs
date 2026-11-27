import { diagnose } from "../lib/doctor.mjs";
import {
  assertStopped,
  instanceStatus,
  readState,
  removeInside,
  resetTargets,
  startInstance,
  stopInstance
} from "../lib/instance.mjs";
import { evaluateInMain } from "../lib/main-process.mjs";
import { CliError } from "../lib/output.mjs";
import { secondsOption } from "../lib/runner.mjs";
import { applySeed, planSeed, resolveSeedSource } from "../lib/seed.mjs";

const DRY_RUN = {
  type: "boolean",
  description: "只列出将要发生的变更，不做任何修改"
};
const START_TIMEOUT = {
  type: "string",
  valueName: "秒",
  default: "180",
  description: "等待窗口与控制接口就绪的最长时间"
};

async function doctorReport(layout) {
  const status = await instanceStatus(layout);
  const state = await readState(layout);
  const report = await diagnose(status, state ?? {});
  return { status, report };
}

function doctorNextSteps(report) {
  if (report.needsStart) return ["运行 pnpm -s ctl env start"];
  if (report.needsRestart) return ["运行 pnpm -s ctl env restart"];
  return [];
}

export const envCommands = {
  summary: "测试环境：准备、启动、诊断、停止与清理隔离的开发版实例",
  commands: {
    status: {
      summary: "查看测试实例的进程、端口与就绪状态",
      description:
        "只读。报告测试实例是否运行、窗口是否就绪、调试端口与 Vite 地址；同时只读报告开发者自己的 pnpm dev 是否在运行（developerInstance），CLI 从不操作它。",
      options: {},
      examples: ["pnpm -s ctl env status"],
      output: {
        running: "启动器进程是否存活",
        ready: "窗口已加载且调试端口可用",
        app: "控制接口 get_app_status 的结果",
        cdpPort: "Playwright 连接用的调试端口",
        developerInstance: "开发者自己的开发版，仅供参考"
      },
      errors: {},
      run: async ({ layout }) => ({ data: await instanceStatus(layout) })
    },
    doctor: {
      summary: "判断测试实例能否复用，给出是否需要启动或重启",
      description:
        "检查：实例与窗口是否就绪；启动后是否改过 Main、Preload、Utility、extras 或 packages 的代码（这些不热更新）；out/ 是否在启动后被重建；就绪后日志里是否有热更新或加载错误。不健康时退出码为 1。",
      options: {},
      examples: ["pnpm -s ctl env doctor"],
      output: {
        healthy: "可以直接在这个实例上验证",
        needsStart: "实例没在运行",
        needsRestart: "实例在运行但必须重启",
        reasons: "需要处理的原因",
        checks: "逐项检查结果"
      },
      errors: {},
      run: async ({ layout }) => {
        const { report } = await doctorReport(layout);
        return {
          ok: report.healthy,
          data: report,
          nextSteps: doctorNextSteps(report)
        };
      }
    },
    start: {
      summary: "启动隔离的测试实例并等到就绪；健康的实例直接复用",
      description:
        "以 DEEPWRITE_DEV_USER_DATA、DEEPWRITE_CONTROL_DIR、DEEPWRITE_TEST_ENV=1 运行 pnpm dev 并开启调试端口。窗口在后台显示、不抢焦点。数据、控制端点和端口都与开发者自己的开发版分开。",
      options: { timeout: START_TIMEOUT },
      examples: [
        "pnpm -s ctl env start",
        "pnpm -s ctl env start --timeout 300"
      ],
      output: {
        reused: "true 表示复用了已在运行的健康实例",
        cdpPort: "调试端口",
        logFile: "本次 pnpm dev 输出的日志文件"
      },
      errors: {
        "env.not_seeded": "先运行 env seed",
        "env.sandbox_blocked": "沙盒禁止拉起 Electron",
        "env.running_unhealthy": "已有实例但不健康，运行 env restart",
        "env.start_exited": "启动后退出，看 details.logTail",
        "env.start_timeout": "超时未就绪，看 details.logTail"
      },
      run: async ({ layout, values }) => ({
        data: await startInstance(layout, {
          timeoutMs: secondsOption(values.timeout, "timeout", 180)
        })
      })
    },
    stop: {
      summary: "优雅停止本 CLI 启动的测试实例",
      description:
        "只结束 state.json 记录、且命令行核对一致的进程：先发 SIGINT（等同终端 Ctrl+C），超时后逐级强制。没在运行时直接成功。",
      options: {
        timeout: {
          type: "string",
          valueName: "秒",
          default: "30",
          description: "等待优雅退出的最长时间"
        }
      },
      examples: ["pnpm -s ctl env stop"],
      output: { stopped: "是否结束了进程", forced: "是否用了强制结束" },
      errors: {},
      run: async ({ layout, values }) => ({
        data: await stopInstance(layout, {
          timeoutMs: secondsOption(values.timeout, "timeout", 30)
        })
      })
    },
    restart: {
      summary: "停止后重新启动测试实例",
      description:
        "等同 env stop 再 env start；改了后台代码或 doctor 要求重启时使用。",
      options: { timeout: START_TIMEOUT },
      examples: ["pnpm -s ctl env restart"],
      output: { stop: "停止结果", start: "启动结果" },
      errors: {
        "env.start_exited": "看 details.logTail",
        "env.start_timeout": "看 details.logTail"
      },
      run: async ({ layout, values }) => {
        const stop = await stopInstance(layout);
        const start = await startInstance(layout, {
          timeoutMs: secondsOption(values.timeout, "timeout", 180)
        });
        return { data: { stop, start } };
      }
    },
    show: {
      summary: "把测试窗口交给开发者亲手试用：显示到前台并恢复 Dock 图标",
      description:
        "测试窗口平时在后台显示、没有 Dock 图标，开发者不好找到。运行后窗口到前台，可以用 Dock 和 Cmd+Tab 切回，直到 env restart 为止。会抢系统焦点，只在开发者要亲手点点看时用。",
      options: {},
      examples: ["pnpm -s ctl env show"],
      output: { shown: "是否显示了窗口" },
      errors: {
        "env.window_missing": "实例里找不到应用窗口，运行 env restart",
        "app.main_inspector_unavailable": "运行 env restart"
      },
      run: async ({ layout }) => {
        const shown = await evaluateInMain(
          layout,
          `(() => {
            const { app, BrowserWindow } = require("electron");
            const window = BrowserWindow.getAllWindows().find(
              (candidate) => !candidate.isDestroyed() && /^https?:/.test(candidate.webContents.getURL())
            );
            if (!window) return false;
            if (process.platform === "darwin") app.setActivationPolicy("regular");
            if (window.isMinimized()) window.restore();
            window.show();
            app.focus({ steal: true });
            return true;
          })()`
        );
        if (!shown) {
          throw new CliError(
            "env.window_missing",
            "测试实例里找不到应用窗口。",
            {
              exitCode: 1,
              nextSteps: ["运行 pnpm -s ctl env restart"]
            }
          );
        }
        return { data: { shown } };
      }
    },
    seed: {
      summary: "从正式配置只读复制模型、密钥与登录，并写入测试设置",
      description:
        "复制白名单文件（模型、图片、语音、联网搜索、登录会话、模型目录缓存），写入测试用的通用设置、作品目录与控制接口批准记录。不复制作品、对话、智能体配置、同步与云备份。复制前后校验源文件未变。会覆盖测试环境里的同名配置，实例运行时拒绝执行。",
      options: {
        from: {
          type: "string",
          valueName: "数据目录",
          description: "配置来源的数据目录，默认是正式版 DeepWrite 的数据目录"
        },
        "dry-run": DRY_RUN
      },
      examples: ["pnpm -s ctl env seed --dry-run", "pnpm -s ctl env seed"],
      output: {
        copied: "已复制的文件",
        skipped: "来源里不存在而跳过的文件",
        written: "CLI 生成的测试配置",
        sourceUnchanged: "来源文件哈希前后一致"
      },
      errors: {
        "env.running": "先运行 env stop",
        "seed.source_missing": "来源没有模型配置",
        "seed.source_changed": "复制期间来源被改，重跑一次"
      },
      run: async ({ layout, values }) => {
        await assertStopped(layout, "覆盖测试配置");
        const plan = await planSeed(
          layout,
          await resolveSeedSource(values.from)
        );
        if (values["dry-run"]) {
          return {
            data: {
              dryRun: true,
              source: plan.source,
              copy: plan.copies.map(({ file, from, to, sourceHash }) => ({
                file,
                from,
                to,
                present: Boolean(sourceHash)
              })),
              write: plan.writes
            }
          };
        }
        return { data: await applySeed(layout, plan) };
      }
    },
    reset: {
      summary: "清空测试作品与运行数据，保留测试配置",
      description:
        "删除 profile/ 下除 config/ 以外的全部内容、workspace/ 与 control/ 的内容，以及数据集台账。日志、截图与快照保留。实例运行时拒绝执行。",
      options: { "dry-run": DRY_RUN },
      examples: ["pnpm -s ctl env reset --dry-run", "pnpm -s ctl env reset"],
      output: { removed: "删除（或将删除）的路径" },
      errors: { "env.running": "先运行 env stop" },
      run: async ({ layout, values }) => {
        await assertStopped(layout, "清空数据");
        const targets = await resetTargets(layout);
        if (!values["dry-run"]) await removeInside(layout, targets);
        return {
          data: { dryRun: Boolean(values["dry-run"]), removed: targets }
        };
      }
    },
    destroy: {
      summary: "删除整个测试环境目录",
      description:
        "删除 ~/.deepwrite-test/<名>/，包括配置副本、作品、日志、截图与快照。实例运行时拒绝执行。",
      options: { "dry-run": DRY_RUN },
      examples: ["pnpm -s ctl env destroy --dry-run"],
      output: { removed: "删除（或将删除）的目录" },
      errors: { "env.running": "先运行 env stop" },
      run: async ({ layout, values }) => {
        await assertStopped(layout, "删除测试环境");
        if (!values["dry-run"]) await removeInside(layout, [layout.root]);
        return {
          data: { dryRun: Boolean(values["dry-run"]), removed: [layout.root] }
        };
      }
    }
  }
};
