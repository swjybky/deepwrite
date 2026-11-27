import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readLogSince } from "./doctor.mjs";
import { readState } from "./instance.mjs";
import { CliError } from "./output.mjs";
import { assertInsideTestEnvironment } from "./paths.mjs";

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;
const MARK_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/u;

const DEV_ERRORS = [
  /\[renderer:error\]/u,
  /Internal server error/iu,
  /Pre-transform error/iu,
  /\[vite\].*(?:error|failed)/iu,
  /render-process-gone/iu,
  /\bUncaught\b/u,
  /\bUnhandled/u,
  /\b(?:Type|Reference|Range|Syntax)Error\b/u,
  /\bError:/u
];
const DEV_WARNINGS = [/\[renderer:warning\]/u, /\bwarn(?:ing)?\b/iu];
/**
 * Vite 8 also relays renderer console output, but only when it detects an
 * agent and only while its HMR socket is up; the [renderer:*] copy from Main
 * is the one counted.
 */
const VITE_CONSOLE_RELAY =
  /\[vite\] \(client\) \[(?:console\.\w+|Unhandled error)\]/u;
const STARTUP_ERRORS = /(?:uncaught|\.gone$|\.failed$)/u;

/** Each source the app writes while the test instance runs. */
export function logSources(layout, state = {}) {
  const diagnostics = join(layout.profile, "diagnostics");
  return [
    {
      id: "dev",
      description:
        "pnpm dev 输出：Main、各 Utility 的控制台，以及测试模式转写的渲染进程控制台（[renderer:级别]）",
      format: "text",
      file: state.logFile
    },
    {
      id: "startup",
      description: "启动阶段、崩溃与子进程退出记录",
      format: "jsonl",
      file: join(diagnostics, "startup.log")
    },
    {
      id: "model-calls",
      description: "子智能体每次模型调用的状态与耗时（读取时只输出摘要）",
      format: "jsonl",
      file: join(diagnostics, "subagent-model-calls.jsonl")
    },
    {
      id: "external-control",
      description: "控制接口写入类工具的审计记录",
      format: "jsonl",
      file: join(layout.profile, "logs", "external-control.jsonl")
    }
  ];
}

export function findSources(layout, state, ids) {
  const sources = logSources(layout, state);
  if (!ids) return sources;
  const wanted = ids.split(",").map((id) => id.trim());
  const unknown = wanted.filter((id) => !sources.some((s) => s.id === id));
  if (unknown.length > 0) {
    throw new CliError(
      "logs.unknown_source",
      `没有日志来源：${unknown.join(", ")}`,
      {
        nextSteps: ["运行 pnpm -s ctl logs sources 查看全部来源"],
        details: { sources: sources.map(({ id }) => id) }
      }
    );
  }
  return sources.filter(({ id }) => wanted.includes(id));
}

