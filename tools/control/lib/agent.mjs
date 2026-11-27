import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { connectPage } from "./browser.mjs";
import { CliError } from "./output.mjs";

export const SETTLED = new Set([
  "completed",
  "failed",
  "stopped",
  "interrupted"
]);

/**
 * Polls until the run settles or stops to wait for the user. In auto-approve
 * mode the last proposals briefly report `waiting_for_user` while their saves
 * finish, so that status must persist through a grace period to count.
 */
export async function waitForRun(
  session,
  runId,
  { timeoutMs, intervalMs = 2_000, userGraceMs = 20_000 }
) {
  const started = Date.now();
  let waitingSince;
  for (;;) {
    const run = await session.call("get_agent_run", { runId });
    const elapsed = Date.now() - started;
    if (SETTLED.has(run.status) || run.status === "waiting_for_input") {
      return { run, waitedMs: elapsed, timedOut: false };
    }
    if (run.status === "waiting_for_user") {
      waitingSince ??= Date.now();
      if (Date.now() - waitingSince >= userGraceMs) {
        return { run, waitedMs: elapsed, timedOut: false };
      }
    } else {
      waitingSince = undefined;
    }
    if (elapsed > timeoutMs) return { run, waitedMs: elapsed, timedOut: true };
    await delay(intervalMs);
  }
}

export function runNextSteps(run, timedOut) {
  if (timedOut) {
    return [
      `运行还没结束：继续 pnpm -s ctl agent wait ${run.runId}`,
      `要放弃时 pnpm -s ctl agent stop ${run.runId}`
    ];
  }
  if (run.status === "waiting_for_input") {
    return [
      `智能体在提问，按 questions 回答：pnpm -s ctl agent answer ${run.runId} --answers '[{"id":"<问题id>","selectedOptionIds":["<选项id>"]}]'`
    ];
  }
  if (run.status === "waiting_for_user") {
    return [
      "运行在等用户确认（审批或界面操作），看 reply，必要时 pnpm -s ctl ui snapshot 查看窗口"
    ];
  }
  if (run.status !== "completed") {
    return [
      `运行结束于 ${run.status}：看 error 与 pnpm -s ctl agent trace ${run.runId}`,
      "pnpm -s ctl logs errors 查看同期报错"
    ];
  }
  return [
    `核对结果：pnpm -s ctl agent trace ${run.runId}，再用 app call read_document 回读产物`
  ];
}

