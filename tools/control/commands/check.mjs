import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";
import { diagnose } from "../lib/doctor.mjs";
import {
  ALL_STEPS,
  planAll,
  runAllChecks,
  toolBin
} from "../lib/check-all.mjs";
import { checkFeatureMap } from "../lib/feature-map.mjs";
import { instanceStatus, readState } from "../lib/instance.mjs";
import { problemsSince, resolveMark } from "../lib/logs.mjs";
import { CliError } from "../lib/output.mjs";
import { REPO_ROOT, resolveArtifactPath } from "../lib/paths.mjs";
import { RULES, runRepoRules } from "../lib/repo-rules.mjs";

const PRETTIER = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".vue",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yaml",
  ".yml"
]);
const ESLINT = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".vue"]);
const CODE = new Set([".js", ".mjs", ".ts", ".mts", ".vue"]);
const STEPS = [
  "prettier",
  "eslint",
  "typecheck",
  "boundary",
  "i18n",
  "features",
  "rules",
  "tests"
];

function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new CliError(
      "check.git_failed",
      `git ${args.join(" ")} 失败：${result.stderr.trim()}`,
      {
        nextSteps: ["确认在仓库里运行，且 --base 是存在的提交"]
      }
    );
  }
  return result.stdout.split("\0").filter(Boolean);
}

export function changedFiles({ staged, base, files }) {
  const names = files
    ? files
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean)
        .map((file) =>
          (isAbsolute(file)
            ? relative(REPO_ROOT, file)
            : file.replace(/^\.\//u, "")
          ).replaceAll("\\", "/")
        )
    : staged
      ? git(["diff", "--cached", "--name-only", "-z"])
      : [
          ...git(["diff", "--name-only", "-z", base ?? "HEAD"]),
          ...git(["ls-files", "--others", "--exclude-standard", "-z"])
        ];
  return [...new Set(names)].sort();
}

/** Which checks the changed paths call for; AGENTS.md lists the boundaries. */
export function planChecks(files, present = files) {
  const has = (pattern) => files.some((file) => pattern.test(file));
  const projects = [];
  if (
    has(
      /^apps\/desktop\/src\/(main|preload|utilities|extras)\/|^packages\/(contracts|pi-runtime-adapter|shared)\/src\//u
    )
  )
    projects.push("apps/desktop/tsconfig.node.json");
  if (
    has(/^apps\/desktop\/src\/renderer\/|^packages\/(contracts|shared)\/src\//u)
  )
    projects.push("apps/desktop/tsconfig.web.json");
  for (const name of ["contracts", "shared", "pi-runtime-adapter"]) {
    if (has(new RegExp(`^packages/${name}/src/`, "u")))
      projects.push(`packages/${name}/tsconfig.json`);
  }
  return {
    prettier: present.filter((file) => PRETTIER.has(extname(file))),
    eslint: present.filter((file) => ESLINT.has(extname(file))),
    typecheck: projects,
    boundary: has(
      /^apps\/desktop\/src\/(renderer|preload|main\/index\.ts)|^packages\/contracts\/src\/renderer|electron\.vite\.config/u
    ),
    i18n: has(/^apps\/desktop\/src\/renderer\//u),
    tests: present.filter((file) => CODE.has(extname(file))),
    features: has(
      /^references\/features\/|^apps\/|^packages\/|^tools\/control\//u
    ),
    rules: has(
      /^(apps\/|packages\/|tools\/|test\/|package\.json$|pnpm-workspace\.yaml$)/u
    )
  };
}

function runStep(name, command, args) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: "0" }
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const lines = output
        .replace(/\u001b\[[0-9;]*m/gu, "")
        .trimEnd()
        .split("\n");
      resolve({
        step: name,
        ok: code === 0,
        command: [command, ...args].join(" ").slice(0, 400),
        durationMs: Date.now() - started,
        ...(code === 0
          ? { tail: lines.slice(-3) }
          : { exitCode: code, tail: lines.slice(-60) })
      });
    });
  });
}

const BINS = { tsc: ["typescript", "tsc"] };
const npx = (tool, args) => [
  process.execPath,
  [toolBin(...(BINS[tool] ?? [tool])), ...args]
];

async function collectFiles(directory, wanted) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (wanted(entry.name)) found.push(path);
    }
  }
  await walk(directory);
  return found;
}