export async function fileSize(file) {
  if (!file) return undefined;
  try {
    return (await stat(file)).size;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

const marksFile = (layout) => join(layout.logs, "marks.json");

export async function readMarks(layout) {
  try {
    return JSON.parse(await readFile(marksFile(layout), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function validMarkName(name) {
  if (!MARK_NAME.test(name)) {
    throw new CliError(
      "cli.invalid_arguments",
      `标记名「${name}」无效：用字母、数字、点、下划线或连字符，最长 64 个字符。`,
      { nextSteps: ["例如 --name before-fix"] }
    );
  }
  return name;
}

export async function writeMark(layout, state, name) {
  const marks = await readMarks(layout);
  const sources = {};
  for (const source of logSources(layout, state)) {
    sources[source.id] = {
      file: source.file ?? null,
      offset: (await fileSize(source.file)) ?? 0
    };
  }
  marks[name] = { time: new Date().toISOString(), sources };
  const target = assertInsideTestEnvironment(layout, marksFile(layout));
  await mkdir(layout.logs, { recursive: true });
  await writeFile(`${target}.tmp`, `${JSON.stringify(marks, null, 2)}\n`);
  await rename(`${target}.tmp`, target);
  return marks[name];
}

export async function resolveMark(layout, name) {
  if (!name) return undefined;
  const mark = (await readMarks(layout))[name];
  if (!mark) {
    throw new CliError("logs.unknown_mark", `没有名为「${name}」的标记。`, {
      nextSteps: [
        `先运行 pnpm -s ctl logs mark --name ${name}，再执行要验证的操作`,
        "或去掉 --since，从本次启动后开始读"
      ]
    });
  }
  return mark;
}

/**
 * Text written after the mark. A restart starts a new dev log, so the old
 * file's tail and the whole new file are both read; a log rewritten shorter
 * than the mark (the audit log trims itself) is read from the start.
 */
export async function readSourceSince(source, mark, state = {}) {
  const at = mark?.sources?.[source.id];
  if (!source.file) return { text: "", notes: ["实例没有启动记录"] };
  if (!at) {
    const offset = source.id === "dev" ? (state.logOffsetAtReady ?? 0) : 0;
    return { text: await readLogSince(source.file, offset), notes: [] };
  }
  const notes = [];
  let text = "";
  if (at.file && at.file !== source.file) {
    notes.push("标记之后实例重启过，包含重启前后两份日志");
    text += await readLogSince(at.file, at.offset);
    text += await readLogSince(source.file, 0);
  } else {
    const size = (await fileSize(source.file)) ?? 0;
    if (size < at.offset) notes.push("日志在标记后被截短，从头读取");
    text = await readLogSince(source.file, size < at.offset ? 0 : at.offset);
  }
  return { text, notes };
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return { unparsed: line.slice(0, 500) };
  }
}

/** Model-call entries carry whole prompts; only their outline is shown. */
function summarizeEntry(sourceId, entry) {
  if (sourceId !== "model-calls" || !entry.call) return entry;
  const { call } = entry;
  return {
    time: call.startedAt,
    sessionId: entry.sessionId,
    runId: entry.runId,
    subagentId: entry.subagentId,
    model: `${call.requestedProvider}/${call.requestedModel}`,
    sequence: call.sequence,
    status: call.status,
    durationMs: call.durationMs
  };
}

export function parseLines(source, text, { startedAt } = {}) {
  const lines = text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.trimEnd());
  if (source.format === "text") return lines.filter(Boolean);
  const startedMs = startedAt ? Date.parse(startedAt) : undefined;
  return lines
    .filter(Boolean)
    .map((line) => summarizeEntry(source.id, parseJsonLine(line)))
    .filter((entry) => {
      if (startedMs === undefined) return true;
      const time = Date.parse(entry.time ?? "");
      return Number.isNaN(time) || time >= startedMs;
    });
}

function severity(sourceId, line) {
  if (sourceId === "dev") {
    if (VITE_CONSOLE_RELAY.test(line)) return undefined;
    if (DEV_ERRORS.some((pattern) => pattern.test(line))) return "error";
    if (DEV_WARNINGS.some((pattern) => pattern.test(line))) return "warning";
    return undefined;
  }
  if (sourceId === "startup") {
    return STARTUP_ERRORS.test(line.event ?? "") ? "error" : undefined;
  }
  if (sourceId === "model-calls") {
    if (line.status === "error") return "error";
    return line.status === "interrupted" ? "warning" : undefined;
  }
  if (sourceId === "external-control") {
    return line.result && line.result !== "ok" ? "warning" : undefined;
  }
  return undefined;
}

/** Repeated lines are counted once, keyed by text without numbers and ids. */
export function summarizeProblems(sourceId, lines, ignore) {
  const groups = new Map();
  for (const line of lines) {
    const level = severity(sourceId, line);
    if (!level) continue;
    const text = typeof line === "string" ? line : JSON.stringify(line);
    if (ignore?.test(text)) continue;
    const key = `${level}:${text.replace(/\d+/gu, "#").slice(0, 300)}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else
      groups.set(key, {
        source: sourceId,
        level,
        text: text.slice(0, 2_000),
        count: 1
      });
  }
  return [...groups.values()];
}

export async function collectLogs(layout, { since, source } = {}) {
  const state = (await readState(layout)) ?? {};
  const mark = await resolveMark(layout, since);
  const results = [];
  for (const entry of findSources(layout, state, source)) {
    const { text, notes } = await readSourceSince(entry, mark, state);
    results.push({
      source: entry,
      notes,
      lines: parseLines(entry, text, mark ? {} : { startedAt: state.startedAt })
    });
  }
  return { state, mark, results };
}

export async function problemsSince(layout, since) {
  const { results } = await collectLogs(layout, { since });
  const problems = results.flatMap(({ source, lines }) =>
    summarizeProblems(source.id, lines)
  );
  return {
    errors: problems.filter(({ level }) => level === "error"),
    warnings: problems.filter(({ level }) => level === "warning")
  };
}
