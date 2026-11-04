import type {
  AgentTeamRunMode,
  DeepWriteApi,
  ExternalAgentRun,
  ExternalWindowRequest,
  ExternalWindowResponse,
  ExternalWindowTarget
} from "@deepwrite/contracts";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { systemEventCenter } from "../../events/systemEventCenter";
import { trackExternalRun, type TrackedRun } from "./tracked-run";

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 50;
const LONG_SETTLE_MS = 1_500;
const SEND_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 1_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FailureCode = Extract<ExternalWindowResponse, { ok: false }>["code"];

class BridgeFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string
  ) {
    super(message);
  }
}

export interface ExternalControlBridgePorts {
  api(): DeepWriteApi | undefined;
  open(target: ExternalWindowTarget): Promise<boolean>;
  /** The conversation shown after opening a target. */
  conversation(): AgentConversationController | null | undefined;
  /** Settles once opened conversations have their saved settings back. */
  conversationsRestored(): Promise<void>;
  /** Undefined until the team catalog can answer. */
  teamAvailable(target: ExternalWindowTarget): boolean | undefined;
  sendReady(): boolean;
  /** What the composer's send button does for that conversation. */
  send(): Promise<void>;
  longEditorHasUnsavedChanges(bookId: string): boolean;
}

/** The send path reads the composer, so the message passes through its draft. */
async function sendThroughComposer(
  conversation: AgentConversationController,
  message: string,
  teamMode: AgentTeamRunMode | undefined,
  send: () => Promise<void>
): Promise<void> {
  const draft = conversation.draft.value;
  conversation.draft.value = message;
  conversation.overrideNextApprovalMode("auto-approve");
  conversation.overrideNextAgentTeamMode(teamMode ?? null);
  try {
    // Await acceptance/preflight; clearing the draft precedes persistence.
    await send();
  } finally {
    conversation.draft.value = draft;
    conversation.overrideNextApprovalMode(null);
    conversation.overrideNextAgentTeamMode(null);
  }
}

/**
 * Carries out what Main asks of the window. Runs go through the same send
 * entry as the composer, so a run cannot behave differently from a user's.
 */
