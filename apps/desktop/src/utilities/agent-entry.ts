import { createBookIdentityService } from "./agent-book-identity-service";
import {
  ModelCapacityResultSchema,
  ModelConnectionTestResultSchema,
  ModelTestCancelResultSchema,
  SessionPromptAcceptedPayloadSchema,
  type CommandResult,
  type ExtrasAgentRunSpec
} from "@deepwrite/contracts";
import {
  ModelConnectionTestCancelledError,
  ModelConnectionTestTimeoutError,
  PiAgentRuntimeAdapter
} from "@deepwrite/pi-runtime-adapter";
import { nowIso } from "@deepwrite/shared";
import {
  createAgentRunInput,
  createCoreCommandExecutor
} from "./agent-run-input";
import { handleAgentRunControl } from "./agent-run-control";
import { AgentModelTestRegistry } from "./agent-model-test-registry";
import { AgentRunRegistry } from "./agent-run-registry";
import { createDecompositionServices } from "./agent-decomposition-services";
import { bootUtility } from "./runtime";

/** A long project chat reads the book through the Core query bridge. */
function readsLongProject({ task }: ExtrasAgentRunSpec): boolean {
  return (
    (task.agentId === "chat-project" &&
      task.input.project.projectType === "long") ||
    ((task.agentId === "book-title-design" ||
      task.agentId === "book-synopsis-design" ||
      task.agentId === "book-cover-design") &&
      task.input.book.projectType === "long")
  );
}

const runtime = new PiAgentRuntimeAdapter({
  evaluationMode: process.env.DEEPWRITE_APP_MODE === "evaluation"
});
const runs = new AgentRunRegistry();
const modelTests = new AgentModelTestRegistry();

bootUtility("agent", {
  mode: "pi-agent-provider",
  async commandHandler(command, emitEvent, context): Promise<CommandResult> {
    if (command.type === "agent.model_test") {
      const testRequestId = command.payload.requestId ?? command.id;
      const testRun = modelTests.begin(testRequestId);
      if (!testRun) {
        return {
          status: "rejected",
          requestId: command.id,
          error: {
            code: "models.test_duplicate_request",
            message: "该模型连接测试请求已在进行中。"
          }
        };
      }
      try {
        const result = ModelConnectionTestResultSchema.parse(
          await runtime.testConnection(command.payload.runtimeConfig, {
            signal: testRun.signal
          })
        );
        if (modelTests.wasCancelled(testRequestId)) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "models.test_cancelled",
              message: "模型连接测试已取消。"
            }
          };
        }
        return {
          status: "accepted",
          requestId: command.id,
          payload: result
        };
      } catch (error: unknown) {
        if (
          modelTests.wasCancelled(testRequestId) ||
          error instanceof ModelConnectionTestCancelledError
        ) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "models.test_cancelled",
              message: "模型连接测试已取消。"
            }
          };
        }
        if (error instanceof ModelConnectionTestTimeoutError) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "models.test_timeout",
              message: error.message
            }
          };
        }
        throw error;
      } finally {
        modelTests.finish(testRequestId);
      }
    }

    if (command.type === "agent.model_test_cancel") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ModelTestCancelResultSchema.parse({
          cancelled: modelTests.cancel(command.payload.requestId)
        })
      };
    }

    if (command.type === "agent.model_capacity") {
      return {
        status: "accepted",
        requestId: command.id,
        payload: ModelCapacityResultSchema.parse(
          runtime.resolveModelCapacity(command.payload.runtimeConfig)
        )
      };
    }

    const runControl = handleAgentRunControl(command, runs, runtime);
    if (runControl) return runControl;

    if (
      command.type !== "agent.prompt" &&
      command.type !== "agent.extras_run"
    ) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "agent.unsupported_command",
          message: `Agent utility does not support ${command.type}.`
        }
      };
    }

    const extras = command.type === "agent.extras_run";
    const rejection = runs.admissionError(command.payload.sessionId, extras);
    if (rejection) {
      return { status: "rejected", requestId: command.id, error: rejection };
    }

    const { runId, signal } = runs.begin(command.payload.sessionId, extras);
    const runtimeRef = runtime.describe(command.payload.runtimeConfig);
    const accepted = SessionPromptAcceptedPayloadSchema.parse({
      sessionId: command.payload.sessionId,
      runId,
      acceptedAt: nowIso(),
      runtime: runtimeRef
    });
    runs.stream(
      {
        runId,
        sessionId: command.payload.sessionId,
        runtime: runtimeRef,
        promptRequestId: command.id
      },
      command.type === "agent.extras_run"
        ? runtime.startExtras({
            runId,
            spec: command.payload,
            signal,
            ...([
              "book-title-design",
              "book-synopsis-design",
              "book-cover-design"
            ].includes(command.payload.task.agentId) && context
              ? createBookIdentityService(
                  context,
                  command.payload.sessionId,
                  runId
                )
              : {}),
            ...(command.payload.task.agentId === "long-book-decomposition" &&
            context
              ? createDecompositionServices(
                  context,
                  command.payload.sessionId,
                  runId
                )
              : {}),
            ...(readsLongProject(command.payload) && context
              ? { longCommandExecutor: createCoreCommandExecutor(context) }
              : {})
          })
        : runtime.start(
            createAgentRunInput(command.payload, runId, signal, context)
          ),
      command.context.correlationId,
      emitEvent
    );

    return {
      status: "accepted",
      requestId: command.id,
      payload: accepted
    };
  },
  onShutdown: () => {
    modelTests.abortAll();
    return runs.shutdown();
  }
});
