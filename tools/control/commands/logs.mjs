import { readState } from "../lib/instance.mjs";
import {
  collectLogs as collect,
  fileSize,
  logSources,
  readMarks,
  summarizeProblems,
  validMarkName,
  writeMark
} from "../lib/logs.mjs";
import { CliError } from "../lib/output.mjs";
import { countOption } from "../lib/runner.mjs";

const SINCE = {
  type: "string",
  valueName: "标记名",
  description: "只看这个标记之后写入的内容；省略时从本次启动就绪后开始"
};
const SOURCE = {
  type: "string",
  valueName: "来源",
  description: "逗号分隔的来源 id，见 logs sources；默认全部"
};

function regexOption(value, name) {
  if (value === undefined) return undefined;
  try {
    return new RegExp(value, "iu");
  } catch (error) {
    throw new CliError(
      "cli.invalid_arguments",
      `--${name} 不是合法的正则：${error.message}`,
      {
        nextSteps: [`例如 --${name} "ResizeObserver"`]
      }
    );
  }
}

export const logsCommands = {
  summary: "日志：列出来源、打时间标记、读取与按标记汇总新增错误",
  commands: {
    sources: {
      summary: "列出测试实例的全部日志来源与当前大小",
      description:
        "只读。dev 是本次 pnpm dev 的输出，包含 Main、各 Utility 与渲染进程控制台；其余是 App 写在测试数据目录里的结构化日志。",
      options: {},
      examples: ["pnpm -s ctl logs sources"],
      output: { sources: "id、说明、格式、文件路径、是否存在、字节数" },
      errors: {},
      run: async ({ layout }) => {
        const state = (await readState(layout)) ?? {};
        const sources = [];
        for (const source of logSources(layout, state)) {
          const size = await fileSize(source.file);
          sources.push({
            ...source,
            exists: size !== undefined,
            size: size ?? 0
          });
        }
        return {
          data: { sources, marks: Object.keys(await readMarks(layout)) }
        };
      }
    },
    mark: {
      summary: "记下各日志当前的位置，之后用 --since 只看这之后的新内容",
      description:
        "在执行要验证的操作之前打标记，操作后用 logs errors --since <名> 只汇总这段时间新增的错误。同名标记会被覆盖。",
      options: {
        name: {
          type: "string",
          valueName: "标记名",
          default: "last",
          description: "标记名"
        }
      },
      examples: [
        "pnpm -s ctl logs mark",
        "pnpm -s ctl logs mark --name before-fix"
      ],
      output: {
        name: "标记名",
        time: "标记时间",
        sources: "各来源的文件与字节位置"
      },
      errors: {},
      run: async ({ layout, values }) => {
        const name = validMarkName(values.name);
        const state = (await readState(layout)) ?? {};
        return { data: { name, ...(await writeMark(layout, state, name)) } };
      }
    },
    tail: {
      summary: "读取日志最后若干行，可按标记、来源和正则过滤",
      description:
        "只读。去掉终端颜色码；结构化日志按条输出，模型调用日志只输出状态、模型与耗时，不输出提示词。",
      options: {
        source: SOURCE,
        since: SINCE,
        lines: {
          type: "string",
          valueName: "行数",
          default: "80",
          description: "每个来源最多输出的行数（取最后的部分）"
        },
        grep: {
          type: "string",
          valueName: "正则",
          description: "只保留匹配的行，不区分大小写"
        }
      },
      examples: [
        "pnpm -s ctl logs tail --source dev --lines 40",
        "pnpm -s ctl logs tail --since before-fix --grep renderer"
      ],
      output: { logs: "按来源分组的 lines、total（过滤后总行数）与 notes" },
      errors: {
        "logs.unknown_source": "来源 id 不对",
        "logs.unknown_mark": "标记不存在"
      },
      run: async ({ layout, values }) => {
        const limit = countOption(values.lines, "lines", 80, 2_000);
        const grep = regexOption(values.grep, "grep");
        const { mark, results } = await collect(layout, values);
        return {
          data: {
            since: mark ? { name: values.since, time: mark.time } : "ready",
            logs: results.map(({ source, notes, lines }) => {
              const kept = grep
                ? lines.filter((line) =>
                    grep.test(
                      typeof line === "string" ? line : JSON.stringify(line)
                    )
                  )
                : lines;
              return {
                source: source.id,
                file: source.file,
                total: kept.length,
                lines: kept.slice(-limit),
                ...(notes.length > 0 ? { notes } : {})
              };
            })
          }
        };
      }
    },
    errors: {
      summary: "汇总新增的错误与警告；有错误时退出码为 1",
      description:
        "只读。dev 里的渲染进程错误、未捕获异常、热更新与加载错误、Error: 行算错误；启动日志里的崩溃与子进程退出算错误；模型调用 status=error 算错误。相同内容合并计数。先 logs mark 再操作，再用 --since 只看操作带来的新错误。",
      options: {
        source: SOURCE,
        since: SINCE,
        ignore: {
          type: "string",
          valueName: "正则",
          description: "忽略匹配的行（已知且无关的噪声），不区分大小写"
        }
      },
      examples: [
        "pnpm -s ctl logs errors",
        "pnpm -s ctl logs errors --since before-fix",
        `pnpm -s ctl logs errors --since before-fix --ignore "ResizeObserver loop"`
      ],
      output: {
        clean: "没有错误",
        errors: "source、text、count",
        warnings: "source、text、count"
      },
      errors: {
        "logs.unknown_source": "来源 id 不对",
        "logs.unknown_mark": "标记不存在"
      },
      run: async ({ layout, values }) => {
        const ignore = regexOption(values.ignore, "ignore");
        const { mark, results } = await collect(layout, values);
        const problems = results.flatMap(({ source, lines }) =>
          summarizeProblems(source.id, lines, ignore)
        );
        const errors = problems.filter(({ level }) => level === "error");
        const warnings = problems.filter(({ level }) => level === "warning");
        const strip = ({ level: _level, ...problem }) => problem;
        return {
          ok: errors.length === 0,
          data: {
            since: mark ? { name: values.since, time: mark.time } : "ready",
            clean: errors.length === 0,
            errors: errors.slice(0, 50).map(strip),
            warnings: warnings.slice(0, 50).map(strip),
            notes: results.flatMap(({ source, notes }) =>
              notes.map((note) => `${source.id}：${note}`)
            )
          },
          ...(errors.length > 0
            ? {
                nextSteps: [
                  "逐条判断错误是否由本次改动引起，修复后重跑验证",
                  "用 pnpm -s ctl logs tail --source dev --grep <关键词> 查看上下文",
                  "确认无关的噪声用 --ignore 排除，并在回复里说明"
                ]
              }
            : {})
        };
      }
    }
  }
};
