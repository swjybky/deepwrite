import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETTLED,
  checkRun,
  latestSessionFor,
  listModels,
  proposalCheck,
  runNextSteps,
  traceSession,
  waitForRun
} from "../lib/agent.mjs";
import { openControlSession } from "../lib/control-client.mjs";
import { loadFixture } from "../lib/fixtures.mjs";
import { problemsSince, writeMark } from "../lib/logs.mjs";
import { readState } from "../lib/instance.mjs";
import { CliError } from "../lib/output.mjs";
import { resolveArtifactPath } from "../lib/paths.mjs";
import { jsonOption, secondsOption } from "../lib/runner.mjs";

const SCENARIOS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../scenarios"
);
const RUN_TIMEOUT = {
  type: "string",
  valueName: "秒",
  default: "600",
  description: "等待运行结束的最长时间；超时不会中止运行"
};

async function withSession(layout, action) {
  const session = await openControlSession(layout, { timeoutMs: 60_000 });
  try {
    return await action(session);
  } finally {
    session.close();
  }
}

function runResult(run, waitedMs, timedOut) {
  const { reply, ...rest } = run;
  return {
    ok: run.status === "completed" && !timedOut,
    data: {
      ...rest,
      reply: reply.length > 2_000 ? `${reply.slice(0, 2_000)}…` : reply,
      waitedMs,
      timedOut
    },
    nextSteps: runNextSteps(run, timedOut)
  };
}

async function listScenarios() {
  const names = (await readdir(SCENARIOS_DIR))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const scenarios = [];
  for (const file of names) {
    scenarios.push({
      name: basename(file, ".json"),
      ...JSON.parse(await readFile(join(SCENARIOS_DIR, file), "utf8"))
    });
  }
  return scenarios;
}

function withToken(value, token) {
  return JSON.parse(JSON.stringify(value).replaceAll("{{token}}", token));
}

