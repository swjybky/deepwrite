import { formatError } from "../i18n/errors";
import { t } from "../i18n";
import type {
  ProposalCoordinator,
  ProposalCoordinatorContext
} from "./useProposalCoordinator";

export function useLazyProposalCoordinator(
  context: ProposalCoordinatorContext
): ProposalCoordinator {
  let coordinator: ProposalCoordinator | undefined;
  let coordinatorPromise: Promise<ProposalCoordinator> | undefined;
  let invocationTail: Promise<void> = Promise.resolve();
  let pendingInvocationCount = 0;
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  function loadCoordinator(): Promise<ProposalCoordinator> {
    if (coordinator) return Promise.resolve(coordinator);
    if (coordinatorPromise) return coordinatorPromise;
    coordinatorPromise = import("./useProposalCoordinator")
      .then(({ useProposalCoordinator }) => {
        coordinator = useProposalCoordinator(context);
        return coordinator;
      })
      .catch((error: unknown) => {
        coordinatorPromise = undefined;
        throw error;
      });
    return coordinatorPromise;
  }

  function enqueue<Result>(
    operation: (
      loadedCoordinator: ProposalCoordinator
    ) => Result | PromiseLike<Result>
  ): Promise<Awaited<Result>> {
    if (disposed) {
      return Promise.resolve(undefined as Awaited<Result>);
    }
    pendingInvocationCount += 1;
    const result = invocationTail.then(async () =>
      operation(await loadCoordinator())
    );
    invocationTail = result.then(
      () => undefined,
      () => undefined
    );
    return result.finally(() => {
      pendingInvocationCount = Math.max(0, pendingInvocationCount - 1);
    }) as Promise<Awaited<Result>>;
  }

  function reportFailure(error: unknown): void {
    context.notifications.error(
      formatError(
        error,
        t(
          "workspace.lazyProposalCoordinator.failedToLoadTheAgentEditCoordinator"
        )
      )
    );
  }

  function enqueueVoid(
    operation: (loadedCoordinator: ProposalCoordinator) => void | Promise<void>
  ): void {
    void enqueue(operation).catch(reportFailure);
  }

  const resumeRecoveredAutomaticAgentEdits: ProposalCoordinator["resumeRecoveredAutomaticAgentEdits"] =
    (...args) => {
      enqueueVoid((loaded) =>
        loaded.resumeRecoveredAutomaticAgentEdits(...args)
      );
    };
  const hasQueuedAgentEdits: ProposalCoordinator["hasQueuedAgentEdits"] = () =>
    pendingInvocationCount > 0 || (coordinator?.hasQueuedAgentEdits() ?? false);
  const reviewAgentEdit: ProposalCoordinator["reviewAgentEdit"] = (...args) =>
    enqueue((loaded) => loaded.reviewAgentEdit(...args)).catch(reportFailure);
  const reviewLongAgentEdit: ProposalCoordinator["reviewLongAgentEdit"] = (
    ...args
  ) =>
    enqueue((loaded) => loaded.reviewLongAgentEdit(...args)).catch(
      reportFailure
    );
  const discardAgentEdit: ProposalCoordinator["discardAgentEdit"] = (...args) =>
    enqueue((loaded) => loaded.discardAgentEdit(...args)).catch(reportFailure);
  const scheduleQueuedAgentEdits: ProposalCoordinator["scheduleQueuedAgentEdits"] =
    (...args) => {
      enqueueVoid((loaded) => loaded.scheduleQueuedAgentEdits(...args));
    };
  const stageAgentEditProposal: ProposalCoordinator["stageAgentEditProposal"] =
    (...args) =>
      enqueue((loaded) => loaded.stageAgentEditProposal(...args)).catch(
        reportFailure
      );
  const stageLibraryEditProposal: ProposalCoordinator["stageLibraryEditProposal"] =
    (...args) => {
      enqueueVoid((loaded) => loaded.stageLibraryEditProposal(...args));
    };
  const stageLongCharacterEditProposal: ProposalCoordinator["stageLongCharacterEditProposal"] =
    (...args) => {
      enqueueVoid((loaded) => loaded.stageLongCharacterEditProposal(...args));
    };
  const stageLongDraftEditProposal: ProposalCoordinator["stageLongDraftEditProposal"] =
    (...args) => {
      enqueueVoid((loaded) => loaded.stageLongDraftEditProposal(...args));
    };
  const stageLongPlotDesignEditProposal: ProposalCoordinator["stageLongPlotDesignEditProposal"] =
    (...args) => {
      enqueueVoid((loaded) => loaded.stageLongPlotDesignEditProposal(...args));
    };
  const stageLongWorldbuildingEditProposal: ProposalCoordinator["stageLongWorldbuildingEditProposal"] =
    (...args) => {
      enqueueVoid((loaded) =>
        loaded.stageLongWorldbuildingEditProposal(...args)
      );
    };

  async function drainPending(): Promise<void> {
    while (true) {
      const observedTail = invocationTail;
      await observedTail;
      await coordinator?.drain();
      if (observedTail === invocationTail && pendingInvocationCount === 0) {
        return;
      }
    }
  }

  function drain(): Promise<void> {
    return disposePromise ?? drainPending();
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    disposePromise = (async () => {
      await invocationTail;
      await coordinator?.dispose();
    })();
    return disposePromise;
  }

  return {
    resumeRecoveredAutomaticAgentEdits,
    hasQueuedAgentEdits,
    reviewAgentEdit,
    reviewLongAgentEdit,
    discardAgentEdit,
    scheduleQueuedAgentEdits,
    stageAgentEditProposal,
    stageLibraryEditProposal,
    stageLongCharacterEditProposal,
    stageLongDraftEditProposal,
    stageLongPlotDesignEditProposal,
    stageLongWorldbuildingEditProposal,
    drain,
    dispose
  };
}