export function useExternalControlBridge(ports: ExternalControlBridgePorts) {
  const runs = new Map<string, TrackedRun>();
  let navigation: Promise<unknown> = Promise.resolve();
  const navigate = <T>(action: () => Promise<T>): Promise<T> => {
    const result = navigation.then(action);
    navigation = result.catch(() => undefined);
    return result;
  };

  function requireRun(runId: string): TrackedRun {
    const run = runs.get(runId);
    if (!run) {
      throw new BridgeFailure("external.not_found", "找不到这次运行。");
    }
    return run;
  }

  async function open(target: ExternalWindowTarget): Promise<void> {
    if (!(await ports.open(target))) {
      throw new BridgeFailure("external.not_found", "窗口无法打开这个目标。");
    }
  }

  /**
   * A long work keeps settling for a moment after it reports ready, and a send
   * that sees it change is cancelled, so readiness has to hold for a while.
   */
  async function waitUntilSettled(target: ExternalWindowTarget): Promise<void> {
    const settleMs = target.kind === "long" ? LONG_SETTLE_MS : 0;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let readySince = ports.sendReady() ? Date.now() : null;
    while (readySince === null || Date.now() - readySince < settleMs) {
      if (Date.now() > deadline) {
        throw new BridgeFailure(
          "external.not_ready",
          "这个目标还没有加载完成。"
        );
      }
      await pause(READY_POLL_MS);
      if (!ports.sendReady()) readySince = null;
      else readySince ??= Date.now();
    }
  }

  /** A conversation sent while restoring would run with its initial settings. */
  async function waitForRestoredConversation(): Promise<void> {
    ports.conversation();
    const restored = await Promise.race([
      ports.conversationsRestored().then(() => true),
      pause(READY_TIMEOUT_MS).then(() => false)
    ]);
    if (!restored) {
      throw new BridgeFailure(
        "external.not_ready",
        "这个目标的对话还没有恢复。"
      );
    }
  }

  async function resolveTeamMode(
    request: Extract<ExternalWindowRequest, { action: "start_run" }>
  ): Promise<AgentTeamRunMode | undefined> {
    if (request.target.kind === "library") {
      if (request.mode !== "team") return undefined;
      throw new BridgeFailure(
        "external.invalid_input",
        "资料库没有智能体团队。"
      );
    }
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let available = ports.teamAvailable(request.target);
    while (available === undefined) {
      if (Date.now() > deadline) {
        throw new BridgeFailure(
          "external.not_ready",
          "智能体团队配置还没有加载完成。"
        );
      }
      await pause(READY_POLL_MS);
      available = ports.teamAvailable(request.target);
    }
    if (request.mode === "team" && !available) {
      throw new BridgeFailure(
        "external.invalid_input",
        "这部作品没有可用的智能体团队。请让用户启用或绑定团队，或改用 normal 模式。"
      );
    }
    return request.mode ?? (available ? "team" : "normal");
  }

  async function startRun(
    request: Extract<ExternalWindowRequest, { action: "start_run" }>,
    runId: string
  ): Promise<ExternalAgentRun> {
    await open(request.target);
    await waitForRestoredConversation();
    await waitUntilSettled(request.target);
    const teamMode = await resolveTeamMode(request);
    const conversation = ports.conversation();
    if (!conversation) {
      throw new BridgeFailure(
        "external.not_ready",
        "这个目标的对话还没有就绪。"
      );
    }
    if (conversation.isBusy.value) {
      throw new BridgeFailure("external.busy", "这个目标的对话正在运行。");
    }
    if (request.newConversation && request.sessionId) {
      throw new BridgeFailure(
        "external.invalid_input",
        "新对话不能同时指定 sessionId。"
      );
    }
    if (
      request.sessionId &&
      conversation.sessionId.value !== request.sessionId
    ) {
      if (!(await conversation.openConversation?.(request.sessionId))) {
        throw new BridgeFailure(
          "external.not_found",
          "找不到这个目标的指定对话。"
        );
      }
    }
    if (request.newConversation) await conversation.newConversation();
    const firstNewMessage = conversation.messages.value.length;
    const newMessages = () =>
      conversation.messages.value.slice(firstNewMessage);
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
      await sendThroughComposer(
        conversation,
        request.message,
        teamMode,
        ports.send
      );
      if (newMessages().length > 0) break;
      if (attempt < SEND_ATTEMPTS) await pause(SEND_RETRY_DELAY_MS);
    }
    if (newMessages().length === 0) {
      throw new BridgeFailure(
        "external.invalid_input",
        conversation.conversationError.value ||
          "消息没有发出。请确认 DeepWrite 已配置可用模型。"
      );
    }
    const assistant = newMessages().find(({ role }) => role === "assistant");
    if (!assistant)
      throw new BridgeFailure(
        "external.not_ready",
        "这次运行尚未建立回复记录。"
      );
    const run = trackExternalRun(
      runId,
      conversation,
      assistant,
      teamMode,
      request.target
    );
    runs.set(runId, run);
    return run.snapshot();
  }

  /** Conversation state is reactive, and proxies cannot cross the bridge. */
  async function respond(response: ExternalWindowResponse): Promise<void> {
    const api = ports.api()?.externalControl;
    try {
      await api?.respond(JSON.parse(JSON.stringify(response)));
    } catch {
      await api?.respond({
        requestId: response.requestId,
        ok: false,
        code: "external.not_ready",
        message: "DeepWrite 窗口没能返回结果。"
      });
    }
  }

  async function handle(
    id: string,
    request: ExternalWindowRequest
  ): Promise<unknown> {
    switch (request.action) {
      case "open_target":
        await navigate(() => open(request.target));
        return null;
      case "start_run":
        return navigate(() => startRun(request, id));
      case "run_status":
        return requireRun(request.runId).snapshot();
      case "answer_run": {
        const run = requireRun(request.runId);
        run.snapshot();
        if (!run.ownsActiveRun())
          throw new BridgeFailure(
            "external.invalid_input",
            "这次运行已经结束，不能再提交回答。"
          );
        if (!(await run.conversation.submitUserInput(request.answers))) {
          throw new BridgeFailure(
            "external.invalid_input",
            run.conversation.conversationError.value || "回答没有被接受。"
          );
        }
        return run.snapshot();
      }
      case "stop_run": {
        const run = requireRun(request.runId);
        const snapshot = run.snapshot();
        if (!run.ownsActiveRun()) return snapshot;
        await run.conversation.stopGeneration();
        return run.snapshot();
      }
      case "long_editor_state":
        return { dirty: ports.longEditorHasUnsavedChanges(request.bookId) };
    }
  }

  const unsubscribe = systemEventCenter.subscribe(
    "externalControl.window_request",
    (event) => {
      void handle(event.id, event.payload)
        .then(
          (result): ExternalWindowResponse => ({
            requestId: event.id,
            ok: true,
            result
          }),
          (error: unknown): ExternalWindowResponse => ({
            requestId: event.id,
            ok: false,
            code:
              error instanceof BridgeFailure
                ? error.code
                : "external.not_ready",
            message:
              error instanceof BridgeFailure
                ? error.message
                : "DeepWrite 窗口没能完成这次操作。"
          })
        )
        .then((response) => respond(response))
        .catch(() => undefined);
    }
  );
  return () => {
    unsubscribe();
    for (const run of runs.values()) run.dispose();
    runs.clear();
  };
}