/** Test models only; keys stay encrypted in the file and are never read. */
export async function listModels(layout) {
  const config = JSON.parse(
    await readFile(join(layout.config, "models.json"), "utf8")
  );
  return {
    defaultModelId: config.defaultModelId,
    models: config.models.map(
      ({ id, label, provider, modelId, reasoning }) => ({
        id,
        label,
        provider,
        ...(modelId ? { modelId } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(id === config.defaultModelId ? { default: true } : {})
      })
    )
  };
}

function openConversations(layout) {
  return new DatabaseSync(
    join(layout.profile, "renderer-state", "conversations.sqlite"),
    { readOnly: true }
  );
}

/** Scope keys are `conversation-history:` plus the encoded `<id>:<channel>`. */
export function latestSessionFor(layout, targetId) {
  let database;
  try {
    database = openConversations(layout);
    return database
      .prepare(
        "SELECT session_id FROM sessions WHERE scope_key LIKE ? AND deleted = 0 ORDER BY updated_at DESC LIMIT 1"
      )
      .get(`conversation-history:${encodeURIComponent(targetId)}%`)?.session_id;
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

function scopeKeyFor(layout, sessionId) {
  let database;
  try {
    database = openConversations(layout);
    return database
      .prepare(
        "SELECT scope_key FROM sessions WHERE session_id = ? AND deleted = 0"
      )
      .get(sessionId)?.scope_key;
  } catch {
    return undefined;
  } finally {
    database?.close();
  }
}

const clip = (value, limit = 400) => {
  if (value === undefined || value === null) return value;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit
    ? `${text.slice(0, limit)}…（共 ${text.length} 字符）`
    : text;
};

async function historyCall(page, path, input) {
  const { value, exception } = await page.evaluate(`(async () => {
    try {
      return { result: await window.deepwrite.conversationPersistence.history.${path}(${JSON.stringify(input)}) };
    } catch (error) {
      return { failure: error?.message ?? String(error) };
    }
  })()`);
  if (exception || value.failure) {
    throw new CliError(
      "agent.trace_failed",
      `读取对话记录失败：${exception ?? value.failure}`,
      {
        exitCode: 1,
        nextSteps: ["对话可能还在写入，稍后重试 agent trace"]
      }
    );
  }
  return value.result;
}

async function readDetail(page, identity, messageId, path, revision) {
  let offset = 0;
  let text = "";
  for (;;) {
    const part = await historyCall(page, "detail", {
      ...identity,
      messageId,
      path,
      offset,
      expectedRevision: revision
    });
    text += part.chunk;
    if (part.nextOffset === null || part.nextOffset === undefined) break;
    offset = part.nextOffset;
  }
  return JSON.parse(text);
}

/**
 * Tool calls with arguments and results come from the conversation the run
 * wrote; `get_agent_run` only has counts.
 */
export async function traceSession(
  layout,
  sessionId,
  { allTurns = false, full = false } = {}
) {
  const key = scopeKeyFor(layout, sessionId);
  if (!key) {
    throw new CliError(
      "agent.session_not_found",
      `测试实例的对话记录里没有 ${sessionId}。`,
      {
        exitCode: 1,
        nextSteps: [
          "对话还没落盘时等几秒重试",
          "确认 sessionId 来自本测试环境的 agent run"
        ]
      }
    );
  }
  const identity = { key, sessionId };
  const page = await connectPage(layout, { timeoutMs: 30_000 });
  try {
    const messages = [];
    let revision;
    let afterPosition;
    for (;;) {
      const batch = await historyCall(page, "messages", {
        ...identity,
        limit: 200,
        ...(afterPosition !== undefined ? { afterPosition } : {})
      });
      revision = batch.revision;
      messages.push(...batch.messages);
      if (batch.nextPosition === null) break;
      afterPosition = batch.nextPosition;
    }
    const lastUser = messages.findLastIndex(
      (message) => message.value.role === "user"
    );
    const selected =
      allTurns || lastUser < 0 ? messages : messages.slice(lastUser);
    const limit = full ? 20_000 : 400;
    const turns = [];
    for (const message of selected) {
      const value = message.value;
      if (value.role === "user") {
        turns.push({ role: "user", content: clip(value.content, limit) });
        continue;
      }
      if (value.role !== "assistant") continue;
      const hasCalls = message.details.some(
        ({ path }) => path[0] === "toolCalls"
      );
      const hasProposals = message.details.some(
        ({ path }) => path[0] === "editProposals"
      );
      const proposals = hasProposals
        ? await readDetail(
            page,
            identity,
            message.messageId,
            ["editProposals"],
            revision
          )
        : (value.editProposals ?? []);
      const calls = hasCalls
        ? await readDetail(
            page,
            identity,
            message.messageId,
            ["toolCalls"],
            revision
          )
        : (value.tools ?? []);
      turns.push({
        role: "assistant",
        status: value.status,
        model: value.runtime
          ? `${value.runtime.provider}/${value.runtime.model}`
          : undefined,
        configId: value.runtime?.configId,
        usage: value.usage,
        reply: clip(value.content, limit),
        proposals: proposals.map((proposal) => ({
          title: proposal.title,
          status: proposal.status,
          ...(proposal.statusMessage ? { message: proposal.statusMessage } : {})
        })),
        tools: calls.map((call) => ({
          name: call.name,
          status: call.status,
          ...(call.isError ? { isError: true } : {}),
          durationMs:
            call.requestedAt && call.completedAt
              ? Date.parse(call.completedAt) - Date.parse(call.requestedAt)
              : undefined,
          args: clip(call.args ?? call.argumentsText, limit),
          result: clip(call.resultSummary ?? call.summary, limit)
        }))
      });
    }
    return { sessionId, scope: key, turns };
  } finally {
    await page.close();
  }
}

/** Reads the whole text of a work document by its title. */
export async function readDocumentByTitle(session, workId, title) {
  const { documents } = await session.call("get_work", { workId });
  const document = documents.find((candidate) => candidate.title === title);
  if (!document)
    return { found: false, titles: documents.map(({ title: t }) => t) };
  let content = "";
  let offset = 0;
  let revision;
  for (;;) {
    const page = await session.call("read_document", {
      workId,
      documentId: document.id,
      offset
    });
    content += page.content;
    revision = page.revision;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  return { found: true, id: document.id, content, revision };
}

/** One check per expectation; failures say what was seen instead. */
export async function checkRun(session, run, expect) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, ...detail });
  if (expect.status) {
    add(`status=${expect.status}`, run.status === expect.status, {
      actual: run.status,
      ...(run.error ? { error: run.error } : {})
    });
  }
  const used = new Map(
    (run.toolUsage?.byTool ?? []).map((tool) => [tool.name, tool])
  );
  for (const group of expect.tools ?? []) {
    const names = Array.isArray(group) ? group : [group];
    const hit = names.find((name) => (used.get(name)?.succeeded ?? 0) > 0);
    add(`tool:${names.join("|")}`, Boolean(hit), {
      actual: [...used.keys()]
    });
  }
  if (expect.noFailedTools) {
    const failed = [...used.values()].filter((tool) => tool.failed > 0);
    add("noFailedTools", failed.length === 0, {
      actual: failed.map(({ name, failed: count }) => `${name}×${count}`)
    });
  }
  for (const [title, needles] of Object.entries(expect.documents ?? {})) {
    if (!run.workId) {
      add(`document:${title}`, false, { actual: "运行没有关联作品" });
      continue;
    }
    const document = await readDocumentByTitle(session, run.workId, title);
    if (!document.found) {
      add(`document:${title}`, false, {
        actual: "找不到文档",
        titles: document.titles
      });
      continue;
    }
    for (const needle of needles) {
      add(
        `document:${title} 含「${clip(needle, 40)}」`,
        document.content.includes(needle),
        {
          excerpt: clip(document.content.slice(-300), 300)
        }
      );
    }
  }
  for (const [title, needles] of Object.entries(expect.absent ?? {})) {
    if (!run.workId) continue;
    const document = await readDocumentByTitle(session, run.workId, title);
    for (const needle of needles) {
      add(
        `document:${title} 不含「${clip(needle, 40)}」`,
        document.found && !document.content.includes(needle),
        {
          ...(document.found ? {} : { actual: "找不到文档" })
        }
      );
    }
  }
  return checks;
}

/** Auto-approve still settles each proposal; anything but accepted lost the write. */
export function proposalCheck(trace) {
  const proposals = trace.turns.flatMap((turn) => turn.proposals ?? []);
  const unsaved = proposals.filter(
    (proposal) => proposal.status !== "accepted"
  );
  return {
    name: "proposals:全部已保存",
    ok: unsaved.length === 0,
    ...(unsaved.length > 0 ? { actual: unsaved } : { count: proposals.length })
  };
}
