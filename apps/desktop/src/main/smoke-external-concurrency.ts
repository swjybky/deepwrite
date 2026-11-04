import type { ExternalAgentRun } from "@deepwrite/contracts/external-control";
import type { ExternalControl } from "../extras/external-control";

/** Disposable-profile smoke through Main -> real window -> Agent/Core. */
export async function runExternalConcurrencySmoke(
  call: ExternalControl["call"]
) {
  const invoke = (tool: string, args: Record<string, unknown> = {}) =>
    call(tool, args, { name: "concurrency-smoke" });
  const ensure = (value: unknown, why: string) => {
    if (!value) throw new Error(`External concurrency smoke: ${why}`);
  };
  const create = async (title: string) =>
    (await invoke("manage_work", {
      action: "create",
      type: "short",
      genre: "追妻",
      title
    })) as { id: string };
  const books = await Promise.all(
    Array.from({ length: 5 }, (_, i) => create(`独立任务${i}`))
  );
  const first = (await invoke("run_agent", {
    workId: books[0]!.id,
    message: "并发测试任务0",
    newConversation: true,
    mode: "normal"
  })) as ExternalAgentRun;
  ensure(first.status !== "failed", first.error ?? "first run failed");
  // Creating another work while the first is generating must not be blocked.
  const extra = await create("生成期间新建的书");
  ensure(extra.id, "creation during generation");
  const rest = await Promise.all(
    books.slice(1).map(
      (book, i) =>
        invoke("run_agent", {
          workId: book.id,
          message: `并发测试任务${i + 1}`,
          newConversation: true,
          mode: "normal"
        }) as Promise<ExternalAgentRun>
    )
  );
  const runs = [first, ...rest];
  ensure(
    new Set(runs.map((run) => run.sessionId)).size === 5,
    "independent sessions"
  );
  const finish = async (run: ExternalAgentRun) => {
    const deadline = Date.now() + 20_000;
    let status = run;
    while (
      ["running", "waiting_for_input"].includes(status.status) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      status = (await invoke("get_agent_run", {
        runId: run.runId
      })) as ExternalAgentRun;
    }
    ensure(status.status === "completed", status.error ?? status.status);
    return status;
  };
  const results = await Promise.all(runs.map(finish));
  results.forEach((result, i) => {
    ensure(result.workId === books[i]!.id, "run target drift");
    ensure(
      result.reply.includes(`并发测试任务${i}`),
      "reply routed to another book"
    );
  });
  const continued = (await invoke("run_agent", {
    workId: books[0]!.id,
    sessionId: first.sessionId,
    message: "下一阶段续接",
    mode: "normal"
  })) as ExternalAgentRun;
  ensure(
    continued.sessionId === first.sessionId,
    "continuation session changed"
  );
  await finish(continued);
  const previous = (await invoke("get_agent_run", {
    runId: first.runId
  })) as ExternalAgentRun;
  ensure(previous.reply === results[0]!.reply, "old result overwritten");
  return {
    status: "ok",
    sessions: 5,
    continuation: true,
    creationDuringRun: true
  };
}
