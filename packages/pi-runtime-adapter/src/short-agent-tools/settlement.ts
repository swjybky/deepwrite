import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  createShortWorkspaceContentRevision,
  plotStructureCreationStageId,
  type WritingIndex,
  type AgentWriteApprovalResponse,
  type AgentWriteApprovalResult
} from "@deepwrite/contracts";
import type {
  BuildWritingWorkspaceToolsInput,
  ShortWorkspaceToolDetails,
  ShortWorkspaceToolSharedState
} from "./shared";

type Value =
  | string
  | number
  | boolean
  | null
  | undefined
  | Value[]
  | { [key: string]: Value };
type Snapshot = Record<string, Value>;
type Patch = { path: string[]; value: Value };
type Entry = {
  previousOrder?: string[];
  id: string;
  patches: Patch[];
  details: ShortWorkspaceToolDetails;
  automatic: boolean;
  result?: AgentWriteApprovalResult;
};
const journals = new WeakMap<
  ShortWorkspaceToolSharedState,
  { base: Snapshot; entries: Entry[] }
>();
const incompleteSettlements = new WeakSet<ShortWorkspaceToolSharedState>();
const unavailable = new WeakMap<ShortWorkspaceToolSharedState, Set<string>>();
const mapFields = [
  "stageBodies",
  "stageRevisions",
  "characterItems",
  "plotStages",
  "expertSections"
] as const;
const orderFields = [
  "characterItemOrder",
  "plotStageOrder",
  "expertSectionOrder"
] as const;

function snapshot(state: ShortWorkspaceToolSharedState): Snapshot {
  return structuredClone(
    Object.fromEntries([
      ...mapFields.map((key) => [key, Object.fromEntries(state[key])]),
      ...orderFields.map((key) => [key, state[key]])
    ])
  ) as Snapshot;
}

function diff(before: Value, after: Value, path: string[] = []): Patch[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)])
    ].flatMap((key) => diff(before[key], after[key], [...path, key]));
  }
  return [{ path, value: after }];
}

function apply(data: Snapshot, patch: Patch): void {
  let parent = data;
  for (const key of patch.path.slice(0, -1)) {
    // A dependent edit must not resurrect a rejected creation/deleted object.
    const child = parent[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) return;
    parent = child;
  }
  const key = patch.path.at(-1)!;
  if (patch.value === undefined) delete parent[key];
  else parent[key] = structuredClone(patch.value);
}

function restore(state: ShortWorkspaceToolSharedState, data: Snapshot): void {
  for (const key of mapFields) {
    const map = state[key] as Map<string, unknown>;
    map.clear();
    for (const [id, value] of Object.entries(data[key] as Snapshot))
      map.set(id, value);
  }
  for (const [order, map] of [
    ["characterItemOrder", "characterItems"],
    ["plotStageOrder", "plotStages"],
    ["expertSectionOrder", "expertSections"]
  ] as const) {
    const ids = data[order] as string[];
    state[order] = [
      ...ids.filter((id) => state[map].has(id)),
      ...[...state[map].keys()].filter((id) => !ids.includes(id))
    ];
  }
}

/** Wrap only synchronous mutation work, after any confirmation has resolved. */
export function trackWritingMutation(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  mutate: () => AgentToolResult<ShortWorkspaceToolDetails>
): AgentToolResult<ShortWorkspaceToolDetails> {
  if (
    (!input.writingReader && input.writeApprovalMode === "auto-approve") ||
    !input.mutationToolCallId
  )
    return mutate();
  const before = snapshot(state);
  const result = mutate();
  if (result.details.kind === "none") return result;
  const details = result.details;
  if (
    input.writingReader &&
    details.kind === "workspace-plot-structure-mutation" &&
    details.mutation.type === "create"
  ) {
    const proposalId = `${input.writingReader.runId}:${details.workspaceId}:${details.stageId}:${encodeURIComponent("plot-structure:" + input.mutationToolCallId)}`;
    (state.provisionalPlotIds ??= new Map()).set(
      details.stageId,
      plotStructureCreationStageId(
        proposalId,
        details.mutation.provisionalStageId
      )
    );
  }
  const journal = journals.get(state) ?? {
    base: input.writingReader ? {} : before,
    entries: []
  };
  journal.entries.push({
    ...(input.writingReader &&
    details.kind === "workspace-character-structure-mutation" &&
    details.mutation.type === "moveItem"
      ? { previousOrder: before.characterItemOrder as string[] }
      : {}),
    automatic: input.writeApprovalMode === "auto-approve",
    id: input.mutationToolCallId,
    patches: diff(before, snapshot(state)),
    details: input.writingReader
      ? structuredClone(result.details)
      : result.details
  });
  journals.set(state, journal);
  return result;
}

