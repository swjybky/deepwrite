import type { createDecompositionTrialDiagnostics } from "./smoke-decomposition-trial-diagnostic";
import type {
  DeepWriteApi,
  LongBookDecompositionJob,
  SystemEventEnvelope
} from "@deepwrite/contracts";

export async function decompositionSmokeInRenderer(
  makeDiagnostics: typeof createDecompositionTrialDiagnostics,
  realModel = false,
  trialModelId?: string
) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const { diagnostic, trialRequest, recordTool, recordFailure } =
    makeDiagnostics(realModel);
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Decomposition smoke: ${reason}`);
  };
  let modelId = "decomposition_smoke_model";
  let thinkingLevel:
    "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" = "off";
  if (realModel) {
    ensure(
      trialModelId,
      "real-model trial requires an explicitly selected model id"
    );
    const settings = await trialRequest("model-catalog", () =>
      api.models.refreshFree()
    );
    const selected = settings.deepwriteFreeModels?.find(
      (model) =>
        model.id === trialModelId &&
        model.hasApiKey &&
        model.status !== 1 &&
        (model.contextWindow === undefined || model.contextWindow >= 16_000)
    );
    ensure(
      selected,
      "no eligible free model is available for the real-model trial"
    );
    modelId = selected!.id;
    const { hasApiKey: _hasApiKey, ...capacityInput } = selected!;
    const capacity = await trialRequest("model-capacity", () =>
      api.models.resolveCapacity(capacityInput)
    );
    ensure(
      capacity.contextWindow >= 16_000,
      "selected model window is too small"
    );
    const configuredThinking = selected!.defaultThinkingLevel;
    if (
      ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
        configuredThinking
      )
    )
      thinkingLevel = configuredThinking as typeof thinkingLevel;
    await trialRequest("model-enable", () =>
      api.models.setFreeModelEnabled(modelId, true)
    );
  } else
    await api.models.save({
      defaultModelId: "",
      models: []
    });
  const source = await trialRequest("source-load", () =>
    api.longBookAnalysis.sources.load(
      "long_book_analysis_source_smoke_decomposition"
    )
  );
  const confirmation = await trialRequest("source-confirm", () =>
    api.longBookAnalysis.sources.confirm({
      sourceId: source.id,
      sourceRevision: source.revision!,
      fingerprint: source.fingerprint!,
      range: { start: 1, end: 3 }
    })
  );
  const profiles = await trialRequest("profile-load", () =>
    api.extrasAgents.profiles.list("long-book-decomposition")
  );
  let profileId = profiles.profiles[0]!.id;
  if (realModel) {
    profileId = "decomposition-real-model-trial";
    await trialRequest("profile-save", () =>
      api.extrasAgents.profiles.save({
        agentId: "long-book-decomposition",
        profiles: [
          {
            id: profileId,
            worldCategories: profiles.profiles[0]!.worldCategories,
            name: "自写样书试拆",
            description: "真实模型桌面验证。",
            systemPrompt:
              "忠实于这本自写短样书；每条记录使用简短中文，每个字段尽量控制在 100 字内，保持事实、证据和必需字段完整。不要登记额外专题。"
          }
        ]
      })
    );
  }
  const results: Array<{
    mode: string;
    bookId?: string;
    groupId?: string;
    packages: number;
    units: number;
  }> = [];
  let targetEvents = 0,
    outputEvents = 0,
    childEvents = 0;
  const runPackage = async (
    job: LongBookDecompositionJob,
    unitIds: string[]
  ) => {
    const sessionId = `smoke_decomposition_${Date.now()}`;
    const savedUnits = new Set<string>();
    const errors: string[] = [];
    let finish!: () => void;
    const terminal = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = api.events.subscribe((event: SystemEventEnvelope) => {
      if (
        event.type === "decomposition.target_updated" &&
        event.payload.jobId === job.id
      ) {
        targetEvents++;
        diagnostic.targetEvents = targetEvents;
        if (event.payload.unitId) savedUnits.add(event.payload.unitId);
        return;
      }
      if (
        !("sessionId" in event.payload) ||
        event.payload.sessionId !== sessionId
      )
        return;
      if (event.type.startsWith("subagent.")) childEvents++;
      if (event.type === "tool.execution_completed")
        recordTool(
          event.payload.toolName,
          event.payload.isError,
          event.payload.resultSummary
        );
      if (
        event.type === "subagent.activity" &&
        event.payload.activity.type === "tool_completed"
      ) {
        const activity = event.payload.activity;
        recordTool(activity.toolName, activity.isError, activity.resultSummary);
      }
      if (event.type === "subagent.completed") {
        diagnostic.childStatuses[event.payload.status] =
          (diagnostic.childStatuses[event.payload.status] ?? 0) + 1;
        if (event.payload.errorMessage)
          recordFailure(event.payload.errorMessage);
      }
      if (event.type === "extras_agent.output_updated") {
        outputEvents++;
        diagnostic.outputEvents = outputEvents;
        const output = event.payload.output;
        if (
          "unitId" in output &&
          typeof output.unitId === "string" &&
          "receipt" in output &&
          // Task-local records have no creative-workspace change to notify.
          output.receipt.refs.length > 0 &&
          !savedUnits.has(output.unitId)
        )
          errors.push("output preceded durable target notification");
      }
      if (event.type === "agent.error") {
        errors.push(realModel ? event.payload.code : event.payload.message);
        if (realModel) {
          const status = event.payload.message.match(
            /(?:^|\bHTTP\s+|\bstatus(?:Code)?[:\s]+)(400|401|402|403|404|408|413|429|500|502|503|504)\b/u
          )?.[1];
          if (status) errors.push(`provider-http-${status}`);
        }
      }
      if (
        event.type === "agent.message_completed" ||
        event.type === "agent.error"
      )
        finish();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const accepted = await trialRequest("package-start", () =>
        api.extrasAgents.run({
          sessionId,
          modelId,
          thinkingLevel,
          task: {
            agentId: "long-book-decomposition",
            profileId,
            input: { jobId: job.id, phase: job.phase as "read", unitIds }
          }
        })
      );
      ensure(
        accepted.runtime.mode === (realModel ? "provider" : "local-faux"),
        "unexpected runtime"
      );
      const opened = await trialRequest("attempt-load", () =>
        api.longBookDecomposition.getJob(job.id)
      );
      const attemptId = opened.activeAttemptId;
      ensure(attemptId, "attempt not persisted");
      diagnostic.step = "package-wait";
      await Promise.race([
        terminal,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("decomposition package timed out")),
            realModel ? 360_000 : 45_000
          );
        })
      ]);
      ensure(errors.length === 0, errors.join("; "));
      const finished = await trialRequest("package-finish", () =>
        api.longBookDecomposition.control({
          jobId: job.id,
          action: "finish-package",
          attemptId: attemptId!
        })
      );
      diagnostic.done = Object.values(finished!.units).filter(
        ({ status }) => status === "done"
      ).length;
      diagnostic.unitStatuses = {};
      for (const unit of Object.values(finished!.units))
        diagnostic.unitStatuses[unit.status] =
          (diagnostic.unitStatuses[unit.status] ?? 0) + 1;
      ensure(finished?.status !== "failed", "package coverage incomplete");
      return finished!;
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
    }
  };
  const modes = realModel
    ? (["continuation"] as const)
    : (["continuation", "materials"] as const);
  for (const mode of modes) {
    let job = await trialRequest("target-create", () =>
      api.longBookDecomposition.createJob({
        mode,
        confirmation,
        profileId,
        targetSelection: {
          action: "create",
          kind: mode === "continuation" ? "long" : "material-group",
          title: `冒烟样书 ${mode}`
        },
        models: {
          reading: { modelId, thinkingLevel },
          integration: { modelId, thinkingLevel }
        },
        autoContinue: true,
        maxConcurrency: 5
      })
    );
    diagnostic.step = "target-check";
    diagnostic.phase = job.phase;
    diagnostic.status = job.status;
    diagnostic.units = Object.keys(job.units).length;
    ensure(
      job.target?.state === "ready" && job.phase === "read",
      job.lastError ?? "target not prepared"
    );
    let packages = 0;
    for (let step = 0; step < 40 && job.phase !== "done"; step++) {
      const ids = Object.entries(job.units)
        .filter(
          ([id, unit]) =>
            unit.phase === job.phase &&
            unit.status === "pending" &&
            !id.startsWith("reading:") &&
            (id.startsWith("chunk:") ||
              unit.dependencies.every((dependency) =>
                ["done", "skipped"].includes(
                  job.units[dependency]?.status ?? ""
                )
              ))
        )
        .map(([id]) => id)
        .slice(0, 20);
      if (ids.length) {
        job = await runPackage(job, ids);
        packages++;
      } else
        job = (await trialRequest("phase-advance", () =>
          api.longBookDecomposition.control({
            jobId: job.id,
            action: "advance"
          })
        ))!;
      ensure(
        !job.lastError && job.status !== "failed",
        job.lastError ?? "job failed"
      );
      diagnostic.phase = job.phase;
      diagnostic.status = job.status;
      diagnostic.units = Object.keys(job.units).length;
      diagnostic.done = Object.values(job.units).filter(
        ({ status }) => status === "done"
      ).length;
    }
    ensure(
      job.phase === "done" && job.status === "completed",
      "job did not complete"
    );
    const restored = await api.longBookDecomposition.getJob(job.id);
    ensure(
      Object.values(restored.units).every(({ status }) => status === "done"),
      "recovered target contents differ"
    );
    const artifacts = await api.longBookDecomposition.listResults(job.id);
    ensure(
      artifacts.length === Object.keys(job.units).length,
      "result references missing"
    );
    if (job.target?.kind === "long") {
      const opened = await api.long.open({ bookId: job.target.bookId });
      const index = opened.book.workspaceIndex;
      ensure(
        index.chapters.length === 3 &&
          index.ledger.commits.length === 1 &&
          index.ledger.commits[0]?.mode === "text_files_batch",
        "native ledger invalid"
      );
      ensure(
        realModel
          ? index.characters.length >= 1
          : index.characters.length === 2 &&
              index.plot.foreshadowing.length === 1 &&
              index.plot.foreshadowing[0]?.status === "resolved",
        "native entities invalid"
      );
      results.push({
        mode,
        bookId: job.target.bookId,
        packages,
        units: artifacts.length
      });
    } else if (job.target?.kind === "material-group") {
      const catalog = await api.catalog.index();
      ensure(
        Object.values(job.target.libraryIds).every((id) =>
          catalog.materials.some(
            (library) => library.id === id && library.entries.length > 0
          )
        ),
        "five material libraries incomplete"
      );
      results.push({
        mode,
        groupId: job.target.groupId,
        packages,
        units: artifacts.length
      });
    }
  }
  return {
    status: "ok",
    runtime: realModel ? "provider" : "local-faux",
    modes: results,
    targetEvents,
    outputEvents,
    childEvents
  };
}
