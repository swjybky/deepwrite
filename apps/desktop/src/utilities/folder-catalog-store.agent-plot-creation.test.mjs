import {
  CommandEnvelopeSchema,
  createEnvelope,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { vi } from "vitest";
import { projectCatalogWorkspace } from "../renderer/src/data/catalogWorkspace";
import { buildCreativeWorkspaceContext } from "../renderer/src/composables/agent-conversation/creative-workspace-context";
import { useCatalogDocumentLoader } from "../renderer/src/composables/useCatalogDocumentLoader";
import { useCatalogDocumentPersistence } from "../renderer/src/composables/useCatalogDocumentPersistence";
import { createPlotStructureProposalLane } from "../renderer/src/composables/proposal-coordinator/plot-structure-lane";
import {
  FolderCatalogStore,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  tickingClock
} from "./folder-catalog-store.test-support";

describe("agent plot creation with the metadata catalog", () => {
  it.each(["short", "script"])(
    "accepts a new %s structure and immediately exposes its saved content to the next prompt",
    async (bookType) => {
      const root = await makeTemporaryRoot(`deepwrite-agent-plot-${bookType}-`);
      const now = tickingClock();
      const store = new FolderCatalogStore({
        userDataPath: join(root, "user-data"),
        now
      });
      const opened = await (bookType === "short"
        ? store.createShortBook(
            { title: "剧情测试", genre: "悬疑" },
            join(root, "books")
          )
        : store.createScriptBook(
            { title: "剧情测试", genre: "悬疑" },
            join(root, "books")
          ));
      const bookId = opened.resource.id;
      const snapshot = shallowRef(await store.indexSnapshot());
      const api = {
        catalog: {
          mutatePlotStructure: store.mutatePlotStructure.bind(store),
          saveDocument: store.saveDocument.bind(store),
          readDocument: store.readDocument.bind(store)
        }
      };
      const loader = useCatalogDocumentLoader({
        reader: () => api.catalog,
        catalogIndex: {
          readDocument: async (_key, load) => load(),
          invalidateDocument: () => true
        }
      });
      const loadCatalogSnapshot = async () => {
        snapshot.value = await store.indexSnapshot();
        loader.reconcileProjection(projectCatalogWorkspace(snapshot.value));
        return true;
      };
      await loadCatalogSnapshot();
      const notifications = {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      };
      const acceptingWorkspaceIds = ref(new Set());
      const catalogBook = (id) =>
        snapshot.value.books.find((book) => book.id === id);
      const persistence = useCatalogDocumentPersistence({
        api: () => api.catalog,
        documents: loader.documents,
        drafts: shallowRef({}),
        acceptingWorkspaceIds,
        loader,
        catalog: {
          refreshIndex: loadCatalogSnapshot,
          findBook: catalogBook,
          findLibrary: () => undefined
        },
        nextRecoveryTimestamp: now,
        scheduleAutoSave: vi.fn(),
        notifications
      });
      const proposals = new Map();
      const conversation = {
        sessionId: ref("session-created-plot"),
        messages: ref([
          { role: "user", content: "请创建终局结构\n保留所有伏笔" },
          { role: "assistant", runId: "run-created-plot", content: "" }
        ]),
        markToolConflict: vi.fn(),
        getEditProposal: (_runId, id) => proposals.get(id),
        upsertEditProposal: (_runId, proposal) =>
          proposals.set(proposal.id, proposal),
        updateEditProposal: (_runId, id, patch) => {
          proposals.set(id, { ...proposals.get(id), ...patch });
        }
      };
      const lane = createPlotStructureProposalLane({
        api: () => api,
        catalogBook,
        loadCatalogSnapshot,
        documents: () => loader.documents.value,
        applyAcceptedDocumentLocally:
          persistence.applyAcceptedAgentDocumentLocally,
        isCatalogConflict: () => false,
        isWorkspaceAccepting: (id) => acceptingWorkspaceIds.value.has(id),
        setWorkspaceAccepting: (id, accepting) => {
          if (accepting) acceptingWorkspaceIds.value.add(id);
          else acceptingWorkspaceIds.value.delete(id);
        },
        notifications,
        queueAgentEdit: vi.fn()
      });
      const content = "所有伏笔在这里回收。";
      const event = createEnvelope(
        "workspace.editor_mutation",
        {
          sessionId: "session-created-plot",
          runId: "run-created-plot",
          toolCallId: "create-ending",
          workspaceId: bookId,
          stageId: "pending:plot-stage:1",
          text: content,
          mutationTarget: {
            kind: "plot-structure",
            mutation: {
              type: "create",
              title: "终局回收",
              description: "揭示真相。",
              provisionalStageId: "pending:plot-stage:1",
              content
            }
          },
          baseRevision: createShortWorkspaceContentRevision(""),
          summary: "创建终局结构",
          runtime: {
            provider: "deepwrite",
            model: "deepwrite-writing-faux",
            mode: "local-faux"
          }
        },
        { id: "created-plot-event", timestamp: now() }
      );

      try {
        lane.stage(event, conversation, "auto-approve");
        const proposal = [...proposals.values()][0];
        await lane.accept(
          conversation,
          { runId: proposal.runId, proposalId: proposal.id },
          proposal,
          true
        );

        expect(notifications.error).not.toHaveBeenCalled();
        expect(proposals.get(proposal.id)?.status).toBe("accepted");
        const createdStage = catalogBook(bookId).plotStages.find(
          ({ title }) => title === "终局回收"
        );
        expect(
          await store.withDocumentVersions(
            bookId,
            createdStage.id,
            (versions) => versions.list()
          )
        ).toMatchObject([
          {
            seq: 1,
            kind: "conversation",
            origin: {
              sessionId: "session-created-plot",
              runId: "run-created-plot",
              summary: "请创建终局结构"
            }
          }
        ]);
        // The index intentionally carries no document body.
        expect(
          catalogBook(bookId).documents.find(({ id }) => id === createdStage.id)
            ?.content
        ).toBe("");
        const active = loader.documents.value.find(
          (document) => document.stageId === createdStage.id
        );
        expect(active).toMatchObject({ content, catalogContentLoaded: true });
        expect(
          proposals.get(proposal.id)?.discardSnapshot?.appliedProjectRevision
        ).toBe(active.catalogProjectRevision);

        await loadCatalogSnapshot();
        expect(loader.documentsById.value.get(active.id)).toMatchObject({
          content,
          catalogContentLoaded: true
        });

        await loader.ensureLoaded(loader.documents.value);
        const prompt = createEnvelope(
          "session.prompt",
          {
            sessionId: "session-after-creation",
            message: "继续完善新结构",
            workspaceContext: {
              ...buildCreativeWorkspaceContext(active, loader.documents.value),
              activeResource: {
                id: active.id,
                domain: active.domain,
                title: active.title,
                path: active.path,
                source: "live-editor",
                content: ""
              }
            }
          },
          {
            id: "prompt-after-creation",
            context: {
              sessionId: "session-after-creation",
              resourceId: active.id
            }
          }
        );
        expect(() => CommandEnvelopeSchema.parse(prompt)).not.toThrow();
        expect(
          (
            await store.readDocument({
              projectId: bookId,
              target: "document",
              documentId: createdStage.id
            })
          ).content
        ).toBe(content);
      } finally {
        loader.dispose();
        await persistence.dispose();
      }
    }
  );
});