function textPath(details: ShortWorkspaceToolDetails): string[] | undefined {
  if (details.kind === "workspace-editor-mutation")
    return ["stageBodies", details.stageId];
  if (details.kind === "workspace-character-file-mutation" && details.itemId)
    return ["characterItems", details.itemId, "content"];
  if (details.kind === "workspace-expert-draft-file-mutation")
    return ["expertSections", details.sectionId, details.fileKind, "content"];
  return undefined;
}

export function assertWritingDocumentAvailable(
  input: BuildWritingWorkspaceToolsInput,
  state: ShortWorkspaceToolSharedState,
  documentId: string
): void {
  if (
    incompleteSettlements.has(state) ||
    unavailable.get(state)?.has(documentId)
  )
    throw new Error(
      input.promptLocale === "en-US"
        ? "The approval result does not contain the complete saved document. End this run and ask for a new message to reload the work before reading or editing it."
        : "审批结果未包含此文档的完整保存版本。请结束本轮并重新发送消息，加载最新作品后再读取或修改。"
    );
}

function applyOrder(data: Snapshot, details: ShortWorkspaceToolDetails): void {
  const characters = data.characterItemOrder as string[];
  const sections = data.expertSectionOrder as string[];
  if (details.kind === "workspace-character-structure-mutation") {
    const mutation = details.mutation;
    if (mutation.type === "createItem")
      characters.push(mutation.provisionalItemId);
    if (mutation.type === "deleteItem")
      data.characterItemOrder = characters.filter(
        (id) => id !== mutation.itemId
      );
    if (mutation.type === "moveItem") {
      const from = characters.indexOf(mutation.itemId);
      const to = from + (mutation.direction === "up" ? -1 : 1);
      if (from >= 0 && to >= 0 && to < characters.length)
        [characters[from], characters[to]] = [
          characters[to]!,
          characters[from]!
        ];
    }
  }
  if (details.kind === "workspace-expert-draft-section-creation") {
    const after = details.afterSectionId
      ? sections.indexOf(details.afterSectionId)
      : sections.length - 1;
    sections.splice(
      after + 1,
      0,
      ...details.sections.map((section) => section.provisionalSectionId)
    );
  }
  if (
    details.kind === "workspace-expert-draft-section-rename" &&
    details.change?.field === "afterSectionId"
  ) {
    const from = sections.indexOf(details.sectionId);
    const anchor = details.change.after;
    if (from >= 0 && (anchor === null || sections.includes(anchor))) {
      sections.splice(from, 1);
      sections.splice(
        anchor === null ? 0 : sections.indexOf(anchor) + 1,
        0,
        details.sectionId
      );
    }
  }
  if (details.kind === "workspace-expert-draft-section-deletion")
    data.expertSectionOrder = sections.filter((id) => id !== details.sectionId);
  if (
    details.kind === "workspace-plot-structure-mutation" &&
    details.mutation.type === "create"
  )
    (data.plotStageOrder as string[]).push(details.mutation.provisionalStageId);
}

