import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { parseJsonWithRepair } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import {
  ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
  ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
  createShortWorkspaceContentRevision,
  isBuiltinAcademicFrameworkStageId,
  type AcademicAgentProfile,
  type AcademicMutationTarget,
  type AcademicReferenceCardType,
  type AcademicWorkspaceRuntimeContext,
  type AgentWriteApprovalMode,
  type AgentWriteApprovalResponse,
  type PromptLocale,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { MaterialQueryRunner } from "../material-query-runtime";
import type { AgentUserInputRequester } from "../runtime-types";
import { sanitizeToolSchemaForGemini } from "../short-agent-tools/schema";
import { countWritingContentCharacters } from "../writing-content-counts";
import type { AcademicWritingReader } from "./core-reader";

export type AcademicToolDetails =
  | { kind: "none" }
  | {
      kind: "academic-workspace-mutation";
      workspaceId: string;
      summary: string;
      baseProjectRevision?: number;
      target: AcademicMutationTarget;
    };

export interface AcademicOverlayFile {
  id: string;
  title: string;
  content: string;
  revision: string;
  characters: number;
  length: number;
  loaded: boolean;
  dirty: boolean;
}

export interface AcademicOverlayCard {
  id: string;
  citeKey: string;
  cardType: AcademicReferenceCardType;
  title: string;
  documentId: string;
  file: AcademicOverlayFile;
  provisional?: boolean;
}

export interface AcademicOverlayFrameworkStage {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  file: AcademicOverlayFile;
  provisional?: boolean;
}

export interface AcademicOverlayChapter {
  id: string;
  title: string;
  provisional?: boolean;
}

export interface AcademicOverlaySection {
  id: string;
  chapterId?: string;
  title: string;
  wordCountRequirement: string;
  brief: AcademicOverlayFile;
  body: AcademicOverlayFile;
  state: AcademicOverlayFile;
  provisional?: boolean;
}

export interface AcademicWorkspaceToolSharedState {
  initialWorkspace: AcademicWorkspaceRuntimeContext;
  thesisOverview: AcademicOverlayFile;
  terminology: AcademicOverlayFile;
  cards: Map<string, AcademicOverlayCard>;
  cardOrder: string[];
  frameworkStages: Map<string, AcademicOverlayFrameworkStage>;
  frameworkStageOrder: string[];
  chapters: Map<string, AcademicOverlayChapter>;
  chapterOrder: string[];
  sections: Map<string, AcademicOverlaySection>;
  sectionOrder: string[];
  pendingCardSeq: number;
  pendingStageSeq: number;
  pendingChapterSeq: number;
  pendingSectionSeq: number;
  lastEditedSectionId?: string;
  syncedFromCore: boolean;
  projectRevision: number | undefined;
}

export interface AcademicReadState {
  fullyRead: Map<string, { content: string; revision: string }>;
}

export function createAcademicReadState(): AcademicReadState {
  return { fullyRead: new Map() };
}

export interface BuildAcademicWorkspaceToolsInput {
  promptLocale?: PromptLocale | undefined;
  writingReader?: AcademicWritingReader | undefined;
  workspace: AcademicWorkspaceRuntimeContext;
  profile: AcademicAgentProfile;
  writeApprovalMode: AgentWriteApprovalMode;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
  queryMaterials?: MaterialQueryRunner | undefined;
  requestUserInput: AgentUserInputRequester;
  includeAskUserQuestion?: boolean;
  onContextCompacted?: (
    listener: (removedToolCallIds?: readonly string[]) => void
  ) => void;
  sharedState?: AcademicWorkspaceToolSharedState;
}

function toOverlayFile(
  metric: AcademicWorkspaceRuntimeContext["foundation"]["thesisOverview"],
  inlineSource: boolean
): AcademicOverlayFile {
  const hasContent = metric.content !== undefined;
  const content = metric.content ?? "";
  return {
    id: metric.id,
    title: metric.title,
    content,
    revision: metric.revision,
    characters: metric.characters,
    length: hasContent ? content.length : metric.characters,
    loaded: inlineSource || hasContent,
    dirty: false
  };
}

function populateAcademicSharedState(
  target: Omit<
    AcademicWorkspaceToolSharedState,
    | "initialWorkspace"
    | "pendingCardSeq"
    | "pendingStageSeq"
    | "pendingChapterSeq"
    | "pendingSectionSeq"
    | "lastEditedSectionId"
  >,
  workspace: AcademicWorkspaceRuntimeContext
): void {
  const inlineSource = workspace.readSource !== "core";
  target.thesisOverview = toOverlayFile(
    workspace.foundation.thesisOverview,
    inlineSource
  );
  target.terminology = toOverlayFile(
    workspace.foundation.terminology,
    inlineSource
  );
  target.cards = new Map(
    workspace.foundation.cards.map((card) => [
      card.id,
      {
        id: card.id,
        citeKey: card.citeKey,
        cardType: card.cardType,
        title: card.title,
        documentId: card.documentId,
        file: {
          id: card.documentId,
          title: card.title,
          content: card.content ?? "",
          revision: card.revision,
          characters: card.characters,
          length:
            card.content !== undefined ? card.content.length : card.characters,
          loaded: inlineSource || card.content !== undefined,
          dirty: false
        }
      }
    ])
  );
  target.cardOrder = workspace.foundation.cards.map((card) => card.id);
  target.frameworkStages = new Map(
    workspace.frameworkStages.map((stage) => [
      stage.id,
      {
        id: stage.id,
        title: stage.title,
        description: stage.description,
        enabled: stage.enabled,
        builtin: stage.builtin ?? isBuiltinAcademicFrameworkStageId(stage.id),
        file: toOverlayFile(stage.document, inlineSource)
      }
    ])
  );
  target.frameworkStageOrder = workspace.frameworkStages.map(
    (stage) => stage.id
  );
  target.chapters = new Map(
    workspace.manuscript.chapters.map((chapter) => [
      chapter.id,
      { id: chapter.id, title: chapter.title }
    ])
  );
  target.chapterOrder = [...workspace.manuscript.chapters]
    .sort((left, right) => left.order - right.order)
    .map((chapter) => chapter.id);
  target.sections = new Map(
    workspace.manuscript.sections.map((section) => [
      section.id,
      {
        id: section.id,
        ...(section.chapterId ? { chapterId: section.chapterId } : {}),
        title: section.title,
        wordCountRequirement: section.wordCountRequirement,
        brief: toOverlayFile(section.brief, inlineSource),
        body: toOverlayFile(section.body, inlineSource),
        state: toOverlayFile(section.state, inlineSource)
      }
    ])
  );
  target.sectionOrder = [...workspace.manuscript.sections]
    .sort((left, right) => left.order - right.order)
    .map((section) => section.id);
  target.syncedFromCore = false;
  target.projectRevision = workspace.projectRevision;
}

export function createAcademicWorkspaceToolSharedState(
  workspace: AcademicWorkspaceRuntimeContext
): AcademicWorkspaceToolSharedState {
  const partial = {} as AcademicWorkspaceToolSharedState;
  partial.initialWorkspace = workspace;
  partial.pendingCardSeq = 0;
  partial.pendingStageSeq = 0;
  partial.pendingChapterSeq = 0;
  partial.pendingSectionSeq = 0;
  populateAcademicSharedState(partial, workspace);
  return partial;
}

export function settleAcademicMutations(
  state: AcademicWorkspaceToolSharedState,
  _toolCallIds: readonly string[],
  _response?: AgentWriteApprovalResponse
): void {
  // Core is authoritative after user review: drop unaccepted overlays and
  // re-sync live directory/files on the next tool call.
  populateAcademicSharedState(state, state.initialWorkspace);
}

export async function syncAcademicSharedStateFromCore(
  input: Pick<BuildAcademicWorkspaceToolsInput, "workspace" | "writingReader">,
  state: AcademicWorkspaceToolSharedState,
  signal?: AbortSignal
): Promise<void> {
  if (
    input.workspace.readSource !== "core" ||
    !input.writingReader ||
    state.syncedFromCore
  ) {
    return;
  }
  const index = await input.writingReader.index("workspace", signal);
  state.projectRevision =
    index.projectRevision ?? input.workspace.projectRevision;
  const countMap = new Map(index.counts.map((entry) => [entry.id, entry]));

  const applySavedMetrics = (
    file: AcademicOverlayFile,
    docId: string,
    title: string
  ): void => {
    file.title = title;
    const metric = countMap.get(docId);
    if (!metric || file.dirty) return;
    if (file.loaded && file.revision !== metric.revision) {
      file.loaded = false;
      file.content = "";
    }
    file.revision = metric.revision;
    file.characters = metric.characters;
    file.length = metric.length;
  };

  applySavedMetrics(
    state.thesisOverview,
    ACADEMIC_THESIS_OVERVIEW_DOCUMENT_ID,
    index.foundation.thesisOverview.title
  );
  applySavedMetrics(
    state.terminology,
    ACADEMIC_TERMINOLOGY_DOCUMENT_ID,
    index.foundation.terminology.title
  );

  const provisionalCards = state.cardOrder
    .map((id) => state.cards.get(id))
    .filter((card): card is AcademicOverlayCard => Boolean(card?.provisional));
  const nextCards = new Map<string, AcademicOverlayCard>();
  const nextCardOrder: string[] = [];
  for (const card of index.foundation.cards) {
    const existing = state.cards.get(card.id);
    const file: AcademicOverlayFile = existing?.file ?? {
      id: card.document.id,
      title: card.title,
      content: "",
      revision: createShortWorkspaceContentRevision(""),
      characters: 0,
      length: 0,
      loaded: false,
      dirty: false
    };
    applySavedMetrics(file, card.document.id, card.title);
    nextCards.set(card.id, {
      id: card.id,
      citeKey: existing?.file.dirty ? existing.citeKey : card.citeKey,
      cardType: existing?.file.dirty ? existing.cardType : card.cardType,
      title: existing?.file.dirty ? existing.title : card.title,
      documentId: card.document.id,
      file
    });
    nextCardOrder.push(card.id);
  }
  for (const card of provisionalCards) {
    nextCards.set(card.id, card);
    nextCardOrder.push(card.id);
  }
  state.cards = nextCards;
  state.cardOrder = nextCardOrder;

  const provisionalStages = state.frameworkStageOrder
    .map((id) => state.frameworkStages.get(id))
    .filter((stage): stage is AcademicOverlayFrameworkStage =>
      Boolean(stage?.provisional)
    );
  const nextStages = new Map<string, AcademicOverlayFrameworkStage>();
  const nextStageOrder: string[] = [];
  for (const stage of index.frameworkStages) {
    const existing = state.frameworkStages.get(stage.id);
    const file: AcademicOverlayFile = existing?.file ?? {
      id: stage.id,
      title: stage.title,
      content: "",
      revision: createShortWorkspaceContentRevision(""),
      characters: 0,
      length: 0,
      loaded: false,
      dirty: false
    };
    applySavedMetrics(file, stage.id, stage.title);
    nextStages.set(stage.id, {
      id: stage.id,
      title: stage.title,
      description: stage.description,
      enabled: stage.enabled,
      builtin: isBuiltinAcademicFrameworkStageId(stage.id),
      file
    });
    nextStageOrder.push(stage.id);
  }
  for (const stage of provisionalStages) {
    nextStages.set(stage.id, stage);
    nextStageOrder.push(stage.id);
  }
  state.frameworkStages = nextStages;
  state.frameworkStageOrder = nextStageOrder;

  const provisionalChapters = state.chapterOrder
    .map((id) => state.chapters.get(id))
    .filter((chapter): chapter is AcademicOverlayChapter =>
      Boolean(chapter?.provisional)
    );
  const nextChapters = new Map<string, AcademicOverlayChapter>();
  const nextChapterOrder: string[] = [];
  for (const chapter of index.chapters) {
    nextChapters.set(chapter.id, { id: chapter.id, title: chapter.title });
    nextChapterOrder.push(chapter.id);
  }
  for (const chapter of provisionalChapters) {
    nextChapters.set(chapter.id, chapter);
    nextChapterOrder.push(chapter.id);
  }
  state.chapters = nextChapters;
  state.chapterOrder = nextChapterOrder;

  const provisionalSections = state.sectionOrder
    .map((id) => state.sections.get(id))
    .filter((section): section is AcademicOverlaySection =>
      Boolean(section?.provisional)
    );
  const nextSections = new Map<string, AcademicOverlaySection>();
  const nextSectionOrder: string[] = [];
  for (const section of index.sections) {
    const existing = state.sections.get(section.id);
    const makeFile = (
      kind: "brief" | "body" | "state",
      doc: { id: string; title: string }
    ): AcademicOverlayFile => {
      const prev = existing?.[kind];
      const file: AcademicOverlayFile = prev ?? {
        id: doc.id,
        title: doc.title,
        content: "",
        revision: createShortWorkspaceContentRevision(""),
        characters: 0,
        length: 0,
        loaded: false,
        dirty: false
      };
      applySavedMetrics(file, doc.id, doc.title);
      return file;
    };
    nextSections.set(section.id, {
      id: section.id,
      ...(section.chapterId ? { chapterId: section.chapterId } : {}),
      title: section.title,
      wordCountRequirement: section.wordCountRequirement,
      brief: makeFile("brief", section.brief),
      body: makeFile("body", section.body),
      state: makeFile("state", section.state)
    });
    nextSectionOrder.push(section.id);
  }
  for (const section of provisionalSections) {
    nextSections.set(section.id, section);
    nextSectionOrder.push(section.id);
  }
  state.sections = nextSections;
  state.sectionOrder = nextSectionOrder;
  state.syncedFromCore = true;
}

export async function ensureAcademicOverlayFileLoaded(
  input: Pick<
    BuildAcademicWorkspaceToolsInput,
    "workspace" | "writingReader" | "promptLocale"
  >,
  file: AcademicOverlayFile,
  signal?: AbortSignal
): Promise<AcademicOverlayFile> {
  if (file.loaded) return file;
  if (!input.writingReader) {
    throw new Error(
      input.promptLocale === "en-US"
        ? `Saved content for "${file.title}" requires the Core read bridge.`
        : `读取「${file.title}」的已保存内容需要 Core 读取桥。`
    );
  }
  const loaded = await input.writingReader.file(file.id, undefined, signal);
  file.content = loaded.content;
  file.revision = loaded.revision;
  file.characters = loaded.characters;
  file.length = loaded.length;
  file.loaded = true;
  return file;
}

export function updateAcademicOverlayFile(
  file: AcademicOverlayFile,
  content: string
): string {
  const revision = createShortWorkspaceContentRevision(content);
  file.content = content;
  file.revision = revision;
  file.characters = countWritingContentCharacters(content);
  file.length = content.length;
  file.loaded = true;
  file.dirty = true;
  return revision;
}

export function hasAcademicFullRead(
  readState: AcademicReadState,
  file: AcademicOverlayFile
): boolean {
  const recorded = readState.fullyRead.get(file.id);
  return (
    recorded !== undefined &&
    recorded.revision === file.revision &&
    recorded.content === file.content
  );
}

export function recordAcademicFullRead(
  readState: AcademicReadState,
  file: AcademicOverlayFile
): void {
  readState.fullyRead.set(file.id, {
    content: file.content,
    revision: file.revision
  });
}

export function currentAcademicWorkspaceContext(
  workspace: AcademicWorkspaceRuntimeContext,
  state: AcademicWorkspaceToolSharedState
): AcademicWorkspaceRuntimeContext {
  const toMetrics = (file: AcademicOverlayFile) => ({
    id: file.id,
    title: file.title,
    revision: file.revision,
    characters: file.characters
  });
  return {
    ...workspace,
    foundation: {
      thesisOverview: toMetrics(state.thesisOverview),
      terminology: toMetrics(state.terminology),
      cards: state.cardOrder
        .map((id) => state.cards.get(id))
        .filter((card): card is AcademicOverlayCard => Boolean(card))
        .map((card) => ({
          id: card.id,
          citeKey: card.citeKey,
          cardType: card.cardType,
          title: card.title,
          documentId: card.documentId,
          revision: card.file.revision,
          characters: card.file.characters
        }))
    },
    frameworkStages: state.frameworkStageOrder
      .map((id) => state.frameworkStages.get(id))
      .filter((stage): stage is AcademicOverlayFrameworkStage => Boolean(stage))
      .map((stage) => ({
        id: stage.id,
        title: stage.title,
        description: stage.description,
        enabled: stage.enabled,
        builtin: stage.builtin,
        document: toMetrics(stage.file)
      })),
    manuscript: {
      chapters: state.chapterOrder
        .map((id) => state.chapters.get(id))
        .filter((chapter): chapter is AcademicOverlayChapter =>
          Boolean(chapter)
        )
        .map((chapter, index) => ({
          id: chapter.id,
          title: chapter.title,
          order: index + 1
        })),
      sections: state.sectionOrder
        .map((id) => state.sections.get(id))
        .filter((section): section is AcademicOverlaySection =>
          Boolean(section)
        )
        .map((section, index) => ({
          id: section.id,
          ...(section.chapterId ? { chapterId: section.chapterId } : {}),
          title: section.title,
          wordCountRequirement: section.wordCountRequirement,
          order: index + 1,
          brief: toMetrics(section.brief),
          body: toMetrics(section.body),
          state: toMetrics(section.state)
        }))
    }
  };
}

export function academicTextResult(
  text: string,
  details: AcademicToolDetails = { kind: "none" }
): AgentToolResult<AcademicToolDetails> {
  return { content: [{ type: "text", text }], details };
}

export function academicProposalNote(
  input: Pick<
    BuildAcademicWorkspaceToolsInput,
    "writeApprovalMode" | "promptLocale"
  >
): string {
  if (input.writeApprovalMode === "auto-approve") {
    return input.promptLocale === "en-US"
      ? "Submitted for automatic saving."
      : "已提交自动保存。";
  }
  return input.promptLocale === "en-US"
    ? "Proposal staged for user review."
    : "已生成修改提案，等待用户审阅。";
}

function tryParseJsonString(value: unknown): unknown {
  let current = value;
  for (let depth = 0; typeof current === "string" && depth < 2; depth += 1) {
    const trimmed = current.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) break;
    try {
      current = parseJsonWithRepair(trimmed);
    } catch {
      break;
    }
  }
  return current;
}