function markdownReport({
  title,
  status,
  doctor,
  logs,
  scenarios,
  screenshots,
  directory
}) {
  const lines = [`# ${title}`, "", `生成时间：${new Date().toISOString()}`, ""];
  lines.push("## 环境", "");
  lines.push(
    `- 测试实例：${status.running ? "运行中" : "未运行"}，应用版本 ${status.app?.appVersion ?? "未知"}`
  );
  lines.push(
    `- doctor：${doctor ? (doctor.healthy ? "健康" : `不健康（${doctor.reasons.join("；")}）`) : "未检查"}`
  );
  lines.push("");
  lines.push("## 日志", "");
  if (!logs) lines.push("- 未指定日志标记，未汇总");
  else if (logs.errors.length === 0)
    lines.push(`- 标记之后无新增错误（警告 ${logs.warnings.length} 条）`);
  else
    for (const error of logs.errors.slice(0, 20))
      lines.push(
        `- ❌ [${error.source}] ${error.text}${error.count > 1 ? ` ×${error.count}` : ""}`
      );
  lines.push("");
  if (scenarios.length > 0) {
    lines.push(
      "## 智能体场景",
      "",
      "| 场景 | 结果 | 状态 | 耗时 | 工具 | 未通过 | 报告 |",
      "| --- | --- | --- | --- | --- | --- | --- |"
    );
    for (const report of scenarios) {
      const tools = (report.toolUsage?.byTool ?? [])
        .map(
          ({ name, succeeded, failed }) =>
            `${name} ${succeeded}${failed ? `/${failed}✗` : ""}`
        )
        .join("、");
      const failed =
        (report.checks ?? [])
          .filter((check) => !check.ok)
          .map((check) => check.name)
          .join("；") ||
        (report.error?.message ?? "");
      lines.push(
        `| ${report.scenario} | ${report.ok ? "通过" : "未通过"} | ${report.status ?? "-"} | ${report.durationMs ? `${Math.round(report.durationMs / 1000)}s` : "-"} | ${tools || "-"} | ${failed || "-"} | [${relative(directory, report.file)}](${relative(directory, report.file)}) |`
      );
    }
    lines.push("");
  }
  if (screenshots.length > 0) {
    lines.push("## 截图", "");
    for (const file of screenshots)
      lines.push(
        `- [${relative(directory, file)}](${relative(directory, file)})`
      );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function executeChangedSteps(steps, runner = runStep) {
  const results = [];
  for (const [step, command, args] of steps) {
    if (step === "tests" && results.some((result) => !result.ok)) {
      results.push({
        step,
        ok: false,
        skipped: true,
        command: [command, ...args].join(" ").slice(0, 400),
        durationMs: 0,
        tail: ["前置静态检查未通过，已跳过 tests；修复前置问题后再重跑。"]
      });
      continue;
    }
    results.push(await runner(step, command, args));
  }
  return results;
}

export const checkCommands = {
  summary: "检查改动与全仓规则、构建 App、汇总验证报告",
  commands: {
    all: {
      summary:
        "全量检查：格式、lint、类型、边界、文案、功能地图、仓库规则与全部测试",
      description:
        "一次跑完仓库的全部静态检查和全部 vitest 测试（约 7 分钟），结果按区域汇总：frontend 是 apps/desktop/src/renderer/，backend 是 apps/desktop/src/ 其余部分和 packages/，tooling 是 tools/ 与脚本，repo 是不分区域的检查。每项给 ok、problems 总数和前 20 条 findings（文件、行号、规则或错误码）。git 忽略的路径（含 .git/info/exclude 里的本机目录）不参与格式和 lint。改契约、tsconfig / eslint / vitest 配置、依赖，或改动横跨多层时用它；日常改动用 check changed。pnpm verify 与 CI 也跑它。",
      options: {
        skip: {
          type: "string",
          valueName: "步骤",
          description: `逗号分隔要跳过的步骤：${ALL_STEPS.join("、")}`
        },
        stream: {
          type: "boolean",
          description:
            "把各工具的原始输出实时写到 stderr（CI 日志用），stdout 仍只有 JSON"
        },
        "dry-run": { type: "boolean", description: "只列出要跑的步骤和命令" }
      },
      examples: [
        "pnpm -s ctl check all",
        "pnpm -s ctl check all --skip tests",
        "pnpm -s ctl check all --dry-run"
      ],
      output: {
        areas:
          "frontend / backend / tooling 各有 lint、tests（前两者还有 typecheck）；repo 有 format、boundary、i18n、features、rules",
        steps: "每步 ok、command、耗时，失败时附 exitCode 和输出末尾",
        durationMs: "总耗时"
      },
      errors: {},
      run: async ({ values }) => {
        const skip = new Set(
          (values.skip ?? "")
            .split(",")
            .map((step) => step.trim())
            .filter(Boolean)
        );
        const unknown = [...skip].filter((step) => !ALL_STEPS.includes(step));
        if (unknown.length > 0)
          throw new CliError(
            "cli.invalid_arguments",
            `没有这些步骤：${unknown.join("、")}`,
            { nextSteps: [`--skip 只能取 ${ALL_STEPS.join("、")}`] }
          );
        if (values["dry-run"])
          return {
            data: {
              dryRun: true,
              steps: planAll({ skip }).map(({ step, display }) => ({
                step,
                command: display
              }))
            }
          };
        const { cliGroups } = await import("../cli-groups.mjs");
        return runAllChecks({ skip, stream: values.stream, groups: cliGroups });
      }
    },
    changed: {
      summary:
        "对改动的文件跑 prettier、eslint、相关测试，按路径补类型检查和边界检查",
      description:
        "默认取工作区相对 HEAD 的改动加未跟踪文件；--staged 从暂存区选改动路径；--files 直接指定。按路径加类型、边界、文案、功能地图与仓库规则检查。测试用 vitest related 只跑受影响的。--dry-run 只列出计划。",
      options: {
        staged: { type: "boolean", description: "只检查暂存区文件" },
        base: {
          type: "string",
          valueName: "提交",
          description: "与这个提交比较，默认 HEAD"
        },
        files: {
          type: "string",
          valueName: "文件",
          description: "逗号分隔的文件，代替 git 改动"
        },
        skip: {
          type: "string",
          valueName: "步骤",
          description: `逗号分隔要跳过的步骤：${STEPS.join("、")}`
        },
        "dry-run": { type: "boolean", description: "只列出要检查的文件与步骤" }
      },
      examples: [
        "pnpm -s ctl check changed --dry-run",
        "pnpm -s ctl check changed --files a.ts,b.vue",
        "pnpm -s ctl check changed",
        "pnpm -s ctl check changed --staged"
      ],
      output: {
        files: "检查的文件",
        steps: "每步 ok、command、耗时、失败时的输出末尾"
      },
      errors: { "check.git_failed": "git 读取改动失败" },
      run: async ({ values }) => {
        const files = changedFiles(values);
        const plan = planChecks(
          files,
          files.filter((file) => existsSync(join(REPO_ROOT, file)))
        );
        const skip = new Set(
          (values.skip ?? "")
            .split(",")
            .map((step) => step.trim())
            .filter(Boolean)
        );
        const steps = [];
        if (plan.prettier.length && !skip.has("prettier"))
          steps.push([
            "prettier",
            ...npx("prettier", ["--check", ...plan.prettier])
          ]);
        if (plan.eslint.length && !skip.has("eslint"))
          steps.push([
            "eslint",
            ...npx("eslint", [
              "--max-warnings=0",
              "--no-warn-ignored",
              ...plan.eslint
            ])
          ]);
        if (!skip.has("typecheck")) {
          for (const project of plan.typecheck) {
            steps.push([
              `typecheck ${project}`,
              ...npx(
                project.endsWith("tsconfig.web.json") ? "vue-tsc" : "tsc",
                ["--noEmit", "-p", project]
              )
            ]);
          }
        }
        if (plan.boundary && !skip.has("boundary"))
          steps.push([
            "boundary",
            process.execPath,
            ["tools/check-renderer-boundary.mjs"]
          ]);
        if (plan.i18n && !skip.has("i18n"))
          steps.push(["i18n", process.execPath, ["tools/check-i18n.mjs"]]);
        if (plan.features && !skip.has("features"))
          steps.push([
            "features",
            process.execPath,
            ["tools/control/cli.mjs", "check", "features"]
          ]);
        if (plan.rules && !skip.has("rules"))
          steps.push([
            "rules",
            process.execPath,
            ["tools/control/cli.mjs", "check", "rules"]
          ]);
        if (plan.tests.length && !skip.has("tests"))
          steps.push([
            "tests",
            ...npx("vitest", [
              "related",
              "--run",
              "--passWithNoTests",
              ...plan.tests
            ])
          ]);
        if (values["dry-run"]) {
          return {
            data: {
              dryRun: true,
              files,
              steps: steps.map(([step, command, args]) => ({
                step,
                command: [command, ...args].join(" ").slice(0, 400)
              }))
            }
          };
        }
        const results = await executeChangedSteps(steps);
        const failed = results.filter((result) => !result.ok);
        const actionableFailed = failed.filter((result) => !result.skipped);
        const dirtyHint =
          !values.files && !values.staged && files.length > 50
            ? `工作区共有 ${files.length} 个未提交文件；若包含其他任务改动，请用 pnpm -s ctl check changed --files <本次改动文件> 只检查本次改动。`
            : undefined;
        const rerunCommand = values.files
          ? `pnpm -s ctl check changed --files ${values.files}`
          : "pnpm -s ctl check changed";
        return {
          ok: failed.length === 0,
          data: {
            files: files.length,
            steps: results,
            ...(dirtyHint ? { note: dirtyHint } : {})
          },
          ...(failed.length > 0
            ? {
                nextSteps: [
                  ...actionableFailed.map(
                    (result) =>
                      `修复 ${result.step}：看 tail；格式问题可运行 pnpm exec prettier --write <文件>`
                  ),
                  ...(dirtyHint ? [dirtyHint] : []),
                  `修复后重跑 ${rerunCommand}`
                ]
              }
            : {})
        };
      }
    },
    rules: {
      summary: "校验死文件、重复函数、目录边界、依赖来源、敏感信息与入口一致性",
      description:
        "运行全仓规则，或传规则名只复查该项。规则发现问题时退出码为 1，输出问题位置和修复方法。",
      positionals: [
        {
          name: "name",
          description: `仅跑一项，可选 ${Object.keys(RULES).join("、")}`
        }
      ],
      options: {},
      examples: ["pnpm -s ctl check rules", "pnpm -s ctl check rules layers"],
      output: { rules: "各项的 ok、problems、durationMs、findings 和 advice" },
      errors: { "cli.invalid_arguments": "规则名不存在" },
      run: ({ args: { name } }) => {
        if (name && !Object.hasOwn(RULES, name))
          throw new CliError("cli.invalid_arguments", `没有仓库规则 ${name}`, {
            nextSteps: ["运行 pnpm -s ctl check rules --help 查看规则名"]
          });
        const rules = runRepoRules(
          REPO_ROOT,
          name ? new Set([name]) : undefined
        );
        const failed = Object.values(rules).filter((rule) => !rule.ok);
        return {
          ok: failed.length === 0,
          data: { rules },
          ...(failed.length
            ? { nextSteps: failed.map((rule) => rule.advice) }
            : {})
        };
      }
    },
    features: {
      summary:
        "校验功能地图：代码路径、链接、CLI 命令与参数、IPC 命令名、工具名都要真实存在",
      description:
        "逐页检查 references/features/*.md：反引号里的源码路径（可只写文件名或部分路径）要在 apps/、packages/、tools/ 下找得到；相对链接要指向存在的文件；代码块里的 pnpm -s ctl 命令要是现有的组、命令和参数；catalog.* 等 IPC 命令名要在 Preload、Main 或契约源码里出现；snake_case 工具名要在外部控制契约或智能体源码里出现。不跑命令本身，跑命令用页面里的步骤。",
      options: {},
      examples: ["pnpm -s ctl check features"],
      output: {
        pages: "页数",
        problems: "page、kind（path/link/cli/command/tool）、value、issue"
      },
      errors: {},
      run: async () => {
        const { cliGroups } = await import("../cli-groups.mjs");
        const results = await checkFeatureMap({ groups: cliGroups });
        const problems = results.flatMap(({ page, problems: found }) =>
          found.map((problem) => ({ page, ...problem }))
        );
        return {
          ok: problems.length === 0,
          data: { pages: results.length, problems },
          ...(problems.length > 0
            ? {
                nextSteps: [
                  "按 problems 修正功能地图：路径或命令改名了就更新页面，功能删了就删对应段落",
                  "代码里确实没有这个名字时，先确认是不是写错了，再决定改代码还是改地图"
                ]
              }
            : {})
        };
      }
    },
    build: {
      summary: "构建 App，并告诉你测试实例是否因此需要重启",
      description:
        "运行 pnpm build（electron-vite build 与 Renderer 构建检查）。开发实例也从 out/ 加载 Main，构建会覆盖它，所以实例在运行时构建后一定要 env restart。",
      options: {},
      examples: ["pnpm -s ctl check build"],
      output: { build: "构建结果", needsRestart: "测试实例是否需要重启" },
      errors: {},
      run: async ({ layout }) => {
        const build = await runStep("build", "pnpm", ["build"]);
        const status = await instanceStatus(layout);
        const doctor = status.running
          ? await diagnose(status, (await readState(layout)) ?? {})
          : undefined;
        const needsRestart = Boolean(doctor?.needsRestart);
        return {
          ok: build.ok,
          data: {
            build,
            running: status.running,
            needsRestart,
            ...(doctor ? { reasons: doctor.reasons } : {})
          },
          nextSteps: [
            ...(build.ok ? [] : ["按 build.tail 修复构建错误"]),
            ...(needsRestart
              ? ["运行 pnpm -s ctl env restart，否则新旧代码混跑"]
              : [])
          ]
        };
      }
    },
    report: {
      summary:
        "把一次验证的环境、日志、智能体场景与截图汇总成 test/ 下的 README.md 与 summary.json",
      description:
        "扫描 --dir 目录里的场景报告（agent scenario 产出的 JSON）与 PNG 截图，加上测试实例状态、doctor 结果和 --since 标记之后的新增错误，写成 Markdown 与 JSON。截图按相对路径链接。有错误、场景未通过或实例不健康时退出码为 1。",
      options: {
        dir: {
          type: "string",
          valueName: "目录",
          description:
            "验证产物目录，须在仓库 test/ 下，如 test/2026-11-23-主题"
        },
        title: {
          type: "string",
          valueName: "标题",
          description: "报告标题，默认用目录名"
        },
        since: {
          type: "string",
          valueName: "标记名",
          description: "汇总这个日志标记之后的新增错误"
        }
      },
      examples: [
        "pnpm -s ctl check report --dir test/2026-11-23-new-book --since before-change"
      ],
      output: {
        report: "README.md 路径",
        summary: "summary.json 路径",
        passed: "整体是否通过"
      },
      errors: {
        "guard.outside_artifact_roots": "目录不在 test/ 下",
        "logs.unknown_mark": "标记不存在"
      },
      run: async ({ layout, values }) => {
        if (!values.dir) {
          throw new CliError("cli.invalid_arguments", "需要 --dir。", {
            nextSteps: ["例如 --dir test/2026-11-23-主题"]
          });
        }
        const directory = resolveArtifactPath(
          layout,
          isAbsolute(values.dir) ? values.dir : join(REPO_ROOT, values.dir)
        );
        await mkdir(directory, { recursive: true });
        if (values.since) await resolveMark(layout, values.since);
        const status = await instanceStatus(layout);
        const doctor = status.running
          ? await diagnose(status, (await readState(layout)) ?? {})
          : undefined;
        const logs = values.since
          ? await problemsSince(layout, values.since)
          : undefined;
        const scenarios = [];
        for (const file of await collectFiles(
          directory,
          (name) => name.endsWith(".json") && name !== "summary.json"
        )) {
          try {
            const value = JSON.parse(await readFile(file, "utf8"));
            if (value.scenario && "ok" in value)
              scenarios.push({ ...value, file });
          } catch {
            // Not a scenario report.
          }
        }
        const screenshots = (
          await collectFiles(directory, (name) => name.endsWith(".png"))
        ).filter((file) => !file.includes("-diff/"));
        const passed =
          (doctor?.healthy ?? true) &&
          (logs?.errors.length ?? 0) === 0 &&
          scenarios.every((scenario) => scenario.ok);
        const title =
          values.title ?? relative(join(REPO_ROOT, "test"), directory);
        const report = join(directory, "README.md");
        await writeFile(
          report,
          markdownReport({
            title,
            status,
            doctor,
            logs,
            scenarios,
            screenshots,
            directory
          })
        );
        const summary = join(directory, "summary.json");
        await writeFile(
          summary,
          `${JSON.stringify(
            {
              title,
              generatedAt: new Date().toISOString(),
              passed,
              doctor: doctor && {
                healthy: doctor.healthy,
                reasons: doctor.reasons
              },
              logs: logs && {
                errors: logs.errors,
                warnings: logs.warnings.length
              },
              scenarios: scenarios.map(
                ({
                  scenario,
                  ok,
                  status: runStatus,
                  runId,
                  workId,
                  durationMs,
                  checks,
                  file
                }) => ({
                  scenario,
                  report: relative(directory, file),
                  ok,
                  status: runStatus,
                  runId,
                  workId,
                  durationMs,
                  failed: (checks ?? [])
                    .filter((check) => !check.ok)
                    .map((check) => check.name)
                })
              ),
              screenshots: screenshots.map((file) => relative(directory, file))
            },
            null,
            2
          )}\n`
        );
        return {
          ok: passed,
          data: {
            passed,
            report,
            summary,
            scenarios: scenarios.length,
            screenshots: screenshots.length
          },
          ...(passed ? {} : { nextSteps: [`看 ${report} 里标为未通过的项`] })
        };
      }
    }
  }
};
