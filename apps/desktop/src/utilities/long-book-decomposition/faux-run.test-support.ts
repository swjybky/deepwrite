import { ExtrasAgentResolvedTaskSchema } from "@deepwrite/contracts";
import { PiAgentRuntimeAdapter } from "@deepwrite/pi-runtime-adapter";
import { queryDecomposition } from "./query";
import { readyDecompositionUnits } from "./workflow";
import { planDecompositionTopic } from "./topic-plan";
import type { decompositionFixture } from "./test-support";

export async function runDecompositionFaux(
  fixture: Awaited<ReturnType<typeof decompositionFixture>>,
  stopAt: "done" | "registry_review" = "done"
) {
  const { service } = fixture;
  let job = fixture.job;
  const adapter = new PiAgentRuntimeAdapter({ evaluationMode: true });
  let bridgeQueue: Promise<unknown> = Promise.resolve();
  const bridge = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = bridgeQueue.then(operation);
    bridgeQueue = pending.catch(() => undefined);
    return pending;
  };
  for (
    let packageIndex = 0;
    job.phase !== stopAt && packageIndex < 100;
    packageIndex++
  ) {
    const ids = readyDecompositionUnits(job);
    if (!ids.length) {
      job = await service.advance(job);
      continue;
    }
    if (!["read", "registry", "integrate", "review"].includes(job.phase))
      throw new Error(`运行停在 ${job.phase}: ${job.lastError ?? ""}`);
    const attemptId = `ldattempt_${packageIndex}`;
    const opened = await service.open(
      { jobId: job.id, phase: job.phase as "read", unitIds: ids },
      job.profile.id,
      attemptId
    );
    const errors: string[] = [];
    for await (const event of adapter.startExtras({
      runId: `run_${packageIndex}`,
      spec: {
        sessionId: `session_${packageIndex}`,
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: "long-book-decomposition",
          profile: job.profile,
          input: opened.input
        })
      },
      decompositionQuery: (id, request) =>
        bridge(async () =>
          queryDecomposition(
            await service.state.load(id),
            fixture.root,
            service.reader,
            request
          )
        ),
      decompositionSubmit: (input) => bridge(() => service.submit(input)),
      decompositionPlanTopic: (input) =>
        bridge(() => planDecompositionTopic(service.state, input))
    })) {
      if (event.type === "agent.error") errors.push(event.payload.message);
      if (event.type === "agent.tool_completed" && event.payload.isError)
        errors.push(JSON.stringify(event.payload));
    }
    if (errors.length) throw new Error(errors.join("\n"));
    job = (await service.control({
      jobId: job.id,
      action: "finish-package",
      attemptId
    }))!;
    const missing = ids.filter((id) => job.units[id]?.status !== "done");
    if (missing.length)
      throw new Error(
        JSON.stringify(missing.map((id) => ({ id, unit: job.units[id] })))
      );
    job = await service.advance(job);
  }
  if (job.phase !== stopAt) throw new Error(`工作包数量超限: ${job.phase}`);
  return job;
}