// Rebuild each tool view on a fresh Core directory. Only uncommitted changes
// are replayed; a later disk revision invalidates a pending text edit's base.
export function replayWritingMutations(
  state: ShortWorkspaceToolSharedState,
  base: ShortWorkspaceToolSharedState,
  index: WritingIndex
): void {
  const data = snapshot(base);
  const journal = journals.get(state);
  if (journal) {
    journal.entries = journal.entries.filter((entry) => {
      const d = entry.details;
      if (
        d.kind === "workspace-expert-draft-section-creation" &&
        d.sections.every((section) =>
          index.createdSections.some(
            (mapping) =>
              mapping.clientSectionId === section.provisionalSectionId
          )
        )
      )
        return false;
      if (
        d.kind === "workspace-plot-structure-mutation" &&
        d.mutation.type === "create"
      ) {
        const real = state.provisionalPlotIds?.get(d.stageId);
        if (real && base.plotStages.has(real)) return false;
      }
      if (
        d.kind === "workspace-character-structure-mutation" &&
        d.mutation.type === "createItem" &&
        base.characterItems.has(d.mutation.provisionalItemId)
      )
        return false;
      if (
        d.kind === "workspace-expert-draft-file-mutation" ||
        d.kind === "workspace-editor-mutation"
      ) {
        const oldId =
          d.kind === "workspace-editor-mutation" ? d.stageId : d.sectionId;
        const mapped =
          d.kind === "workspace-editor-mutation"
            ? state.provisionalPlotIds?.get(oldId)
            : index.createdSections.find(
                (item) => item.clientSectionId === oldId
              )?.sectionId;
        if (
          mapped &&
          (d.kind === "workspace-editor-mutation"
            ? base.plotStages.has(mapped)
            : base.expertSections.has(mapped))
        ) {
          if (d.kind === "workspace-editor-mutation") d.stageId = mapped;
          else d.sectionId = mapped;
          for (const patch of entry.patches)
            if (patch.path[1] === oldId) patch.path[1] = mapped;
        }
      }
      // Use each structure operation's original field value to avoid replaying
      // a move or rename over a change already saved by the user or another run.
      if (d.kind === "workspace-character-structure-mutation") {
        const m = d.mutation;
        if (
          m.type === "updateItem" &&
          valueAt(data, ["characterItems", m.itemId, "title"]) !==
            m.previousTitle
        )
          return false;
        if (
          m.type === "moveItem" &&
          entry.previousOrder &&
          JSON.stringify(data.characterItemOrder) !==
            JSON.stringify(entry.previousOrder)
        )
          return false;
      }
      if (d.kind === "workspace-expert-draft-section-rename") {
        if (
          !d.change &&
          valueAt(data, ["expertSections", d.sectionId, "title"]) !==
            d.previousTitle
        )
          return false;
        if (
          d.change?.field === "wordCountRequirement" &&
          valueAt(data, [
            "expertSections",
            d.sectionId,
            "wordCountRequirement"
          ]) !== d.change.before
        )
          return false;
        if (d.change?.field === "afterSectionId") {
          const order = data.expertSectionOrder as string[];
          const at = order.indexOf(d.sectionId);
          if (at < 0 || (order[at - 1] ?? null) !== d.change.before)
            return false;
        }
      }
      const path = textPath(d);
      if (path && "baseRevision" in d) {
        const revPath =
          path[0] === "stageBodies"
            ? ["stageRevisions", path[1]!]
            : [...path.slice(0, -1), "revision"];
        const disk = valueAt(data, revPath);
        if (
          disk === undefined ||
          (disk !== "unloaded" && disk !== d.baseRevision)
        )
          return false;
      } else if (
        entry.automatic &&
        entry.patches.every(
          (patch) =>
            JSON.stringify(valueAt(data, patch.path)) ===
            JSON.stringify(patch.value)
        )
      )
        return false;
      for (const patch of entry.patches)
        if (!(orderFields as readonly string[]).includes(patch.path[0]!))
          apply(data, patch);
      applyOrder(data, d);
      return true;
    });
    if (!journal.entries.length) journals.delete(state);
  }
  restore(state, data);
  state.expertDraftDirectoryBaseRevision =
    base.expertDraftDirectoryBaseRevision;
}

function valueAt(data: Snapshot, path: string[]): Value {
  let value: Value = data;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    value = value[key];
  }
  return value;
}

export function settleWritingMutations(
  state: ShortWorkspaceToolSharedState,
  toolCallIds: string[],
  response?: AgentWriteApprovalResponse
): void {
  const journal = journals.get(state);
  if (!journal) return;
  const settled = new Set(toolCallIds);
  if (state.coreFiles) {
    journal.entries = journal.entries.filter((entry) => !settled.has(entry.id));
    if (!journal.entries.length) journals.delete(state);
    return;
  }
  for (const entry of journal.entries) {
    if (!settled.has(entry.id)) continue;
    const result = response?.items.find((item) =>
      item.toolCallIds?.includes(entry.id)
    );
    if (!result && (response?.items.length || response?.omittedCount))
      incompleteSettlements.add(state);
    entry.result = result ?? {
      title: "未确认的修改",
      status: "failed"
    };
  }
  const data = structuredClone(journal.base);
  const unknown = unavailable.get(state) ?? new Set<string>();
  for (const entry of journal.entries) {
    if (entry.result && entry.result.status !== "saved") continue;
    for (const patch of entry.patches) {
      if (!(orderFields as readonly string[]).includes(patch.path[0]!))
        apply(data, patch);
    }
    applyOrder(data, entry.details);
    if (!entry.result?.edited) continue;
    const path = textPath(entry.details);
    if (!path) continue;
    const documentId =
      entry.details.kind === "workspace-editor-mutation"
        ? entry.details.stageId
        : "documentId" in entry.details
          ? entry.details.documentId
          : "";
    if (
      entry.result.editedText === undefined ||
      entry.result.editedTextTruncated
    ) {
      unknown.add(documentId);
      continue;
    }
    const content = entry.result.editedText;
    apply(data, { path, value: content });
    const revisionPath =
      path[0] === "stageBodies"
        ? ["stageRevisions", path[1]!]
        : [...path.slice(0, -1), "revision"];
    apply(data, {
      path: revisionPath,
      value: createShortWorkspaceContentRevision(content)
    });
    unknown.delete(documentId);
  }
  restore(state, data);
  unavailable.set(state, unknown);
  if (journal.entries.every((entry) => entry.result)) journals.delete(state);
}