async function runScenario(layout, scenario, { timeoutMs, mode }) {
  const token = `DW-${scenario.name.toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
  const filled = withToken(scenario, token);
  const markName = `scenario-${scenario.name}`;
  const startedAt = Date.now();
  return withSession(layout, async (session) => {
    const [work] = await loadFixture(layout, session, {
      name: `scenario:${scenario.name}`,
      works: [{ ...filled.work, documents: filled.sources, sections: [] }],
      libraries: []
    });
    await writeMark(layout, (await readState(layout)) ?? {}, markName);
    const started = await session.call("run_agent", {
      workId: work.id,
      message: filled.message,
      newConversation: true,
      mode
    });
    const { run, timedOut } = await waitForRun(session, started.runId, {
      timeoutMs
    });
    if (!SETTLED.has(run.status) && !timedOut) {
      await session
        .call("stop_agent_run", { runId: run.runId })
        .catch(() => undefined);
    }
    const checks = await checkRun(session, run, filled.expect);
    const logs = await problemsSince(layout, markName);
    checks.push({
      name: "logs:无新增错误",
      ok: logs.errors.length === 0,
      ...(logs.errors.length > 0 ? { actual: logs.errors.slice(0, 10) } : {})
    });
    if (timedOut)
      checks.push({ name: "在限定时间内结束", ok: false, actual: run.status });
    let trace;
    try {
      trace = await traceSession(layout, run.sessionId);
      checks.push(proposalCheck(trace));
    } catch (error) {
      trace = { error: error.message };
      checks.push({
        name: "proposals:全部已保存",
        ok: false,
        actual: `读不到对话记录：${error.message}`
      });
    }
    return {
      scenario: scenario.name,
      summary: scenario.summary,
      ok: checks.every((check) => check.ok),
      token,
      workId: work.id,
      runId: run.runId,
      sessionId: run.sessionId,
      status: run.status,
      durationMs: Date.now() - startedAt,
      toolUsage: run.toolUsage,
      checks,
      warnings: logs.warnings.slice(0, 10),
      trace
    };
  });
}

export const agentCommands = {
  summary:
    "智能体：用真实模型在测试实例里运行、等待、回答提问、看工具明细、断言结果、跑五类场景",
  commands: {
    models: {
      summary: "列出测试实例的模型与默认模型（不含密钥）",
      description:
        "只读测试配置 models.json 的 id、名称、提供方。运行用默认模型，env seed 把它设为官方小站 Deepseek-v4.1-flash。",
      options: {},
      examples: ["pnpm -s ctl agent models"],
      output: { defaultModelId: "默认模型", models: "全部模型" },
      errors: {},
      run: async ({ layout }) => ({ data: await listModels(layout) })
    },
    run: {
      summary: "让作品或资料库的内置智能体执行一条消息（真实模型）",
      description:
        "经控制接口 run_agent 发起，与界面里发送消息同一路径，窗口里能看到对话。默认等到结束（或智能体提问、等待确认）再返回；--no-wait 立即返回 runId。测试实例是自动审批，提案直接落盘。",
      options: {
        work: {
          type: "string",
          valueName: "id",
          description: "作品 id（data list）"
        },
        library: { type: "string", valueName: "id", description: "资料库 id" },
        message: {
          type: "string",
          valueName: "文字",
          description: "发给智能体的消息"
        },
        mode: {
          type: "string",
          valueName: "normal|team",
          description:
            "normal 只用主智能体；team 用作品绑定的团队；省略时有团队就用团队"
        },
        session: {
          type: "string",
          valueName: "sessionId",
          description: "接着某个对话继续"
        },
        new: { type: "boolean", description: "开新对话" },
        "no-wait": { type: "boolean", description: "不等结束，立即返回 runId" },
        timeout: RUN_TIMEOUT
      },
      examples: [
        `pnpm -s ctl agent run --work book-1234abcd --new --mode normal --message "读取剧情设计，续写第一节两句"`
      ],
      output: {
        runId: "运行 id",
        sessionId: "对话 id",
        status: "completed、waiting_for_input、failed…",
        toolUsage: "按工具统计的调用次数",
        changes: "改动的文档"
      },
      errors: {
        "cli.invalid_arguments": "--work 与 --library 给一个，且要有 --message",
        "app.tool_rejected":
          "目标不存在、正忙（external.busy）或窗口未就绪（external.not_ready）"
      },
      run: async ({ layout, values }) => {
        if (
          Boolean(values.work) === Boolean(values.library) ||
          !values.message
        ) {
          throw new CliError(
            "cli.invalid_arguments",
            "需要 --work 或 --library 之一，以及 --message。",
            {
              nextSteps: ["运行 pnpm -s ctl data list 查看 id"]
            }
          );
        }
        if (values.mode && !["normal", "team"].includes(values.mode)) {
          throw new CliError(
            "cli.invalid_arguments",
            "--mode 只能是 normal 或 team。",
            {
              nextSteps: ["例如 --mode normal"]
            }
          );
        }
        const timeoutMs = secondsOption(values.timeout, "timeout", 600);
        return withSession(layout, async (session) => {
          const started = await session.call("run_agent", {
            ...(values.work
              ? { workId: values.work }
              : { libraryId: values.library }),
            message: values.message,
            ...(values.mode ? { mode: values.mode } : {}),
            ...(values.session ? { sessionId: values.session } : {}),
            ...(values.new ? { newConversation: true } : {})
          });
          if (values["no-wait"]) {
            return {
              data: started,
              nextSteps: [`pnpm -s ctl agent wait ${started.runId}`]
            };
          }
          const { run, waitedMs, timedOut } = await waitForRun(
            session,
            started.runId,
            { timeoutMs }
          );
          return runResult(run, waitedMs, timedOut);
        });
      }
    },
    wait: {
      summary: "等一个运行结束、提问或等待确认",
      description: "每 2 秒查询一次。超时只是停止等待，运行继续，可再次 wait。",
      positionals: [
        { name: "runId", required: true, description: "agent run 返回的 runId" }
      ],
      options: { timeout: RUN_TIMEOUT },
      examples: ["pnpm -s ctl agent wait <runId>"],
      output: { status: "运行状态", timedOut: "是否等待超时" },
      errors: { "app.tool_rejected": "runId 不存在" },
      run: async ({ layout, args, values }) =>
        withSession(layout, async (session) => {
          const { run, waitedMs, timedOut } = await waitForRun(
            session,
            args.runId,
            {
              timeoutMs: secondsOption(values.timeout, "timeout", 600)
            }
          );
          return runResult(run, waitedMs, timedOut);
        })
    },
    answer: {
      summary: "回答智能体的提问（waiting_for_input）并继续等待",
      description:
        "answers 按 questions 里的问题 id 给出 selectedOptionIds 或 text。回答后默认继续等到下一次停下。",
      positionals: [{ name: "runId", required: true, description: "runId" }],
      options: {
        answers: {
          type: "string",
          valueName: "JSON",
          description: '如 [{"id":"q1","selectedOptionIds":["a"]}]'
        },
        timeout: RUN_TIMEOUT
      },
      examples: [
        `pnpm -s ctl agent answer <runId> --answers '[{"id":"q1","text":"用第一种落款"}]'`
      ],
      output: { status: "回答后的运行状态" },
      errors: { "app.tool_rejected": "运行没在提问，或答案与问题对不上" },
      run: async ({ layout, args, values }) => {
        const answers = jsonOption(values.answers, "answers", undefined);
        if (!Array.isArray(answers) || answers.length === 0) {
          throw new CliError(
            "cli.invalid_arguments",
            "--answers 必须是非空 JSON 数组。",
            {
              nextSteps: [
                `先 pnpm -s ctl agent wait ${args.runId} 看 questions`
              ]
            }
          );
        }
        return withSession(layout, async (session) => {
          await session.call("answer_agent_question", {
            runId: args.runId,
            answers
          });
          const { run, waitedMs, timedOut } = await waitForRun(
            session,
            args.runId,
            {
              timeoutMs: secondsOption(values.timeout, "timeout", 600)
            }
          );
          return runResult(run, waitedMs, timedOut);
        });
      }
    },
    stop: {
      summary: "中止一个运行",
      description: "经 stop_agent_run 中止，已落盘的改动保留。",
      positionals: [{ name: "runId", required: true, description: "runId" }],
      options: {},
      examples: ["pnpm -s ctl agent stop <runId>"],
      output: { status: "中止后的状态" },
      errors: { "app.tool_rejected": "运行已结束或不存在" },
      run: async ({ layout, args }) =>
        withSession(layout, async (session) => ({
          data: await session.call("stop_agent_run", { runId: args.runId })
        }))
    },
    trace: {
      summary:
        "看一次运行的模型、用量和逐个工具调用（参数、结果、耗时、是否出错）",
      description:
        "从测试实例的对话记录读取。给 runId（agent run 发起的），或用 --work 看这部作品最近一次对话（在界面里直接发消息时没有 runId）。默认只看最后一轮（最后一条用户消息之后），--all 看整个对话，--full 不截断参数与结果。",
      positionals: [
        {
          name: "runId",
          description: "agent run 返回的 runId；与 --work 二选一"
        }
      ],
      options: {
        work: {
          type: "string",
          valueName: "id",
          description: "作品或资料库 id：看它最近更新的对话"
        },
        all: { type: "boolean", description: "整个对话的所有轮次" },
        full: {
          type: "boolean",
          description: "参数与结果不截断（最多 2 万字符）"
        }
      },
      examples: [
        "pnpm -s ctl agent trace <runId>",
        "pnpm -s ctl agent trace <runId> --full",
        "pnpm -s ctl agent trace --work book-1234abcd"
      ],
      output: {
        turns:
          "用户消息与助手轮次：model、usage、reply、tools[name,status,args,result,durationMs]、proposals[title,status,message]"
      },
      errors: {
        "agent.session_not_found": "对话还没落盘或不属于测试环境",
        "agent.trace_failed": "读取对话记录失败"
      },
      run: async ({ layout, args, values }) => {
        if (Boolean(args.runId) === Boolean(values.work)) {
          throw new CliError(
            "cli.invalid_arguments",
            "runId 与 --work 给一个。",
            {
              nextSteps: ["界面里直接发的消息用 --work <作品id>"]
            }
          );
        }
        if (values.work) {
          const sessionId = latestSessionFor(layout, values.work);
          if (!sessionId) {
            throw new CliError(
              "agent.session_not_found",
              `${values.work} 还没有对话记录。`,
              { nextSteps: ["确认作品 id，或等对话落盘后重试"] }
            );
          }
          return {
            data: await traceSession(layout, sessionId, {
              allTurns: values.all,
              full: values.full
            })
          };
        }
        const run = await withSession(layout, (session) =>
          session.call("get_agent_run", { runId: args.runId })
        );
        if (!run.sessionId) {
          throw new CliError(
            "agent.session_not_found",
            "这个运行没有对话 id。",
            {
              nextSteps: ["运行还没开始写对话时稍后重试"]
            }
          );
        }
        return {
          data: {
            runId: run.runId,
            status: run.status,
            toolUsage: run.toolUsage,
            ...(await traceSession(layout, run.sessionId, {
              allTurns: values.all,
              full: values.full
            }))
          }
        };
      }
    },
    assert: {
      summary: "断言一次运行的结果：状态、用到的工具、文档内容、日志",
      description:
        "每项给出通过与否和看到的实际值，任一不通过退出码为 1。--doc 与 --absent 的格式是 文档标题=文字，可重复；文档从运行关联的作品读取。",
      positionals: [{ name: "runId", required: true, description: "runId" }],
      options: {
        status: {
          type: "string",
          valueName: "状态",
          default: "completed",
          description: "期望的运行状态"
        },
        tools: {
          type: "string",
          valueName: "工具",
          description: "逗号分隔，必须至少成功一次；a|b 表示任一"
        },
        "no-failed-tools": {
          type: "boolean",
          description: "不允许任何工具调用失败"
        },
        doc: {
          type: "string",
          multiple: true,
          valueName: "标题=文字",
          description: "文档必须包含的文字，可重复"
        },
        absent: {
          type: "string",
          multiple: true,
          valueName: "标题=文字",
          description: "文档不能包含的文字，可重复"
        },
        "logs-since": {
          type: "string",
          valueName: "标记名",
          description: "这个日志标记之后不能有新增错误"
        },
        saved: {
          type: "boolean",
          description:
            "本轮每个写入提案都已保存（读对话记录，查出冲突或报错的提案）"
        }
      },
      examples: [
        'pnpm -s ctl agent assert <runId> --tools read,edit|write --doc "第一节 · 正文=DW-1234" --logs-since before-run'
      ],
      output: { passed: "是否全部通过", checks: "逐项 name、ok、actual" },
      errors: { "logs.unknown_mark": "日志标记不存在" },
      run: async ({ layout, args, values }) => {
        const pairs = (list, name) =>
          (list ?? []).reduce((result, item) => {
            const index = item.indexOf("=");
            if (index <= 0) {
              throw new CliError(
                "cli.invalid_arguments",
                `--${name} 的格式是 文档标题=文字：${item}`,
                {
                  nextSteps: [`例如 --${name} "第一节 · 正文=DW-1234"`]
                }
              );
            }
            const title = item.slice(0, index);
            (result[title] ??= []).push(item.slice(index + 1));
            return result;
          }, {});
        const expect = {
          status: values.status,
          tools: values.tools
            ? values.tools.split(",").map((group) => group.split("|"))
            : [],
          noFailedTools: values["no-failed-tools"],
          documents: pairs(values.doc, "doc"),
          absent: pairs(values.absent, "absent")
        };
        const checks = await withSession(layout, async (session) =>
          checkRun(
            session,
            await session.call("get_agent_run", { runId: args.runId }),
            expect
          )
        );
        if (values.saved) {
          const run = await withSession(layout, (session) =>
            session.call("get_agent_run", { runId: args.runId })
          );
          checks.push(proposalCheck(await traceSession(layout, run.sessionId)));
        }
        if (values["logs-since"]) {
          const logs = await problemsSince(layout, values["logs-since"]);
          checks.push({
            name: "logs:无新增错误",
            ok: logs.errors.length === 0,
            ...(logs.errors.length > 0
              ? { actual: logs.errors.slice(0, 10) }
              : {})
          });
        }
        const passed = checks.every((check) => check.ok);
        return {
          ok: passed,
          data: { passed, checks },
          ...(passed
            ? {}
            : {
                nextSteps: [
                  `看失败项的 actual，再用 pnpm -s ctl agent trace ${args.runId} 查原因`
                ]
              })
        };
      }
    },
    scenario: {
      summary: "跑预置的真实模型场景：短篇、剧本、长篇、剧本杀、学术",
      description:
        "每个场景：建一部合成作品并写入来源 → 打日志标记 → 用主智能体（真实模型）发起任务 → 等结束 → 断言状态、工具、产物里的校验词、来源未被改坏、写入提案全部保存、无新增报错 → 附工具明细。场景定义在 tools/control/scenarios/。作品记进数据集台账，用 data clear --loaded 清理。场景间按顺序执行；一个场景通常 1 到 3 分钟。",
      positionals: [
        {
          name: "name",
          required: true,
          description: "场景名或 all；list 列出全部"
        }
      ],
      options: {
        timeout: {
          ...RUN_TIMEOUT,
          description: "每个场景等待运行结束的最长时间"
        },
        mode: {
          type: "string",
          valueName: "normal|team",
          default: "normal",
          description: "运行模式"
        },
        "out-dir": {
          type: "string",
          valueName: "目录",
          description:
            "报告目录（测试环境内或仓库 test/ 下），默认 artifacts/scenarios/<时间>/"
        }
      },
      examples: [
        "pnpm -s ctl agent scenario list",
        "pnpm -s ctl agent scenario short",
        "pnpm -s ctl agent scenario all --out-dir test/2026-11-23-agent/scenarios"
      ],
      output: {
        results: "每个场景的 ok、checks、runId、workId、durationMs",
        reports: "每个场景的完整 JSON 报告（含工具明细）"
      },
      errors: {
        "agent.unknown_scenario": "场景名不对",
        "app.control_unavailable": "实例没在运行"
      },
      run: async ({ layout, args, values }) => {
        const scenarios = await listScenarios();
        if (args.name === "list") {
          return {
            data: {
              scenarios: scenarios.map(({ name, summary }) => ({
                name,
                summary
              }))
            }
          };
        }
        const selected =
          args.name === "all"
            ? scenarios
            : scenarios.filter(({ name }) => name === args.name);
        if (selected.length === 0) {
          throw new CliError(
            "agent.unknown_scenario",
            `没有场景「${args.name}」。`,
            {
              nextSteps: ["运行 pnpm -s ctl agent scenario list"],
              details: { scenarios: scenarios.map(({ name }) => name) }
            }
          );
        }
        const outDirectory = resolveArtifactPath(
          layout,
          values["out-dir"] ??
            join(
              layout.artifacts,
              "scenarios",
              new Date().toISOString().replace(/[:.]/gu, "-")
            )
        );
        await mkdir(outDirectory, { recursive: true });
        const timeoutMs = secondsOption(values.timeout, "timeout", 600);
        const results = [];
        const reports = [];
        for (const scenario of selected) {
          let report;
          try {
            report = await runScenario(layout, scenario, {
              timeoutMs,
              mode: values.mode
            });
          } catch (error) {
            report = {
              scenario: scenario.name,
              ok: false,
              error: {
                code: error.code ?? "agent.scenario_failed",
                message: error.message,
                details: error.details
              }
            };
          }
          const file = join(outDirectory, `${scenario.name}.json`);
          await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
          reports.push(file);
          results.push({
            scenario: scenario.name,
            ok: report.ok,
            ...(report.error ? { error: report.error } : {}),
            status: report.status,
            workId: report.workId,
            runId: report.runId,
            durationMs: report.durationMs,
            toolCalls: report.toolUsage?.byTool?.map(
              ({ name, succeeded, failed }) =>
                `${name} ${succeeded}✓${failed ? ` ${failed}✗` : ""}`
            ),
            failed: report.checks?.filter((check) => !check.ok)
          });
        }
        const passed = results.every((result) => result.ok);
        return {
          ok: passed,
          data: { passed, outDirectory, results, reports },
          ...(passed
            ? {}
            : {
                nextSteps: [
                  "看 results[].failed 与对应报告里的 trace",
                  "智能体逻辑问题用 pnpm -s ctl agent trace <runId> --full 看工具参数与结果",
                  "清理场景作品：pnpm -s ctl data clear --loaded"
                ]
              })
        };
      }
    }
  }
};
