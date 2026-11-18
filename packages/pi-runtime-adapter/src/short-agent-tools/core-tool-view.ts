import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createExpertDraftDirectoryRevision,
  type WritingFile,
  type WritingIndex
} from "@deepwrite/contracts";
import { replayWritingMutations } from "./settlement";
import type {
  BuildWritingWorkspaceToolsInput,
  ShortWorkspaceToolSharedState,
  WritingWorkspaceSnapshot
} from "./shared";

type Request = {
  kind?: string;
  id?: string;
  document?: string;
  section_scope?: "directory" | "all_sections";
  offset?: number;
  limit?: number;
  meta?: unknown;
};
type StateFactory = (
  workspace: WritingWorkspaceSnapshot
) => ShortWorkspaceToolSharedState;
const queues = new WeakMap<ShortWorkspaceToolSharedState, Promise<void>>();

function projectIndex(
  workspace: WritingWorkspaceSnapshot,
  index: WritingIndex,
  files: Map<string, WritingFile>
) {
  const counts = new Map(index.counts.map((item) => [item.id, item]));
  function document(id: string) {
    const file = files.get(id);
    return {
      content: file?.content ?? "",
      revision: file?.revision ?? counts.get(id)?.revision ?? "unloaded"
    };
  }
  function draftFile(ref: WritingIndex["sections"][number]["body"]) {
    return { documentId: ref.id, title: ref.title, ...document(ref.id) };
  }
  const structure = index.characterStructure;
  return {
    ...workspace,
    readSource: "core" as const,
    title: index.title,
    plotStages: index.plotStages,
    stages: [
      {
        stageId: "character_design",
        title: index.overview.title,
        ...document(index.overview.id)
      },
      ...index.plotStages.map((stage) => ({
        stageId: stage.id,
        title: stage.title,
        ...document(stage.id)
      }))
    ],
    characterStructure:
      structure.format === "list"
        ? {
            format: "list" as const,
            items: structure.items.map((item) => ({
              ...item,
              ...document(item.id)
            }))
          }
        : structure,
    expertDraft: {
      ...workspace.expertDraft,
      revision: createExpertDraftDirectoryRevision(index.sections),
      sections: index.sections.map((section) => ({
        ...section,
        body: draftFile(section.body),
        characterState: draftFile(section.characterState)
      }))
    }
  };
}

async function refresh(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  createState: StateFactory,
  tool: string,
  params: Request,
  signal?: AbortSignal
) {
  const reader = input.writingReader;
  if (!reader)
    throw new Error(
      input.promptLocale === "en-US"
        ? "The authorized Core reader is unavailable."
        : "当前运行的 Core 只读桥不可用。"
    );
  const counts =
    tool === "read" && (params.kind === "workspace" || params.kind === "draft")
      ? params.kind
      : undefined;
  const index = await reader.index(counts, signal);
  const files = new Map<string, WritingFile>();
  const metrics = new Map(index.counts.map((item) => [item.id, item]));
  async function load(id: string, range?: { offset?: number; limit?: number }) {
    const file = await reader!.file(id, range, signal);
    files.set(id, file);
    metrics.set(id, {
      id,
      revision: file.revision,
      length: file.length,
      characters: file.characters
    });
  }
  const fileKind =
    params.document && params.document !== "body" ? "characterState" : "body";
  const resolveId = (id: string) => {
    const plot = state.provisionalPlotIds?.get(id);
    if (plot && index.plotStages.some((stage) => stage.id === plot))
      return plot;
    return (
      index.createdSections.find((section) => section.clientSectionId === id)
        ?.sectionId ?? id
    );
  };
  const id = params.id && resolveId(params.id.trim());
  if (id) params.id = id;
  if (
    params.meta &&
    typeof params.meta === "object" &&
    "after_id" in params.meta &&
    typeof params.meta.after_id === "string"
  )
    params.meta = { ...params.meta, after_id: resolveId(params.meta.after_id) };
  const section = index.sections.find((section) => section.id === id);
  const kind =
    params.kind ?? (params.document || section ? "draft_section" : undefined);
  const textEdit = tool === "edit" && !params.meta;
  const single = tool === "read" || textEdit;
  let docId: string | undefined;
  if (kind === "character_overview" && id === "character_design" && single)
    docId = index.overview.id;
  if (kind === "draft_section" && single) docId = section?.[fileKind].id;
  if (
    kind === "plot_stage" &&
    tool !== "create" &&
    index.plotStages.some((stage) => stage.id === id)
  )
    docId = id;
  if (kind === "character") {
    if (!single) await load(index.overview.id, { limit: 1 });
    if (
      (single || tool === "delete") &&
      index.characterStructure.format === "list" &&
      index.characterStructure.items.some((item) => item.id === id)
    )
      docId = id;
  }
  if (docId) {
    // A single read is always bounded across IPC, including the size probe for an oversized file.
    const range =
      tool === "read"
        ? { offset: params.offset ?? 0, limit: params.limit ?? 50000 }
        : textEdit
          ? { limit: 50000 }
          : tool === "delete"
            ? undefined
            : { limit: 1 };
    await load(docId, range);
  }
  function project() {
    input.workspace = projectIndex(input.workspace, index, files);
    state.coreFiles = metrics;
    const overviewMetrics = metrics.get(index.overview.id);
    if (overviewMetrics) metrics.set("character_design", overviewMetrics);
    replayWritingMutations(state, createState(input.workspace), index);
  }
  project();
  if (
    counts === "draft" &&
    params.section_scope === "all_sections" &&
    params.id === "draft"
  ) {
    const needed: string[] = [];
    let length = 0;
    for (const section of state.expertSections.values()) {
      const file = section[fileKind];
      const metric = metrics.get(file.documentId);
      if (metric?.revision === file.revision) {
        needed.push(file.documentId);
        length += metric.length;
      } else length += file.content.length;
    }
    if (length <= 50000) {
      for (const id of needed) {
        await load(id, { limit: 50000 });
        length +=
          files.get(id)!.length -
          index.counts.find((item) => item.id === id)!.length;
        if (length > 50000) break;
      }
      project();
    }
  }
}

// Parent and child tools share the proposal overlay. Keep refresh and execution
// together so another tool cannot replace the view between validation and edit.
export function withCoreWritingView(
  tool: AgentTool,
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  createState: StateFactory
): AgentTool {
  if (!input.writingReader && input.workspace.readSource !== "core")
    return tool;
  return {
    ...tool,
    execute(toolCallId, rawParams, signal, onUpdate) {
      const run = (queues.get(state) ?? Promise.resolve()).then(async () => {
        signal?.throwIfAborted();
        const params = { ...(rawParams as Request) };
        await refresh(input, state, createState, tool.name, params, signal);
        signal?.throwIfAborted();
        return tool.execute(toolCallId, params, signal, onUpdate);
      });
      queues.set(
        state,
        run.then(
          () => {},
          () => {}
        )
      );
      return run;
    }
  };
}