export function prepareAcademicToolArguments(args: unknown): unknown {
  const parsed = tryParseJsonString(args);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return args;
  }
  const next: Record<string, unknown> = {
    ...(parsed as Record<string, unknown>)
  };
  for (const key of ["items", "replacements", "insert", "meta"]) {
    if (typeof next[key] === "string") {
      next[key] = tryParseJsonString(next[key]);
    }
  }
  if (
    next.items &&
    typeof next.items === "object" &&
    !Array.isArray(next.items)
  ) {
    next.items = [next.items];
  }
  if (Array.isArray(next.items)) {
    next.items = next.items.map((item) => tryParseJsonString(item));
  }
  if (
    next.replacements &&
    typeof next.replacements === "object" &&
    !Array.isArray(next.replacements)
  ) {
    next.replacements = [next.replacements];
  }
  if (Array.isArray(next.replacements)) {
    next.replacements = next.replacements.map((item) =>
      tryParseJsonString(item)
    );
  }
  return next;
}

export function defineAcademicTool<
  T extends ReturnType<typeof Type.Object>
>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<AcademicToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, AcademicToolDetails> {
  const tool: AgentTool<T, AcademicToolDetails> = {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: sanitizeToolSchemaForGemini(definition.parameters) as T,
    execute: definition.execute,
    ...(definition.executionMode
      ? { executionMode: definition.executionMode }
      : {})
  };
  tool.prepareArguments = (args) =>
    prepareAcademicToolArguments(args) as Static<T>;
  return tool;
}
